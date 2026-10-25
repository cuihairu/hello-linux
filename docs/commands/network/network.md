# Network Management Commands

For a server, the network is the lifeline: SSH will not connect, DNS resolution fails, the port is not listening -- these account for well over half of day-to-day troubleshooting. Network problems feel scary because they look like "black magic": the configuration is clearly right, yet it just does not work. In reality, network troubleshooting follows a very fixed chain of reasoning -- **is the local configuration right -> can the local machine get out -> is the path in between open -> is the target service alive** -- and every link in the chain has its corresponding command. The task of this page is to nail down the commands for the "local state" segment of this chain: `ip` for interfaces and routes, `ss` for ports and connections, the three-family configuration entry points that decide "where to change things", and the DNS resolution path that decides "how a domain becomes an IP". Cross-machine transfer, HTTP testing, packet capture, and other tool scenarios live in [Network Tools](./network-tools.md); firewall rules themselves are covered in [Network chapter - Firewall](../../network/firewall.md). This page keeps only the "is the port listening" layer of judgement, to avoid duplicating those two pages at length.

> The commands on this page -- `ip`, `ss`, `resolvectl` -- work the same across the three families **Debian/Ubuntu, Arch, and RHEL/CentOS/Rocky**; the differences concentrate in **where persistent configuration is written, which daemon manages the network, and who answers DNS on your behalf**, and each is flagged in place in the text. All output comes from real terminals (an Ubuntu 26.04 + systemd-networkd + systemd-resolved environment); the addresses and process names on your machine will differ, but the format matches and you can compare against it.

## What This Page Covers

- Understanding why modern distros replaced `ifconfig`/`netstat` with `ip`/`ss`
- Using `ip link`/`ip addr`/`ip route`/`ip neigh` to answer "is the interface up, what is the address, where do packets go, who are the neighbours"
- Filtering connections by state/port/process with `ss`, and reading `Recv-Q`/`Send-Q` and TIME-WAIT
- Telling the three families' persistence entry points apart: Netplan, systemd-networkd, NetworkManager (nmcli)
- Mapping the local DNS resolution path: `nsswitch.conf` -> `/etc/hosts` -> the systemd-resolved stub -> the upstream DNS, and troubleshooting it with `resolvectl`

## 1. Why ip/ss Replaces ifconfig/netstat

`ifconfig` and `netstat` come from the net-tools package of the 1980s and have long lacked maintenance: interface statistics are vaguely defined, they do not support newer kernel features like policy routing or network namespaces, and they scan `/proc` painfully slowly on machines with many connections. iproute2 (`ip`, `ss`) is a direct wrapper around the kernel netlink interface -- a superset of features, preinstalled by default on all three families, and contemporary with `nftables`, cgroups, and network namespaces. The official Arch repos no longer ship net-tools by default; on Debian/Ubuntu, `ifconfig` often only appears after a manual `sudo apt install net-tools`. Commands you saw in older material may simply not exist on a freshly installed server.

Side by side, the same task:

| What you want to do | Old command (net-tools) | New command (iproute2) | Note |
|------------|---------------------|--------------------|------|
| List all interfaces | `ifconfig -a` | `ip -br link` | `-br` puts one line per interface, good for a quick scan |
| Show IP addresses | `ifconfig eth0` | `ip addr show eth0` | `ip addr` is the long form of `ip a` |
| Bring an interface up/down | `ifconfig eth0 up/down` | `ip link set eth0 up/down` | Maps to link-layer state |
| Show the routing table | `route -n` | `ip route show` | `ip r` is the equivalent shorthand |
| Show ARP/neighbours | `arp -n` | `ip neigh show` | No longer IPv4-only |
| Show listening ports | `netstat -tlnp` | `ss -tlnp` | `ss` reads netlink directly, an order of magnitude faster |
| Show connection state | `netstat -an` | `ss -ant` | Add a state filter on top |

```bash
$ ip -br link
lo               UNKNOWN        00:00:00:00:00:00 <LOOPBACK,UP,LOWER_UP>
ens18            UP             bc:24:11:c2:af:88 <BROADCAST,MULTICAST,UP,LOWER_UP>

$ ip -br addr
lo               UNKNOWN        127.0.0.1/8 ::1/128
ens18            UP             192.168.5.188/24 metric 100 fe80::be24:11ff:fec2:af88/64
ztksetoehl       UNKNOWN        10.147.19.84/24 fe80::40f:3dff:feb1:93f0/64
```

`-br` (brief) squeezes each interface into one line: name, state, MAC, IP. When troubleshooting, run this one first -- it is far faster than reading `ifconfig` line by line. `UNKNOWN` does not mean failure; it only means the interface currently has no "operational" layer-2 semantics (loopback and point-to-point tunnels often look like this), and what really matters is whether the `UP` flag and an IP are present. Seeing `UNKNOWN` and assuming the NIC is broken is a mistake: tunnels, veth pairs, and loopback almost always show `UNKNOWN`. As long as `ip addr` shows an address and traffic flows, ignore that state word.

The other line, `ztksetoehl`, is a typical point-to-point/tunnel device (note the name does not start with `ens`/`enp`); it has no "broadcast domain" semantics inside a global IPv4 subnet, so it also often shows `UNKNOWN`. When reading `-br addr`, go by three questions: **is the state UP, is there an IPv4 address, is there a default route** (routes are in the next section). Whatever is missing, dig only in that layer -- do not start by blaming DNS or the firewall.

Which package provides these commands differs slightly across the three families, but the conclusion is the same -- **learn iproute2 first; you only need net-tools to read old documentation**. On Ubuntu, `dpkg -S` shows `ip`/`ss` come from `iproute2` and `ping` from `iputils-ping`, while `net-tools` is a separately installed legacy toolkit (Version 2.10-2ubuntu1). To decide whether a machine has net-tools, checking the package database is more reliable than `command -v ifconfig` -- some slim images ship a same-named shell function or a busybox applet, creating the illusion that "the command is there but the package is not".

- **Debian/Ubuntu**: `ip`/`ss` are provided by `iproute2` and installed by default; `ifconfig`/`netstat`/`route` come from `net-tools`, which was installed explicitly on this machine -- a clean system may not have it.
- **Arch**: `iproute2` is a base dependency, and `pacman -S iproute2` almost always reports it as installed; net-tools is not in the default install set, so install it with `sudo pacman -S net-tools` when needed.
- **RHEL/CentOS/Rocky**: also ships `iproute2` by default; a minimal install may lack `ping`, in which case run `sudo dnf install iputils`.

The three families agree: **write iproute2 in all new documentation and new scripts**; you only need to install net-tools on the fly when maintaining a decade-old operations manual. If you must mix the two (not recommended), at least stay with one set inside any single piece of automation, so you do not feed `route -n` output format to a script that parses `ip route`.

When migrating from `ifconfig` to `ip`, the hardest part to get used to is the **grammar**: `ifconfig eth0 192.168.1.10/24` fuses object and action together, while `ip` standardises on `ip object action` -- addresses go under `address`, link state goes under `link`, so do not expect `ip addr up`. The official migration document (`ip-cref`) has a long cheat sheet; for daily use, remembering the seven rows of the table in this section is enough. The rarer usages (`ip link add type veth`, `ip netns exec`) can wait until you actually need to create virtual devices, at which point the man page will do.

## 2. The ip Command Family: Interfaces, Addresses, Routes, Neighbours

The syntax of `ip` is `ip [options] object command`, with objects including `link` (layer 2), `address` (layer 3 addresses), `route` (routing table), `neigh` (neighbour/ARP), `netns` (network namespace), and so on. Objects can be abbreviated: `ip a` = `ip addr`, `ip r` = `ip route`.

### 2.1 ip link -- Link-layer state

`ip link` answers "does the NIC exist, is the driver loaded, is it UP". In `<BROADCAST,MULTICAST,UP,LOWER_UP>`, `UP` means an administrator brought it up, and `LOWER_UP` means the physical carrier was detected (cable and link are good). Only `LOWER_UP` without `UP` means the physical link is fine but an administrator shut the interface down; if neither is present, check the cable first, or whether the virtual device was even created.

A single-interface detail listing has many fields; for daily use, four is enough: `mtu` (was it shrunk by a tunnel or PPPoE), `state` (the kernel's view: UP/DOWN), the `link/ether` MAC, and the `inet` and `inet6` addresses with their prefixes. `altname` is the predictable-name alias (`ens18` and `enp6s18` refer to the same device), which helps you reconcile old scripts that hard-code an interface name. `valid_lft forever` means the address never expires; for a DHCP lease, this field shows the remaining time, so when a lease is about to run out and was not renewed, this line tells you "the address is about to go away" rather than "the network is down". Also distinguish `scope global` from `scope link`: a global address is routable beyond the subnet, while link-local is only usable on the local subnet; when IPv6 traffic fails and you only have `fe80` and no global address, it is usually RA/SLAAC or DHCPv6 that was not configured.

Four rules cover temporary up/down: link on/off with `ip link set dev interface up|down`, add or delete an address with `ip addr add|del address/prefix dev interface`, and **all of it is lost on reboot**. `metric` is route priority; the smaller the number, the higher the priority. DHCP on the same interface often carries `metric 100`, so if you add an address by hand without specifying a metric, it can conflict with the default route's priority and produce "the address is there but nothing flows". When operating remotely, treat `down` as a last resort -- it is indistinguishable from unplugging the cable as far as the session is concerned.

### 2.2 ip route -- Where packets go

The routing table decides which NIC and which gateway each destination address leaves from. The troubleshooting order is fixed: first check whether a default route exists, then use `ip route get` to verify what the kernel actually picks for a specific target.

```bash
$ ip route show
default via 192.168.5.11 dev ens18 proto dhcp src 192.168.5.188 metric 100
10.147.19.0/24 dev ztksetoehl proto kernel scope link src 10.147.19.84
192.168.5.0/24 dev ens18 proto kernel scope link src 192.168.5.188 metric 100
192.168.5.0/24 via 10.147.19.17 dev ztksetoehl proto static metric 5000

$ ip route get 8.8.8.8
8.8.8.8 via 192.168.5.11 dev ens18 src 192.168.5.188 uid 1000
```

`default via 192.168.5.11` is the default gateway; `proto dhcp` means this route came from DHCP and may be rewritten when DHCP runs again; the `metric 5000` static route has low priority and will not steal the default egress. The output of `ip route get` is "if a packet to 8.8.8.8 were sent right now, how would the kernel actually route it" -- when `ip route show` has several overlapping routes, only this command gives the final answer.

The local routing table has a good teaching example: `192.168.5.0/24` appears in two routes at once -- one is `dev ens18 ... metric 100` (direct), the other is `via 10.147.19.17 dev ztksetoehl metric 5000` (a static route via the tunnel). The kernel picks the smaller metric, so same-subnet traffic goes out the physical NIC; if you changed the static route's metric to 10, traffic would immediately switch to the tunnel. **Same-subnet traffic that is "sometimes fast, sometimes slow", or "clearly direct yet takes a detour", is usually metric or overlapping prefixes fighting each other**. When troubleshooting, do not just check whether a default route exists; check **which route the target subnet matched and what its metric is**.

Also distinguish the three sources `proto dhcp`, `proto kernel`, and `proto static`: `kernel` is a directly connected route auto-generated from interface configuration, `dhcp` may be rewritten wholesale as the lease refreshes, and `static` comes from a config file or a manual command. When changing configuration, if you expected static but see proto dhcp, the manager has not taken over yet, or DHCP reclaimed a manual command -- this explains the weird "the address is there but the route was washed away" symptom.

Three rules cover temporary add and delete of routes (lost on reboot or interface reset): default gateway with `ip route add default via gateway`, a specific subnet with `ip route add target/prefix via gateway`, and delete by swapping `add` for `del`. In production, prefer declaring routes in the configuration manager; temporary commands are for firefighting only.

Policy routing (`ip rule`) is common on multi-NIC/multi-egress servers; the default three rules are enough to read the priority: smaller numbers match first, the `local` table handles local addresses, `main` is the table shown by `ip route show`, and `default` is usually empty. Only add custom rules when you need to steer traffic by source address or fwmark -- that is an advanced topic, and for everyday troubleshooting, just confirm the `main` table is right.

### 2.3 ip neigh -- Layer-2 neighbours

Same-subnet communication relies on ARP/ND to resolve an IP to a MAC. When the gateway does not respond to ping but the link layer looks fine, look at the neighbour table first:

```bash
$ ip neigh show
192.168.5.11 dev ens18 lladdr 04:0e:3c:2f:c5:a9 REACHABLE
192.168.5.125 dev ens18 FAILED
192.168.5.5  dev ens18 lladdr bc:24:11:7d:b8:44 STALE
192.168.5.1  dev ens18 lladdr 94:28:6f:bf:d1:35 REACHABLE
fe80::5 dev ens18 lladdr 94:28:6f:bf:d1:35 router STALE
```

`REACHABLE`/`STALE` are normal neighbour states (STALE just means the cache entry expired and will refresh on next use); **`FAILED` means ARP resolution keeps failing** -- common causes: an IP on the wrong subnet, the remote end powered off, or a switch port-security/VLAN mismatch. `lladdr` is the resolved MAC, which you can cross-check against the switch's MAC table.

A very useful cross-check for neighbour-table troubleshooting: run `ip neigh show | grep yourip` on the remote machine and see **whether both sides have learned each other's MAC**; then actively send an ARP with `arping -I interface peerip` (requires `arping`/`iputils-arping`, with package names differing slightly across the three families). If one side has it and the other does not, the problem is a one-way link, a VLAN, or ARP filtering in a firewall; if both sides show FAILED and you are on the same subnet, suspect an IP conflict or a mismatched subnet mask first. `ip neigh flush dev interface` clears stale entries before you retest, but it is **clearing the cache, not fixing the root cause** -- if it still fails after a flush, stop flushing.

### 2.4 Statistics and detail

To read dropped and errored packets and decide whether the problem is in the application or in the driver/link, use `ip -s link show interface`. Watch the growth rate of three columns: `errors` (checksum/frame errors, usually cable or duplex), `dropped`/`missed` (the kernel could not receive in time -- interrupt affinity or ring buffer), and TX `carrier` (the remote link flapping). **Before reading statistics, write down the current values and look at the delta after you reproduce the problem**, rather than agonising over cumulative totals -- `bytes` accumulate since boot, so a few TB of RX bytes is perfectly normal. What is actually worth a threshold alert is the **growth rate** of the first three columns, plus jumps in `carrier`. On a cloud host, if those three columns stay at 0 for a long time, you can largely rule out the network layer and start looking at the application and DNS. Cross-check `ip -s` against `ethtool -S` to pin down driver-level counters.

## 3. ss: Ports, connections, and queues

`ss` is the modern replacement for `netstat`: it asks the kernel for socket information directly, without scanning `/proc/net`. The most used combination is `-tlnp`: TCP listeners + numeric ports + show the process. The three most instructive lines in real output are `0.0.0.0:22`, SSH listening on all interfaces; `127.0.0.1:3306`, MySQL bound to loopback only (the outside not being able to connect is by design, not a firewall failure); and `127.0.0.53%lo:53`, the systemd-resolved stub (not your application stealing the port). The `Process` column is only complete under root or for the same user; for ordinary users it is often empty.

A fixed chain works well for the full "cannot connect from outside" judgement: **first `ss -tlnp` to see the listen address, then `ss -ant | grep target` to see whether SYNs are arriving and reaching ESTABLISHED, and only then open the firewall and application logs**. When only loopback is listening, the right fix is to change the application's `bind` address or add a reverse proxy, not to flood the firewall with allow rules -- the packets never reach a destination socket outside netfilter's PREROUTING in the first place. Conversely, if listening is normal but there are SYNs with no ACKs, the problem is in the path, the firewall, or a non-responding remote end, which is exactly where to switch to the firewall page and `tcpdump`.

The common filters fit into one sentence to memorise: **use `-tln` for listening ports, add `p` to find the process, use `-ant state established` for long-lived connections, `-o state time-wait` for buildup, and `-s` for totals**. When typing, narrow with `| grep :80` or `| grep pid` as needed. The `ss -s` output is good for a quick "are the connections blowing up" check: `estab` climbing while the business shows no growth points to a leak; tens of thousands of `timewait` with normal `estab` is usually just a short-connection pattern and not something to panic about (combine with `ss -o state time-wait` to see the timers). A non-zero `orphaned` means look for a process that never called `close`.

That reading is enough to support 90% of port-related tickets. Worth expanding is **the meaning of Recv-Q and Send-Q in different states**: in LISTEN, `Recv-Q` is the number of connections waiting to be accepted and `Send-Q` is the backlog limit; if the former is close to the latter, the application cannot accept fast enough, so raise the backlog or fix the application. In ESTABLISHED they become the bytes pending in the send and receive buffers. The root cause of many "service is stuck" incidents is a full accept queue, and that signal only flashes past in `ss -tlnp` -- when troubleshooting, spend two extra seconds on a suspect port and look at those two columns; it is often faster than flipping through ten pages of logs.

Another one is **UDP**: `ss -ulnp` has the same format, but UDP has no three-way handshake, so "LISTEN is normal" does not mean the remote end is receiving -- you need business logs or packet capture. The nasty DNS, SNMP, and syslog cases often stall here: `ss` can only prove the local socket exists, not that the datagrams went out or that replies came back.

| Meaning | netstat | ss |
|------|---------|-----|
| TCP listeners + process | `netstat -tlnp` | `ss -tlnp` |
| All TCP connections | `netstat -ant` | `ss -ant` |
| UDP listeners | `netstat -ulnp` | `ss -ulnp` |
| Connection statistics | `netstat -s` | `ss -s` |
| Filter by process | `netstat -anp \| grep pid` | `ss -antp \| grep pid` |

When you need to walk a socket back to "the file descriptor or command line that opened it", `lsof` still has a place (`lsof -i :3306`), but it is slower than `ss` and not installed by default on all three families; use `ss -tlnp` for daily work. It becomes indispensable only when you need **which process is on the other end of an established connection**, or when you use `lsof` to see every file a process has open (not just network ones). The `-P` in `lsof -i -P` stops port numbers being resolved back to service names, which avoids the `https`/`443` confusion during troubleshooting and almost always belongs in the pipeline; in the output, `LISTEN` and `ESTABLISHED` appear side by side, so you can see at once "who is listening" and "who is connected to who".

## 4. Network configuration entry points across the three families

`ip`/`ss` manage "right now"; how addresses are restored after a reboot is a completely different entry point across the three families. Copying a config file from family A to family B not only fails to take effect, it can leave the machine entirely unreachable -- **before changing the network remotely, confirm the distro and keep a console or out-of-band rollback path**.

| Family | Default manager | Configuration entry point | How it is applied | Common commands |
|------|-----------|----------|----------|----------|
| Debian/Ubuntu (common on desktop/server) | Netplan (backend networkd or NM) | `/etc/netplan/*.yaml` | `sudo netplan try` (120-second auto-rollback) or `netplan apply` | `netplan status`, `netplan get all` |
| Debian slim/container | ifupdown | `/etc/network/interfaces` | `ifup`/`ifdown` or restart ` networking ` | `ifquery --list` |
| Arch (common on servers) | systemd-networkd | `/etc/systemd/network/*.network` | `sudo systemctl reload systemd-networkd` | `networkctl status`, `networkctl list` |
| Arch (common on desktops) | NetworkManager | `/etc/NetworkManager/system-connections/` | `nmcli connection up name` | `nmcli`, `nm-online` |
| RHEL/CentOS/Rocky 7 | ifcfg scripts | `/etc/sysconfig/network-scripts/ifcfg-*` | `nmcli connection reload` or restart the network service | `nmcli`, `ifup` |
| RHEL/CentOS/Rocky 8+ / Fedora | NetworkManager (keyfile) | `/etc/NetworkManager/system-connections/` (`.nmconnection`) | `nmcli connection up name` | `nmcli`, `nmcli device` |

After reading the table, add two facts that echo section 3, so "config entry point" and "current state" do not get mixed up: the table above manages **how addresses are restored after a reboot**, while `ss`/`ip` manage **who is listening right now and who is connected to who** -- before changing the network remotely, first record the current listeners with `ss -tlnp`, then compare again after the change, so you can confirm the change only touched the interfaces it should.

Two version facts to remember:

1. **From RHEL 9, the `network-scripts` package is no longer provided**; the `/etc/sysconfig/network-scripts/ifcfg-eth0` style in older material has nowhere to land on the new system, so switch to `nmcli`/NetworkManager keyfile across the board.
2. **Netplan does not configure NICs itself, it only generates backend configuration**. In `netplan status`, `ens18 ... (networkd: ens18)` means the YAML was generated by netplan but is actually executed by systemd-networkd; the same Ubuntu box may also show `NetworkManager`, depending on the `renderer` setting.

The real state on this machine (Ubuntu + networkd) condenses into three sentences: loopback and tunnels are managed by the kernel and other components, and Netplan does not touch them; the physical NIC `ens18` is UP, its address comes from DHCP, and the default route goes via `192.168.5.11`; DNS delivered four servers (including a link-local one), so `resolvectl dns` shows multiple nameservers. `Online state: online` only means the manager thinks the configuration is satisfied, **which is not the same as business connectivity** -- it is "configuration-layer health", and connectivity still needs ping or curl to verify. Separating those two kinds of health is the key to avoiding the "the state says online but the internet does not work" confusion.

`unmanaged` means Netplan/the manager does not take over this device (common for tunnels and container veth pairs); `managed` with `(dhcp)`/`(networkd)` is the interface that is "governed by declarative configuration". After editing the YAML, run `sudo netplan try` first -- if you do not confirm within the countdown it auto-rolls back, which is the most practical safety net against locking yourself out on Ubuntu.

`netplan status` has one more thing worth watching: whether `Online state: online` and each link's `DNS Addresses` and `Routes` match what you wrote in the YAML. If the YAML says a static IP but the state still shows `(dhcp)`, the device match name (`match:` MAC/name) is wrong, the file was not applied, or NM stole it; if `DNS Addresses` is empty yet you can reach the internet, DNS probably went out another link or through a manual `resolv.conf` -- do not conflate this with the resolution path in section 5 -- **netplan shows "what the manager delivered", while `resolvectl dns` shows "what resolved is actually using"**, and both deserve a look.

When verifying on the same machine, run two terminals in parallel: one edits the YAML and runs `netplan try`, the other keeps `watch -n1 'ip -br addr; ip route'` running. Confirm inside the countdown, then press Enter to save; if routes disappear, do nothing at all -- it auto-rolls back after 120 seconds. This flow is an order of magnitude more reliable than "apply and then pray the SSH is still there", and is why we keep the Ubuntu entry point in the master table.

The matching at-a-glance contrast on Arch: the config is INI style rather than YAML --

```ini
# /etc/systemd/network/10-eth0.network (Arch / systemd-networkd example)
[Match]
Name=eth0

[Network]
Address=192.168.1.100/24
Gateway=192.168.1.1
DNS=8.8.8.8
DNS=8.8.4.4
```

On RHEL, do not hand-edit the keyfile binary/INI for daily work; prefer `nmcli`, which changes the configuration and activates the connection at the same time:

```bash
nmcli connection show                    # list connections
nmcli device status                     # list devices
nmcli connection modify name ipv4.addresses 192.168.1.100/24
nmcli connection up name
```

The test for **temporary vs persistent** is simple: addresses added with `ip addr add` and routes added with `ip route add` vanish on process or machine restart; only what is written into Netplan YAML, `*.network`, or `nmcli connection modify` is rebuilt by the daemon at boot. When troubleshooting "it broke again after a reboot", it is almost always because only a temporary change was made.

Three practical tips when choosing an entry point. First, **on servers prefer declarative configuration that can live in Git** (Netplan YAML, `*.network`, keyfile); in desktop/NM environments prefer `nmcli` to avoid hand-editing binary or easily drifted files. Second, **only touch one interface at a time**, and verify from a second path immediately after (open a new SSH, check `ip -br addr`, ping the gateway) -- do not edit all three NICs' YAML in one go and then test. Third, **none of the entry points above may exist in containers or cloud images** -- the network is injected by veth or the cloud provider, so just read `ip`/`ss` there and do not hunt for `/etc/netplan` inside a container.

Firewalls are not covered on this page: for the rule syntax and allow lists of Ubuntu `ufw`, RHEL `firewalld`, and Arch's own `nftables`, see [Network chapter - Firewall](../../network/firewall.md). The split between this page and that one is -- first use `ss -tlnp` to confirm **whether the process is listening**, then use the firewall page to confirm **whether the packets were allowed through**.

## 5. The DNS resolution path: from domain to IP

When `ping domain` fails, first tell "the link is down" from "resolution failed": if `ping 8.8.8.8` works and `ping example.com` does not, the problem is DNS; if neither works, go back to sections 2 and 3 and check the address and routes. DNS still has to pass through a fixed pipeline inside the local machine.

### 5.1 Who looks first: nsswitch and hosts

glibc's `getaddrinfo()` does not read `/etc/resolv.conf` directly; it first looks at the `hosts:` line in `/etc/nsswitch.conf`, whose typical value is `hosts: files dns`: check `/etc/hosts` (`files`) first, then fall back to the name service (`dns`). That is why, in local development, writing `10.0.0.5 myapp.local` into `/etc/hosts` takes effect immediately, **with no need** to touch the DNS server; conversely, if `hosts:` is changed to `dns files`, `/etc/hosts` stops working, and it looks like "I edited hosts and nothing happened". All three families default to `files dns`, but container images or hardening scripts may have changed it, so the first line of troubleshooting should be `grep hosts /etc/nsswitch.conf`.

You may also see systemd-nss modules such as `myhostname`, `mymachines`, and `resolve` in `hosts:`: `resolve` hands resolution straight to systemd-resolved, **bypassing the semantics of the traditional `dns` backend**; some hardened images delete `dns` for "leak prevention", which leaves every domain resolution failing. Change this line with extreme care; after editing, verify with both `getent hosts example.com` and the actual application, and do not trust a single `ping` -- ping sometimes walks a different address family or cache path.

```bash
$ cat /etc/hosts
127.0.0.1 localhost
127.0.1.1 cui
::1     ip6-localhost ip6-loopback
```

### 5.2 systemd-resolved and the 127.0.0.53 stub

Modern Ubuntu, Fedora, and Arch enable systemd-resolved by default. It runs a stub resolver at `127.0.0.53:53` on the local machine, aggregates the DNS delivered by each NIC, caches, and forwards to upstream. `/etc/resolv.conf` is often a **symbolic link** to `../run/systemd/resolve/stub-resolv.conf`; inside it, `nameserver 127.0.0.53` and `options edns0 trust-ad` are normal content, not the literal meaning of "DNS only ever asks the local machine".

Three frequent misunderstandings:

1. **Hand-editing `resolv.conf` with `nameserver 8.8.8.8` and having it reverted on reboot** -- because the file is a stub link, or resolved regenerates it. The right way is to change the DNS in the network manager (Netplan `nameservers`, `nmcli ... ipv4.dns`, NetworkManager keyfile) and let resolved pick it up automatically.
2. **Seeing `127.0.0.53:53` listening and thinking an application stole the port** -- that is resolved's own stub (visible with `ss -ulnp | grep :53`), and it is not the same 53 as dnsmasq or unbound; if the latter wants to take over, you first have to work out the port relationship with resolved.
3. **Containers and slim systems do not have resolved**, in which case dhclient/dhcd writes a static `resolv.conf` directly. Check with `systemctl is-active systemd-resolved`.

Why is there a stub layer at all? Multiple NICs, multiple VPNs, and container veth pairs each deliver different DNS; without a unified aggregator, `resolv.conf` can only hard-code one set and breaks when you switch networks. resolved collects "which upstream set to choose, how long to cache, whether to answer mDNS/LLMNR" into a single daemon, and applications only ever see a stable `127.0.0.53`. The cost is one extra hop in troubleshooting: **the `nameserver` you see is the stub, not the real upstream**, so always run `resolvectl dns` or `resolvectl status` as well to get the truth.

When a self-built dnsmasq or unbound coexists with resolved, a common correct arrangement is: keep resolved as a stub and point its upstream at a custom port on `127.0.0.1` (such as 5353), or the other way round -- let your own service listen on 53 and point resolved's DNS forwarding there. **Do not let two processes fight over the same 53**: first come first served, and the other only slowly errors out in the logs after its bind fails, showing up on the ground as "resolution works sometimes and not others".

Real query output (`Data from: network` means a live lookup to upstream, `cache` means a local cache hit):

```bash
$ resolvectl query example.com
example.com: 198.18.0.47                                    -- link: ens18

-- Information acquired via protocol DNS in 2.9ms.
-- Data is authenticated: no; Data was acquired via local or encrypted transport: no
-- Data from: cache network

$ resolvectl dns
Global:
Link 2 (ens18): 192.168.5.1 223.5.5.5 192.168.5.11 fe80::5
Link 3 (ztksetoehl):
```

The real query output can be read through three fields: `Data from: cache network` means both a cache hit and a live network lookup (in order, a cache hit comes back fast); `-- link: ens18` says which interface's DNS delivery this answer is bound to, so on a multi-NIC box you can see "asked the wrong port" directly; `Information acquired via protocol DNS in 2.9ms` is the protocol-layer elapsed time, and a sudden jump to hundreds of milliseconds is usually degraded upstream RTT or timeout retries. `resolvectl status` also shows each link's DNS scope and whether it is the default route source; `resolvectl flush-caches` clears the cache when "the upstream DNS was changed but old results keep coming back". The application-layer `getent` and `python socket` walk the same path, so their results should line up.

If `dig example.com` (asking the stub or upstream directly) works but `python`/`getent` does not, the problem is in `nsswitch`/`hosts` or a glibc plugin; if both fail, then check `resolvectl status` and upstream connectivity (ping the upstream IP). Command-level DNS diagnostic techniques (`dig +trace`, specifying `@server`, MX/NS records) are in [Network Tools](./network-tools.md).

Stringing the whole chain together, everyday troubleshooting can follow this fixed order without skipping a layer: first `ip -br addr` to confirm an address and `ip route` to confirm a default gateway; then `ping -c 3 gateway` and `ping -c 3 publicip` to distinguish "cannot get out" from "cannot resolve"; if it is a domain problem, the three steps `grep hosts /etc/nsswitch.conf` plus `resolvectl query` plus `dig @upstream` pin down which link it is; at the application layer, `ss -tlnp` for listeners and `curl -w` for stage timings. Every step answers only one question; if you cannot answer, stay on that layer and dig in, rather than jumping to the next command and hoping.

## 6. Common pitfalls

The common pitfalls are easier to remember in three time windows -- "before changing config, while changing it, after verifying" -- than by command.

**Before changing config**: confirm the distro and manager (section 4), open an out-of-band console or a second SSH first, run `netplan try` rather than `apply` straight away, and record a baseline of `ip -br addr` and `ip route` so you can compare on rollback. "Optimising" without a baseline is like dropping a database without a backup.

**While changing config**: only touch one interface or one item at a time (address, route, DNS in three separate edits), and verify from a new connection after every change; do not bring the NIC down in the same window and then edit that NIC's YAML -- you will lose your only session before the config even takes effect. Temporary commands (`ip addr add`) are only for verification; once it passes, translate it into persistent configuration immediately, otherwise you are leaving a time bomb for your future self.

**After verifying**: restart the network service or the whole machine once, and confirm the address, default route, and DNS are all still there; then run a business smoke test (SSH, HTTP, internal dependencies). Many "low-level incidents" are not from a mistyped command, but from **verifying only the moment you typed the command, not after the reboot**.

A quick order for working backwards from symptoms: SSH is dead but the physical link is alive -> get in via the console and check whether `ip -br addr` still has an address; if not, check whether persistence was written wrong or DHCP failed to renew; the gateway pings but the public internet does not -> run `ip route get 1.1.1.1` to see whether it is going out the wrong interface or whether the default route metric was stolen; an IP works but a domain does not -> go to the DNS chain in section 5; an application port cannot be reached from outside -> check the listen address with `ss -tlnp` and then switch to the firewall page. Writing these four into the front of your on-call runbook covers more than half of the everyday network tickets.

1. **`ifconfig`/`netstat` not found on a new system**. They are not "essential Linux commands", they are the net-tools package. Either `sudo apt install net-tools` (Debian/Ubuntu), `sudo pacman -S net-tools` (Arch), `sudo dnf install net-tools` (RHEL), or simply switch to `ip`/`ss` -- the comparison table in section 1 of this page is enough to replace everyday usage.

2. **Running `ip link set eth0 down` on a remote machine locks you out**. A down link kills SSH immediately. Always change the persistent configuration and use `netplan try`, or open a new connection to verify first, or go through the console. `ifdown` is equally dangerous.

3. **Editing `/etc/resolv.conf` does not survive a reboot**. First run `ls -l /etc/resolv.conf` to see whether it is a symlink to resolved; if so, change the network manager or use `resolvectl`, and do not overwrite the link.

4. **`ss -tlnp` shows no process name**. Permissions are needed: `sudo ss -tlnp`, or confirm the target process runs as the current user. Behaviour is the same across all three families.

5. **On multi-NIC boxes the default route goes out the wrong interface**. Look at `metric` with `ip route show` and the final decision with `ip route get target`; a temporary fix is `ip route change default via gateway dev interface`, and a permanent fix changes the `metric`/`route` field in Netplan/NM/networkd.

6. **The interface is no longer called eth0**. Modern distros use predictable naming (`ens18`, `enp3s0`). Confirm with `ip -br link` and do not copy `eth0` straight from old material; containers and cloud images commonly use `eth0`, but KVM and physical machines usually do not.

7. **Treating 127.0.0.53 as a fault**. It is the local stub of systemd-resolved; `127.0.0.54` is the mDNS/LLMNR-related loopback. Both listening at once is normal, unless you are running your own authoritative DNS and need to own 53 exclusively.

8. **Putting a temporary route change into the runbook**. `ip route add` is lost on reboot. Production changes must land in Netplan YAML, `.network`, or `nmcli connection modify`, and be verified once after the change with a `reboot` or a network-service restart.

9. **Hard-coding `eth0` as the interface name in a script**. Under predictable naming, physical machines almost never call it eth0; at the start of a script, probe with `ip -br link`, or use `match: MAC/driver` (the `Match` section of Netplan/`*.network`) rather than a hard-coded name, otherwise swapping a card or a slot silently breaks the script.

10. **Changing DNS by only editing `resolv.conf`, or changing routes by only `ip route add`**. Both are "temporary layer" operations and are disconnected from the persistent entry points in section 4. The unified principle: **use temporary commands to verify, and land the result in a config file plus the daemon** -- do not do it the other way round.

## References

- `man ip`, `man ss`, `man ip-rule`, `man resolvectl`, `man nsswitch.conf`, `man systemd-resolved`
- Bird's Private Recipes (Lin's Linux Administration Guide) - network basics -- [linux.vbird.org](https://linux.vbird.org/linux_server/centos6/0110network_basic.php)
- Arch Wiki - iproute2 -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Iproute2)
- Arch Wiki - Network configuration -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Network_configuration)
- Arch Wiki - systemd-resolved -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd-resolved)
- iproute2 manual (ss/ip) -- [man7.org](https://man7.org/linux/man-pages/man8/ip.8.html)
- Ubuntu - Netplan documentation -- [netplan.io](https://netplan.io/)
- systemd-resolved / resolvectl manual -- [freedesktop.org](https://www.freedesktop.org/software/systemd/man/latest/resolvectl.html)
- Red Hat documentation - Configuring and managing networking -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_and_managing_networking/index)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/commands/README.md)
- [network](/commands/network.md)
- [network-tools](network-tools.md)
- [knowledge](/knowledge.md)
- [commands-practice](/network/commands-practice.md)
- [coverage-matrix](/research/coverage-matrix.md)
