# YUM/DNF 包管理

RHEL/CentOS/Rocky 家族的包管理在 2015 年经历了一次核心更替：**YUM**（Yellowdog Updater Modified）基于 Python 2 编写，依赖解析慢、内存占用高，逐渐难以应付 Fedora/RHEL 8 起的模块化仓库；**DNF**（Dandified YUM）作为其继任者用 Python 3 重写，接口大部分兼容、速度显著提升，如今已是 RHEL 8+/Fedora/Rocky 9 的默认前端，而旧的 `yum` 命令在多数系统上只是指向 DNF 的兼容链接或由 `dnf-yum` 插件提供。本页以 **DNF 为主线**讲解，凡是与 YUM 行为一致的地方会注明"YUM 兼容"，个别差异（如 `yum update` 的废弃警告）单独标出，避免你对着 CentOS 7 时代的旧教程困惑。底层始终是 **RPM**——理解 DNF 与 RPM 的分层，和理解 APT 与 dpkg 的分层是同一件事。

> 内容参考自 RHEL 9 官方文档与 Arch Wiki，见文末参考资料。

## 学习目标

- 分清 DNF、YUM、RPM 三者关系，知道 `yum` 命令今天还意味着什么
- 掌握 DNF 安装/升级/搜索/仓库/缓存/锁定六类核心操作
- 会配置 EPEL 等扩展源与国内镜像，理解模块流（module stream）概念
- 能把 DNF 命令与 APT、Arch `pacman` 逐项对照

## 1. DNF 与 YUM 的关系

在 Rocky Linux 9 / RHEL 9 / Fedora 上执行 `yum`，你通常看到的是 DNF 在响应：

```bash
# RHEL 9 / Rocky 9：yum 实际是 dnf 的兼容入口
$ rpm -qf /usr/bin/yum
dnf-yum-4.14.0-1.el9_3.noarch      # 来自 dnf-yum 插件包，不是老 YUM 本体
$ dnf --version | head -1
4.14.0
```

这意味着：**日常文档里写 `yum install` 在现代 RHEL 系上仍然有效**，但新脚本、新教程一律推荐写 `dnf`，语义更明确，也不再依赖兼容层。真正需要区分 YUM 与 DNF 行为的场景主要在 CentOS 7（纯 YUM，Python 2）与个别废弃选项上——本页所有主命令以 DNF 为准，YUM 差异随文标注。

DNF 与底层 RPM 的分层完全对应 APT/dpkg：RPM 只负责本地包的安装、查询、卸载与校验，不解决远程依赖；DNF 在其上维护仓库索引、解析依赖、下载并按序调用 RPM 完成事务。因此遇到 `rpm -ivh` 报依赖错误时，正确反应是换 `dnf install` 让 DNF 去算，而不是继续 `--nodeps` 强装——强装会留下"数据库认为已装、实际链接缺失"的坏账。

```bash
$ sudo dnf install nginx
 Installing:
  nginx            x86_64   1.24.1-1.el9   appstream   29 k
Complete!                       # 依赖由 DNF 解析后按序调用 RPM 完成事务

$ rpm -q nginx                  # RPM 层：只查本地数据库
nginx-1.24.1-1.el9.x86_64
```

## 2. 日常核心命令（DNF）

```bash
$ sudo dnf makecache
Metadata cache created.         # 刷新元数据（对应 apt update / pacman -Sy）

$ sudo dnf upgrade
Upgrading:
 openssl   x86_64   3.0.7-6.el9   baseos   2.1 M
Complete!                       # YUM 时代写作 yum update，语义被映射到 upgrade

$ sudo dnf install nginx        # 卸载把 install 换成 remove，同版本重装用 reinstall
$ dnf search nginx
nginx.x86_64: A high performance web server and reverse proxy server
```

查询类操作按场景收进下表，命令都能直接运行：

| 场景 | 命令 | 说明 |
|------|------|------|
| 包详情 | `dnf info nginx` | 版本、仓库、体积、维护者 |
| 可升级列表 | `dnf check-update` | 类似 `apt list --upgradable` |
| 统计已装包 | `dnf list installed \| wc -l` | 输出总行数（示例机器 2143） |
| 文件属于哪个包 | `rpm -qf /usr/sbin/nginx` | RPM 层查询 |
| 包内文件列表 | `rpm -ql nginx` | 反查安装了哪些路径 |

YUM 兼容说明：`yum update` 在 DNF 下仍可用但语义被映射为 `dnf upgrade`；`yum install`/`yum search`/`yum remove` 同理完全兼容。唯一要留意的是老教程里的 `yum clean all`、`yum makecache` 在 DNF 下分别对应 `dnf clean all`、`dnf makecache`，命令名换掉即可。

## 3. 仓库与扩展源

RHEL/Rocky 的仓库定义全部放在 `/etc/yum.repos.d/` 下的 `*.repo` 文件，每个文件可含多个 `[section]`：

```bash
$ ls /etc/yum.repos.d/
rocky-baseos.repo  rocky-appstream.repo  rocky-extras.repo

$ dnf repolist
repo id      repo name                 status
appstream    Rocky Linux 9 - AppStream 6,412
baseos       Rocky Linux 9 - BaseOS    2,231

# 临时启用 / 禁用某个仓库执行一条命令
$ sudo dnf --enablerepo=epel install htop
$ sudo dnf --disablerepo=epel upgrade
```

**EPEL**（Extra Packages for Enterprise Linux）是 Fedora 官方为 RHEL/Rocky 维护的扩展仓库，提供 `htop`、`nginx`（部分版本）、`ripgrep` 等不在 BaseOS/AppStream 里的软件：

```bash
$ sudo dnf install epel-release
$ dnf repolist | grep epel
epel    Extra Packages for Enterprise Linux 9 - x86_64   2,104
$ sudo dnf install htop        # 装完就能正常搜索安装
```

**国内镜像**：清华 TUNA、阿里云、中科大均提供 Rocky/RHEL/EPEL 镜像，替换 `.repo` 里的 `baseurl` 即可（注意 `mirrorlist=` 行要一并注释，否则优先走官方 CDN）。

::: warning CentOS 7 已 EOL
CentOS 7 于 2024-06-30 结束生命周期，官方镜像仓库已下线。仍需维护旧机器的唯一办法是把源切到 `vault.centos.org` 存档；新系统请直接使用 Rocky Linux / AlmaLinux 9+ 或 Fedora。本页所有 DNF 命令均以 Rocky 9 为基准，不适用于 CentOS 7 的纯 YUM 环境。
:::

```bash
# 仅当必须维护 CentOS 7 时（新机器不要执行）：关掉 mirrorlist、改走 vault 存档
$ sudo sed -i -e 's|^mirrorlist=|#|' \
      -e 's|^#baseurl=http://mirror|baseurl=http://vault|' /etc/yum.repos.d/CentOS-*.repo
$ sudo yum makecache
```

**模块流（module stream）** 是 RHEL 8+ 引入的机制，让同一仓库可并存多个版本的应用（如不同版本的 Node.js、PHP、 PostgreSQL）：

```bash
$ dnf module list nodejs
Name       Stream      Profiles      Summary
nodejs     18 [d]      common...     Javascript runtime
nodejs     20          common...     Javascript runtime
$ sudo dnf module enable nodejs:20    # 切换到 20 这条流
$ sudo dnf install nodejs
```

这是 DNF 相对 YUM 的重要新能力，APT 靠多套仓库（如 `php-*` 版本包并存）、`pacman` 则基本靠滚动更新跟进新版本，三者解决同一问题的路径完全不同。

## 4. 缓存管理

DNF 的元数据与包缓存分别位于 `/var/cache/dnf/` 与 `/var/cache/yum/`（兼容路径）。清理策略与 APT 类似但命令不同，核心就两条：

```bash
$ sudo dnf clean all     # 清元数据 + 已下载包（如 142 files removed）
$ sudo dnf makecache     # 重建元数据
```

更细的粒度用 `sudo dnf clean metadata`（只清索引）与 `sudo dnf clean packages`（只清包），占用情况看 `sudo du -sh /var/cache/dnf/`。生产上 `dnf clean all && dnf makecache` 是容器镜像瘦身、缓存同步失败时的标准组合拳。与 `pacman` 对照：`pacman -Scc` 会连问两次是否清空全部包缓存，比 DNF 更激进；APT 的 `apt clean` 只删 `.deb`，不删索引（索引在 `apt clean` 后仍在，可用 `rm -rf /var/lib/apt/lists/*` 才等效于"全清"）。

## 5. 版本锁定

DNF 的版本锁由 `versionlock` 插件提供（RHEL/Rocky 默认已装），锁定条目写入 `/etc/dnf/plugins/versionlock.list`：

```bash
$ sudo dnf versionlock add nginx
Adding versions.
$ dnf versionlock list
8:nginx-1.24.1-1.el9.x86_64
$ sudo dnf versionlock delete nginx   # 解锁单个包（clear 解锁全部）
Deleting versions.
```

与另两系对照：APT 的 `apt-mark hold` 语义最接近"精确锁死当前版本，禁止出现在 upgrade 列表"；DNF `versionlock` 额外支持通配与版本范围表达式；Arch 的 `pacman` 没有一级锁命令，惯例是在 `/etc/pacman.conf` 写 `IgnorePkg = linux linux-headers`（跳过升级，而非锁定到某个确切版本），需要精确锁定时借助第三方 pin 脚本。做内核升级窗口管控时，三系的这个差异决定了你的自动化脚本必须分支处理。

## 6. RPM 底层命令

绕过 DNF 直接操作本地包的场景：安装厂商提供的闭源 `.rpm`、离线环境、或查询文件归属。三个动词记住就够：`-i` 安装（`-U` 升级、`-e` 卸载）、`-q` 查询、`-V` 校验。

```bash
$ sudo rpm -ivh vendor-app-1.0-1.x86_64.rpm   # 本地闭源包直接落盘
$ rpm -qi nginx                                # 包信息（-ql 列文件、-qf 查归属）
$ rpm -qf /usr/sbin/nginx
nginx-1.24.1-1.el9.x86_64
$ rpm -V nginx                                 # 校验完整性，无输出 = 与安装时一致
```

**常见坑**：`rpm -ivh` 遇到 `failed dependencies` 时，不要习惯性加 `--nodeps` 跳过——那会绕过 DNF 已经为你建好的依赖图，留下运行时 `undefined symbol` 之类的深坑。正确做法是改用 `dnf install ./vendor-app.rpm`，DNF 同样能装本地文件并自动解析依赖（相当于 `apt install ./xxx.deb`）。想知道系统一共装了多少个包，`rpm -qa | wc -l` 一行就够。

## 7. 与 APT、pacman 对照

核心操作在三系上的完整对照（同一张表也收录在章节首页，便于对照记忆）：

| 场景 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 刷新索引 | `sudo apt update` | `sudo pacman -Sy` | `sudo dnf makecache` |
| 升级系统 | `sudo apt upgrade` | `sudo pacman -Syu`（不可拆） | `sudo dnf upgrade` |
| 安装 | `sudo apt install pkg` | `sudo pacman -S pkg` | `sudo dnf install pkg` |
| 卸载 | `sudo apt remove pkg` | `sudo pacman -R pkg` | `sudo dnf remove pkg` |
| 搜索 | `apt search pkg` | `pacman -Ss pkg` | `dnf search pkg` |
| 包信息 | `apt show pkg` | `pacman -Si pkg` | `dnf info pkg` |
| 文件归属 | `dpkg -S /path` | `pacman -Qo /path` | `rpm -qf /path` |
| 清缓存 | `sudo apt clean` | `sudo pacman -Scc` | `sudo dnf clean all` |
| 锁版本 | `sudo apt-mark hold` | `IgnorePkg`（配置文件） | `sudo dnf versionlock add` |
| 扩展源 | PPA | AUR（`yay`/`paru`） | EPEL、RPM Fusion |
| 包格式 | `.deb` | `.pkg.tar.zst` | `.rpm` |

除了命令本身，升级纪律的差异最需要记住：APT/DNF 可以"先刷新索引、稍后升级"分两步安全执行，Arch 的 `pacman -Sy` 之后若不跟 `-Su` 就构成 partial upgrade，是该系统最经典的新手事故。换发行版做自动化脚本时，这条差异比命令拼写更容易造成生产问题。

## 8. 常见坑

1. **把 CentOS 7 时代的 `yum` 教程直接套到 Rocky 9**。命令名多数兼容，但仓库布局（`dnf repolist` vs `yum repolist` 输出格式）、模块流等概念已变。先 `cat /etc/os-release` 确认系统版本再动手。

2. **`dnf` 报 `Metadata cache expired` 或下载失败**。先 `sudo dnf clean all && sudo dnf makecache` 重建元数据；仍失败则检查 `.repo` 文件里 `mirrorlist` 是否指向了不可达的官方域名，必要时注释掉改用 `baseurl` 指向国内镜像。

3. **EPEL 装完某个包却提示"模块需要的依赖被禁用"**。RHEL 系的模块流会锁默认启用的版本，`dnf module list` 查看并 `dnf module reset <name>` 后再试。

4. **`rpm -ivh --nodeps` 强装闭源包后服务起不来**。依赖图被绕过，运行时缺库。用 `dnf install ./pkg.rpm` 重装让 DNF 补依赖，或 `ldd /usr/sbin/binary | grep not` 定位缺失的 `.so` 再精确安装。

5. **versionlock 清不掉导致某包"永远不升级"**。`dnf versionlock list` 确认后 `dnf versionlock clear`；这与 APT 的 `apt-mark showhold/unhold` 是同一类排查路径。

6. **在 Arch 上找 `dnf`/`yum`**。命令不存在，Arch 只有 `pacman`（及其 AUR 助手）。三系切换前的固定动作仍是先看 `/etc/os-release` 的 `ID=` 字段。

## 参考资料

- RHEL 9 - 使用 DNF 工具管理软件 — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_software_with_the_dnf_tool/index)
- Rocky Linux - 包管理 — [docs.rockylinux.org](https://docs.rockylinux.org/guides/package_management/)
- Fedora 文档 - DNF — [docs.fedoraproject.org](https://docs.fedoraproject.org/en-US/quick-docs/dnf/)
- EPEL 项目 — [fedoraproject.org/wiki/EPEL](https://fedoraproject.org/wiki/EPEL)
- Arch Wiki - pacman（对照参考） — [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- 鸟哥的私房菜 - 软件管理 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0520softwaremanager.php)
- `man dnf`、`man rpm`、`man dnf-versionlock`、`man dnf.conf`
