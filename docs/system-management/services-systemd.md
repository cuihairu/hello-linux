# systemd 服务与程序管理进阶

会用 `systemctl` 启停服务只是起点——基础篇的[系统服务管理](../basic/services/system_services.md)讲完启停、`enable` 与 `start` 的分水岭就停在了门口。真正把服务"管好"要跨过四道坎：发行版升级不把你的定制冲掉、依赖失败时看懂 systemd 拒绝启动的那条链、给服务套上资源笼头不被一个失控进程拖垮整机、故障时从 `status` 与 journal 里一步定位到根因。这四件事分别落在 unit 文件的查找优先级、依赖事务、cgroup 归属与诊断工具上，本页按此展开：先建立 unit 全景与三层领地的判定方法，再拆依赖语义与事务回滚，然后是 drop-in 覆盖与模板实例化的正规姿势，最后是 cgroup 归属、资源限制与一套可复用的故障诊断动线。

> 内容参考自 systemd 官方文档与 Arch Wiki（概念框架参考鸟哥的私房菜），见文末参考资料。

## 学习目标

- 读懂 unit 文件的三层查找顺序与生效判定，升级后本地定制不丢
- 分清 `Wants` / `Requires` / `BindsTo` 的失败传染语义，理解 `After` 只管顺序不产生依赖
- 用 drop-in 覆盖与模板单元管理定制与多实例，不再直接改包管理器领地的文件
- 理解 cgroup 进程归属，会用 `systemctl kill` 与资源限制指令管住服务
- 建立 `status → journal → analyze` 的诊断动线，读懂退出码与重启限速

## 1. 从"会用"到"管好"

四个信号说明你该读本页了。第一，改了服务的配置想"顺手"调一下默认参数，直接编辑 `/usr/lib/systemd/system/` 下的文件——升级后发现改动消失，还怀疑是包管理器"覆盖了配置"。第二，服务起不来，`systemctl status` 里一句 `Dependency failed` 就没了下文，你不知道是哪一环断的。第三，一个 Java 服务半夜吃光内存把整机拖进 OOM，连带 SSH 都登不上，而它按理"只该用 2G"。第四，`systemctl disable` 了服务，重启后它照样活着，你开始怀疑 enable/disable 根本没用。

这四个问题的答案分别对应：unit 的三层查找优先级、依赖事务的失败传染、cgroup 资源限制、以及"能拉起你的不止 enable 一处"。它们在 systemd 的设计里本是一体的——unit 不是启动脚本，而是声明式描述：systemd 读入所有声明，算出一次启动事务，再在 cgroup 里兑现这份声明。理解了"声明 → 事务 → cgroup 兑现"这条主线，本页的每个细节都有了归处。

## 2. unit 全景与查找顺序

### 2.1 unit 类型速查

`systemctl list-unit-files --type=service` 换 `--type=` 就切到另一类 unit。常见类型各管一件事：

| 类型 | 职责 | 典型例子 |
|------|------|----------|
| `service` | 常规守护进程的生命周期 | `nginx.service`、`sshd.service` |
| `socket` | 监听套接字，有人连上才拉起服务（socket 激活） | `ssh.socket`、`cups.socket` |
| `timer` | 定时触发，cron 的接班人 | `fstrim.timer`、`man-db.timer` |
| `target` | 启动阶段的依赖编组，接班运行级别 | `multi-user.target`、`graphical.target` |
| `path` | 监视路径变化再触发服务 | `cups.path` |
| `mount` / `automount` | 挂载点管理与延迟挂载 | `home.automount` |
| `device` | udev 设备事件触发（一般不手写） | `dev-sda1.device` |
| `swap` | 交换空间的管理单元 | `swapfile.swap` |
| `slice` | cgroup 资源编组，配额的容器 | `system.slice`、`user.slice` |
| `scope` | 外部进程组的登记处（`systemd-run --scope`） | `run-1234.scope` |

表里藏着两个高频实战入口：`socket` 型让服务零占用待机（发行版拿它做 SSH、CUPS 的按需启动，第 7 节"disable 了还自启"多半与此有关）；`slice` 型是第 5 节资源限制的落点——配额不是加在服务上凭空生效的，而是加在 slice 这个 cgroup 容器上。

### 2.2 三层领地与生效判定

systemd 按固定顺序查找同一 unit 的多个候选路径，**前面的目录覆盖后面的**：

```text
/etc/systemd/system/     ← 管理员领地：你与 systemctl edit 的一切落点，优先级最高
/run/systemd/system/     ← 运行时领地：本次开机内 systemd/程序生成的定义，重启即逝
/usr/lib/systemd/system/ ← 包管理器领地：dpkg/rpm/pacman 安装的原厂定义，升级会被刷新
```

Debian/Ubuntu 上常看到的 `/lib/systemd/system` 是 `/usr/lib/systemd/system` 的符号链接（usr-merge 布局），同一片领地的两个名字。三条纪律随之而来：**包管理器的文件绝不手改**（升级还原，还可能在 dpkg 侧触发 conffile 冲突提示）；**你的定制只落在 `/etc`**（跨升级存活）；**分清"改了"与"生效了"**——生效判定有三个层次的工具：

```bash
# 1) 最终生效的定义由哪些文件拼成：前几行注释就是答案
$ systemctl show nginx -p FragmentPath -p DropInPaths
FragmentPath=/usr/lib/systemd/system/nginx.service
DropInPaths=/etc/systemd/system/nginx.service.d/override.conf

# 2) 全盘清点：谁被覆盖、谁被扩展、谁被屏蔽（输出示意）
$ systemd-delta
OVERRIDEN /usr/lib/systemd/system/nginx.service → /etc/systemd/system/nginx.service
EXTENDED  /usr/lib/systemd/system/nginx.service → /etc/systemd/system/nginx.service.d/override.conf

# 3) 列出某一类 unit 的全部候选与状态
$ systemctl list-unit-files --type=timer | head -4
UNIT FILE                    STATE
fstrim.timer                 enabled
man-db.timer                 static
```

`FragmentPath` 指向主 unit 文件，`DropInPaths` 列出所有附加覆盖——升级后怀疑定制丢了，先看这两行，比翻目录快得多。`systemd-delta` 则是"开机后第一次巡检"的好帮手：三行输出直接告诉你本机有几处偏离原厂。基础篇讲过的服务名三系差异（Debian 的 `ssh` vs 其他系的 `sshd`）在 `list-unit-files` 输出里同样一眼可辨，不重复展开。

## 3. 依赖与启动事务

### 3.1 三种依赖的失败传染

依赖指令不止"要不要一起启动"，更重要的是**对方出事时把自己拖到什么地步**：

| 指令 | 对方激活失败 | 对方被停或崩溃 | 典型用法 |
|------|--------------|----------------|----------|
| `Wants=` | 自己照常启动 | 自己不受影响 | 弱关联：target 编组、可选配套 |
| `Requires=` | 自己不启动（配 `After=` 时） | 自己被一并停下 | 硬前置：数据目录、密钥代理 |
| `BindsTo=` | 自己不启动 | 自己被停——**任何原因**变 inactive 都算 | 绑死：设备拔出、网络接口消失 |

`Wants` 与 `Requires` 的分界是"失败是否传染"：`Wants` 的世界里 nginx 不在乎日志收集器起没起来，`Requires` 的世界里数据库挂了应用必须跟着退——否则就是"半个系统还在服务"的幽灵状态。`BindsTo` 比 `Requires` 更狠：`Requires` 主要防"启动失败"与"被显式停止"，`BindsTo`（通常搭配 `After=`）连对方自己崩溃都算数，设备 unit 与容器绑网络接口的场景非它不可。与包管理的依赖同理——`pacman -S` 拉起的是"安装"这一半，运行时的"谁崩了拖谁"是另一半账，声明式系统的可贵就在于这两半都写在配置里可审计。

### 3.2 `After` / `Before` 只管顺序

最高频的误解：给 unit 加一行 `After=network.target` 就以为"依赖网络就绪"了。`After` 只回答"同时要启动时谁先谁后"，它**不产生任何拉起关系**——对方不会因为这行而被启动，对方启动失败也不因此传染给你。要拉起必须配 `Wants` / `Requires`；要顺序才配 `After`；两者常常一起写，但职责截然分开。

另一层坑：`network.target` 只表示网络管理服务"已启动"，不等于网卡拿到了 IP。SSH、NFS、远程数据库这类"必须有地址才能干活"的服务，正确前置是 `network-online.target`，并且发行版要启用等待组件（`systemd-networkd-wait-online.service` 或 `NetworkManager-wait-online.service`），否则你会得到"重启后偶发起不来"的竞态——顺序声明写对了，等待动作没人执行，照样是碰运气。

### 3.3 target 编组与依赖图

target 是依赖的"打包点"：几十个服务各自 `WantedBy=multi-user.target`，开机只需要拉这一个 target，systemd 自己算出整张图。两张图是诊断的常规动作：

```bash
# multi-user.target 拉起了谁（开机全景）
$ systemctl list-dependencies multi-user.target
● multi-user.target
  ├─nginx.service
  ├─sshd.service
  └─...

# 谁拉起了我（反向追责：谁把我弄进启动序列的）
$ systemctl list-dependencies --reverse nginx.service
nginx.service
└─multi-user.target
```

### 3.4 事务性与失败回滚

一次 `systemctl start` 不是逐个点燃脚本，而是把依赖闭包算成一组 job，整体作为一个**事务**提交：全部满足才动手，任一必需环节失败，相关 job 一并取消——systemd 不允许系统停在"启动了一半"的状态，这正是声明式对脚本式的核心优势。启动卡住时未决的 job 队列可以直接看：

```bash
$ systemctl list-jobs
JOB UNIT                       TYPE   STATE
152 nginx.service              start  waiting     ← 在等它前面的环节
151 network-wait.service       start  running    ← 真正占着队的那个
```

排队不可怕，**排在一个永远完不成的 job 后面**才可怕——`waiting` 的 unit 是受害者，`running` 半天不退的才是嫌疑人。启动失败时 `status` 里的 `Dependency failed` 就是事务拒绝执行的签名，顺着第 3.1 节的表反查是 `Wants`（无害）还是 `Requires`（致命）即可定位断点。

## 4. drop-in 与模板单元

### 4.1 为什么必须走 drop-in

定制写进 `/usr/lib/systemd/system` 有三重代价：升级被还原（包管理器刷新自家领地天经地义）、`dpkg -V` 校验报警（你改了它的文件）、多机无从同步（你的改动混在原厂文件里，没法单独 diff）。drop-in 的机制是把覆盖放进 `/etc/systemd/system/<unit>.d/*.conf`——systemd 加载时按第 2.2 节的优先级叠罗汉，原厂文件一字不动，你的声明叠在上面。`systemctl edit` 就是这条路径的正式入口：

```bash
$ sudo systemctl edit nginx.service
# 自动创建并打开 /etc/systemd/system/nginx.service.d/override.conf
```

保存退出后的收尾顺序固定：`systemctl daemon-reload` → `systemctl restart`。无论改动来自编辑器直写还是 `systemctl edit`，把 reload 当成收尾动作最稳妥——它是幂等的，多跑一次无害，漏跑一次则 systemd 还抱着旧定义（第 7 节第一坑）。

### 4.2 一个完整的覆盖例子

```text
# /etc/systemd/system/nginx.service.d/override.conf
[Unit]
# 需要真实拿到 IP 后再启动（配合第 3.2 节的等待组件）
After=network-online.target
Wants=network-online.target

[Service]
# 环境文件由发行版约定放 /etc/default（Debian 系）或 /etc/sysconfig（RHEL 系）
EnvironmentFile=-/etc/default/nginx
# 资源笼头：内存上限，见第 5.3 节
MemoryMax=512M
# 失败自动拉起，参数联动见第 6.4 节
Restart=on-failure
```

`EnvironmentFile` 行的前缀 `-` 表示"文件不存在也不报错"——服务级配置里这是必备的宽容写法，否则一个可选文件缺失就能让服务起不来。若覆盖涉及 `ExecStart`，规则骤然变严：**exec 类指令在 unit 内必须唯一**，直接写第二条会被 systemd 拒绝加载（类似 `Duplicate ExecStart` 的报错），正确姿势是先置空再定义：

```text
[Service]
ExecStart=                       ← 这一行是清空，不是笔误
ExecStart=/usr/sbin/nginx -g 'daemon off;'
```

### 4.3 `systemctl edit` 的三种姿势与撤销

`systemctl edit nginx.service` 编辑（或创建）drop-in，是最常用的入口；`--full` 则把**整份** unit 拷到 `/etc` 再编辑——用于"要改的点太多、逐条 override 不划算"的场景，代价是从此与原厂文件分道扬镳，升级后的新默认值不再自动进来，要自己盯着；`--runtime` 把覆盖写进 `/run`，重启自动消失，是"想试一版又怕留坑"的灰度姿势。要全部撤销回到发行版原样：

```bash
$ sudo systemctl revert nginx.service   # 移除该 unit 的所有本地覆盖
$ systemd-delta | grep nginx            # 确认已无覆盖残留
```

### 4.4 模板单元：一份定义，N 个实例

文件名带 `@` 的是模板（如 `sshd-alt@.service`），它本身不直接启动，而是按参数实例化。下面自建一个多实例 SSH 的完整例子（路径与参数按目标发行版实际调整）：

```text
# /etc/systemd/system/sshd-alt@.service —— 自建模板，示意
[Unit]
Description=OpenSSH server (instance %i)
After=network.target

[Service]
ExecStart=/usr/sbin/sshd -D -f /etc/ssh/sshd_config.%i -o PidFile=/run/sshd-%i.pid
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```text
# /etc/ssh/sshd_config.2222 —— 实例配置必须自洽：
# sshd -f 指定后主配置 /etc/ssh/sshd_config 不再被读取，Port/HostKey 等要在本文件写全
Port 2222
HostKey /etc/ssh/ssh_host_ed25519_key
PasswordAuthentication no
```

```bash
$ sudo systemctl enable --now sshd-alt@2222
$ ss -tlnp | grep :2222                  # 监听确认
$ ssh -p 2222 alice@192.168.56.10        # 换端口登录
$ systemctl list-units 'sshd-alt@*'      # 已实例化清单
```

实例名的展开要分清两个占位符：`%i` 是按 systemd 转义规则处理过的实例名，`%I` 是还原后的原始实例名——实例名里可能带路径类字符时，**拼文件路径用 `%I`**，其余场景用 `%i`（发行版自带的 sshd 模板即是范本）。`%n`（完整 unit 名）、`%p`（去实例后缀的名字）、`%%`（字面 `%`）知道即可，查 `man systemd.unit` 的 "Specifiers" 一节全表可得。模板的收益在第 2 节的语境下很好理解：一份声明进版本库，多机多实例靠 `enable sshd@chat` 逐个派生，不再复制粘贴 N 份只差一行的配置。

## 5. cgroup 与进程归属

### 5.1 `status` 里的 CGroup 段

```bash
$ systemctl status nginx --no-pager | tail -8
     CGroup: /system.slice/nginx.service
             ├─1234 nginx: master process /usr/sbin/nginx
             ├─1240 nginx: worker process
             └─1241 nginx: worker process
```

这棵树就是 systemd 对该服务兑现声明的地方：master 与所有 worker 都在 `/system.slice/nginx.service` 这一格 cgroup 里。归属的含义有三层——**记账**（`status` 里的 Memory/CPU 数字聚合自这一格）、**限额**（第 5.3 节的配额作用于这一格）、**收割**（服务停止时 systemd 扫这一格，一个不留）。理解第三层，就理解了下一个问题。

### 5.2 kill 的两种语义

手起 `kill 1234` 只打死 master：worker 还活着，`Restart=on-failure` 又拉起新 master——老 worker 没人管理、新 master 端口冲突，典型的双开事故。`systemctl stop` 走的是 cgroup 收割：`KillMode=control-group`（默认）先给全组发 `SIGTERM`，等 `TimeoutStopSec`（默认 90 秒）仍未退出再补 `SIGKILL`——优雅退出的时间窗口就是给应用处理 `TERM` 的。运行中想给全组发信号而不重启：

```bash
$ sudo systemctl kill -s SIGUSR1 nginx    # 全组收到（如 nginx 热加载）
$ sudo systemctl kill --kill-who=main nginx  # 只给主进程，谨慎使用
```

手动 `kill` 与 `systemctl stop` 的分工由此明确：**日常运维只碰 `systemctl`**，手动杀进程仅限调试，且杀完永远跟一句 `systemctl status` 确认没有进入重启循环或僵尸 worker 残留。

### 5.3 资源笼头与 slice

配额指令（cgroup v2 统一命名，v1 时代的 `MemoryLimit` 已被 `MemoryMax` 取代）：

| 指令 | 作用 | 示例 |
|------|------|------|
| `MemoryMax=` | 内存硬上限，超限由内核 OOM killer 杀 cgroup 内进程 | `MemoryMax=512M` |
| `CPUQuota=` | CPU 均值上限，`50%` 即半核 | `CPUQuota=50%` |
| `TasksMax=` | 进程/线程数上限，防 fork 炸弹 | `TasksMax=128` |
| `AllowedCPUs=` | 绑定运行核心 | `AllowedCPUs=0-3` |

写在 drop-in 的 `[Service]` 里即对该服务生效；要给一组服务整体限配额，则用 slice：

```text
# /etc/systemd/system/db.slice —— 一组服务共享的配额容器
[Slice]
CPUQuota=200%
MemoryMax=2G
```

服务在 `[Service]` 段写 `Slice=db.slice` 即可入住——slice 是 cgroup 树的分支，配额在分支上生效、覆盖分支下所有单元，这与"仓库信任名单写一处、全家遵守"是同一种单点声明思路。一次性任务的临时笼头用 `systemd-run`：`systemd-run --scope -p MemoryMax=512M ./heavy-job` 当场拉起一个受限任务，不必先写 unit 文件。巡览工具配一对——`systemd-cgls` 看谁住在哪一格，`systemd-cgtop` 按用量排序揪出膨胀的那格：

```bash
$ systemd-cgtop | head -4
Path                                       Tasks   %CPU   Memory  Input/s Output/s
/                                            213   12.4     4.2G      -        -
/system.slice/nginx.service                    5    0.3   14.2M      -        -
/system.slice/postgresql.service-DB.slice      8    2.1    1.7G      -        -
```

这一眼看到的就是第 5.1 节那棵 cgroup 树的用量投影：哪一格内存异常、哪一格 CPU 持续高企，答案比在进程列表里大海捞针直接得多。

## 6. 故障诊断套路

### 6.1 逐行读 `systemctl status`

先看一份健康输出，把每个字段的"正常值"记牢，异常才一眼可辨：

```text
● nginx.service - A high performance web server
     Loaded: loaded (/usr/lib/systemd/system/nginx.service; enabled; preset: enabled)
     Active: active (running) since Mon 2026-09-29 08:00:12 CST; 3 days ago
       Tasks: 5 (limit: 4915)
      Memory: 14.2M (peak: 39.8M)
         CPU: 1min 23s
```

`Tasks` 行的 `limit` 是全机 `TasksMax` 上限，逼近它就要查 fork 失控；`Memory` 的 `peak` 记录历史峰值，是给 `MemoryMax` 定值的依据（第 7 节最后一坑）；`CPU` 是累计占用，配合运行时长可粗判负载水位。再看失败现场：

```text
● nginx.service - A high performance web server
     Loaded: loaded (/usr/lib/systemd/system/nginx.service; enabled; vendor preset: disabled)
     Active: failed (Result: exit-code) since Tue 2026-10-02 03:12:45 CST; 11min ago
    Process: 1234 ExecStart=/usr/sbin/nginx -g 'daemon off;' (code=exited, status=1/FAILURE)
   Main PID: 1234 (code=exited, status=1/FAILURE)
```

`Loaded` 行读三件事：路径（是否被 `/etc` 覆盖，对照第 2.2 节）、`enabled/disabled`（开机意图）、`vendor preset`（出厂默认）。`Active` 行是状态机：`active (running)` 常驻、`active (exited)` 一次性任务成功完成、`inactive (dead)` 未运行、`activating/deactivating` 过渡态、`failed` 失败——`failed` 后的 `Result:` 是第一个分诊字段：`exit-code` 看退出码（下一小节），`timeout` 是超时，`resource` 是配额打满（对照第 5.3 节）。

### 6.2 日志与事后取证

```bash
$ journalctl -u nginx -p err --since "10 min ago"   # 只看 err 及以上，先划小范围
$ journalctl -u nginx -f                            # 跟踪现场
$ systemctl show nginx -p Result -p ExecMainStatus -p NRestarts
Result=exit-code
ExecMainStatus=1
NRestarts=3
```

`show` 的三个属性是崩溃现场的最小证据集：失败类型、退出码、重启了几次。`NRestarts` 高说明应用在崩溃-重启循环里，方向是读应用自身日志找根因；journal 的持久化与检索姿势在基础篇[系统日志](../basic/log/syslog.md)展开，此处不重复。

### 6.3 启动慢定位

```bash
$ systemctl analyze blame | head        # 各 unit 耗时排行
$ systemctl analyze critical-chain nginx.service  # 它所在的真正关键路径
```

`blame` 的数字是**并行发生**的，不能相加当总时长——多个服务同时跑，排行榜只告诉你谁单点慢。要看"谁拖住了我"，`critical-chain` 沿依赖链逐层给出等待耗时，前缀 `+` 的是链上真实增量；`systemd-analyze plot > boot.svg` 输出全启动时间轴，浏览器打开即是一张图看清谁在串行等待。

### 6.4 退出码与重启限速

`Process:` 行的 `status=` / `signal=` 是高频签名：

| 签名 | 含义 | 第一步动作 |
|------|------|------------|
| `status=1/FAILURE` | 应用自身报错退出 | 读 journal 里退出前最后几行 |
| `status=203/EXEC` | `ExecStart` 路径不存在或无执行位 | 核对绝对路径（systemd **不走 PATH**） |
| `status=217/USER` | `User=` 指定的用户不存在 | 查 `/etc/passwd` 与 unit 拼写 |
| `signal=SIGKILL` | 被强杀：OOM 或 stop 超时补枪 | journal 找 `oom-kill` / `Killing process` |
| `code=timeout` | 启动超时 | `Type=notify` 服务没在 `TimeoutStartSec` 内就绪 |

崩溃循环的自动止损靠两条指令联动：`[Service] Restart=on-failure` 决定"失败就拉起"，`[Unit] StartLimitIntervalSec=30` + `StartLimitBurst=5` 决定"30 秒内崩满 5 次就放弃"——systemd 打出 `start request repeated too quickly` 后 unit 停在 `failed`，此时任何 `start` 都会被拒。处置顺序固定：读日志修根因 → `systemctl reset-failed nginx` 清除失败记账 → 再 `start`。不设限速的 `Restart=always` 等于让一台必崩的服务无限消耗磁盘与告警，限速与重启是同一张配置里的两半。

## 7. 常见坑

**改了 unit 文件不生效——忘了 `systemctl daemon-reload`。** 症状是配置明明写了、`restart` 也跑了，行为却还是旧的。systemd 只在 reload 时重新解析 unit 文件，之后的 `start/restart` 都基于内存里的旧定义。顺序永远是 `daemon-reload` → `restart/enable`；判定生效用 `systemctl show -p DropInPaths` 或 `systemctl cat` 的开头注释，别用"我刚才保存了"当证据。经 `systemctl edit` 的改动也按此收尾，reload 幂等无害。

**覆盖 `ExecStart` 直接写第二条——unit 加载被拒。** 报错形如 `Duplicate ExecStart`，服务直接起不来。exec 类指令在 unit 内必须唯一，覆盖时先写一行空的 `ExecStart=` 清空继承值，再写新的（第 4.2 节示例）。同理适用于 `ExecStop`、`Environment` 之外列表型可叠加指令——清空再定义是唯一安全姿势。

**`disable` 了开机还自启——能拉起你的不止 enable 一处。** 三个常见来源：被别的 unit `Wants=/Requires=` 连带（`systemctl list-dependencies --reverse <目标单元>` 反查）；enable 的其实是配套 `.socket` 单元，连接一来照样激活服务（`systemctl is-enabled ssh.socket` 对照 `ssh.service`）；unit 无 `[Install]` 段时 `is-enabled` 显示 `static`，disable 对它根本无效——它永远由依赖方决定生死。反查命令一条就能定案，比反复 disable/start 试运气高效得多。

**`stop` 卡住 90 秒后进程变 SIGKILL——应用不响应 `TERM` 或超时没调。** 症状是 `systemctl stop` 长时间悬挂，最终日志出现 `Killing process ... with SIGKILL`。两个方向二选一：应用侧实现优雅退出（捕获 `SIGTERM`、释放监听后退出）；systemd 侧按实际需要调 `TimeoutStopSec`（如数据库类可给 180s）并确认 `ExecStop` 的停止方式正确。被 SIGKILL 收尾的后果不止难看——正在进行的事务可能被拦腰截断，应用层的数据一致性只能靠自己的 journal 兜底。

**模板实例名对不上——`%i` 未展开或展开成意外值。** 症状是 `systemctl start sshd-alt@2222` 报 `Unit sshd-alt@2222.service not found`（模板文件名拼错，`@` 后没有可实例化的 `@.service`），或服务起来了但配置读的不是预期文件。验证两步：`systemctl cat sshd-alt@2222` 看展开后的完整定义，`systemctl status 'sshd-alt@*'`（通配）列出实际存在的实例。实例名含特殊字符时分清 `%i`（转义版）与 `%I`（原始版），拼路径用 `%I`——拼错的结果是 sshd 打开一个名字里带转义符的配置文件然后静默回退到默认值，端口对不上还查不出所以然。

**`MemoryMax` 配了服务还是被 OOM——限额小于应用真实需求。** 症状是服务运行数小时后死亡，journal 里留着 `Memory cgroup out of memory: Killed process ...` 或 `oom-kill` 痕迹，`Result:` 显示 `signal=SIGKILL`。限额不是拍脑袋的整数：先用 `systemctl status` 观察真实峰值（或 `MemoryPeak` 属性），给限值留出启动期与缓存的缓冲——把 `MemoryMax` 设得比应用稳态还小，等于给它装了定时炸弹。伴生陷阱是 `TasksMax`：太小会在 journal 里留下 `max ... tasks` 提示，应用侧表现为 `fork: retry: Resource temporarily unavailable`——限任务数是防 fork 炸弹的，不是省资源的。

## 参考资料

- systemd.unit(5) 官方手册 — [freedesktop.org](https://www.freedesktop.org/software/systemd/man/systemd.unit.html)
- systemd.service(5) 官方手册 — [freedesktop.org](https://www.freedesktop.org/software/systemd/man/systemd.service.html)
- Arch Wiki: Systemd — [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd)
- systemd 官方文档索引 — [freedesktop.org/software/systemd](https://www.freedesktop.org/software/systemd/)
- man systemctl / man systemd-delta / man systemd.resource-control
- 鸟哥的私房菜 — [linux.vbird.org](https://linux.vbird.org/)
