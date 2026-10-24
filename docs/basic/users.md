# User Management

## Chapter Introduction

Linux is a multi-user system. From the moment you press the power button to the moment you see the login prompt, dozens of processes with different identities are already running on the machine: `systemd` manages services as root, `sshd` listens on port 22 as root and then drops privileges to handle connections, and your browser runs under your own UID. The question "who is running, and with what privileges" runs through the entire Linux security model -- the three-digit rwx of file permissions, sudo's elevation logs, and the ownership of `/home` on disk all rest on the user and group mechanism. If you cannot tell a primary group from a supplementary group, the group name in the third column of `ls -l` will confuse you; understand it and you will know why adding a user to the `docker` group lets them touch the Docker socket without sudo, and why, from a security standpoint, that is equivalent to handing them root.

This chapter spans three pages: account management solves the "people" problem -- how UID/GID are assigned, which `usermod` scenarios come up most, and why sudo is preferable to logging in as root on a long-term basis; ACL permission control solves the "three permission digits are not enough" problem -- what to do when owner/group/other cannot express "give Zhang San read-write alone"; disk quota solves the "one person eats all the resources" problem -- how to stop a single user from filling `/home` on a shared server. The three pages build on each other: first people, then permissions, then resource ceilings.

> This page compares the three distribution families -- **Debian/Ubuntu, Arch, RHEL/CentOS/Rocky** -- and tags every concrete command or default-configuration difference with its family. Content drawn from the Arch Wiki, Bird's Private Recipes, and the official distro docs; see references at the end.

## What This Page Covers

After the three sub-pages, the chapter covers:

1. **Explain what UID/GID do**: the kernel checks numbers, not usernames, when judging permissions, and understand the UID 0, system UID, and regular UID boundaries.
2. **Distinguish primary from supplementary groups**: use `id` in a real terminal to verify which groups a user belongs to, and explain what each group grants.
3. **Perform account operations independently**: create, rename, lock passwords, add to groups, delete users -- knowing whether each step touched `/etc/passwd`, `/etc/group`, or `/etc/shadow`.
4. **Make the right elevation decision**: explain why daily work should use `sudo` rather than a long-lived root session via `su -`, and know the difference between Arch's `wheel` group and Debian/Ubuntu's `sudo` group.
5. **Pick the tool by scenario**: for "grant directory access to someone" versus "cap someone's disk usage", choose ACL versus quota instead of a blanket `chmod 777`.
6. **Avoid the common traps**: do not run `userdel -r` on a home directory still NFS-mounted, do not delete a primary group by mistake, and do not leave a syntax error in `/etc/sudoers` that locks you out of your own system.

## Sub-Page Guide

The three sub-pages are ordered by the dependencies between concepts and operations (roughly 10-15 minutes each):

- **[Account Management](./users/account_management.md)** -- where people come from. Starting from one real line in `/etc/passwd`, it breaks down the origin of UID/GID and primary/supplementary groups, covers typical `useradd`/`usermod`/`userdel` scenarios (change shell, lock an account, batch add to a group), focuses on the traps between sudo and direct root, and gives Arch's `wheel` group convention plus a three-family sudo comparison. This page answers "how is this user created and managed".

- **[ACL Permission Control](./users/acl_permissions.md)** -- fine-grained grants beyond the three permission digits. It starts with why traditional rwx cannot express "give guest write alone", then walks through real `getfacl`/`setfacl` output, explains the most easily ignored field -- mask (which quietly narrows what you set), covers default ACLs so new files inherit automatically, and includes backup/restore scripts. This page answers "how to grant specific people access without changing owner or group".

- **[Disk Quota](./users/disk_quotas.md)** -- resource ceilings. It opens with a real incident where one user filled `/home` and broke logins for everyone, then explains the semantic difference between soft (can be temporarily exceeded, with a grace period) and hard (absolute ceiling), covers the key difference in how ext4 and XFS enable quotas (XFS needs `quota=` in the mount options), and walks through reading a `repquota` report. This page answers "how to limit one user's disk usage".

## Three-Family Differences at a Glance

Default behavior comparison across the three distribution families for the operations in this chapter:

| Topic | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Default UID for regular users | 1000+ | 1000+ | 1000+ |
| `useradd` default Shell | `/bin/sh` (dash), often needs `-s /bin/bash` | `/bin/bash` | `/bin/bash` |
| Sudo qualification group | `sudo` group | `wheel` group (enabled by default via `%wheel`) | `wheel` group |
| Install sudo | `apt install sudo` (desktop image has it by default) | `pacman -S sudo` (included in base packages) | Installed by default |
| Edit sudoers | `visudo` | `visudo` | `visudo` |
| Default password hash | yescrypt (newer) | yescrypt | sha512crypt |
| Common ACL tool package | `apt install acl` | `pacman -S acl` | `dnf install acl` |
| Quota tool package | `apt install quota` | `pacman -S quota-tools` | `dnf install quota` |

No need to memorize the table -- once you enter a sub-page, every command is tagged with its distro. The one intuition to establish first: **the user model is identical across the three families (all are UID/GID + primary/supplementary groups), and the differences are only in defaults and package names** -- fundamentally different from package management, where switching distros means switching commands.

## Common Questions

Four questions that come up often entering this chapter, answered up front:

**Q: Should I always log in as root?**
No. root (UID 0) has no permission boundaries; one careless `rm -rf /` or a mistyped `dd of=/dev/sda` is an irreversible incident. Use a regular user plus `sudo` for daily work -- it keeps elevation ability while leaving a complete audit trail in `/var/log/auth.log` (Debian/Ubuntu) or `/var/log/secure` (RHEL family). See [Account Management](./users/account_management.md).

**Q: What is the difference between `usermod -aG` and `usermod -G`?**
`-aG` **appends** to the supplementary groups; `-G` **replaces** the entire supplementary group list. Drop the `-a` and you remove the user from every other supplementary group -- say you just added an ops colleague to `sudo`, then ran `usermod -G docker` without `-a`, and they will mysteriously lose sudo qualification. This is the highest-frequency accident in the chapter.

**Q: I changed a user's groups, why do not the new permissions apply?**
Supplementary groups are read into process credentials once at login; an already-open SSH session will not refresh on its own. Log in again (or temporarily switch with `newgrp groupname`).

**Q: When should I use ACL rather than chmod/chown?**
When you do not want (or have no right to) change a file's owner and group but need to grant access to a specific user or group. Typical case: a shared `/srv/projects` owned by `root:devops`, but you want only the `guest` account to write to one subdirectory. `chmod` cannot "grant to one person only"; ACL can. See [ACL Permission Control](./users/acl_permissions.md).

## References

- Arch Wiki - Users and groups -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Users_and_groups)
- Arch Wiki - sudo -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Sudo)
- Arch Wiki - Access Control Lists -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Access_Control_Lists)
- Arch Wiki - Disk quota -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Disk_quota)
- Bird's Private Recipes - Users and Groups -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0410accountmanager.php)
- Debian Handbook - Users and Permissions -- [debian.org](https://www.debian.org/doc/manuals/debian-handbook/)
- RHEL 9 Docs - Managing Users and Groups -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_basic_system_settings/)
- `man useradd`, `man usermod`, `man sudoers`, `man setfacl`, `man edquota`

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)
- [configuration-management](/commands/system/configuration-management.md)
- [system_info](/commands/system/system_info.md)