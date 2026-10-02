# 账号权限进阶：PAM 与 sudo

`useradd` 建出的账号为什么输对密码就能登录、输错三次为什么会被拒之门外？普通用户敲 `sudo` 时，系统凭什么认定"这个人被允许以 root 身份跑这条命令"？这两件事的答案都不在用户数据库本身，而在两套独立的机制里：PAM（可插入认证模块）决定"谁能通过认证这扇门"，sudo 决定"进门之后谁临时借用 root 的手"。基础篇的[账号管理](../basic/users/account_management.md)讲了用户、组与密码文件的 ABC，本页往下挖一层机制：密码策略为什么改的是 `/etc/pam.d/` 下的文本，登录失败锁定怎么配才真正生效，sudoers 的白名单怎么写才既精确又不留提权后门。这两套机制是安全篇后续[安全加固](./hardening.md)的地基——加固清单里一半的条目，落到实现就是改 PAM 或 sudoers。

> 内容参考自 Linux-PAM 与 sudo 官方文档、Arch Wiki（概念框架参考鸟哥的私房菜），见文末参考资料。

## 学习目标

- 建立"认证（PAM）"与"授权（sudo）"分层的权限心智模型
- 读懂 `/etc/pam.d/` 规则文件：模块类型、控制标志、调用顺序
- 独立配置登录失败锁定（pam_faillock）与密码复杂度（pam_pwquality），并能验证生效
- 掌握 sudoers 四元组语法、别名分组与 NOPASSWD 的适用边界
- 识别白名单里的提权后门（find/vi/pager 的 shell 逃逸），建立"命令白名单"的审查直觉

## 1. 权限的两层：先认证，后授权

把一次 `ssh alice@server` 拆开看，权限其实分两段。第一段是**认证**（authentication）：证明"你是 alice"——核对密码、指纹、一次性验证码。第二段是**授权**（authorization）：认证通过之后，判定"alice 能做什么"——她能读哪些文件（传统 rwx 与[ACL](../basic/users/acl_permissions.md)）、能以谁的身份执行什么命令（sudo）。两段的机制完全独立：密码怎么被核对、错几次锁账号，PAM 说了算；alice 能不能 `systemctl restart nginx`，sudoers 说了算。

| 问题 | 机制 | 配置落点 | 改错的后果 |
|------|------|---------|-----------|
| 谁能登录、怎么核验 | PAM | `/etc/pam.d/` 与 `/etc/security/` | 改错可能把自己锁在系统外 |
| 登录后能借 root 干什么 | sudo | `/etc/sudoers` 与 `/etc/sudoers.d/` | 改错可能留下提权后门 |

这个分层解释了一个常见困惑：为什么改了 `/etc/login.defs` 里的 `PASS_MAX_LEN` 类参数，新密码却不受影响？因为密码在设置与核对时走的都是 PAM 的 `password` 栈，真正的口舌在 `pam.d` 的规则文件与 `pwquality.conf`——规则文件才是认证策略的唯一真相源。反过来，把 alice 加进 `wheel` 组她就能 sudo，但登录密码该锁还是锁——授权的宽不会稀释认证的严。排障时先问"卡在哪一段"，比直接翻配置高效得多：登录不了查 PAM 日志，命令跑不了查 sudoers 与审计日志，两条路不混。

## 2. PAM 是什么：登录背后的插件栈

PAM（Pluggable Authentication Modules）把"怎么认证"从每个程序里抽出来，做成一套可插拔的中间件。sshd、login、su、sudo、`passwd`……这些程序自己不写一行密码核对逻辑，只是在启动认证时调用 PAM 库，报上自己的服务名；PAM 拿着服务名去 `/etc/pam.d/` 下找同名规则文件（`sshd` 服务找 `/etc/pam.d/sshd`），按文件里的顺序逐条调用模块。**服务名 = 文件名**是排障的第一线索：想知道 `sudo` 自己怎么认证，看 `/etc/pam.d/sudo`；想看 ssh 登录的完整关卡，看 `/etc/pam.d/sshd`。旧式的单一配置文件 `/etc/pam.conf` 仍被支持，但现代发行版全部用 `pam.d/` 目录——目录里每个文件就是一个服务的认证清单，与 apt 把源拆进 `sources.list.d/` 是同一哲学：按服务隔离，升级不互相踩。

```text
sshd 进程 ──服务名 "sshd"──▶ libpam ──▶ /etc/pam.d/sshd
                                        ├── auth 规则 1  pam_faillock  (preauth)
                                        ├── auth 规则 2  pam_unix      (核对密码)
                                        ├── account …    pam_nologin   (检查 /etc/nologin)
                                        ├── session …    pam_systemd   (注册 cgroup)
                                        └── password …   pam_pwquality (改密时才走)
```

模块本身是 `/usr/lib/` 下的共享库（Debian 在 `/usr/lib/x86_64-linux-gnu/security/`，Arch 与 RHEL 在 `/usr/lib/security/`——`ls` 这个目录就知道系统有哪些积木），规则文件只是搭积木的图纸。同一块积木被所有服务复用：`pam_unix.so` 既替 sshd 核对密码，也替 su、sudo 干同样的活。想理解一台机器的认证行为，与其读十份教程，不如把 `/etc/pam.d/` 里五六个高频文件通读一遍——每个都是十几行、语法相同的清单，这是 PAM 设计给管理员的可读性红利。

## 3. PAM 规则实战：读懂与修改

### 3.1 规则行的语法

每行规则四个字段：**模块类型 控制标志 模块路径 模块参数**。模块类型说"这行管认证四件事中的哪件"：`auth`（核实身份）、`account`（账号是否可用——过期、锁定的）判在此处、`session`（登录前后的事——环境、审计、cgroup）、`password`（改密码的策略与加密方式）。控制标志说"这行失败后怎么办"，是新手最容易晕的地方，四种关键词一张表说清：

| 控制标志 | 本行失败时 | 本行成功时 | 典型角色 |
|---------|-----------|-----------|---------|
| required | 继续走完栈，最终判失败 | 继续下一行 | 默认的严肃关卡 |
| requisite | **立即失败**，不再走后面的行 | 继续下一行 | 一票否决的前置检查 |
| sufficient | 继续走（若此前无 required 失败则整体成功） | **立即成功**，跳过后续同类 | 备用认证路径（指纹、指纹失败回落密码） |
| optional | 不影响整体成败 | 不影响整体成败 | 只做记录、建会话之类的陪衬 |

这套语义的精妙在于"失败也走完全程"（required）：即便第一关就注定失败，PAM 仍把栈走完，让攻击者无法从"第几关报错"推断自己在哪一步露馅——慢一点，但少泄露信息。Debian 系的规则文件里还会看到 `[success=1 default=ignore]` 这种方括号写法，它是控制标志的精确版："成功就跳过下一行，否则当没看见"——语义查 `man pam.conf` 的 action 表即可，读规则时先记关键词版，方括号版当方言认。

### 3.2 两系真实文件对照

Debian/Ubuntu 把公共栈拆成 `common-auth`、`common-account`、`common-session`、`common-password` 四个文件，各服务的规则文件用 `@include` 引入——改动集中在公共文件，一次生效于 ssh、login、su 所有入口。RHEL 与 Arch 则把公共栈直接写在 `system-auth` 里（RHEL 9 起实为 `/etc/authselect/` 下文件的符号链接，由 authselect 管理）。两份真实节选对照：

```text
# /etc/pam.d/common-auth（Debian/Ubuntu，节选）
auth	[success=1 default=ignore]	pam_unix.so nullok
auth	requisite			pam_deny.so
auth	required			pam_permit.so

# /etc/pam.d/system-auth（RHEL/Arch 风格，节选）
auth	required	pam_env.so
auth	required	pam_faillock.so preauth audit deny=4 unlock_time=1200
auth	sufficient	pam_unix.so try_first_pass nullok
auth	required	pam_faillock.so authfail audit deny=4 unlock_time=1200
auth	required	pam_deny.so
```

逐行读 Debian 版：`pam_unix` 是真正核对 `/etc/shadow` 的那行，成功就跳过下一行（`success=1`）；如果它失败了，接着走的 `pam_deny` 是个永远失败的模块，保证"没有任何模块放行"时栈必然拒绝；最后的 `pam_permit` 是永远成功的兜底，让栈在"前面都通过"时有个明确的收尾。RHEL 版多出的两行 `pam_faillock` 就是在 3.3 节要配的失败锁定——注意它的**位置纪律**：`preauth` 在 `pam_unix` 之前清点旧账，`authfail` 在之后记账，两行夹着真正的核对模块，少了任何一行计数都不完整。

### 3.3 改动一：登录失败锁定

暴力破解的账要用锁来算：连续输错 N 次就把账号锁一段时间，`pam_faillock` 负责这件事（它的前辈 `pam_tally2` 已随老版本 PAM 退役，老文档里的名字别再照抄）。参数集中在 `/etc/security/faillock.conf`，比把一长串参数写在规则行里清爽：

```text
# /etc/security/faillock.conf
deny = 4              # 连续失败 4 次后锁定
unlock_time = 1200    # 锁 20 分钟后自动解
even_deny_root        # root 也计数（谨慎：物理控制台应保留逃生门）
audit                 # 锁定事件写审计日志
```

配置挂载方式三系不同——这是本页第一次撞见"同一件事三个落点"：Debian/Ubuntu 在 `common-auth` 里补两行 faillock（`preauth`/`authfail` 夹住 `pam_unix`，照 3.2 节 RHEL 版的排布抄）；RHEL 8/9 用 `authselect enable-feature with-faillock` 一步挂好；Arch 直接编辑 `/etc/pam.d/system-auth`（pambase 升级会留 `.pacnew`，记得合并）。验证不靠猜，拿一个测试账号故意输错：

```bash
$ echo 'wrong-password' | su - testuser -c whoami 2>&1 | head -2
su: Authentication failure
$ faillock --user testuser
testuser:
When                Type  Source                 Valid
2026-10-02 21:04:11 R     ssh:notty              V
2026-10-02 21:04:19 R     ssh:notty              V
# 凑够 deny 次后，正确密码也会被拒——这就是锁定生效的证据
$ sudo faillock --user testuser --reset    # 人工解锁
```

`faillock` 命令是这套机制的观察窗：不带参数列全部失败记录，`--user` 看单人，`--reset` 清零解锁。把它纳入[入侵检测](./intrusion-detection.md)的巡检清单，比事后翻日志发现爆破早好几天。

### 3.4 改动二：密码复杂度

`passwd` 改密码时走的 `password` 栈里，`pam_pwquality` 在真正改密之前先审一遍新口令的质量（它的前辈叫 `pam_cracklib`，老资料里的名字）。参数同样集中在独立文件 `/etc/security/pwquality.conf`：

```text
# /etc/security/pwquality.conf
minlen = 12      # 最短 12 个字符
dcredit = -1     # 至少 1 个数字（负数=下限）
ucredit = -1     # 至少 1 个大写字母
ocredit = -1     # 至少 1 个特殊字符
lcredit = -1     # 至少 1 个小写字母
maxrepeat = 3    # 同一字符至多连排 3 个
```

落点照样分三系：Debian/Ubuntu 改 `common-password`（前提是装了 `libpam-pwquality` 包，没装就没有这块积木）；RHEL 同样改 `password-auth` 对应栈（或经 authselect 的 profile）；Arch 改 `system-auth` 的 `password` 段。验证有捷径：`pwscore`（pwquality 自带的评分器）直接给口令打分，不用真改密码试错：

```bash
$ echo 'abc123' | pwscore
Password quality failed: The password is shorter than 8 characters
$ echo 'correct-horse-battery-staple' | pwscore
72
```

注意 `pwscore` 校验的是它自己的默认配置，读不读 `pwquality.conf` 取决于发行版打包——它适合当"语感训练器"体会什么口令得分高，生产验证仍以真实 `passwd` 交互为准。改完这两处后，纪律是**先在第二个终端验证登录与改密，再关掉第一个窗口**——PAM 改坏的典型症状不是报错，而是所有人都登不进来。

### 3.5 sudo 自己也要过 PAM

容易忽略的一环：你敲 `sudo` 时，sudo 这个程序同样要认证"你是不是你"——`/etc/pam.d/sudo` 就是它的关卡文件（Debian 系照例 `@include common-auth`，Arch/RHEL 引 `system-auth`）。所以 3.3 节给 `common-auth` 加的 faillock，ssh 登录与 sudo 提权两条路同时被保护——公共栈的好处在这里兑现。一个例外同样值得知道：root 自己跑 `sudo` 从不问密码——sudoers 里的 `root ALL=(ALL:ALL) ALL` 在授权层直接放行，根本走不到认证；而普通用户连续 `sudo` 几分钟内不重复问密码，则是 sudo 自己的时间戳缓存（`/run/sudo/ts/` 下按用户与终端记账），与 PAM 无关——`sudo -k` 手工作废缓存、下次必问，交接终端前的肌肉记忆。

### 3.6 session 段：登录的"搭台"与"拆台"

`auth` 判完身份就完了吗？还差 session 段给登录搭台：把用户环境、资源上限、审计、cgroup 一并备好。两个高频模块值得单独认识——`pam_limits.so` 读 `/etc/security/limits.conf` 决定这个会话的文件句柄与进程数上限（大服务必须调，否则 `Too many open files` 来自登录那一刻的隐形天花板），`pam_systemd.so` 把登录会话注册给 systemd-logind，`loginctl` 看到的会话、切用户时的环境继承，都由它起头。二者都有与直觉不符的互动：limits 配了却不生效时，先确认 `session required pam_limits.so` 这行确实在 session 栈里（Debian 系看 `common-session`，RHEL/Arch 看 `system-auth`——三系落点又不同），再确认自己是不是经由不走 session 段的路子进来，session 没走完自然没搭台：

```bash
$ ulimit -n        # 当前会话的最大打开文件数（limits 生效与否的现成探针）
$ cat /etc/security/limits.d/99-services.conf
*    soft    nofile    65535
*    hard    nofile    65535
$ loginctl show-session $(loginctl | awk '$3=="alice"{print $1; exit}') | head -5
```

`session` 段"拆台"的一面同样要懂：注销时模块按栈序逆向清理，谁建了临时文件、谁销了审计——改 session 段时留意顺序语义（`optional` 的清理模块被挪位，可能留下无人回收的会话账目），这也是为什么安全审计类模块（如 `pam_loginuid`）应标 `required`：审计不全的登录，比不登录更危险。另一个对照场景是 systemd 服务单元直接拉起的进程——它们根本不经 PAM，资源上限归 `LimitNOFILE=` 管，别拿着 limits.conf 去查服务的句柄问题，两套账本互不相干。

## 4. sudo 完整语法：白名单怎么写

### 4.1 一行授权的四元组

sudoers 的授权行是一个四元组：**谁 在哪台机器上=(以谁的身份) 跑什么**。`alice ALL=(root) /usr/bin/systemctl restart nginx` 读作"alice 在任何机器上、以 root 身份、只准跑这一条命令"。`ALL` 是通配主机名——单机场景永远填它，多机共享一份 sudoers 时才真正有意义。四个位置都能用别名收编，让规则可读、可复用：

```text
# /etc/sudoers.d/ops（或 visudo 主文件；语法同）
Cmnd_Alias NETCMDS  = /usr/bin/ip, /usr/bin/ping, /usr/bin/traceroute
Cmnd_Alias BACKUP   = /usr/local/bin/backup.sh
User_Alias OPS      = alice, bob

OPS     ALL=(root) NETCMDS
backup  ALL=(root) NOPASSWD: BACKUP
Defaults timestamp_timeout = 5
```

三条细节值钱：其一，命令必须写**绝对路径**，`ip` 不行、`/usr/bin/ip` 才行——防的是 PATH 劫持；其二，`NOPASSWD:` 只作用于它后面那一块命令，不是整行人的属性，更不是整个文件的默认；其三，`Defaults timestamp_timeout = 5` 把"输过密码后几分钟内免问"从默认的 15 分钟压到 5 分钟——会话安全性与打扰度的折中，按团队口味调。规则文件推荐放 `/etc/sudoers.d/` 下按用途命名（`ops`、`backup`），主文件留给发行版默认——又是熟悉的"本地改动与包管理领地分居"哲学。

编辑入口永远只有一个：`visudo`。它不是"vi 的别名"，而是带语法检查的专用编辑器——保存时先解析，语法错就拒绝落盘并把你按回编辑器。绕过它直接 `vim /etc/sudoers`，一个手滑的字符就能让 sudo 对所有人罢工，而你可能恰好在没有 root shell 的机器上。`visudo -c` 可以随时体检存量文件，`visudo -f /etc/sudoers.d/ops` 检查单个片段：

```bash
$ sudo visudo -c
/etc/sudoers: parsed OK
/etc/sudoers.d/ops: parsed OK
```

### 4.2 查询与验证

sudo 自带两把查询钥匙：`sudo -l` 列"我能跑什么"（排查授权问题永远从它开始），`sudo -ll` 给长格式含来源文件；管理员加 `-U` 查他人：

```bash
$ sudo -l -U alice
User alice may run the following commands on db1:
    (root) /usr/bin/ip, /usr/bin/ping, /usr/bin/traceroute
```

注意 `sudo -l` 显示的顺序就是 sudoers 的**最后匹配优先**语义：同一用户被多条规则命中时，排在后面的覆盖前面的——想"先给宽再收窄"的写法（先 ALL 再收）必须把收窄规则放后面，顺序反了等于没写。这也是为什么授权习惯上"从零开始逐条放行"，而不是"先全给再打补丁"——与[防火墙](./firewall.md)的默认拒绝哲学同源：白名单的正字标记是窄，不是长。

### 4.3 环境变量：sudo 为什么"找不到命令"

sudo 默认做 `env_reset`：提权瞬间把环境变量清成一张极简白名单，PATH 换成 sudoers 里 `Defaults secure_path` 指定的固定值。这个设计防的是环境注入——恶意 `PATH`、`LD_PRELOAD`、`PYTHONPATH` 都能借提权之机溜进 root 进程；清空之后，攻击者留在自己 shell 里的机关全部失效。代价是脚本体验：依赖自装路径的脚本在 `sudo` 下突然 `command not found`，八成是 secure_path 没包含它。正解不是关掉 env_reset，而是按需加白：

```text
# /etc/sudoers.d/env
Defaults secure_path = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
Defaults env_keep += "HTTP_PROXY HTTPS_PROXY EDITOR"
```

`sudo -E` 能整包保留调用者的环境，但那是给例外场景的锤子——等于为图省事拆掉防火墙，规范里应禁止出现在生产脚本中；个别变量过不去就用 `env_keep` 点名。判读顺序也简单：`sudo env | grep -i proxy` 一眼看出哪些变量活着，比对着文档猜快得多。

## 5. sudo 的安全边界：白名单里的后门

### 5.1 命令能当 shell 用，就等于给了 root

白名单的朴素想法是"只放行这条命令"，但它有个隐蔽前提：**这条命令自己不能变成任意命令的入口**。经典三例——`/usr/bin/find` 白名单：`sudo find / -name x -exec /bin/sh \;`，`-exec` 让 find 替你起一个 root shell；`/usr/bin/vi` 白名单：vi 里敲 `:!sh` 同样落地 root shell；`less` 或 git 的 pager（`sudo git log` 翻页时）敲 `!sh` 亦是。三例的共同点：命令内部保留了执行外部命令的能力，sudo 只管住了入口，管不住腹地。

```bash
# 每一条都是教科书级提权——白名单里的它们形同虚设
$ sudo find /tmp -name '*.log' -exec /bin/sh \;
$ sudo vi /etc/hosts    # vi 内：!sh 回车
$ sudo git log -p       # pager 内：!sh 回车
```

由此得出白名单的审查原则：**凡能执行任意代码的命令，一律不给白名单**——编辑器、pager、解释器（python/perl/node 的 REPL 与 `-c`）、编译器、能 `-exec`/`--exec` 的 find/tar、包管理器（下一节的头号案例）。这条原则比背漏洞清单耐用：清单会过时，"命令的腹地能力"这个视角不会。给运维放行时，优先选自带参数收敛的工具（`systemctl restart nginx` 写死服务名）、或干脆包一层只干一件事的脚本，把脚本放进白名单——脚本属 root、不可被白名单用户改写，才有资格当"命令"。

### 5.2 审计：谁在什么时候借了 root

sudo 的每次使用都留痕，落在认证日志里（Debian/Ubuntu 为 `/var/log/auth.log`，RHEL 系为 `/var/log/secure`，Arch 以 journal 为主——见[日志系统](../basic/log/syslog.md)的分工讲解）：

```bash
$ journalctl -t sudo --since today
Oct 02 10:12:31 db1 sudo[3121]:   alice : TTY=pts/1 ; PWD=/home/alice ; USER=root ;
    COMMAND=/usr/bin/ip addr
$ sudo grep COMMAND /var/log/auth.log | tail -3
```

日志里"谁、在哪个终端、当时目录、以谁的身份、跑了什么"五要素俱全，事后追责与异常发现（深夜的 sudo、陌生来源的 sudo）都靠它。sudo 1.9 起还能把会话的输入输出全录下来（`Defaults log_input,log_output`，落到 `/var/log/sudo-io/`），适合把守最敏感的跳板机——代价是存储与隐私合规要一起想清楚，别默认全局开。`su -` 与 sudo 在审计维度的差异也值得记：su 之后的一切只归属"su 这个动作"，后续命令无痕；sudo 每条命令独立留痕——这正是一线规范"用 sudo 不发 root 密码"的机制依据。

### 5.3 su - 与 sudo -i：借 root 的三种姿势

日常提权三种入口常被混用，语义其实三岔：`su -` 问的是**目标用户的密码**（默认 root），换来一个完整登录环境；`sudo -i` 问的是**你自己的密码**（或免密），同样模拟出 root 的登录 shell；`sudo -s` 也是问你自己的密码，但继承你当前的环境变量而非重建登录环境。三者放一张表，选型一目了然：

| 途径 | 问谁的密码 | 环境语义 | 审计粒度 |
|------|-----------|---------|---------|
| `su -` | root 的密码 | 完整登录环境（login shell） | 只记一次"su 事件"，后续命令无痕 |
| `sudo -i` | 自己的密码 | 模拟 root 登录环境 | 进入留痕，会话可配输入输出录制 |
| `sudo -s` | 自己的密码 | 继承当前环境，只换身份 | 同 `sudo -i` |

工程上的取舍顺着这张表推：root 密码知道的人越少越好（改密、追责、离职回收都简单），所以 `su -` 退居物理控制台的应急通道，日常用 `sudo 单命令`——能不开交互 shell 就不开；确需完整环境排障时用 `sudo -i` 而不是找人要 root 密码——这正是 5.2 节审计能力存在的意义。`sudo -s` 用在"就想带着我的 PATH 与代理变量干活的脚本场景"，用完即走，别当常驻习惯。

## 6. 三系差异与现代替代

| 操作 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 安装 PAM 框架 | `apt install libpam-modules` | `pacman -S pam pambase` | `dnf install pam` |
| 安装 sudo | `apt install sudo` | `pacman -S sudo` | `dnf install sudo` |
| 密码质量模块 | `apt install libpam-pwquality` | `pacman -S libpwquality` | `dnf install libpwquality` |
| 模块库目录 | `/usr/lib/x86_64-linux-gnu/security/` | `/usr/lib/security/` | `/usr/lib/security/` |
| 公共栈管理 | `pam-auth-update`（菜单式） | 手工编辑（留意 `.pacnew`） | `authselect`（profile 式） |
| 管理员组 | `sudo` 组 | `wheel` 组（默认规则注释着，需自启） | `wheel` 组（装 sudo 即生效） |

组差异展开一句：Debian 的习惯是把管理员塞进 `sudo` 组（对应 `%sudo ALL=(ALL:ALL) ALL` 默认规则）；RHEL 系是 `wheel` 组，装上 sudo 包即激活；Arch 的 sudoers 里 wheel 两行规则默认注释——`%wheel ALL=(ALL:ALL) ALL` 与免密版二选一自己解开，这是 Arch"默认最小"的一贯脾气。桌面与服务场景还有第三位玩家 polkit：图形会话挂载磁盘、NetworkManager 改网络、PackageKit 装包，这些"动作级"授权由 polkit 的规则文件裁决，管理员组同样是 wheel——与 sudo 的分工是"命令级找 sudoers，动作级找 polkit"，服务器上几乎只遇前者，桌面混合环境两头都要查。

## 7. 常见坑

**直接编辑 /etc/sudoers 出语法错，sudo 全面罢工。** 症状是任何人 `sudo` 都报 `parse error`，而此刻你恰好没有开着的 root shell。处置顺序：先试 `pkexec visudo`（polkit 还活着就能救）；不行就得物理控制台登 root（没锁 root 密码的话）或 live/rescue 环境挂盘改回——与[开机救援](../system-management/boot-process.md)同一套流程。预防只有一条铁律：永不开 visudo 的直通车，片段文件也用 `visudo -f` 编辑，保存前它替你把关。

**改 PAM 把自己锁在门外。** 典型根因：注释掉了 `session` 段的 `pam_unix.so`（会话建立失败=登录失败）、或把 `auth` 行的顺序调错。PAM 的报错往往只在日志里（`journalctl -u ssh` 或 auth 日志的 `FAILURE` 行），登录端只见"密码错误"。纪律有三：改动前**保留一个已登录的 root 会话不关**；一次只改一处，第二个终端验证通过再改下一处；改完先 `su` 自测再退出。真锁死了走 live 环境把文件改回来——这也是 3.2 节坚持"读懂再改"的原因，PAM 文件短，读懂的成本远低于试错。

**pam_pwquality 配了不生效。** 三种常见根因：模块包没装（Debian 的 `libpam-pwquality` 是独立包，没装则规则行引用的 `.so` 根本不存在，栈会按控制标志跳过或报错）；改错了文件（RHEL 9 的 `/etc/pam.d/system-auth` 是指向 `/etc/authselect/` 的符号链接，直接改会被下次 `authselect` 调用冲掉——用 `authselect enable-feature` 或改 profile；Debian 要落在 `common-password`，各服务靠 `@include` 共享）；参数文件改了 `pam_pwquality.so` 行内又带了旧参数——行内参数优先于 `pwquality.conf`，两处打架时以行为准。验证永远用真实 `passwd` 走一遍，别信"文件改了=策略生效"。

**faillock 计数不涨，锁不住人。** 九成是排布问题：`preauth` 那行必须在 `pam_unix.so` **之前**、`authfail` 那行在**之后**，两行一夹才构成完整记账；只加了 `authfail` 而 `pam_unix` 用了 `sufficient` 且成功路径短路，失败路径照样到不了记账行。另一种可能是 `deny` 写得过大或测试间隔超过了失败记录的窗口（默认记最近 15 分钟）。用 3.3 节的 `faillock --user` 现场看计数涨不涨，比反复登录试错直观。

**sudo 免密不生效。** 按序排查：`sudo -l -U 用户` 先看最终生效的规则集（注意最后匹配优先，后面的规则覆盖前面）；组规则要带 `%` 前缀（`%wheel` 是组、`wheel` 是用户名，拼错不报错只是不匹配）；用户是否真在组里 `id 用户` 一眼便知；片段文件的权限必须是 0440（`chmod 440 /etc/sudoers.d/ops`），权限过宽 sudo 会直接忽略该文件——这个静默忽略的设计曾让无数人困惑"文件明明写了对吧"。

**给包管理器开了 NOPASSWD，等于人人是 root。** `apt`、`dnf`、`pacman` 维护脚本以 root 身份执行任意代码——装一个恶意 deb 就是完整提权，npm/pip 一类用户态包管理器同理。白名单原则在此再次生效：包管理器、解释器、编辑器都属"腹地能力过强"的一类，真要放行就包一层锁定行为的脚本（如只准 `apt upgrade` 的封装），并接受"这不是缩小攻击面、只是换成审计"的现实。相关检查已纳入[安全加固](./hardening.md)的基线清单。

## 参考资料

- Linux-PAM 项目 — [kernel.org/pub/linux/libs/pam](https://www.kernel.org/pub/linux/libs/pam/)
- Linux-PAM 源码与文档 — [github.com/linux-pam/linux-pam](https://github.com/linux-pam/linux-pam)
- sudo 官方文档 — [sudo.ws/docs](https://www.sudo.ws/docs/)
- man 手册 — man pam、man pam.conf、man sudoers
- Arch Wiki: Sudo — [wiki.archlinux.org/title/Sudo](https://wiki.archlinux.org/title/Sudo)
- Arch Wiki: PAM — [wiki.archlinux.org/title/PAM](https://wiki.archlinux.org/title/PAM)
- 鸟哥的私房菜 — 账号管理章 [linux.vbird.org](https://linux.vbird.org/)
