# 网络设备

"网络不通"排障时，多数人从 IP 和路由查起——这没错，但有一整类问题根本到不了协议栈：网线没插稳、链路协商成 100M 半双工、驱动没绑定、固件没加载、中断全挤在一个核上。本篇从**硬件视角**覆盖这些"包进入 Linux 网络栈之前"的事实：网卡结构、PCIe 挂载、驱动与 `ethtool`、中断与多队列、链路协商与无线法规域。IP 怎么配、路由与 DNS 怎么排、防火墙怎么看，属于[网络篇](../network/README.md)的分工——两篇合起来，才是从水晶头到应用层的完整链条。

> 内容参考自 Arch Wiki、ethtool 手册与内核网络文档，见文末参考资料。

## 学习目标

- 理解网卡的 PHY/MAC/DMA/PCIe 结构，知道一次收包在硬件上经历了什么
- 用 `lspci -k` + `ethtool -i` 确认设备与驱动绑定，排查"网卡识别不了"
- 熟练使用 `ethtool` 查看链路、统计、卸载与队列，能读懂错误计数的方向
- 理解中断亲和性与 RSS 多队列，会用 `irqbalance` 或 `smp_affinity` 优化收包路径
- 区分接口命名、无线法规域等硬件相关事实与网络篇的配置问题

## 与网络篇的分工

| 层次 | 本篇（硬件视角） | [网络篇](../network/README.md)（软件视角） |
|------|------------------|-----------------------------------------------|
| 物理/链路 | 网卡结构、PHY/MAC、双工协商、线缆与光模块 | — |
| 驱动 | `lspci -k`、`ethtool -i`、模块加载、固件 | — |
| 中断/DMA | IRQ 分摊、RSS 多队列、Ring Buffer、offload | — |
| 接口命名 | 为什么叫 `enp3s0` 不叫 `eth0`（硬件拓扑决定） | 接口如何配置地址与路由 |
| L3 及以上 | — | [网络配置](../network/network-configuration.md)、[故障排除](../network/troubleshooting.md)、[防火墙](../network/firewall.md) |

一个判断顺序的建议：先用本篇确认**硬件与驱动在不在、链路通不通**（`ip link` 看有没有 `UP`、`ethtool` 看有没有 `Link detected`），再带着"物理层已通"的前提进网络篇查地址、路由、DNS。反过来做，你会在网线松了的机器上抓半天包。本篇所有示例接口名以 `enp3s0` 为准，用 `ip link` 替换成你机器上的实际名字。

## 1. 网卡（NIC）的结构

### 1.1 组成与数据路径

```text
┌───────────────────────────────────────┐
│                 网卡                    │
│  ┌─────────┐  ┌─────────┐  ┌───────┐ │
│  │RJ45/SFP│→│  PHY    │→│  MAC   │ │
│  │ 物理接口 │  │ 物理层  │  │控制器  │ │
│  └─────────┘  └─────────┘  └───┬───┘ │
│                               ↓       │
│  ┌────────────────────────────────┐  │
│  │   DMA 引擎（直接读写主机内存）     │  │
│  └────────────────┬───────────────┘  │
│                   ↓                   │
│  ┌────────────────────────────────┐  │
│  │   PCIe 接口（挂到 CPU/芯片组）    │  │
│  └────────────────────────────────┘  │
└───────────────────────────────────────┘
```

| 组件 | 功能 | 排障意义 |
|------|------|---------|
| PHY | 物理层信号收发（编码、自协商） | 双工/速率协商错误的现场 |
| MAC 控制器 | 帧封装解封、CRC 校验 | `ethtool -S` 的错误计数来自这层 |
| DMA 引擎 | 把帧直接搬进主机内存，不经 CPU 拷贝 | 大流量下占内存带宽；IOMMU 关系到直通安全 |
| PCIe 接口 | 与主机互联 | `lspci` 的枚举对象；带宽 x1/x4/x25 影响万兆以上吞吐 |

收包路径串起来就是：PHY 收到信号 → MAC 校验成帧 → DMA 写入预分配的 Ring Buffer（环形缓冲）→ 触发中断/轮询通知内核驱动 → 驱动把 skb 交给内核协议栈。**本篇覆盖到驱动交付为止**；skb 之后的 IP/路由/TCP 归网络篇。理解这条路径，后面 `ethtool -G`（Ring 大小）、`ethtool -k`（卸载）、`/proc/interrupts`（中断）三个调优点才有坐标——它们分别作用在 DMA 缓冲、MAC 卸载和中断通知这三个硬件环节上。

### 1.2 网卡类型速查

| 类型 | 速率 | 接口 | 适用场景 |
|------|------|------|---------|
| 千兆 | 1 Gbps | RJ45 | 桌面与入门服务器，`igb`/`e1000e`/`r8169` 常见 |
| 万兆 | 10 Gbps | RJ45(SFP+) | 虚拟化宿主、存储网 |
| 25G/100G | 25/100 Gbps | SFP28/QSFP28 | 数据中心（Mellanox `mlx5` 常见） |
| 无线 | Wi-Fi 5/6/6E/7 | 天线 | 笔记本与 AP；受法规域约束（第 6 节） |

## 2. 认识网络硬件：从 lspci 到接口命名

### 2.1 lspci：设备与驱动的对账单

```bash
$ lspci -k | grep -A3 -i "Ethernet\|Network"
03:00.0 Ethernet controller: Intel I350 Gigabit Network Connection
        Subsystem: Intel I350 Gigabit Network Connection
        Kernel driver in use: igb        ← 驱动已绑定
        Kernel modules: igb
```

`Kernel driver in use` 那行是硬件排障的分水岭：**有它，设备已交给内核，接下来查链路与配置；没它，接口根本不会出现，该查驱动与固件**（第 4 节）。`lspci` 默认预装（`pciutils`），若缺失：Debian/Ubuntu 用 `apt install pciutils`，Arch 用 `pacman -S pciutils`，RHEL 用 `dnf install pciutils`。无线网卡对应 `lspci | grep -i network`，USB 网卡则用 `lsusb`（`usbutils` 包）。

### 2.2 接口为什么叫 enp3s0

Linux 2.6 以前以驱动探测顺序命名 `eth0`/`eth1`——**重启或加卡后顺序可能变**，这是老脚本最隐蔽的定时炸弹。现代 systemd 发行版默认启用**可预测命名**：基于固件/拓扑生成 `enp3s0`（onboard/PCI 以太网：`en` + PCI 位置 `p3s0`）、`wlp2s0`（无线）这类名字，含义固定——`enp3s0` 就是"PCI 总线 3 插槽 0 上的以太网口"，换卡换槽它会变，但"位置即身份"的规则不变。

```bash
ip link show   # 名字以这里为准，别照抄文档里的 eth0
# 2: enp3s0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 ... state UP
```

`<BROADCAST,MULTICAST,UP,LOWER_UP>` 中 **`LOWER_UP` 才代表"灯亮了"**：接口 `UP` 但没有 `LOWER_UP`，说明管理状态开了而物理链路没通——查网线、交换机口、对端配置。这个字段是硬件视角排障的第一个分叉点；拿到"物理已通"的结论后，IP/路由问题请转到[网络篇 · 故障排除](../network/troubleshooting.md)。

## 3. ethtool：与网卡对话

`ethtool` 读写网卡固件与驱动暴露的参数，是硬件视角的核心工具。三系安装包名一致：Debian/Ubuntu 用 `sudo apt install ethtool`、Arch 用 `sudo pacman -S ethtool`、RHEL/CentOS/Rocky 用 `sudo dnf install ethtool`，完整对照见第 7 节与 [README 速览表](./README.md)。

### 3.1 链路状态与驱动信息

链路状态用 `sudo ethtool enp3s0` 的关键字段判读：**`Speed: 1000Mb/s`、`Duplex: Full`、`Link detected: yes`、`Auto-negotiation: on`**——四项异常的排查路径见第 5 节，其中 `Duplex: Half` 几乎必错，`Speed` 掉到 100Mb/s 则要怀疑协商或线缆。驱动信息用 `ethtool -i` 查看：

```bash
$ sudo ethtool -i enp3s0
driver: igb
version: 5.15.0-1-generic        ← 驱动版本（对照厂商支持列表）
bus-info: 0000:03:00.0           ← 与 lspci 地址一致，可交叉验证
```

`ethtool -i` 与 `lspci -k` 应当互相印证：两边都指向同一驱动才算对账成功；`ethtool` 报 `Operation not supported` 或设备不存在，而 `ip link` 里有接口时，优先怀疑权限（多数查询要 root）或接口名拼错。

### 3.2 统计计数：错误往哪边涨

```bash
# 驱动统计（不同驱动字段名不同，抓关键错误项）
$ sudo ethtool -S enp3s0 | grep -E "rx_error|crc|drop|missed" | head -8
     rx_crc_errors: 0            ← 非零持续涨：线缆/电磁/对端问题
     rx_missed_errors: 0         ← 内核来不及取，Ring Buffer 可能偏小（3.4 节）
     tx_dropped: 0
```

判读方法是**趋势与方向**：`rx_crc_errors` 涨指向物理层（换线、查水晶头、查双工）；`rx_missed_errors`/FIFO 涨指向主机侧来不及消费（中断、Ring、CPU 饱和）；`tx_dropped` 涨指向协议栈以上（转去网络篇）。`ip -s link show enp3s0` 给出收发包总量的粗账，与 `ethtool -S` 的细分计数配合，先定量再定性。

### 3.3 速度、双工与自动协商

多数场景保持 `autoneg on` 即可——现代设备强制双工反而容易与对端不匹配。需要临时改时用 `sudo ethtool -s enp3s0 speed 1000 duplex full autoneg on`，**必须手工设置时交换机侧要同步改**：单边强制 1000/full、对边 autoneg 失败落到 100/half，是"网页偶尔卡死、大文件拷不动"的经典根因。光模块（SFP+）还有兼容性问题：非原厂模块可能被固件拒绝或速率异常，换模块先看 `dmesg` 与厂商 HCL（合格部件清单）。

### 3.4 Ring Buffer、卸载与多队列

```bash
sudo ethtool -g enp3s0                 # Ring：DMA 环当前/最大值
sudo ethtool -G enp3s0 rx 4096         # 调大 rx（重启失效，上限看 -g 输出）
sudo ethtool -k enp3s0                 # 卸载：tso/gso/gro/checksum 状态
sudo ethtool -K enp3s0 gro on tso on   # 一般开启；抓包分析时才考虑关 gro
sudo ethtool -l/-L enp3s0              # 多队列：查看/调整通道数（不超过 CPU 数）
```

三个参数的分工：**Ring** 管"内核来不及取时能垫多少"，**offload** 管"谁来做校验和与分段"，**channels/多队列** 管"收包能摊到几个核"。它们都由驱动实现，改完**不保证持久**——重启或 NetworkManager/systemd-Link 重读配置后回默认，持久化属于配置层（网络篇），临时排查才用 `ethtool -G/-K/-L`。

## 4. 网卡驱动与固件

### 4.1 常见驱动对照

| 驱动 | 支持的网卡 | 场景备注 |
|------|-----------|---------|
| `e1000e` | Intel 千兆（桌面/服务器） | 老牌稳定 |
| `igb` | Intel I210/I340/I350 千兆 | 服务器多口常见 |
| `ixgbe` | Intel 万兆 82599/X520/X540 | 10GbE |
| `i40e`/`ice` | Intel X710/X722、E810 | 25G/100G 世代 |
| `mlx5_core` | Mellanox/NVIDIA ConnectX-4/5/6 | 25G/100G、RDMA |
| `r8169` | Realtek 千兆 | 消费级主板集成 |
| `virtio_net` | 虚拟机半虚拟化网卡 | KVM/QEMU 访客 |

```bash
# 驱动状态与固件日志（失败的经典现象）
lsmod | grep -E "igb|ixgbe|mlx5|virtio_net"
sudo modprobe igb    # 手动加载
sudo dmesg | grep -iE "firmware|failed to load" | grep -iE "net|iwl|ath"
```

### 4.2 "网卡识别不了"的检查链

按顺序走，每步只有一个结论：① `lspci | grep -i ether` 有设备吗？没有 → PCIe 枚举问题（槽位/供电/直通配置），与驱动无关；② `-k` 有 `Kernel driver in use` 吗？没有 → 驱动未绑定：`lsmod` 看模块、`dmesg` 看加载报错、必要时 `modprobe` 手动加载，仍失败则查驱动对该芯片 ID 的支持（`lspci -nn` 拿到 `8086:1521` 类 ID 去比对驱动源码/发行版说明）；③ 有驱动但 `ip link` 无接口？→ 看 `dmesg` 是否 `firmware failed`（固件文件缺失，常见于部分无线卡与新网卡配老内核）、接口是否被 renaming 干扰（`dmesg | grep renamed`）；④ 接口在但 `LOWER_UP` 不亮？→ 回到第 3.3 节查协商，或换线换口。发行版仓库的驱动版本老时，**优先升级发行版内核**而不是随手编译第三方驱动——DKMS 与内核升级的兼容债务往往比驱动本身更贵；确认需要厂商驱动（如部分 Mellanox 固件工具）时，以厂商安装文档为准。

### 4.3 无线网卡的固件特殊性

多数 Wi-Fi 芯片的**固件运行在卡上**，由内核在初始化时从 `/lib/firmware/` 上传；固件缺失时接口存在却 `DOWN`，`dmesg` 有 `direct firmware load ... failed` 字样。Debian/Ubuntu 对 `firmware-iwlwifi`（Intel）等采用 free/firmware 分包，**最小安装常默认不带**——装完"没有无线"先补固件包；Arch 因 `linux-firmware` 默认安装较少遇到；RHEL/Rocky 在启用相应仓库后安装 `linux-firmware`。这是三系"无线表现不同"最常见的非黑魔法解释。

## 5. 中断、RSS 与收包路径调优

### 5.1 中断为什么值得关注

每个收包中断都消耗 CPU；如果全部中断落在同一个核（单队列老网卡、或 irq 分摊不均），该核 `sy` 飙高而其他核围观——瓶颈不在带宽，在**通知路径只有一根线**。现代网卡用**多队列 + RSS**（Receive Side Scaling，按流哈希把不同连接分到不同队列/中断）从硬件上并行化；运维要做的是确认队列数与中断分布是否匹配机器的核数：

```bash
# 中断计数按 CPU 分布（网卡行按驱动名 grep；全在 CPU0 即单核瓶颈）
grep -E "enp3s0|virtio|mlx5" /proc/interrupts
#            CPU0       CPU1       CPU2       CPU3
# 44:  12003455  11987632  11990210  12011089  IR-PCI-MSI  igb-TxRx-0
grep -E "NET_RX|NET_TX" /proc/softirqs   # 软中断（NET_RX 反映收包压力）
```

多数场景的默认答案是把分摊交给守护进程 irqbalance，安装三系对照如下——Debian/Ubuntu 用 `sudo apt install irqbalance`、Arch 用 `sudo pacman -S irqbalance`、RHEL/CentOS/Rocky 用 `sudo dnf install irqbalance`，然后 `sudo systemctl enable --now irqbalance` 即可。

### 5.2 irqbalance 与手工亲和性

判断"中断该谁管"之前，先明白两层机制的分工：**irqbalance** 是发行版默认带的守护进程，按负载周期性地把 IRQ 重新分摊到各核，省心但不保证与你的业务绑核策略一致；**手工亲和性**则把每个中断号钉死在指定 CPU 上，可预测、可复现，代价是要自己维护清单。两者只能选一个——同时开会导致绑定被悄悄改写。选择标准很简单：通用服务器用 irqbalance；延迟敏感或已用 `taskset`/NUMA 绑核的场景，停掉它改手工。

手工绑定的操作只有三步：先 `grep enp3s0 /proc/interrupts` 拿到中断号 N，停用 irqbalance（`sudo systemctl disable --now irqbalance`），再把十六进制掩码写进 `/proc/irq/N/smp_affinity`。这个文件是**位掩码，每个 bit 对应一个 CPU**：`1`=CPU0、`2`=CPU1、`4`=CPU2、`c`=CPU2+3——把 16 进制当十进制写（想要 CPU2 却写 `2`，实际绑到 CPU1）是最常见的静默错误，写完必须回读确认。多队列网卡要为每个 `igb-TxRx-N` 队列分别规划；中断号在重启/换卡后会变，手工清单需要维护——这也是把 irqbalance 当默认、手工仅作定向优化的原因。进阶的 XPS/RPS 软队列分流见内核文档，按需再读。

## 6. 无线：硬件视角

### 6.1 查看无线硬件与法规域

```bash
iw dev                     # 无线接口（phy 索引、MAC、当前信道）
iw phy phy0 info | grep -A20 "Supported"   # 支持的频段与信道列表
iw reg get   # 法规域 → country: CN 决定可用信道与功率；安装对照见第 7 节
```

**法规域（regulatory domain）是写进无线硬件的法律边界**：不同国家允许的信道与功率不同，国家码错了会出现"扫得到 AP 却连不上 5G 信道"或功率受限穿墙变差。`iw reg get` 与 `iwphy` 的频率列表对不上你预期的信道时，先查国家码再怪路由器。扫描与连接的**配置操作**（`nmcli`、`wpa_supplicant`）归[网络篇 · 配置](../network/network-configuration.md)，本篇只要求定位到"硬件支持什么、法规允许什么"这一层。

### 6.2 驱动与射频的常见事实

Intel 网卡走 `iwlwifi` + 固件（第 4.3 节），Realtek 走 `rtw88`/`rtw89` 等（部分需 DKMS，Arch 用户常从 AUR 补），Broadcom 部分芯片闭源驱动在 Debian 上要 `firmware-brcm80211`。笔记本的**硬件射频开关/Fn 快捷键**会把设备变成 `RFKILL` 状态——`ip link` 里接口在但 `STATE` 异常时，`rfkill list all` 查看 Soft/Hard block，这是纯硬件层问题，与 NetworkManager 无关：

```bash
rfkill list all   # 0: WLAN Soft blocked: yes → rfkill unblock；Hard = 物理拨钮
```

## 7. 三系差异速览

| 方面 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| `ethtool`/`iw` 安装 | `apt install ethtool iw` | `pacman -S ethtool iw` | `dnf install ethtool iw` |
| 默认网络配置层 | Netplan（`/etc/netplan/`，Ubuntu 服务器）；Debian 服务器常见 ifupdown/networkd | 多为 systemd-networkd 或 NetworkManager（自行选择） | NetworkManager（`nmcli`；RHEL 9 起统一） |
| 可预测命名 | 默认启用 | 默认启用 | 默认启用 |
| 固件包 | `firmware-*` 分包，最小安装可能缺失 | `linux-firmware` 默认较全 | `linux-firmware` |
| `irqbalance` | `apt install irqbalance` | `pacman -S irqbalance` | `dnf install irqbalance` |
| 防火墙（配置归网络篇） | `ufw` | 自选 `nftables`/`ufw` | `firewalld` |

注意本表只列**硬件视角的差异**：配置管理器与防火墙的完整对照见[网络篇](../network/README.md)的三系速览；本篇三系一致的原则是——`lspci`/`ethtool`/`ip` 的用法与 `/proc/interrupts` 的格式完全相同，差异只在包名、固件是否默认齐全、以及配置落在哪个管理器手里。

## 8. 常见坑

1. **脚本里写死 `eth0`。** 可预测命名下默认是 `enp3s0`/`ens33` 这类名字，且换卡会变——用 `ip link` 读取实际名，或用 MAC 地址/udev 规则做稳定别名（第 2.2 节）。
2. **`ip link` 显示 UP 却不通，忘了看 `LOWER_UP`。** 管理状态与物理链路是两回事；没有 `LOWER_UP` 就是没链路，去查协商与线缆，别先查路由（第 2.2 节）。
3. **`ethtool` 调完的参数重启就没了，以为驱动坏了。** 运行时参数本就不持久，持久化要交给 networkd/Netplan/NetworkManager 的 link 配置（网络篇）；临时排查用 `ethtool`，长期策略写配置文件（第 3.4 节）。
4. **强制 1G/full 单边改，把链路改出兼容性问题。** 双边协商规则不一致会落到 100/half，症状是"小流量正常、大流量极慢"；恢复 `autoneg on` 两边对齐（第 3.3 节）。
5. **手工绑定中断后不关 irqbalance。** 两个机制互相改写 `smp_affinity`，表现为"绑定莫名失效"——要么全交 irqbalance，要么停掉它自己管（第 5.2 节）。
6. **把 `smp_affinity` 当十进制写。** 它是**十六进制位掩码**：想要 CPU2 要写 `4` 而不是 `2`，写完必须回读确认（第 5.2 节）。
7. **虚拟机里找不到真实网卡驱动，或 `ethtool -k` 大量 unsupported。** VM 用的是 `virtio_net`/模拟设备，能力集与物理 NIC 不同，unsupported 的卸载项属正常——别拿物理机的调优清单硬套（第 4.1 节）。
8. **无线"驱动坏了"实为固件/法规域/射频开关。** 按第 4.3、6.1、6.2 节顺序查 `dmesg` 固件加载 → `iw reg get` 国家码 → `rfkill list`，三关都过再怀疑驱动本身。

## 参考资料

- Arch Wiki - Network configuration — [wiki.archlinux.org](https://wiki.archlinux.org/title/Network_configuration)
- Arch Wiki - Network configuration / Wireless — [wiki.archlinux.org](https://wiki.archlinux.org/title/Network_configuration/Wireless)
- Arch Wiki - irqbalance — [wiki.archlinux.org](https://wiki.archlinux.org/title/Category:Hardware)
- Arch Wiki - Improving performance（网络调优上下文） — [wiki.archlinux.org](https://wiki.archlinux.org/title/Improving_performance)
- Linux Kernel Networking Documentation — [kernel.org](https://www.kernel.org/doc/html/latest/networking/)
- ethtool(8) 手册 — [man7.org](https://man7.org/linux/man-pages/man8/ethtool.8.html)
- systemd.net-naming-scheme（可预测接口命名） — [freedesktop.org](https://www.freedesktop.org/software/systemd/man/systemd.net-naming-scheme.html)
- iw(8) 手册 — [kernel.org](https://www.kernel.org/doc/html/latest/networking/regulatory.html)
- 鸟哥的私房菜 - 连上因特网 — [linux.vbird.org](https://linux.vbird.org/linux_server/rocky9/0150networking.php)
- Red Hat - RHEL 9 网络性能调优 — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html-single/monitoring_and_managing_system_status_and_performance/index)
