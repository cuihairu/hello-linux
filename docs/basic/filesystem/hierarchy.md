# 目录层次结构

Linux 遵循 FHS（Filesystem Hierarchy Standard）标准定义目录结构。FHS 的意义不在于"把文件放到哪"的死记硬背，而在于它回答了一组工程问题：**哪些目录随发行版升级而变动、哪些属于用户、哪些开机时会被清空、哪些必须在根文件系统挂载前就可用**。理解每个顶级目录"为什么存在"，你在排查"磁盘满了""配置改了没生效""重装会不会丢数据"时，才能直接定位到正确的目录，而不是满盘 `find`。

> 内容参考自 FHS 3.0、Arch Wiki 与 Debian 手册，见文末参考资料。

## 学习目标

- 说清 FHS 每个顶级目录的存在理由与可变性（是否随重启清空）
- 掌握 /etc、/usr、/var、/proc 的三系差异与典型文件
- 理解 usr-merge（/bin → usr/bin）为什么成为三家共同选择

## 1. 目录结构总览

```text
/
├── bin -> usr/bin        # 基本命令（usr-merge 后是指向 /usr/bin 的符号链接）
├── sbin -> usr/sbin      # 系统管理命令（同上）
├── lib -> usr/lib        # 共享库（同上）
├── boot                  # 启动文件：内核、initramfs、GRUB 配置
├── dev                   # 设备文件（块设备、字符设备）
├── etc                   # 本机专属配置文件
├── home                  # 用户主目录
├── media                 # 可移动设备自动挂载点（光盘、U 盘）
├── mnt                   # 临时手动挂载点
├── opt                   # 第三方大型软件
├── proc                  # 进程与内核信息（虚拟文件系统，不占磁盘）
├── root                  # root 用户的主目录
├── run                   # 本次开机以来的运行时数据（重启清空）
├── srv                   # 服务对外提供的数据（网站内容等）
├── sys                   # 内核对象/设备模型（虚拟文件系统）
├── tmp                   # 临时文件（重启可能清空）
├── usr                   # 系统程序与数据（只读，随升级变动）
└── var                   # 可变数据：日志、缓存、包数据库
```

下面按"为什么存在"逐个展开，而不是逐个念名字。

## 2. 顶级目录的存在理由

### 2.1 `/etc` —— 本机配置的唯一权威

**为什么存在**：同一份 `/usr` 二进制可能出现在上千台机器上，但每台机器的 hostname、IP、时区、服务开关必然不同。FHS 把"会因机器而异的东西"全部归到 `/etc`，让 `/usr` 可以做到跨机器共享/只读。

- `/etc/passwd`、`/etc/shadow`、`/etc/group` —— 用户与密码数据库
- `/etc/fstab` —— 开机挂载表（写错影响开机）
- `/etc/ssh/sshd_config` —— SSH 服务配置
- `/etc/hostname`、`/etc/hosts`、`/etc/resolv.conf` —— 主机名与解析
- `/etc/os-release` —— 发行版标识（所有三家都有，脚本判断发行版的通用入口）

**关键约束**：`/etc` 里**不该放程序本体**，只放配置；也**不该放会频繁变化的大块数据**（那是 `/var` 的职责）。

### 2.2 `/usr` —— 随发行版升级的"系统主体"

**为什么存在**：名字的历史包袱（user，最初是"多用户系统资源"的 user 而非"用户的"），今天的含义是——**所有默认安装的程序、库、文档都在这里，且应视为只读、由包管理器统一维护**。

- `/usr/bin` —— 普通命令（`ls`、`gcc`、`python3`）
- `/usr/sbin` —— 管理命令（`sshd`、`reboot`，部分发行版已并入 `bin`）
- `/usr/lib` —— 共享库与内核模块
- `/usr/share` —— 架构无关数据（帮助文档、图标、时区外的静态资源）
- `/usr/local` —— **管理员手工安装**的软件，与包管理器的 `/usr` 隔离，升级系统包时不会误伤

**决策后果**：`pacman -Syu` / `apt upgrade` / `dnf update` 会整批替换 `/usr` 下的文件。所以**永远不要手改 `/usr` 里的配置**（改了会被下次升级覆盖），也不要把自己编译的程序直接 `cp` 进 `/usr/bin`（会和包管理器抢文件所有权）——放 `/usr/local` 或用包管理器装。

### 2.3 `/var` —— 会变化的一切

**为什么存在**：与只读的 `/usr` 相对，`/var` 存放运行期不断增长/覆写的数据。把两者分开，`/usr` 才能做成只读快照部署，`/var` 的膨胀也不会撑爆系统盘配额（服务器上 `/var` 单独分区是常规操作）。

- `/var/log/` —— 日志（`syslog`、`messages`、`journal/`）
- `/var/cache/` —— 包管理器缓存与应用缓存
- `/var/lib/` —— **服务的持久状态数据库**，这一层要特别记：

| 发行版 | 包管理数据库 | 包缓存 |
|--------|-------------|--------|
| Debian/Ubuntu | `/var/lib/dpkg/` | `/var/cache/apt/archives/` |
| **Arch** | **`/var/lib/pacman/`** | **`/var/cache/pacman/pkg/`** |
| RHEL/CentOS/Rocky | `/var/lib/rpm/` | `/var/cache/dnf/` |

Arch 的 `pacman -Q` 查询的正是 `/var/lib/pacman/local/` 里的已装包记录；清理磁盘时若把 `/var/cache/pacman/pkg/` 清空，损失的是"降级回旧版本"的能力（`pacman -U` 本地包缓存），数据库本体绝不能删。

### 2.4 `/home` —— 用户数据与系统分离

**为什么存在**：让"个人文件"与"系统文件"生命周期解耦。重装系统时格式化 `/`、保留 `/home`，文档与配置（`~/.bashrc`、SSH 密钥、浏览器配置）得以幸存；服务器上 `/home` 独立分区还便于配额（quota）和备份策略差异化。

- 每个普通用户一个子目录：`/home/alice/`
- root 的家目录**不在** `/home`，而在 `/root`——保证即使 `/home` 是独立分区且挂载失败，管理员仍能登录修复

### 2.5 `/boot` —— 引导所需的最小集合

**为什么存在**：bootloader 工作在操作系统完全运行之前，它需要能独立读取的内核镜像和 initramfs。单独（或至少独立目录）管理这块，便于加密根分区、Btrfs 等复杂布局下 bootloader 仍能找到文件。

- `/boot/vmlinuz-*` —— 内核
- `/boot/initramfs-*`（RHEL 系叫 `initramfs`，Debian/Arch 叫 `initrd.img`）—— 早期用户态
- `/boot/grub/` —— GRUB 配置与字体
- `/boot/efi/` —— UEFI 模式下的 ESP 挂载点（有的发行版直接挂 `/efi`）

**坑**：`/boot` 满了会挡不住 `apt upgrade`/`dnf update` 失败——老内核堆积是最常见原因，定期清理 `/boot` 里的旧版本。

### 2.6 `/dev` —— 设备即文件

**为什么存在**：实现"一切皆文件"。设备不以文件形式存在，用户程序就无法用 `open()/read()/write()` 统一操作它们。

- 块设备：`/dev/sda`、`/dev/nvme0n1`、`/dev/loop0`（`b` 类型）
- 字符设备：`/dev/tty`、`/dev/null`、`/dev/zero`、`/dev/random`（`c` 类型）
- 由 **udev** 动态创建，不是安装时静态铺进去的——所以热插拔的 U 盘会自动多出 `/dev/sdb`

### 2.7 `/proc` 与 `/sys` —— 内核的窗口

两者都是虚拟文件系统，不占磁盘空间，是内核向用户空间暴露状态的接口：

```bash
cat /proc/cpuinfo       # CPU 详情
cat /proc/meminfo       # 内存详情
cat /proc/version       # 内核版本
cat /proc/<PID>/status  # 单个进程状态
ls /sys/block/          # 块设备
ls /sys/class/net/      # 网络接口
```

**为什么存在**：与其为每种状态发明一个专用系统调用，不如都做成文件——`cat`、`grep`、管道这些现成工具立刻可用。这也是"一切皆文件"哲学最彻底的落地。

### 2.8 `/run` 与 `/tmp` —— 生命周期最短的两层

- **`/tmp`**：任意用户可写的临时文件。systemd 系（Arch、Ubuntu、RHEL 8+）默认可能把它做成 **tmpfs（内存盘）**，重启即清空——重要文件放进去等于没保存。
- **`/run`**：本次开机以来的运行时数据（PID 文件、锁、socket）。`/var/run` 是指向它的兼容符号链接。**重启后必然清空**，所以守护进程的 pid 文件放这里，避免上次异常退出留下的陈旧 pid 干扰本次启动。

两者共同回答了一个 FHS 问题：**"哪些数据在重启后应当自动消失？"** ——把它们和 `/var` 分开，就不用靠手工 rm 来清理垃圾。

### 2.9 其余目录

| 目录 | 存在理由 |
|------|---------|
| `/bin`、`/sbin`、`/lib*` | 历史上是"最小系统自救所需的命令"，独立于 `/usr` 以便根分区未挂全时仍能修复；usr-merge 后退化为指向 `/usr/*` 的符号链接（见第 3 节） |
| `/media` | 供桌面环境**自动**挂载可移动设备（插入 U 盘出现的图标对应这里） |
| `/mnt` | 给**管理员手动**挂载用的空目录约定（临时挂载数据盘、网络存储） |
| `/opt` | 第三方闭源/大型软件的自包含目录（如某些商用数据库、`/opt/google/chrome`），不与包管理器的 `/usr` 混放 |
| `/srv` | 本机对外提供服务的数据（`/srv/www`、`/srv/ftp`），FHS 推荐但实际很多发行版的 Apache/Nginx 仍用 `/var/www` |
| `/root` | root 的家目录，与 `/home` 隔离以确保 `/home` 挂载失败时仍可登录 |

## 3. usr-merge：三家殊途同归

新装的 Debian/Ubuntu、Arch（2023 年起）、RHEL 9 上执行：

```bash
ls -ld /bin /sbin /lib
# lrwxrwxrwx 1 root root 7 ... /bin -> usr/bin
# lrwxrwxrwx 1 root root 8 ... /sbin -> usr/sbin
# lrwxrwxrwx 1 root root 7 ... /lib -> usr/lib
```

**为什么要合并**：历史上 `/bin` 和 `/usr/bin` 存在重复（两处都有 `ls`），独立分区、独立升级路径带来无数一致性 bug。usr-merge 让 `/usr` 成为唯一实体，`/bin` 只是兼容旧脚本的符号链接——支持"整个 `/usr` 只读 + 原子切换升级"的部署模型。

**对你的影响**：几乎没有，路径照常用。唯一要注意的是**别手动删除 `/bin` 这些符号链接**，也别往"以为是独立目录"的 `/bin` 里塞私货——它就是 `/usr/bin`。

## 4. 三系差异

FHS 只规定骨架，各家族在骨架上的血肉不同：

| 目录 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 网络配置 | `/etc/netplan/*.yaml` | `/etc/systemd/network/` 或 NetworkManager | NetworkManager（RHEL 9 起 network-scripts 已移除） |
| Apache 配置 | `/etc/apache2/` | `/etc/httpd/`（官方仓库） | `/etc/httpd/` |
| 日志主文件 | `/var/log/syslog` | `/var/log/messages`（journald 亦可） | `/var/log/messages` |
| 包数据库 | `/var/lib/dpkg/` | `/var/lib/pacman/` | `/var/lib/rpm/` |
| 源配置 | `/etc/apt/sources.list*` | `/etc/pacman.conf` + `/etc/pacman.d/mirrorlist` | `/etc/yum.repos.d/` |
| 附加源机制 | `sources.list.d/` + PPA | AUR（用户仓库，PKGBUILD） | EPEL 等 `.repo` 文件 |

写脚本时判断发行版不要猜路径，读 `/etc/os-release`（三系都有该文件，`. ` 引入后取 `$ID`、`$VERSION_ID` 即可；Arch 没有版本号，`ID=arch` 且滚动发布）。

## 5. /etc 与 /var 实战速查

```bash
# 用户、组、发行版信息（脚本判断发行版的通用入口）
cat /etc/passwd | head -3
grep wheel /etc/group
sudo cat /etc/shadow | head -2
cat /etc/hostname
. /etc/os-release && echo "$ID $VERSION_ID"
# ubuntu 24.04
# arch  rolling      ← Arch 没有版本号，ID=arch
# rocky 9.4

# 磁盘满时的第一现场：日志与缓存
du -sh /var/log/* | sort -hr | head
ls /var/cache/apt/archives | wc -l    # Debian/Ubuntu 缓存的 deb 数量
du -sh /var/cache/pacman/pkg          # Arch 包缓存大小
```

## 6. 常见坑

- **手改 `/usr` 下的配置**——下次 `pacman -Syu`/`apt upgrade` 直接覆盖。配置在 `/etc`，第三方程序放 `/opt` 或 `/usr/local`。
- **把重要数据写进 `/tmp`**——systemd 系重启可能清空 tmpfs，代码没保存就没了。
- **把日志当 `/usr` 的一部分去清理**——日志在 `/var/log`；`/var` 满了导致服务崩溃时，先查日志目录再查 `/var/lib/<服务>`。
- **删除 `/var/lib/pacman` 或 `/var/lib/dpkg`**——这是包管理器的账本，删了等于"系统装了什么"全部失忆，修复成本极高。清缓存请用 `pacman -Scc` / `apt clean`，它们只动 `cache` 不动 `lib`。
- **以为 `/bin` 是独立目录**——usr-merge 后是符号链接，向"备份 `/bin`"这类操作要意识到它和 `/usr/bin` 是同一份数据。
- **`/etc/resolv.conf` 改了不生效**——很多发行版由 NetworkManager/systemd-resolved 接管该文件，手工编辑会被覆盖；应在 NetworkManager 连接配置或 `resolved.conf` 里改。
- **fstab 里挂载点顺序错误**——先挂 `/` 再挂 `/home`/`/var`，子目录必须在父目录之后；写反会导致开机挂载失败。

## 参考资料

- FHS 3.0 — [refspecs.linuxfoundation.org](https://refspecs.linuxfoundation.org/FHS_3.0/fhs/index.html)
- Arch Wiki - File system hierarchy — [wiki.archlinux.org](https://wiki.archlinux.org/title/Filesystem_Hierarchy_Standard)
- Arch Wiki - pacman/本地数据库 — [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- Debian Reference - 文件系统层次结构 — [debian.org](https://www.debian.org/doc/debian-reference/ch02.zh-cn.html)
- `man hier`、`man 7 file-hierarchy`（systemd）
