# Filesystems

If processes are Linux's "heartbeat", the filesystem is its "memory". A mis-set permission keeps a service from starting; a wrong mount entry loses data at reboot; a directory placed in the wrong spot makes backups miss files. Most of the "spooky, unexplainable problems" in operations and development, traced to the end, land on the filesystem layer. This chapter records how data is organized from disk to directory to permissions.

> Content adapted from FHS 3.0, the Linux kernel documentation, and the Arch Wiki; see the references at the end.

## What This Chapter Covers

- Understanding what a filesystem does and the VFS abstraction layer
- Being able to make a reasoned choice among ext4, XFS, and Btrfs based on data characteristics
- Getting fluent with mount/unmount and correct `/etc/fstab` configuration
- Memorizing the division of labor among FHS top-level directories
- Handling rwx, umask, SUID/SGID/Sticky, and ACLs with confidence

## Sub-page Guide

| Section | One-line summary | Questions to bring when reading |
|---------|------------------|---------------------------------|
| [Filesystem Concepts](./filesystem/concept.md) | The VFS layering model, ext4/XFS/Btrfs feature comparison, mount and fstab in practice | "Which filesystem suits my scenario? Why does this mount fail?" |
| [Directory Hierarchy](./filesystem/hierarchy.md) | The "reason to exist" of every FHS top-level directory, plus the three families' differences around /etc, /var, /usr, and /proc | "Where should this configuration file live? Why are /var and /usr separated?" |
| [File Permissions](./filesystem/permissions.md) | umask, SUID/SGID/Sticky in real scenarios beyond rwx, and how they connect to ACLs | "Why is umask 0022? When does chmod 4755 work, and when is it a trap?" |

## Filesystem Differences: The Three Families at a Glance

On the surface the three families' directory structures follow the same FHS standard; in practice the differences concentrate in **default format choice** and **the package manager's data layout**:

| Dimension | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|-----------|---------------|------|-------------------|
| Default root filesystem | ext4 | ext4 (archinstall also offers Btrfs/XFS) | XFS (default since RHEL 8; ext4 in 7 and earlier) |
| Btrfs adoption | Optional, not the default | Popular in the community; the installer ships a subvolume scheme | Optional; the OpenSUSE lineage favors it more |
| Package database | `/var/lib/dpkg/` | `/var/lib/pacman/` | `/var/lib/rpm/` |
| Package cache | `/var/cache/apt/archives/` | `/var/cache/pacman/pkg/` | `/var/cache/dnf/` |
| Package config handling | `.dpkg-dist` backups | `.pacnew` / `.pacsave` | `.rpmnew` / `.rpmsave` |
| Primary log file | `/var/log/syslog` | `/var/log/messages` (journald also works) | `/var/log/messages` |
| Network configuration directory | `/etc/netplan/` | `/etc/systemd/network/` or NetworkManager | `/etc/sysconfig/network-scripts/` (managed by NetworkManager since RHEL 9) |
| Merged /usr | Yes (`/bin` → `usr/bin` symlink) | Yes (usr-merge completed in 2023) | Yes (since RHEL 9) |

Note the last row: all three families have completed **usr-merge** in recent years (folding `/bin`, `/sbin`, and `/lib` into `/usr` while keeping the symlinks), so running `ls -ld /bin` on a freshly installed system most likely shows `lrwxrwxrwx ... /bin -> usr/bin`. This is not a misconfiguration — it enables the deployment model of "the whole `/usr` read-only, upgraded atomically". That detail unfolds in the hierarchy section.

## Quick Diagnostic Command Reference

Filesystem-related problems (disk full, mount failure, permission denied) follow a fixed troubleshooting path: **capacity first, then mounts, then permissions**. Burn the command set below into muscle memory and over ninety percent of "spooky problems" narrow down within two minutes:

```bash
# 1. Capacity: who filled the disk
df -hT                  # mount-point view; -T shows the filesystem type
df -i                   # inodes can run out too (too many small files)
du -sh /var/* 2>/dev/null | sort -rh | head   # locate the big directories

# 2. Mounts: are the device, filesystem, and options what you expect
findmnt                 # tree view of all mounts
mount | grep -E 'ro|rw' # watch for read-only mounts
lsblk -f                # block devices with filesystem types and UUIDs

# 3. Permissions and ownership: who is denying you
namei -l /path/to/file  # permissions of every path segment, to find the break
ls -ldZ /path           # -Z shows the security context (SELinux/AppArmor)
id && groups            # current user and their groups

# 4. Space held by deleted files (df and du disagree)
sudo lsof +L1           # find deleted files still held open by processes
```

A practical decision order: `df` reports full → use `du` to narrow it to a specific directory → if `du`'s result is far smaller than `df`'s, files deleted but still held by processes are the likely cause, follow the `lsof +L1` route; a `mount` failure → first `findmnt` for existing mounts and `lsblk -f` to cross-check the UUID, then review `/etc/fstab` syntax; `Permission denied` → use `namei -l` to walk from the root and find the first directory segment missing `x` or with the wrong owner, instead of guessing from the last component. Family differences only affect some commands' default output (RHEL defaults to XFS, Ubuntu to ext4); the diagnostic approach is identical.

## Common Problems Preview

Filesystems and permissions are the most pitfall-prone areas; a preview of the high-frequency problems:

1. **`Permission denied` everywhere** — nine times out of ten the permissions are not broken; the semantics of the three rwx triplets have not been fully absorbed: a directory's `x` decides whether you can enter it, `w` whether you can add or remove entries; without `x` on a directory, `w` alone still cannot write files into it.
2. **`umount: target is busy`** — a process still holds a file under that directory (typically a `cd` you never left, a tail on a log, an editor left open). Use `fuser -vm /mnt` to find the culprit rather than reflexively lazy-unmounting with `-l`.
3. **A fstab typo drops the machine into an emergency shell at boot** — writing an unstable name like `/dev/sda1` into fstab, or a slip in the mount point or options. Always use UUIDs, and validate with `sudo mount -a` before rebooting.
4. **Btrfs snapshot copy onto itself errors out** — the snapshot target cannot sit inside the subvolume being snapshotted, or it forms a loop.
5. **SUID on a script has no effect** — the kernel ignores the SUID bit on shell scripts for security reasons; only binary programs are affected.
6. **Believing `chmod -R 777` solves permission problems** — it solves the immediate moment and demolishes the security boundary; the right fix is to identify owner/group and repair with least privilege.
7. **Arch reports unmerged `.pacnew` after an upgrade** — pacman will not overwrite configuration you have modified; the leftover `.pacnew` files need a manual diff before you decide what to keep.

### Filesystem Selection Decision Table

When picking a format, do not blindly trust "newest is best"; match by the characteristics of your data:

| Scenario traits | Recommended format | Reason |
|-----------------|--------------------|--------|
| General server/desktop, stability with minimal fuss | **ext4** | Most mature ecosystem, supported by all three families, the most material available when things break |
| Large files, databases, big single-machine capacity | **XFS** | RHEL 8+ default; strong with large files and parallel I/O |
| Needs snapshots, transparent compression, flexible subvolume layouts | **Btrfs** | Snapshot, checksum, and compression are the killer features; mind RAID5/6 write-hole issues |
| UEFI boot partition | **FAT32 (ESP)** | Firmware only reads FAT; unrelated to what the root filesystem uses |
| External USB sticks plugged in and out often | **exFAT / FAT32** | Cross-platform compatibility; journal-free, unafraid of abrupt removal |

The core trade-off in one sentence: **ext4 for peace of mind, XFS for large capacity and large files, Btrfs for snapshots and compression**. Before deciding, ask "what does the data on this disk fear most" — fear of data loss picks the checksummed format, fear of performance bottlenecks picks the parallel-friendly one, fear of management complexity picks the default.

## Reading Order

The suggestion: read the concepts page first to build the layered "disk → VFS → directory → permissions" view, then the hierarchy page to understand where each kind of data should land, and finally the permissions page to close the loop. If you arrived with a concrete failure (a service returning 403, a mount that will not come up), you can jump straight to the relevant subsection — but do come back and finish the "why" parts; permission and path problems tend to arrive in pairs.

## References

- FHS 3.0 — [refspecs.linuxfoundation.org](https://refspecs.linuxfoundation.org/FHS_3.0/fhs/index.html)
- Arch Wiki - File systems — [wiki.archlinux.org](https://wiki.archlinux.org/title/File_systems)
- Arch Wiki - File permissions and attributes — [wiki.archlinux.org](https://wiki.archlinux.org/title/File_permissions_and_attributes)
- Linux Kernel Documentation: Filesystems — [kernel.org](https://www.kernel.org/doc/html/latest/filesystems/)
- Bird's Private Recipes (Lin's Linux Administration Guide) - Linux file permissions and directory configuration — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0210filepermission.php)
- Debian Reference - File system hierarchy — [debian.org](https://www.debian.org/doc/debian-reference/ch02.zh-cn.html)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)
- [README](/hardware/README.md)
- [storage](/hardware/storage.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [lvm](/system-management/lvm.md)
