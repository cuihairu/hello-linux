# Routers and NAT

Put two machines into the same switch and they can ping each other; put a router in between and many people hit "the gateway works but the internet does not" on their first attempt. This page turns a Linux host into a real router: enable kernel forwarding, read and edit the routing table, use nftables for source address translation so a private segment can reach the internet, publish an internal service with port mapping, and finally verify the whole chain hop by hop. It assumes you can already configure and persist static addresses on the three distro families (see [Network Configuration Fundamentals](../network/network-configuration.md)); this page focuses on "how packets are forwarded inside this machine and how addresses are rewritten". The full design of firewall policy is not covered here -- see the [Firewall](../security/firewall.md) page.

> Content draws on the official nftables wiki and the Arch Wiki (conceptual framework from "Vbird's Linux Cabinet"); see the references at the end.

## What This Page Covers

- Explaining the boundary between "same segment goes through ARP, cross-segment goes through the gateway", and the role of `ip_forward` in it
- Reading every column of `ip route`, adding and removing static routes temporarily, and knowing where to persist them
- Choosing between snat and masquerade, and writing a runnable nftables NAT gateway config on your own
- DNAT port mapping and the forwarding rule that lets it work
- Locating NAT gateway faults in the hop-by-hop order "gateway -> public IP -> domain name"

## 1. Why You Need a Router

### 1.1 ARP on the Same Segment, Routing Across Segments

To decide whether two addresses are on the same segment, a host ANDs its own address with the prefix length: if the target falls inside the segment, it first sends an ARP broadcast to resolve the target IP to a MAC address and delivers the frame directly at layer 2; if the target falls outside the segment, ARP is powerless -- broadcasts cannot leave the segment -- so the host hands the packet to the next hop pointed out by the routing table, and that "neighbor that sends the packet on your behalf" is the gateway. The whole decision flow can be drawn as a diagram:

```text
Local packet decision
Same segment as target? --yes--> ARP the target IP's MAC --> frame delivered at layer 2
        |no
        v
Consult the routing table (longest prefix match, default as fallback)
        |
        v
ARP the MAC of the "next hop" --> frame goes to the gateway; the IP header still names the final destination
```

One fact crucial to understanding NAT hides in this diagram: **the layer-2 address changes hop by hop, while the layer-3 address in the IP header stays end-to-end unchanged** -- each router only swaps MACs and ports, never IPs. NAT is the sole violator of this rule; it exists precisely to rewrite the layer-3 address (section 4). A gateway has no magic in it: it is simply a host "willing to do layer-3 forwarding for others", and Linux refuses that role by default for safety: with `net.ipv4.ip_forward = 0`, the kernel silently drops any packet whose destination IP is not itself. Flip the switch and the host becomes a router -- this is the first step of every configuration on this page and the number one item on the checklist for "the gateway pings but clients have no internet".

### 1.2 When to Use Linux for Routing

For a home, buying an off-the-shelf router is the least fuss; but in a lab isolating a test segment, giving a virtualization or container environment a controlled egress, or publishing and auditing at the internal network boundary, a Linux gateway is far more transparent than a commercial router: every forwarding step is visible with `ip`, `nft`, and `tcpdump`, and the policy is a few lines of versionable, diffable text config. A more practical reason is that you have already been using a Linux router: Docker's bridge networks, libvirt's default network, and the forwarding rules on Kubernetes nodes are all fundamentally "kernel forwarding plus NAT rules" (see the [Containers](./container/docker.md) page). Building this mechanism by hand on bare metal is the shortest path to understanding what those automation tools do for you -- and when something breaks, you know which layer to look at.

## 2. Kernel Forwarding: From Host to Router

### 2.1 Turning It On Temporarily

```bash
$ sudo sysctl -w net.ipv4.ip_forward=1
net.ipv4.ip_forward = 1
$ cat /proc/sys/net/ipv4/ip_forward
1
```

`/proc/sys/` is the runtime truth of kernel parameters: `sysctl -w` changes exactly that, and verification reads it directly. To forward IPv6 traffic the switch is `net.ipv6.conf.all.forwarding = 1`, independent of IPv4; a dual-stack gateway needs both. The temporary switch suits verifying "is forwarding the bottleneck": when a client cannot get through, add the `sysctl -w` and test again -- if it now works, the problem was a missing configuration rather than the link; the means of diagnosis is as valuable as the result itself.

### 2.2 Persistence (Identical on All Three Families)

```text
# /etc/sysctl.d/30-forward.conf
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1
```

```bash
$ sudo sysctl --system | grep forwarding
net.ipv4.ip_forward = 1
net.ipv6.conf.all.forwarding = 1
```

On all three families systemd-sysctl reads `/etc/sysctl.d/` in order at boot, so this form is portable across distros. The correspondence to remember: `sysctl -w` changes "the current state", while `/etc/sysctl.d/` records "the boot-time intent" -- exactly parallel to the distinction between `systemctl start` and `enable` (see [System Service Management](../basic/services/system_services.md)); do only the first and forget the second and you get the classic "fine right now, reverted after reboot" incident. Apply with `sysctl --system` and confirm the output by eye, then re-verify once with `cat /proc/sys/net/ipv4/ip_forward` after a reboot; only when both checks are green is persistence complete.

## 3. Reading and Adding Routes

### 3.1 Reading Every Column

```bash
$ ip route show
default via 203.0.113.1 dev ens36 proto dhcp src 203.0.113.10 metric 100
192.168.56.0/24 dev ens33 proto kernel scope link src 192.168.56.1 metric 100
198.51.100.0/24 via 192.168.56.20 dev ens33 proto static metric 20
```

The three lines are the three most common route origins. The first column is the destination: `default` (i.e. `0.0.0.0/0`) is the fallback, used only when nothing else matches; matching follows **longest prefix first**, so a /24 always beats a /16, with no relation to the default route. `via` is the next-hop address, `dev` is the egress interface -- direct routes marked `scope link` have no `via`, because the target is on this segment and is delivered right after ARP. `proto` says who wrote the route: `kernel` is the direct route attached automatically when the address was configured, `dhcp` was learned by a client, `static` was added by hand -- use it first in troubleshooting to judge "should this route exist, and who put it here". `src` is the preferred source address when sending to that segment, which in multi-address setups explains "why the peer sees this IP"; `metric` is the priority among multiple routes to the same destination, lower wins. Reading a routing table is basic skill for gateway troubleshooting: when a client's packets cannot come in or go out, walk this table once -- "which entry would a lookup by destination hit" -- and you lock onto a configuration-layer problem faster than with a packet capture. The troubleshooting meaning of each column is summarized below:

| Column | Meaning | What to watch when troubleshooting |
|---|------|---------------|
| destination prefix | match scope; `default` is 0.0.0.0/0 | does it match the expected segment; longest prefix wins |
| via | next-hop address | direct routes have no via; a via that does not work means check next-hop reachability first |
| dev | egress interface | does it match the NIC the address lives on |
| proto | who installed it: kernel / dhcp / static | should this route exist, and who put it here |
| scope | scope; `link` means this link | within link there is no routing, just ARP delivery |
| src | preferred source address when sending | in multi-address/NAT setups it explains "who the peer sees" |
| metric | route priority, lower first | with multiple routes to one destination, which is really in effect |

### 3.2 Adding and Removing Static Routes

```bash
$ sudo ip route add 198.51.100.0/24 via 192.168.56.20 dev ens33
$ sudo ip route del 198.51.100.0/24
$ ip route get 198.51.100.8
198.51.100.8 via 192.168.56.20 dev ens33 src 192.168.56.1
```

`ip route get` is an underrated troubleshooting weapon: it answers "which interface, to whom, with which source address would a packet to this address go", laying the result of longest-prefix matching straight out. For "how does this segment get out" on a gateway, `get` before `show` beats eyeballing the whole table. One dedicated trick for changing the default gateway is worth memorizing: `add` reports `File exists` when a default is already there, while `ip route replace default via <new gateway> dev ens36` deletes the old and adds the new in one step, avoiding a window with no default route between two commands -- the moment you switch gateways is exactly when you cannot afford such a window.

```bash
$ sudo ip route replace default via 203.0.113.254 dev ens36
```

Note that `ip route add` likewise only changes the runtime and is lost on reboot; persistence must go into your distro's network configuration system -- Netplan, NetworkManager, and systemd-networkd are compared for the three families in section 4 of [Network Configuration Fundamentals](../network/network-configuration.md), and are not repeated here.

### 3.3 Policy Routing: Choose the Table by "Who Sent It"

Traditional routing looks only at the destination; to make packets "from different sources, to the same destination" take different exits you need policy routing. `main` is actually just an ordinary table numbered 254, and the kernel's real lookup order is set by the `ip rule` policy list, matched from low priority to high:

```bash
$ echo '100 second' | sudo tee -a /etc/iproute2/rt_tables
$ sudo ip route add default via 198.51.100.1 dev ens37 table second
$ sudo ip rule add from 192.168.57.0/24 lookup second priority 100
$ ip rule show
0:      from all lookup local
100:    from 192.168.57.0/24 lookup second
32766:  from all lookup main
32767:  from all lookup default
```

This example makes traffic from 192.168.57.0/24 look in the `second` table (exiting via ens37) while everything else still uses `main`. Two common mistakes to note up front: the rule's `priority` must be lower than 32766, or it sorts after the `main` lookup and never runs; and the `second` table must contain complete, usable routes (at least one default), because an empty table funnels that source's traffic into a black hole. Also, neither `ip rule` nor custom table contents are persisted -- both are lost on reboot, so write them into the NIC configuration system or create your own systemd unit to run these two commands at boot; another instance of "current state versus boot-time intent".

## 4. NAT: How Private Addresses Reach the Internet

### 4.1 What NAT Changes Inside the Kernel

RFC 1918 private addresses (such as 192.168.0.0/16) are not routable on the public internet; for an internal host's packets to go out, the egress gateway must rewrite the source address to its own external interface address during the postrouting stage and register the mapping in the conntrack table at the same time; when the reply enters the kernel, it is restored in reverse according to that record and forwarded to the internal host. So NAT has never been a standalone feature; its two preconditions are that forwarding is enabled (section 2) and that connection tracking is working -- understand this and the first suspect for "forwarding is on but still no internet" naturally becomes "NAT is not configured yet", rather than restarting some service. dnat is the mirror operation: it rewrites the destination address at the prerouting stage, used to map a port on the external interface to an internal server. A complete masquerade round trip:

```text
Request   192.168.56.50:51728 --> gateway ens33 receives --> postrouting rewrites src --> 203.0.113.10:51728 --> public server
Reply     93.184.216.34:443   --> gateway ens36 receives --> conntrack finds the mapping --> dst restored to 192.168.56.50 --> original client
```

Note what the kernel does on the reply path: the destination is "restored" to the internal address -- not by consulting a config file, but by looking up the conntrack register. The inference is direct: if the conntrack record is gone (evicted from a full table, rebooted, or forwarding was never on), the reply finds no registration, and what gets through is only "there and never back".

### 4.2 Choosing Between snat and masquerade

| Item | snat | masquerade |
|---|------|-----------|
| rewritten source address | the address written in the config | the egress interface's current address, read each time |
| suited to external addresses | static, long-term stable | dynamically obtained via DHCP / PPPoE |
| typical scenario | a fixed public IP in a data center | home broadband, labs, cloud host elastic IPs |

The two are semantically isomorphic as rules; the choice depends only on whether the external address is fixed: with a fixed address use snat and skip the cost of reading the interface address every time; with a dynamic address you must use masquerade, or the moment the address changes the rule becomes "rewrite to the old address", which is simply wrong. snat also supports a pool of addresses for simple load sharing (`snat ip to 203.0.113.10-203.0.113.12`), a device-free way to scale the egress when public IPs are plentiful. Home and lab environments are almost always masquerade -- the examples below follow that. One commonly asked fact by the way: when masquerade rewrites the source address it tries to preserve the original source port and only reallocates on conflict, so "two internal machines happening to use the same source port to the same target" is not rare; conntrack handles it and no human intervention is needed.

### 4.3 A Complete, Runnable Gateway Config

Scenario: ens33 is the internal interface with address 192.168.56.1/24, and internal clients (such as 192.168.56.50) use it as their gateway; ens36 is the external interface, obtaining its address and default route via DHCP. Two goals: the whole internal segment gets internet access; and port 8080 on the external interface maps to port 80 of the internal web server 192.168.56.20. Topology:

```text
  Internal client             Linux gateway (this page's subject)          Public internet
+----------------+      +-------------------------------+
| 192.168.56.50   |      | ens33: 192.168.56.1/24        |      +------------------+
|  gw -> .1       |------|                               |------| any destination  |
+----------------+      | ens36: DHCP (e.g. 203.0.113.10) |      +------------------+
+----------------+      | duty: forwarding + masquerade +|
| Web server      |------| 8080->.20:80 port mapping      |
| 192.168.56.20   |      +-------------------------------+
+----------------+
```

```text
#!/usr/sbin/nft -f
# /etc/nftables.conf -- internal 192.168.56.0/24 exits via ens36 + 8080 mapped to the internal web server

flush ruleset

table inet filter {
    chain input {
        type filter hook input priority filter; policy accept;
        iifname "lo" accept
        ip protocol icmp accept
        tcp dport 22 accept                                # ops SSH; open first, tighten later
    }
    chain forward {
        type filter hook forward priority filter; policy drop;
        ct state established,related accept                # replies and related flows
        ip saddr 192.168.56.0/24 oifname "ens36" accept    # internal egress
        iifname "ens36" ip daddr 192.168.56.20 \
            tcp dport 80 accept                            # inbound whitelist for the DNAT target
    }
}

table inet nat {
    chain prerouting {
        type nat hook prerouting priority dstnat; policy accept;
        iifname "ens36" tcp dport 8080 dnat ip to 192.168.56.20:80
    }
    chain postrouting {
        type nat hook postrouting priority srcnat; policy accept;
        ip saddr 192.168.56.0/24 oifname "ens36" masquerade
    }
}
```

```bash
$ sudo nft -c -f /etc/nftables.conf    # syntax check; does not apply
$ sudo nft -f /etc/nftables.conf       # load once confirmed
$ sudo nft list ruleset                # verify the full ruleset in the kernel
```

A few facts up front: writing NAT in the inet family needs kernel 4.18 or newer, which all three families' current versions far exceed -- only old kernels need to fall back to `table ip nat`; DNAT only changes the destination, and admitting the forwarded traffic is the forward chain's job -- the `ip daddr 192.168.56.20 tcp dport 80 accept` line in the forward chain above is the door opened for the mapped traffic, and omitting it produces the classic broken chain where "the external SYN arrives, conntrack has a record, and the web server does nothing". The discipline for editing config is `nft -c` first and load second -- the same discipline as `named-checkconf` before `rndc reload` on the DNS page: catching a syntax error before it takes effect is always cheaper than "half-dead, then roll back". One important final warning: **machines with Docker installed should think twice about `flush ruleset`** -- it also clears the chains Docker depends on and the container network dies on the spot; on such machines add and remove per table and chain (see the [Containers](./container/docker.md) page).

### 4.4 Install and Enable on the Three Families

| Action | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Install | `apt install nftables` | `sudo pacman -S nftables` | `dnf install nftables` |
| Search | `apt search nftables` | `pacman -Ss nftables` | `dnf search nftables` |
| Show package info | `apt show nftables` | `pacman -Qi nftables` | `dnf info nftables` |
| List files | `dpkg -L nftables` | `pacman -Ql nftables` | `rpm -ql nftables` |
| Upgrade | `apt upgrade` | `sudo pacman -Syu` | `dnf upgrade` |
| Remove | `apt remove nftables` | `sudo pacman -R nftables` | `dnf remove nftables` |
| Connection tracking tool | `apt install conntrack` | `pacman -S conntrack-tools` | `dnf install conntrack-tools` |

The package name and service unit are identical across all three: the package is `nftables`, the config lives in `/etc/nftables.conf`, and the service is `nftables.service` -- after `sudo systemctl enable --now nftables` the file is loaded automatically at boot. The only thing to watch is that RHEL-family systems ship firewalld by default, and firewalld manages its own set of nftables tables: **choose one of the two firewalls** -- either keep managing policy with `firewall-cmd` (and do not hand-write nft), or `systemctl disable --now firewalld` and take over `/etc/nftables.conf`; managing both ends in parallel means neither side can see the other's rules, and in troubleshooting nobody can say which rule is in effect.

### 4.5 The iptables-nft Compatibility Layer

On all three families the `iptables` command now goes through the iptables-nft backend by default, so rules ultimately land in the same kernel nftables engine, and `nft list ruleset` shows the chains they became. Copying `iptables -t nat -A POSTROUTING -j MASQUERADE` from old material therefore works; but managing the same table with two syntaxes quickly makes it unclear "who added this rule and who should delete it". For new configurations use the native nft syntax directly and treat iptables purely as a translation layer for reading old material.

## 5. The Minimal Firewall Baseline

The skeleton of the forward chain in the example above is the minimal viable baseline for a server gateway: `policy drop` as the default, admitting `ct state established,related` (let replies in first), admitting the internal egress (trust outbound from the LAN), and whitelisting each service you need to publish (such as the DNAT target line). This shape of "deny by default, open as needed" applies to any gateway; only the number of entries differs. Policy design topics such as zones, rich rules, logging, and rate limiting are covered fully in the [Firewall](../security/firewall.md) page and are not repeated here -- get forwarding and NAT working first, and you will naturally know where the policy belongs.

## 6. Verification and Troubleshooting

### 6.1 Hop-by-Hop Verification from the Client

```bash
$ ping -c3 192.168.56.1        # hop 1: the gateway's internal interface; verify layer 2 and addressing
$ ping -c3 223.5.5.5           # hop 2: a public IP; bypasses DNS to verify forwarding + MASQUERADE
$ dig example.com @223.5.5.5   # hop 3: a domain name; verify DNS works
```

Each hop rules out one layer: hop 1 failing means the problem is in the client's own config or the switch; hop 1 working but hop 2 failing pins it to the gateway (forwarding, NAT, or the forward admit rule -- pick one); hop 2 working but hop 3 failing leaves only DNS -- check whether the client's `/etc/resolv.conf` got a usable nameserver (handing internal clients their address and DNS together is the DHCP server's job, see the DHCP chapter of the servers section). This hop-by-hop method shares its origin with the methodology in [Network Troubleshooting](../network/troubleshooting.md), only refined from "local -> gateway" to inside the NAT gateway. Summarized as a quick reference table:

| Symptom | Where it broke | Next step |
|------|---------|--------|
| cannot ping the gateway | client addressing / layer 2 | check the address prefix, NIC, and switch/virtual network |
| gateway pings, public IP does not | gateway forwarding / NAT / admit rule | work through 6.2 -> 6.3 -> 6.4 layer by layer |
| public IP pings, dig fails | DNS | client resolv.conf and DNS handout |
| intermittent, drops at peak | conntrack capacity | see the last item in Common Traps |

### 6.2 Verification on the Gateway Side

```bash
$ cat /proc/sys/net/ipv4/ip_forward
1
$ sudo nft list table inet nat
table inet nat {
    chain prerouting {
        type nat hook prerouting priority dstnat; policy accept;
        iifname "ens36" tcp dport 8080 dnat ip to 192.168.56.20:80
    }
    chain postrouting {
        type nat hook postrouting priority srcnat; policy accept;
        ip saddr 192.168.56.0/24 oifname "ens36" masquerade
    }
}
```

Verify on the gateway in three layers -- "switch, rules, evidence of effect": is `ip_forward` 1; is the nat table present in `nft list ruleset` and does it match the intent literally (`nft -f` succeeding only proves the syntax is valid, not that the content is what you wanted); and finally look at conntrack in section 6.3 to confirm the rewriting is really happening.

### 6.3 conntrack: Confirm the Rewriting Is Happening

```bash
$ sudo conntrack -L -p tcp --dport 443
ipv4 2 tcp      6 431872 ESTABLISHED \
        src=192.168.56.50 dst=93.184.216.34 sport=51728 dport=443 \
        src=93.184.216.34 dst=203.0.113.10 sport=443 dport=51728 [ASSURED] mark=0 use=2
```

Read a conntrack entry in two halves: the first half is the request direction (initiated by the internal 192.168.56.50), the second half is the reply direction the kernel expects -- note the reply's destination has already been changed to the external interface address 203.0.113.10, which is direct evidence that masquerade matched; `[ASSURED]` means packets have passed in both directions. When a client "cannot reach the internet", run `conntrack -L` on the gateway: a first half without a second half means the reply never came in (an egress or peer problem), and no entry at all means the packet was never forwarded (a forwarding or forward-admit problem). Without the conntrack tool installed, `sudo cat /proc/net/nf_conntrack` gives the same structure, just without filter parameters.

### 6.4 Watching Where Packets Go with tcpdump

```bash
$ sudo tcpdump -ni any icmp or tcp port 8080
```

The last resort is a packet capture: `-n` turns off reverse DNS (otherwise every packet triggers a lookup and the capture gets messier the longer you run it), and `-i any` watches both interfaces at once. "SYN goes out and never comes back" is the most frequent observation, corresponding to three causes: the forward chain does not admit it (the packet enters the kernel and is dropped, leaving no conntrack record), masquerade is not configured (the packet goes out but the reply cannot find its way home), or asymmetric routing (the reply comes back a different way -- see the next section). tcpdump usage is covered on a full page in [Network Tool Commands](../commands/network/network-tools.md).

### 6.5 A Minimal Lab: Two VMs

Every configuration on this page can be reproduced on a laptop; the topology only needs two VMs: gw gets one NAT NIC (external, address via DHCP) plus one Host-Only NIC (internal, 192.168.56.1/24 by hand); client gets only the Host-Only NIC. Both VirtualBox and libvirt's default network naturally provide such a segment isolated from the host, and the cloud equivalent is a VPC private segment plus a dual-NIC instance. Once gw has sections 2 and 4 done, three commands on the client start the hop-by-hop verification of section 6:

```bash
# Client side (identical on all three families; all temporary, lost on reboot -- which makes repeated experiments easy)
$ sudo ip addr add 192.168.56.50/24 dev ens3
$ sudo ip route add default via 192.168.56.1
$ echo 'nameserver 223.5.5.5' | sudo tee /etc/resolv.conf
```

Suggested experiment order: do only section 2 (enable forwarding) first and confirm "still no internet", then add masquerade and see "it works", and finally deliberately delete the forward admit rule and watch "it breaks again" -- these three break/work cycles nail down the causality of forwarding, NAT, and admission individually, which teaches more than configuring everything at once. After each change, run the three hops on the client and glance at conntrack on gw, building the "symptom -> layer -> evidence" correspondence with your own hands.

## 7. Common Traps

**Forwarding is on but clients still have no internet -- masquerade or DNS was forgotten.** The two most frequent root causes. Split them with the hop-by-hop method of 6.1: public IP pings but dig fails means DNS, with no usable nameserver in the client's resolv.conf; only when the public IP fails while the gateway pings is it the NAT layer -- check whether the rules are in `nft list table inet nat` and whether `conntrack -L` shows the rewriting. When the two symptoms are mixed, always isolate the variable first with "public IP + dig @public DNS".

**Policy routing does not take effect -- the rule was forgotten or the priority is wrong.** In `ip rule show`, a policy sorted after 32766 (the `main` table lookup) never gets its turn; the priority must be lower. A rule added with an empty `second` table funnels traffic straight into a black hole -- `ip route show table second` must be checked together with `ip rule show`; neither alone is enough. And remember that rules and table contents are not persisted and vanish on reboot, so verify after a reboot rather than right after configuring.

**DNAT works but the reply takes the default route -- asymmetric routing.** Access to the mapped port from outside works, so DNAT and the admit rules are correct; if the internal server then misbehaves toward another external target, or it breaks with a different set of clients, first check whether the internal server's default gateway is this Linux gateway -- if the reply leaves through another egress, its source address does not match the conntrack mapping and it is silently dropped. The capture signature is "both hops present on the way out, only the server side present on the way back". A variant is the hairpin case: an internal client directly accessing port 8080 on the external interface address -- after DNAT the server replies straight to the client (same segment, no gateway), and the source address is not the external interface IP the client expected; this traffic needs an extra masquerade rule in the internal-interface direction.

**Forwarding is lost after reboot -- sysctl was not persisted.** `sysctl -w` only changes the runtime; passing the test on the spot does not mean it survives a reboot. After writing into `/etc/sysctl.d/`, confirm with `sysctl --system` and re-verify with `cat /proc/sys/net/ipv4/ip_forward` after a reboot -- "changing now" and "changing at boot" are two different things, exactly isomorphic to only `start`-ing a service without `enable`-ing it.

**nft rules vanish on reboot -- nftables.service was not enabled.** Rules loaded with `nft -f` live only in the in-memory ruleset and are cleared on reboot. Rules written into `/etc/nftables.conf` are loaded at boot only after `systemctl enable --now nftables`; `nft list ruleset` right after deployment verifies "correct now", and one more check after a reboot verifies "correct always".

**The conntrack table fills up and connections drop in batches at high concurrency.** `dmesg` showing `nf_conntrack: table full, dropping packet` is the tell: every connection takes one tracking entry, and once the table is full new connections are dropped. On gateway-class machines check the ceiling with `sysctl net.netfilter.nf_conntrack_max`, raise it to match the connection scale, and persist it in `/etc/sysctl.d/`; also check `net.netfilter.nf_conntrack_buckets` (the hash bucket count). The signature of this trap is "everything fine at low load, blows up under a load test or business peak" -- factor the time dimension into troubleshooting.

## References

- Official nftables wiki -- [wiki.nftables.org](https://wiki.nftables.org/)
- Arch Wiki: nftables -- [wiki.archlinux.org/title/nftables](https://wiki.archlinux.org/title/nftables)
- Arch Wiki: Router -- [wiki.archlinux.org/title/Router](https://wiki.archlinux.org/title/Router)
- "Vbird's Linux Cabinet" - routers and NAT -- [linux.vbird.org](https://linux.vbird.org/linux_server/)
- man ip-route (routing table operations) / man ip-rule (policy routing) / man sysctl.d (kernel parameter persistence)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [commands-practice](/network/commands-practice.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [README](README.md)
- [cloud-computing](cloud-computing.md)
- [dhcp](dhcp.md)
- [network-parameters](network-parameters.md)
- [kvm](virtualization/kvm.md)