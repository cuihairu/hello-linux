# The History of Linux

From Unix to GNU/Linux, this history explains why Linux's design philosophy and culture look the way they do. This is not pedantry: AT&T closed Unix off as a commercial product, which is what produced Stallman's free software movement; the free software movement lacked a kernel, which is what produced that "just a hobby" project in 1991; and the early chaos of mutually incompatible distros directly produced the very different temperaments of Debian, RHEL, and Arch today -- the conservatism of fixed releases, the decade-long support of enterprise editions, the aggression of rolling release. Each of those can be traced to a cause in the history. After reading this page you will be able to look at any distro announcement and roughly infer the stance and tradeoffs behind it.

> Content draws on official documentation and historical sources -- see the references at the end.

## What This Chapter Covers

- The birth and split of Unix, and their influence on later system design
- The origins of the GNU Project, the significance of the GPL, and the historical timing of the Linux kernel
- Key milestones in Linux's development and the lineage of modern distros
- The differing historical positioning of the three families (Debian / RHEL / Arch), and where `pacman` and rolling release came from
- Recognizing common misconceptions in historical topics (CentOS's identity, confusing kernel versions with distro release years)

## 1. The Unix Era (1969-1983)

### 1.1 Birth

In 1969, Ken Thompson and Dennis Ritchie at Bell Labs developed Unix on a PDP-7 at DEC. **Why this project deserves remembering**: it made several choices that seemed heretical at the time and later became industry standard -- replacing the all-in-one monolithic kernel pile with a layered structure, providing a hierarchical filesystem, and exposing everything, including hardware, to users in the form of files. The decisive step came in 1973: Dennis Ritchie rewrote Unix in the C language he had just invented. C is close to the hardware and easy to port, so Unix could move with the machine instead of being welded to one minicomputer. The `ls`, `cd`, and `chmod` you type in a terminal today keep almost the exact names and concepts from that era.

| Year | Event |
|------|-------|
| 1969 | Unix is born at Bell Labs |
| 1971 | Unix v1 is released, written in assembly |
| 1973 | Unix is rewritten in C (a landmark) |
| 1975 | Unix v6 is released, distributed widely to universities |
| 1977 | BSD (Berkeley Software Distribution) is born |
| 1979 | Unix v7, the beginning of commercialization |
| 1983 | AT&T releases System V |

Unix v6 spread through universities, where it was read and modified at length; BSD is what the University of California, Berkeley produced by adding networking capability to Unix (an early key contribution to the TCP/IP implementation). In other words, the network protocol stack that came to dominate the internet and the Unix lineage that dominated academia were already intertwined by the late 1970s.

### 1.2 The Split of Unix

In 1979, after Unix v7, AT&T made a clear turn toward commercial licensing; universities could no longer use the source freely. That prohibition directly produced two things: BSD accelerated the refactor of a usable system from its own code, and the whole industry developed a hunger for "the next free Unix". Unix gradually split into two schools:

```text
                    Unix
                     │
        ┌────────────┴────────────┐
        │                         │
    AT&T System V              BSD
    (commercial)            (academic)
        │                         │
   ┌────┴────┐              ┌────┴────┐
   │ Solaris │              │ FreeBSD │
   │ HP-UX   │              │ NetBSD  │
   │ AIX     │              │ OpenBSD │
   └─────────┘              └─────────┘
```

**Practical effect on you today**: you will still occasionally meet a "north versus south" dispute in command style -- `ifconfig` (BSD tradition) versus `ip` (modern Linux interface), System V `init` scripts versus the now-unified `systemd`. Knowing which school a design came from tells you where to look for clues in the documentation. Linux itself is closer to the POSIX/SysV lineage at the interface level, but in areas like network management it long ago went its own way.

### 1.3 The POSIX Standard

In 1988, IEEE published the POSIX (Portable Operating System Interface) standard, unifying Unix system call interfaces. **Why a standard was needed**: after vendors forked, a program written for Solaris might not compile on HP-UX. POSIX fixed the behavior of interfaces for processes, signals, and file I/O, which is what made cross-platform applications possible. Linux targeted POSIX compatibility from the start, which is exactly why so much Unix software could be ported over relatively smoothly -- and why tools like `getconf`, `grep`, and `awk` behave almost identically across the three families.

```bash
# Check whether the system conforms to POSIX
$ getconf _POSIX_VERSION
200809L
```

A return value of `200809L` means it implements POSIX.1-2008; that output is the same on Debian, Rocky, and Arch. Once the interface standard is unified, experience carries across distros.

## 2. The GNU Movement (1983-1991)

### 2.1 Origins

In 1983, Richard Stallman launched the GNU (GNU's Not Unix) project at MIT, aiming to create a completely free Unix-like operating system.

Stallman's motivations:
- The printer driver's source code was refused by the vendor (he could not fix a bug that made the machine jam repeatedly)
- Proprietary software was blocking technical progress
- He wanted to build a free software community

**Why the GNU story matters**: it established two rules of the Linux world that are still in force today -- code must be obtainable, and modifications must be redistributable. The right to demand that a vendor ship driver source, and the freedom to fork a distro, both trace their legal basis back to this philosophy.

### 2.2 Defining Free Software

The four essential freedoms of free software:

| Freedom | Description |
|---------|-------------|
| Freedom 0 | The freedom to run the program, for any purpose |
| Freedom 1 | The freedom to study and modify the source code |
| Freedom 2 | The freedom to redistribute copies |
| Freedom 3 | The freedom to distribute modified versions (giving back to the community) |

Note that Freedom 1 presupposes "you can get the source" -- which is precisely the link proprietary software cuts. For users, the most direct payoff is security auditing and self-determination: after the Heartbleed vulnerability broke, any distro could audit and patch OpenSSL immediately, without waiting for some vendor to "decide" whether to ship a fix.

### 2.3 The GPL License

In 1989, Stallman created the GNU General Public License (GPL) to ensure the free propagation of software. The GPL's core weapon is **contagion (copyleft)**: any derivative work based on GPL code that is redistributed must itself be open sourced under the GPL. This blocks the arbitrage of "take free software, close it back up" -- a vendor may build a commercial product on the Linux kernel, but must ship complete source when distributing it. The Linux kernel uses GPLv2; that choice sparked a famous dispute with GPL v3 in the late 1990s, and the kernel community ultimately decided to stay on v2.

```bash
# View the GPL license text (Debian/Ubuntu ship it in the common-licenses package)
$ head -5 /usr/share/common-licenses/GPL-3
                    GNU GENERAL PUBLIC LICENSE
                       Version 3, 29 June 2007

 Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>
 Everyone is permitted to copy and distribute verbatim copies
 of this license document, but changing it is not allowed.
```

On RHEL and Arch that path may not exist (licenses are usually stored under `/usr/share/licenses/<package>/`), but the convention that every installed package carries license information is common to all three families -- to query a package's license, the output of `pacman -Qi nginx`, `dnf info nginx`, and `apt show nginx` all includes a `License` field.

### 2.4 GNU Project Achievements

| Year | Project | Description |
|------|---------|-------------|
| 1984 | GNU Emacs | Text editor |
| 1987 | GCC 0.9 | GNU compiler |
| 1988 | GNU Make | Build tool |
| 1990 | glibc | C standard library |
| 1990 | GNU Hurd | Kernel (incomplete) |

By 1991, GNU had nearly every component except a kernel. **The coincidence and inevitability of history**: Hurd went on dragging its feet, while a Finnish student's experimental kernel, written for the Minix teaching system, ran quickly -- GNU needed a kernel, Linux needed user space tools, and fitting the two together was almost inevitable. This is also why "the most Linux of commands" like `ls` and `bash` are actually all GNU code.

## 3. The Birth of Linux (1991)

### 3.1 Linus Torvalds

In 1991, Linus Torvalds, a student at the University of Helsinki in Finland, began writing an operating system kernel. The starting point was academic: in a course he had encountered contemporary UNIX and wanted to experience similar capability on his own 386 machine, while the teaching version of Minix had many limitations. His first public message was very modest, even saying it was "just a hobby, and won't be big and professional like GNU" -- the humor of history is that this "hobby project" later became the foundation of global digital infrastructure.

### 3.2 The Famous Usenet Post

On August 25, 1991, Linus posted the famous message on the comp.os.minix newsgroup:

```text
From: torvalds@klaava.Helsinki.FI (Linus Benedict Torvalds)
Newsgroups: comp.os.minix
Subject: What would you like to see most in minix?
Date: 25 Aug 91 23:19:35 GMT

Hello everybody out there using minix -

I'm doing a (free) operating system (just a hobby, won't be big and
professional like gnu) for 386(486) AT clones...
```

The subject line asks "what would you most like to see in minix", while the body announces that he is building a new system -- two months later version 0.01 was released, and the list of people willing to test and contribute grew fast. The flywheel of open collaboration spun up in the era before GitHub, powered by newsgroups and mailing lists.

### 3.3 Version Milestones

| Version | Date | Significant change |
|---------|------|--------------------|
| 0.01 | 1991.09.17 | First public release |
| 0.02 | 1991.10.05 | Adds bash and gcc support |
| 0.12 | 1991.11 | Adds virtual memory |
| 1.0 | 1994.03.14 | First stable release |
| 2.0 | 1996.06.09 | Adds multi-architecture support |
| 2.6 | 2003.12.17 | Kernel-mode preemption |
| 3.0 | 2011.07.21 | Version numbering change (no disruptive rewrite) |
| 4.0 | 2015.04.12 | Live patching |
| 5.0 | 2019.03.03 | Energy Aware Scheduling, among others |
| 6.0 | 2022.10.02 | Support for more new hardware |

**Two things to read from version numbers**: first, jumps like 3.0 and 4.0 were mainly renumbering decisions, not evidence that the system was rewritten -- do not treat a big kernel version number as a "generational revolution". Second, an incrementing version number and "which version is on your machine" are two different questions: Ubuntu 24.04 ships a 6.8 kernel, while Rocky 9.4 sits on 5.14 with a large number of backported patches -- the latter is a deliberate enterprise-distro choice, where stability and hardware support lifetime outrank chasing new.

```bash
# Show the current kernel version
$ uname -r
6.8.0-45-generic

# Show the changelog of the kernel package (Debian/Ubuntu example)
$ zgrep -m1 "^linux" /usr/share/doc/linux-image-$(uname -r)/changelog.Debian.gz 2>/dev/null || true
```

The three families inspect kernel information slightly differently: on Debian/Ubuntu the kernel and its documentation come from `linux-image-*` packages; on RHEL/Rocky the corresponding package is `kernel`, queryable with `rpm -q kernel`; on Arch the kernel is the `linux` package itself, and `pacman -Qi linux` shows the version and build info. Same `uname -r`, completely different packagers and patching strategies behind it.

## 4. The Rise of Distributions (1992-present)

### 4.1 Early Distributions

Why distros exist: kernel source and GNU tools are both freely downloadable, but assembling them into a "plug it in and it works" system and providing security updates for years takes organized effort. A distribution is that team plus the software repository it produces.

| Year | Distro | Description |
|------|--------|-------------|
| 1992 | SLS | One of the earliest distros |
| 1993 | Slackware | The oldest still-active distro |
| 1993 | Debian | Founded by Ian Murdock; emphasizes free software and community governance |
| 1994 | Red Hat | Later evolved into commercial RHEL |
| 1994 | SUSE | German distro, derived from Slackware |

### 4.2 Modern Distributions

| Year | Distro | Description |
|------|--------|-------------|
| 2002 | Arch Linux | Minimalism plus rolling release; `pacman` shipped the same year |
| 2004 | Ubuntu | Based on Debian; drove desktop adoption |
| 2004 | CentOS | Community rebuild of RHEL (transformed in 2021) |
| 2009 | Chrome OS | Based on Gentoo |
| 2020 | Rocky Linux | One of the community replacements after CentOS was discontinued |

Arch and `pacman` deserve a separate note. Before 2002 the mainstream story was "fixed release cycles plus conservative package selection", and Arch went the opposite way: the repository always holds only the **current latest** of each package, users stay current with `sudo pacman -Syu`, and there are no version numbers like 22.04 or 24.04. `pacman`'s command design reflects the same philosophy: `-S` (sync) is the highest-frequency operation, and a full system upgrade is reduced to one indivisible everyday command. The iron rule you see on the Arch Wiki today -- "always do a complete upgrade" -- traces back to the release model established in 2002. It forms one extreme of the three families' rhythms, alongside Debian's "stable barely moves, changes go through backports" and RHEL's "ten years of support, take patches only, never chase new".

### 4.3 The Distro Family Tree

```text
Slackware (1993)
    └── SUSE (1994)

Debian (1993)
    ├── Ubuntu (2004)
    │   ├── Linux Mint
    │   ├── Pop!_OS
    │   └── Kali Linux
    └── Knoppix

Red Hat (1994)
    ├── RHEL (2000)
    │   ├── CentOS (2004, transitioned to CentOS Stream in 2021)
    │   ├── Rocky Linux (2021)
    │   └── AlmaLinux (2021)
    └── Fedora (2003)

Independent family: Arch Linux (2002, rolling release + pacman)
```

**The practical value of reading the tree**: derivatives usually inherit their upstream's package format and a great deal of tooling habit -- a system with `ID_LIKE=ubuntu` can generally just reuse APT commands, Rocky's `dnf` operations are nearly identical to Fedora's, and the Arch family (Manjaro, for example) still centers on `pacman`, only adding a wrapper. To judge how to administer an unfamiliar machine, the family tree tells you far more than the logo.

## 5. Linux Today

### 5.1 Domains of Use

| Domain | Share | Description |
|--------|-------|-------------|
| Servers | The vast majority | The mainstream choice for web, cloud, and databases |
| Supercomputing | 100% | The Top 500 has run Linux exclusively for years |
| Mobile devices | The vast majority | Android is based on the Linux kernel (user space is Android, not GNU) |
| Embedded | Widespread | Routers, smart home, automotive |
| Desktop | About 4% | Mostly developers and technology enthusiasts |

Two easy-to-confuse points: **Android uses the Linux kernel but not the GNU toolchain** -- the shell and tools on Android are a different user space, so strictly speaking it is not a GNU/Linux distro. And **a low desktop share does not mean low influence** -- developer desktops, build servers, and CI clusters are almost entirely Linux, and the toolchains you use on your desktop ultimately get deployed onto it.

### 5.2 Major Contributors

The Linux kernel long ago stopped being a solo hobbyist project and is now public infrastructure maintained jointly by large companies and the community:

| Contributor | Description |
|-------------|-------------|
| Intel | Hardware support and drivers |
| Red Hat | Core kernel development (consistently near the top) |
| Google | Containers, schedulers (EAS, cgroup-related) |
| Meta | Performance optimization |
| ARM | Architecture support |
| Community individuals | A large number of contributors |

Commercial companies invest heavily in the open source kernel because their products (cloud, chips, phones) all run on it -- combined with the GPL's rules, this creates the distinctive ecosystem of "competitors collaborating on the same code base". For concrete numbers, see the Linux Foundation and LWN reports.

## 6. Common Pitfalls and Misconceptions

1. **Treating CentOS as "free RHEL" without checking the current situation**. CentOS 8 reached end of life at the end of 2021, and the CentOS project moved to CentOS Stream, which sits **upstream** of RHEL. If you need a RHEL-compatible downstream option, today's community mainstream is Rocky Linux and AlmaLinux. When you see an article still telling you to "install CentOS 7/8 in production", check its publication year first.

2. **Treating a distro's release year as the kernel's year**. Ubuntu 24.04 does not mean the kernel has everything from 2024 -- it may carry only 6.8 with a large number of backports; Rocky 9.4's kernel is 5.14 family. When discussing "does my system have this feature", check `uname -r` and the distro release notes; do not infer from the calendar year.

3. **Thinking nobody used Linux before 1.0**. The 0.x era already had a large body of testers and early distros shipping the kernel; 1.0 marks a stable interface, not the point where users went from zero to something.

4. **Treating GNU and Linux as rival projects**. They are complementary: GNU provides the user space, Linux provides the kernel. The naming dispute only affects wording, not any software you actually use.

5. **Assuming rolling release is "always newest, therefore better"**. Arch's newness means you carry the upgrade regression risk yourself (hence `/etc/pacman.d/hooks`, full-upgrade discipline, and the maintenance responsibility for AUR packages); fixed-release families are the opposite -- stable, but you may go years without a new feature. Neither is superior, only better or worse matched to a scenario. See [Introduction to Linux Distributions](./distributions.md).

6. **Copying another distro's package commands into Arch**. The two-step `apt update && apt upgrade` habit from other distros corresponds to a **single** `sudo pacman -Syu` on Arch; deliberately splitting it into "only refresh the index" causes partial upgrade damage. When porting experience, port the concept first, then look up the commands again.

## References

- The Unix Heritage Society -- [tuhs.org](https://www.tuhs.org/)
- GNU Project History -- [gnu.org](https://www.gnu.org/gnu/gnu-history.html)
- Full GPL license text -- [gnu.org](https://www.gnu.org/licenses/gpl-3.0.en.html)
- Linus Torvalds' original Usenet post -- [groups.google.com](https://groups.google.com/g/comp.os.minix/c/dlNtH7RRrGA)
- Linux Kernel Archives -- [kernel.org](https://www.kernel.org/)
- LWN.net Kernel Newbies / Linux Versions -- [kernelnewbies.org](https://kernelnewbies.org/LinuxVersions)
- Arch Wiki - pacman (rolling release and partial upgrades) -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- CentOS project notes (the Stream transition) -- [centos.org](https://www.centos.org/)
- DistroWatch -- [distrowatch.com](https://distrowatch.com/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/basic/README.md)
- [introduction](/basic/introduction.md)
