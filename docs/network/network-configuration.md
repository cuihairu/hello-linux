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

The chapter is split into six subpages; read them in order
or jump straight to the one you need:

1. [Who Is Managing Your NIC](network-configuration/manager-detection.md) --
   manager detection across the three families and
   inspecting the live state with `ip`
2. [Persistent Configuration: The Three Families Compared](network-configuration/persistent-config.md) --
   Netplan, systemd-networkd, `nmcli`, and legacy ifcfg
3. [Routing Configuration](network-configuration/routing.md) --
   reading `ip route`, adding and persisting routes,
   main table vs policy routing
4. [DNS Configuration and the Resolution Path](network-configuration/dns.md) --
   the complete chain from `getaddrinfo()` to `resolv.conf`,
   and how to change DNS without it being overwritten
5. [Bonding, VLANs and Performance Tuning](network-configuration/advanced-topology.md) --
   advanced topologies, kernel/interface tuning,
   and the container/VM networking boundary
6. [Worked Cases and Common Pitfalls](network-configuration/troubleshooting-playbook.md) --
   a one-shot diagnostic script, a migration checklist,
   and the classic failure modes

## How This Page Relates to the Rest of the Chapter

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
After finishing each subpage,
run that subpage's commands in full on a test machine
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
