# Storage Devices

Storage is the only layer where **irreversible data loss** can happen: a misconfigured CPU is merely slow at worst, a mis-swapped page merely stutters, but a dead disk or a wrongly written partition destroys the data itself. This page explains, from the Linux block layer's viewpoint, "what a write actually passes through", then covers the hardware differences between HDD/SSD/NVMe, the two physical-exam tools `lsblk`/`smartctl`, the stacked relationship between partitioning and mounting, and finally the correct way to run performance tests. The division of labor with [Basics · Filesystems](../basic/filesystem.md) is: **this page covers the "disk" (the block device itself); that page covers "how data on the disk is organized" (mkfs, fstab, permissions)** — the two cross-reference each other at partitioning and mounting, with no duplicated documentation.

> Content is drawn from Linux kernel documentation, the Arch Wiki, and vendor specifications; see the references at the end.

## What This Page Covers

- Where the Linux block layer sits in the I/O path
- Telling apart the hardware and protocol differences between HDD, SATA SSD, and NVMe SSD, so choosing a drive is no longer just "is it solid-state"
- Using `lsblk` to inventory the device tree and `smartctl`/`nvme` to judge drive health
- Explaining the stacked relationship of "disk → partition → filesystem → mountpoint"
- The correct use of RAID and fio/dd testing

## 1. Linux Block Layer: The Journey of One Write

### 1.1 Layers of the I/O Stack

A process calling `write()` does not mean the data reached the disk. One write passes downward through: **application → VFS (virtual filesystem) → concrete filesystem (ext4/XFS/Btrfs) → block layer (bio submission and I/O scheduling) → device driver (nvme/ahci/sd) → physical device**. Every layer can fail, and their troubleshooting entry points are completely different — filesystem-layer faults often report `EXT4-fs error` in `dmesg`, block-layer problems show up as request pile-ups (the `b` column of `vmstat`, `await` in `iostat`), and device-layer issues are found via SMART and the link (`smartctl`, SATA error counters).

| Layer | Responsibility | Typical observation entry point |
|----|------|-------------|
| VFS | uniform file access interface | `strace`, `/proc/<pid>/io` |
| Filesystem | inodes/directories/page cache | `dmesg`, `tune2fs`/`xfs_info`, [the basics pages](../basic/filesystem.md) |
| Block layer | request merging, scheduling, rate limiting | `/sys/block/*/queue/`, `iostat -x` |
| Driver | talking to the concrete controller | `lsblk`, `dmesg`, `lspci -k` |
| Device | medium and firmware | `smartctl`, `nvme smart-log` |

The block layer's I/O scheduler queues and merges requests; you can see the current choice with `cat /sys/block/sda/queue/scheduler` (common values include `mq-deadline`, `kyber`, `bfq`; NVMe often uses `none` for pass-through) — **the default varies with kernel version and device type, so trust what your machine reads out**; there is no universally "best scheduler". Check the kernel docs before switching; in daily use the default is fine for most cases. A device's in-kernel incarnation is the node under `/dev`, with numbering information in `/proc/partitions`:

```bash
$ cat /proc/partitions
major minor  #blocks  name
   8        0  500107608 sda
 253        0   52428800 dm-0        ← device-mapper device (LVM/encrypted volumes hang off this layer)
```

**device-mapper** is a virtualization layer on top of the block layer: LVM volumes, LUKS encryption, and RAID1 mirrors can all "knead" multiple physical disks into a single virtual block device (`/dev/dm-*`, `/dev/mapper/*`). Only by understanding it can you read the multi-level structure `sda3 → vg0-lvroot → /` inside `lsblk` — the hands-on side of LVM lives in [System Administration · LVM Logical Volume Management](../system-management/lvm.md); this page only requires recognizing the hierarchy.

## 2. Device Types: HDD, SATA SSD, and NVMe

### 2.1 HDD (Mechanical Disk)

An HDD seeks with a head over spinning platters, and that mechanical latency decides its character: "poor at random small I/O, acceptable at large sequential I/O":

| Parameter | Description | Typical value |
|------|------|--------|
| Spindle speed | how fast the platter spins | 5400/7200/10000/15000 RPM |
| Seek time | head movement to the target track | 3-12 ms |
| Interface | the connecting bus | SATA / SAS |
| Sequential throughput | large contiguous reads/writes | about 100-280 MB/s (limited by speed and density) |

The random I/O gap between a 7200 RPM desktop drive and a 5400 RPM surveillance drive is large; and an **SMR (shingled) drive** drops significantly during sustained writes because it must rewrite tracks — when buying surveillance/backup drives, if you see SMR and the workload is sustained writing, triple-check the firmware and model reviews.

### 2.2 NAND Types in SSDs

SSDs have no moving parts and far exceed HDDs at random workloads; lifespan and speed are set by how many bits each NAND cell stores:

| Type | Bits per cell | Lifespan | Speed | Cost | Notes |
|------|-----------|------|------|------|------|
| SLC | 1 bit | longest | fastest | most expensive | mostly enterprise cache tiers |
| MLC | 2 bits | longer | faster | pricier | now rare in consumer drives |
| TLC | 3 bits | medium | medium | medium | today's consumer mainstream |
| QLC | 4 bits | shorter | slower | lower | big capacity at low price; mind DWPD in write-heavy use |

A consumer drive's real lifespan also depends on the size of its **burst cache (SLC cache)** and its **DWPD/TBW figures** — sustained write speed after the cache fills may be only a fraction of the advertised number, which is the hardware root of "great benchmark scores on a new drive, but it slows down copying big files"; `smartctl`'s `Percentage Used`/`Data Units Written` track this over the long term (section 4).

### 2.3 NVMe: An Interface Designed for Flash

AHCI was designed for the command queues of the mechanical-disk era; NVMe goes straight over PCIe, built for flash parallelism:

| Comparison | SATA SSD | NVMe SSD |
|------|----------|----------|
| Interface/bus | SATA | PCIe |
| Protocol | AHCI | NVMe |
| Theoretical bandwidth | 600 MB/s (SATA III) | PCIe 4.0 x4 about 8 GB/s (bidirectional) |
| Queues | 1 queue, 32 commands | up to 64K queues, 64K commands each |
| Device name | `/dev/sdX` | `/dev/nvmeXnY` |

The direct meaning for ops: **device names and the whole toolchain change** — `hdparm` does not work on NVMe (a gotcha in section 3.3), SMART goes through `nvme smart-log` or smartctl's NVMe path, and `lsblk`'s `TRAN` column reads `nvme` instead of `sata`. Multiple queues also mean a different interrupt model (one interrupt per queue, see the multi-queue section of [the network page](./network.md)); NVMe I/O pressure naturally spreads across cores.

## 3. Inventorying Devices: lsblk and Companion Tools

### 3.1 lsblk: Understand the Storage Topology as One Tree

```bash
$ lsblk
NAME        MAJ:MIN RM   SIZE RO TYPE MOUNTPOINTS
sda           8:0    0 465.8G  0 disk
├─sda1        8:1    0     1G  0 part /boot/efi
├─sda2        8:2    0     2G  0 part /boot
└─sda3        8:3    0 462.8G  0 part
  ├─vg0-root 253:0   0    50G  0 lvm  /
  └─vg0-home 253:1   0  412G  0 lvm  /home
nvme0n1     259:0    0 931.5G  0 disk
└─nvme0n1p1 259:1    0   931G  0 part /srv/data

# All the key columns in one shot: filesystem, mountpoint, rotational or not, transport protocol
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS,ROTA,TRAN,SERIAL
# ROTA=1 mechanical; ROTA=0 solid state; TRAN=nvme/sata/usb
```

`lsblk` reads udev/kernel block-device relationships and naturally covers multi-level structures like LVM and md RAID — **it is the first entry point when inventorying "where the data actually lands"**, a cut above `df`: `df` only tells you which virtual device a mountpoint uses, while `lsblk` unfolds that virtual device all the way down to `sda3`/`nvme0n1`. The `-f` option adds filesystem and UUID (the `fs`, `uuid` columns); pair it with `findmnt` when debugging fstab (fstab docs in [Basics · Filesystem Concepts](../basic/filesystem/concept.md)).

### 3.2 Partition Tables and Identification Tools

```bash
sudo fdisk -l              # list partition tables of all disks (GPT/MBR shown together)
sudo parted -p /dev/sda print   # parted is more intuitive for GPT/large disks
sudo hdparm -I /dev/sda | head -20   # SATA identification (model, serial, features)
sudo hdparm -Tt /dev/sda             # -T cached throughput / -t device throughput

# NVMe-specific tool (package name identical on all three families: nvme-cli; see the README quick-reference table for installs)
nvme list                      # controllers and namespaces at a glance
nvme id-ctrl /dev/nvme0 | head -20   # controller capabilities (model, firmware, queue count)
```

The theory and selection of MBR/GPT partition tables, plus the interactive commands of `fdisk`/`gdisk`/`parted`, belong to [Basics · Filesystem Concepts](../basic/filesystem/concept.md) and [BIOS and UEFI](../basic/boot/bios_uefi.md); this page only requires remembering the hardware constraints: **MBR caps at 2 TB and 4 primary partitions, while GPT targets UEFI and large disks** — a disk over 2 TB must be GPT, and GPT in turn requires UEFI booting; both decisions are made together at install time.

### 3.3 hdparm/dd Only Know SATA

`hdparm`'s IDENTIFY command is based on the ATA specification; against an NVMe device it errors out or returns meaningless output. A bare `dd` test is disturbed by the page cache (section 7). The correct combination: SATA with `hdparm -Tt`, NVMe with the `nvme` tool plus `fio`, and `fio` for everything else.

## 4. SMART Health Monitoring

### 4.1 Why Check SMART "Before It Goes Bad"

SMART (Self-Monitoring, Analysis and Reporting Technology) is the disk's own physical-exam record: bad-sector remapping, power-on hours, temperature, remaining lifespan. By the time the system reports I/O errors the data may already be gone; **the value of inspection is in the trend** — `Reallocated_Sector_Ct` climbing from 0 into double digits, or `Percentage Used` racing toward 100%, both are early warning to replace the drive. Writing `smartctl -q error`-style checks into server monitoring is a line of defense earlier than RAID.

### 4.2 smartctl in Practice

```bash
# Install on the three families (identical package name): apt install smartmontools / pacman -S smartmontools / dnf install smartmontools
sudo smartctl -a /dev/sda          # full report (works for both SATA/NVMe, -d auto detects)
sudo smartctl -H /dev/sda          # health verdict only (common in inspections) → result: PASSED
sudo smartctl -t short /dev/sda    # self-test takes 1-2 minutes; long takes hours, run at low-traffic
sudo smartctl -l selftest /dev/sda # self-test history
sudo nvme smart-log /dev/nvme0     # NVMe native path (choose one or the other)
#   percentage_used: 3%    ← lifespan consumed
#   media_errors: 0        ← medium errors; watch if non-zero
```

Rules of interpretation: **look at the trend, not a single point** (45 °C today is fine; climbing from 35 to 55 within a week means check the airflow); `PASSED` only means "the current self-test did not fail", not that lifespan remains — replacement decisions weigh `percentage_used`, remap counts, and years in service together; external USB enclosures may not pass SMART through at all (`smartctl` reports `Unknown USB bridge`), needing `-d sat` or a UASP-capable enclosure, a bridge-chip limitation rather than a dead drive.

## 5. How Partitioning, Filesystem, and Mounting Relate

### 5.1 The Stack: Five Layers, Each With Its Own Job

For a piece of data to go from raw disk to `open()`-able, it passes through five layers, each with different tools and owners — keep this stack printed in your mind and a "mount failed" message instantly tells you which layer to look at:

```text
Physical disk /dev/sda (or nvme0n1)   ← hardware layer: this page, SMART/lsblk
  └─ partition /dev/sda1 (GPT/MBR table)  ← partition layer: fdisk/parted, broken table = whole disk lost
       └─ (optional) PV → VG → LV /dev/vg0/root  ← block virtualization layer: LVM/mdadm
            └─ filesystem ext4/XFS/Btrfs  ← filesystem layer: mkfs, see the basics pages
                 └─ mountpoint /          ← mount layer: mount/fstab, attaching the device to the tree
```

The mnemonic: **the partition decides "how the disk is sliced", the filesystem decides "how those slices are accounted", and the mounting decides "which branch of the directory tree the ledger hangs on"**. The three are independently rebuildable — while the partition table survives you can recover the partitions (`testdisk`); if fs metadata breaks you can still mount it on another system to rescue it, but each layer down multiplies the repair difficulty. Conversely, `mount: wrong fs type` is almost always a filesystem-layer problem, not a dead disk; `/dev/sda1 not found` is when you should suspect the partition layer.

### 5.2 Division of Labor with the Basics Pages

Parameter choices for `mkfs.ext4`/`mkfs.xfs`, the semantics of `mount` options, `/etc/fstab` fields and UUID syntax, and handling `target is busy` on unmount all belong to [Basics · Filesystems](../basic/filesystem.md) (including the ext4/XFS/Btrfs feature comparison and fstab hands-on in [Filesystem Concepts](../basic/filesystem/concept.md)); this page does not repeat them. Here we keep only the one-line conclusion directly tied to **hardware selection**:

| Filesystem | Fit from the hardware side | Details |
|---------|------------------|------|
| ext4 | the general default, stable on both HDD and SSD | [Basics · Filesystem Concepts](../basic/filesystem/concept.md) |
| XFS | friendly to large files/parallel I/O, the RHEL-family default | same as above |
| Btrfs | snapshots/checksums, **swapfile creation has special requirements** (see [the memory page](./memory.md) section 7.2) | same as above |
| ZFS | enterprise features, eats memory and CPU, explicit hardware requirements | official documentation |

The minimal closed loop of format and mount (defer details to the basics pages): `sudo mkfs.ext4 /dev/sdb1 && echo '/dev/sdb1 /data ext4 defaults 0 2' | sudo tee -a /etc/fstab && sudo mount -a` — every time you add an fstab line, verify once with `mount -a`; that is the iron rule against a box that will not boot.

## 6. RAID

### 6.1 Level Cheat Sheet

| Level | Min disks | Redundancy | Usable capacity | Read | Write | Use case |
|------|---------|------|---------|----|----|---------|
| RAID 0 | 2 | none | N×disk | high | high | temporary/rebuildable data |
| RAID 1 | 2 | mirror | 1×disk | high | medium | system disk |
| RAID 5 | 3 | single parity | (N-1)×disk | high | medium | general storage (high rebuild risk at large capacity) |
| RAID 6 | 4 | double parity | (N-2)×disk | high | medium | large cold data |
| RAID 10 | 4 | mirror + stripe | N/2×disk | very high | high | databases |

RAID **is not a backup**: two disks of a mirror dying, or another dying during the rebuild (the rebuild window on a large HDD stretches past ten hours), still loses the data. The rebuild risk of RAID 5/6 on 10 TB+ disks is an old story — important data always needs the double insurance of "RAID + offsite backup".

### 6.2 Software RAID (mdadm)

```bash
# Install on the three families (identical package name)
sudo apt install mdadm     # Debian/Ubuntu
sudo pacman -S mdadm       # Arch
sudo dnf install mdadm     # RHEL/CentOS/Rocky

# Create a RAID 1 (example: mirror of two disks; in production do a dry-run first to confirm the target disks)
sudo mdadm --create /dev/md0 --level=1 --raid-devices=2 /dev/sdb /dev/sdc
cat /proc/mdstat            # status and rebuild progress ([UU] and resync percentage)
sudo mdadm --detail /dev/md0

# Persist (the path differs per distro; verify against your version)
sudo mdadm --detail --scan | sudo tee -a /etc/mdadm/mdadm.conf   # common on Debian/Ubuntu
```

Hardware RAID cards have their own BIOS/CLI (MegaCLI, StorCLI, ssacli, etc.); logical drives appear as a single virtual block device and `lsblk` cannot see their internals — when you meet a device name like `PERC`/`Smart Storage`, find the matching CLI before touching anything at the Linux layer.

## 7. Performance Testing: dd and fio Done Right

### 7.1 dd: Only Good for Rough Sequential Throughput, and Only With the Page Cache Bypassed

```bash
# Write test (oflag=direct bypasses the page cache, conv=fsync flushes to disk)
sudo dd if=/dev/zero of=./testfile bs=1M count=1024 oflag=direct conv=fsync status=progress
# Read test (1M blocks keep alignment)
sudo dd if=./testfile of=/dev/null bs=1M iflag=direct status=progress
```

A `dd` run without `oflag=direct` measures **memory to memory** — a fake several GB/s result from the page cache will make you think you bought a fast disk (see the memory hierarchy in [the architecture page](./architecture.md)). `dd` also reports no IOPS and controls no queue depth; **use fio for any serious evaluation**. When done, remember to `rm ./testfile` — do not leave a 1 GB piece of junk on a production partition.

### 7.2 fio: Reproducible Benchmarks

```bash
# Install on the three families (identical package name)
sudo apt install fio       # Debian/Ubuntu
sudo pacman -S fio         # Arch
sudo dnf install fio       # RHEL/CentOS/Rocky

# 4K random-read IOPS (the core database metric); for 1M sequential writes swap rw/bs and reuse the rest
fio --name=rand_read --filename=/data/testfile --size=1G \
    --rw=randread --bs=4k --numjobs=4 --runtime=60 --time_based \
    --ioengine=libaio --direct=1
```

`--direct=1` is fio's way of "bypassing the page cache"; `--filename` must point at **the real filesystem under test** (create the file under the mountpoint of the disk you are measuring), otherwise you are still testing the root partition. A load test genuinely consumes disk lifespan and bandwidth, so confirm a window in production first; when done, compare against the vendor's advertised figures (4K random-read IOPS, sequential-write MB/s) to locate whether it is "the disk" or "the upper stack".

## 8. Three-Family Differences and Tool Comparison

| Aspect | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Default filesystem | ext4 | ext4 (installer offers Btrfs/XFS) | XFS (from RHEL 8 on; ext4 in 7 and earlier) |
| Partitioning tools | fdisk/gdisk/parted | same as left | same as left |
| LVM package | `lvm2` | `pacman -S lvm2` | `lvm2` |
| RAID package | `mdadm` | `pacman -S mdadm` | `mdadm` |
| NVMe tools | `nvme-cli` | `pacman -S nvme-cli` | `nvme-cli` |
| SMART tools | `smartmontools` | `pacman -S smartmontools` | `smartmontools` (enable EPEL if missing) |
| Benchmarks | `fio` | `pacman -S fio` | `fio` |

The block layer, `lsblk`, and `smartctl` work identically on all three families; the differences concentrate in the **default filesystem** and **extra repositories** — on RHEL, if `dnf install smartmontools` reports no match, enable EPEL first (`dnf install epel-release`) and retry; this is the one of the few places in the three-family comparison where you must touch a repository. The full tool install list is in [the hardware quick-reference table](./README.md).

## 9. Common Gotchas

1. **Reaching for `hdparm` to test NVMe.** ATA commands are meaningless to NVMe; the result is an error or a misleading reading (section 3.3) — use `hdparm -Tt` on SATA, `nvme`/`fio` on NVMe.
2. **A performance test without `direct` measures memory.** Forget to bypass the page cache in `dd`/`fio` and you get a fake several GB/s (section 7) — every conclusion must come from `oflag=direct`/`--direct=1` output.
3. **Running `dd of=testfile` on a production partition and filling up the root disk.** Size the test file deliberately and delete it after; `conv=fsync` + `status=progress` are good habits (section 7.1).
4. **Declaring a built-in SSD the moment `lsblk` shows `ROTA=0`.** USB flash drives and some memory cards also report `ROTA=0`; also read `TRAN` (usb/nvme/sata) and `SUSPENDED` and judge the medium as a whole (section 3.1).
5. **Writing unstable names like `/dev/sda3` in fstab/scripts.** With the order of disks changing, device names drift (sda↔sdb) and the machine mounts the wrong thing or nothing at boot — **always use UUID/LABEL** (view with `lsblk -f`); the fstab section of the basics pages has the full syntax.
6. **Seeing PASSED on `smartctl -H` and calling the drive healthy.** A passed self-test ≠ remaining lifespan; read `Percentage Used`, remap counts, and the temperature trend together; a USB-bridged drive may not support SMART at all (section 4.2).
7. **Running SMART on a VM/cloud disk and finding no data.** Virtual disks have no real medium statistics and `smartctl` usually reports it unsupported — that is not broken, there simply is no disk (the hypervisor layer's health belongs to the cloud provider). Run your SMART inspections on **physical machines**, or switch to the cloud provider's disk metrics API.
8. **Setting up RAID and never writing the config file.** Debian/Ubuntu's mdadm config path differs from Arch/RHEL, and a lost array configuration will not auto-assemble after reboot (section 6.2) — make sure `mdadm --scan` output lands in your distro's config file.

## References

- Arch Wiki - Partitioning — [wiki.archlinux.org](https://wiki.archlinux.org/title/Partitioning)
- Arch Wiki - File systems — [wiki.archlinux.org](https://wiki.archlinux.org/title/File_systems)
- Arch Wiki - LVM — [wiki.archlinux.org](https://wiki.archlinux.org/title/LVM)
- Arch Wiki - RAID — [wiki.archlinux.org](https://wiki.archlinux.org/title/RAID)
- Arch Wiki - S.M.A.R.T. — [wiki.archlinux.org](https://wiki.archlinux.org/title/S.M.A.R.T.)
- Arch Wiki - fio (performance testing notes) — [wiki.archlinux.org](https://wiki.archlinux.org/title/Fio)
- Linux Kernel Documentation - Block layer — [kernel.org](https://www.kernel.org/doc/html/latest/block/index.html)
- NVM Express Specification — [nvmexpress.org](https://nvmexpress.org/specifications/)
- smartmontools Documentation — [smartmontools.org](https://www.smartmontools.org/)
- Bird's Private Recipes (Lin's Linux Administration Guide) - Disk and filesystem management — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0230filesystem.php)
- Red Hat - RHEL 9 storage management — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html-single/managing_storage_devices/index)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)
- [architecture](architecture.md)
- [memory](memory.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [gap-fill](/research/gap-fill.md)
- [lvm](/system-management/lvm.md)
