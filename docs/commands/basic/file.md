# File Operation Commands

In Linux, "everything is a file" is not just a slogan: programs, devices, configuration, and even directories themselves are ultimately exposed through a file interface. In everyday troubleshooting you reach for simple file operations far more often than complex service commands -- create, view, copy, move, delete, find, compare. Getting their semantics, exit codes, and danger boundaries straight makes the later chapters on permissions, logs, and automation scripts much easier to follow.

> Example output on this page comes from a real Ubuntu 26.04 environment; distribution differences are noted in the text. The core tools are installed by default on Debian/Ubuntu, RHEL/CentOS/Rocky, and Arch, so nothing extra is usually needed.

## What This Chapter Covers

- Understand the semantics and exit codes of file creation, viewing, copying, moving, and deleting
- Be fluent in searching by name, size, and time, and in file comparison and linking
- Recognize the common gotchas: inode, symbolic links, and quoting wildcards

## 1. Creating Files

### 1.1 touch - Create Empty Files and Update Timestamps

`touch` has two jobs: create an empty file when the file does not exist, and update the atime and mtime when it does. Ops scripts use it as a "check-in" to refresh timestamps, or to generate placeholder files in bulk.

```bash
# create an empty file
touch file.txt

# create several at once
touch file1.txt file2.txt file3.txt

# set a specific mtime (format [[CC]YY]MMDDhhmm)
touch -t 202401011200 file.txt
stat -c '%n mtime=%y' file.txt
```

```text
file.txt mtime=2024-01-01 12:00:00.000000000 +0000
```

Use `touch -a` to update only the access time and `touch -m` to update only the modification time. `-d` reads better: `touch -d '2024-06-15 08:30:00' file2.txt`.

**Gotcha**: `touch` never empties an existing file; it only touches the timestamps. If a parent directory in the target path does not exist you get `No such file or directory` -- run `mkdir -p` first.

### 1.2 cat Redirection and Heredoc - Write Content

Redirection is the more common way to create a file. `cat > file` writes with truncation, `cat >> file` appends, and a heredoc (`<< EOF`) is good for writing several lines at once.

```bash
cat > file.txt << 'EOF'
Hello Linux
Second line	with tab
EOF

cat >> file.txt << 'EOF'
appended line
EOF
```

The quotes around `'EOF'` suppress variable expansion (`$VAR` is kept literally), which is safer when writing configuration fragments.

## 2. Viewing Files

### 2.1 cat - Print the Whole File

`cat` sends the file to standard output as-is, good for small files or piping. `-n` numbers the lines, and `-A` shows every non-printing character (tab as `^I`, line ends as `$`).

```bash
cat -n file.txt
cat -A file.txt
```

```text
     1	Hello Linux
     2	Second line	with tab
     3	Third line with trailing space   
```

```text
Hello Linux$
Second line^Iwith tab$
Third line with trailing space   $
```

`cat -A` is a sharp tool for hunting "invisible spaces / tabs / line endings": when configuration alignment fails or a patch will not apply, look here first.

**Gotcha**: `cat` on a huge log pulls everything into the pipe at once -- slow and memory-hungry. Use `less`, `head`, or `tail` for big files.

### 2.2 less / more - Paginated Viewing

Use `less` on big files to page back and forth and to search; `more` only moves forward and has fewer features, but fewer dependencies too. Common `less` keys: space for the next page, `b` for the previous page, `/` to search, `q` to quit.

```bash
less file.txt
more file.txt
```

### 2.3 head / tail - View Head and Tail

The most-used pair for log troubleshooting. Each shows 10 lines by default; `-n` selects a line count, `-c` a byte count, and `tail -f` follows appended writes in real time.

```bash
head -n 5 nums.txt
tail -n 3 nums.txt
tail -n +18 nums.txt    # show from line 18 to the end
```

```text
1
2
3
4
5
```

```text
23
24
25
```

`tail -n +N` is more intuitive than `sed -n 'N,$p'` when you want to skip a progress bar or a header. Following a live log: `tail -f /var/log/syslog` (the common path on the RHEL family is `/var/log/messages`; `-F` reopens automatically after log rotation).

## 3. Copying Files

### 3.1 cp - Copy Files

`cp` does **not** preserve metadata such as ownership and timestamps by default, and it does not confirm before overwriting an existing target. `-i` confirms interactively, `-n` never overwrites, `-p` preserves attributes, and `-a` is archive mode (preserve attributes plus recurse; the common spelling of `-dR --preserve=all`).

```bash
cp file.txt copy_of_file.txt
cp -v file.txt copy2.txt
```

```text
-rw-rw-r-- 1 cui cui 67 Sep 22 05:52 copy_of_file.txt
'file.txt' -> 'copy2.txt'
```

```bash
cp -a file.txt cp_a.txt
stat -c '%n %y' file.txt cp_a.txt
```

```text
file.txt 2024-01-01 12:00:00.000000000 +0000
cp_a.txt 2024-01-01 12:00:00.000000000 +0000
```

Copying a directory requires `-r`/`-R` (or `-a`). More on recursive directory copying in [Directory Operation Commands](./directory.md).

**Gotcha**: in `cp src/ dest/`, a trailing slash on the source still means the directory itself under GNU `cp`; the real danger is writing `.` or the root path as the target. In production, prefer `cp -i`, or copy to a temporary name first and then `mv` into place.

## 4. Moving Files

### 4.1 mv - Move and Rename

Within one filesystem, `mv` mostly rewrites the directory entry (rename) and is nearly instant; across filesystems it becomes a copy followed by a delete. Renaming and moving are two faces of the same command.

```bash
mv -v copy2.txt renamed.txt
```

```text
renamed 'copy2.txt' -> 'renamed.txt'
```

```bash
mv file.txt /path/to/dir/
mv -i old.txt existing.txt      # ask before overwriting
mv -n important.txt backup/     # do not overwrite if the target exists
```

**Gotcha**: `mv` silently overwrites a same-named target by default; without `-i`/`-n` there is no undo. Before a batch `mv *.txt dir/`, run `echo *.txt` to see what the wildcard expands to and avoid sweeping in files you did not mean to move.

## 5. Deleting Files

### 5.1 rm - Delete Files

`rm` does not send files to a trash. `-i` confirms each one, `-f` forces (and does not report missing files), and `-r` deletes directories recursively.

```bash
rm -v renamed.txt
```

```text
removed 'renamed.txt'
```

```bash
rm file.txt
rm -i important.txt
rm -r directory/
rm -rf directory/
```

**Safety advice (follow this)**:

1. Guard variable paths passed to `rm -rf` in scripts: `[ -n "$dir" ] && rm -rf -- "$dir"`.
2. Always put `--` before an absolute path or an explicit relative path, so filenames beginning with `-` are not read as options.
3. An empty path is extremely dangerous on some older implementations; newer GNU coreutils have protection, but do not bet on implementation details.
4. See [Directory Operation Commands](./directory.md) for the full discussion of recursive directory deletion.

## 6. Finding Files

### 6.1 find - Find by Condition

`find` walks the filesystem directly: precise conditions, no database. The most common forms are by name, type, size, and time.

```bash
find . -name "*.txt" -type f
find . -iname "*.TXT"              # ignore case in the name
find . -name "*.txt" -size +0c     # larger than 0 bytes
find . -name "*.txt" -mtime -1     # modified within the last 24 hours
find . -perm -u+x -name "*.sh"     # scripts executable by the owner
```

```text
./a.txt
./b.txt
./copy_of_file.txt
./dir_a/nested.txt
./file.txt
...
./permtest/exec.sh
```

Acting on the matches:

```bash
find . -maxdepth 1 -name "nums.txt" -exec wc -l {} \;
```

```text
25 ./nums.txt
```

`-delete` removes in place (depth-first is implied); for large numbers of files use `-print0 | xargs -0` instead -- see `xargs` in [Text Processing Commands](../text/text_processing.md).

**Gotchas**:

- The `*.txt` in `-name "*.txt"` **must be quoted**, otherwise the shell expands the glob first and `find` receives a list of concrete filenames instead of a pattern.
- `-mtime -7` means "within 7 days" and `-mtime +7` means "more than 7 days ago" -- it is easy to invert the sign. When unsure, drop the `-exec` first and just read the paths.
- `find /` scans from the root and is slow; narrow the start directory first, or switch to `locate` for paths that are already indexed.

### 6.2 locate - Fast Database-Backed Search

`locate` queries a prebuilt database, so it is extremely fast, but it **cannot see files that were just created or just deleted**, and results are a historical snapshot. `updatedb` refreshes the database on a schedule (usually via `cron` or a `systemd timer`).

```bash
# update the database manually (root required)
sudo updatedb

# search
locate file.txt

# match the path with a regex
locate -r '\.txt$'
```

Installation differs by distribution: `locate` is **not installed** by default in this Ubuntu demo environment (`apt install plocate` is needed); use `dnf install plocate` or `mlocate` on RHEL/CentOS/Rocky, and `pacman -S plocate` on Arch. If the command is missing, `find` is the only reliable choice.

More at [Arch Wiki - Locate](https://wiki.archlinux.org/title/Locate) and [man find](https://man.archlinux.org/man/find.1).

## 7. Comparing Files

### 7.1 diff - Compare Files

`diff` prints a **human-readable, patchable** difference. The exit code matters for scripts: `0` means identical, `1` means differences, and `>1` means error.

```bash
diff file.txt file2.txt; echo "exit=$?"
```

```text
1,2c1,2
< Hello Linux
< Second line	with tab
---
> Hello Linux v2
> Second line changed
3a4
> Fourth line
exit=1
```

Unified format (the patch standard) and side-by-side display:

```bash
diff -u file.txt file2.txt || true
diff -y file.txt file2.txt
diff -rq dir1 dir2          # report only files that differ (quiet)
```

```text
--- file.txt	2024-01-01 12:00:00.000000000 +0000
+++ file2.txt	2024-06-15 08:30:00.000000000 +0000
@@ -1,3 +1,4 @@
-Hello Linux
-Second line	with tab
+Hello Linux v2
+Second line changed
 Third line with trailing space   
+Fourth line
```

**Gotcha**: under `set -e`, `diff` exiting `1` because files differ aborts the script; either append `|| true`, or test explicitly with `if diff -q a b; then ...`.

### 7.2 cmp - Byte-by-Byte Comparison

`cmp` reports the position of the first differing byte and suits binary files; `-l` lists every differing byte (in octal).

```bash
cmp a.txt b.txt; echo "exit=$?"
cmp -l a.txt b.txt || true
```

```text
a.txt b.txt differ: byte 7, line 1
exit=1
7 147 130
```

Choosing between them: use `diff` for text when you want to see what changed; use `cmp` for binaries, or when you only need to know whether two files are the same.

## 8. Linking Files

### 8.1 ln - Hard Links and Symbolic Links

A hard link shares the same inode as the original, so **deleting the original name still leaves the content reachable through the other hard link**; directories normally cannot be hard-linked (that would create loops). A symbolic link is a small file of its own that stores a target path, and it breaks the moment the target is gone.

```bash
ln file.txt hard_link.txt
ls -li file.txt hard_link.txt
```

```text
6665323 -rw-rw-r-- 2 cui cui 67 Jan  1  2024 file.txt
6665323 -rw-rw-r-- 2 cui cui 67 Jan  1  2024 hard_link.txt
```

In `ls -li` both lines share inode `6665323` with a link count of `2`, so it is one copy of the data.

```bash
ln -s file.txt soft_link.txt
ln -s missing_target.txt broken_link.txt
ls -l soft_link.txt broken_link.txt
```

```text
lrwxrwxrwx 1 cui cui  8 Sep 22 05:53 soft_link.txt -> file.txt
lrwxrwxrwx 1 cui cui 18 Sep 22 05:53 broken_link.txt -> missing_target.txt
```

**Gotchas**:

- Linking to a name that already exists: only `-f` in `ln -sf realfile linkname` will overwrite it; without `-s` you get another hard link.
- When a symbolic link stores a relative target, it resolves **relative to the directory holding the link**, not the current working directory.
- Hard links cannot cross filesystems; use a symbolic link instead.

## 9. File Attributes

### 9.1 stat - Inspect Metadata

`stat` shows the inode, size, permissions, and the three timestamps (access / modify / status change) among other things. When a file "is clearly there but will not open" or the timestamps look wrong, start with `stat`.

```bash
stat file.txt
stat -c 'inode=%i links=%h size=%s mode=%A' file.txt
```

```text
  File: file.txt
  size: 67        	Blocks: 8          IO Block: 4096   regular file
Device: 0,38	Inode: 6665323     Links: 2
Access: (0664/-rw-rw-r--)  Uid: ( 1000/     cui)   Gid: ( 1000/     cui)
Access: 2026-09-22 05:52:37.979360375 +0000
Modify: 2024-01-01 12:00:00.000000000 +0000
Change: 2026-09-22 05:53:16.742582259 +0000
 Birth: 2026-09-22 05:52:37.891366681 +0000
```

```text
inode=6665323 links=2 size=67 mode=-rw-rw-r--
```

Do not confuse the three timestamps: **Access** changes on every read; **Modify** changes only when the content changes (backups usually key off this one); **Change** changes when metadata (permissions, owner) changes and usually follows Modify closely.

To check free space on a filesystem use `df -h file.txt` (`stat -f` is the BSD/macOS habit; on GNU/Linux it means something different -- see [Directory Operation Commands](./directory.md)).

### 9.2 file - Identify File Type

Not relying on the extension, `file` reads the header to determine the type; `-i` prints the MIME type.

```bash
file file.txt
file -i file.txt
file fakebin
```

```text
file.txt: ASCII text
file.txt: text/plain; charset=us-ascii
fakebin: ELF
```

**Gotcha**: `file` reports the link itself for symbolic links by default (`symbolic link to ...`); add `-L` to follow the target. A `.sh` extension does not mean executable -- check the permission bits (`ls -l`) and the shebang.

## 10. Common Gotchas Quick Reference

| Symptom | Cause | Fix |
|------|------|------|
| `rm` deletion cannot be undone | no trash mechanism | back up important data first; use `rm -rf` cautiously |
| `cp`/`mv` silently overwrite | no confirmation by default | add `-i` or `-n` |
| `find` pattern does not match | `*.txt` expanded by the shell first | quote the pattern |
| `diff` aborts a script midway | exit code 1 when files differ | `\|\| true` or an explicit test |
| a symbolic link fails to open | target does not exist (broken link) | `ls -l` shows where the arrow points; `stat -L` follows it |
| `locate` misses a new file | the database is out of date | `sudo updatedb`, or switch to `find` |
| line endings / tabs do not line up | invisible characters in the file | check with `cat -A` |

## 11. Differences Across the Three Distributions

Core commands such as `cp`/`mv`/`rm`/`find` behave the same in all three families; the differences concentrate in **default umask, overwrite-confirmation aliases, and SELinux context** -- exactly the places that can be "quietly different" inside scripts.

| Scenario | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| install `plocate`/`tree`/`file` | `sudo apt install plocate tree file` | `sudo pacman -S plocate tree file` | `sudo dnf install plocate tree file` |
| default umask for new users | `0022` | `0022` | regular users `0002` (legacy); root `0022` |
| overwrite-confirmation alias for `cp`/`mv` | no `-i` alias by default | no `-i` alias by default | some setups alias `cp -i` and `mv -i` for root |
| inspect the SELinux context (`ls -Z`) | AppArmor; rarely used | no default mandatory access control | common; rules via `semanage fcontext` |
| system log path (in the `tail -f` example) | `/var/log/syslog` | `journalctl` first | `/var/log/messages` |

**Key point**: interactive root shells on the RHEL family commonly alias `cp`/`mv` with `-i`, so the same script can behave differently interactively and non-interactively -- in automation, write `-n` or `\cp` explicitly. A wrong `ls -Z` context is an SELinux labeling problem; restore it with `restorecon -R` rather than `chmod`.

## References

- Bird's Private Recipes (Lin's Linux Administration Guide) - File and directory management -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0220filemanager.php)
- Arch Wiki - Core utilities -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Core_utilities)
- Arch Wiki - Find -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Find)
- Arch Wiki - Locate -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Locate)
- Arch Wiki - File permissions -- [wiki.archlinux.org](https://wiki.archlinux.org/title/File_permissions)
- man ls -- [man.archlinux.org](https://man.archlinux.org/man/ls.1)
- man find -- [man.archlinux.org](https://man.archlinux.org/man/find.1)
- man stat -- [man.archlinux.org](https://man.archlinux.org/man/stat.1)
- man diff -- [man.archlinux.org](https://man.archlinux.org/man/diff.1)
- man ln -- [man.archlinux.org](https://man.archlinux.org/man/ln.1)
- Linux man pages (man7) -- [man7.org](https://man7.org/linux/man-pages/)
- Debian manual -- [debian.org](https://www.debian.org/doc/manuals/debian-handbook/)
- Rocky Linux documentation -- [docs.rockylinux.org](https://docs.rockylinux.org/)
- Red Hat documentation -- [access.redhat.com](https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/commands/README.md)
- [basic](/commands/basic.md)
- [directory](directory.md)
- [text_processing](/commands/text/text_processing.md)
- [coverage-matrix](/research/coverage-matrix.md)
