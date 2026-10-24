# Introduction to Linux Distributions

There are hundreds of Linux distributions, but for the overwhelming majority of use cases only three camps genuinely deserve serious consideration: the **Debian/Ubuntu family** (APT, `.deb`), the **RHEL/CentOS/Rocky family** (DNF, `.rpm`), and the **Arch family** (`pacman`, rolling release). This chapter records the lineage, package management differences, and suitable scenarios of these three families, focusing on how release cadence matches real requirements. Chasing new kernels on a production server that must run five years uninterrupted, or locking three-year-old software versions on a personal machine you tinker with daily, both bring real pain. Choose correctly and every later chapter's operations fall neatly into place; choose wrong and you will keep wrestling with your own toolchain.

> Content draws on each distro's official documentation, the Arch Wiki, and DistroWatch -- see the references at the end.

## What This Chapter Covers

- Understand the classification dimensions of distros (release model, purpose) and the operational implications behind them
- The traits, lineage, and package management differences of the Debian/Ubuntu, RHEL-family, and Arch families
- Be able to tell the three families apart on a real terminal and run the matching software install/upgrade operations (`apt` / `dnf` / `pacman`)
- Choose a distro by use case and experience, and recognize common selection mistakes

## 1. Classifying Distributions

### 1.1 By Update Strategy

| Type | Traits | Representatives | Operational implication |
|------|--------|-----------------|-------------------------|
| Fixed release | New versions ship on a fixed cadence, with large jumps between them | Debian, Ubuntu, RHEL | Upgrades go through a major-version migration process; day to day it is mostly security patches |
| Rolling release | Continuous updates, no version number concept | Arch Linux, Gentoo | You must do a full upgrade regularly (usually weekly), or it gets harder the longer you wait |

**Why this is the most important classification dimension**: it decides your future daily routine. On a fixed-release distro the routine is "wait for the next LTS, then migrate"; on a rolling-release distro it is "run `pacman -Syu` first, then get to work". The real output below shows the difference between the two models directly:

```bash
# Ubuntu 24.04 (fixed release): list upgradable packages -- a limited, controlled set
$ apt list --upgradable 2>/dev/null | head -5
Listing...
linux-image-6.8.0-45-generic/noble-updates 6.8.0-45.45 amd64 [upgradable from: 6.8.0-44.44]
...

# Arch (rolling release): before upgrading, check "how much is going to move this time"
$ pacman -Qu | wc -l        # count pending package upgrades
27
$ sudo pacman -Syu          # standard practice: sync + upgrade in one command
:: Synchronizing package databases...
 core is up to date
 extra                    1785.4 KiB  3.12 MiB/s 00:00 [######################] 100%
:: Starting full system upgrade...
resolving dependencies...
looking for conflicting packages...

Packages (9) glibc-2.39-4  linux-6.8.9.arch1-1  ...

Total Download Size:  12.40 MiB
:: Proceed with installation? [Y/n]
```

### 1.2 By Purpose

| Type | Traits | Representatives |
|------|--------|-----------------|
| Desktop | User-friendly, desktop environment preinstalled | Ubuntu Desktop, Fedora Workstation |
| Server | Stability first, long-term support | Ubuntu Server, RHEL, Debian |
| Minimal | Smallest install, add what you need | Ubuntu Minimal, Debian netinst, CentOS Stream Minimal |
| Security | Security testing tools preinstalled | Kali Linux, Parrot OS |
| Embedded | Small resource footprint | Alpine Linux, Buildroot, OpenWrt |

The same kernel can serve everything from routers to supercomputers; the difference lies entirely in how the user space is trimmed and what ships preinstalled -- which is the literal meaning of the word "distribution": the full supporting stack that rides along when the kernel is **distributed**.

## 2. The Debian/Ubuntu Family

### 2.1 Debian

Debian was founded in 1993 by Ian Murdock. Three principles -- stability first, free software, community governance -- have carried from the project's early days to now. It releases a stable roughly every 2-3 years, and the security team provides security updates long term (historical LTS was extended by a separate project; see https://www.debian.org/ for the current policy). Package management is APT / dpkg, package format `.deb`.

Among the three families Debian is known for being "reassuringly conservative": software versions entering stable are essentially frozen, receiving only security and important fixes. The cost is that packages in the repository are often a year or so behind upstream -- for new tools, either wait for a faster cadence distro like Ubuntu/Fedora, or use backports or containers yourself.

```bash
# Check the Debian version (returns a version number such as 12.7)
$ cat /etc/debian_version
12.7

# Refresh the index && upgrade installed software
$ sudo apt update
Hit:1 http://deb.debian.org/debian bookworm InRelease
Get:2 http://security.debian.org/debian-security bookworm-security InRelease [48.0 kB]
...
Reading package lists... Done
Building dependency tree... Done
Reading state information... Done
12 packages can be upgraded. Run 'apt list --upgradable' to see them.

$ sudo apt upgrade
Reading package lists... Done
Building dependency tree... Done
Calculating upgrade... Done
The following packages will be upgraded:
  ...
```

**Three branches**:

| Branch | Description |
|--------|-------------|
| stable | The stable release, codenamed e.g. `bookworm`; suitable for production |
| testing | The testing release, candidate for the next stable |
| unstable | The development release, codenamed `sid` forever |

The tradeoffs are plain: stable for steadiness, sid for newness, testing in between. Ordinary users and servers should stay on stable; only people who know exactly what they are doing should point their daily system at sid.

### 2.2 Ubuntu

Ubuntu was founded in 2004 by Mark Shuttleworth at Canonical, built on a curated snapshot of Debian unstable. It ships a version every 6 months, with the April release of even-numbered years carrying the LTS label: regular releases get 9 months of support, LTS 5 years (paid extension to 10). Package management stays APT / dpkg, with snap added as a supplementary packaging format (official site: https://ubuntu.com/ ).

```bash
# Check the Ubuntu version
$ lsb_release -a
No LSB modules are available.
Distributor ID:	Ubuntu
Description:	Ubuntu 24.04.1 LTS
Release:	24.04
Codename:	noble

$ cat /etc/os-release | head -3
PRETTY_NAME="Ubuntu 24.04.1 LTS"
NAME="Ubuntu"
VERSION_ID="24.04"
```

**Version naming rule**:

```text
Ubuntu 24.04 LTS
       │   │  │
       │   │  └── Long Term Support (LTS)
       │   └──── 04 = April release
       └──────── 24 = year 2024
```

Why LTS is the default recommendation: a regular release is supported for only 9 months, which means a system migration every half year; LTS gives you a migration window every two years, and plugins and third-party repositories are far more willing to track LTS. Servers and desktop users who do not want fuss can just stick to LTS.

**Ubuntu derivatives**:

| Derivative | Desktop | Traits |
|------------|---------|--------|
| Ubuntu Desktop | GNOME | Official default |
| Kubuntu | KDE Plasma | KDE desktop |
| Xubuntu | XFCE | Lightweight |
| Lubuntu | LXQt | Lightest |
| Ubuntu MATE | MATE | Traditional layout |
| Linux Mint | Cinnamon | User-friendly, good for Windows migrants |
| Pop!_OS | GNOME | Developer-oriented, friendly GPU switching |

The value of a derivative is "pre-configuration": underneath it is still Ubuntu's APT repository; what you mainly change is the default desktop, driver policy, and a few homegrown tools. That means Debian/Ubuntu-family experience transfers to these derivatives almost 100%.

### 2.3 Family Tree

```text
Debian (1993)
    ├── Ubuntu (2004)
    │   ├── Linux Mint
    │   ├── Pop!_OS
    │   ├── Kali Linux
    │   └── Elementary OS
    └── Debian directly
```

## 3. The RHEL/CentOS/Rocky Family

### 3.1 RHEL (Red Hat Enterprise Linux)

RHEL split off from Red Hat Linux in 2000 as the commercial product line, selling enterprise-grade stability, a certified ecosystem, and commercial subscription support. A major version about every 3 years, with a 10-year support cycle (extendable). Package management is DNF / RPM (historically YUM), package format `.rpm` (official site: https://www.redhat.com/ ).

RHEL's value is not software freshness but **predictability**: the kernel and key components take patches only, no replacement, for years; a large body of commercial software (databases, virtualization, security products) certifies against it, and ops teams' automation scripts can therefore stay unchanged for years. That is also why it is always on the "enterprise server" recommendation list.

```bash
# Check the RHEL/Rocky version
$ cat /etc/redhat-release
Rocky Linux release 9.4 (Blue Onyx)

# Install software (DNF is YUM's next-generation implementation; commands are highly compatible)
$ sudo dnf install -y nginx
Last metadata expiration check: 0:00:42 ago on Tue 17 Sep 2024 10:12:01 AM CST.
Dependencies resolved.
===============================================================================
 Package       Arch        Version              Repository      Size
===============================================================================
Installing:
 nginx         x86_64      1.20.1-9.el9         appstream       56 k
...

Complete!
```

### 3.2 Fedora

Fedora was created in 2003 and positioned as RHEL's upstream proving ground: one release every 6 months, each maintained for about 13 months (official site: https://fedoraproject.org/ ).

```bash
$ cat /etc/fedora-release
Fedora Linux 40 (Workstation Edition)
```

The Fedora-RHEL relationship is "propose, incubate, graduate": new features are validated in Fedora first and enter RHEL once mature. For an individual developer, Fedora means a fairly new toolchain without the rolling-distro risk of the environment breaking at any moment.

### 3.3 CentOS and CentOS Stream

- **CentOS**: born in 2004, a de-branded rebuild of RHEL sources; was once the very definition of "free RHEL"
- **The turn**: at the end of 2020 Red Hat announced the early end of CentOS 8 (originally set for 2029); CentOS 8 went unmaintained at the **end of 2021**
- **Today**: the CentOS project's focus moved to **CentOS Stream** -- a rolling distro sitting **upstream** of RHEL, between Fedora and RHEL
- **Downstream replacements**: the community options for a "RHEL-compatible downstream" are **Rocky Linux** and **AlmaLinux** (both founded in 2021)

CentOS Stream is not CentOS renamed and continued; the **direction is reversed**: the old CentOS was a rebuild after RHEL shipped (downstream), while Stream is a preview of RHEL development (upstream). Anyone still reading "CentOS = free RHEL" will make outdated selection decisions -- it is one of the most common legacy misconceptions today.

### 3.4 Family Tree

```text
Fedora (2003, upstream testing)
    └── RHEL (2000, commercial product)
        ├── CentOS Stream (upstream rolling; the former CentOS has transitioned)
        ├── Rocky Linux (2021, downstream rebuild)
        ├── AlmaLinux (2021, downstream rebuild)
        └── Oracle Linux (downstream rebuild)
```

## 4. The Arch Linux Family

### 4.1 Positioning and Philosophy

Arch Linux was created in 2002 by Judd Vinet on the principles of minimalism, user agency, and KISS (Keep It Simple, Stupid). It uses rolling release: `/etc/os-release` has no `VERSION_ID`, only `BUILD_ID=rolling`; package management is `pacman`, package format `.pkg.tar.zst` (official site: https://archlinux.org/ ).

Arch often gets labeled "experts only", but its more accurate positioning is a **teaching system**: the install makes you partition, mount, configure the bootloader, and install the base system that `pacman` bootstraps -- in effect assembling the distro in front of you, step by step. The Arch Wiki documents these steps so well that Debian and RHEL users consult it constantly -- Arch's biggest quiet contribution to the whole Linux community.

```bash
$ cat /etc/os-release
NAME="Arch Linux"
PRETTY_NAME="Arch Linux"
ID=arch
BUILD_ID=rolling
HOME_URL="https://archlinux.org/"
DOCUMENTATION_URL="https://wiki.archlinux.org/"
```

### 4.2 pacman in Practice

`pacman` (short for package manager) is Arch's only official package manager. Commands are built from single-letter option groups, with `-S` (sync, from the repository) as the highest-frequency entry point:

```bash
# Everyday full upgrade: sync the database + upgrade all packages, one command, do not split it
$ sudo pacman -Syu
:: Synchronizing package databases...
 core                    156.5 KiB   412 KiB/s 00:00 [######################] 100%
 extra                   868.7 KiB  1.63 MiB/s 00:00 [######################] 100%
:: Starting full system upgrade...
resolving dependencies...
looking for conflicting packages...

Packages (3) linux-firmware-20240809-1  nginx-1.26.2-1  ...

Total Download Size:    4.15 MiB
Total Installed Size:  18.32 MiB
Net Upgrade Size:       0.45 MiB

:: Proceed with installation? [Y/n] y
(3/3) checking keys in keyring               [######################] 100%
(3/3) checking package integrity             [######################] 100%
(3/3) loading package files                  [######################] 100%
(3/3) checking for file conflicts            [######################] 100%
(3/3) checking available disk space          [######################] 100%
:: Processing package changes...
(1/3) upgrading linux-firmware               [######################] 100%
(2/3) upgrading nginx                        [######################] 100%
(3/3) upgrading linux                        [######################] 100%
```

A cheat sheet of common operations (learn them side by side; the right column is the APT/DNF equivalent):

| Operation | Arch (`pacman`) | Debian/Ubuntu | RHEL/Rocky |
|-----------|-----------------|---------------|------------|
| Full upgrade | `sudo pacman -Syu` | `sudo apt update && sudo apt upgrade` | `sudo dnf upgrade --refresh` |
| Install | `sudo pacman -S nginx` | `sudo apt install nginx` | `sudo dnf install nginx` |
| Remove | `sudo pacman -R nginx` | `sudo apt remove nginx` | `sudo dnf remove nginx` |
| Remove incl. config | `sudo pacman -Rns nginx` | `sudo apt purge nginx` | `sudo dnf remove nginx` |
| Search repositories | `pacman -Ss nginx` | `apt search nginx` | `dnf search nginx` |
| Search installed | `pacman -Qs nginx` | `apt list --installed \| grep nginx` | `dnf list installed \| grep nginx` |
| Package info | `pacman -Si nginx` | `apt show nginx` | `dnf info nginx` |
| Which package owns a file | `pacman -Qo /usr/bin/nginx` | `dpkg -S /usr/bin/nginx` | `rpm -qf /usr/bin/nginx` |
| Clean cache | `sudo pacman -Scc` | `sudo apt clean` | `sudo dnf clean all` |

A few details only Arch users need burned into memory:

1. **Do not split `-Syu`**. `sudo pacman -Sy package` refreshes the index and installs a single package, leaving the new package's newer library dependencies mismatched against the rest of the older system, triggering failures like `error while loading shared libraries` -- known in the Arch community as a "partial upgrade" and explicitly unsupported. The correct move is always a full upgrade first.
2. **Keep `-Ss` and `-Qs` straight**. The `-S` series searches the **repositories**, the `-Q` series searches the **local installed database**. Right after a fresh install, `pacman -Ss` finding a package while `-Qs` does not is normal, not a failed install (use `pacman -Qi` for details).
3. **The AUR is not part of `pacman`**. The Arch User Repository holds community-maintained build scripts (PKGBUILDs); `pacman` does not install them directly -- you need an AUR helper like `yay` or `paru`. Trusting the AUR as an official repository means giving up the distro's quality gate -- a responsibility boundary you must know when choosing Arch.
4. **Refresh the bootloader after kernel upgrades**. Arch maintains the kernel image under `/boot` itself; after a major kernel upgrade with GRUB you usually need `sudo grub-mkconfig -o /boot/grub/grub.cfg` (or the corresponding EFI path). RHEL/Ubuntu handle this automatically -- a real difference in operating habit.

### 4.3 Where Arch Fits and Where It Does Not

- **Fits**: developers and ops people who want to thoroughly understand how a system is assembled, personal machines chasing minimalism and the newest software, users willing to spend ten minutes a week on a full upgrade
- **Does not fit**: production servers that must not change for three years (there is officially no long-term-support stable branch), desktop newcomers with no intention of touching the command line, enterprise environments that depend on commercially certified software

## 5. The Three Families Side by Side

### 5.1 Package Management

| Operation | Debian/Ubuntu (`apt`) | RHEL/CentOS/Rocky (`dnf`) | Arch (`pacman`) |
|-----------|----------------------|---------------------------|-----------------|
| Refresh source index | `apt update` | `dnf makecache` | `pacman -Sy` (usually folded into `-Syu`) |
| Upgrade system | `apt upgrade` / `full-upgrade` | `dnf upgrade` | `pacman -Su` (folded into `-Syu`) |
| Install software | `apt install pkg` | `dnf install pkg` | `pacman -S pkg` |
| Remove software | `apt remove pkg` | `dnf remove pkg` | `pacman -R pkg` |
| Search software | `apt search kw` | `dnf search kw` | `pacman -Ss kw` |
| Package format | `.deb` | `.rpm` | `.pkg.tar.zst` |
| Low-level tool | `dpkg` | `rpm` | `pacman`, all-in-one |

### 5.2 System Configuration

| Aspect | Debian/Ubuntu | Arch | RHEL/CentOS/Fedora |
|--------|---------------|------|--------------------|
| Network config | Netplan (`/etc/netplan/*.yaml`) | Usually `systemd-networkd` or NetworkManager | NetworkManager / ifcfg scripts |
| Firewall | `ufw` (over iptables/nftables) | No default; pick `nftables`/`iptables` yourself | `firewalld` |
| Mandatory access control | AppArmor (on by default) | Unconfigured by default | SELinux (RHEL default **enforcing**) |
| Service management | systemd | systemd | systemd |
| Default shell | bash | bash | bash |
| Configuration style | Officially integrated, with `debconf` prompt replay | Mostly hand-written config files | Officially integrated, emphasizing tools like `firewall-cmd`/`nmcli` |

Every row of that table maps to a class of real failure: running RHEL documentation's `firewall-cmd` on Ubuntu gives "command not found"; on Rocky, a "permissions look right but 502" case is more often SELinux than the application itself; when networking is down on Arch, first confirm whether you configured `systemd-networkd` or NetworkManager -- both may be installed, but only one can be managing.

### 5.3 Software Sources

| Aspect | Debian/Ubuntu | Arch | RHEL/CentOS/Fedora |
|--------|---------------|------|--------------------|
| Official source config | `/etc/apt/sources.list` + `sources.list.d/` | `/etc/pacman.conf` + `/etc/pacman.d/mirrorlist` | `/etc/yum.repos.d/*.repo` |
| Third-party extensions | PPA, backports | AUR (needs a helper like `yay`/`paru`) | EPEL, RPM Fusion |
| Mainland-China mirrors | Tsinghua, USTC, Alibaba | Tsinghua, USTC, archlinuxcn | Tsinghua, USTC, Alibaba |

The three sides' trust models differ: PPAs are published by individuals or teams but go through Launchpad's packaging process; EPEL is maintained by an official Fedora special-interest group; the AUR is user-submitted build scripts -- **the chain of trust ultimately lands on "have you audited the PKGBUILD"**. As a rule, production should stick to official repositories plus well-known third-party sources.

## 6. How to Choose

### 6.1 By Use Case

| Use case | Recommendation | Reason |
|----------|----------------|--------|
| Learning, first install | Ubuntu Desktop (LTS) | Most material, active community, pitfalls are easy to search |
| Desktop development | Ubuntu LTS / Fedora Workstation | Fairly new toolchain, container-friendly ecosystem |
| Enterprise servers | RHEL/Rocky Linux/AlmaLinux | Long-term support, certified ecosystem, predictable upgrade path |
| Web / general servers | Ubuntu Server / Debian stable | Stable, rich repositories, complete documentation |
| Deep system understanding | Arch Linux | The install process shows how a system is assembled; the Arch Wiki is thorough |
| Security testing | Kali Linux | Security tools preinstalled (Debian-based) |
| Embedded / tiny images | Alpine / Debian minimal | Small footprint or full ecosystem; trade off as needed |

### 6.2 By Experience Level

| Experience | Recommendation | Reason |
|------------|----------------|--------|
| Complete beginner | Ubuntu Desktop LTS | Graphical installer + automatic partitioning + a desktop that works out of the box |
| Coming from Windows | Linux Mint | Layout resembles Windows; underneath it is still the Ubuntu repositories |
| Want to learn deeply | Arch (hands-on) / Debian/Fedora (upstream) | The former takes it apart in front of you; the latter tracks upstream development pace |
| Chasing minimalism | Arch Linux | Build from zero, no imposed desktop or vendor tools |
| Enterprise ops | RHEL/Rocky Linux | Industry standard; skills transfer directly |

### 6.3 Download Addresses

| Distro | Official download | Mainland-China mirror |
|--------|-------------------|------------------------|
| Ubuntu | https://ubuntu.com/download | https://mirrors.tuna.tsinghua.edu.cn/ubuntu-releases/ |
| Debian | https://www.debian.org/distrib/ | https://mirrors.tuna.tsinghua.edu.cn/debian-cd/ |
| Fedora | https://fedoraproject.org/ | https://mirrors.tuna.tsinghua.edu.cn/fedora/releases/ |
| Arch | https://archlinux.org/download/ | https://mirrors.tuna.tsinghua.edu.cn/archlinux/ |
| Rocky Linux | https://rockylinux.org/download/ | https://mirrors.tuna.tsinghua.edu.cn/rocky/ |

After downloading, always verify the hash (the official site publishes SHA256SUMS) -- basic hygiene for mirror distribution:

```bash
$ sha256sum ubuntu-24.04.2-desktop-amd64.iso
f4c5431b6d4b1e4e7e3f6c8c0a9f...  ubuntu-24.04.2-desktop-amd64.iso
# Compare against the officially published SHA256, then write it to the USB drive
```

## 7. Common Pitfalls and Misconceptions

1. **Choosing the wrong update model**. Wanting "five years without touching it" but installing Arch, or wanting the newest tools but picking Debian stable -- both will make you want to switch within a week. First answer "how often am I willing to do a system upgrade, and how old can my software get", then pick a camp.

2. **Porting APT/DNF habits as "the Linux standard"**. `apt update && apt upgrade` is correct on Debian/Ubuntu; the correct Arch equivalent is the single `sudo pacman -Syu`; `sudo yum install` is flat-out command not found on Arch. Before running any command from a guide, run `cat /etc/os-release` and confirm the `ID`.

3. **Assuming CentOS is still free RHEL**. CentOS 8 went unmaintained at the end of 2021 and the project moved to the upstream CentOS Stream; for downstream compatibility use Rocky Linux or AlmaLinux. Following old guides and freshly installing CentOS gets you a system that no longer receives security updates.

4. **Looking to SELinux/AppArmor for rescue on machines outside RHEL/Debian**. SELinux is enforcing by default on the RHEL family; Debian/Ubuntu enables AppArmor by default; Arch configures neither by default. When troubleshooting, first confirm "does this machine actually have a mandatory access control blocking me" -- otherwise you will spin on permission bits for half a day.

5. **Underestimating Arch's maintenance burden**. Rolling release means you carry the upgrade-regression risk (a new package version breaking compatibility); AUR build scripts vary wildly in quality. Installing Arch on a production machine as a "maintenance-free, always-current system" is a selection-level mismatch, not a technical problem.

6. **Choosing only by "market share" and "ranking"**. DistroWatch page-hit counts measure curiosity, not stability or suitability. Server selection should look at support cycles, certifications, and team familiarity; desktop selection should look at drivers and how well everyday software (chat clients, office suites, etc.) is supported.

7. **Ignoring mainland-China mirrors and install-media verification**. The default sources are often slow enough to time out locally, and a stuck `apt update`, `pacman -Sy`, or `dnf makecache` gets misdiagnosed as "the system is broken"; writing an unverified image to disk can turn corruption from a bad mirror into weird problems you then blame on the installer.

## References

- Debian Handbook -- [debian.org](https://www.debian.org/doc/manuals/debian-handbook/)
- Ubuntu Documentation -- [help.ubuntu.com](https://help.ubuntu.com/)
- Ubuntu LTS lifecycle -- [ubuntu.com](https://ubuntu.com/about/release-cycle)
- RHEL Documentation -- [docs.redhat.com](https://docs.redhat.com/)
- Fedora Documentation -- [docs.fedoraproject.org](https://docs.fedoraproject.org/)
- Rocky Linux Documentation -- [docs.rockylinux.org](https://docs.rockylinux.org/)
- CentOS project (Stream notes) -- [centos.org](https://www.centos.org/)
- Arch Linux -- [archlinux.org](https://archlinux.org/)
- Arch Wiki - pacman -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- Arch Wiki - Arch as a beginner? -- [wiki.archlinux.org](https://wiki.archlinux.org/title/General_recommendations)
- AUR -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Arch_User_Repository)
- Tsinghua Open Source Software Mirror -- [mirrors.tuna.tsinghua.edu.cn](https://mirrors.tuna.tsinghua.edu.cn/)
- DistroWatch -- [distrowatch.com](https://distrowatch.com/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/basic/README.md)
- [introduction](/basic/introduction.md)
- [history](history.md)
