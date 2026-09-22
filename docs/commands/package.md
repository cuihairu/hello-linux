# 包管理

在 Linux 上"装软件"和在 Windows 上"双击安装包"是两种完全不同的体验：
你几乎不会从网站下载 `.exe`，
而是告诉系统"我要 nginx"，
由**包管理器**去仓库拉取、
解决依赖、
写好配置、
注册到数据库里。
这就是包管理的核心——
它不只是下载器，
更是**依赖解析器 + 版本数据库 + 卸载回滚器**。
理解了这一点，
你才能理解为什么 `apt` 和 `dnf` 修依赖的方式不同、
为什么 Arch 的 `pacman -Syu` 不能只做一半、
以及为什么直接 `rpm -ivh` 绕过包管理器会留下一堆烂摊子。

> 本章并列讲解三大发行版家族的包管理器：
> **APT**（Debian/Ubuntu）、
> **DNF/YUM**（RHEL/CentOS/Rocky/Fedora）、
> **pacman**（Arch/Manjaro）。
> 读任何一个子页时，请先对照本页的六维速查表，明确自己手上的发行版该用哪一列。

## 为什么包管理是 Linux 第一课

三个几乎无法回避的现实：

1. **几乎所有任务的第一步都是"装个东西"**。
   要装 Docker？
   要装 `htop`？
   要装编译器？
   都要先过包管理器这一关。
   包管理不熟，
   后面的系统管理、
   网络、
   服务器章节会寸步难行——
   `command not found` 会成为你的每日问候。
2. **依赖问题只能靠包管理器解决**。
   软件 A 依赖库 B，
   库 B 又依赖库 C，
   手工下载安装几乎必然死循环。
   APT 的 `apt --fix-broken install`、
   DNF 的自动依赖解析、
   `pacman` 的完整依赖树处理，
   都是在替你做人肉不擅长的事。
3. **升级与安全补丁是运维的日常**。
   `sudo apt upgrade`、
   `sudo dnf upgrade`、
   `sudo pacman -Syu` 背后是完全不同的更新哲学：
   Debian/RHEL 系追求"版本稳定、
   只回移植修复"，
   Arch 系追求"仓库永远只有一个当前版本、
   升级即前进"。
   **Arch 上只执行 `pacman -Sy`（刷新数据库但不升级）会制造"部分升级"的半残状态，
   是官方明确警告的高危操作**，
   要么 `-Syu` 全升，
   要么什么都别动。

鸟哥的教程把包管理比作"软件的户籍管理"：
每个包由数据库登记（`dpkg -l` / `rpm -qa` / `pacman -Q`），
文件清单可查、
依赖关系可查、
卸载可追溯。
绕过户籍管理系统（直接解压二进制到 `/usr/local` 而不留记录）短期方便，
长期会让你彻底失去"这台机器装了什么"的答案。

## 学习目标

- **三系基本操作无障碍**：
  见到 APT 系发行版会用 `apt`，
  见到 RPM 系会用 `dnf`，
  见到 Arch 会用 `pacman`，
  且知道"更新源索引"和"升级已装软件"是两个不同动作（`apt update` ≠ `apt upgrade`；
  `pacman -Sy` ≠ `pacman -Syu`）。
- **查询与溯源**：
  能回答"这个包是否已装""这个命令属于哪个包""这个文件是谁装的"——
  `apt/dpkg -S`、
  `dnf provides`、
  `pacman -Qo` 三系各来一遍。
- **底层工具心中有数**：
  理解 `dpkg`/`rpm` 是底层安装器、
  `apt`/`dnf`/`pacman` 是上层管理器，
  知道什么时候必须下沉到底层（离线装 `.deb`/`.rpm`、
  修复数据库）。
- **仓库配置能独立完成**：会添加/禁用软件源、更换国内镜像、安装 EPEL/PPA，理解仓库签名（GPG）报错的含义。
- **排障有章法**：
  遇到锁文件、
  依赖冲突、
  缓存损坏、
  部分升级残留时，
  能按"查进程 → 修数据库 → 清缓存 → 重试"的顺序处理，
  而不是反复 `Ctrl+C`。
- **版本控制意识**：
  会锁定关键软件版本（`apt-mark hold` / `dnf versionlock` / `pacman -D --ignore`），
  避免一次全量升级把生产环境炸掉。

## 本章内容

- [包管理命令](./package/package.md) — 三大包管理器的完整操作手册：APT 的 `install/remove/search` 与 `dpkg` 底层、DNF/YUM 的 `install/remove/repoquery` 与 `rpm` 底层、**pacman 的 `-S/-R/-Q/-Syu` 全套用法**，以及软件源配置、版本锁定、本地仓库搭建、锁文件与依赖故障排查、三系命令对照表。

建议：
先在本页记住六维对照表的"安装/升级/卸载"一行，
再进子页按自己的发行版精读对应章节，
最后把另外两系扫一遍——
运维很少只接触一种发行版。

## 三系差异速览（apt / dnf / pacman 六维对照）

下面六行覆盖了包管理 95% 的日常操作。**横着看是一个维度在三系的写法，竖着看是一个发行版的完整工具箱**。

| 维度 | APT（Debian/Ubuntu） | DNF/YUM（RHEL/CentOS/Rocky） | pacman（Arch） |
|------|----------------------|------------------------------|----------------|
| **① 安装 / 升级 / 卸载** | `sudo apt update` 刷新索引<br>`sudo apt upgrade` 升级已装包<br>`sudo apt install 包名` 安装<br>`sudo apt remove 包名` 卸载（保留配置用 `purge`） | `sudo dnf makecache` 刷新缓存<br>`sudo dnf upgrade` 升级已装包<br>`sudo dnf install 包名` 安装<br>`sudo dnf remove 包名` 卸载 | `sudo pacman -Sy` 仅刷新数据库（**勿单独使用**）<br>`sudo pacman -Syu` 刷新并全量升级<br>`sudo pacman -S 包名` 安装<br>`sudo pacman -Rns 包名` 卸载（连带未用依赖与配置） |
| **② 查询与搜索** | `apt search 关键词`<br>`apt show 包名`<br>`apt list --installed`<br>`apt list --upgradable` | `dnf search 关键词`<br>`dnf info 包名`<br>`dnf list installed`<br>`dnf check-update` | `pacman -Ss 关键词` 搜仓库<br>`pacman -Si 包名` 看远端信息<br>`pacman -Qs 关键词` 搜已装<br>`pacman -Qi 包名` 看已装详情 |
| **③ 底层工具与本地包** | `dpkg -i 包.deb` 装本地包<br>`dpkg -l` 列已装<br>`dpkg -S 文件` 查归属<br>`apt --fix-broken install` 修依赖 | `rpm -ivh 包.rpm` 装本地包<br>`rpm -qa` 列已装<br>`rpm -qf 文件` 查归属<br>`dnf reinstall 包名` 重装修复 | `pacman -U 包.pkg.tar.zst` 装本地包<br>`pacman -Q` 列已装<br>`pacman -Qo 文件` 查归属<br>`pacman -Dk` 检查孤立依赖 |
| **④ 软件源配置** | `/etc/apt/sources.list`<br>`/etc/apt/sources.list.d/*.list`<br>改完执行 `apt update` | `/etc/yum.repos.d/*.repo`<br>改完执行 `dnf makecache` | `/etc/pacman.conf`<br>`/etc/pacman.d/mirrorlist`<br>改完执行 `pacman -Sy`（并立即 `-Syu`） |
| **⑤ 第三方扩展生态** | PPA（`add-apt-repository`）、backports | EPEL（`dnf install epel-release`）、RPM Fusion、CRB/PowerTools | AUR（官方仓库不含，用 `yay`/`paru` 等助手从 PKGBUILD 构建；`pacman` 本身不感知 AUR） |
| **⑥ 版本锁定 / 回滚 / 缓存** | `apt-mark hold 包名` 锁定<br>`apt-mark unhold` 解锁<br>`apt clean` 清缓存<br>`apt history` 看历史 | `dnf versionlock add 包名`（需插件）<br>`dnf history` 查/回滚事务<br>`dnf clean all` 清缓存 | `pacman -D --ignore 包名` 本次升级忽略<br>`pacman -Qq` + 时间戳辅助回查<br>`pacman -Sc`/`-Scc` 清缓存 |

**六维之外的三条黄金法则**：

1. **索引 ≠ 升级**。
   `apt update`、
   `dnf makecache`、
   `pacman -Sy` 都只是"让本地知道仓库有什么"，
   不改变已装软件版本。
   真正动版本的是 `apt upgrade`、
   `dnf upgrade`、
   `pacman -Syu`。
2. **Arch 只做一半最危险**。
   `pacman -Sy` 之后去装一个新包，
   可能出现"新包依赖的新版本库"与"系统里还是旧版本库"的错配（部分升级）。
   Arch Wiki 的建议是：
   任何安装/升级都写成 `pacman -Syu 包名` 一步到位。
3. **卸载语义不同**。
   `apt remove` 默认保留配置，
   `apt purge` 才删配置；
   `pacman -Rns` 默认连未用依赖和配置一起清（`n` 清依赖、
   `s` 清配置文件）；
   `dnf remove` 会移除"仅被该包依赖"的依赖包，
   但保留配置。
   迁移习惯时别想当然。

## 常见问题

**Q1：
`Unable to lock the administration directory (/var/lib/dpkg/lock-frontend)` 怎么办？**

APT 被另一个进程占着。
先 `ps aux | grep -E 'apt|dpkg' | grep -v grep` 找出残留进程（常见于上次安装被 `Ctrl+C` 打断），
确认后结束它，
再执行 `sudo dpkg --configure -a` 和 `sudo apt --fix-broken install`。
**不要**直接删锁文件——
那会损坏 dpkg 数据库。
DNF 对应锁是 `/var/run/dnf.pid`/`/var/cache/dnf/` 下的锁；
`pacman` 报 `unable to lock database` 时同样先查有没有另一个 `pacman` 在跑。

**Q2：`apt update` 报 `GPG error` / `NO_PUBKEY`？**

本地缺仓库的签名公钥，
说明源配置换过但没导入密钥。
Debian/Ubuntu 常见处理是 `sudo apt-key adv --keyserver keyserver.ubuntu.com --recv-keys 密钥ID`（或按源文档把 `.gpg` 放进 `/etc/apt/keyrings/` 并在 sources 里指定 `signed-by=`）。
Arch 若报 `signature from ... is unknown trust`，
检查系统时间是否正确（时间错乱会导致所有签名验证失败），
或按提示 `pacman-key --populate archlinux`。

**Q3：`apt --fix-broken install` 或 `dnf distro-sync` 也救不回来怎么办？**

先确认故障范围：
是单个包的依赖环，
还是全系统状态错乱。
单包问题可尝试 `dpkg -r --force-depends 包名` 后重装；
全系统问题在 Debian 上可 `apt full-upgrade`，
在 RHEL 系可 `dnf distro-sync --allowerasing`，
在 Arch 上若因部分升级导致，
通常只能 `pacman -Syu` 把系统推到仓库当前状态（必要时从安装介质救援）。
动手前记录报错原文，
必要时做快照。

**Q4：装同一个软件，三系包名不一样怎么办？**

很常见（如 `iptables` 在 Debian 叫 `iptables`，
文档示例包名可能对应 `nmap`/`ripgrep` 等在不同仓库略有差异）。
用各系的搜索命令先确认：
`apt search 关键词`、
`dnf search 关键词`、
`pacman -Ss 关键词`；
不确定时以发行版官方 wiki/手册的包名为准，
不要照抄别的发行版教程。

**Q5：为什么 `pacman -Ss` 搜得到 AUR 里的软件，但 `-S` 装不了？**

`pacman` 只认识官方仓库。
AUR 是社区构建脚本仓库，
需要 `yay -S 软件名`、
`paru -S 软件名` 这类助手，
或克隆 PKGBUILD 后 `makepkg -si` 手动构建。
**AUR 包没有官方审核**，
构建前务必过目 PKGBUILD 内容，
生产服务器谨慎使用。

**Q6：国内环境下更新源很慢？**

三系都换国内镜像即可：
Debian/Ubuntu 改 `/etc/apt/sources.list`（或 Ubuntu 的 `sources.list.d/ubuntu.sources`），
RHEL 系改 `/etc/yum.repos.d/*.repo` 的 `baseurl`，
Arch 改 `/etc/pacman.d/mirrorlist`（可用 `reflector` 自动筛选）。
换完记得刷新索引（`apt update` / `dnf makecache` / `pacman -Syu`）。

## 参考资料

- [鸟哥的私房菜 - 软件管理（RPM/DPKG/YUM）](https://linux.vbird.org/linux_basic/centos7/0520softwaremanager.php)
- [Arch Wiki - Pacman](https://wiki.archlinux.org/title/Pacman)（含 `-Syu`、部分升级警告、缓存管理）
- [Arch Wiki - AUR](https://wiki.archlinux.org/title/Arch_User_Repository)
- [Arch Wiki - Mirrors](https://wiki.archlinux.org/title/Mirrors)
- [Debian 手册 - APT](https://www.debian.org/doc/manuals/debian-handbook/apt.zh-cn.html)
- [Ubuntu - apt(8) 与包管理文档](https://ubuntu.com/server/docs/package-management)
- [Red Hat 文档 - Managing software with the DNF tool](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_software_with_the_dnf_tool/index)
- [Rocky Linux 文档 - 软件管理](https://docs.rockylinux.org/guides/software_management/)
- [Fedora 文档 - DNF](https://docs.fedoraproject.org/en_US/quick-docs/dnf/)
- `man apt`, `man dpkg`, `man dnf`, `man rpm`, `man pacman`
