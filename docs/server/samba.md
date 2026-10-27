# File Sharing Server (Samba)

Windows, macOS, and Linux machines all reading and writing the same shared drive in an office sounds plain, but at the protocol layer there is a built-in contradiction: Windows "Network Neighborhood" speaks an SMB dialect, while the Unix world's own file sharing speaks NFS. Samba is the translator standing in between -- making a Linux machine look, to a heterogeneous fleet of clients, like an ordinary Windows file server. To answer "why learn it specifically", two real scenarios suffice: a department shared drive where everyone must log in with their own account and password, with permissions down to "writable within the group, invisible outside it" -- impossible under NFS's machine-level trust model; or the company acquires a firm that is a heavy Windows user, where the migration cost far outweighs installing Samba on the Linux side. This page is organized as "why -> two ledgers and two daemons -> installation on the three distro families -> global config -> two shares (group-writable and anonymous read-only) -> SELinux -> client verification -> common traps"; the installation section compares Debian/Ubuntu (apt), Arch (pacman), and RHEL/CentOS/Rocky (dnf) -- the package name is rare in agreeing across all three, with the differences concentrated in the service unit names and how client tools are packaged; opening ports such as 445 in the host firewall is covered on the [Firewall](../security/firewall.md) page.

> Content draws on the official Samba documentation and the Arch Wiki (conceptual framework from "Vbird's Linux Cabinet"); see the references at the end.

## What This Page Covers

- Drawing the boundary between where Samba applies and where NFS applies
- Installing and starting/stopping on the three distros, and keeping the unit-name differences of the smbd/nmbd daemons straight across the families
- Reading `[global]` and share definitions, and making testparm a fixed prelude to any config change
- Building a group-writable share and an anonymous read-only share independently
- Handling SELinux contexts on the RHEL family

## 1. Why Samba

### 1.1 One Protocol, Two Worlds

SMB (Server Message Block) was born at IBM in the 1980s, later extended by Microsoft and once renamed CIFS (Common Internet File System), and has since evolved into SMB3 -- whatever the name, it has always been the Windows world's native file sharing protocol: Network Neighborhood in Explorer, mapped network drives, and authorized access in domain environments all ride on it. macOS ships with an SMB client, and Linux desktop file managers commonly build in support, so "SMB as the lingua franca, zero installation on heterogeneous clients" is its most practical payoff. **Samba** is the free implementation of this protocol on Unix: a Linux machine with Samba installed is, in Windows' eyes, a browsable, loggable, shareable file server. Its division of labor with NFS is a sentence: NFS assumes both ends are Unix-descended and works through uid/gid mapping and machine-level trust, suited to machines in the same trust domain mounting each other inside a data center (see [NFS](./nfs.md)); Samba targets heterogeneous clients, carries a username and password with every access, and can be as granular as three levels -- share, user, and group. By way of an access-control analogy: NFS is like an internal staff badge -- once issued, you can go anywhere on the floor; Samba is like visitor registration, with the front desk checking the list every time before you enter -- the former wins on efficiency, the latter on granularity, and which you pick depends on your client fleet and trust model.

| Dimension | NFS | Samba |
|------|-----|-------|
| Protocol ecosystem | Unix to Unix | Windows / macOS / Linux heterogeneous |
| Unit of authentication | machine level (mounting is authorization) | user level (per-access verification against passdb) |
| Typical scenarios | data center clusters, diskless stations, build farms | office shared drives, file relay on mixed networks |
| Permission granularity | lands on filesystem uid/gid | share-level plus user/group ACL-style filtering |

The protocol itself keeps evolving in two directions worth knowing. One is **security** -- SMB1 has been disabled by default on all sides because of its amplification in WannaCry-class worms; from SMB3 on, transport encryption (`server smb encrypt = desired`/`mandatory`) and stricter authentication negotiation are supported, so new deployments have no reason to fall back to SMB1 compatibility; when old devices force your hand, restrict it to a specific share, never globally. The other is **performance** -- SMB3 multichannel lets one share aggregate the theoretical bandwidth of several NICs at once, which pays off concretely on 10 GbE intranets for file relay. Both are mature in Samba 4.x, and their directives live at the corresponding levels of smb.conf -- the introductory main line of this page does not need them, but when evaluating "is this shared drive slow, can it leave the data center", reaching for these two names before blindly switching to adding RAM is far more purposeful.

### 1.2 Two Ledgers: passdb Is Separate from System Accounts

A design in Samba that confuses people easily: **the Samba password is not the system password**. The password a Windows client submits when connecting to a share is verified by Samba's own account database (passdb, defaulting to the tdbsam backend, at `/var/lib/samba/private/passdb.tdb`), a ledger entirely separate from the login password in `/etc/shadow`. The two ledgers share the "name" -- a Samba account must hang off a system user of the same name, because file ownership on disk ultimately has to resolve to a uid -- but the passwords can be changed independently. The benefit of this design is decoupling: the credential rotation policies for "can access the shared drive" and "can SSH into the machine" do not interfere, and a leaked shared-drive password does not drag down the server login credentials; the cost is getting used to double-ledger bookkeeping -- `passwd` changes the system ledger, `smbpasswd` changes the Samba one, and changing the wrong one is a frequent slip-up in troubleshooting. With the two ledgers understood, why `smbpasswd -a` demands that the system user exist first, and why disabling a system account also locks out share access, stop being rules to memorize and become natural corollaries.

```text
Windows / macOS / Linux desktop
   │
   ├── SMB over TCP 445 ──▶ smbd ──▶ passdb verification ──▶ Linux file permissions as final arbiter
   │
   └── NetBIOS 137/138 UDP ──▶ nmbd ──▶ Network Neighborhood browsing, name resolution
```

### 1.3 smbd and nmbd: Two Daemons

Samba's service surface is assembled from two daemons. **smbd** does the real work: authentication, file reads and writes, locking, and opportunistic lock (oplock) arbitration, listening on TCP 445 (modern SMB direct) and 139 (legacy NetBIOS session layer compatibility). **nmbd** handles NetBIOS name service and the browse list (UDP 137/138), letting the server appear in Windows' "Network" neighbors and be resolvable by NetBIOS short name. Modern clients usually go straight for `\\192.168.1.100\data` or `\\server\data` over 445 and hand name resolution to DNS/mDNS -- making nmbd look optional; but once the environment contains old Windows machines or old printers that depend on the browse list, stopping nmbd makes the server "invisible" to them. Before getting started, think about who this machine serves: with purely modern clients, nmbd need not be enabled; with legacy terminals, keep it running as a compatibility layer. This "two processes, each owning a stretch" division also explains a classic fault -- "the IP connects but the hostname does not" is usually a name resolution matter, nothing to do with smbd itself, covered in section 7. The port list collapses into the table below; open them on the firewall side from this list, with full policy design on the [Firewall](../security/firewall.md) page:

| Port | Protocol | Owner | Purpose |
|------|------|------|------|
| 445/TCP | SMB direct | smbd | main channel of modern file sharing |
| 139/TCP | NetBIOS session | smbd | compatibility with old clients |
| 137/udp, 138/udp | NetBIOS name/datagram | nmbd | name resolution and browse lists |

## 2. Installation, Start, and Stop (Three Distros Compared)

| Action | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Install (server + client) | `apt install samba smbclient` | `sudo pacman -S samba` | `dnf install samba samba-client` |
| Search | `apt search samba` | `pacman -Ss samba` | `dnf search samba` |
| Show package info | `apt show samba` | `pacman -Qi samba` | `dnf info samba` |
| List files | `dpkg -L samba` | `pacman -Ql samba` | `rpm -ql samba` |
| Upgrade | `apt upgrade samba` | `sudo pacman -Syu` | `dnf upgrade samba` |
| Remove | `apt remove samba` | `sudo pacman -R samba` | `dnf remove samba` |

The package name agrees across all three families -- `samba` -- and the real differences hide in two places. **Service unit names**: Debian/Ubuntu split the two daemons into `smbd.service` and `nmbd.service`, while Arch and the RHEL family both use `smb.service` and `nmb.service` -- package name, unit name, and config path are three independent dimensions, so line the unit up first with `systemctl status` when troubleshooting, and only then talk config. **Packaging of the client tools**: Debian's `smbclient` is a separate package, so installing only the server leaves you without the client you need for troubleshooting; Arch's samba main package includes smbclient; on the RHEL family the client tools live in `samba-client`. Installing the client alongside the server is a habit worth building -- a local smbclient is the first-hand tool for verifying "what does the server actually expose", far cheaper than trial-and-error from the Windows side.

### 2.1 Debian/Ubuntu

```bash
$ sudo apt install samba smbclient
$ sudo systemctl enable --now smbd nmbd && systemctl is-active smbd
active
$ smbclient --version
Version 4.19.x
```

A fresh Debian install gives you a usable `/etc/samba/smb.conf` with two default shares, `[homes]` (automatically share each user's home directory) and `[printers]` -- do not rush to delete them; understanding them through `testparm` is ready-made teaching material for share definition syntax. Logs land in `/var/log/samba/` by default, split per client machine name (`log.%m`), so `ls` first and pick a file during troubleshooting rather than reading through them one by one.

### 2.2 Arch

```bash
$ sudo pacman -S samba
$ sudo cp /etc/samba/smb.conf.default /etc/samba/smb.conf
$ sudo systemctl enable --now smb nmb
```

Arch's samba package deliberately does not lay down `smb.conf` directly, leaving an `smb.conf.default` sample for you to copy and rename -- both the rolling-release convention of "never overwrite the administrator's intent" and a forcing function to face the config file itself from minute one. `pacman -Ql samba | grep -E 'smbd|nmb$'` shows the unit list the package laid down; Samba and smbclient in the official repository share one package and one version, so there is no client-versus-daemon version skew.

### 2.3 RHEL/CentOS/Rocky

```bash
$ sudo dnf install samba samba-client
$ sudo systemctl enable --now smb nmb && systemctl is-active smb
active
$ firewall-cmd --permanent --add-service=samba && sudo firewall-cmd --reload
success
```

The RHEL-family unit names are `smb`/`nmb`, one letter off from Debian's, and this is the number one way to trip when copy-pasting old material across families. The `samba` service object on the firewall side opens 445/TCP and 137-138/UDP in one stroke; in an nftables/ufw environment the port list is the same, with full policy design and the three-family differences on the [Firewall](../security/firewall.md) page. The RHEL family adds a further SELinux layer: when the directory label is wrong, smbd looks "service normal, access denied", and that layer gets its own treatment in section 5 -- Debian/Arch have no such mechanism by default, so do not treat the RHEL restorecon habit as a universal step in migration scripts.

## 3. Global Configuration

### 3.1 The [global] Skeleton

```text
# /etc/samba/smb.conf -- the [global] section (same syntax on all three families)
[global]
    workgroup = WORKGROUP
    server string = File Server %h
    server role = standalone server
    security = user
    map to guest = Bad User
    log file = /var/log/samba/log.%m
    max log size = 1000
```

These eight lines each own one thing: `workgroup` must match the workgroup on the Windows side (or the domain's NetBIOS name), and the default `WORKGROUP` works out of the box in a pure workgroup environment; `server role = standalone server` declares this machine a standalone server -- not joined to a domain, not acting as a domain controller, managing its own ledger; the vast majority of small deployments stop at this role; `security = user` is Samba 4's default, meaning every connection is verified per user, and it is written out to make the config self-explanatory; `map to guest = Bad User` maps "a username that does not exist" to guest access and is the prerequisite switch for anonymous shares -- note it is a completely different value from `Bad Password`, which also lets a *wrong password* through as guest, far more aggressive security-wise, and should not be used without a clear reason. `log.%m` splits logs per client machine name, and `max log size` is in KB, rotating at that size, so 1000 means about 1 MB per file.

### 3.2 testparm: The Fixed Prelude to Any Config Change

```bash
$ testparm
Load smb config files from /etc/samba/smb.conf
Loaded services file OK.
Server role: ROLE_STANDALONE

Press enter to see a dump of your service definitions
```

`testparm` does two things: syntax checking, and printing Samba's fully effective configuration in full. The second is often underestimated -- it shows "the final shape after parameter resolution", including entries you never wrote that inherited defaults; when debugging ghost problems like "I never configured that behavior", trust testparm's output over your memory of smb.conf. This step is the same discipline as BIND's `named-checkconf` and Nginx's `nginx -t`: **verify first, then apply**, catching syntax errors before the service reloads, an order of magnitude cheaper than reading logs at 2 a.m. with the service half-dead. A passing testparm only shows "the file can be parsed", not "the service has loaded it" -- making a running smbd re-read the config is a separate action, covered in section 7.

### 3.3 smbstatus: What the Server Is Doing Right Now

```bash
$ sudo smbstatus
Samba version 4.19.x
PID     Username     Group        Machine                            Protocol   Encryption   Signing
------------------------------------------------------------------------------------------
3412    alice        smbgrp       192.168.1.50 (ipv4:192.168.1.50:51824)  SMB3_11    -            partial

Service      pid     Machine           Connected at                     Encryption   Encryption
---------------------------------------------------------------------------------------
data         3412    192.168.1.50      Thu Oct  2 20:58:02 2026 UTC    -            -

Locked files:
Pid          User         DenyMode   Access    R/W        Oplock      SharePath   Name   Time
----------------------------------------------------------------------------------------
3412         alice       DENY_NONE  0x120089  RDONLY     NONE         /srv/samba/data   report.xlsx   Thu Oct  2 21:03:11 2026
```

`smbstatus` is the server's "snapshot of now": who is connected (user, source IP, negotiated protocol version SMB3_11), which share they are on, and which files they currently hold what locks on. Three uses are available on the spot -- before changing config, check for live connections to decide between reload and waiting for a maintenance window; when a user reports "the file is in use and cannot be deleted", the Locked files section names the holder and process ID directly, far more efficient than guessing "who has this Excel open" on the client; and the Encryption/Signing columns give security inspections hard evidence at the protocol layer. Treat `smbstatus`, `testparm`, and the log files as the Samba ops trio, and daily inspection has all the information it needs.

## 4. Share Definitions and Users

### 4.1 Preparing Directories and the Group

A share does not start in smb.conf but on the filesystem: first build the physical facts of "who can write" at the system level, then let Samba do logical filtering on top:

```bash
$ sudo groupadd smbgrp
$ sudo usermod -aG smbgrp alice
$ sudo mkdir -p /srv/samba/data /srv/samba/public
$ sudo chgrp -R smbgrp /srv/samba/data
$ sudo chmod 2775 /srv/samba/data
$ sudo chmod 2755 /srv/samba/public
```

The `2` in `chmod 2775` is the setgid bit: files and subdirectories created under it automatically inherit the parent directory's group (smbgrp) rather than the creator's primary group -- this is the foundation that keeps a group-shared drive orderly in the long run. Without it, files created by alice carry her primary group as the owning group, and colleague bob cannot write even though he is in the group; after a week the shared drive fills with "only this person can write" islands. `2755` goes to the anonymous read-only directory: group readable, others readable, no one writable (except root) -- "read-only" is welded shut at the physical layer and configured once more at the Samba layer; each layer owns half, and a misconfiguration in either shows up as "behavior differs from expectation". One word on placement in passing: the share root goes under `/srv/samba/`, not under `/home` -- `/srv`'s semantics are "data of services this machine offers", and SELinux has a ready-made labeling scheme for it (section 5), while home directory sharing has its own boolean switch and `[homes]` mechanism; do not mix the two in one path, and future permission reasoning and security policy stay much cleaner.

### 4.2 Two Shares: Group-Writable and Anonymous Read-Only

```text
# /etc/samba/smb.conf -- appended share definitions
[data]
    path = /srv/samba/data
    valid users = @smbgrp
    force group = smbgrp
    create mask = 0664
    directory mask = 0775
    browseable = yes
    read only = no

[public]
    path = /srv/samba/public
    guest ok = yes
    read only = yes
    browseable = yes
```

`[data]` is the standard shape of group collaboration: in `valid users = @smbgrp` the `@` prefix means "every member of this group", and accounts outside the group cannot even see the share's entry point; `force group = smbgrp` forces every file written through this share to carry smbgrp as its group, a second layer of insurance alongside the directory's setgid; `create mask`/`directory mask` are a logical AND on permissions -- the permissions a client requests when creating a file (Windows typically asks for 0666/0777) are ANDed with the mask before landing on disk, so `0664` guarantees writable inside the group and read-only outside; `read only = no` declares the share writable (`writable = yes` is its synonym -- either is right, but keep one spelling throughout a config). `[public]` is the minimal anonymous read-only form: `guest ok = yes` allows access without credentials, `read only = yes` refuses every write at the Samba layer. Anonymous sharing has a double prerequisite: `map to guest` in `[global]` and `guest ok` in the share must both be in place; configure only half and anonymous clients get a password prompt, covered in section 7.

A file traveling from "Save As" in Windows to landing on disk passes three gates, and tightening any one of them changes the final result; draw this pipeline clearly and "why are the permissions wrong" questions have a fixed reasoning path:

```text
Windows client request (usually 0666 / 0777)
        │ AND
        ▼
Samba share mask (create mask 0664 / directory mask 0775)
        │ AND
        ▼
Physical directory permissions (parent setgid + 2775 decide the group-writable surface)
        │
        ▼
Final permissions on disk (the result of ANDing the three layers; the SELinux label then decides whether smbd may read it)
```

### 4.3 smbpasswd: Entering into Samba's Ledger

```bash
$ sudo smbpasswd -a alice
New SMB password:
Retype new SMB password:
Added user alice.
$ sudo pdbedit -L
alice:1001:Alice Chen
```

`-a` registers the **already existing** system user alice into Samba's passdb -- the precondition is often overlooked: without a system user of the same name, this step errors out; Samba never conjures accounts out of thin air, because ownership on disk needs a real uid to land on. The password typed twice is the Samba password, unrelated to alice's login password; a later `passwd alice` will not move it, and `smbpasswd alice` will not touch the system ledger. `pdbedit -L` is the directory view of that ledger: the three columns are username, uid, and full-name comment; when the question is "is this person on the books", look here first rather than grepping files. The offboarding corollary follows: `smbpasswd -x alice` retires the Samba account, or go straight for `usermod -L alice`/`userdel alice` to pull it from under at the system side -- the ledger hangs off the system user, and with the system user gone the Samba side goes void on its own.

After four sections, it helps to assemble the scattered changes back into one complete config for self-checking -- this page's `[global]` and the two shares joined into one file, effective after `testparm` passes and a reload:

```text
# /etc/samba/smb.conf -- this page's examples assembled in full
[global]
    workgroup = WORKGROUP
    server string = File Server %h
    server role = standalone server
    security = user
    map to guest = Bad User
    log file = /var/log/samba/log.%m
    max log size = 1000

[data]
    path = /srv/samba/data
    valid users = @smbgrp
    force group = smbgrp
    create mask = 0664
    directory mask = 0775
    browseable = yes
    read only = no

[public]
    path = /srv/samba/public
    guest ok = yes
    read only = yes
    browseable = yes
```

The corresponding system-side preparation likewise collapses into one copy-pasteable order (details and rationale in sections 4.1/4.3/5): create the group and directories -> register group members -> setgid and group ownership -> the Samba ledger -> labels for the RHEL family. With those five steps done, section 6's verification starts from a clean slate:

```bash
$ sudo groupadd smbgrp && sudo usermod -aG smbgrp alice
$ sudo mkdir -p /srv/samba/data /srv/samba/public
$ sudo chgrp -R smbgrp /srv/samba/data && sudo chmod 2775 /srv/samba/data && sudo chmod 2755 /srv/samba/public
$ sudo smbpasswd -a alice
$ sudo semanage fcontext -a -t samba_share_t "/srv/samba(/.*)?" && sudo restorecon -Rv /srv/samba   # RHEL/Rocky only
```

## 5. SELinux Contexts (RHEL/Rocky)

On the RHEL family smbd runs confined: even with traditional permissions all green, a wrong SELinux label on the directory means access is still refused -- and the refusal appears only in the audit log, leaving the client with a vague "cannot access". Directories you create under `/srv` carry the `var_t` label by default, and smbd is not allowed to use one as a share root:

```bash
$ ls -dZ /srv/samba/data
unconfined_u:object_r:var_t:s0 /srv/samba/data
$ sudo semanage fcontext -a -t samba_share_t "/srv/samba(/.*)?"
$ sudo restorecon -Rv /srv/samba
Relabeled /srv/samba/data from unconfined_u:object_r:var_t:s0 to unconfined_u:object_r:samba_share_t:s0
$ ls -dZ /srv/samba/data
unconfined_u:object_r:samba_share_t:s0 /srv/samba/data
```

`semanage fcontext -a` writes "what label this path pattern should carry" into the policy store, and `restorecon -Rv` relabels existing files according to that policy -- the former sets the rule, the latter executes it; a `chcon` edit only executes without setting the rule, so the next relabel reverts it, a patch that survives the night but not the month. When access is still refused after labeling, look for evidence in the audit log: `sudo ausearch -m avc -ts recent` gives the refused operation, the target label, and the rule name; in Samba-related avc records `scontext` is smbd and `tcontext` is the share directory, so a label problem is visible at a glance -- far more information than reconnecting repeatedly from the client. Two companions: sharing user home directories (`[homes]`) needs the boolean `setsebool -P samba_enable_home_dirs on`; and `semanage` may be missing on minimal installs, filled in with `dnf install policycoreutils-python-utils`. Debian/Ubuntu and Arch ship no targeted policy by default, so skip this whole section -- and this is precisely where cross-family migration scripts trip most often: the "three-step permission fix" proven on RHEL is redundant on Debian, and one step short when copied from Debian to RHEL. The full SELinux system (modes, booleans, diagnostic workflow) is on the [SELinux Concepts](../basic/security/concept.md) page.

## 6. Client Verification

### 6.1 smbclient: The curl of the SMB World

```bash
$ smbclient -L //192.168.1.100 -U alice
Password for [WORKGROUP\alice]:

        Sharename       Type      Comment
        ---------       ----      -------
        data            Disk      department shared
        public          Disk      public read-only
        IPC$            IPC       IPC Service (File Server fs-01)
SMB1 disabled -- no workgroup available
```

`-L` lists shares without entering any, giving first-hand evidence of "what does the server actually expose": share names, types, and comments at a glance, so reconcile against it first when a name fails on the Windows side -- ninety percent of `NT_STATUS_BAD_NETWORK_NAME` cases are located right here (see section 7). The last line, `SMB1 disabled -- no workgroup available`, is normal modern Samba output: with SMB1 disabled the browse list no longer travels this session, which is not a failure. Use `-N` to skip the password prompt for anonymous listing, which settles whether anonymous shares really are credential-free. Once inside a share, you are in a small FTP-style interactive environment:

```bash
$ smbclient //192.168.1.100/data -U alice
Try "help" to get a list of possible commands.
smb: \> ls
  .                                   D        0  Thu Oct  2 21:02:15 2026
  ..                                  D        0  Thu Oct  2 20:44:01 2026
  report.xlsx                         A    18432  Thu Oct  2 20:58:02 2026
smb: \> put notes.md
putting file notes.md as \notes.md (12.3 kb/s) (average 12.3 kb/s)
smb: \> get report.xlsx
getting file \report.xlsx of size 18432 as report.xlsx (35.1 kb/s) (average 35.1 kb/s)
smb: \> quit
```

`ls` shows the listing and permission bits (`D` directory, `A` archive, `N` normal), `put`/`get` go both ways, and `quit` exits. This back-and-forth is the minimal verification set proving "both read and write channels work" -- and it gets you two things over clicking open a folder in Windows: explicit error codes, and a direct result with no GUI cache in between.

### 6.2 CIFS Mounting: Turning a Share into a Local Path

```bash
$ sudo apt install cifs-utils        # same name on all three: pacman -S cifs-utils / dnf install cifs-utils
$ sudo mount -t cifs -o username=alice,uid=1000,gid=1000 //192.168.1.100/data /mnt
$ df -h /mnt | tail -1
//192.168.1.100/data   100G   32G   69G  32% /mnt
```

`cifs-utils` shares its name across all three families -- one of the few names that need no branching in cross-distro scripts. `uid=`/`gid=` map remote file ownership to a local user -- the SMB protocol reports ownership as a Windows-style SID, while the kernel mount layer needs a local answer for "whose is this", and without it everything is owned by root and even read-only access is a chore for ordinary users. Auto-mounting at boot goes through fstab, with the credentials in their own file with 600 permissions, more dignified than a plaintext password in fstab:

```text
# /etc/samba/creds (permissions must be 600, owner root)
username=alice
password=********

# appended to /etc/fstab
//192.168.1.100/data  /mnt/data  cifs  credentials=/etc/samba/creds,uid=1000,gid=1000  0  0
```

Writing fstab this way directly has an old production trap: at boot the network is not ready, and `mount -a` blocks waiting on the server -- at best slowing startup by tens of seconds, at worst timing out into emergency mode. Two fixes in order of thoroughness: `noauto,x-systemd.automount` defers the mount until the first access to the path (almost mandatory for intermittently-connected clients like laptops); or at least add `_netdev` to declare a network device so the mount is scheduled after the network. Another parameter worth writing explicitly is `vers=` -- modern clients and Samba will negotiate SMB3 on their own, but against an old NAS you must accommodate, pinning a definite version like `vers=2.1` turns "negotiation fails and it will not mount" into deterministic version behavior; in troubleshooting, try a pinned version before anything else, and it often saves a round of packet capture.

### 6.3 Windows and macOS Sides

In the Windows Explorer address bar, type `\\192.168.1.100\data` directly; in the authentication dialog, fill in alice and the **Samba password** (not her Linux login password -- the two ledgers, from section 1); on macOS, use Finder's Connect to Server (⌘K) with `smb://192.168.1.100/data`. Both sides cache credentials after the first successful connection; the strange behavior after a password change is covered under "Windows caches old credentials" in section 7.

## 7. Troubleshooting and Common Traps

**testparm passes but access is still refused.** testparm only proves the syntax is parseable, not that the path is reachable. The investigation has exactly three steps: `ls -ld /srv/samba/data` for traditional permissions (is even the others bit lacking read); on the RHEL family, next `ls -ldZ` to check the label is `samba_share_t` (the semanage + restorecon fix from section 5); finally pick the client machine's log in `/var/log/samba/` and read smbd's recorded refusal reason. Still stuck after three steps? Reproduce from the Linux side with `smbclient //IP/share -U user` -- the error code points clearly at NT_STATUS_ACCESS_DENIED (permissions/labels) or NT_STATUS_LOGON_FAILURE (ledger problem), far more informative than Windows' "cannot access".

**NT_STATUS_BAD_NETWORK_NAME.** The server simply does not recognize the share name. The number one cause is spelling: Windows' case-insensitive illusion masks whether the real share name in the config is `data` or `Data`; next is that the share genuinely is not written or not effective in smb.conf (changed without reloading -- see below). Reconcile against what the server actually exposes with `smbclient -L //server -U user` -- a name absent from that list will never appear no matter how often the client retries. Also note `browseable = no` only hides it from the browse list, and typing the share name manually still gets in; a rejection for a `valid users` mismatch is ACCESS_DENIED, not BAD_NETWORK_NAME -- two error codes, two investigation paths, so read the code before acting.

**smbpasswd created the account, but login still fails.** NT_STATUS_LOGON_FAILURE points at the ledger itself. Three root causes in order of frequency: you typed the system password instead of the Samba one (two ledgers, section 1.2); the system user was touched after `smbpasswd -a` (deleted by `userdel` or locked by `passwd -l`/`usermod -L`), so the ledger has the person but the system does not; the passdb backend was switched (say tdbsam to the smbpasswd text backend, a migration left half-done), so `pdbedit -L` lists a different database than the one actually verifying. The comparison commands: `pdbedit -L` for the Samba account, `getent passwd alice` for the system user; suspect the password itself only when both lines are green.

**Anonymous access pops a password prompt.** Anonymous sharing is a double switch: `map to guest = Bad User` in `[global]` and `guest ok = yes` in the share must both be in place; missing either half makes the client's anonymous request be treated as "a normal login without credentials" and asked for a password. When checking, mind the value of `map to guest` -- writing `Never` (the default) disables anonymous mapping entirely, and `Bad Password` behaves far more aggressively (a wrong password also goes through as guest); neither is the security posture "anonymous read-only" wants. Verification once configured is one command: neither `smbclient -L //IP -N` nor `smbclient //IP/public -N` should still prompt for a password.

**Changes to smb.conf do not take effect.** A passing testparm only means the file is correct; a running smbd still holds the old config. Two actions make it re-read: `sudo smbcontrol smbd reload-config` reloads online without dropping existing connections, suitable for production hours; `sudo systemctl restart smbd` (Debian family `smbd`, Arch/RHEL family `smb`) restarts completely and drops all connections, suitable for clean verification after big changes. One more confounding behavior worth knowing: smbd itself periodically re-checks the config file's timestamp and applies changes within a few minutes -- which explains the ghost phenomenon of "did not restart, but it started working a while later", and means that "waiting a bit" during troubleshooting pollutes your causal judgment: verify a config change either with an explicit reload or a restart, and do not rely on this delayed effect.

**Windows caches old credentials.** After changing a Samba password, the Windows side reports authentication failures repeatedly while other machines typing the new password manually work fine -- this machine's credential manager still holds the old password and submits it automatically. Clear the cache on the client with `net use * /delete /yes` to disconnect and clear session credentials; for stubborn cases, delete the Windows credential entry in Credential Manager; on the server side, changing the password once more with `smbpasswd` also triggers re-authentication. This is the same class of problem as a browser caching an old password: the authentication layer has been updated while the submitting side is still stuck on yesterday; in troubleshooting, swapping in a clean client isolates the variable and immediately pins the problem on "the server" versus "this machine's memory".

**The IP connects but the hostname does not.** `\\192.168.1.100\data` works while `\\fs-01\data` reports not found -- the problem is not in Samba, it is in name resolution. Check in order: does DNS have an A record (the preferred path in modern environments); is nmbd running and `systemctl status nmb` (Debian family `nmbd`) active -- NetBIOS short name resolution depends on it; does the client still depend on the long-disabled SMB1 browsing. One try with the name swapped for an IP narrows the fault from "the Samba service" to "the name-to-address stretch", which is the first cut for every name-related problem.

**Chinese filenames are mojibake on the Windows side.** Modern Samba's unix charset defaults to UTF-8, consistent with the Linux filesystem, and normally needs no change; garbled names mostly occur in two corners: old files that landed on disk back in the GBK era sitting in the share, or someone having explicitly written an outdated value like `unix charset = GB2312` into smb.conf from old material. The handling principle is "UTF-8 is the single source of truth": delete the suspicious charset overrides so the default takes effect, and batch-convert old files with `convmv -f GBK -t UTF-8 -r --notest dir` -- run `--notest` first for a dry run to see the impact, then drop `--notest` for the real conversion, the same discipline as any bulk data change. Client-side support for UTF-8 over SMB (Windows 10+/macOS) has long been on by default; do not bother "aligning encodings" on both ends.

**Symlinks in a share cannot be followed.** Clicking a symlink in the share on the client reports the target not found -- this is secure design, not a failure: the link's target may lie outside the share root, and Samba by default does not follow it (the behavior is decided by the interaction of `wide links` and `unix extensions`), preventing clients from reading arbitrary server paths through links. The correct approach is to put real data inside the share tree and organize structure with directories rather than symlinks; when a cross-directory aggregation need is genuine, understand the risk of `allow insecure wide links` before enabling it explicitly, and back it with SELinux and file permissions as a double layer -- the "denied by default versus explicitly opened" trade-off is the same lesson as the firewall's default-deny model.

**Excel/documents are locked, cannot be deleted or edited.** Before blaming the antivirus for "file in use by another process", check `sudo smbstatus`: the Locked files section gives the holding process ID, user, and lock mode directly (see section 3.3). oplocks let clients cache reads and writes locally for speed, at the cost of lock coordination under concurrent editing; normally a second client opening the file triggers a lock downgrade and gets a read-only copy; a stale lock (not released after a client abnormally disconnected) is kicked with `smbcontrol smbd close-share SHARENAME`, or dealt with directly by the PID smbstatus reports. Writing "cannot delete? smbstatus first" into the on-call runbook saves a round trip compared to having the user save repeatedly to probe.

**Large file transfers stall or drop midway -- fragmentation from MTU or negotiated encryption.** `ping -s 1472 -M do server` tests PMTU; if it does not get through, either the switch/virtualization layer MTU is too small (set 9000 to enable jumbo frames), or `smb encrypt = required` is eating payload with SMB packet encryption overhead. Countermeasures: add `socket options = TCP_NODELAY IPTOS_LOWDELAY SO_RCVBUF=131072 SO_SNDBUF=131072` in `[global]` to enlarge kernel send/receive buffers and lower interactive latency; in a plaintext environment, temporarily try `smb encrypt = desired` to see whether it recovers, then go back and solve the MTU root cause.

**Multichannel not in effect -- the NIC has multiple IPs but the client stays single-channel.** `smbstatus -S` shows whether the same user appears on multiple rows with different IPs; if there is only one row, check `[global] server multi channel support = yes` and client SMB3.1.1+ (Windows 10 1709+, Server 2016+, Linux cifs.ko 4.13+). One hidden condition: the multiple IPs must be in the **same subnet** or have a reachable route, and the interfaces must not be excluded by `interfaces`/`bind interfaces only`. Troubleshooting mantra: server switch, client version, same subnet, interface allowlist -- all four green before aggregation happens.

**Logs explode and fill the disk -- log level too high or not split.** In production `log level = 1` (errors/warnings only); change to `2`/`3` temporarily for debugging and roll it back on a deadline; `max log size = 10240` (10 MB rotation) and `log file = /var/log/samba/%m.log` to split per client. If the disk is already full: `ls -lh /var/log/samba/` to find the big one, `rm` the old rotations, change the config, `systemctl reload smbd` -- do not use external `logrotate` splitting, Samba's built-in rotation fits its write pattern better.

---

## 8. SMB3 Encryption and Signing (Enterprise Minimal Hardening)

Add to `[global]`:

```ini
# Allow only SMB2.1 and above; enforce encryption and signing
server min protocol = SMB2_10
smb encrypt = required      # encrypt from the handshake; refuse plaintext
server signing = mandatory  # refuse unsigned packets
```

Verify:

```bash
# Force encryption on the client connection
smbclient //server/data -U smbuser -e
# -e requests encryption; if the server has smb encrypt = required, omitting -e also gets rejected
```

> **Compatibility**: natively supported from Windows 8 / Server 2012 onward; macOS 10.10+; Linux cifs.ko 3.7+. Old XP/2003 clients will become entirely unable to connect -- this is expected behavior.

---

## 9. References

- Official Samba documentation -- [samba.org/samba/docs](https://www.samba.org/samba/docs/)
- Arch Wiki: Samba -- [wiki.archlinux.org/title/Samba](https://wiki.archlinux.org/title/Samba)
- Red Hat official documentation (RHEL deployment and SELinux configuration) -- [access.redhat.com/documentation](https://access.redhat.com/documentation/en_US/red_hat_enterprise_linux/)
- "Vbird's Linux Cabinet" -- [linux.vbird.org](https://linux.vbird.org/)
- man smb.conf -- [man.archlinux.org/man/smb.conf.5](https://man.archlinux.org/man/smb.conf.5)
- man smbclient -- [man.archlinux.org/man/smbclient.1](https://man.archlinux.org/man/smbclient.1)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [glossary](/glossary.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [selinux](/security/selinux.md)
- [README](README.md)
- [ldap](ldap.md)
- [nfs](nfs.md)