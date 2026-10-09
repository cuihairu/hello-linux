# 云计算与 cloud-init

前一章还在自己的机器上装虚拟机，这一章把视角换成租：实例在网页或 API 上点出来，几分钟内可登录，用完销毁。运维的主战场从一台主机变成一组可编程的资源——但落到实例内部，它仍然是一台跑着 systemd 的 Linux，包管理、服务、日志一样不少。变化集中在两处：装机变成了镜像启动，配置注入变成了 cloud-init。本页讲清云服务模型的分层、实例与镜像的关系、cloud-init 的运行机制，以及安全组这类云上特有的概念。

> 内容参考自 cloud-init 官方文档与 Ubuntu/Debian 官方云镜像站，包版本事实于 2026-10-10 经 Arch 官方包 API 与 CentOS Stream 9 镜像目录实取。

## 学习目标

- 用 IaaS/PaaS/SaaS 说清「你管到哪一层」，判断一个场景该买哪种
- 说清实例生命周期与机器镜像的关系，明白镜像里为什么必须装 cloud-init
- 读懂一份 `#cloud-config` 用户数据，用 NoCloud 数据源在本地虚拟机走通注入流程
- 用 metadata 服务让实例查到自己的属性，知道它为什么不能当配置库用
- 把安全组与系统防火墙的分工讲清楚，排错时知道查哪一层

## 1. 云服务模型：你管到哪一层

| 模型 | 云管什么 | 你管什么 | 典型形态 |
|------|---------|---------|---------|
| IaaS | 硬件、虚拟化层、网络底座 | 操作系统及以上：系统配置、包、服务、数据 | 云主机实例、云磁盘 |
| PaaS | 再往上包括运行时与中间件 | 应用代码与配置 | 托管数据库、对象存储、容器平台 |
| SaaS | 几乎全部 | 使用与账号管理 | 网页邮箱、协作工具 |

三条界限的判断方法：出问题该谁修。内核要打补丁是你——IaaS；连接数超限要升配额是平台——PaaS；功能不对找客服——SaaS。系统运维的主战场在 IaaS，PaaS 是把系统层工作外包出去的选项，外包了多少，本仓讲的那套 systemd、包管理、防火墙知识就剩多少用武之地。

## 2. 实例与镜像

实例（instance）是租到的一台虚拟机，生命周期三条主线：启动（run）、停止（stop，磁盘保留、计算不再计费）、销毁（terminate，一切归零）。实例从机器镜像（machine image）启动——一个装好系统、预配置好的磁盘映像。Ubuntu 与 Debian 都发布官方云镜像（[cloud-images.ubuntu.com](https://cloud-images.ubuntu.com/)、[cloud.debian.org](https://cloud.debian.org/)，2026-10-10 实测可达），qcow2/raw 格式既能导入公有云，也能喂给本机 KVM 复用同一套镜像。

镜像与实例的关系引出云计算的关键机制：同一份镜像要能在一千台硬件各异的宿主机上启动成一千台配置各异的实例，系统必须在**第一次启动时**按需配置——主机名、网络、SSH 密钥、磁盘扩容都不能烤死在镜像里。承担这件事的就是 cloud-init。

## 3. cloud-init：启动时的配置注入

cloud-init 在系统首次启动（确切说是 instance-id 变化后的首次启动）时运行，从「数据源」读取配置并按阶段执行。本地测试最常用 NoCloud 数据源——配置来自挂载的 ISO 或 seed 盘，不依赖云厂商；公有云上数据源是 metadata 服务（第 4 节）。

三系安装（生产镜像都已预装，手搓虚拟机或容器镜像才需要装）：

| 操作 | Debian/Ubuntu | RHEL/Rocky | Arch |
|------|---------------|-----------|------|
| 安装 | `apt install cloud-init` | `dnf install cloud-init` | `pacman -S cloud-init` |
| 服务单元 | cloud-init-local / cloud-init / cloud-config / cloud-final 四段链 | 同左 | 同左 |
| 主配置 | `/etc/cloud/cloud.cfg` | 同左 | 同左 |
| 日志 | `/var/log/cloud-init.log` 与 journal | 同左 | 同左 |

包版本现状：Arch 26.2（extra），EL9 24.4（AppStream）。四个服务单元按 local → network → config → final 顺序串成链，前面的阶段不依赖网络（磁盘挂载、growpart），后面的阶段可以联网拉包。

### 3.1 一份能用的 user-data

user-data 以 `#cloud-config` 开头，是 YAML 格式的声明式配置。下面这份在 NoCloud 场景下完成「改主机名、建运维账号配好密钥、更新系统、装 Web 服务」四件事：

```yaml
#cloud-config
hostname: web-01
users:
  - name: ops
    sudo: ALL=(ALL) NOPASSWD:ALL
    groups: wheel
    shell: /bin/bash
    ssh_authorized_keys:
      - ssh-ed25519 AAAAC3NzaC1lZDI1... ops@example.com
package_update: true
packages:
  - nginx
runcmd:
  - systemctl enable --now nginx
```

验证语法不必等启动：`cloud-init schema --config-file user-data` 直接校验。实例侧确认注入是否完成：

```bash
$ cloud-init status --wait      # 阻塞到四个阶段全部跑完，脚本里等初始化就用它
$ cloud-init query datasource   # 查当前数据源与实例属性
$ sudo less /var/log/cloud-init.log   # 没生效先翻日志，按阶段定位
```

两个容易误判的点：user-data 只在 instance-id 变化后的首启执行，改了配置重启不会重跑——测试新配置要么换 instance-id，要么 `cloud-init clean`（会清机器标识，慎用于生产）；runcmd 每条是一个命令列表元素，写错嵌套层级会被当成一条命令，报错在日志里而不是启动失败。

## 4. Metadata 服务

实例运行中查自己的属性，标准入口是链路本地地址 `169.254.169.254`：

```bash
$ curl -s http://169.254.169.254/latest/meta-data/instance-id
i-0abc123def456
```

实例id、可用区、公网 IP、实例类型都能查到——脚本里「这台机器是谁」的问题靠它回答，配置管理工具报资产清单也用它。边界要划清：metadata 是**实例事实**的查询口，不是配置存储。往里写自定义数据要走 user-data 的通道，敏感信息更不该放——同宿主机任何拿到 metadata 访问权的进程都能读。主流云的新版 metadata 服务对取证请求加了会话保护（首次要拿 token），细节随各家版本核实，原则不变：把 metadata 当只读的系统事实源。

## 5. 网络与安全组

云上网络多了一层平台级防火墙——安全组（security group）：状态化的端口白名单，挂在实例网卡外侧，规则即时生效、不计入实例负载。它与系统防火墙的关系是**叠加而非替代**：安全组放行 22，sshd 才有机会收到连接；两层的规则并集决定最终可达性，排错时先查安全组再登机器查 firewalld/ufw（本仓[防火墙](../security/firewall.md)页讲系统层）。VPC（虚拟私有云）把一批实例圈进私有网段，子网划分、路由表、对等连接是它的日常词汇——语义上就是本仓[路由与 NAT](./routing-nat.md)那套概念在平台上的映射，概念迁移即可，命令换成了控制台或 API。

公网接入两条路：弹性 IP（静态公网地址，实例换绑不变）与按需分配（重启可能变化）。计费按量与包年/包月两型，短期与测试环境按量、长期负载包月，价格结构随厂商与区域变化大，本页不给数字。

## 6. 私有云一瞥

同一套机制在自家机房复刻就是私有云：OpenStack 提供完整的计算/网络/存储 API 集，Proxmox VE 把 KVM 与存储打包成带 Web 界面的中型方案，oVirt 是 RHEL 系虚拟化管理的企业化形态。三者的共同点是都支持 cloud-init 语义——镜像与注入流程在本仓讲的知识可以直接迁移。私有云的平台工程量不小，规模没到几十台之前，直接用 KVM 虚拟化（见[上一章](./virtualization/kvm.md)）加脚本化管理更划算。

## 7. 常见故障

**SSH 密钥没注入，登不进去。** 先排除安全组（第 5 节）；再查 cloud-init：`cloud-init status` 看是否完成，`/var/log/cloud-init.log` 里搜 ssh 模块报错；常见根因是镜像里没装 cloud-init 或数据源没被识别（NoCloud 的 seed 盘标签必须是 cidata）。

**user-data 改了不生效。** 正常现象：user-data 只在 instance-id 变化后的首启执行。测试流程用 `cloud-init clean` 或换实例标识，生产变更走重新构建镜像。

**实例启动后没有 IP。** DHCP 客户端没起或 cloud-init 网络阶段失败：`cloud-init status` 卡在 network 阶段，日志里查网卡名与镜像内配置（`/etc/cloud/cloud.cfg` 的 network 段或 netplan/network-scripts 配置）是否对得上宿主网络。

**磁盘没有随规格扩容。** growpart 模块负责首启扩根分区，没生效查它：日志搜 growpart，常见于自定义镜像里缺 cloud-utils-growpart（RHEL 系包名随版本核实）。

**runcmd 静默没跑。** 多半是 YAML 嵌套写错，被解析成了一条命令。`cloud-init schema` 预校验能抓大半；跑过的每条命令在 `/var/log/cloud-init-output.log` 有输出留档。

## 与其它页的分工

SSH 密钥的生成与 authorized_keys 语义见[SSH 远程登录](./ssh.md)，cloud-init 的 `ssh_authorized_keys` 只是注入手段；系统层防火墙与安全组的叠加关系见[防火墙](../security/firewall.md)；自建虚拟化的完整操作见[KVM 虚拟化](./virtualization/kvm.md)；实例上的服务交付与变更走 CI/CD 流水线，见[CI/CD 与持续交付](./ci-cd.md)；镜像内预装什么，遵循[源码编译与 Tarball 安装](../basic/packages/tarball.md)第 6 节的同一条边界——能进包管理的都别手工塞。

## 参考资料

- cloud-init 官方文档 — [docs.cloud-init.io](https://docs.cloud-init.io/)
- Ubuntu 官方云镜像 — [cloud-images.ubuntu.com](https://cloud-images.ubuntu.com/)
- Debian 官方云镜像 — [cloud.debian.org](https://cloud.debian.org/)
- NoCloud 数据源说明 — cloud-init 文档「datasources/nocloud」节
- man 手册 — man cloud-init、man cloud-config
