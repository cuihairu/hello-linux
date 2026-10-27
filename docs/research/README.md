# Research Overview

This set of documents answers three questions: what do authoritative books and official documentation cover, how much of it does this repository actually cover, and what do we do about the difference. The output lands in four steps, mapped to four kinds of files:

| File | Content | Corresponding step |
|------|------|---------|
| [Authoritative Books Survey](./authoritative-books.md) | Measured tables of contents for both parts of Bird's Private Recipes plus TLCL/USAH/Debian Handbook, and the positioning of the other English books | ① Survey |
| [Official Documentation Survey](./official-docs.md) | The official documentation list from ArchWiki, Debian, kernel.org, Red Hat, etc., with this repository's external-link citation counts | ① Survey |
| [Application Scenarios Survey](./application-scenarios.md) | What documentation demands arise from four scenario classes: servers, cloud computing, edge & embedded, desktop development | ① Survey |
| [Coverage Matrix and Gap Table](./coverage-matrix.md) | Each source topic mapped to a page in this repository, judged as covered/partially covered/gap/not covered | ③ Coverage check |
| [Gap Fill and Revision Log](./gap-fill.md) | The pages added in this round and the revision records, each tagged with the gap entry that triggered it | ④ Fill gaps and revise |

## Source Tiers and Verification Status

Citations come in three tiers; every source in the body is labeled, so later readers can judge how much to trust it:

- **Tier A, actually fetched this round**: on 2026-10-08/09 the pages were fetched and read on this machine; all statistics and TOC entries come from the fetched results.
- **Tier B, verified against the existing repository**: the repository's `scripts/check_links.py` already verified the URL was reachable during an external-link check round, with the round and result recorded in the README maintenance notes; this round does not re-fetch the body.
- **Tier C, bibliographic data only**: only stable facts such as title, author, publisher, and site entry points are cited; no TOC or body was fetched, and no detail from it is cited.

**This round's network status**: on 2026-10-08 all access from this machine to overseas sites failed (TLS handshakes interrupted; `linux.vbird.org`, `wiki.archlinux.org`, `www.debian.org`, `docs.kernel.org`, `systemd.io`, `www.gnu.org`, `web.archive.org` all returned `curl: (35) SSL routines::unexpected eof while reading`, and DNS returned fake 198.18.x.x addresses, indicating the egress link was broken at the router side, not a local configuration issue). This round therefore used two accessible channels for evidence:

1. **Mirror sites**: `vbird.org.cn` (a mirror of Bird's site, Tier A) and `wiki.archlinux.org.cn` (a Chinese mirror of ArchWiki, Tier A, not an officially acknowledged mirror, used only for category structure).
2. **The repository's existing external-link verification records** (Tier B), plus tool output measured locally (`lsblk`, `aa-status`, `qemu-system-x86_64 --version` on Ubuntu 26.04).

The list of items to retest once the overseas link recovers is in the "To Retest" section of [Gap Fill and Revision Log](./gap-fill.md). **The 2026-10-09 retest has been executed**: of the original "unreachable" list, `linux.vbird.org`, `wiki.archlinux.org`, `www.debian.org`, `docs.kernel.org`, `systemd.io`, and `web.archive.org` were measured at 200 (`www.gnu.org` still fails at the connection layer), and both Bird's tables of contents and the ArchWiki category structure were checked line by line against the official sites and matched; details and the upgrade conclusions are in [Gap Fill and Revision Log](./gap-fill.md).

## Key Conclusions

- This repository has 144 TOC entries; all 25 chapters of Bird's Basics and all 12 chapters of the Server Setup part have landing points, and among the eight ArchWiki top-level categories, the ones related to server operations are essentially covered.
- 6 gaps confirmed, all filled with new pages: the Arch package management entry page, hands-on LVM, the desktop graphics stack, KVM virtualization, AppArmor, and application scenarios.
- Follow-up increment (2026-10-09): the two items initially logged as not-to-be-filled have been filled ([Cross-Compilation and Embedded](../source/cross-compile.md), [LDAP Unified Account Management](../server/ldap.md)), bringing the total gap pages to 8; links added for the systemd official documentation citations; every "verify per version" marker checked item by item or demoted; the tables of contents of TLCL, USAH, and Debian Handbook were actually fetched, completing the C→A upgrades -- details in [Gap Fill and Revision Log](./gap-fill.md).
- The knowledge points distilled from the survey output are collected into a single page, [Knowledge Points](../knowledge.md): core concepts, book and documentation highlights, scenarios and pitfalls, each with a source citation and back-links to the pages of this part.
- Follow-up increment (2026-10-10): the partially-covered SSH entry in the gap table got its own page, [SSH Remote Login](../server/ssh.md) (server part), and the gap table and this page's §1 verdicts were upgraded in sync; the same day, "Chapter 21" of the basics part got [Source Builds and Tarball Installation](../basic/packages/tarball.md), upgrading the gap table §1 verdicts; the USAH 5e extended topics Cloud Computing and Continuous Integration and Delivery landed as two pages, [Cloud Computing and cloud-init](../server/cloud-computing.md) and [CI/CD and Continuous Delivery](../server/ci-cd.md), logged in [Gap Fill and Revision Log](./gap-fill.md). The same day all 31 chapters of USAH 5e and all 36 chapters of TLCL were checked item by item into [Coverage Matrix](./coverage-matrix.md) §4 and §5, every exposed landing point was judged, and 6 logged as not-to-be-filled -- see gap-fill §3. The Debian Handbook (Bullseye edition), 16 chapters, was checked item by item the same day into the gap table §6: 12 chapters covered, 2 logged as not-to-be-filled (real-time communication and proxy services, the Debian packaging workflow) -- see gap-fill §3.2.
- Follow-up increment (2026-10-10, second round): the remaining two Tier C books completed their C→A upgrades -- *How Linux Works* 3e via the No Starch new-edition product page plus the official detailed TOC PDF (17 chapters), and *The Linux Bible* via the Wiley 11th-edition product page plus the official TOC PDF (6 parts, 31 chapters, which also corrected the invalid ISBN originally logged). Both were then checked chapter by chapter into [Coverage Matrix](./coverage-matrix.md) §7 and §8 (15 / 27 chapters covered), with 4 logged as not-to-be-filled -- see gap-fill §3.3 -- completing the survey: all five English authoritative books are now Tier A and checked chapter by chapter, with no Tier C books remaining.
- 3 revisions made: the "hands-on LVM belongs to the basics and system-management parts" pointer in the storage part previously had no landing point and now points to the new page; the research part was added to the README part table and references; the software installation chapter's TOC completed the third distro family.
- "Verify per version" markers cleared (2026-10-10): the 5 remaining markers across the ssh, ldap, cloud-computing, and ci-cd pages were checked one by one (five-way evidence: man sshd_config, CentOS Stream 9 mirrors, the Arch Wiki, man slapo-memberof plus the OpenLDAP administration guide, docs.gitea.com), all removed in favor of affirmative sentences, and a TrustedUserCAkeys spelling typo was corrected along the way -- details in [Gap Fill and Revision Log](./gap-fill.md) §4.1.1.
- The repository has 970 external links across 162 domains (retested 2026-10-10, including the added source links for the *How Linux Works* / *Linux Bible* TOCs); the top four are `wiki.archlinux.org` (251 links / 120 pages), `linux.vbird.org` (102 links / 96 pages), `man7.org` (51 links / 31 pages), and `docs.redhat.com` (46 links / 46 pages) -- the actual citation density of authoritative sources matches the survey conclusions.
- Cross-statistics synced (2026-10-10, third round): five counts and tiers on the knowledge-points page's source table -- Debian (37), kernel documentation (C→A, upgraded with Official Documentation Survey §4.4), Red Hat (46), GNU (40), man pages (51 / 43) -- plus the systemd citation count in [Official Documentation Survey](./official-docs.md) §3 (2→5) and the Bird citation count in [Authoritative Books Survey](./authoritative-books.md) §3 (100/94 → 102/96 pages) were aligned per that day's full-scan baseline; [Coverage Matrix](./coverage-matrix.md) §9 gained a virtualization row (aligned with this part's §2's six requirements), and [Application Scenarios Survey](./application-scenarios.md) §2's disposition column was unified to "page added".

<!-- BACKLINKS-AUTO -->
## Related Pages

- [knowledge](/knowledge.md)
- [gap-fill](gap-fill.md)
