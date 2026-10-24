# Introduction to Linux

## Chapter Introduction

"What is Linux" looks like a one-sentence answer, but it actually hides three layers that each need to be understood on their own terms: the **kernel**, the **operating system**, and the **distribution**. In everyday speech, "I installed a Linux" usually means some distro; strictly speaking, "Linux" refers only to the kernel source tree Linus Torvalds maintains; and the thing you actually type commands into and install software with every day is a complete system assembled from the GNU toolchain, system libraries, a package manager, and the kernel. If you cannot separate these three layers, everything afterwards feels off -- you will be confused by questions like "what is my Arch Linux version number" (Arch is rolling release; `cat /etc/os-release` has no `VERSION_ID` at all), and you will copy Debian's `apt` command onto Rocky and watch it print `command not found`.

Beyond "what it is", you also need to know **where it came from**. Unix's commercial split gave rise to the free software movement; the GNU project filled in the user space but lacked exactly one piece, a kernel; and in 1991 a student's "just a hobby" project happened to slot into that gap. This history is not trivia: the GPL license explains why Linux derivatives must be open source, the "everything is a file" philosophy explains why processes show up in `/proc`, and the split between rolling and fixed release models can be traced back to the distro family tree. Knowing the backstory, you can quickly read the temperament of an unfamiliar distro instead of fumbling with it as a brand-new system from scratch.

The last problem to solve is **selection**. There are hundreds of distros, but for the overwhelming majority of people only three families genuinely deserve consideration: the Debian/Ubuntu family (APT, `.deb` packages), the RHEL/CentOS/Rocky family (DNF, `.rpm` packages), and the Arch family (`pacman`, rolling release). They differ sharply in package management, firewall, default SELinux policy, and release model; picking wrong costs you anything from constant gotchas to production stability incidents. The third page of this chapter gives the full comparison and decision advice -- read it before you install anything.

> Content draws on the Arch Wiki, Bird's Private Recipes (Lin's Linux Administration Guide), and the official Linux documentation -- see the references at the end.

## What This Section Covers

This chapter spans three pages, and the pages cover:

1. **Separating four layers**: kernel, GNU user space, complete operating system, and distribution -- and verifying any of them from a real terminal with commands.
2. **Explaining the naming**: why Stallman argued for GNU/Linux while most people just say Linux, and why that dispute barely affects usage today.
3. **Drawing at least two family trees**: the derivative relationships of Debian and RHEL, plus where Arch sits among the three families (an independent family, rolling release, managed by `pacman`).
4. **Describing what a distro is made of**: from kernel, GNU tools, and system libraries to package manager and desktop environment -- knowing each layer's job and what changes when you swap one.
5. **Making a selection on your own**: given the scenarios "beginner / enterprise server / want to learn deeply", produce a reasonable recommendation with reasons (including "why not the other one").
6. **Avoiding conceptual traps**: not treating a kernel version as a distro version, not treating one family's package commands as the Linux standard, and not chasing the wrong feature on the wrong distro.

## Reading the Subpages

The three pages are ordered by how the concepts depend on each other (about 10-15 minutes per page):

- **[What Is Linux](./introduction/what_is_linux.md)** -- the concept-boundaries page. Starting from the real output of `uname -r` and `cat /proc/version`, it breaks down kernel versus operating system, explains how the GNU project and Linux fit together, lays out the layered structure of a distro, and introduces the division of labor among the three big package managers (`apt`, `dnf`, `pacman`). This page answers "when other people say Linux, what are they actually talking about".

- **[The History of Linux](./introduction/history.md)** -- the backstory page. From Unix's birth in 1969 to today's Top 500 supercomputers, the focus is three cause-and-effect chains: how AT&T's commercialization tore Unix into the System V and BSD camps, how Stallman's printer incident gave rise to GNU and the GPL, and how that famous 1991 Usenet post opened the floodgates of distro diversity. This page answers "why does Linux look the way it does today".

- **[Introduction to Linux Distributions](./introduction/distributions.md)** -- the selection-decision page. It dissects the positioning, release model, and package management of the Debian/Ubuntu, RHEL/CentOS/Rocky, and Arch families one by one (including a full hands-on `pacman` comparison), gives two decision tables -- by use case and by experience -- and lists mainland-China mirror download addresses. This page answers "which one should I install".

## Linux in 30 Seconds

If you remember only one paragraph, make it this one:

> Linux is the name of a **kernel**, and is also commonly used to mean the whole **operating system** assembled from "Linux kernel + GNU tools + package management + configuration". It was open sourced by Linus Torvalds in 1991 and today powers nearly every supercomputer on the planet, the vast majority of cloud servers, and the vast majority of Android phones. What you actually install and use is a **distribution** -- Debian/Ubuntu installs software with `apt`, RHEL/Rocky uses `dnf`, Arch uses `pacman`; all three run the Linux kernel and differ in software repositories, default configuration, and update cadence. Linux dominates servers and supercomputers absolutely; on the desktop it sits around 4%, used mostly by developers and technology enthusiasts.

Three commands verify that paragraph from a terminal:

```bash
# Which kernel am I on? -- all three families return a real version number like 6.8.0-45-generic
uname -r

# Which distro am I on? -- note the output format differs a lot across the three families
cat /etc/os-release

# Are the GNU tools present on my system? -- a coreutils version string means yes
ls --version | head -1
```

On Ubuntu 24.04, `uname -r` returns `6.8.0-45-generic`; on Rocky Linux 9.4 it returns `5.14.0-427.13.1.el9_4.x86_64`; on Arch it returns a rolling version like `6.8.9-arch1-1`. Three different kernel version strings, but all of them are Linux -- which is the plainest evidence that "the kernel is the kernel, the distro is the distro".

## Clearing Up Common Misconceptions

The five conceptual traps people fall into most often, cleared up here in one place; each subpage expands in detail:

1. **Misconception: "Linux is Ubuntu"**. Ubuntu is just one distro, based on Debian; Rocky is rebuilt from RHEL's sources; Arch is an independent starting point. The kernel is Linux in every case, but the user space and the ecosystem are completely different. Porting "Ubuntu experience" straight onto another family fails most often on package management commands and network config file paths.

2. **Misconception: "the Linux version number is the output of `uname -r`"**. `uname -r` returns the **kernel** version. The distro version lives in `/etc/os-release`: Ubuntu is `24.04`, Rocky is `9.4`, and Arch is `rolling` (there is no version number). Asking an Arch user "what version is your Linux" is the wrong question -- the right one is "when did you last run `pacman -Syu`".

3. **Misconception: "`apt` is the package manager Linux ships with"**. `apt` belongs to the Debian/Ubuntu family; the RHEL family uses `dnf` (formerly `yum`), and Arch uses `pacman`. The three are mutually incompatible and the package formats (`.deb` / `.rpm` / `.pkg.tar.zst`) do not interchange. To decide which to use, run `cat /etc/os-release` and read the `ID=` field first -- that is the first habit this chapter asks you to build.

4. **Misconception: "more distros means more kernels"**. There is only one kernel (the mainline on kernel.org); what distros do is pick a kernel version, apply patches, configure build options, and pair it with their own user space. So `uname -r` output differs between Ubuntu and Debian, yet they share the same upstream project.

5. **Misconception: "open source = free = no commercial support"**. RHEL is the commercial distribution of open source software; what it sells is a subscription (which bundles certification, support, and long-term maintenance); Rocky and AlmaLinux are the community-provided RHEL-compatible options. Open source describes code availability, which is a separate question from whether you pay for service -- enterprise selection especially trips over this.

## References

- GNU Project: Linux and the GNU system -- [gnu.org](https://www.gnu.org/gnu/linux-and-gnu.html)
- The Linux Kernel Archives -- [kernel.org](https://www.kernel.org/)
- Arch Wiki - Linux -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Linux)
- Arch Wiki - pacman -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- Debian Handbook -- [debian.org](https://www.debian.org/doc/manuals/debian-handbook/)
- Red Hat documentation -- [docs.redhat.com](https://docs.redhat.com/)
- DistroWatch -- [distrowatch.com](https://distrowatch.com/)
- Bird's Private Recipes (Lin's Linux Administration Guide) - first chapter of Volume 1 -- [linux.vbird.org](https://linux.vbird.org/linux_basic/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)
- [coverage-matrix](/research/coverage-matrix.md)
