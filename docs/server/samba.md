# 文件共享服务器（Samba）

办公室里 Windows、macOS、Linux 三种机器要在同一个共享盘里读写文件，这事听起来朴素，落到协议层却有个先天矛盾：Windows"网上邻居"说的是 SMB 方言，Unix 世界自家的文件共享说的是 NFS。Samba 就是站在中间的那名翻译官——让一台 Linux 机器在异构终端眼里就是一台普普通通的 Windows 文件服务器。要回答"为什么需要专门学它"，看两个真实场景就够：部门共享盘要求每个人用自己的账号密码进出、权限精确到"组内可写、组外不可见"，NFS 的机器级信任模型做不到；或者公司收购了一家 Windows 深度用户，迁移成本远高于在 Linux 侧装一个 Samba。本页按"为什么 → 两本账本与两个守护进程 → 三系安装 → 全局配置 → 组可写与匿名只读两种共享 → SELinux → 客户端验证 → 常见坑"展开，安装部分给出 Debian/Ubuntu（apt）、Arch（pacman）、RHEL/CentOS/Rocky（dnf）三系对照——三系包名难得地一致，差异集中在服务单元名与客户端工具的拆包方式；主机防火墙如何放行 445 等端口不在本页展开，见[防火墙篇](../security/firewall.md)。

> 内容参考自 Samba 官方文档与 Arch Wiki（概念框架参考鸟哥的私房菜），见文末参考资料。

## 学习目标

- 分清 Samba 与 NFS 的适用边界，理解 Samba 为何维护独立于系统账号的 passdb
- 掌握三发行版安装与服务启停，记住 smbd/nmbd 两守护进程在三系的 unit 名差异
- 读懂 `[global]` 与共享定义，把 testparm 变成改配置的固定前奏
- 独立搭建组可写与匿名只读两种共享，理解 create mask 与系统权限的叠加关系
- 会处理 RHEL 系的 SELinux 上下文，能用 smbclient 与 CIFS 挂载完成端到端验证

## 1. 为什么是 Samba

### 1.1 一个协议，两个世界

SMB（Server Message Block）诞生于二十世纪八十年代的 IBM，后经微软扩充并一度更名 CIFS（Common Internet File System），如今演进到 SMB3——不管名字怎么换，它始终是 Windows 世界的原生文件共享协议：资源管理器里的网上邻居、映射网络驱动器、域环境下的授权访问，底层走的都是它。macOS 自带 SMB 客户端，Linux 桌面文件管理器也普遍内建支持，所以"SMB 当通用语、异构终端零安装"是它最现实的红利。**Samba** 是这套协议在 Unix 上的自由实现：一台装了 Samba 的 Linux 机器，在 Windows 眼里就是一台可浏览、可登录、可共享的文件服务器。它与 NFS 的分工一句话说清——NFS 假设两端都是 Unix 血统，靠 uid/gid 映射与机器级信任工作，适合机房内同信任域的机器互挂（见[NFS](./nfs.md)）；Samba 面向异构终端，每次访问都携带用户名密码，权限可以细到共享、用户、组三层。类比门禁：NFS 像大楼内部工卡，发卡后整层楼随便进出；Samba 像访客登记，每次进门前台都核一遍名单——前者胜在效率，后者胜在粒度，选谁取决于你的终端构成与信任模型。

| 维度 | NFS | Samba |
|------|-----|-------|
| 协议生态 | Unix 对 Unix | Windows / macOS / Linux 异构 |
| 认证单位 | 机器级（挂载即授权） | 用户级（passdb 逐次核验） |
| 典型场景 | 机房集群、无盘站、构建农场 | 办公共享盘、混网文件中转 |
| 权限粒度 | 落在文件系统 uid/gid | 共享级 + 用户/组 ACL 式过滤 |

协议本身也在进化，两个方向值得知道：其一是**安全**——SMB1 因 WannaCry 类蠕虫的放大利用已被各端默认关闭，SMB3 起支持传输加密（`server smb encrypt = desired`/`mandatory`）与更严格的认证协商，新部署没有理由再向下兼容到 SMB1，需要为老设备开倒车时务必限定到特定共享而不是全局；其二是**性能**——SMB3 的多通道（multichannel）允许一条共享同时走多块网卡聚合理论带宽，对万兆内网的文件中转有实际收益。两者在 Samba 4.x 里都已成熟，配置项都落在 smb.conf 的对应层级——本页的入门主线用不到它们，但选型评估"共享盘慢不慢、能不能出机房"时，先想到这两个名字，再回去翻手册，比盲目换 NFS 或加内存有的放矢得多。

### 1.2 两本账本：passdb 独立于系统账号

Samba 最让初学者困惑的设计是：**Samba 密码不是系统密码**。Windows 客户端连共享时输入的密码，由 Samba 自己的账号数据库（passdb，默认后端是 tdbsam，落在 `/var/lib/samba/private/passdb.tdb`）核验，与 `/etc/shadow` 里的登录密码是两本独立的账。两本账共享"户名"——Samba 账号必须挂在一个同名的系统用户身上，因为文件落盘时的属主最终要解析成 uid——但密码可以各改各的。这样设计的收益是解耦："能访问共享盘"和"能 SSH 登录机器"的凭据轮换策略互不牵连，员工的共享盘密码泄露不必连累服务器登录口令；代价是要习惯双账本的记账动作——`passwd` 改的是系统账，`smbpasswd` 改的是 Samba 账，改错一本是排错时的高频乌龙。理解了这两本账，后面 `smbpasswd -a` 为什么要求系统用户先存在、为什么禁用系统账号会连带锁死共享访问，就都不再是需要背的规则，而是自然推论。

```text
Windows / macOS / Linux 桌面
   │
   ├── SMB over TCP 445 ──▶ smbd ──▶ passdb 核验 ──▶ Linux 文件权限最终裁定
   │
   └── NetBIOS 137/138 UDP ──▶ nmbd ──▶ 网上邻居浏览、名称解析
```

### 1.3 smbd 与 nmbd：两个守护进程

Samba 的服务面由两个守护进程拼成。**smbd** 干真正的活：认证、文件读写、锁与机会锁（oplock）裁断，监听 TCP 445（现代 SMB 直连）与 139（兼容老 NetBIOS 会话层）。**nmbd** 负责 NetBIOS 名服务与浏览列表（UDP 137/138），让服务器能出现在 Windows"网络"邻居里、能被 NetBIOS 短名解析到。现代客户端通常直接 `\\192.168.1.100\data` 或 `\\server\data` 走 445，名字解析交给 DNS/mDNS——nmbd 显得可有可无；但一旦环境里有依赖浏览列表的老 Windows 或老打印机，nmbd 停了它们就"看不见"服务器。动手前先想清楚这台机器面向谁：纯现代客户端，nmbd 可以不启用；有老终端，就把它当成兼容层一起养着。这个"两个进程各管一段"的划分也解释了一类经典故障——"IP 连得上、主机名连不上"多半是名称解析层的事，与 smbd 本身无关，见第 7 节。端口清单收拢成一张表，防火墙侧照单放行即可，完整策略设计见[防火墙篇](../security/firewall.md)：

| 端口 | 协议 | 归属 | 用途 |
|------|------|------|------|
| 445/TCP | SMB 直连 | smbd | 现代文件共享主通道 |
| 139/TCP | NetBIOS 会话 | smbd | 老客户端兼容 |
| 137/udp、138/udp | NetBIOS 名/数据报 | nmbd | 名称解析与浏览列表 |

## 2. 安装与启停（三发行版对照）

| 操作 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 安装（服务端+客户端） | `apt install samba smbclient` | `sudo pacman -S samba` | `dnf install samba samba-client` |
| 搜索 | `apt search samba` | `pacman -Ss samba` | `dnf search samba` |
| 查看包信息 | `apt show samba` | `pacman -Qi samba` | `dnf info samba` |
| 查看文件列表 | `dpkg -L samba` | `pacman -Ql samba` | `rpm -ql samba` |
| 升级 | `apt upgrade samba` | `sudo pacman -Syu` | `dnf upgrade samba` |
| 卸载 | `apt remove samba` | `sudo pacman -R samba` | `dnf remove samba` |

三系的包名难得一致，都是 `samba`；真正的差异藏在两处。**服务单元名**：Debian/Ubuntu 把两个守护进程拆成 `smbd.service` 与 `nmbd.service`，Arch 与 RHEL 系都叫 `smb.service` 与 `nmb.service`——包名、unit 名、配置路径是三个独立维度，排错时先 `systemctl status` 对准 unit，再谈配置。**客户端工具的拆包**：Debian 的 `smbclient` 单独成包，只装服务端会发现自己没有排障用的客户端；Arch 的 samba 主包自带 smbclient；RHEL 系客户端工具在 `samba-client` 里。装服务器时把客户端一并装上是值得养成的习惯——本机 smbclient 是验证"服务端到底暴露了什么"的第一手工具，比从 Windows 侧反复试错便宜得多。

### 2.1 Debian/Ubuntu

```bash
$ sudo apt install samba smbclient
$ sudo systemctl enable --now smbd nmbd && systemctl is-active smbd
active
$ smbclient --version
Version 4.19.x
```

Debian 装完即得一份可用的 `/etc/samba/smb.conf`，自带 `[homes]`（自动共享用户家目录）与 `[printers]` 两个默认共享——先别急着删，`testparm` 看懂它们反而是理解共享定义语法的现成教材。日志默认落在 `/var/log/samba/` 下，按客户端机器名分文件（`log.%m`），排错时先 `ls` 一眼再挑文件看，比逐个翻省力。

### 2.2 Arch

```bash
$ sudo pacman -S samba
$ sudo cp /etc/samba/smb.conf.default /etc/samba/smb.conf
$ sudo systemctl enable --now smb nmb
```

Arch 的 samba 包刻意不直接铺设 `smb.conf`，而是留下 `smb.conf.default` 样例让你复制改名——这既是滚动发行版"不覆盖管理员意图"的习惯，也逼你从第一分钟就直面配置文件本身。`pacman -Ql samba | grep -E 'smbd|nmb$'` 能看清包铺出的 unit 清单；官方仓库的 Samba 与 smbclient 同包同版本，不存在客户端与守护进程版本错位的问题。

### 2.3 RHEL/CentOS/Rocky

```bash
$ sudo dnf install samba samba-client
$ sudo systemctl enable --now smb nmb && systemctl is-active smb
active
$ firewall-cmd --permanent --add-service=samba && sudo firewall-cmd --reload
success
```

RHEL 系的 unit 名是 `smb`/`nmb`，与 Debian 差一个字母，跨系照抄教程时这是头号翻车点。防火墙侧 `samba` 服务一次性放行 445/TCP 与 137-138/UDP；若是 nftables/ufw 环境，对应端口清单相同，完整策略设计与三系差异见[防火墙篇](../security/firewall.md)。RHEL 还多一层 SELinux：目录标签不对时 smbd 会"服务正常、访问被拒"，这一层留给第 5 节专门展开——在 Debian/Arch 上默认无此机制，迁移脚本时别把 RHEL 的 restorecon 习惯当成普适步骤。

## 3. 全局配置

### 3.1 [global] 骨架

```text
# /etc/samba/smb.conf —— [global] 段（三系语法一致）
[global]
    workgroup = WORKGROUP
    server string = File Server %h
    server role = standalone server
    security = user
    map to guest = Bad User
    log file = /var/log/samba/log.%m
    max log size = 1000
```

这八行各自管一件事：`workgroup` 要与 Windows 侧的工作组（或域的 NetBIOS 名）一致，默认 `WORKGROUP` 在纯工作组环境里开箱即用；`server role = standalone server` 声明本机是独立服务器——不加入域、不扮演域控，单机管自己的账本，小型部署的绝大多数都停在这个角色；`security = user` 是 Samba 4 的默认值，含义是每个连接按用户核验，写出来是为了让配置自解释；`map to guest = Bad User` 把"用户名不存在"的连接映射为 guest 访问，是匿名共享的前置开关——注意它和 `Bad Password` 是两个行为完全不同的值，后者把"密码错"也放行给 guest，安全上激进得多，没有明确理由不要用。`log.%m` 按客户端机器名分日志，`max log size` 单位是 KB，到量轮转，留 1000 意味着单文件约 1 MB。

### 3.2 testparm：改配置的固定前奏

```bash
$ testparm
Load smb config files from /etc/samba/smb.conf
Loaded services file OK.
Server role: ROLE_STANDALONE

Press enter to see a dump of your service definitions
```

`testparm` 干两件事：语法检查，以及把 Samba 实际生效的配置完整打出来。第二件事常被低估——它展示的是"参数解析后的最终形态"，包括你没写但继承了默认值的条目，排"我明明没配这个行为"类的幽灵问题时，以 testparm 的输出为准而不是以你记忆中的 smb.conf 为准。这一步与 BIND 的 `named-checkconf`、Nginx 的 `nginx -t` 是同一纪律：**先验证、再生效**，把语法错误拦在服务重载之前，比服务半死不活时深夜翻日志便宜一个数量级。testparm 通过只说明"文件能被解析"，不说明"服务已加载"——让运行中的 smbd 重新读配置是另一个动作，见第 7 节的对应条目。

### 3.3 smbstatus：看服务端此刻在发生什么

```bash
$ sudo smbstatus
Samba version 4.19.x
PID     Username     Group        Machine                            Protocol   Encryption   Signing
------------------------------------------------------------------------------------------
3412    alice        smbgrp       192.168.1.50 (ipv4:192.168.1.50:51824)  SMB3_11    -            partial

Service      pid     Machine           Connected at                     Encryption   Encryption
---------------------------------------------------------------------------------------
data         3412    192.168.1.50      Thu Oct  2 20:58:02 2026 UTC    -            -

Locked files:
Pid          User         DenyMode   Access    R/W        Oplock      SharePath   Name   Time
----------------------------------------------------------------------------------------
3412         alice       DENY_NONE  0x120089  RDONLY     NONE         /srv/samba/data   report.xlsx   Thu Oct  2 21:03:11 2026
```

`smbstatus` 是服务端的"此刻快照"：谁连着（用户、来源 IP、协商出的协议版本 SMB3_11）、连着哪个共享、正握着哪些文件的什么锁。三个用处立等可取——改配置前先看有没有活连接，决定 reload 还是等维护窗口；用户报告"文件被占用删不掉"时，Locked files 一栏直接点名占有人与进程号，比在客户端猜"谁开着这个 Excel"高效得多；加密与签名列（Encryption/Signing）则给安全巡检提供了协议层的硬证据。把 `smbstatus`、`testparm`、日志文件当成 Samba 运维的三件套，日常巡检的信息量就齐了。

## 4. 共享定义与用户

### 4.1 目录与组的准备

共享不是从 smb.conf 开始的，而是从文件系统开始。先在系统层把"谁能写"的物理事实搭好，再让 Samba 在其上做逻辑过滤：

```bash
$ sudo groupadd smbgrp
$ sudo usermod -aG smbgrp alice
$ sudo mkdir -p /srv/samba/data /srv/samba/public
$ sudo chgrp -R smbgrp /srv/samba/data
$ sudo chmod 2775 /srv/samba/data
$ sudo chmod 2755 /srv/samba/public
```

`chmod 2775` 里的 `2` 是 setgid 位：目录下新建的文件与子目录自动继承父目录的属组（smbgrp），而不是创建者的主组——这是组共享目录能长期不乱的根基。没有它，alice 建的文件属主组是 alice 的主组，同事 bob 即使在组里也写不动，共享盘用一周就会长满"只有某人能写"的孤岛。`2755` 给匿名只读目录：组可读、其他人可读、无人可写（root 除外），物理层先把"只读"焊死，Samba 层再配一遍——两层各管一半，任何一层配错都会以"行为与预期不符"的形式暴露。顺带交代选址：共享根放 `/srv/samba/` 而不是 `/home` 下——`/srv` 的语义就是"本机对外提供的服务数据"，SELinux 侧也为其准备了现成的标签套路（第 5 节），而家目录共享有独立的布尔开关与 `[homes]` 机制，两者别混在一条路径里，日后的权限推理与安全策略都会干净很多。

### 4.2 两种共享：组可写与匿名只读

```text
# /etc/samba/smb.conf —— 追加共享定义
[data]
    path = /srv/samba/data
    valid users = @smbgrp
    force group = smbgrp
    create mask = 0664
    directory mask = 0775
    browseable = yes
    read only = no

[public]
    path = /srv/samba/public
    guest ok = yes
    read only = yes
    browseable = yes
```

`[data]` 是组协作的标准形态：`valid users = @smbgrp` 里 `@` 前缀表示"这个组的所有成员"，不在组里的账号连共享都看不见入口；`force group = smbgrp` 强制所有经此共享落盘的文件以 smbgrp 为属组，与目录 setgid 双保险；`create mask`/`directory mask` 是权限的"与"运算——客户端建文件时请求的权限（Windows 通常是 0666/0777）先与掩码相与再落盘，`0664` 保证组内可写、组外只读；`read only = no` 声明共享可写（`writable = yes` 是它的同义词，写哪个都对，但同一份配置里保持一种写法）。`[public]` 是匿名只读的最小形态：`guest ok = yes` 允许无凭据访问，`read only = yes` 在 Samba 层拒绝一切写——匿名共享生效有个双重前提：`[global]` 里的 `map to guest` 与共享里的 `guest ok` 必须同时就位，只配一半的表现就是"匿名访问弹密码框"，见第 7 节。

一个文件从 Windows"另存为"到落盘，权限要过三道闸，任何一道收紧都会改变最终结果，把这条流水线画清楚，"权限怎么不对了"类问题就有了固定的推理路径：

```text
Windows 客户端请求（通常 0666 / 0777）
        │ AND
        ▼
Samba 共享掩码（create mask 0664 / directory mask 0775）
        │ AND
        ▼
目录物理权限（父目录 setgid + 2775 决定属组可写面）
        │
        ▼
落盘最终权限（三层相与的结果；SELinux 标签再决定能不能被 smbd 读到）
```

### 4.3 smbpasswd：给 Samba 的账本记账

```bash
$ sudo smbpasswd -a alice
New SMB password:
Retype new SMB password:
Added user alice.
$ sudo pdbedit -L
alice:1001:Alice Chen
```

`-a` 把**已存在**的系统用户 alice 登记进 Samba 的 passdb——前提条件经常被忽略：系统里没有同名用户，这一步直接报错，Samba 从不凭空造账号，因为落盘属主需要真实的 uid 承接。输两遍的是 Samba 密码，与 alice 的登录密码无关，之后 `passwd alice` 不会带动它，`smbpasswd alice` 也不会改到系统账。`pdbedit -L` 是这本账本的目录视图：三列分别是用户名、uid、全名注释；排"这人在不在账上"的问题，先看这里而不是翻文件。员工离职的收尾动作由此推出：`smbpasswd -x alice` 销掉 Samba 账，或干脆 `usermod -L alice`/`userdel alice` 在系统侧釜底抽薪——账本挂在系统用户上，系统用户没了，Samba 侧自然失效。

四节走完，把分散的改动拼回一份完整配置便于对照自查——本页示例的 `[global]` 与两个共享合成一个文件，`testparm` 通过后 reload 生效：

```text
# /etc/samba/smb.conf —— 本页示例拼装全览
[global]
    workgroup = WORKGROUP
    server string = File Server %h
    server role = standalone server
    security = user
    map to guest = Bad User
    log file = /var/log/samba/log.%m
    max log size = 1000

[data]
    path = /srv/samba/data
    valid users = @smbgrp
    force group = smbgrp
    create mask = 0664
    directory mask = 0775
    browseable = yes
    read only = no

[public]
    path = /srv/samba/public
    guest ok = yes
    read only = yes
    browseable = yes
```

对应的系统侧准备也收拢成一段可复制的顺序（细节与理由见 4.1/4.3/5 节）：建组与目录 → 组员登记 → setgid 与属组 → Samba 账本 → RHEL 系补标签——五步做完，第 6 节的验证就有了干净的起点：

```bash
$ sudo groupadd smbgrp && sudo usermod -aG smbgrp alice
$ sudo mkdir -p /srv/samba/data /srv/samba/public
$ sudo chgrp -R smbgrp /srv/samba/data && sudo chmod 2775 /srv/samba/data && sudo chmod 2755 /srv/samba/public
$ sudo smbpasswd -a alice
$ sudo semanage fcontext -a -t samba_share_t "/srv/samba(/.*)?" && sudo restorecon -Rv /srv/samba   # 仅 RHEL/Rocky
```

## 5. SELinux 上下文（RHEL/Rocky）

RHEL 系的 smbd 运行在 confined 状态：即便传统权限全绿，目录的 SELinux 标签不对，访问照样被拒——而且拒绝只出现在审计日志里，客户端侧只看到一个含糊的"无法访问"。`/srv` 下自建的目录默认标签是 `var_t`，smbd 无权以它为共享根：

```bash
$ ls -dZ /srv/samba/data
unconfined_u:object_r:var_t:s0 /srv/samba/data
$ sudo semanage fcontext -a -t samba_share_t "/srv/samba(/.*)?"
$ sudo restorecon -Rv /srv/samba
Relabeled /srv/samba/data from unconfined_u:object_r:var_t:s0 to unconfined_u:object_r:samba_share_t:s0
$ ls -dZ /srv/samba/data
unconfined_u:object_r:samba_share_t:s0 /srv/samba/data
```

`semanage fcontext -a` 把"这个路径模式该是什么标签"写进策略库，`restorecon -Rv` 负责按策略把现存文件的标签改到位——前者立规矩、后者执行，只执行不立规矩的 `chcon` 改法在下次 relabel 后会被打回原形，是排错时能过夜、过不了月的临时补丁。标签补完仍被拒时，去审计日志找证据：`sudo ausearch -m avc -ts recent` 会给出被拒的操作、目标标签与规则名，Samba 相关的 avc 记录里 `scontext` 是 smbd、`tcontext` 是共享目录，一眼可判是不是标签问题——比客户端侧反复重连试错信息量大得多。两条配套：共享用户家目录（`[homes]`）需要布尔开关 `setsebool -P samba_enable_home_dirs on`；`semanage` 在精简安装里可能缺席，`dnf install policycoreutils-python-utils` 补齐。Debian/Ubuntu 与 Arch 默认不带 targeted 策略，本节整个跳过——但这恰是跨系迁移脚本最常翻车的地方：RHEL 上跑通的"改权限三件套"搬到 Debian 多余，从 Debian 抄到 RHEL 又缺一步。SELinux 的完整体系（模式、布尔、诊断工作流）见[SELinux 基础概念](../basic/security/concept.md)。

## 6. 客户端验证

### 6.1 smbclient：SMB 世界的 curl

```bash
$ smbclient -L //192.168.1.100 -U alice
Password for [WORKGROUP\alice]:

        Sharename       Type      Comment
        ---------       ----      -------
        data            Disk      department shared
        public          Disk      public read-only
        IPC$            IPC       IPC Service (File Server fs-01)
SMB1 disabled -- no workgroup available
```

`-L` 只列共享不进入，是验证"服务端到底暴露了什么"的第一手证据：共享名、类型、注释一目了然，Windows 侧连不上的名字先在这里对账——`NT_STATUS_BAD_NETWORK_NAME` 类问题九成在这一步就能定位（见第 7 节）。末行 `SMB1 disabled -- no workgroup available` 是现代 Samba 的正常输出：SMB1 被禁用后浏览列表不走这条会话，不是故障。匿名列表用 `-N` 跳过密码提示，匿名共享是否真的免密，这一步见分晓。进入共享后就是一个小型 FTP 式交互环境：

```bash
$ smbclient //192.168.1.100/data -U alice
Try "help" to get a list of possible commands.
smb: \> ls
  .                                   D        0  Thu Oct  2 21:02:15 2026
  ..                                  D        0  Thu Oct  2 20:44:01 2026
  report.xlsx                         A    18432  Thu Oct  2 20:58:02 2026
smb: \> put notes.md
putting file notes.md as \notes.md (12.3 kb/s) (average 12.3 kb/s)
smb: \> get report.xlsx
getting file \report.xlsx of size 18432 as report.xlsx (35.1 kb/s) (average 35.1 kb/s)
smb: \> quit
```

`ls` 看列表与权限位（`D` 目录、`A` 归档、`N` 普通），`put`/`get` 双向往返，`quit` 退出。这一来一回是"读写双通道都通"的最小验证集——比在 Windows 上点开文件夹多拿到两样东西：明确的错误码，与不经过任何 GUI 缓存的直连结果。

### 6.2 CIFS 挂载：把共享变成本地路径

```bash
$ sudo apt install cifs-utils        # 三系同名：pacman -S cifs-utils / dnf install cifs-utils
$ sudo mount -t cifs -o username=alice,uid=1000,gid=1000 //192.168.1.100/data /mnt
$ df -h /mnt | tail -1
//192.168.1.100/data   100G   32G   69G  32% /mnt
```

`cifs-utils` 三系同名，是跨发行版脚本里少数不用分支处理的名字。`uid=`/`gid=` 把远端文件的属主映射成本地用户——SMB 协议报告的属主是 Windows 风格的 SID，内核挂载层需要一个"都算谁的"的本地答案，不指定则一律 root，普通用户只读都费劲。开机自动挂载走 fstab，凭据单独落一份 600 权限的文件，比把密码明文写进 fstab 体面：

```text
# /etc/samba/creds（权限必须 600，属主 root）
username=alice
password=********

# /etc/fstab 追加
//192.168.1.100/data  /mnt/data  cifs  credentials=/etc/samba/creds,uid=1000,gid=1000  0  0
```

直接这样写 fstab 有个生产环境的老坑：开机时网络未就绪，`mount -a` 会卡在等待服务器上，轻则拖慢启动几十秒，重则超时进紧急模式。两个补法按彻底程度排：`noauto,x-systemd.automount` 让挂载推迟到第一次有人访问该路径时才发起（对笔记本这类时断时连的客户端几乎是必选项）；或至少补上 `_netdev` 声明这是网络设备，让挂载顺序排在网络之后。另一个值得显式写的参数是 `vers=`——现代客户端与 Samba 会自动协商出 SMB3，但面对必须迁就的老 NAS 时，`vers=2.1` 这类显式钉版能把"协商失败挂不上"变成确定的版本行为，排错时先试钉版再查别的，常能省一轮抓包。

### 6.3 Windows 与 macOS 侧

Windows 资源管理器地址栏直接输 `\\192.168.1.100\data`，弹出的认证框填 alice 与 **Samba 密码**（不是她 Linux 机器的登录密码——两本账的区别在第 1 节）；macOS 用 Finder 的连接服务器（⌘K）填 `smb://192.168.1.100/data`。两端首次连上后都会缓存凭据，改密后的怪异行为见第 7 节"Windows 缓存旧凭据"条目。

## 7. 排错与常见坑

**testparm 过了，访问仍被拒。** testparm 只证明语法可解析，不证明路径可达。排查顺序固定三步：`ls -ld /srv/samba/data` 看传统权限（others 位是否连读都没有）；RHEL 系接着 `ls -ldZ` 看标签是否 `samba_share_t`（第 5 节的 semanage + restorecon 补课）；最后 `/var/log/samba/` 里按客户端机器名挑日志看 smbd 记录的拒绝原因。三步走完仍无头绪时，用 `smbclient //IP/共享 -U 用户` 从 Linux 侧复现——错误码会明确指向 NT_STATUS_ACCESS_DENIED（权限/标签）或 NT_STATUS_LOGON_FAILURE（账本问题），比 Windows 侧的"无法访问"信息量大得多。

**NT_STATUS_BAD_NETWORK_NAME。** 服务端根本不认识这个共享名。头号原因是拼写：Windows 侧大小写不敏感的错觉掩盖了配置里真实共享名是 `data` 还是 `Data` 的差别；其次是 smb.conf 里该共享确实没写或没生效（改完没重载，见下条）。用 `smbclient -L //服务器 -U 用户` 对照服务端真实暴露的清单——列表里没有的名字，客户端再怎么重试也不会有。另外 `browseable = no` 只是让它不出现在浏览列表，手工输入共享名仍可访问；而 `valid users` 不匹配的拒绝是 ACCESS_DENIED 而非 BAD_NETWORK_NAME，两类错误码对应两条排查路径，先读码再动手。

**smbpasswd 建了账号，登录仍然失败。** NT_STATUS_LOGON_FAILURE 指向账本本身。三种根因按频率排：输的是系统密码而不是 Samba 密码（两本账，第 1.2 节）；`smbpasswd -a` 之后系统用户被动过（被 `userdel` 删除或 `passwd -l`/`usermod -L` 锁定），账本里有人、系统里无人；passdb 后端被切换过（tdbsam 换 smbpasswd 文本后端等迁移半途），`pdbedit -L` 列出的人与实际核验用的不是同一个库。对照命令：`pdbedit -L` 看 Samba 账，`getent passwd alice` 看系统用户，两行都绿再怀疑密码本身。

**匿名访问弹密码框。** 匿名共享是双重开关：`[global]` 的 `map to guest = Bad User` 与共享段的 `guest ok = yes` 必须同时就位，缺任何一半，客户端的匿名请求都会被当成"没提供凭据的普通登录"而索要密码。检查时注意 `map to guest` 的值——写成 `Never`（默认）即整体关闭匿名映射，写成 `Bad Password` 则行为更激进（密码错也放行 guest），都不是"匿名只读"想要的安全姿态。配好后的验证就一句：`smbclient -L //IP -N` 与 `smbclient //IP/public -N` 都不应再出现密码提示。

**改了 smb.conf 不生效。** testparm 通过只代表文件正确，运行中的 smbd 还抱着旧配置。让它重新读配置有两个动作：`sudo smbcontrol smbd reload-config` 在线重载、不断开既有连接，适合生产时段；`sudo systemctl restart smbd`（Debian 系 `smbd`，Arch/RHEL 系 `smb`）彻底重启、连接全断，适合大改后的干净验证。另一个迷惑行为值得知道：smbd 本身会周期性自查配置文件的时间戳并在几分钟内自动应用——这解释了"没重启但过了一会儿又好了"的灵异现象，也意味着排错时"等一等"会污染你的因果判断：验证配置变更要么显式 reload，要么重启，不要依赖这种延迟生效。

**Windows 缓存旧凭据。** 改了 Samba 密码后 Windows 侧反复报认证失败，但手输新密码的别的机器一切正常——本机凭据管理器还揣着旧密码自动提交。客户端清缓存：`net use * /delete /yes` 断开并清除会话凭据，顽固时到"凭据管理器"里删除 Windows 凭据条目；服务端侧也可用 `smbpasswd` 再改一次触发重新认证。这与浏览器缓存旧密码是同一类问题：认证层已经更新，提交端还停在昨天，排错时先换一台干净客户端隔离变量，就能立刻把问题定位到"服务器"还是"这台机器的记忆"。

**IP 连得上，主机名连不上。** `\\192.168.1.100\data` 正常而 `\\fs-01\data` 报找不到——问题不在 Samba，在名称解析。依次确认：DNS 里有没有这条 A 记录（现代环境的首选路径）；nmbd 是否在跑、`systemctl status nmb`（Debian 系 `nmbd`）是否 active——NetBIOS 短名解析靠它；客户端是否还依赖早已关闭的 SMB1 浏览。把名字换成 IP 试一次就能把故障面从"Samba 服务"收窄到"名字到地址这一段"，这是所有名称类问题的第一刀。

**中文文件名在 Windows 侧乱码。** 现代 Samba 的磁盘字符集（unix charset）默认 UTF-8，与 Linux 文件系统一致，正常不需要动；乱码多发生在两种边角：共享目录里躺着早年 GBK 时代落盘的旧文件名，或 smb.conf 被人按老教程显式写了 `unix charset = GB2312` 之类的过时值。处置原则是"以 UTF-8 为唯一真相"：删掉可疑的 charset 覆盖让默认值生效，旧文件用 `convmv -f GBK -t UTF-8 -r --notest 目录` 批量转码——先去掉 `--notest` 干跑一遍看清影响面，再实转，与改任何批量数据的纪律一致。客户端侧（Windows 10+/macOS）对 UTF-8 over SMB 的支持早已默认开启，不需要在两端做"对齐编码"的多余配置。

**共享里的符号链接跟不过去。** 客户端点开共享里的软链报找不到目标——这是安全设计而非故障：链接的目标可能在共享根之外，Samba 默认不跟随（`wide links` 与 `unix extensions` 的交互决定行为），防止客户端借链接越权读到服务器上任意路径。正确做法是把真实数据放进共享树内、用目录替代软链组织结构；确有跨目录聚合需求时，了解 `allow insecure wide links` 的风险再显式开启，并配合 SELinux 与文件权限双保险——"默认不给"与"显式开口"的取舍，和防火墙的默认拒绝模型是同一课。

**Excel/文档被占用，删不掉也改不了。** "文件正被另一进程使用"类提示先别怪杀毒软件——`sudo smbstatus` 的 Locked files 栏直接给出占用进程号、用户与锁模式（见 3.3 节）。oplock（机会锁）让客户端本地缓存读写以提速，代价是并发编辑时的锁协调：正常情况下第二个客户端打开会触发锁降级、拿到只读副本；僵死锁（客户端异常断开后未释放）用 `smbcontrol smbd close-share 共享名` 踢会话，或按 smbstatus 给出的 PID 直接处置。把"删不掉先 smbstatus"写进值班手册，比让用户反复保存试探省一轮来回。

## 参考资料

- Samba 官方文档 — [samba.org/samba/docs](https://www.samba.org/samba/docs/)
- Arch Wiki: Samba — [wiki.archlinux.org/title/Samba](https://wiki.archlinux.org/title/Samba)
- Red Hat 官方文档（RHEL 部署与 SELinux 配置） — [access.redhat.com/documentation](https://access.redhat.com/documentation/en_US/red_hat_enterprise_linux/)
- 鸟哥的私房菜 — [linux.vbird.org](https://linux.vbird.org/)
- man smb.conf — [man.archlinux.org/man/smb.conf.5](https://man.archlinux.org/man/smb.conf.5)
- man smbclient — [man.archlinux.org/man/smbclient.1](https://man.archlinux.org/man/smbclient.1)
