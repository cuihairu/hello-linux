# Commands

Linux is a system you drive with commands.
A graphical interface gets you the "click a few times" work,
but when you SSH into a server with no desktop,
when a service dies in the middle of the night and you have to debug from a black terminal,
when you need to repeat the same operation on three machines,
the command line is the only thing that works.
This section is the command index of these notes:
the fundamentals section explains concepts,
the servers section explains building services,
and this one answers "how do I actually use this command,
what do the options mean,
and is there any difference across the three distro families".

> This section uses the **Debian/Ubuntu, Arch, and RHEL/CentOS/Rocky** distro families as its running comparison.
> Wherever a concrete operation or behavior differs, the owning family is called out; for example, the `apt` command does not work directly on Arch.

## A Few Boundaries in Command Usage

Assembling these command notes, two problems come up most often:

1. **Treating a distro-specific command as the Linux standard**.
   `apt` belongs to the Debian family only,
   `dnf` to the RHEL family only,
   `pacman` to the Arch family only --
   what actually sits stably in the Linux standard are `tar`,
   `grep`,
   `find`,
   and `ps`, the POSIX/GNU tools.
   Recognizing the boundary between these two classes of commands lets you judge the applicable scope of a command in some documentation much faster.
2. **Memorizing options,
   but not being able to describe the problem**.
   When the disk is full, I usually look for evidence in three places: large files, the related processes, and directory usage. This section records commands and reasoning by scenario.

> Example output comes from a real Ubuntu 26.04 environment; see the references at the end.

## What This Section Covers

These pages are organized by file operations, text processing, search, archiving, system state, and package management:

- **Running file and directory operations fluently**:
  create,
  copy,
  move,
  delete,
  change permissions,
  and know how generic options such as `-r`,
  `-i`,
  `-f` differ in meaning between commands.
- **Combining text tools with pipes**:
  `grep` to filter,
  `sed` to replace,
  `awk` to pull columns,
  `sort`/`uniq` to count,
  able to write a one-line shell pipeline that solves a log-analysis problem on your own.
- **Locating files and content quickly**:
  knowing when to use `find` (real-time,
  by condition),
  when to use `locate` (instant results but database-backed),
  when to use `fd`/`ripgrep` (the modern replacements).
- **Archiving and compressing correctly**:
  keeping "archive" and "compress" straight as two different things,
  choosing gzip,
  zstd,
  xz by scenario,
  and being comfortable with `tar -C`,
  `--exclude`,
  split volumes, and streaming.
- **Reading system and network state**: use `ps`, `free`, `df`, `ss`, `ip` to answer "who is using the resources, is the network reachable".
- **Switching between the three families' package managers**:
  `apt` on Debian,
  `dnf` on RHEL,
  `pacman` on Arch,
  and knowing where to install a missing command.

## Reading the Chapters

This section has two levels:
five **chapter home pages** provide the content index and the three-family comparison,
the **sub-pages** beneath them carry the syntax and examples of specific commands;
there are also two special topics (search and locate,
compression and archiving) organized directly as single pages.

### Chapter Home Pages (Content Index Entries)

- [Basic Commands](./basic.md) -- where every operation starts: adding, deleting, changing, and querying files and directories, plus the meaning of the permission bits. If you cannot read the nine letters after `ls -l`, you cannot read Linux's permission model.
- [Text Processing](./text.md) -- where the Linux philosophy of "text is a universal interface" lands in practice: `cat`/`less` to view, `grep` to find, `sed` to change, `awk` to compute, then Vim to save the result.
- [System Management](./system.md) -- answers "how is this machine doing right now": system information, processes, memory, monitoring, and configuration automation; the first scene of any troubleshooting.
- [Network Management](./network.md) -- configure addresses, check connections, test reachability: `ip`, `ss`, `ping`, `curl` walk the chain end to end, and network problems stop being a mystery.
- [Package Management](./package.md) -- three entirely different toolchains (APT / DNF / pacman) for installing, upgrading, and uninstalling software, plus a six-dimension comparison table; start here when a command is missing.

### Sub-Pages (Per-Command Quick Reference)

- [Basic Commands - File Operations](./basic/file.md) -- syntax and safe usage of single-file operations such as `cp`, `mv`, `rm`, `chmod`, and `chown`.
- [Basic Commands - Directory Operations](./basic/directory.md) -- `mkdir`, `cd`, `pwd`, `ls`, directory trees, and path notation (absolute versus relative).
- [Text Processing - Text Processing Commands](./text/text_processing.md) -- the pipe toolbox formed by `grep`, `sed`, `awk`, `sort`, `uniq`, `cut`, and `tr`.
- [Text Processing - Editing and Viewing Tools](./text/editors.md) -- core Vim operations, a quick start on nano, and the right way to open `less`, `head`, and `tail -f`.
- [System Management - System Information](./system/system_info.md) -- `uname`, `hostnamectl`, `lscpu`, `lsblk`; verify the machine's identity quickly.
- [System Management - Process Management](./system/process.md) -- `ps`, `top`, `kill`, `nice`/`renice`; from spotting a rogue process to terminating it gracefully.
- [System Management - Memory Management](./system/memory.md) -- `free` and `vmstat`; telling buff/cache apart from a genuine memory shortage.
- [System Management - Configuration Management Tools](./system/configuration-management.md) -- Ansible-led bulk operations: write repeated commands as a reusable playbook.
- [System Management - Monitoring Tools](./system/monitoring.md) -- `top`/`htop`, `vmstat`, `iostat`, `sar`; the toolchain for pinning down CPU, memory, and I/O bottlenecks.
- [Network Management - Network Commands](./network/network.md) -- `ip`, `ss`, `ping`, `traceroute`, `dig`; the minimal closed loop of configuration and diagnosis.
- [Network Management - Network Tools](./network/network-tools.md) -- `curl`, `wget`, `ssh`, `scp`, `rsync`; the daily drivers of data transfer and remote administration.
- [Package Management Commands](./package/package.md) -- the complete operation of the three package managers APT, DNF, and pacman, plus repository configuration and dependency troubleshooting.

### Special-Topic Pages

- [Search and Locate](./find-and-locate.md) -- from `find` condition expressions to `locate` database lookups, to content search with `grep`/`fd`/`ripgrep`, plus the three-family install commands for "install the package first when the command is missing".
- [Compression and Archiving](./compression.md) -- how `tar` archiving and gzip/zstd/xz compression divide the work, a selection comparison, split volumes and incremental backups, and the common gotchas (including how to write a `pacman -S` install of a compression tool).

## Three-Family Differences at a Glance

The same instruction lands completely differently across the three distro families. This is the comparison you look up most while reading this section:

| Scenario | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Install software | `sudo apt install package` | `sudo pacman -S package` | `sudo dnf install package` |
| Refresh the repository index | `sudo apt update` | `sudo pacman -Sy` (recommend combining with `-u` as `-Syu`) | `sudo dnf makecache` |
| Upgrade all installed software | `sudo apt upgrade` | `sudo pacman -Syu` | `sudo dnf upgrade` |
| Uninstall | `sudo apt remove/purge` | `sudo pacman -Rns` | `sudo dnf remove` |
| Search packages | `apt search keyword` | `pacman -Ss keyword` | `dnf search keyword` |
| Find which package owns a file | `dpkg -S filepath` | `pacman -Qo filepath` | `dnf whatprovides filepath` |
| Default firewall | `ufw` | your own choice of `nftables`/`iptables` | `firewalld` (`firewall-cmd`) |
| Default mandatory access control | AppArmor | no default configuration | SELinux (enforcing) |
| Package format | `.deb` | `.pkg.tar.zst` | `.rpm` |
| Third-party extensions | PPA, backports | AUR (with helpers such as `yay`/`paru`) | EPEL, RPM Fusion |

**A rule of thumb to remember**:
any command whose name carries a distro prefix (`apt`,
`dnf`,
`pacman`,
`firewall-cmd`,
`netplan`) is not the Linux standard,
so switching distros means switching syntax;
any command from GNU coreutils (`ls`,
`cp`,
`grep`,
`find`,
`tar`,
`chmod`) behaves consistently across the three families,
with at most small differences in option style.

## Command Format Conventions

The general written form of a Linux command is:

```bash
command [options] [arguments]
```

- `command`: the program to run, which may be an executable file, a shell builtin (`cd`, `export`), or an alias.
- `[options]`:
  switches that control command behavior.
  Short options are written `-l`,
  `-r`,
  and are often combinable as `-la`;
  long options are written `--human-readable`,
  supported by almost all GNU tools.
- `[arguments]`: the object the command acts on, usually a file or directory path.

Common options keep a fairly stable meaning across most commands:

| Option | Common meaning | Notes |
|------|----------|------|
| `-a` | all, show/include all entries | `ls -a` and `tar -a` do not agree; defer to `man` |
| `-l` | long, long format | `ls -l` is the long listing; `ps -l` is also long format |
| `-r` | recursive | `cp -r`, `grep -r`; but `tar -r` means "append to the archive", so it is not universal |
| `-v` | verbose, detailed output | `tar -cvf` lists filenames one per line |
| `-f` | force | `rm -f` asks no questions; `tar -f` means "name the archive file", the exception |
| `-i` | interactive, confirm | `cp -i` and `rm -i` ask before overwriting |

The special meanings of `-r` and `-f` in `tar` are one of the most common gotchas: in `tar`, `-f` must be immediately followed by a filename, so `tar -cvf file.tar dir` is correct, while `tar -cv dir file.tar` treats `file.tar` as a file to be archived. Details in [Compression and Archiving](./compression.md).

**`man` is the final answer**.
The authoritative documentation for any command lives in the manual:
`man ls` shows usage,
press `/` to search and `q` to quit;
`man 5 passwd` shows the file-format section of the manual;
`apropos keyword` searches the manual titles backward to find a command.
The value of the Arch Wiki is explaining "why",
the value of `man` is explaining "exactly which options are supported",
and neither replaces the other.

## Common Questions

**Q: It says `command not found`, but the documentation clearly documents this command?**

Work through them in order:
(1) is the command distro-specific (`apt`/`dnf`/`pacman` are not interchangeable)?
(2) is it simply not installed -- install the package that provides it with `apt install` on Debian/Ubuntu,
`pacman -S` on Arch,
or `dnf install` on the RHEL family?
(3) is it installed but not on `PATH` --
confirm with `which command` or `type command`;
(4) is it a typo or a case error (Linux is case-sensitive)?

**Q: `Permission denied` -- a permission problem or a missing file?**

The errors are different:
a missing file reports `No such file or directory`,
while insufficient permission reports `Permission denied`.
For the latter, `ls -l` shows the owner, group, and rwx bits,
`id` shows the current user and groups,
then `sudo` or `chmod`/`chown` as needed.
If `ls` lists the filename but you cannot open it,
you are usually stuck on the rule that "entering a directory requires the `x` bit".

**Q: Why does the command I type differ from the one in the documentation?**

Most likely an option-style difference:
GNU tools (the mainstream on Linux) support `--long-option` and combined short options like `-abc`,
while some POSIX tools only accept `-abc`.
A very few commands (`kill`,
`ps`) still accept their legacy BSD-style options without a leading `-`.
Go by your local `man` output,
and do not copy across systems.

**Q: I always mix up pipes, redirection, and wildcards -- can they be told apart in one sentence?**

Redirection `>`/`<` decides whether data goes in and out of a file,
a pipe `|` decides whether data flows from one command to the next,
and wildcards `*`/`?` are the shell expanding **filenames** before execution.
All three are interpreted by the shell,
so the `*` in `ls *.txt` is expanded by the shell,
while the `*` in `find -name "*.txt"` is matched by find itself --
which is why find patterns need quotes,
otherwise the shell expands them early.

**Q: Which "standard commands" exist on all three families?**

`ls`,
`cd` (shell builtin),
`cp`,
`mv`,
`rm`,
`mkdir`,
`cat`,
`less`,
`grep`,
`sed`,
`awk`,
`find`,
`tar`,
`chmod`,
`chown`,
`ps`,
`kill`,
`df`,
`du`,
and `mount` are completely consistent across the three families (mostly from GNU coreutils/findutils/grep/tar).
What really needs switching by distro
concentrates in five areas:
**package management,
service management,
network configuration,
firewalls,
and log entry points**.

## References

- Bird's Private Recipes (Lin's Linux Administration Guide) - Command line and Shell -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0320bash.php)
- Bird's Private Recipes (Lin's Linux Administration Guide) - Introduction to common commands -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0220filemanager.php)
- Arch Wiki - Core utilities -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Core_utilities)
- Arch Wiki - Bash -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Bash)
- Arch Wiki - Pacman -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- Debian manual -- [debian.org](https://www.debian.org/doc/manuals/debian-handbook/)
- Bird's Private Recipes (Lin's Linux Administration Guide) - Fundamentals (command line introduction) -- [linux.vbird.org](https://linux.vbird.org/linux_basic/)
- Linux man pages (man7.org) -- [man7.org](https://man7.org/linux/man-pages/)
- POSIX.1-2017 Shell Command Language -- [pubs.opengroup.org](https://pubs.opengroup.org/onlinepubs/9699919799/)


## Same-Level Pages

- [basic](/commands/basic.md)
- [compression](/commands/compression.md)
- [system](/commands/system.md)
- [text](/commands/text.md)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [basic](basic.md)
