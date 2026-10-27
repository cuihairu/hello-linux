# DNS Server (BIND)

DNS is the phone book of the internet: humans remember domain names, machines need IPs, and the translation layer in between has to be both fast and reliable. BIND (Berkeley Internet Name Domain) is the oldest and most widely deployed authoritative DNS implementation -- from the root servers to enterprise intranet resolvers, what runs behind is mostly it or its direct descendants. To answer "why run your own DNS", look at three real scenarios first: intranet machines wanting to reach each other by short names like `db.example.com` without hand-editing `/etc/hosts` for every host; a company publishing its website and mail routes, where MX/SPF records must be answered by an authoritative server you control; or an upstream public DNS getting hijacked and its answers poisoned, and you need a recursive exit that trusts only your own configuration. BIND puts the two roles of "authoritative answering" and "recursive querying" into one configuration system, but their security implications are completely different -- misconfigure an authoritative machine exposed to the public internet with open recursion and it can become a leveraged amplification source. This page is organized as "why -> roles and architecture -> installation on the three families -> forward and reverse zones -> primary/secondary replication -> dig troubleshooting -> common traps"; the installation section compares Debian/Ubuntu (apt), Arch (pacman), and RHEL/CentOS/Rocky (dnf), with the differences concentrated in package and unit names while the config syntax itself is identical across families; opening port 53 in the host firewall is covered on the [Firewall](../../security/firewall.md) page instead.

> Content draws on the official BIND documentation and the Arch Wiki; see the references at the end.

## What This Page Covers

- Telling apart the two roles: authoritative and recursive
- Installing on the three distros (apt / pacman / dnf) and reading named-checkconf's verification output
- Configuring forward and reverse zones independently
- Using dig to trace the resolution chain and locate TTL, answer-source, and NXDOMAIN-style faults
- Debugging the high-frequency traps: service won't start, zone changes not taking effect, primary/secondary out of sync

## 1. Why DNS Is Designed This Way

### 1.1 Authoritative and Recursive: Two Faces of One Server

From the client's perspective, a DNS query has only two forms. A **recursive query** is "you ask all the way for me": the browser asks the local resolver for `www.example.com`, and the resolver walks the whole chain root -> top-level domain -> authoritative server on its behalf, returning the final IP. An **iterative query** is "you tell me who to ask next": the root server does not give the result directly, only says "go ask the .com authorities", and the resolver continues with the referral. Most end devices only send recursive queries; while the roots, the top-level domains, and an enterprise's own authoritative servers mainly answer iterative referrals and authoritative responses.

| Role | Who uses it | Meaning in BIND | Security boundary |
|------|--------|----------------|----------|
| Recursive resolver | intranet endpoints, the recursive exit | allows `recursion yes`, caches upstream results | must restrict query sources, or it becomes an open recursion amplifier |
| Authoritative server | upstream resolvers, secondary servers | gives authoritative answers for configured zones | only needs to be open inward/upstream; generally no recursion for the outside |

This division explains the most common config incident: someone copy-pastes documentation that enables both authoritative service and fully open recursion on a public IP, and the server is quickly picked up by scanners and its bandwidth saturated by a DNS amplification attack. The correct posture is -- put an `allow-recursion`/`allow-query-cache` source allowlist on the recursion entry, let the authoritative role answer only clients permitted by `allow-query`, and separate the two with views, or simply with two machines. By analogy with package management: who a repository index is open to via `pacman -Sy` is a trust question, and who `named` opens recursion to is the same trust question -- writing down "who may come fetch" is one discipline; signing repository addresses and putting ACLs on query entries are both fundamentally "confirm the peer is trustworthy before letting data out".

### 1.2 Record Types and Why Zone Files Exist

One DNS record answers one specific question: A/AAAA map a name to IPv4/IPv6, CNAME gives an alias, MX specifies where mail lands, NS declares who is authoritative, PTR does the reverse mapping, and TXT carries metadata such as SPF/DKIM/DMARC. The **zone file** is the authoritative ledger for one domain (or the reverse zone of a network segment): the SOA record declares the serial number and refresh cadence, NS records list the name servers, and the remaining records land line by line. The reason it exists is plain: DNS's truth needs to be versionable, diffable, and reviewable offline -- changing an A record equals changing one line of text plus incrementing the serial, and secondaries use the serial to decide whether to retransfer (AXFR/IXFR). This converges with the system package database in `/var/lib/pacman/local`: one uses a text zone to express the desired state of "name -> address", the other a database to express the installed state of "package -> files"; both seek a single source of truth, with changes leaving traces and verification being reproducible.

```text
Client --recursive--> Local resolver --iterative--> root / TLD / authoritative
                          ├── cache hit -> answer directly (mind the TTL)
                          └── cache miss -> walk the whole referral chain
```
TTL (time to live) is the breathing rhythm of the caching protocol: too long, and record changes propagate slowly and roll back slowly too; too short, and resolvers keep coming back, loading the authoritative servers. Lowering the TTL of critical records (say to 60 seconds) before a cutover and restoring it afterward is the standard move for IP changes and data center migrations -- this step is often skipped, producing "I definitely changed the record, but users still see the old IP". Once this layered picture is understood before configuring, you find that the decisions you actually face are only three: is this machine authoritative or recursive (or how are the two separated), who may query, and how is the ledger versioned; the remaining syntax details can be looked up in the manual -- the framework of trade-offs is what this page really wants to leave you with.

Two cross-distro disciplines before starting: **check before reload** -- do not touch the production process until both `named-checkzone` and `named-checkconf` are green, catching syntax errors outside the maintenance window is far cheaper than rolling back at 2 a.m. with a half-dead service; and **the serial only increases, never edit content without bumping** -- secondaries compare size, not hashes, and secretly editing a zone under the same serial is the classic source of primary/secondary divergence. Both share the conservative change philosophy of package management "look at dependencies before upgrading, keep the old package if the upgrade fails": DNS, like packages, is state shared across machines, and "done on one box" does not equal "correct everywhere in the cluster".

## 2. Installation (Three Distros Compared)

| Action | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Install | `apt install bind9 bind9utils` | `sudo pacman -S bind` | `dnf install bind bind-utils` |
| Search | `apt search bind9` | `pacman -Ss bind` | `dnf search bind` |
| Show package info | `apt show bind9` | `pacman -Qi bind` | `dnf info bind` |
| List files | `dpkg -L bind9` | `pacman -Ql bind` | `rpm -ql bind` |
| Upgrade | `apt upgrade` | `sudo pacman -Syu` | `dnf upgrade` |
| Remove | `apt remove bind9` | `sudo pacman -R bind` | `dnf remove bind` |
| Resolution tools | `apt install dnsutils` | `pacman -S bind` (ships dig) | `dnf install bind-utils` |

There is one naming difference easy to trip on: on Debian/Ubuntu the service unit is called `bind9`, while Arch and the RHEL family both call it `named` -- package name, unit name, and config path are three independent dimensions, so line the unit up first with `systemctl status` when troubleshooting, and only then talk config files. Arch users still start from `pacman -S bind` in daily work, one command installing both the daemon and dig/nslookup; on Debian, `dig` additionally requires `dnsutils`, and on RHEL the corresponding `bind-utils`. Upgrade paths also differ: Arch rolling updates go through `pacman -Syu`, Debian/RHEL through `apt upgrade`/`dnf upgrade`, and after config changes either way, run `named-checkconf` before restarting -- verify first, then apply, the universal order for changing any critical network service.

### 2.1 Debian/Ubuntu

```bash
$ sudo apt install bind9 bind9utils dnsutils
$ sudo systemctl enable --now bind9 && systemctl is-active bind9
active
```

Debian splits the config across multiple snippet files under `/etc/bind/`: `named.conf.options` for global options, `named.conf.local` for local zones -- the same philosophy as apt splitting sources into `sources.list.d/`, so local changes are not easily clobbered by package upgrades. `dnsutils` is merely the client toolkit (dig, nslookup, host); the service runs fine without it, but during troubleshooting you will find every common diagnostic command missing -- installing the client alongside the server is an unassuming but very practical difference between the Debian family and Arch/RHEL (the latter two ship dig with the main package).

### 2.2 Arch

```bash
$ sudo pacman -S bind
$ sudo systemctl enable --now named && dig -v | head -1
DiG 9.18.x
```

Arch's BIND comes from the official extra repository, one `pacman -S bind` away, with config concentrated in the single file `/etc/named.conf` (the upstream default layout); zone files conventionally go in `/etc/named/` or `/var/lib/named/`, per the `directory` directive in the file. After installing, `pacman -Ql bind | head` quickly shows which units and default configs the package laid down -- the same action as `dpkg -L bind9` on Debian and `rpm -ql bind` on RHEL, only the front half of the package-manager verb changes. During rolling upgrades keep everything updated with `pacman -Syu`; BIND and dig are in the same package and repository, so there is no client-versus-daemon version skew to worry about. The package manager's dependency resolution and progress lines carry no troubleshooting information; acceptance is fixed on two lines: `systemctl status` and `dig -v`.

### 2.3 RHEL/CentOS/Rocky

```bash
$ sudo dnf install bind bind-utils
$ sudo systemctl enable --now named && systemctl is-active named
active
$ dig example.com @127.0.0.1 +short
192.168.1.100
```

On the RHEL family the main config lives in `/etc/named.conf`, zones default to `/var/named/`, and permissions are jointly governed by the package's default `named` user and SELinux contexts -- `restorecon -Rv /var/named` is the step often forgotten after editing files; with wrong permissions or labels named refuses to load the zone with `permission denied`, leaving only a vague `loading configuration: file not found`-style error in the log. Upgrades on the RHEL side are likewise one `dnf upgrade bind`, matching the cadence of Debian's `apt upgrade bind9` and Arch's `pacman -Syu`; what all three share is "always reload or restart after upgrading, always checkconf before restarting" -- the package manager changes, the discipline does not.

## 3. Global Configuration Essentials

### 3.1 Main Config Skeleton

```text
// /etc/bind/named.conf.options (Debian snippet style)
options {
    directory "/var/cache/bind";
    allow-query { localhost; 192.168.1.0/24; };
    allow-recursion { localhost; 192.168.1.0/24; };
    forwarders { 8.8.8.8; 1.1.1.1; };
    dnssec-validation auto;
    version "not available";
    listen-on { 127.0.0.1; 192.168.1.100; };
    listen-on-v6 { none; };
};
```

`allow-query` governs "who may ask the authoritative questions" and `allow-recursion` "who may have me recurse" -- the two are often conflated: opening only the first and forgetting the second makes intranet users see the strange phenomenon of "public domains resolve but our own do not", or the reverse, with the root cause being that the two kinds of access are turned away by different ACLs. `version "not available"` erases the banner version, giving scanners less intelligence; `listen-on-v6 { none; }` removes one listening surface in data centers not using IPv6. After any change, always run `named-checkconf` first -- syntax errors are caught before the restart, saving half the time compared to reading logs after the service fails to come up.

## 4. Forward Resolution

### 4.1 Declaring a Zone

From BIND 9.18 on, `type primary`/`type secondary` is recommended (`master`/`slave` still work but are deprecated); write new configs with the new terms directly to avoid confusion when reading old documentation side by side:

```text
// named.conf.local (Debian) or named.conf (Arch/RHEL)
zone "example.com" {
    type primary;
    file "/etc/bind/zones/db.example.com";   // adjust the path for Arch/RHEL
    allow-transfer { 192.168.1.101; };       // allow only the secondary
    also-notify { 192.168.1.101; };          // notify actively when the serial changes
};
```

The four fields in this declaration each own one thing: `type` decides whether this machine is the ledger's owner or a follower; `file` points at the zone text actually on disk (the path must agree with the `directory` convention -- a wrong location shows up in named's log as file not found); `allow-transfer` tightens AXFR to the secondary's IP so the whole zone cannot be dragged off by any querier; `also-notify` makes the primary knock on the secondary's door actively when the serial changes, compressing propagation from "waiting for the Refresh interval" to seconds. After writing, run `named-checkzone` and then `named-checkconf`; only when both gates are green do `rndc reload` -- reverse the order and a single zone's syntax error can take the whole named down.

### 4.2 The Zone File

The zone file itself is a plain-text ledger: TTL, SOA, NS, then the records one by one. The five SOA fields -- serial, Refresh, Retry, Expire, and Negative TTL -- explain in order "how often to retransfer, the retry interval on failure, and when the secondary gives up"; a CNAME not coexisting with A/MX, and the apex needing an A record for alias hosts like `mail`, are the syntax points most easily tripped on when writing your first zone:

```text
$TTL    86400
@       IN      SOA     ns1.example.com. admin.example.com. (
                        2024010101 ; Serial: must increase on every change
                        3600 1800 604800 86400 )
        IN      NS      ns1.example.com.
        IN      NS      ns2.example.com.
        IN      A       192.168.1.100
ns1     IN      A       192.168.1.100
www     IN      A       192.168.1.100
mail    IN      A       192.168.1.102
ftp     IN      CNAME   www.example.com.
        IN      MX 10   mail.example.com.
```

Of the SOA five-tuple, **the serial is the heartbeat of primary/secondary sync**: the secondary compares its local serial with the primary's each time and only pulls a new zone when the primary's is larger -- change records without bumping the serial and the secondary forever thinks "nothing changed", the number one root cause of replication lag. Convention is `YYYYMMDDNN` (date plus a daily revision counter), readable and non-wrapping. A CNAME's host cannot carry other records (MX/A cannot coexist on the same name), and when a mail-related name must also serve as an A record, remember to give the apex an A too -- otherwise `mail.example.com`'s CNAME target must point at a different pure A name. After editing, verify in order: `named-checkzone example.com /etc/bind/zones/db.example.com` for the zone, `named-checkconf` for the global config, and finally `rndc reload` or a service restart to make the new serial effective -- reverse the order and a syntax error takes the whole server down. As for "which directory this zone file belongs in", follow the distro's default `directory`: `/etc/bind/zones/` is common in Debian snippets, while Arch/RHEL usually live around `/var/named/`; in a wrong location named may still start but reports file not found when loading the zone, so `ls` first and suspect syntax second.

## 5. Reverse Resolution

A reverse zone writes the IP octets backwards and hangs them under `in-addr.arpa`: `192.168.1.100` corresponds to zone `1.168.192.in-addr.arpa`, and PTR records map addresses back to names. Declaration and records combine into one block -- the `type`/`file` in the zone declaration is perfectly symmetric with the forward zone, the only differences being the filename and the PTR lines:

```text
zone "1.168.192.in-addr.arpa" {
    type primary;
    file "/etc/bind/zones/db.192.168.1";
};
// db.192.168.1 -- SOA isomorphic to the forward zone, serial bumped in step
$TTL    86400
@       IN      SOA     ns1.example.com. admin.example.com. ( 2024010101 3600 1800 604800 86400 )
        IN      NS      ns1.example.com.
100     IN      PTR     www.example.com.
102     IN      PTR     mail.example.com.
```

A PTR target must be written as a **fully qualified domain name ending in a dot**; missing the trailing dot produces the joke `www.example.com.1.168.192.in-addr.arpa` -- the single most common typo in reverse zones. Reverse resolution is not optional in practice: a mail server failing reverse lookups gets deprioritized or even rejected by peers, and in a network with a broken reverse zone, `dig -x` never gives a trustworthy answer during troubleshooting.

When maintaining forward and reverse zones as a pair, bumping both serials inside the same change ticket avoids the half-updated state of "forward in effect, reverse still yesterday"; reverse zones change rarely and are easier to forget, so inspection scripts should include `dig -x` expected results in the smoke test just like `dig A`. If the segment uses dynamic DHCP PTRs, mind the boundary with static PTRs -- never let one address carry both a manual and a dynamic record, since BIND picks one per configured priority; when "the reverse answer is wrong", first confirm which kind of zone you changed.

## 6. Primary/Secondary DNS

### 6.1 Primary Side

The primary keeps the zone declaration from section 4 -- `type primary` and `file` pointing at the authoritative ledger -- plus the two lines opening up for the secondary (`allow-transfer` and `also-notify`, see the example in section 4; not repeated here).

### 6.2 Secondary Side

Installation commands are identical to the primary -- `sudo apt install bind9` on Debian, `sudo pacman -S bind` on Arch (see the section 2 comparison), `sudo dnf install bind` on RHEL; after installing, the only differences are the unit name and config path, and the secondary adds one zone declaration:

```text
zone "example.com" {
    type secondary;
    file "db.example.com.slave";     // a writable path relative to directory
    masters { 192.168.1.100; };
};
```

After a successful pull the secondary writes the zone into its working directory, and a `transfer of ... succeeded` line in the log means the handshake is done. Three things to remember by design: AXFR should default to being tightened to the secondary's IP (any querier on the network being able to drag off the whole zone is an information leak); the serial treats the primary as the single source of truth, so never hand-edit the secondary's file; and `also-notify` makes the primary push actively after a reload, compressing propagation delay from "waiting for the Refresh interval" to seconds -- the same idea as `pacman` pulling up the new version immediately via a systemd unit after an upgrade, both being "actively trigger the effect after a change". Once primary/secondary is set up, daily inspection only needs to watch two things: whether the serials match on both sides, and whether the log shows abnormal transfer failures -- two green lights that worry less than staring at every A record.

## 7. Testing and dig Troubleshooting

```bash
# Syntax verification: the fixed prelude after a config change
$ sudo named-checkconf
$ sudo named-checkzone example.com /etc/bind/zones/db.example.com
zone example.com/IN: loaded serial 2024010101
# Query a specific server / trace the chain / reverse / response code
$ dig @192.168.1.100 www.example.com A
www.example.com. 86400 IN A 192.168.1.100   # excerpt of the ANSWER SECTION
$ dig +trace example.com
$ dig -x 192.168.1.100
$ dig @192.168.1.100 no-such.example.com   # watch STATUS
$ sudo journalctl -u named -f              # the Debian unit is bind9
```

`named-checkzone` printing `loaded serial` means the zone file is accepted at the syntax level; the serial value must match what you wrote in the zone, and a mismatch means you edited a different file -- with multiple environments and zones coexisting, this is the most common root cause of "changed it but nothing happened". The `@` in `dig @IP` selects the authoritative-side entry, and always include it during troubleshooting, otherwise the local cache will pollute the result into "I changed it and it is still old". Memorize the three STATUS states: `NOERROR` with an empty answer means "the domain exists but this record does not"; `NXDOMAIN` means "the whole name does not exist"; `SERVFAIL` usually points at upstream or a DNSSEC validation failure -- three states, three completely different handling paths, and reading STATUS before digging into logs saves half the detours.

Build the habit of reading three lines during troubleshooting: `STATUS` to tell "no domain" (NXDOMAIN) from "no record" (NOERROR empty); `ANSWER SECTION` for the result and TTL; `AUTHORITY SECTION`/`ADDITIONAL SECTION` for who gave the authoritative answer. `+trace` lays out the referral chain, making "stuck at the root or stuck at the authority" visible at a glance; nslookup also works, but its interactive mode is unfriendly to scripted investigation, so prefer `dig` in diagnostic scenarios. Zone change not taking effect? Check in order: was the serial incremented -> did `named-checkzone` pass -> was `rndc reload`/restart done -> did the query hit the local cache (verify the source first with `dig +norecurse @authority`); after these four steps, the vast majority of "changed but not effective" cases narrow to a specific link. Putting these four steps into the change ticket template saves more late-night time than asking in the chat group "who changed the DNS".

## 8. Common Traps

**Service won't start / port occupied.** `systemctl status named` (or `bind9` on Debian) for the error summary, then `journalctl -u named -e` for the full text. The three most common: config syntax errors (reproduce with `named-checkconf`); port 53 taken by systemd-resolved or another DNS stack (`ss -ulnp | grep :53` to find the occupant); permissions/SELinux refusing to read the zone file (`ls -lZ` against the package's default context, `restorecon` when needed). Port opening and inbound policy remain governed by the [Firewall](../../security/firewall.md) page, not repeated here.

**systemd-resolved and named fighting over 53 on one machine.** The symptom is `bind9`/`named` getting halfway up with `address already in use`, or coming up but queries being truncated to 127.0.0.53. If `ss -ulnp | grep :53` points at `systemd-resolved`, choose one per this machine's role: if it is only a recursive exit, let resolved forward to named; if it is to be an authoritative server, disable resolved's listener (change the DNS StubListener in `resolved.conf` or simply `systemctl disable --now systemd-resolved`) and write `/etc/resolv.conf` properly -- same handling order as any port-occupancy problem: identify the occupant first, then decide whether to step aside or shut it down, and never change half on each side.

**Record changes not taking effect.** Follow the four-step method of section 7: a serial not incremented is the top root cause; a `named-checkzone` error means the zone is refused and named keeps running while that zone sits empty; a forgotten reload means the process still holds the old cache; the last link is the testing side's own cache -- strike at the source with `dig +norecurse @authorityIP` to separate "the authority was not changed" from "the cache has not expired".

**Primary/secondary serials out of sync.** If the secondary's log shows no transfers for a long time, compare the serials on both sides first; when they are equal, of course the secondary does not move -- and the question returns to whether the primary incremented and reloaded. Equal serials with different content is a human incident, requiring a forced serial increment on the primary to rebuild the truth; when `allow-transfer` does not admit the secondary's IP, the transfer is silently refused, commonly showing `permission denied` in the log, which you match against the ACL.

**Open recursion on the public internet being abused.** The symptom is abnormal bandwidth and unfamiliar network segments appearing in `allow-recursion` logs. Handling order: tighten the ACL -> consider `recursion no` for a purely authoritative role -> use views to split internal and external answers when necessary. The same logic as "do not open a package repository to untrusted networks": a service's default posture should shrink the trust surface and open up on demand, rather than opening wide and patching afterward -- the signature policy in a `pacman` source file and named's ACL table write down the same trust list.

**Intranet short names not resolving.** Confirm `/etc/resolv.conf` points at your server; confirm the client segment is inside `allow-query`; confirm the name actually exists in the zone and no CNAME dangles. Just as a package not found by `pacman -Ss` first makes you suspect a stale index, an unresolvable DNS name first makes you suspect "you are not asking the server you think you are" -- `dig @serverIP name` is the fastest post-mortem tool.

**DNSSEC validation failure (SERVFAIL).** The symptom is a domain that resolves fine on public resolvers but returns SERVFAIL on your own recursive resolver. Check in order: was `dnssec-validation` set to `no` and then damaged managed keys left behind; does the upstream forwarder return an incomplete DNSSEC chain; is the local clock badly skewed (signature validity follows the clock, and falling out of step with NTP makes every signature "expired"). During investigation, first use `dig +cd` to bypass validation and confirm whether it is a data problem or a validation problem, then decide whether to fix the time, add the DS record, or roll the validation switch back -- same as "before guessing empty, tell a wrong query from missing data": isolate the variable before changing config.

**AXFR refused / secondary cannot get the zone.** The primary's `allow-transfer` not admitting the secondary's IP, `named-checkzone` already red on the primary, or the firewall blocking 53/TCP -- the three look different in logs: an ACL refusal commonly shows `permission denied`, a syntax red means the transfer never starts, and a firewall shows up as a timeout. On the secondary, `dig AXFR example.com @primaryIP` reproduces the handshake directly, faster than reading logs on both sides; same order as in package management "query locally before suspecting the network": first prove the service layer can answer, then suspect the link.

**Old address still answering after an IP change.** The classic result of an overly long TTL plus caching at intermediate layers (recursive resolvers, browsers, the libc cache). Handling: before changing records, lower the TTL to 60 and wait out the old TTL, then switch the A record, and restore the normal TTL afterward; if the problem is discovered after switching, you have to wait for the caches at each layer to expire naturally, and when a forced flush is impossible, the only option is to wait out coverage with the new value. Writing this timeline into the change ticket is far less effort than later explaining "why does it still point at the old machine" -- DNS has no global flush button, and pre-lowering the TTL is the only cheap regret insurance.

## References

- Official BIND 9 documentation -- [bind9.readthedocs.io](https://bind9.readthedocs.io/)
- Arch Wiki: BIND -- [wiki.archlinux.org/title/BIND](https://wiki.archlinux.org/title/BIND)
- Debian BIND manual -- [bind9.readthedocs.io](https://bind9.readthedocs.io/en/latest/)
- "Vbird's Linux Cabinet" - DNS -- [linux.vbird.org](https://linux.vbird.org/linux_server/centos6/0350dns.php)
- RFC 1034/1035 -- the DNS specification
- dig manual -- [man dig](https://linux.die.net/man/1/dig)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [glossary](/glossary.md)
- [commands-practice](/network/commands-practice.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [README](/server/README.md)
- [dhcp](/server/dhcp.md)
- [postfix](/server/mail/postfix.md)
- [network-parameters](/server/network-parameters.md)
- [ntp](/server/ntp.md)
- [scheduled-tasks](/system-management/scheduled-tasks.md)