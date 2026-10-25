# Security Basics

## Chapter Introduction

Traditional Linux permissions (rwx + user/group) have a structural weakness: **root decides everything**. When a web service is compromised, the attacker usually gets the identity of the process running that service; if the process runs as root, or can happen to escalate through sudo, the DAC permission model fails across the board -- file permissions cannot stop a process that is already root. Mandatory Access Control (MAC) is the second gate designed for exactly this: even if a process has uid 0, the kernel still denies access as long as the security policy does not say "it is allowed to touch this file."

This chapter records SELinux, the most mainstream MAC implementation on Linux: what it is, how to choose among the three modes, the standard command flow for daily triage, and why file contexts are more reliable than `chcon`. It also contrasts Debian/Ubuntu's AppArmor with Arch's default no-MAC situation, building a full picture of the three families' security stacks so you do not copy RHEL documentation commands straight onto another distribution.

Security basics are more than SELinux. This chapter starts from the limits of DAC to introduce the MAC concept, then unfolds SELinux across four sections: **concepts** (security contexts and type enforcement), **modes** (the trade-offs of Enforcing/Permissive/Disabled), **basic commands** (the triage flow with ausearch/restorecon/semanage), and **policy configuration** (fcontext persistence and the correct use of audit2allow). Each section contrasts the three families' default security stacks, so you will not look for `getenforce` on Ubuntu and not find it, and will not assume SELinux is on by default on Arch.

> Content adapted from the Red Hat SELinux documentation, the Arch Wiki, and each distribution's security documentation; see the references at the end.

## Why MAC Is Needed: Starting From the Ceiling of DAC

The rules of DAC (Discretionary Access Control) are simple: a file's owner decides who can read and write it, and root can change everything. That was enough in the era when "all programs are trusted," but on a shared server a fatal premise is broken -- **you cannot guarantee that every process is well-intentioned**.

A typical story: nginx starts as root and then drops privileges to `www-data`, which looks fine under DAC. But if nginx has a path traversal vulnerability and the attacker reads `/etc/shadow` through it -- DAC checks "does www-data have permission," and `/etc/shadow`'s group often happens to allow certain service groups to read it; worse still, if the process itself runs as root, DAC lets it through outright. MAC asks a different question: not "who is the user," but "**is this type of process allowed by policy to access that type of file?**" -- an `httpd_t` process wants to touch a `shadow_t` file, the policy has no such rule, the kernel denies, regardless of uid.

This is the core of SELinux: **taking the decision of "who can access what" back from the file owner into the hands of the system security policy**.

## The Three Families' Default Security Stacks (Establishing the Big Picture First)

This is one of the most important pieces of background in the chapter: **not every distribution has SELinux on by default**. Learning SELinux only from the RHEL perspective will not line up at all when you switch to Ubuntu or Arch:

| Distribution | Default MAC solution | Default state | Notes |
|--------------|----------------------|---------------|-------|
| RHEL/CentOS/Rocky/Fedora | **SELinux** | Enforcing | Enterprise default; the targeted policy protects key services |
| Debian/Ubuntu | **AppArmor** | Enabled (enforce mode) | Path-based MAC, profiles in `/etc/apparmor.d/`, a different mechanism from SELinux |
| Arch | **Neither enabled by default** | No MAC | The official project does not enable SELinux or AppArmor by default; SELinux requires building/installing userspace tools and policy yourself, and belongs to advanced custom scenarios |

Therefore:

- On the **RHEL family**, when you hit "a service is mysteriously denied," the first reaction is to check `ausearch -m avc`.
- On **Debian/Ubuntu** with the same problem, the first reaction is to check `aa-status` / the apparmor denials in `/var/log/kern.log`.
- On **Arch**, DAC + firewall + least privilege is the default baseline; SELinux/AppArmor are extra options for "I know what I am doing."

The four sections that follow focus on SELinux (it is the RHEL family's default stack, and also the most complete MAC textbook conceptually), but each section contrasts the other two families so you do not form the mistaken mental model that "Linux = SELinux."

> Content adapted from the Red Hat SELinux documentation and the Arch Wiki; see the references at the end of each section.

## What This Chapter Covers

- The essential difference between DAC and MAC
- The behavioral differences between SELinux's three modes (Enforcing/Permissive/Disabled) and the three families' defaults
- Being familiar with the standard triage flow: confirm the mode -> read denials with `ausearch` -> decide whether it is a boolean, a label, or a policy gap -> choose the minimal fix
- How to read type enforcement and security contexts (`user:role:type:level`)
- The correct use of `semanage fcontext` + `restorecon`
- Being able to explain the difference in positioning between AppArmor (Debian/Ubuntu default) and SELinux (RHEL default), and why Arch chose not to enable one by default

## Sub-Page Guide

| Chapter | What it answers | Suggested reading time |
|---------|-----------------|------------------------|
| [SELinux Concepts](./security/concept.md) | Why DAC vs MAC is needed; how to read a security context; how type enforcement makes decisions; the three families' MAC big picture | The first time you meet MAC, or when you cannot read `ls -Z` output |
| [SELinux Modes](./security/modes.md) | The consequences of Enforcing/Permissive/Disabled respectively; the three families' defaults; the boundary between `setenforce` and the config file; the correct way to switch modes | Before turning SELinux on, off, or debugging it |
| [SELinux Basic Commands](./security/commands.md) | Hands-on with `ausearch`/`setenforce`/`restorecon`/`semanage`/booleans/port labels; the standard triage flow | When a service is denied and you need to actually debug (the hands-on core of this chapter) |
| [SELinux Policy Configuration](./security/policy_configuration.md) | The differences between targeted/minimum/mls policies; why file contexts and fcontext beat chcon; the correct and dangerous uses of audit2allow | When you need to persistently allow custom paths or ports |

The pages are ordered by topic dependency; when triaging you can also go straight to [Basic Commands](./security/commands.md).

## Three-Family Differences at a Glance

| Item | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|--------------------|
| Default MAC | AppArmor | None (SELinux/AppArmor both optional) | SELinux |
| Default mode/state | AppArmor enforce | -- | SELinux Enforcing, targeted |
| Status command | `aa-status` | (if you enable SELinux yourself: `getenforce`) | `getenforce` / `sestatus` |
| Denial log location | `/var/log/kern.log`, journal | Depends on the enabled solution | `/var/log/audit/audit.log` |
| Temporary allow | `aa-complain` / edit a profile | -- | `setenforce 0` (temporary), booleans |
| Policy file location | `/etc/apparmor.d/` | -- | `/etc/selinux/targeted/` |
| Main triage command | `aa-status`, `dmesg \| grep apparmor` | -- | `ausearch`, `sealert` |

An easy pitfall: running `getenforce` on Ubuntu returns `None` or command not found -- **that is not an operator error, the machine simply does not use SELinux at all**. Likewise, copying the RHEL `setenforce` flow onto Arch will probably fail because the userspace tools are not installed. Confirm the distribution and the MAC solution first, then pick the command.

## Common Questions

**Q: SELinux is blocking a service from starting -- should I just turn it off?**
Not recommended. Turning it off is dismantling the second gate, and on the RHEL family a large number of services (httpd, samba, ftpd) have labels and booleans that assume SELinux is on. The correct path is to read the denial logs and make the minimal allowance with a boolean or an fcontext rule -- that is exactly the standard flow in the [Basic Commands](./security/commands.md) section. Only when the policy itself has a known bug that cannot be fixed for now should you use Permissive mode to collect logs without affecting the workload.

**Q: What is the difference between `setenforce 0` and editing `/etc/selinux/config`?**
`setenforce` is a runtime switch, lost on reboot, suitable for temporary verification; editing the config file is a persistent setting and requires a reboot (switching between Disabled<->Enforcing also requires relabeling the files). See [SELinux Modes](./security/modes.md) for details.

**Q: Does Ubuntu use SELinux at all?**
Ubuntu uses AppArmor by default rather than SELinux. Both are MAC implementations under the LSM (Linux Security Modules) framework, with different mechanisms: SELinux is based on type labels, AppArmor on file-path profiles. The concepts interlock; the commands do not.

**Q: Can you enable SELinux on Arch?**
Yes, but it is not the default path: you need to prepare kernel parameters (`lsm=...selinux...`) yourself, install the userspace tools, and replace a large number of core packages with SELinux-enabled builds, plus install and maintain the policy. For most Arch users this is a deliberate hardening project rather than an out-of-the-box feature; copying the RHEL documentation before you understand the details will probably leave you unable to log in.

**Q: I changed a label with `chcon` -- why did it revert after a reboot?**
`chcon` only changes the label of the current inode and does not write into the policy database; any moment that triggers `restorecon` (reboot, package update, `restorecon -R /`) recomputes the label from the default rules in the policy file. A persistent change must use `semanage fcontext`; see [Policy Configuration](./security/policy_configuration.md) for details.

## References

- Red Hat - Using SELinux -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/using_selinux/index)
- Red Hat - What is SELinux -- [redhat.com](https://www.redhat.com/en/topics/linux/what-is-selinux)
- Arch Wiki - SELinux -- [wiki.archlinux.org](https://wiki.archlinux.org/title/SELinux)
- Arch Wiki - AppArmor -- [wiki.archlinux.org](https://wiki.archlinux.org/title/AppArmor)
- Debian Wiki - SELinux -- [wiki.debian.org](https://wiki.debian.org/SELinux)
- Debian Wiki - AppArmor -- [wiki.debian.org](https://wiki.debian.org/AppArmor)
- Ubuntu community - AppArmor -- [help.ubuntu.com](https://help.ubuntu.com/community/AppArmor)
- AppArmor official site -- [apparmor.net](https://apparmor.net/)
- `man getenforce`, `man setenforce`, `man semanage`, `man ausearch`

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)
- [what_is_linux](/basic/introduction/what_is_linux.md)
- [log](log.md)
- [syslog](/basic/log/syslog.md)
- [services](services.md)
- [configuration_tools](/basic/services/configuration_tools.md)
- [log_management](/basic/services/log_management.md)
- [acl_permissions](/basic/users/acl_permissions.md)
- [README](/security/README.md)
- [hardening](/security/hardening.md)
