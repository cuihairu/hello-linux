# Pacman 包管理

pacman 是 Arch Linux 的官方包管理器，官方仓库里的所有包都以 `.pkg.tar.zst` 格式交由它安装，而 Arch 的滚动更新模型，日常就是靠 `pacman -Syu` 一条命令维持的。它没有 APT/DNF 那种子命令风格（`apt install`、`dnf remove`），只有四个字母动词：`-S`（同步仓库并操作）、`-Q`（查本地数据库）、`-R`（卸载）、`-U`（安装本地包文件），组合出全部功能。命令风格之外，真正的分水岭在发布模型：Debian/RHEL 的仓库是"固定版本集合"，刷新索引与升级可以拆开慢慢做；Arch 仓库里每个包永远只有一个当前版本，索引一刷新，系统里所有旧包立刻"过期"——由此引出本页最重要的一条纪律：永远不要部分升级（partial upgrade）。

> 内容参考自 Arch Linux 官方文档（Arch Wiki / pacman 手册页），见文末参考资料。

## 学习目标

- 说出 pacman 与 Arch 滚动更新模型的绑定关系，解释为什么"部分升级"被官方列为不支持行为
- 掌握 `-S`/`-R`/`-Q` 三个动词及常用组合（`-Syu`、`-Rs`、`-Qo`、`-Ss`），独立完成安装、卸载、查询、升级
- 理解 `/etc/pacman.conf` 里的仓库定义（core/extra/multilib）与镜像文件 mirrorlist 的优先级规则
- 会用 `paccache` 控制包缓存占用，并理解"保留几个旧版本"对滚动系统回滚的价值
- 了解 AUR 的定位与 `git clone` + `makepkg -si` 构建流程，划清它与官方仓库的边界
- 能与 [APT](./apt.md)、[YUM/DNF](./yum.md) 逐项对照，在跨发行版脚本里写对分支

## 1. pacman 与滚动更新模型

Arch 没有 8.0、9.0 这样的版本号，只有一个持续前进的滚动分支：装一次系统，之后无限次 `pacman -Syu`。仓库里每个包只保留一个当前版本，这是它区别于 Debian stable / RHEL 固定源的根本点，也是本页所有纪律的来源。

```bash
# 滚动仓库没有"stable 代号"，pacman -Si 只会给出一个当前版本
$ pacman -Si htop | grep -E '^(Repository|Version)'
Repository      : extra
Version         : 3.3.0-1
```

Debian 的 stable 像一张冻结的菜单，`apt update` 之后随时可以升级；Arch 的仓库则是持续滚动的前端，今天索引里的 `htop 3.3.0-1`，明天可能就是 3.4.0-1，而仓库不再保留旧版。这决定了两条纪律：升级必须整体进行（第 4 节），回滚手段有限、包缓存要自己经营（第 5 节）。

## 2. 数据库与仓库

pacman 的状态分两处：`/var/lib/pacman/local/` 记录已安装包（`-Q` 系列查询、卸载都基于它），`/var/lib/pacman/sync/` 存放各仓库的索引快照（`-Sy` 更新的就是这里）。仓库在 `/etc/pacman.conf` 里定义，镜像在 `/etc/pacman.d/mirrorlist` 中按顺序排列，排在前面的优先使用。

```bash
# /etc/pacman.conf 的仓库段落（节选）
[core]
Include = /etc/pacman.d/mirrorlist      # core：系统启动与基本运行必需的包

[extra]
Include = /etc/pacman.d/mirrorlist      # extra：桌面、应用等其余官方包

#[multilib]
#Include = /etc/pacman.d/mirrorlist     # multilib：x86_64 上的 32 位库，默认注释未启用
```

三个官方仓库的分工：core 收录基本系统运行所必需的包（glibc、systemd、内核）；extra 收录其余官方软件，桌面环境和大多数服务器软件都在这里；multilib 提供 32 位兼容库，运行 Wine、Steam 这类含 32 位组件的程序时才需要，默认不启用。老教程里的 `[community]` 仓库已于 2023 年并入 `[extra]`，索引里搜不到 community 属正常现象。

国内镜像加速不靠 sed 替换 URL，而是把镜像条目在 mirrorlist 里的位置挪到前面（pacman 按文件顺序取用），改完执行一次 `pacman -Syu` 验证。

## 3. 日常核心命令

安装的完整交互，输出格式与 APT 差异不小，值得先看一遍：

```bash
$ sudo pacman -S htop
resolving dependencies...
looking for conflicting packages...

Packages (1) htop-3.3.0-1

Total Download Size:   0.16 MiB
Total Installed Size:  0.35 MiB

:: Proceed with installation? [Y/n] y
# 确认后下载并安装（进度条行已略）
```

其余高频操作按场景收进下表，命令都能直接运行：

| 场景 | 命令 | 说明 |
|------|------|------|
| 一次装多个 | `sudo pacman -S git curl wget` | 依赖统一解析 |
| 重装已有包 | `sudo pacman -S htop` | 已安装时相当于覆盖重装 |
| 安装本地包 | `sudo pacman -U ./htop-3.3.0-1-x86_64.pkg.tar.zst` | makepkg 产物与缓存降级都走 `-U` |
| 搜远端仓库 | `pacman -Ss nginx` | 支持正则，如 `pacman -Ss '^nginx-'` |
| 远端包详情 | `pacman -Si nginx` | 版本、依赖、所在仓库 |
| 搜已安装 | `pacman -Qs nginx` | `-Q` 系列只查本地库，与 `-S` 系列成对 |
| 已装包详情 | `pacman -Qi nginx` | 安装时间、安装原因、依赖它的包 |
| 包内文件列表 | `pacman -Ql nginx` | 该包装到了哪些路径 |
| 文件归属 | `pacman -Qo /usr/bin/nginx` | 未安装的文件先 `sudo pacman -Fy` 再 `pacman -F 文件` 查仓库 |

卸载有三个梯度，区别在"带不带依赖、留不留备份"：

```bash
$ sudo pacman -R htop        # 只删包本身，依赖原地不动
$ sudo pacman -Rs nginx      # 连带删除只为它装上的依赖
$ sudo pacman -Rns nginx     # 再加 -n：不保留备份文件（否则配置存成 .pacsave）
```

pacman 没有 `apt autoremove` 那样的一级命令，孤儿包（作为依赖装上、如今无人需要的包）要自己查自己删：

```bash
$ pacman -Qdt                          # 列出孤儿包
$ sudo pacman -Rns $(pacman -Qdtq)     # 社区惯用的批量清理写法
```

批量清理前务必先单独跑一遍 `pacman -Qdt` 看清清单：若某个包你实际在用、却因为装的时候没加参数被记成了依赖，先 `sudo pacman -D --asexplicit 包名` 把它标为手动安装，再执行批量删除。

## 4. 系统升级与部分升级

系统升级只有一种正确写法：`-Syu` 连写，同步索引与升级在一次事务里完成。

```bash
$ sudo pacman -Syu
:: Synchronizing package databases...
 core                  132.0 KiB   ...
 extra                 8.0 MiB     ...
:: Starting full system upgrade...
 there is nothing to do            # 无更新时的完整结尾

$ sudo pacman -Syu                 # 有更新时会列出全部包并要求确认
Packages (12) curl-8.x.y-1  linux-6.x.y.arch1-1  ...
```

反过来，`pacman -Sy`（只刷索引）之后跟着 `pacman -S 包名`（只装一个包），就是 Arch 社区说的部分升级：pacman 会按新索引解析依赖，目标包和它的新依赖从新仓库取，而系统其余部分停在旧版，库与应用版本脱节，典型症状是 `error while loading shared libraries` 和签名信任错误。Arch Wiki 对 partial upgrade 的定性是"不支持"（unsupported），修复方式恰恰是执行一次完整的 `-Syu`。网上脚本与定时任务里"只跑 `pacman -Sy`"是这条红线的最高发场景，第 8 节还会回到它。

## 5. 缓存管理

包缓存在 `/var/cache/pacman/pkg/`，pacman 不会自动清理，旧版本越积越多。但滚动系统恰恰靠这些旧文件回滚：升级后某服务起不来，最直接的补救是 `sudo pacman -U /var/cache/pacman/pkg/包名-旧版本.pkg.tar.zst` 降级。所以清理的目标是"留够、删多"，而不是清零。

```bash
$ sudo pacman -S pacman-contrib       # paccache 在这个包里，不在 pacman 本体
$ paccache -r                         # 每个包保留最近 3 个版本（默认策略）
$ paccache -ruk0                      # 只清已卸载包的全部缓存，保留已装包的回滚余地

$ du -sh /var/cache/pacman/pkg/       # 清理前后各看一眼占用
2.1G	/var/cache/pacman/pkg/
$ sudo pacman -Sc                     # 删已卸载包的缓存（交互确认）
$ sudo pacman -Scc                    # 全清——回滚材料一并消失，滚动系统上慎用
```

`paccache -r` 是 Arch Wiki 系统维护页给出的推荐做法；不想手动跑，可以 `systemctl enable --now paccache.timer` 让它每周自动执行。

## 6. AUR 与 makepkg

官方仓库之外还有一个 AUR（Arch User Repository），它的定位必须先说清楚：AUR 不是官方仓库，里面存放的是用户提交的 PKGBUILD 构建脚本而非预编译包，官方不为其中任何内容提供支持，构建与使用风险自负。大量小众软件正是通过它进入 Arch 生态，不少今天在官方仓库里的包，最初也只是 AUR 里的一份 PKGBUILD。

构建的前提是编译工具链：

```bash
$ sudo pacman -S --needed base-devel git   # --needed：已装则跳过

# AUR 标准构建流程（以 yay 自身为例）
$ git clone https://aur.archlinux.org/yay.git
$ cd yay
$ less PKGBUILD                    # 构建前必须通读：源码地址、校验值、构建脚本
$ makepkg -si                      # -s 由 pacman 补齐依赖，-i 构建完成后立即安装
```

PKGBUILD 本质是 shell 脚本，`makepkg` 会以你的用户身份执行其中内容，到安装环节才请求 sudo。所以"先读 PKGBUILD 再构建"不是仪式，而是 AUR 唯一有效的安全防线——star 数和下载量都替代不了这一步。yay、paru 这类 AUR 助手把搜索、构建、更新打包成一条命令，使用面很广，但它们是第三方工具，与 Arch 官方无关。另有一条边界要记住：`pacman -Syu` 不会更新 AUR 包，pacman 只读官方仓库数据库，AUR 包需要用助手或手动重新 makepkg 跟进。

## 7. 与 APT、DNF 对照

四类核心操作的对照（APT/DNF 两系的展开见前两页）：

| 操作 | APT（Debian/Ubuntu） | DNF（RHEL 系） | pacman（Arch） |
|------|----------------------|----------------|----------------|
| 安装 | `sudo apt install nginx` | `sudo dnf install nginx` | `sudo pacman -S nginx` |
| 卸载 | `sudo apt remove nginx` | `sudo dnf remove nginx` | `sudo pacman -R nginx` |
| 查询 | `apt search nginx` / `dpkg -S 文件` | `dnf search nginx` / `rpm -qf 文件` | `pacman -Ss nginx` / `pacman -Qo 文件` |
| 升级 | `sudo apt update && sudo apt upgrade` | `sudo dnf upgrade` | `sudo pacman -Syu`（不可拆开） |

表格之外有三点结构性差异，比命令拼写更值得记住。升级原子性：APT/DNF 刷新索引与升级可以分两步相隔任意久，pacman 的 `-Sy` 与 `-Su` 必须合并执行。孤儿清理：`apt autoremove`、`dnf autoremove` 都是一级命令，pacman 只提供 `-Qdt` 查询，删除靠用户自己组合。版本锁定：`apt-mark hold` 与 `dnf versionlock` 是一级命令，pacman 走配置文件 `IgnorePkg`（见下一节）。还有一处分层上的不同：pacman 自身就是底层，没有 dpkg、RPM 那样的独立低层工具，依赖解析、下载、安装都在同一个程序里完成——这也是它的输出总以 `resolving dependencies` 开头的原因。

## 8. 常见坑

1. **把 `-Sy` 当成 `apt update` 的等价物**。语义确实对应（刷新索引），用法不等价：`apt update` 之后可以安心干别的，`pacman -Sy` 之后系统立刻处于"索引新、包旧"的中间态，正确动作只有紧接着完整 `-Syu`。定时任务、自动化脚本里只写 `-Sy` 是这个坑的最高发场景。

2. **签名错误 `invalid or corrupted package (PGP signature)` 或 `unknown trust`**。多半是 `archlinux-keyring` 太旧，许久未升级的机器、用旧安装镜像装出来的系统都常见。先 `sudo pacman -Sy archlinux-keyring` 更新钥匙环，紧接着执行完整 `pacman -Syu`。注意这一步本身是刻意为之的部分升级，所以钥匙环更新后不要中途停下。

3. **`IgnorePkg` 写了忘删**。在 `/etc/pacman.conf` 的 `[options]` 段写 `IgnorePkg = linux linux-headers` 可让 pacman 跳过指定包的升级，升级输出里表现为 `warning: xxx: ignoring package upgrade`。内核升级窗口期临时锁包很常用，但锁完要记得回来删，`grep -i ignorepkg /etc/pacman.conf` 一眼核对。

4. **`.pacnew` 文件长期不处理**。升级时若某配置文件（`/etc/pacman.conf` 自己就常中招）在官方新版本里有变化而你改过本地文件，pacman 不覆盖，而是把新版存成 `.pacnew` 放在旁边。不合并，新增的默认配置项就永远不生效。升级后 `find /etc -name "*.pacnew"` 查一遍，装了 pacman-contrib 的可以用 `pacdiff` 逐个对比合并。

5. **把 AUR 当官方仓库用**。`yay -S xxx` 的便利容易让人忘记两件事：AUR 内容无人审核，构建前要读 PKGBUILD；AUR 包不在 `pacman -Syu` 的覆盖范围内，忘了跟进就会长期停在旧版。

6. **`-Scc` 清缓存清到底**。全清之后，升级翻车时连降级的材料都没有。日常用 `paccache -r` 留最近几版即可，`-Scc` 留给磁盘实在不够的时候。

## 参考资料

- pacman 手册页 — [man.archlinux.org](https://man.archlinux.org/man/pacman.8)
- Arch Wiki - pacman — [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- Arch Wiki - System maintenance — [wiki.archlinux.org](https://wiki.archlinux.org/title/System_maintenance)
- Arch Wiki - AUR — [wiki.archlinux.org](https://wiki.archlinux.org/title/Arch_User_Repository)
- `man pacman`、`man pacman.conf`、`man makepkg`、`man paccache`
