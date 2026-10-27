# Network Stack

The ESTABLISHED row in `ss`, the three-way handshake captured by `tcpdump`, the NIC's blinking light when the gateway answers a ping --
all of these behaviors happen inside the kernel network stack.
[TCP/IP Essentials](../network/tcpip-essentials.md) covers how protocols "ought" to behave;
this page answers in which stretches of code those behaviors actually happen:
which functions a packet walks from NIC DMA to a returning `read()`,
and how one `tcp_sendmsg` call punches through congestion control and queueing discipline to become bits on the wire.
The network stack is one of the largest subsystems in the kernel (the net/ directory has long been second only to drivers/ in code volume),
yet its main road is really just two lanes -- receive and transmit --
and the two are structurally asymmetric:
receiving is an interrupt-driven asynchronous pipeline (the hardirq does only the minimal work and hands the heavy lifting to the softirq),
while transmitting is a synchronous express train from the system call straight down.
Grasp that asymmetry and three thousand files collapse into two roads.
This page follows the source part's unified five acts: core data structures, key function call paths, source reading order, hands-on tracing, further reading;
every function name and location was checked against v6.12 source, and mismatches with old books are flagged as they come up.

> Content draws on the kernel source tree (v6.12) and further reading (conceptual framework); see Section 7.

## What This Part Covers

- Describe the two-half structure of the kernel network stack (the device-independent layer in net/core/ and the protocol families in net/ipv4/) and why sending and receiving are asymmetric
- Recognize the three main characters -- sk_buff, sock, and net_device -- and map ss's output columns back onto structure fields
- Walk the complete function chain of both the receive path and the transmit path
- See the stack's runtime state with your own eyes using four tools: /proc/softirqs, mpstat, bpftrace, and ss -tin
- Identify the roots of high-frequency confusions: "function names from old articles do not match", "giant packets on loopback", "a single core saturated with softirqs"

This page only covers the two chains on the kernel side; it does not repeat protocol semantics (see [TCP/IP Essentials](../network/tcpip-essentials.md)) or tool usage (see [Tracing Tools](./tracing-tools.md)) -- cross-reference them as needed.

## 1. The Layering Truth of the Kernel Network Stack

Textbooks teach networking as five OSI layers or four TCP/IP layers; that picture is for protocol designers.
The kernel source's real carving is two different cuts.
The first cut is between the **device-independent layer and the protocol families**:
code in net/core/ does not care whether you run IPv4, IPv6, or plain Ethernet frames -- it handles skb allocation and recycling, softirq scheduling, and traffic shaping, the "logistics infrastructure";
net/ipv4/ and net/ipv6/ are the "protocol business", where `ip_rcv` and `tcp_v4_rcv` both live.
The second cut is between **receiving and transmitting**, and the two sides are asymmetric --
which is exactly where old articles most easily mislead you.
The transmit path is synchronous:
the process calls `tcp_sendmsg` inside a system call and nests function calls all the way down to the NIC driver's send function, stopping for nothing short of a full queue.
The receive path is an asynchronous two-parter:
the NIC's hardirq does exactly one thing (disable interrupts, schedule NAPI polling),
and the real packet reception, protocol parsing, and socket enqueueing all happen later in softirq context (NET_RX_SOFTIRQ).
Why designed this way?
A 10 Gbps link can deliver millions of packets per second;
if every packet occupied the CPU for a full protocol stack walk, interrupt overhead would eat everything --
the interrupt only knocks, and the softirq does the work in batches on a budget
(each round of `net_rx_action` gets `net.core.netdev_budget` "ration tickets").
This is the engineering compromise between throughput and latency.

Why can transmitting be synchronous while receiving must be asynchronous?
The two sides' "time budgets" are fundamentally different:
transmission happens in the initiator's own process context, so slowness costs only that process's latency, and the system call framework naturally budgets it;
reception has no "process of its own" --
packets belong to the whole machine, and they arrive urgently and densely;
doing the full protocol parse inside the interrupt would mean the whole machine working for the NIC.
Offloading ownerless urgent work onto the softirq while leaving owner-having slow work on the call stack --
this judgment runs through almost every layered design of interrupt handling in the kernel
(the general theory of interrupt bottom halves is in the softirq background of [Tracing Tools](./tracing-tools.md)).

One more positional relationship to establish first:
this page covers the segment from device driver to socket queue inside the kernel;
further up, `read()`/`recvmsg()` in the process take data from the socket queue and `sendmsg()` hands data to `tcp_sendmsg` --
that is the territory of the system call part (the entry mechanism is in the strace section of [Tracing Tools](./tracing-tools.md)).
And every socket that ss and netstat see is the user-space projection of this page's Section 2.2 `struct sock`:
your everyday network observation tools are all built on top of these data structures.
At the very bottom, `/proc/net/tcp` shares its data source with ss; ports are recorded in hex, and it is the "read the raw ledger" debugging technique:

```bash
$ ss -tln sport = :80
State   Recv-Q Send-Q Local Address:Port  Peer Address:Port
LISTEN  0      128            0.0.0.0:80           0.0.0.0:*
$ head -2 /proc/net/tcp
  sl  local_address rem_address   st tx_queue rx_queue ... 
   0: 00000000:0050 00000000:0000 0A 00000000:00000000 ...   # 0050 = 80, 0A = LISTEN
```

The two cuts land on the directory layout, and net/'s layout is a map:
memorize the big cells first so you do not get lost when entering functions:

| Directory | Responsibility | Covered here |
|---|---|---|
| net/core/ | device-independent infrastructure: skb lifecycle, softirqs, qdisc, neighbor tables | the middle segments of both chains |
| net/ipv4/, net/ipv6/ | protocol families: IP input/output, TCP/UDP, routing | ip_rcv, tcp_v4_rcv, tcp_sendmsg |
| net/sched/ | qdisc queueing disciplines (pfifo, fq_codel, htb...) | the queueing checkpoint of the transmit chain |
| net/netfilter/, net/ipv4/netfilter/ | registration and execution of netfilter hooks | the NF_INET_* trigger points on both chains (policy in the security part) |
| net/packet/ | AF_PACKET -- the host protocol family of tcpdump | the two capture taps |
| include/linux/skbuff.h, include/net/sock.h | definitions of the two core structures | Sections 2.1 and 2.2 |

## 2. Core Data Structures (Act ①)

### 2.1 sk_buff: A Suitcase That Shells Itself

sk_buff (conventionally abbreviated skb, defined in include/linux/skbuff.h) is the universal data container of the network stack --
every packet received and every chunk of data to send travels inside an skb.
Its most ingenious design is not holding the data itself
(the data is just a linear buffer, with a frag list of fragments on high-throughput ports)
but **sliding a pointer through the buffer to "shell" it**:
the buffer is reserved in one piece from head to end, and `skb->data` points at the start of the current protocol layer's payload.
When an Ethernet frame arrives, `data` starts after the link header;
after `ip_rcv` processes the IP header, `skb_pull` pushes `data` forward past it,
so the `data` that `tcp_v4_rcv` sees points straight at the TCP segment payload --
each layer peeled is one pointer move, zero bytes copied.
Conversely, the transmit path reserves headroom at the front of the buffer precisely to "shell up" layer by layer
(each layer does one `skb_push`, writing its new header into the reserved space).
The mechanism of zero-copy layered processing lives entirely in the advance and retreat of these two pointers; it deserves a full minute of staring.

skb is the most frequently allocated object in the network stack (millions of times per second);
it is born out of a dedicated slab cache, `skbuff_head_cache` --
the busiest customer of the memory management chapter's slab allocator is the network stack.
Four markers inside the buffer decide where the "shells" are:

```text
        skb->head                         skb->end
           │                                │
           ▼                                ▼
      ┌────┬──────────────┬───────────┬─────┐
      │head│   headroom   │ data area │tail │   tailroom
      │room│  (reserved   │  ←data    │room │
      │    │  for shells) │           │     │
      └────┴──────────────┴───────────┴─────┘
              skb_push: data moves forward, "asking" the buffer for one header (transmit shells up)
              skb_pull: data moves back, giving one header back to the buffer (receive shells off)
              skb_reserve: at construction, move data aside to fix the start of headroom
```

Another high-frequency path is the shallow copy of `skb_clone`:
the packet tcpdump wants, the packet netfilter wants to inspect, and the packet forwarded to multicast each get a new shell (an sk_buff header),
while the data buffer is shared by reference count;
only whoever truly needs to modify the data (writing a new header when fragmenting, say) deep-copies.
"Many readers, few writers" is the second act of the network stack's zero-copy philosophy --
the first act is the pointer sliding above.
The kernel's own Documentation/networking/skbuff.rst (verified present in the v6.12 tree) is the official manual for this design.

### 2.2 The sock Family: What ss Sees

`struct sock` (include/net/sock.h) is a socket's entire state inside the kernel.
A TCP sock is called `tcp_sock`, a UDP one `udp_sock`;
they do not "inherit" from sock -- C has no inheritance --
but embed `struct sock` as the structure's first member, so a pointer cast switches between the two views
(the kernel macro `tcp_sk(sk)` does exactly this: "poor man's inheritance" by nesting containers).
The most important fields for this chapter are two queues: `sk_receive_queue` (received, awaiting pickup) and `sk_write_queue` (sent, awaiting confirmation) --
**ss's Recv-Q and Send-Q columns are exactly the lengths of these two queues**.
The `sk_state` field corresponds one-to-one with ss's STATE column:
TCP's connection state machine (the SYN_SENT, ESTABLISHED, TIME_WAIT set; protocol semantics in [TCP/IP Essentials](../network/tcpip-essentials.md)) is in the kernel simply this integer field flowing through switch statements:

| sk_state (TCP value) | ss displays | Meaning |
|---|---|---|
| TCP_ESTABLISHED | ESTAB | transferring both ways |
| TCP_SYN_SENT / TCP_SYN_RECV | SYN-SENT / SYN-RECV | handshake in progress |
| TCP_FIN_WAIT1 / TCP_FIN_WAIT2 | FIN-WAIT-1/2 | this end has sent its FIN |
| TCP_CLOSE_WAIT / LAST_ACK | CLOSE-WAIT / LAST-ACK | peer sent FIN, this end not closed |
| TCP_TIME_WAIT | TIME-WAIT | waiting out 2MSL |
| TCP_CLOSE / TCP_LISTEN | CLOSED / LISTEN | closed / listening |

TCP also maintains the entire congestion control ledger inside sock (`snd_cwnd`, `ssthresh`, RTT samples),
and these fields are exported via `getsockopt(TCP_INFO)` as `struct tcp_info` (include/uapi/linux/tcp.h);
the rtt, cwnd, and retrans columns printed by `ss -tin` are a field-by-field transcription of that structure --
every column you read in operations has a ledger field of the same name in source.

### 2.3 net_device: The Abstraction of a NIC

`struct net_device` (include/linux/netdevice.h) represents a network card --
physical or virtual (veth/bridge/WireGuard) alike;
every line `ip link` prints is one net_device.
Hanging off it are the driver's receive and transmit function pointers,
queue statistics (the counters `ethtool -S` reads),
and one of this chapter's protagonists: the NAPI structure.
The `poll` function pointer inside `struct napi_struct` is the callback that `net_rx_action` calls repeatedly when batching packets in softirq --
the "interrupt knocks, polling works" hybrid model hangs off net_device itself.
The v6.12 tree's Documentation/networking/napi.rst explains the modern form of this mechanism in detail.

The accounts the driver keeps on the transmit and receive paths all have projections on the operations side;
this correspondence table is worth pinning next to your monitor:

| Driver-level counter (ethtool -S name) | Operations projection | Note |
|---|---|---|
| rx_packets / rx_bytes | ip -s link show | total received, uniformly accounted by the kernel |
| rx_dropped | TcpInDiscards etc. in /proc/net/netstat | packets dropped before the protocol layer |
| rx_missed_errors / rx_fifo_errors | the raw ethtool -S output | NIC ring buffer full; the packets were lost on the hardware side |
| tx_errors / tx_dropped | dmesg, ss's retransmission counters | entry clues for egress packet loss |

The last row deserves a pause:
a ring buffer overflow (rx_missed) happens **before the driver receives the packets**,
and neither /proc/net/softnet_stat nor tcpdump can see them;
when you suspect "packets died on the NIC", `ethtool -S` is the only place that can answer.

### 2.4 net_namespace: The Foundation of Container Networking

The last leading character only needs recognition:
`struct net` encapsulates an entire set of network devices, routing tables, iptables rules, and socket hash tables;
`clone(CLONE_NEWNET)` creates a new netns and `ip netns exec` enters it.
Container networking (veth pairs, bridges) is all built on this foundation;
this page does not elaborate -- see the boundary discussion in Section 10 of [Network Configuration](../network/network-configuration.md).
There is only one practical effect on reading source:
when you see `dev_net(skb->dev)` or `sock_net(sk)` in functions like `tcp_v4_rcv`,
remember this is fetching "which network namespace this packet / this socket belongs to" --
two containers pinging each other on the same host walk code that is identical on both chains;
the only divergence happens at these net-fetching points.

## 3. Key Function Call Paths (Act ②)

### 3.1 The Receive Path: From NIC Interrupt to Socket Queue

```text
NIC DMA receives a frame into the ring buffer
  → hardirq: the driver handler calls napi_schedule() and returns immediately   ← interrupt context, tens of nanoseconds
  ─────────────── the asynchronous boundary ───────────────
  → NET_RX_SOFTIRQ fires → net_rx_action()                                     ← softirq context
      (net/core/dev.c, batched on the netdev_budget)
  → the driver's napi->poll(): batch frames out of the ring buffer, wrap them into skbs
  → netif_receive_skb() → __netif_receive_skb_core()                           ← net/core/dev.c
      ├─ passing the ptype_all delivery point: AF_PACKET clones here — this is what tcpdump catches
      └─ dispatch by ethertype to the registered protocol handler (IPv4: ip_rcv)
  → ip_rcv()                                               ← net/ipv4/ip_input.c
      └─ the NF_INET_PRE_ROUTING hook (netfilter/nftables intervenes here; see the firewall chapter)
  → ip_rcv_finish: consult the routing table → dst_input()
  → local delivery: tcp_v4_rcv()                            ← net/ipv4/tcp_ipv4.c
      └─ __inet_lookup_skb(): find the sock in the established hash table by the four-tuple
  → tcp_v4_do_rcv → tcp_rcv_established: sequence checks, ACK processing
  → data goes into sk->`sk_receive_queue`; `sk_receive_queue` wakes the waiting process
  → user space read()/recvmsg() returns                      ← back into the system call part's territory
```

Three points for understanding this chain.
**First, the asynchronous boundary**: between hardirq and softirq lies the soul of the receive path --
on a loaded machine you can watch softirqs eat CPU directly in mpstat's %soft column;
that is `net_rx_action` and its poll loop at work.
**Second, the capture point**: tcpdump (the AF_PACKET family)'s receive tap sits on the delivery chain of `__netif_receive_skb_core`, and its transmit tap on the `dev_queue_xmit` side --
so capturing is "taking a photo as the packet passes by"; it does not change the path itself.
**Third, lookup is ownership**: in `tcp_v4_rcv`, `__inet_lookup_skb` finds the sock in a hash table by the four-tuple (source IP, source port, destination IP, destination port),
and from that moment the packet belongs to that socket;
if no listener is found, the kernel sends back a RST --
the `Connection refused` you see on the client side is born in these very lines (protocol-side semantics in [TCP/IP Essentials](../network/tcpip-essentials.md)).

### 3.2 The Transmit Path: From tcp_sendmsg to the NIC

```text
tcp_sendmsg()                                    ← net/ipv4/tcp.c
    copy user data into `sk_write_queue` (this is where Send-Q grows)
  → tcp_push() → tcp_write_xmit()                ← net/ipv4/tcp_output.c
      congestion window cwnd / advertised window / Nagle gatekeep: decide "how much to send now"
  → __tcp_transmit_skb(): encapsulate the TCP header, compute the checksum
  → __ip_queue_xmit()                            ← net/ipv4/ip_output.c
      consult routing, encapsulate the IP header (skb_push uses the headroom)
  → ip_local_out → the NF_INET_POST_ROUTING hook (netfilter egress inspection)
  → ip_finish_output2 → neigh_output()           ← net/core/neighbour.c
      triggers ARP resolution of the next hop's MAC when needed
  → dev_queue_xmit()                             ← net/core/dev.c
      → qdisc queueing (default noqueue/fq_codel; the queueing disciplines live in net/sched/)
  → the driver's hard_start_xmit: DMA to the NIC, and on the wire it goes
```

Transmission is synchronous:
apart from the qdisc possibly queueing, this chain runs in one continuous stroke on tcp_sendmsg's call stack.
Two checkpoints worth stopping at:
**tcp_write_xmit is where congestion control is executed** --
every textbook narrative of "when cwnd is full, wait for ACK" lands on this function comparing `snd_cwnd` against the bytes sent-but-unacknowledged;
**neigh_output is the interchange between layer 3 and layer 2** --
the IP header holds the peer's address while the frame header holds the next hop's MAC, and ARP fills the gap right here on the spot.
Incidentally, the transmit tap (`dev_queue_xmit_nit`) also lives on the dev_queue_xmit path, symmetric to the receive side.

The qdisc link deserves two extra sentences because it is the standing suspect for "transmit got slow":
`__dev_queue_xmit` hands the skb over to the current qdisc's `qdisc_run` around dev.c:3812,
the dequeueing work is done by `sch_direct_xmit` (net/sched/sch_generic.c:315),
and it finally lands in `dev_hard_start_xmit` (net/core/dev.c:3594) into the driver --
this code is the executor of "drop when the queue is full",
and both `ip -s link show`'s tx_dropped and `tc -s qdisc`'s drops are its accounts.
Under the default policy, loopback and most virtual devices use noqueue (no queue, straight through),
while physical NICs mostly use pfifo_fast/fq_codel --
so "transmit is slow" on the same machine can have completely different explanations:
first determine whether it is the qdisc waiting or tcp_write_xmit's cwnd waiting
(the unacknowledged byte count in `ss -tin` tells them apart).

### 3.3 UDP: The Minimal Edition Without a Connection Ledger

UDP deletes half of TCP's code and walks the same skeleton:
the sending side `udp_sendmsg` (net/ipv4/udp.c:1059) maintains no connection state -- it looks up routing, encapsulates, and exits the stack directly;
the receiving side dispatches from `ip_rcv` to `udp_rcv` (udp.c:2630) → `__udp4_lib_rcv` (udp.c:2387),
finding the sock in the UDP hash table by destination port
(not found, it replies with ICMP port unreachable, in place of TCP's RST),
and after enqueueing into `sk_receive_queue` it likewise relies on `sk_receive_queue` to wake.
No handshake, no cwnd, no `sk_write_queue` ledger --
which is why in ss, a UDP connection's Send-Q is always 0 and only Recv-Q can meaningfully pile up.
Reading UDP's half after TCP is a good test of whether you have truly internalized "which parts are transport-layer personality and which are the stack's common skeleton".

### 3.4 Joining the Two Roads: The Handshake's Send/Receive Closed Loop

Receive alone or transmit alone is only half a river;
the handshake joins them into a loop.
Take an active open initiated by connect() (protocol semantics such as ISN and the SYN+ACK field meanings are in the handshake section of [TCP/IP Essentials](../network/tcpip-essentials.md); here we only watch function names):

```text
This end connect()                                  ← back to the system call part
  → tcp_v4_connect: create the sock, look up routing, pick the initial sequence number
  → transmit road: tcp_connect → tcp_send_syn → ... → the NIC   (walks the §3.2 chain)
  ── SYN crosses the wire ──
Peer's receive road: ... → tcp_v4_rcv → tcp_v4_do_rcv            (walks the §3.1 chain)
  → tcp_conn_request: create a new request_sock, reply SYN+ACK    (the transmit road sets off again)
  ── SYN+ACK crosses the wire ──
This end's receive road: tcp_v4_rcv → tcp_rcv_synsent_state_process
  → the three-way handshake is "complete" in the kernel; sk_state set to TCP_ESTABLISHED
  → the `sk_receive_queue` callback wakes the process blocked in connect()
```

Three ways to read this picture.
**First, the two chains mirror each other**:
every step of the handshake is "the end of the previous step's receive road triggers the beginning of the next step's transmit road";
there is no general scheduler in the middle -- queues and callbacks (`sk_receive_queue`, `sk_write_queue`) drive it forward.
**Second, the state machine lives in the sock, not in the protocol book**:
the observable instant of handshake completion is the integer `sk_state` changing from TCP_SYN_SENT to TCP_ESTABLISHED --
`ss -tan` showing SYN-SENT become ESTAB is its user-space projection.
**Third, the passive open's listen road forks**:
when a SYN arrives and the destination sock is in TCP_LISTEN, `tcp_v4_rcv` takes the `tcp_v4_conn_request` branch,
creating a not-yet-fully-established request_sock (the SYN queue);
only after the entire handshake completes does it land in the established hash table --
`accept()` merely picks up the finished product.
The lengths of the SYN queue and the accept queue are precisely those two Recv-Q/Send-Q numbers in `ss -lnt`
(look back at Section 6, "two meanings in one column").

## 4. Source Reading Order (Act ③)

Stop one: **the `__netif_receive_skb_core` stretch of net/core/dev.c** (the receive trunk, around line 5457 in v6.12):
see how the skb is delivered to ptype_all and to the protocol handlers; this stretch is the hub of the entire receive path.
Stop two: **all of net/ipv4/ip_input.c**:
this file is short; `ip_rcv` only does basic validity checks and hands off to the netfilter hook;
after reading it you will have the correct mental model of "a protocol handler = a callback registered into ptype_base".
Stop three: **`tcp_v4_rcv` in net/ipv4/tcp_ipv4.c** (around line 2176 in v6.12):
the complete choreography of four-tuple lookup, the TIME_WAIT/ACK fast paths, and socket locking and enqueueing.
Stop four: **only the skeleton of `tcp_sendmsg` in net/ipv4/tcp.c**:
the main loop's three steps -- copy data, advance sequence numbers, push as needed --
skipping all details (urgent data, zerocopy).
Two things not to do:
do not read net/ in directory order (you will drown in the ocean of drivers/),
and do not plunge into netfilter's hook macros (knowing that PRE_ROUTING/POST_ROUTING exist is enough; the policy side is in [Firewall](../security/firewall.md)).

At every stop, do the same small thing:
set an observation point on this function, then go back to the runtime state and find its projection.
This "source ↔ runtime" correspondence table is the core equipment for reading this page:

| Code entity you read | Runtime projection | Observation command |
|---|---|---|
| `sk_receive_queue` / `sk_write_queue` | Recv-Q / Send-Q | `ss -tin` |
| sk_state | the STATE column | `ss -tan` |
| net_rx_action / the napi poll loop | NET_RX counts, %soft | /proc/softirqs, mpstat |
| tcp_sock's tcp_info fields | rtt/cwnd/retrans columns | `ss -tin` |
| the ptype_all capture tap | every packet tcpdump sees | `tcpdump -i any` |
| the various ethtool -S counters | the NIC's rx/tx/drop accounts | `ethtool -S ens33` |

Arrange the four stops into an executable checklist, ticking one box after each stop, following along as you read:

1. `net/core/dev.c` -- __netif_receive_skb_core (around line 5457 in v6.12): the ptype_all tap, ethertype dispatch
2. `net/ipv4/ip_input.c` -- ip_rcv: validity checks, NF_INET_PRE_ROUTING, handoff after routing
3. `net/ipv4/tcp_ipv4.c` -- tcp_v4_rcv (around line 2176): four-tuple lookup, locking and enqueueing
4. `net/ipv4/tcp.c` -- tcp_sendmsg skeleton: copying and enqueueing, sequence advancement, pushing as needed
5. `net/ipv4/tcp_output.c` -- tcp_write_xmit (around line 2734): the three gates of cwnd/window/Nagle
6. `net/core/dev.c` -- __dev_queue_xmit (around line 4340): the qdisc checkpoint and the transmit tap

Between stops, you can look things up problem-first and "back-chain the call path" --
at each stop, return to the runtime and compare against one column of output (the table above),
so the chain turns from nouns into a map that lives on your hands.

Finally, a quick-reference of coordinates that appear on this page
(line numbers measured on v6.12 and re-verified with elixir; line numbers drift between versions, function names are the stable anchors):

| Function | File | v6.12 line |
|---|---|---|
| __netif_receive_skb_core | net/core/dev.c | 5457 |
| __dev_queue_xmit | net/core/dev.c | 4340 |
| dev_hard_start_xmit | net/core/dev.c | 3594 |
| sch_direct_xmit | net/sched/sch_generic.c | 315 |
| ip_rcv | net/ipv4/ip_input.c | 560 |
| tcp_v4_rcv | net/ipv4/tcp_ipv4.c | 2176 |
| tcp_sendmsg | net/ipv4/tcp.c | 1352 |
| tcp_write_xmit | net/ipv4/tcp_output.c | 2734 |
| __ip_queue_xmit | net/ipv4/ip_output.c | 457 |
| udp_sendmsg / __udp4_lib_rcv | net/ipv4/udp.c | 1059 / 2387 |

For online reading and jumping around use [elixir.bootlin.com](https://elixir.bootlin.com/linux/v6.12/latest/source);
environment setup is in [Source Tree](./source-tree.md);
to set a breakpoint on a function and see the scene, the gdb section of [Tracing Tools](./tracing-tools.md) has it,
including the concrete steps for single-stepping through the send/receive paths line by line -- this page does not repeat them.

## 5. Hands-On Tracing (Act ④)

**Experiment 1: Watch the softirq accounting.** /proc/softirqs is the kernel's per-CPU softirq ledger, and the NET_RX and NET_TX rows are the stack's receive and transmit counters.
Sample once before and once after a curl, and the growth of both rows is clearly visible
(using awk to keep only the delta, sparing you from subtracting big numbers by eye):

```bash
$ awk '/NET_RX|NET_TX/ && !seen[$1]++ { f[$1]=$2 } /NET_RX|NET_TX/ { d[$1]=$2-f[$1] } END { for (i in d) printf "%-8s +%d\n", i, d[i] }' /proc/softirqs
NET_RX  +0
NET_TX  +0
$ curl -s https://www.kernel.org/ > /dev/null
$ awk '/NET_RX|NET_TX/ && !seen[$1]++ { f[$1]=$2 } /NET_RX|NET_TX/ { d[$1]=$2-f[$1] } END { for (i in d) printf "%-8s +%d\n", i, d[i] }' /proc/softirqs
NET_RX  +184
NET_TX  +96
```

One page fetched about 184 NET_RX and 96 NET_TX softirqs --
DNS, the TCP handshake, and the page's segment-by-segment transfer are all recorded there.
Note that the increments usually land on only individual CPU columns (spread by queue on multi-queue NICs) --
NIC queue-to-CPU affinity is fixed, and this is the setup for the Section 6 pitfall "one core's %soft saturated".

**Experiment 2: See the capture point with your own eyes.** tcpdump can catch packets because AF_PACKET received a clone on the delivery chain of `__netif_receive_skb_core`.
Two terminals walk the causality through once:

```bash
# Terminal one: capture packets on port 53
$ sudo tcpdump -i any -nn -c 5 port 53
# Terminal two: fire off a DNS query
$ dig +short www.kernel.org A
139.178.84.217
# Terminal one replays:
13:41:02.114301  ens33  Out 192.168.56.20.46561 > 223.5.5.5.53: 58934+ A? www.kernel.org. (33)
13:41:02.131882  ens33  In  223.5.5.5.53 > 192.168.56.20.46561: 58934 1/0/0 A 139.178.84.217 (49)
```

The Out tap is on the `dev_queue_xmit` side and the In tap on `__netif_receive_skb_core` --
one photo taken in each direction, while the path itself did not move a hair.

**Experiment 3: The CPU distribution of softirqs.** mpstat's %soft column is `net_rx_action`'s load sheet (the sysstat package, same name on all three families).
In high-PPS scenarios it is common to see one core at 90%+ while the others idle --
which CPU handles the softirq is decided by the NIC's queue mapping;
widening the queues (ethtool -L) or enabling RPS (setting /sys/class/net/ens33/queues/rx-0/rps_cpus to a multi-core bitmap) is the standard treatment:

```bash
$ mpstat -P ALL 1 3 | grep -E "CPU|Average"
Average:  CPU     %usr     %sys    %soft    %idle
Average:  all    12.41     4.10     6.02     71.30
Average:    0     3.12     2.03    23.87     64.50   # the typical shape of NET_RX concentrated on CPU0
```

**Experiment 4: Put a counter on tcp_v4_rcv.** A single bpftrace kprobe can tally which CPUs the receive entry point is frequently crossed on
(the built-in variable `cpu` is the CPU number; background on probe tools is in [Tracing Tools](./tracing-tools.md)):

```bash
$ sudo bpftrace -e 'kprobe:tcp_v4_rcv { @[cpu] = count(); }'
Attaching 1 probe...
^C
@[0]: 4187
@[2]: 22
```

**Experiment 5: Read a socket's ledger.** `ss -tin` transcribes `struct tcp_info` directly:
rtt/rttvar are the round-trip delay samples, cwnd is the current congestion window, retrans is the retransmission count --
the Section 2.2 claim that "every ss column corresponds to a structure field" is cashed in here:

```bash
$ ss -tin state established '( dport = :443 )'
Estab  0  0  192.168.56.20:47126  142.250.66.163:443
  cubic rto:386 rtt:28.6/13.2 ato:40 mss:1448 pmtu:1500 rcvmss:1328
  cwnd:10 bytes_acked:19617 segs_out:19 segs_in:24 send 4.03Mbps lastsnd:198 lastrcv:198
```

The word `cubic` is the congestion control algorithm announcing itself;
multiplying cwnd:10 by rtt:28.6 approximately yields the available send rate --
the send 4.03Mbps column is the bandwidth-delay product formula the kernel computed for you.
To reconcile the ledger with source one field at a time:
every member of `struct tcp_info` in include/uapi/linux/tcp.h is the origin of these columns
(tcpi_rtt, tcpi_snd_cwnd, tcpi_total_retrans correspond one to one).

**Experiment 6: Trace a call chain with the kernel.** The function-level tracers (details of ftrace/function_graph and bcc/bpftrace tracepoints are in [Tracing Tools](./tracing-tools.md))
can turn this page's Section 3.1 receive call graph into a measured flow;
below, the laziest tracepoint combination shows the order in which one DNS query crosses the kernel:

```bash
$ sudo trace-cmd record -e net:netif_receive_skb -e net:net_dev_xmit \
      -e tcp:tcp_probe -- dig +short www.kernel.org A
$ sudo trace-cmd report | head -6
<...>-2713  [002]  1234.567890: net_dev_xmit: skb=... dev=ens33 protocol=2048 length=74
<...>-2713  [002]  1234.567901: netif_receive_skb: skb=... dev=ens33 protocol=2048 length=74
     <idle>-0    [001]  1234.589341: netif_receive_skb: skb=... dev=ens33 protocol=2048 length=90
<...>-2713  [002]  1234.589402: net_dev_xmit: skb=... dev=ens33 protocol=2048 length=74
```

The output confirms three things:
the transmit (`net_dev_xmit`) and receive (`netif_receive_skb`) tracepoints sit exactly at the tap positions of Section 3's two chains;
the events land on different CPUs ([001]/[002]) --
on a real machine the asynchronous transmit/receive boundary really is cross-core;
the query goes out at 74 bytes and comes back at 90 bytes, request and reply completed within the same second.
For a function-level rather than event-level flow, swap -e for function_graph and filter with -p tcp_v4_rcv --
this is the execution tool behind Section 4's "follow wherever you read".

**Experiment 7: Keep a grand total for the whole stack.** /proc/net/sockstat is the protocol layer's summary ledger (ss -s is its transcription);
map it onto Section 2's queues and the last piece of the five-act puzzle falls into place:

```bash
$ cat /proc/net/sockstat
sockets: used 142
TCP: inuse 34 orphan 0 tw 12 alloc 78 mem 12
UDP: inuse 5 alloc 9 mem 4
...
$ ss -s
Total: 41 (kernel 49)
TCP:   34 (estab 22, closed 12, orphan 0, timewait 12)
```

The TCP row's inuse is the count of TCP_ESTABLISHED + LISTEN sockets,
tw is the TIME_WAIT count,
and mem is the number of pages held by skbs (corresponding to the `sk_write_queue` pre-charge).
Everyday questions like "how many connections does this machine have" always start from this grand total,
then drill down to individual connections with `ss -tan`;
get the direction backwards and you will be fishing numbers out of tens of thousands of lines.

**Closing exercise: write both chains out from memory.** After the seven experiments there is only one standard of proof:
close this page, and write from "the NIC receives a TCP packet" to "the process's read() returns",
then from "the process's write()" to "bits on the wire",
producing every step's function name and file without consulting the text.
If you get stuck at a link, go back and reread that section --
stuck at the tap positions, back to the Section 3.1 call graph;
stuck at queue semantics, back to the Section 2.2 correspondence table;
stuck at GSO giant packets or budget drops, back to Section 6.
This ability to write the call chains from memory is the dividing line between "having read the network stack" and "having memorized the network stack".

## 6. Common Pitfalls

**Old articles take netif_rx as the receive trunk.** In v6.12 `netif_rx` is still in net/core/dev.c, but it is the slow path for non-NAPI cases like loopback;
modern physical NIC drivers all walk the "hardirq schedules + napi poll batches" hybrid model.
Drawing the trunk as netif_rx → netif_receive_skb per old books misses the entire softirq batching mechanism --
update this picture before reading new kernel source.

**Function names do not match across versions.** The typical case is `ip_rcv_finish` on the receive path, which in 6.x hides inside NF_HOOK's indirect call --
searching for its definition directly is worse than reading along from ip_rcv's call;
`__inet_lookup_skb` and the earlier `__inet_lookup` family keep getting renamed as well.
The source part's discipline:
treat [elixir](https://elixir.bootlin.com/linux/v6.12/latest/source)'s ident search as the authority;
old books give road signs, not coordinates.

**tcpdump catching "giant packets" over MTU on loopback/-i any.** This is the effect of TCP segmentation offload (TSO/GSO):
the kernel accumulates a large segment in the skb and hands it to the NIC hardware to cut,
and the capture tap sees the uncut original segment.
To see the true frame sizes on the wire, temporarily disable offload with `ethtool -K ens33 tso off gso off` and capture again --
the packets are fine; it is your vantage point that sits before the segmentation.
The sibling mechanism GRO operates in reverse on the receive side:
merging many small frames into one large skb before handing it to the protocol stack, reducing per-packet overhead --
both sides' "offload/merge" happen in the middle of Section 3's two chains,
and the capture point always sees the post-merge/post-segment shape;
this is the first check in every capture mystery.

**A single core's %soft saturated and the machine drops packets "for no reason".** Each softirq round of `net_rx_action` is capped by two budgets, net.core.netdev_budget (default 300) and netdev_budget_usecs;
when the budget runs out the remaining work is deferred to the next round;
if all receive interrupts pile onto one CPU, the budget becomes the throughput ceiling.
Order of treatment:
confirm the distribution with mpstat → check the queue count with ethtool -l → widen the queues (ethtool -L) or configure RPS to spread the softirq across cores → if still not enough, weigh multi-queue NICs against irqbalance.

**ss: two meanings in one column.** For an ESTABLISHED socket, Recv-Q/Send-Q are byte counts (the lengths of `sk_receive_queue`/`sk_write_queue`);
for a LISTEN socket, Recv-Q is the number of completed handshakes waiting to be accepted and Send-Q is the listen backlog limit.
Reading a column without checking the state will misdiagnose "accept is slow" as "receive buffer is piling up" --
protocol-level details are in the state machine section of [TCP/IP Essentials](../network/tcpip-essentials.md).

**tcpdump catches not a single packet but the connection works fine.** Check the filter first (reversed port/direction is the most common mistake), then check the path:
an XDP program can drop packets at the driver layer, earlier than `__netif_receive_skb_core`,
and dropped packets never pass the capture point;
also, on stacked devices like vlan/bonding, `-i` on the physical versus logical interface sees different traffic.
A capture point is "a photo as the packet passes by"; it has no authority over junctions upstream of the photo.

**Softirqs are not saturated yet packets still drop -- first work out which layer is dropping.** Packet loss has three mutually invisible battlefields:
the NIC ring buffer (rx_missed_errors from ethtool -S, invisible even to tcpdump),
column two of /proc/net/softnet_stat (work that did not fit in the softirq budget; read it as hex in your sampling script),
and the socket receive buffer (Recv-Q pressed against rmem_max in ss; the application reads too slowly).
The three layers demand completely different treatments:
widen the ring (ethtool -G) or add queues for the first;
the second is this section's single-core budget problem;
the third is an application-side backlog/read-speed problem --
adjusting net.core.rmem_max without looking at the scene is the most common wasted effort.

**qdisc queueing charging its delay to TCP's account.** ping RTT is normal but application latency is high, and `tc -s qdisc` shows growing drops or backlog --
the bottleneck is the egress qdisc, not the congestion window.
As Section 3.2 said, transmission in tcp_sendmsg's synchronous chain can stop and wait at the qdisc;
check qlen/drops with `tc -s qdisc show dev ens33` and compare against `ss -tin`'s unacknowledged byte count --
if the former climbs while the latter stays flat, the problem is in the shaping rules (or a missing noqueue);
change the qdisc policy, and leave the congestion algorithm alone.

## 7. Further Reading (Act ⑤)

These materials span from 2.4 to 6.12 and each demands a different reading mode --
look at this table before opening any of them, lest you hunt today's functions with twenty-year-old coordinates:

| Material | Era | Good for | Discipline |
|---|---|---|---|
| *Understanding the Linux Kernel* (Bovet & Cesati, 3rd) | 2.6 | the networking layering map, the skb/sock field relationship diagrams | function names must be checked against 6.12 source |
| *Annotated Walkthrough of Linux Kernel Source Code* (Mao Decao, Hu Ximing) | 2.4 | the methodology of "walking the kernel along one packet" | read the ideas, not the code |
| *Professional Linux Kernel Architecture* (Wolfgang Mauerer) | 2.6.2x | deep dives at field and mechanism level | equally old coordinates |
| *Linux Kernel Development* (Robert Love) | 2.6.x | softirq/bottom-half background (the NET_RX_SOFTIRQ appetizer) | stated honestly: no dedicated networking chapter |
| in-tree Documentation/networking/ | per version | the official account of NAPI, skb, sysctl | verified present in v6.12: napi.rst, skbuff.rst, ip-sysctl.rst |
| [elixir.bootlin.com/linux/v6.12](https://elixir.bootlin.com/linux/v6.12/latest/source) | 6.12 | every "where is this function" question | every line number on this page was re-verified with it |
| man 8 ss, man 8 tcpdump, man 7 tcp | current | the authoritative semantics of tool output and protocol fields | cross-verify against /proc/net/sockstat |

Two honest words to close.
First, none of the four Chinese-accessible kernel books is based on 6.x;
that is a fact, not a regret --
they supply structure and method, while coordinates must be looked up live with elixir,
and the first two pitfalls of Section 6 are the on-site evidence of expired coordinates.
Second, the network stack's "next lesson" is already written in the in-tree documentation:
after this page's two chains, read Documentation/networking/napi.rst (the modern form of NAPI and GRO) and ip-sysctl.rst (the tuning knobs for Section 3's checkpoints),
then return to [Tracing Tools](./tracing-tools.md) and attach ftrace/bpftrace probes to the functions that appeared here --
source, documentation, and tools cross-verifying each other in a triangle is how every chapter of the source part is read.

<!-- BACKLINKS-AUTO -->
## Related Pages

- [glossary](/glossary.md)
- [README](README.md)
