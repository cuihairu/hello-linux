# 配置管理工具

一台机器的配置写在文本文件里；一百台机器的配置靠**工具**保证一致。配置管理横跨两个层面：**单机上选对入口**（网络、时间、主机名、内核参数写在哪、怎么生效），以及**多机上用声明式工具收敛状态**（Ansible 等）。前者错了会断网丢数据，后者错了会在半小时后于全网复现事故。

> 内容参考自 Ansible、Puppet、Chef、SaltStack 官方文档与 Arch Wiki，见文末参考资料。

## 学习目标

- 理解为什么文本配置优于 GUI，以及单机配置的三系入口
- 掌握 sysctl 持久化在三系的路径差异与验证方法
- 掌握 Ansible 清单、ad-hoc、Playbook、角色的主线用法
- 了解 Puppet/Chef/Salt 的定位差异，能按场景选型
- 形成"改配置 → 验证 → 可回滚"的操作习惯

## 1. 为什么需要配置管理

手工 `ssh` 上去改十台机器，第一台成功、第三台手滑、第七台漏改——这不是态度问题，是**变更方式**问题。配置管理（Configuration Management）把"最终期望状态"写成代码，由工具去比对、收敛、报告差异，带来四件手工做不到的事：

- **一致性**：100 台机器收敛到同一份声明，不靠"我上次是这么改的"。
- **可重复**：新机房扩容 = 再跑一遍同一 Playbook，而不是重写 checklist。
- **可审计**：配置进 Git，谁在何时把 `nginx.conf` 从 A 改成 B，diff 一眼可见。
- **可回滚**：上一个 commit checkout 回来即可，不用在生产上凭记忆反向 sed。

### 1.1 文本配置为什么优于 GUI

图形界面点两下就能改完的选项，为什么 Linux 运维坚持"一切皆文本"？因为服务器场景下 GUI 的前提是**本机、可视、单次、无审计**——四条前提在生产上全部不成立：

1. **可 diff**：`diff -u old.conf new.conf` 即变更评审；GUI 勾选状态无法被 review，更无法进 Git。
2. **可复制**：同一份 YAML 拷到 100 台完全一致；每台手工点 GUI 必然出现配置漂移（configuration drift）。
3. **可远程**：SSH 五毫秒可达，装桌面环境与显卡驱动才能改配置则荒谬；无头服务器占 Linux 服务器绝大多数。
4. **可自动化**：Ansible 这类工具的底层操作对象是文本、命令与模块，不是鼠标事件。

GUI 并非一无是处：初次探索选项、或用 `nmtui`/`netplan try` 这类**带回滚的交互工具**避免把远程网络配断，都很实用。正确姿势是：**用交互工具探索，用文本文件固化**。单机三系入口（Netplan/nmcli/networkd、timedatectl、hostnamectl）的完整原理与操作在[系统配置工具](../../basic/services/configuration_tools.md)已系统讲过，本章不重复展开，只留速查与交叉引用；下面先补内核参数这一课里最容易踩错的 sysctl 持久化。

### 1.2 单机配置：三系入口速查

装机后第一次基础配置，按"网络 → 时间 → 主机名 → 内核参数"顺序做。三系差异集中在**网络前端**，时间与主机名因 systemd 而统一：

| 配置项 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|--------|---------------|------|-------------------|
| 网络前端 | **Netplan**（`/etc/netplan/*.yaml` → `netplan apply`/`try`） | **systemd-networkd**（`/etc/systemd/network/*.network`）或 NetworkManager | **NetworkManager**（`nmcli`，keyfile 存 `/etc/NetworkManager/system-connections/`） |
| 网络验收 | `netplan status` + `ip addr` | `networkctl status` + `ip addr` | `nmcli device status` + `ip addr` |
| 时间 | `timedatectl set-timezone` / `set-ntp` | 同左 | 同左（底层常为 chronyd） |
| 主机名 | `hostnamectl set-hostname` | 同左 | 同左 |
| 内核参数 | `/etc/sysctl.d/*.conf` | `/etc/sysctl.d/*.conf` | `/etc/sysctl.d/*.conf`（遗留 `/etc/sysctl.conf`） |

三条网络路线要点（细节与 YAML 示例见[系统配置工具](../../basic/services/configuration_tools.md)、[网络配置基础](../../network/network-configuration.md)）：

- **Netplan 不直接管网卡**，只负责把 YAML 渲染成 networkd 或 NetworkManager 配置；远程会话务必 `sudo netplan try`（120 秒不确认自动回滚），不要上来就 `apply`。
- **nmcli 是 NetworkManager 的统一入口**，也是三系里唯一完整覆盖 Wi-Fi/VPN 的工具；改完连接要 `connection down/up` 才落地，文本事实来源在 keyfile（权限必须 600）。
- **systemd-networkd** 是纯 systemd 栈，Arch 服务器最小安装常用；改完 `systemctl restart systemd-networkd`，用 `networkctl` 验收。

同一只网卡只能有一个管理者：NetworkManager 与 networkd 同时 enable 会互相覆盖 DHCP 与路由，这是网络配置第一大坑。

时间与主机名三系命令一致：

```bash
$ timedatectl
System clock synchronized: yes
              NTP service: active

$ sudo timedatectl set-timezone Asia/Shanghai
$ sudo timedatectl set-ntp true
$ sudo hostnamectl set-hostname web01.example.com
```

时钟不同步会导致 TLS 校验失败、日志时间错乱、定时任务错峰——属于装机必查项，完成标准是 `timedatectl` 里 `System clock synchronized: yes`。

### 1.3 sysctl 持久化：路径差异与验证

内核参数是配置管理里"单机层"的高频对象（`vm.swappiness`、`net.ipv4.ip_forward`、`fs.file-max`）。**运行时**改用 `sysctl -w`，**持久化**三系推荐统一写 `/etc/sysctl.d/99-<topic>.conf`，由 systemd-sysctl 开机按优先级加载（`/etc` 覆盖 `/usr/lib` 同名文件）：

```bash
# /etc/sysctl.d/99-forward.conf
net.ipv4.ip_forward=1
```

```bash
$ sudo sysctl --system | grep ip_forward         # 确认合并结果里有这行
$ sudo sysctl -p /etc/sysctl.d/99-forward.conf   # 不重启先生效
```

| 事项 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 推荐路径 | `/etc/sysctl.d/*.conf` | `/etc/sysctl.d/*.conf` | `/etc/sysctl.d/*.conf` |
| 遗留 `/etc/sysctl.conf` | `sysctl -p` 默认读取 | 不推荐使用 | 老教程常见，仍可能残留 |
| 开机加载 | systemd-sysctl | 同左 | 同左 |

**坑**：`echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf` 在只认 `.d` 目录的加载链上可能**重启后丢失**；改完务必 `sysctl --system` 或重启后复查。内存相关的 swappiness/vfs_cache_pressure 同理，完整讨论见[内存管理](./memory.md)。

单机配置解决"这一台对不对"；接下来的自动化工具解决"一千台是否仍然一致"。

## 2. 配置管理工具选型

四款主流工具常被并列讨论，但定位并不相同：有的强调无代理轻量，有的强调大规模强一致，有的把"变更即代码"做到极致。先看总表，再决定深入哪一家：

| 工具 | 语言 | 架构 | 拓扑规模 | 学习曲线 | 典型场景 |
|------|------|------|----------|----------|----------|
| **Ansible** | Python | 无代理，SSH | 数百～数千 | 低 | 交付快、混合环境、临时任务与持续收敛 |
| Puppet | Ruby | C/S（agent） | 数千～数万 | 中高 | 长期合规、变更窗口严格的企业 |
| Chef | Ruby | C/S（client） | 数千～数万 | 中高 | DevOps 深度集成、Ruby 技术栈 |
| SaltStack | Python | C/S（minion），ZeroMQ | 数万、分钟级下发 | 中 | 大规模、需要高并发执行的环境 |

选型不必纠结"谁更强"：**没有代理 + YAML + 巨量现成模块**让 Ansible 成为事实默认；已有 Puppet/Chef 资产的组织继续深耕即可；Salt 在"万级机器同时跑命令"时性能优势明显。新手与本文其余示例均以 Ansible 为主线——它也是唯一能让你在五分钟后就跑通第一条 ad-hoc 的选项，学习反馈最快。

## 3. Ansible：无代理自动化

### 3.1 安装（三系含 pacman）

控制节点只需要一个 Python 环境和包管理器装出来的 `ansible` 命令；被控端在首次连接时由 Ansible 探测解释器版本。三系安装如下（包名一致，前端不同）：

```bash
sudo apt update && sudo apt install ansible   # Debian/Ubuntu
sudo pacman -S ansible                        # Arch（先 pacman -Syu 完整升级，避免 partial upgrade）
sudo dnf install ansible                      # RHEL/CentOS/Rocky
```

Arch 注意：滚动发行版上"只装一个包"容易触发 partial upgrade，务必先 `pacman -Syu`。安装后验证：

```bash
$ ansible --version
ansible [core 2.16.3]
  config file = /etc/ansible/ansible.cfg
```

控制节点需要 Python；被控端默认也依赖 Python（Ansible 会推送/调用），极简镜像需预装或配 `ansible_python_interpreter`。连接基于 SSH，建议先配好密钥与 `~/.ssh/config`，否则每条 ad-hoc 都要输密码。

### 3.2 核心概念

- **控制节点**：运行 `ansible`/`ansible-playbook` 的机器。
- **被控节点**：清单里被管理的主机，通过 SSH（或 WinRM 等）接入。
- **清单（Inventory）**：定义"谁被管"，可分组、可带变量。
- **模块（Module）**：原子能力单元（`apt`、`copy`、`systemd`…），每次任务调用一个模块。
- **Playbook**：YAML 编排的剧本：对哪些主机、以什么身份、按何顺序执行哪些任务。
- **角色（Role）**：把 tasks/handlers/templates/vars 打包复用的目录约定。

### 3.3 清单文件

默认位置 `/etc/ansible/hosts`，项目中更常用 `-i inventory/hosts` 指定自有清单：

```ini
# inventory/hosts
[webservers]
192.168.10.20 ansible_user=deploy
192.168.10.21 ansible_user=deploy ansible_port=2222

[dbservers]
192.168.10.30

[prod:children]
webservers
dbservers

[webservers]                # 同组可再追加，支持范围简写
192.168.10.2[0:9]
```

变量可写在主机行、`[group:vars]`、或 `group_vars/`/`host_vars/` 目录——**敏感变量（密码、token）不要明文进 Git**，用 Ansible Vault（`ansible-vault encrypt`）加密存储。

### 3.4 ad-hoc：一条命令的剧本

适合巡检与一次性操作，本质是"单任务 Playbook"：

```bash
$ ansible all -m ping
192.168.10.20 | SUCCESS => {"ping": "pong"}

$ ansible webservers -m shell -a "df -h | head -5"
$ ansible all -m package -a "name=nginx state=present" --become   # 自动选 apt/pacman/dnf
$ ansible all -m copy -a "src=files/motd dest=/etc/motd mode=0644" --become
```

**跨发行版时优先用 `ansible.builtin.package`**（或按 `ansible_os_family` 条件分派 `apt`/`dnf`/`pacman` 模块），不要在 Playbook 里写死 `apt`——否则同一流程跑到 Rocky 上直接失败。`-m shell` 会过 shell 解释，能用具名模块就别用 `shell`/`command`，幂等性与可读性都会好一截。

### 3.5 Playbook

Playbook 是声明式核心：描述**期望状态**，可反复执行（幂等），而非"执行一遍的脚本"：

最小可运行结构如下（安装 → 下发配置 → 确保服务，配置变更才通过 handler 重启）：

```yaml
# deploy-nginx.yml
---
- hosts: webservers
  become: true
  tasks:
    - ansible.builtin.package: { name: nginx, state: present }
    - ansible.builtin.template:
        src: nginx.conf.j2
        dest: /etc/nginx/nginx.conf
        mode: "0644"
      notify: Restart nginx
    - ansible.builtin.systemd:
        name: nginx
        state: started
        enabled: true
  handlers:
    - name: Restart nginx
      ansible.builtin.systemd: { name: nginx, state: restarted }
```

```bash
$ ansible-playbook -i inventory/hosts deploy-nginx.yml
$ ansible-playbook --check --diff deploy-nginx.yml   # 演练：不落盘，只报差异
$ ansible-playbook --limit 192.168.10.20 deploy-nginx.yml
```

**养成先 `--check --diff` 的习惯**——这是自动化时代的"netplan try"。`notify`/`handlers` 把"配置变了才重启"固化下来，避免每个任务都无脑 restart 服务。完整可投产的 Playbook（含 `validate` 语法校验）见第 5 节实战案例。

### 3.6 常用模块（按用途）

| 用途 | 模块 | 说明 |
|------|------|------|
| 文件 | `copy`、`template`、`file`、`lineinfile`、`replace` | `template` 支持 Jinja2 变量渲染 |
| 包管理 | `apt`、`dnf`、`pacman`、`package` | 跨发行版优先 `package` |
| 服务 | `systemd`（或 `service`） | 三系均为 systemd，语义与 `systemctl` 一致 |
| 用户组 | `user`、`group`、`authorized_key` | 管理 SSH 公钥比改密码安全 |
| 命令 | `command`、`shell`、`script`、`raw` | 无幂等保证，放最后且要有 `creates`/`changed_when` |
| 网络/防火墙 | `nmcli`、`ufw`、`firewalld` | 规则管理见[防火墙](../../network/firewall.md) |

### 3.7 角色（Role）与项目结构

Playbook 超过几十行就该拆角色：把任务、处理器、模板、变量按固定目录拆开后，多个 Playbook 可以组合复用同一套 nginx 逻辑，评审时也只需看 diff。目录约定如下（`site.yml` 里用 `roles: [nginx]` 引用）：

```text
roles/nginx/{tasks,handlers,templates,files,defaults,vars}/...
# site.yml 中引用：
# - hosts: webservers
#   roles: [nginx]
```

`tasks` 放任务、`handlers` 放重启逻辑、`templates` 放 Jinja2、`defaults` 是可被 inventory 覆盖的低优先级变量、`vars` 是高优先级（慎用）。角色可发布到 Galaxy 复用；团队内自建 roles 放私有 Git，用 `ansible-galaxy install -r requirements.yml` 拉取——至此"配置即代码"的闭环完成：Inventory + Playbook + Role 全部进版本库。

## 4. Puppet / Chef / SaltStack 概览

三者与 Ansible 的根本差异在**架构与执行模型**：它们默认在被控端常驻 agent，由服务端周期性推送或拉取期望状态，适合数千台规模与强合规审计；Ansible 无代理，控制端 SSH 现连现跑。以下保留最小可用示例，建立概念即可，深入以官方文档为准。

### 4.1 Puppet（声明式，Ruby DSL）

Puppet 用资源声明"这台机器上 nginx 必须安装且开机运行"，服务器端编译 catalog，agent 周期 apply：

```puppet
package { 'nginx': ensure => installed }
service { 'nginx': ensure => running, enable => true }
file { '/etc/nginx/nginx.conf':
  ensure => file, mode => '0644',
  source => 'puppet:///modules/nginx/nginx.conf',
}
```

概念链是资源（resource）→ 类（class）→ 模块（module）→ 清单（manifest），天然适合"每周对账"式合规。官方仓库提供 `puppet-agent`；Arch 上多经 AUR 或自建仓库，装前用 `pacman -Ss puppet` 确认源里是否收录。

### 4.2 Chef（Ruby，程序式风格强）

```ruby
package 'nginx'
service 'nginx' do
  action [:enable, :start]
end
```

食谱（recipe）组成烹饪书（cookbook），节点（node）带运行列表（run list）。灵活性高，适合已有 Ruby 工具链的团队；需 Chef Workstation + Server + Agent 三件套。

### 4.3 SaltStack（Python，高并发）

```yaml
nginx:
  pkg.installed: []
  service.running: {enable: True, require: [{pkg: nginx}]}
```

Master/Minion 架构、ZeroMQ 通道，`salt '*' test.ping` 级别的扇出速度是其招牌；state 语法为 YAML，与 Ansible 概念可平移。

### 4.4 怎么选（决策链）

选型时先问规模，再问团队现状，最后才看功能清单——工具列表上 Salt 的并发、Puppet 的审计都很诱人，但维护成本会随机器数平方级增长，第一条决策链往往就能筛掉八成选项：

1. 团队规模 < 100 台、无 agent 基础设施 → **Ansible**。
2. 需要持续对账、变更审计严格、已有 Ruby/Puppet 资产 → 维持 **Puppet/Chef**。
3. 数千～数万台、要求秒级并行执行 → 评估 **Salt**，或 Ansible + AWX/Tower 的调度能力。
4. 只是"本机配置固化"、尚无多机诉求 → 本章第 1 节的 sysctl/Netplan/文本文件 + Git 已够，**不要为了工具而工具**。

无论选哪家，验收标准相同：新机器从裸系统到业务就绪能否**一条命令复现**、变更是否可在测试环境 `--check`/dry-run、失败时能否回滚到上一个已知良好状态。达不到这三条，换工具也救不了流程。

## 5. 实战案例：Web 服务器收敛

把安装、目录、页面、站点配置、自启串成可重复执行的流程。相对第 3.5 节的最小示例，这里补上三处生产细节：**文档根目录用 `file` 保证存在**、**站点配置用 `template` 渲染并 `validate`**、**只有配置变化才 `notify` 重启**。写 Playbook 时建议始终带上 `name:`——失败日志里没有任务名的报错等于盲猜：

```yaml
# site-webserver.yml（关键片段）
- hosts: webservers
  become: true
  vars:
    doc_root: /var/www/html
  tasks:
    - ansible.builtin.package: { name: [nginx, curl], state: present }

    - ansible.builtin.file:
        path: "{{ doc_root }}"
        state: directory
        owner: www-data     # 按发行版用变量切换 www-data/nginx
        mode: "0755"

    - ansible.builtin.copy:
        src: files/index.html
        dest: "{{ doc_root }}/index.html"
        mode: "0644"
      notify: Restart nginx

    - ansible.builtin.template:
        src: templates/site.conf.j2
        dest: /etc/nginx/conf.d/site.conf
        mode: "0644"
        validate: nginx -t -c %s   # 语法不通过则拒绝落盘
      notify: Restart nginx

    - ansible.builtin.systemd: { name: nginx, state: started, enabled: true }

  handlers:
    - name: Restart nginx
      ansible.builtin.systemd: { name: nginx, state: restarted }
```

两个值得抄走的细节：`validate` 让坏配置**进不了生产**（比事后 restart 失败再回滚便宜得多）；handler 保证只有配置真正变化时才重启。发行版差异（`www-data` vs `nginx` 用户、站点 conf 目录不同）用 `ansible_os_family` 变量分支，而不是维护两套 Playbook——这正是"文本 + 声明式"相对手工 ssh 的核心收益。

上线前固定走一遍：测试环境 `ansible-playbook --check --diff` → 金丝雀主机 `--limit` 实跑 → 观察 `systemctl status` 与应用日志 → 再全量。任何一步发现问题，回滚都是"改 inventory 再跑上一个 Git 版本"，而不是登十台机器手改文件。

用户批量开通类需求，用 `user` 模块 + 循环（或 `loop`）实现，密码哈希（`password_hash` 过滤器）**禁止明文密码进清单**；SSH 公钥用 `authorized_key` 推送，比分发私钥安全。完整用户管理概念见[用户管理](../../basic/users.md)。

## 6. 常见坑

自动化把"一次手误"放大成"一百台手误"，以下九条按出现频率排序。每一条背后都是真实事故模式——先对照自查，再上线：

1. **改文件 ≠ 生效**。Netplan 要 `apply`/`try`，networkd 要 restart，nmcli 要 down/up，sysctl 要 `--system`/`-p`，服务要 reload/restart。配置管理必须把"应用"写成显式步骤。
2. **sysctl 写进 `/etc/sysctl.conf` 后重启丢失**。三系统一 `/etc/sysctl.d/99-*.conf`，用 `sysctl --system` 验证合并结果。
3. **Playbook 写死 `apt`**。跑上 Rocky/Arch 即失败；用 `package` 模块或按 `ansible_os_family` 分支，把 `pacman`/`dnf` 差异收进变量。
4. **从不 `--check --diff`**。自动化放大错误半径；先演练再上线，与 `netplan try` 同一哲学。
5. **两套网络管理器并存**。NetworkManager + systemd-networkd 同时 enable，DHCP 互相覆盖；`systemctl is-active` 确认只有一个在管同一只网卡。
6. **SSH host key 未接受**，ad-hoc 全挂 `Host key verification failed`。预先把目标主机 key 放入 `known_hosts`，或在受控环境配置 `host_key_checking=False`（有中间人风险，需评估）。
7. **被控端无 Python**。Alpine/极简容器常见；装 python3 或设 `ansible_python_interpreter=/usr/bin/python3`。
8. **敏感信息进 Git**。用 `ansible-vault`，或外置密钥管理系统；`--diff` 输出也可能泄露文件内容，谨慎在 CI 打印。
9. **工具选型过度**。单机两台虚拟机就上 Puppet，运维成本高于收益；先文本 + Git，规模出现后再上 Ansible。

修坑的通用顺序是：先在测试环境复现 → 用 `--check --diff` 或 `netplan try` 一类带回滚的方式验证 → 修清单/配置文件 → 再全量。永远不要在生产上"边改边试"——自动化的错误半径与机器数成正比。

## 参考资料

- Ansible 官方文档 — [docs.ansible.com](https://docs.ansible.com/)
- Ansible Playbook 常用模块 — [docs.ansible.com/ansible/latest/collections/ansible/builtin/](https://docs.ansible.com/ansible/latest/modules/list_of_all_modules.html)
- Puppet 文档 — [puppet.com/docs](https://puppet.com/docs/)
- Chef 文档 — [docs.chef.io](https://docs.chef.io/)
- SaltProject 文档 — [docs.saltproject.io](https://docs.saltproject.io/)
- Arch Wiki - Sysctl — [wiki.archlinux.org](https://wiki.archlinux.org/title/Sysctl)
- Arch Wiki - pacman（控制节点为 Arch 时） — [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- 系统配置工具（网络/时间/主机名详解） — [basic/services/configuration_tools.md](../../basic/services/configuration_tools.md)
- 系统服务管理 — [basic/services/system_services.md](../../basic/services/system_services.md)
- `man sysctl`、`man ansible-playbook`
