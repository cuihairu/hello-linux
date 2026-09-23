# 系统服务管理

systemd 是现代 Linux 发行版的初始化系统和服务管理器，负责拉起服务、处理依赖、记录日志和执行定时任务。

> 内容参考自 Arch Wiki systemd 文档与鸟哥的私房菜，见文末参考资料。

## 学习目标

- 理解 systemd 取代 SysV init 的动机，读懂 unit 文件结构与依赖声明
- 熟练使用 `systemctl`，准确区分 `enable` 与 `start`（最高频的坑）
- 掌握 `journalctl` 查服务日志的常用姿势
- 理解 target 取代运行级别、timer 取代 cron 的对应关系
- 对照三发行版默认服务与防火墙差异，避免拿一系命令去另一系执行

## 1. 为什么 systemd 取代了 SysV init

早期 Linux 用 SysV init 管理开机：`/etc/rc.d/rc3.d/` 下一堆按 `S01`、`S12` 编号的脚本串行执行，依赖关系全靠编号顺序约定。三个致命问题让它难以适应现代系统：

- **串行启动太慢**：每个脚本执行完才轮到下一个，与依赖无关的服务也要排队。
- **依赖关系隐式且脆弱**：编号一旦被人为改动，NFS 可能在网络就绪前挂载，SSH 可能在密钥生成前启动。
- **管理入口分散**：`service`、`chkconfig`、`init` 各管一摊，状态查询没有统一格式。

systemd 的解法是把"开机要做的事"统一抽象为 **unit 文件**（INI 风格的声明式配置），用 `After=`、`Wants=` 等字段显式声明依赖，允许无依赖的 unit 并行启动，并提供 `systemctl` 一个入口完成查询、启停和开机自启管理。三发行版（Debian/Ubuntu、Arch、RHEL/CentOS/Rocky）均以 systemd 为默认初始化系统，命令完全一致。

```bash
# 今天的三系都能用同一套命令
$ systemctl status sshd
```

Debian/Ubuntu 上 SSH 服务名通常是 `ssh`（`sshd` 为别名），Arch 与 RHEL 系是 `sshd`，下文统一以 `sshd` 为例。

## 2. systemctl 基本操作

先看一个真实的状态输出，注意 `Loaded` 与 `Active` 两行——它们分别回答"重启后会不会自启"和"现在跑没跑"：

```bash
$ systemctl status sshd
● sshd.service - OpenSSH server daemon
     Loaded: loaded (/usr/lib/systemd/system/sshd.service; enabled; vendor preset: disabled)
     Active: active (running) since Mon 2026-09-21 08:15:03 CST; 1 day 3h ago
   Main PID: 1102 (sshd)
      Tasks: 1 (limit: 2246)
     Memory: 5.8M
        CPU: 42ms
     CGroup: /system.slice/sshd.service
             └─1102 /usr/sbin/sshd -D $OPTIONS

Sep 21 08:15:03 web01 systemd[1]: Started OpenSSH server daemon.
```

常用操作按语义分两类，混用是新手最常见的错误来源：

```bash
# —— 改变"当下状态"，重启即失效 ——
sudo systemctl start sshd      # 立刻启动
sudo systemctl stop sshd       # 立刻停止
sudo systemctl restart sshd    # 停止后重新启动（进程 PID 会变）
sudo systemctl reload sshd     # 不重启进程，仅重读配置（需服务支持）

# —— 改变"开机意图"，重启后依然生效 ——
sudo systemctl enable sshd     # 创建开机自启符号链接
sudo systemctl disable sshd    # 删除开机自启符号链接

# —— 查询 ——
systemctl status sshd          # 综合状态（含最近日志）
systemctl is-active sshd       # 只回答 active/inactive
systemctl is-enabled sshd      # 只回答 enabled/disabled
systemctl list-units --type=service        # 列出已加载（多为运行中）的服务
systemctl list-unit-files --type=service   # 列出系统中所有可管理的服务文件
```

`enable` 的底层实现只是创建/删除符号链接，执行时你会直接看到这一过程：

```bash
$ sudo systemctl enable sshd
Created symlink /etc/systemd/system/multi-user.target.wants/sshd.service
    → /usr/lib/systemd/system/sshd.service.

$ sudo systemctl disable sshd
Removed "/etc/systemd/system/multi-user.target.wants/sshd.service".
```

## 3. 大坑：enable ≠ start

这是服务管理里被问得最多的问题，值得单独一节。

| 操作 | 影响现在 | 影响重启后 | 典型误用 |
|------|---------|-----------|---------|
| `start` | ✅ 立即运行 | ❌ 重启后不自动运行 | 装完服务只 start，服务器一重启业务全挂 |
| `enable` | ❌ 不会让服务跑起来 | ✅ 下次开机自动启动 | 以为 enable 了服务就在运行，实际 `Active: inactive` |
| `enable --now` | ✅ | ✅ | 正确的一步到位写法（systemd ≥ 220） |

组合出的四种状态都是合法且常见的，`status` 必须两行一起读：

```bash
# enabled + active：自启且正在运行（正常生产状态）
# enabled + inactive：自启但当前被停掉（下次开机会自动拉起）
$ sudo systemctl stop sshd
$ systemctl status sshd | head -3
● sshd.service - OpenSSH server daemon
     Loaded: loaded (/usr/lib/systemd/system/sshd.service; enabled)
     Active: inactive (dead)

# disabled + active：正在运行但重启后消失（最常见的事故状态）
$ sudo systemctl disable sshd >/dev/null
$ sudo systemctl start sshd
$ systemctl status sshd | head -3
● sshd.service - OpenSSH server daemon
     Loaded: loaded (/usr/lib/systemd/system/sshd.service; disabled)
     Active: active (running) since Tue 2026-09-22 09:41:12 CST; 2s ago
```

三系通用的正确姿势是安装完服务立刻 `enable --now`。Arch 上用 `pacman` 装的服务（如 `pacman -S nginx`）同样遵守这条规则：包只负责把 unit 文件铺到 `/usr/lib/systemd/system/`，是否开机自启仍由你决定。

## 4. unit 文件结构与依赖关系

unit 文件按来源分三个目录，优先级从低到高：

| 目录 | 用途 | 修改建议 |
|------|------|---------|
| `/usr/lib/systemd/system/` | 软件包自带（RHEL 系路径；Debian/Ubuntu/Arch 常见等价路径为 `/lib/systemd/system/` 或 `/usr/lib/systemd/system/`） | 不要直接改，升级会被覆盖 |
| `/run/systemd/system/` | 运行时生成 | 一般不碰 |
| `/etc/systemd/system/` | 管理员本地修改与自建 unit | **改 unit 只改这里** |

一个典型服务 unit 的三个小节：

```ini
# /etc/systemd/system/sshd.service（示意，实际以发行版自带文件为准）
[Unit]
Description=OpenSSH server daemon
Documentation=man:sshd(8)
After=network.target cryptsetup.target
Wants=sshd-keygen.service

[Service]
Type=notify
ExecStart=/usr/sbin/sshd -D $OPTIONS
ExecReload=/bin/kill -HUP $MAINPID
Restart=on-failure
RestartSec=4s

[Install]
WantedBy=multi-user.target
```

依赖声明只回答"顺序与牵连"，不回答"要不要启动"：

- `After=` / `Before=`：只管启动**顺序**，不隐含"必须先启动对方"。
- `Wants=`：弱依赖。对方启动失败，自己照样启动。
- `Requires=`：强依赖。对方启动失败，自己也失败退出。
- `BindsTo=`：比 `Requires` 更强，对方中途停止时自己也会被停止。
- `Conflicts=`：互斥，启动我就不启动你（如 `graphical.target` 与部分救援模式）。

查询依赖树——正向看"我依赖谁"，`--reverse` 看"谁依赖我"：

```bash
$ systemctl list-dependencies sshd.service
sshd.service
├─sshd-keygen.service
├─system.slice
├─basic.target
│ ├─...
│ ├─network.target
│ └─...
└─multi-user.target

$ systemctl list-dependencies --reverse network.target
network.target
└─sshd.service
```

修改 unit 文件后必须让 systemd 重新读入，否则它仍按内存里的旧定义工作：

```bash
sudo systemctl daemon-reload   # 重读 unit 定义
sudo systemctl restart sshd    # 让运行中的进程用上新配置
```

`daemon-reload` 不会重启任何服务，两步缺一不可。

## 5. target：取代运行级别

SysV 的运行级别 0–6 被 target unit 取代，日常只需要关心两个：

| target | 对应场景 |
|--------|---------|
| `multi-user.target` | 纯命令行（≈ runlevel 3） |
| `graphical.target` | 图形界面（≈ runlevel 5，内部包含 multi-user） |

```bash
$ systemctl get-default
graphical.target

$ sudo systemctl set-default multi-user.target
Removed symlink /etc/systemd/system/default.target.
Created symlink from /etc/systemd/system/default.target
    to /usr/lib/systemd/system/multi-user.target.
```

切换**当前**运行环境用 `isolate`（会启动/停止一整组 unit），不要对 target 用 `start`/`stop`：

```bash
sudo systemctl isolate multi-user.target   # 立即切到纯命令行
sudo systemctl isolate graphical.target    # 立即切回图形界面
```

## 6. timer：systemd 的定时任务

每个 `.timer` 对应一个同名 `.service`，timer 负责"何时触发"，service 负责"触发后干什么"。相对 cron 的优势是：任务跑在自己的 cgroup 里、依赖可声明、执行结果自动进 journal、错过的周期可用 `Persistent=true` 补跑。

```bash
# 查看系统已排程的 timer（真实输出节选）
$ systemctl list-timers
NEXT                          LEFT        LAST                          PASSED     UNIT                         ACTIVATES
Tue 2026-09-22 00:00:00 CST  14h left    Mon 2026-09-21 00:00:01 CST  10h ago    logrotate.timer              logrotate.service
Wed 2026-09-23 03:15:00 CST  1 day 17h  Tue 2026-09-15 03:15:01 CST  7 days ago man-db.timer                 man-db.service
```

一个最常用的 timer 例子——每天凌晨 2:30 跑备份：

```ini
# /etc/systemd/system/backup.timer
[Unit]
Description=Nightly backup

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl enable --now backup.timer   # timer 本身需要 enable，service 不需要
systemctl list-timers backup.timer         # 确认下次触发时间
```

用户级个人任务继续用 `crontab -e` 完全没问题；系统级、与服务生命周期绑定的任务优先选 timer。

## 7. 三发行版默认服务与防火墙差异

命令相同，出厂状态不同，迁移机器时最容易在这里翻车：

| 项目 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|--------------------|
| SSH 服务名 | `ssh.service` | `sshd.service` | `sshd.service` |
| 默认防火墙 | Ubuntu 启用 ufw；Debian 通常未启用 | 无默认，需自行安装配置 | firewalld 默认启用 |
| 防火墙查询 | `sudo ufw status` | 取决于所装方案 | `sudo firewall-cmd --state` |
| 常见日志文件 | `/var/log/syslog`、`/var/log/auth.log` | 默认以 journal 为主 | `/var/log/messages`、`/var/log/secure` |
| 服务包来源 | `apt`（如 `apt install nginx`） | `pacman`（如 `pacman -S nginx`） | `dnf`（如 `dnf install nginx`） |

无论用哪家包管理器，流程都一样：**安装 → `systemctl enable --now` → `systemctl status` 确认 `enabled + active` → 查 `journalctl -u` 验证日志无报错**。Arch 上 `pacman` 安装的任何服务都遵守这套流程，包本身不会替你 enable（少数包用 pacman hook 例外，装完仍建议 `is-enabled` 确认一次）。

## 8. 常见坑

1. **只 start 不 enable**：重启后服务消失。装完服务立刻 `systemctl enable --now`，上线前用 `is-enabled` 验收。
2. **改了 unit 不 reload**：编辑 `/etc/systemd/system/*.service` 后必须 `daemon-reload`，否则 systemd 视而不见；改了 `ExecStart` 还要 `restart`。
3. **对 target 用 start/stop**：切换运行级别要用 `isolate`，`systemctl stop graphical.target` 不会按预期工作。
4. **kill 服务进程**：直接 `kill` 会让 systemd 认为服务意外退出并可能按 `Restart=` 策略反复拉起。停止服务永远用 `systemctl stop`。
5. **掩蔽（mask）忘了解除**：`systemctl mask` 把 unit 链到 `/dev/null`，比 `disable` 更彻底，连手动 start 都会被拒绝；调试完记得 `unmask`。
6. **reload 失败以为配置坏了**：只有声明了 `ExecReload=` 或 `Type=notify`/支持重载的服务才能 `reload`，否则会报错，此时用 `restart`。
7. **服务起失败只看 status 尾部**：`journalctl -u <unit> -n 50 --no-pager` 能看到完整报错；`systemctl status` 只截取最后几行。
8. **三系服务名想当然**：在 Debian/Ubuntu 上执行 `systemctl status sshd` 通常因别名可用，但写脚本时应使用 `ssh.service` 或先 `systemctl list-unit-files | grep ssh` 确认，避免别名缺失导致失败。

## 参考资料

- `man systemctl`、`man systemd.unit`、`man systemd.timer`
- Arch Wiki - systemd — [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd)
- Arch Wiki - systemd timers — [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd/Timers)
- 鸟哥的私房菜 - 认识系统服务 (daemons) — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0560daemons.php)
- 鸟哥训练教材 - 服务管理与开机流程管理 — [linux.vbird.org](https://linux.vbird.org/linux_basic_train/centos8/unit13.php)
- Red Hat 文档 - 配置基本系统设置 (含 systemd 服务管理) — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_basic_system_settings/index)
- systemctl 手册页 — [man7.org](https://man7.org/linux/man-pages/man1/systemctl.1.html)
