# Knowledge Base

The research section answers, in four steps, "what do the authoritative sources say, how much of it does this repository cover, and what do we do about the gaps" (see [Research Overview](./research/README.md)). This page gathers the output of those four steps into a web of knowledge points: the research documents are the evidence records, and this is what is worth keeping after the evidence has been gathered. Every knowledge point carries a source tag, and the grading follows the research convention -- level A is captured locally on this machine (2026-10-08/09), level B is a record from the repository's existing external-link verification rounds, and anything without hard evidence is marked "source not verified". To see how a given conclusion was established, follow the link inside that entry back to the research document or the corresponding page.

## Core Concepts

### Content thread: concepts, commands, services, troubleshooting

Bird's two volumes connect concepts (disks, permissions, processes), commands, services and troubleshooting into a single line. When organizing these topics I usually lay the Debian/Ubuntu, RHEL-family and Arch commands side by side, and also moved the CentOS 7-era coordinates up into the systemd era; the related pages each start from a different question and do not demand a fixed reading order (source: [Authoritative Books Survey](./research/authoritative-books.md) sections 1 and 3, level A).

### The three package-management models

APT ships at the distro's cadence, DNF stresses transactions and dependency resolution, pacman is rolling, and daily operations collapse into a single `pacman -Syu`. The difference between the three is not command spelling but the update model: a rolling release has no such thing as a "version upgrade", and therefore no major-version migration; fixed-release distros are the opposite, and crossing versions depends on the migration tools the vendor provides. Either way the whole repository has to move together -- installing packages piecemeal is where the mess starts (source: [Coverage and Difference Matrix](./research/coverage-matrix.md) section 1, chapter 22, [Pacman Package Management](./basic/packages/pacman.md), level A).

### systemd is the current service coordinate

Units and cgroups are systemd's two pivots: services, mounts and timers are all units, and process groups are gathered into cgroups, which is why the process tree you see from `systemctl status` is complete. Timers can take over part of what crontab used to do, and logs go into the journal. The design documents and the BOOT page on systemd.io are the official line (source: [Official Documentation Survey](./research/official-docs.md) section 3, [Advanced systemd Services and Program Management](./system-management/services-systemd.md), level A).

### The storage stack: layering is the main thread, XFS cannot shrink

Partitioning, RAID, LUKS, LVM and the filesystem each occupy a layer, and the order in which you work the stack decides who can be moved without downtime. LVM's value lies in decoupling logical volumes from physical disks: growth is done online, and both ext4 and XFS can grow; only ext4 can shrink, and XFS can only be backed up and rebuilt. Snapshots and `pvmove` disk swaps are the everyday insurance this stack provides (source: [LVM Logical Volume Management](./system-management/lvm.md), level B page + this round's re-verification).

### Virtualization and containers each have their job

KVM is the virtualization module inside the kernel, QEMU does device emulation, libvirt gathers both into a single management plane, and `virsh` is the everyday entry point to that layer. A container is not a virtual machine: it shares the kernel and relies on namespaces and cgroups for isolation, and it starts in milliseconds. The one-line criterion for choosing is whether you need another kernel -- if you do, a virtual machine; if not, a container (source: [KVM Virtualization](./server/virtualization/kvm.md), level B page + verified against Arch's official package data).

### Two MAC models: labels and paths

SELinux tags every object and writes policy around the tags; AppArmor hangs directly off the executable path, and a profile is a stretch of readable configuration. RHEL-family defaults to SELinux, Debian and SUSE mostly use AppArmor. Neither model replaces the other; what operations need is to know which one is running on their box and where the logs are (source: [Coverage and Difference Matrix](./research/coverage-matrix.md) section 3, "8.20 Security", [AppArmor in Practice](./security/apparmor.md), level B page + aa-status live test).

### Account consistency: directory, cache, wiring

The answer to ten machines sharing accounts is a directory server (OpenLDAP) holding the single source of truth, clients connecting through SSSD, and below that the two standard interfaces NSS and PAM. The split where Kerberos handles authentication and LDAP holds the directory data is the foundation of the large-scale solutions (FreeIPA, Active Directory). If you changed the directory and nothing took effect, first suspect the client cache (`sss_cache -E`), then check the configuration (source: [Application Scenarios Survey](./research/application-scenarios.md) section 1.4, [LDAP Unified Account Management](./server/ldap.md), level B page + verified against RHEL package repos).

### TLS is a prerequisite for production, not a bonus

A simple bind sends the password in the clear -- that is a fact at the protocol level. There are two routes to encryption: ldaps (port 636, ciphertext from the beginning of the handshake) and StartTLS (port 389, plaintext first, then upgrade). For new deployments a single ldaps channel is recommended, with the firewall opening only 636. The certificate's CN/SAN must match the hostname the client actually connects with (source: [LDAP Unified Account Management](./server/ldap.md) section 4, level B page).

### The main line of network commands moved to iproute2

`ip` and `ss` replacing ifconfig/netstat is a done deal: new kernel features (multiple routing tables, policy routing, network namespaces) only have interfaces in iproute2. The old commands' output formats still live on in plenty of scripts and textbooks -- read them, but do not write anything new on top of them (source: [Network Management Commands](./commands/network/network.md), level B page).

### The desktop stack is layered, and servers do not install it

Pixels come out of DRM/KMS, above that sit the two display-protocol routes Xorg and Wayland, and above those the display manager, desktop environment or window manager. Server scenarios have no place for that entire layer, and a minimal install removes a class of attack surface. Group and package names in the desktop stack move with major releases, so measure before acting with things like `dnf group list` (source: [Application Scenarios Survey](./research/application-scenarios.md) section 1.3, [Desktop Graphics Stack](./hardware/desktop-stack.md), level A survey + in-page downgraded re-verification).

### The embedded threshold is the toolchain and the boot chain

The cross-compilation triple (arch-vendor-os-libc), the `ARCH`/`CROSS_COMPILE` variables, device trees describing hardware, BusyBox assembling the rootfs, U-Boot doing the booting -- every link in this chain differs from desktop habits. The verification method is QEMU emulation of a foreign architecture plus remote debugging with gdb-multiarch: most of the flow can be walked through without touching a real board (source: [Cross-compilation and Embedded](./source/cross-compile.md), level B page + verified against EL9 package repos).

### Reading source code means looking coordinates up on the spot

Kernel books on the market stop at the 2.6 era; function names and file paths should be taken from the current tree via elixir. Books give structure and method, the tree gives coordinates, and the two are used together; if you read the tree directly, start from the Documentation/ directory (source: [Official Documentation Survey](./research/official-docs.md) section 3, [The Source Section](./source/README.md), level B).

## Key Points from the Authoritative Books

The positioning of the seven books and their measured tables of contents are in [Authoritative Books Survey](./research/authoritative-books.md). The original tables of contents of all seven books were captured locally (level A).

| Book | Author / Publisher | Level | Related knowledge points |
|------|---------------------|-------|--------------------------|
| Bird's Private Recipes - Basic Study (CentOS 7 edition, 25 chapters) | VBird | A | Disks and filesystems, BASH and scripting, accounts and ACLs, scheduled tasks, services and logs, boot flow, software installation, kernel compilation -- the main skeleton of the basics volume |
| Bird's Private Recipes - Server Setup (RockyLinux 9 edition, 12 chapters) | VBird | A | Virtual machines, security hardening, network planning, firewalls, DNS/DHCP/NTP, SSH, LDAP -- the main skeleton of the server volume |
| The Linux Command Line (7th web edition, 4 parts, 36 chapters) | William Shotts (self-published, CC BY-NC-ND; print edition No Starch Press) | A | From shell usage to scripting engineering: variables, flow control, positional parameters, arrays -- the depth benchmark for the commands and scripting sections |
| UNIX and Linux System Administration Handbook (5th edition, 4 parts, 31 chapters) | Evi Nemeth, Garth Snyder, Trent R. Hein, Ben Whaley, James Ma (Addison-Wesley) | A | The four parts: fundamentals, networking, storage, operations; Containers is already covered by [Containers](./server/container/docker.md), and Cloud Computing and Continuous Integration and Delivery by [Cloud Computing and cloud-init](./server/cloud-computing.md) and [CI/CD and Continuous Delivery](./server/ci-cd.md) (2026-10-10) |
| The Debian Handbook (Bullseye edition, 16 chapters) | Raphaël Hertzog, Roland Mas | A | The Debian project, installation, APT, services, security -- the authoritative coordinates for the Debian family |
| How Linux Works (3rd edition, Introduction + 17 chapters) | Brian Ward (No Starch Press) | A | The benchmark for mechanism explanations: kernel boot, user-space boot, processes and resources, cgroups, virtualization -- the "how/why" coordinates for the source and system-administration sections |
| The Linux Bible (11th edition, 6 parts, 31 chapters) | Christopher Negus (Wiley) | A | The benchmark for distro breadth: desktop to server, security, cloud and Ansible/Kubernetes -- the breadth coordinates for the server and security sections |

The two Bird volumes each have three landing points for this repository's verification results (source code and Tarball, X Window, virtual machines, LDAP etc.), with the item-by-item table in [Coverage and Difference Matrix](./research/coverage-matrix.md) sections 1 and 2. The 31 + 36 + 16 + 17 + 31 chapters of the five English books were all checked item by item into the difference table sections 4-8 on 2026-10-10: USAH's Cloud Computing and Continuous Integration and Delivery are covered by [Cloud Computing and cloud-init](./server/cloud-computing.md) and [CI/CD and Continuous Delivery](./server/ci-cd.md), most other chapters are supported by existing pages, and 12 items -- printing, a full SSO deployment, prompt customization, realtime communication agents, Debian packaging, udev, cloud vendor consoles, Kubernetes, the AI chatbot etc. -- are registered as not to be filled.

## Official Documentation Points

The reachability and anti-scraping judgments for each source are in [Official Documentation Survey](./research/official-docs.md). The repository holds 970 external links across 162 domains (re-measured 2026-10-10); the top four are `wiki.archlinux.org` (251 links / 120 pages), `linux.vbird.org` (102 / 96), `man7.org` (51 / 31) and `docs.redhat.com` (46 / 46) -- the citation density matches the survey's conclusions.

| Source | Entry point | Key points | Level |
|--------|-------------|------------|-------|
| ArchWiki | [wiki.archlinux.org](https://wiki.archlinux.org/title/Table_of_contents) | 8 major categories, 337 numbered entries (captured directly from the official site 2026-10-09); the categories relevant to server operations were matched item by item against this repository's pages | A |
| Bird's official site | [linux.vbird.org](https://linux.vbird.org/) | 36 chapter titles across the two volumes, captured directly from the official site on 2026-10-09 and identical item by item to the mirror | A |
| Debian Handbook | [debian.org/doc/manuals/debian-handbook](https://www.debian.org/doc/manuals/debian-handbook/) | 37 in-site citations (`www.debian.org` 28 + `wiki.debian.org` 9); the chapter-level table of contents (Bullseye edition, 16 chapters) was captured from the official online edition | Entry point A / body not captured |
| Kernel docs | [docs.kernel.org](https://docs.kernel.org/) | The coordinate source for the source section; the official front page was captured on 2026-10-10 with 21 top-level sections, and this repository's 13 citations spread over scheduler, process, networking, mm, kbuild and devicetree | A |
| systemd docs | [systemd.io](https://systemd.io/) | The design-document portal and the official [BOOT boot process](https://systemd.io/BOOT) statement; both system-administration pages have added links | A |
| Red Hat docs | [docs.redhat.com](https://docs.redhat.com/) | 46 citations (one per page); returns 403 anti-scraping to curl, supported by the repository's existing dual-channel arbitration records | B |
| GNU manuals | [www.gnu.org](https://www.gnu.org/) | 40 citations covering coreutils, bash, findutils, tar etc.; connection-level failures to this domain from our egress persist, so the existing verification stands | B |
| man pages | [man7.org](https://man7.org/), [man.archlinux.org](https://man.archlinux.org/) | 51 and 43 citations, the first landing point for system call and command semantics | B |
| Kernel source search | [elixir.bootlin.com](https://elixir.bootlin.com/) | Returns 200 in live tests with a UA; the earlier unreachable verdict was a false positive from anti-scraping | B |

## Application Scenarios

Survey facts for four scenario classes (openEuler's scenario and architecture statements, Anolis's CentOS compatibility claims, ArchWiki's desktop categories, and the operations tooling surface inferred from this repository's external links) are in [Application Scenarios Survey](./research/application-scenarios.md). All six requirements landed once the pages were filled in:

| Scenario | Key requirement | Where it lands in this repository |
|----------|-----------------|-----------------------------------|
| Servers and cloud | three-distro commands side by side, a legacy-migration perspective, multi-architecture | The server volume + the system-administration volume, with three-distro comparison running through the whole repository |
| Edge and embedded | cross-compilation, device trees, the boot chain, no graphical interface | [Cross-compilation and Embedded](./source/cross-compile.md) |
| Desktop and development | Xorg/Wayland, display managers, input methods and fonts | [Desktop Graphics Stack](./hardware/desktop-stack.md) |
| Operations automation | scheduling, orchestration, monitoring, backups, account consistency | [LDAP Unified Account Management](./server/ldap.md) completes the last link |
| Security compliance | distro differences between the two MAC models | [AppArmor in Practice](./security/apparmor.md) plus the five SELinux pages form the two sets |
| Virtualization | KVM/libvirt machine and network setup, and the division of labor with containers | [KVM Virtualization](./server/virtualization/kvm.md) |

The scenario-organized index of related pages is in [Application Scenarios Survey](./research/application-scenarios.md) section 4:

- Servers and cloud: [Network Parameters](./server/network-parameters.md), [SSH Remote Login](./server/ssh.md), [Nginx](./server/web/nginx.md), [Performance](./system-management/performance.md), [Hardening](./security/hardening.md)
- Edge and embedded: [Architecture](./hardware/architecture.md), [Driver Framework](./source/driver-framework.md), [Cross-compilation](./source/cross-compile.md), [Kernel Build](./source/build-and-modules.md)
- Desktop and development: [Choosing a Distribution](./basic/installation/choose_distribution.md), [Installation Process](./basic/installation/process.md), [Desktop Graphics Stack](./hardware/desktop-stack.md), [KVM](./server/virtualization/kvm.md)
- Operations automation: [Operations Automation](./system-management/automation.md), [CI/CD and Continuous Delivery](./server/ci-cd.md), [Scheduled Tasks](./system-management/scheduled-tasks.md), [Monitoring](./server/monitoring/prometheus.md), [Backups](./system-management/backup-and-recovery.md), [LDAP](./server/ldap.md)

## Common Pitfalls and Misconceptions

The technical pitfalls are high-frequency problems picked out of the page filling and re-verification work; the details are all on the corresponding pages:

| Pitfall | Fact | Where it is covered |
|---------|------|---------------------|
| `pacman -Sy` partial upgrade | It refreshes the database without upgrading the system, so new packages land against old dependencies and the versions on disk and in the repository drift apart; `-Syu` is the only correct daily move | [Pacman Package Management](./basic/packages/pacman.md) |
| `openldap-servers` moved out of Red Hat's own repo starting with RHEL 8 | Red Hat officially points at Directory Server or IdM; Rocky put the package back in the plus repo | [LDAP Unified Account Management](./server/ldap.md) |
| Package group names move with major releases | Group names such as `base-x` cannot be confirmed from public comps sources; run `dnf group list` and read the actual output before installing | [Desktop Graphics Stack](./hardware/desktop-stack.md) |
| XFS can only grow, not shrink | Shrinking is supported by ext4 only; back up before touching XFS | [LVM Logical Volume Management](./system-management/lvm.md) |
| sss written before files in nsswitch | The moment the directory hiccups, even local root cannot be resolved, and sudo and login go on strike in turn; files always comes first | [LDAP Unified Account Management](./server/ldap.md) |
| Certificate CN/SAN does not match the connection name | ldaps reports Can't contact; make the SAN cover every access name when signing | [LDAP Unified Account Management](./server/ldap.md) |
| SSSD stale cache | The directory side changed but the client shows nothing; run `sss_cache -E` before checking the configuration, or you waste half a day with the order reversed | [LDAP Unified Account Management](./server/ldap.md) |
| olcAccess is default-deny by direction | A misconfigured access rule can lock yourself out too; leave one logged-in session before changing it | [LDAP Unified Account Management](./server/ldap.md) |

Research-method pitfalls are equally worth recording; the check records are in [Gap Fill and Verification Revisions](./research/gap-fill.md) section 4:

- **Mirrors lag in time.** ArchWiki official 337 vs mirror 336, and plus or minus one in individual category counts is normal; the two Bird tables of contents matched the mirror item by item against the official site. Anything whose structure came from a mirror has to be checked back against the official source.
- **Publisher pages do not always give the table of contents, but it is worth trying a different layout.** The first round's Wiley product pages were rendered by front-end scripts and the old No Starch product pages had no TOC block, so only ISBNs were obtained; after switching in the second round to the new product pages and the official TOC PDFs (media.wiley.com sample pages, nostarch.com/download/samples) everything was recovered. A C-level book entry is not laziness -- it means the material really could not be obtained that round; keep the entry point and try another channel later.
- **Anti-scraping behaves differently everywhere.** docs.redhat.com 403, freedesktop man pages 418, elixir 200 as soon as a UA is sent (a false positive), gnu.org failing at the connection layer with 000 and still failing on retry. Judge reachability with a UA and cross-channel checks; do not be misled by a single curl result.
- **Do not copy numbers from marketing copy.** The TLCL site copy says 596 pages; the official PDF measured 533 pages (same 7th web edition). Cite what you actually measured on the version in hand.
- **Downgrade when there is no hard evidence.** For an entry marked "verify per version", if it verifies, remove the mark and state it affirmatively; if it does not, reword it and keep the record -- do not force a statement.

## Sources and Conventions

- **Level A**: captured locally on 2026-10-08/09/10. Book tables of contents (both Bird volumes, TLCL, USAH, the Debian Handbook, How Linux Works, The Linux Bible), the ArchWiki category structure, the docs.kernel.org section structure, the openEuler/Anolis scenario statements, systemd.io, the official TLCL PDF.
- **Level B**: records from the repository's existing external-link verification rounds. The reachability conclusions for Red Hat, GNU, the man pages and elixir come from the README maintenance notes.
- **Level C / source not verified**: the Debian Handbook body (entry point and chapter contents captured, content not read chapter by chapter); Red Hat and GNU body details (anti-scraping and egress restrictions).
- Re-measurement records and the item-by-item handling of "verify per version" entries are in [Gap Fill and Verification Revisions](./research/gap-fill.md) sections 4 and 4.1.

## References

- [Research Overview](./research/README.md) -- the four-step method and the source grading
- [Authoritative Books Survey](./research/authoritative-books.md) -- the original tables of contents of the seven books and citation discipline
- [Official Documentation Survey](./research/official-docs.md) -- nine kinds of official sources and citation density
- [Application Scenarios Survey](./research/application-scenarios.md) -- facts for the four scenario classes and the related-page index
- [Coverage and Difference Matrix](./research/coverage-matrix.md) -- the four-tier verdicts, item by item
- [Gap Fill and Verification Revisions](./research/gap-fill.md) -- gap-fill execution and re-measurement records
- [Quick terms: Glossary](./glossary.md) (Chinese-English pairings, one-sentence definitions, authoritative sources and related pages).

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/research/README.md)
