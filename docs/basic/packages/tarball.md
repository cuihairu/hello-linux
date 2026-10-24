# Source Build and Tarball Install

There are three kinds of installs package managers cannot solve: software that simply does not exist in any repo, software where the repo version lags behind upstream fixes, and software that needs code changes or non-standard compile options. All three point to the same path: take the source tarball published by upstream (the community calls it a tarball) and compile and install it yourself. State the cost up front: leaving the package database means you watch for upgrades yourself, security advisories will not find you, and there is no first-class command for uninstall. This page lays out the full flow, the judgment at each step, and when to fall back to a package manager.

> Content drawn from the GNU build system documentation, the README/INSTALL shipped inside each project's source tarball, and Bird's Private Recipes chapter 21. See references at the end.

## What This Page Covers

- Decide whether an install need should go through the package manager or through source, and name the cost of each path
- Install the full toolchain across the three families, read `./configure`'s detection logic and understand what `--prefix` means
- Complete the standard "download - verify - unpack - configure - make - install" flow, and read `config.log` when it breaks
- The `/usr/local` convention and the cleanup actions for `ldconfig` and `PATH`
- Recognize the long-term cost of source installs drifting from the package database, and build the habit of falling back to the package manager

## 1. When to Use Source

| Situation | Package manager | Source |
|------|---------|--------|
| In the repo, version is good enough | Default choice | Not needed |
| Not in the repo (niche tool, your own software) | Check third-party repos or EPEL/AUR first | Fits |
| Repo version too old, upstream fix needed | Try backports/EPEL/AUR before deciding | Fits |
| Need code changes, special compile options, or your own patches | Basically impossible (you'd build the package yourself) | Fits |
| Bulk deploy in production | Strongly recommended (auditable, rollback-able) | Think carefully; consider only after scripting the install |

The core of the decision is not "can it be installed" but who owns it afterward: the package manager owns upgrades, security updates, and uninstall consistency, while a source install is owned only by you. Source-installed software is invisible at the system level -- `dnf list installed` will not show it, `apt upgrade` will not touch it. That invisibility is the source of both its flexibility and its risk.

## 2. Toolchain Preparation

Compiling C/C++ software needs a compiler, build tools, and header files. Entry points across the three families:

| Operation | Debian/Ubuntu | RHEL/Rocky | Arch |
|------|---------------|-----------|------|
| Build tool group | `apt install build-essential` | `dnf groupinstall "Development Tools"` (group name follows the actual `dnf group list` output) | `pacman -S base-devel` |
| Header package convention | Library name + `-dev` (e.g. `libssl-dev`) | Library name + `-devel` (e.g. `openssl-devel`) | Not split; the main package includes headers |

Arch does not split devel packages, RHEL-family splits on `-devel`, Debian-family splits on `-dev` -- this naming difference is the most common pitfall in source installs: when configure reports "cannot find xxx.h", the missing piece is the development package for that library, and each family installs it under its own convention. The group-name lesson has a precedent in this repo: group names change across major versions, so run `dnf group list` to check the actual output before you act.

## 3. Standard Flow

Take a hypothetical `demo-app` as the example; six steps end to end:

```bash
$ wget https://example.com/dist/demo-app-1.4.2.tar.xz
$ sha256sum demo-app-1.4.2.tar.xz        # Compare against the checksum published on the site; guards against transfer corruption and tampering
$ tar -xJf demo-app-1.4.2.tar.xz          # .xz uses -xJf; .gz uses -xzf
$ cd demo-app-1.4.2
$ less README INSTALL                     # Read the install notes first; special dependencies and options live here
$ ./configure --prefix=/usr/local/demo-app
$ make -j"$(nproc)"                       # Parallel build; thread count equals core count
$ sudo make install
```

### 3.1 What configure Does

`./configure` is a probe script: it checks the compiler, function libraries, and header files one by one, then generates the `Makefile` from what it finds. `--prefix` decides the install root; the convention is either a dedicated subdirectory under `/usr/local` or `/usr/local` itself. Choosing `/usr/local` rather than `/usr` is deliberate: `/usr` is the package manager's territory, and once source files are mixed in there the package manager and your files will overwrite each other with no way to reconcile the accounts. `/usr/local`, by convention, belongs to the local administrator, so each side keeps its own books.

Three configure options to know: `--prefix` (install root), `--with-xxx`/`--without-xxx` (toggle optional features), and debug switches such as `--enable-debug`. See `./configure --help` for the full list.

### 3.2 make and Install

`make` compiles according to the Makefile; `make install` copies the artifacts to the location named by prefix. On low-memory machines drop `-j` to 2 or remove it; when swap is short, a parallel build gets killed by OOM, which shows up as make exiting mid-way rather than printing an error. After install, make sure the system can locate the shared libraries the build depends on:

```bash
$ sudo ldconfig                           # Refresh the shared-library cache (usually already covered when prefix is under /usr/local)
$ echo 'export PATH=/usr/local/demo-app/bin:$PATH' >> ~/.bashrc
$ ldd /usr/local/demo-app/bin/demo-app    # Verify all linked libraries resolve, no "not found"
```

## 4. How to Read the Errors

Configure failures cluster into three categories, each with its own playbook:

**checking for xxx... no, ending in error: xxx not found.** Missing dependency. Look at which library the error names, install the corresponding development package per family convention (`libssl-dev` / `openssl-devel` / `openssl`), then rerun configure. `config.log` holds the full probe trace; consult it when the error message is vague.

**C compiler cannot create executables.** The compiler itself is unusable: gcc is not installed, CFLAGS carries an option the compiler does not accept, or 32-bit support is missing. On a fresh machine first confirm the toolchain from section 2 is fully installed.

**Version too old.** The error names a minimum version for some library and the system has an older one. Order of operations: look for a newer system package first, then decide whether to source-install the dependency too -- once a dependency chain starts snowballing, it is worth stopping and reconsidering whether the software is truly required.

Errors at the make stage are usually a missed dependency from the previous step. Go back to the configure output and cross-check every `checking ... no` line.

## 5. Uninstall and Upgrade: Two Answers

`make uninstall` depends on the Makefile recording a complete manifest, which many projects never implement, so do not rely on it. Two reliable approaches:

**Option 1: DESTDIR dry run to produce a manifest.** Install into a scratch directory to collect the list, then do the real install:

```bash
$ make install DESTDIR=/tmp/stage         # All files land under /tmp/stage
$ find /tmp/stage -type f | sed 's|^/tmp/stage||' > /usr/local/demo-app/MANIFEST
$ sudo rm -rf /tmp/stage
$ sudo make install                       # Real install
```

At uninstall time, delete the files listed in MANIFEST; comparing the old and new manifests before an upgrade also reveals stale files to remove.

**Option 2: GNU stow.** Each program installs into its own `/usr/local/stow/<name>` directory, and stow creates symlinks to gather them into the public paths. Uninstall is `stow -D` to delete the links plus removing the directory, and multiple versions can coexist with little fuss. This approach is less work when managing several source installs.

Upgrade = fetch the new source and repeat the flow. For software under a dedicated prefix, rename the old directory and keep it before upgrading, then delete the old directory only after the new version checks out -- this is the source-install version of "rollback".

## 6. The Boundary with Package Managers

Three disciplines contain the cost of this path:

1. **Do not change the priority**: official repos > distro-endorsed extension repos (EPEL, AUR) > source installs. An AUR PKGBUILD is essentially the source-build flow wrapped in a package, so use it rather than hand-building -- once installed it enters the package database and upgrades, uninstall, and dependency accounting all return to normal.
2. **Do not overwrite package-manager files**: confirm at configure time that the prefix does not conflict with installed packages; the `/usr/local` vs `/usr` split exists for exactly this reason.
3. **Keep a register**: run `find /usr/local -maxdepth 2` periodically to review what was installed and when. Source-installed software never enters any database, so the answer to "what else is on this box" lives only in your own memory.

## 7. Common Failures Quick Reference

| Symptom | Cause | Fix |
|------|------|------|
| configure: error: xxx not found | Missing dependency or missing development package | Install per section 4, rerun configure |
| C compiler cannot create executables | Toolchain incomplete or invalid compiler flags | Install the tool group; check CFLAGS/CXXFLAGS |
| make: xxx: No such file or directory | Incomplete unpack or configure not run first | Re-unpack and verify; confirm configure succeeded |
| command not found after install | prefix/bin not in PATH | Fix PATH or confirm the bin subdirectory name |
| error while loading shared libraries at runtime | Shared library not in the cache | Run `ldconfig`; confirm the library dir is in the ld.so config |
| Disk full, make interrupted | Build dir and temp files ate all the space | Clean up and rerun; reduce -j on low-memory machines |

## Division of Labor with Other Pages

The three pages for APT, DNF, and pacman ([APT](./apt.md), [YUM/DNF](./yum.md), [Pacman](./pacman.md)) are the main line for everyday installs; this page is the fallback when they do not cover you -- read those three first, and come back only if you cannot find what you need. Full syntax for compression and unpack commands is in [Compression and Archiving](../../commands/compression.md); cross-architecture compilation is a separate toolchain, see [Cross-compilation and Embedded](../../source/cross-compile.md); kernel-style special builds have their own flow, see [Kernel Build and Module Development](../../source/build-and-modules.md).

## References

- GNU Autoconf Manual -- [gnu.org/software/autoconf/manual](https://www.gnu.org/software/autoconf/manual/)
- GCC Online Docs -- [gcc.gnu.org/onlinedocs](https://gcc.gnu.org/onlinedocs/)
- GNU stow -- [gnu.org/software/stow](https://www.gnu.org/software/stow/)
- Bird's Private Recipes - Software Installation: Source Code and Tarball -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0520source_code_and_tarball.php)
- Man pages -- man gcc, man make, man ldconfig, man stow

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/basic/README.md)
- [packages](/basic/packages.md)
- [README](/research/README.md)
- [application-scenarios](/research/application-scenarios.md)
- [authoritative-books](/research/authoritative-books.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [gap-fill](/research/gap-fill.md)
- [cloud-computing](/server/cloud-computing.md)