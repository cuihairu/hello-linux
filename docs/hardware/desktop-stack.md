# 桌面图形栈

从内核里的显卡驱动到屏幕上的一颗像素，中间隔着五层软件：任何一层缺席或断裂，屏幕就是黑的。服务器最小化安装后没有桌面，缺的就是这一整条链——本章沿"图形硬件 → 显示栈"的顺序把它拆开讲清，让你在"装不上、起不来、花屏、没字体"这些经典现场知道每一层该看哪里。

> 内容参考自 Arch Wiki 图形相关条目与 freedesktop/Wayland 文档，见文末参考资料。

## 学习目标

- 能画出从 GPU 到像素的分层链路，并说出每层在 Linux 里的观察入口
- 理解 Xorg 与 Wayland 的架构与安全模型差异，知道 XWayland 兼容层承担什么
- 分清显示管理器、窗口管理器、桌面环境三个常被混用的角色
- 能为一块显卡在开源驱动与专有驱动之间做取舍，并解释 linux-firmware 与 DKMS 在内核升级后的作用
- 能在三大发行版家族上用元包/组装出最小可用的图形会话
- 能对"服务器要不要装桌面"给出有依据的判断，并说出替代方案

## 1. 分层链路：GPU 到像素要过几层

服务器版安装通常只覆盖到第 2 层：内核带 DRM/KMS 与开源驱动（否则连控制台分辨率都靠固件兜底），但没有第 3 层以上的任何东西。桌面发行版则五层全备。

```text
┌──────────────────────────────────────────────────┐
│ 5 应用层    Firefox、终端模拟器、编辑器            │
│            （经 GTK/Qt 工具包绘制控件与文字）      │
├──────────────────────────────────────────────────┤
│ 4 会话层    桌面环境：GNOME / KDE Plasma / XFCE   │
│            或独立窗口管理器：i3 / sway             │
├──────────────────────────────────────────────────┤
│ 3 显示服务器 Xorg 或 Wayland 合成器               │
│            （Wayland 下经 XWayland 兼容 X11 应用） │
├──────────────────────────────────────────────────┤
│ 2 内核图形   DRM/KMS 子系统 + 显卡驱动            │
│            i915 / amdgpu / nouveau / nvidia      │
├──────────────────────────────────────────────────┤
│ 1 硬件      GPU · 显存 · 显示器 · 键鼠输入        │
└──────────────────────────────────────────────────┘
```

每一层都有对应的观察入口，排障时自下而上逐层确认：

| 层 | 组件 | 职责 | 观察入口 |
|----|------|------|----------|
| 硬件 | GPU、显示器、输入设备 | 渲染与显示的物理基础 | `lspci -tv` |
| 内核图形 | DRM/KMS + 驱动 | 模式设置、显存管理、命令提交 | `lspci -k`、`dmesg` |
| 显示服务器 | Xorg / Wayland 合成器 | 接管输入输出，分配窗口表面 | `echo $XDG_SESSION_TYPE` |
| 会话层 | 桌面环境或窗口管理器 | 面板、托盘、快捷键、窗口策略 | `echo $DESKTOP_SESSION` |
| 应用 | GTK/Qt 应用、xdg-desktop-portal | 绘制界面，经门户请求截图/文件等能力 | `ldd $(which 应用)` |

`lspci -k` 里 GPU 条目是否出现 `Kernel driver in use`，对应[计算机体系结构](./architecture.md)第 3 节讲的"驱动绑没绑"——图形栈排障的起步动作与查网卡完全相同。

```bash
lspci -k | grep -A3 -i vga          # GPU 型号与已绑定的驱动
dmesg | grep -i drm | head -5       # DRM 子系统的初始化记录
echo "$XDG_SESSION_TYPE"            # x11 / wayland / tty
echo "$WAYLAND_DISPLAY$DISPLAY"     # wayland-0 有值=Wayland；:0 有值=X11
```

## 2. Xorg 与 Wayland：两种模型

### 2.1 架构差异

X11 采用客户机/服务器模型：Xorg 是"服务器"，独占显卡与输入输出；Firefox、终端这些应用是"客户端"，通过 X11 协议向服务器发送"画个窗口、写行字"的绘图指令，绘制的具体工作发生在服务端。这个模型诞生于 1980 年代的网络终端，本地运行时客户端与服务端在同一台机器上，但协议按"隔着网络"设计。

Wayland 只定义了一套窗口表面（surface）与输入事件的协议，没有独立的服务器进程：合成器（compositor）同时承担显示服务器与合成两职。每个客户端用 EGL/Vulkan 自行渲染到自己的缓冲区，把缓冲区"交给"合成器，合成器负责把它们拼成最终画面。绘图发生在客户端自己的进程里，这是它与 X 最本质的区别。

| 对比项 | Xorg | Wayland 合成器 |
|--------|------|----------------|
| 模型 | 客户机/服务器，服务端代理绘图 | 合成器直接合成客户端自绘的缓冲区 |
| 绘制位置 | 服务端（客户端发绘图指令） | 客户端进程内自绘 |
| 窗口装饰与合成 | 依赖扩展（Composite、窗口管理器合作） | 协议原生，合成器统一处理 |
| 屏幕截图/录屏 | 任意客户端可直接读取 | 需经 xdg-desktop-portal 授权 |

### 2.2 安全模型差异

X11 协议下，同一个 X 服务器的客户端彼此之间几乎没有隔离：任何一个客户端都能读取其它客户端的窗口内容、监听全局键盘事件。也就是说，你在终端里输入的密码，理论上可被同会话下的另一个进程拿到。这在单用户桌面时代可以接受，放在今天就是实际的安全缺口。

Wayland 从协议层面做了隔离：客户端只能访问自己的表面与输入，想截屏、录屏、全局快捷键，必须通过 xdg-desktop-portal 这样的受控通道，由用户逐次授权。代价是部分依赖"全局钩子"的老软件（某些密码管理器、远程协助工具）在纯 Wayland 下功能受限。

### 2.3 现状与兼容层

主流桌面已完成向 Wayland 的默认切换：GNOME 在 Fedora Workstation 与 Ubuntu 的近期版本上默认 Wayland；KDE Plasma 自 6.0 起（2024 年发布）默认 Wayland 会话；XFCE 至 4.20 仍以 X11 为默认，Wayland 支持处于实验阶段（以上以发行版实际打包为准）。登录界面上的会话选择，本质就是 `/usr/share/wayland-sessions/` 与 `/usr/share/xsessions/` 两目录里 `.desktop` 文件的差别，见第 4 节。

存量 X11 应用不会立刻消失，XWayland 充当兼容层：它是跑在 Wayland 会话里的一个 X 服务器，老应用连接它照常工作，它的画面再由 Wayland 合成器合成。判断一个应用走的是哪条路，可以看环境变量或直接查进程树。

```bash
pstree -p | grep -i xwayland        # XWayland 进程存在 = 会话里跑着 X11 应用
ps -o comm= -p "$(xprop -root _NET_SUPPORTING_WM_CHECK \
  | grep -o '[0-9]\+')" 2>/dev/null # X11 会话下查窗口管理器；Wayland 下 xprop 无根窗口
GDK_BACKEND=x11 firefox             # 强制 GTK 应用走 XWayland，用于对照排查
```

## 3. 显示管理器：登录与启动会话的那层

显示管理器（DM）开机后在 `graphical.target` 下运行，负责两件事：提供图形化登录界面，以及按你选的会话启动桌面。它不是桌面本身——登录界面那个"界面"只有登录框，启动 GNOME 还是 i3 完全由它转交给会话文件决定。

| 显示管理器 | 常见搭配 | 特点 |
|-----------|---------|------|
| GDM | GNOME | GNOME 官方配套，Debian 包名 `gdm3` |
| SDDM | KDE Plasma | Plasma 官方配套，基于 Qt |
| LightDM | XFCE 等 | 轻量，多款 greeter（登录界面）可选 |
| greetd | sway、i3 等 WM | 极简，常配 tuigreet/gtkgreet，无完整图形界面 |

`systemctl status display-manager` 看到的是当前在跑的那一个（它是指向实际服务的别名）；`loginctl list-sessions` 能看到 DM 自己的会话与你登录后的用户会话。换 DM 时先 `disable` 旧的再 `enable` 新的，两个同时 enable 会抢 `display-manager.service`。

```bash
systemctl status display-manager    # 当前显示管理器是谁、起没起来
systemctl cat display-manager       # 看它实际指向 gdm3/sddm/lightdm 哪个单元
sudo systemctl disable --now gdm3   # Debian/Ubuntu 关掉 GDM（服务名带 3）
sudo systemctl enable sddm          # 换 SDDM：enable 后重启生效
```

不装 DM 也能进图形界面：装 `xorg-xinit`（Debian 在 `xinit` 包里），用 `startx` 按 `~/.xinitrc` 启动会话。这正是第 7 节"最小图形界面"做法的基础。

## 4. 桌面环境与窗口管理器

### 4.1 完整桌面与独立 WM 的分工

桌面环境（DE）是一组软件的集合：窗口管理器、面板、文件管理器、设置中心、主题框架打包在一起，开箱即有完整体验。独立窗口管理器（WM）只做窗口的摆放与切换这一件事，状态栏、启动器、壁纸都要自己拼装。代价换收益：GNOME/Plasma 全套常以百 MB 计，i3 加状态栏几十 MB 就够了，内存占用与更新负担同样相差一个量级。

| 组件 | 类型 | 自带 WM | 默认显示协议 |
|------|------|---------|-------------|
| GNOME | 完整桌面 | Mutter | Wayland（X11 会话可选） |
| KDE Plasma | 完整桌面 | KWin | Wayland（Plasma 6 起默认） |
| XFCE | 完整桌面（轻量） | Xfwm4 | X11（Wayland 实验性） |
| i3 | 独立 WM（平铺） | — | X11 |
| sway | 独立 WM（平铺） | — | Wayland（i3 的 Wayland 实现） |

### 4.2 会话文件：登录界面上的选项从哪来

DM 的会话菜单读的是两个目录下的 `.desktop` 文件：`/usr/share/xsessions/` 是 X11 会话，`/usr/share/wayland-sessions/` 是 Wayland 会话。装 `plasma` 而没装 `plasma-wayland-session`（Arch）时登录界面里看不到 Wayland 选项，就是这个目录缺了文件。想自定义入口，照着抄一份改 `Exec` 即可，用户级目录是 `~/.local/share/xsessions/` 与 `~/.local/share/wayland-sessions/`。

```bash
ls /usr/share/xsessions/ /usr/share/wayland-sessions/ 2>/dev/null
cat /usr/share/wayland-sessions/sway.desktop   # Exec= 一行就是启动命令
echo "$DESKTOP_SESSION"                        # 当前会话名，与上面的文件名对应
```

## 5. 显卡驱动与固件

### 5.1 开源驱动与专有驱动

Intel 与 AMD 的 GPU 用内核内建的开源驱动（`i915`/`amdgpu`），固件由 `linux-firmware` 提供，无需额外安装。NVIDIA 的选择是经典的两难：开源的 `nouveau` 由社区逆向而来，无官方配合，对新卡与电源管理支持不全，性能明显受限；专有的 `nvidia` 驱动性能完整，但它是内核树外模块，每次内核升级都要重编，且对 Wayland 的部分特性（如 GBM 之外的路径、早期对 PRIME 混合输出的支持）长期滞后——NVIDIA 自 545 系列起改善了 Wayland 支持，但选它仍意味着接受"跟随内核节奏重编"这份维护成本。

| 驱动 | 适用 | 优点 | 代价 |
|------|------|------|------|
| i915 / amdgpu | Intel、AMD GPU | 内核内建，随内核更新，Wayland 支持完整 | 老卡优化程度不一 |
| nouveau | NVIDIA GPU | 完全开源，开箱即用 | 无官方固件配合，性能与电源管理受限 |
| nvidia（专有） | NVIDIA GPU | 性能完整，官方支持 | 树外模块，内核升级需重编（DKMS） |

### 5.2 linux-firmware 与 DKMS

`linux-firmware` 是内核加载的固件（微码与运行时代码）集合，amdgpu 等驱动启动时要从中取对应芯片的固件文件，缺了会在 `dmesg` 里看到 `failed to load firmware` 类报错，GPU 直接初始化失败。包名三系一致：Debian/Ubuntu `linux-firmware`、Arch `linux-firmware`、RHEL/Rocky 同名，是最常被最小化安装裁掉的关键包之一。

DKMS（Dynamic Kernel Module Support）在内核升级后自动重编树外模块。专有 NVIDIA 驱动经 DKMS 安装时，新内核装完的瞬间模块可能还没编好或编译失败——重启后黑屏、`nvidia-smi` 找不到设备，多半就是这个窗口期。判断方法是对比模块的当前版本与 DKMS 登记状态：

```bash
dkms status                         # 已登记模块：installed 还是 broken？
pacman -Q linux nvidia-dkms         # Arch：内核与模块包版本是否配套
ls /usr/lib/modules/$(uname -r)/updates/dkms/ 2>/dev/null   # 新内核下模块落位没有
```

## 6. 字体与输入法

### 6.1 fontconfig 与 CJK 字体

应用显示文字走 fontconfig 的字体匹配：应用给出"要无衬线字体"这样的请求，fontconfig 按 `/etc/fonts/` 的规则与已安装字体库挑一个。最小化安装的服务器往往只有 Latin 字体，中文页面显示成一排方框（tofu）——不是编码问题，是库里根本没有覆盖 CJK 的字体。确认与修复：

```bash
fc-list :lang=zh | head -5          # 列出覆盖中文的字体，输出为空 = 会出方框
sudo apt install fonts-noto-cjk     # Debian/Ubuntu
sudo pacman -S noto-fonts-cjk       # Arch
sudo dnf search noto cjk            # RHEL/Rocky：包名随版本变化，先查再装
fc-cache -f                         # 手动刷新字体缓存（新装字体后偶尔需要）
```

### 6.2 输入法框架

中文输入需要输入法框架居中转译：应用提交"我要输入"的意图，框架接管按键、出候选词、把结果回传。X11 下这套流转靠环境变量约定：`GTK_IM_MODULE`、`QT_IM_MODULE` 告诉工具包走哪个框架，`XMODIFIERS=@im=fcitx` 告诉 X 层全局输入法是 fcitx。fcitx5 与 ibus 都属此类框架，GNOME 内建 ibus。

Wayland 下路径不同：键盘输入由合成器统一接收，经 wayland-protocols 中的 text-input 协议（如 `zwp_text_input_v3`）与输入法协议在合成器、输入法、应用之间流转，环境变量的地位下降。实际表现是同一套配置在两种会话下行为不同——GNOME Wayland 下 ibus 开箱即用，fcitx5 在 KDE Wayland 下随 Plasma 6 的 text-input 支持工作良好，而在另一些组合下需要手动补环境变量或使用框架的 Wayland 前端。排错时先确认会话类型（`echo $XDG_SESSION_TYPE`），再按会话选配置位置：X11 写 `~/.xprofile`，Wayland 多数组合成器读 `~/.config/environment.d/*.conf`。

## 7. 三系安装对照：最少装什么能进图形界面

| 目标 | Debian/Ubuntu | Arch | RHEL/Rocky |
|------|---------------|------|------------|
| 完整桌面 | `apt install ubuntu-desktop`（GNOME） | `pacman -S gnome` + `systemctl enable gdm` | `dnf groupinstall "Server with GUI"` |
| KDE 全套 | `apt install kubuntu-desktop` | `pacman -S plasma-meta sddm` + `systemctl enable sddm` | `dnf groupinstall "Workstation"` |
| 最小 X + WM | `apt install xorg openbox` | `pacman -S xorg-server xorg-xinit openbox` | 见下方说明 |

最小路径的差异值得单独展开——这是"服务器临时需要图形界面"最常用的姿势：

```bash
# Debian/Ubuntu 与 Arch 的最小 X11 会话
apt install xorg openbox            # Debian：xorg 元包已含 xinit
pacman -S xorg-server xorg-xinit openbox   # Arch：分得更细，需单独装 xinit
echo "exec openbox-session" > ~/.xinitrc   # startx 默认读它决定启动什么
startx                              # 进入 openbox，退出即回到控制台
```

RHEL/Rocky 的组安装粒度较粗，最小化做法是安装 `base-x` 组再补一个 WM（组名随大版本有变动，先用 `dnf group list --installed | grep -i x` 核实）；`dnf groupinstall "Server with GUI"` 则直接给出 GNOME + GDM 的完整图形环境。装完检查默认启动目标：最小化安装的服务器常停在 `multi-user.target`，不切换就见不到登录界面。

```bash
systemctl get-default               # 当前默认目标
sudo systemctl set-default graphical.target   # 切到图形登录
```

## 8. 服务器上要不要装桌面

明确判断：生产服务器不装桌面。理由落在三处——攻击面（整套 GUI 加浏览器等于多出一批需要跟踪安全更新的组件）、资源（桌面会话常驻数百 MB 内存与持续的后台进程，挤占业务余量）、以及必要性（桌面对管理服务器没有不可替代的能力，下面三条替代路径覆盖了绝大多数场景）：

| 需求 | 替代方案 | 说明 |
|------|---------|------|
| 网页化的图形管理 | Cockpit（RHEL 系配套） | `dnf install cockpit` 后启用 socket，浏览器访问 9090 端口 |
| 临时跑一个 GUI 程序 | X 转发 | `ssh -X user@host`，程序窗口显示在本地，服务端只装该程序 |
| 需要常驻的完整桌面 | VNC | 装最小 X + WM，按需拉起，用完可关 |

X 转发适合"就想跑一下 `system-config-*` 这类图形配置工具"的场景，带宽占用低、无常驻服务；VNC 适合训练环境或需要长期图形会话的特殊情况，但要暴露端口，务必放在 SSH 隧道或 VPN 之后。真要装桌面，装第 7 节的"最小 X + WM"而不是完整 DE，并把会话设为按需启动而非开机自启。

## 9. 排错入口

1. **黑屏/花屏，先看内核层。** 换 TTY（Ctrl+Alt+F3）或 SSH 进去：`dmesg | grep -iE "drm|gpu"` 看驱动初始化与固件加载报错；`lspci -k` 确认 `Kernel driver in use` 存在。专有驱动场景跑 `dkms status` 对照内核版本。应急验证可在内核参数加 `nomodeset` 强制关闭 KMS——能亮屏说明问题在驱动层而非显示器线缆。
2. **DM 起不来，看 journal。** `systemctl status display-manager` 看状态，`journalctl -b -u gdm`（服务名随 DM 替换为 sddm/lightdm）看启动日志；单元日志不够时 `journalctl -b | grep -iE "gdm|sddm|xinit"` 扩大范围。常见根因：换 DM 后两个服务同时 enable、显卡驱动崩溃把 DM 一起拖死（回到上一条）、磁盘满导致会话写不出日志。
3. **Wayland 会话下老 X 应用异常，走 XWayland 排查。** 先 `echo $XDG_SESSION_TYPE` 确认真的在 Wayland 会话；用 `GDK_BACKEND=x11 应用` 或 `QT_QPA_PLATFORM=xcb 应用` 强制走 XWayland 对照，异常依旧则问题与应用本身有关而非 Wayland；`journalctl -b | grep -i xwayland` 看 XWayland 自身的崩溃记录。输入法在特定 Wayland 应用里失灵，按第 6.2 节确认 text-input 支持情况，不要套用 X11 的环境变量结论。
4. **中文变方框，是字体不是编码。** `fc-list :lang=zh` 输出为空即缺 CJK 字体，按第 6.1 节安装后 `fc-cache -f`，重启应用即可，无需动任何 locale 配置。

## 参考资料

- Arch Wiki - Graphics 分类 — [wiki.archlinux.org](https://wiki.archlinux.org/title/Category:Graphics)
- Arch Wiki - Xorg — [wiki.archlinux.org](https://wiki.archlinux.org/title/Xorg)
- Arch Wiki - Wayland — [wiki.archlinux.org](https://wiki.archlinux.org/title/Wayland)
- freedesktop.org — [freedesktop.org](https://www.freedesktop.org/)
- Ubuntu 桌面文档 — [ubuntu.com](https://ubuntu.com/desktop)
