# Bonding, VLANs and Performance Tuning

> Part of [Network Configuration Basics](../network-configuration.md) --
> advanced topologies (bonding, VLANs),
> kernel and interface tuning,
> and where container/VM networking meets this page.

## NIC Bonding

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

## VLANs

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

## Kernel Parameters

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

## Interface Parameters

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

## The Boundary of Container and Virtual Networking

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
So the routing knowledge of
[Routing Configuration](routing.md)
is not merely applicable in container scenarios,
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
