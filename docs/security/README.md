# Security

## Introduction

Linux system security is a foundational skill for operations and development, covering core topics like firewalls, intrusion detection, and encryption. Building on the fundamentals chapter's "Security Basics" (SELinux concepts), this chapter shifts attention to the five things a real networked server must handle: **block traffic that should not come in, detect changes that have already happened, protect data in transit and at rest, shrink the system's own attack surface, and control who can escalate privileges and what processes can touch**.

Many people's "security" stops at two actions: change the password after install, and run `apt upgrade` whenever there is time. Both are worth doing, but they are far from real threats. An SSH port exposed on the public internet gets hundreds to thousands of password brute-force attempts per hour; a planted web shell will not trigger any "wrong password" alert -- it quietly modifies a few files; and an old hard drive pulled from a server, unless encrypted, has its database exports sitting in plaintext.

The security chapter builds an intuition for a **layered defense**, not a tool catalog:

1. **Prevention layer** -- a firewall shrinks the attack surface to "ports the business actually needs," and SSH hardening plus minimal installs cut down the number of exploitable entry points. Do this layer well and most scans and brute-force attempts never reach your service at all.
2. **Detection layer** -- the prevention layer will inevitably have gaps, so you need file integrity checks (AIDE), host auditing (auditd), and reactive banning (Fail2Ban) to answer "was the system touched while I was not looking."
3. **Confidentiality layer** -- TLS protects network transmission, GPG protects the trust chain of files and software distribution, and LUKS protects static data when a disk is stolen.
4. **Baseline layer** -- hardening freezes the three layers above into a reviewable baseline: services that should be off are off, a patching cadence is set, and SSH configuration is auditable.

The four layers have a clear dependency order: talking about intrusion detection without a firewall is like hunting for a needle in noise; without encryption, no matter how sensitive the detection, data can still be read straight off; and without a hardening baseline, the first three layers' configuration drifts out of effect over time. That is also why the chapters are in this order.

The fifth thread is carried by two dedicated chapters: [PAM and sudo](./pam-sudo.md) governs "the privileges a person gets" -- who can authenticate, who can escalate, and where the audit trail is after escalation; [SELinux in Practice](./selinux.md) governs "the resources a process is allowed to touch" -- at which kernel layer over-privileged access is blocked, and how to fix things correctly after a denial. The two are depth-extensions of the prevention layer and the baseline layer, respectively.

> Content adapted from the Arch Wiki, Bird's Private Recipes (Lin's Linux Administration Guide), and each tool's official documentation; see the references in each chapter.

## Contents Index

The pages are ordered by the dependency between protection, detection, encryption, baseline, and privilege management; when triaging a single issue you can jump straight to the relevant topic:

| Stage | Chapter | Why it goes here |
|------|------|----------------|
| 1. Shrink the entry | [Firewall](./firewall.md) | The first gate of security: decide "who is allowed in" before anything else |
| 2. Protect data | [Encryption](./encryption.md) | Traffic that gets through the door still needs protection against eavesdropping and tampering; SSH key login is the prerequisite for the hardening that follows |
| 3. Spot anomalies | [Intrusion Detection](./intrusion-detection.md) | Prevention has gaps, so file integrity, audit logs, and Fail2Ban fill them in |
| 4. Freeze the baseline | [Hardening](./hardening.md) | Collapse the first three steps, along with services, patches, and MAC, into one reviewable baseline |
| 5. Control escalation | [PAM and sudo](./pam-sudo.md) | The firewall blocks traffic; this page governs "who can get root, and what they can do once they have it" |
| 6. Last-resort MAC | [SELinux in Practice](./selinux.md) | MAC is the final layer of the baseline, and a frequent visitor in 403 triage |
| 7. Second MAC engine | [AppArmor in Practice](./apparmor.md) | Ubuntu/Debian's default mandatory access control: writing path-based profiles and debugging, read alongside SELinux |

A practical self-check: these pages assemble the relevant practices, and you can use them to answer a fixed set of questions against a brand-new VM -- "What is this machine's firewall default policy, how does SSH authenticate, how would I find out if a file was tampered with, which services are redundant, where do I check logs for security events, who maintains the sudo rules, and where do I look up SELinux denials." If you can answer all seven, you have passed this chapter.

## The Three Families' Security Stacks at a Glance

The **default security stacks of the three distribution families differ a lot**, and this is the single most important piece of background for this chapter. Even "open up a firewall" uses completely different commands across families; and "check an SELinux denial" is not even possible on Ubuntu -- there is no `getenforce` at all:

| Item | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|--------|---------------|------|-------------------|
| Default firewall | `ufw` (installed on Ubuntu by default, not enabled; Debian servers often do not pre-enable it) | No default; pick `nftables`/`iptables`/`ufw` yourself | `firewalld` enabled by default |
| Firewall front end | `ufw` (iptables/nftables underneath) | `nft` is the kernel-native interface; Arch's iptables package defaults to the nft backend | `firewall-cmd` |
| Mandatory access control | AppArmor (enabled by default) | Neither SELinux nor AppArmor enabled by default | SELinux (Enforcing) |
| Authentication log | `/var/log/auth.log` | journal (a text file only appears after installing rsyslog) | `/var/log/secure` |
| Audit framework | `auditd` must be installed yourself | The `audit` package must be installed yourself | `auditd` installed and enabled by default |
| Install a security tool | `sudo apt install package` | `sudo pacman -S package` | `sudo dnf install package` |

Every subpage in this chapter gives a three-family installation comparison. Common security tools all live in the official Arch repositories, so `pacman` is enough -- no AUR needed:

```bash
# Debian/Ubuntu
sudo apt install ufw aide fail2ban lynis gnupg

# Arch
sudo pacman -S ufw aide fail2ban lynis gnupg

# RHEL/CentOS/Rocky (fail2ban/lynis etc. are often in EPEL)
sudo dnf install epel-release
sudo dnf install firewalld aide fail2ban lynis gnupg2
```

Note two package-name details: on Arch, `pacman -S audit` provides the auditd daemon; on the RHEL family the GPG package is named `gnupg2` (Debian/Arch use `gnupg`). Before installing, use `pacman -Ss keyword`, `apt search`, and `dnf search` to confirm each one -- a habit common to all three families.

## Reading the Subpages

This chapter has six subpages, each answering a different class of question with no overlap:

- [Firewall](./firewall.md) -- the three families' default firewall differences, the zone and rule models, how to design a default-deny policy, the "allow first, enable second" lockout pitfall, and how this page divides work with the Network chapter's operation quick reference. Answers "who should traffic be allowed in for."
- [Intrusion Detection](./intrusion-detection.md) -- the split of duties between file integrity (AIDE) and host intrusion detection, Fail2Ban's reactive banning, auditd audit rules and how they connect with journald, and where rkhunter/OSSEC fit. Answers "was the system touched, and how do I find out."
- [Encryption](./encryption.md) -- why both symmetric and asymmetric are needed, the TLS handshake and certificate chain, SSH key authentication, GPG signing and the trust chain, and the concepts and risks of LUKS disk encryption. Answers "how do I keep data secret, and how do I prove identity."
- [Hardening](./hardening.md) -- minimal installs, cleaning up redundant services, patching cadence, SSH hardening, kernel parameters, the three families' default MAC differences, and a baseline self-check. Answers "can this machine's attack surface get any smaller."
- [PAM and sudo](./pam-sudo.md) -- how the PAM authentication stack is organized, sudoers rules and delegation, NOPASSWD and escalation auditing, and common denial errors. Answers "who can get root, and what they can do once they have it."
- [SELinux in Practice](./selinux.md) -- reading the AVC triple, labels and port/boolean adjustments, the audit2allow loop, and troubleshooting three real sites: httpd, Samba, and NFS. Answers "where does the kernel block a process overstepping, and how do I fix it correctly."

Keep the boundaries with other chapters in mind: **the "how to open a port" operation quick reference for firewalls is in [Network · Firewall](../network/firewall.md); this chapter takes the security-policy perspective** (default deny, allowlist, logging and rate limits); **SELinux/AppArmor concepts are in [Basics · Security Basics](../basic/security.md)**, and the hands-on work after the concepts (AVC reading, labels, booleans, audit2allow) lives here in [SELinux in Practice](./selinux.md); the hardening page only discusses its place in the baseline; **log protocols and rotation are in [Basics · Logging System](../basic/log.md)**, and this chapter only covers where to look for security events.

## What This Chapter Covers

- Understanding the layered defense: what each of prevention (firewall), detection (IDS/audit), confidentiality (encryption), and baseline (hardening) solves
- Familiarity with the three families' default firewall differences
- Understanding the division of labor between symmetric and asymmetric encryption
- Basic usage of AIDE file integrity checks and auditd audit rules
- Being able to review a server against the principle of minimalism: redundant services, unpatched software, weak SSH configuration, tightened one by one
- The triage path for the PAM authentication stack and sudoers delegation

## Common Questions

**Q: I only have a single internal-network dev box -- do I really need to read the whole security chapter?**
Internal network does not mean safe, but the priority can shift. The minimum baseline is three things: switch SSH to key login, let the firewall allow only business ports, and keep the system patched. Intrusion detection and disk encryption can wait until you touch sensitive data or need a compliance audit.

**Q: I always mix up the three families' commands -- is there a rule of thumb?**
Yes: **any command with a distribution lineage in its name is not Linux standard** -- `ufw` is a Debian-family habit, `firewall-cmd` is a RHEL-family habit, and `nft` is the kernel interface all three families share; same logic for `apt`/`pacman`/`dnf`. See the three-family comparison table in the Commands chapter.

**Q: Does the firewall content here duplicate the Network chapter?**
Different perspective. The Network chapter answers "how do I quickly allow port 80"; this chapter answers "what should be denied by default, why allow before enable, how to configure logging and rate limits." Read them together: the Network chapter as a quick reference, this chapter as a policy design guide.

**Q: Do I have to use the distribution package manager to install security tools, or can I compile from source?**
Prefer the package manager (`apt`/`pacman`/`dnf`) in production, because the upgrade chain and signature verification are the repository's job. Source builds suit cases that need a specific version, but then you own the follow-up CVE tracking yourself -- not recommended.

## References

- Arch Wiki - Security -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Security)
- Arch Wiki - Pacman -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- Bird's Private Recipes (Lin's Linux Administration Guide) - System Security and Permission Control -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0410accountmanager.php)
- Debian Security Handbook -- [debian.org](https://www.debian.org/doc/manuals/debian-handbook/)
- Ubuntu Security -- [ubuntu.com/security](https://ubuntu.com/security)
- Red Hat Security Hardening -- [redhat.com](https://www.redhat.com/en/topics/security)
- CIS Benchmarks -- [cisecurity.org](https://www.cisecurity.org/cis-benchmarks/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [services](/basic/services.md)
- [log_management](/basic/services/log_management.md)
- [README](/hardware/README.md)
- [README](/network/README.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [README](/system-management/README.md)
