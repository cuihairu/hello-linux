# 网络栈

`ss` 里那一行 ESTABLISHED、`tcpdump` 抓到的三次握手、ping 通网关时网卡的闪烁灯——这些行为都发生在内核网络栈里。[TCP/IP 要点](../network/tcpip-essentials.md)讲了协议"应该"怎样表现，本页回答的是这些表现"在哪几段代码里发生"：一个包从网卡 DMA 到进程 read 返回走了哪些函数，一条 tcp_sendmsg 调用如何穿过拥塞控制与队列纪律变成线缆上的比特。网络栈是内核里最庞大的子系统之一（net/ 目录的代码量长期仅次于 drivers/），但它的主干道其实只有两条——收与发，且两者结构不对称：收包是中断驱动的异步流水线（硬中断只做最小工作，重活交给软中断），发包是从系统调用一路同步调用下去的直通车。抓住这个不对称，三千个文件就缩成了两条路。本页按源码篇统一的五段式展开：核心数据结构、关键函数调用路径、源码阅读顺序、实操跟踪、延伸资料；函数名与文件位置均以 v6.12 源码为准核对过，老书对不上的地方会随时标注。

> 内容参考自内核源码树（v6.12）与延伸书目（概念框架），见第 7 节延伸资料。

## 学习目标

- 说出内核网络栈的两半结构（net/core/ 设备无关层与 net/ipv4/ 协议族）与收发不对称的原因
- 认识 sk_buff、sock、net_device 三大主角，并把 ss 的输出列对应回结构体字段
- 沿收包路与发包路各走一遍完整函数链，知道 tcpdump 的抓包点卡在哪一步
- 用 /proc/softirqs、mpstat、bpftrace、ss -tin 四件工具把栈的运行态亲眼看到
- 识别"老文章函数名对不上""loopback 抓到巨包""单核软中断打满"这类高频困惑的根源

## 1. 内核网络栈的分层真相

教科书用 OSI 五层或 TCP/IP 四层讲网络，那张图是给协议设计者看的；内核源码的真实切分是另外两刀。第一刀切在**设备无关层与协议族之间**：net/core/ 里的代码不关心你跑的是 IPv4、IPv6 还是纯以太网帧，它负责 skb 的分配回收、软中断调度、流量整形这些"物流基建"；net/ipv4/、net/ipv6/ 才是"协议业务"，ip_rcv 与 tcp_v4_rcv 都住在这里。第二刀切在**收与发之间**，而且两边不对称——这正是初学者最容易被老文章误导的地方。发包路径是同步的：进程在系统调用里调用 tcp_sendmsg，一路函数嵌套走到网卡驱动的发送函数，除非队列满了否则不停；收包路径是异步的两段式：网卡的硬中断只做一件事（关中断、调度 NAPI 轮询），真正的收包、协议解析、socket 入队都发生在稍后的软中断上下文里（NET_RX_SOFTIRQ）。为什么这样设计？10 Gbps 网线每秒可来上百万个包，如果每个包都占住 CPU 跑完整条协议栈，中断开销会吃掉一切——中断只敲门，软中断按预算批量干活（每轮 net_rx_action 有 net.core.netdev_budget 张"粮票"），这是吞吐与延迟之间的工程折中。

为什么发包可以同步、收包却必须异步？两侧的"时间预算"根本不同：发包发生在发起方自己的进程上下文里，慢一点损失的只是这个进程的延迟，系统调用框架天然给它设了预算；收包没有"自己的进程"——包是给全机的，来得又急又密，若在中断里做完整协议解析，等于让全机为网卡打工。把无主的急事卸载到软中断、让有主的慢事留在调用栈，这个判断贯穿了内核里几乎所有中断处理的分层设计（中断下半部的通论见[跟踪工具](./tracing-tools.md)对 softirq 的背景介绍）。

还有一层位置关系要先立住：本页讲的是内核里从设备驱动到 socket 队列的这段；再往上，进程里的 read()/recvmsg() 从 socket 队列取数据、sendmsg() 把数据交给 tcp_sendmsg——那是系统调用篇的领地（入口机制见[跟踪工具](./tracing-tools.md)的 strace 一节）。而 ss、netstat 看到的每一个 socket，就是本页第 2.2 节 struct sock 的用户态投影：你观察网络的日常工具，全部建立在这几个数据结构之上。最底层的 /proc/net/tcp 与 ss 数据同源，端口以 16 进制记录，是"直接看账本原文"的调试手段：

```bash
$ ss -tln sport = :80
State   Recv-Q Send-Q Local Address:Port  Peer Address:Port
LISTEN  0      128            0.0.0.0:80           0.0.0.0:*
$ head -2 /proc/net/tcp
  sl  local_address rem_address   st tx_queue rx_queue ... 
   0: 00000000:0050 00000000:0000 0A 00000000:00000000 ...   # 0050 = 80，0A = LISTEN
```

## 2. 核心数据结构（五段式 ①）

### 2.1 sk_buff：一只会剥壳的行李箱

sk_buff（习惯简称 skb，定义在 include/linux/skbuff.h）是网络栈里万能的数据包容器——收到的每个包、待发的每段数据，旅途中都装在一只 skb 里。它最精妙的设计不是装数据本身（数据只是一块线性缓冲，高端口场景还有 frag 分片列表），而是**用指针在缓冲里滑动来"剥壳"**：缓冲区从 head 到 end 整体预留，skb->data 指向当前协议层的负载起点。收到以太网帧时 data 从链路头之后开始；ip_rcv 处理完 IP 头，skb_pull 把 data 往前推过 IP 头，tcp_v4_rcv 看到的 data 就直指 TCP 段负载——每剥一层头只是挪一次指针，零字节拷贝。反过来说，发包路径在缓冲头部预留的 headroom 正是为逐层"戴壳"准备的（每一层 skb_push 一次，把新头写进预留空间）。分层处理零拷贝的机关就在这两个指针的进退之间，值得专门盯一分钟。

skb 是网络栈里分配最频繁的对象（每秒百万次量级），它从专门的 slab 缓存 skbuff_head_cache 里出生——内存管理那套 slab 分配器最繁忙的客户就是网络栈。缓冲区内部的四个标记决定了"壳"在哪：

```text
        skb->head                         skb->end
           │                                │
           ▼                                ▼
      ┌────┬──────────────┬───────────┬─────┐
      │head│   headroom   │ data area │tail │   tailroom
      │room│  （戴壳预留） │  ←data    │room │
      └────┴──────────────┴───────────┴─────┘
              skb_push：data 前移，向缓冲区"要"一层头（发包戴壳）
              skb_pull：data 后移，把一层头让出缓冲区（收包剥壳）
              skb_reserve：构造时把 data 挪开，划定 headroom 起点
```

另一条高频路径是 skb_clone 的浅拷贝：tcpdump 想抓的包、netfilter 想审的包、转发给多播的包，各自领一只新壳（sk_buff 头），数据缓冲靠引用计数共享，谁真正要改数据（比如分片时写新头）才深拷贝。"读的人多、改的人少"是网络栈零拷贝哲学的第二幕——第一幕是上文的指针滑动。内核自带的 Documentation/networking/skbuff.rst（v6.12 树内已核对存在）是这份设计的官方说明书。

### 2.2 sock 家族：ss 看到的就是它

struct sock（include/net/sock.h）是一个 socket 在内核里的全部状态。TCP 的 sock 叫 tcp_sock、UDP 的叫 udp_sock，它们并不"继承"自 sock——C 没有继承——而是把 struct sock 作为结构的第一个成员嵌进去，指针一转就能在两种视角间切换（内核宏 tcp_sk(sk) 干的就是这件事，容器里套容器的"贫富继承"）。对本章最重要的字段是两条队列：sk_receive_queue（收妥待取的数据）与 sk_write_queue（已发出待确认的数据）——**ss 输出里的 Recv-Q 与 Send-Q 就是这两条队列的长度**。sk_state 字段则与 ss 的 STATE 列一一对应，TCP 的连接状态机（SYN_SENT、ESTABLISHED、TIME_WAIT 那套，协议语义见 [TCP/IP 要点](../network/tcpip-essentials.md)）在内核里就是这个整数字段在 switch 里流转：

| sk_state（TCP 值） | ss 显示 | 含义 |
|---|---|---|
| TCP_ESTABLISHED | ESTAB | 双向在传 |
| TCP_SYN_SENT / TCP_SYN_RECV | SYN-SENT / SYN-RECV | 握手进行中 |
| TCP_FIN_WAIT1 / TCP_FIN_WAIT2 | FIN-WAIT-1/2 | 本端已发 FIN |
| TCP_CLOSE_WAIT / LAST_ACK | CLOSE-WAIT / LAST-ACK | 对端 FIN、本端未关 |
| TCP_TIME_WAIT | TIME-WAIT | 等待 2MSL 收尾 |
| TCP_CLOSE / TCP_LISTEN | CLOSED / LISTEN | 关闭 / 监听中 |

TCP 还在 sock 里维护拥塞控制的全套账本（snd_cwnd、ssthresh、RTT 采样），这些字段通过 getsockopt(TCP_INFO) 导出为 struct tcp_info（include/uapi/linux/tcp.h），`ss -tin` 打印的 rtt、cwnd、retrans 列正是这份结构体的逐字段转写——你在运维里读的每一列，源码里都有一个同名的账本字段。

### 2.3 net_device：一张网卡的抽象

struct net_device（include/linux/netdevice.h）代表一块网卡——物理的、虚拟的（veth/bridge/WireGuard）都算，`ip link` 列出的每一行就是一个 net_device。它身上挂着驱动的收发函数指针、队列统计数据（ethtool -S 读的就是这些计数器），以及本章主角之一的 NAPI 结构：struct napi_struct 里的 poll 函数指针就是软中断批量收包时被 net_rx_action 反复调用的那个回调——"中断敲门、轮询干活"的混合模型，挂点就在 net_device 身上。v6.12 树内的 Documentation/networking/napi.rst 详细讲了这套机制的现代形态。

### 2.4 net_namespace：容器网络的地基

最后一号主角只需认识：struct net 资源隔离了整套网络设备、路由表、iptables 规则与 socket 哈希表，clone(CLONE_NEWNET) 创建新 netns，`ip netns exec` 进入其中。容器网络（veth 对、bridge）全部搭在这块地基上，本页不展开，见[网络配置基础](../network/network-configuration.md)第 10 节的边界讨论。

## 3. 关键函数调用路径（五段式 ②）

### 3.1 收包路：从网卡中断到 socket 队列

```text
网卡 DMA 收帧到 ring buffer
  → 硬中断：驱动 handler 调 napi_schedule()，立即返回     ← 中断上下文，几十纳秒量级
  ─────────────── 异步分界线 ───────────────
  → NET_RX_SOFTIRQ 触发 → net_rx_action()                 ← 软中断上下文
      （net/core/dev.c，按 netdev_budget 预算批量处理）
  → 驱动的 napi->poll()：从 ring buffer 批量取帧，包成 skb
  → netif_receive_skb() → __netif_receive_skb_core()      ← net/core/dev.c
      ├─ 途经 ptype_all 交付点：AF_PACKET 在此克隆——tcpdump 抓到的就是这份
      └─ 按 ethertype 分派到注册的协议处理函数（IPv4 即 ip_rcv）
  → ip_rcv()                                              ← net/ipv4/ip_input.c
      └─ NF_INET_PRE_ROUTING 钩子（netfilter/nftables 在此介入，见安全篇防火墙）
  → ip_rcv_finish：查路由 → dst_input()
  → 本机交付：tcp_v4_rcv()                                 ← net/ipv4/tcp_ipv4.c
      └─ __inet_lookup_skb()：按四元组在 established 哈希表里找 sock
  → tcp_v4_do_rcv → tcp_rcv_established：序号检查、ACK 处理
  → 数据入 sk->sk_receive_queue，sk_data_ready 唤醒等待的进程
  → 用户态 read()/recvmsg() 返回                            ← 回到系统调用篇的领地
```

这条链有三个理解要点。**第一，异步分界线**：硬中断与软中断之间是收包路径的灵魂——高负载机器上 mpstat 的 %soft 列能直接看到软中断吃掉多少 CPU，那是 net_rx_action 与它的 poll 循环在工作。**第二，抓包点**：tcpdump（AF_PACKET 协议族）的收包 tap 在 __netif_receive_skb_core 的交付链上，发包 tap 在 dev_queue_xmit 一侧——所以抓包是"路过照相"，不改变路径本身。**第三，查找即归属**：tcp_v4_rcv 里 __inet_lookup_skb 用（源 IP、源端口、目的 IP、目的端口）四元组在哈希表里找到 sock，这个包从此属于那个 socket；找不到监听者，内核回一条 RST——你在客户端看到的 Connection refused，出生地就在这几行（协议侧语义见 [TCP/IP 要点](../network/tcpip-essentials.md)）。

### 3.2 发包路：从 tcp_sendmsg 到网卡

```text
tcp_sendmsg()                                    ← net/ipv4/tcp.c
    把用户数据拷进 sk_write_queue（Send-Q 增长即此）
  → tcp_push() → tcp_write_xmit()                ← net/ipv4/tcp_output.c
      拥塞窗口 cwnd / 通告窗口 / Nagle 把关：决定"现在发多少"
  → __tcp_transmit_skb()：封装 TCP 头、计算校验和
  → __ip_queue_xmit()                            ← net/ipv4/ip_output.c
      查路由、封 IP 头（skb_push 用上 headroom）
  → ip_local_out → NF_INET_POST_ROUTING 钩子（netfilter 出口审查）
  → ip_finish_output2 → neigh_output()           ← net/core/neighbour.c
      需要时触发 ARP 解析下一跳 MAC
  → dev_queue_xmit()                             ← net/core/dev.c
      → qdisc 排队（默认 noqueue/fq_codel，net/sched/ 里的排队规则）
  → 驱动 hard_start_xmit：DMA 到网卡，线缆上见
```

发包是同步的：除了 qdisc 可能排队，这条链在 tcp_sendmsg 的调用栈里一气呵成。两个值得驻足的关卡：**tcp_write_xmit 是拥塞控制的执行点**——所有教科书里"cwnd 满了就等 ACK"的叙述，落地就是这个函数拿着 snd_cwnd 与已发未确认的字节数做比较；**neigh_output 是三层与二层的换乘站**——IP 头里写的是对端地址，帧头里写的是下一跳 MAC，ARP 缺口在这里现场补票。顺带一提，发包 tap（dev_queue_xmit_nit）也在 dev_queue_xmit 路径上，与收包侧对称。

## 4. 源码阅读顺序（五段式 ③）

第一站 **net/core/dev.c 的 __netif_receive_skb_core 一段**（收包主干道，v6.12 在 5457 行附近）：看 skb 如何被交付给 ptype_all 与协议处理函数，这段是整个收包路径的枢纽。第二站 **net/ipv4/ip_input.c 全文**：这个文件很短，ip_rcv 只做基本合法性检查然后交给 netfilter 钩子，读完能建立"协议处理函数=注册进 ptype_base 的回调"的正确心智。第三站 **net/ipv4/tcp_ipv4.c 的 tcp_v4_rcv**（v6.12 在 2176 行附近）：看四元组查找、TIME_WAIT/ACK 快速路径、socket 锁与入队的完整编排。第四站 **net/ipv4/tcp.c 的 tcp_sendmsg 只看骨架**：主循环里"拷数据、更新序号、按需 push"三步走，细节（紧急数据、zerocopy）全部跳过。两件事不要做：不要按目录顺序通读 net/（会在 drivers 的汪洋里溺死），不要一头扎进 netfilter 的钩子宏（知道 PRE_ROUTING/POST_ROUTING 两个位置存在即可，策略面在[防火墙](../security/firewall.md)）。读收包链时把 `ss -s` 与 /proc/net/sockstat 开在旁边——代码里每读一个队列或计数器，就到运行态里找它的投影，这种互证是源码篇反复强调的读法。在线阅读与跳转用 [elixir.bootlin.com](https://elixir.bootlin.com/linux/v6.12/latest/source)，环境搭建见[源码获取与目录导读](./source-tree.md)，想在函数上打断点看现场则见[跟踪工具](./tracing-tools.md)的 gdb 一节。

## 5. 实操跟踪（五段式 ④）

**实验一：看软中断分账。** /proc/softirqs 是内核按 CPU 记账的软中断流水，NET_RX 与 NET_TX 两行就是网络栈的收发计数器。前后对比一次 curl，两行的增长清晰可见：

```bash
$ grep -E "NET_RX|NET_TX" /proc/softirqs
             CPU0       CPU1       CPU2       CPU3
NET_RX:    1204819    1187455    1198230    1179902
NET_TX:     811203     792418     803115     798764
$ curl -s https://www.kernel.org/ > /dev/null && grep -E "NET_RX|NET_TX" /proc/softirqs
NET_RX:    1205841    1187455    1200089    1179902   # 收包记账在处理的 CPU 上增长
NET_TX:     811377     792418     803115     798764
```

注意增长的只落在个别 CPU 列——网卡队列与 CPU 的亲和是绑定的，这正是第 6 节"单核 %soft 打满"坑的伏笔。

**实验二：亲眼看见抓包点。** tcpdump 能抓到包，是因为 AF_PACKET 在 __netif_receive_skb_core 的交付链上拿到了一份克隆。把因果演一遍：

```bash
# 终端一：抓 53 端口的包
$ sudo tcpdump -i any -nn -c 5 port 53
# 终端二：发起一次 DNS 查询
$ dig +short www.kernel.org A
139.178.84.217
# 终端一回放：
13:41:02.114301  ens33  Out 192.168.56.20.46561 > 223.5.5.5.53: 58934+ A? www.kernel.org. (33)
13:41:02.131882  ens33  In  223.5.5.5.53 > 192.168.56.20.46561: 58934 1/0/0 A 139.178.84.217 (49)
```

Out 方向的 tap 在 dev_queue_xmit 一侧、In 方向在 __netif_receive_skb_core——两个方向各照一次相，路径本身分毫未动。

**实验三：软中断的 CPU 分布。** mpstat 的 %soft 列是 net_rx_action 的负载表（sysstat 包，三系同名）。高 PPS 场景常见单核 90%+ 而其余核闲置——处理软中断的 CPU 由网卡队列映射决定，扩队列（ethtool -L）或开 RPS（把 /sys/class/net/ens33/queues/rx-0/rps_cpus 设成多核位图）是标准处置：

```bash
$ mpstat -P ALL 1 3 | grep -E "CPU|Average"
Average:  CPU     %usr     %sys    %soft    %idle
Average:  all    12.41     4.10     6.02     71.30
Average:    0     3.12     2.03    23.87     64.50   # NET_RX 集中在 CPU0 的典型形态
```

**实验四：给 tcp_v4_rcv 打点计数。** bpftrace 一个 kprobe 就能统计收包入口被哪些 CPU 频繁穿过（内置变量 cpu 是 CPU 编号；探针工具的背景见[跟踪工具](./tracing-tools.md)）：

```bash
$ sudo bpftrace -e 'kprobe:tcp_v4_rcv { @[cpu] = count(); }'
Attaching 1 probe...
^C
@[0]: 4187
@[2]: 22
```

**实验五：读 socket 的账本。** ss -tin 直接转写 struct tcp_info：rtt/rttvar 是往返时延采样，cwnd 是拥塞窗口现状，retrans 是重传计数——第 2.2 节说的"ss 每一列对应一个结构体字段"在这里兑现：

```bash
$ ss -tin state established '( dport = :443 )'
Estab  0  0  192.168.56.20:47126  142.250.66.163:443
  cubic rto:386 rtt:28.6/13.2 ato:40 mss:1448 pmtu:1500 rcvmss:1328
  cwnd:10 bytes_acked:19617 segs_out:19 segs_in:24 send 4.03Mbps lastsnd:198 lastrcv:198
```

cubic 一词是拥塞控制算法自报家门，cwnd:10 与 rtt:28.6 相乘约等于可用发送速率——send 4.03Mbps 列就是内核替你算的带宽积公式。

## 6. 常见坑

**老文章把 netif_rx 当收包主干。** v6.12 里 netif_rx 仍在 net/core/dev.c，但它是 loopback 等非 NAPI 场景的慢路径；现代物理网卡驱动全部走"硬中断调度 + napi poll 批量收"的混合模型。按老书画 netif_rx → netif_receive_skb 的主干图会漏掉整个软中断批量机制，读新内核源码先更新这张图。

**函数名跨版本对不上。** 典型如收包路径的 ip_rcv_finish 在 6.x 藏在 NF_HOOK 的间接调用里，直接搜索定义不如沿着 ip_rcv 的调用读；__inet_lookup_skb 与更早版本 __inet_lookup 系列也在不断改名。源码篇的纪律：以 [elixir](https://elixir.bootlin.com/linux/v6.12/latest/source) 的 ident 检索为准，老书给的是路标不是坐标。

**tcpdump 在 loopback/-i any 抓到超过 MTU 的"巨包"。** 这是 TCP 分段卸载（TSO/GSO）的效应：内核在 skb 里攒一个大段交给网卡硬件去切，抓包 tap 看到的是未切分的原始大段。想看线缆上的真实帧尺寸，`ethtool -K ens33 tso off gso off` 临时关掉卸载再抓——包没异常，是你看到的位置在切分之前。

**单核 %soft 打满、机器"莫名"丢包。** net_rx_action 每轮软中断受 net.core.netdev_budget（默认 300）与 netdev_budget_usecs 双重预算限制，预算耗尽剩余工作顺延下一轮；若所有收包中断都压在一个 CPU 上，预算就成了吞吐天花板。处置顺序：mpstat 确认分布 → ethtool -l 看队列数 → 扩队列（ethtool -L）或配 RPS 把软中断散到多核 → 还不够再考虑多队列网卡与 irqbalance 的取舍。

**ss 同一列两种语义。** ESTABLISHED 态的 Recv-Q/Send-Q 是字节（sk_receive_queue/sk_write_queue 的长度）；LISTEN 态的 Recv-Q 是已完成三次握手待 accept 的连接数、Send-Q 是 listen backlog 上限。不看状态直接读列，会把"accept 慢了"误诊成"接收缓冲堆积"——协议语义细节见 [TCP/IP 要点](../network/tcpip-essentials.md)的状态机一节。

**tcpdump 一个包都抓不到但连接正常。** 先查过滤器（端口/方向写反是最常见），再查路径：XDP 程序在比 __netif_receive_skb_core 更早的驱动层就能丢包，被丢弃的包永远不会路过抓包点；此外 vlan/ bonding 等叠加设备上 -i 指定物理口与逻辑口看到的流量也不同。抓包点是"路过照相"，照相点之前的岔路它管不着。

## 7. 延伸资料（五段式 ⑤）

- 《深入理解Linux内核》（Understanding the Linux Kernel, 3rd，Bovet & Cesati）网络一章——2.6 时代的分层地图与数据结构关系图仍是最清晰入门，函数名需对照 6.12 源码
- 《Linux内核源代码情景分析》（毛德操、胡希明）收发包情景——"沿一个包走读内核"的方法论原点，本书页结构即致敬此法（基于 2.4，读思路不读代码）
- 《深入Linux内核架构》（Wolfgang Mauerer）网络相关章节——字段级参考
- 《Linux内核设计与实现》（Robert Love）没有网络专章，如实说明；其软中断与下半部章节是理解 NET_RX_SOFTIRQ 的最佳前菜
- 内核树内文档：Documentation/networking/napi.rst 与 Documentation/networking/skbuff.rst（v6.12 已核对存在）——NAPI 与 skb 的官方说明书
- 源码交叉引用 — [elixir.bootlin.com/linux/v6.12](https://elixir.bootlin.com/linux/v6.12/latest/source)
- man 8 ss、man 8 tcpdump；/proc/net/sockstat 各字段见 man proc
