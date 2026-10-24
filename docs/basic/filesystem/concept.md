# Filesystem Concepts

A filesystem is how an operating system manages disk data — it decides what structure data is stored in, how it is named, and how it gets looked up. But the more important fact for you as a user: on top of any concrete filesystem, Linux puts a **VFS (Virtual File System)** layer that presents ext4, XFS, Btrfs, NFS, and even "fake directories" like `/proc` as one identical interface. Understanding this abstraction is the prerequisite for understanding "why `mount` can attach a disk to any directory" and "why everything is a file."

> Content adapted from the Linux kernel documentation and the Arch Wiki; see the references at the end.

## What This Chapter Covers

- Understand the filesystem/VFS layering model
- Make an informed choice among ext4, XFS, and Btrfs based on your data's characteristics
- Be comfortable with mounting/unmounting and configuring `/etc/fstab` correctly

## 1. What a Filesystem Is

### 1.1 The Three Things It Decides

A filesystem decides how data is stored, organized, and accessed on disk: the **layout** (how the inode table, directory entries, and free blocks are arranged), the **semantics** (how permissions apply, when mtime updates, whether snapshots/compression are supported), and the **limits** (how large a single file can be, how large a partition can be). Formatting a disk is, at its core, locking in these three decisions — so choosing ext4 vs Btrfs is not a matter of taste but a matter of capability boundaries.

### 1.2 VFS: The Shared Middle Layer

```text
┌─────────────────────────────────┐
│          Applications           │   cat, ls, vim only ever see this layer
├─────────────────────────────────┤
│    VFS (Virtual File System)    │   Unified interface: open/read/write/mount
├────────┬────────┬────────┬──────┤
│  ext4  │  XFS   │ Btrfs  │ NFS  │   Concrete implementations, each with its own on-disk format
├────────┴────────┴────────┴──────┤
│          Block Device Drivers   │
├─────────────────────────────────┤
│         Disk / SSD / NVMe       │
└─────────────────────────────────┘
```

```bash
cat /proc/filesystems
#     	ext4          ← no nodev prefix = a real on-disk filesystem
#     	xfs
#     	btrfs
```

The value of VFS is **decoupling**: an application never needs to know whether a local Btrfs or a network NFS sits underneath — it calls the same `open()`/`read()` in every case. This is also why "plugging a portable drive in and mounting it under `/mnt` to use like a local directory" is possible at all — mounting is exactly the act of attaching the root of a concrete filesystem to some node in the VFS directory tree.

## 2. "Everything Is a File"

Linux abstracts nearly every resource into a file interface, and the payoff is **one set of commands that works everywhere**: `cat`, `ls`, redirection, and pipes are just as effective on devices, processes, and network state.

```bash
# "Everything is a file" side by side: devices, processes, and network are all reachable via ls/cat
ls -la /dev/sda        # block device (b prefix)
ls -la /dev/null       # the null device — data written to it is simply discarded
cat /proc/cpuinfo      # a "file" the kernel fabricates on the spot
```

`/dev`, `/proc`, and `/sys` are not "directories with data in them" — they are files the kernel fabricates in memory. They can be listed by `ls` and read by `cat` precisely because of VFS's unified interface.

## 3. Common Filesystems: How to Pick Between ext4, XFS, and Btrfs

The three major distribution families make different defaults, and that is no accident:

| Filesystem | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky | One-line verdict |
|---------|---------------|------|-------------------|-----------|
| ext4 | default root | default root | default through RHEL 7 | The stable general-purpose default; no weaknesses, no standout strengths |
| XFS | optional | optional | **default since RHEL 8** | Great big-file and high-concurrency write performance; the enterprise server favorite |
| Btrfs | optional | installer offers a subvolume layout | optional | Snapshots, transparent compression, checksums — you pay for "recoverability" |

### 3.1 ext4: The De Facto Default Answer

Mature, the longest real-world track record, and a complete `fsck` toolchain. If you have no special requirements, picking it will not go wrong:

```bash
sudo mkfs.ext4 /dev/sdb1
sudo tune2fs -l /dev/sdb1 | grep -E 'Filesystem features|Inode count'
```

The format output reports block and inode counts (e.g. 6553600 4k blocks and 1638400 inodes), and `tune2fs -l` re-checks feature flags and counters anytime.

The costs: no native snapshots; growing is easy but shrinking is extremely hard (`resize2fs` only grows); and on massive numbers of small files, its directory-entry performance falls behind XFS.

### 3.2 XFS: Big Files and High Throughput

RHEL 8 picked it as the default because of large-file writes, parallel I/O, and metadata scalability. It suits database data directories, media libraries, and log archives:

```bash
sudo mkfs.xfs /dev/sdb1
sudo xfs_info /dev/sdb1 | head -3
```

`mkfs.xfs` prints parameters such as `isize`, `agcount`, and `bsize` for the meta-data/data sections, and `xfs_info` re-checks them anytime.

Note the old XFS limitation (the historical era of a 16 TB single-file cap is over; current ceilings are extremely high) — but **no shrinking** is a hard constraint — when planning an XFS partition, "bigger is safer."

### 3.3 Btrfs: Designed for Recoverability

Copy-on-write (CoW) brings snapshots, roll-back, transparent compression, and checksums (which catch silent data corruption proactively). Btrfs is quite popular among Arch users, and Ubuntu also uses it by default in the Live session:

```bash
sudo mkfs.btrfs /dev/sdb1
# Create a snapshot (the target path must not sit inside the subvolume being snapshotted, or you nest circularly)
sudo btrfs subvolume snapshot /mnt /mnt/snapshots/my-snapshot
```

The costs: CoW has a write-amplification problem on "in-place update" workloads such as databases (you can turn it off with `nodatacow`, but you lose snapshots); fragmentation shows up more on HDDs; and backup tools need to understand the subvolume structure.

### 3.4 Capacity Limit Comparison

| Filesystem | Single-file max | Partition max | Traits | Where it fits |
|---------|-----------|---------|------|---------|
| ext4 | 16 TB | 1 EB | Stable, mature | General-purpose default |
| XFS | 8 EB | 8 EB | High performance on big files | Databases, media |
| Btrfs | 16 EB | 16 EB | Snapshots, compression, checksums | Data protection that needs roll-back |
| FAT32 | 4 GB | 8 TB | Cross-platform compatibility | ESP, USB drives |
| NTFS | 16 TB | 256 TB | Windows default | Sharing data in a dual-boot |

By the way, this explains "ESP must be FAT32" from the installation chapter: the UEFI spec only recognizes the FAT family, so even if your root partition is Btrfs, that 512 MB boot partition has no other option.

## 4. Mounting and Unmounting

### 4.1 Mounting: Attaching a Device to the Directory Tree

```bash
# Temporary mount / read-only mount (use when triaging a damaged disk or doing forensics)
sudo mount /dev/sdb1 /mnt
sudo mount -o ro /dev/sdb1 /mnt
findmnt            # the tree output is much easier to read than mount's one-line-per-entry
```

**Why the stress on "the mount point must be an existing empty directory":** mounting is essentially "overlaying" the device's root directory onto that directory. If you mount onto a directory that already has files, the existing files are temporarily hidden (not deleted; they reappear after unmounting) — mounting onto `/home` where a non-empty directory lives, or mounting the root partition onto its own subdirectory, are classic ways to lock yourself out.

### 4.2 Permanent Mounts: /etc/fstab

`mount`'s effect dies at reboot; to auto-mount at boot, write it into `/etc/fstab`:

```bash
sudo vim /etc/fstab
# UUID=8f3c1c2e-...  /data  ext4  defaults  0  2
#                                  │        └── fsck order: 0=do not check, /=root first, 2=after root
#                                  └── defaults: rw,suid,dev,exec,auto,nouser,async
```

**Always test after editing** — a broken fstab costs you a boot stuck in the emergency shell:

```bash
sudo mount -a     # re-mount every fstab entry that is not mounted; errors report bad UUID / missing mount point
echo $?           # 0 is the pass condition
```

Always use a UUID (or LABEL) instead of `/dev/sda1`: device names depend on enumeration order and can drift once you add a disk, while a UUID is bound to that partition for life.

### 4.3 Unmounting

```bash
sudo umount /mnt
# umount: /mnt: target is busy.        ← the most common error
sudo fuser -vm /mnt                    # find the process holding it (a shell cd'd inside, a tail not closed)
sudo umount -l /mnt                    # lazy unmount: the real detach happens only once holders let go
```

`-l` is fine in an emergency, but do not build a habit on it — it hides the "who is using it" question, and the process still holds a handle on a now-deleted file. A failed unmount is almost never a broken filesystem; it is **someone still having the directory open**: find the process with `fuser`, close it, then unmount — cleaner than `-l`.

## 5. Common Pitfalls

- **Rebooting without testing `mount -a`** — one mistyped UUID in fstab and you cannot get back in after reboot. Always run `sudo mount -a` after editing.
- **Writing `/dev/sdX` into fstab** — device-name drift causes the wrong disk to get mounted. Always use a UUID.
- **Believing mounted data is already on the device** — mounting only "connects"; pulling the disk before `umount` can lose data because the cache has not flushed. Run `sync` and unmount properly before pulling.
- **Placing a Btrfs snapshot target inside the subvolume** — it self-nests and the command errors out outright. The snapshot directory should live outside the subvolume, or be a sibling subvolume.
- **Running `fsck.ext4` on Btrfs** — wrong tool for the filesystem. Btrfs uses `btrfs check`/`btrfs scrub`, XFS uses `xfs_repair`, ext4 uses `fsck.ext4`; using the wrong tool is at best ineffective and at worst deepens the damage.
- **Treating a Btrfs snapshot as a backup** — the snapshot shares fate with the source disk; if the disk dies, everything is gone. Snapshots solve "fat-fingered mistakes / botched upgrades"; backups solve "the disk died." Neither substitutes for the other.
- **After an Arch upgrade, forgetting to check package-manager state** — pacman maintains a local database under `/var/lib/pacman/`; an abnormally interrupted transaction can be repaired with `pacman -Dk`/`pacman-keys --populate`, and when you suspect file damage, `pacman -Qk` checks the file integrity of installed packages.

## References

- Arch Wiki - File systems — [wiki.archlinux.org](https://wiki.archlinux.org/title/File_systems)
- Arch Wiki - Btrfs / XFS / Ext4 topic pages — [wiki.archlinux.org](https://wiki.archlinux.org/title/Btrfs)
- Linux Kernel Documentation: VFS — [kernel.org/doc](https://www.kernel.org/doc/html/latest/filesystems/)
- ext4 documentation — [kernel.org/doc](https://www.kernel.org/doc/html/latest/filesystems/ext4/)
- `man mount`, `man fstab`, `man filesystems`

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/basic/README.md)
- [filesystem](/basic/filesystem.md)
- [glossary](/glossary.md)
- [storage](/hardware/storage.md)
- [vfs-ext4](/source/vfs-ext4.md)
- [lvm](/system-management/lvm.md)
