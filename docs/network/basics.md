# Network Basics

Network basics is the entry point to this chapter.
The goal here is not to memorize every protocol number,
but to answer three questions:
**why the layers exist**,
**how a packet finds its way to its destination**, and
**which Linux command shows what is actually happening**.
Get these three things straight,
and every later page -- configuration, troubleshooting, firewall --
is just reusing the same model in a specific scenario.

> Content adapted from the Arch Wiki,
> RFC 791/793/1122, and Bird's Private Recipes (Lin's Linux Administration Guide);
> see the references at the end.

## What This Page Covers

- Why networks are layered, and how layering buys replaceability, locateability, and division of labor
- Basic arithmetic of IP, subnets, and routing
- The DNS resolution chain
- Telling transport-layer ports apart from sockets
- Using `ip` and `ss` to observe the local network, as the unified entry point for later troubleshooting
- Comparing network tool installation across the three distro families

## 1. Why Layering Exists

### 1.1 The Three Real Problems Layering Solves

Early networking programs
wrote "how the physical connection works"
and "how the data content is parsed"
in the same block of code,
so swapping one NIC for another
meant rewriting all the logic.
Layering is, at its core, **contractual**:
each layer promises only a limited interface to the layers above and below it,
and the internal implementation can be swapped freely.
That buys three direct benefits:

- **Replaceability**.
  Swap Ethernet for Wi-Fi
  and only the data link layer is affected;
  IP and TCP notice nothing;
  upgrade IPv4 to IPv6
  and most application code does not need to change either.
- **Locateability**.
  When a fault happens,
  first decide which layer it belongs to,
  then collect evidence with that layer's tools,
  instead of guessing in the dark at the four words "cannot get online".
  This is the theoretical basis for
  [Network Troubleshooting](./troubleshooting.md)
  reasoning layer by layer.
- **Division of labor**.
  The kernel is only responsible for delivering to an IP/port,
  while application-layer protocols (HTTP, DNS)
  are handled in user space --
  which makes the kernel/application boundary clear.

If all the logic were mixed into one layer,
the cost of extending, troubleshooting, and collaborating would all run out of control:
a network engineer changing a route would have to touch application code,
and adding a single field to an application would restart the whole protocol stack.
Layering confines the blast radius of a change to a single layer,
and this is the structural reason the Internet has kept evolving for fifty years
while its core protocols have barely changed.

### 1.2 The OSI Seven Layers and TCP/IP Four Layers

The OSI seven-layer model is the teaching standard;
the TCP/IP four-layer model is what the Internet actually runs on.
Just memorize the mapping --
for daily troubleshooting the four-layer model is more convenient:

| OSI layer | TCP/IP layer | Transfer unit | Typical protocols/devices | Troubleshooting tool |
|--------|-----------|----------|---------------|--------------|
| 7 Application | Application | Data | HTTP, DNS, SSH | `curl`, `dig`, application logs |
| 6 Presentation | Application | Data | TLS, encoding | `openssl s_client` |
| 5 Session | Application | Data | RPC, session persistence | application logs |
| 4 Transport | Transport | Segment | TCP, UDP | `ss`, `nc -zv` |
| 3 Network | Internet | Packet | IP, ICMP, routing | `ip route`, `ping`, `traceroute` |
| 2 Data link | Network interface | Frame | Ethernet, ARP, VLAN | `ip link`, `ip neigh`, switch |
| 1 Physical | Network interface | Bits | Twisted pair, fiber, RF | `ethtool eth0`, link LED |

Worth noting:
OSI layers 5/6/7
are merged into one layer in TCP/IP --
in practice nobody captures packets just for the "presentation layer".
Memorize the seven layers for interviews, use the four for real work,
and the two are not contradictory:
the seven layers help you explain the concepts clearly,
the four layers help you pick the right tool.

### 1.3 Encapsulation: How Data Passes Through the Layers

When data leaves an application it is **encapsulated** top-down;
at the destination it is **decapsulated** bottom-up.
Take a browser visiting
`https://example.com` as an example:

1. The application layer produces the HTTP request byte stream.
2. The transport layer wraps it in a TCP header
   (source port, destination port 443, sequence number),
   forming a "segment".
3. The internet layer wraps it in an IP header
   (source IP, destination IP),
   forming a "packet".
4. The link layer wraps it in an Ethernet header and trailer
   (source/destination MAC, FCS),
   forming a "frame", handed to the NIC for sending.
5. The peer NIC receives the frame and strips it layer by layer,
   finally handing the byte stream to
   the process listening on port 443.

Each added header is like sticking another shipping label on a parcel:
the MAC label is valid only for this hop,
the IP label decides the whole route,
the TCP label decides which process to hand it to.
Understand encapsulation,
and you understand why "is the port reachable"
and "is the IP reachable" are two independent questions --
which is exactly where the step-by-step verification of the troubleshooting chain comes from:
first prove the packet reached the NIC,
then prove the packet reached the process,
and finally prove the process produced a response.

Encapsulation has one more hidden implication:
**which layer's header you see in a capture
decides what kind of problem you are troubleshooting**.
If you see frames at the link layer but no packets at the network layer,
check ARP/VLAN/switch;
if you see packets at the network layer but no connection at the transport layer,
check routing/firewall/port listening;
if the connection is fine but the application errors out,
only then is it time to read application logs.
Reverse the order,
and you will waste a lot of time in the wrong layer.

## 2. The Internet Layer: IP, Subnets, and Routing

### 2.1 IP Addresses and Private Ranges

An IPv4 address is 32 bits of binary,
usually written in dotted decimal,
for example `192.168.1.100`.
RFC 1918 carves out three ranges for private use,
and they never appear on the public Internet:

```text
10.0.0.0     - 10.255.255.255   (10.0.0.0/8,     used by large enterprises)
172.16.0.0   - 172.31.255.255   (172.16.0.0/12,  common for cloud VPCs)
192.168.0.0  - 192.168.255.255  (192.168.0.0/16, home and small offices)
```

For a private address to reach the Internet,
it must go through the egress device for **NAT**
(Network Address Translation),
which swaps the source address for a public one.
So when "the LAN can ping a public IP
but cannot open a particular site",
the problem may lie in DNS or the application layer after NAT,
not in routing --
layered thinking pays off here for the first time:
connectivity, resolution, and application
must be tested as three separate layers.

An IPv6 address is 128 bits,
written in colon-separated hexadecimal (e.g. `fe80::1`),
with globally routable addresses built in,
so NAT is usually no longer needed.
The examples in this page are IPv4-focused,
but most commands work for both
(`ip -6 addr`).
When troubleshooting a dual-stack environment, distinguish
"only link-local addresses"
from "has a global address but a missing route" --
the symptoms are completely different,
and so are the fixes.

### 2.2 Subnet Masks and CIDR

The mask answers
"are the target and I on the same L2 network".
CIDR replaces the dotted mask with a prefix length;
the two are equivalent:

```text
192.168.1.100/24   ->   mask 255.255.255.0    ->   same subnet: 192.168.1.0 - 192.168.1.255
10.0.0.0/8         ->   mask 255.0.0.0        ->   same subnet: 10.0.0.0 - 10.255.255.255
172.16.0.0/12      ->   mask 255.240.0.0      ->   172.16.0.0 - 172.31.255.255
```

The decision logic:
AND both addresses with the mask,
if the results match they are on the same subnet,
and you go straight to the link layer with ARP to find the MAC;
otherwise hand it to the default gateway.
**The classic symptom of a wrong subnet mask**
is "same-subnet neighbors work, everything across subnets fails",
or the reverse --
the mask is set larger than reality,
and traffic that should go through the gateway is misjudged as direct.
Use `ip -br addr`
to check the prefix length quickly:

```bash
$ ip -br addr
lo               UNKNOWN        127.0.0.1/8 ::1/128
eth0             UP             192.168.1.100/24 fe80::216:3eff:fe12:3456/64
```

The same prefix does not necessarily mean the same subnet:
VLAN, VXLAN, and cloud security groups
can all cut in another way between L2 segments.
If the mask is right but ARP cannot reach the gateway,
look toward the link layer and switch configuration,
not toward editing the IP over and over --
**correct address configuration
is only the starting point of "you can start troubleshooting",**
not a sufficient condition for connectivity.

### 2.3 Routing: The Packet's Navigation Table

The kernel consults the routing table for every packet it forwards,
and the rule is simple:
**longest prefix match** --
take the route with the longest (most specific) matching prefix.
Viewing and interpreting:

```bash
$ ip route show
default via 192.168.1.1 dev eth0 proto dhcp src 192.168.1.100 metric 100
192.168.1.0/24 dev eth0 proto kernel scope link src 192.168.1.100 metric 100
```

The first is the default route
(`default`, equivalent to `0.0.0.0/0`),
matching any target not hit by a more specific entry;
the second is a directly connected route,
generated automatically by the kernel once the interface gets an address,
meaning "this subnet goes straight out eth0,
no gateway needed".
`via` specifies the next hop,
`dev` specifies the outgoing interface,
and `src` optionally specifies the source address.

Verifying how one specific target will go
is more useful than reading the whole table:

```bash
$ ip route get 8.8.8.8
8.8.8.8 via 192.168.1.1 dev eth0 src 192.168.1.100 uid 1000
    cache
```

The output tells you the outgoing interface and next hop directly.
If this step is already wrong,
the later `ping` is guaranteed to fail --
**in troubleshooting, check the route first, then check reachability**;
the order cannot be reversed.
When multiple NICs, multiple gateways, and policy routing coexist,
`ip route get` also reflects
the result of rule matching,
making it the single fastest command for judging
"traffic is leaving out the wrong interface".

The three most common entry types in a routing table are:
directly connected routes (auto-generated by the kernel),
static routes (written by hand by an administrator),
and dynamic routes (learned by a protocol).
None of the three distro families runs a dynamic routing daemon by default,
so cloud VPCs and container networks
often need extra components
(such as bird, calico) to inject routes.
First figure out who wrote each entry,
then decide which configuration to change,
and you avoid a lot of wasted effort.

### 2.4 The Gateway's Job

The default gateway is a router
that stands on two subnets at the same time,
and it does two things on behalf of the LAN host:
forward packets bound for unknown subnets,
and do NAT when needed.
So "ping the gateway"
is the fastest way to split the problem in two --
if it goes through,
then this machine to the link segment is fine
and the fault is behind the gateway;
if it does not,
the problem is in local configuration, the link, or the gateway itself.
This dividing line will reappear again and again in
[Network Troubleshooting](./troubleshooting.md).

The gateway itself can also be a failure point:
it may reply to ICMP but not forward;
it may have an ACL blocking the return path;
or the MTU may be stuck at that hop.
So after "the gateway is reachable"
you must still test "a public IP is reachable" and "a hostname is reachable" --
all three steps are necessary.
Verifying the gateway as a black-box next hop
is far more reliable than assuming "the gateway must be fine" --
the real break point in most LAN faults
is actually NAT or DNS behind the gateway.

## 3. DNS: Turning Names into Addresses

### 3.1 Why DNS Is Needed

IP numbers are hard to remember;
DNS (Domain Name System)
provides a distributed "name -> address" mapping.
Note that it is **a separate chain from connectivity**:
a machine may ping `8.8.8.8` perfectly
yet fail to open `example.com` --
which is exactly why a connectivity test
must be run once with an IP and once with a hostname,
to separate "the network is down"
from "name resolution is broken".

A simplified path for one resolution on Linux:
the application calls `getaddrinfo()` ->
glibc decides the order from the `hosts:` line in `/etc/nsswitch.conf`
(usually `files dns`,
i.e. check `/etc/hosts` first
then DNS) ->
the DNS query goes to
the `nameserver` in `/etc/resolv.conf`.
If the system has `systemd-resolved` enabled,
`resolv.conf`
is often a symlink to `127.0.0.53`,
and the real upstream DNS records
live in resolved's own configuration.
This full chain is expanded in its own section in
[Network Configuration Basics](./network-configuration.md).

A long resolution chain means many failure points:
hosts written wrong,
nsswitch order reversed,
resolv.conf overwritten by NetworkManager,
upstream unreachable,
cache returning a stale record --
every link shows up as
"the hostname will not open".
Reading the config files in order
instead of jumping straight to `systemctl restart`
is the first discipline of DNS troubleshooting.

### 3.2 Observing One Resolution

```bash
$ cat /etc/resolv.conf
nameserver 192.168.1.1
search example.com

$ dig example.com +short
93.184.216.34
```

What `search example.com` means:
when accessing the short name `myserver`,
it is automatically completed to `myserver.example.com` before the lookup.
Multi-domain search is very useful in multi-zone environments,
but it can also cause
stealthy problems like "resolved to the wrong host of the same name" --
when troubleshooting, use `dig +short`
to look up the full name explicitly,
and do not rely on the result of short-name completion.

### 3.3 /etc/hosts and Resolution Order

`/etc/hosts` is a local static mapping,
with priority decided by `nsswitch.conf`.
It is often used for temporary hostname hijacking in a development environment,
but it is also easy to leave stale entries behind --
for the case of "edited hosts but it did not take effect",
the first step is always to confirm
that `files`
really comes before `dns`
in `nsswitch.conf`.

Hosts edits are not cached,
but the browser and application layer may have their own caches;
a misconfigured nsswitch will make the edit never take effect at all.
The two look similar but have different root causes;
the way to tell them apart is to use `getent hosts <name>`
to ask the system layer directly --
if getent is right but the application is still wrong,
the problem is in the application cache;
if getent itself is wrong,
the problem is in the hosts/nsswitch order.

## 4. The Transport Layer: Ports and Sockets

The transport layer answers "hand it to which process".
TCP provides connection-oriented reliable transport
(three-way handshake, sequence numbers, retransmission),
while UDP is connectionless best-effort.
Both use 16-bit port numbers to identify processes,
in the range 0-65535,
of which 0-1023 are privileged ports
requiring root to bind.

Choosing between TCP and UDP also reflects the layered idea:
if you need delivery confirmation, ordering,
and congestion control, use TCP
(HTTP, SSH, DNS over TCP);
if you would rather drop packets than add latency, use UDP
(video, games, QUIC).
Understanding this trade-off
lets you read why
"the UDP port is not reachable" sometimes
does not send an RST at all --
a connectionless protocol has no concept of "reject"
and can only time out in silence.

On Linux, "is the service listening"
and "is the network reachable" are likewise two separate things.
To view listening sockets,
`ss` is the modern replacement for `netstat`,
faster and requiring no extra package:

```bash
$ ss -tlnp
State  Recv-Q Send-Q Local Address:Port  Peer Address:Port
LISTEN 0      511    0.0.0.0:22          0.0.0.0:*
LISTEN 0      511    0.0.0.0:80          0.0.0.0:*
LISTEN 0      128    [::]:22             [::]:*
```

`-t` limits to TCP,
`-l` shows only listeners,
`-n` does not resolve service names
(avoiding interference from `/etc/services`),
`-p` shows the process
(needs root to see all processes).
In listening state `Recv-Q`/`Send-Q`
mean the current backlog count and the backlog queue limit;
sustained non-zero values often signal the application cannot consume fast enough --
this is the most common kernel-side signal of
"the service is alive but the user is stuck".

`netstat` has not disappeared,
but it belongs to the `net-tools` package:
Debian family needs `apt install net-tools`,
Arch needs `pacman -S net-tools`,
and RHEL family no longer installs it by default in newer versions.
New scripts should always use `ss`;
when maintaining old scripts, knowing this package-name difference is enough.
Gradually replacing netstat with ss in old monitoring scripts
is also a routine step to avoid scripts silently failing on a freshly installed machine.

## 5. Linux Network Observation Entry Points: ip and ss

### 5.1 The ip Command Family: One Tool for Three Layers

`ip` is provided by `iproute2`
and is the unified entry point for the link layer (`link`)
and the internet layer (`addr`/`route`/`neigh`).
All three distro families can install or upgrade it through their respective package managers:
Debian/Ubuntu use `apt install iproute2`,
Arch uses `pacman -S iproute2`,
RHEL/CentOS/Rocky use `dnf install iproute`
(preinstalled by default).
Compared to the outdated ifconfig/route,
ip's output is more complete
and better suited to script parsing.

```bash
# Link layer: is the interface UP, is it dropping frames
$ ip -s link show eth0
3: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 ...
    RX:  bytes packets errs drop fifo frame compressed multicast
         1048576    8234    0    0    0     0     0        0
    TX:  bytes packets errs drop fifo colls carrier compressed
         524288     6102    0    0    0     0    0        0

# Internet layer: addresses and prefixes
$ ip -br addr show eth0
eth0 UP 192.168.1.100/24 fe80::216:3eff:fe12:3456/64

# Neighbor table: is same-subnet MAC resolution working
$ ip neigh
192.168.1.1 dev eth0 lladdr aa:bb:cc:dd:ee:ff REACHABLE
192.168.1.50 dev eth0 FAILED
```

The `errs`/`drop` counters in `ip -s link`
are the first place to look for physical and driver problems:
if the counts keep growing,
the frames are being dropped at the link layer,
and a capture often cannot see the complete traffic at that point --
check the cable, duplex negotiation, or a loop first.
`FAILED` in `ip neigh`
means ARP resolution failed --
the target may be powered off,
or there may be an address conflict on the subnet.
Whether the counters "are growing"
matters more than "what the current value is";
when troubleshooting, sample twice a few seconds apart and look at the delta.

### 5.2 ss: A Microscope for the Transport Layer

The value of `ss` lies in its filtering ability.
Common combinations:

```bash
ss -tlnp                 # all listening ports and their processes
ss -tn state established # established connections
ss -s                    # connection summary statistics per state
ss -tn dst 93.184.216.34 # only connections to a given address
```

The `-i` option also shows
TCP internals such as the congestion window and retransmit count,
which is the key clue when diagnosing "the network is slow but ping is fine" --
`retrans` climbing steadily means the loss
is happening on a path visible to the transport layer.
Cross-checking ss state counts
against `netstat -s` retransmit statistics
can often pin down "slowness" to packet loss,
slow application processing,
or a backed-up queue within a minute.

### 5.3 From Model to Command

Compress this section into one cross-reference table,
and during troubleshooting you just pick the tool by layer:

| Layer | What to ask | What to use |
|----|--------|--------|
| Physical/link | Is the interface up, are there error frames | `ip link`, `ip -s link`, `ethtool`, link LED |
| Internet | Is the address right, how does the route go, are neighbors reachable | `ip addr`, `ip route`, `ip neigh`, `ping`, `traceroute` |
| Transport | Is the port listening, what state are the connections | `ss -tlnp`, `nc -zv` |
| Application | Is name resolution right, does the service answer | `dig`, `curl`, application logs |

This table is also the index for the pages that follow:
the configuration page solves "how to set each layer",
the troubleshooting page solves "how to check each layer",
the firewall page solves "why each layer is being dropped".
The tool names change,
but the reasoning structure does not --
pin down the layer first,
then worry about command fluency.

## 6. Three-Family Installation Comparison

When a tool is missing, fill it in per the table below;
every command can be copied directly.
Arch always uses `pacman -S`,
Debian/Ubuntu use `apt install`,
RHEL/CentOS/Rocky use `dnf install`:

| Purpose | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| `ip`/`ss` (iproute2) | `apt install iproute2` | `pacman -S iproute2` | `dnf install iproute` |
| `dig`/`nslookup` | `apt install dnsutils` | `pacman -S bind` | `dnf install bind-utils` |
| `traceroute` | `apt install traceroute` | `pacman -S traceroute` | `dnf install traceroute` |
| `mtr` | `apt install mtr-tty` | `pacman -S mtr` | `dnf install mtr` |
| `tcpdump` | `apt install tcpdump` | `pacman -S tcpdump` | `dnf install tcpdump` |
| `netstat` (compat with old scripts) | `apt install net-tools` | `pacman -S net-tools` | `dnf install net-tools` |

The update commands for Debian and RHEL
are `apt update`
and `dnf check-update`
(or `dnf makecache`) respectively;
Arch fetches the latest repo index with `pacman -Sy`,
uses `pacman -Su` to update only existing packages,
and `pacman -Syu` for a full upgrade.
**Do not run
only `pacman -S <pkg>` on Arch
while never doing a system upgrade** --
after some library dependency upgrades
you can end up in a half-new half-old state,
which is the most common way to self-injure on a rolling release.
Running `pacman -Syu` to level the baseline before installing a tool
saves a lot of time compared to repairing a half-upgraded state afterwards.

## 7. Common Pitfalls

- **Treating "I can log into QQ/WeChat" as a working network**.
  Many instant messengers use UDP
  or come with multi-IP fallback,
  which masks DNS failures.
  To judge connectivity, run three separate tests:
  `ping <gateway IP>`,
  `ping 8.8.8.8`,
  and `ping example.com` --
  which validate the link, the route, and resolution respectively.
- **Setting a subnet mask of 255.255.255.0
  while planning addresses on /16**.
  Cross-subnet hosts are misjudged as directly connected,
  ARP cannot reach the gateway,
  and the symptom is "the gateway does not ping but the interface has an address".
- **Confusing the `state` in `ip link`
  with actual availability**.
  An interface showing `UP`
  only means the administrative state is on;
  `LOWER_UP`
  means a carrier was detected (the cable is plugged in).
  On virtual interfaces, or when a cable is unplugged,
  `UP` without `LOWER_UP` is common.
- **Using `ping 127.0.0.1` succeeding
  to claim "the network stack is healthy"**.
  Loopback skips most of the NIC and route-lookup logic;
  it succeeding only proves the local TCP/IP stack has not crashed,
  and says nothing about outward connectivity.
- **Ignoring IPv6**.
  A `fe80::` address shown by `ip addr`
  is a link-local address, not a fault;
  but if there is only a link-local address and no global address,
  that means IPv6 SLAAC/DHCPv6 is not working,
  and some IPv6-only environments
  will show up as "half-reachable" as a result.

Every pitfall maps back to a section's principle earlier:
the mask pitfall is in 2.2,
the state pitfall in 5.1,
the IPv6 pitfall in 2.1.
Remember the symptom first,
then go back to the principle section --
that lasts longer than memorizing the conclusion --
swap the distro or the toolset and
the symptoms change, but layering does not.

## 8. Hands-on Verification

After reading this section,
run the following set of commands to walk the model end to end,
confirming each step's output matches what you expect:

```bash
ip -br addr                 # what are my addresses and prefixes
ip route show               # who does the default route point to
ip route get 1.1.1.1        # which exact path to a public host
ip neigh                    # did the gateway MAC resolve
ping -c 2 192.168.1.1       # link layer to the gateway
ping -c 2 1.1.1.1           # internet layer to the public Internet
dig +short example.com      # is DNS usable
ss -tlnp                    # what services is this machine offering
```

The eight commands cover
the complete vertical slice from link to application.
Any anomalous output
means the corresponding layer has a problem --
and that is the starting point the later pages keep expanding on.
Put these eight in a script you can run on a whim:
run it once when a new machine comes online,
once when entering a container,
and once after a VPN connects --
that will catch most configuration mistakes on the local machine
before a user reports a fault.

## References

- Arch Wiki - Networking -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Networking)
- Arch Wiki - iproute2 -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Iproute2)
- Bird's Private Recipes (Lin's Linux Administration Guide) - Network basics -- [linux.vbird.org](https://linux.vbird.org/linux_server/centos6/0110network_basic.php)
- RFC 791 (Internet Protocol), RFC 793 (Transmission Control Protocol)
- RFC 1918 (Private address space), RFC 1035 (DNS implementation and specification)
- `man ip`, `man ss`, `man nsswitch.conf`, `man resolv.conf`

<!-- BACKLINKS-AUTO -->
## Related Pages

- [glossary](/glossary.md)
- [README](README.md)
- [network-configuration](network-configuration.md)
- [tcpip-essentials](tcpip-essentials.md)
- [coverage-matrix](/research/coverage-matrix.md)
