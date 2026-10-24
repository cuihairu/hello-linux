# YUM/DNF Package Management

Package management in the RHEL/CentOS/Rocky family underwent a core replacement in 2015: **YUM** (Yellowdog Updater Modified) was written in Python 2, with slow dependency resolution and high memory usage, gradually unable to keep up with the modular repositories of Fedora/RHEL 8 and beyond; **DNF** (Dandified YUM) was its successor, rewritten in Python 3 with a largely compatible interface and significantly improved speed, and is now the default front end on RHEL 8+/Fedora/Rocky 9, while the old `yum` command on most systems is merely a compatibility symlink pointing at DNF or is provided by the `dnf-yum` plugin. This page takes **DNF as the main thread**; where behavior matches YUM, it is marked "YUM compatible," and individual differences (such as the deprecation warning on `yum update`) are called out separately, so you do not get confused reading CentOS 7-era material. The underlying layer is always **RPM** -- understanding the DNF/RPM split is the same exercise as understanding the APT/dpkg split.

> Content adapted from the RHEL 9 official documentation and the Arch Wiki; see the references at the end.

## What This Page Covers

- Separate the relationship between DNF, YUM, and RPM
- The six core DNF operations: install / upgrade / search / repos / cache / pinning
- Configure extension repos such as EPEL and domestic mirrors
- Compare DNF commands item by item against APT and Arch `pacman`

## 1. The Relationship Between DNF and YUM

On Rocky Linux 9 / RHEL 9 / Fedora, running `yum` usually gets you a response from DNF:

```bash
# RHEL 9 / Rocky 9: yum is actually a compatibility entry point to dnf
$ rpm -qf /usr/bin/yum
dnf-yum-4.14.0-1.el9_3.noarch      # From the dnf-yum plugin package, not the old YUM binary
$ dnf --version | head -1
4.14.0
```

This means: **documents that say `yum install` still work on modern RHEL-family systems**, but new scripts and new documentation should always write `dnf` -- it is semantically clearer and no longer depends on a compatibility layer. The scenarios where you genuinely need to distinguish YUM from DNF behavior are mainly CentOS 7 (pure YUM, Python 2) and a few deprecated options -- all main commands on this page are DNF-based, with YUM differences annotated in text.

The DNF/RPM layering maps exactly onto APT/dpkg: RPM only handles local package install, query, remove, and verify, and does not resolve remote dependencies; DNF on top maintains the repository index, resolves dependencies, downloads, and calls RPM in order to complete the transaction. So when `rpm -ivh` reports a dependency error, the correct reaction is to switch to `dnf install` and let DNF compute -- not to force it with `--nodeps`, which leaves the bad debt of "the database says it is installed, but the actual linkage is missing."

```bash
$ sudo dnf install nginx
 Installing:
  nginx            x86_64   1.24.1-1.el9   appstream   29 k
Complete!                       # Dependencies resolved by DNF, then RPM called in order to complete the transaction

$ rpm -q nginx                  # RPM layer: query the local database only
nginx-1.24.1-1.el9.x86_64
```

## 2. Daily Core Commands (DNF)

```bash
$ sudo dnf makecache
Metadata cache created.         # Refresh metadata (equivalent to apt update / pacman -Sy)

$ sudo dnf upgrade
Upgrading:
 openssl   x86_64   3.0.7-6.el9   baseos   2.1 M
Complete!                       # In the YUM era this was yum update; the semantics are mapped to upgrade

$ sudo dnf install nginx        # For remove, change install to remove; for reinstalling the same version, use reinstall
$ dnf search nginx
nginx.x86_64: A high performance web server and reverse proxy server
```

Query operations are grouped by scenario in the table below. All commands run directly:

| Scenario | Command | Notes |
|----------|---------|-------|
| Package details | `dnf info nginx` | Version, repository, size, maintainer |
| List upgradable | `dnf check-update` | Similar to `apt list --upgradable` |
| Count installed packages | `dnf list installed \| wc -l` | Total lines of output (2143 on the example machine) |
| Which package owns a file | `rpm -qf /usr/sbin/nginx` | RPM-layer query |
| Files in a package | `rpm -ql nginx` | Reverse lookup of which paths were installed |

YUM compatibility notes: `yum update` still works under DNF but its semantics are mapped to `dnf upgrade`; `yum install`/`yum search`/`yum remove` are likewise fully compatible. The only thing to watch is that `yum clean all` and `yum makecache` from old material correspond to `dnf clean all` and `dnf makecache` under DNF -- just swap the command name.

## 3. Repositories and Extension Sources

RHEL/Rocky repository definitions all live in `*.repo` files under `/etc/yum.repos.d/`, and each file can contain multiple `[section]` blocks:

```bash
$ ls /etc/yum.repos.d/
rocky-baseos.repo  rocky-appstream.repo  rocky-extras.repo

$ dnf repolist
repo id      repo name                 status
appstream    Rocky Linux 9 - AppStream 6,412
baseos       Rocky Linux 9 - BaseOS    2,231

# Enable / disable a repository temporarily with a single command
$ sudo dnf --enablerepo=epel install htop
$ sudo dnf --disablerepo=epel upgrade
```

**EPEL** (Extra Packages for Enterprise Linux) is the extension repository that Fedora officially maintains for RHEL/Rocky, providing software not in BaseOS/AppStream such as `htop`, `nginx` (some versions), and `ripgrep`:

```bash
$ sudo dnf install epel-release
$ dnf repolist | grep epel
epel    Extra Packages for Enterprise Linux 9 - x86_64   2,104
$ sudo dnf install htop        # Once installed, normal search and install work
```

**Domestic mirrors**: Tsinghua TUNA, Alibaba Cloud, and USTC all provide Rocky/RHEL/EPEL mirrors; just replace `baseurl` in the `.repo` files (note that the `mirrorlist=` line must also be commented out, otherwise it prefers the official CDN).

::: warning CentOS 7 is EOL
CentOS 7 reached end of life on 2024-06-30, and the official mirror repos have been taken offline. The only way to keep maintaining old machines is to switch sources to the `vault.centos.org` archives; for new systems, use Rocky Linux / AlmaLinux 9+ or Fedora directly. All DNF commands on this page are based on Rocky 9 and do not apply to a pure YUM CentOS 7 environment.
:::

```bash
# Only when you must maintain CentOS 7 (do not run this on new machines): disable mirrorlist and switch to the vault archives
$ sudo sed -i -e 's|^mirrorlist=|#|' \
      -e 's|^#baseurl=http://mirror|baseurl=http://vault|' /etc/yum.repos.d/CentOS-*.repo
$ sudo yum makecache
```

**Module streams** is a mechanism introduced in RHEL 8+ that lets a single repository carry multiple versions of the same application (such as different Node.js, PHP, or PostgreSQL versions):

```bash
$ dnf module list nodejs
Name       Stream      Profiles      Summary
nodejs     18 [d]      common...     Javascript runtime
nodejs     20          common...     Javascript runtime
$ sudo dnf module enable nodejs:20    # Switch to the 20 stream
$ sudo dnf install nodejs
```

This is an important new DNF capability relative to YUM. APT handles the same problem with multiple repositories (such as coexisting `php-*` version packages), while `pacman` mostly relies on the rolling release to pick up new versions -- the three families solve the same problem along entirely different paths.

## 4. Cache Management

DNF metadata and package cache live in `/var/cache/dnf/` and `/var/cache/yum/` (compatibility path) respectively. The cleanup strategy is similar to APT's but the commands differ; there are essentially two:

```bash
$ sudo dnf clean all     # Clear metadata + downloaded packages (e.g. 142 files removed)
$ sudo dnf makecache     # Rebuild metadata
```

Finer granularity uses `sudo dnf clean metadata` (only the index) and `sudo dnf clean packages` (only packages); check usage with `sudo du -sh /var/cache/dnf/`. In production, `dnf clean all && dnf makecache` is the standard combo for shrinking container images and recovering from cache sync failures. Compared with `pacman`: `pacman -Scc` asks twice whether to clear all package cache, more aggressive than DNF; APT's `apt clean` only removes `.deb` files and not the index (the index survives `apt clean`, and you need `rm -rf /var/lib/apt/lists/*` for a true "clean everything").

## 5. Version Pinning

DNF version locking is provided by the `versionlock` plugin (installed by default on RHEL/Rocky); lock entries are written to `/etc/dnf/plugins/versionlock.list`:

```bash
$ sudo dnf versionlock add nginx
Adding versions.
$ dnf versionlock list
8:nginx-1.24.1-1.el9.x86_64
$ sudo dnf versionlock delete nginx   # Unpin a single package (clear unpins all)
Deleting versions.
```

Cross-family: APT's `apt-mark hold` is semantically closest to "pin the current version exactly and exclude it from the upgrade list"; DNF `versionlock` additionally supports wildcards and version-range expressions; Arch's `pacman` has no first-level lock command, and the convention is writing `IgnorePkg = linux linux-headers` in `/etc/pacman.conf` (skips the upgrade rather than pinning to an exact version) -- for precise pinning you need a third-party pin script. When doing kernel upgrade-window control, this difference across the three families means your automation scripts must branch.

## 6. The RPM Underlying Commands

Scenarios where you bypass DNF and operate on local packages directly: installing a vendor-provided closed-source `.rpm`, offline environments, or querying file ownership. Three verbs are enough to remember: `-i` install (also `-U` upgrade, `-e` remove), `-q` query, `-V` verify.

```bash
$ sudo rpm -ivh vendor-app-1.0-1.x86_64.rpm   # Local closed-source package written straight to disk
$ rpm -qi nginx                                # Package info (-ql lists files, -qf checks ownership)
$ rpm -qf /usr/sbin/nginx
nginx-1.24.1-1.el9.x86_64
$ rpm -V nginx                                 # Verify integrity; no output = identical to install time
```

**Common pitfall**: when `rpm -ivh` hits `failed dependencies`, do not habitually add `--nodeps` to skip -- that bypasses the dependency graph DNF already built for you and leaves deep holes like `undefined symbol` at runtime. The correct approach is to use `dnf install ./vendor-app.rpm`; DNF can also install local files and resolve dependencies automatically (equivalent to `apt install ./xxx.deb`). To find out how many packages the system has in total, `rpm -qa | wc -l` is enough.

## 7. Comparison with APT and pacman

A full comparison of core operations across the three families (the same table also appears on the chapter index page, for side-by-side memorization):

| Scenario | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|----------|---------------|------|-------------------|
| Refresh index | `sudo apt update` | `sudo pacman -Sy` | `sudo dnf makecache` |
| Upgrade system | `sudo apt upgrade` | `sudo pacman -Syu` (cannot be split) | `sudo dnf upgrade` |
| Install | `sudo apt install pkg` | `sudo pacman -S pkg` | `sudo dnf install pkg` |
| Remove | `sudo apt remove pkg` | `sudo pacman -R pkg` | `sudo dnf remove pkg` |
| Search | `apt search pkg` | `pacman -Ss pkg` | `dnf search pkg` |
| Package info | `apt show pkg` | `pacman -Si pkg` | `dnf info pkg` |
| File ownership | `dpkg -S /path` | `pacman -Qo /path` | `rpm -qf /path` |
| Clean cache | `sudo apt clean` | `sudo pacman -Scc` | `sudo dnf clean all` |
| Pin version | `sudo apt-mark hold` | `IgnorePkg` (config file) | `sudo dnf versionlock add` |
| Extension repos | PPA | AUR (`yay`/`paru`) | EPEL, RPM Fusion |
| Package format | `.deb` | `.pkg.tar.zst` | `.rpm` |

Beyond the commands themselves, the upgrade discipline difference is the most worth remembering: APT/DNF can safely split "refresh index now, upgrade later" into two steps, while on Arch, `pacman -Sy` without a following `-Su` constitutes a partial upgrade -- the classic failure mode on that system. When porting automation scripts between distros, this difference causes more production incidents than any command spelling mistake.

## 8. Common Pitfalls

1. **Applying CentOS 7-era `yum` documentation straight to Rocky 9**. Most command names are compatible, but repo layout (output format of `dnf repolist` vs `yum repolist`), module streams, and other concepts have changed. First `cat /etc/os-release` to confirm the system version before you start.

2. **`dnf` reports `Metadata cache expired` or a download failure**. First `sudo dnf clean all && sudo dnf makecache` to rebuild metadata; if that still fails, check whether `mirrorlist` in the `.repo` file points at an unreachable official domain, and comment it out and use `baseurl` pointing at a domestic mirror instead.

3. **Installed a package from EPEL but got "dependencies required by a module are disabled"**. RHEL-family module streams lock the default enabled version; check with `dnf module list` and `dnf module reset <name>`, then try again.

4. **Force-installed a closed-source package with `rpm -ivh --nodeps` and the service will not start**. The dependency graph was bypassed; libraries are missing at runtime. Reinstall with `dnf install ./pkg.rpm` to let DNF fill in dependencies, or locate the missing `.so` with `ldd /usr/sbin/binary | grep not` and install it precisely.

5. **A versionlock entry that will not clear, so a package "never upgrades"**. Confirm with `dnf versionlock list`, then `dnf versionlock clear`; this is the same troubleshooting path as APT's `apt-mark showhold`/`unhold`.

6. **Looking for `dnf`/`yum` on Arch**. The commands do not exist; Arch only has `pacman` (and its AUR helpers). The fixed action before switching families is still checking the `ID=` field in `/etc/os-release`.

## References

- RHEL 9 - Managing software with the DNF tool -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_software_with_the_dnf_tool/index)
- Rocky Linux - Package management -- [docs.rockylinux.org](https://docs.rockylinux.org/guides/package_management/)
- Fedora documentation - DNF -- [docs.fedoraproject.org](https://docs.fedoraproject.org/en-US/quick-docs/dnf/)
- EPEL project -- [fedoraproject.org/wiki/EPEL](https://fedoraproject.org/wiki/EPEL)
- Arch Wiki - pacman (cross-reference) -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- Bird's Private Recipes (Lin's Linux Administration Guide) - Software management -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0520rpm_and_srpm.php)
- `man dnf`, `man rpm`, `man dnf-versionlock`, `man dnf.conf`

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/basic/README.md)
- [packages](/basic/packages.md)
- [apt](apt.md)
- [pacman](pacman.md)
- [tarball](tarball.md)
- [package](/commands/package/package.md)
- [coverage-matrix](/research/coverage-matrix.md)
