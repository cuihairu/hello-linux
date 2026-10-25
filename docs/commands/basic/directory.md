# Directory Operation Commands

A directory is, at its core, a special file that records the mapping between filenames and inodes. Creating, switching into, listing, copying, and deleting directories -- plus checking what space they take -- is the skeleton of day-to-day system work. Compared with file operations, directory operations add a few extra gotchas: recursion, path depth, and the execute bit on permissions (whether you can actually `cd` in). This page walks through each step with real output.

> Example output comes from a real Ubuntu 26.04 environment. All the commands below ship by default on Debian/Ubuntu, RHEL/CentOS/Rocky, and Arch (optional tools such as `tree` and `plocate` excepted).

## What This Chapter Covers

- Create, delete, switch into, and list directories fluently
- Understand what each column of the `ls` long format means and the common sort / recursion options
- Use `du` / `df` to tell "how big is this directory" from "how much is left on the filesystem"
- Know the caveats around directory permissions, recursive deletion, and archiving for backup

## 1. Creating Directories

### 1.1 mkdir - Create Directories

`mkdir` can create several directories in one go; `-p` creates missing parent directories one by one (no error if the path already exists, which makes it idempotent for scripts); `-m` sets the permissions directly; `-v` prints what it creates.

```bash
mkdir -m 750 -v private_dir
ls -ld private_dir
```

```text
mkdir: created directory 'private_dir'
drwxr-x--- 2 cui cui 40 Sep 22 05:53 private_dir
```

Multi-level and batch creation:

```bash
mkdir -p project/{src,bin,doc,test}
ls project
```

```text
bin
doc
src
test
```

```bash
mkdir dir_{1..3}
ls -d dir_*
```

```text
dir_1
dir_2
dir_3
```

Brace expansion `dir_{1..3}` is a **Bash extension**, not a feature of `mkdir` itself; if `sh` points to dash (the default `/bin/sh` on Debian/Ubuntu), you need to use an explicit list or a `mkdir -p` loop instead.

**Gotcha**: without `-p`, a missing parent directory causes an error; if `mkdir a b` and one of them already exists, the whole command fails and the parts that succeeded **are not rolled back** -- in scripts it is safer to `mkdir -p` one at a time.

## 2. Deleting Directories

### 2.1 rmdir - Remove Empty Directories Only

`rmdir` is deliberately conservative: it refuses non-empty directories to avoid accidental data loss. `-p` removes the parents that become empty as well.

```bash
mkdir -p tmp_empty/sub
rmdir -v tmp_empty/sub
rmdir -v tmp_empty
```

```text
rmdir: removing directory, 'tmp_empty/sub'
rmdir: removing directory, 'tmp_empty'
```

```bash
mkdir -p nonempty && touch nonempty/f
rmdir nonempty
```

```text
rmdir: failed to remove 'nonempty': Directory not empty
# exit code 1
```

### 2.2 rm -r / rm -rf - Recursive Deletion

When you need to delete the contents along with the directory, use `rm -r`; add `-f` to force (no confirmation, no error if the file does not exist). This is usually written as `rm -rf`.

```bash
rm -r directory
rm -ri directory      # confirm each one
rm -rf directory
```

**Safety rules (follow these)**:

1. Guard variable paths: test for non-empty first, then add `--`: `[ -n "$dir" ] && rm -rf -- "$dir"`.
2. Avoid combining `rm -rf "$dir/"` with an uninitialized variable; an empty value gets interpreted as a root-related path in some cases.
3. When in doubt, start with `rm -r` (it prompts) or `rm -i`, confirm the list, and only then use `-f`.
4. On a desktop, prefer the trash first; on a server, `rm` is usually unrecoverable.

Recursive deletion also applies to files; see [File Operation Commands](./file.md).

## 3. Changing Directories

### 3.1 cd - Change Directory

`cd` is a shell builtin (not an external program), so `which cd` usually finds nothing. Common forms:

```bash
cd /etc/nginx          # absolute path
cd ..                  # parent
cd .                   # current (usually pointless; can be a wait / placeholder in a script)
cd ~                   # home directory
cd                     # same as above; with no argument you go home
cd -                   # back to the previous directory (OLDPWD)
```

```bash
cd app/logs
pwd
cd ../..
pwd
cd -
```

```text
/tmp/rewrite_demo/dirsamples/app/logs
/tmp/rewrite_demo/dirsamples
/tmp/rewrite_demo/dirsamples/app/logs
```

`cd -` prints both the old and the new directory, which makes it a muscle-memory shortcut for "jump back after editing a config".

**Gotcha**: in scripts, `cd /path || exit 1` matters a lot -- if the directory change fails and you keep going, the subsequent relative paths will land in the wrong directory.

### 3.2 pwd - Print the Current Directory

`pwd` prints the logical path; `-P` resolves all symbolic links to give you the physical path. When they disagree, you are standing inside a linked directory.

```bash
ln -sfn /tmp/rewrite_demo/demoX /tmp/demoX_link
cd /tmp/demoX_link
pwd
pwd -P
```

```text
/tmp/demoX_link
/tmp/rewrite_demo/demoX
```

When writing scripts with absolute paths, or when debugging `PATH` / `chroot` problems, `pwd -P` is more reliable than eyeballing.

### 3.3 pushd / popd / dirs - The Directory Stack

When you need to hop back and forth between several directories without typing the long path each time, park them on the directory stack:

```bash
pushd /tmp/rewrite_demo/demoX
dirs
pushd /tmp
dirs
popd
dirs
```

```text
/tmp/rewrite_demo/demoX
/tmp /tmp/rewrite_demo/demoX /tmp/rewrite_demo/demoX
/tmp/rewrite_demo/demoX /tmp/rewrite_demo/demoX
```

`dirs -v` lists them with numbers; `cd +N` jumps to the Nth entry on the stack. These are Bash builtins too.

## 4. Viewing Directories

### 4.1 ls - List Directory Contents

`ls` is one of the highest information-density commands you use every day. Start with what each column of the long format means, then remember the common combinations.

```bash
ls -la | head -8
```

```text
total 80
drwxrwxr-x  4 cui cui 640 Sep 22 05:53 .
drwxrwxr-x 10 cui cui 200 Sep 22 05:53 ..
-rw-rw-r--  1 cui cui   9 Sep 22 05:53 a.txt
-rw-rw-r--  1 cui cui   9 Sep 22 05:53 b.txt
lrwxrwxrwx  1 cui cui  18 Sep 22 05:53 broken_link.txt -> missing_target.txt
```

Key points:

- The first column `drwxrwxr-x`: the leading character is `d` for a directory, `l` for a symbolic link, `-` for a regular file; the three groups that follow are rwx for owner / group / everyone else.
- The second column is the **hard link count** (for a directory it is at least 2: `.` plus the entry in the parent directory).
- `.` is the current directory, `..` is the parent; `ls -a` is what shows them and any other hidden entries (those beginning with `.`).

Common variants:

```bash
ls            # current directory, short format
ls -lh        # human-readable sizes (K/M/G)
ls -lt        # by modification time, newest first
ls -lS        # by size, largest first
ls -R         # recurse into subdirectories
ls --color=auto -F   # color output and mark types (/ directory, @ link, * executable)
```

```bash
ls -lt | head -5
ls -lS | head -5
```

```text
# -lt example (newest -> oldest)
-rwxr-xr-x  1 cui cui   4 Sep 22 05:53 fakebin
-rw-rw-r--  1 cui cui   2 Sep 22 05:53 f1
...
```

```bash
ls -R
```

```text
.:
f1
sub1

./sub1:
f2
```

**Gotchas**:

- `ls dir` and `ls dir/` usually give the same result, but `ls dir/*` expands the glob first and then passes the list to `ls`, so multiple arguments can get mixed in.
- Colors are lost through a pipe: use `ls --color=auto` (or set an `alias`); do not force `--color=always` into a pipe and then `grep` for the color codes.
- `ls -l` does **not** follow symbolic links by default (it shows the link itself); when you need the target's attributes, use `ls -lL` or `stat -L`.

### 4.2 tree - Tree Display

`tree` is the most intuitive, but it **is not installed with the minimal install**: on Ubuntu/Debian use `apt install tree`, on the RHEL family use `dnf install tree`, on Arch use `pacman -S tree`.

```bash
tree -L 2        # at most 2 levels
tree -d          # directories only
tree -a          # include hidden entries
```

When `tree` is not available: `ls -R`, `find . -type d`, or `find . -name pattern -type d`.

## 5. Copying Directories

### 5.1 cp -r / cp -a - Copy Directories

Copying a directory always requires recursion: `-r` / `-R`, or `-a` (archive: recurse and preserve permissions / timestamps / links, semantics close to `cpio` / `tar`).

```bash
cp -r source_dir dest_dir
cp -a source_dir dest_dir_backup
cp -rv app app_copy        # -v prints every file copied
cp -ri . existing_dir      # confirm before overwriting
```

Semantics:

- If `dest_dir` **does not exist**: create `dest_dir` with the contents of `source_dir`.
- If `dest_dir` **already exists**: copy `source_dir` into `dest_dir/source_dir` as a subdirectory -- it does not merge and overwrite same-named files. This is the opposite of what many people expect, and a frequent accident.

```bash
# dry-run idea: check whether the target already exists
[ -e dest ] && echo "exists, will nest" || echo "will create"
```

**Gotcha**: `cp -r` loses timestamps and ownership by default; for "as the original" backups use `cp -a`. Copying lots of small files across filesystems gets noticeably slower -- when needed, switch to a `tar` pipe.

## 6. Moving Directories

### 6.1 mv - Move and Rename Directories

Renaming and moving a directory is the same `mv` command; within one filesystem it only rewrites the directory entry.

```bash
mkdir to_rename
mv -v to_rename renamed_dir
```

```text
renamed 'to_rename' -> 'renamed_dir'
```

```bash
mv old_name new_name                 # rename
mv source_dir /path/to/dest/         # move into the target directory
```

**Gotcha**: if the target already exists and is a **non-empty directory**, `mv` fails (it will not merge two directory trees); when the target is an empty directory, GNU `mv` may drop the source into it (depending on the implementation and options) -- when unsure, run `ls dest` first. Moving across devices becomes a copy followed by a delete, so large directories take a while and a mid-way failure leaves you with half the data.

## 7. Finding Directories

### 7.1 find -type d

Restricting `find` to the directory type is enough; the name, time, and size conditions work the same as for files -- see [File Operation Commands](./file.md) for the full syntax.

```bash
find /path -type d -name "dirname"
find /path -type d -mtime -7
find . -type d | sort
```

```text
.
./app
./app/conf
./app/logs
```

**Gotcha**: `find ... -type d -size +100M` is not very meaningful for directory size -- `-size` on a directory measures the inode data of the directory entry itself, **not** the subtree total. For subtree usage use `du -sh`.

## 8. Directory Size and Disk

### 8.1 du - Measure Directory Usage

`du` measures actual disk usage (not the sum of the "length" field from `ls -l`). `-s` summarizes, `-h` makes it human-readable, `-a` lists files as well.

```bash
du -sh .
du -sh * | sort -hr | head -5
```

```text
8.0K	.
4.0K	sub1
4.0K	f1
```

The classic combination for sorting by size: `du -sh * | sort -hr` (`-h` for human-readable sort needs GNU sort; when `sort -h` is not available, drop `-h` first and use `sort -rn`, or use `du -sk`).

**Gotchas**:

- A hard link referenced from multiple places is counted once by `du` by default (across multiple command-line arguments it may be double-counted) -- this is often why `df` and `du` do not agree.
- Symbolic links are not followed by default (GNU `du` counts the link itself); `-L` follows them, which can pull in a big directory outside the subtree -- use with care.
- `du` results are affected by permissions: subtrees without read permission produce errors or incomplete results; add `2>/dev/null` when needed.

### 8.2 df - Check Free Space on the Filesystem

`df` reports at the **mount point / filesystem** level, not the "own" size of an individual directory. No matter how big a directory is, as long as it is on the same filesystem it only shows up in that filesystem's `Use%`.

```bash
df -h .
df -Th .
```

```text
Filesystem                         Size  Used Avail Use% Mounted on
/dev/mapper/ubuntu--vg-ubuntu--lv  883G  492G  354G  59% /
tmpfs                               20G   92K   20G   1% /dev/shm
```

`-T` adds the filesystem type (ext4, xfs, tmpfs ...). When "the space is gone but `du` is small", start with `df -Th` to see whether a different disk is full, or whether an open-but-deleted log file is holding the space (the `lsof +L1` idea).

| Question | Use |
|------|--------|
| How big is this folder, actually? | `du -sh path` |
| How much disk is left? | `df -h` |
| Who is holding space that has been deleted? | `df -h` + check for deleted-but-unreleased handles |

## 9. Directory Permissions

### 9.1 chmod - Change Permissions

The `x` bit on a directory decides whether you can `cd` into it or traverse it; the `r` bit decides whether you can `ls` the names; the `w` bit decides whether you can add or remove files in it. **Losing `x` while keeping `r` means you can see the filenames but cannot open them** -- the classic permission-debugging scenario.

```bash
chmod 755 directory
chmod +x directory          # add the execute (traverse) bit
chmod -R 755 project        # recursive (use with care; touches every subfile)
ls -ld app
```

```text
drwxr-xr-x 3 cui cui 80 Sep 22 05:53 app
```

For more on octal / symbolic modes, see the parent page [Basic Commands](../basic.md) and [Arch Wiki - File permissions](https://wiki.archlinux.org/title/File_permissions).

**Gotcha**: running `chmod -R 775` / `755` on a whole code tree adds the execute bit to regular files too; for finer control use `find project -type d -exec chmod 755 {} +` and `find project -type f -exec chmod 644 {} +` separately.

### 9.2 chown - Change Owner and Group

Changing ownership usually needs root:

```bash
chown user directory
chown user:group directory
chown -R user:group directory
```

```text
chown: changing ownership of 'f1': Operation not permitted (os error 1)
# the typical error when a regular user tries
```

**Gotcha**: recursive `chown -R` has a wide blast radius; run `chown user dir` first to see the one-level effect, or list the files with `find` and check before acting. Accidentally chowning a user's home directory breaks subsequent `sudo` and session behavior.

## 10. Directory Links

```bash
ln -s /path/to/directory link_name
```

- **Directories cannot be hard-linked** (it would create loops in the tree; a universal filesystem convention). Forcing `ln dir hard` reports `hard link not allowed for directory`.
- Symbolic links to directories are the norm (`/etc/alternatives`, switching module paths, etc.).
- For the inode / `ls -li` details of file links, see section 8 of [File Operation Commands](./file.md).

## 11. Comparing Directories

```bash
diff -r dir1 dir2
diff -rq dir1 dir2
```

```text
Only in d1: b.txt
```

`-r` compares same-named files recursively; `-q` only reports "different / only on one side", which is good for backup verification. The exit code is the same as for `diff` on files: `0` for identical, `1` for differences. See [Text Processing Commands](../text/text_processing.md) for unified-format patches.

## 12. Archiving Directories

```bash
tar -czf archive.tar.gz directory      # archive and gzip
tar -tzf archive.tar.gz                # list contents only (no extraction)
tar -xzf archive.tar.gz                # extract and decompress
tar -cvf archive.tar directory         # no compression
```

```text
d1/
d1/b.txt
d1/a.txt
```

**Gotchas**:

- `-z` is gzip, `-j` is bzip2, `-J` is xz; the `.tar.gz` suffix must match the option.
- `directory` and `directory/` can produce different paths inside the archive; pick one spelling and stick with it in extraction scripts.
- Preview with `tar -t` first, then extract into a temporary directory and check, so `--overwrite` does not pollute production files.
- When you need to preserve ownership / ACL / SELinux context, add `-p` / `--acls` / `--xattrs` to GNU tar (the restore side needs the matching permissions).

## 13. Practical Tips

### 13.1 Batch-Creating a Directory Tree

```bash
mkdir -p project/{src,bin,doc,test}
mkdir -p web/{css,js,img}
find web -type d | sort
```

```text
web
web/css
web/img
web/js
```

### 13.2 Shortcut Recap

```bash
cd ~        # home directory
cd -        # previous directory
cd ..       # parent
pushd/popd  # directory stack
```

### 13.3 One Command to Find What Is Eating Space

```bash
du -h --max-depth=1 . | sort -hr | head
df -h .
```

Start with `df` to decide whether the disk is full, then `du` to drill down into directories -- much safer than blindly `rm`ing.

## 14. Common Gotchas Quick Reference

| Symptom | Cause | Fix |
|------|------|------|
| `rmdir` reports Directory not empty | the directory is not empty (hidden files included) | run `ls -a`, then decide whether `rm -r` |
| `cp -r` ended up with an extra nesting level | the target directory already exists | check whether the target exists first |
| `pwd` and `pwd -P` disagree | the current path contains a symbolic link | use `pwd -P` consistently in scripts |
| `du` shows little but the disk is full | another mount point / deleted but not released | `df -Th`, check log rotation |
| `chmod` made every file executable | `chmod -R` touched regular files too | use `find -type d/f` to change them separately |
| `tree`/`locate` not found | not installed | install the package with `apt`/`dnf`/`pacman` |
| relative paths all wrong after `cd` | the directory change failed but did not abort | `\|\| exit 1` |

## 15. Differences Across the Three Distributions

The core directory commands (`mkdir` / `cd` / `ls` / `du` / `df`) all come from GNU coreutils, and the three families behave identically; the differences concentrate in **whether the optional tools are preinstalled, how `/tmp` is mounted, and the default shell** -- check the table below before troubleshooting on a new machine.

| Scenario | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Install `tree`/`ncdu`/`plocate` | `sudo apt install tree ncdu plocate` | `sudo pacman -S tree ncdu plocate` | `sudo dnf install tree ncdu plocate` |
| `/tmp` default mount | systemd tmpfs by default (cleared on reboot) | optional tmpfs unit; often a disk directory by default | disk directory by default (`/var/tmp` is preserved) |
| Default login shell | `/bin/bash` (`/bin/sh` -> dash) | `/bin/bash` | `/bin/bash` |
| `ls` color / confirmation aliases | root defaults to `--color=auto` | root defaults to `--color=auto` | root defaults to `--color=auto`; some aliases include `-i` |

**Key points**: whether `/tmp` is tmpfs decides whether files survive a reboot; `sh` points to dash on Debian/Ubuntu, so brace expansion fails when the shebang does not specify bash. On Arch the basic file commands already ship with the base package -- see [Arch Wiki - Pacman](https://wiki.archlinux.org/title/Pacman).

## References

- Bird's Private Recipes (Lin's Linux Administration Guide) - File and directory management -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0220filemanager.php)
- Arch Wiki - Core utilities -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Core_utilities)
- Arch Wiki - File permissions -- [wiki.archlinux.org](https://wiki.archlinux.org/title/File_permissions)
- Arch Wiki - Pacman -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- man ls -- [man.archlinux.org](https://man.archlinux.org/man/ls.1)
- man mkdir -- [man.archlinux.org](https://man.archlinux.org/man/mkdir.1)
- man rmdir -- [man.archlinux.org](https://man.archlinux.org/man/rmdir.1)
- man du -- [man.archlinux.org](https://man.archlinux.org/man/du.1)
- man df -- [man.archlinux.org](https://man.archlinux.org/man/df.1)
- man tar -- [man.archlinux.org](https://man.archlinux.org/man/tar.1)
- man chmod -- [man.archlinux.org](https://man.archlinux.org/man/chmod.1)
- Debian manual -- [debian.org](https://www.debian.org/doc/manuals/debian-handbook/)
- Rocky Linux documentation -- [docs.rockylinux.org](https://docs.rockylinux.org/)
- Red Hat documentation -- [access.redhat.com](https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/commands/README.md)
- [basic](/commands/basic.md)
- [file](file.md)
- [coverage-matrix](/research/coverage-matrix.md)
