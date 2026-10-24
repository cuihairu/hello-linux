# File Permissions

Permissions are the first gate in the Linux security model: they decide whether a request is let through or rejected by the kernel before SELinux/AppArmor ever sees it. The root cause of the vast majority of "service returns 403," "script cannot execute," and "someone else can delete my file" failures is not a security module but one of the three rwx triads, a bad umask default, or an unset special permission bit. This chapter starts from the underlying logic of DAC (discretionary access control), covers umask and the real scenarios and pitfalls of SUID/SGID/Sticky, and then connects to ACL — the extension for when rwx's "three subject classes" model is not enough — plus the permission conventions of the Arch packaging ecosystem.

> Content adapted from the Arch Wiki, `man 7 capabilities`, and Bird's Private Recipes (Lin's Linux Administration Guide); see the references at the end.

## What This Chapter Covers

- Read every column of `ls -l` correctly
- Explain how umask is computed and its role as a "secure default"
- Judge when SUID/SGID/Sticky are appropriate and when they are a privilege escalation hole
- Use ACL to cover what rwx cannot express, and know when ACL is the right call instead of chmod 777
- Arch's permission conventions (wheel/sudo, default package permissions, .pacnew)

## 1. Permission Basics: The DAC Model

### 1.1 Inspecting Permissions

```bash
ls -la
# -rwxr-xr-x 1 user group 4096 Jan  1 00:00 file.txt
# drwxr-xr-x 2 user group 4096 Jan  1 00:00 dir/
```
The permission field, broken apart:

```text
- rwx r-x r--
│ │   │   │
│ │   │   └── other users (other)
│ │   └────── owning group (group)
│ └────────── owner (user/owner)
└──────────── file type (- regular file, d directory, l symlink, s SUID, t sticky)
```

Linux is a **DAC (discretionary access control)** system: the file's owner alone decides who gets access. The kernel's check order is fixed — **it first tests whether the process's euid equals the file's owner; if so the user bits apply; otherwise it tests whether one of the process's groups matches the file's group; if so the group bits apply; failing both, the other bits apply.** Understanding this order is what explains "why I gave the file to alice but bob still cannot read it" (bob is not in the matching group, and other is `---`).

### 1.2 How rwx Differs Between Files and Directories

This is the most overlooked and most error-prone point in the whole chapter:

| Permission | On a file | On a directory |
|------|-------------|-------------|
| r (read) | View the file's contents | `ls` lists the directory's entries (names only — not the same as being able to enter) |
| w (write) | Modify the file's contents | **Create/delete/rename entries inside it** — this is what directory write permission actually grants |
| x (execute) | Run it as a program | `cd` into the directory, `stat` its files — **without x, having w still does not let you write into files** |

Corollary: give a directory `rwx` but no `x` on a subfile, and the user can `ls` the file's name yet cannot open it. Conversely, a web server that needs to read `/var/www/html/index.html` needs `x` (traverse) at every level of `/`, `/var`, `/var/www`, `/var/www/html`, plus `r` on the target file. Miss `x` at any level and the error is `Permission denied` — for diagnosis, `namei -l /var/www/html/index.html` lists the whole chain's permissions in one shot.

### 1.3 Numeric Notation and Common Combinations

| Char | Value | | Combo | Means | Typical use |
|------|------|-|------|------|---------|
| r | 4 | | 755 | rwxr-xr-x | Directories and executables: owner has full rights, others can read and traverse |
| w | 2 | | 644 | rw-r--r-- | Ordinary config/docs: owner writes, others read |
| x | 1 | | 700 | rwx------ | Private directory: only the owner enters (`~`, SSH key directories) |
| - | 0 | | 600 | rw------- | Private file: only the owner reads/writes (`~/.ssh/id_ed25519`, `/etc/shadow`) |

The computation is three octal digits summed: `rwx = 4+2+1 = 7`, `r-x = 5`, `r-- = 4`. `chmod 755` means "owner gets everything, group and other get read + traverse."

**Why 644/755 is the secure default**: the other bits carry no w (`0`, or `4`/`5` with w=0), so other ordinary users on the same machine cannot modify your files; if the file is also configuration, you need not worry about tampering by a low-privileged user. Conversely, `777` turns on the other's w bit — that is write access for every user on the machine. It is the number-one source of "just make it work," and a common target scanners look for.

## 2. Changing Permissions

### 2.1 chmod

```bash
# Numeric mode (absolute; overwrites the existing permissions)
chmod 755 file.txt
chmod -R 755 directory/     # recursive — be careful on directories; it also makes files executable

# Symbolic mode (relative add/remove; clearer semantics, avoids one wrong digit flipping everything)
chmod u+x file.txt     # add execute for the owner
chmod g-w file.txt     # remove write from the group
chmod o=r file.txt     # set others to read-only
chmod a+r file.txt     # add read for everyone
chmod 750 dir/         # only the directory itself, not recursively into subfiles
```

The value of symbolic mode is **readability**: `chmod o-w secrets/` expresses intent better than `chmod 750 secrets/`, and avoids the numeric mode risk of "one wrong digit, all permissions change."

### 2.2 chown and chgrp

```bash
# Change the owner (group can be given at the same time; :group shorthand = change only the group; -R recursive)
sudo chown user file.txt
sudo chown user:group file.txt
sudo chown -R user:group directory/
sudo chown :group file.txt

# chgrp: usable by unprivileged users too (as long as you are yourself a member of the target group)
sudo chgrp staff file.txt
```

**Decision consequences**: `chown -R` on a directory does not automatically strip the SUID bit or any ACLs inside it — a file brought in via `cp -a` from elsewhere may carry SUID; ownership changed but the privileged bit remains. After copying untrusted files, actively check `getcap -r` and `find . -perm -4000`.

## 3. umask: Where the Default Permissions of New Files Come From

### 3.1 Why umask Exists

`chmod` handles "files that already exist"; **umask handles "files created in the future."** If every new file defaulted to `666` (writable by anyone), the first user's edited script could be tampered with by the second. umask's job is to **mask out** a set of bits that should not be open by default at file creation time — essentially "the initial security baseline for permissions."

The computation (note that this is "masking," not "subtracting then using the result"; in practice apply a bitwise AND-NOT):

```text
New file permissions = 666 & ~umask     (directories = 777 & ~umask)
```

The common mental-arithmetic version (when the umask has no x bits, it can be approximated as subtraction):

| umask | New file | New directory | Common with |
|-------|--------|--------|--------|
| 0022 | 644 (rw-r--r--) | 755 (rwxr-xr-x) | **The default on almost every distro** (root / single-user scenarios) |
| 0002 | 666 (rw-rw-r--) | 777 (rwxrwxrwx) | Collaborative group directories, where group members write to each other's files |
| 0077 | 600 (rw-------) | 700 (rwx------) | High-security setups, some service users |

```bash
# Show the current umask; verify by creating a new file/directory
umask                                  # 0022
touch test.txt && ls -l test.txt       # -rw-r--r-- ← 666 with 022 masked out = 644
mkdir testdir && ls -ld testdir        # drwxr-xr-x ← 777 with 022 masked out = 755
```

### 3.2 Why Servers and Shared Directories Change umask

The default `0022` leaves the other bits as `r-x`, meaning **any user on the machine can read your new files**. Two typical fixes:

```bash
# Temporary (current shell only)
umask 0027      # new files 640, new dirs 750: group can read, others get nothing

# Persistent: write it into the shell configuration
echo "umask 027" >> ~/.bashrc

# Collaborative group shared directory: force group permissions on entry + 0002
chmod 2775 /srv/shared        # the SGID bit, see the next section
# New files in this directory automatically belong to the directory's group; combined with umask 0002, group members can write to each other's files
```

**How it fits with ACL**: umask only affects "newly created" files; it cannot backfill permissions onto existing ones, nor can it express "give exactly this one user write." Both of those are ACL's territory — umask sets the baseline, ACL handles the special cases.

## 4. Special Permissions: SUID, SGID, Sticky

The three special bits show up in `ls -l` as `s`/`S` on the user field, `s`/`S` on the group field, and `t`/`T` on the other field (uppercase means the corresponding x is not set). Numerically they occupy the thousands place as 4, 2, and 1.

### 4.1 SUID: Running as the File's Owner

**Real scenario**: a regular user needs to change their own password, but the password hash lives in `/etc/shadow`, owned by root, and a normal process has no write permission. `/usr/bin/passwd` therefore carries SUID — at execution time the process's **effective uid becomes the file's owner (root)**, which lets it write to shadow; on exit the normal identity returns.

```bash
ls -la /usr/bin/passwd
# -rwsr-xr-x 1 root root 55136 ... /usr/bin/passwd   (the x slot of the user field shows as s)

chmod u+s script      # or numeric mode: chmod 4755 script (4 + 755)
```

**Why this is a double-edged sword**: an SUID program amounts to "lending the executor a share of the owner's power." If the program has an input-validation vulnerability (injection, or a way to read arbitrary files), the attacker gets root. Therefore:

- On production systems, the set of SUID binaries should be a **very small number** of audited standard tools (`passwd`, `sudo`, `su`, `mount`, `ping` — in newer kernels ping mostly uses capabilities rather than SUID)
- **The kernel ignores the SUID bit on scripts** — `chmod 4755 evil.sh` appears to take effect (`ls` shows `s`), but the privilege does **not** apply at execution time. This is a deliberate security design (historically it was exploited through `#!` parsing differences). To give a script elevated rights, the correct approach is wrapping it in a binary or authoring the specific command with `sudo`
- Audit regularly: `find / -perm -4000 -type f 2>/dev/null`; every file it lists should have a ready answer to "why does this need root"

**sudo vs SUID**: `sudo` puts the authorization table for **specific commands** into `/etc/sudoers` — auditable, revocable, logged; SUID hands the **whole program's** owner rights to anyone who can execute it. Prefer `sudo` for new needs; leave SUID to the base tools that ship with the distribution.

### 4.2 SGID: Two Uses of the Group Bit

SGID has two distinct semantics, depending on what it is set on:

**On a directory (the more common use) — new files inherit the directory's group**

```bash
# Build a team shared directory: group staff, members read/write, new files automatically go to staff
sudo groupadd staff
sudo chgrp staff /srv/shared
sudo chmod 2775 /srv/shared      # 2 = SGID
ls -ld /srv/shared                # drwxrwsr-x ... the x slot of the group field shows as s
```

Without SGID, new files default to inheriting the **creator's primary group** (not the directory's group), and the same-group collaboration falls into the fragmented state of "the file's group is alice's private group and bob cannot read it." An SGID directory pins the group relationship in place; it is the standard configuration for a shared workspace.

**On an executable file — the process's euid-associated group becomes the file's group at runtime**

```bash
chmod 2755 /usr/bin/wall
# A process running wall executes under the group of the root:root wall binary and can write to every user's tty
```

Manual setup is uncommon; when you do see it, audit it just like SUID.

### 4.3 Sticky Bit: Deleting Only Your Own Files

**Real scenario**: `/tmp` must be writable by all users (otherwise nobody can stage anything), but without an extra constraint, user A can delete user B's in-use temporary file — at best a nuisance, at worst it opens the door to race attacks (symlink race). The sticky bit makes it so that **only the file's owner (or the directory's owner, or root) can delete an entry**; everyone else's w right applies only to "files they created":

```bash
ls -ld /tmp
# drwxrwxrwt 15 root root 4096 ... /tmp     (the other field's t)

chmod +t dir         # or chmod 1755 dir
```

`/tmp`, `/var/tmp`, and `/dev/shm` are the system's built-in sticky directories. A self-made shared temporary directory that also allows multi-user writes should get sticky too; otherwise "sharing" degrades into "deleting each other's files."

### 4.4 Special Bit Combinations at a Glance

| Bit | Numeric | `ls -l` shows | One-line scenario | Main risk |
|----|------|-------------|-----------|---------|
| SUID | 4xxx | user slot `s` | `passwd` changing passwords | a program bug -> root escalation; wrongly set on a script it is inert but misleading |
| SGID (file) | 2xxx | group slot `s` | a specific tool running under that group | widens the group's writable surface |
| SGID (directory) | 2xxx | group slot `s` | team directory, new files inherit the group | group members automatically gain the group permissions of new files in that directory |
| Sticky | 1xxx | other slot `t` | `/tmp` preventing mutual deletion | none (should be more widespread) |

```bash
# Audit script: list every SUID/SGID file on the system (run once after a fresh install to keep a baseline)
find / -xdev \( -perm -4000 -o -perm -2000 \) -type f 2>/dev/null | sort
```

## 5. ACL: When Three Subject Classes Are Not Enough

The rwx model has only three slots: owner/group/other. To express "this file belongs to the dev group, but bob from ops should also be able to read it, and the audit group can read but not write," you need ACL to append arbitrary entries beyond the three slots:

```bash
# Inspect (a file with ACLs shows a + after the group field in ls -l)
getfacl file.txt
# user::rw-
# user:bob:rw-        ← opened for bob alone
# group::r--
# mask::rw-           ← effective ceiling: every group-type entry is clamped by it
# other::r--

# Grant, recurse & default ACLs (set default on the directory; new files then inherit automatically)
setfacl -m u:bob:rw file.txt
setfacl -m g:ops:r file.txt
setfacl -R -m u:bob:rX shared/
setfacl -m d:u:bob:rX shared/

# Remove one entry, wipe everything, back up / restore (common in ops handovers)
setfacl -x u:bob file.txt
setfacl -b file.txt
getfacl -R /srv/shared > acl.bak
setfacl --restore=acl.bak
```

**When to use ACL vs chmod**:

| Scenario | Choose | Why |
|------|------|------|
| Default permissions on an ordinary file are wrong | Adjust umask/chmod | ACL is a patch; get the baseline right first |
| A few files need extra access for a specific user/group | ACL | Does not touch anyone else's other bits |
| Large-scale "per-department" grants | ACL, or groups + traditional permissions | ACL with default inherits; low maintenance cost |
| Need to audit "who was granted what" | ACL | `getfacl` is the ledger; chown/chmod cannot express it |

`ls -l` shows only a single `+`, never the ACL contents — when you see `+`, the conditioned reflex should be to run `getfacl`; otherwise you can easily miss a historical grant.

## 6. Arch Conventions and the Package Manager View

Arch has no separate "permission system," but the community and packaging ecosystem have settled on a few stable conventions that come up again and again:

- **Administrators go through the `wheel` group + sudo**: the user created at install time is added to `wheel` by default; once `%wheel ALL=(ALL:ALL) ALL` is enabled in `/etc/sudoers` (or `/etc/sudoers.d/wheel`), wheel members can `sudo`. This mirrors Debian putting the first user into the `sudo` group and RHEL using the `wheel` group; Arch's default choice is wheel.
- **Permissions on installed packages are decided by the PKGBUILD**: binaries from official packages are usually `root:root 755`, config files `644`, and sensitive files such as `/etc/shadow` are provisioned at `600`/`640` by the `filesystem`/`shadow` packages. In other words, **the permission baseline arrives with the package** — an upgrade will not "revert" permissions you chmod'd, but it does generate a `.pacnew` copy for **new config files** for you to diff — this is Arch's way of handling "package defaults vs your local changes" (Debian uses `.dpkg-dist`, RHEL uses `.rpmnew`; same idea).
- **PKGBUILD review and permissions**: an AUR package under `makepkg` by default does **not** run as root (nor does it execute arbitrary scripts as root); installation steps that need privilege are done via `sudo pacman -U` — this design separates "build" from "elevate." Correspondingly, running `makepkg` as a non-root user is the officially documented recommendation, while `pacman` itself must run as root.
- **Cleaning up permission-related caches**: `pacman -Qkk` can verify the file integrity of installed packages (one of the entry points for detecting tampered permissions); when you suspect a malicious SUID implant, comparing with `pacman -Qk` plus reinstalling the package via `pacman -S <pkg>` is the standard repair path.

One sentence comparing the three families: Debian/Ubuntu's `sudo` group, RHEL/Rocky's `wheel` group, and Arch's `wheel` group are all just different names for the same DAC + sudo model; the genuinely additional concern is SELinux (on by default in the RHEL family), which stacks another layer of mandatory checks on top of DAC — if the context shown by `ls -Z` is wrong, the service gets denied even with rwx fully correct.

## 7. Common Pitfalls

- **`chmod -R 777` cures everything** — it turns on other's w, which is an open invitation for every user on the machine to modify your files. The right move: use `namei -l` to locate the level missing the permission, then apply the minimal `chmod`/`chown` at **that level**.
- **Adding w to a directory but forgetting x** — the result is nobody can create files (writing an entry needs w; finding an entry needs x). A directory's permission triad is normally `rwx`/`r-x`/`---` distributed across the subject classes; do not stare at w alone.
- **Putting SUID on a script and wondering why it does not work** — the kernel ignores script SUID; this is expected. Author the specific command with sudo instead.
- **An SUID binary planted in a user-controlled path** — a root-owned SUID file under, say, `/home/user/bin` is almost certainly an intrusion trace. Reconcile regularly with `find / -perm -4000`.
- **Ignoring `+` and `.` in `ls -l`** — `+` means ACLs are present, `.` means an SELinux context is present (RHEL family); both mean "the permissions are more than just the rwx layer."
- **`umask 000` on a shared directory** — setting umask to zero for convenience makes every new file writable by everyone. For collaboration, `0002` + an SGID directory is enough; no need to open other.
- **An ACL mask silently reset by chmod** — running `chmod` on a file that already has ACLs also rewrites the mask, which can clamp ACL grants down to a smaller effective set; run `getfacl` for a backup before changing anything.
- **Changing `/etc/shadow` to 644** — every ordinary user can read password hashes, which is an offline-cracking risk. The file should stay `640 root:shadow` or `600`; after any tampering is caught by a verifier such as `pacman -Qk`/`rpm -Va`/`dpkg -V`, restore it as soon as possible.

## References

- `man chmod`, `man chown`, `man umask`, `man getfacl`, `man 7 capabilities`
- Arch Wiki - File permissions and attributes — [wiki.archlinux.org](https://wiki.archlinux.org/title/File_permissions_and_attributes)
- Arch Wiki - sudo (wheel group configuration) — [wiki.archlinux.org](https://wiki.archlinux.org/title/Sudo)
- Arch Wiki - makepkg, PKGBUILD permission conventions — [wiki.archlinux.org](https://wiki.archlinux.org/title/PKGBUILD)
- Bird's Private Recipes (Lin's Linux Administration Guide) - Linux file permissions — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0210filepermission.php)
- Debian Administrator - POSIX ACL — [debian.org](https://www.debian.org/doc/manuals/debian-reference/ch06.zh-cn.html)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/basic/README.md)
- [filesystem](/basic/filesystem.md)
- [glossary](/glossary.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [driver-framework](/source/driver-framework.md)
