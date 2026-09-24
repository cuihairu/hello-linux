# 防火墙

防火墙是网络里最容易被"冤枉"的组件：
业务一不通，第一个被怀疑的往往是它；
可它同时也是第二容易被漏查的——
因为很多人只记得"我装了防火墙"，
却不记得"它默认放行什么、拦截什么"。

本篇从**连通性与排障**的视角讲防火墙：
它如何决定一个包能不能穿过本机，
三发行版的默认状态有何不同，
以及如何用证据证明"是/不是防火墙拦的"。
本页按"为什么连通性问题总要先问防火墙 →
三发行版的默认状态 → 三种规则模型：ufw、zone、nft →
连通性视角的排障路径 → 三发行版安装与启用对照 →
常见坑 → 何时去安全篇继续"展开，
三系给出 Debian/Ubuntu（ufw）、Arch（nftables）、
RHEL/CentOS/Rocky（firewalld）对照。

> 内容参考自 ufw、firewalld、nftables
> 官方文档与 Arch Wiki，见文末参考资料。

> **与安全篇的分工**：
> 规则设计原则、默认拒绝策略、速率限制、
> 审计加固等**安全策略**内容，
> 请阅读[安全篇 - 防火墙](../security/firewall.md)。
> 本页只解决"流量过不过得来、
> 为什么过不来、怎么验证"，
> 两页交叉引用、不重复展开。

## 学习目标

- 说清为什么连通性问题总要先问防火墙，区分"没听"与"被拦"
- 对照三发行版防火墙默认状态与工具（ufw / firewalld / nftables）
- 理解三种规则模型的差异：端口白名单、zone、nft 表链
- 掌握连通性视角的排障路径：服务监听 → 本机规则 → 路径验证
- 能用证据证明"是/不是防火墙拦的"，并与安全篇策略设计分工

## 1. 为什么连通性问题总要先问防火墙

Linux 内核的包过滤发生在**钩子点**（hook）上：
包从网卡进入（INPUT）、准备转发（FORWARD）、
发往本机进程、从网卡离开时，
都会依次经过规则表。
任何一条规则匹配并给出 `DROP`/`REJECT`，
包就到不了应用层——
于是在 `ss` 里能看到端口在 `LISTEN`，
`tcpdump` 在网卡上也能看到 SYN 进来，
但客户端就是收不到响应。

这就是为什么排障时要区分三个问题：

1. **服务在听吗？**
   —— `ss -tlnp`，属于应用与传输层。
2. **包到本机了吗？**
   —— `tcpdump -i eth0 port 80`，
   属于链路/网际层。
3. **包被谁丢了？**
   —— 防火墙规则或内核参数，属于本页内容。

三者的结论互相独立。
很多"防火墙的锅"其实是服务没起来，
反之亦然——
所以本页的第一个操作永远是**查状态**，
而不是急着改规则。

一个更完整的判断顺序是：
先用 `ss` 确认监听，
再用 `tcpdump` 确认包是否到达本机，
最后才看规则。
如果抓包里根本没有入站 SYN，
防火墙即使规则再严也"无从下手"——
问题在上游路径。
反过来，
若 SYN 到达、却没有任何响应出去，
而监听又正常，
嫌疑就高度集中在 INPUT/OUTPUT 链上。
把这三步固化成习惯，
可以避免最常见的两类误判。

## 2. 三发行版的默认状态

三大发行版对防火墙的出厂态度完全不同，
这是跨发行版维护时最常踩的坑：

| 发行版 | 默认工具 | 默认状态 | 底层实现 |
|--------|----------|----------|----------|
| Debian/Ubuntu | `ufw` | 已安装，但默认 **inactive**（未启用） | `iptables`/`nftables` 后端 |
| Arch | 无（自选） | 默认**不安装**任何防火墙 | 通常直接用 `nftables` 或 `ufw` |
| RHEL/CentOS/Rocky | `firewalld` | 已安装并**默认运行**，默认区域 `public` | RHEL 8+ 底层为 `nftables` |

由此产生的现象很直观：
同一份服务器镜像，
搬到 Ubuntu 上可能"全端口裸奔"
（因为 ufw 没开），
搬到 Rocky 上则"SSH 之外全被拦"
（因为 firewalld 的 public 区
默认只放行 ssh、dhcpv6-client、cockpit 等服务）。

**新机器第一件事永远是确认防火墙现状**：

```bash
# Ubuntu/Debian（ufw）
$ sudo ufw status verbose
Status: inactive

# RHEL/CentOS/Rocky（firewalld）
$ sudo firewall-cmd --state
running
$ sudo firewall-cmd --list-all
public (active)
  target: default
  icmp-block-inversion: no
  interfaces: eth0
  sources:
  services: ssh dhcpv6-client
  ports:
  protocols:
  ...
```

Arch 系没有统一命令，
直接看 `nftables` 与服务状态：

```bash
$ systemctl is-active nftables ufw
inactive
inactive
$ sudo nft list ruleset
# 无输出表示当前没有任何规则，全部流量放行
```

`nft list ruleset` 无输出是正常结果，
不代表命令失败——
它意味着内核里确实一张规则表都没有，
等于"完全不设防"。
理解这一点，
才能解释为什么裸装 Arch 对外网暴露面最大。

默认状态的差异也解释了"迁机事故"：
从 Ubuntu 搬到 Rocky 后，
原本通的 8080 端口突然不通，
往往不是配置丢了，
而是 firewalld 的 public 区
根本没放行这个端口。
反过来从 Rocky 搬到 Ubuntu，
又可能"莫名变得全通"——
因为接管者 ufw 压根没启用。
迁移清单里把"防火墙现状"单列一项，
比事后追查省事得多。

## 3. 三种规则模型：ufw、zone、nft

### 3.1 ufw：面向"应用配置文件"的极简模型

`ufw`（Uncomplicated Firewall）
是 Debian/Ubuntu 的默认前端，
把复杂规则抽象成
"端口/服务 + 允许或拒绝"两条主干。
它的设计目标是让 90% 的场景一条命令完成，
而不是暴露链、表、匹配器的全部细节。

```bash
# 安装与启用（Debian/Ubuntu 预装；
# Arch 可用 pacman -S ufw；RHEL 无此包）
$ sudo ufw allow 22/tcp
Rules updated
$ sudo ufw enable
Firewall is active and enabled on system startup
$ sudo ufw status numbered
Status: active

     To                         Action      From
     --                         ------      ----
[ 1] 22/tcp                     ALLOW IN    Anywhere
```

**关键点**：
`ufw allow` 默认对 `Anywhere` 生效，
且同时放行 IPv4/IPv6。
启用前务必先放行 SSH，
否则远程会话会立刻断开且无法重连——
这是 ufw 最经典的自锁事故。

ufw 还支持"应用配置文件"
（`ufw app list`），
它来自 `/etc/ufw/applications.d/` 下的定义，
比裸开端口更易维护。
Web 服务常用的 80/443
通常已有 `Nginx Full`、`Apache Full`
这类预置描述文件，
批量部署时直接引用即可，
不必逐条记端口号。

### 3.2 firewalld：以 zone 为中心的策略模型

`firewalld` 的核心抽象是**区域（zone）**：
每个区域代表一类网络环境的默认信任级别
（`public`、`home`、`work`、`trusted`、
`dmz`、`external` 等），
接口与源地址被绑定到某个区域后，
就继承该区域的放行清单。

这与"一条条堆规则"的思路不同——
它先问"这块网卡接的是什么网"，
再决定放什么。
信任级别跟着**位置**走，
而不是跟着单条连接走，
这对经常换网络环境的笔记本尤其自然：
插上网线是 `work`，
连上咖啡厅 Wi-Fi 自动切到 `public`。

```bash
# 查看区域与接口绑定
$ sudo firewall-cmd --get-active-zones
public
  interfaces: eth0

# 临时放行 HTTP（重载后失效）
$ sudo firewall-cmd --zone=public --add-service=http
success

# 永久放行并生效
$ sudo firewall-cmd --zone=public --add-service=https --permanent
success
$ sudo firewall-cmd --reload
success
```

忘记 `--permanent`
或忘记 `--reload` 是高频失误：
命令显示 `success`，
但重启或重载后规则消失；
反之，
只加了 `--permanent` 而不 `--reload`，
当前会话又看不到效果——
**两者必须配套**。
临时与永久的区分本身是刻意设计：
临时规则用于验证，
确认无误后再固化，
避免"一条命令把远程锁死"还没来得及反悔。

判断某接口属于哪个区，
还可以结合 NetworkManager 查看
（RHEL 系常见）：

```bash
$ nmcli -f GENERAL.CONNECTION,GENERAL.DEVICES device show
GENERAL.CONNECTION:               ens160
GENERAL.DEVICES:                  ens160
```

绑定关系可通过
`firewall-cmd --change-interface=eth0 --zone=internal`
调整。
接口换了区域，暴露面立刻改变——
迁移网段、增开网卡后这是必查项。

### 3.3 nftables：现代内核的原生语言

`nftables` 是 iptables 的继任者，
语法更统一（表 → 链 → 规则），
且同时覆盖 inet/ip/ip6 各地址族。
Arch 官方推荐直接使用它；
RHEL 8 之后 firewalld 的底层也已切换到
nftables；Debian/Ubuntu 同样可以
绕过 ufw 直接操作。

```bash
# 安装：Debian/Ubuntu 为 apt install nftables；
# Arch 为 pacman -S nftables；RHEL 为 dnf install nftables
$ sudo nft list ruleset
table inet filter {
  chain input {
    type filter hook input priority filter; policy accept;
    tcp dport 22 accept
    ip protocol icmp accept
  }
}
```

读懂这张表就掌握了 nft 的骨架：
`table inet filter`
是地址族为 inet 的过滤表；
`chain input`
是挂载在 input 钩子、优先级为 filter 的链；
`policy accept`
表示未被任何规则匹配的包默认放行
（改成 `drop` 即为白名单模式）。
一条规则一次写全"协议 + 端口 + 动作"，
不必像 iptables 那样分开指定 `-p`、`--dport`、`-j`。

nft 规则没有 ufw/firewalld
那样的"持久化层"，
重启即失——
生产上需把规则写进
`/etc/nftables.conf`
并 `systemctl enable nftables`，
否则下次开机规则全丢。
这是从 ufw 迁移到 nft 时最容易忽略的差异：
ufw 有 `ufw enable` 托底，
nft 只有你亲手写的文件。

## 4. 连通性视角的排障路径

当"端口不通"时，
按下面顺序取证，
通常两三步就能定位。

**第一步，确认监听**。
`ss -tlnp | grep :80`
看服务是否绑定在预期地址。
绑成 `127.0.0.1:80`
而客户端走公网 IP，
防火墙根本轮不到出场。

**第二步，确认防火墙状态与规则计数**。
ufw 看 `ufw status verbose`；
firewalld 看 `--list-all` 加 `--list-ports`；
nft 看 `nft list ruleset`。
若规则带计数器
（`iptables -L -n -v` 的 `pkts` 列持续增长），
说明包确实撞上了这条规则——
增长的是 ACCEPT 还是 DROP，
直接给出结论。

**第三步，抓包对照**。
在本机抓包，
若看得到对方的 SYN、
却没有 SYN-ACK 出去或被本机丢弃，
就能把责任锁定在本机策略或应用：

```bash
$ sudo tcpdump -ni eth0 port 80
tcpdump: verbose output suppressed, use -v or -vv for full protocol decode
listening on eth0, link-type EN10MB (Ethernet), capture size 262144 bytes
14:22:01.183421 IP 192.168.1.50.51234 > 192.168.1.100.80: Flags [S], seq 1829345678, win 64240, options [mss 1460], length 0
14:22:02.184561 IP 192.168.1.50.51234 > 192.168.1.100.80: Flags [S], seq 1829345678, win 64240, options [mss 1460], length 0
```

只有 SYN、没有响应，
且服务监听正常——
此时回头细查 INPUT 链/区域规则，
几乎总能找出一条 `DROP`。
反过来，
若抓包里连 SYN 都没有，
问题在客户端到本机之间的路径
（路由、对端防火墙、ARP），
与本机防火墙无关。
完整抓包判读方法见
[网络故障排除](./troubleshooting.md)。

还有一类容易忽略的情况：
规则确实放行了，
但**放行的对象不对**——
比如只加了 IPv4 的 allow，
客户端却走 IPv6 访问；
或者 zone 写对了、接口却绑定在另一个 zone。
核对时把"协议族 + 接口 + 区域 + 端口"
四个维度一次性对齐，
比反复增删同一条规则更快。

## 5. 三发行版安装与启用对照

需要补齐或更换防火墙时，
按下表操作。
Arch 一律用 `pacman -S`：

| 操作 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 安装 ufw | `apt install ufw` | `pacman -S ufw` | 不适用（非官方默认） |
| 安装 firewalld | `apt install firewalld` | `pacman -S firewalld` | `dnf install firewalld`（预装） |
| 安装 nftables | `apt install nftables` | `pacman -S nftables` | `dnf install nftables`（预装依赖） |
| 查看状态 | `ufw status` | `nft list ruleset` | `firewall-cmd --state` |
| 开机自启 | `ufw enable` | `systemctl enable nftables` | `systemctl enable firewalld` |

同一台机器**不要同时运行两套**
主动防火墙（例如 ufw 与 firewalld 同时 enable）。
两者都会写内核规则，
后写的覆盖先写的，
结果既难预测也难回滚——
排查时会看到
"我明明允许了，为什么还是不通"。
判断谁在实际生效，看服务状态即可：

```bash
$ systemctl is-active ufw firewalld nftables
inactive
active
failed
```

（未安装或未配置的服务可能显示
`failed` 或 `inactive`，属正常。）

如果你要从 ufw 迁到 nftables，
或从 firewalld 迁到纯 nft，
请先在维护窗口内导出现有规则
（`ufw status numbered`、
`firewall-cmd --list-all`、
`nft list ruleset`），
翻译成目标工具的等价规则，
在 `netplan try` 式的可回滚时机切换，
并保留旧配置至少一个发布周期。
两套规则并存期越短越好。

## 6. 常见坑

- **ufw 自锁**。
  远程机器上先 `ufw enable` 再 `allow 22`，
  会立刻断开自己的 SSH。
  正确顺序永远是：
  先 `ufw allow 22/tcp`，再 `ufw enable`，
  并在另一个会话验证成功后才关旧连接。
  云服务器还应同时检查安全组
  （安全组是另一层虚拟防火墙，
  ufw 管不到它）。
- **firewalld 改了没 reload，
  或只 reload 没加 `--permanent`**。
  两者症状相反，
  但都会让人误以为"命令没生效"。
  养成 `--permanent` 与 `--reload`
  成对执行的习惯。
- **zone 绑错接口**。
  把接公网的 `eth0` 从 `public`
  改成 `trusted`（或误改到 `home`），
  等于全端口放行；
  反之把内网网卡绑到 `drop` 区，
  会造成"同网段都不通"。
  迁移或热插网卡后，
  务必 `firewall-cmd --get-active-zones`
  复核绑定。
- **混用 iptables 与 nft 后端**。
  RHEL 8+、Ubuntu 22.04+ 的 `iptables`
  命令实际由 `iptables-nft` 包提供，
  写入的是 nftables 规则集。
  用 `iptables -L` 看到的规则，
  可能与 `nft list ruleset` 的一部分重叠，
  但两套工具的"持久化机制"完全不同——
  `iptables-save` 保存的规则
  不会自动被 nft 加载。
- **把"安全组/上游设备"当成系统防火墙**。
  云主机、宿主机网桥、物理交换机 ACL
  都可能拦流量。
  本机 `nft list ruleset` 干净
  不代表路径畅通，
  分层取证的原则在此同样适用。
- **IPv6 规则缺失**。
  ufw 与 nft 的 inet 族
  会同时处理 IPv6，
  但手写 `iptables` 时
  若只写 `ip6tables` 或只写 `iptables`，
  会出现"v4 通 v6 不通"的半残状态。
  验证时务必 `ping -6` 或 `curl -6`
  各测一次。

## 7. 何时去安全篇继续

本页解决了"流量为什么过不来"。
当你需要：

- 设计**默认拒绝 + 最小授权**的服务器基线策略；
- 为 SSH 加速率限制、封禁暴力破解来源；
- 保存/恢复规则并纳入配置管理；

请继续阅读
[安全篇 - 防火墙](../security/firewall.md)，
那里按策略设计而非连通性验证组织内容，
两页互为补充。
一句话概括分工：
**本篇回答"为什么不通"，
安全篇回答"应该怎么设"。**
两篇都读完，
你既能在故障现场快速取证，
也能在初始化机器时一次配对策略。

## 参考资料

- Arch Wiki - ufw — [wiki.archlinux.org](https://wiki.archlinux.org/title/Ufw)
- Arch Wiki - nftables — [wiki.archlinux.org](https://wiki.archlinux.org/title/Nftables)
- Arch Wiki - firewalld — [wiki.archlinux.org](https://wiki.archlinux.org/title/Firewalld)
- UFW Manual — [manpages.debian.org](https://manpages.debian.org/bookworm/ufw/ufw.8.en.html)
- firewalld 官方文档 — [firewalld.org](https://firewalld.org/documentation/)
- nftables wiki — [wiki.nftables.org](https://wiki.nftables.org/)
- RHEL 9 使用 firewalld 配置防火墙 — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_and_managing_firewalls/)
- `man ufw`、`man firewall-cmd`、`man nft`
