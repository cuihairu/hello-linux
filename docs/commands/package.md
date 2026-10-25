# Package Management

"Installing software" on Linux and "double-clicking an installer" on Windows are two completely different experiences:
you almost never download `.exe` files from a website;
you tell the system "I want nginx",
and the **package manager** pulls it from the repository,
resolves dependencies,
writes the config,
and registers it in the database.
This is the core of package management --
it is not just a downloader;
it is a **dependency resolver + version database + uninstall/rollback tool**.
Once you understand this,
you can understand why `apt` and `dnf` fix dependencies differently,
why Arch's `pacman -Syu` cannot be done half-way,
and why running `rpm -ivh` directly, bypassing the package manager, leaves a mess behind.

> This chapter covers the package managers of the three distro families side by side:
> **APT** (Debian/Ubuntu),
> **DNF/YUM** (RHEL/CentOS/Rocky/Fedora),
> **pacman** (Arch/Manjaro).
> When reading any sub-page, check it against the six-dimension quick table on this page first, and figure out which column applies to your distro.

## Why Package Management Is the First Lesson on Linux

Three realities that are almost impossible to avoid:

1. **Almost every task starts with "install something"**.
   Need Docker?
   Need `htop`?
   Need a compiler?
   All of them go through the package manager first.
   Without package management fluency,
   the later system administration,
   network,
   and server sections become impossible --
   `command not found` becomes your daily greeting.
2. **Dependency problems can only be solved by the package manager**.
   Software A depends on library B,
   library B depends on library C,
   and manual download-and-install almost always dead-ends in a loop.
   APT's `apt --fix-broken install`,
   DNF's automatic dependency resolution,
   and `pacman`'s complete dependency tree handling
   are all doing the human-hostile work for you.
3. **Upgrades and security patches are the daily routine of operations**.
   Behind `sudo apt upgrade`,
   `sudo dnf upgrade`,
   and `sudo pacman -Syu` sit completely different update philosophies:
   the Debian/RHEL family chases "version stability,
   backport fixes only",
   while the Arch family chases "one current version in the repo at all times,
   upgrade means forward".
   **On Arch, running only `pacman -Sy` (refresh the database but do not upgrade) creates a half-broken "partial upgrade" state,
   an operation the official docs explicitly warn is high risk**;
   either do `-Syu` for a full upgrade,
   or do nothing at all.

Bird's Private Recipes (Lin's Linux Administration Guide) compares package management to "household registration for software":
each package is registered in a database (`dpkg -l` / `rpm -qa` / `pacman -Q`),
file lists are queryable,
dependencies are queryable,
and uninstalls are traceable.
Bypassing the registration system (extracting binaries to `/usr/local` without a record) is convenient short-term,
but long-term you lose the answer to "what is installed on this machine" entirely.

> Example output comes from a real Ubuntu 26.04 environment; see the references at the end.

## What This Chapter Covers

- **Basic operations across the three families, no barriers**:
  seeing an APT family distro, use `apt`;
  seeing an RPM family, use `dnf`;
  seeing Arch, use `pacman`;
  and know that "refresh the repo index" and "upgrade installed software" are two different actions (`apt update` != `apt upgrade`;
  `pacman -Sy` != `pacman -Syu`).
- **Query and traceability**:
  be able to answer "is this package installed", "which package does this command belong to", "who installed this file" --
  `apt/dpkg -S`,
  `dnf provides`,
  `pacman -Qo` once each across the three families.
- **Understand the underlying tools**:
  understand that `dpkg`/`rpm` are the underlying installers and
  `apt`/`dnf`/`pacman` are the high-level managers,
  and know when you must go down to the underlying layer (installing `.deb`/`.rpm` offline,
  repairing the database).
- **Configure repositories independently**: add/disable software sources, switch to domestic mirrors, install EPEL/PPA
- **Troubleshoot with a method**:
  when hitting lock files,
  dependency conflicts,
  cache corruption,
  or partial-upgrade leftovers,
  work through "check processes -> fix the database -> clear cache -> retry" in order,
  rather than hitting `Ctrl+C` repeatedly.
- **Version control awareness**:
  lock critical software versions (`apt-mark hold` / `dnf versionlock` / `pacman -D --ignore`),
  so one full upgrade does not blow up production.

## Reading the Subpages

- [Package Management Commands](./package/package.md) -- the complete operation manual for the three package managers: APT's `install/remove/search` and the `dpkg` underlying layer, DNF/YUM's `install/remove/repoquery` and the `rpm` underlying layer, **pacman's full `-S/-R/-Q/-Syu` usage set**, plus repository configuration, version locking, local repo setup, lock file and dependency troubleshooting, and a three-family command comparison table.

Suggestion:
first memorize the "install / upgrade / uninstall" row of the six-dimension comparison table on this page,
then go to the sub-page and read the corresponding section for your own distro closely,
and finally skim the other two families --
operations rarely touches only one distro.

## Three-Family Differences at a Glance (apt / dnf / pacman Six-Dimension Comparison)

The six rows below cover 95% of daily package management operations. **Read across to see one dimension across the three families, read down to see one distro's complete toolbox**.

| Dimension | APT (Debian/Ubuntu) | DNF/YUM (RHEL/CentOS/Rocky) | pacman (Arch) |
|------|----------------------|------------------------------|----------------|
| **1. Install / Upgrade / Uninstall** | `sudo apt update` refresh the index<br>`sudo apt upgrade` upgrade installed packages<br>`sudo apt install package` install<br>`sudo apt remove package` uninstall (use `purge` to keep config) | `sudo dnf makecache` refresh cache<br>`sudo dnf upgrade` upgrade installed packages<br>`sudo dnf install package` install<br>`sudo dnf remove package` uninstall | `sudo pacman -Sy` refresh the database only (**do not use alone**)<br>`sudo pacman -Syu` refresh and full upgrade<br>`sudo pacman -S package` install<br>`sudo pacman -Rns package` uninstall (with unused deps and config) |
| **2. Query and Search** | `apt search keyword`<br>`apt show package`<br>`apt list --installed`<br>`apt list --upgradable` | `dnf search keyword`<br>`dnf info package`<br>`dnf list installed`<br>`dnf check-update` | `pacman -Ss keyword` search the repo<br>`pacman -Si package` see remote info<br>`pacman -Qs keyword` search installed<br>`pacman -Qi package` see installed details |
| **3. Underlying Tools and Local Packages** | `dpkg -i package.deb` install a local package<br>`dpkg -l` list installed<br>`dpkg -S file` check ownership<br>`apt --fix-broken install` fix dependencies | `rpm -ivh package.rpm` install a local package<br>`rpm -qa` list installed<br>`rpm -qf file` check ownership<br>`dnf reinstall package` reinstall to repair | `pacman -U package.pkg.tar.zst` install a local package<br>`pacman -Q` list installed<br>`pacman -Qo file` check ownership<br>`pacman -Dk` check orphan dependencies |
| **4. Repository Configuration** | `/etc/apt/sources.list`<br>`/etc/apt/sources.list.d/*.list`<br>after changing, run `apt update` | `/etc/yum.repos.d/*.repo`<br>after changing, run `dnf makecache` | `/etc/pacman.conf`<br>`/etc/pacman.d/mirrorlist`<br>after changing, run `pacman -Sy` (and immediately `-Syu`) |
| **5. Third-Party Extension Ecosystem** | PPA (`add-apt-repository`), backports | EPEL (`dnf install epel-release`), RPM Fusion, CRB/PowerTools | AUR (not in official repos, build from PKGBUILD with helpers such as `yay`/`paru`; `pacman` itself is unaware of the AUR) |
| **6. Version Locking / Rollback / Cache** | `apt-mark hold package` lock<br>`apt-mark unhold` unlock<br>`apt clean` clear cache<br>`apt history` view history | `dnf versionlock add package` (needs plugin)<br>`dnf history` check/rollback transactions<br>`dnf clean all` clear cache | `pacman -D --ignore package` ignore on this upgrade<br>`pacman -Qq` + timestamps for assisted rollback<br>`pacman -Sc`/`-Scc` clear cache |

**Three golden rules beyond the six dimensions**:

1. **Index != upgrade**.
   `apt update`,
   `dnf makecache`,
   and `pacman -Sy` only mean "let the local know what the repo has";
   they do not change the version of installed software.
   What actually changes versions is `apt upgrade`,
   `dnf upgrade`,
   and `pacman -Syu`.
2. **On Arch, doing only half is the most dangerous**.
   After `pacman -Sy`, installing a new package
   may produce a mismatch between "the new version of the library the new package depends on" and "the old version of the library still in the system" (partial upgrade).
   The Arch Wiki's recommendation is:
   write every install/upgrade as `pacman -Syu package` in one pass.
3. **Uninstall semantics differ**.
   `apt remove` keeps config by default;
   `apt purge` removes config;
   `pacman -Rns` cleans unused deps and config together by default (`n` clears deps,
   `s` clears config files);
   `dnf remove` removes dependencies that "only that package depended on",
   but keeps config.
   Do not assume habits transfer across families.

## Common Gotchas

1. **Running `pacman -Sy package` on Arch for a partial upgrade**.
   The index is refreshed to the latest but only the target package is installed;
   libraries the new package depends on may have been upgraded, while other old software on the system still links the old libraries,
   producing a pile of `error while loading shared libraries`.
   The correct form is `sudo pacman -Syu package` in one pass;
   the Arch Wiki's official stance is never do a partial upgrade.
2. **Treating `apt update` as an upgrade**.
   `update`/`makecache`/`-Sy` only refresh the local index (see the latest menu);
   what actually changes versions is `apt upgrade`, `dnf upgrade`, `pacman -Su`.
   After switching to a new mirror, you must update before install,
   otherwise you get "package not found" or version mismatches.
3. **Deleting `/var/lib/dpkg/lock-frontend` directly to unlock**.
   A lock file existing means another apt/dpkg is running (or the last run was interrupted and left a half-configured state).
   First `ps` to confirm and wait for it to finish;
   repair leftover state with `sudo dpkg --configure -a`;
   hard-deleting the lock corrupts the dpkg database,
   and the repair cost far exceeds the cost of waiting.
4. **Running `apt full-upgrade`/`dnf upgrade -y` on production without checking the change list**.
   A major version jump may remove depended-on packages, change config files, and restart services.
   First check the list with `apt list --upgradable` / `dnf check-update` / `pacman -Qu`,
   lock important packages with `apt-mark hold` / `dnf versionlock add`,
   and then run during a maintenance window.
5. **Installing AUR/PPA packages without review**.
   The AUR contains PKGBUILD build scripts, not precompiled binaries;
   PPAs are similarly maintained by third parties.
   Before installing, open the PKGBUILD/package description and review the build steps;
   production servers should only use official repos plus distro-endorsed extensions like EPEL.
6. **Forgetting that the three families' package managers are not interchangeable**.
   `apt` only exists on Debian/Ubuntu, `dnf`/`yum` only on the RHEL family, `pacman` only on Arch.
   Bringing one family's commands to another only yields `command not found`.
   On an unfamiliar machine, first `cat /etc/os-release` and check the `ID` field before choosing a tool,
   or use this page's six-dimension comparison table to look it up on the spot.

## Common Questions

**Q:
`Unable to lock the administration directory (/var/lib/dpkg/lock-frontend)` -- what to do?**

APT is held by another process.
First `ps aux | grep -E 'apt|dpkg' | grep -v grep` to find leftover processes (common after the last install was interrupted by `Ctrl+C`),
confirm, then kill it,
and run `sudo dpkg --configure -a` and `sudo apt --fix-broken install`.
**Do not** delete the lock file directly --
that corrupts the dpkg database.
The DNF counterpart locks are `/var/run/dnf.pid` and locks under `/var/cache/dnf/`;
when `pacman` reports `unable to lock database`, similarly first check whether another `pacman` is running.

**Q: `apt update` reports `GPG error` / `NO_PUBKEY`?**

The local system is missing the repository's signing public key,
which means the source config was changed but the key was not imported.
The common Debian/Ubuntu handling is `sudo apt-key adv --keyserver keyserver.ubuntu.com --recv-keys KEY_ID` (or, per the source's docs, put the `.gpg` in `/etc/apt/keyrings/` and specify `signed-by=` in sources).
On Arch, if you see `signature from ... is unknown trust`,
check whether the system time is correct (time skew causes all signature verification to fail),
or run `pacman-key --populate archlinux` as prompted.

**Q: `apt --fix-broken install` or `dnf distro-sync` cannot save it -- what now?**

First confirm the scope of the damage:
is it a dependency loop in a single package,
or a full-system state disorder?
For a single package, try `dpkg -r --force-depends package` and reinstall;
for a full-system issue on Debian, `apt full-upgrade`;
on the RHEL family, `dnf distro-sync --allowerasing`;
on Arch, if it is caused by a partial upgrade,
usually the only way is `pacman -Syu` to push the system to the repo's current state (rescue from install media if necessary).
Record the original error text before acting,
and snapshot when necessary.

**Q: Installing the same software gives different package names across the three families -- what now?**

Very common (e.g. `iptables` is called `iptables` on Debian,
and the example package names in docs may map to `nmap`/`ripgrep` etc. with slight differences across repos).
Use each family's search command to confirm first:
`apt search keyword`,
`dnf search keyword`,
`pacman -Ss keyword`;
when unsure, defer to the distro's official wiki/manual package names,
and do not copy across distro docs.

**Q: Why does `pacman -Ss` find software in the AUR, but `-S` cannot install it?**

`pacman` only recognizes official repos.
The AUR is a community build-script repo,
and you need helpers such as `yay -S software` or
`paru -S software`,
or clone the PKGBUILD and `makepkg -si` to build manually.
**AUR packages have no official review**;
always review the PKGBUILD contents before building,
and use them with caution on production servers.

**Q: Repo updates are very slow in a domestic environment?**

Switch all three families to a domestic mirror:
Debian/Ubuntu change `/etc/apt/sources.list` (or Ubuntu's `sources.list.d/ubuntu.sources`),
the RHEL family changes `baseurl` in `/etc/yum.repos.d/*.repo`,
Arch changes `/etc/pacman.d/mirrorlist` (you can use `reflector` to filter automatically).
After changing, remember to refresh the index (`apt update` / `dnf makecache` / `pacman -Syu`).

## References

- Bird's Private Recipes (Lin's Linux Administration Guide) - Software management (RPM/DPKG/YUM) -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0520rpm_and_srpm.php)
- Arch Wiki - Pacman -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman) (includes `-Syu`, partial upgrade warnings, cache management)
- Arch Wiki - AUR -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Arch_User_Repository)
- Arch Wiki - Mirrors -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Mirrors)
- Debian manual - APT -- [debian.org](https://www.debian.org/doc/manuals/debian-handbook/apt.zh-cn.html)
- Ubuntu - apt(8) and package management docs -- [ubuntu.com](https://ubuntu.com/server/docs/package-management)
- Red Hat docs - Managing software with the DNF tool -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_software_with_the_dnf_tool/index)
- Rocky Linux docs - Software management -- [docs.rockylinux.org](https://docs.rockylinux.org/)
- Fedora docs - DNF -- [docs.fedoraproject.org](https://docs.fedoraproject.org/en_US/quick-docs/dnf/)
- `man apt`, `man dpkg`, `man dnf`, `man rpm`, `man pacman`

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)
