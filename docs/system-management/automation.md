# 自动化运维

自动化运维的真正目的不是"少打字"，而是**消除人肉变异**：
同一件事让十个人做会有十种细节差异，让同一个人隔三个月再做又会漏掉当初踩过的坑。
把动作固化成脚本、playbook 或定时器之后，
执行结果不再取决于谁值班、记不记得、敲得快不快。
本页覆盖三块：**怎么选工具**（脚本 vs Ansible）、
**怎么被触发**（cron vs systemd timer vs 流水线）、
**怎么不出事**（幂等性与常见坑）。

> 内容参考自 cron、systemd、Ansible 官方文档与自动化实践，见文末参考资料。
> Bash 语法、调试与 shellcheck 属于[脚本篇](../script/README.md)，
> 本页只讲选型与调度，语法问题请回脚本篇查表。

## 学习目标

- 能在"写脚本、用 Ansible、继续手工"三条路之间做出有依据的选择
- 理解幂等为什么是自动化的生命线，会识别非幂等写法
- 掌握 cron 与 systemd timer 的语义差异及三发行版默认状态
- 理解流水线（CI/CD）与本机定时器的分工边界
- 会写最小可用的 Ansible playbook，并读懂 changed/ok 的反馈

## 1. 何时写脚本，何时用 Ansible

工具选择是本页第一课，因为选错工具的自动化比不自动化更贵——
错误会被定时器准时放大。

**先说分工**：[脚本篇](../script/README.md)解决"怎么把命令写对"——
引号、循环、`set -euo pipefail`、shellcheck；
本页解决"写出来的东西交给谁执行、值不值得上配置管理"。
两篇是上下游关系：脚本篇是车间，本页是调度室。

三条路的判据：

| 判据 | 继续手工 | 写 Shell 脚本 | 上 Ansible |
|------|---------|--------------|-----------|
| 执行频率 | 偶发、一次性 | 周期性（每天/每周） | 周期性或"期望状态常驻" |
| 目标机器数 | 1 台 | 1～几台 | 5 台以上，或差异化的多角色 |
| 失败影响 | 能立刻 Ctrl+C | 单机可控 | 需要统一回滚、审计、审批 |
| 执行者 | 只有你 | 你 + 同事（可读即可） | 团队（需要 review 与幂等语义） |
| 状态描述 | "做过了" | "按步骤做一遍" | "应该长这样"（声明式） |

几个具体场景对号入座：

- **每周压缩清理日志**：单机、周期性、步骤固定——脚本 + cron/timer，到此为止。
- **50 台机器统一装监控 agent、改 sshd 配置**：
  手敲必漏，循环脚本能跑但难表达"每台的差异"；
  Ansible 的 inventory + playbook 天然携带"谁是什么角色"。
  命令篇的[配置管理工具](../commands/system/configuration-management.md)
  对"什么时候值得上配置管理"有更细的判断标准。
- **第一次在陌生机器上装环境**：先手工敲一遍。
  没有手工跑顺的流程直接写自动化，等于给错误配了闹钟。
  跑顺两次后再沉淀成脚本——这是最容易被跳过的中间态。

经验法则：**手工 → 脚本 → 配置管理**是单向升级链，
每升一级都要满足上一级已经"跑顺、可交接"。
反过来，给 3 台机器上一套带 AWX 的 Ansible 平台，
学习与维护成本会超过它省下的时间——
命令篇常见坑第 7 条说的就是这件事。

## 2. 幂等：自动化的生命线

**幂等（idempotent）**：同一操作执行一次和执行 N 次，
最终状态相同。定时器和配置管理都会把你的代码**反复执行**，
非幂等的代码第一次正确、第二次就开始破坏现场：

```bash
# 非幂等：每跑一次追加一行，三天后配置文件里有 30 行相同记录
echo "server 10.0.0.5" >> /etc/hosts

# 幂等写法：先查再写，没有才追加
grep -qF "server 10.0.0.5" /etc/hosts || echo "server 10.0.0.5" >> /etc/hosts

# 非幂等：user 已存在时 useradd 报错退出，脚本若 set -e 直接中断
useradd -m deploy

# 幂等：存在即视为成功，不存在才创建
id -u deploy &>/dev/null || useradd -m deploy
```

Ansible 把幂等做进了模块语义：每个模块回答"目标状态是否已达成"，
没达成才动手，并在结果里如实上报：

```text
TASK [Install Nginx] ************************************************************
changed: [web1]
ok: [web2]                    # web2 已装过，本次无操作——这就是幂等的反馈形态
```

读 playbook 输出时，**`changed` 才代表本次发生了变更**，
`ok` 代表状态本已正确；一次"全 ok"的运行不是没用，
它证明期望状态仍然成立（漂移检测）。
`ansible-playbook --check`（干跑）则在动真格之前先报告"会发生什么"，
与 `rsync -n`、`apt upgrade --simulate` 是同一种安全习惯。

判断一段脚本是否够格进入 cron/timer，先自问：
**连跑三遍会不会出错、会不会累积副作用**。
写不到幂等，至少要写成"失败可识别"（退出码、日志、告警），
见第 6 节的监控闭环。

## 3. 定时与触发：cron、systemd timer、流水线

"何时执行"有三种主流答案，各自解决不同问题。

### 3.1 cron：五字段的经典调度

```bash
$ crontab -e
# 分 时 日 月 周  命令
0 2 * * *    /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1
*/5 * * * *  /usr/local/bin/check-service.sh >> /var/log/check.log 2>&1
0 9 * * 1    /usr/local/bin/send-report.sh >> /var/log/report.log 2>&1
0 0 1 * *    /usr/local/bin/clean-logs.sh >> /var/log/clean.log 2>&1
```

语法三系完全一致，老文档随手可抄。
但三个环境事实必须知道：

- **cron 包并非三系都预装**。
  Debian/Ubuntu 的 `cron` 随基础系统安装并启用；
  RHEL/CentOS/Rocky 用 `cronie`，默认安装并启用；
  **Arch 默认没有 cron**，需要 `sudo pacman -S cronie`
  并 `systemctl enable --now crond`，或者干脆改用 timer（见 3.2）。
- **环境变量极瘦**。cron 的 `PATH` 只有基础几项，
  脚本里一律写绝对路径；`HOME`、语言环境也与登录时不同。
- **输出默认去你邮箱**。没有 `>> log 2>&1` 的任务，
  成功失败都可能静默消失在本地 MTA 里——这是"脚本明明在跑却没人知道它挂了"的头号原因。

一次性任务用 `at`（`apt install at` / `pacman -S at` / `dnf install at`，
Arch 上同样可能需要手动启用）：
`at 02:00` 后输入命令、Ctrl+D 提交，`atq` 查看、`atrm` 取消。
`at` 适合"今晚跑一次就完了"，不要拿它当周期调度。

### 3.2 systemd timer：可观测、可补跑、可依赖

timer = `oneshot` 服务单元 + `.timer` 触发单元：

```ini
# /etc/systemd/system/my-task.service
[Unit]
Description=My task

[Service]
Type=oneshot
ExecStart=/usr/local/bin/my-task.sh

# /etc/systemd/system/my-task.timer
[Unit]
Description=Daily my-task at 02:00

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
$ sudo systemctl daemon-reload
$ sudo systemctl enable --now my-task.timer
$ systemctl list-timers my-task.timer
NEXT                      LEFT     LAST                        PASSED  UNIT
Tue 2026-01-20 02:00:00   6h left  Mon 2026-01-19 02:00:00    18h ago my-task.timer
```

相比 cron 的实质优势有三：
**日志免费**——`journalctl -u my-task.service` 直接给上次运行的完整输出，
不必自己拼重定向；
**`Persistent=true` 错过即补**——关机睡眠错过的凌晨两点，
开机后自动补跑，对桌面与非 7×24 服务器是刚需；
**可声明依赖与条件**——`After=network-online.target`、
`ConditionPathExists=/backup` 让"盘没挂载就不备份"变成声明而不是脚本 if。
代价是 unit 文件语法要查手册（`man systemd.time` 的 `OnCalendar` 写法比五字段啰嗦）。

### 3.3 流水线：事件驱动，而非时钟驱动

cron 和 timer 都在回答"几点跑"，流水线回答的是
**"代码变了就跑"**——触发源是事件（git push、镜像构建完成、PR 合并），
这是部署与测试类任务的正确形态：

```bash
#!/bin/bash
# /var/repo/myapp.git/hooks/post-receive —— 最小流水线：服务器端钩子，push 即部署
GIT_WORK_TREE=/var/www/myapp git checkout -f
sudo systemctl restart myapp
```

企业级形态是 Jenkins、GitLab CI 这类 CI 系统：
代码检出、构建、测试、部署串成带状态与历史的流水线。
Jenkins 官方仓库安装（密钥会定期轮换，
**以 <https://pkg.jenkins.io/debian-stable> 与
<https://www.jenkins.io/doc/book/installing/> 当前文档为准**，
下面的命令以 2026 年初的密钥为例）：

```bash
# 密钥文件名里的年份会变（jenkins.io-2026.key 仅为当前示例），
# 指纹/密钥随时间轮换——安装前一律以官方文档的最新值为准
# Debian/Ubuntu（LTS 仓库；weekly 仓库把 debian-stable 换成 debian）
curl -fsSL https://pkg.jenkins.io/debian-stable/jenkins.io-2026.key \
  | sudo tee /usr/share/keyrings/jenkins-keyring.asc > /dev/null
echo "deb [signed-by=/usr/share/keyrings/jenkins-keyring.asc] \
https://pkg.jenkins.io/debian-stable binary/" \
  | sudo tee /etc/apt/sources.list.d/jenkins.list > /dev/null
sudo apt update && sudo apt install fontconfig openjdk-21-jre jenkins

# RHEL/CentOS/Rocky
sudo rpm --import https://pkg.jenkins.io/rpm-stable/jenkins.io-2026.key
sudo wget -O /etc/yum.repos.d/jenkins.repo \
  https://pkg.jenkins.io/rpm-stable/jenkins.repo
sudo dnf install fontconfig java-21-openjdk jenkins
```

Arch 官方仓库不提供 Jenkins，
可用 AUR 社区包或直接跑官方容器镜像——
容器方式与[容器篇](../server/container/docker.md)衔接，本页不展开。
Ruby 生态的 Capistrano（`gem install capistrano` 后 `cap production deploy`）
属于应用部署工具，定位与流水线重叠，本文不再展开。
选择标准一句话：**周期性任务用 timer/cron，代码事件驱动用流水线，
多机状态收敛用 Ansible**——三者经常并存而非互斥。

### 3.4 cron vs timer vs 流水线 速查

| 维度 | cron | systemd timer | 流水线（CI） |
|------|------|--------------|-------------|
| 触发源 | 时钟 | 时钟（可补跑） | 代码/事件 |
| 日志 | 自行重定向 | journal 自带 | 平台自带 |
| 错过触发 | 静默跳过 | `Persistent=true` 可补 | 不适用 |
| 多机分发 | 不解决 | 不解决 | 不解决（部署场景除外） |
| 学习成本 | 最低 | 中（unit 语法） | 高（平台 + 流水线语法） |
| 典型任务 | 清理、报表、简单备份 | 备份、巡检、需依赖判断的任务 | 构建、测试、发布 |

## 4. Ansible：多机一致性的默认答案

### 4.1 三系安装

| 项目 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 完整 ansible（含 collections） | `sudo apt install ansible` | `sudo pacman -S ansible` | 启用 EPEL 后 `dnf install ansible` |
| 最小 ansible-core | `apt install ansible-core` | `sudo pacman -S ansible-core` | `sudo dnf install ansible-core`（AppStream 自带） |
| 被控端要求 | 有 Python 3 即可，无代理 | 同左 | 同左（注意 Python 版本对齐支持矩阵） |

RHEL 系一个易混点：AppStream 直接给的是 `ansible-core`（最小运行时），
带社区 collections 的完整 `ansible` 包通常要 EPEL
（`sudo dnf install epel-release`）。
控制端与被控端的 Python 版本需对照
[Ansible 支持矩阵](https://docs.ansible.com/)核实，
"装上了却连不上/模块缺失"多半是这个原因。
Arch 上 `pacman -S ansible` 一条即可，无需 AUR。

### 4.2 清单与连通性

```ini
# /etc/ansible/hosts
[webservers]
web1 ansible_host=192.168.1.100
web2 ansible_host=192.168.1.101

[dbservers]
db1 ansible_host=192.168.1.200
```

```bash
$ ansible all -m ping
web1 | SUCCESS => {
    "changed": false,
    "ping": "pong"
}
```

`ping` 模块不发 ICMP，而是走 SSH 执行一小段 Python——
它是"控制端 → 被控端"整条链路的冒烟测试：
SSH 密钥、sudo、Python 解释器任何一环不通都会在这里暴露。

### 4.3 Ad-hoc 命令：临时的一次性动作

```bash
$ ansible all -m shell -a "uptime"                      # 集合看负载
$ ansible webservers -m apt -a "name=nginx state=present"  # 装包（声明式）
$ ansible all -m copy -a "src=ntp.conf dest=/etc/ntp.conf"
$ ansible all -m service -a "name=nginx state=started enabled=yes"
```

Ad-hoc 适合"敲一次就完"的批量动作；
同样的命令第二次执行就应该沉淀进 playbook——
ad-hoc 没有版本历史，出事无法 diff，这是它与 playbook 的真正分界。

### 4.4 Playbook：可评审的期望状态

```yaml
# playbook.yml
---
- hosts: webservers
  become: true
  tasks:
    - name: Install Nginx
      apt:
        name: nginx
        state: present

    - name: Copy configuration
      copy:
        src: nginx.conf
        dest: /etc/nginx/nginx.conf
      notify: Restart Nginx

    - name: Start and enable Nginx
      service:
        name: nginx
        state: started
        enabled: yes

  handlers:
    - name: Restart Nginx
      service:
        name: nginx
        state: restarted
```

要点有三：模块名与发行版绑定（`apt`/`pacman`/`dnf`/`yum` 各有其模块，
`package` 模块则自动选择，混管三系时优先 `package`）；
`notify` 让"配置变了才重启"成为结构化约束，避免每次都重启；
每个 task 的 `changed/ok/failing` 输出就是第 2 节说的幂等反馈。
上生产前先 `ansible-playbook --syntax-check` 再 `--check` 干跑一遍。

角色（Role）把 playbook 拆成可复用目录：

```text
roles/nginx/
  tasks/main.yml      # 主流程
  handlers/main.yml   # 重启等联动动作
  templates/nginx.conf.j2   # 可变配置模板
  files/              # 静态文件
  vars/main.yml       # 高优先级变量
  defaults/main.yml   # 可被覆盖的默认值
```

```yaml
- hosts: webservers
  roles:
    - nginx
    - php
```

defaults 与 vars 的分界是"环境差异放 defaults、
本环境不可变的值放 vars"——这也是 Ansible Galaxy 生态的通用布局，
读别人的 role 时能直接对照。

## 5. 与脚本篇的分工：什么时候停留在脚本

自动化不等于 Ansible。以下任务**写脚本 + timer 就是终点**，
上 Ansible 属于过度设计：

- 单机的日志切割、临时文件清理、本机自监控；
- 依赖大量 shell 管道文本处理的逻辑（Ansible 模块表达反而更绕）；
- 一次性迁移、压测脚本这类跑完即弃的流程。

而这些信号出现时，说明该升级到配置管理了：
同一条命令在三台机器上出现了三种手工变体；
新人入职要口述五步操作；
某次故障复盘发现"只有张三知道怎么改"。
命令篇的[配置管理工具](../commands/system/configuration-management.md)
还对比了 Puppet/Chef/SaltStack 的定位——
它们与 Ansible 的差异（代理 vs 无代理、推 vs 拉）在那一页展开，
本页只保留默认建议：**5～50 台规模从 Ansible 起步**。

脚本本身的质量问题——引号、循环子 shell、`$@` 与 `$*`、
shellcheck 报警——全部回[脚本篇](../script/README.md)与
[脚本调试](../script/debugging.md)解决，本页不重复。

## 6. 监控与告警也要自动化

巡检脚本写完只完成一半，另一半是**让它在失败时出声**，
而且要挂到第 3 节的调度器上，不要手写常驻循环：

```bash
#!/bin/bash
# check-thresholds.sh —— 由 cron/timer 每 5 分钟拉起一次
LOG=/var/log/system-monitor.log

# 用 if/fi 而非 `[ ... ] && ...`：条件不成立时后者会以退出码 1 结束，
# 让 cron/systemd 误报整次巡检失败
disk=$(df -P / | awk 'NR==2{print $5}' | tr -d '%')
if [ "$disk" -gt 90 ]; then
    echo "$(date) DISK usage high on /: ${disk}%" >> "$LOG"
fi

# 内存判定用 available 而非 free（列含义见命令篇 · 内存管理）
mem_avail=$(awk '/^MemAvailable:/{printf "%d", $2/1024}' /proc/meminfo)
if [ "$mem_avail" -lt 256 ]; then
    echo "$(date) LOW mem available: ${mem_avail}MB" >> "$LOG"
fi
```

调度行（cron 与 timer 二选一）：

```bash
*/5 * * * * /usr/local/bin/check-thresholds.sh   # cron 版
# 或 OnCalendar=*:0/5 的 systemd timer（写法见 3.2）
```

三个刻意的取舍，都来自实际踩坑：

- **拒绝 `while true; do ...; sleep 300; done`**。
  它是伪装成守护进程的定时器：进程被 OOM 杀掉后巡检静默消失，
  没有日志边界、不好重启、难以审计。
  `systemd` 或 cron 牵起的单次运行天生带生命周期与日志，
  短任务永远优先交给调度器。
- **阈值与通道先 `command -v` 确认**。
  最小化镜像常没有 `bc`、`mail`，
  判定用整数运算（`[ ]`/`(( ))`），通道用 webhook 更可移植；
  邮件/webhook 的选型讨论在
  [命令篇 · 系统监控](../commands/system/monitoring.md)。
- **阈值没有全球标准**。
  先采一周基线再定线，磁盘 90%、`available` 低水位这类数字
  必须能回答"为什么是这个值"；
  机器多了之后，这类检查迁移到 Prometheus + alertmanager，
  见[监控](../server/monitoring/prometheus.md)。

## 7. 配置文件的自动化：etckeeper

`/etc` 是手工修改最频繁、也最难审计的地方。
etckeeper 用 Git 看住它：每次包安装/升级自动提交，改动能 diff、能回滚：

```bash
# 三系安装：Debian/Ubuntu、Arch 官方仓库均自带；RHEL 系在 EPEL
sudo apt install etckeeper        # Debian/Ubuntu
sudo pacman -S etckeeper          # Arch
sudo dnf install epel-release && sudo dnf install etckeeper   # RHEL 系

$ sudo etckeeper init
$ sudo etckeeper commit "initial import"
$ sudo etckeeper vcs log --oneline | head -3
```

它与 Ansible 不冲突，定位互补：
etckeeper 记录"**实际被改成了什么**"（事后审计），
Ansible 约束"**应该是什么**"（事前声明）。
小团队常从 etckeeper 起步——
成本只是一次 init，却把 `/etc` 从"薛定谔的配置"变成有历史的仓库。

容器与多机编排属于[容器篇](../server/container/docker.md)与服务器篇，
本页不再重复 Compose 示例；
需要"把一整套服务定义成代码"时先读那两处，
再回到本页为它选择触发器（多半是流水线）。

## 8. 实战案例：带备份与回滚意识的部署脚本

```bash
#!/bin/bash
# deploy.sh —— 单机部署：先备份当前版本，再更新、构建、重启
set -euo pipefail

APP=myapp
DEPLOY_DIR=/opt/$APP
BACKUP_DIR=/var/backups/$APP
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"
tar -czf "$BACKUP_DIR/${APP}_${DATE}.tar.gz" -C "$DEPLOY_DIR" .

cd "$DEPLOY_DIR"
git pull --ff-only origin main
npm ci
npm run build

systemctl restart "$APP"
echo "deploy ok: $DATE"
```

设计要点对应本页各节：
`set -euo pipefail` 让任一步失败即停（不会带着半成品重启服务）；
`git pull --ff-only` 拒绝分叉，避免自动部署制造合并冲突；
部署前备份当前版本，**回滚路径在设计期就存在**——
与[备份页](./backup-and-recovery.md)"恢复演练才是真备份"是同一条纪律；
`systemctl restart` 前先做服务自检：`nginx -t`、`sshd -t`、
`systemd-analyze verify myapp.service`（因服务而定），
迁移脚本则先 `--check` 干跑。

把 deploy.sh 挂到流水线的 post-receive 钩子（3.3 节）
或人工执行均可；
**不要**挂到每五分钟一次的 cron 上——
部署的触发源应当是代码事件，不是时钟。

## 9. 常见坑

1. **脚本没幂等就进 cron**。
   追加式配置、重复 useradd、重复建表——
   连跑三遍先做验收测试（第 2 节）。
2. **输出没有归宿**。
   cron 任务不重定向、timer 任务不看 journal，
   失败两周后才被发现。验收标准：随便挑一天能查到上次运行结果。
3. **依赖交互环境的隐式状态**。
   crontab 里引用了只在 `.bashrc` 里的变量/`PATH`，
   在交互终端正常、在 cron 里失败。脚本内全部显式赋值 + 绝对路径。
4. **Arch 上找不到 `crontab`**。
   默认无 cron：`sudo pacman -S cronie` 并启用 crond，
   或改用 systemd timer——三系对照见第 3 节。
5. **改了 unit 文件忘了 `daemon-reload`**。
   timer/service 不生效时先 `systemctl daemon-reload`，
   再 `enable` + `start`（两者管不同事：一个管开机、一个管当下）。
6. **Ansible 包名/仓库搞混**。
   RHEL 系 AppStream 是 `ansible-core`，完整包在 EPEL；
   Arch 用 `pacman -S ansible`；Debian/Ubuntu 是 `apt install ansible`。
   装错包的典型症状是 `ansible-galaxy` 或常用 collection 不见了。
7. **playbook 用 `shell` 模块当默认**。
   `shell`/`command` 不可幂等声明，应尽量换 `apt`/`copy`/`template`/
   `service` 等声明式模块，让 `changed` 有意义。
8. **`while true` 常驻巡检代替调度器**。
   见第 6 节：进程死则监控死，还占着一个"看起来在工作"的进程名。
9. **流水线密钥照抄旧文章**。
   Jenkins 等仓库签名密钥会轮换（2023 版密钥在 2026 年已失效），
   安装命令永远以官方文档当次为准（3.3 节给出的就是轮换后的写法）。
10. **自动化了但从不演练回滚**。
    部署脚本有备份步骤，但没人试过 `tar -xzf` 回去——
    与备份页的结论一致：**演练过的流程才算存在**。

## 参考资料

- `man cron`、`man crontab`、`man systemd.timer`、`man systemd.time`、`man at`
- cron(8)/crontab(5) 在线手册 — [man7.org](https://man7.org/linux/man-pages/man5/crontab.5.html)
- systemd.timer(5) — [man7.org](https://man7.org/linux/man-pages/man5/systemd.timer.5.html)
- Ansible 安装文档（含各发行版包名） — [docs.ansible.com](https://docs.ansible.com/projects/ansible-core/devel/installation_guide/installation_distros.html)
- Ansible 官方文档 — [docs.ansible.com](https://docs.ansible.com/)
- Arch Wiki - Ansible — [wiki.archlinux.org](https://wiki.archlinux.org/title/Ansible)
- Arch Wiki - Cron（cronie） — [wiki.archlinux.org](https://wiki.archlinux.org/title/Cron)
- Arch Wiki - systemd/Timers — [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd/Timers)
- Jenkins 安装文档（Linux packages，密钥以此为准） — [jenkins.io](https://www.jenkins.io/doc/book/installing/)
- etckeeper 官方站点 — [etckeeper.branchable.com](https://etckeeper.branchable.com/)
- Arch Wiki - Etckeeper — [wiki.archlinux.org](https://wiki.archlinux.org/title/Etckeeper)
- 鸟哥的私房菜 - 例行性任务排程 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0430cron.php)
- Red Hat - 自动化主题 — [redhat.com](https://www.redhat.com/en/topics/automation)
- [脚本篇](../script/README.md)（Bash 语法、调试与 shellcheck）
