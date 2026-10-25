# Package Management Commands

Installing software, upgrading, checking dependencies, clearing caches -- these happen on every machine every day, but the three families' commands look completely different: Debian calls it `apt`, RHEL 8+ calls it `dnf` (older docs still say `yum`), Arch calls it `pacman`. Typing an APT-family `apt install` on Arch yields only `command not found`, and conversely Ubuntu will not recognize `pacman -Syu`. This page is a **command quick-reference handbook**: three master tables plus real output pin down the "six everyday jobs" (install, upgrade, search, repo, cache, lock), then fill in the underlying `dpkg`/`rpm` layers and the repo ecosystem (PPA, EPEL, AUR). Concepts and distro choice live in [Software Package Management](../../basic/packages.md) of the fundamentals chapter; APT detail in [apt deep dive](../../basic/packages/apt.md), RHEL family detail in [yum/dnf deep dive](../../basic/packages/yum.md). This page does not repeat long principle explanations -- **for "how to do it", look here first; for "why", go to the fundamentals chapter**.

> Three-family comparisons give commands separately for **Debian/Ubuntu (apt/dpkg), RHEL/CentOS/Rocky (dnf/rpm), and Arch (pacman)**; a command appearing in two families is shown side by side in the table. All APT/dpkg output comes from a real Ubuntu 26.04 environment; dnf and pacman output follows each family's stable-version standard format -- if your machine is newer, column names may differ slightly, but the semantics are identical.

## What This Page Covers

- Identify in 30 seconds which family the current system belongs to and which command set to use (including minimized-install and container exceptions)
- Compare apt, dnf, and pacman equivalents across the six dimensions: install / upgrade / search / repo / cache / lock
- The relationship between `dpkg`/`rpm` and their frontends: when you must drop down a layer
- Correct use of PPA (Debian/Ubuntu), EPEL (RHEL family), and AUR (Arch)
- Using `apt-mark`, dnf version lock, and `pacman -IgnorePkg` to avoid critical packages being broken by automatic upgrades

## 1. Identify the System First: Which Command Set to Type

`uname` is not enough; containers may be any distro. Three lines of commands locate the family and toolchain:

```bash
$ cat /etc/os-release | grep -E '^(ID|ID_LIKE)='
ID=ubuntu
ID_LIKE=debian

$ command -v apt dnf pacman yum 2>/dev/null
/usr/bin/apt
```

Judgment rules (in priority order):

1. Has `apt` and `/etc/debian_version` exists -> **Debian/Ubuntu family**, frontend `apt`/`apt-get`, underlying `dpkg`
2. Has `dnf` -> **RHEL 8+/Fedora/Rocky 8+**, underlying `rpm`; only `yum` is likely RHEL 7 or a compatibility alias (`yum` on new systems is often a thin shell pointing to dnf)
3. Has `pacman` and `/etc/arch-release` exists -> **Arch/Manjaro etc.**, frontend and underlying are one tool: `pacman`
4. None of the three -> slim containers, Alpine (`apk`), SUSE (`zypper`), etc., not covered by this page

**Three hard rules**: do not mix (do not install rpm on Debian, and do not expect to double-click a `.deb` into Arch); do not copy "already compiled binary directories" across families (glibc/dependency ABI will bite you); when upgrading, **use only one frontend per family** (Ubuntu `apt upgrade` and `unattended-upgrades` can coexist, but do not manually alternate apt and dpkg for upgrades).

Container scenarios often hit "no apt and no dnf/pacman": Alpine is `apk`, Ubuntu/Debian images are apt, Rocky containers are dnf, Arch containers have `pacman`. In Dockerfiles, use the image's officially recommended frontend, and merge upgrade+install+index-clean in `RUN` (e.g. `apt-get update && apt-get install -y --no-install-recommends ... && rm -rf /var/lib/apt/lists/*`) -- this both shrinks layer size and avoids "stale index prevents install". Cross-image copying of precompiled artifacts like `node_modules` is inherently unreliable; binary distribution should target the destination distro's package manager, not assume every machine is Ubuntu.

```bash
$ dpkg --version | head -1
dpkg command line interface; version 1.22.6ubuntu8;

$ pacman --version
 Pacman v6.1.0 - libalpm v15.0.0
```

## 2. Six-Dimension Master Table: apt / dnf / pacman

The three tables below are this page's core. When you cannot remember, memorize the **verbs** first, then map to each family's parameters: install `install`, upgrade `upgrade`/`update`, search `search`, uninstall `remove`/`erase`/`-R`, find which package owns a file is `-S` in both apt and pacman (dpkg is `-S`; note pacman's `-S` is sync/install, case-sensitive).

### 2.1 Install / Upgrade / Uninstall

| Operation | Debian/Ubuntu | RHEL/CentOS/Rocky | Arch |
|------|-----------------|------------------------|------|
| Install | `sudo apt install package` | `sudo dnf install package` | `sudo pacman -S package` |
| Batch install | `sudo apt install a b c` | `sudo dnf install a b c` | `sudo pacman -S a b c` |
| Upgrade all | `sudo apt update && sudo apt full-upgrade` | `sudo dnf upgrade --refresh` | `sudo pacman -Syu` |
| Upgrade installed only | `sudo apt upgrade` | `sudo dnf upgrade` | `sudo pacman -Syu` (Arch has no official "partial upgrade" support) |
| Upgrade single package | `sudo apt install --only-upgrade package` | `sudo dnf upgrade package` | `sudo pacman -S package` (sync repo) |
| Uninstall (keep config) | `sudo apt remove package` | `sudo dnf remove package` | `sudo pacman -R package` |
| Uninstall (delete config) | `sudo apt purge package` | `sudo dnf remove` (config mostly in `/etc`, delete by hand or combine with `--no-autoremove`) | `sudo pacman -Rns package` (`-n` deletes config too) |
| Autoremove deps | `sudo apt autoremove` | `sudo dnf autoremove` | `sudo pacman -Qdtq \| sudo pacman -Rns -` |
| Reinstall | `sudo apt install --reinstall package` | `sudo dnf reinstall package` | `sudo pacman -S package` (for corruption use `pacman -Syyu package`) |

In the Arch column, `pacman` appears most densely because its parameters are **verb combinations**, not English words: `-S` (Sync, install/upgrade), `-R` (Remove), `-Q` (Query), and `-Syyu` forces a metadata refresh plus full upgrade. Case must be exact -- `-S` and `-s` are different operations (the latter is "search only"); the most common error is missing the uppercase `S`.

The Debian/Ubuntu `full-upgrade` vs `upgrade` difference: the former is willing to **remove conflicting old packages** for an upgrade, and is more thorough for cross-version distro jumps (e.g. before `do-release-upgrade`); daily `apt upgrade` is more conservative. The RHEL-side counterparts are `dnf upgrade` and `dnf distro-sync` (the latter aligns versions with the repo, more common across minor versions). Arch is a rolling release, and the official stance is **always upgrade the whole system with `pacman -Syu`**, opposing single-package "partial upgrades" -- those create dependency hell.

A real install example (Ubuntu), keeping only the three most informative lines: `sudo apt update` ends with `Reading package lists... Done`, `sudo apt install -y sl` shows `1 newly installed` and `Setting up sl`, and finally `Processing triggers for man-db` signals triggers finished -- if triggers are missing, the manual index stays stale, but that does not mean the install failed. **Watching the progress bar is less useful than watching the three numbers "newly installed / upgraded / removed"**, which are the stable anchor for scripts to judge success.

`apt update` only refreshes the **index**, downloading nothing and upgrading no packages; `apt install` is what downloads and installs. The RHEL correspondence: `dnf makecache` ~ update, `dnf install` ~ install. Does Arch's `pacman -S` need a manual metadata "update" first? -- Yes: `pacman -Sy` refreshes, `pacman -Syu` refreshes+upgrades. Before a single install you may habitually write `pacman -Sy package`, but the safest is still `sudo pacman -Syu` first to guarantee system consistency.

Understanding "index vs package body" explains most daily confusion: error `Unable to locate package` or `No match for argument` -- first ask whether you **only searched without updating the index** (or conversely, the index is fresh but the local cache was `clean`ed). Disk full, download 404, signature verification failure are package-body/repo-layer problems, unrelated to search. The three families differ in "whether to auto-refresh metadata on upgrade" -- dnf often carries `--refresh`, pacman's `-Syu` bundles the refresh, apt deliberately splits them -- in scripts, prefer writing the extra explicit step rather than betting on implicit behavior in production.

### 2.2 Search / Info / File Ownership

| Operation | Debian/Ubuntu | RHEL/CentOS/Rocky | Arch |
|------|-----------------|------------------------|------|
| Search by name | `apt search keyword` | `dnf search keyword` | `pacman -Ss keyword` |
| Check installed | `apt list --installed` / `dpkg -l package` | `dnf list installed` / `rpm -qa` | `pacman -Qs keyword` |
| Package info | `apt show package` | `dnf info package` | `pacman -Si package` (repo) / `-Qi` (local) |
| Description contains keyword | `apt-cache search --names-only` or `aptitude search` | `dnf search --all` | `pacman -Ss` already includes description |
| Which package owns a file | `dpkg -S /path` | `rpm -qf /path` | `pacman -Qo /path` |
| What files a package installed | `dpkg -L package` | `rpm -ql package` | `pacman -Ql package` |
| What a package depends on | `apt-cache depends package` | `dnf repoquery --requires package` | `pacman -Si package` look at Depends |
| Who depends on me | `apt-cache rdepends package` | `dnf repoquery --whatrequires package` | `pacman -Qii package` / `pactree package` |

Real examples (`apt-cache`/`dpkg` and their `pacman -Ss`/`-Qo` counterparts):

```bash
$ apt-cache policy sl
sl:
  Installed: (none)
  Candidate: 5.05-1
  Version table:
     5.05-1 500
        500 http://cn.archive.ubuntu.com/ubuntu noble/universe amd64 Packages

$ apt-cache search --names-only '^sl$'
sl                    5.05-1   universe: Correct the train

$ dpkg -S /usr/bin/vim 2>/dev/null || dpkg -S /etc/vim/vimrc
vim-runtime: /etc/vim/vimrc

$ dpkg -L iproute2 | grep -E '/(ip|ss)$'
/usr/sbin/ip
/usr/sbin/ss

$ pacman -Ss ^vim$ ; pacman -Qo /usr/bin/vim
extra/vim 9.1.1231-1
    Vi Improved, a highly configurable, improved version of the vi editor
/usr/bin/vim is owned by vim 9.1.1231-1
```

`apt-cache policy` is the fastest way to check "is it installed, which source the candidate comes from, what the priority is", and **needs no sudo** (reads cache). Correspondingly, `pacman -Si package` gives the repo source and dependencies, `pacman -Qi` gives the local installed version and install time; the dnf side is `dnf info` and `dnf list installed`. "Why is the command not found after install" is solved by the "file ownership" row: `dpkg -S` / `rpm -qf` / `pacman -Qo` directly tell you which package provides the binary.

The numbers in `policy` output (e.g. `500`) are pin priorities, not version numbers; 100 is the installed baseline, >100 allows upgrade, `origin` and `-1` are often used for locking. You do not need to memorize the full rules daily, but you must read the three lines: **what Installed is, whether Candidate is the expected version, and whether the source URL in Version table is correct**. If Candidate has long sat at an old version, it is likely pinned or that repo was disabled; if Candidate is `none`, there is no candidate at all -- go back to the index-refresh column.

Search commands share another property: **they are all "text matching", not "semantic search"**. `apt search`, `pacman -Ss`, `dnf search` all hit on package-name+description substrings; one misspelled letter gives an empty result. Trying synonyms, abbreviations, and upstream project names, each once, is faster than staring at one keyword. All three families support regex style (apt's `apt-cache search --names-only '^vim'`, pacman's `pacman -Ss ^vim$`); in scripts prefer anchors, to avoid sweeping `vim-runtime` and `neovim` into an automated install list.

### 2.3 Repo / Source / Cache / Lock

| Operation | Debian/Ubuntu | RHEL/CentOS/Rocky | Arch |
|------|-----------------|------------------------|------|
| Refresh index | `sudo apt update` | `sudo dnf makecache` | `sudo pacman -Sy` (usually merged into `-Syu`) |
| List enabled repos | `apt-cache policy` / look at `/etc/apt/sources.list.d/` | `dnf repolist` / `dnf repolist -a` | the `[extra]`/`[community]` sections of `/etc/pacman.conf`; `pacman -Sl` |
| Add third-party source | `add-apt-repository ppa:user/ppa` or hand-write a `.list` | `dnf config-manager --add-repo URL` or install a `.repo` file | append a custom repo to `pacman.conf` (signing keys must be imported) |
| Cache location | `/var/cache/apt/archives/` | `/var/cache/dnf/` | `/var/cache/pacman/pkg/` |
| Clean cache | `sudo apt clean` / `apt autoclean` | `sudo dnf clean all` | `sudo pacman -Sc` (keeps installed packages) / `-Scc` (full clear) |
| Lock against upgrade | `sudo apt-mark hold package` | `dnf install package-version` or edit dnf's `exclude=` | `IgnorePkg = package` in `/etc/pacman.conf` |
| Unlock | `sudo apt-mark unhold package` | remove the `exclude=` entry | delete the corresponding `IgnorePkg` item |
| Check lock status | `apt-mark showhold` | `dnf repoquery --installed \| grep -i exclude` (or check config) | `grep IgnorePkg /etc/pacman.conf` |

Repository files and third-party sources can be distinguished this way: APT's deb822/.list lines live in `/etc/apt/sources.list` and `sources.list.d/*.list`, shaped like `deb http://... noble main restricted universe multiverse`; add a PPA with `add-apt-repository ppa:user/ppa`. RHEL's `.repo` files live in `/etc/yum.repos.d/`, added with `dnf config-manager --add-repo` or by installing `epel-release`. Arch's repo sections live in `/etc/pacman.conf` (`[extra]` + `Include = /etc/pacman.d/mirrorlist`); to lock the kernel, write `IgnorePkg = linux linux-headers`. **When you change a source, change the corresponding manager's file, and refresh the index immediately after**, or you will see "the file changed but policy still shows the old URL".

Cache directories map directly to "offline reinstall/rollback" capability: APT's `.deb`, dnf's rpm, and pacman's `.pkg.tar.zst` all sit in their respective caches. **Clearing the cache does not uninstall installed packages**; it only affects "can you install once more without network". `pacman -Sc` and `apt clean` are both standard disk-freeing actions; when slimming container images, all three families run one of these first (Arch uses `-Scc` for a more thorough clean). Locking philosophy differs: Ubuntu habitually uses `apt-mark hold` per package (`linux-image` is often locked); RHEL relies on `exclude=`/module streams to control major versions; Arch officially does not recommend long-term IgnorePkg -- in a rolling distro, locking too long will blow up as dependency conflicts at the next `pacman -Syu`; only lock for critical days and unlock as soon as possible.

The repo column also needs a three-tier trust split: "official, distro-derived, third-party". Ubuntu main repos and updates/security are officially maintained; PPAs and RHEL's EPEL are semi-official; AUR or a randomly pasted `.list`/`.repo` depends entirely on the author. Production baseline recommendation: default to official sources only, register each extension source as an asset (who enabled it, when, how to disable), and periodically audit `apt-cache policy` / `dnf repolist -v` / `pacman.conf` for unexpected lines someone added -- a tampered software source is one of the most common persistence methods after a server is compromised.

## 3. APT and dpkg: Debian/Ubuntu

`apt` is the interactive high-level frontend; `apt-get`/`apt-cache` are the stable scripting interfaces (old material is full of them); `dpkg` is the **underlying installer** -- it resolves no dependencies and touches no network, handling only the `.deb` file itself. The relationship to remember: **apt = dpkg + dependency solving + repo index**. The three daily threads: refresh the index with `apt update`; install/upgrade/uninstall with `apt install|full-upgrade|remove|purge`; fix dependencies and half-installs with `apt install -f`. In scripts, swap the interactive `apt` for `apt-get -y` (and `apt-get update` on its own line), so prompts do not hang CI.

The underlying `dpkg` steps in only for three cases: installing a local `.deb` (`dpkg -i`), checking status and ownership (`dpkg -l/-S/-L`), and repairing interrupted configuration (`dpkg --configure -a`). `apt-cache policy`/`search`/`depends` answer "candidate version, dependency graph" **without installing** -- during troubleshooting, policy before install is the standard move, and it blocks ninety percent of "installed the wrong version". Two `dpkg -l` status codes are worth memorizing: `ii` normal install, `rc` removed but config remains, `iU`/`iF` meaning not-unpacked/not-configured (half-install); finish with `apt install -f` or `dpkg --configure -a`.

**When you must use dpkg**: installing vendor-provided local `.deb` files (NIC drivers, closed-source clients), repairing half-install state, and emergency use when `apt` is completely unavailable due to index corruption. After installing a `.deb`, remember `apt install -f`, otherwise missing dependencies will explode all at once on the first `apt upgrade`. APT permission note: `apt` auto-prompts for sudo, `apt-get` does not; in cron scripts, always use `apt-get -y`.

The layered mental model to remember: **want to know "what is in the repo, how dependencies resolve" -> apt/apt-cache; want to touch local files and state -> dpkg**. Both share the same database (`/var/lib/dpkg/status`), so `dpkg -l` can see what apt installed and vice versa; but only apt knows "where to download, version comparison, automatic dependencies". After a manual `dpkg -i` leaves the status code stuck at `iU`/`iF`, do not repeatedly `-i` force-install -- use `sudo apt install -f` to let the frontend complete the dependency graph. For version comparison, do not use string sort: `dpkg --compare-versions 2.10 gt 2.9` is the package-manager semantics.

## 4. DNF/YUM and rpm: The RHEL Family

RHEL 8 / CentOS 8 / Rocky / Alma / Fedora all unify on `dnf`; `yum` is kept as a command alias (the `yum` -> dnf compatibility layer), and **new scripts should all use dnf**; only maintaining a RHEL 7 legacy base continues writing `yum`. The underlying layer is `rpm`, with the same relationship as apt/dpkg: **dnf = rpm + dependency solving + repos**.

`dnf history` is the RHEL family's safety rope: `dnf history` shows transaction numbers, `sudo dnf history undo 42` rolls back an entire transaction (more reliable than manual downgrade for multi-package upgrades). The command thread parallels apt: refresh `dnf makecache`, install/upgrade/uninstall `dnf install|upgrade --refresh|remove`, reinstall `dnf reinstall`, check repos `dnf repolist`, check info `dnf info|search|list installed`, clean cache `dnf clean all`, roll back `dnf downgrade`. The underlying `rpm` maps to `-ivh`/`-e`/`-qa`/`-qi`/`-ql`/`-qf`/`-V`, with the same responsibility boundary as dpkg -- **dependencies and repos belong to dnf, local files and verification belong to rpm**.

In `rpm -V` output, markers like `5` (checksum changed), `T` (timestamp), `S` (size) quickly reveal "a file the package claims was modified by someone" -- common in server-compromise triage. **When you must use rpm**: installing local `.rpm` packages, forced queries when dnf sources are unavailable (`rpm -qa`), and file integrity verification. After installing a local rpm, `dnf install ./xxx.rpm` is often better than `rpm -ivh`, because dnf resolves dependencies automatically.

`rpm -V` practical use deserves a standalone mention: take a baseline for critical packages (sshd, sudo, kernel), or periodically run `rpm -Va | grep -v '^....5'` in CI to filter known noise. The leftmost 8 characters in output represent attributes (S size, M mode/permission, 5 checksum, U owner, G group, T time, D device, L symlink), and `.` means that item matches -- **whichever position is not a dot, that item was touched**. Combined with `dnf repoquery --changelog`, you can push the "official patch vs local tampering" question one layer further; raising alarm at a mere checksum change tends to miss the normal differences that come from distro repackaging.

The RHEL family also frequently meets **module streams** (AppStream's `module enable`): when mysql 8.0/8.4 coexist in the same repo, `dnf module list mysql` shows available streams, `sudo dnf module enable mysql:8.4` before installing -- this is a dimension Debian/Arch do not have, so do not copy `apt install` verbatim when migrating cross-version scripts.

The practical differences between dnf and old `yum`, from an ops perspective, come down to three points: dependency solving and module streams are dnf-exclusive; `dnf history` has more complete transaction granularity than yum, making rollback more trustworthy; error messages carry `hint` and can tell you which repo is missing. The script compatibility strategy is **uniformly write dnf**, keeping `yum` only in branches that must support RHEL 7. Compared to apt, note: `dnf install` already does `makecache`-style metadata handling by default, but it is still recommended to explicitly run `dnf makecache` or `upgrade --refresh`, splitting "refresh" and "download package bodies" into two steps in poor-network environments, which makes failures easier to locate.

## 5. pacman: Arch Family Quick Reference

Arch has only one official package manager, **`pacman`**, with no dpkg equivalent (it unpacks directly + runs hooks), and no separation ritual between `apt update` and `apt install` -- metadata refresh and upgrade are tightly coupled. `pacman` parameters are **combinations of four verb switches**, and that is its first difficulty:

| Switch | Verb | Purpose | Typical combinations |
|------|------|------|----------|
| `-S` | Sync | install/upgrade from repo | `-S package`, `-Syu`, `-Ss keyword` |
| `-R` | Remove | uninstall | `-R package`, `-Rns package` |
| `-Q` | Query | query local database | `-Qs`, `-Qi`, `-Ql`, `-Qo` |
| `-U` | Upgrade | install a local package file | `pacman -U ./pkg.pkg.tar.zst` |

Combination examples (watch the case carefully) can be memorized as one trunk plus four groups of suffixes: the trunk is `sudo pacman -S/-R/-Q/-U`; after `-S` you can stack `y` (refresh index), `u` (upgrade), `s` (search, lowercase `-s`), and `yy` (force re-refresh); after `-R` you often stack `n` (delete config) and `s` (clear deps) to get `-Rns`; after `-Q` you stack `s/i/l/o/d/m` for search, details, list files, ownership, orphans, and foreign packages respectively. To install a local file use `-U ./package.pkg.tar.zst`; to find a package by filename use `pacman-contrib`'s `pacman -Fy` and `pacman -F keyword`. The five high-frequency daily lines: `pacman -S package`, `sudo pacman -Syu`, `pacman -Ss keyword`, `pacman -Qs keyword`, `sudo pacman -Rns package`.

`pacman -Syu` upgrades occasionally show `:: Proceed with installation? [Y/n]` and hook output (`mkinitcpio`, `ldconfig`) -- these are normal; if you see `error: failed to commit transaction (conflicting files)`, look at the conflict paths first, **do not** habitually run `pacman -Syu --overwrite '*'` -- that is defusing bombs, not solving the problem. Arch officially opposes long-term single-package upgrades (partial upgrades): `pacman -S just-one-package` on a system whose deps have already advanced may fail to link; the correct move is always `-Syu`.

Three config files to recognize: `/etc/pacman.conf` controls repo switches, `IgnorePkg` locking, and `ParallelDownloads`; `/etc/pacman.d/mirrorlist` controls mirror order (fastest on top); `/var/log/pacman.log` records every installed/upgraded/removed event, the first scene for tracing "who touched this package". During troubleshooting, first `grep` the log for package name and timestamp, then compare against the same-version behavior on a test machine -- much faster than staring at the error and guessing. `pacman -Q --explicit` lists **manually installed** packages (system deps don't count), a starting point for slimming a system or generating a personal package manifest; `pacman -Qtdq` (or `pacman -Qdtq`) lists orphan deps, pipe into the master table's `| sudo pacman -Rns -` for safe cleanup. Before manually installing an AUR package on Arch for the first time, run `sudo pacman -S --needed base-devel git`; the AUR flow is in the next section -- **the AUR is not part of pacman, and pacman does not recognize any AUR helper other than `yay`/`paru`** (yay/paru are themselves packages and must be installed with pacman first).

When treating `pacman` as your only daily entry point, three small things reduce gotchas: before upgrading, check whether `/etc/pacman.conf` has commented-out `[extra]`/`[multilib]` sections (a missing repo makes `pacman -Ss` "out of nowhere" unable to find things); for slow mirrors, change the top of `mirrorlist` rather than repeatedly `pacman -Syyu` hard-refreshing; for conflict errors, read through `conflicting files` before deciding whether the package was locally modified (`pacman -Qkk package`) or it is a real bug. The Arch official forums and Wiki almost always have install instructions findable via the exact package name from `pacman -Ss` -- **confirm the package name is in the official repo first, then consider the AUR**, an ordering that matters especially in production.

## 6. Repository Ecosystem: PPA, EPEL, AUR

The "beyond official repos" mechanisms of the three families are completely different, with different trust levels: **official repos > distro-officially-endorsed extension sources > user community builds (AUR)**. The more "wild" an extension source, the tighter to tighten in production.

### 6.1 PPA (Ubuntu)

Personal Package Archive, hosted on Launchpad, bound to Ubuntu version numbers. The flow: install `software-properties-common`, `add-apt-repository ppa:deadsnakes/ppa`, then `apt update` and `apt install` the target package; the manual equivalent is writing a line to `sources.list.d`: `deb https://ppa.launchpadcontent.net/... noble main`, and remove with `add-apt-repository --remove`.

Note that PPAs only cover Ubuntu (and derivatives) and do not work on Debian; a third-party PPA means trusting the author with **arbitrary root-level install scripts** from the repo, so add as few as possible on production servers. Keys are auto-imported into `trusted.gpg.d` during `apt update`.

### 6.2 EPEL / CRB (RHEL Family)

Extra Packages for Enterprise Linux, built by the Fedora community for RHEL/CentOS/Rocky, **explicitly recommended in official docs**, but still an external repository:

```bash
# Rocky/Alma/RHEL (change version number per system)
sudo dnf install epel-release
# On RHEL 8/9 the extras repo may be renamed CRB (CodeReady Builder)
sudo dnf config-manager --set-enabled crb
sudo dnf repolist | grep -i epel
sudo dnf install htop
```

After enabling, `dnf repolist` should show an extra `epel` line. EPEL packages and RHEL core packages have **different version strategies** (EPEL updates more often); a few packages (e.g. certain `nano` versions) have had precedents of conflicting with base -- when problems arise, first `dnf repolist -v` to check the package source, then handle it.

### 6.3 AUR (Arch User Repository)

**The AUR is not a binary repository**: it contains user-maintained `PKGBUILD` scripts, which `pacman` cannot install directly -- you need helpers like `yay`, `paru` to build with `makepkg` first, then hand off to `pacman -U`. One-time bootstrap: `sudo pacman -S --needed base-devel git`, then `git clone https://aur.archlinux.org/yay.git && cd yay && makepkg -si` (`-s` uses pacman to fetch deps, `-i` installs into the system). Daily use switches to `yay -S package`, `paru -Syu --aur`, `yay -Qm` to list foreign packages, `yay -Sc` to clean the build cache.

The trust boundary must be clear: **a PKGBUILD is arbitrary shell** -- installing an AUR package means running a stranger's script; first `less PKGBUILD` to inspect `source`, `prepare()`, `build()`, and you personally vouch for anything not in the official repos. `yay -Qm` (or `pacman -Qm`, where `m` = foreign/non-official repo) is the audit checklist: have foreign binaries snuck into the system? One run tells you. The production-server principle: **use the official repo whenever possible, never the AUR**; when unavoidable, lock versions, record `pacman.log`, and run a full `pacman -Syu` chain on a test machine before upgrading.

Compared to the other two families, the trust model is actually continuous: Ubuntu's PPA and RHEL's EPEL at least have distro or community endorsement and a build farm; the AUR is "user uploads a recipe, you build locally", with **no unified binary review**. So even though they all go by "third-party source", the risks are not equivalent. Three self-checks before going to production: is the package only in the AUR (if it is in the official repo, use `pacman -S package`/`apt install`/`dnf install`); does the build only fetch declared `source` (no suspicious curl|sh); is the uninstall/upgrade path controllable (`pacman -Qm` can see it, `-Rns` can remove it). If you cannot satisfy these three, use it on test or dev machines, not in production.

## 7. Common Gotchas

Common gotchas stick better when memorized by lifecycle than by command: **before install, during upgrade, after upgrade, during cleanup**. Before install, the most common mistakes are picking the wrong frontend and searching the wrong repo; during upgrade, the most common are partial upgrades and mixed automated tasks; after upgrade, the most common are not reading logs and not verifying deps; during cleanup, the most common is clearing the cache and then expecting offline rollback.

**Before install**: first `command -v` to identify the family, then `policy`/`-Si`/`info` to check candidates and repos, and only then `install`. Skipping the middle two steps means doubling your time on rework after "installed a lookalike package" or "pulled a higher version from an unexpected third-party source".

**During upgrade**: plan a window, lock packages that must not move, and pick one automated task as the single source of truth. Before cross-major-version jumps (Ubuntu `do-release-upgrade`, RHEL `dnf distro-sync`, Arch rolling), rehearse the full flow on a test machine, and back up the package manager database and critical config directories -- rollback capability does not come from some magic command flag, it comes from whether you have a recoverable state.

**After upgrade**: read the logs (apt/dnf history/pacman.log), run a smoke test on critical services, and confirm `ii`/installed status has not broadly regressed to `rc`/orphan. Database, kernel, and language-runtime upgrades are the three most likely to trigger chain reactions -- verify each one.

**During cleanup**: cache and installed list are two different things; `-Scc` and `apt clean` only affect "can you install offline", `autoremove`/`-Rns` is what actually moves the dependency graph. Cleanup commands should also be `--dry-run` or previewed as a list before confirming, especially on shared hosts running multiple workloads.

Reverse-tracing by symptom: "package not found" -> index not refreshed or repo not enabled; "dependency conflict / half-install" -> go down to dpkg/rpm to fix state, then let the frontend `-f`/`reinstall` wrap up; upgrade cut short by network drop -> resume if resumable, otherwise locate the transaction boundary from `history`/`pacman.log` -- do not hand-delete half a package from `/var/lib`; AUR/helper build failure -> first read the PKGBUILD and the first missing dependency in the error, do not stack `--overwrite`/`--noconfirm`.

1. **Typing habitual commands on the wrong distro**. `apt install` vs `dnf install` vs `sudo pacman -S` are not interchangeable; automation scripts should probe with `command -v` first.
2. **Only `apt update` without `upgrade`, or upgrading only one package**. update is only the index; Debian allows single-package upgrades but they lag behind, **Arch strictly forbids partial upgrades**, `pacman -Syu` forward as a whole.
3. **Using `pacman -R` while expecting config cleanup**. Config files are kept by default, use `-Rns`; orphan deps are cleaned separately via the `-Qdtq` pipe -- do not blanket `-Rns $(pacman -Qdtq)` without reading the list.
4. **`dpkg -i` and walking away**. Local `.deb` files with unmet dependencies leave a half-install; follow up with `sudo apt install -f`; same applies when `dpkg -l` shows non-`ii` status.
5. **Treating the AUR as the official repo**. `pacman` will never find the AUR; when a helper build fails, look at the `PKGBUILD` and dependencies first -- do not blindly hammer `--noconfirm` through installs.
6. **Clearing the cache and then expecting offline reinstall**. `apt clean`/`dnf clean all`/`pacman -Sc` delete downloaded package copies; if you need offline capability, do not run `pacman -Scc`.
7. **Forgetting to lock the kernel/critical packages**. Ubuntu `apt-mark hold linux-image-...`, Arch `IgnorePkg = linux linux-headers`, RHEL `exclude=kernel*` -- lock the lifelines outside upgrade windows, then unlock after `showhold`/config review.
8. **Running interactive apt inside containers**. Set `DEBIAN_FRONTEND=noninteractive apt-get install -y` to avoid configure prompts hanging CI; dnf/pacman likewise add `-y`/`--noconfirm`.
9. **Mixing `yum` and `dnf` transactions**. RHEL 8+ is actually all dnf under the hood, but having two cache/history sets coexist can confuse; teams should uniformly write `dnf`.
10. **Not reading logs after upgrading**. APT logs to `/var/log/apt/term.log`, dnf uses `dnf history`, Arch always check `/var/log/pacman.log` -- you can pin down which transaction caused the issue within the first minute.
11. **Treating "search results" as "installable"**. `apt search` matches noise packages in description keywords, `pacman -Ss` similarly; before installing, confirm package name, repo, and candidate version with `policy`/`-Si`/`info`.
12. **Multi-machine ops using the same upgrade command but with different frontends installed**. A given machine should always recognize only one "source of truth": either cron runs `unattended-upgrades`, or manual `apt`, or `dnf automatic`, or scheduled `pacman -Syu` -- two automated upgrade systems coexisting will inevitably fight over lock files and rollback logs.

## 8. Selection Guidance and Discipline

The three families have no absolute "who is more advanced" answer, only **the match between ops model and talent pool**: if you want a stable patch cadence and commercial support, Debian/Ubuntu LTS or the RHEL family fits better; if you are willing to accept rolling, like software always fresh, and can fix packages yourself, Arch's `pacman` actually carries a low mental burden; in enterprise estates, two families coexisting is normal -- what is truly dangerous is not coexistence, but **a script author who knows only one family yet force-fits it onto the other**.

The minimal discipline for individuals and teams (memorizing these beats memorizing 100 commands): one, **one system, one frontend**, with a single upgrade window; two, **policy/info before install, read the list before delete**; three, **lock critical packages, read logs after upgrade**; four, **third-party sources must be registered and rollback-capable**; five, **whatever can live in a config file should not stay only in shell history**. Commands change, distros get replaced -- these five apply verbatim across apt/dnf/pacman.

If you maintain cross-distro automation, converge the differences into **one probe function + three adapters**: the function uses `command -v` to determine the family, the adapters each map the four verbs install/upgrade/search/remove, and all other logic is shared. Do not scatter `if ubuntu` throughout business code -- package management differences are an infrastructure-layer concern and should be translated at the entry point. Your test matrix must cover at least a minimal-install image for all three families, otherwise your `pacman -Syu` branch will exist only in documentation.

## References

- `man apt`, `man apt-get`, `man dpkg`, `man dnf`, `man rpm`, `man pacman`
- Bird's Private Recipes (Lin's Linux Administration Guide) - Software package management -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0520source_code_and_tarball.php)
- Arch Wiki - pacman -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- Arch Wiki - AUR -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Arch_User_Repository)
- Debian Wiki - apt -- [wiki.debian.org](https://wiki.debian.org/Apt)
- Ubuntu - PPA / repositories docs -- [documentation.ubuntu.com](https://ubuntu.com/server/docs/package-management)
- DNF docs (Fedora) -- [dnf.readthedocs.io](https://dnf.readthedocs.io/)
- Red Hat - Installing software packages with DNF -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_software_with_the_dnf_tool/index)
- EPEL FAQ -- [docs.fedoraproject.org](https://docs.fedoraproject.org/en-US/epel/faq)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/commands/README.md)
- [package](/commands/package.md)
- [coverage-matrix](/research/coverage-matrix.md)
