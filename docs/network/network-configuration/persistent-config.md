# Persistent Configuration: The Three Families Compared

> Part of [Network Configuration Basics](../network-configuration.md) --
> the four configuration entry points, compared.
> Before changing anything, confirm the manager with
> [Who Is Managing Your NIC](manager-detection.md).

## Netplan (Debian/Ubuntu, the Ubuntu Default)

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

## systemd-networkd (Common on Arch)

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

## NetworkManager / nmcli (RHEL/CentOS/Rocky)

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

## ifcfg Scripts (Legacy RHEL 7/8 Only)

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
The criterion is still
[manager detection](manager-detection.md) --
**there is exactly one configuration entry point, and that is an iron rule**.

With addresses persisted, the next layers are
[Routing Configuration](routing.md)
and [DNS and the Resolution Path](dns.md).
