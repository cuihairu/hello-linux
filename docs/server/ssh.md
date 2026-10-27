# SSH Remote Login

The first thing to configure on a freshly installed server is remote login: every deployment, troubleshooting session, and backup afterward travels through this channel. What makes SSH special is that it is usually the only pre-authorized public entry point on a machine, so getting it wrong does not mean "a feature does not work" -- it means the whole machine goes out of reach. This page walks the server-side main line in the order "install it -> run it -> get connected -> keep control"; client usage is covered in [Network Tools](../commands/network/network-tools.md), the hardening checklist in [Security Hardening](../security/hardening.md), and key generation in [Encryption](../security/encryption.md).

> Content draws on the official OpenSSH documentation, the Arch Wiki, and RHEL documentation; see the references at the end. Package version facts were verified on 2026-10-10 against the official Arch package API and the CentOS Stream 9 mirror directory.

## What This Page Covers

- Installing openssh-server on all three distro families
- Closing the loop on key authentication: generating, distributing, and disabling password login, knowing why at every step
- Reading the core directives of sshd_config and verifying your edits with `sshd -t` and `sshd -T`
- Freezing aliases, jump hosts, and connection reuse into `~/.ssh/config`
- Handling the firewall and SELinux correctly after changing the port, and locating common failures from the logs

## 1. Installation and Service

| Action | Debian/Ubuntu | RHEL/Rocky | Arch |
|------|---------------|-----------|------|
| Install | `apt install openssh-server` | `dnf install openssh-server` | `pacman -S openssh` |
| Service unit | `ssh.service` | `sshd.service` | `sshd.service` |
| Config directory | `/etc/ssh/` | `/etc/ssh/` | `/etc/ssh/` |
| Main config | `/etc/ssh/sshd_config` | same | same |
| Logs | journal (the `ssh` unit) | journal (the `sshd` unit) | journal (the `sshd` unit) |

The service name difference is the first troubleshooting trap: the Debian-family unit is called `ssh`, while RHEL-family systems and Arch use `sshd`, so `systemctl status ssh` on RHEL reports that the unit does not exist. Current package layout: Arch's openssh lives in core (10.6p1); on EL9 the openssh/openssh-clients/openssh-server trio lives in BaseOS (9.9p1).

```bash
$ sudo systemctl enable --now sshd    # On Debian-family systems, replace sshd with ssh
$ sudo systemctl status sshd         # Confirm active and listening on 22
$ sudo ss -tlnp | grep :22           # The listening address matches the process
```

Before changing the port (`Port 2222`), finish the firewall and SELinux preparation in section 5 and only then restart the service -- otherwise you are actively cutting your own management channel.

## 2. Key Authentication

Password login works, but brute-force scripts watch exactly that password prompt on port 22. The production baseline is key-only authentication, in four steps:

```bash
$ ssh-keygen -t ed25519 -C "ops@example.com"   # generated on the client; the passphrase may be empty for automation
$ ssh-copy-id -i ~/.ssh/id_ed25519.pub user@server   # appends the public key to the server's ~/.ssh/authorized_keys
$ ssh user@server                            # verify the key logs in before touching server config
$ sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
$ sudo systemctl restart sshd
```

The order matters: verify the key works first, then disable password login. Do it the other way around and any mistake in key distribution locks you out for good. The permissions on `authorized_keys` are the second gate -- on the server, `~/.ssh` must be 700 and `authorized_keys` 600, owned by the logging-in user; if the permissions are looser, sshd refuses to use the key outright (the log says `Authentication refused: bad ownership or modes`).

`ssh-agent` manages the key passphrase: start it with `eval $(ssh-agent)`, add the key with `ssh-add ~/.ssh/id_ed25519`, and subsequent ssh sessions on the same machine stop asking for the passphrase. Automation scenarios (CI, batch scripts) use passphrase-less keys, but recognize that the key file itself then becomes the sole credential -- keep its spread across disk tight.

## 3. Core Directives of sshd_config

The main config file is `/etc/ssh/sshd_config`; after editing, check the syntax with `sudo sshd -t` first, then restart. The common directives fall into four groups by purpose:

| Group | Directives | Notes |
|----|------|------|
| Listening | `Port`, `ListenAddress` | must be set when changing the port; `ListenAddress 0.0.0.0` is the listen-everywhere default |
| Authentication | `PermitRootLogin`, `PasswordAuthentication`, `PubkeyAuthentication` | direct root login: recommended `no`; password login: recommended `no`; key login: keep `yes` |
| Admission | `AllowUsers`, `AllowGroups`, `DenyUsers` | an account-level whitelist; even if the password policy is bypassed, accounts outside the list cannot open a session |
| Session | `MaxAuthTries`, `LoginGraceTime`, `X11Forwarding`, `AllowTcpForwarding` | authentication attempt cap, handshake window, forwarding switches; the per-directive rationale and defaults are in [Security Hardening](../security/hardening.md), section 5 |

Two advanced mechanisms are worth knowing. A `Match` block overrides the main config conditionally -- for example, allowing password login only from one network:

```text
# /etc/ssh/sshd_config
PasswordAuthentication no
Match Address 10.0.0.0/8
    PasswordAuthentication yes
```

The drop-in directory `/etc/ssh/sshd_config.d/*.conf` takes priority over the main file, so edits made in a drop-in survive distro upgrades. After editing, read back the effective runtime values with `sudo sshd -T` -- what the config file says is not necessarily what the runtime adopts, since drop-ins and Match blocks can both rewrite lines of the main file.

## 4. Client Configuration

`~/.ssh/config` freezes common connections into aliases so you do not have to type the full set of options every time:

```text
# ~/.ssh/config
Host bastion
    HostName 203.0.113.10
    User ops
    IdentityFile ~/.ssh/id_ed25519

Host db-*
    ProxyJump bastion
    User ops
    ServerAliveInterval 60
    ControlMaster auto
    ControlPath ~/.ssh/cm-%r@%h:%p
```

`ProxyJump` reaches an internal machine through a jump host more directly than the older `ProxyCommand`, with less to misconfigure. Once `ControlMaster` is reusing connections, consecutive ssh sessions to the same batch of machines skip the repeated handshakes and batch operations run noticeably faster. On first connection, always verify the fingerprint by hand (pre-seed `known_hosts` or confirm in person); `StrictHostKeyChecking=no` in a script should only ever appear in a disposable, throwaway CI container.

## 5. Firewall and SELinux

After changing the port, the new port must be opened on both the firewall and the SELinux side; skipping either one produces the same symptom -- "connection refused even though the service is clearly running":

| Action | Debian/Ubuntu | RHEL/Rocky | Arch |
|------|---------------|-----------|------|
| Open 22 | `ufw allow ssh` | `firewall-cmd --add-service=ssh --permanent && firewall-cmd --reload` | no firewall by default; install ufw and follow the Debian column |
| Open a custom port | `ufw allow 2222/tcp` | `firewall-cmd --add-port=2222/tcp --permanent && firewall-cmd --reload` | same as the Debian column |
| SELinux port label | no SELinux by default | `semanage port -a -t ssh_port_t -p tcp 2222` | no SELinux by default |

On RHEL-family systems, forgetting `semanage` after changing the port is the most common "it no longer connects after the change": sshd starts on 2222, but SELinux only allows ports labeled ssh_port_t, the new port is not in that label set, and the connection is blocked by the kernel before the handshake even begins. `semanage port -l | grep ssh` reads back the current label set.

## 6. Further Hardening

Beyond key authentication and disabling root, there are three optional hardening layers, ordered from lowest to highest cost:

- **Brute-force rate limiting**: fail2ban watches the journal for authentication failures and bans IPs over the threshold; a lighter alternative is nftables limiting new connections per source IP. This repo's [Intrusion Detection](../security/intrusion-detection.md) page has the corresponding toolchain.
- **Certificate authentication**: a CA issues user certificates, and `TrustedUserCAKeys` names the trusted CA public key, removing the need to maintain `authorized_keys` per machine. Suited to teams with many machines and many people; the directives are governed by the sshd_config man page (verified present on OpenSSH 10.2 on this machine).
- **Two factors**: `AuthenticationMethods publickey,keyboard-interactive` layers a second PAM factor on top; this repo's [PAM and sudo](../security/pam-sudo.md) page covers the PAM wiring.

For every item you add, you must be able to say which attack it defends against and which clients it might affect; if you cannot, do not add it -- the full argument for this discipline is in [Security Hardening](../security/hardening.md).

## 7. Common Failures

**Permission denied (publickey,password).** Run `ssh -v` first to see which key the client actually offered and whether the server accepted it; then check the owner and permissions of `~/.ssh` and `authorized_keys` (700/600); on RHEL-family systems also check SELinux (`ausearch -m avc -ts recent` or `/var/log/audit/audit.log`). Work through the three causes in that order -- most problems are the first two.

**Connection refused.** Service not running, wrong port, firewall blocking -- all three look identical. Check the service with `systemctl status sshd`, the listener with `ss -tlnp | grep :22`, and the firewall with `firewall-cmd --list-all` or `ufw status`, ruling out one layer at a time.

**Host key verification failed.** The fingerprint changed after the server was reinstalled or replaced; `ssh-keygen -R host` clears the old record so you can verify again. Do not take the shortcut of deleting `known_hosts` -- that amounts to giving up fingerprint verification.

**Cannot connect after changing the port.** Check both the firewall and SELinux per section 5, and make sure the client command carries `-p 2222`.

**Locked out after disabling passwords.** This is a change-discipline problem, not a technical one: before changing the authentication method, open a new session, verify it works, and only then close the old one -- with the verification recorded in the change ticket. The console and out-of-band management (IPMI, cloud console) are the last escape hatches; confirm one is available before you touch sshd.

## 8. Division of Labor with Other Pages

Client command usage (`-J` jump hosts, `-L` local forwarding, `-v` debugging) is in [Network Tools](../commands/network/network-tools.md); the sshd_config hardening checklist and the three-step change discipline are in [Security Hardening](../security/hardening.md), section 5; key generation and passphrase management are in [Encryption](../security/encryption.md); account consistency across machines is handled by [LDAP Unified Account Management](./ldap.md) and SSSD, and SSH's `AllowUsers` whitelist can be layered on top of directory accounts.

## References

- OpenSSH official documentation -- [openssh.com/manual.html](https://www.openssh.com/manual.html)
- Arch Wiki: OpenSSH -- [wiki.archlinux.org/title/OpenSSH](https://wiki.archlinux.org/title/OpenSSH)
- RHEL documentation (sshd configuration and SELinux port labels) -- [docs.redhat.com](https://docs.redhat.com/)
- man pages -- man sshd_config, man ssh_config, man ssh-keygen

<!-- BACKLINKS-AUTO -->
## Related Pages

- [knowledge](/knowledge.md)
- [README](/research/README.md)
- [application-scenarios](/research/application-scenarios.md)
- [authoritative-books](/research/authoritative-books.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [gap-fill](/research/gap-fill.md)
- [README](README.md)
- [ci-cd](ci-cd.md)
- [cloud-computing](cloud-computing.md)