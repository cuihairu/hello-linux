# 包管理命令

装软件、升级、查依赖、清缓存——这些事每台机器每天都在发生，但三系命令长得完全不一样：Debian 叫 `apt`，RHEL 8+ 叫 `dnf`（旧文还写着 `yum`），Arch 叫 `pacman`。把 A 系的 `apt install` 敲到 Arch 上只会得到 `command not found`，反过来 `pacman -Syu` 也不会被 Ubuntu 认出。本页定位是**命令速查手册**：用三张总表 + 真实输出把"六件日常事"（安装、升级、搜索、仓库、缓存、锁定）钉死，再补底层 `dpkg`/`rpm` 与仓库生态（PPA、EPEL、AUR）。概念讲解与发行版选择见[基础篇 · 软件包管理](../../basic/packages.md)，APT 细节在 [apt 详解](../../basic/packages/apt.md)，RHEL 家族细节在 [yum/dnf 详解](../../basic/packages/yum.md)，本页不再重复长篇原理——**遇到"怎么做"，先查这里；遇到"为什么"，翻基础篇**。

> 三系对照涉及的命令在 **Debian/Ubuntu（apt/dpkg）、RHEL/CentOS/Rocky（dnf/rpm）、Arch（pacman）** 上分别给出；一条命令同时出现在两系的，表格里会并列。所有 APT/dpkg 输出来自真实 Ubuntu 26.04 环境；dnf 与 pacman 输出按各系稳定版本的标准格式给出，若你机器版本较新，列名可能略有出入，语义一致。

## 学习目标

- 30 秒内判断当前系统属于哪一家族、该用哪套命令（含最小化安装/容器的例外）
- 按"安装 / 升级 / 搜索 / 仓库 / 缓存 / 锁定"六个维度对照 apt、dnf、pacman 的等价操作
- 理解 `dpkg`/`rpm` 与上层前端的关系：什么时候必须下沉一层
- 正确使用 PPA（Debian/Ubuntu）、EPEL（RHEL 系）、AUR（Arch），知道它们各自的信任边界与风险
- 用 `apt-mark`、`dnf` 版本锁、`pacman -IgnorePkg` 避免关键包被自动升级打坏

## 1. 先认清系统：该敲哪套命令

`uname` 不够用，容器里也可能是任何发行版。三行命令定位家族与工具链：

```bash
$ cat /etc/os-release | grep -E '^(ID|ID_LIKE)='
ID=ubuntu
ID_LIKE=debian

$ command -v apt dnf pacman yum 2>/dev/null
/usr/bin/apt
```

判断规则（按优先级）：

1. 有 `apt` 且 `/etc/debian_version` 存在 → **Debian/Ubuntu 家族**，前端 `apt`/`apt-get`，底层 `dpkg`
2. 有 `dnf` → **RHEL 8+/Fedora/Rocky 8+**，底层 `rpm`；只有 `yum` 多半是 RHEL 7 或兼容别名（`yum` 在新系统上常是指向 dnf 的薄壳）
3. 有 `pacman` 且 `/etc/arch-release` 存在 → **Arch/Manjaro 等**，前端与底层合一，就是 `pacman`
4. 三者都没有 → 精简容器、Alpine（`apk`）、SUSE（`zypper`）等，本页不覆盖

**三条硬规则**：不要混用（别在 Debian 上装 rpm，也别指望把 `.deb` 双击装进 Arch）；不要跨系拷贝"已编译好的二进制目录"（glibc/依赖 ABI 会咬人）；升级时**一家只用一个前端**（Ubuntu 上 `apt upgrade` 与 `unattended-upgrades` 可并存，但不要 apt 和 dpkg 手动交替升级）。

容器场景常出现"没有 apt 也没有 dnf/pacman"的情况：Alpine 是 `apk`，Ubuntu/Debian 镜像才是 apt，Rocky 容器是 dnf，Arch 容器才有 `pacman`。写 Dockerfile 时用镜像官方推荐的前端，并在 `RUN` 里合并升级+安装+清索引（如 `apt-get update && apt-get install -y --no-install-recommends ... && rm -rf /var/lib/apt/lists/*`），既减小层体积，也避免"索引过期导致装不到"。跨镜像复制 `node_modules` 一类预编译产物本来就不可靠，二进制分发更应对准目标发行版的包管理器，而不是假设所有机器都是 Ubuntu。

```bash
$ dpkg --version | head -1
dpkg command line interface; version 1.22.6ubuntu8;

$ pacman --version
 Pacman v6.1.0 - libalpm v15.0.0
```

## 2. 六维对照总表：apt / dnf / pacman

下面三张表是本页核心。记不住时先背**动词**，再对到各系参数：安装 `install`、升级 `upgrade/update`、搜索 `search`、卸载 `remove`/`erase`/`-R`、查文件属于哪个包在 apt 与 pacman 里都是 `-S`（dpkg 是 `-S`，注意 pacman 的 `-S` 是同步/安装，大小写敏感）。

### 2.1 安装 / 升级 / 卸载

| 操作 | Debian / Ubuntu | RHEL / CentOS / Rocky | Arch |
|------|-----------------|------------------------|------|
| 安装 | `sudo apt install 包名` | `sudo dnf install 包名` | `sudo pacman -S 包名` |
| 批量安装 | `sudo apt install a b c` | `sudo dnf install a b c` | `sudo pacman -S a b c` |
| 升级全部 | `sudo apt update && sudo apt full-upgrade` | `sudo dnf upgrade --refresh` | `sudo pacman -Syu` |
| 只升已装 | `sudo apt upgrade` | `sudo dnf upgrade` | `sudo pacman -Syu`（Arch 无"部分升级"官方支持） |
| 升单个包 | `sudo apt install --only-upgrade 包名` | `sudo dnf upgrade 包名` | `sudo pacman -S 包名`（同步仓库） |
| 卸载（留配置） | `sudo apt remove 包名` | `sudo dnf remove 包名` | `sudo pacman -R 包名` |
| 卸载（删配置） | `sudo apt purge 包名` | `sudo dnf remove`（配置多在 `/etc`，需手删或 `--no-autoremove` 配合） | `sudo pacman -Rns 包名`（`-n` 同时删配置） |
| 自动清依赖 | `sudo apt autoremove` | `sudo dnf autoremove` | `sudo pacman -Qdtq \| sudo pacman -Rns -` |
| 重装 | `sudo apt install --reinstall 包名` | `sudo dnf reinstall 包名` | `sudo pacman -S 包名`（损坏用 `pacman -Syyu 包名`） |

Arch 这一列里 `pacman` 出现密度最高，原因是它的参数是**动词组合**而非英文单词：`-S`（Sync，装/升级）、`-R`（Remove，卸）、`-Q`（Query，查）、`-Syyu` 强制刷新元数据并全升。大小写必须准确——`-S` 与 `-s` 是不同操作（后者是"仅搜索"），新手最常见的错误就是少了大写 `S`。

Debian/Ubuntu 的 `full-upgrade` 与 `upgrade` 差别：前者允许为升级**移除冲突的旧包**，在发行版跨版本（如 `do-release-upgrade` 前）时更彻底；日常 `apt upgrade` 更保守。RHEL 侧对应 `dnf upgrade` 与 `dnf distro-sync`（后者把版本对齐仓库，跨小版本更常用）。Arch 因为滚动更新，官方强调**永远整系统 `pacman -Syu`**，反对只升单包的"部分升级"——那会制造依赖地狱。

真实安装示例（Ubuntu）只保留最有信息量的三行节奏：`sudo apt update` 结束于 `Reading package lists... Done`，`sudo apt install -y sl` 显示 `1 newly installed` 与 `Setting up sl`，最后 `Processing triggers for man-db` 说明触发器已跑完——若缺触发器，手册索引会旧，却不代表安装失败。**看进度条不如看"newly installed / upgraded / removed"三个数字**，它们是脚本判断成功与否的稳定锚点。

`apt update` 只刷新**索引**，不下载也不升级包体；`apt install` 才下载安装。RHEL 对应关系：`dnf makecache` ≈ update，`dnf install` ≈ install。Arch 的 `pacman -S` 不需要先手动"update"元数据？——需要：`pacman -Sy` 刷新，`pacman -Syu` 刷新+升级，单装前习惯写 `pacman -Sy 包名` 亦可，但最稳妥仍是先 `sudo pacman -Syu` 保证系统一致。

理解"索引 vs 包体"能解释一多半日常困惑：报错 `Unable to locate package` 或 `No match for argument`，先想是不是**只搜了没更索引**（或反过来，索引新了但本地缓存被 `clean` 掉）；磁盘满、下载 404、签名校验失败，则是包体/仓库层问题，和搜索无关。三系在"升级时是否自动刷新元数据"上策略不同——dnf 常带 `--refresh`，pacman 的 `-Syu` 捆绑刷新，apt 刻意拆开——脚本里宁可显式多写一步，也不要在生产上赌隐式行为。

### 2.2 搜索 / 信息 / 文件归属

| 操作 | Debian / Ubuntu | RHEL / CentOS / Rocky | Arch |
|------|-----------------|------------------------|------|
| 按名搜索 | `apt search 关键词` | `dnf search 关键词` | `pacman -Ss 关键词` |
| 查已装 | `apt list --installed` / `dpkg -l 包名` | `dnf list installed` / `rpm -qa` | `pacman -Qs 关键词` |
| 查包信息 | `apt show 包名` | `dnf info 包名` | `pacman -Si 包名`（仓库）/ `-Qi`（本机） |
| 描述含关键词 | `apt-cache search --names-only` 或 `aptitude search` | `dnf search --all` | `pacman -Ss` 已含描述 |
| 某文件属于哪个包 | `dpkg -S /路径` | `rpm -qf /路径` | `pacman -Qo /路径` |
| 包安装了哪些文件 | `dpkg -L 包名` | `rpm -ql 包名` | `pacman -Ql 包名` |
| 包依赖谁 | `apt-cache depends 包名` | `dnf repoquery --requires 包名` | `pacman -Si 包名` 看 Depends |
| 谁依赖了我 | `apt-cache rdepends 包名` | `dnf repoquery --whatrequires 包名` | `pacman -Qii 包名` / `pactree 包名` |

真实示例（`apt-cache`/`dpkg` 与 `pacman -Ss`/`-Qo` 的对应关系）：

```bash
$ apt-cache policy sl
sl:
  Installed: (none)
  Candidate: 5.05-1
  Version table:
     5.05-1 500
        500 http://cn.archive.ubuntu.com/ubuntu noble/universe amd64 Packages

$ apt-cache search --names-only '^sl$'
sl                    5.05-1   universe: Correct the train

$ dpkg -S /usr/bin/vim 2>/dev/null || dpkg -S /etc/vim/vimrc
vim-runtime: /etc/vim/vimrc

$ dpkg -L iproute2 | grep -E '/(ip|ss)$'
/usr/sbin/ip
/usr/sbin/ss

$ pacman -Ss ^vim$ ; pacman -Qo /usr/bin/vim
extra/vim 9.1.1231-1
    Vi Improved, a highly configurable, improved version of the vi editor
/usr/bin/vim is owned by vim 9.1.1231-1
```

`apt-cache policy` 是查"装没装、候选来自哪个源、优先级多少"的最快方式，**不需要 sudo**（读缓存）。对应地，`pacman -Si 包名` 给出仓库来源与依赖，`pacman -Qi` 给出本机已装版本与安装时间；dnf 侧是 `dnf info` 与 `dnf list installed`。"为什么装了命令却找不到"用"文件归属"那一行解决：`dpkg -S` / `rpm -qf` / `pacman -Qo` 直接告诉你二进制提供的包。

`policy` 输出里的数字（如 `500`）是 pin 优先级，不是版本号；100 为已安装基线，>100 会允许升级，`origin` 与 `-1` 常用于锁定。日常不用背完整规则，但要能读懂三行：**Installed 是多少、Candidate 是不是预期版本、Version table 里来源 URL 对不对**。Candidate 长期停在旧版，八成是 pin 住了或该仓库被禁用；Candidate 是 `none` 则根本没候选，回到索引刷新那一列。

搜索类命令还有一个共性：**它们都是"文本匹配"不是"语义搜索"**。`apt search`、`pacman -Ss`、`dnf search` 都按包名+描述子串命中，拼错一个字母就空结果；换近义词、缩写、上游项目名各搜一次，比盯着一个关键词发呆快。三系都支持正则风格（apt 的 `apt-cache search --names-only '^vim'`、pacman 的 `pacman -Ss ^vim$`），脚本里优先用锚定，避免把 `vim-runtime`、`neovim` 一锅端进自动化安装列表。

### 2.3 仓库 / 源 / 缓存 / 锁定

| 操作 | Debian / Ubuntu | RHEL / CentOS / Rocky | Arch |
|------|-----------------|------------------------|------|
| 刷新索引 | `sudo apt update` | `sudo dnf makecache` | `sudo pacman -Sy`（通常合进 `-Syu`） |
| 列已启仓库 | `apt-cache policy` / 看 `/etc/apt/sources.list.d/` | `dnf repolist` / `dnf repolist -a` | `/etc/pacman.conf` 的 `[extra]`/`[community]` 段；`pacman -Sl` |
| 添加第三方源 | `add-apt-repository ppa:user/ppa` 或手写 `.list` | `dnf config-manager --add-repo URL` 或装 `.repo` 文件 | 追加自定义仓库到 `pacman.conf`（签名密钥要导入） |
| 缓存位置 | `/var/cache/apt/archives/` | `/var/cache/dnf/` | `/var/cache/pacman/pkg/` |
| 清缓存 | `sudo apt clean` / `apt autoclean` | `sudo dnf clean all` | `sudo pacman -Sc`（保留已装包）/ `-Scc`（全清） |
| 锁定不升 | `sudo apt-mark hold 包名` | `dnf install 包名-version` 或编辑 `dnf` 的 `exclude=` | `/etc/pacman.conf` 中 `IgnorePkg = 包名` |
| 解除锁定 | `sudo apt-mark unhold 包名` | 移除 `exclude=` 条目 | 删除 `IgnorePkg` 对应项 |
| 查锁定状态 | `apt-mark showhold` | `dnf repoquery --installed \| grep -i exclude`（或看配置） | `grep IgnorePkg /etc/pacman.conf` |

仓库文件与第三方源的形态可以这样区分：APT 的 deb822/.list 行写在 `/etc/apt/sources.list` 与 `sources.list.d/*.list`，形如 `deb http://... noble main restricted universe multiverse`，加 PPA 用 `add-apt-repository ppa:user/ppa`；RHEL 的 `.repo` 写在 `/etc/yum.repos.d/`，用 `dnf config-manager --add-repo` 或装 `epel-release`；Arch 的仓库段写在 `/etc/pacman.conf`（`[extra]` + `Include = /etc/pacman.d/mirrorlist`），锁定内核可写 `IgnorePkg = linux linux-headers`。**改源必改对应管理器的文件，改完立刻刷新索引**，否则会出现"文件改了、policy 里还是旧 URL"。

缓存目录直接对应"离线重装/回滚"能力：APT 的 `.deb`、dnf 的 rpm、pacman 的 `.pkg.tar.zst` 都躺在各自缓存里，**清了缓存不等于卸载已装包**，只影响"能否不联网再装一次"。`pacman -Sc` 与 `apt clean` 都是释放磁盘的标准动作；容器镜像瘦身时三家都会先跑一遍（Arch 用 `-Scc` 更彻底）。锁定策略的哲学不同：Ubuntu 习惯 `apt-mark hold` 逐包锁（`linux-image` 常被锁），RHEL 靠 `exclude=`/模块流控制大版本，Arch 官方不推荐长期 IgnorePkg——滚动发行版里锁太久会在下一次 `pacman -Syu` 时爆发依赖冲突，只能锁关键几天并尽快解锁。

仓库这一列还要区分"官方、发行版衍生、第三方"三层信任。Ubuntu 主仓库与 updates/security 官方维护；PPA 与 RHEL 的 EPEL 属于半官方；AUR 或随手贴的 `.list`/`.repo` 则完全取决于作者。生产基线建议：默认只开官方源，扩展源逐条登记进资产（谁开的、何时开的、下线方式），并用 `apt-cache policy` / `dnf repolist -v` / `pacman.conf` 定期审计是否被人加了意料之外的行——被篡改的软件源是服务器失陷后最常见的持久化手段之一。

## 3. APT 与 dpkg：Debian/Ubuntu

`apt` 是交互式高层前端，`apt-get`/`apt-cache` 是稳定脚本接口（老教程全是它们），`dpkg` 是**底层安装器**——不解析依赖、不访问网络，只管 `.deb` 文件本身。关系可以记成：**apt ≈ dpkg + 依赖求解 + 仓库索引**。日常三条主线：刷新索引用 `apt update`，安装/升级/卸载用 `apt install|full-upgrade|remove|purge`，修依赖与半安装用 `apt install -f`；脚本里把交互式 `apt` 换成 `apt-get -y`（以及 `apt-get update` 分行写），避免提示符卡住 CI。

底层 `dpkg` 只在三种场合出手：装本地 `.deb`（`dpkg -i`）、查状态与归属（`dpkg -l/-S/-L`）、修复被中断的配置（`dpkg --configure -a`）。`apt-cache policy`/`search`/`depends` 则在**不安装**的前提下回答"候选版本、依赖图"——排障时先 policy 后 install 是标准姿势，能挡住九成"装错版本"。`dpkg -l` 状态码值得背两个：`ii` 正常安装，`rc` 已卸载但残留配置，`iU`/`iF` 表示未解包/未配置（半安装），用 `apt install -f` 或 `dpkg --configure -a` 收尾。

**什么时候必须用 dpkg**：安装厂商提供的本地 `.deb`（网卡驱动、闭源客户端）、修复半安装状态、在 `apt` 因索引损坏完全不可用时应急。装完 `.deb` 记得 `apt install -f`，否则依赖缺失会在第一次 `apt upgrade` 时集中爆发。APT 权限注意：`apt` 会自动加 sudo 提示，`apt-get` 不会；cron 脚本里固定用 `apt-get -y`。

分层的心智模型建议这样记：**想知道"仓库里有什么、依赖怎么解" → apt/apt-cache；想动本地文件和状态 → dpkg**。两者数据库是同一套（`/var/lib/dpkg/status`），所以 `dpkg -l` 能看到 apt 装的东西，反之亦然；但只有 apt 懂"从哪下载、版本比较、自动依赖"。手工 `dpkg -i` 后状态码停在 `iU`/`iF` 时，不要反复 `-i` 硬装，应 `sudo apt install -f` 让前端把依赖图补完。版本比较也别用字符串排序：`dpkg --compare-versions 2.10 gt 2.9` 才是包管理器语义。

## 4. DNF/YUM 与 rpm：RHEL 家族

RHEL 8 / CentOS 8 / Rocky / Alma / Fedora 统一到 `dnf`；`yum` 作为命令别名保留（`yum` → dnf 的兼容层），**脚本里新写的都用 dnf**，只有维护 RHEL 7 存量才继续写 `yum`。底层对应 `rpm`，关系与 apt/dpkg 完全同构：**dnf ≈ rpm + 依赖求解 + 仓库**。

`dnf history` 是 RHEL 系独有的安心绳：`dnf history` 看编号，`sudo dnf history undo 42` 可撤销整次事务（涉及多包升级时比手工降级可靠）。命令主线可以概括成与 apt 平行的一组：刷新 `dnf makecache`，安装/升级/卸载 `dnf install|upgrade --refresh|remove`，重装 `dnf reinstall`，查仓库 `dnf repolist`，查信息 `dnf info|search|list installed`，清缓存 `dnf clean all`，回退 `dnf downgrade`。底层 `rpm` 对应 `-ivh`/`-e`/`-qa`/`-qi`/`-ql`/`-qf`/`-V`，职责边界与 dpkg 相同——**依赖与仓库归 dnf，本地文件与校验归 rpm**。

`rpm -V` 输出中 `5`（校验和变化）、`T`（时间戳）、`S`（大小）等标记能快速发现"包声称的文件被人改过"——服务器被入侵排查常用。**什么时候必须用 rpm**：安装 `.rpm` 本地包、在 dnf 源不可用时强制查询（`rpm -qa`）、校验文件完整性。装本地 rpm 后用 `dnf install ./xxx.rpm` 往往比 `rpm -ivh` 更好，因为 dnf 会自动解决依赖。

`rpm -V` 的实战用法值得单独说：对关键包（sshd、sudo、kernel）做一份基线，或在 CI 里定期跑 `rpm -Va | grep -v '^....5'` 过滤已知噪音。输出左侧 8 个字符表示属性（S 大小、M 模式/权限、5 校验和、U 属主、G 组、T 时间、D 设备、L 符号链接），`.` 表示该项一致——**哪一位不是点，哪一项就被动过**。结合 `dnf repoquery --changelog` 能把"是官方补丁还是本机篡改"再推进一层；只看到校验和变化就喊狼来了，容易忽略发行版重新打包带来的正常差异。

RHEL 家族还常碰**模块流**（AppStream 的 `module enable`）：同一仓库里 mysql 8.0/8.4 并存时，`dnf module list mysql` 看可用流，`sudo dnf module enable mysql:8.4` 再安装——这是 Debian/Arch 没有的维度，跨版本迁移脚本时别照抄 `apt install`。

dnf 相对老 `yum` 的实际差异，运维时主要体现在三点：依赖求解与模块流是 dnf 独有能力；`dnf history` 的事务粒度比 yum 更完整，回滚更可信；错误信息带 `hint`，能提示缺哪个 repo。脚本兼容策略是**统一写 dnf**，仅在必须支持 RHEL 7 的分支里保留 `yum`。与 apt 对照时注意：`dnf install` 默认就会 `makecache` 类的元数据处理，但仍建议显式 `dnf makecache` 或 `upgrade --refresh`，在网络极差的环境里把"刷新"和"下载包体"拆成两步，失败时更好定位。

## 5. pacman：Arch 家族速查

Arch 只有一个官方包管理器 **`pacman`**，没有 dpkg 对应物（它直接解包+跑 hook），也没有 `apt update` 与 `apt install` 的分离仪式——元数据刷新与升级高度耦合。`pacman` 参数是**四个动词开关的组合**，这是它的第一难点：

| 开关 | 动词 | 用途 | 典型组合 |
|------|------|------|----------|
| `-S` | Sync | 从仓库安装/升级 | `-S 包名`、`-Syu`、`-Ss 关键词` |
| `-R` | Remove | 卸载 | `-R 包名`、`-Rns 包名` |
| `-Q` | Query | 查本机数据库 | `-Qs`、`-Qi`、`-Ql`、`-Qo` |
| `-U` | Upgrade | 装本地包文件 | `pacman -U ./pkg.pkg.tar.zst` |

组合示例（务必看清大小写）可以背成一条主干加四组后缀：主干是 `sudo pacman -S/-R/-Q/-U`，`-S` 后可叠 `y`（刷新索引）、`u`（升级）、`s`（搜索，且是小写 `-s`）、`yy`（强制重刷）；`-R` 后常叠 `n`（删配置）与 `s`（清依赖）得 `-Rns`；`-Q` 后叠 `s/i/l/o/d/m` 分别是搜索、详情、列文件、归属、孤儿、外来包。装本地文件用 `-U ./包名.pkg.tar.zst`，按文件名找包用 `pacman-contrib` 的 `pacman -Fy` 与 `pacman -F 关键词`。日常高频就五句：`pacman -S 包名`、`sudo pacman -Syu`、`pacman -Ss 关键词`、`pacman -Qs 关键词`、`sudo pacman -Rns 包名`。

`pacman -Syu` 升级时偶尔出现 `:: Proceed with installation? [Y/n]` 与 hook 输出（`mkinitcpio`、`ldconfig`），属正常；若出现 `error: failed to commit transaction (conflicting files)`，先看冲突路径，**不要**习惯性 `pacman -Syu --overwrite '*'`——那是排雷，不是解法。Arch 官方反对长期只升单包（partial upgrade）：`pacman -S 仅某包` 在依赖已前进的系统上可能链接失败，正确姿势是任何时候都 `-Syu`。

配置文件三处要认得：`/etc/pacman.conf` 管仓库开关、`IgnorePkg` 锁定与 `ParallelDownloads`；`/etc/pacman.d/mirrorlist` 管镜像顺序（快的放最上）；`/var/log/pacman.log` 记录每一次 installed/upgraded/removed，是回溯"谁动了这个包"的第一现场。排障时先 `grep` 日志里包名与时间戳，再对比测试机同版本行为，比盯着报错空想快得多。`pacman -Q --explicit` 列**手动安装**的包（系统依赖不算），是精简系统、生成个人包清单的起点；`pacman -Qtdq`（或 `pacman -Qdtq`）列孤儿依赖，接上总表里的 `| sudo pacman -Rns -` 即可安全清理。首次在 Arch 上手工装 AUR 包前，先 `sudo pacman -S --needed base-devel git`，AUR 流程见下一节——**AUR 不是 pacman 的一部分，pacman 也不认识 `yay`/`paru` 之外的任何 AUR 帮手**（yay/paru 自身也是包，要用 pacman 先装上）。

把 `pacman` 当日常唯一入口时，还有三件小事能少踩坑：升级前看 `/etc/pacman.conf` 有没有被注释掉的 `[extra]`/`[multilib]`（少一个仓库会让 `pacman -Ss` "凭空"搜不到）；镜像慢先改 `mirrorlist` 首位，而不是反复 `pacman -Syyu` 硬刷；冲突报错读完 `conflicting files` 再决定是本包本地改过（`pacman -Qkk 包名`）还是真 bug。Arch 官方论坛与 Wiki 几乎都能用 `pacman -Ss` 里的确切包名搜索到安装说明——**先确认包名在官方库，再考虑 AUR**，这条顺序在生产上尤其重要。

## 6. 仓库生态：PPA、EPEL、AUR

三系的"官方仓库之外"机制完全不同，信任级别也不同：**官方仓库 > 发行版官方认可的扩展源 > 用户社区构建（AUR）**。扩展源越"野"，越要在生产上收紧。

### 6.1 PPA（Ubuntu）

Personal Package Archive，Launchpad 托管，绑定 Ubuntu 版本号。流程是：装 `software-properties-common`，`add-apt-repository ppa:deadsnakes/ppa`，`apt update` 后 `apt install` 目标包；手工等价是往 `sources.list.d` 写一行 `deb https://ppa.launchpadcontent.net/... noble main`，移除用 `add-apt-repository --remove`。

注意 PPA 只覆盖 Ubuntu（及衍生），Debian 上不通用；第三方 PPA 等于把仓库的**任意 root 级安装脚本**信任给作者，生产服务器尽量少加。密钥由 `apt update` 时自动导入 `trusted.gpg.d`。

### 6.2 EPEL / CRB（RHEL 系）

Extra Packages for Enterprise Linux，Fedora 社区为 RHEL/CentOS/Rocky 构建，**官方文档明确推荐**，但仍是外置仓库：

```bash
# Rocky/Alma/RHEL（版本号按系统改）
sudo dnf install epel-release
# RHEL 8/9 里 extras 仓库可能改名 CRB（CodeReady Builder）
sudo dnf config-manager --set-enabled crb
sudo dnf repolist | grep -i epel
sudo dnf install htop
```

启用后 `dnf repolist` 应多出 `epel` 一行。EPEL 包与 RHEL 核心包**版本策略不同**（EPEL 常更新），个别包（如 ` nano ` 某些版本）曾出现与 base 冲突的先例，出问题先 `dnf repolist -v` 看包来源再处理。

### 6.3 AUR（Arch User Repository）

**AUR 不是二进制仓库**：里面是用户维护的 `PKGBUILD` 脚本，`pacman` 无法直接安装，需要 `yay`、`paru` 等 helper 先用 `makepkg` 构建再交给 `pacman -U`。一次性 bootstrap：`sudo pacman -S --needed base-devel git`，再 `git clone https://aur.archlinux.org/yay.git && cd yay && makepkg -si`（`-s` 用 pacman 补依赖，`-i` 装进系统）。日常改用 `yay -S 包名`、`paru -Syu --aur`、`yay -Qm` 列外来包、`yay -Sc` 清构建缓存。

信任边界必须清楚：**PKGBUILD 是任意 shell**，装 AUR 包等于运行陌生人的脚本，先 `less PKGBUILD` 看 `source`、`prepare()`、`build()`，官方仓库里没有的东西要自己背书。`yay -Qm`（或 `pacman -Qm`，`m` = foreign/非官方仓库）是审计清单：陌生二进制是否混进系统，一跑便知。生产服务器的原则：**能用官方库就绝不上 AUR**；必须用时锁定版本、记录 `pacman.log`，升级前先在测试机跑 `pacman -Syu` 全链路。

对比另外两系，信任模型其实是连续的：Ubuntu 的 PPA 和 RHEL 的 EPEL 至少有发行版或社区背书、有构建农场；AUR 则是"用户上传配方、你本地构建"，**没有统一的二进制审核**。因此同样叫"第三方源"，风险并不等价。三条上生产线前的自查：包是否只在 AUR 有（官方库有的话用 `pacman -S 包名`/`apt install`/`dnf install`）；构建过程是否只拉声明过的 `source`（无奇怪的 curl|sh）；卸载与升级路径是否可控（`pacman -Qm` 能看见、能 `-Rns` 走）。做不到这三条，就在测试机或开发机用，别进生产。

## 7. 常见坑

常见坑按生命周期记比按命令记更牢：**装之前、升级时、升级后、清理时**。装之前最常见的是选错前端与搜错仓库；升级时最常见的是部分升级与混合自动任务；升级后最常见的是不看日志、不验依赖；清理时最常见的是把缓存清没了还指望离线回滚。

**装之前**：先 `command -v` 认家族，再 `policy`/`-Si`/`info` 看候选与仓库，最后才 `install`。跳过中间两步，你会在"装了个名字很像的包"或"从意料之外的第三方源拉了更高版本"之后花双倍时间返工。

**升级时**：规划窗口、锁住不该动的包、选一个自动任务作为唯一事实来源。跨大版本（Ubuntu `do-release-upgrade`、RHEL `dnf distro-sync`、Arch 滚动）前，在测试机完整演练一遍，并备份包管理器数据库与关键配置目录——回滚能力不来自命令的某个魔法参数，来自你有没有可恢复的状态。

**升级后**：读日志（apt/dnf history/pacman.log），跑关键服务冒烟，确认 `ii`/已装状态没有大面积回退到 `rc`/孤儿。数据库、内核、语言运行时三类升级最容易引发连锁反应，分别验证一次。

**清理时**：缓存与已装列表是两回事；`-Scc`、`apt clean` 只影响"不联网还能不能装"，`autoremove`/`-Rns` 才动依赖图。清理命令也建议先 `--dry-run` 或先看列表再确认，尤其在多业务共用的宿主机上。

按现象反查：提示找不到包 → 索引没刷或仓库没开；提示依赖冲突/半安装 → 下沉 dpkg/rpm 修状态，再让前端 `-f`/`reinstall` 收尾；升级到一半断网 → 能续传就续传，不能就从 `history`/`pacman.log` 定位事务边界，不要手工删 `/var/lib` 里的半个包；AUR/helper 构建失败 → 先读 PKGBUILD 与错误里第一个缺失依赖，不要连叠 `--overwrite`/`--noconfirm`。

1. **在错误的发行版上敲习惯命令**。`apt install` vs `dnf install` vs `sudo pacman -S` 不可混用；写自动化脚本先 `command -v` 探测。
2. **只 `apt update` 不 `upgrade`，或只升一个包**。update 只是索引；Debian 允许单包升级但会滞后，**Arch 严禁部分升级**，必须 `pacman -Syu` 整体前进。
3. **用 `pacman -R` 却期待清配置**。配置文件默认保留，用 `-Rns`；孤儿依赖另用 `-Qdtq` 管道清理，别一刀切 `-Rns $(pacman -Qdtq)` 不看清单。
4. **`dpkg -i` 装完就走**。本地 `.deb` 依赖未满足会留下半安装，紧接着 `sudo apt install -f`；`dpkg -l` 里出现非 `ii` 状态同理。
5. **把 AUR 当官方仓库用**。`pacman` 永远不会搜到 AUR；helper 构建失败时先看 `PKGBUILD` 与依赖，不要连点 `--noconfirm` 盲装。
6. **清缓存后以为能离线重装**。`apt clean`/`dnf clean all`/`pacman -Sc` 删的是下载包副本，要保留离线能力就别 `pacman -Scc`。
7. **忘记锁内核/关键包**。Ubuntu `apt-mark hold linux-image-...`，Arch `IgnorePkg = linux linux-headers`，RHEL `exclude=kernel*`——升级窗口之外先把命脉锁住，用完 `showhold`/配置复核再解锁。
8. **在容器里执行交互式 apt**。设 `DEBIAN_FRONTEND=noninteractive apt-get install -y`，避免 configure 提示卡死 CI；dnf/pacman 同样加 `-y`/`--noconfirm`。
9. **混用 `yum` 与 `dnf` 事务**。RHEL 8+ 实际都是 dnf，但两套缓存/历史并存时可能困惑，团队统一写 `dnf`。
10. **升级后不看日志**。APT 在 `/var/log/apt/term.log`，dnf 用 `dnf history`，Arch 必查 `/var/log/pacman.log`——出问题第一分钟就能定位是哪次事务。
11. **把"搜索结果"当"可安装"**。`apt search` 会命中描述关键词里的噪音包，`pacman -Ss` 同理；装之前用 `policy`/`-Si`/`info` 确认包名、仓库、候选版本，再动手。
12. **多机运维用同一套升级命令却装了不同前端**。同一台机器永远只认一个"事实来源"：要么 cron 跑 `unattended-upgrades`，要么人工 `apt`，要么 `dnf automatic`，要么定时 `pacman -Syu`——两套自动升级并存必然在锁文件和回滚日志上打架。

## 8. 选择建议与纪律

三系没有"谁更先进"的绝对答案，只有**运维模型与人才池**的匹配：追求稳定补丁节奏与商业支持，Debian/Ubuntu LTS 或 RHEL 系更合适；愿意接受滚动、喜欢软件常新且能自己修包，Arch 的 `pacman` 心智负担其实很低；企业存量里两系并存是常态，真正危险的不是并存，而是**脚本作者只熟一家，却在另一家上硬套**。

给个人与团队的最小纪律（背下来比背 100 条命令有用）：一，**一个系统一个前端**，升级窗口唯一；二，**装前 policy/info，删前看清单**；三，**锁关键包，升级后读日志**；四，**第三方源必须登记与可回滚**；五，**能写进配置文件的不要只留在 shell history**。命令会变、发行版会换代，这五条在 apt/dnf/pacman 上都能原样套用。

若你要维护跨发行版自动化，建议把差异收敛在**一个探测函数 + 三个适配器**里：函数用 `command -v` 判断家族，适配器分别映射 install/upgrade/search/remove 四个动词，其余逻辑共享。不要在业务代码里到处 `if ubuntu`——包管理差异是基础设施层的问题，应该在入口处翻译完。测试矩阵至少覆盖三系的最小安装镜像，否则你的 `pacman -Syu` 分支永远只在文档里存在。

## 参考资料

- `man apt`, `man apt-get`, `man dpkg`, `man dnf`, `man rpm`, `man pacman`
- 鸟哥的私房菜 - 软件包管理 — [linux.vbird.org](https://linux.vbird.org/linux_basic/0510source_manager.php)
- Arch Wiki - pacman — [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- Arch Wiki - AUR — [wiki.archlinux.org](https://wiki.archlinux.org/title/Arch_User_Repository)
- Debian Wiki - apt — [wiki.debian.org](https://wiki.debian.org/Apt)
- Ubuntu - PPA / repositories 文档 — [documentation.ubuntu.com](https://documentation.ubuntu.com/ubuntu/howto/manageing-software/)
- DNF 文档（Fedora） — [dnf.readthedocs.io](https://dnf.readthedocs.io/)
- Red Hat - Installing software packages with DNF — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/installing_managing_software_with_the_dnf_tool/index)
- EPEL FAQ — [docs.fedoraproject.org](https://docs.fedoraproject.org/en-US/epel/faq)
