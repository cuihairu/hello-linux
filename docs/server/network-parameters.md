# Server Network Parameter Configuration

A server that has finished installing its OS but has not started any service yet still has a set of network parameters that must be right first: hostname and FQDN, `/etc/hosts` and local name resolution, resolver pointers, address and default route, listening surface, and clock. Each of these on its own looks trivial, but together they are the foundation of every service chapter that follows -- Nginx cannot bind its address, Samba cannot announce its own name, a mail server's certificate validation fails, and when you trace it to the root you often find the service was not misconfigured; the machine's "identity and street address" never lined up. This is exactly why "Vbird's Linux Cabinet" puts this chapter at the very front of the server section: give the machine a clear identity on the network first, then talk about serving the outside world. This page rewrites it as a **pre-launch checklist** -- each section explains the mechanism first, then gives self-check commands and how to read the results, and the final section collects everything into a printable table. Persistent configuration (how the three families write settings to disk via Netplan/networkd/nmcli) already has its own page in [Network Configuration Fundamentals](../network/network-configuration.md), and the layered post-fault troubleshooting methodology is in [Network Troubleshooting](../network/troubleshooting.md); this page repeats neither and does one job only: "get the parameters right before going live".

> Content draws on the Arch Wiki and the official systemd documentation (conceptual framework from "Vbird's Linux Cabinet"); see the references at the end.

## What This Page Covers

- Understanding the relationship between hostname, FQDN, and `/etc/hosts`, and why Samba/Kerberos-class services are sensitive to it
- Telling apart the three managers of `resolv.conf` (systemd-resolved, NetworkManager, direct hand-writing)
- Using `ip -br addr` and `ip route` to quickly read the health of addresses, prefixes, and the default route
- Building the habit of "check the listening surface before opening the firewall", and understanding the security meaning of `0.0.0.0` versus a specific address
- Knowing the pre-launch network parameter checklist by heart, and moving the layered troubleshooting method into the deployment phase

## 1. Why Parameters Come Before Services

Service configuration is "what I intend to provide"; network parameters are "who I am on the network". The former rests on the latter: a service that wants to listen on an address needs an address first; validating the time window of a client certificate needs a clock first ([NTP Time Service](./ntp.md)); being findable by peers under a name needs the local resolver to be able to answer for that own name. One layer of wrong parameters means every debugging step at the service layer is building on a wrong foundation -- which is also why [Network Troubleshooting](../network/troubleshooting.md) puts "the local machine" in the first segment of its investigation; this page simply moves the same order from "after failure" to "before launch".

The value of checklist thinking is that it is cheap. Five minutes spent item-by-item before launch costs minutes; finding this class of problem after go-live costs hours, plus the change pressure of "people are already using the service". It is the same conservative change philosophy as lowering the TTL before changing DNS: intercept the problem at the moment it is cheapest. The sections below follow the fixed order of the checklist: identity (hostname and hosts) -> resolution (resolv and nsswitch) -> address and route -> listening surface, collected into a table at the end.

## 2. Hostname and Identity

### 2.1 Three Levels of Hostname

```bash
$ hostnamectl
   Static hostname: web01
         Icon name: computer-server
        Chassis: server
       Machine ID: 5f3c2a1b8e9d4c6f...
         Boot ID: 3a7b9c...
    Operating System: Debian GNU/Linux 12 (bookworm)
$ hostname -f
web01.example.com
```

`hostnamectl`'s Static hostname is the machine name from the kernel's point of view (same origin as `uname -n`), while the FQDN from `hostname -f` is a **resolution result** assembled from "kernel name + domain" -- note this crucial difference: the FQDN is not an independent configuration item; it is the answer you get by asking the resolver with the static hostname (via `/etc/hosts` first, then DNS, in the order set by `nsswitch.conf`). So "the hostname is right but the FQDN is wrong" is almost always a hosts/DNS-side problem, and editing `hostnamectl` will not help.

Changing the hostname is one command, identical on all three families:

```bash
$ sudo hostnamectl set-hostname web01
```

The family differences concentrate in "who else might have written the name down": the direct-edit method on `/etc/hostname` from old Debian/Ubuntu material still works (systemd reads it for compatibility), but `hostnamectl` is the proper path; RHEL/Rocky's `hostnamectl` behaves the same, with the extra note that `HOSTNAME=` in `/etc/sysconfig/network` is a pre-systemd relic and editing it has no effect; Arch has no extra files, `hostnamectl` is everything. Cloud hosts add one common interference: cloud-init in cloud images resets the hostname to the instance name at first boot, so after you change the name and reboot it gets "changed back" -- check `systemctl status cloud-init` first to see whether it is managing this.

### 2.2 Aligning /etc/hosts with the FQDN

```text
# /etc/hosts
127.0.0.1   localhost
192.168.56.10  web01.example.com  web01
```

The recommended form is one line for the local IP carrying both the FQDN and the short name, FQDN first -- the resolver answers `hostname -f` with the multiple names on a line in the order they appear. Two frequent mistakes: hanging the FQDN on `127.0.0.1` (self-resolution works, but other machines' reverse lookups with the real IP do not match, and the address some services announce becomes the loopback); writing only the short name and no FQDN (`hostname -f` cannot assemble the domain and degenerates to returning the short name).

Verify with `getent` rather than `ping` -- it walks exactly the nsswitch resolution path and has no ICMP dependency:

```bash
$ getent hosts web01.example.com
192.168.56.10  web01.example.com
$ getent hosts "$(hostname -f)"
192.168.56.10  web01.example.com
```

### 2.3 Why Some Services Are Sensitive to Identity

Protocols like Samba and Kerberos exchange FQDNs during the handshake and cross-check the name against the address in both directions: if the local resolver cannot answer for its own name, or the reverse lookup (`dig -x 192.168.56.10`) disagrees with the forward one, you get a warning in the mild case and refused service in the severe one. Postfix's HELO name and the SAN field of TLS certificates are likewise tied to the FQDN. Before going live, closing the loop of "forward lookup yields the address, reverse lookup yields the name, and the two agree" is the cheapest step in troubleshooting this class of service -- the checklist in section 6 lists it as a fixed item.

## 3. Resolution Path Self-Checks

### 3.1 The Three Managers of resolv.conf

`/etc/resolv.conf` takes one of three forms on modern distros; identify which one you are in before talking about editing it -- hand-editing a file managed by systemd-resolved, only to have it reverted after a reboot or reconnect, is the single most common trap:

| Form | Identifying marks | Who writes it |
|------|---------|---------|
| resolved stub | `nameserver 127.0.0.53`, with a `Generated by systemd-resolved` comment at the top | systemd-resolved (the upstream servers are configured elsewhere) |
| NetworkManager-managed | the header is marked NetworkManager | NM generates it from the connection profile (the dns field in `nmcli`) |
| traditional direct write | no generation comment; `nameserver` points at the real servers | the administrator by hand (or cloud-init/DHCP client on a cloud image) |

The defaults differ across the three families: Ubuntu desktop and server both run systemd-resolved by default (the stub form); RHEL/Rocky default to NetworkManager-managed; a minimal Arch install is usually traditional direct write, chosen by the user. The identification step is universal:

```bash
$ cat /etc/resolv.conf | head -3
# This is a run-time file managed by systemd-resolved...
nameserver 127.0.0.53
$ resolvectl status | head -12
Global
       Protocols: -LLMNR -mDNS +DNSOverTLS DNSSEC=no/supported
resolv.conf mode: stub
Current DNS Server: 192.168.56.2
         DNS Servers: 192.168.56.2 223.5.5.5
```

How to read `resolvectl status`: `resolv.conf mode` tells you whether it is a stub; `DNS Servers` is the real upstream (the stub address 127.0.0.53 is only a local proxy); `+DNSOverTLS` marks whether the upstream is encrypted (internal DNS usually is not, which is normal). To change the real upstream in resolved form, use `resolvectl dns` for a temporary change, or edit `resolved.conf`/the connection profile to persist it -- details are in [Network Configuration Fundamentals](../network/network-configuration.md), section 5.

### 3.2 The Order Semantics of nsswitch

```text
# /etc/nsswitch.conf (the hosts line)
hosts: files dns myhostname
```

`files` before `dns` means a hit in `/etc/hosts` short-circuits DNS -- this is the other half of the first suspect in "it is written in hosts but does not take effect" problems: if `files` is not first in the order (rare, but historical configurations exist), the hosts file is overridden by DNS no matter how correct it is. The `myhostname` module guarantees the local static name resolves no matter what; it is the fallback distros add by default. Editing nsswitch is a low-frequency operation; after changing it, test that it took effect with `getent hosts` -- no service restart needed.

### 3.3 Self-Check Actions

```bash
$ resolvectl status | grep -A2 "Current DNS"     # in resolved form: look at the real upstream
$ dig +short example.com @223.5.5.5              # bypass local config, verify the upstream link
$ dig +short example.com                         # go through the local resolver; compare the two
```

Comparing the two `dig` runs is the segmentation method for the resolution path: `@upstream` works but the local one does not, and the problem is local configuration (resolv.conf form, nsswitch, resolved state); neither works, and the problem is upstream or at the network layer. This continues the DNS segmentation from the third segment of [Network Troubleshooting](../network/troubleshooting.md). In the self-hosted internal DNS scenario, the upstream should point at your own BIND -- configuration and troubleshooting are in [DNS Server](./dns/bind.md).

## 4. Address and Default Gateway

### 4.1 Reading the Two Self-Check Commands

```bash
$ ip -br addr
lo        UNKNOWN  127.0.0.1/8 ::1/128
ens33     UP       192.168.56.10/24 fe80::20c:29ff:fe5a:8f12/64
$ ip route
default via 192.168.56.2 dev ens33 proto dhcp metric 100
192.168.56.0/24 dev ens33 proto kernel scope link src 192.168.56.10 metric 100
```

`ip -br addr` shows everything on one screen: the interface state must be `UP`, and the address carries its prefix length (a `/24` mistyped as `/32` is the classic static-config typo, showing up as "can ping the same segment but nothing beyond the gateway"). For `ip route`: **there should be exactly one primary `default via` route**; the second, direct route is generated automatically by the kernel from the prefix, with `scope link` meaning directly reachable on the same segment, which is normal. `metric 100` is the priority field; when two default routes coexist, the smaller metric wins -- which makes this the first checkpoint for "intermittently up and down" problems on multi-NIC machines.

### 4.2 Multiple NICs and Source Address Selection

A two-NIC server (say, a business network plus a management network) has three disciplines. First, give the default route to only one segment; configure the other with only direct or specific routes, so two default routes never tread on each other; when they must coexist (multiple egresses), use metric to explicitly separate primary and backup. Second, understand source address selection: when the local machine initiates a connection, the kernel "picks the egress NIC by route, then uses the address on that NIC as the source", so if the peer's firewall only allows the business-segment address and your traffic leaves via the management segment, it gets rejected; at the application layer you can specify the source address explicitly with `IP_PKTINFO`, and at the troubleshooting layer use `ip route get <peer IP>` to see the kernel's actual choice. Third, NIC naming: modern distros default to predictable names (`ens33`/`enp0s3` named by bus slot); only resort to systemd's `.link` files or the kernel parameter `net.ifnames=0` when cloud images or old scripts assume `eth0` -- renaming is a reinstall-scale change, so settle it before launch and do not touch it after go-live.

### 4.3 IPv4 and IPv6 Coexistence


```bash
$ ip -6 route | head -3
default via fe80::1 dev ens33 proto ra metric 1024  pref medium
```

The v6 default route usually comes from RA (router advertisement) rather than static configuration, and the `proto ra` field exposes its origin. The typical "v4 works everywhere, v6 silently broke" scenario: the service's domain has an AAAA record, clients prefer v6, and an RA failure removes the v6 default route, showing up as "some clients are slow, some cannot connect" (depending on each one's v6 state). The self-check is the v6 version of the two commands above. When v6 is genuinely not needed, disabling it explicitly (kernel parameter, or `ipv6.method disabled` in the connection profile) beats leaving a half-broken state -- disabled is deterministic; half-working is a hidden risk.

## 5. Firewall and Listening Surface: The First Move

Before starting a service, get two things straight: which address it should listen on, and which sources to admit. This section only covers "checking the surface"; how to write the rules is in [Firewall](../security/firewall.md) (ufw/firewalld/nftables for the three families), and gateway and NAT scenarios are in [Routing and NAT](./routing-nat.md).

Checking commands and how to read the listening surface:

```bash
$ ss -tlnp
State  Recv-Q Send-Q Local Address:Port  Process
LISTEN 0      128    127.0.0.1:6379      users:(("redis-server",pid=812))
LISTEN 0      511    0.0.0.0:80          users:(("nginx",pid=940))
```

`0.0.0.0` means listening on all v4 addresses (usually correct for public-facing services, but Redis/database-class services must have a bind address or firewall coverage -- in the example above Redis bound to loopback is the secure posture); `127.0.0.1` is reachable only locally. Before launch, checking these three columns per port against the design is the only cheap interception point for "bound to the wrong surface" incidents (bound to loopback while believed reachable externally, or bound to 0.0.0.0 and never meant to be exposed). After the listening surface checks out, open the firewall by port and source -- the order matters: knowing "how big a hole should be opened" before opening it, versus opening a hole and then seeing where the service lies broken, are two different philosophies of safety.

## 6. Pre-Launch Checklist

Converge the previous five sections into a printable table. Each row has three columns: what to check, how to check it, what you should see. Walking the rows in order completes one pre-launch network acceptance pass:

| # | Item | Verification command | Expected |
|---|------|---------|--------|
| 1 | Hostname | `hostnamectl --static` | matches the plan; no leftover default name |
| 2 | FQDN loop | `getent hosts "$(hostname -f)"` | returns the machine's real IP (not 127.0.0.1) |
| 3 | Reverse consistency | `dig -x <local IP> +short` | returns its own FQDN |
| 4 | hosts content | `cat /etc/hosts` | the real-IP line carries FQDN and short name, FQDN first |
| 5 | Resolution form | `ls -l /etc/resolv.conf; resolvectl status` | you know exactly who manages it; upstream points at the planned internal DNS |
| 6 | Address and prefix | `ip -br addr` | interface UP; address and prefix match the plan |
| 7 | Default route | `ip route` | exactly one primary default, via the right gateway |
| 8 | v6 state | `ip -6 route` | either explicit v6 routes or explicitly disabled; nothing half-broken |
| 9 | Same-segment reachability | `ping -c2 <gateway IP>` | 0% loss |
| 10 | Listening surface | `ss -tlnp` | per-port match with the design; no unplanned listeners |
| 11 | Clock | `timedatectl` | NTP synchronized: yes (see [NTP](./ntp.md)) |
| 12 | External resolution | `dig +short example.com` | returns normally (the whole DNS path works) |

Step 9 verifying only as far as the gateway is deliberate: beyond the gateway belongs to the layered territory of [Network Troubleshooting](../network/troubleshooting.md); the boundary of the pre-launch checklist is "all local parameters are correct". Keeping this table in the deployment repository and feeding it into the delivery process is like giving every new machine a tireless first inspector -- the value of a checklist is not in how many items it has, but in "the same things checked every time, to the same standard".

## 7. Common Traps

**The domain is in /etc/hosts but the service still fails to resolve.** Two root causes account for nearly all of it: `files` not being before `dns` on the hosts line of `nsswitch.conf` (rare but fatal), or hosts carrying only the short name and no FQDN, so queries by FQDN come up empty. Reproduce the service's resolution path directly with `getent hosts FQDN`; if that fails, it is a hosts-side problem and has nothing to do with DNS.

**resolv.conf gets reverted.** First `ls -l /etc/resolv.conf` to see whether it is a symlink, and `head -3` for the generation comment, to identify whether resolved stub, NM-managed, or cloud-init/dhclient is writing it; then go change it at the real owner -- hand-editing a generated file gets wiped by a reboot, a network reconnect, or even a DHCP renewal. This is the number one root cause on the DNS side of "changed it but it does not stick" tickets.

**The NIC name changed, so services fail to start.** After a hardware swap or a cloud host migration, `eth0` became `ens33`, and everything bound to the old name (firewall rules, bonding, application config) fails at once. Handle it in two layers: in an emergency, use a `.link` matching the MAC to pin the name; for the real fix, parameterize the name in every config. One line of background on why naming changed (what predictable names solve): naming by firmware/bus position keeps the name from drifting when NICs are moved.

**Two default routes treading on each other.** Each of two NICs gets its own default via DHCP; with equal metrics the kernel guarantees no stable choice, and the symptom is route flapping. Handling: keep the default route on only one interface, or separate primary and backup with an explicit `metric`; in a static setup, leaving the gateway field empty in the connection profile means "no default route".

**A service bound to 127.0.0.1 is assumed reachable from outside.** The symptom is local `curl` working perfectly while everything external is refused. `ss -tlnp` reveals it at a glance: the listening address is loopback. This is not a network problem but the service's bind address -- yet the check belongs to the listening-surface audit in section 5, and going port by port at launch catches it.

**IPv6 does not work although the config looks perfect.** The address is there and the service listens on `[::]`, but the v6 default route comes from RA and the upstream router is not sending it, or nobody is receiving it. The absence of a default line in `ip -6 route` confirms it. Either repair the RA or add a static v6 route, or explicitly disable v6 per section 4.3 -- leaving an intermediate state (address without route) in production is the worst option.

**After changing the hostname, some services still use the old name.** What hostnamectl changes is the kernel name; services still showing the old name come in two kinds: those that cached the hostname at startup (a service restart fixes it), and those with the old FQDN hard-coded in certificates/config (a configuration problem -- go back to section 2 and walk the FQDN loop again). For Samba/Kerberos-class services, run `hostname -f` first to confirm the assembled FQDN matches the config before restarting, so you do not restart a good service into a broken state.

## References

- Arch Wiki: systemd-resolved -- [wiki.archlinux.org/title/Systemd-resolved](https://wiki.archlinux.org/title/Systemd-resolved)
- Arch Wiki: Network configuration -- [wiki.archlinux.org/title/Network_configuration](https://wiki.archlinux.org/title/Network_configuration)
- Arch Wiki: Network configuration (its Checklist section is the source of the pre-launch checklist idea) -- [wiki.archlinux.org/title/Network_configuration](https://wiki.archlinux.org/title/Network_configuration)
- systemd man pages -- man hostnamectl, man systemd-resolved, man nsswitch.conf
- "Vbird's Linux Cabinet" - network parameter configuration -- [linux.vbird.org](https://linux.vbird.org/linux_server/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [knowledge](/knowledge.md)
- [application-scenarios](/research/application-scenarios.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [README](README.md)