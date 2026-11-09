# Who Is Managing Your NIC

> Part of [Network Configuration Basics](../network-configuration.md) --
> this page covers manager detection and inspecting the live state.
> Making changes permanent is covered in
> [Persistent Configuration](persistent-config.md).

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

## Inspecting the Current Network State

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

The configuration entry points for each family are compared in
[Persistent Configuration](persistent-config.md);
routes observed here are read in depth in
[Routing Configuration](routing.md).
