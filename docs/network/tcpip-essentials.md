# TCP/IP Essentials: Connections and Packets

[Networking Basics](./basics.md) answers "how does a packet find its destination," but once troubleshooting goes deep, questions tend to converge on the behavioral details of TCP itself: the first connection after a server restart comes back refused, a burst of duplicate ACKs shows up in the capture, SSH logs in fine but `scp` hangs and then drops -- these three correspond to the origin of RST, the trigger conditions for fast retransmission, and the PMTU black hole. None of the answers live in a configuration file; they live in how the protocol actually runs. This page unfolds along the full life of one TCP connection: first the state machine of handshake and teardown, then counting the states with `ss` and reading the segments with `tcpdump`, and finally MTU, the case of "a link property biting the transport layer back." IP addressing, subnets, and the layered model are already covered thoroughly in the basics chapter and are not repeated here; for the layered methodology see [Network Troubleshooting](./troubleshooting.md) -- this page stays on the transport layer.

> Content adapted from RFC 9293, the man pages, and Bird's Private Recipes (conceptual framework); see the references at the end.

## What This Page Covers

- Reading every segment of the three-way handshake and the four-way teardown
- Filtering by state, counting, and attributing to a process with `ss`, building the "count first, capture second" order of work
- Capturing one complete session with `tcpdump`, recognizing the S/F/R/P/. flags, and knowing the three common sources of RST
- MTU, IP fragmentation, MSS negotiation, and the PMTU black hole
- Knowing where UDP fits and which way QUIC is heading

## 1. From "It Works" to "I Understand"

Early on in network troubleshooting, every command in the toolbox answers "does it work or not": `ping` tests reachability, `dig` tests resolution, `curl` tests the service. When you get to "the service is clearly listening but the client says connection refused," or "the connection establishes and then always dies on a big file," "does it work" stops being enough -- you need to know that TCP maintains a whole state machine between working and not working, which states are whose responsibility and what each segment is actually saying. The relation of this knowledge to the basics chapter is like learning to read an intersection before learning the traffic-light timing: the map has not changed, but now you can explain "why the light is green and the cars still are not moving."

This page has exactly one methodology rule: **look at the states first, then at the segments**. `ss` is a static snapshot -- cheap, unobtrusive, and able to classify thousands of connections by state in one command; `tcpdump` is a live recording -- precise but expensive, because an unfiltered capture on a production box can print faster than you can read. This is the same discipline as log troubleshooting, where you filter by severity before reading in full: cheap things first, expensive things reserved for a problem surface you have already narrowed. Reverse the order and the information does not fail to arrive -- it floods you.

To do the work, get the tools together first: `ss` is part of iproute2 and preinstalled on all three distro families; `tcpdump` is usually missing from a minimal install and has to be added; `ping` is part of iputils. Install per the comparison below once, and every experiment on this page will run:

| Tool | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| ss | iproute2 (preinstalled) | iproute2 (preinstalled) | iproute2 (preinstalled) |
| tcpdump | `apt install tcpdump` | `pacman -S tcpdump` | `dnf install tcpdump` |
| ping (with `-M do`) | iputils-ping (preinstalled) | iputils (preinstalled) | iputils (preinstalled) |

## 2. The Life of a TCP Connection

### 2.1 The Three-Way Handshake: Confirming "Both Sides Can Send and Receive"

```text
client                          server (LISTEN)
   │ ── SYN, seq=x ─────────────▶ │   "I want to connect, my sequence numbers start at x"
   │ ◀───── SYN+ACK, seq=y, ────── │   "Got it; I want to connect too, mine start at y"
   │          ack=x+1              │
   │ ── ACK, ack=y+1 ──────────▶ │   "Got your sequence number" -> both sides ESTABLISHED
```

The three-way handshake is often misremembered as routine paperwork, but every exchange eliminates one class of failure: the first SYN proves the client can send, the second SYN+ACK proves the server can both receive and send, and the third ACK proves the client can receive. Drop one and somebody's "receive" has never been verified -- in the old two-way design, the server could not tell "the client is really there" from "a late historical SYN," and would hand out connection resources for nothing. Sequence numbers `x` and `y` (the ISN, initial sequence number) do not start at zero or at a fixed value precisely so that late segments from an old connection cannot slip into a new one and be taken for valid data; the kernel's randomization of the ISN is one detail of "defending against history" in the protocol's design.

The handshake also finishes another piece of business on the way: **exchanging the MSS option**. Each side declares in its SYN "the largest TCP segment this link can receive at once," which is how IP-layer fragmentation is avoided -- section 5 expands on this. Just remember the timing: SYN (the first two exchanges complete within one RTT) -> ACK, and only then come data segments. In a capture, the boundary between handshake and data is the moment `length` changes from 0 to something else.

The cost of the handshake is therefore a fixed round trip. For businesses dense with short connections (the old HTTP style of opening a new connection per request), a 1 RTT setup cost is substantial on a high-latency path: a 200 ms intercontinental RTT means every connection burns 200 ms before sending a single byte. Connection reuse and pooling pay that tax once and then keep using it, which is the most effective "TCP tuning" at the application layer; on the kernel side, TCP Fast Open (TFO, where a cookie lets the very first SYN carry data) is the protocol-level patch. It never became widespread because of middlebox compatibility trouble, and knowing it exists is enough.

### 2.2 The Four-Way Teardown and Half-Close

```text
active closer                     passive closer
   │ ── FIN, seq=m ─────────────▶ │   "I am done sending"
   │ ◀──────────────── ACK ─────── │   "Noted" (but it may still have data to send)
   │                              │ ...keeps sending the remaining data...
   │ ◀── FIN, seq=n ────────────── │   "I am done sending too"
   │ ── ACK ────────────────────▶ │   -> passive side CLOSED, active side TIME_WAIT
```

The teardown takes one more step than the handshake because closing is asymmetric: at handshake time both sides start from zero and can merge their statements; at teardown the passive side may still have unsent data the instant the FIN arrives, so it can only ACK first and send its own FIN once the data is out -- ACK and FIN sent separately makes four. This is how TCP supports the **half-close**: one side calls shutdown(fd, SHUT_WR) to close only the write direction, leaving the read direction open so the peer's remaining data can still arrive. Most applications never use it and just `close()` both directions at once, but understanding it is what lets you explain the "data segments after the FIN" timing in a capture.

Closing has a second path: **RST**. An abnormal abort (a process crashing, or writing to a connection the peer already closed) sends an RST outright, skipping the teardown ritual; queued unsent data is dropped on the spot, and TIME_WAIT is never entered. "Graceful close goes through FIN, trouble goes through RST" -- the two attitudes are unmistakable in tcpdump and are direct evidence for judging "did the far end go offline normally or die abruptly."

### 2.3 The Core Subset of the State Machine

```text
                    ┌──────────┐  passive open
                    │  LISTEN  │◀──────────── server
                    └────┬─────┘
   got SYN, reply SYN+ACK │              client sends SYN
                    ┌────▼─────┐         ┌──────────┐
                    │ SYN_RECV │         │ SYN_SENT │
                    └────┬─────┘         └────┬─────┘
              got ACK    │  handshake done    │ got SYN+ACK, reply ACK
                    ┌────▼───────────────────▼────┐
                    │         ESTABLISHED         │
                    └────┬───────────────────┬────┘
     active close, send FIN│                  │ got FIN, reply ACK
              ┌────▼─────┐               ┌────▼─────┐
              │FIN_WAIT_1│               │CLOSE_WAIT│ (waiting for the app to close)
              └────┬─────┘               └────┬─────┘
           got ACK │            app closes, sends FIN
              ┌────▼─────┐               ┌────▼─────┐
              │FIN_WAIT_2│               │ LAST_ACK │
              └────┬─────┘               └────┬─────┘
           got FIN, reply ACK │               │ got the final ACK
              ┌────▼─────┐               ┌────▼─────┐
              │TIME_WAIT │── 2×MSL ──▶  │  CLOSED  │
              └──────────┘               └──────────┘
```

The two directions must be remembered separately: the **active closer** walks FIN_WAIT_1 -> FIN_WAIT_2 -> TIME_WAIT -> CLOSED, and the **passive closer** walks CLOSE_WAIT -> LAST_ACK -> CLOSED. In the same four-way teardown the two ends see completely different state sequences -- which explains the classic troubleshooting confusion: why is the server full of CLOSE_WAIT while the client is full of TIME_WAIT? Because the client initiated the close that time; reverse it and the states swap. A state is not a property of the connection, it is a property of **each end individually**.

TIME_WAIT lasts about 60 seconds (Linux hardcodes 2×MSL to 60 seconds) and exists for two reasons: first, to let stale segments from this connection die out naturally on the network so they cannot pollute a later connection reusing the same four-tuple; second, because the passive side's LAST_ACK depends on the active side still being present -- if the final ACK is lost, the passive side retransmits its FIN and the active side must still be able to answer. The "optimizations" that skip TIME_WAIT mostly dismantle these two safety nets, and section 7 returns to the topic. Also, if the peer never closes, FIN_WAIT_2 lingers; the kernel sets a timeout for **orphaned** FIN_WAIT_2 (`tcp_fin_timeout`, 60 seconds by default), but a connection held by an application is not reclaimed automatically. When a capture shows one side sending a FIN and the other staying silent for a long time, the trouble is usually in the closing logic of the peer's application.

Map states to responsibilities in a table and take from it row by row during troubleshooting:

| State | Which end | When it appears | Troubleshooting meaning |
|------|-----------|---------|---------|
| SYN_SENT | the initiator | SYN sent, no answer yet | lingering forever = the far end is unreachable or the SYN was dropped on the way (firewall DROP) |
| SYN_RECV | the receiver | got a SYN, sent SYN+ACK | piling up = nobody completes the handshake, watch for a SYN flood |
| ESTABLISHED | both | data transfer in progress | a sudden drop is worth more alarm than a sudden rise |
| CLOSE_WAIT | the passive closer | got a FIN, sent an ACK | piling up = our own application never calls `close()`, see 3.2 |
| TIME_WAIT | the active closer | after the teardown, cleanup phase | normal posture, decays by itself after 60 seconds, holds no fd |

### 2.4 keepalive and Application-Level Heartbeats

TCP has its own keepalive mechanism: once a connection has been idle longer than `net.ipv4.tcp_keepalive_time` (7200 seconds, two hours, by default) it starts sending probes, and after `tcp_keepalive_probes` consecutive unanswered probes (9 by default, at 75-second intervals) it declares the connection dead. Those defaults are far too sluggish for production services -- after the far end vanishes abnormally, you may not notice for up to two hours and ten minutes, all the while the application keeps writing to a dead connection. Tuning the kernel parameters down is certainly possible, but the more common practice is **application-level heartbeats**: short periods, full control, business semantics attached (a message queue heartbeat often reports the consumer offset along the way), and able to punch through the middleboxes that show no mercy to idle TCP connections (a carrier NAT reclaims idle UDP mappings in tens of seconds, and a long-lived TCP connection can likewise be silently cut).

One naming trap to defuse early: **HTTP Keep-Alive and TCP keepalive are two different things**. The former is an application-layer convention for reusing a connection instead of closing it after each request, and it solves handshake overhead; the latter is transport-layer dead-link detection. When diagnosing "why did the connection drop," first establish which layer is under discussion -- HTTP reuse timeouts are controlled by server settings like `keepalive_timeout` and have nothing to do with the kernel's `tcp_keepalive_*` family.

## 3. Seeing the State Machine: ss in Practice

### 3.1 Filtering and Counting by State

`ss`'s `state` filter uses exactly the state names from 2.3, and is the first entry point for statistics on connection distribution:

```bash
# Overview: one line for the whole picture -- note the breakdown in parentheses on the TCP line
$ ss -s
Total: 236
TCP:   18 (estab 9, closed 6, orphaned 0, timewait 3)

# Count by state (subtract 1 for the header)
$ ss -t state time-wait | wc -l
157
$ ss -t state established '( dport = :443 )' | wc -l
92

# CLOSE_WAIT always needs -p to attribute it to a process -- that is its only value: naming the culprit
$ ss -t state close-wait -p
Recv-Q Send-Q  Local Address:Port   Peer Address:Port  Process
0      0        192.168.1.20:45632   203.0.113.10:https users:((("app",pid=2841,fd=213)))
```

In `ss -s`'s parentheses, `estab` and `timewait` are quick heartbeat indicators: charting a trend line for those two numbers in monitoring is far more meaningful than alarming on absolute values -- TIME_WAIT rising from 50 to 5000 means the short-connection pattern has changed, while CLOSE_WAIT rising from 0 to three digits almost certainly means the application has a bug. The `fd=213` in the `-p` output is also a clue: a process whose file descriptor numbers have climbed into the hundreds, combined with `lsof -p 2841 | wc -l` to confirm the fd leak, pins down half the cause of the CLOSE_WAIT.

The two Recv-Q/Send-Q columns on a listening socket are easy to misread and deserve their own note:

```bash
$ ss -tlnp | head -3
State  Recv-Q Send-Q Local Address:Port   Peer Address:Port  Process
LISTEN 0      511    0.0.0.0:80           0.0.0.0:*          users:(("nginx",pid=918,fd=6))
LISTEN 0      128    127.0.0.53%lo:domain 0.0.0.0:*          users:(("systemd-resolve",pid=301,fd=18))
```

For a LISTEN socket, **Send-Q is the accept queue limit** (the backlog passed to `listen(fd, backlog)`; nginx defaults to 511), and **Recv-Q is the number of connections currently queued waiting for `accept()`** -- persistently non-zero means the application cannot process connections as fast as they arrive, and once the backlog fills, the kernel drops new connections outright, which the client sees as "the occasional connection timeout at peak hours." This is the same column name but a different meaning from the UDP Recv-Q in 6.2 (bytes waiting to be read), so check the State column before reading any number.

### 3.2 The Diagnostic Split Between CLOSE_WAIT and TIME_WAIT

These are the two states most often confused with each other, and the rule of thumb is one sentence: **CLOSE_WAIT means "the other side closed and you did not," TIME_WAIT means "you closed first and are cleaning up."** When the peer's FIN arrives and our kernel has sent the ACK, the connection parks in CLOSE_WAIT and only advances to LAST_ACK once the application calls `close()` -- and if the application never calls it, it parks there forever, holding the fd, the memory, and the connection table entry. TIME_WAIT is the exact opposite: the normal posture of the active closer honoring the two safety nets of 2.3, gone by itself after 60 seconds, holding no fd (in the kernel it is a lightweight mini socket), and a large population is usually the **result of high-frequency short connections** rather than a fault in itself.

The diagnostic actions fork accordingly. When CLOSE_WAIT piles up, go find the process that never calls `close()` and audit its code path -- the typical shape is that after the peer closes first, our side reads the remaining data and forgets to close, or an error branch skips the cleanup logic. Restarting the application only dulls the pain; the fds will pile up again. When TIME_WAIT is in the thousands, first ask why the business does not use long connections (a connection pool or Keep-Alive reuse is the real cure), and only if you truly need relief reach for kernel measures: outbound connections can enable `net.ipv4.tcp_tw_reuse=1` (it depends on timestamps and is on by default), which lets new connections reuse TIME_WAIT ports, and widening `net.ipv4.ip_local_port_range` from the default `32768 60999` also buys room. As for the widely circulated `tcp_tw_recycle`, it was **removed** in kernel 4.12 -- under NAT it wrongly killed connections sharing a source address, so do not copy that "tuning" out of old material.

### 3.3 Three Rules of Thumb

First, **count before capturing**. `ss` answers in milliseconds with one command; first narrow the problem to "which state, which process, which peer," then decide whether `tcpdump` is warranted. Second, **read the state distribution to tell who closed first**. TIME_WAIT concentrated on end A and CLOSE_WAIT concentrated on end B means the close was initiated by A; a distribution that contradicts the expected roles (say, a flood of client-initiated closes on connections the server should be recycling) often points straight at a design problem. Third, **after attributing to a process, audit the application before tuning the kernel**. Kernel parameters are the last gear; reversing the order costs you a pile of sysctl changes while the missing `close()` line stays untouched.

## 4. Capturing the Handshake and Teardown: tcpdump in Practice

### 4.1 Capture a Complete Session

Open a capture in one terminal, start a request in a second, and the whole life of an HTTP session lands on the screen:

```bash
# Terminal one: no name resolution, 20 packets, port 80 only
$ sudo tcpdump -i any -n -c 20 port 80
# Terminal two: curl http://203.0.113.10/
```

```text
14:31:05.301209 IP 192.168.1.20.51344 > 203.0.113.10.80: Flags [S], seq 1287305421, win 64240, [mss 1460,sackOK,TS val 3089034202 ecr 0,nop,wscale 7], length 0
14:31:05.302005 IP 203.0.113.10.80 > 192.168.1.20.51344: Flags [S.], seq 3982085013, ack 1287305422, win 65535, [mss 1460], length 0
14:31:05.302093 IP 192.168.1.20.51344 > 203.0.113.10.80: Flags [.], ack 3982085014, win 502, length 0
14:31:05.302870 IP 192.168.1.20.51344 > 203.0.113.10.80: Flags [P.], seq 1287305422:1287305490, ack 3982085014, win 502, length 68
14:31:05.303530 IP 203.0.113.10.80 > 192.168.1.20.51344: Flags [.], ack 1287305490, win 83, length 0
14:31:05.304102 IP 203.0.113.10.80 > 192.168.1.20.51344: Flags [P.], seq 3982085014:3982086078, ack 1287305490, win 83, length 1064
14:31:05.304180 IP 192.168.1.20.51344 > 203.0.113.10.80: Flags [.], ack 3982086078, win 501, length 0
14:31:05.306220 IP 192.168.1.20.51344 > 203.0.113.10.80: Flags [F.], seq 1287305490, ack 3982086078, win 501, length 0
14:31:05.306872 IP 203.0.113.10.80 > 192.168.1.20.51344: Flags [.], ack 1287305491, win 83, length 0
14:31:05.307609 IP 203.0.113.10.80 > 192.168.1.20.51344: Flags [F.], seq 3982086078, ack 1287305491, win 83, length 0
14:31:05.307664 IP 192.168.1.20.51344 > 203.0.113.10.80: Flags [.], ack 3982086079, win 501, length 0
```

Read it line by line against 2.1 and 2.2: the first three lines are the handshake (`length 0`, pure control segments), from line 4 the `length 68` is the HTTP request (a GET line is roughly that long), followed by the response and its acknowledgments; the last four lines are the four-way teardown -- client FIN first, server ACK, server FIN once its data is out, client ACK. Note the range notation such as `seq 1287305422:1287305490`: tcpdump prints start and end sequence numbers for segments that **carry data**, and the difference is the `length`; pure control segments show a single value. The `mss 1460,sackOK,wscale 7` options in the first line's SYN are exactly the "parameters exchanged along with the handshake" from 2.1, and section 5 will use the `mss` item.

On a production box the safer posture is **write to disk first, analyze later**: let the machine carry only the cost of capture while the analysis happens offline at leisure:

```bash
# Capture to a file (-w); counts and filters stay just as tight
$ sudo tcpdump -i any -n -w /tmp/session.pcap -c 2000 port 80
# Offline replay (-r); -A shows the payload in clear; the same file can go straight to Wireshark for GUI analysis
$ tcpdump -r /tmp/session.pcap | head
reading from file /tmp/session.pcap, link-type EN10MB (Ethernet)
```

pcap is the industry-standard format, and Wireshark opens tcpdump's files directly -- use the command line to confirm "is it there, and on which end," and the GUI to answer "why." Both work on the same evidence.

### 4.2 Flags Quick Reference

| tcpdump shows | Meaning | Where it appears |
|---|---|---|
| `[S]` | SYN | first step of the handshake |
| `[S.]` | SYN+ACK | second step (`.` means the ACK bit is also set) |
| `[.]` | ACK only | data acknowledgments, empty keep-alive-style ACKs |
| `[P.]` | PSH+ACK | the sender wants the data handed to the application promptly; common on data segments |
| `[F.]` | FIN+ACK | teardown |
| `[R]` / `[R.]` | RST | abnormal abort, see 4.3 |

`.` always stands for the ACK bit, and combined flags stack alphabetically. The rhythm of reading a capture is to sweep the Flags column first: a healthy session always has the shape of "three handshake lines, a run of interleaved P./. pairs, and two F./. pairs at the end" -- if the shape is wrong, the problem is already half located.

### 4.3 Three Sources of RST

When an RST appears, first ask who it is speaking for. **First, nobody is listening on the port**: the kernel receives a SYN for a port with no listener and answers with an RST immediately, which the client sees as `Connection refused` -- the fastest and most "honest" failure, telling you "the door is not open" within a millisecond. **Second, firewall REJECT**: an explicit reject rule (`reject-with tcp-reset`) **forges** an RST posing as the service, and the client likewise sees refused, but the truth is on the firewall -- during a capture, an RST whose TTL disagrees with the real service's segments is the giveaway (different platforms start from different initial TTLs). **Third, a process died**: the service crashed or was killed with `kill -9`, and the kernel sends RSTs on its behalf for every connection; an application writing to a connection the peer already closed also provokes an RST back (the writer then receives `EPIPE`/SIGPIPE). The three sources map onto three handling paths, and conflating them wastes time in the wrong direction -- see the [Firewall page](../security/firewall.md) for the policy discussion of DROP versus REJECT.

The opposite extreme of an RST is **nothing at all**: the SYN goes out and sinks, and the client eventually reports a timeout. The list of culprits is completely different -- firewall DROP (silent discard), unreachable routing, or the PMTU black hole of section 5. So the first question in troubleshooting is always: **refused or timeout?** The former means "somebody answered, but said no," the latter means "the packet never arrived or never came back" -- two worlds, two toolchains. The "port not listening" RST can be reproduced casually, seeing is believing:

```bash
$ curl --connect-timeout 2 http://203.0.113.10:8080/ &
$ sudo tcpdump -i any -n port 8080
14:39:11.102301 IP 192.168.1.20.51500 > 203.0.113.10.8080: Flags [S], seq 3512994823, win 64240, [mss 1460], length 0
14:39:11.102870 IP 203.0.113.10.8080 > 192.168.1.20.51500: Flags [R.], seq 0, ack 3512994824, length 0
# the client then receives: curl: (7) Failed to connect to 203.0.113.10 port 8080: Connection refused
```

One question, one answer, two lines, 0.7 milliseconds in total -- that is the entire shape of an "honest refusal." Compare it with the timeout case, where the SYN is retransmitted with exponential backoff (1s, 2s, 4s, ...), and the two failures are distinguishable on sight.

## 5. MTU, Fragmentation, and PMTU

### 5.1 MTU Is a Property of the Link

MTU (maximum transmission unit) is the largest IP packet a link can carry at once; typical Ethernet is 1500 bytes -- note that it constrains the IP-layer payload and excludes the 14-byte Ethernet frame header. That number is not a global constant but a **per-hop property**: 1500 on this machine's NIC, 1420 on some VPN tunnel in the middle, 1492 on the peer's PPPoE; a path's MTU is the smallest of these.

The IP layer has a mechanism for oversize packets: large packets are split into fragments that are routed independently and reassembled at the destination. But fragmentation is expensive -- **lose any one fragment and the whole original packet is void and must be retransmitted**, which for a UDP application (a large DNS response, a video stream) means one loss ruins everything; worse for TCP, congestion control misreads fragmentation as path congestion. Protocol designers therefore carved out a separate road for TCP: never fragment, and control the segment size at the source to within the minimum.

### 5.2 MSS Negotiation and PMTUD

MSS (maximum segment size) is the transport-layer counterpart: with a 1500 MTU, IPv4 gives MSS 1460 (20 bytes of IP header and 20 bytes of TCP header subtracted), and the larger IPv6 header gives 1440. The `mss 1460` carried in the SYN of the capture in 4.1 is exactly this side declaring "on this direction, do not send me segments over 1460." **Each side declares its own and each takes effect on its own**, so one handshake pins both ends' outgoing segment sizes within what both links can bear.

But MSS only covers the two ends; it cannot police the links in between. When the middle of the path has a smaller MTU (typically a tunnel), PMTUD is the fallback: the IP header sets the DF (Don't Fragment) bit, and when the packet is dropped at the narrow point, that router returns an ICMP "Fragmentation Needed" (type 3 code 4, carrying the next-hop MTU), whereupon the sender lowers its segment size and resends. The mechanism was standardized back in 1990 (RFC 1191); the trouble is that it depends on ICMP surviving the trip back -- and ICMP is often swept away wholesale by firewalls.

### 5.3 The PMTU Black Hole: Small Packets Pass, Large Ones Die

ICMP blocked + a narrow link = a PMTU black hole, whose symptom is extremely classic: **everything small works, everything large dies**. SSH interaction is fine (a few dozen bytes per packet) but `scp` hangs (full-MSS data segments); the HTTPS handshake stalls at the certificate stage (a certificate chain fills large packets); curl opens a small page but spins on a big one. Any network problem shaped like "the command line works but transferring data does not" deserves an MTU check first.

```bash
# DF set, 1472-byte payload: 1472 + 8 (ICMP header) + 20 (IP header) = 1500
$ ping -c 3 -M do -s 1472 203.0.113.10
PING 203.0.113.10 (203.0.113.10) 1500(1528) bytes of data.
From 192.168.1.1 icmp_seq=1 Frag needed and DF set (mtu = 1492)
From 192.168.1.1 icmp_seq=2 Frag needed and DF set (mtu = 1492)

# Binary-search the payload downward: 1472 fails, 1464 works -> path MTU = 1464+28 = 1492 (PPPoE)
$ ping -c 3 -M do -s 1464 203.0.113.10
1492 bytes from 203.0.113.10: icmp_seq=1 ttl=64 time=1.87 ms
```

`-M do` forces DF (`do` = Don't Fragment) and `-s` sets the ICMP payload in bytes. Getting a "Frag needed" receipt is lucky -- the path MTU is written right in the parentheses. The nastier case is when ICMP is blocked too: large payloads time out **silently** while small ones work, and then the only way is to binary-search. Once the narrow point is located, the fix is chosen by layer: if you control it, allow ICMP type 3 code 4 so PMTUD works; if the far end cannot be changed, do MSS clamping at the egress (5.4).

Investigation also starts locally -- first make sure your own NIC's MTU is not the bottleneck, especially on tunnels and virtual interfaces:

```bash
$ ip link show | grep -E "^[0-9]+:"
2: ens33: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP mode DEFAULT
3: wg0: <POINTOPOINT,NOARP,UP,LOWER_UP> mtu 1420 qdisc noqueue state UNKNOWN mode DEFAULT
# Lower it temporarily to verify (lost on reboot; for persistent configuration see Network Configuration Basics)
$ sudo ip link set dev wg0 mtu 1380
```

A tunnel interface's MTU is set by the tool that created it (wg-quick defaults to 1420), and when you add another encryption layer or nest a tunnel by hand you have to subtract the difference yourself. The persistence methods (the three families' own syntaxes for Netplan / systemd-networkd / NetworkManager) are covered together in [Network Configuration Basics](./network-configuration.md) and are not repeated here.

### 5.4 Stacked Encapsulation and MSS Clamping

VPNs and tunnels are the main breeding ground for modern MTU problems: WireGuard's default MTU is 1420 (the outer IP+UDP+encryption headers eat about 80 bytes), and PPPoE is 1492 (6 bytes of PPP header plus a 2-byte PPP protocol field). The extreme case of stacked encapsulation is "a VPN inside a VPN," where the MTU shrinks layer by layer and the innermost full-size packet is doomed.

Since the root of the black hole is "the MSS declared in the handshake is larger than what the path can actually pass," there is a sledgehammer: **MSS clamping** -- the gateway rewrites the MSS option in the SYN/SYN+ACK packets it forwards to a value the egress MTU can bear, and both ends stay none the wiser but never produce an oversize segment again. PPPoE dial-up routers and cloud overlay gateways do this by default; when you build your own NAT/gateway, remember to add it (nftables' `tcp mss clamp`, or iptables' `TCPMSS --clamp-mss-to-pmtu` target), with policy and forwarding configuration covered in the [Security chapter's firewall page](../security/firewall.md). Ten-gigabit internal networks chasing throughput will use 9000-byte jumbo frames, but that is **a consensus across the whole path** -- switch, NIC, and far end must all support it, and at the edge you still fall back to 1500.

## 6. UDP and Choosing Between Them

### 6.1 The Costs and Gains of Being Connectionless

UDP takes "best effort" all the way: no handshake, no retransmission, no ordering guarantee, no congestion control -- and in exchange gets zero setup latency, no state, and near-zero protocol overhead. That minimalism happens to fit one family of needs perfectly: **small single-round-trip transactions** (one DNS question and answer, where the application layer can simply resend), and **streams where late is worse than never** (audio, video, game state sync, where retransmitting a stale frame is pointless). The criterion is not "UDP is fast" but "can this business tolerate packet loss on its own" -- if it can, save the reliability work out of the stack; if it cannot, be honest and use TCP, or rebuild a reliability layer you control at the application layer.

That last road is exactly the recent trend: QUIC (the foundation of HTTP/3) runs over UDP but implements reliable transport, multiplexing, and a TLS-integrated handshake itself -- redoing thirty years of TCP's machinery in user space, one motivation being precisely to sidestep the ossified interference of middleboxes toward TCP (kernels that are hard to upgrade, firewalls full of "optimizations"). Understanding TCP is what lets you understand why QUIC is designed the way it is; that is where this page's knowledge lands today. When choosing, put the trade-offs side by side:

| Dimension | TCP | UDP |
|------|-----|-----|
| Setup cost | three-way handshake, 1 RTT | no handshake, fire and forget |
| Reliability | retransmission, ordering, flow control, congestion control built in | none of it, the application handles it |
| Ordering | guarantees byte-stream order | datagrams are independent, may arrive out of order |
| Broadcast/multicast | unsupported | natural fit |
| Typical payloads | HTTP, SSH, databases, mail | DNS, DHCP, NTP, audio/video streams, games |
| Modern variants | MPTCP (multipath) | QUIC (UDP with reliability built in) |

### 6.2 Observing UDP

```bash
$ ss -u -a -p | head -5
State  Recv-Q Send-Q Local Address:Port  Peer Address:Port
UNCONN 0      0      0.0.0.0:bootps      0.0.0.0:*          users:(("dnsmasq",pid=812,fd=5))
UNCONN 0      0      127.0.0.53%lo:domain 0.0.0.0:*          users:(("systemd-resolve",pid=301,fd=12))
UNCONN 0      0      192.168.1.20:47398   203.0.113.53:domain users:(("chronyd",pid=690,fd=5))
```

A UDP socket has no ESTAB-style states (it is connectionless) and is always `UNCONN`; a line like the third one, carrying a peer address, is a **connected UDP** socket -- the application called `connect()` to fix the peer, purely so the kernel can filter the packets it delivers, not any kind of handshake. For UDP, `Recv-Q` means "bytes that have arrived and are waiting for the application to read them": on a DNS server, a persistently non-zero value there means queries arrive faster than the application consumes them, an early sign of a capacity problem. This is the same name but a different meaning from TCP's listening `Recv-Q` (connections waiting for `accept()`), so establish the socket type before reading the number.

## 7. Common Pitfalls

**Panic over thousands of TIME_WAIT entries.** Mostly this is the normal posture of the active closer: in a high-concurrency short-connection business, accumulating thousands within a 60-second window is unremarkable, and they hold no fd and do not slow down new connections. Only when it comes with **outbound port exhaustion** (`connect()` reporting `Cannot assign requested address`, meaning the roughly 28,000 ephemeral ports in the default 32768-60999 range are used up) does it need action: prefer changing the application to long connections/a pool, then `net.ipv4.tcp_tw_reuse=1` (outbound only, needs timestamps), then widening `ip_local_port_range`. The old `tcp_tw_recycle` was removed with kernel 4.12 and under NAT it killed connections anyway -- do not copy it.

**CLOSE_WAIT piling up and never dropping.** This is the electrocardiogram of an application bug: the peer has FINned, our kernel has ACKed, and the connection is stuck waiting for the application to `close()`. Find the process with `ss -t state close-wait -p`, check with `lsof` whether the fd count rises along with it to confirm the leak, then audit the code -- the typical lesion is "hit EOF but the error branch never ran the cleanup." Restarting the process zeroes the curve, but the fds pile up again; only a code fix treats the cause.

**Confusing Connection refused with a timeout.** refused means an RST came back at once: the port is not listening, or the firewall REJECTs (forging an RST). timeout means the packet left and never came back: firewall DROP, no route, or an MTU black hole. The handling paths are completely different, and the error text is the first triage desk -- read whether the error says "refused" or "timed out" before picking tools.

**Treating an MTU black hole as network flakiness.** Small packets pass, large ones die; SSH logs in while `scp` hangs; a small web page opens while a large download spins -- this is a path MTU problem, not "an unstable network." Start with `ping -M do -s 1472` and binary-search; if you get "Frag needed" you can read the narrow point's MTU straight off, and if it times out silently, keep lowering the payload. The fix is allowing ICMP 3/4 or MSS clamping -- do not try to retry your way around it.

**Forgetting MSS clamping in a NAT/PPPoE environment.** Your self-built gateway does NAT and forwards happily until users report "certain sites will not open, uploading attachments fails" -- the egress MTU is smaller than the MSS declared inside, and ICMP is blocked upstream into a black hole. Applying `tcp mss clamp` (or `TCPMSS --clamp-mss-to-pmtu`) to forwarded SYNs on the gateway takes effect immediately; dial-up PPPoE routers ship with this on by default, and a self-built gateway has to add it by hand.

**Conflating SYN floods and syncookies.** A skyrocketing `ss -t state syn-recv` count with spoofed, scattered source addresses is the shape of a SYN flood; Linux's `net.ipv4.tcp_syncookies=1` is on by default and lets the server substitute a cryptographic challenge for state when the half-open queue fills, so legitimate clients are unaffected and an attacker never completes a handshake. A real high-volume flood has to be scrubbed upstream; host parameters are only the last thin shield -- to judge whether the attack is real, first look at whether the `syn-recv` to `estab` ratio is grotesque.

## References

- RFC 9293 -- Transmission Control Protocol (TCP), the current standard superseding RFC 793 -- [rfc-editor.org/rfc/rfc9293.html](https://www.rfc-editor.org/rfc/rfc9293.html)
- RFC 1191 -- Path MTU Discovery -- [rfc-editor.org/rfc/rfc1191.html](https://www.rfc-editor.org/rfc/rfc1191.html)
- Linux kernel documentation, ip-sysctl (parameters such as tcp_tw_reuse / keepalive / syncookies) -- [docs.kernel.org/networking/ip-sysctl.html](https://docs.kernel.org/networking/ip-sysctl.html)
- Bird's Private Recipes -- TCP/IP and network basics -- [linux.vbird.org](https://linux.vbird.org/linux_server/)
- man 8 ss, man 8 tcpdump, man 8 ping -- the manual pages of each tool

<!-- BACKLINKS-AUTO -->
## Related Pages

- [glossary](/glossary.md)
- [README](README.md)
- [commands-practice](commands-practice.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [README](/source/README.md)
- [network-stack](/source/network-stack.md)
