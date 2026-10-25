# Backup and Recovery

Backup is one of the few tasks in system administration that is invisible when it works and determines life or death when it fails.
Its cruelty lies in **delayed feedback**:
the act of making a backup and the moment of verifying it are often weeks or even months apart,
and data loss gives you only one chance.
This page revolves around one core idea -- **a restore drill is the real backup**:
a backup file that has never actually been restored is just a pile of bytes eating disk space;
you do not know whether it is complete, you do not know how long a restore takes, and you do not know whether your hands will shake when it is your turn.

> Content draws on the rsync/tar manuals, the Arch Wiki backup pages, and 3-2-1 strategy materials; see the references at the end.

## What This Page Covers

- The 3-2-1 backup strategy
- Distinguish full/incremental/differential backup types by their real difference in **restore cost**
- The applicable boundaries of rsync mirror sync, hard-link snapshots, and whole-disk images
- Schedule backups with cron and systemd timer, and know the default differences across the three families
- Complete a restore drill independently

## 1. Why Back Up: Data Is Lost in Ways You Did Not Expect

Many people think backup is for "hard drive failure".
In reality, hardware failure is the mildest way data is lost, because at least it is predictable;
the real accident list is far richer:

- **Human error**: `rm -rf` on the wrong directory, an erroneous `--delete` sync,
  someone "casually" altering a production table schema -- post-mortem audits show
  that accidental deletion is the number-one cause of data loss in small and medium teams.
- **Software and upgrade incidents**: a failed major distro upgrade,
  an incompatible database migration, an application bug overwriting a config file.
- **Ransomware**: ransomware does not pick targets; desktops and servers are treated the same.
  When encrypted, "the latest backup" on the same disk as the source is effectively no backup.
- **Accounts and cloud resources reclaimed**: cloud disks released with instances,
  object storage bucket policies misconfigured and emptied -- data stored in someone else's data center
  can be lost faster than a local hard drive.

The response must assume **the accident will come, and it will come when you are not around**.
This is the point of the 3-2-1 strategy.

### 1.1 3-2-1: What Each Number Guards Against

- **3 copies**: the production data itself counts as 1, backups must be at least 2.
  When a single backup breaks, is deleted by accident, or is encrypted, you still have one more chance;
  two copies can also validate each other, catching the case where "the backup has actually been incomplete for a while".
- **2 different media**: putting both copies on two SATA drives of the same model,
  a lightning strike, a power failure, or a firmware defect in the same batch can take them both down.
  Local disk + NAS, local disk + object storage -- heterogeneous counts.
- **1 offsite copy**: a fire, theft, or data center power outage will not send a heads-up first.
  Offsite can be an office in another city or a bucket in a cloud account of its own --
  the key is **not sharing a failure domain with production**, including the account itself.

A workable personal/small-team version:
data on a local SSD (production),
rsync to a home NAS daily (local backup, copy 2),
NAS syncs to an independent object storage bucket weekly (offsite, copy 3).
Two media tracks (SSD + HDD/NAS, NAS + cloud), three copies, one offsite -- compliant.

The reverse: "copy to a portable drive once a week, then put it back in the drawer" is only 2 copies, 1 media type, 0 offsite,
and it relies heavily on "remembering to do it every week" -- the least reliable component.
Scheduling is solved by cron and systemd timer in section 6.

### 1.2 Full, Incremental, Differential: The Difference Is Mainly at Restore Time

| Type | What Is Backed Up | Backup Cost | Restore Cost |
|------|-------------------|-------------|--------------|
| Full | All data | Slowest and most space-hungry every time | Simplest: one file or one disk done |
| Incremental | Changes since the **last backup of any kind** | Fastest and most space-efficient | Slowest: must replay the full + a chain of incrementals in order |
| Differential | Changes since the **last full** | Gets slower over time | Full + only the last differential needed |

The tradeoff is not "incremental is always better":
if any link in an incremental chain breaks, all subsequent backups are void,
and a restore at 2am means stacking seven or eight files in order -- easy to skip one.
When data volume is modest (under a few hundred GB), a daily full or "weekly full + daily incremental"
is often more reassuring; the shorter the restore path, the lower the chance of a midnight mistake.
Chains that really need careful design are scenarios at TB scale or above with small change volumes.

There is no global standard for strategy frequency; work backwards from two numbers:
**RPO (Recovery Point Objective, how much data loss is acceptable) determines frequency** --
once a day means at most 24 hours of loss; **RTO (Recovery Time Objective, how long to restore service) determines method** --
a workload requiring recovery within 1 hour cannot rely on "finding a tool on the fly and writing a restore script".

## 2. A Restore Drill Is the Real Backup

There is an old saying in the backup world: you back up to restore, not to create.
A backup that has never been drilled has at least four landmines:

1. **The file never got in**: script path wrong, insufficient permissions,
   the database export command failed silently, nobody reads the logs,
   so the directory that "backs up every day" has actually been stale for three weeks.
2. **The backup is broken**: archive corrupt, transfer interrupted leaving a half-file,
   encryption private key lost -- you will never know unless you open it once.
3. **Nobody knows the restore steps**: restore commands require flipping through docs on the spot,
   and midway you discover `dump` is not installed or the `-C` flag is missing.
4. **Restore time exceeds expectations**: estimated RTO is 2 hours,
   but actually pulling 500 GB back from offsite takes 5 hours.

So a drill is not a "nice-to-have ritual" but **the only way to prove a backup exists**.
A minimal quarterly drill has four steps:

```bash
# 1) Pick a recent backup and note its date and size (confirm it is not an empty shell)
$ ls -lh /backup/websites/
drwxr-xr-x 1000 1000 4.0K Jan 14 02:03 files_20260114_020311
-rw-r--r--    1 root  8.7M Jan 14 02:05 db_20260114_020544.sql.gz

# 2) Extract/sync to an isolated directory, never directly overwrite the production path
$ mkdir -p /tmp/restore_drill
$ gzip -t /backup/websites/db_20260114_020544.sql.gz   # verify archive integrity
$ rsync -a /backup/websites/files_20260114_020311/ /tmp/restore_drill/

# 3) Spot-check that key files open and their content makes sense (homepage, config, one record)
$ head -5 /tmp/restore_drill/index.html
$ zcat /backup/websites/db_20260114_020544.sql.gz | head -20

# 4) Record the elapsed time -- this is your real RTO; write it into the docs
$ du -sh /tmp/restore_drill && rm -rf /tmp/restore_drill
```

Database backups also need separate verification of **logical recoverability**:
import the SQL into a temporary instance, run two queries, and confirm the tables and row counts are intact.
There is a full import test between "file exists" and "data is usable".
A quarterly drill + a completion alert on every backup job (section 8)
together turn "think I am backing up" into "am actually backing up".

## 3. rsync Incremental, Snapshots, Mirrors: Three Mechanisms That "Look Like Backups"

These three terms are used interchangeably in daily talk but have completely different mechanisms and risks.
Choosing the wrong mechanism is the most common design error in a backup plan.

### 3.1 rsync Sync: Mirror-Style Incremental

rsync's job is **to sync changes from a source directory to a target**,
transferring only changed blocks, so it is often treated as an "incremental backup tool":

```bash
# Local archive sync: -a preserves attributes, -z compresses in transit, --delete makes the target a strict mirror of the source
$ rsync -avz --delete --exclude='*.log' /var/www/ /backup/www/

sending incremental file list
index.html
              1,024  100%    1.00kB/s    0:00:00 (xfr#1, to-chk=3/4)

sent 1,456 bytes  received 35 bytes  2,982.00 bytes/sec
total size is 1,024  speedup is 0.69
```

Three details that must be internalized:

- **Trailing slash on the source path** determines content hierarchy:
  `/var/www/` syncs the files inside www;
  `/var/www` puts the www directory itself into the target.
  One character wrong, and restore adds an extra directory level -- discovered only during a fire drill.
- **`--delete` is a double-edged sword**: it makes the target an exact mirror of the source,
  so a file deleted by accident in the source vanishes from the backup immediately --
  mirror sync is **by definition not a version history**.
  Always do a `-n` dry-run before going live:

  ```bash
  $ rsync -avzn --delete /var/www/ /backup/www/ | tail -5
  ...
  sent 1,200 bytes  received 35 bytes  0.00 bytes/sec   # -n writes nothing to disk
  ```

- **Only one copy of rsync = violates 3-2-1**:
  the backup directory and the source data are on the same disk, and a disk failure takes both down.

Suitable for: static sites, config directories, or the underlying engine for a snapshot chain where the goal is simply "keep a latest copy".
Not suitable for direct version history: it does not remember "what the file looked like last Wednesday".

### 3.2 Hard-Link Snapshots: Looks Like Full, Costs Like Incremental

Snapshots solve exactly the blind spot of mirroring: **keeping any point in time**.
The classic approach is using `--link-dest` pointing at the previous snapshot:
unchanged files are hard-linked over (no new space used),
and only changed files are truly copied -- every snapshot looks like a complete directory tree at a cost close to incremental:

```bash
# In the new snapshot directory, unchanged files hard-link to the previous snapshot; space only grows with changes
$ rsync -a --link-dest=/backup/snap/latest /data/ /backup/snap/new/
$ ln -sfn new /backup/snap/latest    # roll the "latest" pointer (illustrative)
```

Tools like Timeshift, rsnapshot, and borgbackup are essentially productized versions of the above flow:
scheduling, retention policy, and hard-link management are all done for you.
Timeshift protects only **system files** (excludes `/home` by default);
its purpose is "one-click rollback after an upgrade breaks the system", not user data backup;
use rsync/borg separately for `/home` or business directories.
Borg/restic also provide deduplication and client-side encryption, suitable for offsite and cloud destinations.

**Hard-link snapshots have a hidden pitfall**:
if a program **overwrites a file in place** (opens then writes, rather than writing a temp file then renaming),
because the inode is shared across snapshots, **the "old version" in older snapshots changes along with it**,
and the time machine instantly time-travels. Most modern package managers and database exports use "temp file + rename" and are safe,
but directly including a database data directory that is being written in place into hard-link snapshots is unreliable --
databases should use their own export/hot-backup mechanism (see section 4.2); file-level snapshots only cover configs and static data.

### 3.3 Whole-Disk Images: dd and Filesystem Snapshots

`dd` copies **block by block**, producing an image structurally identical to the source disk:

```bash
# Back up the whole disk (replace /dev/sda with the actual device from lsblk; confirm if/of are not swapped)
$ sudo dd if=/dev/sda of=/backup/sda.img bs=4M status=progress

# Restore: likewise first confirm the target disk content can be overwritten
$ sudo dd if=/backup/sda.img of=/dev/sda bs=4M status=progress

# Piped compression, saves space but is slower and cannot be randomly accessed mid-stream
$ sudo dd if=/dev/sda bs=4M status=progress | gzip > /backup/sda.img.gz
```

The advantage of an image is that restore is the most thorough -- partition table, bootloader, everything restored together,
suitable for install baselines and bare-metal migration;
the drawbacks are equally sharp: size equals the whole disk, restore must write back the entire disk,
and file-level recovery (just grabbing one file) is actually more cumbersome.
Btrfs/ZFS filesystem-level snapshots take a different route:
created in seconds with near-zero space cost, but **snapshots share the same disk as the source**,
limiting ransomware and disk-failure protection, so a copy must still be synced elsewhere --
back to 3-2-1.

The selection among the three mechanisms can be compressed into a table:

| Mechanism | Point in Time | Space Overhead | Restore Granularity | Main Risk |
|-----------|---------------|----------------|---------------------|-----------|
| rsync mirror | Latest only | ~ total data | File-level | `--delete` wipes history; same disk as source |
| Hard-link snapshot | Every snapshot | ~ change volume | File-level / whole tree | In-place writes pollute shared inodes |
| dd whole-disk image | One-shot | ~ whole disk | Whole disk | Bulky; writing to the wrong device bricks it |
| Database export | Every export | ~ data volume | Logical object | Requires import verification; long-transaction consistency |

In practice they are complementary rather than competing:
configs and site files go through rsync or snapshots,
databases go through logical export, and an install baseline keeps one image.

## 4. Tools and Three-Family Installation

### 4.1 Three-Family Installation Comparison

| Tool | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| rsync | `sudo apt install rsync` | `sudo pacman -S rsync` | `sudo dnf install rsync` |
| tar (preinstalled on most systems) | Ships with base | `sudo pacman -S tar` | Ships with the coreutils family |
| Timeshift system snapshots | `sudo apt install timeshift` (universe repo) | `sudo pacman -S timeshift` | `sudo dnf install epel-release` first, then `dnf install timeshift` |
| Borg deduplicated backups | `sudo apt install borgbackup` | `sudo pacman -S borg` | `sudo dnf install borgbackup` (often in EPEL; confirm with `dnf search borg` first) |
| rclone cloud sync | `sudo apt install rclone` | `sudo pacman -S rclone` | `sudo dnf install rclone` |
| dump/restore | `sudo apt install dump` | `sudo pacman -S dump` | `sudo dnf install dump` |
| Scheduling: cron | Installed and enabled by default | Not preinstalled: `sudo pacman -S cronie` and enable crond | cronie installed and enabled by default |

Arch users note: when the official repos lack cron,
using systemd timer directly for scheduled backups is more in line with distro convention (see section 6);
if the team prefers crontab, install `pacman -S cronie` first before discussing scheduling.
On the RHEL family, confirm EPEL is enabled before installing Timeshift or borg;
`dnf search` is the universal package-name verification step across all three families.

### 4.2 tar Archives and Logical Exports

tar is the most general-purpose archiving tool, suitable for "package it up and take it with you":

```bash
# Create a compressed archive / list / extract
$ tar -czvf /backup/etc_$(date +%F).tar.gz /etc
$ tar -tvf backup.tar.gz | head          # list contents only, no extraction
$ tar -xzvf backup.tar.gz -C /restore/

# tar's built-in snapshot incremental: the first full run writes the manifest, later runs collect only changed files
$ tar -czvf full.tar.gz --listed-incremental=/backup/snap.snar /data
$ tar -czvf incr.tar.gz --listed-incremental=/backup/snap.snar /data
```

Databases cannot be backed up by copying the data directory alone (InnoDB hot writes produce inconsistent file copies);
a logical export is mandatory, and **the export success must be written into the exit code**:

```bash
$ mysqldump -u backup -p --single-transaction --routines \
    --databases shop | gzip > /backup/db/shop_$(date +%F).sql.gz
$ echo $?        # 0 counts as success; non-0 must trigger an alert (see section 8)
```

`--single-transaction` takes a consistent snapshot on InnoDB without locking tables;
switch to `--lock-all-tables` for MyISAM or when strong consistency is needed, at the cost of paused writes.
The PostgreSQL equivalent is `pg_dump` (`-Fc` custom format supports parallel restore).

`dump/restore` is aimed at filesystem-level backup (by block + incremental level);
`dump -0` is full, `dump -1` and above are incremental, `restore -r` replays in order;
the division of labor with file-level rsync is: dump is better for "resurrect an entire partition as-is",
while day-to-day file-level protection still centers on rsync/snapshots.

### 4.3 System Baseline Checklist

Restoring a machine requires not just files but also "what it originally had installed":

```bash
# Each family's package manifest -- rebuild the system by following the list
$ dpkg --get-selections > /backup/pkgs.dpkg.list          # Debian/Ubuntu
$ pacman -Qqe     > /backup/pkgs.pacman.list              # Arch (-e for explicitly installed only)
$ rpm -qa --qf '%{NAME}\n' | sort > /backup/pkgs.rpm.list # RHEL family

$ fdisk -l    > /backup/partitions.txt                    # partition table
$ lsblk -f    > /backup/lsblk.txt                         # filesystems and UUIDs
$ ip addr     > /backup/network.txt                       # network config snapshot
```

`pacman -Qqe` is especially worth emphasizing:
Arch rolling releases have no "distro install disk version number" to rely on,
and the explicit package list is the fastest map for rebuilding the environment.
These text manifests are small in size and change frequently, making them nearly free to include in a daily backup.

## 5. Backup Plan Examples

There is no silver bullet; the two templates below are organized as "purpose -> structure",
can be trimmed after understanding, but should not be copied wholesale:

**Site/file backup** (rsync mirror + expiry cleanup):

```bash
#!/bin/bash
# backup-web.sh -- daily site backup: a file mirror + a database export
set -euo pipefail

BACKUP_DIR="/backup/websites"
DATE=$(date +%Y%m%d_%H%M%S)
KEEP_DAYS=30

mkdir -p "$BACKUP_DIR"

# File mirror: dry-run first to confirm --delete behavior, then go to production
rsync -a --delete --exclude='*.log' /var/www/ "$BACKUP_DIR/files_$DATE/"

# Database logical export: credentials read from a mode-600 defaults file, password never in the command line;
# non-0 exit code aborts via set -e, and the whole job is marked as failed
mysqldump --defaults-extra-file=/root/.my.cnf --single-transaction --databases shop \
  | gzip > "$BACKUP_DIR/db_$DATE.sql.gz"

# Retention policy: clean only history older than KEEP_DAYS
find "$BACKUP_DIR" -maxdepth 1 -name 'files_*'  -mtime +"$KEEP_DAYS" -exec rm -rf {} +
find "$BACKUP_DIR" -maxdepth 1 -name 'db_*.sql.gz' -mtime +"$KEEP_DAYS" -delete

echo "backup ok: $BACKUP_DIR ($DATE)"
```

Key design points: the mirror directory carries a timestamp (history is traceable),
`set -euo pipefail` ensures a `mysqldump` failure is no longer swallowed by the pipeline,
and cleanup touches only explicit naming patterns --
the most dangerous line in a backup script is always `rm`,
which needs a dry-run even more than `rsync` before going live.
Also, a password in the command line will be exposed in `ps` output,
so this script's `mysqldump` uses `--defaults-extra-file`
pointing to a mode-600 config file (containing a `[client]` section with user/password),
keeping the password out of the command line, and eliminating any undefined `$DB_PASS` under `set -u`.

**Config and system baseline backup** (tar + package manifest, see section 4.3 commands),
once daily, small in size, most commonly restored:
during a fire drill, `/etc` is often restored first before business data is even discussed.

## 6. Scheduling: cron and systemd timer Across the Three Families

No matter how good a script is, relying on someone remembering to run it is bound to fail.
Scheduling layer choices are not uniform across the three families:

| Dimension | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|-----------|---------------|------|-------------------|
| Default cron | `cron` package preinstalled and enabled | No cron by default; `pacman -S cronie` required | `cronie` preinstalled and enabled |
| Default timer | systemd timer available directly | Same (Arch officially recommends it) | Same |
| Common choice | Simple tasks use cron | Tends toward timer when cron is absent | Legacy scripts tend to stay on cron |

### 6.1 cron: Five Fields, Same Across All Families

```bash
$ crontab -e
# minute hour day-of-month month day-of-week  command
0 2 * * *   /usr/local/bin/backup-web.sh >> /var/log/backup.log 2>&1
0 3 * * 0   /usr/local/bin/full-backup.sh >> /var/log/backup.log 2>&1
```

cron's expressiveness is these five fields; the benefit is that syntax is identical across all three families,
with zero learning cost for legacy ops. Two things must be remembered:
**output must be redirected**, otherwise execution results (including errors) are lost to the mailbox or discarded because there is no terminal;
**`%` in crontab has special meaning** (treated as a newline),
so any percent sign in a command must be escaped or placed in single quotes.
cron's environment variables are also far leaner than a login shell,
so scripts should use absolute paths throughout and not rely on the `PATH` from an interactive environment.

### 6.2 systemd timer: Observable and Catch-Up Capable

A timer consists of a `oneshot` unit plus a `.timer` unit:

```ini
# /etc/systemd/system/backup.service
[Unit]
Description=Daily backup

[Service]
Type=oneshot
ExecStart=/usr/local/bin/backup-web.sh

# /etc/systemd/system/backup.timer
[Unit]
Description=Daily backup at 02:00

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
$ sudo systemctl daemon-reload
$ sudo systemctl enable --now backup.timer
$ systemctl list-timers backup.timer
NEXT                        LEFT    LAST                        PASSED  UNIT
Tue 2026-01-20 02:00:00 CST 6h left Mon 2026-01-19 02:00:00 CST 18h ago backup.timer
```

Three substantive advantages over cron:
**logs go into the journal** (`journalctl -u backup.service` shows the last run's outcome directly,
no need to manually wire up `>> log 2>&1`);
**`Persistent=true` will catch up on missed triggers** --
a laptop sleep or VM shutdown that misses 2am gets fired automatically after boot,
which is essential for desktops and non-24/7 servers;
**can be combined with dependencies, conditions, and resource limits** (`After=`, `ConditionPathExists=`),
so if the backup disk is not mounted the service does not start, more elegant than a manual check at the top of a script.
The cost is two more unit files and syntax that requires consulting the manual --
for one-off tasks, relative timers with `OnActiveSec=`/`OnBootSec=` are more convenient.

### 6.3 How to Choose

- **Single machine, a few rules, team used to cron**: stay with cron,
  noting output redirection and the cron package differences across families (Arch needs cronie first).
- **Need logs, catch-up, and conditional dependencies**: use systemd timer, universal across all three families.
- **Multi-machine unified scheduling**: a scheduler only solves "when", not "what changes";
  multi-machine consistency is handled by [Automation](./automation.md) with Ansible,
  and local frequency by timer -- each layer owns one segment, do not use crontab to distribute configuration.

## 7. Offsite and Cloud

Section 6 solved "run automatically"; this section solves the final 1 in 3-2-1:

```bash
# Off-site rsync (configure passwordless SSH keys first; -e specifies the transport channel)
$ rsync -avz -e ssh /backup/ user@remote:/remote/backup/

# rclone object storage (three-family install in 4.1; after configuring remotes with rclone config)
$ rclone copy /backup remote:backup-bucket --progress
$ rclone ls remote:backup-bucket | head        # periodically verify the remote manifest
```

Object storage choices (AWS S3, Alibaba Cloud OSS, etc.) each have their own vendor CLI;
this page does not duplicate their install steps -- follow the vendor docs.
The only key point: **use an independent account/independent key for the offsite bucket with least privilege**,
otherwise ransomware or accidental deletion can follow the same credentials and wipe the offsite copy along with the rest.
Buckets with versioning or object lock (WORM) enabled can additionally counter accidental deletion from `rclone sync`-style operations.

## 8. Encryption and Monitoring

### 8.1 Encrypted Backups

If offsite copies contain sensitive data, encrypt before sending:

```bash
# Encrypt after packaging (recipient public key; use --symmetric for a symmetric passphrase)
$ tar -czf - /data | gpg -e -r backup@example.com > backup.tar.gz.gpg

# Restore
$ gpg -d backup.tar.gz.gpg | tar -xzf - -C /restore/
```

**The private key/passphrase itself must have a 3-2-1 copy** --
having all backups but the key existing only on the encrypted machine is effectively all backups failing at once.
This is the most common way an encryption scheme self-destructs.

### 8.2 Backup Monitoring: Let Failures Speak for Themselves

Logs nobody reads are the same as not running. Minimum configuration has two parts:

```bash
# 1) Write a status file at the end of the job (the timestamp is the "last success time")
$ date +%s > /backup/websites/.last_ok

# 2) Separate inspection job (mounted on cron or timer): missing file or not updated for over a day both count as failure
if [ ! -f /backup/websites/.last_ok ] || \
   [ -n "$(find /backup/websites/.last_ok -mtime +1)" ]; then
    echo "STALE backup"
    exit 1
fi
echo "fresh"
```

Hook the inspection into your alert channel (email, webhook, existing monitoring system);
the criterion is **"last successful time"**, not **"is there a file on disk"**.
Alert channels depend on tools like `mail`/`bc`, which are often missing in minimal images;
confirm with `command -v` before writing the script, as with
[Commands: System Monitoring](../commands/system/monitoring.md);
once machines multiply, hand collection to Prometheus-style systems, see [Monitoring](../server/monitoring/prometheus.md).

## 9. Common Gotchas

1. **Backup and source data on the same disk**. Ransomware, an accidental `mkfs`, or lightning takes both.
   Meeting at least the "offsite" criterion of 3-2-1 is what gives real defense.
2. **`--delete` went live without a dry-run**. One character off in the source path,
   and `rsync` faithfully mirrors the mistake into the backup. Always `-n` first.
3. **Only files backed up, not the database**. Directly copying an InnoDB data directory
   produces a torn state on restore; logical export + import verification is the right answer (section 4.2).
4. **Restore has never been drilled**. Run the four steps from section 2 once per quarter,
   and write the real elapsed time into the docs -- that is your actual RTO.
5. **cron job fails silently**. No output redirection, no exit code check,
   no "last successful time" monitoring; the script has been erroring since some day and nobody knows.
6. **Encrypted backup lost its key**. Give the private key its own 3-2-1, or use a passphrase stored offline.
7. **Timeshift used as a full-machine backup**. It only manages system files by default and excludes `/home`;
   user data must be covered separately (rsync/borg) -- the two are complementary, not either/or.
8. **Offsite sync uses `sync` semantics but versioning is not enabled**.
   A local accidental deletion follows the sync and deletes the last copy;
   enable versioning on object storage, or use an "append-only" archive layout for the remote.
9. **`crontab` command does not exist on Arch**. No cron by default;
   `pacman -S cronie` and enable crond, or switch to the systemd timer from section 6.2.

## References

- rsync official documentation -- [download.samba.org](https://download.samba.org/pub/rsync/rsync.html)
- GNU tar manual -- [gnu.org](https://www.gnu.org/software/tar/manual/)
- Backblaze - The 3-2-1 Backup Strategy -- [backblaze.com](https://www.backblaze.com/blog/the-3-2-1-backup-strategy/)
- Arch Wiki - Timeshift -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Timeshift)
- Arch Wiki - Borg backup -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Borg_backup)
- Arch Wiki - Cron (cronie install and enable) -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Cron)
- systemd.timer(5) -- [man7.org](https://man7.org/linux/man-pages/man5/systemd.timer.5.html)
- rclone documentation -- [rclone.org](https://rclone.org/docs/)
- Red Hat - System Backup and Recovery (System Administrator's Guide, RHEL 7 edition; ReaR/backup concepts still apply) -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/7/html/system_administrators_guide/part-system_backup_and_recovery)
- Bird's Private Recipes (Lin's Linux Administration Guide) - Server Volume (includes backup-related units) -- [linux.vbird.org](https://linux.vbird.org/linux_server/)
- `man rsync`, `man tar`, `man crontab`, `man dump`, `man restore`

<!-- BACKLINKS-AUTO -->
## Related Pages

- [knowledge](/knowledge.md)
- [application-scenarios](/research/application-scenarios.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [README](README.md)
- [automation](automation.md)
- [lvm](lvm.md)
- [performance](performance.md)
