# LDAP Unified Account Management

Ten Linux servers, ten independent copies of `/etc/passwd` -- this is the debt most teams start accumulating with their second server. The ongoing bills come in roughly three shapes: changing one password means running `passwd` on ten machines, and the one you missed is still using the old password next quarter; when an employee leaves, accounts are deleted by walking a spreadsheet with `userdel`, and the one you forgot to delete is a long-dormant entry point; the sudo whitelist lives in ten sudoers files, alignment is done by eye, and whoever edits first becomes the de facto standard. The common root of these pain points: there are ten copies of the "account truth". NIS (Network Information Service) was the first answer -- turning passwd/group into shared mappings that clients query -- but it transports everything in cleartext, has a flat naming space, and no per-entry access control, with password hashes roaming in the clear across the LAN. The ecosystem has delivered its verdict: since RHEL 8.3 NIS is deprecated, RHEL 9 removed it wholesale, and Fedora is retiring the ypbind family of tools. The successor is LDAP: one directory server holds the single account truth, and ten clients query and authenticate through SSSD -- change it in one place and it takes effect everywhere. This page is organized as "directory model -> OpenLDAP server -> building the tree -> TLS -> SSSD clients -> authorization and access control", with the three families (Debian/Ubuntu, RHEL/Rocky, Arch) compared throughout, and common failures collected in the penultimate section.

> Content draws on the official OpenLDAP documentation and the directory service documentation of Ubuntu, RHEL, and Arch respectively; see the references at the end.

## What This Page Covers

- Describing the organization with a tree-shaped naming space (dc/ou/cn/uid), and reading and writing LDIF
- Explaining the constraint relationship between schema, objectClass, and "what attributes a directory can store"
- Completing the OpenLDAP server install, setting the suffix and administrator, building the directory tree, and verifying with queries
- Protecting the bind process with TLS certificates, and making an informed choice between ldaps and StartTLS
- Configuring SSSD client integration on the three families, verifying NSS with `getent`, and solving home directory creation
- Reading the semantics of olcAccess and configuring the baseline of "users change their own password, admins have full rights, everyone else read-only"

## 1. The Directory Service Model: What LDAP Actually Is

### 1.1 A Tree: DN and Naming Prefixes

LDAP organizes accounts into an inverted tree; each entry's position in the tree is its DN (Distinguished Name), written from leaf toward root, joined with commas: `uid=alice,ou=people,dc=example,dc=com`. Four prefixes cover ninety percent of cases -- dc (Domain Component) carries the DNS domain, with example.com split into `dc=example,dc=com` as the tree root; ou (Organizational Unit) is the organizational unit, with people, groups, and service accounts each under their own branch; cn (Common Name) is the generic "name", commonly used for group and administrator entries; uid refers specifically to login names. The DN is unique across the whole tree -- it is the primary key of an account in the directory.

### 1.2 LDIF and Schema: Who Decides What Can Be Stored

LDIF (LDAP Data Interchange Format) is the textual representation of directory data; all add/delete/modify operations are expressed in it. One entry is one LDIF block: a `dn` line first, then several `objectClass` and attribute-value pairs. objectClass is the key constraint -- it declares "what kind of thing" the entry is, and specifies required and optional attributes: posixAccount (from the nis schema) demands `uid`, `uidNumber`, `gidNumber`, and `homeDirectory` without exception, and a single missing one makes `ldapadd` report an objectClass violation. Whatever schemas are loaded is what the directory can store -- the default core/cosine/nis/inetorgperson set covers the Unix account scenario, and to store specialized data such as sudo rules or mail aliases you load the corresponding schema. This is isomorphic to "create a table, define its columns" in a relational database, except the table structure ships as schema files with the package.

### 1.3 It Only Manages the Directory; Authentication Rides on simple bind

First, straighten out a commonly misunderstood statement: LDAP is a directory access protocol, not an authentication system in itself. The client's way of proving a password is plain and direct -- simple bind: present the DN and password, the server checks the entry's `userPassword` attribute (stored as a salted hash such as `{SSHA}`), and a match admits the session. The more careful division of labor in production in one sentence: Kerberos handles authentication (it issues tickets, and the password never crosses the network), LDAP handles directory data (identity attributes, group membership), and FreeIPA and Active Directory are products that package the two together. This page's main line starts with simple bind, and section 4 solves its cleartext problem; adopt Kerberos when you reach the necessary scale -- both paths share the same directory tree.

## 2. The Server: OpenLDAP and cn=config

### 2.1 Install Comparison Across the Three Families

| Action | Debian/Ubuntu | RHEL/Rocky | Arch |
|------|---------------|-----------|------|
| Install | `apt install slapd ldap-utils` | `dnf install openldap-servers openldap-clients` | `pacman -S openldap` |
| Service unit | slapd.service | slapd.service | slapd.service |
| Config directory | `/etc/ldap/slapd.d/` | `/etc/openldap/slapd.d/` | `/etc/openldap/slapd.d/` |
| Data directory | `/var/lib/ldap` | `/var/lib/ldap` | `/var/lib/openldap/data` |

Remarkably, all three families call the service unit `slapd`; the differences concentrate in config paths and how the packages are split. One thing must be disclosed about the RHEL family up front: since RHEL 8 Red Hat has moved `openldap-servers` out of its own repositories, and the officially recommended replacements are Red Hat Directory Server or IdM; Rocky puts the package back in the plus repository (`dnf --enablerepo=plus install openldap-servers`), while RHEL itself needs EPEL, whose package version occasionally lags -- verify before installing. Arch's openldap package contains both server and client, with config and data under `/etc/openldap/`; before enabling slapd.service you must set the suffix and rootdn (the Arch Wiki gives steps for rebuilding cn=config from slapd.ldif).

### 2.2 Debian's debconf Interaction and Reconfiguration

On Debian/Ubuntu, `apt install slapd` asks four things via debconf: the DNS domain (which determines the suffix), the organization name, the administrator password, and the database backend. Right after install you have a usable little tree: the suffix is the domain you typed, and the rootdn is `cn=admin,<suffix>`. If you typed it wrong or want to change it, there is no need to uninstall and reinstall:

```bash
$ sudo dpkg-reconfigure slapd
# Re-set the domain, organization name, and admin password at the prompts; the database is rebuilt under the new suffix; back up with slapcat first if there is data
```

The benefit of this path is that the suffix is right from installation, so you can build the directory directly in section 3. On RHEL/Arch the default suffix after install is still the placeholder `dc=my-domain,dc=com` (or empty), so you must edit the config per section 3.1 first.

### 2.3 cn=config: The Configuration Is Itself a Directory

The old single-file slapd.conf model from textbooks has been retired (cn=config is the default since OpenLDAP 2.4): the configuration is itself an LDIF tree, living in `/etc/ldap/slapd.d/` (Debian) or `/etc/openldap/slapd.d/` (RHEL/Arch), edited online with ldapmodify and taking effect immediately without a restart. The act of changing config goes from "edit a file and restart" to "send LDIF to the configuration directory", using the same syntax as changing business data later. Local root connects over the Unix socket as SASL EXTERNAL and can then read and write the whole config tree:

```bash
$ sudo ldapsearch -Y EXTERNAL -H ldapi:/// -b cn=config '(olcDatabase={1}mdb)'
# -Y EXTERNAL uses the socket peer's identity (local root); ldapi:/// is the local Unix socket
# The olcSuffix and olcRootDN in the output are the current database's domain and administrator
```

Depending on the version, the database name may be `{1}mdb` or the older `{1}hdb`; list `olcDatabase` under cn=config before acting. Files in the config directory should not be edited by hand -- they are slapd's output, and only writes through ldapmodify keep the format self-consistent.

## 3. Building the Directory Tree: suffix, rootdn, and the First Entries

### 3.1 Setting the Suffix and the Administrator

Debian-family installs already completed this step, so skip ahead to 3.2. On RHEL/Arch you need to change three attributes: olcSuffix (the tree root), olcRootDN (the superuser), and olcRootPW (a password hash generated with slappasswd):

```bash
$ slappasswd        # type it twice interactively; paste the {SSHA}... hash into the LDIF below
$ cat > suffix.ldif <<'EOF'
dn: olcDatabase={1}mdb,cn=config
changetype: modify
replace: olcSuffix
olcSuffix: dc=example,dc=com
-
replace: olcRootDN
olcRootDN: cn=admin,dc=example,dc=com
-
replace: olcRootPW
olcRootPW: {SSHA}4XRhAeGlmS2GXjTQG7H8bKXq0cJFjUoP
EOF
$ sudo ldapmodify -Y EXTERNAL -H ldapi:/// -f suffix.ldif
```

In LDIF, `-` separates multiple change sets on the same entry, so the three attributes are done in a single replace operation. olcRootDN is the superuser of this tree, and its password hash lives in cn=config -- it is independent of any entry inside the directory, so even if the directory is wiped it can be rebuilt from it.

### 3.2 Organizational Structure and Users: LDIF in Practice

Build three organizational units first: people for users, groups for groups, and services for service accounts (the ones that only know a password and do not get a shell). The tree is built from the root downward, and the LDIF files are written in that order:

```text
# base.ldif -- the tree root and organizational units
dn: dc=example,dc=com
objectClass: dcObject
objectClass: organization
o: Example Inc
dc: example

dn: ou=people,dc=example,dc=com
objectClass: organizationalUnit
ou: people

dn: ou=groups,dc=example,dc=com
objectClass: organizationalUnit
ou: groups

dn: ou=services,dc=example,dc=com
objectClass: organizationalUnit
ou: services
```

Write them in with `ldapadd`: `-x` means simple bind, `-D` names the administrator DN, and `-W` prompts for the password interactively. Debian-family installs already created the root entry, so append from `ou=people` onward; re-adding the root entry reports Already exists (68):

```bash
$ ldapadd -x -D "cn=admin,dc=example,dc=com" -W -f base.ldif
# Each entry echoes one adding new entry "..." line; an error names exactly which entry failed
```

Add people and groups in pairs; uidNumber/gidNumber must be unique across the whole organization and must not collide with each machine's local accounts -- a common plan stops local accounts at 9999 and starts directory accounts at 10000:

```text
# alice.ldif -- one person and her primary group
dn: cn=dev,ou=groups,dc=example,dc=com
objectClass: posixGroup
cn: dev
gidNumber: 20001

dn: uid=alice,ou=people,dc=example,dc=com
objectClass: inetOrgPerson
objectClass: posixAccount
objectClass: shadowAccount
uid: alice
cn: Alice Chen
sn: Chen
uidNumber: 10001
gidNumber: 20001
homeDirectory: /home/alice
loginShell: /bin/bash
userPassword: {SSHA}q9kVz0eRbM3nWtYpLc2A8sDfGhJ5uXwQ   # generated with slappasswd
```

posixAccount carries the Unix account semantics (the four required attributes are in section 1.2), inetOrgPerson adds the person's natural attributes, and shadowAccount leaves a hook for password expiration policies. You do not have to hand-write hashes to change passwords: on the server use `ldappasswd`, and once SSSD is integrated the client's `passwd` command can also change the password in the directory directly (the access rules of section 7 guarantee the user can write their own).

### 3.3 Query Verification

```bash
$ ldapsearch -x -b dc=example,dc=com '(uid=alice)'
# -x is anonymous simple bind (whether anonymous reads are allowed is decided by the olcAccess of section 7); -b is the search base, and matches echo back all attributes
```

The parameter combinations of `ldapsearch` are the everyday dialect of troubleshooting: `-H` swaps protocol and address (`ldaps://ldap.example.com`, or `ldap://` with `-ZZ` to force StartTLS), and `-D` plus `-W` switches to the administrator identity to read all attributes. If the entry is found and its attributes are complete, the server side has closed its loop.

## 4. TLS: A Cleartext bind Cannot Go to Production

The simple bind's password crosses the network in cleartext -- a capture on the LAN intercepts it. This is not a matter of the "the LAN is safe" gambit; it is a fact at the protocol layer. TLS is not a bonus; it is a precondition.

### 4.1 The Server-Side Certificate Trio

```bash
$ cat > tls.ldif <<'EOF'
dn: cn=config
changetype: modify
add: olcTLSCertificateFile
olcTLSCertificateFile: /etc/ldap/tls/ldap.example.com.crt
-
add: olcTLSCertificateKeyFile
olcTLSCertificateKeyFile: /etc/ldap/tls/ldap.example.com.key
-
add: olcTLSCACertificateFile
olcTLSCACertificateFile: /etc/ldap/tls/ca.crt
EOF
$ sudo ldapmodify -Y EXTERNAL -H ldapi:/// -f tls.ldif
$ sudo chown openldap:openldap /etc/ldap/tls/*.key && sudo chmod 600 /etc/ldap/tls/*.key
```

Each of the three has its job: the certificate file presents the identity, the private key file signs the handshake, and the CA certificate validates client certificates (mandatory for mutual authentication, recommended even for one-way TLS). The certificate's CN/SAN must match the hostname the client connects with -- a certificate issued for `ldap.example.com` fails hostname verification when the client connects by IP, a veteran of the troubleshooting section. After configuration, slapd must also listen on 636: on Debian-family systems set `SLAPD_SERVICES="ldap:/// ldaps:///"` in `/etc/default/slapd`, on RHEL set `SLAPD_URLS` in `/etc/sysconfig/slapd`, and on Arch set `SLAPD_URLS` in `/etc/conf.d/slapd` and restart (the environment file read by `slapd.service`, per the current Arch Wiki OpenLDAP page).

### 4.2 Client CA Trust and the Two Encryption Paths

On the client side, add the CA certificate to the trust: system-wide (drop it in the distro's CA directory and run `update-ca-certificates` or `update-ca-trust`), or set `TLS_CACERT` in the OpenLDAP client config `/etc/ldap/ldap.conf`; SSSD specifies it with `ldap_tls_cacert` in sssd.conf. There are two encryption paths: ldaps:/// (port 636) is TLS from the very first byte of the connection, with a fixed port that is easy to pin down in the firewall and no possibility of forgetting to enable encryption on a plaintext session; StartTLS (port 389) connects in plaintext first and then negotiates the upgrade, reusing one channel, but leaving a downgrade surface in the negotiation window. Their encryption strength is equivalent; the difference is "from which byte onward it is ciphertext". For new deployments, a single ldaps channel with only 636 opened in the firewall is recommended; where an existing 389 ecosystem must be maintained, use StartTLS and make it mandatory on the server side (olcSecurity containing `tls=1`). The verification step is the same: `ldapwhoami -x -H ldaps://ldap.example.com -D "uid=alice,ou=people,dc=example,dc=com" -W` returning the DN with no warnings closes the loop on link encryption.

## 5. Client Integration: The SSSD Main Line

With a tree on the server, integrating ten clients is what completes "consistency". The modern main line is SSSD (System Security Services Daemon): a local daemon that talks upstream to LDAP (or AD/IPA) and serves the system downstream through the two standard interfaces NSS and PAM -- getent, login, and sudo never need to know that accounts live in a directory. The old route, nslcd/pam_ldap, is still common in old documentation; it is a direct no-cache approach, weak at caching, offline login, and multi-domain integration, and is not recommended for new deployments.

### 5.1 Install and Configuration Comparison Across the Three Families

| Action | Debian/Ubuntu | RHEL/Rocky | Arch |
|------|---------------|-----------|------|
| Install | `apt install sssd sssd-ldap` | `dnf install sssd sssd-ldap` | `pacman -S sssd` |
| NSS/PAM wiring | done automatically by the package scripts via pam-auth-update | `authselect select sssd with-mkhomedir` | edit nsswitch.conf and system-auth by hand |
| Automatic home creation | `apt install libpam-mkhomedir`, then enable via pam-auth-update | included by with-mkhomedir; `systemctl enable --now oddjobd` | add pam_mkhomedir.so to the session section of system-auth |

The config file follows the same path and name on all three families -- `/etc/sssd/sssd.conf`, with identical syntax; the minimal working form is:

```text
# /etc/sssd/sssd.conf -- permissions must be 600; with looser permissions sssd refuses to start and does not say so clearly
[sssd]
services = nss, pam
domains = example.com

[domain/example.com]
id_provider = ldap
auth_provider = ldap
ldap_uri = ldaps://ldap.example.com
ldap_search_base = dc=example,dc=com
ldap_tls_cacert = /etc/ldap/tls/ca.crt
cache_credentials = True
# After saving: chmod 600 this file, then systemctl enable --now sssd
```

With `cache_credentials = True` enabled, already-logged-in users can still authenticate locally when the directory server is briefly unreachable (offline caching); this is one of SSSD's core gains over the older approach. RHEL-family `authselect select sssd` takes over the shared NSS and PAM stacks -- record the current state with `authselect current` before changing the stack, the same discipline as "leave yourself a way back before editing" on the PAM page.

### 5.2 nsswitch, PAM, and Home Directories

The two pipelines SSSD uses to supply accounts must be wired up at the system level. NSS handles lookups; add sss after files on the three lines of `/etc/nsswitch.conf`:

```text
passwd: files sss
group:  files sss    # order semantics: check local files first, then ask sss
shadow: files sss
```

Reversing the order (putting sss before files) breaks even local root resolution -- the moment the directory hiccups, local sudo, cron, and systemd all fail in a chain. On Debian-family systems the package scripts of libnss-sss/libpam-sss fix these two lines automatically, so just verify; on Arch and in hand-managed setups you edit them yourself. PAM handles authentication: pam_sss.so is hooked into the auth stack, and at login the password is handed by SSSD to the directory for verification -- for how to read and edit the PAM stack itself see [PAM and sudo](../security/pam-sudo.md); this page does not repeat it. Home directories are the last link: an account in the directory has no home on this machine, and the first login crashes (the shell drops to the root directory). There are two remedies: Debian-family systems create it at login with the pam_mkhomedir module, RHEL-family systems delegate to the oddjob-mkhomedir service (enable the with-mkhomedir feature), and Arch has you add one pam_mkhomedir.so line to the session section of system-auth by hand.

### 5.3 Verification

```bash
$ getent passwd alice
alice:*:10001:20001:Alice Chen:/home/alice:/bin/bash
# Hard evidence that NSS is live: she is not in the local /etc/passwd; this record comes from the directory; id alice should show the same origin
$ ssh alice@localhost    # log in with the directory password; the home directory is created automatically
```

`getent` is the key acceptance action: it walks the same NSS pipeline as the login programs -- if getent finds the account but ssh will not log in, the problem is on the PAM side; if getent cannot find it, the problem is on the NSS/SSSD side. Repeat 5.1-5.3 on the ten machines; this kind of configuration is a good candidate for distribution by automation tools (see [Automation](../system-management/automation.md)).

## 6. Authorization and Least Privilege

With accounts in the directory, the next step is tightening down "who can do what". Login admission is filtered by group: SSSD's ldap_access_filter decouples "has an account in the directory" from "is allowed to log into this machine" -- all ten ops people have directory accounts, but the database machine only admits the dba group:

```text
# Appended to the [domain/example.com] section of /etc/sssd/sssd.conf
access_provider = ldap
ldap_access_filter = memberOf=cn=dba,ou=groups,dc=example,dc=com
```

Before changing anything, reconcile on the directory side first: `ldapsearch -x -H ldaps://ldap.example.com -b ou=groups,dc=example,dc=com '(cn=dba)' memberUid` lists the login names in the group so you can check them against the expected list. Two cautions: OpenLDAP does not produce the memberOf attribute by default, so the memberof overlay must be enabled (loaded dynamically via back-config with `olcModuleLoad: memberof` plus `olcOverlay: memberof`; the parameter family was renamed `olcMemberOfConfig` in 2.5; static slapd.conf deployments write `overlay memberof` directly -- see man slapo-memberof(5) and the OpenLDAP 2.6 administration guide); and when the filter is misconfigured, SSSD defaults to deny rather than allow -- the safe direction, but it can lock you out as well, so keep a logged-in session open and verify after editing. Sudo rules in the directory in one line: sudo ships its own LDAP schema, so writing sudoers rules as entries into the directory shares one copy across the ten machines (Debian-family systems have a separate sudo-ldap package for this); most teams start with a lighter combination -- group membership in the directory, and a single local sudoers line `%ops ALL=(ALL:ALL) ALL`, which is enough at this stage. Finally, cache invalidation: SSSD caches directory data locally, so when an attribute changes on the directory side (adding a group, renaming), the client waits for the cache to expire or you clear it manually with `sudo sss_cache -E` (users, groups, and credentials all invalidate together). The troubleshooting mnemonic: directory changed but the client does not react, run `sss_cache -E` before doubting the configuration -- get the order wrong and you waste half a day investigating nothing.

## 7. Access Control: olcAccess

The previous sections assumed "anonymous readable, admin with full rights"; a real directory needs the read/write surface narrowed. olcAccess is an ordered list of rules: each rule first declares which entries and attributes it governs (`to ...`), then lists who may do what (`by ...`); rules are evaluated top to bottom and the first match wins, by clauses likewise, and if everything falls through the result is deny. A baseline rule set covering this page's scenarios:

```bash
$ cat > acl.ldif <<'EOF'
dn: olcDatabase={1}mdb,cn=config
changetype: modify
replace: olcAccess
olcAccess: {0}to attrs=userPassword
  by self write
  by anonymous auth
  by dn.exact="cn=admin,dc=example,dc=com" write
  by * none
olcAccess: {1}to *
  by dn.exact="cn=admin,dc=example,dc=com" write
  by * read
EOF
$ sudo ldapmodify -Y EXTERNAL -H ldapi:/// -f acl.ldif
```

Read it rule by rule: {0} clamps the password attribute as tightly as possible -- the owner may change it (self write), anonymous connections may only use it for authentication comparison (anonymous auth, which is "verifying a password", not "reading the hash"), the admin may change it, and nobody else can even see it; {1} is the fallback making everything world-readable -- uid, uidNumber, and group membership are public data the login path needs anyway, so being readable is not a sin, while the hash staying invisible is the bottom line. The indexes `{0}{1}` are ordering declarations, and a replace rewrites the whole set. Do not verify by imagination: read someone else's userPassword as alice and you should get an empty result, and an anonymous query is allowed but cannot obtain the password attribute -- that matches the intent.

## Common Failures

**Invalid credentials (49).** `ldapadd`/`ldapwhoami` reports `ldap_bind: Invalid credentials (49)`: the bind DN or the password is wrong. Two frequent mix-ups: a typo in one RDN of the DN (writing `uid=admin` for `cn=admin`, an entry that does not exist in the directory at all), or using the system password as the password set for olcRootPW. Verify the DN first, then the password: `ldapsearch -x -b dc=example,dc=com '(cn=admin)'`; if nobody shows up, fix the DN first.

**TLS hostname mismatch.** The client reports `Can't contact LDAP server (-1)`, and the server log contains `TLS: hostname does not match CN in peer certificate`: the certificate was issued for ldap.example.com while the client URI carries an IP or an alias. The thorough fix is a certificate SAN covering all access names, or connecting by DNS name everywhere; for temporary diagnosis you can add `LDAPTLS_REQCERT=never` to confirm the culprit, but never in production.

**nsswitch order reversed, so even local root cannot resolve.** Once `passwd: sss files` is written backwards, name resolution asks the directory first; the moment the directory or sssd hiccups, `id root` comes up empty and sudo, login, and cron all stop working in a chain. The fix requires a physical channel: a console or a surviving root session to put the order back to `files sss`. The rule in one line: sss always comes after files.

**objectClass violation (65).** `ldapadd` reports `Object class violation` along with the name of a missing attribute: the entry declares some objectClass but did not supply all required attributes (posixAccount's homeDirectory is a regular offender); the other variant is a schema that was never loaded -- on a minimal install where the nis schema is absent, posixAccount is not even recognized. Add the attributes first; for a missing schema load the corresponding file -- Debian-family systems ship converted `.ldif` files under `/etc/ldap/schema/` (e.g. misc.ldif), loaded with `ldapadd -Y EXTERNAL -H ldapi:/// -f`.

**Stale SSSD cache.** An account was deleted or its uid changed on the directory side, but the client's `getent` still returns the old value. Try `sudo sss_cache -E` first; when it is stubborn, stop sssd, clear `/var/lib/sss/db/`, and start it again -- the latter also wipes offline credentials and users must log in again, so use the two measures in that order.

**Firewall blocking 389/636.** The client reports `Can't contact LDAP server (-1)` while the server's slapd is clearly active. First probe from the client with `nc -zv ldap.example.com 636` (or 389); if that fails, check the server-side firewall and cloud security groups; on RHEL-family systems `firewall-cmd --add-service=ldaps` opens 636 in one step, with the full policy in the [Firewall](../security/firewall.md) page.

## Division of Labor with Other Pages

Single-machine users, groups, and password files are covered thoroughly in Basics · [Account Management](../basic/users/account_management.md); this page answers "how do ten machines share one truth". The post-login authorization details (PAM stack, sudoers) are developed in Security · [PAM and sudo](../security/pam-sudo.md); this page only touches PAM where SSSD is wired up. Sibling scenarios of cross-machine consistency each have their home: Samba's shared-disk ledger is a volume of its own ([Samba File Sharing](./samba.md)); aligning UIDs on both ends of NFS takes directory accounts as the thorough fix ([NFS Server](./nfs.md)); account consistency unifies the "people" side, while consistency of the software environment is handed to [Containers](../server/container/docker.md).

## References

- OpenLDAP official administration guide -- [openldap.org/doc/admin24](https://www.openldap.org/doc/admin24/)
- Ubuntu server documentation -- [ubuntu.com/server/docs](https://ubuntu.com/server/docs)
- Arch Wiki: OpenLDAP -- [wiki.archlinux.org/title/OpenLDAP](https://wiki.archlinux.org/title/OpenLDAP)
- Red Hat documentation (SSSD and directory services) -- [docs.redhat.com](https://docs.redhat.com/)
- man pages -- man slapd-config, man sssd.conf, man sssd-ldap, man ldapsearch

<!-- BACKLINKS-AUTO -->
## Related Pages

- [knowledge](/knowledge.md)
- [README](/research/README.md)
- [application-scenarios](/research/application-scenarios.md)
- [authoritative-books](/research/authoritative-books.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [gap-fill](/research/gap-fill.md)
- [README](README.md)
- [ssh](ssh.md)