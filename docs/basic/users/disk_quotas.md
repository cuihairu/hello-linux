# Disk Quotas

On a multi-user server, disk is the classic "tragedy of the commons" resource: someone runs an out-of-control logging job, or `~/.cache` gets stuffed full accidentally, and the moment the `/home` partition hits 100%, every user's SSH login starts reporting `No space left on device` -- even though their own home directories still have plenty of free space. Disk quota is the hard budget built for exactly this scenario: set a usage ceiling per user (or per group) so the one runaway case hits the wall first instead of dragging everyone down. Once quotas are enabled, the system tracks each UID/GID's data blocks and inode count in real time on the write path, refusing writes and returning an error as soon as a threshold is exceeded. This page first clarifies the core concepts of soft versus hard limits (and the "grace period" -- a middle state that is easily misread), then walks through the enablement flow for ext4 and XFS separately: their initialization differs enough that copying one for the other is guaranteed to fail.

> Content drawn from the Arch Wiki, Bird's Private Recipes, and the distro `man` pages; see references at the end.

## What This Page Covers

- Explain what problem quotas solve, and the two resource types they count (blocks and inodes)
- Distinguish soft (can be temporarily exceeded) from hard (absolute ceiling) semantics
- Complete quota enablement and initialization for ext4 and XFS separately
- Use `edquota` to set, `repquota` to audit, and `edquota -p` to bulk-apply

## 1. Why Quotas Are Needed

A shared `/home` without quotas gambles the entire partition's fate on luck. Common trigger scenarios:

- One user downloads an 80 GB dataset to `~/Downloads` and the partition goes critical instantly
- A service account (say the `etl` user running batch jobs) has unrotated logs and a single account writes tens of GB
- A deploy script runs a long job with `nohup ... > ~/job.out` and nobody ever cleans up the output file

Quotas break the "whole-disk budget" down into "per-person budgets", and can alert during the warning phase (past soft but not yet hard) via mail or logs, buying the administrator time to act. Note that quotas measure **filesystem-level** usage: hard links count once (because they point to the same inode), sparse files count by actual allocated blocks. Quotas do not know "whether this file is important" -- they only see byte counts and file counts.

Another resource that is easily confused is the **inode**. The total inode count is fixed at filesystem format time, and every small file consumes one inode. Even with 100 GB of free disk, once inodes are exhausted (a typical case: a million few-KB cache files), writes fail the same way. So quotas must cap both blocks (KB) and inodes (file count).

## 2. Soft, Hard, and the Grace Period

Every line edited with `edquota` holds four numbers; get the semantics right first, or the limits you set will not behave as intended:

| Limit type | Meaning | Behavior after exceeding |
|---------|------|-------------|
| soft | Allowance for everyday use | Can be **temporarily** exceeded, but enters a grace-period countdown |
| hard | Absolute ceiling | Writes are refused directly by the kernel; cannot be exceeded |
| inodes soft | Maximum number of files creatable | Same as block soft; exceeding enters the grace period |
| inodes hard | Absolute ceiling for file count | `creat`/`open(O_CREAT)` fails once reached |

The grace period defaults to 7 days. Once usage exceeds soft but has not reached hard, the system starts the clock; you can keep writing during the grace period, and after it expires soft behaves exactly like hard -- writes start being refused until usage drops back below soft. The point of this design is to tolerate bursts: writing up to 800 MB is fine as long as you clean it up within a week and you will not be locked out. Setting soft to 0 means "no soft limit, only hard". Hard must be >= soft, otherwise `edquota` refuses to save.

```bash
$ sudo edquota -u alice
Filesystem     blocks       soft       hard     inodes     soft     hard
/dev/sda2     1048576     2097152    3145728       842        0        0
```

Table values are in filesystem blocks (typically 1 block = 1 KB). Left to right: used blocks, block soft, block hard, used file count, inode soft, inode hard. The used `blocks` figure is tracked in real time by the kernel and **does not include** cases where you manually `dd` to a block device bypassing the filesystem. Quota changes take effect immediately -- no service restart needed.

## 3. Enabling Quotas: ext4 (Debian/Ubuntu, Arch, Rocky defaults)

ext4 quotas are enabled by the kernel reading the `usrquota`/`grpquota` options at mount time. The flow has three steps: edit mount options, remount, then run `quotacheck` to build the database. **Do not reverse the order** -- `quotacheck` must scan a mount point that already has quotas enabled and create the `aquota.user`/`aquota.group` database files; running it before remounting fails outright. The three families differ only in the package install command (`apt install quota`, `pacman -S quota-tools`, `dnf install quota`); everything after that is identical:

```bash
$ sudo vim /etc/fstab
/dev/sda2  /home  ext4  defaults,usrquota,grpquota  0  2
$ sudo mount -o remount /home
$ mount | grep /home
/dev/sda2 on /home type ext4 (rw,relatime,usrquota,grpquota)
$ sudo quotacheck -cugm /home    # -c create database -u users -g groups -m skip read-only check
$ sudo quotaon /home
$ sudo systemctl enable quotaon.service   # Common across systemd distros; enables auto-start on boot
```

## 4. Enabling Quotas: XFS (mount options only, no quotacheck)

XFS is incompatible with ext4 in its implementation: it does not generate `aquota.*` files on the mount point, and instead stores quota metadata in hidden inodes inside the filesystem. So there is **no `quotacheck` step**, and initialization uses the `xfs_quota` command. Copying the section 3 steps and running `quotacheck` produces failures like `quotacheck: Cannot find filesystem to check` -- the classic result of confusing ext4 with XFS.

```bash
$ sudo vim /etc/fstab
/dev/sdb1  /data  xfs  defaults,quota,usrquota,grpquota,prjquota  0  0
$ sudo mount -o remount /data
$ sudo xfs_quota -x -c 'limit -u alice 20g 30g' /data   # soft 20g, hard 30g; syntax differs from edquota
$ sudo xfs_quota -x -c 'report -h' /data
```

Fedora/RHEL systems may have both XFS and ext4 partitions, but **only one quota toolset can be used per partition** -- confirm the filesystem type with `df -T` first, then decide whether to follow section 3 or section 4. RHEL/CentOS/Rocky commonly use XFS for root and `/home`, while Debian/Ubuntu and Arch default to ext4. This is a textbook example of "documentation that does not name the distro will bite you".

## 5. Viewing and Auditing

```bash
$ quota                       # Current logged-in user checks themselves (no root needed); -s shows GB/MB
Disk quotas for user alice (uid 1000):
$ sudo quota -u alice         # Administrator checks any user
$ sudo repquota /home         # Audit an entire mount point at once; good for cron inspection scripts
*** Report for user quotas on /dev/sda2
alice    3145728 2097152 1048576   ...
```

The `repquota` output columns are, in order, hard, soft, used; a countdown in the `grace` column (such as `6days+`) means that user is already over soft and in the grace period -- the ideal moment to send alert mail. Production setups usually run `repquota -ugs` daily via cron and diff against a threshold.

## 6. Bulk Setup and Copying

Per-user `edquota` is inefficient and error-prone. Template copying is the right posture for bulk initialization: tune quotas for one "standard user", save as a template, then copy to many with `-p` (prototype). You can also apply per group.

```bash
$ sudo edquota -u template_user
$ sudo edquota -p template_user alice bob carol dave
$ sudo edquota -g -p template_group developers
```

When someone needs a temporary unlock (say an emergency data export), raise their soft/hard temporarily, then restore the original values immediately after the operation -- do not take the shortcut of `quotaoff /home` to disable quotas for the whole filesystem, because that voids everyone's limits at once and leaves a gap in the audit log of "who exceeded the budget".

## 7. Common Traps

1. **Edited fstab but forgot to remount**. The `usrquota` option is read only at mount time; `quotacheck` fails on a mount point without quotas enabled. The order is always: edit fstab, `mount -o remount`, `quotacheck`, `quotaon`.

2. **Running the ext4 flow on XFS**. XFS has no `quotacheck`/`aquota.user`; use `xfs_quota` instead (see section 4). Conversely, using `xfs_quota` on ext4 is also ineffective.

3. **Treating soft as a "warning value" and ignoring hard**. Exceeding soft only starts the clock; hard is what actually stops the user. A rule-of-thumb ratio for shared servers is soft around 70% of hard, leaving a 7-day recovery window.

4. **Ignoring the inode limit**. A directory with only a block limit can still blow up on inodes with a million small files. For log and cache directories, also set inodes soft (say 500,000) as a double safeguard.

5. **Misusing local quotas on NFS**. NFS client quota accounting depends on the server's `usrquota` mount and `quota` service; running `quotaon` only on the client is ineffective. Shared-storage quotas must be configured on the **exporter side**.

6. **Quota records lingering after user deletion**. `userdel -r` does not automatically clean up entries in `aquota.user`. On long-running machines, periodically compare `repquota /home` against the actual user list, or use `edquota -d username` (if the distro supports it) to clear orphan entries.

## References

- Arch Wiki - Disk quota -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Disk_quota)
- Bird's Private Recipes - Disk Quotas -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0420quota.php)
- XFS Quota Management official docs -- [xfs.org](https://xfs.wiki.kernel.org/)
- Debian Handbook - Disk Quotas -- [debian.org](https://www.debian.org/doc/manuals/debian-handbook/)
- RHEL 9 - Configuring Quotas -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html-single/managing_storage_devices/index)
- `man quota`, `man repquota`, `man edquota`, `man quotacheck`, `man quotaon`, `man xfs_quota`

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/basic/README.md)
- [users](/basic/users.md)
- [coverage-matrix](/research/coverage-matrix.md)