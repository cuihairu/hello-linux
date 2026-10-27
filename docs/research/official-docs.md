# Official Documentation Survey

Official documentation is this repository's second source class. This page does two things: register the entry points of official documentation worth citing, and count how much this repository actually cites -- citation density is itself evidence for the coverage verdict.

## 1. External-Link Citation Statistics (Tier A, Local Full Scan)

Baseline: scan every external link target in the Markdown link syntax `](http(s)://...)` across `docs/**/*.md`, aggregated by domain; initial measurement on 2026-10-08, retested on 2026-10-10 and recomputed with that day's added source links (the *How Linux Works* / *Linux Bible* TOC sources).

- 970 external links across 162 domains; under this round's baseline, 0 links to example domains like `example.com` or `localhost`.
- Covering 142 pages (homepage and TOC pages included), an average of 6.8 external links per page.

### 1.1 Grouped by Source

| Source category | Citations | Pages involved |
|---------|---------|---------|
| ArchWiki and Arch official (`wiki.archlinux.org`, `man.archlinux.org`, `archlinux.org`) | 302 | 122 |
| Bird's Private Recipes (`linux.vbird.org`) | 102 | 96 |
| Red Hat and Fedora (`docs.redhat.com`, `access.redhat.com`, `docs.fedoraproject.org`) | 55 | 50 |
| Kernel-related (`www.kernel.org`, `docs.kernel.org`, `elixir.bootlin.com`) | 74 | 32 |
| GNU, POSIX, and TLDP (`www.gnu.org`, `tldp.org`, `pubs.opengroup.org`) | 54 | 27 |
| Man page sites (`man7.org` etc.) | 51 | 31 |
| Project official docs (Docker, Ansible, Prometheus, nginx, MySQL, Redis, BIND, etc.) | 50 | 25 |
| Debian official (`www.debian.org`, `wiki.debian.org`) | 37 | 35 |
| Ubuntu (`ubuntu.com`, `help.ubuntu.com`, `netplan.io`) | 21 | 20 |
| RHEL-compatible distributions (`docs.rockylinux.org` etc.) | 17 | 13 |

### 1.2 Top Ten Single Domains

| Domain | Links | Pages |
|------|------|-------|
| `wiki.archlinux.org` | 251 | 120 |
| `linux.vbird.org` | 102 | 96 |
| `man7.org` | 51 | 31 |
| `docs.redhat.com` | 46 | 46 |
| `man.archlinux.org` | 43 | 13 |
| `www.gnu.org` | 40 | 24 |
| `elixir.bootlin.com` | 36 | 13 |
| `www.debian.org` | 28 | 28 |
| `www.kernel.org` | 25 | 21 |
| `github.com` | 16 | 12 |

Two numbers are worth noting: docs.redhat.com's 46 citations are spread over 46 pages (one per page -- the typical "one official source per chapter"), while man.archlinux.org's 43 citations cluster in 13 pages (dense citation on the command quick-reference pages). The README maintenance notes record that docs.redhat.com 403s across the whole domain against crawlers; link reachability was confirmed by dual-channel arbitration, hence Tier B.

## 2. ArchWiki (Tier A, Structure Fetched This Round)

The official site `wiki.archlinux.org` was unreachable this round, so the category structure was taken from the TOC page of the Chinese mirror `wiki.archlinux.org.cn`. That mirror is not officially acknowledged by Arch and is **used only to take the category tree and entry counts, never the body text**; body citations always use the official `wiki.archlinux.org` address (all 251 of this repository's citations point to the official domain).

The mirror's TOC page gives 8 top-level categories and 336 numbered entries; the number after each entry is that category's page count on the mirror. Second-level categories relevant to this repository:

> 2026-10-09 retest: the official TOC page fetched at 200, 8 top-level categories and 337 numbered entries, the structure matching the mirror (per-category counts off by ±1 in places, due to mirror lag); this section's category structure upgraded to a direct official fetch. Retest records in [Gap Fill and Revision Log](./gap-fill.md).

| Category | Pages | Landing point in this repository |
|-------|-------|---------|
| 1.3 Installation | 35 | Basics · Installing Linux (3 pages) |
| 4.2 CPU / 4.16 Storage | 9 / 17 | Hardware · CPU, storage devices |
| 4.6 Graphics / 4.15 Sound | 33 / 21 | Graphics landed by the new [Desktop Graphics Stack](../hardware/desktop-stack.md) page; sound not listed separately |
| 6.4 Firewall / 6.7 Network configuration / 6.8 Network monitoring | — / 10 / 11 | Corresponding pages in the network and security parts |
| 6.12 Servers / 6.3.2 Mail server | 20 / 30 | Server part (21 pages) and `mail/postfix` |
| 8.8 File systems | 46 | Basics · File systems (3 pages) + the new LVM page |
| 8.12 Kernel | 37 | Source part (14 pages) |
| 8.18 Package management | 26 | Basics · software installation + Commands · package management commands |
| 8.20 Security | 39 | Security part (8 pages) + Basics SELinux (4 pages) + the new AppArmor page |
| 8.23 Virtualization | 37 | Container page (docker) + the new KVM page |
| 8.6 Generalities of desktop / 8.10 Graphical user interfaces / 8.14 Localization | 25 / 3 / 14 | The new desktop graphics stack page |
| 8.1 Backup / 8.2 Boot process / 8.15 Logging / 8.16 Monitoring | 16 / 19 / 6 / 2 | Corresponding system-management pages |

Explicitly not followed: 4.9 Laptops (33 vendor-specific subcategories listed, Lenovo alone at 183 pages), the 2.x development toolchains, 6.10 Peer-to-peer and 6.13 Streaming, and 6.15 VoIP -- these entries belong to device adaptation and application software catalogs, at odds with this repository's "learn Linux itself" positioning; the [Coverage Matrix](./coverage-matrix.md) marks them as not covered rather than as gaps.

## 3. Other Official Documentation Entry Points

| Documentation | Entry point | This repository's citations | This round's status |
|------|------|---------|---------|
| Debian official manual | [debian.org/doc/manuals/debian-handbook](https://www.debian.org/doc/manuals/debian-handbook/) | 28 `www.debian.org` + 9 `wiki.debian.org` | Entry point mid C→A upgrade: landing page 200 in the 2026-10-09 retest; the chapter-level TOC was actually fetched from the official online edition (debian-handbook.info, Bullseye); the 16-chapter structure is in [Authoritative Books Survey](./authoritative-books.md) §2.1; body details still unfetched |
| Kernel documentation | [docs.kernel.org](https://docs.kernel.org/), [www.kernel.org](https://www.kernel.org/) | 13 + 25 | Upgraded to A on 2026-10-10: official homepage fetched at 200, parsing out 21 top-level sections (maintainer, process, core-api, driver-api, locking, doc-guide, dev-tools, kernel-hacking, trace, fault-injection, livepatch, rust, admin-guide, kbuild, tools, userspace-api, firmware-guide, devicetree, arch, staging, translations), plus a direct 200 on `scheduler/` not listed on the homepage. This repository's 13 citations distribute over six areas -- scheduler, process, networking, mm, kbuild, devicetree -- all within the admin-guide and core-mechanism documentation scope; the README records path-migration fixes from a follow-up link-verification round |
| Red Hat documentation | [docs.redhat.com](https://docs.redhat.com/) | 46, across 46 pages | Tier B: the repository's external-link verification round confirmed reachability (403 anti-crawler, dual-channel arbitration) |
| GNU tool manuals | [www.gnu.org](https://www.gnu.org/) (coreutils, bash, findutils, tar, etc.) | 40, 24 pages | Tier B: passed the existing verification round |
| Arch man pages | [man.archlinux.org](https://man.archlinux.org/) | 43, 13 pages | 2026-10-10 retest: direct test with UA returned 200; the previous wayback-snapshot corroboration withdrawn |
| systemd documentation | [systemd.io](https://systemd.io/) | 5 (two added 2026-10-09 on the services-systemd and boot-process pages, plus one entry point each from the research part and the knowledge-points page) | Citation gap cleared: both pages gained one official entry point (both URLs measured at 200); details in [Gap Fill and Revision Log](./gap-fill.md) §2 item 4 |
| Kernel source browsing | [elixir.bootlin.com](https://elixir.bootlin.com/) | 36, 13 pages | Tier B: measured 200 with a UA; the README records it as an anti-crawler false positive |

Citation baseline: this repository's external links were sample-checked at 54 pages / 291 links in the previous site-inspection round (README maintenance notes) -- 269 normal, 10 dead and already replaced, 10 anti-crawler false positives kept, 6 transient network anomalies logged and left alone. The 2026-10-10 retest: 5 of the 6 transients turned 200 (confirmed as transient at the time); proftpd.org still 000 (DNS resolving to fake 198.18.x.x addresses, an egress-side issue, wayback has a snapshot) and remains kept; four wayback-corroborated entries -- elixir.bootlin.com, cisecurity.org, man.archlinux.org, groups.google.com -- measured 200 directly with a UA, so the corroboration was withdrawn; help.ubuntu.com 503 is anti-crawler (not 404) and remains kept.

<!-- BACKLINKS-AUTO -->
## Related Pages

- [knowledge](/knowledge.md)
- [README](README.md)
- [coverage-matrix](coverage-matrix.md)
- [gap-fill](gap-fill.md)
