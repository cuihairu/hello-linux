# 网络篇

Linux 之所以能撑起今天绝大部分服务器与云基础设施，
一半功劳属于内核里那套成熟而透明的网络栈：
从网卡驱动、IP 路由查找，到 TCP 状态机和防火墙钩子，
几乎每一层都留下了可以观察、可以复现、可以调试的接口。
学习 Linux 网络，本质上不是背命令，
而是建立一条稳定的推理链——
当"网络不通"这句话出现时，
你知道该从哪一层开始问问题。

这一篇按"先懂模型、再会配置、然后能排障、最后谈服务"
的顺序组织。每一节都先解释**为什么这样设计**，
再给出**三发行版上怎么做**
（Debian/Ubuntu、Arch、RHEL/CentOS/Rocky），
并尽量附上真实的终端输出，
方便你对照自己机器的结果。

> 与 [安全篇](../security/README.md) 的分工：
> 本篇的[防火墙](./firewall.md)关注
> "流量为什么过不来、怎么验证是不是防火墙拦的"；
> 安全策略设计、加固与规则审计请阅读
> [安全篇 - 防火墙](../security/firewall.md)。

## 学习路线

网络知识天然是分层的，跳跃式学习容易留下盲区。
建议按下面的顺序推进，
每完成一站就回到终端做一次真实验证：

1. **建立模型**：先读[网络基础](./basics.md)，
   搞清 OSI/TCP-IP 分层为什么存在、
   一次数据包从发出到返回经过了什么、
   `ip` 和 `ss` 如何对应到模型的各层。
   这一站不求快，模型错了后面全是补丁。
2. **学会配置**：读[网络配置基础](./network-configuration.md)，
   理解 Netplan、systemd-networkd、
   NetworkManager（`nmcli`）、ifcfg
   四套配置方式各自解决什么问题，
   以及 DNS 解析从 `getaddrinfo()`
   到 `/etc/resolv.conf` 的完整路径。
3. **掌握排障**：读[网络故障排除](./troubleshooting.md)，
   把"本机 → 网关 → DNS → 远端"的推理链
   内化成肌肉记忆，
   并学会用 `tcpdump`、`traceroute` 拿到证据
   而不是猜测。
4. **守住边界**：读[防火墙](./firewall.md)，
   理解 ufw、firewalld、nftables 三系默认状态
   与 zone/规则模型，
   能够证明或排除"防火墙导致不通"。
5. **支撑业务**：按需阅读
   [网络监控](./network-monitoring.md)、
   [VPN](./vpn.md)、[负载均衡](./load-balancing.md)，
   这三篇分别对应"持续观测"、
   "跨可信域互联"、"水平扩展与高可用"
   三个生产场景。

如果你只有半小时，
建议只读[网络基础](./basics.md)的分层一节
和[网络故障排除](./troubleshooting.md)的推理链两节——
这两部分能解决日常八成以上的"上不了网"问题。

实际工作中，这五站往往不是一次性走完的：
新人入职先走前两站把机器跑起来；
第一次值班前把第三站过一遍；
服务器要对公网开放时补第四站；
流量起来之后再按需看第五站。
把每一站的结论沉淀成自己环境的检查清单，
比反复重读文档更有效。

## 子页导读

| 章节 | 一句话导读 | 适合谁 |
|------|-----------|--------|
| [网络基础](./basics.md) | 为什么需要分层，IP/子网/路由/DNS 栈，`ip` 与 `ss` 的观察路径 | 所有人的第一站 |
| [网络配置基础](./network-configuration.md) | Netplan / networkd / nmcli / ifcfg 三系对照，DNS 解析路径，路由与 VLAN | 要给机器配地址的人 |
| [网络故障排除](./troubleshooting.md) | 按"本机→网关→DNS→远端"推理，真实 `tcpdump`/`traceroute` 输出解读 | 值班与救火的人 |
| [防火墙](./firewall.md) | ufw/firewalld/nftables 三系默认、zone 与规则模型、连通性视角排障 | 怀疑"被墙了"的人 |
| [网络监控](./network-monitoring.md) | SNMP 场景、Prometheus + node_exporter、带宽与延迟的持续观测 | 要长期盯着网络的人 |
| [VPN](./vpn.md) | WireGuard/OpenVPN 实操，IPsec 概念，隧道如何与路由协作 | 远程办公与组网的人 |
| [负载均衡](./load-balancing.md) | L4/L7 差异、Nginx 与 HAProxy 选型、健康检查与 Keepalived | 要扛流量的人 |

各页均可独立阅读，
但配置页依赖基础页的概念，
排障页依赖前两页的命令基础，
建议不要跳读。

子页之间的引用是双向的：
排障页会指向防火墙页解释"包被谁丢了"，
监控页会指向排障页承接"告警之后怎么查"，
VPN 页与负载均衡页则复用配置页的路由知识。
带着"上一页的结论从哪来"去读，
比孤立地背每页的命令牢固得多。

## 学习目标

- 理解 OSI/TCP-IP 分层模型，能说清一个数据包从发出到返回经过了什么、`ip` 与 `ss` 对应哪一层
- 掌握 Netplan、systemd-networkd、nmcli、ifcfg 四套配置方式的适用场景，能独立配置地址、路由与 DNS
- 能按"本机 → 网关 → DNS → 远端"的推理链排障，会用 `tcpdump`、`traceroute` 拿到证据而不是猜测
- 掌握 ufw、firewalld、nftables 三系默认状态与 zone/规则模型，能证明或排除"防火墙导致不通"
- 了解 Prometheus + node_exporter 网络监控、WireGuard/OpenVPN 隧道与 L4/L7 负载均衡各自的分工
- 避开"`ufw` 装了就是开着"这类默认印象误区，以实际查询结果判断机器的防护与连通状态

## 三系网络工具速览

同一把工具在三大发行版中的包名和默认状态并不一致。
下面的对照表是本篇反复使用的"安装底座"，
后文各页涉及工具时不再重复解释包名差异：

| 任务 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 链路/地址/路由（`ip`） | `iproute2`（默认预装） | `pacman -S iproute2` | `dnf install iproute`（默认预装） |
| 套接字统计（`ss`） | 随 `iproute2` 提供 | 随 `iproute2` 提供 | 随 `iproute` 提供 |
| 抓包 `tcpdump` | `apt install tcpdump` | `pacman -S tcpdump` | `dnf install tcpdump` |
| 路径追踪 `traceroute` | `apt install traceroute` | `pacman -S traceroute` | `dnf install traceroute` |
| 持续追踪 `mtr` | `apt install mtr-tty` | `pacman -S mtr` | `dnf install mtr` |
| 端口扫描 `nmap` | `apt install nmap` | `pacman -S nmap` | `dnf install nmap` |
| 带宽测试 `iperf3` | `apt install iperf3` | `pacman -S iperf3` | `dnf install iperf3` |
| DNS 查询 `dig` | `apt install dnsutils` | `pacman -S bind` | `dnf install bind-utils` |
| 默认防火墙 | `ufw`（预装但默认未启用） | 默认无，自选 `nftables`/`ufw` | `firewalld`（默认启用） |
| 默认网络管理器 | Netplan + NetworkManager/networkd | 多为 systemd-networkd | NetworkManager（`nmcli`） |

两个高频误区值得在起点就说清楚。

**"预装"不等于"在用"**。
Ubuntu 的 `ufw` 装好后默认是 `inactive`，
很多云镜像还会额外关掉它；
Arch 则干脆不预装防火墙，
裸机直接暴露全部端口。
判断某台机器的防护状态，
永远以实际查询结果为准，
而不是发行版的"默认印象"。

**包管理器命名习惯不同**。
Debian 系是 `apt install`，
RHEL 系在 8 之后统一为 `dnf install`
（`yum` 是兼容前端），
Arch 系是 `pacman -S`。
本篇统一以 `pacman -S` 写出 Arch 的安装动作，
避免读者误以为 Arch 也有 `apt`。
换发行版作业时先改这行肌肉记忆，
能省下大量"命令不存在"的挫败。

验证工具链是否就绪，
可以用一条命令快速体检：

```bash
for t in ip ss ping traceroute dig tcpdump; do
  command -v "$t" >/dev/null && echo "OK   $t" || echo "MISS $t"
done
```

缺失的按上表补齐即可。
`ip` 与 `ss` 来自同一个包，
通常一荣俱荣、一损俱损——
如果 `ss` 不在而 `ip` 在，
优先怀疑 PATH 或别名，而不是包损坏。

## 阅读约定

- **真实输出优先**：示例输出取自典型的局域网环境
  （`192.168.1.0/24`，网关 `192.168.1.1`），
  你机器上的地址不同属正常，
  重点看字段结构与状态含义。
- **命令可复制**：所有命令默认在现代 systemd 发行版上有效；
  涉及旧工具（如 `netstat`、`ifconfig`）时
  会注明其所属的 `net-tools`/`wireless-tools` 包
  以及被 `ss`/`ip` 取代的原因。
- **不确定不写**：没有把握的版本差异、
  已废弃的参数一律不写，
  或明确标注"需按你的版本核实"。
- **先为什么后怎么做**：每章开头的概念段落
  与后面的命令同等重要，
  跳过概念直接抄命令，
  出问题时会失去判断力。

网络领域的"经验帖"过时极快：
十年前流行的调优参数今天可能有害，
某条命令在新内核上可能早已移除。
本篇只保留经得起版本变化的原理与主流工具，
凡是依赖特定版本行为的地方都会显式标注。
拿不准时，回到对应手册页（`man ip`、`man nft`）
永远比搜索引擎结果更可靠。

## 参考资料

- 鸟哥的私房菜 - 网络基础：
  <https://linux.vbird.org/linux_server/0110networkbasic.php>
- Arch Wiki - Networking：
  <https://wiki.archlinux.org/title/Networking>
- Arch Wiki - systemd-networkd：
  <https://wiki.archlinux.org/title/Systemd-networkd>
- RHEL 9 配置与管理网络：
  <https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_and_managing_networking/index>
- Netplan 官方文档：<https://netplan.readthedocs.io/>
- iproute2 手册页（`man ip`、`man ss`、`man tc`）
- systemd.network(5)、systemd-resolved.service(8)
