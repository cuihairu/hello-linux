# ACL Permission Control

Traditional rwx permissions have only three groups of bits: owner, group owner, and others. That model is enough in a "one person, one file" world, but real shared directories almost always raise needs the three groups cannot express -- `/srv/projects` has group owner `devops`, yet you need an outsourced colleague in only the `guest` group to write to one subdirectory; a home directory must let a backup script read as the `backup` user without changing the owner. Chmod-ing one file at a time destroys the group semantics, and `chown` breaks the ownership chain. So Linux provides ACL (Access Control List): an authorization table in filesystem metadata that grants access to any named user or group, operating in parallel with the traditional three-bit permissions. Understanding ACL is not just about running `setfacl` -- it is about grasping the **mask** field, which acts like a gate that quietly narrows the permissions you carefully set and is the root of bizarre problems like "I clearly granted rw but still cannot write".

> Content drawn from the Arch Wiki and `man setfacl`/`man getfacl`; see references at the end.

## What This Page Covers

- Explain what blind spot ACL fixes in traditional rwx
- Read every line of `getfacl` output (especially `mask`)
- `setfacl` modifications, recursion, and default ACLs
- Back up and restore directory ACLs

## 1. Why ACL Is Needed

The expressive ceiling of the traditional model is "three groups of people". When what you need to express is "this specific user **Zhang San** can read and write this file", and Zhang San is neither the owner nor in the group owner, the traditional model is left with only the "others" tier -- granting `o+w` means **everyone** who is neither owner nor group can write. The group approach does not fix it either: temporarily adding Zhang San to the group owner solves one file but inadvertently opens every file that group can reach.

ACL extends the authorization targets from three groups to any number of named user/group entries while staying backward compatible -- old programs that do not support ACL still call `stat()` and get the traditional three-bit permissions (corresponding to `user::`, `group::`, `other::` in the ACL). All three distro families' filesystems support ACL by default: ext4, XFS, Btrfs, and tmpfs all work out of the box with no kernel parameter changes; the only thing to install is the userspace tool package.

```bash
$ sudo apt install acl        # Debian/Ubuntu
$ sudo pacman -S acl          # Arch
$ sudo dnf install acl        # RHEL/CentOS/Rocky
```

## 2. Reading getfacl Output

`getfacl` output maps one-to-one onto `ls -l`: `user::` is the owner bits, `group::` the group owner bits, `other::` the others bits; in between there may be several `user:name:` / `group:name:` named entries, plus a `mask::` line. An unmodified file matches `ls -l` exactly; after granting a named user, the extra line is a **named ACL entry**, and `mask` is automatically raised to accommodate the new permission.

```bash
$ getfacl /srv/projects/notes.txt
# file: srv/projects/notes.txt
user::rw-
user:guest:rw-     <-- newly added: grant for a named user
group::r--
mask::rw-          <-- effective permission ceiling (see section 4)
other::r--
```

Comparing with `ls -l` you will notice the permission string grew longer -- the `+` at the end is the "ACL exists" marker (`-rw-rw-r--+`). You can also grant directly to a group with the same semantics as a named user, just with the match target being a group GID: `sudo setfacl -m g:auditors:r file.txt`.

## 3. Common setfacl Operations

`setfacl -m` modifies an entry, `-x` deletes one entry, and `-b` clears all extended ACLs leaving only the traditional three bits; multiple grants are comma-separated in a single write; `-R` applies recursively to files that **already exist at the time of the call**.

```bash
$ sudo setfacl -m u:guest:rw,u:carol:r file.txt
$ sudo setfacl -R -m u:guest:rw /srv/projects/drafts/
$ sudo setfacl -x u:guest file.txt     # Delete a single named ACL entry
$ sudo setfacl -b file.txt             # Delete all extended ACLs
$ sudo setfacl -m m:r file.txt         # Modify the permission mask
```

Note that `-R` only affects existing files; files created later will not inherit the ACL automatically. To make new files carry the grant, set a **default ACL** -- it attaches to a directory and is inherited like a template by files and subdirectories created via `open()`/`creat()`. The `d:` prefix is only valid on **directories**:

```bash
$ sudo setfacl -m d:u:guest:rw /srv/projects/drafts/
$ touch /srv/projects/drafts/new.txt
$ getfacl /srv/projects/drafts/new.txt
user:guest:rw-     <-- inherited automatically by the new file; no manual setfacl needed
$ sudo setfacl -k /srv/projects/drafts/   # Clear the default ACL
```

Default ACL permissions are constrained by the directory's own ACL; if the parent has `group::r--`, child files cannot inherit write permission -- permissions are ANDed down level by level.

## 4. mask: The Most Common Trap

mask is the **effective permission ceiling** in an ACL. It ANDs every non-owner ACL entry (named user, named group, and group owner). Once any entry is narrowed by mask, the actually effective permission falls below what you set -- the named lines shown by `getfacl` are the effective permission **after** the mask is applied.

```bash
$ sudo setfacl -m m:r file.txt
$ getfacl file.txt
user:guest:r--     <-- already truncated by mask; no longer the rw originally granted
mask::r--
$ sudo -u guest tee -a file.txt < /dev/null
tee: file.txt: Permission denied
```

When you call `setfacl -m u:...:rw`, the tool tries to raise the mask automatically enough to fit the new permission (which is why you rarely notice it). But when someone has explicitly set the mask, or entries were partially cleared in a way other than `-b`, mask may be stuck at an old value. **When debugging "I set the permission but it does not take effect", the first thing to do is `getfacl` and look at the mask line** -- far more useful than repeatedly re-running `setfacl`.

Named group entries share the same mask as the group owner entry (`group::`). In other words, mask is "the common ceiling for all grants except owner and others", a design that ensures the second permission group of `ls -l` (the group owner bits) seen by old programs that do not understand ACL never exceeds the administrator's real intent.

## 5. Three-Family Default ACL Policy Comparison

The three distro families are nearly identical in ACL behavior; the differences concentrate in default mount options and documentation conventions:

| Topic | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Tool package | `acl` (installed by default) | `acl` (included in base group) | `acl` (installed by default) |
| ext4 mount option | Works by default (ACL enabled on demand, no `acl` option needed) | Same | Same |
| Common misuse | Using `chmod 777` instead of ACL | Same | Same |
| Check support | `tune2fs -l /dev/sdX1 \| grep -i acl` | Same | `xfs_info` enabled by default |

To clarify: historically ext2/3 required explicitly adding the `acl` mount option, but ext4 and later enable ACL support in the kernel by default; XFS has always had it on. So on all three families you do not need to touch `/etc/fstab` -- install the `acl` package and use `setfacl` directly.

## 6. Backup and Restore

ACLs live in filesystem metadata; `cp` does not preserve them by default (unless using `cp -a`/`--preserve=xattr`), so the most reliable way to migrate a directory tree is to export first, then replay. `getfacl -R` output is replayable text (with `# file:` comment lines for location), and `setfacl --restore` expects exactly this format:

```bash
$ getfacl -R /srv/projects > /backup/projects.acl
$ sudo setfacl --restore=/backup/projects.acl
$ getfacl -R /srv/projects | sudo setfacl --restore=/dev/stdin
```

For a full migration (`rsync` to a new machine), archive the ACL export alongside the data. Restore order is "rsync the data first, then setfacl --restore"; the reverse causes ACL entries to be skipped because the target files do not exist yet.

## 7. Common Traps

1. **ACL set but not taking effect**. First `getfacl` and check whether `mask` is narrowing; then `ls -l` to see if there is a `+`; finally `id` to confirm the current process credentials' UID/GID actually match the entry. These three steps cover 90% of cases.

2. **Confusing `-R` with default ACL**. `-R` handles existing files, `d:` handles future files; doing only one leaves a mess of "half the files have permission, half do not". The correct batch-grant posture is to do both:

   ```bash
   $ sudo setfacl -R -m u:guest:rw /srv/projects/drafts/
   $ sudo setfacl -m d:u:guest:rw /srv/projects/drafts/
   ```

3. **Using ACL to bypass a problem that should use groups**. If ten people need the same permission, create a group and `setfacl -m g:team:rw` is easier to manage than maintaining ten user entries. ACL's role is "individual exceptions", not "replacing the group model".

4. **Losing ACLs during backup**. Plain `tar` does not include xattrs (ACLs are stored under the `system.posix_acl_*` xattr keys). Use `tar --xattrs --xattrs-include='*'`, or export `getfacl` text per section 6.

5. **Operating on a filesystem that does not support ACL**. FAT32 and exFAT (common on USB drives) do not support POSIX ACL; `setfacl` reports `Operation not supported`. For USB drives shared across systems, use the `umask`/`fmask`/`dmask` mount options instead to control default permissions.

6. **Assuming ACL can restrict root**. Like traditional DAC, ACL is ineffective against UID 0; what actually constrains root is MAC such as SELinux or AppArmor -- see [Security Fundamentals](../security.md).

## References

- Arch Wiki - Access Control Lists -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Access_Control_Lists)
- Bird's Private Recipes - File Permissions and ACL -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0210filepermission.php)
- `man getfacl`, `man setfacl`, `man acl`
- Debian Handbook - Permissions and ACL -- [debian.org](https://www.debian.org/doc/manuals/debian-handbook/)
- RHEL 9 - Using ACL -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html-single/managing_storage_devices/index)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/basic/README.md)
- [users](/basic/users.md)
- [glossary](/glossary.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [pam-sudo](/security/pam-sudo.md)