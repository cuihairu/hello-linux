# AppArmor 实战

一台 Ubuntu 上 nginx 跑得好好的，配置文件从默认的 `/etc/nginx/nginx.conf` 读得来、`systemctl status nginx` 也是绿色的，唯独新挂的站点证书从 `/opt/certs/site.crt` 加载时报 `cannot load certificate`——`ls -l` 权限齐全、属主正确、用 root 手工 `cat` 也没问题，`nginx -t` 却能过。翻 `/var/log/syslog` 才看到一行平常不会留意的东西：`kernel: audit: type=1400 audit(...): apparmor="DENIED" operation="open" profile="/usr/sbin/nginx" name="/opt/certs/site.crt"`。普通权限没有拦它，内核里的 AppArmor 拦了它——而且拦得毫无声音，进程收到的只是一个概念上等同于 `EACCES` 的返回值。

这就是 AppArmor 与 SELinux 最直观的分野：它不用"类型标签"给每个文件盖章，而是拿 **profile 绑定程序路径**，再用 **文件路径通配** 列出这个程序能碰什么。证书放在 `/etc/nginx/` 下没问题、挪到 `/opt/certs/` 就出问题，不是因为标签变了，是因为路径规则覆盖不到。理解了"路径 vs 标签"这一条，Ubuntu 上绝大多数 MAC 类故障都能在几分钟内定位。要对照 SELinux 的排障方法论见[SELinux 实战](./selinux.md)，两者的修正思路可以互相照镜子，命令与判读对象完全不同。

> 内容参考自 AppArmor 项目文档与 Ubuntu/Arch Wiki，见文末参考资料。

## 学习目标

- 说清 AppArmor 用路径强制、SELinux 用标签强制的差别，知道该看哪份日志
- 读懂 `operation=` / `profile=` / `name=` 三个字段，从一条 denial 直接得出改哪条规则
- 会用 `aa-status`、`aa-complain`、`aa-enforce` 在 enforce 与 complain 之间安全切换
- 能写出一个最小可用 profile（文件 `rwk`、`network`、`capability`），并 `apparmor_parser -r` 重载验证
- 理解 Docker 的 `docker-default` profile 与 `--security-opt apparmor=` 的边界
- 分清 Ubuntu/Debian、Arch、RHEL 系对 AppArmor 的默认态度，不套错发行版

## 1. AppArmor 的模型：绑程序，不绑文件

### 1.1 强制单位是"程序路径"

AppArmor 的核心对象是 **profile**，一条 profile 的头部就是这个程序的绝对路径：

```
/usr/sbin/nginx {
  ...
}
```

规则写的是"这个程序能做什么"：读哪些路径、写哪些路径、能不能开网络套接字、能不能用某项 `capability`。程序一旦被执行，内核按它的路径把它塞进对应 profile，此后它的所有动作先过 profile 再谈 DAC。**profile 与二进制路径绑定**——路径变了（升级换了安装目录、做了软链接、容器里 mount 到别处）、或以别的名字被执行，profile 就可能不生效或匹配到另一个 profile。这是 AppArmor 排障里一个反复出现的盲点：`systemctl status` 一切正常，可它在跑的是"无 profile 约束"的进程。

### 1.2 路径规则与权限字符

文件规则用权限字母组合，最常用的三个是读、写、锁：

```
/etc/nginx/nginx.conf r,                          # 只读
/var/log/nginx/** rw,                             # 目录及其后代可读可写
/var/lib/nginx/** rwk,                            # 再加独占锁
```

`r` 是读、`w` 是写、`k` 是文件锁（`flock`/`fcntl` 类）、`m` 是 `mmap` 可执行的内存映射、`x` 是执行（分 `ix`/`ux`/`px`/`cx` 几种，决定执行后继承还是切换 profile）。通配符里 `*` 不跨目录、`**` 跨目录——把 `/etc/nginx/*` 写成 `/etc/**` 是配置文件里最常见的"顺手放大"。除此之外还有两类规则：

```
network inet tcp,                                 # 允许 IPv4 TCP 套接字
network inet6 stream,
capability net_bind_service,                      # 允许绑定 1024 以下端口
capability setuid,
```

`network` 按协议族与类型放行，`capability` 对应内核的 capability 位。一个 profile 不需要显式写全所有规则——它引入的 `#include <abstractions/base>` 里已经预置了一大批"任何程序都会用"的通用规则（加载共享库、读 `/etc/ld.so.cache`、读 locale、`/proc` 基本项等），真正要你手写的只是这个程序特有那几条。

### 1.3 与 SELinux 的对照

两套框架解决同一个问题——在 DAC 之上加一层强制——但落到操作层面几乎没有一行是重合的。下表把日常排障会踩到的每一栏并排给出：

| 对比项 | AppArmor | SELinux |
|--------|----------|---------|
| 强制对象 | 程序路径 → 文件/网络/能力路径 | 进程类型标签 → 资源类型标签 |
| 策略语言 | profile 文本（路径通配 + 权限字母） | 类型强制规则（`allow 域 类型:类别 权限`） |
| 默认发行版 | Ubuntu/Debian、SUSE/OpenSUSE 默认启用 | RHEL/CentOS/Rocky/Fedora 默认 Enforcing |
| 标签扩散问题 | 无（文件不携带标签，新建文件无需打标） | 有（新目录/新文件默认 `var_t`，需 `semanage fcontext`） |
| 排障日志 | `dmesg`/`journalctl -k` 的 `apparmor="DENIED"` | `/var/log/audit/audit.log` 的 `AVC`，用 `ausearch` |
| 拒绝字段 | `operation=` `profile=` `name=` | `scontext` / `tcontext` / `tclass` |
| 策略工具 | `aa-status`、`aa-complain`、`aa-genprof`、`aa-logprof` | `semanage`、`restorecon`、`setsebool`、`audit2allow` |
| 状态查询 | `aa-status`、`cat /sys/module/apparmor/parameters/enabled` | `getenforce`、`sestatus` |
| 容器默认 | Docker 给每个容器挂 `docker-default` | 取决于宿主与运行时配置 |

两条判据值得记死：**Ubuntu 上执行 `getenforce` 得到空输出，不是操作错了，是这机器不用 SELinux**；**RHEL 上执行 `aa-status` 报 `command not found`，同理**。看到 `name=` / `profile=` 就是 AppArmor，看到 `scontext` / `tcontext` 就是 SELinux，两个字段族不会同时出现。对照表只到这一行为止，具体怎么改、改哪一条在本页下面的小节。

## 2. 状态与模式

### 2.1 三种状态

`aa-status` 是 AppArmor 的总览入口，输出比 `getenforce` 详细得多：

```bash
$ sudo aa-status
apparmor module is loaded.
34 profiles are loaded.
32 profiles are in enforce mode.
   /usr/bin/man
   /usr/sbin/nginx
   ...
2 profiles are in complain mode.
   /usr/sbin/foo
0 processes have profiles defined.
0 processes are unconfined but have a profile defined.
```

三档模式语义要分清：

- **enforce**：规则照常求值，越界即拒，进程拿到错误返回；默认态。
- **complain**：规则照常求值，越界**只记录不拦截**，进程正常跑，日志里记一条 `apparmor="ALLOWED"`。调试用的安全网——行为照旧，但能把"本来会被拦的动作"整条攒出来。
- **unconfined**：进程不受任何 profile 约束，AppArmor 对它不做强制。`aa-status` 末行的 `unconfined but have a profile defined` 指"程序路径能匹配某个 profile、但该 profile 尚未加载"——这是排障时要专门留意的假保护状态。

还有一档 `kill` 模式（profile 里写 `flags=(kill)`，越界直接杀进程，比 enforce 更硬），日常几乎不用，知道有它即可。判断某个进程到底受不受管，一条命令：

```bash
$ cat /proc/$(pgrep -f nginx | head -1)/attr/current
/usr/sbin/nginx (enforce)
# 输出 "unconfined" 说明这个进程没被任何 profile 覆盖
```

### 2.2 模块与解析器

AppArmor 是一个内核模块加一套用户空间工具。内核侧确认：

```bash
$ cat /sys/module/apparmor/parameters/enabled
Y                       # AppArmor 在内核里就绪；N 或文件不存在=未启用
```

用户空间侧的核心是 `apparmor_parser`——它把 `/etc/apparmor.d/` 下的 profile 文本编译进内核：

```bash
$ sudo apparmor_parser -r /etc/apparmor.d/usr.sbin.nginx   # 重载单个 profile
$ sudo apparmor_parser -a /etc/apparmor.d/usr.sbin.nginx   # 加载（未加载时用）
$ sudo apparmor_parser -R /etc/apparmor.d/usr.sbin.nginx   # 卸载
$ sudo systemctl reload apparmor                           # 重载全部 profile
```

`apparmor_parser` 也是你写 profile 时的**语法检查器**：`-r` 时若 profile 有拼写或结构错误，它把错误打到 stderr 并拒绝加载，原 profile 保持生效——所以改 profile 前不必紧张，写错了不会让程序立刻失去保护，但会看到解析失败的信息。

## 3. 修正轨迹：从一条 denial 到最小放行

对齐 [SELinux 实战](./selinux.md) 的"优先序"思路，AppArmor 的修正也按改动半径从小到大排。区别在于 AppArmor 没有"标签"这一层，所以没有"改标签"这级动作，起点是**读懂 denial 再决定改哪条规则**。

### 3.1 读懂 denial 的三个字段

拒绝会同时出现在内核环缓冲与 journal 里，两处都能看：

```bash
$ sudo dmesg | grep -i apparmor | tail -3
[12345.678] audit: type=1400 audit(1759415677.124:4256): apparmor="DENIED" \
  operation="open" profile="/usr/sbin/nginx" name="/opt/certs/site.crt" \
  pid=812 comm="nginx" requested_mask="r" denied_mask="r" fsuid=0 ouid=0

$ journalctl -k | grep apparmor | tail -3        # 等价入口，systemd 机器上更常用
$ grep apparmor /var/log/syslog | tail -3        # Debian/Ubuntu 的 syslog 也有副本
```

三个字段决定了你要改什么：

- **`operation=`**：被拒的动作类型——`open`（打开文件）、`exec`（执行）、`connect`（连出）、`bind`（绑定）、`capability`（用它项能力）、`file_lock` 等。它告诉你这是文件规则、网络规则还是能力规则的问题。
- **`profile=`**：是哪个 profile 拦的（这里是 `/usr/sbin/nginx`）。注意它和 `comm=`（进程名）可能不一致，以 `profile=` 为准。
- **`name=`**：被访问的对象路径/资源。它是修正的直接依据——把这一条路径加进 profile 就能解决这一条 denial。

`requested_mask="r" denied_mask="r"` 是请求的权限与最终拒绝的权限，nginx 案例里请求的是读，被拒的也是读，对应 profile 里补一条 `/opt/certs/** r,` 即可。若 `operation="capability"` 后面跟的是 `capname=`，那就落到底层要补 `capability` 规则。

### 3.2 用 `aa-complain` 临时放松定位

一条 denial 解决后往往还有第二条、第三条——程序启动会碰一串文件。与其逐条猜，不如先把 profile 切到 complain，让程序把所有"本来会被拦"的动作都记下来：

```bash
$ sudo aa-complain /usr/sbin/nginx
Setting /usr/sbin/nginx to complain mode.
# 现在检查 /var/log/syslog，会在 apparmor="ALLOWED" 的记录里看到完整动作集
```

`aa-complain` 只改运行状态，不碰磁盘上的 profile 文本；它对应 `aa-enforce`（切回强制）、`aa-disable`（整个卸掉这个 profile）。**诊断窗口要短**——complain 期间该程序实质上不受强制，跑完定位立刻切回：

```bash
$ sudo aa-enforce /usr/sbin/nginx
```

### 3.3 持久修正的两条路

临时放松不是修复。持久修正有两条路，按改动半径选。

**改本地覆盖片段（最推荐）。** `/etc/apparmor.d/local/` 是给本地追加规则专用的目录，很多发行版自带的 profile 末尾都有 `#include <local/usr.sbin.nginx>`。本地改这里，不动发行版文件、升级时不冲突：

```bash
$ sudo tee -a /etc/apparmor.d/local/usr.sbin.nginx <<'EOF'
/opt/certs/** r,
/var/log/nginx/extra/** rw,
EOF
$ sudo apparmor_parser -r /etc/apparmor.d/usr.sbin.nginx
```

**复用 `abstractions/` 片段。** `/etc/apparmor.d/abstractions/` 下是"一类资源"的规则集合，`base`（基础）、`ssl_certs`（证书目录）、`nameservice`（DNS/主机名相关）、`php`、`python` 等都在里面。要放行的东西如果和某个 abstraction 覆盖的范围吻合，直接 `#include <abstractions/名字>` 比手写路径更稳；动手前先 `grep -rn "路径关键字" /etc/apparmor.d/` 反查一遍已有 profile 的写法，照抄最省事。

### 3.4 用工具生成候选规则

`aa-logprof` 扫最近日志里的 denial/ALLOWED，交互式地一个个问你"要不要加进 profile"，你按 `a`（allow）它会把规则写到对应 profile 的位置；`aa-genprof` 则用于初次生成一份新的 profile。两者产出的都是**候选**，不是结论：

```bash
$ sudo aa-logprof
Reading log entries from /var/log/syslog.
Profile: /usr/sbin/nginx
Path: /opt/certs/site.crt
  New Mode: r
(A)llow / (D)eny / (I)gnore / (N)ew / (G)lob / (Q)uit
```

工具的边界要写清楚：它会放行"这次日志里出现过的所有请求"，可能比你要的宽。放行前逐条读它给出的路径与权限，把与本次业务无关的项拒掉——这和 [SELinux 实战](./selinux.md) 第 6 节里"`audit2allow` 生成的 `.te` 要看"是同一条纪律。

### 3.5 最后才是 `aa-disable`

`aa-disable` 把整个 profile 卸掉，等于对该程序关掉 AppArmor。它只该在两种情况出现：profile 与程序版本严重不匹配、你要重做它；排障中确认问题确在 AppArmor 而你要先让业务恢复、稍后重写规则——**两种都要留一张"临时禁用、回收时间"的工单**。AppArmor 的 profile 通常比 SELinux 的完整策略窄而精准，多数 denial 补一条路径规则就能解决，真正需要整体禁用的场景很少。

## 4. 写一个自定义 profile

### 4.1 最小骨架

给一个自编的小程序 `/usr/local/bin/mytool` 写 profile，落盘在 `/etc/apparmor.d/usr.local.bin.mytool`（约定用路径把 `/` 换成 `.`）：

```
# /etc/apparmor.d/usr.local.bin.mytool
#include <tunables/global>

/usr/local/bin/mytool {
  #include <abstractions/base>          # 加载器/locale/基础库等通用规则

  /usr/local/bin/mytool mr,              # 自身可读可执行映射
  /usr/local/share/mytool/** r,          # 只读资源
  /var/lib/mytool/** rwk,                # 数据目录：读、写、加锁
  /var/log/mytool/** rw,                 # 日志目录

  network inet tcp,                      # 允许 IPv4 TCP 套接字
  network inet6 tcp,

  capability net_bind_service,           # 允许绑定低位端口
}
```

`#include <tunables/global>` 是几乎所有 profile 的开头，它引入 `@{HOME}`、`@{PROC}` 这类变量定义；`#include <abstractions/base>` 覆盖绝大多数程序都需要的通用规则，省掉它就要自己把共享库加载、`/proc/self/**`、locale 一条条写全，基本写不对。骨架的其余部分就是程序的三类诉求：文件 `rwk`、网络 `network`、能力 `capability`。

### 4.2 加载与验证

写完不能直接上强制，按"先 complain 观察、再 enforce 验证"的两步走：

```bash
# 1. 语法检查并加载
$ sudo apparmor_parser -r /etc/apparmor.d/usr.local.bin.mytool
# 若报 "AppArmor parser error ... line N"，按行号回看 profile（常见是少了逗号或右花括号）

# 2. 先切 complain，跑一轮业务流程，看该放行的有没有都放行
$ sudo aa-complain /usr/local/bin/mytool
$ sudo journalctl -k | grep apparmor | grep -v DENIED | tail
#    日志里若全是 apparmor="ALLOWED" 而没有你想要的记录，说明规则已覆盖

# 3. 切 enforce，实测
$ sudo aa-enforce /usr/local/bin/mytool
$ sudo aa-status | grep mytool
   /usr/local/bin/mytool
```

验证的核心判据是：**把 profile 切到 enforce 后，业务功能全部正常**。任何一次失败都会在 `dmesg` 里留一条 `apparmor="DENIED"`，回到 3.1 读三字段、在 profile 里补规则、`apparmor_parser -r` 重载，循环到零 denial。这就是 AppArmor 的"小步放行"——每一条 denial 是一张精确的权限申请单，逐条读、逐条放，profile 会随业务运行长成贴合的形状。

## 5. 三系现状

AppArmor 的普及程度和 SELinux 相反：它在 SUSE 系起源、被 Ubuntu 从 7.10 起默认采用，在 Debian 系日益普及；而 RHEL 系走的是 SELinux 路线，默认压根不装 AppArmor。

**Ubuntu / Debian。** Ubuntu 默认启用 AppArmor 且为大量常用服务（nginx、mysqld、dockerd、snap 相关、`man` 等）自带 profile——不装也不用配，开箱即在强制。Debian 从 10 起把 AppArmor 作为默认启用，随包提供的 profile 覆盖度略低于 Ubuntu。状态与版本：

```bash
$ sudo aa-status | head -3
$ dpkg -l | grep -E 'apparmor|apparmor-profiles'   # 包与 profile 包是否都装了
$ sudo apt install apparmor-profiles               # 补装"额外但未默认启用"的 profile 集合
```

**Arch。** Arch 默认既没有 SELinux 也没有 AppArmor——出厂的 MAC 层是空的。要用 AppArmor 得自己装、自己起、自己启开机：

```bash
$ sudo pacman -S apparmor
$ sudo systemctl enable --now apparmor.service
$ cat /sys/module/apparmor/parameters/enabled
Y                       # 输出 N 或文件不存在，说明内核没把 apparmor 选为启用 LSM
```

Arch 内核默认的 LSM 启用列表不含 apparmor，装完还要把 `lsm=landlock,lockdown,yama,integrity,apparmor,bpf` 写进内核启动参数（GRUB 或 systemd-boot 的配置），否则上面的检查会得到 N。装了也不等于有 profile 生效——Arch 的 `apparmor` 包里带的 profile 很少，业务程序要自己写或从其他发行版移植。这也是为什么很多 RHEL 向、Ubuntu 向的加固清单在 Arch 上"缺一半"：那边是默认态，这边要手工把基线搭出来。

**RHEL / CentOS / Rocky。** 默认走 SELinux Enforcing，发行版不提供 AppArmor，仓库里也没有官方包。**在 RHEL 系上装 AppArmor 不是常规路线**——同时装两套 MAC 会带来难以调和的语义冲突（哪个先拦、日志怎么分、策略谁来写），社区基本不这么做。RHEL 系上出现的 `AVC` 一律按 [SELinux 实战](./selinux.md) 的路径处理，不要试图用 `aa-status` 去查。

三系一句话：**Ubuntu/Debian 是 AppArmor 的主场，Arch 要自己搭，RHEL 系换 SELinux 这套。** 跨发行版照抄命令前，先跑一遍 `aa-status` 或 `getenforce` 确认自己站在哪一边。

## 6. 容器与 AppArmor

Docker 在启用 AppArmor 的宿主机上，默认给**每个容器**挂一个叫 `docker-default` 的 profile——它给容器进程一个中等强度的约束：禁掉若干危险的挂载与内核操作，允许网络与常规文件活动。这个 profile 由容器运行时自己管理，你不必写：

```bash
$ docker run --rm alpine sh -c 'cat /proc/self/attr/current'
docker-default (enforce)
```

要覆盖它，运行时可以用 `--security-opt`：

```bash
# 换成自定义 profile：先在宿主机加载它，再按名字引用
$ sudo apparmor_parser -r /etc/apparmor.d/docker-myname
$ docker run --security-opt apparmor=docker-myname ...

# 完全卸载容器的 AppArmor 约束——谨慎
$ docker run --security-opt apparmor=unconfined ...
```

`apparmor=unconfined` 意味着这个容器**不再受 AppArmor 约束**，容器里所有进程的动作直接落到宿主的 DAC 上。风险是具体的：一旦容器被突破（RCE、依赖投毒），攻击者手脚更自由，容器逃逸与横向移动的门槛随之下降。它不是禁用的理由，但应当是"我知道自己在放弃什么、并为此留了别的手段"后的显式选择——生产环境里它不该出现在默认启动参数里，该出现在评审记录里。反向用法是把容器 profile 收得比 `docker-default` 更紧：给只跑一个服务、只读一个目录的容器写专用 profile，把攻击面压到比默认更小。

## 7. 常见故障

**服务启动被静默拒绝，日志里只有一句含糊的权限错误。** 现象是 `systemctl start` 返回失败或程序启动报 `EACCES`，而 `ls -l` 看权限没问题。首选动作是去 `journalctl -k | grep apparmor`（或 `dmesg | grep -i apparmor`）找 `apparmor="DENIED"`；找不到再往 DAC（SELinux 的 AVC 在另一个日志里）查——**AppArmor 的拒绝不写普通文件权限错误，它是内核侧的 MAC 拒绝，进程只会拿到一个 `EACCES` 式的模糊返回**。这一点与 [SELinux 实战](./selinux.md) 的开篇场景同构。

**`aa-status` 显示 profile 没加载。** 三种可能：profile 文件没放对位置（须在 `/etc/apparmor.d/` 下、文件名与程序路径对应）；`apparmor_parser -r` 报过语法错误而你没看到（重跑一次看 stderr）；`apparmor.service` 没在跑或模块没加载（`cat /sys/module/apparmor/parameters/enabled` 若为 `N`，先解决内核/服务层）。

**profile 写错，`apparmor_parser` 报错。** 报错会给出文件名与行号，最常见三类：规则末尾漏逗号（每行规则都要以 `,` 结束）；右花括号 `}` 少一个或嵌套错位（`#include` 引的 abstraction 也可能带花括号）；路径通配写错（`**` 与 `*` 混用，或路径里出现未转义的特殊字符）。`apparmor_parser -r` 失败时**旧的 profile 仍在生效**，不会因为你写错就让程序裸奔，按行号改完重载即可。

**升级或重装程序后 profile 与新版路径不匹配。** 程序版本更新换了安装目录、改了日志路径、多读了一个新的配置文件，都会导致原来正确的 profile 开始报 denial。症状是"昨天还好、今天拒绝"。处理方式是回到 3.1 读 denial，把新路径补进 `/etc/apparmor.d/local/` 的本地覆盖片段——**改本地片段而不是改发行版 profile 文件**，因为下次升级会覆盖后者。

**调试完忘了切回 enforce。** `aa-complain` 之后程序实质上不受强制，如果忘了 `aa-enforce`，这台机器上这个服务就长期处于"规则形同虚设"的状态。纪律和 SELinux 的 `setenforce 0` 完全一致：切换必须记进变更单（原因、回收时间、责任人），排障结束用 `aa-status | grep -A2 complain` 确认 complain 列表里没有残留——**残留的 complain 项是这类事故最直接的信号**。

**`aa-disable` 之后忘记重新加载。** 禁用是运行状态，不是磁盘修改——profile 文件还在，只是没生效。改好文件后要 `apparmor_parser -r` 重新加载才会回到 enforce（或在 profile 里写 `flags=(enforce)` 让它一加载即强制）。状态与文件是两本账，和 SELinux 里"改 `semanage fcontext` 后要 `restorecon`"是同一个道理。

## 参考资料

- AppArmor 项目文档（官方 Wiki，含 profile 语法与工具手册）— [gitlab.com/apparmor/apparmor/-/wikis/Documentation](https://gitlab.com/apparmor/apparmor/-/wikis/Documentation)
- Ubuntu Server 文档 — [ubuntu.com/server/docs](https://ubuntu.com/server/docs)
- Arch Wiki: AppArmor — [wiki.archlinux.org/title/AppArmor](https://wiki.archlinux.org/title/AppArmor)
- AppArmor 手册页（`apparmor_parser`、`aa-status`、`aa-complain`、`aa-logprof` 等）— [manpages.ubuntu.com](https://manpages.ubuntu.com/)
- `man 5 apparmor.d`（profile 语法）、`man 8 apparmor_parser`
