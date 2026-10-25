# LVM Logical Volume Management

Formatting a filesystem on a raw partition pins the capacity at the moment you run `mkfs`: the root partition got 50 GB, and a few months later it is full, so you choose between "downtime, repartition, and move the data block by block" and "migrate the service away". LVM (Logical Volume Manager) solves exactly this: it inserts a mapping layer between the physical disks and the filesystem so that capacity, snapshots, and migration become operations you can adjust at any time. A logical volume can grow online without being unmounted, a snapshot can freeze a consistent view during a backup, and multiple disks can be assembled into one volume group and sliced as needed. The cost is one more device-mapper layer, one more set of commands to learn, and gotchas that only LVM has -- such as forgetting to grow the filesystem after growing the volume.

> Content draws on the LVM project documentation and the man pages (lvm(8), pvcreate, vgcreate, lvcreate, and others); see the references at the end.

## What This Page Covers

- The boundary of each of the three PV / VG / LV abstractions, and why PE decides the final volume size
- Read `pvs`, `vgs`, `lvs`, and `lsblk` output, tracing a logical volume all the way down to the physical disk
- Complete the "PV -> VG -> LV -> mkfs -> mount" volume-creation loop on your own, and write fstab correctly
- Tell apart the online-grow commands for ext4 and XFS, and the extra step that follows: growing the filesystem after the logical volume
- Use an LVM snapshot as a pre-freeze step before a backup
- Swap disks online with `pvmove` / `vgreduce`

## 1. The Three-Layer Model and PE

### 1.1 PV / VG / LV

LVM abstracts storage into three layers; top-down is the easier order to explain:

- **PV (Physical Volume)**: a block device that `pvcreate` has stamped with LVM metadata. It can be a whole disk, a partition (conventionally a GPT partition of type `8e00`), or an md RAID array or a dm-crypt encrypted device -- this layer does not care what sits underneath.
- **VG (Volume Group)**: `vgcreate` pools one or more PVs into a resource pool. Capacity accounting and free-space queries happen at this layer; the output of `vgs` is the volume-group ledger.
- **LV (Logical Volume)**: a usable volume cut out of a VG by `lvcreate`; after you format and mount it, it is used exactly like an ordinary partition such as `/dev/sda1`.

A single machine can have multiple VGs, a VG can contain multiple LVs, and an LV's physical landing can span multiple PVs. This mapping is recorded in LVM metadata on disk (one copy at the head of each PV, plaintext by default), so the kernel can assemble the device nodes under `/dev/mapper/` automatically at boot.

### 1.2 PE: The Smallest Allocation Unit

LVM does not allocate by byte; it moves space in units of **PE (Physical Extent)**, whose size is fixed by `vgcreate -s` (default 4 MiB). The blocks of an LV are mapped onto a set of PEs, and that fact has two practical consequences:

- **A volume's size is a whole multiple of PEs**. You ask for `lvcreate -L 10G` and LVM rounds up to the PE count you requested; the result may be slightly smaller or larger than 10G. You can check the difference yourself with `vgs -o vg_name,vg_extent_size` and `lvs -o lv_name,size,current_le`.
- **PE is the transport unit for pvmove, snapshots, and mirrors**. Understanding PE is closer to LVM's essence than understanding the partition table: an LV is not a contiguous address range but a "logical block -> physical PE" mapping table.

### 1.3 Reading the Three Outputs

`pvs` / `vgs` / `lvs` are the three most-used query commands, one per layer. Here is the output from a typical server:

```bash
$ sudo pvs                  # each PV: which VG, total size, used, free
  PV         VG  Fmt  Attr PSize   PFree
  /dev/sda3  vg0 lvm2 a--  462.80g 512.00m
  /dev/sdb1  vg0 lvm2 a--  931.00g 931.00g

$ sudo vgs                  # each VG: PV count, LV count, total and free space
  VG  #PV #LV #SN Attr   VSize    VFree
  vg0   2   3   0 wz--n-   1.36t   931.51g

$ sudo lvs -a -o name,vg_name,lv_size,devices   # each LV: which PVs it lands on
  LV     VG  LSize  Devices
  lvroot vg0 50.00g /dev/sda3(0)
  lvhome vg0 412.00g /dev/sda3(12800)
```

The key reading: `vgs`'s `VFree` is **the space that can still be cut into a new LV or added to an existing one** -- you must check this line before any grow; it decides whether `lvextend` alone is enough or whether you need `vgextend` first to add a disk. `pvs`'s `PFree` is the same quantity decomposed onto a single PV. `lvs -a` takes `-a` so that internal volumes (snapshots, the `_rimage` / `_rmeta` of mirrors, etc.) are listed too; you must see them during troubleshooting.

`lvs`'s `Devices` column unfolds the "logical volume -> physical disk" mapping directly, complementing `lsblk`'s multi-level tree: `lsblk` looks from the device tree (what is hanging on which disk), `lvs` looks from inside LVM (which PEs of which PVs this volume uses). Reading the same `sda3 -> vg0-lvroot -> /` structure in `lsblk` was already covered in [Hardware · Storage](../hardware/storage.md) section 3.1 -- so is the fact that device-mapper inserts virtual devices into the block layer; this page does not repeat it and only carries on with how to build the volume.

```bash
# The lsblk and lvm commands map to each other: every level of the device tree can be verified with one set of commands
$ lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS
NAME        SIZE TYPE FSTYPE MOUNTPOINTS
sda       465.8G disk
├─sda1        1G part vfat   /boot/efi
├─sda2        2G part ext4   /boot
└─sda3    462.8G part LVM2_member
  ├─vg0-lvroot 50G lvm  ext4  /
  └─vg0-lvhome 412G lvm xfs   /home
```

Device names come in three forms; recognizing them avoids many pitfalls: `/dev/vg0/lvroot` (VG/LV symlink), `/dev/mapper/vg0-lvroot` (device-mapper node), and `/dev/dm-0` (the kernel's real number). All three point to the same device, but only the first two are stable; the `dm-N` number changes with kernel probe order.

## 2. From Raw Disk to Mounted: The Volume-Creation Sequence

Below is one complete, runnable sequence, assuming the goal is to turn a newly added `/dev/sdb` into a logical volume serving `/srv/data`. Every step is followed by verifiable output; do not type the whole thing at once and look at the result afterwards.

```bash
# 1) Look at the disk, confirm you did not pick the wrong device (data on /dev/sdb will be wiped)
$ sudo lsblk /dev/sdb
NAME MAJ:MIN RM  SIZE RO TYPE MOUNTPOINTS
sdb    8:16   0  1.8T  0 disk

# 2) Make the whole disk a PV (you can also cut an 8e00-type partition first, then make the PV; see below)
$ sudo pvcreate /dev/sdb
  Physical volume "/dev/sdb" successfully created.

# 3) Create the VG; -s sets the PE size (4M here, the default)
$ sudo vgcreate -s 4M vgdata /dev/sdb
  Volume group "vgdata" successfully created.

# 4) Cut the LV: -L sizes by capacity, -l sizes by PE count (mutually exclusive, pick one)
$ sudo lvcreate -L 1T -n lvdata vgdata
  Logical volume "lvdata" created.

# 5) Format -- LVM does not do this for you; the filesystem is yours to add
$ sudo mkfs.ext4 /dev/vgdata/lvdata

# 6) Mount and write fstab (always use UUID or a stable /dev/mapper/ path in fstab)
$ sudo mkdir -p /srv/data
$ sudo mount /dev/vgdata/lvdata /srv/data
$ lsblk -f /dev/vgdata/lvdata     # get the UUID and FSTYPE
```

A few details worth fixing in place:

- **The difference between `-L` and `-l`**. `-L 1T` sizes by capacity; `-l 100%FREE` gives all of the VG's free space to this volume; `-l 50%VG` takes half the group. The `%` form is especially convenient for growing, avoiding hand-calculated capacity mistakes.
- **Whole-disk PV or partition PV**. `pvcreate` on the whole disk is simplest; but if the disk might be split for different uses later, cut a partition first, set its type to `8e00` (Linux LVM, MBR) or `E6D6D379-F507-44C2-A23C-238F2A3DF928` (the GPT GUID), then make the partition a PV -- more flexible. For the partitioning tools, see [Hardware](../hardware/storage.md) section 3.2.
- **What to write in fstab**. `/dev/vg0/lvroot` will mount, but the device name goes stale after a rename; `/dev/mapper/vg0-lvroot` is more explicit, and `UUID=` is the most stable. The three iron rules are the same as for ordinary partitions: **run `mount -a` once after every line you add to verify**, and only reboot once it is clean, otherwise the next boot stalls in the emergency shell. Full fstab field semantics belong to [Fundamentals · Filesystem](../basic/filesystem.md).
- **LVM metadata is not encrypted by default**. `lsblk` can see VG/LV names and `pvs` can see PV layout -- by design; if the on-disk structure itself counts as sensitive information, consider putting the LV inside LUKS (see section 7).

## 3. Growing

Growing is the most frequent LVM operation day to day, and it is two things: **grow the logical volume first, then grow the filesystem**. The boundary is that LVM only manages block-device capacity and does not know what filesystem sits on top, so "the logical volume got bigger" and "the filesystem actually uses that space" must be done separately.

```bash
# Before growing, see how much the VG still has (is VFree enough? if not, add a disk first)
$ sudo vgs
  VG  #PV #LV #SN Attr   VSize VFree
  vg0   2   3   0 wz--n- 1.36t 100.00g

# Grow the logical volume: three ways, pick one
$ sudo lvextend -L +50G /dev/vg0/lvroot        # add 50G on top of the current size
$ sudo lvextend -L 100G /dev/vg0/lvroot        # grow to an absolute 100G (note: not add)
$ sudo lvextend -l +100%FREE /dev/vg0/lvroot   # take all of the VG's free space

# Grow the filesystem: ext4 and XFS use different commands -- the most common LVM mistake
$ sudo resize2fs /dev/vg0/lvroot          # ext4: online grow, no unmount needed
$ sudo xfs_growfs /mnt/xfsvol             # XFS: must pass the MOUNTPOINT, not the device name
```

Three easy-to-get-wrong judgments:

**`-L +50G` and `-L 50G` differ by one plus sign**. The first is an increment, the second a target value. `lvextend` never shrinks -- a target below the current size fails outright; the real risk is silent drift: the volume is 40G, you want to add 50G to reach 90G, and writing `-L 50G` gives you 50G, 40G short of the plan, and the command still succeeds. Decide "add" versus "to" before you use `-L`.

**`resize2fs` takes a device name, `xfs_growfs` takes a mount point**. This is not a misremembering, it is a design difference: XFS can only grow online (it cannot shrink online), and its grow interface is a filesystem-level operation that needs an already-mounted filesystem path. If you habitually run `xfs_growfs /dev/vg0/lvhome` on XFS it will complain that it is not a mount point; conversely, passing a mount point on ext4 also fails. For the feature comparison of the two filesystems see [Fundamentals · Filesystem Concepts](../basic/filesystem/concept.md).

**XFS does not support shrinking** -- this is a hard constraint, not a case of finding the wrong command. XFS's design makes online shrinking technically infeasible, so an XFS volume can only grow in one direction. The RHEL family defaults to XFS, so on those systems the "gave it too little, shrink it back" path does not exist at all: capacity must be sized correctly the first time, or you accept "cannot shrink, so rebuild + migrate data".

When VG space runs short, add physical resources first, then give it to the LV:

```bash
# Add a new disk to the volume group (-v prints the process, e.g. whether existing PEs must be moved)
$ sudo pvcreate /dev/sdc
$ sudo vgextend -v vg0 /dev/sdc
$ sudo vgs vg0                 # VFree goes from before-add to after-add + the size of /dev/sdc
$ sudo lvextend -l +100%FREE /dev/vg0/lvhome
$ sudo xfs_growfs /home
```

Growing an LV does not lose data and does not require an unmount (both ext4 online grow and XFS online grow are supported, as long as the VG has space), but **always `df -h` before growing to confirm the mount point, and `df -h` after to confirm the filesystem actually grew** -- the weight of this step recurs in section 9.

## 4. Shrinking

**Shrinking is high-risk and is not the inverse of growing.** Growing loses data with near-zero probability; shrinking's data-loss risk depends on whether you get the order right, whether the filesystem supports it, and whether the data really sits in that space. Conclusion up front:

> In production, when you run short on capacity, **prefer adding a disk** (`vgextend` to add a physical volume, see section 3) over shrinking another volume to free space. Only shrink when "a volume really is idle long-term and the freed space has a clear destination", and do it inside a maintenance window with a backup taken first.

If you really must shrink, for ext4 the order is **shrink the filesystem first, then shrink the logical volume**, never reversed:

```bash
# 1) Unmount the filesystem (ext4 shrinking must be offline; online-shrink kernel support is very limited)
$ sudo umount /srv/data

# 2) Filesystem self-check first; the fs must be clean before shrinking
$ sudo e2fsck -f /dev/vgdata/lvdata

# 3) Shrink the filesystem to the target size (only after this can the tail space be reclaimed)
$ sudo resize2fs /dev/vgdata/lvdata 800G

# 4) Then reclaim the logical volume (-L 800G is the target value to shrink to, not the amount removed)
$ sudo lvreduce -L 800G /dev/vgdata/lvdata

# 5) Remount and verify
$ sudo mount /dev/vgdata/lvdata /srv/data && df -h /srv/data
```

The order matters because: when `resize2fs` shrinks the filesystem it moves data toward lower addresses and turns the tail into a hole; if you `lvreduce` the logical volume shorter before the move completes, data not yet moved is chopped off. **Filesystem first, then volume** -- neither step may be reversed. Shrinking has two more preconditions: XFS does not support shrinking at all (section 3), and the target size cannot be smaller than the actual data volume -- `resize2fs` errors out and exits when you ask for less than the data usage, which is its protection mechanism; the error is correct.

For scenarios that truly cannot go offline, you can first dry-run with `lvreduce --test` to see if LVM accepts the request, but **online ext4 shrinking support is extremely unstable and must not be treated as a production capability**. After shrinking, the VG has extra space that can be given to other volumes or removed directly with `vgreduce`.

## 5. Snapshots

An LVM snapshot has **copy-on-write (COW)** semantics: at creation it references all of the source LV's PEs without copying data; afterwards, any PE written on the source has its old content moved into snapshot space first, and the new content lands on the source as usual. The snapshot itself is an ordinary mountable, read-write LV, so you can mount it elsewhere and back up that "frozen moment".

```bash
# 1) Take a 20G snapshot of the source volume (a snapshot is a separate LV; do not treat it as free)
$ sudo lvcreate -s -L 20G -n lvdata_snap /dev/vgdata/lvdata

# 2) Mount the snapshot elsewhere (note: do not mount it back onto the source mount point; fsck before mounting is safer)
$ sudo mkdir -p /mnt/snap
$ sudo mount -o ro,nouuid /dev/vgdata/lvdata_snap /mnt/snap
$ sudo tar -czf /backup/data_$(date +%F).tar.gz -C /mnt/snap .

# 3) Remove the snapshot as soon as the backup is done; otherwise the moment the source is written to the snapshot starts eating space
$ sudo umount /mnt/snap && sudo lvremove /dev/vgdata/lvdata_snap

# 4) Roll back: merge the snapshot into the source volume (the source must be unmounted or in a mergeable state)
$ sudo lvconvert --merge /dev/vgdata/lvdata_snap
```

**How much snapshot capacity**. There is no precise formula; it depends on two quantities: snapshot lifetime times the source's write rate. A source writing 100 MB/s with the snapshot kept for an hour needs up to 360 GB in the worst case; the same scenario kept only 10 minutes while running the backup at low traffic needs just 20 GB. In practice, start at 10%-20% of the source volume and pair it with monitoring (see below). Once a snapshot **fills up it is marked invalid** -- it is no longer a consistent point-in-time view, and data backed up from it may be unusable, while the source is unaffected. So a snapshot must be monitored on `lvs`'s `Data%`:

```bash
# Three key columns for snapshot usage: Data% (used), Meta% (metadata), free space
$ sudo lvs -a -o name,vg_name,size,data_percent,snap_percent
  LV           VG     LSize  Data%
  lvdata       vgdata  1.00t
  lvdata_snap  vgdata 20.00g   3.50
```

Snapshots suit "pre-backup freeze": the database-consistent-export window is very short, so take a snapshot to compress the window to seconds and then export slowly from the snapshot -- far friendlier to the business than running an hour-long `mysqldump` on the production database. **A snapshot cannot replace a backup** -- it sits in the same VG and on the same physical disks as the source, so a dead disk takes both, and ransomware can encrypt the snapshot along with the rest. For the backup-strategy lesson see [Backup and Recovery](./backup-and-recovery.md) section 1: a snapshot is only a way to move the backup window; offsite and independent copies still have to follow 3-2-1.

## 6. Online Migration and Disk Swap

`pvmove` moves data from one PV to another at PE granularity, fully online, without stopping the business. The most typical case is a **disk swap**: `/dev/sdb` reports a SMART warning (reallocated sectors are climbing; how to read them is in [Hardware](../hardware/storage.md) section 4) -- the disk has life left but will have to come out eventually, so add a new disk, move the data, then remove the old one.

```bash
# 1) Make the new disk a PV and add it to the same VG (the VG must have enough existing space for what is being moved)
$ sudo pvcreate /dev/sdd
$ sudo vgextend vgdata /dev/sdd

# 2) Move every PE on /dev/sdb onto the other PVs in the VG
$ sudo pvmove /dev/sdb
  /dev/sdb: Moved: 12.5%
  ...
  /dev/sdb: Moved: 100.0%

# 3) After the move completes, remove the now-empty PV from the VG
$ sudo vgreduce vgdata /dev/sdb

# 4) Wipe the PV metadata; after this the old disk is a raw disk
$ sudo pvremove /dev/sdb
```

`pvmove`'s key property is that **it moves at PE granularity and can be interrupted and resumed**: a Ctrl-C mid-move stops it, already-moved PEs are not rolled back, and rerunning continues where it left off; during the move, a PE read from the source is re-read on the target, so it is transparent to the upper layers. The drawback is that it cannot dodge physical bandwidth -- moving 1 TB of data is a real 1 TB of read and write, so plan the window carefully for large disks and do not run it at peak hours.

`pvmove` can also target only one LV's PEs (finer migration granularity) or take source and target PVs for point-to-point moves. Before removing a disk, be sure the target has really landed the data (`pvs` shows the old disk's `PFree` equal to its `PSize`); `vgreduce` on a PV that still has data is refused by LVM -- the refusal is correct, it means there is still something on it.

## 7. Stack Order with RAID and LUKS

LVM is one layer of block-device virtualization; encryption and redundancy can be stacked above or below it, and the two stack orders trade off differently.

**LUKS on top of LVM** (`PV -> VG -> LV -> LUKS -> fs`): each LV is encrypted separately, the finest granularity -- you can encrypt only one volume and leave the system disk unencrypted, with flexible key management. The cost is that each encrypted volume maintains its own key slots, raising management cost as disk count grows.

**mdraid below LVM** (`md -> PV -> VG -> LV -> fs`): build the RAID array first, then make the array a PV. The RAID layer owns redundancy and bad-disk rebuild, and LVM only faces one "never-fails" virtual disk. **This is the choice of most servers**, because redundancy is managed uniformly by RAID, LVM does not care how many disks sit underneath, and it does not have to sacrifice PE-allocation flexibility for mirroring. For building software RAID and choosing a level, see [Hardware · Storage](../hardware/storage.md) section 6.

The tradeoff compresses to one sentence: **if you want the fine granularity of "encrypt which volume", put LUKS on top; if you want the peace of mind of "a dead disk is not my problem", put RAID on the bottom**. The two are not mutually exclusive -- the four-layer stack `md -> PV -> VG -> LV -> LUKS -> fs` is common on servers that need full-disk encryption, at the cost that troubleshooting has to peel from the filesystem all the way down to md. The more layers there are, the more layers "mount failed" can originate in; this is the pattern already hinted at by the stack diagram in [Hardware](../hardware/storage.md) section 5.1.

## 8. Do Not Treat LVM as a Backup

This deserves a separate call-out: **no LVM mechanism constitutes data protection**. A snapshot lives on the same disk and VG as the source, so one dead disk loses everything; `pvmove` is migration, not redundancy -- source and target are on the same machine, and a data-center incident takes both; `lvremove` has no trash can, and a wrongly removed disk or wrongly shrunk volume is irreversible. LVM provides flexible capacity management; data protection still relies on RAID redundancy (section 7), monitoring (SMART, snapshot `Data%`), and the 3-2-1 strategy of [Backup and Recovery](./backup-and-recovery.md), each doing its job -- "I took a snapshot, so the data is safe" is an illusion that keeps recurring in operations; a snapshot solves the backup-window problem, not the copy-independence problem.

## 9. Common Failures

### 9.1 Insufficient VG Space

`lvextend` reporting `Insufficient free space in volume group` is the most common error. First `vgs` to check `VFree`: if only a few hundred MB remain, you are actually asking LVM to conjure space out of thin air, and it cannot. There are two ways out -- add a disk (`pvcreate` + `vgextend`, section 3) or shrink another volume first to free space (section 4, but not recommended). **Do not** try to "squeeze" space out by changing the PE size: the PE size set by `vgcreate` decides the allocation granularity of every volume in the VG and cannot be changed afterwards.

Note an easy-to-overlook symptom: `vgs` shows `VFree` has space but `lvextend` fails -- usually because the LV's stripe or mirror layout requires a whole number of PEs, or the `-L` amount after alignment exceeds the free space. Switch to `-l` to specify an exact PE count, or first check `lvs -o lv_name,stripes,stripe_size`.

### 9.2 Forgot `xfs_growfs`, the Mount Point Did Not Grow

`lvextend` succeeded, `lvs` shows the LV grew, but `df -h` shows the mount point capacity did not budge -- one of the most common LVM confusions. The reason is that **growing the LV and growing the filesystem are two things** (section 3); LVM does not know whether the upper layer is XFS or ext4. The fix is simple: run `resize2fs /dev/vg0/lvX` on ext4, `xfs_growfs /mountpoint` on XFS.

Turn this failure into a habit: **after every grow, `df -h` to verify -- if you did not verify it, it is not done**. A real chain reaction: someone grew the root partition thinking it resolved the `/` space alert, but the alert kept firing, and only on looking back did they realize they had missed the final `xfs_growfs /`.

### 9.3 LVM Names and the `/dev/mapper/` Mapping Do Not Line Up

`/dev/vg0/lvroot`, `/dev/mapper/vg0-lvroot`, and `/dev/dm-0` are three ways of writing the same device (section 1.3), but their correspondence depends on kernel and udev probe order, and the `dm-N` number can change after a reboot. Two practical symptoms:

- **fstab or a script contains `/dev/dm-2`**: after swapping a disk or changing a config, the number drifts and boot mounts the wrong device or fails to mount at all. Use `lsblk -f` to see the UUID and always write `UUID=` or a stable `/dev/mapper/` path in fstab.
- **There is a trap in mapping hyphens in VG names**. LVM uses `-` as the VG/LV separator, so when a VG name or LV name itself contains a hyphen, `/dev/mapper/` uses multiple `-` to represent it, and copying the VG-LV name verbatim into `mount` fails. In that case, `lsblk -o NAME,PATH` or `lvs -o lv_path` to get the path LVM itself believes in is most reliable.

The troubleshooting order in one sentence: `lsblk -f` to see the device and UUID, `pvs` / `vgs` / `lvs` to see LVM's internal structure, and if the two do not line up it is a metadata or udev problem. For the last-resort flow when a failed LVM assembly stalls boot, see [Boot Process and Troubleshooting](./boot-process.md).

### 9.4 Snapshot Space Fills Up and Invalidates It

As section 5 noted, when a snapshot's `Data%` hits 100% it is marked invalid (the corresponding state appears in `lvs`'s `Attr` column) and is no longer a consistent point-in-time view. The more insidious consequence: **after a snapshot invalidates, mounting it for a backup yields corrupted data, and it does not error out** -- you think you are backing up, but you are backing up a torn state.

Prevention rests on three things: give the snapshot enough capacity (start at 10%-20%, more for fast-writing sources), `lvremove` the snapshot as soon as the backup script finishes, and feed `lvs -o name,data_percent` into monitoring with an alert when it crosses a threshold. The hard-won lesson is "three months ago I set up a snapshot for a backup, forgot to delete it, the source kept writing, and when a restore was needed the snapshot had long since invalidated" -- **not giving a snapshot a lifecycle is planting a fake backup in your own garden**.

## 10. Common Gotchas

1. **Grew the LV but forgot to grow the filesystem**. After `lvextend` you must run `resize2fs` (ext4) or `xfs_growfs` (XFS), or `df` stays unchanged (section 9.2).
2. **Tried to shrink XFS**. XFS does not support shrinking; the command error is by design, not a bug. Size capacity correctly the first time (sections 3 and 4).
3. **Treated `-L 50G` as `-L +50G`**. The first is a target value, the second an increment; a typo gives you a volume smaller than expected (section 3).
4. **Wrote `/dev/dm-N` or a bare device name in fstab**. The number drifts; use `UUID=` or a stable `/dev/mapper/` path, and verify with `mount -a` after every line you change (section 9.3).
5. **Passed a mount point to `resize2fs`**. ext4 wants a device name; XFS's `xfs_growfs` wants the mount point -- do not mix the two (section 3).
6. **Created a snapshot and never deleted it, or treated it as a backup**. Continuous writes on the source fill the snapshot and invalidate it; creation and deletion must come in pairs, and a snapshot on the same disk and VG never counts as a backup (sections 8 and 9.4).
7. **Did not confirm the disk is empty before `vgreduce` removes it**. If the old disk still has PEs, `vgreduce` is refused; do not force it. For a disk swap, go through a full `pvmove` migration (section 6).
8. **Picked the PE size by feel when creating the VG**. The 4 MiB default suits most cases; very large volumes may consider 16 / 32 / 64 MiB to cut metadata overhead, but it cannot be changed afterwards (section 9.1).

## References

- lvm(8) man page -- [man7.org](https://man7.org/linux/man-pages/man8/lvm.8.html)
- Arch Wiki - LVM -- [wiki.archlinux.org](https://wiki.archlinux.org/title/LVM)
- Red Hat storage management documentation (the RHEL LVM chapter) -- [docs.redhat.com](https://docs.redhat.com/)
- Ubuntu Server documentation (LVM guide) -- [ubuntu.com/server/docs](https://ubuntu.com/server/docs)
- `man pvcreate`, `man vgcreate`, `man lvcreate` (including `-s` snapshot), `man lvextend`, `man lvreduce`, `man lvconvert` (`--merge`)
- `man resize2fs`, `man xfs_growfs`, `man pvmove`, `man vgreduce`

<!-- BACKLINKS-AUTO -->
## Related Pages

- [glossary](/glossary.md)
- [storage](/hardware/storage.md)
- [knowledge](/knowledge.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [gap-fill](/research/gap-fill.md)
- [README](README.md)
