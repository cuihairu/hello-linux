# APT 包管理

APT（Advanced Package Tool）是 Debian 与 Ubuntu 全家桶的官方前端，它解决的核心问题是**依赖解析**：安装一个图形程序可能牵连几十个库，人工追依赖既不现实也不可能。APT 的设计有一个值得先理解的分层——`apt` 只负责"和仓库打交道"（查索引、算依赖、下载），真正把文件写进系统、维护"已安装清单"的是底层的 `dpkg`。这个分工解释了很多现象：为什么 `dpkg -i` 装本地 `.deb` 会报"未满足的依赖"而 `apt install ./xxx.deb` 不会（后者先调 APT 算依赖再调 dpkg），为什么安装被中断后要用 `dpkg --configure -a` 而不是 `apt --fix-broken` 二选一（两者各管一层，常常需要连用）。本页按"日常命令 → 仓库与源 → 缓存与锁定 → 三系对照 → 常见坑"展开，所有输出均来自真实终端。

> 内容参考自 Debian 手册与 Ubuntu 官方文档，见文末参考资料。

## 学习目标

- 分清 `apt` 与 `dpkg` 的职责边界，知道何时该用哪个
- 掌握安装/升级/搜索/卸载/清理全套命令并读懂真实输出
- 会配置 sources.list（旧格式）与 ubuntu.sources（deb822 格式）、国内镜像与 PPA
- 会用 `apt-mark hold` 锁版本，并能与 DNF、`pacman` 对照

## 1. 为什么分 apt 和 dpkg 两层

`dpkg` 是 Debian Package 的缩写，从 1993 年就存在，只做本地包管理：安装、卸载、查询"哪些文件属于哪个包"，但**完全不理解依赖**——它拿到一个需要 `libssl3` 却发现系统没有时，只会把错误码抛给你。APT 在它之上补全了缺失的智能：维护远程仓库索引、构建依赖图、按需下载依赖、处理冲突与推荐包。类比关系是：`dpkg` 像仓库管理员只管入库出库，`apt` 像采购经理负责比价、凑单、补货。

```bash
# 高层：与仓库交互（需要联网概念）
$ apt policy nginx
nginx:
  Installed: (none)
  Candidate: 1.24.0-2ubuntu7
  Version table:
     1.24.0-2ubuntu7 500
        500 http://archive.ubuntu.com/ubuntu noble/main amd64 Packages

# 底层：只看本地 dpkg 数据库
$ dpkg -l | grep -c ^ii
2487          # 系统上已成功安装的包数量（ii = installed ok）
```

日常使用几乎永远从 `apt` 开始；只有在处理本地 `.deb` 文件、修复损坏状态、或查询"这个文件是哪个包提供的"时才需要直接调用 `dpkg`。

## 2. 日常核心命令

```bash
# 刷新索引（不升级任何软件，只下载"菜单"）
$ sudo apt update
Get:1 http://archive.ubuntu.com/ubuntu noble InRelease [126 kB]
Get:2 http://archive.ubuntu.com/ubuntu noble/main amd64 Packages [1406 kB]
Fetched 3429 kB in 1s (3241 kB/s)
Reading package lists... Done

# 升级所有可升级的包（不移除、不安装新依赖以外的包）
$ sudo apt upgrade
The following packages will be upgraded:
  curl libcurl4 openssl zlib1g
3 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.
Need to get 1420 kB of archives.

# 完整升级：允许为升级而"移除"冲突的旧包（比 upgrade 更激进）
$ sudo apt full-upgrade        # 旧称 apt-get dist-upgrade

# 安装
$ sudo apt install nginx
The following NEW packages will be installed:
  nginx nginx-common nginx-core
0 upgraded, 3 newly installed, 0 to remove.
Setting up nginx (1.24.0-2ubuntu7) ...
nginx: configuration file test is successful

# 卸载（保留配置文件）
$ sudo apt remove nginx

# 卸载并删除配置（purge = remove + 清 /etc 与部分 /var 残留）
$ sudo apt purge nginx

# 删除不再被任何软件依赖的包（升级后例行清理）
$ sudo apt autoremove

# 搜索（会同时搜包名与描述，注意大小写不敏感）
$ apt search web server | head -5
nginx/stable 1.24.0-2ubuntu7 amd64
  small, but powerful web/proxy server

# 查看包详情（版本、依赖、维护者、主页）
$ apt show nginx
Package: nginx
Version: 1.24.0-2ubuntu7
Depends: nginx-common (= ...), libc6 (>= 2.34), libssl3 ...
Description: small, but powerful web/proxy server

# 列出可升级的包
$ apt list --upgradable
curl/noble-updates 8.5.0-2ubuntu10 amd64 [upgradable from: 8.4.0-1build1]

# 查文件属于哪个包 / 包里装了哪些文件
$ dpkg -S /usr/sbin/nginx
nginx: /usr/sbin/nginx
$ dpkg -L nginx-common | head -5
/.
/etc
/etc/logrotate.d/nginx
```

一个常被问到的区别：`apt remove` 卸载后，`/etc/nginx/` 下的配置通常仍在（因为属于独立的 `nginx-common` 包或被 dpkg 标记为 conffile），想要干净删掉用 `apt purge`。反过来，`apt autoremove` 与 `apt clean` 是两回事——前者删"不再需要的软件包"，后者删"下载下来的 `.deb` 缓存文件"。

## 3. 仓库与源配置

APT 的仓库定义在两类位置：单行格式的老文件 `/etc/apt/sources.list`，以及 Debian 12+/Ubuntu 24.04+ 推荐的 **deb822 格式**（`.sources` 文件，字段分行书写、更易解析）。Ubuntu 24.04 起默认源文件已迁移到 `/etc/apt/sources.list.d/ubuntu.sources`，照着老教程改 `sources.list` 会发现改了没反应——这是该版本最高频的配置踩坑。

```bash
# Ubuntu 24.04+ deb822 格式（默认路径）
$ cat /etc/apt/sources.list.d/ubuntu.sources
Types: deb
URIs: http://archive.ubuntu.com/ubuntu/
Suites: noble noble-updates noble-backports
Components: main restricted universe multiverse
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

# 旧版单行格式（Debian 与 Ubuntu 22.04 及更早）
# deb http://archive.ubuntu.com/ubuntu noble main restricted universe multiverse

# 额外源目录（PPA、第三方仓库都放这里）
$ ls /etc/apt/sources.list.d/
ubuntu.sources
```

**切换国内镜像**（以清华 TUNA 为例，替换前务必备份）：

```bash
# deb822 格式（Ubuntu 24.04+）
$ sudo cp /etc/apt/sources.list.d/ubuntu.sources{,.bak}
$ sudo sed -i 's|http://archive.ubuntu.com|https://mirrors.tuna.tsinghua.edu.cn|g' \
      /etc/apt/sources.list.d/ubuntu.sources

# 单行格式（旧版）
$ sudo cp /etc/apt/sources.list{,.bak}
$ sudo sed -i 's|http://archive.ubuntu.com|https://mirrors.tuna.tsinghua.edu.cn|g' \
      /etc/apt/sources.list

$ sudo apt update      # 换源后必须刷新索引
```

**PPA（Personal Package Archive）** 是 Ubuntu 特有的第三方仓库机制，Debian 官方体系没有对等物（Debian 用 backports 或直接从源码/第三方 `.list` 文件）：

```bash
# 添加 PPA（需要 software-properties-common）
$ sudo apt install software-properties-common
$ sudo add-apt-repository ppa:deadsnakes/ppa    # 例：Python 多版本
$ sudo apt update

# 移除 PPA
$ sudo add-apt-repository --remove ppa:deadsnakes/ppa

# 查看当前启用了哪些源
$ apt policy | grep -E '^\S|release' | head -10
```

## 4. 缓存管理

APT 在 `/var/cache/apt/archives/` 保留已下载的 `.deb` 文件（便于重装、离线部署），索引则在 `/var/lib/apt/lists/`。两者都会随时间膨胀，需要区分清理：

```bash
# 清空已下载的 .deb 缓存（安全，随时可重新下载）
$ sudo apt clean
$ du -sh /var/cache/apt/archives/
0       /var/cache/apt/archives/

# 只清理"过期版本"的 .deb（保守版，留当前可用的）
$ sudo apt autoclean

# 删除不再需要的依赖包（注意与 clean 的区别）
$ sudo apt autoremove

# 查看 APT 缓存占用
$ sudo du -sh /var/cache/apt/archives/ /var/lib/apt/lists/
```

一个实用技巧：服务器上跑完 `apt upgrade` 后习惯性接一句 `apt clean`，可以把镜像缓存占用降为 0；需要离线分发时反过来，在一台机器 `apt install --download-only` 聚齐 `.deb` 再拷走。

## 5. 版本锁定

升级前想把某个关键包（内核、nginx 指定小版本、glibc）钉死，避免被 `apt upgrade` 顺手带上去：

```bash
# 锁定（hold 会写入 dpkg 状态标记）
$ sudo apt-mark hold nginx
nginx set on hold.

# 查看所有被锁定的包
$ apt-mark showhold
nginx

# 解锁
$ sudo apt-mark unhold nginx
nginx was unheld.

# 对比：查看"可自动升级"与"被 hold"的差异
$ apt list --upgradable    # 被 hold 的包不会出现在这里
```

`hold` 是包级别的"禁止升级"标记，存在 `/var/lib/dpkg/status` 中，重装系统不保留，但同一系统内跨多次 `apt upgrade` 一直有效。与另两系对照：DNF 用 `dnf versionlock add nginx`（写入 `versionlock.list`，可精确到版本号），Arch 无对等一级命令，通常在 `/etc/pacman.conf` 配 `IgnorePkg`。

## 6. 与 DNF、pacman 对照

同样六类操作在三系上的完整对照（详细展开见 [YUM/DNF](./yum.md) 与章节首页）：

| 操作 | Debian/Ubuntu (`apt`) | Arch (`pacman`) | RHEL/Rocky (`dnf`) |
|------|----------------------|-----------------|---------------------|
| 刷新索引 | `sudo apt update` | `sudo pacman -Sy` | `sudo dnf makecache` |
| 升级 | `sudo apt upgrade` | `sudo pacman -Su`（建议 `-Syu` 连写） | `sudo dnf upgrade` |
| 安装 | `sudo apt install nginx` | `sudo pacman -S nginx` | `sudo dnf install nginx` |
| 卸载 | `sudo apt remove nginx` | `sudo pacman -R nginx` | `sudo dnf remove nginx` |
| 搜索 | `apt search nginx` | `pacman -Ss nginx` | `dnf search nginx` |
| 清缓存 | `sudo apt clean` | `sudo pacman -Scc` | `sudo dnf clean all` |
| 锁版本 | `sudo apt-mark hold` | `IgnorePkg`（pacman.conf） | `sudo dnf versionlock add` |

`pacman` 的短选项体系（`-S` sync、`-R` remove、`-Ss` search）与 APT/DNF 的子命令风格完全不同，第一次接触时只需记：`-S` 同时承担"安装"与"同步索引"两个语义，所以 `-Syu` = 同步 + 升级。真正需要警惕的仍是 Arch 的 partial upgrade：**永远不要把 `-Sy` 与 `-Su` 拆开执行**。

## 7. dpkg 底层与修复

```bash
# 安装本地 .deb（会因缺依赖失败——此时改用 apt install ./file.deb）
$ sudo dpkg -i nginx-common_1.24.0-2ubuntu7_all.deb
dpkg: dependency problems prevent configuration of nginx-common:
 nginx-common depends on lsb-base (>= 3.2-14) ...

# 正确姿势：让 apt 补齐依赖（deb822 之后支持本地路径）
$ sudo apt install ./nginx-common_1.24.0-2ubuntu7_all.deb

# 中断后的标准修复流程（顺序很重要）
$ sudo dpkg --configure -a          # 先完成所有"已解包未配置"的包
$ sudo apt --fix-broken install     # 再修复依赖关系

# 强制配置（慎用，仅在 dpkg 自身状态错乱时）
$ sudo dpkg --configure -a --force-confnew
```

`dpkg --configure -a` 处理的是"文件已复制、postinst 脚本没跑完"的半安装状态（apt 中断、断电后常见）；`apt --fix-broken install` 处理的是依赖图缺口。两者互补，修复脚本里通常按上述顺序各跑一遍。

## 8. 常见坑

1. **Ubuntu 24.04 改错源文件**。默认已是 `ubuntu.sources`（deb822），改老 `sources.list` 无效。先 `ls /etc/apt/sources.list*` 确认实际存在哪个文件再动手。

2. **`apt update` 报 `404 Not Found` 或 `Release file expired`**。多为镜像源与当前发行版代号（如 `noble`）不匹配，或源指向了已过期的旧版本仓库。核对 `Suites`/`deb` 行里的代号与 `lsb_release -cs` 一致。

3. **锁文件冲突 `Could not get lock`**。另一个 apt/dpkg 进程在跑（常见是 `unattended-upgrades`）。`ps aux | grep -E 'apt|dpkg'` 定位后等待或处理；不要手动 `rm` 锁文件，那会破坏 dpkg 数据库一致性。

4. **`dpkg -i` 装出一堆 `unmet dependencies`**。这正是分层设计的预期行为——本地装包请优先 `apt install ./xxx.deb`，让 APT 先算依赖。

5. **hold 之后忘了 unhold**。升级窗口期临时锁的包，事后 `apt-mark showhold` 检查一遍，否则以后每次升级都会"莫名其妙少升一个"。

6. **把 `autoremove` 当 `clean`**。前者删软件，后者删缓存文件；在共享机器上误跑 `autoremove` 可能删掉手动安装但当前无反向依赖的工具包，执行前先看它打算删什么：`apt --dry-run autoremove`。

## 参考资料

- Debian 手册 - APT 与 dpkg — [debian.org](https://www.debian.org/doc/manuals/debian-handbook/apt.zh-cn.html)
- Ubuntu 文档 - sources.list 与 deb822 — [help.ubuntu.com](https://help.ubuntu.com/community/SourcesList)
- Arch Wiki - pacman（对照参考） — [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- 鸟哥的私房菜 - Debian 的软件管理 — [linux.vbird.org](https://linux.vbird.org/linux_basic/ubuntu/)
- `man apt`、`man apt-get`、`man dpkg`、`man apt-mark`、`man sources.list`
