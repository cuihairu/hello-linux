# System Configuration Tools

Linux provides many tools for managing system configuration. The vast majority of system-level configuration ultimately lands in plain text files, and a GUI is only a front end that generates those texts -- understanding that lets you configure anything calmly on a server with no display.

> Content adapted from the Arch Wiki and each tool's official documentation; see the references at the end.

## What This Page Covers

- Understanding the "text configuration first" philosophy
- Comparing the three distributions' network configuration approaches (Netplan / systemd-networkd / nmcli)
- Using `timedatectl`, `hostnamectl`, and `resolvectl` to configure time, hostname, and DNS
- Knowing how to verify a configuration took effect after changing it, avoiding "changed it but never reloaded"
- Being able to finish basic system configuration independently on a headless server

## 1. The Philosophy of Text Configuration: Why Not a GUI

The habit formed in the Windows era is "to change a setting, open the control panel," while Linux insists on **all configuration as text**. This is not an aesthetic preference but a necessary choice of operations engineering:

- **Auditable**: `diff old.conf new.conf` shows at a glance what changed; there is no way to trace which boxes a GUI clicked.
- **Reproducible**: copy the same YAML/INI to a hundred machines and the configuration is identical; the state a GUI clicks into varies from person to person.
- **Remote-friendly**: a change done in five minutes with `vim` over SSH is realistic; requiring a desktop environment first is not.
- **Version-controllable**: put config files in Git and you get change history, rollback, and code review for free.

A GUI is not worthless: when exploring a feature for the first time, a graphical interface quickly shows "what options exist"; and semi-interactive tools like `nmtui` and `netplan try` are often used to avoid breaking a remote network. The correct posture is: **explore with a GUI or interactive tool, and solidify with a text file**. All three network approaches covered here (Netplan, systemd-networkd, nmcli) use text as the final source of truth.

## 2. Three-Family Network Configuration Compared

Network is the first thing you must configure after installing, and the place where the three families differ most. The conclusion first:

| Solution | Main distributions | Configuration location | How to apply | Use cases |
|----------|--------------------|------------------------|--------------|-----------|
| Netplan | Debian/Ubuntu | `/etc/netplan/*.yaml` | `sudo netplan apply` | Declarative YAML; the backend can be networkd or NetworkManager |
| systemd-networkd | Arch (server); can be used as a Netplan backend | `/etc/systemd/network/*.network` | `systemctl restart systemd-networkd` | Pure systemd stack, no extra dependencies |
| NetworkManager (nmcli) | RHEL/CentOS/Rocky; Arch (desktop); Ubuntu desktop | `/etc/NetworkManager/system-connections/` | `nmcli connection up ...` | Desktop roaming, Wi-Fi, VPN; also suitable for servers |

The three do not overlap much, but **one network interface can only be taken over by one manager**; running two DHCP clients at once makes them overwrite each other's routes and DNS. That is the number one pitfall of network configuration.

### 2.1 Netplan (Debian/Ubuntu)

Netplan does not manage network interfaces itself; after reading YAML it **renders** native configuration for systemd-networkd or NetworkManager:

```yaml
# /etc/netplan/01-netcfg.yaml
network:
  version: 2
  renderer: networkd        # common on servers; on desktops you can switch to NetworkManager
  ethernets:
    enp3s0:
      dhcp4: true
    enp3s0-1:
      addresses: [192.168.10.5/24]
      routes:
        - to: default
          via: 192.168.10.1
      nameservers:
        addresses: [223.5.5.5, 114.114.114.114]
```

```bash
$ sudo netplan generate      # only generate the backend config, no effect
$ sudo netplan try           # apply, with automatic rollback after 120s with no confirmation -- must use for remote sessions
$ sudo netplan apply         # apply immediately (a misconfiguration can cut your network, so try first)
$ sudo netplan status        # show the applied state (Ubuntu 22.04+)
```

**Pitfall**: YAML is indentation-sensitive, start with two spaces, and tabs are forbidden; when changing the network over a remote session always use `netplan try` rather than `apply`, to leave yourself 120 seconds of regret medicine.

### 2.2 systemd-networkd (Arch server / Netplan backend)

The configuration files are unit-like INI, loaded in lexical filename order, with `/etc` overriding `/usr/lib`:

```ini
# /etc/systemd/network/20-wired.network
[Match]
Name=enp3s0

[Network]
DHCP=yes
# Static address example: Address=192.168.10.5/24, Gateway=192.168.10.1, DNS=223.5.5.5
```

```bash
$ sudo systemctl enable --now systemd-networkd
$ networkctl status enp3s0     # show link and address state; networkctl lists all interfaces
```

The minimal system installed from the official Arch installation media often still has no network manager configured; either `pacman -S networkmanager` or simply enabling `systemd-networkd` -- pick one -- and after installing you still need `systemctl enable --now`.

### 2.3 nmcli (the RHEL/CentOS/Rocky default)

The RHEL family is managed by NetworkManager by default, `nmcli` is its command-line front end, and it is the only tool across the three families that can fully manage Wi-Fi/VPN/mobile broadband:

```bash
$ nmcli device status
DEVICE  TYPE      STATE      CONNECTION
enp3s0  ethernet  connected  System eth0
lo      loopback  unmanaged  --
$ sudo nmcli connection modify "System eth0" ipv4.method auto    # switch to DHCP
$ sudo nmcli connection down "System eth0" && sudo nmcli connection up "System eth0"   # down/up after changing the IP
$ nmcli connection edit "System eth0"    # interactive editor (another option besides nmtui)
```

The text source of truth is `/etc/NetworkManager/system-connections/` (keyfile format, permissions 600), but **do not edit it directly and then restart the service**; modify with `nmcli` and then `nmcli connection reload`, which is less likely to write out an invalid file. For an ad hoc command-line interface use `nmtui`.

RHEL 8 and earlier commonly use the old `/etc/sysconfig/network-scripts/ifcfg-*` format, while RHEL 9 and later default to keyfile on new installs; either way, `nmcli` is the unified entry point, and scripts should prefer `nmcli` over sed-ing the config files.

## 3. Time Configuration (timedatectl)

All three systems use systemd's `timedatectl`; timezone and NTP are handled in one command. Wrong time causes TLS certificate verification failures, scrambled log timestamps, and scheduled tasks drifting -- a must-check on every install:

```bash
$ timedatectl
               Local time: Tue 2026-09-22 10:30:41 CST
           Universal time: Tue 2026-09-22 02:30:41 UTC
                Time zone: Asia/Shanghai (CST, +0800)
System clock synchronized: yes
              NTP service: active
$ sudo timedatectl set-timezone Asia/Shanghai
$ sudo timedatectl set-ntp true      # turn on NTP synchronization
$ timedatectl list-timezones | grep Shanghai   # list available timezones
```

The NTP daemon actually running on the RHEL family is usually `chronyd`; Debian/Ubuntu uses `systemd-timesyncd` or `ntp`/`chrony`; Arch defaults to `systemd-timesyncd` -- but the upper-level entry point is always `timedatectl set-ntp`, so you do not need to care who is underneath. To view synchronization details, use `chronyc tracking` in a chrony environment, and the generic entry point is `timedatectl timesync-status`.

## 4. Hostname (hostnamectl)

```bash
$ hostnamectl
 Static hostname: web01.example.com
Operating System: Debian GNU/Linux 12 (bookworm)
$ sudo hostnamectl set-hostname web01.example.com
```

`set-hostname` writes both `/etc/hostname` and the relevant entries in `/etc/hosts` (the implementation varies slightly by distribution). Newly opened shells and services only see the new name after the change; already running processes are unaffected. The command is identical across the three families.

## 5. DNS Resolution (resolvectl)

Once systemd-resolved takes over DNS, `/etc/resolv.conf` is often a symlink to `/run/systemd/resolve/`, and editing it directly will be overwritten at the next network change -- that is the standard cause of "I changed DNS but it did not take effect":

```bash
$ resolvectl status / query example.com / flush-caches   # status, test resolution, clear cache
```

To make DNS persistent, configure it in Netplan's `nameservers`, `.network`'s `DNS=`, or nmcli's `ipv4.dns`, rather than hand-editing `resolv.conf`. On systems without systemd-resolved enabled (some Debian/Ubuntu versions still manage resolv.conf directly), editing `/etc/resolv.conf` is fine -- first use `ls -l /etc/resolv.conf` to tell whether it is a file or a symlink.

## 6. Common Pitfalls

1. **Two network managers fighting**: enabling both NetworkManager and systemd-networkd makes DHCP overwrite each other. Check with `systemctl --type=service | grep -E 'NetworkManager|networkd'`, and keep only one at a time.
2. **Changing the network remotely with `apply` cuts your connection**: for Netplan use `netplan try`; for nmcli first `connection clone` a rollback-safe copy; for systemd-networkd confirm the config file syntax before restarting.
3. **Changed the config file but it did not take effect**: Netplan needs `apply`; networkd needs `restart systemd-networkd`; for nmcli, after modifying a connection you need `down`+`up` on that connection. Changing a file does not mean it took effect.
4. **YAML indentation or quoting errors**: Netplan uses spaces for indentation, and addresses are safer written with quotes as `"192.168.10.5/24"` (some parsers are sensitive to bare values); run `netplan generate` first after editing to validate.
5. **Manually editing an NM connection file corrupts it**: `/etc/NetworkManager/system-connections/` must have permissions 600, and an invalid format makes NetworkManager refuse to load it. Prefer `nmcli`, and `nmcli connection reload` after changing.
6. **Timezone right but time wrong**: `set-timezone` only changes the timezone; if the clock is not synchronized you need `set-ntp true` and to confirm `System clock synchronized: yes`, otherwise certificates and logs will still be wrong.
7. **Firewall and SELinux are out of scope for this section**: the three families' default firewall differences are in [System Service Management](./system_services.md), rule configuration is in the [Networking chapter, Firewall](../../network/firewall.md), and SELinux/AppArmor are in [Security Basics](../security.md).

## References

- Arch Wiki - Network configuration -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Network_configuration)
- Arch Wiki - systemd-networkd -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd-networkd)
- Arch Wiki - NetworkManager -- [wiki.archlinux.org](https://wiki.archlinux.org/title/NetworkManager)
- Netplan official documentation -- [netplan.io](https://netplan.io/)
- `man timedatectl`, `man hostnamectl`, `man nmcli`, `man networkctl`
- timedatectl man page -- [man7.org](https://man7.org/linux/man-pages/man1/timedatectl.1.html)
- hostnamectl man page -- [man7.org](https://man7.org/linux/man-pages/man1/hostnamectl.1.html)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/basic/README.md)
- [services](/basic/services.md)
- [configuration-management](/commands/system/configuration-management.md)
- [coverage-matrix](/research/coverage-matrix.md)
