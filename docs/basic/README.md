# Fundamentals

The fundamentals section records the classes of problems I kept running into on Linux: treating a kernel version as a distro version, treating `apt` as a standard Linux command, and losing the network after a reboot. When you troubleshoot these, knowing the anatomy of a distro, the filesystem, the boot process, and where the logs live pays off far more than memorizing a few more commands. These notes are organized as concepts, installation, filesystem, boot, services, and logs; the commands section and the servers section collect command details and service practice respectively.

> These notes primarily compare the **Debian/Ubuntu, Arch, and RHEL/CentOS/Rocky** distro families; where a concrete operation or behavior differs, the owning family is called out.

## Where These Notes Start

I have seen one common path: install the system, memorize commands, hit an error, search the web, copy someone else's distro-specific command, and get a worse error. The root cause is skipping the three problems this section exists to solve:

1. **Concepts**: does "Linux" mean the kernel or the whole system? What does "everything is a file" actually mean? Without these, you read `/proc` and `/dev` as if they were ordinary directories, and when a `sudo` permission problem appears, all you can do is retry.
2. **Selection**: Debian's stability, Arch's rolling release, and Rocky's enterprise compatibility are three completely different operating rhythms. Chasing the wrong goal on the wrong distro (chasing the newest software on RHEL, or chasing five years without a reboot on Arch) means pain from then on.
3. **Structure**: filesystem hierarchy, boot process, services and logs -- strung together, these are a machine's "life cycle". Troubleshooting skill is essentially the ability to walk that chain end to end.

The order used here is: concepts (overview, introduction), installation and filesystem, then boot, services, logs, and security. While troubleshooting you can jump straight to the page that matches the problem.

## Content Index

The pages below are ordered by how concepts connect to real configuration, as a lookup entry point:

| Stage | Chapters | Why it sits here |
|-------|----------|------------------|
| 1. Build concepts | Technology Overview, then Introduction to Linux | Separate kernel/distro/package manager first; talk operations second |
| 2. Land a machine | Installing Linux | With selection concepts in hand, you know the consequence of each installer option |
| 3. Learn the world on disk | Filesystem | Installation is, at its core, partitioning and writing a filesystem |
| 4. Learn the boot process | Boot Process | Understand boot and you understand why a bad `/etc/fstab` edit bricks the machine |
| 5. Make the machine useful | Software Installation, then User Management, then System Services | From "it boots" to "it works" |
| 6. Make the machine reliable | Logging, then Security Basics | Observation and defense come last |

While assembling these pages I kept a short checklist of troubleshooting questions to check coverage: which distro and kernel the machine runs, how its disk is partitioned, which stages boot passes through, which tool manages its software, and where service logs can be read. They also double as handover checks for a new machine.

> Content draws on the Arch Wiki, Bird's Private Recipes (Lin's Linux Administration Guide), and each distro's official documentation -- see the references in each chapter.

## What This Section Covers

- The relationship between kernel, GNU, distros, and package management, and the difference between a kernel version and a distro version
- The FHS directory layout, the rwx permission model, and the roles of `/etc`, `/var`, and `/usr`
- Installation methods and release models for the Debian/Ubuntu, Arch, and RHEL families
- Everyday APT, pacman, and dnf operations and the boundaries between distros
- The boot process, the systemd service model, and the `systemctl` / `journalctl` troubleshooting entry points
- Where mandatory access control such as SELinux fits, and the default differences across the three families

## Reading the Subpages

The dozen-plus chapters in this section fall into three blocks; understanding by block costs less effort than memorizing the directory tree:

### Concept Block: What This Machine Is

Corresponding chapters: Technology Overview, Introduction to Linux. These answer the identity questions -- kernel versus operating system, the GNU/Linux naming relationship, the family tree of distros. Almost nothing here requires running commands, but the block decides how fast you read documentation later. For example, when the Arch Wiki says `pacman -Syu`, you should immediately understand: `-S` is sync (install from the repository), `-yu` is upgrade plus refresh, and behind that sits the rolling-release philosophy that "the repository always has exactly one current version".

### Installation Block: How This Machine Came to Be

Corresponding chapters: Installing Linux (distro choice, preparation, the install process). Installation is where concepts become reality: the partitioning scheme maps to the filesystem chapter, the bootloader maps to the boot process chapter, and timezone and language map to later localization configuration. The three families differ enormously at install time -- Debian/Ubuntu has mature graphical installers plus Subiquity/Calamares, Arch offers the interactive `archinstall` but expects you to partition and mount by hand by default, and RHEL/Rocky pushes Kickstart automation through Anaconda. Every corner cut during installation becomes debt in the later chapters.

### System Component Block: How This Machine Runs

Corresponding chapters: Filesystem, Boot Process, Software Installation, User Management, System Services, Logging, Security Basics. This is the center of gravity of the section and covers 90% of day-to-day operations. The divergence between the three families is starkest here: for packages Debian uses `apt`, Rocky uses `dnf`, Arch uses `pacman`; for firewalls Debian/Ubuntu defaults to `ufw`, the RHEL family to `firewalld`, and Arch usually leaves you to pick `nftables` or `iptables` yourself; SELinux is enforcing by default on RHEL-family systems, not enabled by default on Debian/Ubuntu, and Arch ships no mandatory access control framework at all. Commands can be looked up, but "why is this command missing on this machine" can only be answered with concepts.

## Chapter Directory

Here is the full table of contents for this section, one line per chapter, so you can jump as needed:

- [Technology Overview](./overview.md) -- the master map of operating system principles and Linux's design philosophy (everything is a file, system calls, kernel subsystems). Skim it before reading the introduction.
- [Introduction to Linux](./introduction.md) -- answers the three-part question "what is Linux, really": kernel or system, where it came from, and how to pick a distro.
  - [What Is Linux](./introduction/what_is_linux.md) -- draws the boundaries between kernel, operating system, GNU/Linux, and distro, with terminal commands to verify each.
  - [The History of Linux](./introduction/history.md) -- from the Unix split to the GNU movement to that 1991 Usenet post; understand where the design philosophy came from.
  - [Introduction to Linux Distributions](./introduction/distributions.md) -- the lineage of the Debian, RHEL, and Arch families, their package management differences, and selection advice.
- [Installing Linux](./installation.md) -- the full path from choosing a distro to a finished install, including a comparison of how the three families install.
  - [Choosing the Right Distribution](./installation/choose_distribution.md) -- decide by use case and experience, and avoid "installed it, reinstalled three days later".
  - [Preparation Before Installing](./installation/preparation.md) -- plan partitioning, boot mode, network, and mirror sources in advance.
  - [The Installation Process](./installation/process.md) -- the actual installer steps for the three families and what the key options mean.
- [Filesystem](./filesystem.md) -- how data on disk is organized, and why the Linux directory tree looks the way it does.
  - [Filesystem Concepts](./filesystem/concept.md) -- inode, blocks, mount points and other core ideas; answers "why does a USB drive need to be mounted".
  - [Directory Hierarchy](./filesystem/hierarchy.md) -- the duties of `/etc`, `/var`, and `/usr` under the FHS standard.
  - [File Permissions](./filesystem/permissions.md) -- what rwx, owner/group, and the SUID/SGID/sticky bits actually mean, and how to debug them.
- [Boot Process](./boot.md) -- what happens between pressing the power button and the login prompt.
  - [BIOS and UEFI](./boot/bios_uefi.md) -- how the two firmware modes differ, and why the disk partition table has to follow.
  - [The GRUB Bootloader](./boot/grub.md) -- how the bootloader finds the kernel, and how to rescue a failed boot.
- [Software Installation](./packages.md) -- the principles and operations of the three family package managers (APT / DNF / pacman) side by side, plus the fallback path of building from source and installing from a tarball.
  - [APT Package Management](./packages/apt.md) -- Debian/Ubuntu's `apt` and `dpkg`: repositories, dependencies, and source configuration.
  - [YUM/DNF Package Management](./packages/yum.md) -- RHEL/CentOS/Rocky's `dnf` and RPM, module streams, and EPEL.
  - [Pacman Package Management](./packages/pacman.md) -- Arch's `pacman` and the AUR, the rolling-release model, and the boundary of partial upgrades.
  - [Building from Source and Tarball Installs](./packages/tarball.md) -- the fallback outside the package manager: a six-step standard flow and an uninstall checklist.
- [User Management](./users.md) -- how accounts, groups, and permissions form the first line of defense of a multi-user system.
  - [Account Management](./users/account_management.md) -- create/read/update/delete for users and groups, and a walkthrough of `/etc/passwd` and the other key files.
  - [ACL Permissions](./users/acl_permissions.md) -- fine-grained grants for when the three rwx bits are not enough.
  - [Disk Quotas](./users/disk_quotas.md) -- capping how much disk a single user may consume.
- [System Services](./services.md) -- services, boot units, and configuration management in the systemd era.
  - [System Service Management](./services/system_services.md) -- core `systemctl` usage and the path to diagnose a service that will not start.
  - [Log Management](./services/log_management.md) -- the division of labor between journald and traditional syslog.
  - [System Configuration Tools](./services/configuration_tools.md) -- each family's configuration entry points (Netplan, NetworkManager, and friends).
- [Security Basics](./security.md) -- mandatory access control concepts and practice, centered on SELinux.
  - [SELinux Concepts](./security/concept.md) -- why MAC is needed beyond DAC, and the policy and labeling model.
  - [SELinux Modes](./security/modes.md) -- choosing and switching between enforcing/permissive/disabled.
  - [Basic SELinux Commands](./security/commands.md) -- the everyday commands for "permissions look right but access is denied".
  - [SELinux Policy Configuration](./security/policy_configuration.md) -- custom booleans and policy modules.
- [Logging](./log.md) -- recording, querying, and rotating system events.
  - [System Logs](./log/syslog.md) -- how to read `journalctl` and `/var/log`.
  - [Log Rotation](./log/rotation.md) -- why logs must rotate and how to configure logrotate.

## How the Three Families Map to Each Other

Every chapter in this section that involves operations slots into the table below. This is the single most important index while reading:

| Topic | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|-------|---------------|------|-------------------|
| Package format | .deb | .pkg.tar.zst | .rpm |
| Package manager | `apt` / `dpkg` | `pacman` | `dnf` / `rpm` |
| Software source config | `/etc/apt/sources.list` | `/etc/pacman.conf` + `/etc/pacman.d/mirrorlist` | `/etc/yum.repos.d/*.repo` |
| Third-party extensions | PPA, backports | AUR (`pacman` does not install it directly; use helpers such as `yay`/`paru`) | EPEL, RPM Fusion |
| Network configuration | Netplan (`/etc/netplan/*.yaml`) | Usually `systemd-networkd` or NetworkManager directly | NetworkManager / ifcfg scripts |
| Firewall | `ufw` (over iptables/nftables) | Your own choice of `nftables`/`iptables`; no default | `firewalld` |
| Mandatory access control | AppArmor (default) | No default config | SELinux (enforcing by default) |
| Release model | Fixed cycle (Ubuntu LTS every two years) | Rolling release, no version numbers | Fixed cycle (about 3 years, 10 years of support) |
| Typical use cases | Desktop beginners, general-purpose servers | Learning, minimal customization, staying current | Enterprise production, certified ecosystems |

Two scope notes for this section: the Software Installation chapter covers the three families with one page each for APT, DNF, and Pacman, plus a source-build/tarball fallback (see [Software Installation](./packages.md)); Arch's `pacman` system usage lives in [Pacman Package Management](./packages/pacman.md), and [Introduction to Linux Distributions](./introduction/distributions.md) adds a distro-level comparison. The SELinux material in Security Basics applies to Debian/Ubuntu and Arch as well, but neither family enables it by default -- when reading, treat the commands as "available once enabled".

## Practice Environment and Resources

These notes were mostly verified in virtual machines and disposable test environments. The relevant environment and resources:

1. **Keep an expendable lab machine.** A virtual machine (VirtualBox, QEMU/KVM, or VMware all work) plus two snapshots is the most robust setup: one frozen right after install, one after basic configuration. Practicing `chmod 777 /` or editing `/etc/fstab` directly on your main machine costs far more to recover from than installing a VM.
2. **Install one of each family.** Learning only Debian convinces you `apt` is the Linux standard; learning only Arch makes you underestimate the stability work distros do. The minimum setup: one Ubuntu LTS (or Debian stable), one Rocky Linux, one Arch Linux -- even if Arch lives on a 20 GB test disk.
3. **Read official documentation instead of only searching blogs.** Suggested priority: distro official docs, then the Arch Wiki (valuable for all three families), then Bird's Private Recipes (Lin's Linux Administration Guide), then general blogs. The Arch Wiki's strength is that it documents "how Linux works", and much of it is equally correct for Debian/RHEL users.
4. **Keep network and mirrors working.** In mainland-China environments, configure domestic mirrors up front (Tsinghua, USTC, and Alibaba all mirror all three families); otherwise `apt update`, `pacman -Sy`, and `dnf makecache` get slow enough to make you question your life choices -- the number-one reason people give up.
5. **Keep a terminal session ready for notes.** Build the habit from day one: record important commands as run, the original error text, and your own hypotheses. Troubleshooting skill is fed by the "error, hypothesis, verify" loop, not by memorization.

## References

- Bird's Private Recipes (Lin's Linux Administration Guide) - Volume 1 -- [linux.vbird.org](https://linux.vbird.org/linux_basic/)
- Arch Wiki -- [wiki.archlinux.org](https://wiki.archlinux.org/)
- Arch Wiki - pacman -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- Debian Handbook -- [debian.org](https://www.debian.org/doc/manuals/debian-handbook/)
- Ubuntu official documentation -- [help.ubuntu.com](https://help.ubuntu.com/)
- Red Hat documentation center -- [docs.redhat.com](https://docs.redhat.com/)
- Rocky Linux documentation -- [docs.rockylinux.org](https://docs.rockylinux.org/)
- Fedora documentation -- [docs.fedoraproject.org](https://docs.fedoraproject.org/)
- Linux kernel documentation -- [kernel.org](https://www.kernel.org/doc/html/latest/)
- DistroWatch -- [distrowatch.com](https://distrowatch.com/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/hardware/README.md)
- [README](/system-management/README.md)
