# Network Management

For a server,
the network is the lifeline:
SSH will not connect,
DNS resolution fails,
the port is not listening,
the firewall is blocking traffic --
these account for well over half of day-to-day troubleshooting.
Network problems feel scary
because they look like "black magic":
the configuration is clearly correct,
yet it just will not connect.
In reality,
network troubleshooting has a very fixed reasoning chain --
**is the local configuration right -> can the local machine get out -> is the path in between open -> is the target service alive** --
and every link has its corresponding command.
The task of the network management chapter
is to nail down every node on this chain and its matching command,
so that the next time you hit "cannot connect",
you can run four commands in order
instead of rebooting the NIC at random.

> This chapter's core commands `ip`,
> `ss`,
> `ping`,
> `curl`,
> `ssh`,
> and `rsync` work the same across the three families **Debian/Ubuntu,
> Arch,
> and RHEL/CentOS/Rocky**;
> the differences concentrate in **where the configuration file lives,
> which tool edits the network,
> and which firewall is default**,
> and each is flagged in place in the text.

## Why Network Commands Must Be Learned as a System

Anyone can type a single command; the hard part is **knowing which one to type and how to interpret the result**. Three real scenarios show why:

1. **"The website will not open" has at least five possible causes**:
   the local machine has no IP,
   the gateway is unreachable,
   DNS resolution failed,
   the target port is blocked by a firewall,
   or the target service is not running.
   The corresponding checks are `ip addr`,
   `ping gateway`,
   `ping/curl domain`,
   `ss -tlnp`/`firewall-cmd --list-all`,
   and `systemctl status service`.
   Without a systematized command map,
   you can only reboot and hope.
2. **Modern Linux has retired `ifconfig`/`netstat`**.
   Plenty of old material still teaches `ifconfig eth0 192.168.1.10`,
   but both commands come from the net-tools package,
   which is not even installed by default on Arch.
   The new standard is `ip` (iproute2) and `ss`,
   preinstalled on all three families.
   Learn the new ones;
   do not re-enact decade-old operations on a new system.
3. **Remote management is the default way Linux works**.
   `ssh` is not just "log into another machine" --
   it also carries port forwarding,
   passwordless login,
   jump hosts,
   and `scp`/`rsync` file synchronization.
   Not being fluent here
   jams every bit of automation and multi-host collaboration.

One sentence for this chapter's philosophy: **split a network problem into layers first; once layered, each layer has exactly one corresponding command**.

> Example output comes from a real Ubuntu 26.04 environment; see the references at the end.

## What This Page Covers

- **Configure and inspect**:
  use `ip link`/`ip addr`/`ip route` to view and configure NICs,
  IPs,
  and routes,
  know that `ifconfig` is deprecated,
  and know each family's persistence entry point (Netplan,
  `.nmconnection`/NetworkManager,
  ifcfg scripts).
- **Connection diagnosis**:
  use `ss -tlnp` to check listening ports,
  `ping`/`traceroute` to test reachability and path,
  `dig`/`nslookup`/`host` to query DNS,
  and `mtr` for a "ping + traceroute" combined diagnosis.
- **Application-layer testing**:
  use `curl` (including `-I`,
  `-v`,
  `-o`,
  `-w`) and `wget` to test HTTP endpoints,
  download files,
  and capture status codes and timing,
  telling apart "network fine but the service returns 5xx" from "cannot connect at all".
- **Remote and transfer**:
  fluent with `ssh` (key login,
  `~/.ssh/config` shorthand,
  port forwarding `-L`/`-R`),
  `scp`/`sftp`,
  `rsync` incremental sync,
  plus handling permission and host key errors.
- **Firewall awareness**:
  know the three families default to different firewalls (`ufw`/your own nftables/`firewalld`),
  and during troubleshooting confirm first whether the port is blocked by local rules.
- **Troubleshooting framework**: walk the five-step "ip -> gateway -> DNS -> port -> application" chain independently, and say what each step's failure means.

## Reading the Subpages

| Subpage | One-line guide |
|------|------------|
| [Network Management Commands](./network/network.md) | The skeleton of configuration and connectivity: the `ip` family (addr/link/route), `ss` port listening, `ping`/`traceroute`/`mtr` path diagnosis, `dig`/`nslookup` DNS queries, and the three-family configuration entry points NetworkManager/Netplan/ifcfg. |
| [Network Tools](./network/network-tools.md) | Data transfer and remote operations: `curl`/`wget` HTTP requests and downloads, `ssh` passwordless and port forwarding, `scp`/`sftp`/`rsync` file synchronization, `nc`/`tcpdump` packet capture and port probing, `nmap` scanning and `iptables`/`nftables` basics. |

Recommended order: first read [Network Management Commands](./network/network.md) to pin down "the local machine's network state", then read [Network Tools](./network/network-tools.md) to handle "cross-machine communication". Self-check after reading: when a colleague says "your service is unreachable", you can immediately run in order `ip addr`, `ping -c 2 gateway`, `curl -v http://service`, `ss -tlnp | grep port` -- and this chapter counts as passed.

## Three-Family Differences at a Glance

| Scenario | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Check/configure IP | `ip` (preinstalled) | `ip` (preinstalled) | `ip` (preinstalled) |
| Check ports | `ss` (preinstalled) | `ss` (preinstalled) | `ss` (preinstalled) |
| Legacy `ifconfig`/`netstat` | `sudo apt install net-tools`/`netstat-tools` needed | `sudo pacman -S net-tools` needed (partially removed from repos) | `sudo dnf install net-tools`/`net-tools` needed |
| Persistent network config | Netplan (`/etc/netplan/*.yaml`, `netplan apply`) | usually systemd-networkd (`/etc/systemd/network/*.network`) or NetworkManager | ifcfg scripts (`/etc/sysconfig/network-scripts/`, keyfiles since RHEL 9) or NetworkManager |
| Firewall | `ufw` (`sudo ufw allow 22/tcp`) | your own choice of `nftables`/`iptables`, no default front end | `firewalld` (`sudo firewall-cmd --add-port=22/tcp --permanent`) |
| Restart networking | `sudo netplan apply` | `sudo systemctl restart systemd-networkd` | `sudo nmcli connection up network-name` or restart NetworkManager |
| Install `curl`/`wget` | `curl` usually preinstalled, `wget` needs installing | `sudo pacman -S curl wget` | `sudo dnf install curl wget` (wget may not be preinstalled) |
| Install `nmap`/`tcpdump` | `sudo apt install nmap tcpdump` | `sudo pacman -S nmap tcpdump` | `sudo dnf install nmap tcpdump` |

The easiest difference to trip over is **where to edit network configuration**:
Ubuntu uses Netplan YAML,
RHEL uses ifcfg or keyfile,
and Arch often writes systemd-networkd unit files directly.
A config file copied from system A to system B not only does not take effect,
it can cut the machine off entirely --
before changing the network remotely,
always confirm the distro and the config format,
and keep a rollback path (console/out-of-band management).

## Common Pitfalls

1. **Editing the wrong network config and kicking yourself offline**.
   Before remotely running `netplan apply` or restarting NetworkManager,
   first use `netplan try` (Ubuntu gives you a 120-second rollback countdown) or make sure you have console access.
   When an SSH session drops and the config has not taken effect,
   do not keep retrying the connection;
   get in through the physical/cloud console first.
2. **Firewall not opened,
   yet thinking "the service is not running"**.
   `ss -tlnp` shows the port listening
   but the outside still cannot connect --
   the next step is the firewall:
   Ubuntu `sudo ufw status`,
   RHEL `sudo firewall-cmd --list-all`,
   Arch `nft list ruleset`.
   `curl 127.0.0.1` works locally
   but the external IP does not --
   almost always the firewall or the security group.
3. **Treating DNS working as network working,
   or network working as DNS working**.
   `ping domain` failing may be only a DNS problem,
   while `ping IP` succeeding proves the link is fine.
   The diagnosis order is fixed:
   first `ping 8.8.8.8` (test the link),
   then `ping domain` (test resolution) --
   look at the two separately.
4. **Running `curl` without `-I`/`-v`,
   so the status code is invisible**.
   `curl http://service` prints only the body;
   a 502/404 hides in the HTML and is hard to spot;
   add `curl -s -o /dev/null -w '%{http_code}\n' URL` to get just the status code,
   or `curl -v` to watch the whole handshake.
5. **`ssh` reporting `Host key verification failed` or `Permission denied (publickey)`** -- the first is a stale fingerprint recorded in known_hosts (common after a server reinstall),
   the second is a key/permission problem --
   check that `~/.ssh` is `700`,
   `~/.ssh/authorized_keys` is `600`,
   and `sshd_config` has `PubkeyAuthentication yes`.
6. **`rsync` swapping local and remote paths,
   or forgetting the trailing `/` on the target directory**.
   `rsync -av dir/ user@host:/path/` and `rsync -av dir user@host:/path/` produce different results (with the trailing slash it copies "the contents",
   without it copies "the directory itself").
   Dry-run first with `rsync -avn`.
7. **Using `ping -c` in a script and forgetting the exit code**.
   On Linux `ping` exits 0 (reachable)/non-0 (unreachable),
   so it can go straight into `if ping -c1 target; then ...; fi` --
   do not parse the output text.
8. **Forgetting the cloud host's security group/ACL**.
   Local `firewalld` is wide open
   but the cloud platform security group does not allow 443,
   so the outside still cannot get through.
   When troubleshooting, walk all three layers: "local firewall -> cloud security group -> remote firewall".

## Common Questions

**Q: `ping` works but `curl` does not -- where is the problem?**

`ping` uses ICMP and only proves "the network layer is reachable";
`curl` uses TCP at the application layer and must pass **three more gates: port, listen address, and firewall/security group**.
Troubleshoot by layer:
`ss -tlnp | grep port` to see whether the service is listening and whether it binds `0.0.0.0` or only `127.0.0.1`;
`curl -v` to see whether it cannot connect at all (timeout/TCP layer) or connects but returns 5xx/4xx (application layer);
if `ss` shows a listener locally but the outside still cannot connect, go check the security group and `iptables -L -n`.
Split "reachable" into three levels -- ICMP reachable, TCP handshake succeeds, HTTP returns correctly --
and 90% of "black-magic network problems" become immediately locatable.

**Q: Both `ip` and `ifconfig` show addresses -- which one should I use?**

Use **`ip`** (from `iproute2`, preinstalled on all three families).
`ifconfig` belongs to the no-longer-maintained `net-tools`,
and on multi-NIC aliases, IPv6, and policy routing it is incomplete or even misleading.
The rough mapping:
`ifconfig` -> `ip addr`,
`route -n` -> `ip route`,
`arp -n` -> `ip neigh`.
Standardize on `ip` in scripts and documentation
to avoid a script dying at step one because the new system has no `net-tools` at all.

**Q: `ssh` asks for a password every time -- can it be passwordless?**

Yes, with **public key login**:
run `ssh-keygen -t ed25519` locally to generate a key pair,
then `ssh-copy-id user@host` (or manually append `~/.ssh/id_ed25519.pub` to the target machine's `~/.ssh/authorized_keys`),
and note the permissions must be `chmod 700 ~/.ssh`, `chmod 600 ~/.ssh/authorized_keys`,
otherwise sshd refuses outright for "permissions too open".
For jump-host scenarios, chain them with `ProxyJump` in `~/.ssh/config`,
which is easier to remember than typing `ssh -J` by hand.
**Do not** strip the passphrase off your private key and copy it everywhere to save effort --
losing the private key means losing the door to every machine.

**Q: `firewall-cmd`, `nft`, `ufw`, security groups -- which one do I actually change?**

The three families default differently, but the troubleshooting order is fixed:
first look at the **cloud platform security group** (the outermost layer; no local opening will help) ->
then look at the **system firewall**:
Debian/Ubuntu defaults to `ufw` (if enabled),
RHEL/CentOS/Rocky defaults to `firewalld` (`firewall-cmd --list-ports`),
Arch commonly uses `nftables`/`iptables` (`nft list ruleset`) ->
and only then suspect the application's own listen address.
For a quick test you can `systemctl stop firewalld` (or `ufw disable`) first --
if it connects, the firewall rules are the problem, so add the rules back;
**be sure to restore it after the test** -- do not submit "turn off the firewall" to production as the solution.

## References

- `man ip`, `man ss`, `man ping`, `man curl`, `man ssh`, `man rsync`, `man dig`
- Bird's Private Recipes (Lin's Linux Administration Guide) - network basics and commands -- [linux.vbird.org](https://linux.vbird.org/linux_server/centos6/0110network_basic.php)
- Arch Wiki - Networking -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Networking)
- Arch Wiki - iproute2 -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Iproute2)
- Arch Wiki - SSH -- [wiki.archlinux.org](https://wiki.archlinux.org/title/SSH)
- Arch Wiki - nftables -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Nftables)
- iproute2 manual (ss/ip) -- [man7.org](https://man7.org/linux/man-pages/man8/ip.8.html)
- curl manual -- [curl.se](https://curl.se/docs/manpage.html)
- Red Hat documentation - Configuring and managing networking -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_and_managing_networking/index)
- Ubuntu - Netplan documentation -- [netplan.io](https://netplan.io/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)
