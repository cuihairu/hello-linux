# System Services

## Chapter Introduction

Once you have finished installing the system, the programs running in the background are what make the machine do real work: sshd provides remote login, nginx serves web pages to the outside world, and cron runs scripts on schedule. The programs the system brings up and watches over centrally are **system services**. Whether a service comes back after a reboot, whether a failure can be pinpointed from the logs, and whether a fresh machine can be configured correctly map onto three areas respectively: service enabling, log querying, and configuration tools. This chapter records those three categories of daily work, along with the service-management approaches that dominate the systemd era.

In Linux ops I reach for `systemctl` to manage services, `journalctl` to query logs, and Netplan/nmcli to configure networking, over and over. This chapter sorts out the differences between systemd and SysV init, the structure of a unit file, the difference between `enable` and `start`, the division of labor between journald and rsyslog, and how the three distribution families differ on networking, time, and hostname configuration.

> Content adapted from the Arch Wiki, Bird's Private Recipes (Lin's Linux Administration Guide), and the official documentation of each distribution; see the references at the end.

## The Practical Problems in Service Management

The first lesson that burns most people on Linux is not typing a command wrong, but confusing "is the service running right now" with "will it still run after a reboot." You run `systemctl start nginx` on the machine and the web page becomes reachable at once; then the machine reboots at night, nginx never comes up, and the alerts scream -- the service definitely started, but you never told it to **autostart at boot**. The root cause of this class of problem is that service management has two dimensions, "current state" and "persisted intent." In the SysV init era those were two completely disconnected mechanisms (`service` for the present, `chkconfig` for boot); systemd has unified them under `systemctl`, but `start` and `enable` are still two independent actions.

Another motivation is dependencies. A web service depends on the network being ready, a database depends on disks being mounted; if you still rely on the first few comment lines of a SysV script to agree on order, parallel boot is out of the question. systemd hands ordering to the framework via declarative dependencies in unit files; ops just need to read the declarations.

Logs and configuration are the other two sides of the same coin: when a service misbehaves you need to be able to find clues in journald or `/var/log` immediately, and when a machine is initialized the three distribution families configure networking, time, and hostname in different ways, so picking the wrong tool leads to a lot of detours. The other two sections of this chapter address those two problems.

> Content adapted from the systemd manual and the Arch Wiki; see the references at the end of each section.

## What This Chapter Covers

- Why systemd replaced SysV init, and how to read the structure of a unit file and its dependency declarations
- Becoming fluent with `systemctl`
- Common `journalctl` patterns for querying service logs
- Differences between Debian/Ubuntu, Arch, and RHEL/CentOS/Rocky on the default firewall, network configuration, and service sourcing
- Building the habit of "text configuration first"

## Sub-Page Guide

| Chapter | What it answers | Suggested reading time |
|---------|-----------------|------------------------|
| [System Service Management](./services/system_services.md) | Why systemd replaced SysV; `systemctl` operations; the difference between enable and start; unit dependencies and timers | The first time you study systemd systematically, or when you are stuck on "the service will not start / disappears after reboot" |
| [Log Management](./services/log_management.md) | Where service logs live, how to query them with `journalctl`, how journald and rsyslog divide the work, and why persistence matters | When a service misbehaves and you do not know where to look for logs |
| [System Configuration Tools](./services/configuration_tools.md) | The text-configuration philosophy vs GUI; three-family network configuration (Netplan / systemd-networkd / nmcli) side by side; time and hostname | The first basic configuration after the system is installed |

The division of labor among the three pages can be remembered this way: **first get the service running with System Service Management, go to Log Management to hunt logs when something breaks, and consult System Configuration Tools for install-time initialization.** Protocol details and rotation policy for logs are covered separately in the [Logging System](./log.md) chapter; the firewall and security context are covered in the [Networking chapter](../network/README.md) and [Security Basics](./security.md) respectively.

## Three-Family Differences at a Glance

All three distributions use systemd as the init system, and the `systemctl` command itself is identical; the differences are concentrated in the out-of-the-box defaults:

| Item | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|--------------------|
| Init system | systemd | systemd | systemd |
| Default firewall | Ubuntu enables ufw by default; Debian servers usually do not enable a firewall out of the box | No default firewall; the user chooses nftables/ufw and so on | firewalld is enabled and running by default |
| SSH service unit | `ssh.service` (with the `sshd` alias) | `sshd.service` | `sshd.service` |
| Default network component | Netplan (rendered to systemd-networkd or NetworkManager as the backend) | NetworkManager is common on desktops, systemd-networkd is common on servers | NetworkManager |
| Mandatory access control | AppArmor is enabled by default | Neither SELinux nor AppArmor is enabled by default | SELinux is Enforcing by default |
| Service sourcing | Installed with `apt`; the package ships its own unit file | Installed with `pacman`; the package ships its own unit file | Installed with `dnf`; the package ships its own unit file |

Note the common thread in the last row: regardless of the distribution, **after you install a service with the package manager the unit file is deployed along with the package, but "deployed" does not mean "enabled"** -- on Arch, installing nginx with `pacman` will not make it autostart at boot, you still need a manual `systemctl enable --now nginx`. This point is identical across all three families; see [System Service Management](./services/system_services.md).

## Common Questions

**Q: The service is running after `systemctl start`, so why does it vanish on reboot?**
`start` only changes the "current" state and does not create an autostart symlink. You need `systemctl enable`, or the one-step `systemctl enable --now`. This is the single most frequent pitfall in this chapter.

**Q: I edited the unit file, but `systemctl status` still shows the old configuration?**
After a unit file is edited you must run `systemctl daemon-reload` to re-read it; a process that is already running also needs `systemctl restart` before it picks up the new configuration. `daemon-reload` only refreshes systemd's view; it does not restart the service.

**Q: Why are the firewall commands so different across the three families?**
Because the default stacks differ: Ubuntu/Debian commonly use ufw (the front end), Arch ships no firewall by default, and the RHEL family uses firewalld. Firewall rules themselves belong to the networking and security chapters; this chapter only notes the default differences. For concrete configuration see [Networking chapter, Firewall](../network/firewall.md) and the [Security chapter](../security/README.md).

**Q: timer or cron, which should I use?**
Prefer systemd timers for system-level scheduled tasks -- they can inherit service dependencies and send logs straight to the journal. For a user's own ad hoc tasks, crontab is still perfectly fine. The two coexist; there is no need to force a migration.

**Q: For logs, should I look at `/var/log` or `journalctl`?**
On modern systemd distributions the two usually coexist: journald collects structured logs (including kernel messages and services' standard output), while rsyslog is responsible for writing them out as text files under `/var/log`. To diagnose a service problem, start with `journalctl -u <unit>`; turn to the files when you need to grep old logs or when a third-party tool has to read them. See [Log Management](./services/log_management.md) for details.

## References

- Arch Wiki - systemd -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd)
- Arch Wiki - systemd timers -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd/Timers)
- Bird's Private Recipes (Lin's Linux Administration Guide) - Getting to know system services (daemons) -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0560daemons.php)
- Bird's Training Materials - Service management and boot flow management -- [linux.vbird.org](https://linux.vbird.org/linux_basic_train/centos8/unit13.php)
- `man systemctl`, `man systemd.unit`
- Red Hat documentation - Configuring basic system settings (including systemd service management) -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_basic_system_settings/index)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)
- [log](log.md)
- [intrusion-detection](/security/intrusion-detection.md)
