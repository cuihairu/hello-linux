# Pacman Package Management

pacman is Arch Linux's official package manager; every package in the official repositories is installed as a `.pkg.tar.zst` file, and Arch's rolling-release model is maintained day to day by a single `pacman -Syu`. It does not have APT/DNF's subcommand style (`apt install`, `dnf remove`); instead it has four letter verbs: `-S` (sync with repos and operate), `-Q` (query the local database), `-R` (remove), `-U` (install a local package file), which combine into the full feature set. Beyond command style, the real watershed is the release model: Debian/RHEL repositories are a "fixed version set," so refreshing the index and upgrading can be split apart and done slowly; Arch repos keep only one current version per package forever, so as soon as the index refreshes, every old package on the system is immediately "stale" -- which gives rise to the most important discipline on this page: never do a partial upgrade.

> Content adapted from the Arch Linux official documentation (Arch Wiki / pacman man page); see the references at the end.

## What This Page Covers

- State the binding between pacman and Arch's rolling-release model, and explain why "partial upgrade" is officially listed as unsupported behavior
- The three verbs `-S`/`-R`/`-Q` and common combinations (`-Syu`, `-Rs`, `-Qo`, `-Ss`); independently install, remove, query, and upgrade
- Repository definitions (core/extra/multilib) in `/etc/pacman.conf` and mirrorlist priority rules
- Use `paccache` to control package cache usage, and understand the value of "keeping several old versions" for rollback on a rolling system
- AUR's role and the `git clone` + `makepkg -si` build flow, drawing the boundary between it and the official repos
- Compare item by item with [APT](./apt.md) and [YUM/DNF](./yum.md), and write the right branches in cross-distro scripts

## 1. pacman and the Rolling-Release Model

Arch has no version numbers like 8.0 or 9.0; there is only one continuously advancing rolling branch: install the system once, then run `pacman -Syu` indefinitely afterward. Each package in the repo keeps only one current version. This is the fundamental difference from Debian stable / RHEL fixed repos, and the source of every discipline on this page.

```bash
# The rolling repo has no "stable codename"; pacman -Si only gives one current version
$ pacman -Si htop | grep -E '^(Repository|Version)'
Repository      : extra
Version         : 3.3.0-1
```

Debian's stable is like a frozen menu -- after `apt update` you can upgrade at any time. Arch's repo is a continuously rolling front end: today's `htop 3.3.0-1` in the index may be 3.4.0-1 tomorrow, and the repo no longer keeps the old version. This decides two disciplines: upgrades must happen as a whole (section 4), and rollback options are limited, so the package cache needs to be managed yourself (section 5).

## 2. Databases and Repositories

pacman state lives in two places: `/var/lib/pacman/local/` records installed packages (the `-Q` family of queries and removals all operate on it), and `/var/lib/pacman/sync/` stores index snapshots for each repository (what `-Sy` updates is here). Repositories are defined in `/etc/pacman.conf`, and mirrors are listed in order in `/etc/pacman.d/mirrorlist` -- entries earlier in the file take priority.

```bash
# Repository sections in /etc/pacman.conf (excerpt)
[core]
Include = /etc/pacman.d/mirrorlist      # core: packages essential for boot and basic operation

[extra]
Include = /etc/pacman.d/mirrorlist      # extra: desktop, applications, and the rest of the official packages

#[multilib]
#Include = /etc/pacman.d/mirrorlist     # multilib: 32-bit libraries on x86_64, commented out and not enabled by default
```

The division of labor among the three official repositories: core collects packages essential for basic system operation (glibc, systemd, the kernel); extra collects the rest of the official software, including desktop environments and most server software; multilib provides 32-bit compatibility libraries, needed only when running programs with 32-bit components such as Wine or Steam, and is not enabled by default. The `[community]` repository found in older material was merged into `[extra]` in 2023; not finding community in the index is normal.

Speeding up with a domestic mirror does not rely on `sed` replacing the URL; instead you move the mirror entry to the front of the mirrorlist (pacman picks in file order), then run `pacman -Syu` once to verify.

## 3. Daily Core Commands

A complete install interaction -- the output format differs considerably from APT and is worth seeing once:

```bash
$ sudo pacman -S htop
resolving dependencies...
looking for conflicting packages...

Packages (1) htop-3.3.0-1

Total Download Size:   0.16 MiB
Total Installed Size:  0.35 MiB

:: Proceed with installation? [Y/n] y
# After confirming, downloads and installs (progress bar lines omitted)
```

The other high-frequency operations are grouped by scenario in the table below. All commands run directly:

| Scenario | Command | Notes |
|----------|---------|-------|
| Install multiple at once | `sudo pacman -S git curl wget` | Dependencies resolved together |
| Reinstall an existing package | `sudo pacman -S htop` | When already installed, effectively an overwrite reinstall |
| Install a local package | `sudo pacman -U ./htop-3.3.0-1-x86_64.pkg.tar.zst` | makepkg output and cache downgrades both use `-U` |
| Search remote repos | `pacman -Ss nginx` | Supports regex, e.g. `pacman -Ss '^nginx-'` |
| Remote package details | `pacman -Si nginx` | Version, dependencies, repository |
| Search installed | `pacman -Qs nginx` | The `-Q` family queries only the local DB, paired with the `-S` family |
| Installed package details | `pacman -Qi nginx` | Install time, reason installed, packages depending on it |
| Files in a package | `pacman -Ql nginx` | Which paths the package installed |
| File ownership | `pacman -Qo /usr/bin/nginx` | For a file not installed, first `sudo pacman -Fy` then `pacman -F <file>` to query repos |

Removal comes in three grades; the difference is "does it take dependencies, does it keep a backup":

```bash
$ sudo pacman -R htop        # Remove only the package itself; dependencies stay untouched
$ sudo pacman -Rs nginx      # Also remove dependencies installed only for it
$ sudo pacman -Rns nginx     # Add -n: do not keep backup files (otherwise config is saved as .pacsave)
```

pacman has no first-level command like `apt autoremove`; orphan packages (installed as dependencies, now needed by nobody) must be found and removed yourself:

```bash
$ pacman -Qdt                          # List orphan packages
$ sudo pacman -Rns $(pacman -Qdtq)     # The community's idiomatic batch cleanup
```

Before a batch cleanup, always run `pacman -Qdt` alone to read the list: if a package you actually use got recorded as a dependency because you installed it without the right flags, first mark it as manually installed with `sudo pacman -D --asexplicit <pkg>`, then run the batch removal.

## 4. System Upgrade and Partial Upgrades

There is exactly one correct way to upgrade the system: `-Syu` written together, completing index sync and upgrade in a single transaction.

```bash
$ sudo pacman -Syu
:: Synchronizing package databases...
 core                  132.0 KiB   ...
 extra                 8.0 MiB     ...
:: Starting full system upgrade...
 there is nothing to do            # Complete ending when there are no updates

$ sudo pacman -Syu                 # With updates available, lists all packages and asks for confirmation
Packages (12) curl-8.x.y-1  linux-6.x.y.arch1-1  ...
```

Conversely, running `pacman -Sy` (refresh index only) followed by `pacman -S <pkg>` (install just one package) is what the Arch community calls a partial upgrade: pacman resolves dependencies against the new index, the target package and its new dependencies come from the new repo, while the rest of the system stays on old versions -- libraries and applications fall out of sync, with typical symptoms of `error while loading shared libraries` and signature trust errors. The Arch Wiki's verdict on partial upgrade is "unsupported," and the fix is precisely to run one complete `-Syu`. Scripts and cron jobs that only "run `pacman -Sy`" are the single most common source of this red line; section 8 returns to it.

## 5. Cache Management

Package cache lives in `/var/cache/pacman/pkg/`; pacman does not clean it automatically, and old versions accumulate. But a rolling system is exactly what relies on those old files for rollback: if a service will not start after an upgrade, the most direct remedy is downgrading with `sudo pacman -U /var/cache/pacman/pkg/<pkg>-<oldversion>.pkg.tar.zst`. So the goal of cleanup is "keep enough, delete the excess," not zeroing it out.

```bash
$ sudo pacman -S pacman-contrib       # paccache is in this package, not in pacman itself
$ paccache -r                         # Keep the latest 3 versions of each package (default policy)
$ paccache -ruk0                      # Only clear all caches of removed packages, keep rollback room for installed ones

$ du -sh /var/cache/pacman/pkg/       # Check usage before and after cleanup
2.1G	/var/cache/pacman/pkg/
$ sudo pacman -Sc                     # Delete caches of removed packages (interactive confirmation)
$ sudo pacman -Scc                    # Clear everything -- rollback material disappears too; use with care on a rolling system
```

`paccache -r` is the recommended approach from the Arch Wiki system maintenance page; if you do not want to run it manually, `systemctl enable --now paccache.timer` runs it automatically every week.

## 6. AUR and makepkg

Beyond the official repositories there is AUR (Arch User Repository), and its role must be stated clearly first: AUR is not an official repository; it holds user-submitted PKGBUILD build scripts rather than precompiled packages, the official project provides no support for any of its contents, and you build and use it at your own risk. A large number of niche tools enter the Arch ecosystem through it, and many packages that are in the official repos today began life as a PKGBUILD in AUR.

Building requires the compiler toolchain:

```bash
$ sudo pacman -S --needed base-devel git   # --needed: skip if already installed

# Standard AUR build flow (using yay itself as an example)
$ git clone https://aur.archlinux.org/yay.git
$ cd yay
$ less PKGBUILD                    # Must read through before building: source URL, checksums, build script
$ makepkg -si                      # -s has pacman install dependencies, -i installs immediately after building
```

A PKGBUILD is essentially a shell script; `makepkg` runs its contents as your user and only asks for sudo at the install step. So "read the PKGBUILD before building" is not a ritual -- it is AUR's only effective safety line, and no amount of stars or downloads replaces that step. AUR helpers like yay and paru bundle search, build, and update into a single command and are widely used, but they are third-party tools unrelated to Arch official. There is one more boundary to remember: `pacman -Syu` does not update AUR packages; pacman reads only official repo databases, and AUR packages need to be followed up through a helper or manual `makepkg`.

## 7. Comparison with APT and DNF

A comparison of the four core operations (the APT/DNF family expansion is covered on the previous two pages):

| Operation | APT (Debian/Ubuntu) | DNF (RHEL family) | pacman (Arch) |
|-----------|---------------------|-------------------|---------------|
| Install | `sudo apt install nginx` | `sudo dnf install nginx` | `sudo pacman -S nginx` |
| Remove | `sudo apt remove nginx` | `sudo dnf remove nginx` | `sudo pacman -R nginx` |
| Query | `apt search nginx` / `dpkg -S <file>` | `dnf search nginx` / `rpm -qf <file>` | `pacman -Ss nginx` / `pacman -Qo <file>` |
| Upgrade | `sudo apt update && sudo apt upgrade` | `sudo dnf upgrade` | `sudo pacman -Syu` (cannot be split) |

Beyond the table, three structural differences are worth remembering more than command spelling. Upgrade atomicity: APT/DNF can separate index refresh from upgrade by any length of time, while pacman's `-Sy` and `-Su` must be combined. Orphan cleanup: `apt autoremove` and `dnf autoremove` are both first-level commands, while pacman only offers `-Qdt` for querying and leaves removal to the user to compose. Version pinning: `apt-mark hold` and `dnf versionlock` are first-level commands, while pacman goes through the config file `IgnorePkg` (see the next section). There is also a layering difference: pacman is itself the low-level layer, with no separate low-level tool like dpkg or RPM -- dependency resolution, download, and install all happen in the same program, which is also why its output always starts with `resolving dependencies`.

## 8. Common Pitfalls

1. **Treating `-Sy` as equivalent to `apt update`**. The semantics do correspond (refresh index), but the usage is not equivalent: after `apt update` you can safely do anything else, while after `pacman -Sy` the system is immediately in an "index new, packages old" intermediate state, and the only correct action is to immediately follow with a complete `-Syu`. Cron jobs and automation scripts that only run `-Sy` are the single most common source of this pitfall.

2. **Signature error `invalid or corrupted package (PGP signature)` or `unknown trust`**. Usually `archlinux-keyring` is too old, common on machines that have not been upgraded for a long time or systems installed from an old image. First update the keyring with `sudo pacman -Sy archlinux-keyring`, then immediately run a complete `pacman -Syu`. Note that this step is itself an intentional partial upgrade, so do not stop midway after the keyring update.

3. **Wrote `IgnorePkg` and forgot to delete it**. Writing `IgnorePkg = linux linux-headers` in the `[options]` section of `/etc/pacman.conf` makes pacman skip upgrades for those packages, appearing in upgrade output as `warning: xxx: ignoring package upgrade`. Temporarily pinning packages during a kernel upgrade window is common, but remember to come back and delete them; verify at a glance with `grep -i ignorepkg /etc/pacman.conf`.

4. **Leaving `.pacnew` files unhandled for a long time**. When an upgrade finds that a config file (pacman's own `/etc/pacman.conf` is a frequent victim) has changed in the official new version but you edited the local copy, pacman does not overwrite it; instead it saves the new version as `.pacnew` next to the old one. Without merging, newly added default config entries never take effect. After upgrading, run `find /etc -name "*.pacnew"` once; with pacman-contrib installed you can use `pacdiff` to compare and merge one by one.

5. **Treating AUR as an official repository**. The convenience of `yay -S xxx` easily makes you forget two things: AUR contents are not audited by anyone, and you must read the PKGBUILD before building; AUR packages are not covered by `pacman -Syu`, and if you forget to follow up they stay on an old version for a long time.

6. **Running `-Scc` to clean the cache to zero**. After a full clean, an upgrade failure leaves you with no material to downgrade with. For daily use, `paccache -r` keeping the latest few versions is enough; save `-Scc` for when disk space is truly tight.

## References

- pacman man page -- [man.archlinux.org](https://man.archlinux.org/man/pacman.8)
- Arch Wiki - pacman -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- Arch Wiki - System maintenance -- [wiki.archlinux.org](https://wiki.archlinux.org/title/System_maintenance)
- Arch Wiki - AUR -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Arch_User_Repository)
- `man pacman`, `man pacman.conf`, `man makepkg`, `man paccache`

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/basic/README.md)
- [packages](/basic/packages.md)
- [tarball](tarball.md)
- [knowledge](/knowledge.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [gap-fill](/research/gap-fill.md)
