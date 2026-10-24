# APT Package Management

APT (Advanced Package Tool) is the official front end for the whole Debian and Ubuntu family. The core problem it solves is **dependency resolution**: installing a single graphical program can drag in dozens of libraries, and chasing dependencies by hand is neither realistic nor possible. APT's design has a layering worth understanding up front -- `apt` only handles "talking to the repositories" (querying the index, computing dependencies, downloading), while the thing that actually writes files into the system and maintains the "installed list" is the underlying `dpkg`. This division of labor explains a lot: why `dpkg -i` installing a local `.deb` reports "unmet dependencies" but `apt install ./xxx.deb` does not (the latter calls APT to resolve dependencies first, then calls dpkg), and why after an interrupted install you need `dpkg --configure -a` rather than choosing between that and `apt --fix-broken` (the two each manage one layer, and you often need both). This page unfolds as "daily commands -> repositories and sources -> cache and pinning -> three-family comparison -> common pitfalls," and all output is from a real terminal.

> Content adapted from the Debian manual and Ubuntu official documentation; see the references at the end.

## What This Page Covers

- Separate the responsibilities of `apt` and `dpkg`
- Know the full install / upgrade / search / remove / clean command set and read real output
- Configure sources.list (old format) and ubuntu.sources (deb822 format), domestic mirrors, and PPAs
- Lock versions with `apt-mark hold`

## 1. Why Two Layers: apt and dpkg

`dpkg` stands for Debian Package. It has existed since 1993 and does only local package management: install, remove, query "which files belong to which package" -- but it **completely ignores dependencies**. When handed a package that needs `libssl3` and the system does not have it, it just throws an error code at you. APT supplies the missing intelligence on top: maintaining remote repository indexes, building the dependency graph, downloading dependencies on demand, and handling conflicts and recommended packages. The analogy: `dpkg` is like a warehouse keeper who only handles receiving and shipping, while `apt` is like a procurement manager who handles price comparison, bundling, and restocking.

```bash
# High level: interact with repositories, query candidate versions and their sources
$ apt policy nginx
nginx:
  Candidate: 1.24.0-2ubuntu7
  500 http://archive.ubuntu.com/ubuntu noble/main amd64 Packages

# Low level: read the local dpkg database only (ii = installed and status normal)
$ dpkg -l | grep -c ^ii
2487
```

Day to day you almost always start from `apt`; you only call `dpkg` directly when handling a local `.deb`, repairing a broken state, or asking "which package provides this file."

## 2. Daily Core Commands

First a complete "refresh index -> install" flow, with output from a real Ubuntu 24.04 terminal (redundant download/unpack lines trimmed, only the informative parts kept):

```bash
$ sudo apt update
Get:1 http://archive.ubuntu.com/ubuntu noble InRelease [126 kB]
Fetched 3429 kB in 1s (3241 kB/s)            # Only refreshes the index, this "menu"; no software is upgraded

$ sudo apt install nginx
The following NEW packages will be installed:
  nginx nginx-common nginx-core
Setting up nginx (1.24.0-2ubuntu7) ...       # Dependencies unpacked together and postinst scripts run
nginx: configuration file test is successful
```

The other high-frequency operations are grouped by scenario in the table below. All commands run directly; their output semantics match the above, so they are not pasted one by one:

| Scenario | Command | Notes |
|----------|---------|-------|
| Upgrade installed packages | `sudo apt upgrade` | Does not remove, does not install new packages beyond dependencies |
| Full upgrade | `sudo apt full-upgrade` | Allows removing conflicting old packages to complete the upgrade (formerly `apt-get dist-upgrade`) |
| Remove (keep config) | `sudo apt remove nginx` | `/etc/nginx/` usually still remains |
| Purge | `sudo apt purge nginx` | remove + clear conffiles and some `/var` leftovers |
| Clean orphan dependencies | `sudo apt autoremove` | A different thing from `apt clean` (which removes download cache) |
| Search | `apt search web server` | Matches both package name and description, case-insensitive |
| Package details | `apt show nginx` | Version, dependencies, maintainer, homepage |
| List upgradable | `apt list --upgradable` | Held packages do not appear here |
| Which package owns a file | `dpkg -S /usr/sbin/nginx` | Queries the dpkg local database |
| Files in a package | `dpkg -L nginx-common` | Reverse lookup of which paths a package ships |

One frequently asked distinction: after `apt remove`, the configuration under `/etc/nginx/` usually remains (it belongs to the separate `nginx-common` package or is marked as a conffile by dpkg); use `apt purge` for a clean removal. Conversely, `apt autoremove` and `apt clean` are two different things -- the former removes "packages no longer needed," the latter removes "downloaded `.deb` cache files."

## 3. Repository and Source Configuration

APT repositories are defined in two kinds of locations: the old single-line file `/etc/apt/sources.list`, and the **deb822 format** (`.sources` files, with fields on separate lines, easier to parse) recommended since Debian 12+ / Ubuntu 24.04+. From Ubuntu 24.04 the default source file has moved to `/etc/apt/sources.list.d/ubuntu.sources`; editing `sources.list` following old guides produces no effect -- this is the most frequent configuration pitfall on that version. Files generated by PPAs and third-party repos also live under `/etc/apt/sources.list.d/`, coexisting with the default sources.

```bash
# Ubuntu 24.04+ deb822 format (default path)
$ cat /etc/apt/sources.list.d/ubuntu.sources
Types: deb
URIs: http://archive.ubuntu.com/ubuntu/
Suites: noble noble-updates noble-backports
Components: main restricted universe multiverse

# Old single-line format (Debian and Ubuntu 22.04 and earlier; semantically equivalent to above)
# deb http://archive.ubuntu.com/ubuntu noble main restricted universe multiverse
```

**Switching to a domestic mirror** (using Tsinghua TUNA as an example; always back up first; the two formats differ only in file path):

```bash
$ M=https://mirrors.tuna.tsinghua.edu.cn
$ sudo cp /etc/apt/sources.list{,.bak}
$ sudo sed -i "s|http://archive.ubuntu.com|$M|g" /etc/apt/sources.list
$ sudo sed -i "s|http://archive.ubuntu.com|$M|g" /etc/apt/sources.list.d/ubuntu.sources
$ sudo apt update                              # Must refresh the index after switching sources
```

**PPA (Personal Package Archive)** is an Ubuntu-specific third-party repository mechanism; the Debian official system has no equivalent (Debian uses backports or directly from source / third-party `.list` files):

```bash
$ sudo apt install software-properties-common
$ sudo add-apt-repository ppa:deadsnakes/ppa        # Add (e.g. multiple Python versions)
$ sudo apt update
$ sudo add-apt-repository --remove ppa:deadsnakes/ppa    # Remove this PPA
```

## 4. Cache Management

APT keeps downloaded `.deb` files in `/var/cache/apt/archives/` (useful for reinstall and offline deployment), while indexes live in `/var/lib/apt/lists/`. Both grow over time but serve different purposes: the commands containing `clean` manage **files** (`apt clean` clears the entire download cache, `apt autoclean` clears only expired versions), while the ones containing `remove` manage **packages** (`apt autoremove` removes packages no longer depended on). To see actual usage in both places, use `sudo du -sh /var/cache/apt/archives/ /var/lib/apt/lists/`.

```bash
$ sudo apt clean && du -sh /var/cache/apt/archives/   # Clean the cache and verify usage
0	/var/cache/apt/archives/
$ sudo apt autoclean                                   # Conservative: only clean expired .deb files
```

A practical trick: on a server, habitually run `apt clean` right after `apt upgrade` to drop mirror cache usage to 0. For offline distribution, do the reverse -- on one machine use `apt install --download-only` to gather the `.deb` files, then copy them away.

## 5. Version Pinning

To pin a critical package (kernel, a specific minor nginx version, glibc) before an upgrade so `apt upgrade` does not drag it along:

```bash
$ sudo apt-mark hold nginx
nginx set on hold.
$ apt-mark showhold            # Show all held packages
nginx
$ sudo apt-mark unhold nginx   # Unhold
nginx was unheld.
```

`hold` is a per-package "do not upgrade" marker stored in `/var/lib/dpkg/status`. It does not survive a reinstall, but within the same system it persists across many `apt upgrade` runs. Cross-family: DNF uses `dnf versionlock add nginx` (written to `versionlock.list`, can be pinned to an exact version), while Arch has no equivalent first-level command and usually configures `IgnorePkg` in `/etc/pacman.conf`.

## 6. Comparison with DNF and pacman

A full comparison of common operations across the three families (Debian/Ubuntu uses `apt`, Arch uses `pacman`, RHEL/CentOS/Rocky uses `dnf`; for the detailed expansion see [YUM/DNF](./yum.md) and the chapter index):

| Scenario | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|----------|---------------|------|-------------------|
| Refresh index | `sudo apt update` | `sudo pacman -Sy` | `sudo dnf makecache` |
| Upgrade | `sudo apt upgrade` | `sudo pacman -Su` (`-Syu` recommended, combined) | `sudo dnf upgrade` |
| Install | `sudo apt install nginx` | `sudo pacman -S nginx` | `sudo dnf install nginx` |
| Remove | `sudo apt remove nginx` | `sudo pacman -R nginx` | `sudo dnf remove nginx` |
| Search | `apt search nginx` | `pacman -Ss nginx` | `dnf search nginx` |
| Clean cache | `sudo apt clean` | `sudo pacman -Scc` | `sudo dnf clean all` |
| Pin version | `sudo apt-mark hold` | `IgnorePkg` (pacman.conf) | `sudo dnf versionlock add` |

`pacman`'s short-option system (`-S` sync, `-R` remove, `-Ss` search) is entirely different in style from APT/DNF subcommands; the only thing to remember on first contact is that `-S` carries both "install" and "sync index" semantics, so `-Syu` = sync + upgrade. What still truly needs vigilance is Arch's partial upgrade: **never split `-Sy` and `-Su` into separate runs**.

## 7. The dpkg Layer and Repair

```bash
# Installing a local .deb directly fails because dependencies are missing
$ sudo dpkg -i nginx-common_1.24.0-2ubuntu7_all.deb
dpkg: dependency problems prevent configuration of nginx-common:
 nginx-common depends on lsb-base (>= 3.2-14) ...

# Correct approach: let apt resolve and satisfy dependencies first, then call dpkg
$ sudo apt install ./nginx-common_1.24.0-2ubuntu7_all.deb

# Standard repair flow after an interruption (order matters)
$ sudo dpkg --configure -a          # First finish all "unpacked but not configured" packages
$ sudo apt --fix-broken install     # Then fix the dependency graph
```

`dpkg --configure -a` handles the "files copied, postinst script did not finish" half-installed state (common after an apt interruption or power loss); `apt --fix-broken install` handles gaps in the dependency graph. They complement each other; a repair script usually runs both in the order above. Only when dpkg is too messed up for either to fix should you consider `sudo dpkg --configure -a --force-confnew`, which discards old config and re-runs the scripts.

## 8. Common Pitfalls

1. **Editing the wrong source file on Ubuntu 24.04**. The default is already `ubuntu.sources` (deb822); editing the old `sources.list` has no effect. First `ls /etc/apt/sources.list*` to confirm which file actually exists before you start.

2. **`apt update` reports `404 Not Found` or `Release file expired`**. Usually the mirror does not match the current distribution codename (e.g. `noble`), or the source points at a retired old-version repo. Cross-check the codename in the `Suites` / `deb` line against `lsb_release -cs`.

3. **Lock file conflict `Could not get lock`**. Another apt/dpkg process is running (commonly `unattended-upgrades`). Locate it with `ps aux | grep -E 'apt|dpkg'` then wait or handle it; do not manually `rm` the lock file, as that breaks dpkg database consistency.

4. **`dpkg -i` produces a pile of `unmet dependencies`**. This is the expected behavior of the layered design -- for local installs, prefer `apt install ./xxx.deb` so APT resolves dependencies first.

5. **Forgot to unhold after a hold**. Packages you held temporarily around an upgrade window -- check `apt-mark showhold` afterwards, otherwise every future upgrade will "mysteriously skip one package."

6. **Treating `autoremove` as `clean`**. The former removes software, the latter removes cache files; on a shared machine, an accidental `autoremove` can delete a manually installed tool that currently has no reverse dependencies. Before running it, see what it plans to remove: `apt --dry-run autoremove`.

## References

- Debian manual - APT and dpkg -- [debian.org](https://www.debian.org/doc/manuals/debian-handbook/apt.zh-cn.html)
- Ubuntu documentation - sources.list and deb822 -- [help.ubuntu.com](https://help.ubuntu.com/community/SourcesList)
- Arch Wiki - pacman (cross-reference) -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- Bird's Private Recipes (Lin's Linux Administration Guide) - Debian software management -- [linux.vbird.org](https://linux.vbird.org/linux_basic/)
- `man apt`, `man apt-get`, `man dpkg`, `man apt-mark`, `man sources.list`

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/basic/README.md)
- [packages](/basic/packages.md)
- [pacman](pacman.md)
- [tarball](tarball.md)
- [package](/commands/package/package.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [tracing-tools](/source/tracing-tools.md)
