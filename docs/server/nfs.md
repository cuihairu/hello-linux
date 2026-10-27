# NFS Server

NFS (Network File System) is the Unix world's native solution for shared storage: the permission model is isomorphic, and once mounted it is just a local path, with zero changes needed in applications. Its division of labor with Samba is roughly this -- Samba serves the Windows ecosystem and heterogeneous environments, while NFS serves the core Unix-to-Unix scenarios: multiple application servers sharing one web upload directory, or a compute cluster sharing data and home directories. The protocol's stateless tendency makes the cost of a server restart minimal, and the kernel-space client means mounting costs almost nothing in performance. This page is organized as "why -> three-distro install -> /etc/exports option by option -> mounting and the v4 pseudo-root -> permission mapping -> verification and troubleshooting -> common traps", with NFSv4 as the main line and v3 as a comparison; opening ports in the firewall is covered in the [Firewall](../security/firewall.md) page.

> Content draws on the Linux NFS project documentation and the Arch Wiki (conceptual framework from "Vbird's Linux Cabinet"); see the references at the end.

## What This Page Covers

- Telling apart the fundamental differences between NFSv4 and v3: the pseudo-root, ports, and the state model
- Installing on the three distros (apt / pacman / dnf), and recognizing the three different service unit names
- Reading the failure semantics and security meaning of every option in /etc/exports, with root_squash as the focus
- The path mapping that fsid=0 brings
- Using exportfs / showmount / nfsstat / journalctl for verification and troubleshooting
- Locating the high-frequency failures: mismatched UIDs, firewall, fstab hanging the boot

## 1. Why NFS

### 1.1 The Unix-to-Unix Sharing Scenarios

NFS has two classic scenarios. The first is **shared directories at the application layer**: three Nginx/PHP application nodes where uploaded images must be visible from everywhere -- put the upload directory on a storage machine and export it, mount it on all three, and the application code's `move_uploaded_file('/srv/upload/...')` does not change by a single character:

```text
app1 -+
app2 -+-- mounts server:/ --> storage machine /srv/data (fsid=0 pseudo-root)
app3 -+
App writes /srv/upload/x.png -> immediately readable on any node, no rsync/scp rotation needed
```

The second is **shared data for a compute cluster**: an HPC cluster's `/home` and datasets live on NFS, so wherever a job is scheduled the environment is there -- the experience of "changing machines is just changing seats" rests entirely on a globally consistent directory tree. What both scenarios share is "the directory tree itself is shared, not proxied through an application protocol": FTP uploads shuttle copies back and forth on the client, while with NFS mounted the file is simply at its path -- this is the value of "mounted means local path", transparency to applications; compared with the SDK rework of object storage (applications must switch to S3 API calls), NFS's migration cost is "change one line of mount config".

The boundary with [Samba](./samba.md) must be drawn first as well: Samba speaks the SMB protocol and handles NT permission bits, ACLs, and the heterogeneous details of Windows clients, which suits office networks; NFS reuses the Unix owner/group/other model directly, with no protocol-level conversion loss, and is natively supported by Linux/macOS clients. A storage machine serving both kinds of client can enable both, but when sharing the same data directories you must first think through the intersection of the two permission models -- SMB's write check and NFS's uid check are not fully equivalent, which is exactly the root of "the two sides see different file owners".

One more comparison table for selection, drawing the boundaries of three common routes -- most "which one should I use" arguments are really misaligned scenarios:

| Dimension | NFS | [Samba](./samba.md) | iSCSI |
|------|-----|---------------------|-------|
| Protocol layer | file level (kernel client) | file level (SMB) | block level |
| Client ecosystem | native on Linux/macOS | Windows/Linux/macOS | anything that can mount a block device |
| Permission model | Unix uid/gid passed straight through | NT permissions + ACL mapping | none (the block device belongs to the host) |
| Concurrent multi-machine read/write | supported (relies on application locking) | supported | not supported (unless a clustered filesystem) |
| Typical scenarios | application shared directories, cluster home dirs | office file servers, printing | databases, scenarios needing a whole disk |

The last row is the key boundary: services that manage their own storage layout, such as databases, need a block device (iSCSI/LUN); sharing a file directory across machines wants a file-level protocol (NFS/Samba); running a database on NFS means putting a service that "manages its own disk layout" on a protocol where "someone else manages the files", which is awkward for both performance and consistency -- the same goes for VM images on NFS, unless the virtualization platform explicitly supports it.

### 1.2 The Stateless Tendency and the Kernel Client

In protocol design, NFSv3 is fully stateless: the server does not record "who mounted me", and after a restart clients experience at most a few seconds of `nfs: server not responding` before reads and writes resume, with no session to rebuild. NFSv4 introduces state (open, lock), but that server-side state is reconstructable -- the client comes back at boot claiming its state with a clientid (reclaim), and the server persists nothing about "disconnected mounts". This design makes NFS server maintenance remarkably simple: a restart is just a restart, with no business consequence of "logged-in users drop off".

The client is a different technical route: the NFS mount path is implemented directly in the kernel -- `mount -t nfs` merely hands network and filesystem operations to the kernel, and from then on no read or write passes through a user-space process, so performance approaches a local disk plus network latency. This contrasts with FUSE-style user-space filesystems (and early user-space SMB implementations): the low overhead bought with kernel space is paid for by errors landing in the kernel log, with `dmesg` rather than application logs as the troubleshooting entry -- understand this and you know why section 6 looks at kernel messages first.

```text
Application process --> kernel VFS --> NFS client (kernel module) --network--> nfsd (server-side kernel threads)
   path unchanged, no user-space relay; faults surface in dmesg / journalctl -k
```

## 2. Installation (Three Distros Compared)

| Action | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Install (server) | `apt install nfs-kernel-server` | `pacman -S nfs-utils` | `dnf install nfs-utils` |
| Enable service | `systemctl enable --now nfs-kernel-server` | `systemctl enable --now nfs-server` | `systemctl enable --now nfs-server` |
| Install (client) | `apt install nfs-common` | `pacman -S nfs-utils` | `dnf install nfs-utils` |
| Config file | `/etc/exports` (same path on all three) | `/etc/exports` | `/etc/exports` |
| Export tool | `exportfs` (same name on all three) | `exportfs` | `exportfs` |
| Stats tool | `nfsstat` (same name on all three) | `nfsstat` | `nfsstat` |

The biggest difference across the families is the **server unit name**: Debian/Ubuntu's package and unit are both called `nfs-kernel-server`, while Arch and the RHEL family package it as `nfs-utils` with a unit called `nfs-server` -- package name and unit name are two independent dimensions, so align `systemctl status` on the right one before troubleshooting. Config and tooling are remarkably consistent instead: `/etc/exports`, `exportfs`, `showmount`, and `nfsstat` share names and syntax across all three, and the examples below do not repeat per family. The v4 server's main body is the in-kernel nfsd (the user-space `rpc.nfsd` is only a launcher), so the final test of "is the service up" is `exportfs -v` producing output plus the port being connectable, not the name of some daemon.

### 2.1 Debian/Ubuntu

```bash
$ sudo apt install nfs-kernel-server
$ sudo systemctl enable --now nfs-kernel-server && systemctl is-active nfs-kernel-server
active
```

Debian-family installs also pull up `rpcbind` -- as a fallback for v3 clients, which v4 does not need (see section 4). A minimal v4-only deployment can explore disabling `rpcbind`, but only after confirming no v3 clients exist; consistent with the conservative change philosophy of "do not touch what you are not sure about", get the default dependencies working first and subtract on demand afterward.

### 2.2 Arch

```bash
$ sudo pacman -S nfs-utils
$ sudo systemctl enable --now nfs-server && systemctl is-active nfs-server
active
```

Arch's `nfs-utils` contains both server and client tools (`nfsstat` and `showmount` included), one package covering both ends. The old unit name `nfs-utils.service` has been renamed; the current one is `nfs-server.service` -- typing `systemctl status nfs-utils` after old documentation yields "unit not found"; just use the new name. The Arch Wiki's NFS page is the upstream reference for this page's configuration details.

### 2.3 RHEL/CentOS/Rocky

```bash
$ sudo dnf install nfs-utils
$ sudo systemctl enable --now nfs-server && systemctl is-active nfs-server
active
$ sudo firewall-cmd --permanent --add-service=nfs && sudo firewall-cmd --reload
success
```

On the RHEL family the default posture requires two extra thoughts: first, firewalld has a ready-made `nfs` service object (port 2049), with opening covered in the [Firewall](../security/firewall.md) page; second, the default SELinux policy constrains nfsd's export behavior -- `getsebool nfs_export_all_rw` shows whether read-write exports are currently allowed (read-only exports are allowed by default), and if your business needs a read-write share and permissions look wrong after changing the directory, this is the first switch to look at. Same logic as Debian's "get the default dependencies working first": a distro's default security posture is deliberately tightened; open what you need and leave a trace, rather than disabling the whole policy.

## 3. Server Configuration: /etc/exports

### 3.1 Two Example Lines, Option by Option

`/etc/exports` is the export ledger, in the form "path client(options)". The two lines below are this page's runnable example -- a storage machine exporting a data root and a shared directory to the 192.168.56.0/24 segment:

```text
# /etc/exports -- NFSv4 pseudo-root + a normal export
/srv/data 192.168.56.0/24(rw,sync,no_subtree_check,fsid=0)
/srv/share 192.168.56.0/24(rw,sync,root_squash)
```

Option by option: **rw/ro** decides read-write versus read-only, the plainest option and the easiest to overlook when something "did not take effect" (after changing to rw you must re-export -- see 3.2). **sync** requires write requests to hit disk before replying to the client -- on a crash, "acknowledged" writes are not lost, at the cost of higher write latency; `async` is the opposite, the reply may precede the write to disk, and on a power loss acknowledged writes are lost, in extreme cases corrupting the filesystem. When sharing a writable directory, **stick with sync**: this performance trade was never worth it even in the mechanical disk era, let alone today when the consensus is "an untrustworthy acknowledgment hurts more than being a little slow". **root_squash** is the default and the option you must understand: when a client writes as root (uid 0), the ownership is squashed to an anonymous user (nobody by default, uid 65534), preventing a remote root from arbitrarily changing ownership on the server's filesystem -- this is NFS's most important security boundary, expanded in section 5. **no_subtree_check** disables the old logic of "validating handles after the parent of an exported directory is renamed": with it off, moving a subtree inside an export no longer requires revalidation, performance improves, and a great many spurious `ESTALE` errors disappear; modern nfs-utils disables it by default, and writing it explicitly is for readability and cross-distro consistency. **fsid=0** declares this export to be the root of the NFSv4 pseudo-filesystem -- section 4.1 covers the path mapping it brings, the easiest cognitive difference between v4 and v3 to trip over. The optional **anonuid/anongid** specify the exact uid/gid of the squashed user, for cases where "anonymous writes must land on a dedicated account"; not used in this example.

The same path can also carry **different option groups** for different segments -- one group of clients per line, with the permission boundary declared by source:

```text
# /etc/exports -- same path: writable from the internal network, read-only from the office
/srv/builds 192.168.56.0/24(rw,sync,no_subtree_check)
/srv/builds 172.16.0.0/16(ro,sync)
```

This is where the exports ledger is cheaper than "application-layer authorization": the same data presents different faces to different sources, with no need to copy the data twice and no application code changes. There is only one writing discipline -- **do not overlap segments**, so that each kind of client hits exactly one line; how overlapping matches merge is discussed specifically in man exports, but writing clean boundaries is far less work than studying the merge rules, and shares its origin with the firewall discipline of "mutually exclusive segments, single intent per rule".

### 3.2 exportfs: Loading the Ledger

Editing the ledger does not take effect by itself; `exportfs` is the only loading entry -- the same discipline as "a unit file edit requires daemon-reload":

```bash
$ sudo exportfs -rav          # re-read /etc/exports and load (-v echoes back)
exporting 192.168.56.0/24:/srv/data
exporting 192.168.56.0/24:/srv/share
$ sudo exportfs -v            # show currently loaded exports (look here first when troubleshooting)
/srv/data      192.168.56.0/24(sync,wdelay,no_root_squash,no_subtree_check,fsid=0)
/srv/share     192.168.56.0/24(sync,wdelay,root_squash,no_subtree_check)
```

`-r` is reexport (reload), `-a` is all (conventionally combined with `-r`), and `-v` echoes what changed. **You do not need to restart the `nfs-server` unit** -- `exportfs -rav` hot-updates the kernel export table directly, and a restart would only interrupt ongoing mounts. Two notes: first, the output of `exportfs -v` is "the kernel's truth at this moment" while `/etc/exports` is "your intent"; when they disagree, always reason backward from `-v` to find which step was skipped; second, syntax errors (unbalanced parentheses, a nonexistent path) are rejected outright by `exportfs -rav` with an error exit, and the ledger is never partially loaded -- read the command's exit message before touching the config.

### 3.3 Temporary Exports and Gradual Retirement

Besides editing the ledger, `exportfs` also supports **command-line temporary exports** -- not persisted, lost on restart, ideal for one-off needs like "open access for one machine for half an hour to copy a batch of data":

```bash
# Temporary export: client and options right on the command line, /etc/exports untouched
$ sudo exportfs -o rw,sync,root_squash 192.168.56.20:/srv/scratch
$ sudo exportfs -v | grep scratch
/srv/scratch  192.168.56.20(sync,rw,root_squash,wdelay)
# Withdraw as soon as done (-u takes an exact "client:path"; formal retirement after editing the ledger works the same)
$ sudo exportfs -u 192.168.56.20:/srv/scratch
```

The value of temporary exports is that **the lifetime of a permission matches the intent**: a one-off need written into `/etc/exports` and never deleted six months later turns the ledger into a spider web nobody dares touch -- the same discipline as "use a firewalld rich rule with a timeout for a temporary opening instead of a permanent hole". Conversely, a formal retirement should first stop serving with `-u`, watch for a day or two to confirm no client is still using it, and only then delete the line from the ledger -- reverse the order and you discover only after deleting that some machine's boot-time mount still points at it, an avoidable late-night debugging session.

## 4. Mounting and Using

### 4.1 The v4 Pseudo-Root and Path Mapping (This Page's Core Insight)

The mount paths of v4 and v3 are not the same semantics: **v3 mounts the export path as-is, while v4 mounts a subtree of a pseudo-filesystem in which the `fsid=0` export is itself the root of that tree**. Draw the ledger of 3.1 as a tree:

```text
v4 pseudo-root "/"  <-- fsid=0 export /srv/data (this directory on the server's disk)
|-- every subdirectory inside data... appears under the root under its own name
`-- /srv/share ... not inside the root tree; a v4 client cannot see it
```
And so the mount paths map like this -- note the offset from the export paths is the classic first trap:

```bash
# Correct: the fsid=0 export is the pseudo-root; the path carries no /srv/data prefix
$ sudo mount -t nfs -o vers=4 server:/ /mnt
$ mount | grep /mnt
server:/ on /mnt type nfs4 (rw,relatime,vers=4.2,rsize=1048576,wsize=1048576,addr=192.168.56.10)
$ ls /mnt                # what is under /mnt is the contents of the server's /srv/data
# Wrong: there is no subdirectory called data under the pseudo-root (it is the root itself), yielding
# mount.nfs4: No such file or directory
# v3 mounts the export path as-is, so both exports mount directly (a handy trick when verifying a fallback)
$ sudo mount -t nfs -o vers=3 server:/srv/share /mnt2
```

What `showmount -e` lists is the **export paths** (/srv/data, /srv/share); writing v4 mount paths straight from that list hits `No such file or directory` -- that gap between the two semantics is exactly it. v3 natively supports multi-path mounts, which is one reason many old systems insist on `vers=3` -- but v3 needs a string of extra ports opened (see section 7), so new deployments should target v4.

### 4.2 Making Multiple Directories Visible under v4: The bind Mount Pattern

To share scattered directories under v4, the standard approach is not to force every directory to be an fsid=0 export (a tree can have only one root), but to **bind mount the subtrees into the root export directory and export the whole tree as one**:

```text
# Server /etc/fstab -- mount the subtrees to share under the fsid=0 root
/srv/share  /srv/data/share  none  bind  0  0

# /etc/exports -- export only the root; the subtrees become visible through it, options tightened per sub-export line
/srv/data        192.168.56.0/24(rw,sync,no_subtree_check,fsid=0)
/srv/data/share  192.168.56.0/24(rw,sync,root_squash)
```

```bash
$ sudo mount -a && sudo exportfs -rav
# Client's view: a share subpath appears under the root; v4 semantics complete
$ sudo mount -t nfs -o vers=4 server:/ /mnt && ls /mnt
share  dataset_a  dataset_b
```

Two details of this pattern deserve a pause. First, after the bind mount `/srv/data/share` and the original `/srv/share` are two doors to the same data; a local edit at the original path shows up through the bind path on the client -- the export ledger only recognizes the bound path, so do not `ls` the original location while reading a line in `/etc/exports` when troubleshooting. Second, the sub-export line (`/srv/data/share`) can carry options different from the root -- relaxed at the root, tightened on the subtree (say `root_squash` on share while the root has `no_root_squash`), declaring the permission boundary level by level along the tree, far more refined than a single global setting. Behind a NAS's shared-folder UI is exactly this pattern; understand it and a hand-built multi-directory share lines up with how a commercial NAS behaves.

### 4.3 Persisting in fstab and Automounting

For auto-mounting at boot, write fstab, where two options are life savers in this scenario:

```text
# /etc/fstab (client) -- _netdev waits for the network; automount means boot never hangs on a mount
server:/  /mnt/data  nfs  vers=4,_netdev,x-systemd.automount  0  0
```

`_netdev` makes systemd schedule the mount after the network is ready (a boot stage without network skips it instead of waiting and timing out); `x-systemd.automount` defers the mount until "the first real access to the path" -- if the storage machine is down, boot completes normally and the error appears only at access time, rather than freezing the boot progress bar. Write `0 0` in the dump/pass fields: NFS does not participate in fsck, and writing 1/2 only produces meaningless warnings at boot check. Against the "fstab typo hangs the boot" trap of section 7, these two lines are the standard posture against that incident.

### 4.4 hard/soft and timeo

The only mount option that deserves serious thought is hard versus soft. The default is **hard**: when the server stops responding the client process **retries indefinitely**, and read/write calls suspend until it recovers -- better slow than wrong, filesystem consistency first. **soft** returns an error to the process once retries are exhausted; the good side is the application does not freeze when the storage machine dies, the bad side is that a half-written call may fail with `EIO`, and an application that does not handle it will treat the partial write as success. The tuning knobs for both are `timeo` (timeout in units of 0.1 s, so `timeo=60` is 6 seconds) and `retrans` (retries after a timeout). The conclusion is conservative: leave the default hard alone; only when there is a clear business requirement that "the application must keep running in degraded mode when the storage machine dies" should soft be considered, and then the upper application's handling of `EIO` must be verified -- the same ops philosophy as "decide what happens on failure before making it faster".

Two frequent tuning questions by the way. First, `rsize/wsize` (read/write block size): modern kernels already default to 1048576 (1 MiB), visible in the `mount` output -- do not hand-tune them down after old documentation; on 10 GbE doing so is self-harm. Second, for "NFS suddenly got slow", look at client retransmissions first: a steadily growing `retrans` count in `nfsstat -c` means requests are being lost at the network layer and resent, so the suspects are the NIC, the switch, or packet loss rather than the disk -- fix the link before talking about storage tuning; get the direction wrong and you work for nothing.

## 5. Permission Mapping: root_squash and UID Alignment

First look at what root_squash actually does -- create a file as root on the client, and the owner the server sees is not root:

```bash
$ sudo touch /mnt/hello && ls -ln /mnt/hello
-rw-r--r-- 1 65534 65534 0 Oct  2 10:15 /mnt/hello
```

uid 65534 is nobody -- the client's root was "squashed" to an anonymous account, which is where the name root_squash comes from. This is the safe default: a remote root cannot use NFS to rewrite the ownership of arbitrary files on the server. Conversely, `no_root_squash` lets a remote root pass through as root, which amounts to handing over the highest privileges on the server's filesystem -- do not enable it unless there is a closed scenario where "the client's root is the administrator". Where "anonymous writes must land on a dedicated account", use `anonuid=1500,anongid=1500` to point the squash target at a specific user; far safer than `no_root_squash`.

More common than root_squash is **mismatched UIDs on the two ends**: NFSv3's permission check is purely by numeric uid -- the server does not know the client's usernames, only numbers. If Alice is 1000 on the client but 1000 is Bob on the server, then Alice's files "look like" Bob's to the server -- `ls` owner display, subsequent chown/rm decisions, all shift, and this is exactly the mechanism behind owner drift when `rsync` syncs across machines. Two solutions: align the account plan on both ends (a shared account source, LDAP/SSSD -- the thorough fix), or check the uid of key directory owners per machine. v4 introduced idmapping, upgrading "number against number" to "name against name" -- on the precondition that both ends' `idmapd.conf` domains match:

```text
# /etc/idmapd.conf -- the Domain must be identical on both ends (client and server)
[General]
Domain = example.com

[Mapping]
Nobody-User = nobody
Nobody-Group = nogroup
```

When the domains do not match, name resolution falls back to numeric uid and the symptom is still "names do not line up"; after configuring, restart `nfs-idmapd` (Arch/RHEL) or the corresponding service in `nfs-common` (Debian), then clear the cache once with `nfsidmap -c` and verify. One line to remember: **NFS permissions are numeric -- align the uids first, then talk about permission bits**; idmapd only governs "what name it is displayed as", never "whether you can read or write" -- the permission check always travels the old numeric road.

## 6. Verification and Troubleshooting

Verify in the order "ledger -> exports -> ports -> mounts -> reads and writes", with a command for every step:

```bash
# 1. Server: is the ledger loaded (intent vs truth)
$ sudo exportfs -v
# 2. Client: is the export list visible (a tool from the v3 era; see the note below)
$ showmount -e server
Export list for server:
/srv/share 192.168.56.0/24
/srv/data  192.168.56.0/24
# 3. After mounting, actually read and write; do not trust the mount table alone
$ sudo mount -t nfs -o vers=4 server:/ /mnt && sudo touch /mnt/.probe && ls -l /mnt/.probe
# 4. Server-side stats and logs
$ nfsstat -s | head -6
Server:
calls      badcalls   badverfs   ...
12540      1          0          ...
$ journalctl -u nfs-server -e        # on Debian-family systems: -u nfs-kernel-server
# 5. One glance at the connection layer: who is mounted right now (established connections on 2049)
$ sudo ss -tn state established '( sport = :2049 )'
Recv-Q Send-Q Local Address:Port  Peer Address:Port
0      0      192.168.56.10:2049   192.168.56.21:918
0      0      192.168.56.10:2049   192.168.56.22:1022
# 6. Client kernel side: the first scene of timeouts and error codes
$ dmesg | tail -2
[ 1042.718392] nfs: server 192.168.56.10 not responding, still trying
```

A few reading notes: `showmount` and `rpcinfo -p server` are both **v3-era query tools that go through rpcbind/mountd**; on a minimal v4 deployment that only opens 2049 they may produce no output or time out -- that is not the service being broken; the server's `exportfs -v` is the authority, and if `rpcinfo` shows `100003 nfs 2049` the rpc layer is alive (it is also the fastest way to list v3 ports). A growing `badcalls` in `nfsstat -s` indicates abnormal calls (mostly permission denials or protocol version negotiation failures); align the timestamps with `journalctl -u nfs-server` to identify which client segment is colliding. On the client, `not responding` in `dmesg` points at the link or the firewall, while `Stale file handle` (ESTALE) means the handle went stale -- a file being deleted while open on the server, an export directory having been moved, or a failed state rebuild after a server restart all present as this. `permission denied` goes back to sections 3 and 5: the client's segment is not in the exports, or the permission bits/UID do not line up. Memorize the correspondence between these three error codes and the three checkpoints (ledger, segment, uid), and the troubleshooting path gets short by itself.

## 7. Common Traps

**Mount refused (access denied by server).** The symptom is `mount.nfs4: access denied by server while mounting` on the client. There are essentially two root causes: the client IP is not inside any segment in `/etc/exports` (netmask mistyped, or egressing through a NAT address), or you forgot `exportfs -rav` after editing exports. Compare the server's `exportfs -v` against the client's actual egress IP and you have it in one step.

**Reads work, writes do not.** The symptom is read-only operations fine while writes return `Read-only file system` or `Permission denied`. Check in order: is the exports line `ro` (forgetting to change it to rw is the most common); does the client process's uid have write permission on the directory; and if the writer is root while the directory is owned by root -- see section 5, root_squash is squashing your write to 65534, and a root-owned directory denies anonymous writes by default. After changing anything, remember `exportfs -rav`.

**Permissions scrambled, file owners do not match.** The symptom is `ls` showing numeric or unfamiliar owners, and owners drifting after cross-machine sync. This is the direct result of mismatched UIDs on the two ends -- per section 5, align the uids first (a unified account source is the thorough fix), or temporarily converge the anonymous mapping with `anonuid/anongid`; chowning only on the server treats the symptom, and the next sync drifts it back.

**Firewall: v4 only needs 2049, v3 needs a string of ports.** The symptom is `vers=4` mounting while `vers=3` times out, or the reverse. v4 uses only 2049 (TCP/UDP); v3 additionally needs rpcbind(111), mountd (20048 by default, dynamically negotiated when not fixed), statd, and more -- fix the mountd/statd ports and open them, or simply allow only v4. The port list and the firewalld/nftables opening methods are in the [Firewall](../security/firewall.md) page.

**umount hangs.** The symptom is `umount: target is busy` with the mount point refusing to go away. Find who is holding it first: `fuser -vm /mnt` lists the processes (commonly someone's cwd sitting in the mount point, or a process still holding a file). The order is to have people exit or kill the holding processes and then unmount normally; when the mount point must be freed immediately, `umount -l` (lazy -- detach from the directory tree and release once handles drop to zero) is the emergency measure, and long-dead NFS mounts can also be forced with `umount -f`. Lazy only moves the problem from the directory tree to the handles; the root cause (the holding process) still has to be cleared.

**A typo in fstab for NFS hangs the boot.** The symptom is the boot progress bar standing still for a long time and eventually not reaching the system. The root cause is a mount in fstab attempted and waiting before the network is ready. Fix it from a rescue environment, and once recovered add `_netdev,x-systemd.automount` (see 4.2) -- these two lines are the standard posture against recurrence; same logic as "open SSH in the firewall before enabling it", where in automated configuration "make sure I can still get in" always outranks "make the feature work".

**Clients report ESTALE after a server restart.** The symptom is the mount still present but operations on files returning `Stale file handle`. After nfsd restarts there is a time gap while handles and state are rebuilt; in most cases a client retry recovers it; persistent ESTALE means checking whether the export directory was moved or the fsid layout changed -- the physical object the handle pointed at is gone and retrying will not help. Handling: have the holder reopen the file, and if necessary umount/mount on the client to rebuild the handles; export path changes should follow the change ticket, so that "renamed a directory while old handles are still flying around" never happens.

## References

- Linux NFS project (nfs-utils and kernel NFS documentation) -- [linux-nfs.org](https://linux-nfs.org/)
- Arch Wiki: NFS -- [wiki.archlinux.org/title/NFS](https://wiki.archlinux.org/title/NFS)
- Debian Wiki: NFS -- [wiki.debian.org/NFS](https://wiki.debian.org/NFS)
- exports manual (the full set of export options) -- [man 5 exports](https://man7.org/linux/man-pages/man5/exports.5.html)
- nfs manual (client mount options, hard/soft/timeo) -- [man 5 nfs](https://man7.org/linux/man-pages/man5/nfs.5.html)
- "Vbird's Linux Cabinet" - NFS server -- [linux.vbird.org](https://linux.vbird.org/linux_server/centos6/0330nfs.php)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [coverage-matrix](/research/coverage-matrix.md)
- [selinux](/security/selinux.md)
- [README](README.md)
- [ldap](ldap.md)
- [samba](samba.md)