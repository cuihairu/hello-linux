[English](README.md) | [中文](README.zh.md)

<p align="center"><img src="docs/public/logo.svg" width="64" height="64" alt="logo" /> </p>

# Hello Linux

<p align="center">
  <img src="docs/public/badges/topic.svg" alt="topic" />
  <img src="docs/public/badges/docs.svg" alt="docs" />
  <img src="docs/public/badges/license.svg" alt="license" />
  <img src="docs/public/badges/langs.svg" alt="langs" />
</p>

<div align="center">

</div>

Learn Linux from the ground up, with VBird's Linux notes and the Arch Wiki as the primary references, covering three distribution families: Debian/Ubuntu, Arch, and RHEL/CentOS/Rocky.

## Contents

| Section | Description |
|------|------|
| [Fundamentals](https://cuihairu.github.io/hello-linux/basic/overview.html) | Concepts, installation, filesystems, the boot process, package management, user management, services, security, logging |
| [Commands](https://cuihairu.github.io/hello-linux/commands/basic/file.html) | Command reference for files/directories, text processing, searching, compression, system, networking, and package management |
| [Hardware](https://cuihairu.github.io/hello-linux/hardware/architecture.html) | Architecture, CPU, memory, storage, network devices |
| [System Administration](https://cuihairu.github.io/hello-linux/system-management/performance.html) | Performance tuning, backup and recovery, operations automation, scheduled jobs, systemd services, logging, the boot process |
| [Servers](https://cuihairu.github.io/hello-linux/server/web/nginx.html) | Network parameters, routing and NAT, web servers, databases, Redis, FTP, containers, monitoring, DNS, mail, DHCP, Samba, NFS, NTP |
| [Scripting](https://cuihairu.github.io/hello-linux/script/bash-basics.html) | Bash basics, variables, conditionals, loops, functions, text processing, regular expressions, debugging, worked examples |
| [Security](https://cuihairu.github.io/hello-linux/security/firewall.html) | Firewalls, intrusion detection, cryptography, hardening, PAM/sudo, hands-on SELinux |
| [Networking](https://cuihairu.github.io/hello-linux/network/basics.html) | Networking basics, firewalls, VPN, load balancing, network monitoring, configuration fundamentals, troubleshooting, TCP/IP essentials, command practice |
| [Kernel Source](https://cuihairu.github.io/hello-linux/source/README.html) | Obtaining and building the kernel source, scheduling, memory, VFS, the network stack, interrupts, IPC, drivers, system calls |
| [Research](https://cuihairu.github.io/hello-linux/research/README.html) | Surveys of authoritative books and official documentation, application scenarios, the coverage matrix, and the gap-fill record |
| [Knowledge Notes](https://cuihairu.github.io/hello-linux/knowledge.html) | The survey output consolidated: core concepts, key points from the books and official documentation, application scenarios, and common pitfalls |

The full table of contents is at [SUMMARY](https://cuihairu.github.io/hello-linux/SUMMARY.html).

## Features

- Every chapter comes with runnable command examples and real terminal output
- Covers Debian/Ubuntu, Arch, and RHEL/CentOS/Rocky side by side
- All references are cited; no content is fabricated
- Built on VitePress, with local search support

## Run locally

```bash
npm install
npm run docs:dev
```

Build and preview:

```bash
npm run docs:build
npm run docs:preview
```

Link checks and tests (the same gates CI runs):

```bash
npm run docs:check   # run docs:build first to include the artifact-level HTML checks
npm run docs:test    # unit tests
npm run docs:cov     # coverage: 100% line+branch gate over check_links and tree_art (fail_under=100)
```

## Scripts in this repo

| Script | Purpose |
|------|------|
| `scripts/check_links.py` | Link checker: source level (md links/anchors/images) + index level (SUMMARY must cover every content page, and every entry must appear in the nav/sidebar) + artifact level (HTML links/anchors/resources) + sitemap reconciliation (every loc resolvable, every page listed). `npm run docs:check` invokes it; CI additionally passes `--require-html` to enforce the artifact-level checks |
| `scripts/tree_art.py` | Multi-color ASCII-art tree renderer: seeded elevation and humidity fields generate an island world, rivers carve their way to the sea, and quadtree character composition layers three color channels (terrain, water, biomes). No third-party dependencies; `--seed` determines the world, and the same seed reproduces the same output |

Usage of `tree_art.py` (all commands below have been run and verified):

```bash
# Full-color ANSI output in the terminal (default 160×64)
python3 scripts/tree_art.py --seed 7

# Quiet mode + preview HTML with a legend
python3 scripts/tree_art.py --seed 7 --w 80 --h 32 --quiet --html tree.html

# Add --png to capture a screenshot (requires playwright)
python3 scripts/tree_art.py --seed 7 --html tree.html --png tree.png
```

## Build and deployment

Pushes to the `main` branch are deployed to GitHub Pages automatically through GitHub Actions. The build generates `sitemap.xml` (covering every content page and picking up new pages automatically; the base prefix for a sub-path site is added inside `transformItems`). `robots.txt` allows crawling site-wide and points to the sitemap above.

## References

- [VBird's Linux notes](https://linux.vbird.org/)
- [Arch Wiki](https://wiki.archlinux.org/)
- [The Debian Handbook](https://www.debian.org/doc/manuals/debian-handbook/)
- [RHEL documentation](https://docs.redhat.com/)
- On-site survey: [Research section](https://cuihairu.github.io/hello-linux/research/README.html) (source comparison and coverage audit of this repo)
- Consolidated notes: [Knowledge Notes](https://cuihairu.github.io/hello-linux/knowledge.html) (concepts, books, documentation, scenarios, and pitfalls in one page)

## Maintenance notes

- 2026-10: external-link residue batch (close-out of the full external-link audit). The docs.redhat.com domain returns 403 to curl site-wide (anti-bot), so link liveness was arbitrated through two channels: WebFetch direct access plus access.redhat.com 301 redirects. Thirteen links were confirmed dead and fixed: the installation guide moved to `interactively_installing_rhel_from_installation_media` (boot.md, bios_uefi.md); the GRUB2 kernel command line chapter path was folded into the book root `managing_monitoring_and_updating_the_kernel` (grub.md); `html-single/managing_storage` was merged into `managing_storage_devices` (acl_permissions.md, disk_quotas.md); after the `identity_management` split, the "managing users and groups" content landed in chapter 7 of `configuring_basic_system_settings` (users.md; account_management.md, which had pointed at using_selinux by mistake, was moved there as well); `compressing_and_archiving_files` and `searching_files_and_file_contents` were retired from the RHEL 9 catalog and replaced with the GNU tar/findutils manuals (compression.md, find-and-locate.md); a stray `installing_` prefix in the DNF book slug was corrected (package.md); the retired book `getting_started_with_the_red_hat_enterprise_linux_console` was replaced with VBird's basics volume (commands/README.md); the tcpdump chapter was removed from the monitoring book in favor of its book root (network-tools.md); the Arch Wiki `Network_debugging` page was taken down and replaced with `Network_configuration` (network-tools.md); and the `html-single` path in hardware/network.md was normalized to the `html` form. Suspected-dead links that proved alive on re-verification: `configuring_and_managing_networking`, `monitoring_and_managing_system_status_and_performance` (transient 404s, re-checked via 301 plus catalog listing), uefi.org (reachable in a browser, curl is blocked), and the RHEL 7 backup volume plus the security_hardening LUKS chapter (reachable again after 403/transient responses). The last group of suspected transients was classified as alive and kept: man.archlinux.org ×42 (corroborated by a wayback snapshot from 2026-07 returning 200; the local egress was rate-limited at the connection layer, a probe-side problem), help.ubuntu.com ×4 (domain root snapshot 200 on 2026-09-30; the 503/429 responses are anti-bot, not 404), and the groups.google.com thread (snapshot 200 from 2026-07); bare fonts.googleapis.com/gstatic hosts are legitimate config preconnects and are not counted as external links.
- 2026-10: site inspection round (the 126 catalog entries were checked against SUMMARY and the site's actual 128 pages, including the catalog and home pages, plus sampled external links from the references). Conclusion: pages match the catalog, with no thin pages or empty sections; `check_links` static and artifact-level checks are all green at 23462/23462. External-link sampling covered 54 pages / 291 links: 269 healthy, 10 confirmed dead and replaced with alternatives verified reachable (docs.kernel.org suffix migration, the Arch Wiki Checklist merged into its main entry, a chrony documentation path migration, renumbering of VBird's NFS chapter, man7 retiring the at/ping/mtr pages in favor of man.archlinux.org, the RHEL 9 firewall guide moving from `configuring_and_managing_firewalls` to `configuring_firewalls_and_packet_filters` (including a RHEL 8-era assembly path in the security volume), and the retired Cisco 21284 document replaced by the 22166 BGP troubleshooting page); 7 anti-bot false positives kept (elixir.bootlin.com ×5, cisecurity.org ×2, all 200 with a browser UA); 6 network transients (000/ERR) recorded without changes (security.appspot.com, proftpd.org, hub.docker.com, wireguard.com, openvpn.net, libreswan.org).
- 2026-10: cleaned up a dangling stash (an old WIP based on `9c8c35f` that mixed home-page card emoji removal, README heading reshuffling, inline-style extraction, and a vitepress upgrade). merge-tree showed that two of its files conflict with the current migrated content; the style extraction and the dependency upgrade were landed in final form by later commits (`theme/style.css` with its dark-mode fix, and `2.0.0-alpha.20` in package.json), and the home-page card emojis were the intended style at the time (in `style.css`, "remove decorative emoji" referred only to tables inside the docs; that batch of emojis was later removed with the 2026-10 layout cleanup), so the stash was dropped rather than migrated.

## License

[Apache License 2.0](LICENSE)
