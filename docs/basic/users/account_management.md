# Account Management

Linux was designed as a multi-user system from the start: every process carries a UID in the kernel, and when the kernel judges permissions it **looks at numbers, not names** -- the `user` or `root` shown by `ls -l` are just readable aliases resolved from `/etc/passwd`. Once you grasp this, every permission problem becomes plain: "root can do anything" is really "UID 0 bypasses DAC checks"; "add a user to the docker group" is really "add one more GID to that user's process credentials so it matches the group bits on `/var/run/docker.sock`". This page starts from the three core config files, moves to add/delete/modify commands, and lands on the sudo-versus-root choice -- the first mental model every Linux user must build.

> Content drawn from the Arch Wiki, Bird's Private Recipes, and the distro man pages; see references at the end.

## What This Page Covers

- Design intent behind UID/GID, primary and supplementary groups
- Read every field in `/etc/passwd`, `/etc/shadow`, `/etc/group`
- High-frequency `useradd`/`usermod`/`userdel` scenarios (including correct `-aG` usage)
- Weigh sudo against direct root, and get comfortable with three-family sudo config (including Arch's wheel convention)

## 1. Why Users and Groups

In an everything-is-a-file Linux, permissions ultimately land on the three rwx digits, which map to **owner (user)**, **group owner (group)**, and **others (other)**. Without a user concept you cannot tell "who owns it"; without a group concept you are left chmod-ing each person individually -- which instantly collapses the moment a team hits ten people. Groups let permissions be granted in bulk by role: add ten developer accounts to the `devops` group, set the shared directory's group owner to `devops`, and one `chgrp` completes the grant. Staff turnover is then just adding or removing group members.

At the kernel level, every process carries a set of credentials: real UID, effective UID, and a set of GIDs (the first is the primary group, the rest are supplementary). On file open the kernel checks effective UID, then effective GID, then supplementary groups against the file's owner, group, and other permission bits in order, and the first match wins. That is why supplementary groups grant permissions -- they participate in the match, and they are checked before the group owner.

```bash
$ id
uid=1000(alice) gid=1000(alice) groups=1000(alice),27(sudo),999(docker)
```

Read the three parts of `id` output separately: `uid=1000` is the user's own UID; `gid=1000` is the primary group, the same-named group auto-created at user creation; everything after the first in `groups=` is a supplementary group. It is the first-hand evidence for permission debugging: if a file's group owner is 999 (docker) and your groups list does not contain 999, access will never succeed.

## 2. User Types and UID Assignment

Linux distinguishes identity by UID. The boundaries are roughly consistent across the three families (Debian/Ubuntu and Arch use `systemd-sysusers`/`adduser` conventions; the RHEL family keeps the UID 1-999-for-system-accounts tradition):

| Type | UID range | Description | Typical examples |
|------|---------|------|---------|
| Superuser | 0 | The single root; bypasses DAC permission checks | `root` |
| System user | 1-999 | For service processes; usually no login shell | `sshd`, `www-data`, `nobody` |
| Regular user | 1000+ | Everyday login accounts | Every account you create |

```bash
$ head -2 /etc/passwd
root:x:0:0:root:/root:/bin/bash
daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin

$ awk -F: '$3 >= 1000 {print $1, $3}' /etc/passwd
alice 1000
```

Each `/etc/passwd` line has seven colon-separated columns: username, password placeholder, UID, GID, comment, home directory, login shell. Setting the shell to `/usr/sbin/nologin` (or `/sbin/nologin`) blocks interactive login for that account -- the standard practice for system accounts, since a service process does not need a "login" step to start.

## 3. Core Config Files

Three files with clear division of labor; changing any of them affects the system immediately:

| File | Content | Permissions | Stores password? |
|------|------|------|-------------|
| `/etc/passwd` | Username, UID, GID, shell and other public info | 644 (world-readable) | No (password field is `x` placeholder) |
| `/etc/shadow` | Password hash, expiry policy | 640 (root and shadow group only) | Yes |
| `/etc/group` | Group name, group GID, member list | 644 | No |

A `/etc/passwd` line looks like `alice:x:1000:1000:Alice Chen:/home/alice:/bin/bash` -- seven columns: username, password placeholder (the real hash lives in shadow), UID, GID, GECOS comment, home directory, shell. A `/etc/shadow` line is colon-cut into nine segments: username, password hash (`$y$` prefix means yescrypt, the default on newer distros), days since last password change (from 1970-01-01), minimum age before change (0 = changeable anytime), maximum age (99999 = never expires), warning period (default 7 days), followed by reserved fields such as expiry date and inactivity date. `/etc/group` is `groupname:x:GID:member1,member2`; Debian/Ubuntu's `sudo` group and Arch/RHEL's `wheel` group both rely on this member list to decide who can elevate.

```bash
$ grep alice /etc/passwd
alice:x:1000:1000:Alice Chen:/home/alice:/bin/bash

$ sudo grep alice /etc/shadow
alice:$y$j9T$Xk3v...:19685:0:99999:7:::

$ grep -E 'wheel|sudo' /etc/group
sudo:x:27:alice,bob
wheel:x:10:alice
```

Moving passwords out of `/etc/passwd` into `/etc/shadow` is the result of historical evolution: early on all account info sat in one file, so any user who could read it could take every password hash for offline cracking. After the split, public and confidential data are physically separated, and `/etc/passwd` can safely stay world-readable (many legacy tools still rely on that to resolve usernames).

## 4. Creating and Deleting Users

```bash
$ sudo useradd -m -s /bin/bash alice   # -m creates the home dir; Debian's default shell is dash, so specifying bash explicitly is safer
$ sudo useradd -m alice                # Arch and RHEL default to bash already; -s can be omitted
$ sudo passwd alice                    # Interactive password setup; you will be prompted twice
$ sudo userdel -r alice                # -r removes the home directory too
userdel: home/alice not found so not removed
```

**Common trap**: if `userdel -r` reports `not found so not removed`, the home directory path usually does not match the record in `/etc/passwd` (say you manually `mv`'d the directory). Do not reflexively `rm -rf /home/alice` -- first `grep alice /etc/passwd` to confirm what the sixth column actually says. Also, when the home directory lives on a network filesystem such as NFS, `-r` behavior is affected by `USERDEL_CMD` and `REMOVE_HOME` in `/etc/login.defs`; always check before batch-cleaning accounts on shared storage.

## 5. Typical usermod Scenarios

`usermod` is the most frequent modification command in daily work; a few usages you must remember:

```bash
$ sudo usermod -aG docker alice   # Append to supplementary groups; -a is append, never omit it!
$ sudo usermod -G docker alice    # Dangerous: omitting -a becomes "replace" and kicks alice out of sudo, adm, etc.
$ sudo usermod -s /bin/zsh alice  # Change the login shell
$ sudo usermod -L alice && sudo usermod -U alice   # Lock / unlock (prepends ! to the password field)
$ sudo usermod -d /home/alice2 -m alice            # Change home dir and move data
$ sudo usermod -c "Alice Chen" alice               # Change the comment field
```

After locking, check status with `sudo passwd -S alice`; an `L` in the second column means locked. After changing supplementary groups you **must log in again** for the new permissions to apply to existing sessions: the supplementary group list is read into process credentials once at login, and a running shell will not refresh on its own. Verify by opening a fresh SSH session and running `id`.

## 6. Group Management

```bash
$ sudo groupadd devops
$ getent group devops
devops:x:1001:alice,bob
$ sudo gpasswd -M alice,bob,carol devops   # Batch-write the member roster from the group's perspective
$ groups alice
alice : alice sudo devops
$ sudo groupdel devops                     # Refuses if members remain; clear the members first
```

`gpasswd -M` (set member list) and `usermod -aG` (append someone to a group) are two complementary operations: the former sets the whole roster "group-centric", the latter appends "person-centric". When bulk-initializing team accounts, `gpasswd -M` writes the full roster in one shot and is less error-prone.

## 7. sudo Versus Direct root

**Why sudo is preferred over always being root**: root (UID 0) has no permission boundary, so one careless `rm -rf /var/lib/mysql` is a production incident. `sudo` brings three benefits direct root login lacks: every elevation has a clear triggering action (auditable), privileges are held only briefly when needed (least privilege), and credentials are automatically revoked after a timeout (usually 15 minutes). Audit log location varies by family -- Debian/Ubuntu use `/var/log/auth.log`, RHEL/CentOS/Rocky and Arch use `/var/log/secure` (Arch may write only to the journal by default; use `journalctl -t sudo` to check).

The sudo qualification group convention differs across the three families, and this is the most common pitfall when working across distros:

| Distro family | Qualification group | Default sudoers rule |
|-----------|--------|------------------|
| Debian/Ubuntu | `sudo` | `%sudo ALL=(ALL:ALL) ALL` (first user created at install is auto-added) |
| Arch | `wheel` | `%wheel ALL=(ALL:ALL) ALL` (bundled with the base sudo package; the user must add themselves to wheel) |
| RHEL/CentOS/Rocky | `wheel` | `# %wheel ALL=(ALL) ALL` (commented out by default; must be uncommented manually) |

```bash
$ sudo usermod -aG sudo alice    # Debian/Ubuntu: just add to the sudo group
$ sudo usermod -aG wheel alice   # Arch / RHEL family: add to the wheel group
$ sudo visudo                    # RHEL family also needs a sudoers edit; uncomment # %wheel ALL=(ALL) ALL
```

Editing sudoers **must use `visudo`**, which performs a syntax check before saving and refuses to write on error. Editing `/etc/sudoers` directly with `vim` and leaving a syntax error means every subsequent `sudo` call fails -- and if you happen to be the only administrator, you have locked yourself out of the system and are left with a Live USB rescue. The safer approach is to drop a standalone file in `/etc/sudoers.d/` (Debian/Ubuntu's `010_admin`, or any filename without a `.`), with just one line:

```text
alice ALL=(ALL:ALL) ALL
```

To verify the config is in effect, switch to the target user and run `sudo -l`, which lists exactly what the current user is allowed to run. No output or a `not allowed` message means the group is not yet active (log in again) or the sudoers rule is wrong. This is the first command to run when debugging "why can I not sudo".

```bash
$ su - alice
$ sudo -l
User alice may run the following commands on ubuntu-lab:
    (ALL : ALL) ALL
```

**A counterexample**: enabling passwordless sudo for everyone (`NOPASSWD:ALL`) looks convenient but lets anyone who gets an SSH session (including a compromised service account) elevate at zero cost. The correct approach is to concentrate elevation in a small admin group and never let a service account (such as `www-data` or `nginx`) appear in the sudo group.

## 8. User Switching

```bash
$ su - alice     # Correct: the "-" loads the target user's full login environment (HOME, PATH, and shell rc all reset)
$ su alice       # Dangerous: the current environment (including root's PATH) is kept, easy to mistype
$ sudo -u www-data -H php /var/www/html/index.php   # Run a single command as another user
$ sudo -i        # Run as root: interactive root shell that loads root's login environment
```

The easily overlooked `-` in `su - username` decides whether you are "acting as alice" or "accidentally pointing HOME at alice inside a leftover root environment". When scripting batch user switches, `su - user -c 'command'` is more reliable than a bare `su user`.

## 9. Common Traps

1. **Dropping the `-a` in `usermod -aG`**. As noted, `-G` alone clears the other supplementary groups. Build the muscle memory: adding to a group is always `-aG`. Verify with `id username`, comparing the groups list before and after.

2. **Changing groups without logging in again**. Supplementary groups do not hot-update; `newgrp groupname` in an SSH session only applies to the current shell temporarily. Persistent effect requires a reconnect.

3. **Editing `/etc/sudoers` directly**. Use `visudo`, or drop files in `/etc/sudoers.d/`. A syntax error breaks every sudo call.

4. **Deleting a user and orphaning shared resources**. `userdel -r` only handles the home directory; if the user created files in a shared directory (such as `/srv/git`), deleting the account leaves those files with an "orphan UID" that `chown` cannot restore. Before a bulk cleanup, scan with `find /srv -uid <UID>`.

5. **Giving a system account an interactive shell**. Opening `/bin/bash` for accounts like `www-data` widens the attack surface -- once a web app gets a GetShell, the attacker immediately has an interactive shell. Keep system accounts on `/usr/sbin/nologin`.

6. **Copying Debian docs to add a `sudo` group on Arch**. Arch's qualification group is `wheel`; `usermod -aG sudo` on Arch errors out because the group does not exist (or creates a useless new group), and you will then find sudo still does not work.

## References

- Arch Wiki - Users and groups -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Users_and_groups)
- Arch Wiki - sudo -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Sudo)
- Bird's Private Recipes - User and Group Management -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0410accountmanager.php)
- Debian Handbook - System Administrator's View -- [debian.org](https://www.debian.org/doc/manuals/debian-handbook/)
- RHEL 9 - Managing Users and Groups -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_basic_system_settings/)
- `man useradd`, `man usermod`, `man userdel`, `man groupadd`, `man gpasswd`, `man sudoers`, `man visudo`

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/basic/README.md)
- [users](/basic/users.md)
- [application-scenarios](/research/application-scenarios.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [pam-sudo](/security/pam-sudo.md)
- [ldap](/server/ldap.md)