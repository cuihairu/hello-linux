# Software Installation

## Chapter Introduction

Installing software is the most frequently performed operation after you start using Linux, and it is also where the three distribution families differ most starkly: the same "install nginx" is `sudo apt install nginx` on Debian/Ubuntu, `sudo dnf install nginx` on Rocky, and `sudo pacman -S nginx` on Arch -- behind these three commands lie three mutually incompatible package formats (`.deb` / `.rpm` / `.pkg.tar.zst`), three independently maintained repositories, and three entirely different upgrade philosophies. Copying an APT command to Arch only gives you `command not found`, which is nearly a rite of passage for anyone switching distros. A more insidious pitfall is in the upgrade step: APT and DNF allow a two-step "refresh index first, upgrade later" workflow, while Arch's rolling-release model requires `pacman -Syu` to be atomic -- refreshing the index without upgrading (the community calls it a partial upgrade) pairs new libraries with old software, producing a pile of cryptic `error while loading shared libraries` failures. These differences are not about command syntax; they are a direct consequence of the release model, and the goal of this chapter is for you to know both what to do and why.

This chapter has four pages: the APT page covers the Debian/Ubuntu family from the `apt`/`dpkg` layering through repositories, caches, and version pinning; the YUM/DNF page takes DNF as the main thread (noting compatibility with old YUM), covering the RPM layer, EPEL extension repos, and version locking; the Pacman page fills in the Arch family with the rolling-release model, the atomicity of `-Syu`, and the boundary of AUR; the source-compilation and tarball page handles the three cases that package managers cannot cover (not in the repos, version too old, need to modify the code), giving the full flow from configure to an uninstall manifest. The first three pages each include a cross-family comparison table, so switching between families no longer requires guesswork.

> This page uses **Debian/Ubuntu, Arch, and RHEL/CentOS/Rocky**, the three major distribution families, as the running comparison. Any specific command or default-behavior difference is labeled with the family it belongs to. Content adapted from the Debian manual, RHEL documentation, and the Arch Wiki; see the references at the end.

## What This Chapter Covers

What this chapter records, spread across the four pages:

1. **Decide which package manager to use**: on an unfamiliar machine, first `cat /etc/os-release` to check the `ID` field, then decide whether to use `apt`, `dnf`, or `pacman` -- do not type from memory.
2. **Complete six core operations**: for any family, independently install, upgrade, search, manage repos, clean caches, and pin versions, and know the corresponding commands.
3. **Understand the layering**: know that `apt`/`dnf`/`pacman` are the high-level tools, the underlying layer being `dpkg`/`rpm`/`pacman` itself, and where and when dependency resolution happens.
4. **Distinguish repositories from caches**: an index (cache) is just a "menu," not the installed software; the index-refresh commands for the three families are `apt update`, `dnf makecache`, and `pacman -Sy` respectively.
5. **Understand version pinning**: when you need to lock a specific package version (kernel, glibc, etc.), use `apt-mark hold`, `dnf versionlock`, and pacman-related mechanisms to prevent accidental upgrades.
6. **Avoid upgrade disasters**: do not perform a partial upgrade on Arch; do not run `apt full-upgrade` on a production machine without reviewing the change list.

## Sub-Page Guide

The four pages are ordered along package-management scenarios (each page roughly 12-18 minutes):

- **[APT Package Management](./packages/apt.md)** -- the Debian/Ubuntu family's main thread. It starts from "why split `apt` and `dpkg` into two layers," covers install/upgrade/search/remove with real terminal output, dissects the differences between `/etc/apt/sources.list` (old format) and `ubuntu.sources` (Ubuntu 24.04+ deb822 format), covers PPA and domestic mirror configuration, cache cleanup (`clean`/`autoclean`) and `apt-mark hold` version pinning, and closes with a per-item comparison against DNF and `pacman` plus common pitfalls like repairing a broken dpkg state. This page answers "how to install software on Debian/Ubuntu."

- **[YUM/DNF Package Management](./packages/yum.md)** -- the RHEL/CentOS/Rocky family's main thread, with **DNF** as the primary focus and compatibility with old YUM noted (the `dnf-yum` plugin keeps the `yum` command working). It covers DNF install/upgrade/search/repo management, RPM-level commands (`rpm -ivh`, `-qf`, `-ql`), EPEL extension repos and module streams, `dnf versionlock` pinning and `dnf clean` cache management, cross-references APT and Arch `pacman`, and notes the CentOS 7 EOL situation. This page answers "how to install software on the RHEL family."

- **[Pacman Package Management](./packages/pacman.md)** -- the Arch family's main thread. It starts from the rolling-release model: why `pacman -Syu` must be atomic, why partial upgrades are officially unsupported. It covers the core/extra/multilib repository division of labor, daily commands using the `-S`/`-R`/`-Q` letter-verb system, cache management (`paccache`), the role of AUR and the full `makepkg` flow from PKGBUILD to install, plus Arch-specific pitfalls like keyring expiry and `.pacnew` files. This page answers "how to install software on Arch."

- **[Source Compilation and Tarball Installation](./packages/tarball.md)** -- the fallback route when package managers fall short. It clarifies when to go from source (not in the repos, version too old, need to modify code), the detection logic of `./configure --prefix` and the `/usr/local` convention, the six-step standard workflow and how to read `config.log`, two solutions to the uninstall problem (DESTDIR manifest and GNU stow), and the long-term cost of source installs being disconnected from the package database. This page answers "how to install software when package managers cannot cover the case."

## Three-Family Differences at a Glance

This is the most important index of the chapter, covering the six required dimensions (install, upgrade, search, repos, cache, pinning). The three families are highly similar on "install/remove/search"; the real watershed is the **upgrade model** and **repository configuration method**:

| Operation | Debian/Ubuntu (`apt`) | Arch (`pacman`) | RHEL/CentOS/Rocky (`dnf`) |
|-----------|----------------------|-----------------|---------------------------|
| Install | `sudo apt install nginx` | `sudo pacman -S nginx` | `sudo dnf install nginx` |
| Remove | `sudo apt remove nginx` | `sudo pacman -R nginx` | `sudo dnf remove nginx` |
| Upgrade system | `sudo apt update && sudo apt upgrade` | `sudo pacman -Syu` (must be combined) | `sudo dnf upgrade` |
| Search | `apt search nginx` | `pacman -Ss nginx` | `dnf search nginx` |
| Package info | `apt show nginx` | `pacman -Si nginx` | `dnf info nginx` |
| Repo config | `/etc/apt/sources.list`, `*.sources` | `/etc/pacman.conf` + `/etc/pacman.d/mirrorlist` | `/etc/yum.repos.d/*.repo` |
| Refresh index | `sudo apt update` | `sudo pacman -Sy` | `sudo dnf makecache` |
| Clean cache | `sudo apt clean` (removes .deb) | `sudo pacman -Scc` (removes package cache) | `sudo dnf clean all` |
| Version pin | `sudo apt-mark hold pkg` | no official hold; use `-IgnorePkg` or a pin script | `sudo dnf versionlock add pkg` |
| Package format | `.deb` | `.pkg.tar.zst` | `.rpm` |
| Underlying tool | `dpkg` | `pacman` itself | `rpm` |
| Third-party repos | PPA (`add-apt-repository`) | AUR (requires `yay`/`paru` etc.) | EPEL, RPM Fusion |

Two difference-logic points worth memorizing:

1. **Index vs upgrade atomicity**. APT and DNF repos are a "fixed version set" -- `apt update` only downloads the `Packages` index, and `apt upgrade` is safe at any time afterward. Arch is rolling: each package in the repo has only one current version, so once the index is refreshed, already-installed old packages are immediately out of sync with the new libraries. That is why `-Sy` and `-Su` must be combined into `-Syu` in a single pass. This is the partial-upgrade risk emphasized in [What is Linux](./introduction/what_is_linux.md).

2. **Depth of pinning implementation**. `apt-mark hold` directly marks the dpkg database -- the lightest weight. `dnf versionlock` depends on the `python3-libdnf` plugin, with lock records written to `/etc/dnf/plugins/versionlock.list`. `pacman` has no equivalent first-level command; the usual approach is adding `IgnorePkg = linux linux-headers` in the `[options]` section of `/etc/pacman.conf`, which semantically means "skip" rather than "pin to an exact version."

## Common Questions

The four questions most often asked before entering the sub-pages:

**Q: Why do `apt update` and `apt upgrade` always have to be run together?**
`update` only refreshes the local index (equivalent to viewing the latest menu), while `upgrade` is what actually downloads and installs updates (placing the order). Running only `update` without `upgrade` has no side effects, but the next `apt install` will resolve dependencies against the new index -- if you just switched mirrors, this step is mandatory, otherwise you get "package not found" or version mismatches. The three-family correspondence is: `apt update` <-> `pacman -Sy` <-> `dnf makecache`.

**Q: Why is `pacman -Sy pkg` on Arch so dangerous when installing just one package?**
That is exactly a partial upgrade: the index is refreshed to the latest, but you only install the target package, whose dependencies may have been upgraded to incompatible versions, while other old software on the system still links against the old libraries. The Arch Wiki's official stance is "never partial upgrade" -- the correct approach is to run a full `sudo pacman -Syu` first, then consider installing new packages.

**Q: Are third-party repos / PPA / AUR actually safe?**
Priority is always: official repos > distro-endorsed extension repos (EPEL, backports) > community PPA/AUR. AUR contains PKGBUILD build scripts rather than precompiled binaries -- you must review the `PKGBUILD` contents before installing. Same for PPA: before `add-apt-repository`, check who published it. For production servers, stick to official + EPEL only.

**Q: Stuck on `Could not get lock /var/lib/dpkg/lock-frontend` -- what now?**
Another process (usually an incomplete `apt upgrade` or an unattended `unattended-upgrades` run) holds the dpkg lock. First `ps aux | grep -E 'apt|dpkg'` to see who it is, then wait for it to finish or carefully kill it. If the previous install was interrupted and left a half-configured state, use `sudo dpkg --configure -a` to repair, then `sudo apt --fix-broken install`. Never directly delete the lock file -- that corrupts the dpkg database.

## References

- Debian manual - APT and dpkg -- [debian.org](https://www.debian.org/doc/manuals/debian-handbook/apt.zh-cn.html)
- Ubuntu documentation - APT -- [help.ubuntu.com](https://help.ubuntu.com/community/AptGet)
- Arch Wiki - pacman -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- Arch Wiki - AUR -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Arch_User_Repository)
- RHEL 9 - Managing software with DNF -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_software_with_the_dnf_tool/index)
- Rocky Linux docs - DNF -- [docs.rockylinux.org](https://docs.rockylinux.org/guides/package_management/)
- Bird's Private Recipes (Lin's Linux Administration Guide) - Software management -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0520rpm_and_srpm.php)
- `man apt`, `man dpkg`, `man dnf`, `man rpm`, `man pacman`

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)
- [package](/commands/package/package.md)
- [coverage-matrix](/research/coverage-matrix.md)
