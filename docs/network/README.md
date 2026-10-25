# The Network Chapter

The reason Linux can carry most of today's servers and cloud infrastructure
is the mature, transparent network stack inside its kernel:
from NIC drivers and IP route lookup to the TCP state machine and firewall hooks,
almost every layer leaves behind interfaces you can observe, reproduce, and debug.
The most-used approach in my network troubleshooting is not a command list but a stable reasoning chain: when you hit "the network is down," first decide which layer the problem falls in.

Here the material is organized by model, configuration, troubleshooting, and service scenarios, interspersed with the **Debian/Ubuntu, Arch, and RHEL/CentOS/Rocky** implementation differences and real terminal output.

> Division of labor with the [Security chapter](../security/README.md):
> this chapter's [firewall](./firewall.md) covers
> "why the traffic cannot get through, and how to verify that the firewall is the blocker";
> for security policy design, hardening, and rule audits, read
> [Security - Firewall](../security/firewall.md).

## Contents Index

Network problems are naturally layered. The pages are listed below in order of mutual dependency; when troubleshooting, enter from the matching symptom and verify your judgment with terminal output:

1. **Build the model**: read [Network Basics](./basics.md) first,
   to understand why the OSI/TCP-IP layers exist,
   what a packet goes through from send to return,
   and how `ip` and `ss` map onto the model's layers.
   Do not rush this station -- if the model is wrong, everything after it is just patching.
   The three-way handshake and four-way teardown state machines, packet structures, and windows
   are expanded in [TCP/IP Essentials](./tcpip-essentials.md);
   you can alternate between the two.
2. **Configure**: read [Network Configuration Basics](./network-configuration.md),
   to understand what problem each of the four configuration styles -- Netplan,
   systemd-networkd, NetworkManager (`nmcli`), and ifcfg -- solves,
   and the full path of DNS resolution from `getaddrinfo()`
   to `/etc/resolv.conf`.
3. **Get used to troubleshooting**: read [Network Troubleshooting](./troubleshooting.md),
   to internalize the "local machine -> gateway -> DNS -> remote" reasoning chain
   as muscle memory,
   and to gather evidence with `tcpdump` and `traceroute`
   rather than guess.
   The companion [Network Command Practice](./commands-practice.md)
   gives you exercises with real output to follow along, turning syntax into feel.
4. **Hold the boundary**: read [Firewall](./firewall.md),
   to understand the three-family defaults for ufw, firewalld, and nftables
   and the zone/rule model,
   so you can prove or rule out "the firewall is the cause of the outage".
5. **Support the business**: read
   [Network Monitoring](./network-monitoring.md),
   [VPN](./vpn.md), and [Load Balancing](./load-balancing.md) as needed;
   these three map to "continuous observation,"
   "interconnecting across trust domains," and "horizontal scaling and high availability"
   in production.

When time is short, the layering explanation in [Network Basics](./basics.md) and the reasoning chain in [Network Troubleshooting](./troubleshooting.md) are the two places I check first; they cover most everyday "cannot get online" cases.

In real work, these pages are usually consulted by scenario: look at the model and configuration when a machine comes online, look at the reasoning chain during on-call troubleshooting, check the firewall when opening up to the public internet, and look at monitoring, VPN, or load balancing after traffic grows. Recording conclusions in the environment's own checklist saves more effort than paging back and forth.

## Reading the Subpages

| Section | One-line guide | For whom |
|------|-----------|--------|
| [Network Basics](./basics.md) | Why layering is needed, the IP/subnet/route/DNS stack, and the `ip` and `ss` observation path | Everyone's first stop |
| [Network Configuration Basics](./network-configuration.md) | The three-family comparison of Netplan / networkd / nmcli / ifcfg, the DNS resolution path, routing and VLAN | People who have to assign addresses to machines |
| [Network Troubleshooting](./troubleshooting.md) | Reasoning by "local -> gateway -> DNS -> remote," reading real `tcpdump`/`traceroute` output | On-call and firefighting people |
| [Firewall](./firewall.md) | The three-family defaults for ufw/firewalld/nftables, the zone and rule model, connectivity-view troubleshooting | People who suspect "the wall is blocking me" |
| [Network Monitoring](./network-monitoring.md) | SNMP scenarios, Prometheus + node_exporter, continuous observation of bandwidth and latency | People who have to watch the network long term |
| [VPN](./vpn.md) | WireGuard/OpenVPN hands-on, IPsec concepts, how a tunnel cooperates with routing | Remote workers and site-to-site operators |
| [Load Balancing](./load-balancing.md) | L4/L7 differences, Nginx vs HAProxy selection, health checks and Keepalived | People who have to absorb the traffic |
| [TCP/IP Essentials](./tcpip-essentials.md) | The three-way handshake and four-way teardown state machines, packets and windows, causes of retransmits and latency | People who want to read captures and slow requests |
| [Network Command Practice](./commands-practice.md) | Combined drills with ip/ss/ping/traceroute/dig/tcpdump, reading real output | People who want commands to become feel |

Each page can be read independently,
but the configuration pages depend on the basics page's concepts,
and the troubleshooting page depends on the command foundations of the first two;
consult these pages as needed.

The cross-references between subpages are bidirectional:
the troubleshooting page points to the firewall page to explain "who dropped the packet,"
the monitoring page points to the troubleshooting page to pick up "what to check after the alert,"
and the VPN and load-balancing pages reuse the configuration page's routing knowledge.
Reading with "where did the previous page's conclusion come from" in mind
is far more durable than memorizing each page's commands in isolation.

> Content adapted from the Arch Wiki, Bird's Private Recipes (Lin's Linux Administration Guide), and the official documentation of each tool; see the references in each section.

## What This Page Covers

- The OSI/TCP-IP layering model
- The applicable scenarios of the four configuration styles: Netplan, systemd-networkd, nmcli, and ifcfg
- Being able to troubleshoot by the "local machine -> gateway -> DNS -> remote" reasoning chain
- The three-family defaults for ufw, firewalld, and nftables, and the zone/rule model
- The division of labor among Prometheus + node_exporter network monitoring, WireGuard/OpenVPN tunnels, and L4/L7 load balancing
- Avoiding default-impression traps like "`ufw` installed means it is on," and judging a machine's protection and connectivity from actual query results

## Three-Family Network Tool Quick Reference

The same tool does not share the same package name or default state across the three distro families.
The comparison table below is the "installation base" reused throughout this chapter;
later pages will not repeat the package-name differences when they mention a tool:

| Task | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Link/address/route (`ip`) | `iproute2` (preinstalled) | `pacman -S iproute2` | `dnf install iproute` (preinstalled) |
| Socket statistics (`ss`) | provided with `iproute2` | provided with `iproute2` | provided with `iproute` |
| Packet capture `tcpdump` | `apt install tcpdump` | `pacman -S tcpdump` | `dnf install tcpdump` |
| Path tracing `traceroute` | `apt install traceroute` | `pacman -S traceroute` | `dnf install traceroute` |
| Continuous tracing `mtr` | `apt install mtr-tty` | `pacman -S mtr` | `dnf install mtr` |
| Port scanning `nmap` | `apt install nmap` | `pacman -S nmap` | `dnf install nmap` |
| Bandwidth testing `iperf3` | `apt install iperf3` | `pacman -S iperf3` | `dnf install iperf3` |
| DNS query `dig` | `apt install dnsutils` | `pacman -S bind` | `dnf install bind-utils` |
| Default firewall | `ufw` (preinstalled but disabled by default) | None by default; pick `nftables`/`ufw` yourself | `firewalld` (enabled by default) |
| Default network manager | Netplan + NetworkManager/networkd | mostly systemd-networkd | NetworkManager (`nmcli`) |

Two frequent misconceptions are worth clearing up at the outset.

**"Preinstalled" does not mean "in use"**.
Ubuntu's `ufw` defaults to `inactive` after installation,
and many cloud images additionally switch it off;
Arch does not preinstall a firewall at all,
leaving a bare machine with every port exposed.
To judge a machine's protection state,
always go by the actual query result
rather than the distro's "default impression".

**Package managers have different naming habits**.
Debian family uses `apt install`,
RHEL family standardized on `dnf install` after version 8
(`yum` is the compatibility front end),
and Arch uses `pacman -S`.
This chapter writes Arch installation actions uniformly as `pacman -S`
so readers do not assume Arch also has `apt`.
When switching distros, change this line of muscle memory first
and you save yourself a lot of "command not found" frustration.

To verify the toolchain is ready,
you can do a quick checkup with one command:

```bash
for t in ip ss ping traceroute dig tcpdump; do
  command -v "$t" >/dev/null && echo "OK   $t" || echo "MISS $t"
done
```

Fill in whatever is missing per the table above.
`ip` and `ss` come from the same package
and usually succeed or fail together --
if `ss` is missing but `ip` is present,
suspect PATH or an alias first, not a broken package.

## Reading Conventions

- **Real output first**: sample output comes from a typical LAN environment
  (`192.168.1.0/24`, gateway `192.168.1.1`);
  addresses on your machine will differ, which is normal --
  focus on the field structure and what each state means.
- **Commands are copyable**: all commands assume a modern systemd distro;
  when legacy tools (`netstat`, `ifconfig`) are involved
  the text notes their `net-tools`/`wireless-tools` package
  and why they were superseded by `ss`/`ip`.
- **Do not write what is uncertain**: version differences I am not sure about
  and deprecated options are omitted entirely,
  or explicitly marked "verify against your version".
- **Why before how**: the concept paragraphs at the start of each section
  are as important as the later commands;
  skipping the concepts and copying commands directly
  leaves you without judgment when something goes wrong.

"Experience posts" in the networking world go stale very fast:
tuning parameters that were popular a decade ago may be harmful today,
and a command may already have been removed from a newer kernel.
This chapter keeps only principles and mainstream tools that survive version changes,
and marks every place that depends on a specific version's behavior.
When in doubt, go back to the corresponding manual page (`man ip`, `man nft`)
-- it is always more reliable than search results.

## References

- Bird's Private Recipes (Lin's Linux Administration Guide) - Network basics -- [linux.vbird.org](https://linux.vbird.org/linux_server/centos6/0110network_basic.php)
- Arch Wiki - Networking -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Networking)
- Arch Wiki - systemd-networkd -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd-networkd)
- RHEL 9 Configuring and managing networking -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_and_managing_networking/index)
- Netplan official documentation -- [netplan.readthedocs.io](https://netplan.readthedocs.io/)
- iproute2 manual pages (`man ip`, `man ss`, `man tc`)
- systemd.network(5), systemd-resolved.service(8)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [services](/basic/services.md)
- [README](/hardware/README.md)
- [network](/hardware/network.md)
- [README](/system-management/README.md)
