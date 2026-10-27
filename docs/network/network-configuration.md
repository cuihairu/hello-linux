# Network Configuration Basics

Giving a Linux machine a usable IP address
looks like an entry-level task,
yet it actually spans four entirely different configuration systems:
Netplan, systemd-networkd,
NetworkManager (`nmcli`), and the legacy ifcfg scripts.
Choosing the wrong system, editing the wrong file,
or watching the configuration "disappear" after a reboot
all trace back to the same cause --
**not knowing who is actually managing the NIC right now**.

This page first explains that selection logic,
then gives deployable configuration methods across the three distro families,
and finally walks the whole DNS resolution chain,
the most easily overlooked link of all.
The page unfolds as: "first answer: who is managing your NIC" ->
"inspecting the current network state" -> "persistent configuration: the three families compared" ->
"routing configuration" -> "DNS configuration and the resolution path" ->
"bonding and VLANs" -> "network performance tuning" ->
"worked cases" -> "common pitfalls" ->
"the boundary of container and virtual networking" ->
"how this page relates to the rest of the chapter."

> Content adapted from the Netplan, systemd-networkd,
> and NetworkManager official manuals and the Arch Wiki;
> see the references at the end.

## What This Page Covers

- Determining which network manager currently owns a machine,
  so several systems never fight each other
- When each of the four configuration approaches fits:
  Netplan, systemd-networkd,
  `nmcli`, and ifcfg
- The complete DNS resolution path from `getaddrinfo()`
  down to `/etc/resolv.conf`
- Configuring static addresses, routes, bonding, VLANs,
  and basic kernel tuning
- Recognizing the high-frequency pitfalls of configuration management
  (losing settings on reboot, resolv.conf being overwritten,
  route cache illusions)

## 1. First Answer: Who Is Managing Your NIC

Before editing any configuration file,
confirm who currently manages it.
This single step avoids the classic incident of
"changed A only to be overwritten by B":

```bash
# Is NetworkManager running
$ systemctl is-active NetworkManager
active

# Is systemd-networkd running
$ systemctl is-active systemd-networkd
active

# Is Ubuntu using Netplan
$ ls /etc/netplan/
00-installer-config.yaml
```

Having two managers `active` at once is a dangerous state:
both NetworkManager and systemd-networkd
write addresses and `resolv.conf`,
the later writer overwrites the earlier one,
and after a reboot the outcome depends on systemd's start order,
showing up as "occasional configuration rollback."
To see who really holds the device,
read the output of `nmcli device status`
and `networkctl status`.

The default layout across the three families is roughly as follows,
and it is the starting point for choosing:

| Distro | Default manager | Configuration entry point | Notes |
|--------|-----------|----------|------|
| Debian/Ubuntu | NetworkManager (desktop) or systemd-networkd (server) | Netplan (`/etc/netplan/*.yaml`) | Netplan renders its configuration and hands it to the NM or networkd backend |
| Arch | usually systemd-networkd or NetworkManager | `/etc/systemd/network/*.network` or `nmcli` | no single front end; depends on what was chosen at install time |
| RHEL/CentOS/Rocky 9+ | NetworkManager | `nmcli` or keyfile | `network-scripts` (ifcfg) has been removed and survives only in older releases |

**Netplan is not a manager, it is a translation layer**.
It reads YAML
and renders backend configuration
that NetworkManager or systemd-networkd understands.
So on Ubuntu, after editing
`/etc/netplan/*.yaml`
you must run `sudo netplan apply`
for the change to take effect;
editing the backend files directly may be overwritten
at the next `netplan apply`.
Once you understand this relationship,
the question "which file should I actually edit"
stops being confusing.

Three rules of thumb to carry at the start.

**Choose NetworkManager for desktop and mobile scenarios**.
It is the most mature at handling Wi-Fi, VPN, roaming,
and connection priorities,
and desktop distros ship with it.
**Choose systemd-networkd for headless servers**.
Few dependencies, early start, well integrated with the systemd ecosystem,
and especially suitable for container hosts.
**On installed RHEL bases, always use `nmcli`**.
After 9, ifcfg is gone,
and editing `/etc/sysconfig/network-scripts/`
by following old documentation only gets you
"changed it and nothing happened."

To judge the layout of any given machine,
run the detection commands from the top of this section
before touching anything on a new box --
whoever is `active` in the output
and lists your NICs
is the actual manager:
**go by the output, not by your impression of the distro**.

## 2. Inspecting the Current Network State

Whichever system you use,
the observation commands are the same --
`ip` comes from iproute2
and works across all three families
(install or upgrade with `pacman -S iproute2` on Arch,
`apt install iproute2` on Debian/Ubuntu,
`dnf install iproute` on the RHEL family;
it is normally there by default):

```bash
# Link state of every interface
$ ip link show
1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 ...
2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 ...

# Addresses, with prefix lengths
$ ip -br addr
lo   UNKNOWN 127.0.0.1/8 ::1/128
eth0 UP      192.168.1.100/24 fe80::216:3eff:fe12:3456/64
```

The `state` field of `ip link` is easy to misread:
`UP` means the administrative state is enabled,
`LOWER_UP` means carrier has been detected (the cable is plugged in).
Virtual interfaces, or physical ones with no cable,
often show `UP` without `LOWER_UP`,
in which case "the interface is up" but connectivity is impossible.
Check the TX/RX counters with `ip -s link show eth0`;
steadily growing `errs`/`drop`
points at link-layer trouble
(duplex mismatch, a loop, a driver bug),
so fix the link first and only then discuss upper-layer configuration.

When you need a temporary change to verify something,
`ip` is the fastest path,
but **it is not persistent** and vanishes on reboot:

```bash
sudo ip addr add 192.168.1.100/24 dev eth0
sudo ip link set eth0 up
sudo ip route add default via 192.168.1.1
```

Keep the line between temporary and permanent sharp:
**verify with `ip`, make it permanent in a configuration file**.
Conversely,
the production procedure is to change the file first
and then `apply`/`reload`.
Many tickets shaped "it worked yesterday and vanished at today's reboot"
have as their root cause someone who only ran `ip addr add`.

Also note interface naming:
modern distros default to predictable names
(`ens`, `enp`, `eno`)
rather than a uniform `eth0`.
Go by the actual output of `ip -br addr`
and never copy the `eth0` from some document --
with the wrong name, every command answers
`Cannot find device`.

## 3. Persistent Configuration: The Three Families Compared

### 3.1 Netplan (Debian/Ubuntu, the Ubuntu default)

Netplan describes addresses, routes, and DNS
in a single YAML document;
the syntax is independent of the backend
and it is the most convenient entry point on Ubuntu.
Files live in `/etc/netplan/`
and load in filename order:

```yaml
# /etc/netplan/01-netcfg.yaml
network:
  version: 2
  renderer: networkd
  ethernets:
    eth0:
      dhcp4: false
      addresses:
        - 192.168.1.100/24
      routes:
        - to: default
          via: 192.168.1.1
      nameservers:
        addresses: [8.8.8.8, 8.8.4.4]
        search: [example.com]
```

`renderer: networkd`
is for servers without a desktop;
on a desktop switch to `NetworkManager`.
The behavioral difference between the two shows up mainly in
Wi-Fi, mobile broadband, and connection priority handling --
the end result for a static wired address is essentially identical.

Validate the syntax before applying --
Netplan's YAML is indentation-sensitive,
and a mistake makes `apply` fail outright while keeping the old configuration:

```bash
sudo netplan generate     # render backend configuration only
sudo netplan try           # try applying; auto-rolls back after 60 seconds without confirmation
sudo netplan apply         # apply for real
```

`netplan try` is an underrated safety net:
during the countdown it listens for your confirmation
and reverts automatically when time runs out,
designed exactly for the "I have no out-of-band management port" case.
**When changing network configuration remotely,
always `try` before `apply`**.
If `apply` locks you out,
a cloud instance can still be rescued through the console VNC,
while physical hardware may require a trip to the data center --
one `try` saves that journey.

When you only want to see what would be generated,
use `netplan get`
(available in 0.106+)
or simply read the output under
`/run/systemd/generator/`.
In the YAML, `addresses` is a list with prefixes
(`192.168.1.100/24`),
not the old-style `netmask`;
the gateway is expressed through the `routes` list,
which is the largest syntax difference
between Netplan and the backend configurations.

### 3.2 systemd-networkd (Common on Arch)

systemd-networkd
is the lightweight network daemon that ships with systemd;
its configuration comes in three file types:
`.network` (takes over a NIC),
`.netdev` (creates virtual devices),
`.link` (udev-level parameters),
all stored in
`/etc/systemd/network/`.
It does not depend on NetworkManager,
which suits servers and container hosts:

```ini
# /etc/systemd/network/10-eth0.network
[Match]
Name=eth0

[Network]
Address=192.168.1.100/24
Gateway=192.168.1.1
DNS=8.8.8.8
DNS=8.8.4.4
Domains=example.com
```

Enable and observe:

```bash
sudo systemctl enable --now systemd-networkd
networkctl status eth0
networkctl list
```

`[Match]` accepts several conditions such as
`Name` (with wildcards),
`MACAddress`, and `Path`.
**Matching by MAC rather than by device name**
is best practice in cloud and virtualization environments --
names like `eth0`/`ens33`
can drift after cloning, hot-plugging, or a BIOS change,
and the configuration then silently stops applying.
`networkctl status`
also shows the DHCP lease, the DNS source, and the link speed,
and is the first stop for networkd problems.

Multiple `.network` files apply in filename order
and the first match wins,
so numeric prefixes (`10-`, `20-`) are the usual way to set priority.
After a change, `networkctl reload`
picks it up without restarting the service.
Put the two habits -- match by MAC and use numeric prefixes --
together and they cover the great majority of server cases.

### 3.3 NetworkManager / nmcli (RHEL/CentOS/Rocky)

From RHEL 9 on,
NetworkManager is the only official network manager:
the `network-scripts` (ifcfg) package has been removed entirely
and `nmcli` is the de facto standard.
Its strength is the connection abstraction:
one connection can be reused by many devices,
with profiles, priorities, auto-reconnect,
and zone binding (integrating with firewalld).

```bash
# Check status
$ nmcli general status
STATE      CONNECTIVITY  WIFI-HW  WIFI     ETH-HW  VPN-HW
connected  full          enabled  enabled  enabled  enabled

$ nmcli device status
DEVICE  TYPE      STATE      CONNECTION
eth0    ethernet  connected  ens160
lo      loopback  unmanaged  --

# Create a static connection
sudo nmcli connection add type ethernet con-name office ifname eth0 \
    ipv4.method manual ipv4.addresses 192.168.1.100/24 \
    ipv4.gateway 192.168.1.1 ipv4.dns "8.8.8.8 8.8.4.4"

# Enable / disable / delete
sudo nmcli connection up office
sudo nmcli connection down office
sudo nmcli connection delete office
```

`nmcli` supports filtering by property (`-f`)
and field-name completion,
which makes it easy to script.
Modify an existing connection with
`nmcli connection modify`;
the `+`/`-` prefixes add or remove list items
without overwriting the existing values
(such as `+ipv4.routes`, `-ipv4.dns`) --
writing `ipv4.dns "8.8.8.8"` directly
replaces every DNS entry,
so `+` first and `-` after is the safe incremental way.

A connection has two on-disk forms:
the traditional `ifcfg-*` text
(common on RHEL 7/8)
and keyfile
(`/etc/NetworkManager/system-connections/`,
the default on 9+).
The latter has mode `600`,
private to root,
which keeps plaintext passwords from leaking.
Keyfile is INI-style
and its field names do not fully match ifcfg's,
so when migrating, export with
`nmcli connection show`
and rebuild from that
rather than translating every line by hand.

### 3.4 ifcfg Scripts (Legacy RHEL 7/8 Only)

On a legacy system you will still see
`/etc/sysconfig/network-scripts/ifcfg-eth0`.
Understanding its fields helps read pre-migration configurations:

```bash
# RHEL 7/8; removed from 9 on
DEVICE=eth0
BOOTPROTO=static
ONBOOT=yes
IPADDR=192.168.1.100
NETMASK=255.255.255.0
GATEWAY=192.168.1.1
DNS1=8.8.8.8
DNS2=8.8.4.4
```

After editing you must restart the network service or the interface
for it to take effect.
When migrating to RHEL 9,
export the existing connections with `nmcli`
and rebuild them
rather than translating ifcfg by hand --
switches such as `DEFROUTE` and `PEERDNS`
have no one-to-one equivalent in keyfile,
and missing one shows up as
"the address is right but DNS never took effect."

Debian traditionally also has the
`/etc/network/interfaces` style
(`auto eth0` / `iface eth0 inet static`),
but on systems with NetworkManager
or Netplan enabled you **should not**
add entries there --
the two sources overwrite each other.
The criterion is still the manager detection of section 1 --
**there is exactly one configuration entry point, and that is an iron rule**.

## 4. Routing Configuration

### 4.1 Reading and Interpreting

```bash
$ ip route show
default via 192.168.1.1 dev eth0 proto dhcp src 192.168.1.100 metric 100
10.0.0.0/24 via 192.168.1.254 dev eth0
192.168.1.0/24 dev eth0 proto kernel scope link src 192.168.1.100 metric 100

# Which exit would be used for a specific destination
$ ip route get 10.0.0.5
10.0.0.5 via 192.168.1.254 dev eth0 src 192.168.1.100 uid 0
```

`proto dhcp`
means the entry was handed down by DHCP,
and `proto kernel`
means the directly connected route
the kernel generated when the address was configured.
Statically added routes usually show
`proto static`,
which makes them easy to tell apart from dynamic ones.
**The `ip route show cache` from old documentation no longer works** --
Linux 4.x removed the route cache,
so that command producing no output is normal,
and forwarding performance should be judged from connection tracking and the neigh table
rather than a "route cache."
If an old copy of this document still contains that command,
following it will only make you doubt your sanity.

### 4.2 Adding and Persisting

Adding temporarily takes effect immediately but does not persist:

```bash
sudo ip route add 10.0.0.0/24 via 192.168.1.254
sudo ip route del 10.0.0.0/24
```

How you persist it depends on the manager,
and this is where the three families differ most:

```bash
# Netplan (Ubuntu)
# routes: [{to: 10.0.0.0/24, via: 192.168.1.254}]

# systemd-networkd
# [Route]
# Destination=10.0.0.0/24
# Gateway=192.168.1.254

# NetworkManager (nmcli)
sudo nmcli connection modify office \
    +ipv4.routes "10.0.0.0/24 192.168.1.254"

# Legacy ifcfg: /etc/sysconfig/network-scripts/route-eth0
10.0.0.0/24 via 192.168.1.254
```

In production,
static routes are better delivered through the manager
than written into `rc.local` --
the manager replays routes as needed when the link flaps,
while `rc.local` runs only once at boot
and the route may vanish after an interface reconnects.
When investigating
"several subnets can reach each other but it drops intermittently,"
one-shot scripts like that are regular suspects.

When adding routes, also tell apart
**the main table from policy routing**:
an ordinary `ip route add`
goes into the main table,
while multi-tenant and multi-egress scenarios
use `ip rule` and custom tables
(such as `table 100`).
A day-to-day single-gateway server never needs the latter,
but if you see entries in
`ip rule show`
beyond `from all lookup main`,
the machine has policy routing
and troubleshooting can no longer look at the main table alone.

## 5. DNS Configuration and the Resolution Path

### 5.1 The Whole Resolution Chain

When DNS breaks,
many people only re-edit `/etc/resolv.conf` again and again,
only to find that "my change got reverted."
To avoid that futility,
first see the complete chain.

1. The application calls `getaddrinfo()` (glibc).
2. glibc reads the `hosts:` line of `/etc/nsswitch.conf`,
   commonly `files dns`
   or `files resolve dns`,
   which decides whether `/etc/hosts` is consulted first
   or DNS is used directly;
   when `resolve` is enabled,
   the query also goes through
   systemd-resolved's D-Bus interface.
3. If DNS is used,
   the query is sent to the `nameserver` entries
   listed in `/etc/resolv.conf`.
4. On systems with systemd-resolved enabled,
   `/etc/resolv.conf`
   is a symbolic link pointing at `127.0.0.53:53`,
   while the real upstream DNS configuration lives in
   `/etc/systemd/resolved.conf`
   and resolved aggregates it before querying outward.
5. NetworkManager may also own
   `resolv.conf`
   (when `PEERDNS=yes`),
   writing DHCP-provided DNS straight into it.

So `resolv.conf`
may be either a real file or a symlink,
and editing the wrong thing produces
"it saved successfully and was immediately reverted."
Confirm ownership:

```bash
$ ls -l /etc/resolv.conf
lrwxrwxrwx 1 root root 39 ... /etc/resolv.conf -> ../run/systemd/resolve/stub-resolv.conf

$ resolvectl status
Link 2 (eth0)
    Current DNS Server: 192.168.1.1
       DNS Servers: 8.8.8.8 8.8.4.4
```

Ubuntu 22.04+ and most new distros
default to stub mode (`127.0.0.53`);
RHEL does not use resolved by default
and NetworkManager writes the real
`/etc/resolv.conf` file directly.
**Use `ls -l` to see the link relationship first,
then decide what to edit**.

The most easily overlooked step in the chain is step 2:
`nsswitch.conf` decides
whether `files` comes before `dns`.
Someone adds an entry to `/etc/hosts`
and it has no effect,
usually because that machine's
`hosts:` line puts `dns` first,
or because a module such as
`mymachines` or `resolve`
was inserted in between and changed the order.
**When a hosts change does not take effect,
first `grep '^hosts' /etc/nsswitch.conf`**
and only then suspect caching or permissions.

### 5.2 Configuration Files and How Changes Take Effect

```bash
# Basic /etc/resolv.conf entries
nameserver 8.8.8.8
nameserver 8.8.4.4
search example.com
options timeout:2 attempts:3

# /etc/hosts static local mappings
127.0.0.1   localhost
192.168.1.100 myserver.example.com myserver

# systemd-resolved persistent configuration
# /etc/systemd/resolved.conf
[Resolve]
DNS=8.8.8.8 8.8.4.4
FallbackDNS=1.1.1.1
```

`options timeout`/`attempts`
control the per-query timeout and retry count;
loosening them on a weak link
reduces false resolution failures.
After changing resolved's configuration you need
sudo systemctl restart systemd-resolved;
changing `nsswitch.conf`
affects global resolution order,
so before touching it confirm no application depends on a particular order.

In a NetworkManager scenario,
the correct approach is to change the connection's DNS property
rather than editing the file --
the file gets overwritten at the next DHCP renewal:

```bash
sudo nmcli connection modify office ipv4.dns "8.8.8.8 8.8.4.4"
sudo nmcli connection up office
```

Every `nameserver`
must be on its own line;
writing
`nameserver 8.8.8.8 8.8.4.4`
resolves only the first one,
or errors out on the whole line --
the most common low-level mistake
when assembling configuration with `echo` in a script.

### 5.3 Observation and Troubleshooting

Use these commands for observation and diagnosis:
`resolvectl statistics` for cache statistics,
`resolvectl query example.com` to verify a single resolution,
`dig +norecurse example.com @192.168.1.1`
to force the query to a named upstream past the cache,
and sudo resolvectl flush-caches to clear the cache.

`dig @server`
names the upstream directly,
which separates
"a wrong local configuration" from "a broken upstream DNS":
if `dig @8.8.8.8`
resolves while the default query fails,
the problem is certainly in this machine's
resolv.conf/resolved configuration;
if both fail, it is the upstream or the egress.
This dividing line matches exactly the
chain of reasoning in [Network Troubleshooting](./troubleshooting.md).

There is another class of resolution problems:
**search domain side effects**.
With `search example.com` configured,
accessing the short name `myserver`
first tries `myserver.example.com`.
In a multi-region environment,
different search domain orders can resolve
to the wrong host of the same name --
"the ping works but it is a different machine"
is usually this.
To check, use `dig +short FQDN.`
(note the trailing dot) to bypass the search domain
and confirm whether this is the cause.

## 6. Bonding and VLANs

### 6.1 NIC Bonding

Bonding aggregates several physical NICs
into one logical interface,
with the goal of **redundancy** or **bandwidth stacking**.
The most-used `active-backup` mode
provides primary/backup failover:
when the primary NIC fails, traffic moves to the backup automatically
and upper layers never notice.

```bash
sudo modprobe bonding

# Excerpt from /etc/network/interfaces on Debian/Ubuntu
auto bond0
iface bond0 inet static
    address 192.168.1.100
    netmask 255.255.255.0
    gateway 192.168.1.1
    bond-slaves eth0 eth1
    bond-mode active-backup
    bond-miimon 100
```

`bond-miimon 100`
means the link state is checked every 100 ms,
a balance between failover speed and overhead.
Check the bonding state:

```bash
$ cat /proc/net/bonding/bond0
Ethernet Channel Bonding Driver: v5.15.0
Bonding Mode: fault-tolerance (active-backup)
Primary Slave: eth0
Currently Active Slave: eth0
```

`Currently Active Slave`
tells you directly which cable the traffic is on,
and during cutovers and troubleshooting
you often need to confirm it switched as expected.
Bonding differs from teaming (`teamd`)
and from a bridge:
bond aggregates at layer two,
a bridge joins multiple L2 domains
(container/VM scenarios),
and teaming has gradually been superseded by bonding and SwitchDev,
so new projects need not favor team.

Bonding also has to agree with the switch side:
`active-backup` has no special switch requirements,
while `802.3ad` (LACP)
requires link aggregation enabled on the far switch,
otherwise only one of the two cables passes traffic --
the symptom is "bound, but only one NIC shows traffic."
Confirm the far end's capability before changing modes;
that is far more useful than tuning parameters on the Linux side.

### 6.2 VLANs

A VLAN carves several broadcast domains
out of one physical link,
and the switch side needs a trunk configured.
On Linux, create a sub-interface to join a VLAN:

```bash
sudo modprobe 8021q
sudo ip link add link eth0 name eth0.100 type vlan id 100
sudo ip addr add 192.168.100.1/24 dev eth0.100
sudo ip link set eth0.100 up
```

The naming convention is `parent.VLAN-ID`
(for example `eth0.100`),
so membership is legible at a glance.
Persistence again depends on the manager:
Netplan uses a `vlans:` section,
networkd uses a `.netdev` file with `[VLAN]`,
and `nmcli` creates a connection with `type vlan`.

**The VLAN ID must match the switch side**,
otherwise the sub-interface is `UP`
but receives no frames at all --
the symptom resembles an unplugged cable,
and `tcpdump -i eth0 -e vlan`
can show whether frames carry the expected tag.
In multi-VLAN environments also note that
the parent interface usually holds no IP;
all addresses live on the sub-interfaces,
which avoids the hidden routing problem of
"a parent address colliding with VLAN addresses."

## 7. Network Performance Tuning

### 7.1 Kernel Parameters

Always quantify the problem before tuning --
`ss -s` for connection counts,
`nstat` for TCP error counters,
and only then decide which parameter to change.
Blindly copying an "optimization template"
often backfires,
because larger buffers also raise memory use:

```bash
# /etc/sysctl.d/99-network.conf
# Example only; tune to your own load test results
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096
net.ipv4.tcp_fin_timeout = 30
net.ipv4.tcp_tw_reuse = 1
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
```

Keep them in a separate file under
`/etc/sysctl.d/`,
which is easier to manage and roll back
than appending to `/etc/sysctl.conf`.
Apply with sudo sysctl --system.

`tcp_fin_timeout` and `tcp_tw_reuse`
only affect the recycling rhythm of actively closed connections,
and they help proxy-style services drowning in TIME_WAIT;
but on a client behind NAT,
blindly enabling reuse can collide
with an old connection still in TIME_WAIT,
so it has to be evaluated against the specific scenario.
**Tuning without load-test data behind it is guesswork**.

The recommended order of work:
first pin down the problem metric (loss, handshake failures, queue overflows),
then pick the matching parameter,
then re-measure the same metric after the change.
Changing ten parameters at once
means that even if the symptom disappears you cannot attribute it,
and the next fault will repeat the whole exercise.

### 7.2 Interface Parameters

```bash
# Check the current negotiation result
$ ethtool eth0
Settings for eth0:
    Speed: 1000Mb/s
    Duplex: Full
    Auto-negotiation: on

# View/adjust the Ring Buffer (common when chasing packet loss)
sudo ethtool -G eth0 rx 4096 tx 4096
```

On modern NICs and switches
**keeping auto-negotiation is strongly recommended**;
forcing `speed 1000 duplex full` by hand
can instead create duplex mismatches and intermittent loss --
the typical signature of which is
"small traffic is fine, large traffic drops packets,"
which is extremely hard to locate by feel,
and the error counters in `ethtool -S eth0`
are the actual evidence.

A too-small ring buffer drops packets under high PPS,
and the `drop`
counter of `ip -s link` is the first evidence;
after adjusting, watch whether the counter stops climbing,
closing the loop of "measure, adjust, re-measure."
Remember to persist the change in a networkd
`.link` file or a udev rule,
otherwise the next boot puts it back to the default.

## 8. Worked Cases

### 8.1 A One-Shot Diagnostic Script

Chain the observation commands from sections 2, 4, and 5
into a minimal diagnostic set
and run it first on any network ticket:

```bash
#!/bin/bash
echo "=== 1. Interface state ==="
ip -br addr
echo "=== 2. Routes ==="
ip route show
echo "=== 3. DNS sources ==="
ls -l /etc/resolv.conf
grep -E '^hosts' /etc/nsswitch.conf
echo "=== 4. Connectivity ==="
ping -c 2 -W 2 192.168.1.1 >/dev/null && echo "gateway: OK" || echo "gateway: FAIL"
ping -c 2 -W 2 8.8.8.8      >/dev/null && echo "public:  OK" || echo "public:  FAIL"
ping -c 2 -W 2 example.com   >/dev/null && echo "DNS:     OK" || echo "DNS:     FAIL"
```

The value of the script is its **fixed order**:
configuration first (1-2),
then resolution sources (3),
then layered probing (4).
Any FAIL narrows the field to the corresponding layer
and avoids the inefficiency of reaching for a capture immediately.
Lift the gateway address and target domain
into variables at the top of the script,
and it can be reused in a new environment by changing two lines.

### 8.2 Migration Checklist

After moving across distros or reinstalling,
this checklist avoids most configuration loss:

1. Confirm the new system's network manager
   (the commands from section 1) and pick the right entry point.
2. Export the old machine's addresses, routes, and DNS
   (`ip addr`, `ip route`,
   `cat /etc/resolv.conf`)
   and write them into the new configuration.
3. Apply with `netplan try` / `nmcli con up` /
   `networkctl reload`,
   keeping a rollback window open.
4. Verify layer-three connectivity
   (gateway, public IP, name),
   then verify the business ports.
5. Confirm the configuration landed in the persistent layer
   and was not merely changed temporarily with `ip` --
   restart the machine once as a final check.

Step 5 of the checklist is the most often skipped
and is precisely the only defense against
"configured in the morning, gone after an afternoon restart."
Putting the restart verification into the change process
is more relaxing than remembering the details of every manager.

## 9. Common Pitfalls

- **A resolv.conf edit is reverted immediately**.
  It is probably owned by systemd-resolved
  or NetworkManager.
  Use `ls -l` as in 5.1 to determine ownership,
  change the setting the manager exposes,
  and do not edit the file itself.
- **Losing access after `netplan apply`**.
  YAML indentation errors, or a
  `renderer` that does not match the actual backend,
  make the apply fail or the interface disappear.
  When working remotely, always use `netplan try`
  and leave the system its 60-second automatic rollback.
- **Two managers active at once**.
  NetworkManager and networkd coexisting
  overwrite each other's addresses and DNS,
  which looks like configuration rolling back "at random."
  Disable the one you do not need with `systemctl disable`
  and keep a single manager.
- **Device names drifting and the configuration going dead**.
  After cloning a VM or changing hardware,
  `eth0` may become `ens192`
  and every name-based match misses.
  Switch to MACAddress matching,
  or enable `net.ifnames=0`
  for uniform naming
  (evaluate the impact on existing operations scripts first).
- **Treating `ip route show cache` as troubleshooting evidence**.
  Newer kernels removed the route cache;
  that command producing no output is normal,
  not "the cache got lost."
- **Forcing NIC speed/duplex**.
  Unless the switch side is explicitly configured too,
  keep auto-negotiation;
  the signature of a duplex mismatch is
  "half-working, lots of retransmits,"
  and both the `ethtool` side and the switch port
  have to be checked.
- **A VLAN sub-interface is UP but carries no traffic**.
  Check whether the switch trunk
  allows that VLAN through,
  and whether the parent interface is in the right mode;
  use `tcpdump -e`
  to see whether the frame tag matches.
- **Permanent routes written into a temporary script**.
  An `ip route add` in `rc.local`
  or in an ad-hoc operations command
  vanishes at the next restart.
  Put it back into the manager configuration per 4.2.

## 10. The Boundary of Container and Virtual Networking

Container networking is often mistaken for
"a separate kind of network,"
but it reuses every primitive covered on this page:
veth pairs, bridges, routes, NAT --
with one extra layer the runtime manages automatically.
Once you see that,
the troubleshooting approach transfers directly
and there is no need to reinvent a methodology inside the container world.

Docker by default creates the
`docker0` bridge and attaches
a veth endpoint to each container,
with container egress translated by MASQUERADE.
When you see a container that
"can reach the internet but the host cannot reach a container port,"
nine times out of ten port mapping is being confused with
bridge routing:
the former is DNAT,
the latter is reachability of the container subnet --
they solve different problems
and their investigation paths differ.

Kubernetes is the same story,
only with the static docker0 replaced by
bridges and routing rules created dynamically by the CNI.
No matter how complex the orchestration above,
the kernel's view always reduces to
"who created the interface, who wrote the routes, who did the NAT."
So the routing knowledge of section 4 is not merely applicable in container scenarios,
it is the only reliable lead when a cross-node Service does not work --
first `ip route` to see how the encapsulated subnet is reached,
then the forwarding rules in iptables/nft,
and only then suspect the application port.

VM networking adds a virtual switch:
the `vnet` interfaces on the host
connect to the guest's NICs through bridging or NAT.
After migrating a VM or cloning a template,
MAC address drift,
picking the wrong bridge NIC,
and the host firewall breaking the forwarding path
are all frequent problems.
The order of judgment is the same:
look at the host-side interfaces and bridge state first,
then the guest's internal configuration,
and finally use a capture to confirm whether the packet is lost
on the host or in the guest --
the discipline of layered evidence holds in virtualization too.

## 11. How This Page Relates to the Rest of the Chapter

Configuration only answers "are the addresses right";
it does not guarantee "does it work."
If a problem remains after configuration, turn to:

- layered reasoning to localize it:
  [Network Troubleshooting](./troubleshooting.md)
- whether rules are blocking it:
  [Firewall](./firewall.md)
- a refresher on the layered model and command semantics:
  [Networking Basics](./basics.md)

Together the three form the closed loop of
"configuration -> connectivity -> policy,"
and missing any link drops troubleshooting into circular guessing.
Confirm addresses and routes first (this page),
then paths and resolution (the troubleshooting page),
then policy (the firewall page) --
reverse the order and you will spin for a long time in the wrong layer.

The shared method of these three pages can be compressed into one sentence:
**prove what happened in the kernel first,
then discuss why the application is not responding**.
This page records the facts of reading addresses and routes,
the troubleshooting page the facts of reading packets and connections,
the firewall page the facts of reading drop decisions --
only the three together
constitute a complete observation of the layer we call "the network."
Omit any one of them
and your viewpoint gains a fixed blind spot,
and faults love nothing more than hiding in blind spots.

## References

The common failing of configuration documentation is
"read it and forget it,"
because it lacks contact with a real machine.
After finishing each section,
run that section's commands in full on a test machine
and put the output next to the examples in the text:
matching means you understood it,
and a mismatch is exactly the difference worth chasing.
Differences are usually more instructive than matches --
they point either at distro differences
or at an extra manager running on your machine,
and both will recur throughout later operations.
Record those differences in your own environment notes,
and in six months you will own a record of
"how this machine is actually networked"
that is more accurate than any generic document.

- Netplan official documentation -- [netplan.readthedocs.io](https://netplan.readthedocs.io/)
- systemd.network(5), networkctl(1),
  systemd-resolved.service(8)
- Arch Wiki - systemd-networkd -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd-networkd)
- Arch Wiki - Network configuration -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Network_configuration)
- NetworkManager manual -- [networkmanager.dev](https://networkmanager.dev/docs/)
- RHEL 9 Configuring and managing networking -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_and_managing_networking/)
- Bird's Private Recipes - Network configuration -- [linux.vbird.org](https://linux.vbird.org/linux_server/centos6/0110network_basic.php)
- `man ip`, `man nmcli`, `man netplan`,
  `man sysctl`, `man ethtool`

<!-- BACKLINKS-AUTO -->
## Related Pages

- [configuration-management](/commands/system/configuration-management.md)
- [system_info](/commands/system/system_info.md)
- [network](/hardware/network.md)
- [README](README.md)
- [basics](basics.md)
- [commands-practice](commands-practice.md)
- [tcpip-essentials](tcpip-essentials.md)
- [troubleshooting](troubleshooting.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [dhcp](/server/dhcp.md)
- [network-parameters](/server/network-parameters.md)
- [routing-nat](/server/routing-nat.md)
- [network-stack](/source/network-stack.md)
