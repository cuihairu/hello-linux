# Routing Configuration

> Part of [Network Configuration Basics](../network-configuration.md) --
> reading, adding, and persisting routes.
> Static addresses come first, in
> [Persistent Configuration](persistent-config.md).

## Reading and Interpreting

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

## Adding and Persisting

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

Full NAT and forwarding setups built on these routes live in
[Routing and NAT](../../server/routing-nat.md);
name resolution over the routes you just verified is next in
[DNS and the Resolution Path](dns.md).
