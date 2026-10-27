# FTP Server

FTP (File Transfer Protocol, RFC 959) is one of the earliest application-layer protocols on the internet, using a pair of TCP connections to list, upload, and download files. Its historical standing is beyond question, but in today's production environments the mainstream choice has quietly moved to SFTP running over SSH, and the reasons are not mysterious: FTP's control connection is plaintext for its entire lifetime, with `USER`/`PASS` crossing the network in the clear; a single session occupies port 21 plus port 20 (active mode) or a block of ten-odd passive ports, so firewall and NAT rules balloon accordingly; and it lacks the modern semantics of session encryption, auditing, and fine-grained authorization. Hence the common engineering decision: "new systems go straight to SFTP; deploy FTP only when you must support a legacy client or run an anonymous distribution directory." This page still explains FTP's working principles and a vsftpd deployment in full -- understanding the port behavior of active/passive mode is of great benefit when troubleshooting any protocol that traverses firewalls -- and gives the three-distro install comparison (Debian/Ubuntu with apt, Arch with pacman, RHEL/CentOS/Rocky with dnf) where needed. It is organized as "how it works -> selection -> three-distro install -> vsftpd configuration -> users and scenarios -> common traps -> log-based troubleshooting -> migrating to SFTP".

> Content draws on the official vsftpd and ProFTPD documentation and the Arch Wiki; see the references at the end.

## What This Page Covers

- Explaining the division of labor between FTP's control and data connections, and which network environments active and passive modes each suit
- Understanding why production has moved to SFTP
- Comparing the positioning of vsftpd and ProFTPD, and completing the install on the three distros (apt / pacman / dnf)
- Configuring the passive port range, chroot, and TLS, and getting to know the virtual user approach
- Diagnosing the high-frequency failures: wrong PASV address, refusal to start under chroot, LIST disconnects

## 1. How FTP Works: The Craft of Two Connections

### 1.1 Control Connection and Data Connection

What sets FTP apart is splitting "commands" and "data" onto two TCP connections. The client first connects to the server's **port 21** (the control connection); all interactive commands -- login, `LIST`, `RETR` (download), `STOR` (upload) -- travel over this connection as text; the actual file bytes go over a separate **data connection**. The benefit of splitting is that you can still send `ABOR` to abort in the middle of a large transfer; the drawback is that the data connection can be set up in two directions, which is exactly active and passive mode.

```text
Active mode:    client >=1024 port --21--> server
                server port 20 --------> client >=1024 port (data)
Passive mode:   client >=1024 port --21--> server
                client >=1024 port -------> server high port (data)
```

Active mode requires the **server to connect back to the client**. That was fine when both sides were directly on the public internet, but the moment the client hides behind NAT or a corporate firewall, the inbound SYN never reaches it -- listings hang, downloads time out, and yet the control connection "looks fine". Passive mode reverses the direction: the server opens one (or a range of) high port(s) first and tells the client "you come connect to me"; every connection is outbound from the client, which naturally punches through client-side NAT. Today's clients are almost all passive by default, and the cost falls on the server side: **the configured passive port range must be opened in the firewall**, or the control connection works fine and every file transfer dies.

### 1.2 Why Production Largely Moved to SFTP

Leaving FTP on legacy internal systems and putting new systems straight on SFTP is a judgment based on the following facts, not a bandwagon:

- **Encryption and credential safety.** Standard FTP sends passwords and file content in plaintext; FTPS (FTP over TLS) can encrypt but requires managing certificates and yet another batch of ports. SFTP is a subsystem of the SSH protocol, handling authentication, commands, and data over a single port 22, reusing the SSH setup you have probably already hardened.
- **Firewall and NAT friendliness.** SFTP has one port and needs none of the "passive port range plus NAT address rewriting" combination; the ops mental load shifts from "why is FTP acting up again" to ordinary SSH access control.
- **Permission model.** SFTP can naturally be restricted per SSH account (e.g. `ForceCommand internal-sftp` plus chroot), while FTP virtual users need extra PAM/database configuration to reach the same effect.
- **Ecosystem reality.** Mainstream automation tools, CI, and cloud storage gateways all treat SFTP support as table stakes; the ones still insisting on FTP are mostly legacy industry specifications or customer-mandated integration methods.

When is deploying FTP still worth it: public anonymous read-only distribution (the classic kernel mirror scenario), having to integrate with legacy devices/clients that only speak FTP, and internal systems with a large stock of FTP scripts whose rework cost is high. One thing to confirm while deciding: any new FTP deployment must enable TLS and restrict the passive port range -- do not let "compatibility with an old protocol" become "a new naked risk".

## 2. Selection: vsftpd or ProFTPD

Both are mature open-source FTP servers, positioned slightly differently:

| Dimension | vsftpd | ProFTPD |
|------|--------|---------|
| Design orientation | security and performance first, small codebase, few historical vulnerabilities | full-featured, Apache-like config style |
| Config shape | single file `/etc/vsftpd.conf`, options laid out flat | main config plus directory-level config like `.htaccess` |
| Typical users | anonymous large-file distribution, scenarios chasing the smallest attack surface | hosting scenarios needing complex permissions and per-directory overrides |
| TLS | built-in `ssl_enable` | built-in `mod_tls` |
| Virtual users | PAM + user database | native SQL/LDAP and other backends |

The rule of thumb: absent special directory-level needs, pick vsftpd -- its defaults are more conservative and there is plenty of community material; reach for ProFTPD only when you need "each directory with its own set of rules". Both install directly on all three distro families: Debian/Ubuntu use `apt install vsftpd` or `apt install proftpd-core`, Arch uses `pacman -S vsftpd` or `pacman -S proftpd`, and the RHEL family uses `dnf install vsftpd`. This page continues with vsftpd as its main line, because its passive mode and chroot behavior are the most instructive, and it is the preferred choice in most distros' default repositories.

## 3. Installation (Three Distros Compared)

The table below summarizes install, query, and remove commands; the rightmost column reflects Arch's `pacman` reality:

| Action | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Install vsftpd | `sudo apt install vsftpd` | `sudo pacman -S vsftpd` | `sudo dnf install vsftpd` |
| Install ProFTPD | `sudo apt install proftpd-core` | `sudo pacman -S proftpd` | `sudo dnf install proftpd` |
| Search | `apt search vsftpd` | `pacman -Ss ftp server` | `dnf search vsftpd` |
| Show package info | `apt show vsftpd` | `pacman -Qi vsftpd` | `dnf info vsftpd` |
| Show config file paths | `dpkg -L vsftpd` | `pacman -Ql vsftpd` | `rpm -ql vsftpd` |
| Remove | `sudo apt remove vsftpd` | `sudo pacman -R vsftpd` | `sudo dnf remove vsftpd` |

On the Arch side, remember two conventions: repository packages are always installed with `pacman -S` and upgraded with the system via `pacman -Syu` -- do not sync the database alone with `pacman -Sy` and then install; query config paths with `pacman -Ql vsftpd`, where Debian's `dpkg -L` and RHEL's `rpm -ql` are equivalent operations. Backing up config files before installing is a good habit on all three families; the config lives at `/etc/vsftpd.conf` on Debian/Arch and `/etc/vsftpd/vsftpd.conf` on the RHEL family.

### 3.1 Debian/Ubuntu

```bash
$ sudo apt update && sudo apt install vsftpd
$ sudo cp /etc/vsftpd.conf /etc/vsftpd.conf.bak
$ sudo systemctl enable --now vsftpd
```

### 3.2 Arch

```bash
$ sudo pacman -Syu vsftpd
resolving dependencies...
Packages (1) vsftpd-3.0.7-1

:: Proceed with installation? [Y/n] y
(1/1) installing vsftpd                            [######################] 100%
$ sudo systemctl enable --now vsftpd
$ pacman -Ql vsftpd | grep -E 'vsftpd.conf|service'
vsftpd /etc/vsftpd.conf
vsftpd /usr/lib/systemd/system/vsftpd.service
```

Arch's `vsftpd` package directly provides the `vsftpd.service` unit and `/etc/vsftpd.conf`; the anonymous root defaults to `/srv/ftp` (consistent with the FHS's positioning of `/srv`). Upgrade along with `pacman -Syu`; if you only want to refresh this one package, trigger the reinstall with the full dependency-resolving `pacman -S vsftpd` rather than manually unpacking binaries past the dependency manager.

### 3.3 RHEL/CentOS/Rocky

```bash
$ sudo dnf install vsftpd
$ sudo cp /etc/vsftpd/vsftpd.conf /etc/vsftpd/vsftpd.conf.bak
$ sudo systemctl enable --now vsftpd
```

Verify the service and port (the same acceptance standard on all three families):

```bash
$ systemctl is-active vsftpd
active
$ ss -tlnp | grep vsftpd
LISTEN 0 128 0.0.0.0:21 0.0.0.0:* users:(("vsftpd",pid=812,fd=3))
```

## 4. Core vsftpd Configuration

### 4.1 Basic Switches

In `/etc/vsftpd.conf` (on RHEL `/etc/vsftpd/vsftpd.conf`), a small number of switches decide "whether it works at all". After editing, run `systemctl restart vsftpd` -- vsftpd does not hot-reload its config.

```ini
listen=YES                    # standalone process mode; set to NO when hosted by xinetd
anonymous_enable=NO           # anonymous access should be off by default
local_enable=YES              # allow local users to log in
write_enable=YES              # allow write commands such as STOR/DELE
local_umask=022               # permission mask for uploaded files
chroot_local_user=YES         # lock local users into their own home directories
allow_writeable_chroot=NO     # see "Common Traps" below; do not change to YES lightly
xferlog_enable=YES            # transfer log
use_localtime=YES             # directory times in the local timezone
```

`chroot_local_user=YES` is the key to tightening permissions: without it, a user who runs `cd /etc` after logging in can see the entire server's file tree. Once locked into the home directory, the user's `/` is their home -- the most basic isolation an FTP server provides.

### 4.2 Passive Mode Ports: You Must Speak the Same Language as the Firewall

By default passive mode opens **random** ports above 1024, which a firewall cannot open one by one, so the range must be pinned down and the client told the public address:

```ini
pasv_enable=YES
pasv_min_port=10000
pasv_max_port=10100
pasv_address=203.0.113.10      # the server's public IP; for a domain name use pasv_addr_resolve=YES
```

How big should the range be? Each concurrent data connection takes one port; with `max_per_ip=5`, 100 ports are plenty, and too wide a range only enlarges the scan surface. The firewall only needs to open 21 and this range -- the complete nftables/firewalld syntax is general firewall knowledge, covered in the [Firewall](../security/firewall.md) page, and is not repeated here. Note that cloud environments add a **security group** layer: opening only the host's iptables and forgetting the security group produces symptoms identical to a firewall block.

`pasv_address` is mandatory behind NAT: without it, the server writes its own private IP into the `227 Entering Passive Mode (192,168,1,10,...)` reply, and of course the client times out connecting to that address. The way to judge is to look at the IP in the PASV reply from the client and check whether it is a public address.

### 4.3 Enabling TLS

Encrypting the control channel solves the "plaintext password" problem. Prepare a certificate first (use a CA-issued certificate in production; self-signed is fine for testing):

```bash
$ sudo openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout /etc/ssl/private/vsftpd.pem -out /etc/ssl/private/vsftpd.pem
```

```ini
ssl_enable=YES
allow_anon_ssl=NO
force_local_logins_ssl=YES
force_local_data_ssl=YES
rsa_cert_file=/etc/ssl/private/vsftpd.pem
rsa_private_key_file=/etc/ssl/private/vsftpd.pem
```

After `force_local_logins_ssl=YES`, unencrypted logins are refused; if an old client then cannot connect, first check whether it supports FTPS rather than rushing to turn encryption off.

## 5. User Management

### 5.1 Local Users and Directory Permissions

Creating a dedicated system user for scenarios like web uploads is far cleaner than sharing root or a common account:

```bash
$ sudo useradd -m -s /usr/sbin/nologin ftpupload
$ sudo passwd ftpupload
$ sudo chown -R ftpupload:ftpupload /var/www/html
```

Combined with `chroot_local_user=YES` plus `local_root`/`user_sub_token`, each user can be shown an isolated directory. Note the requirement that the home directory itself must not be writable (see the common traps); the upload directory should be a subdirectory of home with permissions granted separately.

### 5.2 Virtual Users: The Reality Differs per Distro

Virtual users decouple the "FTP account" from the "system account" -- the account lives in a database/file and maps to one low-privilege system user on login, so a leak still does not buy an SSH session. But the PAM ecosystems differ across the three families, so the approach must be explained per family; copying a cross-distro document verbatim will simply fail:

- **Debian/Ubuntu**: `db-util` provides `db_load`, which converts a plaintext account file into a `.db` database that `pam_userdb` reads; the PAM config is `auth required pam_userdb.so db=/etc/vsftpd/virtual_users`.
- **Arch**: current PAM no longer ships `pam_userdb.so`; the Arch Wiki's recommended route is `libpam_pwdfile` + `htpasswd` to generate the password file, with PAM reading `auth required pam_pwdfile.so pwdfile /etc/vsftpd/.passwd`. Do not copy Debian's `db_load` documentation onto Arch.
- **RHEL/CentOS/Rocky**: same `pam_userdb` route as Debian, with `db_load` provided by `libdb-utils` (a different package name from Debian's `db-util`).

Generating the virtual user database on Debian looks like this (swap tools per the above on other distros):

```bash
$ sudo apt install db-util
$ printf 'user1\npass1\nuser2\npass2\n' | sudo tee /etc/vsftpd/virtual_users.txt
$ sudo db_load -T -t hash -f /etc/vsftpd/virtual_users.txt /etc/vsftpd/virtual_users.db
$ sudo chmod 600 /etc/vsftpd/virtual_users.db
```

On the vsftpd side, enable `guest_enable=YES`, `guest_username=ftpupload` (the mapping target), and `pam_service_name=vsftpd_virtual`. Tighten the password file's permissions, or you have effectively exposed the password hashes to every user on the machine.

## 6. Practical Scenarios

**Read-only anonymous mirror**: `anonymous_enable=YES`, `anon_root=/srv/ftp`, keep writes disabled for anonymous users, and rate-limit with `anon_max_rate`. Anonymous write access is a serious misconfiguration -- a publicly writable directory will almost certainly be filled with junk or used as an attack staging ground.

**Site content upload**: a dedicated system user + chroot + only the subdirectory writable, plus forced TLS. Before going live, test passive mode with real clients (curl, FileZilla) each; opening `ftp://` directly in a browser does not represent client compatibility.

```bash
$ curl -s ftp://user@203.0.113.10/ --user user:secret -o /dev/null -w '%{http_code}\n'
226   # 1xx/2xx means the control session succeeded; hanging with no output usually means the PASV port is not open
```

## 7. Common Traps

**`500 OOPS: refusing to run with writable root inside chroot()`, service will not start or the login drops immediately.** Since vsftpd 2.3.5 a writable chroot directory itself is forbidden (a writable root lets users escape the semantic jail). The correct fix is to keep the home directory read-only at `555`, create an `upload/` subdirectory at `750` underneath it and hand that to the user; use `allow_writeable_chroot=YES` only as an escape hatch after confirming the risk, and never copy it into production as a default.

**Login works, `pwd` is fine, but `ls` drops the connection or times out.** Control and data are two streams: control up, data down means the passive ports are not open nine times out of ten (check the host's firewalld/iptables and the cloud security group separately), or `pasv_address` was set to a private IP. In active mode, check the reverse: whether the client side is blocking the server's inbound port 20.

**The client prints `227 Entering Passive Mode (192,168,x,x,...)` and then hangs.** This is the NAT scenario from the previous item: set `pasv_address` to the public IP, or use `pasv_addr_resolve=YES` plus a domain name so the server resolves at startup. `tcpdump -i any -nn port 10000:10100` shows directly whether the data connection SYN reaches the host.

**The `LIST` command triggers GnuTLS/connection-reset errors.** In some environments vsftpd's sandbox conflicts with network namespaces; the mitigation summarized on the official forum and the Arch Wiki is `seccomp_sandbox=NO` (which lowers sandbox strength -- confirm first that it is not a certificate or firewall problem). When mixing IPv4/IPv6 you must also respect the mutual exclusion of `listen` and `listen_ipv6`; enabling both reports `run two copies of vsftpd`.

**Edits to the config have no effect.** vsftpd has no hot reload: `systemctl restart vsftpd` is mandatory; with a broken config it exits outright, so look at the last lines with `journalctl -u vsftpd -e`. The troubleshooting approach is the same on all three families; Arch users can verify a reinstall by overwriting local changes with `pacman -S vsftpd` (pacman warns about conflicts when local modifications exist), with `apt reinstall vsftpd` on Debian and `dnf reinstall vsftpd` on RHEL as the equivalents.

**Deployment-order traps.** Run `pacman -Syu` (or `apt full-upgrade`, `dnf upgrade`) first to bring the system and vsftpd up to current versions, then edit the config -- checking today's version line by line against five-year-old documentation is the most common waste in FTP tickets. After upgrading, re-verify the config file paths with `pacman -Ql vsftpd` or the equivalent tool, then compare against the change notes in the [references](https://wiki.archlinux.org/title/Very_Secure_FTP_Daemon).

## 8. Logs and Troubleshooting Entry Points

```bash
# Transfer log (when xferlog_enable=YES)
$ sudo tail -f /var/log/xferlog
Wed Sep 21 10:22:31 2026 1 192.168.1.50 /pub/iso.iso a _ o a0 ftp user 0 c /pub/iso.iso

# Protocol-level debugging: temporarily set log_ftp_protocol=YES and restart to see every FTP command
$ sudo journalctl -u vsftpd -f
```

Keep the troubleshooting order fixed: `systemctl status vsftpd` to confirm the process -> `ss -tlnp` to confirm port 21 and the passive range are listening -> local `curl ftp://127.0.0.1` to rule out the application layer -> then reproduce with an external client. This separates the four classes of problem -- service not running, port not open, mode mismatch, insufficient permissions -- in one pass.

## 9. Migrating from FTP to SFTP

Since production has largely moved to SFTP, how do you migrate without a disaster? Three steps. **Step one, inventory**: use the access logs to count which clients and scripts actually use FTP, separating "live traffic" from "zombie configuration" -- many FTP services really only serve two or three scheduled jobs. **Step two, dual-stack transition**: OpenSSH and vsftpd can listen side by side (ports 22 and 21 do not conflict); move SFTP-capable clients over first, and on the script side replace `curl ftp://` with `sftp://` or `scp`/`rsync -e ssh` -- the URL syntax is nearly isomorphic, so the rework is usually small. **Step three, close out**: once the logs show FTP sessions at zero, `systemctl disable --now vsftpd`, then remove port 21 and the passive range from the firewall -- closing only the service without the firewall is not done, and closing only the firewall leaves the service erroring in monitoring forever.

Permission mapping needs separate verification during the switch: the system account an FTP virtual user maps to is not equivalent to OpenSSH's `ChrootDirectory` rules -- OpenSSH **requires** the chroot directory and every parent above it to be owned by root and unwritable, with the user's writable area placed in a subdirectory inside the chroot. This constraint and vsftpd's refusal of a writable chroot root converge on the same logic: understand "why a jail root cannot be writable" (to prevent users from escaping indirectly by changing permissions) and both services' configurations can be lined up in one pass instead of re-reading the manual every time something breaks.

Acceptance during the migration is simple: `sftp -v user@host` completes authentication and `pwd`, `put`/`get` each transfer one test file, and the permission bits and ownership are checked to match the FTP era. OpenSSH on all three distros is a base component -- Debian's `openssh-server`, Arch's `openssh` (`pacman -S openssh`), and RHEL's `openssh-server` work right after install, with no third-party daemon required.

## References

- vsftpd official site and FAQ -- [security.appspot.com/vsftpd.html](https://security.appspot.com/vsftpd.html)
- Arch Wiki: vsftpd -- [wiki.archlinux.org/title/Very_Secure_FTP_Daemon](https://wiki.archlinux.org/title/Very_Secure_FTP_Daemon)
- ProFTPD official documentation -- [proftpd.org/docs](https://proftpd.org/docs/)
- FTP protocol specification -- [RFC 959](https://tools.ietf.org/html/rfc959)
- RFC 2428 (EPRT/EPSV, FTP extensions under IPv6) -- [tools.ietf.org](https://tools.ietf.org/html/rfc2428)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [coverage-matrix](/research/coverage-matrix.md)
- [README](README.md)