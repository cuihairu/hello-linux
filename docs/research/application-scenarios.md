# Application Scenarios Survey

Who documentation serves decides what gets written. This page lists externally verifiable facts by four scenario classes, then gives per-class observations on this repository's content and related-page indexes; the conclusions go straight into the [Coverage Matrix](./coverage-matrix.md). The sites cited on this page were all actually fetched on 2026-10-08 (Tier A).

## 1. Scenarios and Facts

### 1.1 Servers and Cloud Computing

The openEuler homepage states that it is an "open-source operating system for digital infrastructure", covering the four core scenarios of "servers, cloud computing, edge computing, and embedded", and supporting multiple compute architectures including ARM, x86, RISC-V, LoongArch, PowerPC, and SW-64 ([openeuler.org](https://www.openeuler.org/), fetched 2026-10-08). Anolis OS, another mainstream domestic server distribution, positions itself as "able to provide scenario-tailored demand customization and optimization for the cloud, 100% compatible with the CentOS software ecosystem", and provides a CentOS migration script entry point ([openanolis.cn](https://www.openanolis.cn/), fetched 2026-10-08).

The value of these two facts: readers in the server scenario are in a state of "legacy CentOS migration plus coexisting architectures" -- documentation must provide both the RHEL-family commands and the migration caveats, not just one set.

### 1.2 Edge and Embedded

The same openEuler statement lists edge computing and embedded as two scenario classes in their own right, on par with server and cloud -- such devices have no graphical interface, small storage, and a boot chain different from a desktop machine, involving cross-compilation, device trees, kernel trimming, and boot loading. This repository's current support for this chain: the source part's device driver framework page and the hardware part's architecture page mention device trees, but "cross-compilation" has zero hits repo-wide -- there is no embedded-oriented entry point of its own.

### 1.3 Desktop and Development

The ArchWiki table of contents (fetched via mirror) lists "Generalities of desktop" (25 pages), "Graphical user interfaces" (3 pages), "Localization" (14 pages), and "Input devices" (2 pages) as separate subitems under the system administration category -- meaning the desktop stack occupies a fixed share in peer authoritative documentation. This repository's state (as of 2026-10-08): repo-wide, `Wayland` appears once and only on the choose-a-distribution page, `Xorg` once and only on the GRUB page, and `GNOME` six times, all in installation and distribution-introduction paragraphs -- the desktop was a genuine blank at survey time, filled this round by the new [Desktop Graphics Stack](../hardware/desktop-stack.md) page.

### 1.4 Operations Automation

This repository's own external-link structure lets us infer the operations reader's toolset (local full scan, 2026-10-08): `docs.ansible.com` 7 links, `prometheus.io` 6, `docs.docker.com` 4, `www.brendangregg.com` 5 -- plus the system-management part's four pages on automation, backup & recovery, scheduled tasks, and performance tuning. The automation/monitoring/backup/scheduling main line has taken shape. What is missing is folding "multi-machine account consistency" (LDAP/SSSD, Bird's Server book Chapter 11) into the same main line.

## 2. What the Scenarios Require of This Repository

| Scenario | Key requirement | This repository's state | Disposition |
|------|---------|---------|------|
| Server and cloud | Side-by-side commands for the three distro families, a legacy-system migration perspective, multiple architectures | 21 server pages + 9 system-management pages, with three-family comparisons throughout | Covered |
| Edge and embedded | Cross-compilation, device trees, boot chain, no graphical interface | Previously only device tree mentions; no embedded entry point | Page added; related pages in §4.2 |
| Desktop and development | Xorg/Wayland, display managers, desktop environments, input methods and fonts | Scattered mentions | Page added (desktop graphics stack) |
| Operations automation | Scheduling, orchestration, monitoring, backup, account consistency | Four main lines present; account consistency missing | Page added (LDAP unified account management) |
| Security and compliance | MAC/mandatory access control differences across the two distro families | SELinux spans 5 pages as a system; AppArmor is one comparison-table row | Page added (AppArmor in practice) |
| Virtualization | KVM/libvirt machine and network setup, and the division of labor with containers | The hardware part gives install commands; the server part has only a container page | Page added (KVM virtualization) |

The two items originally "logged as gaps but not filled this round" (the embedded cross-compilation topic and LDAP unified accounts) were completed in follow-up increments, landing as [Cross-Compilation and Embedded](../source/cross-compile.md) and [LDAP Unified Account Management](../server/ldap.md); on 2026-10-10 the partially-covered SSH entry in the gap table got its own page [SSH Remote Login](../server/ssh.md), the basics part's "Chapter 21" got [Source Builds and Tarball Installation](../basic/packages/tarball.md), and the USAH extended topics got [Cloud Computing and cloud-init](../server/cloud-computing.md) and [CI/CD and Continuous Delivery](../server/ci-cd.md); all 31 USAH chapters, 36 TLCL chapters, and 16 Debian Handbook chapters were checked item by item into [Coverage Matrix](./coverage-matrix.md) §4, §5, and §6; see [Gap Fill and Revision Log](./gap-fill.md) for the fill records.

## 4. Finding Related Pages by Scenario

Related pages listed below by scenario, as a lookup index; no reading order is prescribed. All links point to pages within the repository; the desktop and development column includes [Desktop Graphics Stack](../hardware/desktop-stack.md) and [KVM Virtualization](../server/virtualization/kvm.md).

### 4.1 Server and Cloud

- [Installing Linux](../basic/installation.md): installation and initialization
- [Server Network Parameter Configuration](../server/network-parameters.md): addresses, gateways, and DNS
- [SSH Remote Login](../server/ssh.md): remote administration and key authentication
- [Nginx](../server/web/nginx.md): web services
- [Performance Tuning](../system-management/performance.md): load and troubleshooting
- [Security Hardening](../security/hardening.md): service hardening

### 4.2 Edge and Embedded

- [Computer Architecture](../hardware/architecture.md): ARM, RISC-V, and other architectures and device trees
- [Device Driver Framework](../source/driver-framework.md): device trees and drivers
- [Cross-Compilation and Embedded](../source/cross-compile.md): cross toolchains, kernel trimming, rootfs, and U-Boot
- [Kernel Build and Module Development](../source/build-and-modules.md): kernel trimming and compilation
- [Boot Process and Boot Troubleshooting](../system-management/boot-process.md): the boot chain of headless devices

### 4.3 Desktop and Development

- [Choosing a Distribution](../basic/installation/choose_distribution.md): choosing a desktop distribution
- [Installation Process](../basic/installation/process.md): installation and desktop environments
- [Desktop Graphics Stack](../hardware/desktop-stack.md): Xorg/Wayland, display managers, fonts, and input methods
- [KVM Virtualization](../server/virtualization/kvm.md): development and test virtual machines
- [Text Editing and Viewing Tools](../commands/text/editors.md): configuration and code editing

### 4.4 Operations Automation

- [Automation](../system-management/automation.md): scripting and Ansible
- [Scheduled Tasks](../system-management/scheduled-tasks.md): cron and systemd timers
- [Prometheus + Grafana](../server/monitoring/prometheus.md): monitoring
- [Backup and Recovery](../system-management/backup-and-recovery.md): data protection
- [Account Management](../basic/users/account_management.md): single-machine accounts
- [LDAP Unified Account Management](../server/ldap.md): multi-machine account directories

## 5. References

- openEuler official site (scenario and architecture statements) -- [openeuler.org](https://www.openeuler.org/), fetched 2026-10-08
- OpenAnolis (Anolis OS positioning and CentOS compatibility) -- [openanolis.cn](https://www.openanolis.cn/), fetched 2026-10-08
- ArchWiki table of contents (desktop and system administration category structure) -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Table_of_contents); this round fetched the structure via the Chinese mirror [wiki.archlinux.org.cn](https://wiki.archlinux.org.cn/title/Table_of_contents)
- Bird's Private Recipes, Server Setup part (scenario sections) -- [vbird.org.cn/linux_server/rocky9/](https://vbird.org.cn/linux_server/rocky9/), fetched 2026-10-08
- This repository's external-link statistics: local scan of `docs/**/*.md`, 2026-10-08

<!-- BACKLINKS-AUTO -->
## Related Pages

- [knowledge](/knowledge.md)
- [README](README.md)
- [coverage-matrix](coverage-matrix.md)
- [gap-fill](gap-fill.md)
