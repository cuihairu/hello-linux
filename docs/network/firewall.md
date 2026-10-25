# Firewall

A firewall is the component most likely to be "framed" in a network:
the moment business traffic stops flowing, it is often the first thing suspected;
and yet it is the second most likely to be skipped in a check --
because many people only remember "I installed a firewall,"
not "what it allows by default, and what it blocks".

This page covers the firewall from a **connectivity and troubleshooting** perspective:
how it decides whether a packet may pass through this machine,
how the defaults differ across the three distro families,
and how to prove with evidence whether "the firewall did block it or did not".
The page unfolds as: "why connectivity problems always start by asking the firewall" ->
"the defaults of the three distro families" -> "three rule models: ufw, zone, nft" ->
"the troubleshooting path from a connectivity view" -> "install and enable comparison across the three families" ->
"common pitfalls" -> "when to continue in the Security chapter",
with the three families shown as Debian/Ubuntu (ufw), Arch (nftables),
and RHEL/CentOS/Rocky (firewalld) side by side.

> Content adapted from the official documentation of ufw,
> firewalld, and nftables and the Arch Wiki; see the references at the end.

> **Division of labor with the Security chapter**:
> rule design principles, default-deny policy, rate limiting,
> audit hardening, and other **security policy** topics
> live in [Security - Firewall](../security/firewall.md).
> This page only answers "does the traffic get through,
> why not, and how to verify it",
> with the two pages cross-referencing rather than repeating each other.

## What This Page Covers

- Why connectivity problems always start by asking the firewall, and how to tell "not listening" from "blocked"
- Comparing the default firewall state and tooling across the three distro families (ufw / firewalld / nftables)
- Understanding the differences among the three rule models: port allowlist, zone, and nft tables/chains
- The troubleshooting path from a connectivity view: service listening -> local rules -> path verification
- Being able to prove "the firewall did / did not block it," and knowing where this page hands off to the Security chapter's policy design

## 1. Why Connectivity Problems Always Start by Asking the Firewall

Linux kernel packet filtering happens at **hooks**:
when a packet enters from the NIC (INPUT), is about to be forwarded (FORWARD),
is being sent to a local process, or leaves from the NIC,
it passes through the rule tables in order.
If any rule matches and returns `DROP`/`REJECT`,
the packet never reaches the application layer --
so `ss` shows the port in `LISTEN`,
`tcpdump` on the NIC shows the SYN arriving,
yet the client simply never gets a response.

That is why troubleshooting has to separate three questions:

1. **Is the service listening?**
   -- `ss -tlnp`, which belongs to the application and transport layers.
2. **Did the packet reach this machine?**
   -- `tcpdump -i eth0 port 80`,
   which belongs to the link/internet layers.
3. **Who dropped the packet?**
   -- firewall rules or kernel parameters, which is what this page covers.

The three conclusions are independent of one another.
Many "the firewall did it" cases turn out to be a service that was never running,
and vice versa --
so the first action on this page is always **checking the state**,
not rushing to edit rules.

A more complete order of judgment is:
confirm the listener with `ss` first,
then confirm with `tcpdump` whether the packet reached this machine,
and only then look at the rules.
If there is no inbound SYN in the capture at all,
the firewall "has nothing to work on" no matter how strict its rules are --
the problem is on the upstream path.
Conversely,
if the SYN arrives, no response goes out,
and the listener is healthy,
the suspicion narrows sharply to the INPUT/OUTPUT chains.
Making these three steps a habit
avoids the two most common misjudgments.

## 2. Default State Across the Three Families

For the facts of the default state and their policy implications, see [Security chapter - Firewall](../security/firewall.md) in one place: Ubuntu's ufw is usually not enabled, Arch does not preinstall a firewall by default, and the RHEL family usually enables firewalld. This page keeps only the on-site judgment and verification from the connectivity side, so the two pages do not each maintain a copy of the three-family default state table.

**The first thing on any new machine is always confirming the firewall's current state**:

```bash
# Ubuntu/Debian (ufw)
$ sudo ufw status verbose
Status: inactive

# RHEL/CentOS/Rocky (firewalld)
$ sudo firewall-cmd --state
running
$ sudo firewall-cmd --list-all
public (active)
  target: default
  icmp-block-inversion: no
  interfaces: eth0
  sources:
  services: ssh dhcpv6-client
  ports:
  protocols:
  ...
```

The Arch family has no unified command;
look directly at `nftables` and the service state:

```bash
$ systemctl is-active nftables ufw
inactive
inactive
$ sudo nft list ruleset
# No output means there are no rules at all: all traffic passes
```

No output from `nft list ruleset` is a normal result,
not a command failure --
it means there really is not a single rule table in the kernel,
which amounts to "completely undefended".
Understanding this point
is what explains why a bare Arch install has the largest exposure to the outside world.

The difference in defaults also explains "migration incidents":
after moving from Ubuntu to Rocky,
a port 8080 that used to work suddenly stops,
which is often not lost configuration
but rather the fact that firewalld's public zone
never allowed that port.
Moving the other way, from Rocky to Ubuntu,
can make things "mysteriously all open" --
because the successor, ufw, is not enabled at all.
Listing "firewall state" as its own item on a migration checklist
saves a lot of after-the-fact investigation.

## 3. Three Rule Models: ufw, Zone, nft

### 3.1 ufw: A Minimal Model Aimed at "Application Profiles"

`ufw` (Uncomplicated Firewall)
is the default front end on Debian/Ubuntu,
abstracting complex rules into
two spines: "port/service plus allow or deny".
Its design goal is to finish 90% of scenarios in one command,
rather than exposing the full detail of chains, tables, and matchers.

```bash
# Install and enable (preinstalled on Debian/Ubuntu;
# Arch: pacman -S ufw; not available on RHEL)
$ sudo ufw allow 22/tcp
Rules updated
$ sudo ufw enable
Firewall is active and enabled on system startup
$ sudo ufw status numbered
Status: active

     To                         Action      From
     --                         ------      ----
[ 1] 22/tcp                     ALLOW IN    Anywhere
```

**Key point**:
`ufw allow` applies to `Anywhere` by default,
and allows IPv4/IPv6 at the same time.
Always allow SSH before enabling,
otherwise the remote session drops immediately and cannot be reconnected --
this is ufw's classic self-lockout incident.

ufw also supports "application profiles"
(`ufw app list`),
which come from definitions under `/etc/ufw/applications.d/`,
and are easier to maintain than opening raw ports.
The 80/443 ports commonly used by web services
usually already have preset profiles such as `Nginx Full` and `Apache Full`,
so bulk deployments can just reference them
instead of remembering each port number by hand.

### 3.2 firewalld: A Policy Model Centered on Zones

The core abstraction of `firewalld` is the **zone**:
each zone represents a default trust level for a class of network environment
(`public`, `home`, `work`, `trusted`,
`dmz`, `external`, and so on),
and once an interface or source address is bound to a zone,
it inherits that zone's allowlist.

This differs from the "stack up rules one by one" approach --
it first asks "what network is this NIC attached to,"
then decides what to allow.
The trust level follows the **location**,
not the individual connection,
which is especially natural for laptops that switch networks often:
wired gives `work`,
and connecting to a cafe Wi-Fi switches to `public` automatically.

```bash
# Show zones and interface bindings
$ sudo firewall-cmd --get-active-zones
public
  interfaces: eth0

# Allow HTTP temporarily (lost after a reload)
$ sudo firewall-cmd --zone=public --add-service=http
success

# Allow permanently and apply it
$ sudo firewall-cmd --zone=public --add-service=https --permanent
success
$ sudo firewall-cmd --reload
success
```

Forgetting `--permanent`
or forgetting `--reload` are high-frequency mistakes:
the command prints `success`,
but the rule disappears after a reboot or reload;
conversely,
adding only `--permanent` without `--reload`
means the current session still shows no effect --
**the two must go together**.
The split between temporary and permanent is deliberate:
temporary rules are for verification,
and once confirmed correct they get made permanent,
avoiding the case of "one command locked me out remotely" before you can take it back.

To judge which zone an interface belongs to,
you can also check with NetworkManager
(common on the RHEL family):

```bash
$ nmcli -f GENERAL.CONNECTION,GENERAL.DEVICES device show
GENERAL.CONNECTION:               ens160
GENERAL.DEVICES:                  ens160
```

The binding can be adjusted with
`firewall-cmd --change-interface=eth0 --zone=internal`.
Once an interface changes zones, its exposure changes immediately --
this is a must-check after a subnet migration or adding a NIC.

### 3.3 nftables: The Native Language of the Modern Kernel

`nftables` is the successor to iptables,
with more unified syntax (table -> chain -> rule),
and it covers the inet/ip/ip6 address families at the same time.
Arch officially recommends using it directly;
on RHEL 8 and later, firewalld's backend has also switched to
nftables; and Debian/Ubuntu can
bypass ufw and drive it directly as well.

```bash
# Install: Debian/Ubuntu use apt install nftables;
# Arch uses pacman -S nftables; RHEL uses dnf install nftables
$ sudo nft list ruleset
table inet filter {
  chain input {
    type filter hook input priority filter; policy accept;
    tcp dport 22 accept
    ip protocol icmp accept
  }
}
```

Reading this table gets you familiar with nft's skeleton:
`table inet filter`
is a filter table for the inet address family;
`chain input`
is a chain attached to the input hook with priority filter;
`policy accept`
means packets not matched by any rule are allowed by default
(change it to `drop` for allowlist mode).
One rule writes out "protocol + port + action" in a single pass,
without the iptables-style separate `-p`, `--dport`, and `-j`.

nft rules have no "persistence layer" like ufw/firewalld
do; a reboot loses them --
in production you must write the rules into
`/etc/nftables.conf`
and `systemctl enable nftables`,
otherwise the rules are all gone at next boot.
This is the difference most easily missed when migrating from ufw to nft:
ufw has `ufw enable` to back you up,
while nft has only the file you wrote by hand.

## 4. The Troubleshooting Path from a Connectivity View

When "the port is not reachable",
gather evidence in the order below,
and it usually takes two or three steps to locate it.

**Step one: confirm the listener**.
`ss -tlnp | grep :80`
tells you whether the service is bound to the expected address.
If it is bound to `127.0.0.1:80`
while the client comes in on a public IP,
the firewall never even gets a chance to act.

**Step two: confirm the firewall state and rule counters**.
For ufw, look at `ufw status verbose`;
for firewalld, `--list-all` plus `--list-ports`;
for nft, `nft list ruleset`.
If a rule carries counters
(the growing `pkts` column of `iptables -L -n -v`),
the packet really hit that rule --
whether ACCEPT or DROP is growing
gives the answer directly.

**Step three: capture for comparison**.
Capture on the local machine,
and if you see the peer's SYN
but no SYN-ACK goes out or it is dropped locally,
you can pin the responsibility on local policy or the application:

```bash
$ sudo tcpdump -ni eth0 port 80
tcpdump: verbose output suppressed, use -v or -vv for full protocol decode
listening on eth0, link-type EN10MB (Ethernet), capture size 262144 bytes
14:22:01.183421 IP 192.168.1.50.51234 > 192.168.1.100.80: Flags [S], seq 1829345678, win 64240, options [mss 1460], length 0
14:22:02.184561 IP 192.168.1.50.51234 > 192.168.1.100.80: Flags [S], seq 1829345678, win 64240, options [mss 1460], length 0
```

SYN only, no response,
and the listener is healthy --
at that point, going back to examine the INPUT chain / zone rules in detail
almost always turns up a `DROP`.
Conversely,
if there is no SYN at all in the capture,
the problem is on the path between the client and this machine
(routing, the peer's firewall, ARP),
and has nothing to do with the local firewall.
For the complete method of reading captures, see
[Network Troubleshooting](./troubleshooting.md).

There is one more easy-to-miss case:
the rule does allow the traffic,
but **the thing being allowed is not the right one** --
for example only an IPv4 allow was added
while the client comes in over IPv6;
or the zone is written correctly but the interface is bound to another zone.
When checking, line up the four dimensions at once --
"address family + interface + zone + port" --
which is faster than adding and deleting the same rule over and over.

## 5. Install and Enable Comparison Across the Three Families

When you need to add or replace a firewall,
work per the table below.
Arch always uses `pacman -S`:

| Action | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Install ufw | `apt install ufw` | `pacman -S ufw` | N/A (not the official default) |
| Install firewalld | `apt install firewalld` | `pacman -S firewalld` | `dnf install firewalld` (preinstalled) |
| Install nftables | `apt install nftables` | `pacman -S nftables` | `dnf install nftables` (preinstalled dependency) |
| Check status | `ufw status` | `nft list ruleset` | `firewall-cmd --state` |
| Enable at boot | `ufw enable` | `systemctl enable nftables` | `systemctl enable firewalld` |

**Do not run two** active firewalls
on the same machine
(for example ufw and firewalld both enabled).
Both write kernel rules,
the later one overwrites the earlier one,
and the result is hard to predict and hard to roll back --
during investigation you will see
"I clearly allowed it, so why does it still not work".
To judge which one is actually in effect, check the service state:

```bash
$ systemctl is-active ufw firewalld nftables
inactive
active
failed
```

(Services that are not installed or not configured may show
`failed` or `inactive`, which is normal.)

If you are migrating from ufw to nftables,
or from firewalld to plain nft,
first export the existing rules within a maintenance window
(`ufw status numbered`,
`firewall-cmd --list-all`,
`nft list ruleset`),
translate them into the equivalent rules of the target tool,
switch at a rollback-capable moment like `netplan try`,
and keep the old configuration for at least one release cycle.
The shorter the overlap between the two rulesets, the better.

## 6. Common Pitfalls

- **ufw self-lockout**.
  On a remote machine, running `ufw enable` before `allow 22`
  drops your own SSH immediately.
  The correct order is always:
  `ufw allow 22/tcp` first, then `ufw enable`,
  and only close the old connection after verifying success in another session.
  On a cloud host you should also check the security group
  (a security group is another virtual firewall layer,
  and ufw cannot reach it).
- **firewalld changed without reload,
  or reloaded without `--permanent`**.
  The two have opposite symptoms,
  but both make people think "the command did not take effect".
  Build the habit of running `--permanent` and `--reload`
  as a pair.
- **Zone bound to the wrong interface**.
  Moving `eth0`, which faces the public internet, from `public`
  to `trusted` (or mistakenly to `home`)
  is equivalent to opening all ports;
  conversely, binding an internal NIC to the `drop` zone
  causes "nothing works even on the same subnet".
  After a migration or a hot-plug of a NIC,
  always double-check the binding with `firewall-cmd --get-active-zones`.
- **Mixing the iptables and nft backends**.
  On RHEL 8+ and Ubuntu 22.04+, the `iptables`
  command is actually provided by the `iptables-nft` package,
  and writes into the nftables ruleset.
  The rules you see with `iptables -L`
  may overlap with part of `nft list ruleset`,
  but the two tools' "persistence mechanisms" are completely different --
  rules saved with `iptables-save`
  are not automatically loaded by nft.
- **Treating the "security group / upstream device" as the system firewall**.
  A cloud host, a hypervisor bridge, or a physical switch ACL
  can all block traffic.
  A clean local `nft list ruleset`
  does not mean the path is open;
  the principle of layered evidence collection applies here too.
- **Missing IPv6 rules**.
  ufw and nft's inet family
  handle IPv6 at the same time,
  but when writing `iptables` by hand,
  writing only `ip6tables` or only `iptables`
  produces a half-broken "v4 works, v6 does not" state.
  Always verify with `ping -6` or `curl -6`
  once each.

## 7. When to Continue in the Security Chapter

This page answered "why does the traffic not get through".
When you need to:

- design a server baseline policy of **default deny plus least privilege**;
- add rate limiting for SSH and ban brute-force sources;
- save/restore rules and bring them under configuration management;

keep reading
[Security - Firewall](../security/firewall.md),
which organizes the material around policy design rather than connectivity verification,
with the two pages complementing each other.
The division of labor in one sentence:
**this page answers "why it does not connect",
and the Security chapter answers "how it should be set up".**
Having read both,
you can gather evidence quickly at the fault scene
and configure the right policy in one pass when initializing a machine.

## References

- Arch Wiki - ufw -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Ufw)
- Arch Wiki - nftables -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Nftables)
- Arch Wiki - firewalld -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Firewalld)
- UFW Manual -- [manpages.debian.org](https://manpages.debian.org/bookworm/ufw/ufw.8.en.html)
- firewalld official documentation -- [firewalld.org](https://firewalld.org/documentation/)
- nftables wiki -- [wiki.nftables.org](https://wiki.nftables.org/)
- RHEL 9 Configuring firewalls with firewalld -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_firewalls_and_packet_filters/)
- `man ufw`, `man firewall-cmd`, `man nft`

<!-- BACKLINKS-AUTO -->
## Related Pages

- [log](/basic/log.md)
- [syslog](/basic/log/syslog.md)
- [services](/basic/services.md)
- [configuration_tools](/basic/services/configuration_tools.md)
- [log_management](/basic/services/log_management.md)
- [network-tools](/commands/network/network-tools.md)
- [network](/commands/network/network.md)
- [configuration-management](/commands/system/configuration-management.md)
- [glossary](/glossary.md)
- [network](/hardware/network.md)
- [README](README.md)
- [network-configuration](network-configuration.md)
- [network-monitoring](network-monitoring.md)
- [troubleshooting](troubleshooting.md)
- [vpn](vpn.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [README](/security/README.md)
- [firewall](/security/firewall.md)
