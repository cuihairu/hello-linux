# Mail Server (Postfix)

Email is one of the oldest protocol families still running at internet scale: SMTP delivers mail from one host to another, and POP3/IMAP fetches it from the mailbox to the user's client. Postfix is a high-performance mail transfer agent (MTA) with exactly one design goal -- sending and receiving mail securely and reliably on an untrusted public network. To answer "why self-host a mail server", first look at the real constraints: a company-domain mailbox like `alice@corp.example` wanting full control over delivery logs and archiving policy; intranet device alerts needing to reach a designated inbox without handing credentials to a third-party forwarding service; or a mail gateway needing relay control per content policy. But the cost of self-hosting must be stated upfront too -- anti-spam, deliverability, SPF/DKIM alignment, and IP reputation do not happen automatically because "Postfix is installed"; a server configured as an open relay or one ignoring reverse lookups gets blacklisted by the major mail providers within hours. This page is organized as "why -> roles and queues -> installation on the three families -> core configuration -> Dovecot -> anti-spam primer -> common traps"; the installation section compares Debian/Ubuntu (apt), Arch (pacman), and RHEL/CentOS/Rocky (dnf); opening 25/587/993 is on the [Firewall](../../security/firewall.md) page, and policy details this page is unsure about are left out.

> Content draws on the official Postfix documentation and the Arch Wiki; see the references at the end.

## What This Page Covers

- Drawing the MUA/MTA/MDA division of labor clearly
- Installing on the three distros (apt / pacman / dnf) and reading postqueue -p's queue output
- Configuring main.cf's core parameters and aliases, and verifying the mydestination/mynetworks boundary
- What SPF/DKIM/DMARC each protect against
- Recognizing and converging the high-frequency faults: open relay, expired certificates, queue buildup

## 1. Why the Mail System Has So Many Roles

### 1.1 The MUA/MTA/MDA Division of Labor

A mail message from finished draft to landing in the recipient's mailbox passes through at least three kinds of program: the **MUA** (mail user agent, such as Thunderbird/Outlook) composes and displays; the **MTA** (mail transfer agent, Postfix/Sendmail) relays between hosts per SMTP; and the **MDA** (mail delivery agent, Dovecot/Procmail) puts arrived mail into the user's mailbox and serves it over IMAP/POP3. Postfix sits in the middle of the chain -- it listens on port 25 for incoming mail and actively connects to the peer's port 25 to deliver outgoing mail; Dovecot stands on the user side, presenting mail to clients over 993/995.

| Component | Responsibility | Common software | Typical ports |
|------|------|----------|----------|
| MUA | compose, read | Thunderbird, Outlook, mutt | 587/993 (via Dovecot) |
| MTA | delivery between hosts | Postfix, Sendmail | 25 |
| MDA | mailbox and fetching | Dovecot, Procmail | 143/993, 110/995 |

This layering is not academic fastidiousness but fault-domain separation: user cannot reach the inbox -> check Dovecot and the certificate first; outbound delivery rejected -> check the Postfix queue and the peer's response code first; local mail piling up undelivered -> look at `postqueue -p`. Same as the system's division of "package manager handles installation, systemd handles processes, the logging subsystem handles traceability" -- the mail stack splits "compose, transport, store" so each segment can be upgraded and debugged independently instead of one tug moving everything.

### 1.2 The Queue: Why "sent successfully" Is Not "they received it"

Postfix first writes mail into the queue and then delivers asynchronously: a process crash, a temporary 4xx from the peer, or a DNS resolution failure all leave the message in the queue for retry (by default up to about five days). `postqueue -p` is the window onto this to-do list, and `postcat -q QUEUEID` replays a single message's header information and delivery trace. The queue's purpose is to separate "transient failure" from "permanent loss" -- a network blip should not make the user rewrite the message; but a queue that only grows and never drains usually means outbound is blocked (peer refused, no MX in DNS, firewall blocking 25), which must be investigated actively rather than waited out. By analogy with a package cache: `pacman`'s download cache can resume an install offline, and the mail queue can hold and retry offline too, but both need the "confirm afterwards that it really landed" step -- a cache hit is not a completed task.

**Open relay is the number one red line for a mail server**: if clients outside `mynetworks` can use your server to deliver to arbitrary addresses, your IP is quickly used to send spam and ends up on blocklists. There is one configuration principle -- `mynetworks` lists only trusted segments, and `smtpd_relay_restrictions` keeps "authenticated senders and local segments may relay; everything else, refuse unauthenticated outbound relay requests"; after changing, verify with a third-party relay test tool or your own two-machine setup rather than going live on a feeling.

## 2. Installation (Three Distros Compared)

| Action | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Install | `apt install postfix` | `sudo pacman -S postfix` | `dnf install postfix` |
| Search | `apt search postfix` | `pacman -Ss postfix` | `dnf search postfix` |
| Show package info | `apt show postfix` | `pacman -Qi postfix` | `dnf info postfix` |
| List files | `dpkg -L postfix` | `pacman -Ql postfix` | `rpm -ql postfix` |
| Upgrade | `apt upgrade` | `sudo pacman -Syu` | `dnf upgrade` |
| Remove | `apt remove postfix` | `sudo pacman -R postfix` | `dnf remove postfix` |
| Mail fetching component | `apt install dovecot-imapd` | `pacman -S dovecot` | `dnf install dovecot` |

The Debian installation pops a debconf interactive screen; choose "Internet Site" and enter the fully qualified hostname (say `mail.example.com`), and it prefills initial values for `myhostname`/`mydomain` -- choosing wrong means editing `main.cf` later, but at least you have a starting point. Arch users install everything in one go from the official extra repository with `pacman -S postfix`; the main config is upstream's default `/etc/postfix/main.cf`, with no debconf step and every parameter edited afterwards, so the section 3 checklist matters even more. On the RHEL family after `dnf install postfix` the unit is always called `postfix`, and logs go to `journalctl -u postfix` or `/var/log/maillog` (the rsyslog layout differs from Debian's `/var/log/mail.log`, so do not sit waiting on an empty file at the wrong path during troubleshooting). Upgrade semantics agree across all three: Debian/RHEL go through `apt upgrade`/`dnf upgrade`, Arch keeps rolling with `pacman -Syu`, and after an upgrade, if `main.cf` has local changes, watch for the package manager's `.pacnew`/dpkg conffile notices so your edits are not overwritten by upstream defaults -- when something breaks, first ask "which files did I hand-edit" in the style of `pacman -Qmq`, then decide which copy to roll back, far more efficient than guessing across the whole main.cf.

### 2.1 Debian/Ubuntu

```bash
$ sudo apt update
$ sudo apt install postfix mailutils
$ sudo dpkg-reconfigure postfix    # re-run the selection wizard if you skipped it during install
$ sudo systemctl enable --now postfix
$ sudo systemctl status postfix
● postfix.service - Postfix Mail Transport Agent
   Loaded: loaded (/lib/systemd/system/postfix.service; enabled)
   Active: active (running)
```

`mailutils` provides the local `mail` command, so testing loopback delivery does not require a full MUA first; `dpkg-reconfigure postfix` can rerun the selection wizard at any time, no need to uninstall and reinstall.

### 2.2 Arch

```bash
$ sudo pacman -S postfix dovecot
$ sudo systemctl enable --now postfix dovecot
$ postconf mail_version
mail_version = 3.8.x
```

On Arch both Postfix and Dovecot are in extra, and `pacman -S postfix dovecot` installs the transport and fetching sides at once; `postconf mail_version` is a quick trick to verify the binary matches the documentation's version. If you go on to do DKIM signing, the corresponding software also comes from the repository: `pacman -S opendkim`, with exactly the same responsibility as Debian's `apt install opendkim` and RHEL's `dnf install opendkim` -- the only difference being whether the config snippets are already `include`d into the main config by default; Arch convention is to confirm the include chain yourself after editing a conf.d snippet, and `pacman -Ql opendkim` lists every default file the package laid down. When verifying checklist-style files, do not forget to compare against the factory list with `pacman -Ql postfix`, running it once before and once after an upgrade to spot immediately which custom lines went missing in the `.pacnew` -- the same yardstick as `dpkg -L postfix` on Debian. Deleting dependency resolution and progress lines loses no teaching information; acceptance recognizes only `systemctl is-active` and `postconf mail_version`.

### 2.3 RHEL/CentOS/Rocky

```bash
$ sudo dnf install postfix
$ sudo systemctl enable --now postfix
$ sudo alternatives --config mta    # if several MTAs exist on the system, make sure postfix wins
$ postconf -n | head
```

`postconf -n` prints the key parameters that are "non-default and therefore currently in effect", a config-checkup entry shared by all three families -- store this output in the change ticket before going live, and later comparisons reveal immediately who changed `mynetworks` or `relayhost`. In a SELinux environment, if a custom certificate/alias path is refused, confirm the context with `ausearch -m avc -ts recent` and then align it with `restorecon` -- the same routine as handling zone file permissions on the BIND side.

## 3. Core Configuration (main.cf)

### 3.1 Parameters You Must Check

```text
# /etc/postfix/main.cf
myhostname = mail.example.com
mydomain = example.com
myorigin = $mydomain
# which destinations this machine accepts mail for -- spell domains fully; a miss means refusals
mydestination = $myhostname, localhost.$mydomain, localhost, $mydomain
# who may relay through this host -- only trusted segments; rather narrow than wide
mynetworks = 127.0.0.0/8, 192.168.1.0/24
inet_interfaces = all
inet_protocols = ipv4

message_size_limit = 52428800    # 50MB, sized against common peer limits
mailbox_size_limit = 1073741824  # 1GB

alias_maps = hash:/etc/aliases
alias_database = hash:/etc/aliases
```

`mydestination` decides "which domains this server considers itself the endpoint for": mail between users of your own domains is delivered locally, and a missing domain either rejects mail it should accept or tries to relay it back out the long way. `mynetworks` and `relayhost` are one closing and one opening: the former defines the trust boundary, the latter whether outbound goes through the corporate gateway (office IPs often have port 25 blocked upstream, in which case pointing `relayhost = [smtp.corp.example]:587` at a trusted gateway is actually more reliable). Changing parameters with `postconf -e 'param = value'` is less likely to break syntax than hand-editing, and takes effect after `systemctl reload postfix` -- the write, verify, apply rhythm is the same as changing any critical service config.

### 3.2 Aliases and Local Delivery

```bash
# /etc/aliases
root: admin@example.com
postmaster: admin@example.com
webmaster: admin@example.com

$ sudo newaliases    # the alias file is db format; the index must be rebuilt after editing
```

The RFCs require every public-facing domain to have a deliverable `postmaster`, and the alias table is exactly where system accounts map to real mailboxes; without running `newaliases`, changes do not take effect -- the same trap as installing a package with `pacman` but never `systemctl enable`-ing the service, "installed but not running", both being "file changed, index/enablement not caught up". Likewise, if you installed `postfix` with `pacman -S` on Arch but forgot `systemctl enable --now postfix`, nothing listens on the port either; treat "install, configure, start, verify" as a fixed four-step action list, with the three families differing only in the verb of the first step.

## 4. Dovecot: Letting Users Fetch Their Mail

### 4.1 Installation and Key Configuration

Installation commands are in the section 2 comparison; the config focuses on three things -- protocol, mailbox location, and authentication plus TLS:

```text
# /etc/dovecot/dovecot.conf
protocols = imap pop3

# /etc/dovecot/conf.d/10-mail.conf
mail_location = mbox:~/mail:INBOX=/var/mail/%u

# /etc/dovecot/conf.d/10-auth.conf
disable_plaintext_auth = yes
auth_mechanisms = plain login

# /etc/dovecot/conf.d/10-ssl.conf
ssl = required
ssl_cert = </etc/ssl/certs/mail.example.com.pem
ssl_key = </etc/ssl/private/mail.example.com.key
```

`mail_location` must match Postfix's mailbox format (mbox for mbox, Maildir for Maildir); when the two disagree, the symptom is "SMTP reports delivery successful but the client inbox is empty" -- the mail is actually sitting in a directory of the other format. `disable_plaintext_auth = yes` together with `ssl = required` keeps credentials off the wire in plaintext; certificates can come from Let's Encrypt or an enterprise CA, and once expired, IMAPS/SMTPS handshakes fail outright, so certificate expiry reminders should live on the same on-call sheet as system patch reminders. On Arch Dovecot is a single package `pacman -S dovecot`, Debian splits it into `dovecot-core`/`dovecot-imapd`/`dovecot-pop3d`, and RHEL has one `dovecot` package -- after installing, all three start the service with `systemctl enable --now dovecot`, then accept by comparing the effective config from `dovecot -n`, the same yardstick as `postconf -n`.

## 5. SPF, DKIM, DMARC Primer

The three solve different facets of one problem: **who is authorized to send on behalf of this domain**. SPF lists the IPs/MXes allowed to send in a DNS TXT record (`v=spf1 mx a:mail.example.com ip4:203.0.113.10 -all`), and the receiver compares the envelope source; DKIM signs mail headers with a private key, publishing the public key as a TXT record at `mail._domainkey.example.com`, preventing tampering and building domain-level reputation; DMARC tells the receiver what to do when SPF/DKIM do not "align" (TXT at `_dmarc.example.com`, `p=quarantine` or `p=reject`), and provides a `rua` aggregate report address. The configuration order matters: first make sure the outbound IP appears in SPF and DKIM signing is stably in effect, and only then tighten DMARC gradually from `p=none` observation mode to `reject` -- skipping the observation phase and going straight to `reject` is the classic "our own mail silently dropped" incident when alignment config is wrong. OpenDKIM's key generation and permission tightening are well-established operations (`opendkim-genkey`, then restrict directory ownership), but policy choices like filter selection and report mailbox archiving vary per organization; this page only gives direction, with details deferring to official documentation and real-world reports.

### 5.1 SPF: Who May Send for This Domain

SPF is a TXT record published at the **domain apex** (`example.com`), declaring which source IPs/MXes are authorized to relay outbound in this domain's name (`v=spf1 ... -all`). On receiving a message, the receiver fetches the SPF of the domain in the envelope MAIL FROM and checks whether the source IP is in the authorized list. It constrains only the "envelope source domain", which is a different matter from the `From` header:

```bash
$ dig TXT example.com +short
"v=spf1 mx a:mail.example.com ip4:203.0.113.10 -all"
```

### 5.2 DKIM: Signing Mail Headers with a Key

DKIM signs mail headers with a private key at send time, and publishes the public key as a TXT record at `<selector>._domainkey.example.com` (selectors like `default` and `mail` are decided by the OpenDKIM config). The receiver verifies with the public key, which both catches tampering in transit and lets "consistent good delivery from the same domain" accumulate domain-level reputation:

```bash
$ dig TXT default._domainkey.example.com +short
"v=DKIM1; k=rsa; p=MIIBIjANBg..."
```

### 5.3 DMARC: What to Do When Alignment Fails

The DMARC record is published at `_dmarc.example.com`, declaring what the receiver should do when SPF or DKIM fails to "align" with the `From` header's domain: `p=none` only collects reports, `quarantine` sends to spam, `reject` refuses outright; `rua=` designates the aggregate report receiving address:

```bash
$ dig TXT _dmarc.example.com +short
"v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com"
```

The recommended verification and rollout order is fixed: publish SPF first and confirm outbound IPs match, then enable DKIM signing and confirm with dig that the public key is reachable, and finally read aggregate reports from DMARC `p=none` observation mode, and once the alignment rate looks normal, tighten gradually to `quarantine`/`reject`.

## 6. Testing and Verification

```bash
# Local queue and config
$ postqueue -p
$ postconf -n
$ doveconf -n | head

# Ports and the SMTP conversation
$ nc -zv mail.example.com 25     # SMTP
$ nc -zv mail.example.com 587    # Submission
$ nc -zv mail.example.com 993    # IMAPS
$ telnet mail.example.com 25
220 mail.example.com ESMTP Postfix

# Loopback delivery and logs
$ echo "Test" | mail -s "Test Subject" postmaster
$ sudo tail -f /var/log/mail.log     # Debian layout
# $ sudo journalctl -u postfix -f     # or RHEL's /var/log/maillog
```

Talking SMTP by hand over `telnet`/`nc` is the most direct acceptance test: watch the 220 banner to confirm Postfix is answering, walk through `EHLO`, `MAIL FROM`, `RCPT TO` step by step, and the peer's return codes tell you precisely which layer it is stuck at (550 is mostly address/policy rejection, 4xx is a transient fault that goes into the queue for retry). Keep local tests and external tests separate: loopback success only proves local delivery and the alias chain work; delivery to public mailboxes such as Gmail/QQ additionally depends on reverse lookups, SPF/DKIM alignment, and IP reputation -- the latter can only be confirmed with real outbound sends plus delivery reports, there is no shortcut.

## 7. Common Traps

**Open relay / listed on a blocklist.** First check with `postconf -n` whether `mynetworks` was changed to `0.0.0.0/0` or still contains a factory placeholder; then confirm outbound is really refusing relay with an external relay test. If already blocklisted, follow each RBL site's delisting process while also plugging the source -- a pile of `deferred` outbound mail and abnormal send volumes in the queue are corroborating evidence. Firewall and outbound policy still go through the unified process on the [Firewall](../../security/firewall.md) page; here we only solve the "configuration boundary".

**No mail from outside / ports unreachable.** Debug in order: `nc -zv` to test whether 25 is reachable (cloud providers often block outbound 25 by default; inbound depends on the firewall) -> does the MX record point at this machine with resolvable A/AAAA -> is `inet_interfaces` listening on external addresses -> does `mydestination` include the target domain. DNS-side details are in the [DNS](../dns/bind.md) chapter; the interface between the two chapters is MX and PTR: with a wrong MX the mail never arrives, with a wrong PTR it arrives but outbound reputation suffers.

**Queue only grows.** `postqueue -p` for the backlog objects, `postcat` for one message's delivery log; lots of `deferred` points at peer 4xx, DNS, or certificate problems, while a stuck `active` suggests outbound connections are being blocked. Do not blindly `postqueue -f` force-deliver before confirming the root cause -- if the peer is rate-limiting, forced delivery only extends the backoff; after figuring it out, delete dead messages with `postsuper -d` as needed or wait for the retry window.

**main.cf changes not taking effect.** Postfix reads the "compiled" configuration: after hand-editing you need `postfix reload`/`systemctl reload postfix`, and writing with `postconf -e` also requires a reload; `postconf -n` disagreeing with the file means the wrong file was edited or no reload happened. Forgetting `newaliases` after editing aliases, or forgetting to restart OpenDKIM after a DKIM change, are the same class of mistake: file changed, the taking-effect step skipped.

**Dovecot certificate/permissions causing fetch failures.** `dovecot -n` to confirm `ssl` and the paths are in effect; `ls -l` to check the certificate private key is readable by the dovecot user (commonly permissions reset after a Let's Encrypt renewal); when the mailbox directory owner is wrong, the symptom is successful login with an empty listing or write errors. The fixed debugging entry: `doveconf -n` for config first, then `journalctl -u dovecot -e` for the refusal reason -- perfectly symmetric with Postfix's "postconf -n first, logs second".

## References

- Official Postfix documentation -- [postfix.org](https://www.postfix.org/documentation.html)
- Postfix configuration reference -- [postfix.org/CONF_README](https://www.postfix.org/documentation.html)
- Official Dovecot documentation -- [doc.dovecot.org](https://doc.dovecot.org/)
- Arch Wiki: Postfix -- [wiki.archlinux.org/title/Postfix](https://wiki.archlinux.org/title/Postfix)
- Arch Wiki: Dovecot -- [wiki.archlinux.org/title/Dovecot](https://wiki.archlinux.org/title/Dovecot)
- "Vbird's Linux Cabinet" - mail server -- [linux.vbird.org](https://linux.vbird.org/linux_server/centos6/0380mail.php)
- OpenDMARC/SPF overview -- [dmarc.org](https://dmarc.org/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [coverage-matrix](/research/coverage-matrix.md)
- [README](/server/README.md)
- [prometheus](/server/monitoring/prometheus.md)