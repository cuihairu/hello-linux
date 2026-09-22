# 软件安装

## 本章导语

装软件是使用 Linux 后你执行得最频繁的操作，也是三大发行版家族差异最刺眼的地方：同一句"装个 nginx"，在 Debian/Ubuntu 上要敲 `sudo apt install nginx`，在 Rocky 上是 `sudo dnf install nginx`，到了 Arch 则是 `sudo pacman -S nginx`——三条命令背后是三套互不兼容的包格式（`.deb` / `.rpm` / `.pkg.tar.zst`）、三个独立维护的软件仓库、三种截然不同的升级哲学。把 APT 的命令复制到 Arch 上只会得到 `command not found`，这几乎是每个新手的必经之坑。更隐蔽的坑在升级环节：APT 和 DNF 允许"先刷新索引、稍后再升级"分两步走，而 Arch 的滚动更新模型要求 `pacman -Syu` 必须原子完成——只刷新索引不升级（社区称为 partial upgrade）会让新库配旧软件，造出一堆 `error while loading shared libraries` 式的诡异故障。这些差异不是命令风格问题，而是发布模型的直接结果，本章的目标就是让你知其然也知其所以然。

本章两页：APT 页讲透 Debian/Ubuntu 家族从 `apt` 到 `dpkg` 的分层、仓库与缓存、版本锁定；YUM/DNF 页以 DNF 为主线（注明与旧 YUM 的兼容关系），覆盖 RPM 底层、EPEL 扩展源与版本锁。两页都会给出与另一系、与 Arch `pacman` 的对照表，确保你在三系之间切换时不再靠猜。

> 本页以 **Debian/Ubuntu、Arch、RHEL/CentOS/Rocky** 三大发行版家族为主线对照讲解，凡涉及具体命令或默认行为差异都会标注所属家族。内容参考自 Debian 手册、RHEL 文档与 Arch Wiki，见文末参考资料。

## 学习目标

学完本章两页内容后，你应当能够：

1. **判断该用哪个包管理器**：在陌生机器上先 `cat /etc/os-release` 看 `ID` 字段，再决定用 `apt`、`dnf` 还是 `pacman`，而不是凭记忆硬敲。
2. **完成六类核心操作**：对任意一系，都能独立完成安装、升级、搜索、仓库管理、缓存清理、版本锁定，并说出对应命令。
3. **理解分层结构**：知道 `apt`/`dnf`/`pacman` 是高层工具，底层分别是 `dpkg`/`rpm`/`pacman` 自身，依赖解析发生在哪一层、什么时候发生。
4. **说清仓库与缓存的区别**：索引（index/cache）只是"菜单"，不等于已安装软件；三系刷新索引的命令分别是 `apt update`、`dnf makecache`、`pacman -Sy`。
5. **掌握版本锁定**：在需要钉死某个包版本（如内核、glibc）时，用 `apt-mark hold`、`dnf versionlock`、`pacman -Q` 相关机制阻止意外升级。
6. **避开升级事故**：不在 Arch 上执行 partial upgrade，不在生产环境直接 `apt full-upgrade` 而不看变更列表。

## 三子页导读

本章由两页构成，建议按顺序阅读，每页约 12–18 分钟：

- **[APT 包管理](./packages/apt.md)** — Debian/Ubuntu 家族主线。从"为什么要分 `apt` 与 `dpkg` 两层"讲起，覆盖安装/升级/搜索/卸载全套命令并附真实终端输出，拆解 `/etc/apt/sources.list`（旧格式）与 `ubuntu.sources`（Ubuntu 24.04+ deb822 格式）的差异、PPA 与国内镜像源配置，缓存清理（`clean`/`autoclean`）与 `apt-mark hold` 版本锁定，最后给出与 DNF、`pacman` 的逐项对照及 `dpkg` 中断修复等常见坑。本页解决"Debian/Ubuntu 上怎么装软件"。

- **[YUM/DNF 包管理](./packages/yum.md)** — RHEL/CentOS/Rocky 家族主线，以 **DNF** 为主、注明与旧 YUM 的兼容关系（`dnf-yum` 插件让 `yum` 命令继续可用）。覆盖 `dnf` 的安装/升级/搜索/仓库启用，RPM 底层命令（`rpm -ivh`、`-qf`、`-ql`），EPEL 扩展源与模块化流（module stream），`dnf versionlock` 版本锁定与 `dnf clean` 缓存管理，同时对照 APT 与 Arch `pacman`，并标注 CentOS 7 已 EOL 的注意事项。本页解决"RHEL 系上怎么装软件"。

## 三系差异速览

下表是本章最重要的索引，覆盖任务要求的六个维度（安装、升级、搜索、仓库、缓存、锁定）。三系在"安装/卸载/搜索"上高度相似，真正的分水岭在**升级模型**与**仓库配置方式**：

| 操作 | Debian/Ubuntu (`apt`) | Arch (`pacman`) | RHEL/CentOS/Rocky (`dnf`) |
|------|----------------------|-----------------|---------------------------|
| 安装 | `sudo apt install nginx` | `sudo pacman -S nginx` | `sudo dnf install nginx` |
| 卸载 | `sudo apt remove nginx` | `sudo pacman -R nginx` | `sudo dnf remove nginx` |
| 升级系统 | `sudo apt update && sudo apt upgrade` | `sudo pacman -Syu`（必须连写） | `sudo dnf upgrade` |
| 搜索 | `apt search nginx` | `pacman -Ss nginx` | `dnf search nginx` |
| 查包信息 | `apt show nginx` | `pacman -Si nginx` | `dnf info nginx` |
| 仓库配置 | `/etc/apt/sources.list`、`*.sources` | `/etc/pacman.conf` + `/etc/pacman.d/mirrorlist` | `/etc/yum.repos.d/*.repo` |
| 刷新索引 | `sudo apt update` | `sudo pacman -Sy` | `sudo dnf makecache` |
| 清缓存 | `sudo apt clean`（删 .deb） | `sudo pacman -Scc`（删包缓存） | `sudo dnf clean all` |
| 版本锁定 | `sudo apt-mark hold pkg` | 无官方 hold，用 `-IgnorePkg` 或 pin 脚本 | `sudo dnf versionlock add pkg` |
| 包格式 | `.deb` | `.pkg.tar.zst` | `.rpm` |
| 底层工具 | `dpkg` | `pacman` 自身 | `rpm` |
| 第三方源 | PPA（`add-apt-repository`） | AUR（需 `yay`/`paru` 等助手） | EPEL、RPM Fusion |

两条必须记住的差异逻辑：

1. **索引 vs 升级的原子性**。APT 与 DNF 的仓库是"固定版本集合"，`apt update` 只下载 `Packages` 索引，之后任意时刻 `apt upgrade` 都安全；Arch 是滚动更新，仓库里每个包只有一个当前版本，索引刷新后已装的旧包立刻与新库脱节，所以 `-Sy` 与 `-Su` 必须合并为 `-Syu` 一次完成。这就是 [What is Linux](./introduction/what_is_linux.md) 强调过的 partial upgrade 风险。

2. **锁的实现深度**。`apt-mark hold` 直接在 dpkg 数据库打标记，最轻量；`dnf versionlock` 依赖 `python3-libdnf` 插件，锁定记录写在 `/etc/dnf/plugins/versionlock.list`；`pacman` 没有对等的一级命令，通常在 `/etc/pacman.conf` 的 `[options]` 段加 `IgnorePkg = linux linux-headers` 实现"忽略升级"，语义上更接近"跳过"而非"精确锁版本"。

## 常见问题

进入子页前最常被问到的四个问题：

1. **问题："`apt update` 和 `apt upgrade` 为什么总是要连着敲？"** `update` 只刷新本地索引（相当于看最新菜单），`upgrade` 才真正下载并安装更新（点菜）。只 `update` 不 `upgrade` 没有副作用，但下次 `apt install` 会基于新索引解析依赖——如果你刚换了镜像源，这步必须做，否则会提示"找不到包"或版本对不上。三系对应关系是：`apt update` ↔ `pacman -Sy` ↔ `dnf makecache`。

2. **问题："为什么 Arch 上 `pacman -Sy 包名` 单装一个包很危险？"** 这正是 partial upgrade：索引已刷新到最新，但你只安装了目标包，它依赖的库可能已升级到不兼容版本，而系统里其他旧软件还链着旧库。Arch Wiki 的官方立场是"永远不要 partial upgrade"，正确做法是先 `sudo pacman -Syu` 全量升级，再考虑装新包。

3. **问题："三方仓库/PPA/AUR 到底安不安全？"** 优先级永远是官方仓库 > 发行版背书的扩展源（EPEL、backports）> 社区 PPA/AUR。AUR 是 PKGBUILD 构建脚本而非预编译二进制，安装前必须审阅 `PKGBUILD` 内容；PPA 同理，`add-apt-repository` 之前先看是谁发布的。生产服务器建议只用官方 + EPEL。

4. **问题："卡在 `Could not get lock /var/lib/dpkg/lock-frontend` 怎么办？"** 这是另一个进程（通常是未完成的 `apt upgrade` 或无人值守的 `unattended-upgrades`）占着 dpkg 锁。先 `ps aux | grep -E 'apt|dpkg'` 确认是谁，等它结束或谨慎 kill；若上次安装被中断留下半配置状态，用 `sudo dpkg --configure -a` 修复，再 `sudo apt --fix-broken install`。切勿直接删 lock 文件——那会损坏 dpkg 数据库。

## 参考资料

- Debian 手册 - APT 与 dpkg — [debian.org](https://www.debian.org/doc/manuals/debian-handbook/apt.zh-cn.html)
- Ubuntu 文档 - APT — [help.ubuntu.com](https://help.ubuntu.com/community/AptGet)
- Arch Wiki - pacman — [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- Arch Wiki - AUR — [wiki.archlinux.org](https://wiki.archlinux.org/title/Arch_user_repository)
- RHEL 9 - 使用 DNF 管理软件 — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_software_with_the_dnf_tool/index)
- Rocky Linux 文档 - DNF — [docs.rockylinux.org](https://docs.rockylinux.org/guides/package_management/)
- 鸟哥的私房菜 - 软件管理 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0520softwaremanager.php)
- `man apt`、`man dpkg`、`man dnf`、`man rpm`、`man pacman`
