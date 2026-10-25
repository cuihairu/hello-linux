# SELinux Concepts

Traditional Linux permissions (rwx + user/group) have a structural weakness: **root gets the final say**. When a web service is breached, what the attacker usually gains is the identity of the process running the service; as long as that process is root, or can escalate through sudo, DAC falls apart across the board -- file permissions cannot stop a process that is already root. Mandatory Access Control (MAC) is the second gate built exactly for this: even when the process uid is 0, if the security policy does not say "allow it to touch this file", the kernel still refuses. SELinux (Security-Enhanced Linux) is the mainstream framework for implementing MAC in the Linux kernel, developed under NSA leadership and merged into mainline; today it is the default security stack of the RHEL family. Starting from DAC's flaws, this page lays out security contexts and Type Enforcement, then maps the full MAC picture across the three families against Debian/Ubuntu's AppArmor and Arch's default no-MAC stance.

> Content draws on the Red Hat SELinux documentation and the Arch Wiki -- see the references at the end.

## What This Page Covers

- Explain DAC's structural flaw clearly
- Read what each field of a security context `user:role:type:level` means
- Understand how Type Enforcement makes an access decision from a single allow rule
- Draw SELinux's complete decision flow: label match -> rule lookup -> allow/deny
- Compare the MAC landscape across the three distro families

## 1. Why MAC Is Needed: DAC's Structural Flaw

Before SELinux, Linux had only DAC (Discretionary Access Control): the check is based on **the process's uid/gid against the file's rwx bits**. This model has a flaw the owner cannot fix themselves -- **root is exempt**.

A real scenario makes this concrete. Suppose you configure nginx the way best practice says: start as root, bind port 80, then drop privileges to the `www-data` user. One day an attacker exploits a path-traversal bug in nginx and gains the ability to execute arbitrary commands as `www-data`:

```text
DAC's decision path:
  process uid=33 (www-data)
  target file /etc/shadow  owner=root group=shadow  mode 0640
  → www-data is neither root nor in group shadow → denied

Looks safe? Change the target:
  target file /var/lib/nginx/../../etc/ssh/sshd_config  (path crafted via the vulnerability)
  If any step loosens permissions, or the process still holds root capabilities (capabilities not fully dropped):
  process uid=0 → DAC lets it straight through ← the disaster happens here
```

The question DAC cannot answer is: **"should a web server process be allowed to read SSH configuration or write to system directories?"** -- regardless of which user runs it, the answer to this should be "no". DAC hands that decision to the file owner (usually root itself), so once a vulnerability breaks through the first layer of user identity, there is nothing left to stop it.

MAC (Mandatory Access Control) takes that decision back from the owner and gives it to the **system security policy**: the policy is set by security administrators (or the distro's policy team), and neither ordinary processes nor root may modify it. SELinux is one of the mainstream frameworks for implementing MAC in the Linux kernel (via LSM, Linux Security Modules).

| Model | What it checks | Who can change the rules | Is root exempt |
|------|---------|-----------|--------------|
| DAC | uid/gid + rwx | The file owner | Yes, root is fully allowed |
| MAC (SELinux) | Security contexts + policy rules | Only policy management tools (requires loading a new policy) | No, root processes are equally constrained |

A classic illustration (from the Arch Wiki's MAC overview): even if you use `sudo` to escalate a process to root, as long as the SELinux policy does not say "this process may access that target resource", the escalation alone will not push it across a label boundary -- **MAC constrains type-to-type access and has nothing to do with uid**.

## 2. Security Contexts: Every Object Carries a Label

SELinux attaches a **security context** to every process and every file, in the form:

```text
user : role : type : level
  ↓      ↓      ↓      ↓
SELinux  SELinux  drives the decision   MLS level
user     role     core of policy        (only when MLS is on)
```

To see it in practice -- `ls -Z` for files, `ps -eZ` for processes (works on RHEL/CentOS/Rocky and on Debian/Ubuntu with the relevant tools installed; on Arch you must enable SELinux yourself before `-Z` is supported):

```bash
$ ls -Z /var/www/html/index.html
system_u:object_r:httpd_sys_content_t:s0  /var/www/html/index.html
# Read it: system_u=SELinux user  object_r=object role  httpd_sys_content_t=type  s0=low sensitivity level

$ ps -eZ | grep -E 'httpd|nginx' | head -3
system_u:system_r:httpd_t:s0       1523 ?  00:00:01 nginx: master
system_u:system_r:httpd_t:s0       1524 ?  00:00:00 nginx: worker
# The process type is httpd_t ("the httpd domain"); the file type is httpd_sys_content_t
```

In day-to-day decisions the field that actually matters is **type**: a process's type decides which domain it runs in, and a file's type decides which class of resource it belongs to. Under the targeted policy `user` and `role` are essentially fixed, so you can ignore them at first while troubleshooting; `level` only participates in comparison when MLS/MCS (multi-level security) is enabled, and under RHEL's default targeted policy it is usually `s0`, imposing no real restriction.

**Files with the same name can carry different labels, and different files can carry the same label** -- labels stack on top of Unix permission bits; neither replaces the other:

```bash
$ ls -lZ /var/www/html/
-rw-r--r-- root root system_u:object_r:httpd_sys_content_t:s0  index.html    # policy allows httpd to read
-rw-r--r-- root root system_u:object_r:default_t:s0           secrets.env    # wrong label, httpd cannot read
```

The two files have identical DAC permissions (both 644, both owned by root), but because the second one's type is not `httpd_sys_content_t`, a `httpd_t` process reading it is denied by SELinux -- this is the root cause of those mystifying "I fixed the permissions and still get a 500" problems.

## 3. Type Enforcement: SELinux's Decision Engine

Type Enforcement (TE) is SELinux's core mechanism under the targeted policy; rules look like:

```text
allow httpd_t httpd_sys_content_t : file { read open getattr };
#  ↑rule  ↑subject type ↑object type     ↑allowed class and operations
```

Read it as: **"allow a process of type `httpd_t` to perform read/open/getattr on a file of type `httpd_sys_content_t`"**. Any combination without an explicit allow is denied by default -- this is MAC's deny-by-default principle, structurally identical to a firewall.

So the logs you see while troubleshooting (AVC denial records) are organized around the same triple; reading one AVC line pins down both ends of the problem:

```text
type=AVC msg=audit(2026-09-21 14:03:11.234:412) : avc:  denied  { name_connect }
  for  pid=1024 comm="httpd" dest=3306
  scontext=system_u:system_r:httpd_t:s0        ← who wants access (process type)
  tcontext=system_u:object_r:mysqld_port_t:s0  ← what it wants to access (target type)
  tclass=tcp_socket                            ← what operation it wants (connect to a TCP port)
```

What this record says: `httpd_t` tried to connect to port 3306, which is labeled `mysqld_port_t`; the policy has no corresponding allow rule, so it was denied. Which way to fix it depends on your intent -- should the web server be allowed to reach the database? Then enable the relevant boolean or fix the port label. Should it not? Then the denial is correct behavior and the policy needs no change. The [Basic Commands](./commands.md) page gives the full three-step troubleshooting flow.

## 4. The Complete Decision Flow

The check order for a single file access:

```text
process calls open()
   │
   ├─1 DAC check (uid/rwx/ACL) ── fails → EACCES (an ordinary Permission denied)
   │         ↓ passes
   ├─2 LSM/SELinux check
   │     subject: httpd_t (process label)
   │     object:  shadow_t (file label)
   │     class:   file
   │     operation: read
   │         ↓
   │     policy lookup: allow httpd_t shadow_t : file read ?
   │         ├─ rule found → allow, go to 3
   │         └─ no rule → log an AVC denial → EACCES
   │
   └─3 kernel performs the actual read/write
```

Two key points:

1. **DAC runs before MAC**. An access that does not even pass DAC never reaches SELinux -- so when you troubleshoot "permission denied", you still need to `ls -l` to confirm rwx first, then `ls -Z` to confirm the label; both layers must be checked.
2. **The difference between Enforcing and Permissive lies only in the "deny" branch of step 2**: Enforcing really refuses and writes a log; Permissive only writes the log and lets the access through in practice. This is exactly the rationale for using Permissive mode to collect a complete denial list and then fixing the policy in one pass (see [Modes](./modes.md)).

## 5. The MAC Landscape Across the Three Families: SELinux Is Only One Option

Repeating the cross-distro perspective of this chapter -- **do not equate "SELinux" with "MAC on Linux"**:

**RHEL/CentOS/Rocky/Fedora**: SELinux is the default security stack and defaults to Enforcing; the `targeted` policy protects key daemons such as httpd, named, and dhcpd, while user processes are largely unrestricted. The whole toolchain (`semanage`, `ausearch`, `sealert`) works out of the box, and the commands in the rest of this chapter assume that environment.

**Debian/Ubuntu**: what is enabled by default is **AppArmor**, not SELinux. AppArmor is also built on the LSM framework, but it defines profiles by **file path** rather than by type label:

```bash
# Check AppArmor status on Debian/Ubuntu
$ sudo aa-status
apparmor module is loaded.
34 profiles are loaded.
14 profiles are in enforce mode.
   /usr/sbin/tcpdump ...
0 profiles are in complain mode.
```

Profiles live in `/etc/apparmor.d/`, and denial logs usually go to `/var/log/kern.log` or the journal. Conceptually AppArmor's "profile-path" maps to SELinux's "domain-type", but the commands, log formats, and policy syntax are completely different -- looking for `ausearch -m avc` on Ubuntu will come up empty. Debian also offers SELinux as an option (`wiki.debian.org/SELinux`), but it requires explicit installation and configuration and is not the default.

**Arch**: the official baseline **enables neither SELinux nor AppArmor by default**. This is not an oversight but a design trade-off of Arch: it provides near-upstream rolling updates and minimal default configuration, and leaves whether to enable MAC -- and which one -- to the user's decision. The Arch kernel has included SELinux support since 4.18, but the userspace tools, the policy, and the many core packages that need recompiling to link against libselinux must all be handled by you (see [Arch Wiki - SELinux](https://wiki.archlinux.org/title/SELinux)); this is a clearly advanced customization scenario. AppArmor can likewise be installed and enabled by hand. On the vast majority of Arch servers, what actually does the perimeter protection is firewall + DAC + a minimal install.

**The practical conclusion for operators**: cross-distro scripts should not assume `getenforce` is available; on the RHEL family use `ausearch` for troubleshooting, on Debian/Ubuntu use `aa-status`, and on Arch first `cat /sys/kernel/security/lsm` to see which LSM modules are loaded before deciding which toolset to use.

## 6. Common Pitfalls

1. **Checking rwx but not labels**: `ls -l` shows 777 and it is still denied -- nine times out of ten the type is wrong, so use `ls -Z` to compare against a normal file.
2. **Treating an AppArmor error as an SELinux problem**: Ubuntu/Debian default to AppArmor; `ausearch` finding nothing is normal there, so look at `aa-status` and kern.log instead.
3. **Skipping DAC and going straight to policy**: the MAC check comes after DAC; when DAC does not pass, changing the SELinux policy does nothing at all. Fix the permission bits first, then look at labels.
4. **Copying RHEL commands verbatim onto Arch**: without the SELinux userspace tools by default, `getenforce`/`semanage` are both unavailable; first check whether `/sys/fs/selinux` is mounted.
5. **Confusing the `user` field with a Unix user**: `system_u` is a SELinux user identity, unrelated to whether the logged-in user is root or a regular user. Do not try to use it to identify "who did this" -- use `ausearch -ui` to look up the Unix uid.

## References

- Red Hat - Using SELinux -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/using_selinux/index)
- Red Hat - What is SELinux -- [redhat.com](https://www.redhat.com/en/topics/linux/what-is-selinux)
- Arch Wiki - SELinux -- [wiki.archlinux.org](https://wiki.archlinux.org/title/SELinux)
- Arch Wiki - AppArmor -- [wiki.archlinux.org](https://wiki.archlinux.org/title/AppArmor)
- Debian Wiki - SELinux -- [wiki.debian.org](https://wiki.debian.org/SELinux)
- Debian Wiki - AppArmor -- [wiki.debian.org](https://wiki.debian.org/AppArmor)
- `man ls` (`-Z`), `man ps` (`-Z`), `man audit2why`

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/basic/README.md)
- [security](/basic/security.md)
- [modes](modes.md)
- [policy_configuration](policy_configuration.md)
- [glossary](/glossary.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [selinux](/security/selinux.md)
- [samba](/server/samba.md)
