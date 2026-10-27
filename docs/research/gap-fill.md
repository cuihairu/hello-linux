# Gap Fill and Revision Log

This page is step ④ of the four: registering every gap and revision that the [Coverage Matrix](./coverage-matrix.md) verdicts produced -- which gap entry triggered it, which file it landed as, and which existing pages were changed. To-retest items are in the last section.

## 1. Pages Added This Round (6, All Triggered by "Gap" Rows in the Gap Table)

| New page | Triggering gap | Content |
|------|---------|---------|
| [Pacman Package Management](../basic/packages/pacman.md) | Gap table ch. 1 "Chapter 22": the software installation chapter only had the APT/DNF families, with no landing point for the third (ArchWiki 8.18 Package management agrees) | The rolling-release model, repositories and databases, daily commands, `-Syu` atomicity and the danger of partial upgrades, cache management, the AUR and makepkg boundary, a three-family comparison table, keyring/.pacnew and other pitfalls |
| [LVM Logical Volume Management](../system-management/lvm.md) | Gap table ch. 1 "Chapter 7": hands-on LVM previously had no landing point (the storage part only covered device-mapper layering) | The PV/VG/LV/PE model, volume creation sequence, growing (ext4 vs XFS differences), shrink risks, snapshots and rollback, pvmove disk swaps, stacking order vs RAID/LUKS, common failures |
| [Desktop Graphics Stack](../hardware/desktop-stack.md) | Gap table ArchWiki "4.6 Graphics / 8.10 Graphical user interfaces / 8.14 Localization" and Bird's "Chapter 23 X Window" both had no landing points | The DRM/KMS-to-pixels layered chain, Xorg vs Wayland model comparison, display managers, desktop environments and WMs, GPU drivers and DKMS, fonts and input methods, a three-family minimal-install comparison, the verdict on not installing a desktop on servers, troubleshooting entry points |
| [KVM Virtualization](../server/virtualization/kvm.md) | Gap table Bird's Server part "Chapter 2 Virtual Machines" and ArchWiki "8.23 Virtualization" were only supported by the container page | The KVM/QEMU/libvirt/virsh relationship, checking CPU hardware virtualization support, three-family installation, NAT and bridged networking, qcow2/raw storage, a full-parameter virt-install example, day-to-day virsh management, snapshots and clones, a division-of-labor table vs containers, common failures |
| [AppArmor in Practice](../security/apparmor.md) | Gap table ArchWiki "8.20 Security": of the two MAC systems only SELinux was written; AppArmor got one row in the hardening page's comparison table | The "path vs label" model comparison, aa-status's three states, reading deny logs, aa-complain for locating, persistent fixes via local/ and abstractions/, aa-logprof/aa-genprof, a custom profile skeleton, the three-family status, container scenarios |
| [Application Scenarios Survey](./application-scenarios.md) (reading-path section added this round) | Gap table scenario row "Edge and embedded" required a reading path | One reading order of this repository's existing pages for each of the four scenario classes (server & cloud, edge & embedded, desktop & development, operations automation) |
| [Cross-Compilation and Embedded](../source/cross-compile.md) (2026-10-09 increment) | Gap table scenario row "Edge and embedded" and this page §3's first entry | The cross-toolchain triplet, kernel cross-compilation (ARCH/CROSS_COMPILE), device trees, BusyBox rootfs and initramfs, the U-Boot boot chain, cross-architecture verification under QEMU, cross gdb debugging |
| [LDAP Unified Account Management](../server/ldap.md) (2026-10-09 increment) | Gap table Bird's Server part "Chapter 11" and this page §3's second entry | The directory service model (DN/LDIF/schema), OpenLDAP on the three families (including the reality that RHEL 8+ removed openldap-servers and the Rocky plus/EPEL alternatives), cn=config, tree creation and queries, TLS, SSSD client enrollment, olcAccess access control |
| [SSH Remote Login](../server/ssh.md) (2026-10-10 increment) | Gap table Bird's Server part "Chapter 10" upgraded from partially covered (client usage was previously scattered across the commands and security parts) | openssh-server on the three families (including the sshd/ssh service-name differences), the key-authentication loop, core sshd_config items plus Match/drop-ins, ~/.ssh/config, firewall and SELinux port labels, common failures |
| [Source Builds and Tarball Installation](../basic/packages/tarball.md) (2026-10-10 increment) | Gap table Bird's Basics part "Chapter 21" upgraded from partially covered (source builds previously had no dedicated section) | The trade-off judgment for source installs, the three families' toolchain groups, configure probes and --prefix, the six-step standard workflow, reading config.log, two uninstall approaches (DESTDIR manifest and GNU stow), the boundary vs package managers, common failures |
| [Cloud Computing and cloud-init](../server/cloud-computing.md) (2026-10-10 increment) | Extended topic registered by the USAH 5e "Cloud Computing" chapter comparison ([Authoritative Books Survey](./authoritative-books.md) §2.1 fetched TOC) | The IaaS/PaaS/SaaS models, instances and images, cloud-init on three families and its four-part unit chain, #cloud-config user data, NoCloud and the metadata service, security groups and VPC concepts, a glimpse of private cloud, common failures |
| [CI/CD and Continuous Delivery](../server/ci-cd.md) (2026-10-10 increment) | Extended topic registered by the USAH 5e "Continuous Integration and Delivery" chapter comparison | The CI/CD boundary, a three-platform comparison (GitHub Actions/GitLab CI/Jenkins), pipeline anatomy and a minimal example, the two artifact kinds (packages and images), four deployment strategies, secrets red lines, common failures |

## 2. Revisions This Round (3, Each With Its Trigger)

1. **The storage part's LVM pointer now lands**. In `docs/hardware/storage.md`, the link for "hands-on LVM belongs to the basics and system-management parts" previously pointed to `../system-management/README.md`, which contained no hands-on LVM content -- a pointer without a landing point; it now points to the new page [LVM Logical Volume Management](../system-management/lvm.md). (Trigger: the gap table's "partially covered → revised this round" row)
2. **The basics software installation chapter's TOC completed the third family**. The chapter intro of `docs/basic/packages.md` changed from "this chapter has two pages" to three and gained the Pacman page entry; the coverage note in `docs/basic/README.md` changed from "Arch's pacman is compared in the distribution introduction" to pointing at the new page. (Trigger: the same gap table row)
3. **The README part table and references gained the research part**. The bilingual READMEs' content tables each gained a research-part row and the references each gained an in-repo survey entry; the feature cards on `docs/index.md` gained the research part and five chapter counts were corrected (basics 36→37, hardware 6→7, system management 8→9, server 16→17, security 7→8). (Trigger: the same gap table row)
4. **systemd official documentation citations gained links** (2026-10-09 increment). The references of `docs/system-management/services-systemd.md` gained the systemd.io project documentation portal and `boot-process.md` gained systemd.io/BOOT's official boot-process description (both URLs measured at 200; the freedesktop man pages return 418 to curl as anti-crawler, existing citations left untouched). (Trigger: the systemd citation gap registered in Official Documentation Survey §3)

Wiring records: `docs/SUMMARY.md` gained the 5 pages and the new "Research" section; `docs/.vitepress/config.mts` gained the research part in nav and the 6 pages plus the `/research/` group in sidebar; the MAC paragraph of `docs/security/hardening.md` gained the two links to the SELinux and AppArmor practice pages.

## 3. Logged as Not-To-Be-Filled (3 Items in the First Round, All Cleared by the 2026-10-09 Increment)

- **The embedded cross-compilation topic** (trigger: Application Scenarios Survey §1.2 -- "cross-compilation" had zero hits repo-wide). The first round only gave a reading path on the scenario page; [Cross-Compilation and Embedded](../source/cross-compile.md) has been added and wired into the source part's TOC.
- **LDAP unified accounts** (trigger: Application Scenarios Survey §1.4 -- the operations main line lacked "multi-machine account consistency"). [LDAP Unified Account Management](../server/ldap.md) has been added and wired into the server part's TOC.
- **The systemd documentation citation gap** (trigger: Official Documentation Survey §3). The two pages, services-systemd and boot-process, gained systemd.io official entry points -- see §2 revision 4.

### 3.1 Second Batch Logged as Not-To-Be-Filled (2026-10-10, the USAH/TLCL Chapter-by-Chapter Round)

Trigger: [Coverage Matrix](./coverage-matrix.md) §4 (USAH's 31 chapters) and §5 (TLCL's 36 chapters) judged item by item. Registered by category below; all are conscious decisions not to write, and can be revisited if the positioning changes:

| Topic | Source | Reason not to fill |
|------|------|---------|
| Printing with CUPS | USAH ch. 12, TLCL ch. 22 | A desktop/office peripheral scenario, weakly related to the server-operations main line; CUPS already appears as a unit example in [systemd Services and Program Management](../system-management/services-systemd.md) |
| Full SSO deployment | USAH ch. 17 | A Kerberos KDC and domain integration need a domain environment, beyond the single-machine learning positioning; [LDAP Unified Account Management](../server/ldap.md) already connects the Kerberos and FreeIPA concepts |
| readline key bindings and history extensions | TLCL ch. 8 | Terminal-usage habit tricks; core features like job control (jobs/fg/bg) are already covered by [Process Management](../commands/system/process.md) |
| Output-formatting utilities (nl/fold/pr) | TLCL ch. 21 | Low-frequency typesetting tools; printf and fmt are already in [Text Processing](../commands/text/text_processing.md) |
| Prompt customization (PS1) | TLCL ch. 13 | Personal terminal configuration; does not affect the system administration main line |
| Misc shell tricks | TLCL ch. 36 | A miscellany; core tricks (heredocs, process substitution) already appear scattered across the scripting part's [Loops](../script/loops.md) and [Practical Examples](../script/examples.md) |

Additionally, USAH ch. 30 (data center facilities and out-of-band management) and ch. 31 (organizational processes and soft skills) are judged "not covered" in the gap table: the former belongs to data center operations, the latter is not a systems-technical topic; neither enters this registry.

### 3.2 Third Batch Logged as Not-To-Be-Filled (2026-10-10, the Debian Handbook Chapter-by-Chapter Round)

Trigger: [Coverage Matrix](./coverage-matrix.md) §6 (the Debian Handbook's 16 chapters) judged item by item -- the last of the three Tier A English books completed its comparison. Registered by category below:

| Topic | Source | Reason not to fill |
|------|------|---------|
| Real-time communication and proxy services (Squid, SIP/XMPP/TURN) | ch. 11 Network Services | Enterprise-specific protocol stacks, weakly related to the single-machine learning main line; the same chapter's Postfix, Apache, NFS, Samba, and LDAP already have dedicated pages, so the chapter is substantively covered |
| The Debian packaging workflow (`dpkg-buildpackage`, debhelper) | ch. 15 Creating a Debian Package | A distribution packager skill, not the system administration main line; source builds are covered by [Source Builds and Tarball Installation](../basic/packages/tarball.md), and packaging into your own repository is outside this repository's positioning |

Additionally, ch. 2 (Presenting the Case Study, the book's continuous narrative vehicle) and ch. 16 (Conclusion, community outlook) are judged "not covered" -- non-technical topics -- and do not enter this registry.

### 3.3 Fourth Batch Logged as Not-To-Be-Filled (2026-10-10, Second Round: How Linux Works / Linux Bible Chapter-by-Chapter)

Trigger: [Coverage Matrix](./coverage-matrix.md) §7 (How Linux Works 3e, 17 chapters) and §8 (Linux Bible 11e, 31 chapters) judged item by item -- the last two of the five Tier A English books completed their comparisons. Registered by category below:

| Topic | Source | Reason not to fill |
|------|------|---------|
| Device files and udev rules | HLW ch. 3 Devices | Device node and sysfs semantics already appear scattered across [Storage Devices](../hardware/storage.md), [Directory Hierarchy](../basic/filesystem/hierarchy.md), and the source part's driver framework; udev rule details belong to device adaptation (same criterion as ArchWiki 4.9 laptop adaptation) |
| Cloud provider console deployment | Linux Bible ch. 29 | Hands-on work in a specific platform's console (AWS etc.), beyond the single-machine learning positioning; [Cloud Computing and cloud-init](../server/cloud-computing.md) already covers the cross-cloud general mechanisms: the IaaS model, instances and images, security groups, and VPC |
| Kubernetes multi-node orchestration | Linux Bible ch. 31, HLW §17.2.4 | Orchestration systems exceed the single-machine positioning; the [Containers](../server/container/docker.md) page's Compose section already states the boundary judgment -- "revisit Kubernetes once the scope exceeds a single machine (multi-node scheduling, rolling upgrades, service discovery)" -- and the landing point is the judgment itself |
| Local deployment of an AI chatbot | Linux Bible ch. 22 | LLM application deployment belongs to application software, at odds with the "learn Linux itself" positioning (a new chapter in the 11th edition, with no legacy comparison pressure) |

Additionally, HLW ch. 15 (Development Tools: gcc/make/lex/yacc) follows the ArchWiki round's "2.x development toolchains not covered" verdict, and Linux Bible ch. 16 (Configuring a Print Server) follows the printing registration (USAH ch. 12); neither is re-entered into the table.

## 4. Items To Retest (Downgraded in the 2026-10-08 Network-Outage Round) and Retest Results (Executed 2026-10-09)

The original network status is in the [Overview](./README.md): on 2026-10-08 the overseas link went down and the survey was downgraded to mirror fetches plus existing verification records. **On 2026-10-09 the egress recovered and the following retests were completed the same day**:

| Item | 10-08 status | 10-09 retest | Conclusion |
|------|-----------|-----------|------|
| `linux.vbird.org` Basics TOC | Official site unreachable; taken from the mirror | curl fetched the official page at 200; 24 chapter titles compared item by item | Identical to the mirror version; [Authoritative Books Survey](./authoritative-books.md) §1.1 upgraded to a direct official fetch |
| `linux.vbird.org` Server TOC | Same | Official page 200; 12 chapter titles compared item by item | Identical to the mirror version; §1.2 likewise upgraded |
| `wiki.archlinux.org` TOC page | Official site unreachable; taken from the Chinese mirror | Official page 200; parsed out 8 top-level categories and 337 numbered entries | Structure matches the mirror (336→337 is mirror lag; per-category counts ±1, e.g. 4.16 Storage 17→18, 8.12 Kernel 37→36, 8.20 Security 39→38); [Official Documentation Survey](./official-docs.md) §2's category structure upgraded to a direct official fetch |
| `www.debian.org/doc/manuals/debian-handbook/` | Tier C, not fetched | 200, landing page readable, bibliography confirmed (Debian Bullseye from Discovery to Mastery, Raphaël Hertzog / Roland Mas) | Entry point confirmed; the chapter-level TOC is hosted on debian-handbook.info, unfetched this round; stays Tier C with no chapter details cited |
| `docs.kernel.org` | Tier C, not fetched | 200 | Entry point reachable; the documentation sections were not fetched item by item; stays Tier C |
| `systemd.io` | Tier C, not fetched (registered as a citation gap) | 200 | Entry point reachable; the citation gap stays registered in §3 |
| `web.archive.org`, `linuxcommand.org`, `man7.org`, `pubs.opengroup.org`, `tldp.org`, mirrors `vbird.org.cn`, `wiki.archlinux.org.cn` | — | All 200 | All channels restored |
| `www.gnu.org` | Failed in the outage round | Still failing (curl connection-layer 000; one retry the same) | The domain-level problem persists; GNU manual citations keep relying on the existing verification round's records (Tier B); no new citations |
| `docs.redhat.com` | 403 anti-crawler | 403 (expected) | Anti-crawler behavior consistent with the past; the dual-channel arbitration conclusion (Tier B) unchanged |
| The four English books (The Linux Command Line etc.) | Tier C, bibliographic only | linuxcommand.org 200; publisher entry points reachable | Same-day continuation completed C→A: TLCL and China's TOCs fetched and upgraded to A; the Debian Handbook's chapter TOC likewise fetched; How Linux Works and Linux Bible stayed Tier C -- details in §4.2 |

Retest baseline: curl with a browser UA, `--max-time 15`, one direct visit per domain's homepage/TOC page (the no-retry-on-transient principle matches past inspections; only `www.gnu.org` got one retry to rule out a fluke).

### 4.1 Verifying the In-Page "Verify Per Version" Markers (2026-10-09)

| Item | Verification method | Result and disposition |
|------|---------|-----------|
| KVM page: `virt-install` is a separate package on Arch and `dnsmasq` is an optional dependency needing explicit install | Arch's official package API (archlinux.org/packages/search/json) queried item by item | The `virt-install` package is in extra (5.1.0), `qemu-full` is in extra, and `dnsmasq` is a standalone extra package -- the page's wording matches the official package data, so the marker can be withdrawn (the page itself never carried a marker; logged here for the record) |
| Desktop graphics stack page: the RHEL/Rocky minimal X group name `base-x` | Fedora comps (pagure raw files) and Rocky comps, multiple sources | All unreachable (pagure raw 404, Rocky comps lacks the file, no wayback snapshot) -- **not confirmed**. The page's wording was downgraded: the verbatim group name was removed in favor of "run `dnf group list` and go by the actual output", with a note that this revision could not confirm it from public comps sources |
| Cross-compile page: the package source of `dtc` on the RHEL family (suspected via EPEL) | CentOS Stream 9 mirror directory (AppStream/BaseOS package lists) | `dtc-1.6.0-7.el9` is right in AppStream -- direct install on EL9; the page was changed to "in AppStream on EL9; older releases, if missing, go via EPEL", marker withdrawn |
| Cross-compile page: whether RHEL-family gdb ships multi-architecture targets | The Fedora gdb.spec source (src.fedoraproject.org) | The spec clearly builds `--enable-targets` for all targets -- one RHEL-family gdb binary covers everything; the page was changed to an affirmative statement, marker withdrawn |

### 4.1.1 Verifying the In-Page "Verify Per Version" Markers (2026-10-10 Round)

The 5 markers added after or surviving the previous round were verified one by one; all four pages dropped their markers in favor of affirmative sentences:

| Item | Verification method | Result and disposition |
|------|---------|-----------|
| SSH page: the `TrustedUserCAKeys` entry | Read directly from the local man sshd_config (OpenSSH 10.2p1) | The entry exists, spelled TrustedUserCAKeys (the page's original TrustedUserCAkeys was a typo, corrected along the way); marker withdrawn, replaced with "the directive is per man sshd_config" |
| Cloud computing page: the RHEL-family package name of cloud-utils-growpart | CentOS Stream 9 AppStream package directory listing | `cloud-utils-growpart-0.31-10.el9` is in the repository; marker withdrawn, replaced with an affirmative statement plus the measured version |
| LDAP page: Arch's slapd listen-configuration path | The Arch Wiki OpenLDAP page fetched | `SLAPD_URLS` in `/etc/conf.d/slapd` is read by slapd.service; marker withdrawn, replaced with an affirmative statement (the previous "overridden by the systemd unit" wording was inaccurate, replaced with the measured path) |
| LDAP page: how the memberof overlay is loaded | man slapo-memberof(5) (manpages.ubuntu.com) plus the OpenLDAP 2.6 administration guide (openldap.org; both sources 200) | Dynamic configuration loads via back-config (`olcModuleLoad: memberof` + `olcOverlay: memberof`; the parameter family was renamed `olcMemberOfConfig` in 2.5), while static slapd.conf deployments write `overlay memberof` -- the syntax is stable across 2.4/2.5/2.6, marker withdrawn |
| CI/CD page: the degree of Gitea Actions compatibility | docs.gitea.com official docs (text fetched via the web_reader channel) | The official line: built in since 1.19, designed to be compatible with GitHub Actions with documented differences (there is a dedicated "Compared to GitHub Actions" page); marker withdrawn, replaced with an affirmative statement, and a Gitea docs link added to the references |

### 4.2 The C→A Upgrades of the Four English Books and the Debian Handbook (2026-10-09 Continuation)

The §4 table's last row registered "C→A upgrade deferred until the TOC text is fetched"; that was continued the same day, book by book; the verbatim chapter titles land in [Authoritative Books Survey](./authoritative-books.md) §2.1:

| Book | Fetch source | Result |
|----|---------|------|
| The Linux Command Line | linuxcommand.org/tlcl.php bibliographic page + the official free PDF `TLCL-25.12A` (direct from the official SourceForge project, 533 pages) | Upgraded to A: 7th web edition (PDF copyright page © 2026), the 4-part 36-chapter TOC fetched |
| UNIX and Linux System Administration Handbook | Official site admin.com (which self-describes as the 5th edition) sample TOC samples/TOC.pdf | Upgraded to A: the 4-section 31-chapter TOC fetched |
| The Debian Handbook | debian-handbook.info's official online TOC page (stable, Debian 11 Bullseye) | Upgraded to A: the 16-chapter TOC fetched (this book was the "chapter-level TOC hosted on debian-handbook.info, unfetched this round" item in the §4 table) |
| How Linux Works | nostarch.com product page fetched | Stayed C: no TOC block on the page, no sample-chapter PDF link |
| The Linux Bible | Wiley product page fetched (ISBN 9781119909792) | Stayed C: bibliographic fields only; the TOC is rendered by front-end scripts and unavailable to static fetching |

The citation discipline updates accordingly: the three Tier A books may have their chapter structures (parts and chapter titles) cited in the body; the two Tier C books are still cited as "title + publisher + entry point".

### 4.3 The Remaining Two English Books' C→A Upgrades (2026-10-10, Second Round)

The two books that §4.2 recorded as "stayed C" were completed the same day, each with a first-hand publisher TOC source located:

| Book | Fetch source | Result |
|----|---------|------|
| How Linux Works, 3rd Edition | nostarch.com's new [product page](https://nostarch.com/howlinuxworks3) (Table of contents block with the full chapter list) cross-checked against the official [detailed TOC PDF](https://nostarch.com/download/samples/HLW3rd_DTOC.pdf) | Upgraded to A: Introduction + 17 chapters. The product page's chapter list mislabels ch. 15 as "The Big Picture" while the detailed TOC PDF says "Development Tools"; the PDF wins, archived in [Authoritative Books Survey](./authoritative-books.md) §2.1. The old product page recorded in §4.2 (`/how-linux-works-3rd-edition`) now 404s -- the "no TOC block" conclusion was an artifact of the old page layout |
| The Linux Bible | Wiley's official [11th-edition product page](https://www.wiley.com/en-us/linux-bible-11th-edition-p-9781394317462) (ISBN 978-1-394-31746-2, 2025-12, 896 pages) + the on-page official TOC PDF (`media.wiley.com/product_data/excerpt/68/13943174/1394317468-12.pdf`) | Upgraded to A: 6 parts, 31 chapters (the 11th-edition TOC). The §4.2 record "TOC rendered by front-end scripts" was a conclusion about the old page; additionally, the originally registered ISBN `9781119909792` corresponds to nothing on the publisher's page or in public search and was corrected with the ISBN fetched from the official page |

Auxiliary channel records: the Google Books API was over quota that day (429) and OpenLibrary has no TOC field; neither was used. Both books' TOCs ultimately came from the publishers' own pages/sample files -- Tier A first-hand sources. All five English books are now Tier A; the chapter-by-chapter comparisons are in [Coverage Matrix](./coverage-matrix.md) §7 and §8.

### 4.4 Fetching the docs.kernel.org Documentation Sections (2026-10-10)

The §4 table's docs.kernel.org item "documentation sections not fetched item by item, stays Tier C" was continued the same day: the official homepage fetched at 200, and all 21 top-level sections plus this repository's 6 cited areas (scheduler, process, networking, mm, kbuild, devicetree) were confirmed reachable; [Official Documentation Survey](./official-docs.md) §3 upgraded that row to A. The documentation body is still not cited piece by piece -- the A upgrade covers only the section structure and entry points; citations of body details keep following the existing discipline of preferring the kernel source (elixir).

<!-- BACKLINKS-AUTO -->
## Related Pages

- [knowledge](/knowledge.md)
- [README](README.md)
- [application-scenarios](application-scenarios.md)
- [authoritative-books](authoritative-books.md)
- [coverage-matrix](coverage-matrix.md)
- [official-docs](official-docs.md)
