# Compression and Archiving

In the Linux world,
"turning a pile of files into one file you can carry off" and "making that file smaller" are two different things;
it is just that `tar -czf` welds them into a single command line,
which is why many people never manage to tell **archiving** apart from **compression**.
Archiving solves an **organization problem** --
the directory tree,
permissions,
owner,
and timestamps have to be sealed into one file intact,
so transfers and backups are atomic;
compression solves a **size problem** --
exploiting data redundancy to shrink a byte stream,
saving disk and bandwidth.
Only once these two concepts are straight can you understand
why `tar` pairs with `-z`/`-j`/`-J`/`--zstd`,
why `.tar.gz` is really two layers of format inside,
and which algorithm to pick between the opposite demands of "backups must be fast" and "releases must be small".

> Content drawn from the tar, gzip, bzip2, xz, and zstd manuals plus hands-on ops experience; see the references at the end.
> Terminal output marked "real output" was captured from actual runs (demo directory `/tmp/tardemo`); reproduce it on your own machine.

## Why Compression and Archiving Must Be Learned Together

Three real scenarios you cannot get around:

1. **Backups**.
   `/var/www` holds 40 GB of files,
   tens of thousands of inodes,
   mixed owners and 750 permissions.
   Pack it with `zip -r` and
   the permission bits get flattened into a uniform read-write mask;
   after restoring onto a new machine the web service may not even be able to open its files;
   `tar` preserves permissions,
   group ownership,
   symlinks,
   and device files as they were.
   That is the root reason server backups are almost always `tar` (paired with compression).
2. **Transfers**.
   Sending a colleague 2 GB of logs uncompressed takes minutes over the intranet;
   compressed it may be only 200 MB;
   the other way round,
   an already-compressed `.mp4` barely shrinks under `gzip`,
   which is a pure waste of CPU.
   **Picking the right algorithm matters exactly as much as picking whether to compress at all.**
3. **System packages and source distribution**.
   Debian's `.deb`,
   RPM,
   and Arch's `.pkg.tar.zst` are all, at heart, "tar archive plus some compression" --
   Arch switched its package format from `.pkg.tar.xz` to `.pkg.tar.zst` in 2020
   precisely because zstd has an order-of-magnitude lead in unpacking speed.
   Every package you saw in the package-management chapter
   runs on this chapter's tools underneath.

Bird's Private Recipes (Lin's Linux Administration Guide) sums the chain up as:
**packing = boxing things up,
compression = sucking out the air**.
Box first (tar),
then remove the air (gzip/zstd/...);
the two steps can be chained automatically by `tar -z`,
or split apart and run separately (`tar -cf - dir | gzip > out.tgz`).
Only once you grasp this separability
do all the streaming-pipeline usages below make sense.

> Example output comes from a real Ubuntu 26.04 environment; see the references at the end.

## What This Chapter Covers

- **Run the full tar flow fluently**:
  create (`-c`),
  list (`-t`),
  extract (`-x`),
  name the archive (`-f`),
  pick the extraction directory (`-C`),
  exclude (`--exclude`),
  incremental backups (`--listed-incremental`),
  and split volumes (with `split`),
  and be able to explain each letter of `-czvf`.
- **Choose the algorithm by scenario**:
  remember where gzip (fast,
  universal),
  bzip2 (slower,
  higher compression ratio),
  xz (slowest,
  smallest),
  and zstd (fast and tunable,
  the modern default) each sit,
  and know the rule "daily backups use gzip/zstd,
  chasing size uses xz,
  fast interactive extraction uses zstd".
- **Handle the single-file compressors fluently**:
  `gzip`/`bzip2`/`xz`/`zstd` with keep-original (`-k`),
  stdout (`-c`),
  test (`-t`),
  levels (`-1`...
  `-9`),
  and multithreading (`xz -T0`,
  `zstd -T0`).
- **Deliver across platforms**:
  exchange files with Windows using `zip`/`unzip`,
  handle split volumes and encryption with `7z`,
  and know "do not use zip for Linux server backups".
- **Move freely across the three families**:
  `tar`/`gzip`/`bzip2`/`xz`/`zstd` are preinstalled on all three;
  `zip`/`pigz`/`7z` and friends are installed with `apt install` on Debian,
  `pacman -S` on Arch,
  and `dnf install` on the RHEL family.
- **Avoid the classic incidents**:
  understand the common gotchas -- `-f` must sit immediately before the filename,
  archiving absolute paths strips the leading slash,
  `gzip -f` cannot repair damage,
  and you must confirm the target directory is empty before extracting.

## 1. The tar Command

### 1.1 Basic Usage

`tar` is short for *tape archive*; it was designed for tape drives and is now the de facto archiving standard on Linux. The two most common pieces of muscle memory:

```bash
tar -cvf archive.tar /path/to/directory
tar -czvf archive.tar.gz /path/to/directory
tar -cjvf archive.tar.bz2 /path/to/directory
tar -cJvf archive.tar.xz /path/to/directory
tar --zstd -cf archive.tar.zst /path/to/directory
tar -xvf archive.tar
tar -xzvf archive.tar.gz
tar -xJvf archive.tar.xz
tar -xzvf archive.tar.gz -C /opt/app
tar -tvf archive.tar
```

Real output -- after creating, listing the contents line by line (`-t` is the `ls -l`-style equivalent):

```bash
$ tar -cvf archive.tar tardemo
tardemo/
tardemo/app/
tardemo/app/main.conf
tardemo/app/logs/
tardemo/app/logs/app.log

$ tar -tvf archive.tar
drwxrwxr-x cui/cui           0 2026-09-22 05:33 tardemo/
drwxrwxr-x cui/cui           0 2026-09-22 05:33 tardemo/app/
-rw-rw-r-- cui/cui          18 2026-09-22 05:33 tardemo/app/main.conf
drwxrwxr-x cui/cui           0 2026-09-22 05:33 tardemo/app/logs/
-rw-rw-r-- cui/cui           4 2026-09-22 05:33 tardemo/app/logs/app.log
```

The `-tvf` output is the very proof that "tar keeps metadata":
owner/group (`cui/cui`),
permission bits (`-rw-rw-r--`),
and timestamps are all on record.
That is also why permissions come back on their own after a restore.

### 1.2 Common Options

Take `-czvf` apart and tar's core options are really just a handful of letters:

| Option | Meaning | Notes |
|------|------|------|
| `-c` | create, build an archive | mutually exclusive with `-x`/`-t` |
| `-x` | extract | |
| `-t` | list, print the contents | use it to check an archive before shipping |
| `-v` | verbose, print filenames line by line | often omitted in scripts to cut log volume |
| `-f` | file, name the archive | **must be followed immediately by the filename**, see common pitfalls |
| `-z` | pipe through gzip | `.tar.gz`/`.tgz` |
| `-j` | pipe through bzip2 | `.tar.bz2`/`.tbz2` |
| `-J` | pipe through xz | `.tar.xz` |
| `--zstd` | pipe through zstd | `.tar.zst` |
| `-C` | switch to a directory before acting | the key to extracting into a chosen directory |
| `--exclude` | exclude matching paths | can be repeated |
| `-p`/`--preserve-permissions` | keep permission bits | kept by default when root extracts a backup |

In old material `-z` can already be replaced by the auto-detection of newer GNU tar (`tar -xvf foo.tar.gz` figures out on its own that it is gzip),
but **writing `-z` explicitly travels better**,
and is more dependable on minimal environments and non-GNU tar (some BSD scenarios).

### 1.3 Advanced Usage: Exclusion, Incrementals, Split Volumes, and Directory Switching

```bash
tar -czvf archive.tar.gz --exclude="*.log" /path
tar -czvf archive.tar.gz --exclude="node_modules" --exclude=".git" /path
tar -czvf archive.tar.gz --exclude-from=exclude.txt /path
tar -czvf out.tar.gz -C /path/to/dir .
tar -czvf backup-full.tar.gz --listed-incremental=/backup/snapshot.snar /data
tar -czvf backup-incr.tar.gz --listed-incremental=/backup/snapshot.snar /data
tar -czvf - /path | split -b 1G - archive.tar.gz.
cat archive.tar.gz.* | tar -xzvf -
tar -czvf - /path | ssh user@remote "cat > /remote/backup.tar.gz"
ssh user@remote "tar -xzvf /remote/backup.tar.gz -C /remote/path"
```

The `-C /path/to/dir .` combination deserves its own memory slot:
many people extract an archive and find a long `path/to/dir/` prefix they never wanted,
because they ran `tar -cf out.tar.gz path/to/dir` from the wrong directory level.
**If you want the archive root "flat",
use `-C` to enter the target first when packing,
then archive `.`.**

The `.snar` snapshot file of an incremental backup records each file's state at the last backup;
the next run of `--listed-incremental` **automatically marks files already backed up and unchanged as "handled"**,
so the archive it produces contains only the changes.
Note:
the incremental chain must be stored together --
lose one link in the middle
and the later incrementals cannot be restored correctly.

## 2. The gzip Command

gzip is the oldest and most widely embedded compression tool:
nearly all Linux system log rotation (logrotate),
kernel images (`vmlinuz`),
and man pages (`*.gz`) use it.
The default level `-6` is the balance point between speed and size;
for everyday use, just press enter.

```bash
gzip file.txt
gzip -d file.txt.gz
gzip -k file.txt
gzip -9 file.txt
gzip -1 file.txt
gzip -c file.txt > out.gz
gzip -l file.gz
gzip -t file.gz
gzip -r /path
```

Real output (`-l` shows plainly "how much was squeezed out"):

```bash
$ gzip -l archive.tar.gz
         compressed        uncompressed  ratio uncompressed_name
                225               10240  98.0% /tmp/archive.tar
```

A 10240-byte tar squeezed down to 225 bytes (a 98% ratio) --
the demo data is so small that the numbers come out exaggerated;
real text data usually lands in the 60%-80% range.
Another real reminder:
**small files can come out larger after compression**;
an 18-byte config file becomes 43 bytes under `gzip -9`,
because gzip's header and the deflate code tables carry fixed overhead.

Note the fundamental difference between `gzip -r` and `tar -z`:
`gzip -r` compresses **each file in a directory separately** into its own `.gz`,
keeping neither the directory structure nor permissions;
`tar -czf` is the real "archive + compression".
For backups, always pick the latter.

## 3. The bzip2 Command

bzip2 uses the Burrows-Wheeler transform;
its compression ratio usually beats gzip by 10%-20%,
but it is several times slower.
It was very popular in the source tarballs of the 2000s (`.tar.bz2`);
today xz and zstd are squeezing it from both sides,
and its main role is compatibility with historical files.

```bash
bzip2 file.txt
bzip2 -d file.txt.bz2
bzip2 -k file.txt
bzip2 -9 file.txt
bzip2 -c file.txt > out.bz2
bzip2 -t file.txt.bz2
bzip2 -l file.txt.bz2
```

Real comparison (the same 18-byte file):
`bzip2` produces 50 bytes,
`xz` produces 84 bytes --
on small files the algorithm differences drown in fixed overhead,
once again showing that **ratio comparisons only mean something on datasets with real bulk**.

## 4. The xz Command

xz is built on LZMA/LZMA2
and has the highest compression ratio of these traditional algorithms,
at the cost of slow compression
and decompression that is also slower than gzip.
Kernel source trees and the packages of some distros once used `.xz` heavily.
It works best on large files
and on text whose content does not vary wildly.

```bash
xz file.txt
xz -d file.txt.xz
xz -k file.txt
xz -9 file.txt
xz -0 file.txt
xz -T 0 file.txt
xz -t file.txt.xz
xz -l file.txt.xz
```

`-T 0` is xz's unique edge over the other tools:
even a single file can saturate all cores.
Compressing 10 GB of logs on a 16-core machine,
`xz -T0 -9` is an order of magnitude faster than single-threaded,
and the final size is identical.

## 5. The zstd Command

zstd (Zstandard) was open-sourced by Facebook
with the goal of "faster than gzip,
smaller than gzip",
and it offers **continuously tunable levels**:
`-1` through `-19`,
plus the extreme `--ultra -22`.
It is today's new-generation default --
Arch's package format is `.pkg.tar.zst`,
the inner layer of Debian 11+ `.deb` files is zstd too,
and projects such as systemd and
Chrome have all completed the migration.

```bash
zstd file.txt
zstd -d file.txt.zst
zstd -k file.txt
zstd -19 file.txt
zstd -T0 file.txt
zstd -t file.txt.zst
zstd -l file.txt.zst
tar --zstd -cf backup.tar.zst /data
```

Selection rule:
**new systems,
needing both speed and size -> zstd;
chasing the smallest possible size,
with time to spare -> xz;
needing maximum compatibility (the other side may be an old system or a Windows portable tool) -> gzip;
purely decoding a legacy file -> bzip2.**
In the demo data `tar --zstd` (418 bytes) actually comes out larger than `tar.gz` (225 bytes),
because the sample is only a few bytes
and zstd's dictionary overhead dominates --
**for files below the KB scale,
arguing over algorithms is pointless;
just use gzip.**

## 6. zip and unzip

zip's core value is not the compression ratio
but **cross-platform reach**:
Windows and
macOS both open it natively,
and the email/cloud-drive attachment ecosystem is mature.
It also supports password encryption and split volumes.
The drawback is that it keeps neither Linux permission bits nor owners,
so **never use zip for server backups**;
**zip is for sending files to Windows colleagues**.

```bash
zip archive.zip file1.txt file2.txt
zip -r archive.zip /path/to/directory
zip -r archive.zip /path -x "*.log"
zip -r -s 1G archive.zip /path
zip -e archive.zip file
unzip archive.zip
unzip archive.zip -d /path
unzip -l archive.zip
unzip -t archive.zip
unzip -o archive.zip
```

For stronger encryption (AES-256), use `7z` or a modern tool beyond `zip -P`;
the ZipCrypto behind `zip -e`/`-P` can already be brute-forced,
so do not trust it with sensitive data.

## 7. The 7z Command

7z offers a high compression ratio,
multiple algorithms (LZMA/LZMA2/Zstd/PPMd...),
AES-256 encryption,
and **split archives**,
suited to scenarios like "split a big file, encrypt it, and send it over".
It is not installed by default:
on Debian/Ubuntu run `sudo apt install p7zip-full`,
on Arch run `sudo pacman -S 7zip` (the `p7zip` of old documents has been taken over by the `7zip` package),
and on RHEL/CentOS/Rocky run `sudo dnf install p7zip p7zip-plugins` --
the full three-family table is in section 9.

Basic usage (`a` = add, `x` = extract keeping the path structure, `e` = extract discarding paths, `l` = list, `t` = test):

```bash
7z a archive.7z file1.txt file2.txt
7z x archive.7z
7z e archive.7z
7z l archive.7z
7z t archive.7z
7z a -v1g archive.7z /large/dir
7z a -pSecret -mhe=on archive.7z dir
```

## 8. Compressor Comparison and Selection

| Tool | Compression ratio | Compression speed | Decompression speed | Extension | Typical use |
|------|--------|----------|----------|--------|----------|
| gzip | medium | fast | very fast | `.gz`/`.tgz` | log rotation, daily backups, maximum compatibility |
| bzip2 | higher | slow | medium | `.bz2` | compatibility with legacy source tarballs |
| xz | highest (among traditional algorithms) | very slow | medium, leaning slow | `.xz` | extreme size, kernel/firmware releases |
| zstd | high (beats gzip at the same level) | fast (multicore capable) | very fast | `.zst`/`.tzst` | default for new projects, package formats, large backups |
| zip | medium | fast | fast | `.zip` | exchanging with Windows, email attachments |
| 7z | high | medium | medium | `.7z` | encryption, split volumes, multi-format archives |

**Selection decision tree** (just evaluate in order):

1. The recipient is on Windows or needs double-click opening -> `zip` (`7z` if you need encrypted split volumes).
2. A server backup or a release for Linux users, with the other environment unknown -> `tar.gz` (the safe fallback, always correct).
3. Large backups where the backup window matters -> `tar.zst` (`zstd` default level).
4. Size must be minimal and time does not matter (it can run overnight) -> `tar.xz` (`xz -T0 -9`).
5. Need incrementals/exclusions/permission preservation -> whatever the compressor, **the outer layer is always `tar`**.
6. Files that are already compressed (mp4/jpg/gz/xz) -> **do not compress again**, just pack and transfer.

## 9. Three-Family Comparison and Tool Installation

`tar`,
`gzip`,
`bzip2`,
`xz`,
`zstd`,
`gunzip`,
and `zcat` are all preinstalled on **Debian/Ubuntu,
Arch,
and RHEL/CentOS/Rocky**
and work out of the box.
What needs a per-distro install are the tools below (note the **`pacman -S` spelling in the Arch column**):

| Tool/Command | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|-----------|---------------|------|-------------------|
| `zip`/`unzip` | `sudo apt install zip unzip` (unzip usually preinstalled) | `sudo pacman -S zip unzip` | `sudo dnf install zip unzip` |
| `7z` | `sudo apt install p7zip-full` | `sudo pacman -S 7zip` | `sudo dnf install p7zip p7zip-plugins` |
| `pigz` (parallel gzip) | `sudo apt install pigz` | `sudo pacman -S pigz` | `sudo dnf install pigz` |
| `pbzip2` (parallel bzip2) | `sudo apt install pbzip2` | `sudo pacman -S pbzip2` (also in AUR) | `sudo dnf install pbzip2` (EPEL) |
| `pxz` (legacy parallel xz) | `sudo apt install pxz` | `sudo pacman -S pxz` | generally replaced by `xz -T0` |
| `zstd` | `sudo apt install zstd` (usually already present) | `sudo pacman -S zstd` | `sudo dnf install zstd` |
| `lrzip`/`lz4` | `sudo apt install lrzip lz4` | `sudo pacman -S lrzip lz4` | `sudo dnf install lrzip lz4` |

Key points:

- **Parallel tools are the speed shortcut**.
  `pigz` is used exactly like `gzip` (just swap the `-z` pipe for pigz),
  with a clear speedup when compressing GB-scale logs on a multicore box;
  `xz`/`zstd` support `-T0` natively,
  no extra parallel package needed.
- **Some RHEL/CentOS packages live in EPEL** (such as `pbzip2`):
  run `sudo dnf install epel-release` first, then install.
- **The `7z` command on Arch comes from the `7zip` package** (the `p7zip` of older material is deprecated,
  so `pacman -S 7zip` is all it takes).
- Verify the tools are available with `command -v pigz pbzip2 7z zstd`; install whatever is missing, and do not assume the three families ship the same command set.

## 10. Real-World Cases

### 10.1 Backup and Compression Script

```bash
#!/bin/bash
# backup compression script: pack -> verify size -> prune old backups by retention policy
set -euo pipefail

BACKUP_DIR="/backup"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"
tar -czvf "$BACKUP_DIR/backup_$DATE.tar.gz" /important/data

# check the backup size (an empty or oddly small backup usually means the source path is wrong)
ls -lh "$BACKUP_DIR/backup_$DATE.tar.gz"

# delete backups older than 30 days (previewing with -ls before switching to -delete is the safer habit)
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +30 -delete
```

In production, after `tar` succeeds (already guaranteed by `set -e`), run one more `tar -tzf ... > /dev/null` integrity spot-check,
and only then rotate the old backups --
**confirm the new backup works first,
then delete the old one**;
never reverse the order.

### 10.2 Log Compression (Archive First, Verify, Then Delete the Sources)

```bash
#!/bin/bash
# log compression script: archive only old logs that stopped changing; delete sources only after the archive verifies
set -euo pipefail

LOG_DIR="/var/log"
ARCHIVE_DIR="/var/log/archive"
DATE=$(date +%Y%m%d)

mkdir -p "$ARCHIVE_DIR"

# -mtime +7: untouched for at least 8 days, steering clear of active logs still being written
# -print0 | tar --null -T -: handles filenames containing spaces safely
find "$LOG_DIR" -name "*.log" -mtime +7 -print0 \
  | tar -czf "$ARCHIVE_DIR/logs_$DATE.tar.gz" --null -T -

# source files may be deleted only after the archive passes the integrity spot-check
tar -tzf "$ARCHIVE_DIR/logs_$DATE.tar.gz" > /dev/null
find "$LOG_DIR" -name "*.log" -mtime +7 -delete
```

That order (pack -> `tar -t` verify -> delete) is the safety baseline of log archiving.
Delete with `-delete` first and pack afterwards,
and one failed archive run loses the source logs forever.

### 10.3 Compressing for File Transfer

```bash
tar -czvf - /path | ssh user@remote "cat > /remote/backup.tar.gz"
ssh user@remote "tar -xzvf /remote/backup.tar.gz -C /remote/path"
tar -cf - /large | pv -s $(du -sb /large | cut -f1) | gzip > backup.tar.gz
```

### 10.4 Splitting Large Files into Volumes

```bash
tar -czvf - /large/path | split -b 1G - archive.tar.gz.
cat archive.tar.gz.* | tar -xzvf -
scp archive.tar.gz.* user@remote:/path
```

`split -d` switches the suffix to numbers (`-00`,
`-01`),
which sort more intuitively;
zip supports split volumes natively with `zip -s 1G`;
the scenarios differ, so do not mix the two sets of volume files.

## 11. Performance Tuning

### 11.1 Choosing a Compression Level

Level and runtime trade off roughly linearly: `-1` is fastest with the largest output, `-9` slowest with the smallest, and `-6` is gzip's default balance point. Rules of thumb:

- Interactive transfers, in a hurry -> `-1` or `-3` (the size difference is usually a few percentage points; the time difference can be several-fold).
- Nightly routine backups -> default level (gzip `-6` / zstd `-3`).
- Archiving cold data, compress once and never read again -> `xz -9 -T0` or `zstd -19`.

### 11.2 Multithreaded Compression

```bash
sudo apt install pigz     # Debian/Ubuntu
sudo pacman -S pigz       # Arch
sudo dnf install pigz     # RHEL/CentOS/Rocky
tar -cf - /path | pigz > backup.tar.gz
xz -T0 -9 file.tar
zstd -T0 -19 file.tar
tar -cf - /path | pbzip2 > backup.tar.bz2
```

Parallel compression pays off most on **one big file**;
with many small files the bottleneck is usually I/O and process scheduling,
so aggregate into a single stream with `tar -cf -` first and then hand it to the parallel compressor --
faster than parallelizing per small file.

### 11.3 Choosing the Compression Algorithm

Text,
source code,
and logs are **high-redundancy data** where every algorithm shows a clear gap;
already-compressed media (`.jpg`/`.mp4`/`.gz`) shows almost none.
What really deserves optimizing is the **workflow**:
whatever can be done streaming in a pipe
should not be "write a temp file first,
then compress,
then delete the temp file" --
sparing one round trip to disk
often matters more than agonizing over `-9` versus `-6`.

## 12. Troubleshooting and Common Pitfalls

1. **Misplacing `-f`, so a directory is treated as the archive**. `-f` must be followed immediately by the archive filename. Real error:

   ```bash
   $ tar -cvf tardemo archive2.tar
   tar: tardemo: Cannot open: Is a directory
   tar: Error is not recoverable: exiting now
   ```

   The correct form is `tar -cvf archive2.tar tardemo` --
   filename right after `-f`, path last.
   If you forget `-f`, GNU tar may try to write the default tape device or spray the archive stream onto the terminal (a screen of mojibake), which is worse.

2. **Archiving absolute paths, then losing control of the levels on extraction**. Real sequence:

   ```bash
   $ tar -czvf abs.tar.gz /tmp/tardemo/app/main.conf
   tar: Removing leading `/' from member names
   /tmp/tardemo/app/main.conf

   $ tar -xzvf abs.tar.gz -C /tmp/ext
   tmp/tardemo/app/main.conf
   # actually lands at: /tmp/ext/tmp/tardemo/app/main.conf
   ```

   For safety tar strips the leading `/` (so extraction cannot write through to the root),
   turning `/tmp/...` into the relative `tmp/...` with an extra directory layer.
   **The proper form: pack a relative path with `tar -czvf out.tgz -C /parent dir`**,
   and let `-C` fully control where it extracts.

3. **`gzip -f` is not "repair"**.
   `-f` only means "force overwriting same-named output";
   it does nothing for a damaged `.gz` --
   the gzip family has no repair capability.
   After damage, re-archive from the source data,
   or fall back to an older copy in your backups;
   `gzip -t`/`xz -t`/`zstd -t` are for **detecting** damage,
   not fixing it.

4. **Extracting into the wrong directory,
   with files scattered everywhere**.
   `tar -xvf x.tar.gz` without `-C` extracts into the **current directory**.
   Run it once by mistake under `/root` or `/`
   and your directory structure is a mess.
   Habits:
   run `pwd` before extracting to confirm,
   run `tar -tf` first to see what the archive root looks like,
   and when the target is not clean, `mkdir newdir && tar -xf -C newdir` first.

5. **Extracting with the wrong compression flag**. `-z`/`-j`/`-J`/`--zstd` must match how the file was actually compressed. A real error from mixing them:

   ```bash
   $ tar -xzvf archive.tar.gz -t
   tar: You may not specify more than one '-Acdtrux', '--delete' or '--test-label' option
   ```

   That error actually stacks a second mistake:
   `-t` and `-x` cannot be given together (both are "operation modes").
   **Pick exactly one mode (c/x/t) at a time**;
   modern GNU tar can auto-detect when no compression flag is given,
   but once you specify one manually it has to be the right one.

6. **Overwriting existing files without prompting**.
   tar extraction,
   `gzip -k`,
   and `unzip` all silently overwrite same-named targets by default (`unzip` does prompt,
   but scripts commonly pass `-o` to overwrite outright).
   Before restoring production files, compare with `tar -tf` first,
   or extract into a temporary directory, diff, then replace.

7. **Permissions not surviving a restore**.
   When a regular user extracts a backup made by root,
   the owner becomes you (tar cannot "become" someone else),
   and SUID bits may be dropped (the default safety policy).
   **Extract system-level backups as root**,
   or use `tar -xpf` explicitly (`-p` keeps permissions) and `chown` afterwards.
   The other way round,
   `zip` does not store Unix permissions by design,
   so restoring a server backup from zip always ends with wrong permissions --
   that is a tool-selection error,
   not an operating error.

8. **Files "being written" sneaking into the archive**.
   Back up a live database directory without first stopping writes or taking a consistent snapshot
   and the resulting archive may be corrupt (the application changed files mid-read).
   Rule:
   **database backups go through dedicated tools (mysqldump/pg_dump) or LVM/filesystem snapshots**;
   `tar` is only for static file trees.

9. **Low disk space producing a "half-finished archive"**.
   Compression needs temporary space (especially for split volumes and extraction, roughly the size of the original file).
   Check with `df -h` first;
   when space is tight, stream straight to a remote host through a pipe (see 10.3)
   to avoid holding two copies on this machine.

10. **Agonizing over level/algorithm for tiny files**.
    A few dozen bytes can come out larger after compression (real data in this chapter:
    18 -> 43 bytes).
    Batch small files by aggregating with `tar` first and compressing the stream,
    so the redundancy can actually be exploited.

11. **An unquoted `--exclude` pattern expanded by the shell**.
    When the current directory happens to hold `.log` files, `--exclude=*.log` gets expanded by the shell into concrete filenames,
    and the exclusion semantics break.
    Any pattern handed to tar/find/grep to interpret itself
    gets **single quotes, no exceptions**.

12. **Treating the incremental `.snar` snapshot as garbage and deleting it**.
    The snapshot file is the root of the incremental chain;
    deleting it makes every historical incremental unrestorable.
    `.snar` must be kept for as long as the backup set itself.

## References

- `man tar`, `man gzip`, `man bzip2`, `man xz`, `man zstd`, `man zip`, `man unzip`, `man split`
- GNU tar manual -- [gnu.org](https://www.gnu.org/software/tar/manual/)
- gzip manual -- [gnu.org](https://www.gnu.org/software/gzip/manual/gzip.html)
- bzip2 manual -- [sourceware.org](https://sourceware.org/bzip2/manual/manual.html)
- xz / xz-utils documentation -- [tukaani.org](https://tukaani.org/xz/)
- zstd manual -- [github.com](https://github.com/facebook/zstd/blob/dev/programs/zstd.1.md)
- 7-Zip official documentation -- [7-zip.org](https://www.7-zip.org/faq.html)
- Arch Wiki - Pacman (the `.pkg.tar.zst` package format) -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- Arch Wiki - zstd -- [wiki.archlinux.org](https://wiki.archlinux.org/title/General_recommendations)
- Bird's Private Recipes (Lin's Linux Administration Guide) - compression and packing commands -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0240tarcompress.php)
- Debian manual - archiving and compression -- [debian.org](https://www.debian.org/doc/manuals/debian-handbook/)
- GNU tar manual - packing and compression -- [gnu.org](https://www.gnu.org/software/tar/manual/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [tarball](/basic/packages/tarball.md)
- [README](README.md)
- [coverage-matrix](/research/coverage-matrix.md)
