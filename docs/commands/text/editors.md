# 文本编辑和查看工具

在 Linux 系统管理中，几乎每次改配置、看日志都离不开文本编辑与查看工具。编辑器负责"改"，查看器负责"读"：前者以 Vim/nano 为代表，后者以 less/head/tail/cat 为代表。选错工具——例如用 `cat` 直接灌一个几 GB 的日志——会把终端卡住；用错 Vim 模式——在插入模式里敲 `:q`——则会连退出都困难。本页按"先装什么 → 怎么编辑 → 怎么查看 → 实战与对比"组织，示例输出来自真实 Ubuntu 26.04 环境。

> 编辑器在各发行版**默认未必安装**，安装方式见第 1.1 节；`cat`/`less`/`more`/`head`/`tail` 来自 coreutils/less，一般开箱即用。

## 学习目标

- 明确各发行版默认编辑器与安装方法（含 Arch `pacman` 包名）
- 掌握 Vim 模式切换、移动、编辑、搜索替换与常用配置
- 会用 nano 快速编辑，用 less/cat/head/tail 高效查看
- 了解 `vi`/`editor` 替代名机制与实战场景

## 1. Vim 编辑器

### 1.1 Vim 是什么、怎么装

Vim（Vi IMproved）是 vi 的增强版，模式化编辑、搜索替换、宏与插件生态成熟，是服务器上事实标准的终端编辑器。它不是图形程序，却能完成从改一行配置到批量重构脚本的大部分工作。

```bash
# Debian/Ubuntu: sudo apt install vim
# RHEL/CentOS/Rocky: sudo dnf install vim
# Arch Linux（官方 extra 仓库）: sudo pacman -S vim
vim --version | head -1
VIM - Vi IMproved 9.1 (2024 Jan 02, compiled Aug 24 2026 22:11:12)
```

**Arch 包名说明（重要）**：

| 包名 | 仓库 | 说明 |
|------|------|------|
| `vim` | extra | 完整版 Vim，最常用；`sudo pacman -S vim` |
| `neovim` | extra | Neovim，Vim 的现代分支，配置文件多为 `~/.config/nvim/` |
| `nano` | extra | 简单编辑器 |
| `ex-vi-compat` | extra | 提供 POSIX `vi`/`ex` 兼容入口，可 `provides vi`，适合只要最小 vi 的场景 |
| `base` | — | 元包，**不包含** vim/nano；新装系统需自行选装编辑器 |

注意：官方仓库中**不存在**名为 `vim-neovim` 的包；请使用上表真实包名。`pacman -Ss vim` 可搜索。另：AUR 有 [neovim-symlinks](https://aur.archlinux.org/packages/neovim-symlinks) 可把 `vi`/`vim` 软链到 `nvim`（非官方仓库包，自行评估）。详见 [Arch Wiki - Vim](https://wiki.archlinux.org/title/Vim)、[Arch Wiki - Neovim](https://wiki.archlinux.org/title/Neovim)、[Arch Wiki - Pacman](https://wiki.archlinux.org/title/Pacman)、[archlinux.org vim 包页](https://archlinux.org/packages/extra/x86_64/vim/)、[neovim 包页](https://archlinux.org/packages/extra/x86_64/neovim/)、[ex-vi-compat 包页](https://archlinux.org/packages/extra/x86_64/ex-vi-compat/)。

### 1.2 四种模式

Vim 的一切别扭感都来自模式。进入时默认是**普通模式**，键盘按键是命令而不是字符。

| 模式 | 进入方式 | 用途 |
|------|----------|------|
| 普通 Normal | `Esc`（随时回这里） | 移动、删除、复制、粘贴 |
| 插入 Insert | `i` `I` `a` `A` `o` `O` | 输入文本 |
| 命令行 Command | `:` | 保存、退出、替换、行号跳转 |
| 可视 Visual | `v` `V` `Ctrl+v` | 选择字符/行/块再操作 |

**最常见的坑**：在插入模式里找不到 `:wq`——按 `Esc` 回普通模式再敲冒号。不确定自己在哪个模式时，连按几次 `Esc` 永远是安全的。

### 1.3 启动、保存、退出

```bash
vim file.txt              # 打开；vim +10 跳到第 10 行；vim +/pat 先搜索
vim file1.txt file2.txt   # 同时打开多个文件
:w 保存  :q 退出（有未保存修改拒绝）  :wq 保存并退出  :q! 不保存强制退出
:x 有改动才保存后退出   ZZ 普通模式保存退出   ZQ 普通模式不保存退出
```

只读配置若提示 `E45: 'readonly' option is set`，要么改权限（`chmod`/`sudo`），要么明确 `:w!`——不要养成无脑覆盖只读文件的习惯。

### 1.4 光标移动

```text
h j k l 左下上右  w b e 下/上词首·词尾  0 ^ $ 行首·首非空·行尾
{ } 上/下一段  H M L 屏顶·中·底  gg G 文件头/尾  10G 或 :10 跳行
Ctrl+d / Ctrl+u 半页下/上
```

比鼠标更快的秘密是组合：`d` + 移动 = 删除该范围，`y` + 移动 = 复制该范围，`c` + 移动 = 删除并进入插入。

### 1.5 编辑操作

```text
i I a A o O  进入插入：光标前/行首/光标后/行尾/下方新行/上方新行
x X dd D d0 dw db dG  删字符/前行/整行/到尾/到首/到词/到文末（可配移动）
yy yw y$ p P  复制行·词·到尾；光标后/前粘贴
u Ctrl+r U  撤销/重做/撤销本行最近改动
r R s S cw C  替字符·替换模式·删字符进插入·改到词尾/行尾
```

### 1.6 搜索与替换

```text
/pattern ?pattern  向下/向上搜索  n N 下/上一个  * 搜光标下单词
:s/old/new/ 当前行首次  :s/old/new/g 当前行全部  :%s/…/g 全文
:%s/…/gc 全文逐个确认  :10,20s/…/g 第 10–20 行
```

替换前先 `/old` 确认能命中，再 `%s`；生产配置务必 `cp` 备份或 `vim -p` 开两个窗口对照。

### 1.7 多文件与分屏

```text
:next :prev / :ls / :b2 :bn :bp :bd  文件与缓冲区切换
:split (Ctrl+w s) 水平分屏  :vsplit (Ctrl+w v) 垂直分屏
Ctrl+w h/j/k/l 窗格间移动   Ctrl+w = 均分大小
```

### 1.8 宏与可视块

```text
qa ... q  录制宏到寄存器 a，q 停止  @a @@ 执行/重复
v V Ctrl+v  字符/行/块选择；块选后 I…Esc 行首插、A…Esc 行尾追
```

批量给多行加注释：`Ctrl+v` 选行首列 → `I#` → `Esc`，是改配置时的高频技巧。

### 1.9 基本配置（`~/.vimrc`）

```vim
set number
set relativenumber
set tabstop=4 shiftwidth=4 expandtab
set autoindent smartindent
set hlsearch incsearch ignorecase smartcase
set showmatch
set wrap linebreak
set encoding=utf-8 fileencoding=utf-8
set mouse=a
syntax on
filetype plugin indent on
```

首次使用可 `vimtutor`（随 vim 包提供）约 30 分钟过一遍移动与退出，收益高于直接背快捷键表。更多见 [vim.rtorr.com](https://vim.rtorr.com/) 与 [Vim 官方文档](https://www.vim.org/docs.php)。

## 2. Neovim 简述

Neovim 与 Vim 命令高度兼容，差异主要在：默认配置路径 `~/.config/nvim/init.lua`、更激进的 Lua 配置生态、内置终端体验改进。若团队已用 Neovim，日常 `dd`/`:w`/`/` 搜索几乎可以平移。安装见第 1.1 节（Arch 为 `pacman -S neovim`）。本演示环境未安装 `nvim`，故无版本输出。

## 3. nano 编辑器

### 3.1 适合谁、怎么用

nano 键位提示常驻屏幕底部，适合只想改几行、不想学模式的场景；很多发行版把它设为 `editor` 替代名的默认实现。

```bash
# 安装（若未预装）: apt/dnf/pacman install nano
nano file.txt
nano +10 file.txt            # 打开并跳到第 10 行
# GNU nano 8.7.1 —— 底部常驻键位提示
Ctrl+O 保存  Ctrl+X 退出  Ctrl+K 剪切  Ctrl+U 粘贴  Ctrl+W 搜索
Ctrl+\ 替换  Ctrl+G 帮助  Alt+U 撤销  Alt+E 重做
```

### 3.2 配置（`~/.nanorc`）

常用项：`set tabsize 4`、`set autoindent`、`set linenumbers`、`set smarthome`、`set mouse`——与 Vim 的 `~/.vimrc` 同属"一次配置、处处受益"的个人基线，放进 dotfiles 仓库即可在新机器秒恢复。

命令行敲的 `vi`、`editor` 往往不是某个固定二进制，而是经 **alternatives / 替代名** 指向当前实现。在 Debian/Ubuntu 上查看：

```bash
update-alternatives --display vi && update-alternatives --display editor
# vi - auto mode → /usr/bin/vim.basic   editor - auto mode → /bin/nano
readlink -f "$(which vi)" "$(which editor)"
/usr/bin/vim.basic
/bin/nano
dpkg -l | grep -E 'vim|nano' | awk '{print $1,$2,$3}'
ii nano 8.7.1-1ubuntu0.1
ii vim 2:9.1.2141-1ubuntu4.9
```

RHEL/CentOS/Rocky 常见包：`vim-minimal`（提供基础 `vi`）、`vim-enhanced`（完整 `vim`）、`neovim`（多在 EPEL）、`nano`。Arch 见第 1.1 节表；`pacman -Qs 'vim|nano'` 可查询已装包。脚本中若依赖"存在 vi"，请写 `command -v vi` 判断，不要写死 `/usr/bin/vim`。

## 4. cat - 整文件查看与合并

```bash
cat file.txt / cat -n / -b / -s / -A   # 原样 / 行号 / 仅非空编号 / 压空行 / 显示 ^I 与 $
cat file1.txt file2.txt > combined.txt # 拼接合并
# cat -A 实测: ^I=Tab，行尾 $
server {$
^Ilisten 80;$
}$
cat > notes.txt << 'EOF'               # 创建并写入
line one
EOF
cat >> notes.txt << 'EOF'              # 追加
line three
EOF
```

**坑**：`cat 大文件 | less` 没问题，但 `cat 大文件 | grep foo` 时 `cat` 是多余的一跳，直接 `grep foo 大文件` 更省；对超大文件 `cat` 全量进管道还可能造成内存尖峰。`cat` 的本职是"拼接"，查看请按下面选型。

## 5. less - 分页查看（首选）

less 支持前后翻页、搜索、跳转，退出只占一个 `q`，是大文件与管道的默认选择。

```bash
less file.txt / less +10 / less +/pat   # 打开并跳行/搜索
dmesg | less / less -N / less -i         # 管道、行号、忽略大小写
# less 668 (GNU regular expressions)
# 键位: Space·f 下页  b 上页  j·k 行  g·G 头尾  10G 跳行  /·? 搜索  q 退出  h 帮助
```

**坑**：`less` 在管道中会全量缓冲输入再进入界面（取决于实现与 `--no-init` 等选项），对"边生成边看"的超长实时流，优先 `tail -f` 或 `journalctl -f`。

## 6. more - 只能向前的简单分页

more 只能向后翻，功能弱于 less，但依赖简单、在某些最小环境仍存在。适合"看前几屏就退出"的场景。

```bash
more file.txt / more +10 file.txt
# Space·Enter 下页/行  b 向上（部分实现）  q 退出  /pattern 搜索
# more from util-linux 2.41.3
```

新脚本与文档优先推荐 `less`；交互教学可按"more 会用即可，less 必须会"掌握。

## 7. head / tail - 首尾与实时日志

```bash
head file.txt / head -n 20 / head -c 100    # 默认 10 行 / 指定行数 / 前 100 字节
tail file.txt / tail -n 20 / tail -c 100    # 默认最后 10 行
tail -f /var/log/syslog    # 实时追加
tail -F /var/log/app.log   # 轮转后自动重新打开
tail -n +18 file.txt       # 从第 18 行到结束
# 日志排查组合拳
tail -100 app.log
grep -i error app.log | tail -50
less +G app.log            # 直接跳到末尾再搜索
```

**坑**：

- RHEL/CentOS/Rocky 常见是 `/var/log/messages`，Debian/Ubuntu 是 `/var/log/syslog`；systemd 系可优先 `journalctl -u 服务名 -f`。
- `tail -f` 遇到日志轮转（logrotate）可能停在旧 inode 上，用 `-F` 或配合 `copytruncate`/`create` 策略。
- `-n` 与 `-c` 语义不同：行 vs 字节；二进制/无换行文件只能靠 `-c`。

## 8. 实战案例

### 8.1 编辑配置并校验

```bash
sudo cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak
sudo vim /etc/nginx/nginx.conf
nginx -t                      # 改前改后都可测语法
sudo systemctl reload nginx
diff -u /etc/nginx/nginx.conf.bak /etc/nginx/nginx.conf
```

SSH 配置、sysctl 同理：**备份 → 编辑 → 语法检查 → 灰度生效 → diff 留档**。忘 `nginx -t`/`sshd -t` 是回滚的主要原因。

### 8.2 日志定位错误

```bash
grep -n -i "error" /var/log/syslog | tail -20
less +/error /var/log/nginx/error.log
tail -f /var/log/nginx/access.log
```

`grep -n` 保留行号后，可 `vim +412 app.log` 直接跳到那一行上下文。

### 8.3 无图形界面时的最小闭环

只剩 SSH、不知系统装了什么编辑器时：

```bash
command -v nano && nano file || command -v vim && vim file || vi file
```

或先 `pacman -Qs 'vim|nano'` / `dpkg -l | grep -E 'vim|nano'` 看现状，再安装。Arch 最小系统请记得 `pacman -S vim` 或 `pacman -S nano`，不要假设编辑器一定在 `base` 里。

## 9. 工具对比与选型

| 工具 | 定位 | 何时用 | 不要用于 |
|------|------|--------|----------|
| Vim | 模式化全功能编辑 | 长期改配置、脚本、批量操作 | 从未学过却要在 10 秒内改生产文件（改用 nano 或先 `vimtutor`） |
| nano | 简单编辑 | 快速改几行、教学 | 需要宏/分屏/大范围重构时 |
| less | 分页查看 | 大文件、管道、来回翻 | 需要修改文件时（用编辑器） |
| more | 简单向前分页 | 只看开头数屏 | 大文件深度搜索 |
| cat | 拼接/小文件直出 | 合并多文件、`cat` 进管道 | 超大文件查看 |
| head/tail | 首尾与实时 | 日志、截取片段 | 需要文件中部随机跳转（less 更好） |

**经验法则**：不确定多大就 `less`；只看头尾就 `head`/`tail`；要改就 `vim`（或你会用的编辑器）；要改多处先备份再 `vim`/`sed -i.bak`。

## 10. 常见坑速查

| 现象 | 原因 | 处理 |
|------|------|------|
| Vim 里按键"没反应/乱删" | 在插入模式当普通模式用，或反之 | `Esc` 回普通模式看底部模式指示 |
| `:q` 报错无法退出 | 有未保存修改 | `:wq` 或 `:q!` |
| 只读文件保存失败 | 权限或 `readonly` | `sudo` 重开或明确 `:w!` |
| `cat 大文件` 卡住终端 | 一次性灌入整个文件 | 改用 `less`/`head`/`tail` |
| `tail -f` 日志不动 | 路径不对/已轮转/无新写入 | 确认路径，改用 `-F` 或 `journalctl -f` |
| 系统里没有 vim/nano | 最小化安装未含编辑器 | `apt/dnf/pacman -S vim` 或 `nano` |
| 脚本里 `vi` 行为奇怪 | 替代名指向不同实现 | `readlink -f $(which vi)` 确认 |
| `cat -A` 一堆 `^I`/`$` | 正是 Tab 与行尾 | 用于排格式问题，不是乱码 |

## 11. 三发行版差异说明

| 项目 | Debian/Ubuntu | RHEL/CentOS/Rocky | Arch |
|------|---------------|-------------------|------|
| 完整 Vim 包名 | `vim` | `vim-enhanced` | `vim`（extra） |
| 精简 vi | `vim-tiny` | `vim-minimal` | `ex-vi-compat` 等 |
| nano | `nano` | `nano` | `nano` |
| Neovim | `neovim` | `neovim`（常需 EPEL） | `neovim` |
| 安装命令示例 | `sudo apt install vim` | `sudo dnf install vim-enhanced` | `sudo pacman -S vim` |
| `editor` 默认常见指向 | nano | nano（视最小化） | 需自行安装并配置 |
| 默认日志查看路径示例 | `/var/log/syslog` | `/var/log/messages` | `journalctl` 优先 |

## 参考资料

- `man vim`, `man nano`, `man cat`, `man less`, `man more`, `man head`, `man tail`
- man vim (Arch) — [man.archlinux.org](https://man.archlinux.org/man/vim.1.en)
- man nano — [man.archlinux.org](https://man.archlinux.org/man/nano.1.en)
- man less — [man.archlinux.org](https://man.archlinux.org/man/less.1.en)
- man more — [man.archlinux.org](https://man.archlinux.org/man/more.1.en)
- man cat — [man.archlinux.org](https://man.archlinux.org/man/cat.1.en)
- man head — [man.archlinux.org](https://man.archlinux.org/man/head.1.en)
- man tail — [man.archlinux.org](https://man.archlinux.org/man/tail.1.en)
- Vim 手册 — [vim.org](https://www.vim.org/docs.php)
- Vim 快捷键 cheatsheet — [vim.rtorr.com](https://vim.rtorr.com/)
- Arch Wiki - Vim — [wiki.archlinux.org](https://wiki.archlinux.org/title/Vim)
- Arch Wiki - Neovim — [wiki.archlinux.org](https://wiki.archlinux.org/title/Neovim)
- Arch Wiki - Pacman — [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- Arch Wiki - Base meta package — [wiki.archlinux.org](https://wiki.archlinux.org/title/Base_meta_package)
- Nano 官方文档 — [nano-editor.org](https://www.nano-editor.org/docs.php)
- archlinux.org: vim — [archlinux.org](https://archlinux.org/packages/extra/x86_64/vim/)
- neovim — [archlinux.org](https://archlinux.org/packages/extra/x86_64/neovim/)
- ex-vi-compat — [archlinux.org](https://archlinux.org/packages/extra/x86_64/ex-vi-compat/)
- Debian 手册 — [debian.org](https://www.debian.org/doc/manuals/debian-handbook/)
- Rocky Linux 文档 — [docs.rockylinux.org](https://docs.rockylinux.org/)
- Red Hat 文档 — [access.redhat.com](https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/)
- 鸟哥的私房菜 - 文件与目录管理 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0220filemanager.php)
