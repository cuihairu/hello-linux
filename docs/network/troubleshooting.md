# Network Troubleshooting

"The network is down" is the vaguest sentence in an operator's career --
it may mean a loose cable, a wrong IP,
a dead gateway, polluted DNS, a crashed service on the far end,
or simply one extra rule line added to a firewall.
Faced with a vague description,
the only efficient move is
**to break it into an ordered series of yes/no questions**,
starting from the most certain local facts
and pushing outward hop by hop:
local machine -> gateway -> DNS -> remote host.
Each step verifies exactly one hypothesis,
using command output as evidence rather than gut feeling.

> Content adapted from the tcpdump, traceroute, and ss
> manuals and hands-on troubleshooting experience;
> see the references at the end.

## What This Page Covers

- Internalizing the four-segment chain of reasoning
  "local -> gateway -> DNS -> remote", so any fault has an entry point
- Reading the real output of `traceroute`, `tcpdump`, and `ss`
  and drawing conclusions from it
- Telling apart the evidence-gathering approaches for
  "misconfigured", "blocked", and "path broken"
- Building reusable diagnostic scripts and recording habits

## 1. Methodology: Why This Order

The essence of troubleshooting is **shrinking the unknown interval**.
One successful communication requires four path segments at once:
the local protocol stack, the link to the gateway,
name resolution, and end-to-end reachability.
They depend on each other in series --
if any segment fails, the later ones never happen.
Checking them in dependency order therefore guarantees
that each step's input is a premise the previous step already verified.

1. **Local machine**: are the interface, address, routes, and listeners right?
   This segment is entirely under your control and its evidence is the easiest to obtain.
2. **Gateway**: is the internal exit reachable?
   It splits the problem in two:
   not reachable means an internal-network or local problem,
   reachable means the problem is further out.
3. **DNS**: can the name become an IP?
   This must come after pinging the IP,
   otherwise you cannot separate "the network is broken" from "resolution is broken."
4. **Remote host**: does the target host and target port answer?
   Test once with the IP and once with the name,
   and use a capture to confirm whether packets really leave and come back.

The order has a psychological advantage as well:
most faults occur in the first two segments
(configuration and local link dominate the statistics),
so checking them first has a high hit rate and fast feedback.
Skipping ahead straight to a capture or a service restart
is the commonest waste of time --
you may capture a pile of packets
only to discover the machine never had an address at all.

Agree on the criteria up front
so that each step is not re-interpreted:

- **ping succeeds**:
  the internet layer is reachable in both directions
  (ICMP request and reply both pass).
- **pinging the target IP succeeds but pinging the name fails**:
  the problem is DNS, not the network.
- **`* * *` appears in the middle of a traceroute**:
  that hop does not return ICMP time-exceeded, or it is filtered --
  possibly a firewall,
  possibly just a target that does not answer ICMP,
  so other evidence is required.
- **tcpdump shows an inbound SYN and no outbound reply**:
  responsibility is local or in local policy;
  if no inbound SYN is visible, responsibility is on the upstream path.

Write these four rules on the first page of the on-call handbook
so nobody has to reinvent the criteria each time.
The value of the chain of reasoning is not how fresh the commands are,
it is that **the order is stable** --
the later the hour, the more you should rely on a fixed procedure
instead of on-the-spot inspiration.

## 2. Segment One: The Local Machine

### 2.1 Interfaces and Addresses

Start from the least disputable facts --
is the interface UP, and did it get an address:

```bash
$ ip -br addr
lo   UNKNOWN 127.0.0.1/8 ::1/128
eth0 UP      192.168.1.100/24 fe80::216:3eff:fe12:3456/64
```

The three common anomalies each point somewhere definite:
an interface in `state DOWN`
means the administrative state was never enabled
(`ip link set eth0 up`,
or an `ONBOOT`/`dhcp4` problem in the configuration file);
an interface that is UP but has no IPv4 address
is usually a DHCP failure or a static config that never applied;
and `errs`/`drop` from `ip -s link show eth0` climbing steadily
points at link-layer quality --
at that point packet loss happens even if everything above is fine,
so fix the link first (duplex, loops, driver)
and only then discuss upper-layer configuration.

Loopback self-checking takes one command
and confirms the protocol stack itself has not fallen over:

```bash
$ ping -c 2 127.0.0.1
PING 127.0.0.1 (127.0.0.1) 56(84) bytes of data.
64 bytes from 127.0.0.1: icmp_seq=1 ttl=64 time=0.031 ms
64 bytes from 127.0.0.1: icmp_seq=2 ttl=64 time=0.045 ms
```

Note the limit of loopback:
passing only means the local TCP/IP stack is intact
and says nothing about external reachability --
some people declare "the network is fine"
off the back of a successful `ping 127.0.0.1`
and hit a DNS failure one second later.
Loopback is step zero of the chain, not the destination.

### 2.2 Routing

A correct address does not mean packets can get out;
you also need to see where the routing table sends them:

```bash
$ ip route show
default via 192.168.1.1 dev eth0 proto dhcp src 192.168.1.100 metric 100
192.168.1.0/24 dev eth0 proto kernel scope link src 192.168.1.100 metric 100
```

A missing `default via ...` is a frequent problem
whose symptom is "same subnet works, the internet does not at all";
it commonly comes from a failed DHCP renewal
or a manually written configuration that forgot the gateway.
`ip route get 1.1.1.1`
gives this machine's actual chosen exit directly,
which is faster than reading the whole table.
If this step is already wrong,
later pings to the internet are guaranteed to fail
and there is no point digging further --
**the chain of reasoning allows early termination**,
which is exactly how it saves time.

On multi-NIC machines also watch for
**policy routing**:
if `ip rule show`
contains
`from <local-ip> lookup <table>`,
then traffic to certain destinations
does not use the main table at all,
and reading `ip route show` alone gives the wrong answer.
Cloud instances and multi-carrier data centers
routinely use this mechanism for traffic splitting;
during troubleshooting, read `ip rule` first
and then look at the corresponding table --
the order is not negotiable.

### 2.3 Listening and Local Ports

When "I cannot even reach my own service,"
first confirm the service really is listening
and bound to the address you expect:

```bash
$ ss -tlnp | grep :80
LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=812,fd=6))
```

A service bound to `127.0.0.1:80`
will always fail when reached from outside,
and the firewall has nothing to do with it --
this kind of "fake firewall problem" makes up a large share of cases.
`ss`'s `-p`
needs root privileges to show process names,
so a normal user not seeing one does not mean no process exists.

The typical origin of a loopback binding is
`listen 127.0.0.1:80` in the config
or a framework default.
The way to confirm it is the `ss` above:
`Local Address:Port`
showing `0.0.0.0:80`
or `*:80` means open on every interface,
while `127.0.0.1:80`
means only the local machine can connect.
Remember to reload the service after changing it --
if the `ss` output did not move, the config was never loaded.

## 3. Segment Two: The Gateway

### 3.1 Why the Gateway Is the Watershed

The gateway stands on both the internal and external sides at once,
and it is the boundary of what you control locally.
Pinging the gateway cuts the fault domain cleanly in half:

```bash
$ ping -c 3 192.168.1.1
PING 192.168.1.1 (192.168.1.1) 56(84) bytes of data.
64 bytes from 192.168.1.1: icmp_seq=1 ttl=64 time=1.24 ms
64 bytes from 192.168.1.1: icmp_seq=2 ttl=64 time=1.18 ms
64 bytes from 192.168.1.1: icmp_seq=3 ttl=64 time=1.31 ms
```

- **Works**: the link, address, and ARP from this machine to the exit are healthy,
  so the problem lies beyond the gateway
  (upstream carrier, the far end, DNS, or firewall forwarding).
- **Fails**: the problem is pinned between this machine and the gateway --
  ARP resolution failure, a misconfigured VLAN,
  a wrong gateway IP, a physical link fault,
  or the local firewall blocking ICMP.

When it fails, check the neighbor table immediately
to separate "nobody at layer two"
from "someone at layer three who will not answer":

```bash
$ ip neigh
192.168.1.1 dev eth0 lladdr aa:bb:cc:dd:ee:ff REACHABLE
192.168.1.50 dev eth0 FAILED
```

`FAILED` means the ARP request
got no reply at all:
the gateway may be down, the VLAN may not match,
or there may be an IP conflict on the subnet
(the conflicting party answered with the wrong MAC and the kernel marked it).
`STALE`/`DELAY`/`PROBE`
are normal state machine transitions, not a reason to panic;
only a persistent `FAILED` is a fault signal.

If two machines on the same subnet share one IP,
the symptoms are often bizarre:
intermittent reachability, or traffic always ending up at the wrong machine.
Seeing one IP map to two different MACs in `ip neigh`
(flush with `ip neigh flush all` first, then watch)
confirms the address conflict.
Traceroute cannot show this class of problem at all;
the neighbor table locates it in three seconds.

### 3.2 Does the Exit IP Answer

Once the gateway works,
test the internet layer with a public IP,
skipping DNS interference entirely:

```bash
$ ping -c 3 1.1.1.1
PING 1.1.1.1 (1.1.1.1) 56(84) bytes of data.
64 bytes from 1.1.1.1: icmp_seq=1 ttl=57 time=12.4 ms
```

`ttl=57`
(starting values are usually 64 or 128, decremented per hop)
means several routers were crossed
and the packet genuinely left the internal network.
If the gateway pings but a public IP does not,
the candidate causes are:
exit NAT configuration, a carrier outage,
an outbound firewall on this machine or the gateway,
or the target IP being blocked upstream.
At that point use `traceroute`
to see which hop it breaks at (section 5).

Choosing the public target also matters:
prefer anycast addresses such as
`1.1.1.1` and `8.8.8.8`
that are **guaranteed to answer ICMP**
rather than some arbitrary server --
many hosts block ping
and create the illusion of "the network is down."
Reaching two anycast addresses
is enough to prove the exit route is fine,
and the remaining problem is in DNS or the application layer.

## 4. Segment Three: DNS

### 4.1 Separate a Dead Network from Dead Resolution

Many people declare "the network is down"
the moment `ping example.com` fails,
but that command depends on the network and DNS at the same time.
Split the test:
`ping -c 2 1.1.1.1` succeeds (the network layer is fine),
while `ping -c 2 example.com` reports
`ping: example.com: Name or service not known`.

As long as the IP works and the name fails,
the problem is certainly in the resolution chain
and has nothing to do with links or routing.
The full resolution path
(`nsswitch.conf` -> the order in `hosts:` ->
`resolv.conf`/systemd-resolved)
has its own section in
[Network Configuration Basics](./network-configuration.md);
only the evidence-gathering actions are given here.

### 4.2 Evidence, Layer by Layer

```bash
# 1. Does the config file have a nameserver at all
$ cat /etc/resolv.conf
nameserver 192.168.1.1

# 2. Is the resolution order putting files ahead of dns
$ grep '^hosts' /etc/nsswitch.conf
hosts:          files dns myhostname

# 3. Ask a known-good upstream directly, bypassing local config
$ dig +short example.com @1.1.1.1
93.184.216.34

# 4. Compare against the local default configuration
$ dig +short example.com
# If step 3 returned a result and this one does not,
# the problem is pinned to the local DNS configuration
```

`dig @server` is the most important dividing tool:
it sends the query straight to the upstream you name,
bypassing `resolv.conf`.
If step 3 works while the default query fails,
the network and the upstream are both fine
and only the local configuration is broken
(`resolv.conf` overwritten,
resolved not running, nameserver mistyped).
Only when step 3 also fails
is the egress being blocked or the upstream itself down.

On systems with systemd-resolved enabled
you should also check its state and cache --
`resolvectl status` for ownership and upstream,
`resolvectl query example.com` to verify a single resolution,
and `resolvectl flush-caches` to clear the cache.
Cache pollution classically looks like
"it worked a moment ago and suddenly does not,"
and an immediate recovery after `flush-caches` confirms it.
If `resolvectl` reports
`Unit systemd-resolved.service not found`,
resolved is not enabled on this system,
`resolv.conf` should be a real file,
and you can edit it directly.
Check the `search` domain while you are there --
a wrong search domain appends an irrelevant suffix to short names,
showing up as
"some short names resolve to strange addresses."

## 5. Segment Four: The Remote Host

### 5.1 traceroute: Locating the Break

When gateway and DNS are both fine,
the question is which specific hop on the path is broken.
`traceroute`
increments the TTL to trigger ICMP time-exceeded from routers along the way,
drawing the path hop by hop:

```bash
$ traceroute -n -m 15 93.184.216.34
traceroute to 93.184.216.34 (93.184.216.34), 15 hops max, 60 byte packets
 1  192.168.1.1    1.182 ms  1.104 ms  1.098 ms
 2  100.64.0.1     4.215 ms  4.180 ms  4.142 ms
 3  72.14.204.33   8.542 ms  8.498 ms  8.455 ms
 4  * * *
 5  93.184.216.34 12.481 ms 12.402 ms 12.377 ms
```

How to read it:
hop 1 must be your gateway,
and if it is not, the default route points somewhere wrong;
`* * *` means that hop did not return ICMP before the timeout --
middleboxes filtering ICMP and targets that ignore probes are both common,
so **a single `*` hop is not a fault**;
only when every hop from some point onward is `* * *`
and the destination never answers
does it suggest that direction may be blocked.
On cross-carrier paths, losing stars at hops 4 and 5 is routine
and not worth investigating.

To separate "UDP probe blocked" from "ICMP blocked,"
switch protocol or port and try again:
`traceroute -T -p 443`
probes port 443 with TCP SYNs
and gets through devices that only pass TCP;
`traceroute -I`
switches to ICMP echo probes.

The value of `-T` is this:
if TCP 443 gets through while UDP/ICMP does not,
there is protocol-level filtering in the middle
rather than a routing black hole --
which points the suspicion straight at the firewall
instead of the link.
When investigating "only web pages open and nothing else works,"
this move layers the problem instantly.

Traceroute also has a common misreading:
**the hop with the highest latency is not necessarily the culprit**.
Routers answer ICMP at a very low priority,
and high latency often just means "can't be bothered."
Only when every hop **after** that one
slows down in step with it
should you suspect its forwarding performance.
Look at the trend, not at a single point.

### 5.2 tcpdump: Turning Guesses into Evidence

`tcpdump` is the final judge in troubleshooting.
Every command before it is
"an inference from our own viewpoint";
a capture shows **what actually happened on the wire**.
Installations across the three families:
Debian/Ubuntu `apt install tcpdump`,
Arch `pacman -S tcpdump`,
RHEL/CentOS/Rocky `dnf install tcpdump`.

The classic capture for diagnosing "a TCP connection will not establish":

```bash
$ sudo tcpdump -ni eth0 port 80 -c 10
tcpdump: verbose output suppressed, use -v or -vv for full protocol decode
listening on eth0, link-type EN10MB (Ethernet), capture size 262144 bytes
14:22:01.183421 IP 192.168.1.50.51234 > 192.168.1.100.80: Flags [S], seq 1829345678, win 64240, options [mss 1460,sackOK], length 0
14:22:02.184561 IP 192.168.1.50.51234 > 192.168.1.100.80: Flags [S], seq 1829345678, win 64240, options [mss 1460], length 0
14:22:03.185702 IP 192.168.1.50.51234 > 192.168.1.100.80: Flags [S], seq 1829345678, win 64240, options [mss 1460], length 0
```

Three `[S]` segments with the same `seq`
are the client's three retransmissions,
which means the SYN reached this machine
but no `Flags [S.]` (SYN-ACK) ever came back.
Combined with `ss -tlnp`
showing the port in `LISTEN`,
you can all but conclude that
**the local firewall is dropping the SYN on INPUT
or the response on OUTPUT** --
exactly the evidence-gathering procedure
described in the [Firewall](./firewall.md) page.

The other direction:
if `sudo tcpdump -ni eth0 port 80`
stays silent for a long time
while the client insists it "cannot connect,"
the packets never reached this machine at all
and the problem is on the path between the client and here
(client routing, upstream devices,
or the client hitting the wrong IP).
Capturing more on this machine is pointless then --
go collect evidence upstream or on the client side.
**An empty capture is itself important evidence.**

Common filter expressions
(tcpdump uses BPF syntax):
`'host 192.168.1.50 and port 443'`
restricts host and port,
`'tcp[tcpflags] & (tcp-syn|tcp-fin) != 0'`
shows only handshake and teardown segments
(the fastest route to judging connection setup quality),
and adding `-w /tmp/cap.pcap`
saves the file for Wireshark.
**Always add `-n`** --
default reverse DNS lookups slow the output down
and mislead you precisely when resolution is broken.

### 5.3 Port-Level Verification

To see whether a port works,
use `ss` for the local viewpoint
and `nc`/`curl` for the client's:

```bash
# Server: confirm it is listening
$ ss -tlnp | grep :443
LISTEN 0 511 *:443 *:* users:(("nginx",pid=812,fd=8))

# Client: did the three-way handshake succeed
$ nc -zv 192.168.1.100 443
Connection to 192.168.1.100 443 port [tcp/https] succeeded!

$ curl -svI https://example.com 2>&1 | grep -E 'Connected|HTTP/'
* Connected to example.com (93.184.216.34) port 443 (#0)
< HTTP/2 200
```

If `nc` succeeds and `curl` fails,
the transport layer is fine
and the fault is in the application layer
(TLS, HTTP, SNI, certificate chain);
if `nc` fails too,
go back to the network layer and keep digging.
This bisection is far more effective than blindly restarting the web server --
**layered evidence-gathering always ends at
"which layer failed first"**.

## 6. Worked Cases

### 6.1 A Complete Chain of Reasoning

A log-style record of a real troubleshooting session,
usable as a template:

Symptom: a user reports that `https://app.example.com` will not open,
while everyone else on the office network is fine.

1. Local checks (on the user's machine):
   `ip -br addr` -> address looks right, `192.168.1.50/24`;
   `ip route get 1.1.1.1` -> `via 192.168.1.1`, routing fine;
   `ping -c 2 127.0.0.1` -> works, the stack is fine.
2. Gateway:
   `ping -c 2 192.168.1.1` -> works;
   `ping -c 2 1.1.1.1` -> works, the exit is OK.
3. DNS:
   `ping -c 2 app.example.com` -> Name or service not known;
   `dig +short app.example.com @1.1.1.1` -> returns a result;
   `cat /etc/resolv.conf` -> nameserver points at a decommissioned old server.
   Conclusion: the network is fine; the DNS configuration points at a dead server.
   Fix: change it to 1.1.1.1 / 8.8.8.8 and recover after `flush-caches`.

No service was restarted,
no firewall rule was touched,
and the fault was located within four steps.
That is the value of the chain:
**each step eliminates one class of possibilities
instead of suspecting every layer at once**.
Paste this record into the ticket
and the next person on call can take over from step 3
without repeating the first two.

### 6.2 Wireless Troubleshooting

Wireless adds a radio layer and an association state,
and the tools differ from wired
(`iw` replaces the obsolete `iwconfig`,
which belongs to the `wireless-tools` package):

```bash
$ iw dev wlan0 link
Connected to aa:bb:cc:dd:ee:ff (on wlan0)
        SSID: Office-WiFi
        freq: 5180
        signal: -52 dBm
        tx bitrate: 433.3 MBit/s

$ iw dev wlan0 station dump | grep -E 'signal|connected time'
        signal:  -52 [-53, -56, -59] dBm
        connected time: 3604 seconds
```

Below about -75 dBm
the signal usually starts to misbehave,
with roaming and retransmissions visibly raising latency;
if `signal` fluctuates a lot
and `tx bitrate` keeps dropping,
rule out channel congestion and
microwave/Bluetooth interference first,
then look at the driver and power-save settings.
Association is fine but no IP is obtained --
go back to sections 2 and 3 for DHCP and DNS.
Wireless-specific problems tend to exist only in the association phase;
once connected,
the rest of the reasoning is identical to wired.

### 6.3 VPN Faults

A VPN is a logical tunnel overlaid on the physical network;
the troubleshooting order is still the same chain,
with one extra layer added --
"is the tunnel interface up":

```bash
$ sudo wg show
interface: wg0
  public key: 3L4x...=
  listening port: 51820

peer: 9Zc1...
  endpoint: 203.0.113.5:51820
  allowed ips: 10.0.0.2/32
  latest handshake: 42 seconds ago
  transfer: 1.24 MiB received, 2.51 MiB sent
```

A `latest handshake`
stuck far in the past means the tunnel is dead;
first check whether UDP 51820
is being blocked by the exit firewall
(`tcpdump -ni eth0 udp port 51820`
to see whether traffic flows both ways).
If the handshake is fine but pings inside the tunnel fail,
check whether `AllowedIPs`
covers the destination subnet
and whether the local `ip route`
points that subnet at `wg0` --
this is WireGuard's most common configuration blind spot;
see [VPN](./vpn.md) for details.

### 6.4 Automated Health Sweeps

Turn the four-segment check into a script;
it suits an inspection job or a pre-check before alerting:

```bash
#!/bin/bash
GW=${GW:-192.168.1.1}
TARGET=${TARGET:-1.1.1.1}
DOMAIN=${DOMAIN:-example.com}

check() {
  if eval "$2" >/dev/null 2>&1; then
    echo "OK    $1"
  else
    echo "FAIL  $1"
  fi
}

check "local loopback"  "ping -c1 -W1 127.0.0.1"
check "default route"   "ip route | grep -q default"
check "gateway"         "ping -c1 -W1 $GW"
check "public IP"       "ping -c1 -W2 $TARGET"
check "DNS"             "ping -c1 -W2 $DOMAIN"
check "listening port"  "ss -tlnn | grep -q ':22'"
```

The script only judges, it never repairs --
repair requires a human
deciding based on where the FAIL landed.
Feeding the `OK/FAIL` output into the monitoring system
finds anomalies before users report them;
attaching the relevant deep-diagnostic command automatically
to a stage that keeps FAILing
(such as `ip neigh` or `dig @upstream`)
cuts the on-call engineer's repetitive work.

The difference between a sweep and live troubleshooting is
the **dimension of time**:
a sweep asks "is today the same as yesterday,"
troubleshooting asks "which step is failing right now."
Every `check` in the script
corresponds to one segment of the chain,
so an alert can say
"FAIL gateway"
directly,
which is an order of magnitude more useful
than saying "network anomaly."

## 7. Performance Problems: Working but Slow

"It works, but it is slow" needs a different set of evidence.
Quantify before concluding:

```bash
# Continuous observation of loss and latency
$ mtr -r -c 50 1.1.1.1
                            Loss%   Snt   Last   Avg  Best  Wrst StDev
  1.|-- 192.168.1.1          0.0%    50    1.1   1.2   0.9   2.1   0.3
  2.|-- 100.64.0.1           0.0%    50    4.2   4.3   3.9   6.0   0.5
  3.|-- ???                 100.0%    50    0.0   0.0   0.0   0.0   0.0
  4.|-- 1.1.1.1              2.0%    50   12.4  13.1  11.9  22.7   2.8

# Bandwidth validation (server runs iperf3 -s, client pushes traffic)
$ iperf3 -c 192.168.1.200 -t 10
[  5]   0.00-1.00   sec   112 MBytes   941 Mbits/sec    0 sender
```

`mtr` output is worth far more than a single `ping`:
it reports the loss rate of every hop at once,
which separates "loss along the whole path"
from "loss that only starts after a certain hop."
Loss on the last hop with a clean middle path
is usually the far end or its access layer;
loss starting persistently at some middle hop
puts the problem at that device or its downstream link.
**Middle star hops (`???`) are not evidence** --
as long as the final hop's Loss is low, you are fine.

Local soft drops deserve a look too:
the `drop` counter from `ip -s link show eth0`,
the connection summary from `ss -s`,
and the listen overflows and retransmission counters in `nstat -az`.

A growing `drop` on `ip -s`
means the NIC or the kernel buffers
cannot keep up
(ring buffer, interrupt affinity, pps over the limit);
a growing `TcpExtListenOverflows` in `nstat`
means the application's `accept`
queue is full --
in that case the network layer is entirely healthy
and the fix is to scale the application or tune `somaxconn`;
see the tuning section of
[Network Configuration Basics](./network-configuration.md).

Performance work must also separate
**a saturated link from degraded latency**:
`iperf3` settles the first immediately,
while the second requires looking at whether mtr's RTT curve
jitters over time.
Conflating the two
makes a scaling decision in the wrong direction.

## 8. Common Pitfalls

- **Pinging without checking `ip route get` first**.
  When the routing table lacks a default entry,
  pinging the internet is guaranteed to fail;
  looking at the routes first saves half the time.
- **Using `ping <name>` to test the network and DNS at once**.
  When it fails you cannot attribute the cause;
  test the IP and the name separately.
- **Treating a `*` in the middle of a traceroute as a fault**.
  ICMP filtering is normal;
  only "everything from this hop onward is dark" deserves suspicion.
- **Capturing on the wrong machine**.
  If no inbound SYN shows up locally,
  the packets never arrived here,
  so go capture on the client or on a middlebox instead.
- **Forgetting `-n`**.
  `tcpdump`/`traceroute`
  do reverse DNS by default,
  and when DNS is broken the output stutters or misleads;
  always add `-n` during troubleshooting.
- **Depending on `netstat` on machines that do not have it**.
  `netstat` belongs to `net-tools`
  (Debian family `apt install net-tools`,
  Arch `pacman -S net-tools`,
  and recent RHEL no longer ships it by default);
  on new systems just use `ss`.
- **Still using `iwconfig` for wireless**.
  `wireless-tools` is obsolete;
  `iw` is the proper tool for the kernel's nl80211 interface,
  and `iwconfig` cannot see
  5GHz/6GHz bands or modern association state.
- **Changing configuration without verifying persistence**.
  `ip addr add` disappears at reboot;
  after a temporary test it must land in
  Netplan/nmcli/networkd configuration,
  otherwise "it worked yesterday" repeats itself.
- **Fixing a problem without writing anything down**.
  Record symptom, evidence, hypothesis, and fix in four columns;
  three months later when the same class of fault recurs,
  that record beats any memory.
- **Reaching for a service restart first**.
  A restart may make the problem vanish temporarily
  but it also destroys the scene --
  at least finish the first two segments of the chain
  before deciding whether to restart.
- **Giving up on "intermittent" as "not reproducible"**.
  Intermittent faults have patterns too:
  does it land on the hour,
  does it coincide with batch jobs or a backup window,
  does it only happen on a particular exit link.
  Aligning monitoring history against the timeline
  is far more proactive than waiting for the next collision.
- **Syncing conclusions verbally in a team**.
  Intermediate conclusions that were never written down
  get distorted in handover --
  "the gateway answers" can be relayed as "the network is fine."
  Write key judgments into the ticket or the on-call channel
  with the raw command output attached,
  so the evidence travels with the conclusion.
- **Ignoring time zones and timestamps**.
  When comparing logs across machines,
  clock skew can invert the ordering of events entirely,
  especially for tunnel, TLS, and log-correlation problems.
  Confirm synchronization with `chronyc tracking` first,
  then compare timelines.

## 9. Recording, Post-Mortems, and Handover

The end of troubleshooting is not "it is fixed";
it is that the next fault of the same kind gets fixed faster.
Writing the process down
is not documentation for documentation's sake --
it is so that the next 3 a.m. alert
can reuse the reasoning path you already verified last time.

A minimal but sufficient record
needs only four fields:
symptom (who reported what, in what environment),
evidence (each command and its key output),
hypothesis (what is suspected now, and on what grounds),
and fix (what changed, and how the effect was verified).
With those four columns filled in,
handover no longer depends on verbal relay --
the next on-call engineer can continue from any intermediate state
instead of replaying the first two steps.

A post-mortem is not about whose fault it was;
it asks where the chain of reasoning became inefficient:
was a pre-check script missing,
was the capture one step late,
did the alert fail to carry enough context?
Patching those three kinds of weakness into
the sweep, the toolchain, and the alert wording
is more effective than a long blame meeting.

Time-boxing matters too:
give yourself a cap for each stage
(two minutes on the local machine,
one on the gateway,
three on DNS),
and escalate or hand over when it runs out.
Troubleshooting easily sinks into the
"one more command and it will work" trap;
time-boxing forces you to change viewpoint
before your efficiency drops --
which is the structural reason team troubleshooting
is steadier than solo troubleshooting.

## References

One last piece of practical advice:
turn the chain in this article plus the real addresses of your own environment
(gateway, upstream DNS, critical business IPs)
into a one-page on-call card,
pinned next to the monitoring dashboard or embedded in the ticket template.
Tools will change and networks will shift,
but the order "outward, hop by hop, from the most certain facts"
does not stop working when you move data center or cloud provider --
it deserves to become the team's default action
rather than each person improvising from experience.

- `man tcpdump`, `man traceroute`,
  `man mtr`, `man ss`, `man ip`,
  `man nmap`, `man nc`
- tcpdump official manual -- [tcpdump.org](https://www.tcpdump.org/manpages/)
- Arch Wiki - Network troubleshooting -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Network_configuration)
- Red Hat - Troubleshooting network connectivity -- [redhat.com](https://docs.redhat.com/)
- Cisco - BGP common troubleshooting (a reference for troubleshooting methodology) -- [cisco.com](https://www.cisco.com/c/en/us/support/docs/ip/border-gateway-protocol-bgp/22166-bgp-trouble-main.html)
- Bird's Private Recipes - Network debugging -- [linux.vbird.org](https://linux.vbird.org/linux_server/centos6/0110network_basic.php)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [network](/hardware/network.md)
- [README](README.md)
- [basics](basics.md)
- [commands-practice](commands-practice.md)
- [firewall](firewall.md)
- [network-configuration](network-configuration.md)
- [network-monitoring](network-monitoring.md)
- [tcpip-essentials](tcpip-essentials.md)
- [vpn](vpn.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [network-parameters](/server/network-parameters.md)
- [routing-nat](/server/routing-nat.md)
