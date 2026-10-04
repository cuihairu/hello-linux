# NFS 服务器

NFS（Network File System）是 Unix 世界共享存储的原生方案：权限模型同构、挂载后就是本地路径，应用零改动。它与 Samba 的分工大致是——Samba 对接 Windows 生态与异构环境，NFS 服务 Unix-to Unix 的核心场景：多台应用服务器共享同一个 web 上传目录、计算集群共享数据与 home。协议偏无状态的倾向让服务端重启的代价极低，内核态客户端则让挂载几乎不付性能税。本页按"为什么 → 三系安装 → exports 逐选项 → 挂载与 v4 伪根 → 权限映射 → 验证排错 → 常见坑"展开，以 NFSv4 为主线、v3 作对照；端口放行不在本页展开，见[防火墙篇](../security/firewall.md)。

> 内容参考自 Linux NFS 项目文档与 Arch Wiki（概念框架参考鸟哥的私房菜），见文末参考资料。

## 学习目标

- 分清 NFSv4 与 v3 的根本差异：伪根、端口与状态模型
- 三发行版安装（apt / pacman / dnf），认准三系不同的服务单元名
- 读懂 /etc/exports 每个选项的崩溃语义与安全含义，重点是 root_squash
- 掌握 fsid=0 的路径映射，不再被"挂载路径与导出路径对不上"迷惑
- 会用 exportfs / showmount / nfsstat / journalctl 完成验证与排错
- 定位 UID 不一致、防火墙、fstab 卡开机等高频故障

## 1. 为什么用 NFS

### 1.1 Unix-to Unix 的共享场景

NFS 的经典场景有两个。其一是**应用层共享目录**：三台 Nginx/PHP 应用节点，用户上传的图片必须四面可见——把上传目录放到一台存储机上导出，三台都挂，应用代码里 `move_uploaded_file('/srv/upload/...')` 一个字都不用改：

```text
app1 ─┐
app2 ─┼── 挂载 server:/ ──▶ 存储机 /srv/data（fsid=0 伪根）
app3 ─┘
应用写 /srv/upload/x.png → 任一节点立即可读，无需 rsync/scp 轮转同步
```

其二是**计算集群共享数据**：HPC 集群的 `/home` 与数据集放 NFS，作业调度到哪台节点，环境都在——"换台机器就是换个机位"的体验，全靠目录树全局一致。两个场景的共同点是"共享的是目录树本身，而不是通过应用协议中转"——FTP 上传要在客户端来回拷贝，NFS 挂上之后文件就在路径里，这是"挂上就是本地路径"对应用透明的价值；对照对象存储的 SDK 改造（应用要换成 S3 API 调用），NFS 的迁移成本是"改一行挂载配置"。

与 [Samba](./samba.md) 的边界也要先划清：Samba 走 SMB 协议，处理 NT 权限位、ACL 与 Windows 客户端的异构细节，适合对接办公网；NFS 权限直接复用 Unix 属主/属组/other 模型，没有协议层转换损耗，Linux/macOS 客户端原生支持。一台同时服务两类客户端的存储机可以两者都开，但共享同一批数据目录时必须先想清两套权限模型的交集——SMB 的写权限判断与 NFS 的 uid 判断不完全等价，这正是"两边看到的文件属主不一样"的根源。

选型上再给一张对照表，把三条常见路线的边界划清——多数"该用哪个"的争论，其实是场景没对齐：

| 维度 | NFS | [Samba](./samba.md) | iSCSI |
|------|-----|---------------------|-------|
| 协议层 | 文件级（内核客户端） | 文件级（SMB） | 块级 |
| 客户端生态 | Linux/macOS 原生 | Windows/Linux/macOS | 任意能挂块设备者 |
| 权限模型 | Unix uid/gid 直通 | NT 权限 + ACL 映射 | 无（块设备属主机） |
| 多机同时读写 | 支持（依赖应用加锁） | 支持 | 不支持（除非集群文件系统） |
| 典型场景 | 应用共享目录、集群 home | 办公网文件服务器、打印 | 数据库、需要整块盘的场景 |

最后一行是关键分界：数据库这类自己管理存储布局的服务要块设备（iSCSI/LUN），多机共享文件目录要文件级协议（NFS/Samba）；把数据库放 NFS 上跑，等于把"自己管磁盘布局"的服务架在"别人管文件"的协议上，性能与一致性都别扭——虚拟机镜像放 NFS 上同理，除非虚拟化平台明确支持。

### 1.2 无状态倾向与内核客户端

协议设计上，NFSv3 完全无状态：服务端不记录"谁挂载了我"，重启后客户端最多经历几秒的 `nfs: server not responding`，恢复后继续读写，没有任何需要重建的会话。NFSv4 引入了状态（open、lock），但服务端的这些状态是可重建的——客户端开机时带着 clientid 回来认领（reclaim），服务端不为"断开的挂载"持久化任何东西。这个设计让 NFS 服务端的日常维护异常简单：重启就是重启，没有"在线用户掉线"的业务后果。

客户端则是另一条技术路线：NFS 的挂载路径由内核直接实现——`mount -t nfs` 只是让内核接管网络与文件系统操作，之后每次读写都不经过用户态进程，性能接近本地磁盘加网络延迟。这与 FUSE 类用户态文件系统（以及早期 SMB 用户态实现）形成对照：内核态换来的低开销，代价是错误都在内核日志里，排错入口是 `dmesg` 而不是应用日志——理解这一点，就知道第 6 节为什么先看内核消息。

```text
应用进程 ──▶ 内核 VFS ──▶ NFS 客户端（内核模块） ──网络──▶ nfsd（服务端内核线程）
   └── 路径不变、无用户态中转；故障表现写进 dmesg / journalctl -k
```

## 2. 安装（三发行版对照）

| 操作 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 安装（服务端） | `apt install nfs-kernel-server` | `pacman -S nfs-utils` | `dnf install nfs-utils` |
| 启用服务 | `systemctl enable --now nfs-kernel-server` | `systemctl enable --now nfs-server` | `systemctl enable --now nfs-server` |
| 安装（客户端） | `apt install nfs-common` | `pacman -S nfs-utils` | `dnf install nfs-utils` |
| 配置文件 | `/etc/exports`（三系同路径） | `/etc/exports` | `/etc/exports` |
| 导出工具 | `exportfs`（三系同名） | `exportfs` | `exportfs` |
| 统计工具 | `nfsstat`（三系同名） | `nfsstat` | `nfsstat` |

三系最大的差异是**服务端单元名**：Debian/Ubuntu 的包与单元都叫 `nfs-kernel-server`，Arch 与 RHEL 系的包叫 `nfs-utils`、单元叫 `nfs-server`——包名、unit 名是两个独立维度，`systemctl status` 对准了再谈排错。配置与工具层反而高度一致：`/etc/exports`、`exportfs`、`showmount`、`nfsstat` 三系同名同语法，本页后续示例不再逐系重复。v4 的服务端主体是内核里的 nfsd（用户态 `rpc.nfsd` 只是启动器），所以"服务起没起"的最终判据是 `exportfs -v` 有输出 + 端口可连，而不是某个守护进程的名字。

### 2.1 Debian/Ubuntu

```bash
$ sudo apt install nfs-kernel-server
$ sudo systemctl enable --now nfs-kernel-server && systemctl is-active nfs-kernel-server
active
```

Debian 系同时会拉起 `rpcbind`——为 v3 客户端兜底，v4 本不需要它（见第 4 节）。只跑 v4 的极简部署可以研究禁用 `rpcbind`，但要确认没有 v3 客户端后再说；与"不确定依赖就先不动"的保守变更观一致，先让默认依赖跑通，再按需做减法。

### 2.2 Arch

```bash
$ sudo pacman -S nfs-utils
$ sudo systemctl enable --now nfs-server && systemctl is-active nfs-server
active
```

Arch 的 `nfs-utils` 同时包含服务端与客户端工具（`nfsstat`、`showmount` 都在里面），一个包搞定两端。旧文档里的单元名 `nfs-utils.service` 已更名，现行是 `nfs-server.service`——照着老教程敲 `systemctl status nfs-utils` 会得到"找不到单元"，认准新名即可。Arch Wiki 的 NFS 页是本页配置细节的上游参考。

### 2.3 RHEL/CentOS/Rocky

```bash
$ sudo dnf install nfs-utils
$ sudo systemctl enable --now nfs-server && systemctl is-active nfs-server
active
$ sudo firewall-cmd --permanent --add-service=nfs && sudo firewall-cmd --reload
success
```

RHEL 系的默认姿态要多想两层：一是 firewalld 有现成的 `nfs` 服务对象（2049 端口），放行见[防火墙篇](../security/firewall.md)；二是 SELinux 默认策略约束 nfsd 的导出行为——`getsebool nfs_export_all_rw` 可查当前是否允许读写导出（只读导出是默认允许的），若业务需要读写共享且修改目录后权限异常，这是第一个要看的开关。与 Debian 的"先跑通默认依赖"同理：发行版默认安全姿态是故意收紧的，按需开口并留痕，而不是关掉整个策略。

## 3. 服务端配置：/etc/exports

### 3.1 两行示例与逐选项解释

`/etc/exports` 是导出账本，格式是"路径 客户端(选项)"。下面两行是本页的可跑示例——一台存储机给 192.168.56.0/24 网段导出数据根与共享目录：

```text
# /etc/exports —— NFSv4 伪根 + 普通导出
/srv/data 192.168.56.0/24(rw,sync,no_subtree_check,fsid=0)
/srv/share 192.168.56.0/24(rw,sync,root_squash)
```

逐选项过一遍：**rw/ro** 决定读写还是只读，最直白也最容易在"改了不生效"时被忽略（改 rw 后必须重新装载，见 3.2）。**sync** 要求写请求在向客户端应答前落盘——崩溃时"已确认"的写不会丢，代价是写延迟变高；`async` 反之，应答可能先于落盘，服务端断电时客户端已确认的写会丢，极端情况还会损坏文件系统。共享可写目录时**坚持 sync**，这条性能账在机械盘时代都不划算省，何况今天的共识是"确认过的话不算数比慢一点更伤"。**root_squash** 是默认且必须理解的选项：客户端以 root（uid 0）写入时，属主被压成匿名用户（默认 nobody，uid 65534），防止远端 root 把服务端文件系统随意改属主——这是 NFS 最重要的安全边界，第 5 节展开。**no_subtree_check** 关闭"导出目录的父路径被改名后校验句柄"的老逻辑：关闭后服务端移动导出目录内的子树不再需要重新校验，性能更好、也消除了大量假性 `ESTALE`，现代 nfs-utils 默认即关闭，显式写出是为可读性与跨发行版一致。**fsid=0** 声明这个导出是 NFSv4 伪文件系统的根——第 4.1 节专门讲它带来的路径映射，这是 v4 与 v3 最容易踩的认知差异。可选的 **anonuid/anongid** 指定被 squash 用户的具体 uid/gid，用于"匿名写入要落到专用账号"的场景，示例暂不加。

同一路径还可以对不同网段给出**不同的选项组**——每行一组客户端，权限边界按来源声明：

```text
# /etc/exports —— 同一路径，内网可写、办公网只读
/srv/builds 192.168.56.0/24(rw,sync,no_subtree_check)
/srv/builds 172.16.0.0/16(ro,sync)
```

这是 exports 账本比"应用层鉴权"便宜的地方：同一份数据对不同来源呈现不同姿态，不需要数据拷两份、也不需要应用改代码。书写纪律只有一条——**网段之间不要重叠**，让每类客户端恰好命中一行；重叠命中时权限如何合并在 man exports 里有专门讨论，但把边界写干净比研究合并规则省事得多，与防火墙规则"网段互斥、意图单一"的书写纪律同源。

### 3.2 exportfs：装载账本

改完账本不会自动生效，`exportfs` 是唯一的装载入口——与"改 unit 文件必须 daemon-reload"是同一种纪律：

```bash
$ sudo exportfs -rav          # 重新读取 /etc/exports 并装载（-v 回显）
exporting 192.168.56.0/24:/srv/data
exporting 192.168.56.0/24:/srv/share
$ sudo exportfs -v            # 查看当前已装载的导出（排错先看这里）
/srv/data      192.168.56.0/24(sync,wdelay,no_root_squash,no_subtree_check,fsid=0)
/srv/share     192.168.56.0/24(sync,wdelay,root_squash,no_subtree_check)
```

`-r` 是 reexport（重新装载），`-a` 是全部（与 `-r` 连用为惯用形），`-v` 回显改了什么。**不需要重启 `nfs-server` 单元**——`exportfs -rav` 直接热更新内核导出表，重启反而会打断正在进行的挂载。两行注意点：其一，`exportfs -v` 的回显是"内核此刻的真相"，`/etc/exports` 是"你的期望"，两者对不上时永远以 `-v` 为准去反推哪步没做；其二，语法错误（括号不配对、路径不存在）会被 `exportfs -rav` 直接拒绝并报错退出，账本不会被部分装载——先看命令退出信息，再动配置。

### 3.3 临时导出与灰度下线

除了改账本，`exportfs` 还支持**命令行临时导出**——不落盘、重启即失效，适合"给某台机器开半小时权限拷一批数据"这类一次性需求：

```bash
# 临时导出：客户端与选项直接写在命令行，不碰 /etc/exports
$ sudo exportfs -o rw,sync,root_squash 192.168.56.20:/srv/scratch
$ sudo exportfs -v | grep scratch
/srv/scratch  192.168.56.20(sync,rw,root_squash,wdelay)
# 用完即收（-u 按"客户端:路径"精确下线；改账本后的正式下线同此）
$ sudo exportfs -u 192.168.56.20:/srv/scratch
```

临时导出的价值在于**权限的生存期与意图匹配**：一次性需求写进 `/etc/exports`，半年后没人记得删，账本慢慢长成一张没人敢动的蜘蛛网——与"防火墙临时放行用富规则加 timeout，不要永久开口"是同一种纪律。反过来，正式下线也应先 `-u` 停供、观察一两天确认没有客户端还在用，再从账本删行——顺序反了，删完才发现有机器的开机挂载还在指向它，就是一场可以避免的深夜排障。

## 4. 挂载与使用

### 4.1 v4 伪根与路径映射（本页的核心认知）

v4 与 v3 的挂载路径不是同一套语义：**v3 按导出路径原样挂，v4 挂的是伪文件系统的子树，而 `fsid=0` 的导出本身就是那棵树的根**。把 3.1 的账本画出来：

```text
v4 伪根 "/"  ←── fsid=0 导出 /srv/data（服务端磁盘上的这个目录）
├── data 里的每个子目录……按原名出现在根下
└── /srv/share …… 不在根树内，v4 客户端看不见它
```

于是挂载路径是这样映射的——注意与导出路径的错位正是新手第一坑：

```bash
# 正确：fsid=0 导出即伪根，路径不再带 /srv/data 前缀
$ sudo mount -t nfs -o vers=4 server:/ /mnt
$ mount | grep /mnt
server:/ on /mnt type nfs4 (rw,relatime,vers=4.2,rsize=1048576,wsize=1048576,addr=192.168.56.10)
$ ls /mnt                # /mnt 下就是服务端 /srv/data 的内容
# 错误写法：伪根下没有叫 data 的子目录（它自己就是根），会得到
# mount.nfs4: No such file or directory
# v3 按导出路径原样挂，两个导出都能直接挂（回退验证也常用这招）
$ sudo mount -t nfs -o vers=3 server:/srv/share /mnt2
```

`showmount -e` 列出的是**导出路径**（/srv/data、/srv/share），照着它写 v4 挂载路径就会撞上 `No such file or directory`——两套语义的落差就在这里。v3 的多路径挂载则天然支持，这也是很多老系统坚持 `vers=3` 的原因之一——但 v3 要多开一串端口（见第 7 节），新部署应以 v4 为目标。

### 4.2 让多个目录在 v4 下都可见：bind mount 模式

要在 v4 下同时共享散落各处的目录，标准做法不是给每个目录都想办法挂 fsid=0（一棵树只能有一个根），而是**把子树 bind mount 进根导出目录，再把整棵树作为一个导出**：

```text
# 服务端 /etc/fstab —— 把要共享的子树挂进 fsid=0 根下
/srv/share  /srv/data/share  none  bind  0  0

# /etc/exports —— 只导出根；子树随根可见，选项在子导出行上单独收紧
/srv/data        192.168.56.0/24(rw,sync,no_subtree_check,fsid=0)
/srv/data/share  192.168.56.0/24(rw,sync,root_squash)
```

```bash
$ sudo mount -a && sudo exportfs -rav
# 客户端视角：根下出现 share 子路径，v4 语义完整
$ sudo mount -t nfs -o vers=4 server:/ /mnt && ls /mnt
share  dataset_a  dataset_b
```

这个模式有两个细节值得停下来想。其一，bind mount 之后 `/srv/data/share` 与原 `/srv/share` 是同一份数据的两个入口，服务端本地改原路径、客户端看到的是 bind 后的路径——导出账本只认 bind 后的路径，排错时不要看着 `/etc/exports` 里的行去 `ls` 原位置。其二，子导出行（`/srv/data/share`）可以带与根不同的选项——根宽松、子树收紧（比如 share 上 `root_squash` 而根 `no_root_squash`），权限边界沿树逐级声明，比"一刀切全局配置"精细得多。NAS 系统的共享文件夹界面背后就是这个模式，理解它，手工搭的多目录共享与商用 NAS 的行为就对上了。

### 4.3 fstab 持久化与 automount

开机自动挂载写 fstab，两个选项是本场景的救命稻草：

```text
# /etc/fstab（客户端）—— _netdev 等网络就绪，automount 让开机永不在挂载上卡死
server:/  /mnt/data  nfs  vers=4,_netdev,x-systemd.automount  0  0
```

`_netdev` 让 systemd 把该挂载排在网络就绪之后（无网络的启动阶段直接跳过而不是超时死等）；`x-systemd.automount` 把挂载推迟到"第一次真正访问该路径"时才触发——存储机宕机时开机照常完成，访问时才报错，而不是卡在启动进度条上。dump/pass 字段写 `0 0`：NFS 不参与 fsck，写 1/2 只会让开机检查报无意义的警告。与第 7 节"fstab 写错卡开机"对照，这两行是防那类事故的标准姿势。

### 4.4 hard/soft 与 timeo

挂载选项里唯一需要认真权衡的是 hard 与 soft。默认 **hard**：服务端无响应时客户端进程**无限重试**，读写调用挂起直到恢复——宁可慢，不可错，文件系统一致性优先。**soft** 则在重试耗尽后向进程返回错误，好处是服务端宕机时应用不会僵死，坏处是写到一半的调用可能以 `EIO` 失败，应用若不处理就会把半截写当成功。二者的调节旋钮是 `timeo`（超时，单位 0.1 秒，`timeo=60` 即 6 秒）与 `retrans`（超时后重试次数）。结论是保守的：默认 hard 不动；只有当"存储机宕机时应用必须继续降级运行"有明确业务要求时才考虑 soft，且必须验证上层应用对 `EIO` 的处理——与"先想失败了怎么办，再调快"是同一种运维观。

顺带回答两个高频调优问题。其一，`rsize/wsize`（读写块大小）现代内核默认已是 1048576（1 MiB），`mount` 输出里能看到——不要再照老教程手工调小，万兆网络下调小纯属自伤。其二，"NFS 突然变慢"先看客户端重传：`nfsstat -c` 里 `retrans` 计数持续增长，说明请求在网络层丢了又重发，嫌疑在网卡/交换机/丢包，而不是磁盘——先修链路再谈存储调优，方向反了会白忙一场。

## 5. 权限映射：root_squash 与 UID 对齐

先看 root_squash 的实际效果——在客户端以 root 创建文件，服务端看到的属主并不是 root：

```bash
$ sudo touch /mnt/hello && ls -ln /mnt/hello
-rw-r--r-- 1 65534 65534 0 Oct  2 10:15 /mnt/hello
```

uid 65534 就是 nobody——客户端的 root 被"压"成了匿名账号，`root_squash` 的名字由此而来。这是安全默认：远端 root 无法借 NFS 直接改写服务端任意文件的属主。反过来，`no_root_squash` 让远端 root 以 root 直通，等同把服务端文件系统的最高权限交了出去——除非有明确的"客户端 root 即管理员"的封闭场景，否则不要开。需要"匿名写入落到专用账号"时，用 `anonuid=1500,anongid=1500` 把 squash 目标指定为某个专用用户，比 `no_root_squash` 安全得多。

比 root_squash 更常见的坑是**两端 UID 不一致**：NFSv3 的权限判断纯按数字 uid，服务端不认识客户端的用户名，只认号码。客户端上 Alice 是 1000，服务端 1000 若是 Bob，那么 Alice 的文件在服务端"看起来"就是 Bob 的——`ls` 属主显示、后续 chown/rm 判断全部错位，`rsync` 跨机同步时属主跟着漂移就是这个机制在作祟。解法有两条：让两端账号规划对齐（同域账号源，LDAP/SSSD，根治），或按机器分别核对关键目录属主的 uid。v4 引入了 idmapping，把"数字对数字"升级为"名字对名字"——前提是两端 `idmapd.conf` 的域一致：

```text
# /etc/idmapd.conf —— 两端（客户端与服务端）Domain 必须相同
[General]
Domain = example.com

[Mapping]
Nobody-User = nobody
Nobody-Group = nogroup
```

域不匹配时名字解析退回数字 uid，症状仍是"名字对不上"——配完重启 `nfs-idmapd`（Arch/RHEL）或 `nfs-common` 里的对应服务（Debian），再用 `nfsidmap -c` 清一次缓存验证。一句话记牢：**NFS 的权限是数字的，先对齐 uid，再谈权限位**；idmapd 只管"显示成什么名字"，不管"能不能读写"——权限判断永远走数字这条老路。

## 6. 验证与排错

按"账本 → 导出 → 端口 → 挂载 → 读写"的顺序验证，每步都有对应命令：

```bash
# ① 服务端：账本装载了吗（期望 vs 真相）
$ sudo exportfs -v
# ② 客户端：导出列表可见吗（v3 时代工具，见下方注）
$ showmount -e server
Export list for server:
/srv/share 192.168.56.0/24
/srv/data  192.168.56.0/24
# ③ 挂载后实测读写，不要只看 mount 表里有
$ sudo mount -t nfs -o vers=4 server:/ /mnt && sudo touch /mnt/.probe && ls -l /mnt/.probe
# ④ 服务端统计与日志
$ nfsstat -s | head -6
Server:
calls      badcalls   badverfs   ...
12540      1          0          ...
$ journalctl -u nfs-server -e        # Debian 系对应 -u nfs-kernel-server
# ⑤ 连接层一眼账：谁正挂着（2049 上的既有连接）
$ sudo ss -tn state established '( sport = :2049 )'
Recv-Q Send-Q Local Address:Port  Peer Address:Port
0      0      192.168.56.10:2049   192.168.56.21:918
0      0      192.168.56.10:2049   192.168.56.22:1022
# ⑥ 客户端内核侧：超时与错误码的第一现场
$ dmesg | tail -2
[ 1042.718392] nfs: server 192.168.56.10 not responding, still trying
```

几条判读要点：`showmount` 与 `rpcinfo -p server` 都是 **v3 时代经由 rpcbind/mountd 的查询工具**，在只放行 2049 的极简 v4 部署上可能没输出或超时——这不是服务坏了，以服务端 `exportfs -v` 为准，`rpcinfo` 里能看到 `100003 nfs 2049` 则 rpc 层活着（v3 端口一览用它最快）。`nfsstat -s` 的 `badcalls` 持续增长说明有异常调用（多为权限拒绝或协议版本协商失败），配合 `journalctl -u nfs-server` 的时间点对齐即可定位是哪个客户端网段在撞。客户端侧 `dmesg` 里 `not responding` 是链路/防火墙问题，而 `Stale file handle`（ESTALE）是句柄失效——服务端删除了正被打开的文件、导出目录被移动、或服务端重启后状态重建失败，都表现为它。`permission denied` 则回到第 3、5 节：客户端网段不在 exports 里，或权限位/UID 对不上。把这三类错误码与三个检查点（账本、网段、uid）的对应关系记熟，排错路径自然就短了。

## 7. 常见坑

**挂载被拒（access denied by server）。** 症状是客户端 `mount.nfs4: access denied by server while mounting`。根因基本只有两个：客户端 IP 不在 `/etc/exports` 的网段内（子网掩码写错、走了 NAT 出口 IP），或改完 exports 忘了 `exportfs -rav`。服务端 `exportfs -v` 对照客户端实际出口 IP，一步定位。

**能读不能写。** 症状是只读操作正常、写入 `Read-only file system` 或 `Permission denied`。依次排查：exports 里写的是不是 `ro`（忘改 rw 是最常见的）；客户端进程 uid 对目录有没有写权限；若写入者是 root 且目录属主是 root——看第 5 节，`root_squash` 正把你的写入压成 65534，属主为 root 的目录对匿名写入默认是关的。改完任何一项都记得 `exportfs -rav`。

**权限错乱、文件属主对不上。** 症状是 `ls` 看到的属主是数字或陌生账号、跨机同步后属主漂移。这是两端 UID 不一致的直接表现——按第 5 节先对齐 uid（账号源统一是根治），或临时用 `anonuid/anongid` 收敛匿名映射；只在服务端 chown 治标不治本，下一次同步还会漂回来。

**防火墙：v4 只要 2049，v3 要一串端口。** 症状是 `vers=4` 挂得上、`vers=3` 超时，或反过来。v4 只用 2049（TCP/UDP）；v3 还要 rpcbind(111)、mountd（默认 20048，未固定时动态协商）、statd 等一串端口——固定 mountd/statd 端口后放行，或干脆只允许 v4。端口清单与 firewalld/nftables 放行方法见[防火墙篇](../security/firewall.md)。

**umount 挂死。** 症状是 `umount: target is busy`，挂载点卸不掉。先找占用者：`fuser -vm /mnt` 列出进程（常见是有人 cwd 在挂载点里、或某个进程还握着文件）。处理顺序是让人退出或杀掉占用进程再正常卸载；确需立即腾出挂载点时 `umount -l`（lazy，脱离目录树后句柄归零再释放）应急，NFS 长期僵死的挂载还可用 `umount -f` 强制。lazy 只是把问题从目录树挪到句柄上，根因（占用进程）仍要清掉。

**fstab 里 NFS 写错导致开机卡住。** 症状是启动进度条长时间不动、最终进不了系统。根因是 fstab 里的挂载在网络就绪前尝试并死等。修复用救援环境改 fstab，恢复后补上 `_netdev,x-systemd.automount`（见 4.2）——这两行是防复发的标准姿势；与"防火墙先放行 SSH 再启用"同理，自动化配置里"先保证还能进来"永远优先于"功能要生效"。

**服务端重启后客户端报 ESTALE。** 症状是挂载还在、操作文件却 `Stale file handle`。nfsd 重启后句柄与状态重建有时间差，多数情况客户端重试即恢复；持续 ESTALE 则检查导出目录是否被移动过、或 fsid 布局是否变化——句柄指向的物理对象没了，重试也不会好。处置：让占用方重新打开文件，必要时客户端 `umount`/`mount` 重建句柄；导出路径的变更要按变更单走，避免"改了目录名，旧句柄还在满天飞"。

## 参考资料

- Linux NFS 项目（nfs-utils 与内核 NFS 文档） — [linux-nfs.org](https://linux-nfs.org/)
- Arch Wiki: NFS — [wiki.archlinux.org/title/NFS](https://wiki.archlinux.org/title/NFS)
- Debian Wiki: NFS — [wiki.debian.org/NFS](https://wiki.debian.org/NFS)
- exports 手册（导出选项全集） — [man 5 exports](https://man7.org/linux/man-pages/man5/exports.5.html)
- nfs 手册（客户端挂载选项，hard/soft/timeo） — [man 5 nfs](https://man7.org/linux/man-pages/man5/nfs.5.html)
- 鸟哥的私房菜 - NFS 服务器 — [linux.vbird.org](https://linux.vbird.org/linux_server/centos6/0330nfs.php)
