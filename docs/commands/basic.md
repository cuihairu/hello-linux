# Basic Commands

Basic commands are the foundation of every Linux operation:
create a file,
enter a directory,
copy a configuration,
tweak a permission,
delete a temporary file --
whatever you go on to do,
development,
operations, or security,
these five actions are the ones you repeat most every day.
This chapter does not ask you to memorize every option;
it asks you to build three things first:
**the concept of a path,
the meaning of the permission bits,
and where the destructive commands end**.
Once the foundation is solid,
the later text processing,
search,
and system management chapters grow out of it naturally;
if the foundation is weak,
one misplaced space in `rm -rf` can take a whole machine's data with it.

> Almost all commands in this chapter come from GNU coreutils,
> and behave identically across **Debian/Ubuntu,
> Arch,
> and RHEL/CentOS/Rocky**.
> The only thing that needs to switch by distro is how you install an extra tool (`apt install` / `pacman -S` / `dnf install`),
> which is marked in the text.

## Use Cases for File and Directory Commands

Linux builds on "everything is a file" as its design cornerstone:
hardware is a file (`/dev`),
processes are files (`/proc`),
and even network connections can be observed through virtual filesystems.
That means **once you are fluent with file operations,
you have a single language for operating any object**.
The concrete payoff for daily work is threefold:

1. **A sense of paths is the prerequisite for troubleshooting**.
   When you see the error `failed to open /etc/nginx/nginx.conf`,
   you must immediately recognize that as an absolute path,
   independent of the directory you happen to be in;
   when you see `./deploy.sh`, you need to know it is a relative path,
   which depends on your current directory.
   Confuse the two,
   and the logs get more confusing the longer you read them.
2. **Permissions are the first gate of security**.
   `chmod 777` will make a script "run",
   and it will also let any user on the entire server modify it.
   Knowing that the three rwx bits correspond to owner,
   group,
   and others,
   is what tells you whether to hand out `750` or `644`.
3. **The efficiency gap in batch operations is an order of magnitude**.
   Copying 20 files by hand takes 40 mouse clicks,
   while `cp`/`rsync` does it in one line;
   renaming 100 logs by hand is a breakdown waiting to happen,
   while a wildcard or `rename` finishes it in one second.
   Once the basic commands are second nature,
   the later `find`,
   `tar`,
   and pipe combinations have something to stand on.

> Example output comes from a real Ubuntu 26.04 environment; see the references at the end.

## What This Chapter Covers

- **File operations**:
  fluent with `touch`,
  `cp`,
  `mv`,
  `rm`,
  `cat`,
  and `ln`;
  understand how copy and move differ when crossing filesystems,
  and build the habit of `rm -i` or listing with `ls` before deleting.
- **Permission management**:
  change permissions both ways -- octal (`chmod 750`) and symbolic (`chmod u+x`);
  understand the owner/group/others rwx triplets;
  know what SUID/SGID/sticky bits are for.
- **Directory operations**:
  fluent with `mkdir -p`,
  `cd` (including `-` to jump back to the previous directory),
  `pwd`,
  and the common `ls` combinations (`-lah`);
  understand absolute versus relative paths,
  and the difference between `.` and `..`.
- **Security awareness**:
  know which operations are irreversible (`rm -rf`,
  `mv` overwrite,
  `chmod -R`);
  be comfortable with the preview-first flow (`ls`,
  `echo`) and with backing up important data before acting.
- **No difference across the three families**: confirm that this chapter's commands are universal, and that only "installing a tool that is not preinstalled" requires switching package managers.

## Reading the Subpages

| Sub-page | One-line summary |
|------|------------|
| [File Operations](./basic/file.md) | The life cycle of a single file: create (`touch`), view (`cat`/`more`), copy (`cp`), move (`mv`), delete (`rm`), link (`ln`), compare (`diff`/`cmp`), plus the complete syntax and examples for `chmod`/`chown` permission and ownership management. |
| [Directory Operations](./basic/directory.md) | Navigating and maintaining the directory tree: `mkdir` to create directories (including `-p` for recursive creation), `cd`/`pwd` to switch and locate, `ls` to list contents, `rmdir`/`rm -r` to delete, `tree` to view the hierarchy, plus path notation (absolute versus relative) and directory shortcuts (`pushd`/`popd`). |

Suggested order: read [File Operations](./basic/file.md) first to get the permission bits, then [Directory Operations](./basic/directory.md) to see files placed into a directory tree. Once both pages are done, run one complete loop on a lab machine -- create a directory, create a file, change permissions, copy, delete -- and the chapter counts as passed.

## Three-Family Differences at a Glance

The core commands of this chapter are universal across the three families; the table below lists only the places where you will actually hit a difference:

| Scenario | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Missing `tree` | `sudo apt install tree` | `sudo pacman -S tree` | `sudo dnf install tree` (needs EPEL or AppStream) |
| Missing `ncdu` (interactive disk usage) | `sudo apt install ncdu` | `sudo pacman -S ncdu` | `sudo dnf install ncdu` (needs EPEL) |
| Missing `vim` | `sudo apt install vim` | `sudo pacman -S vim` | `sudo dnf install vim-enhanced` |
| Default `ls` color/alias | usually the `ls --color=auto` alias | same (Bash alias) | same |
| Temporary file directory | `/tmp` (possibly tmpfs) | `/tmp` (tmpfs by default, cleared on reboot) | `/tmp` (disk directory by default) |

Note the `/tmp` difference:
Arch mounts `/tmp` as tmpfs by default (cleared on reboot),
while Debian/Ubuntu and the RHEL family usually keep a disk-backed `/tmp` (cleaned periodically by `systemd-tmpfiles`).
Leave an important file in `/tmp` overnight,
and on Arch it will very likely be gone by the next morning.

## Common Gotchas

1. **A wrong path after `rm -rf`**.
   A stray extra space after `rm -rf /var/log/` followed by an empty variable has historically caused database-wiping incidents.
   Safe habits:
   `ls` or `echo` the target first,
   alias `rm` with `-i`,
   and `tar` a backup copy of important directories before you operate on them.
   Never run `rm -rf` across `/`,
   `/etc`,
   or `/usr`.
2. **Silent overwrite causing data loss**.
   `cp` and `mv` **silently overwrite** a same-named target by default (`cp -i` and `mv -i` are the ones that ask,
   and most distros' interactive aliases only work in an interactive shell).
   Especially dangerous in pipelines or scripts,
   where aliases do not take effect.
   By habit, `ls` the target directory first to confirm no same-named file exists.
3. **`chmod -R` recursion "collateral damage"**.
   Running `chmod -R 777` over a whole home directory opens up `.ssh`,
   private keys,
   and every script.
   Permissions should be granted precisely by directory purpose:
   home directory `700`,
   `.ssh` `700`,
   public keys `600`,
   ordinary config `644`,
   executable scripts `750`.
4. **A relative target in a symlink (`ln -s`) is ambiguous**.
   A symlink created with `ln -s file link` resolves **relative to the directory holding the symlink**,
   not the current shell directory.
   Moving the symlink, or using an absolute path, is safer:
   `ln -s /etc/nginx/nginx.conf /home/user/nginx.conf`.
5. **`mv` across filesystems is really "copy plus delete"**.
   Moving a file from a disk to a USB stick (different mount points) gets slower, and a power loss halfway can lose data;
   in that scenario `cp`, verify it succeeded, then `rm` is more controllable.
6. **Putting the current directory `.` on `PATH`**.
   `PATH=.:$PATH` lets you "find" and execute any same-named program in the current directory --
   the classic PATH hijack risk,
   so do not configure it this way on a server.
7. **Forgetting that Linux is case-sensitive**.
   `Config.conf` and `config.conf` are two different files;
   a wrong case in `cd /etc/ssh` yields `No such file or directory`.

## Common Questions

**Q: Why does `cp` just overwrite by default, without asking?**

Interactive confirmation comes from an alias, not from the command itself.
Most distros' shell configuration defines `alias cp='cp -i'` (same for `mv` and `rm`),
which is why you see the `cp: overwrite 'x'?` prompt in an interactive terminal.
But scripts (`sh`/`bash script.sh`) do not load those aliases by default,
so the overwrite is silent.
If you want it to always ask,
write `cp -i` explicitly in the script,
or rely on `set -o noclobber` so that even `>` redirection refuses to overwrite an existing file.

**Q: Why is `chmod -R 777` a bad habit?**

It sets **every** file under the recursive path to "anyone can read, write, and execute".
Writable means any local user can stuff content in it;
executable means scripts and binaries can be modified by someone else and then run;
writable config files are a privilege-escalation entry point.
Do it by layers instead:
directories usually `750`/`755`,
ordinary files `644`/`640`,
and for real group collaboration use `chgrp` to change the group first and then grant group permissions.
Never reach for a blanket `777`.

**Q: How do I choose between a symlink and a hard link?**

In one line: **crossing filesystems, needing to point at a directory, or wanting the link to break when the target is deleted -- use a symlink (`ln -s`); wanting "many names sharing one copy of the data" within the same filesystem, not afraid of the target disappearing -- use a hard link (`ln`)**.
What does not change is the inode on a hard link (so `ls -li` shows both hard links sharing an inode).
`rm` deletes only the name: hard-linked data is truly freed only after every name is removed,
while removing a symlink's target leaves a dangling link (`ls -l` shows the red arrow).
In backups, "hard link plus incremental" (`rsync --link-dest`, Btrfs snapshots) exploits exactly this for second-level rollback.

**Q: I deleted an important file by accident -- is there any chance?**

**Stop all writes immediately** -- more installing, downloading, or scheduled jobs will overwrite the freed blocks.
On ext4, check `~/.local/share/Trash/files/` first (graphical deletes usually land in the trash);
for files removed directly with `rm`, `extundelete`/`testdisk` can attempt recovery by inode, with success depending on how much was written after deletion.
The production answer is prevention:
`cp -a` a timestamped backup of important directories,
or write "delete" as a move into `/var/trash/$(date +%F)/`,
leaving a window to regret it.

## References

- `man ls`, `man cp`, `man mv`, `man rm`, `man chmod`, `man chown`, `man mkdir`
- Bird's Private Recipes (Lin's Linux Administration Guide) - File and directory management -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0220filemanager.php)
- Bird's Private Recipes (Lin's Linux Administration Guide) - Linux file permissions -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0210filepermission.php)
- Arch Wiki - File permissions -- [wiki.archlinux.org](https://wiki.archlinux.org/title/File_permissions)
- Arch Wiki - Core utilities -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Core_utilities)
- GNU coreutils manual -- [gnu.org](https://www.gnu.org/software/coreutils/manual/)
- POSIX - rm/cp/mv/chmod -- [pubs.opengroup.org](https://pubs.opengroup.org/onlinepubs/9699919799/)

## Same-Level Pages

- [README](/commands/README.md)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)
- [directory](/commands/basic/directory.md)
- [coverage-matrix](/research/coverage-matrix.md)
