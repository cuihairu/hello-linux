# Encryption

Cryptography is the core of information security, used to protect the confidentiality and integrity of data. But the word "encrypt" actually points to four different jobs in Linux ops: **protecting transit** (TLS/SSH), **proving identity and integrity** (GPG signatures), **protecting data at rest** (LUKS disk encryption), and **checking consistency** (hashing). Confuse the four and you will reach for the wrong tool -- trying to "encrypt" a file with a hash, or treating a self-signed certificate as a publicly trusted one. This page is organized as "why you need this kind of encryption -> how to make it real," and covers installing the tools across the three distro families plus the common incidents.

> Content draws on the official documentation of OpenSSL, GnuPG, OpenSSH, and cryptsetup, plus the Arch Wiki -- see the references at the end.

## Introduction

Half of all security problems eventually reduce to "the data became unsafe somewhere along the way": a database export copied off by someone, SSH broken into on a weak password, a downloaded installer swapped for a backdoor by a man in the middle, an old drive retired and handed straight to someone. Cryptography is the common language for these scenarios, but it is not a one-and-done job -- **picking the wrong key type, getting the certificate chain wrong, or skipping recovery planning can make encryption worse than no encryption at all** (data permanently undecryptable, a trust chain polluted by misplaced trust).

In the Linux ecosystem each of these four jobs has a mature tool, almost all preinstalled or available from the official repos: all three families have `openssl`, GPG is `gnupg` on Debian/Arch and `gnupg2` on the RHEL family, SSH is `openssh`, and disk encryption is `cryptsetup`. On Arch a single `sudo pacman -S gnupg cryptsetup` fills in what is missing (`sudo pacman -S openssl openssh` does the same for the transit side), and most of the rest already sits under `/usr/bin` in a minimal install. Having the tools is only the starting point -- the **configuration quality** of these four jobs on one machine can differ wildly: a stock SSH, an expired certificate, an unsigned deploy script, an encrypted disk with no header backup. All classic "the tools are installed but no discipline was built." Every section here follows "install the tool -> threat model -> operational discipline": the commands are the surface, the discipline is the substance.

## What This Page Covers

- Clarify the division of labor between symmetric and asymmetric encryption
- Understand the boundaries of hashing: it verifies integrity, but cannot be used to "encrypt and recover"
- Generate keys, sign, and verify signatures with GPG
- Read the TLS handshake and the certificate chain
- Replace password login with SSH keys (ed25519)
- Where LUKS full-disk encryption applies, and its **irreversible** risks

The six goals map to the six body sections of this page (section 1 lays the foundation, sections 2-5 cover the tools, section 6 collects the pitfalls). The recommended reading order is to read through section 1 first to build an intuition for the primitives, then jump around by whichever scenario is most urgent -- working on a release pipeline takes you straight to GPG, working on SSH takes you to section 4. But **do not skip section 1**: every later judgment of "why you cannot use X for Y" is built on that primitive table. Each goal is paired with a read-back action from the text (check the signer with `gpg --verify`, check `notAfter` with `openssl`, check the effective config with `sshd -T`); judge by the command output, not by "I read it." The six goals compress into one selection maxim: **ask about the property first (confidentiality/integrity/identity), then pick the primitive, and only then open the tool** -- reverse the order and you get the class of no-op where the command succeeds and the protection is zero, like "hashing used as encryption."

Items 4 and 5 of the coverage share one underlying discipline: **before an irreversible operation, verify that the fallback path exists** -- confirm key login before turning off passwords, confirm the device name and the header backup location before `luksFormat`. Items 2, 3, and 6 share another: **trust the read-back command output** -- the signer list, the `notAfter` field, the effective values from `sshd -T` are all evidence you can write into a change ticket. Grouping the six items by these two disciplines is easier to recall in the field than memorizing them by section order. The two disciplines also combine into one sentence for on-call duty: **leave yourself a way back before touching a key, and read the output after touching it** -- most encryption incidents trace back to one of these two not being executed.

A hands-on test for having read this: given a release artifact, a new server, and a portable drive, you should be able to use these notes to check off completing "sign + verify," "ed25519 key login with passwords turned off (after confirming the new path works)," and "LUKS format + header backup + test unlock," and to say who each step defends against. If you cannot name the threat target for any one of the three, you are only typing commands and have not yet built a threat model. The two "confirm first, then do it" orderings in that test cannot be swapped -- after signing, verify on another machine first; after key login, open a new session first before turning off passwords. **Getting the order right proves you understand the risk boundary better than typing the command faster does.**

A threat-model verbal test can add one more question: **in what situations does each of these three fail?** A signature cannot stop a stolen private key from signing under your name, key login cannot stop an attacker who first planted a trojan that reads your agent, and LUKS cannot stop direct disk reads once the machine is unlocked. If you can volunteer the failure conditions yourself, the threat model is complete; if you can only say "once it is done it is safe," you are still at the tool layer.

## 1. Encryption Fundamentals: What Each of the Three Primitives Solves

Tool manuals always start with "how to generate a key," but the ops selection order should run backwards: first ask what property needs protection, then pick the primitive, and only then land on the command. The classic symptom of reversing the order is "I encrypted the password hash with AES" or "I ran SHA-256 over the file and declared it encrypted" -- the commands all succeeded, but the property was never protected. What ops means by "encryption" is actually three completely different mathematical primitives doing the work. When selecting, first ask what property you are protecting: **confidentiality** (no one else can see it) -> symmetric or asymmetric encryption; **integrity/identity** (no one else can change it, and you can prove who changed it) -> signatures and hashing. The two often appear together, but the tools and commands are entirely different. The cost of using the wrong primitive is more than "no effect" -- using a hash as encryption creates false confidence, and a signature that is never verified is the same as no signature. You can also read the three-row table as "three different questions": **"can someone else see it?" -> encrypt, "did someone else change it / who sent this?" -> hash + signature, "how do I get the key to the other side safely?" -> asymmetric**. Write the question down before picking the tool; that is the selection discipline for this whole page:

| Primitive | Use | Typical algorithms | Key characteristics |
|------|------|---------|---------|
| Symmetric encryption | Confidentiality for large volumes of data | AES-256-GCM, ChaCha20 | Same key encrypts and decrypts; fast |
| Asymmetric encryption | Key exchange, digital signatures | Ed25519, RSA, X25519 | Public/private key pair; slow |
| Hash function | Integrity, fingerprints | SHA-256, SHA-512 | One-way, fixed length, irreversible |

### 1.1 Why Both Symmetric and Asymmetric Are Needed

**The bind with symmetric encryption is key distribution**: you and the other party need to share the same key, so how do you get that key to them without it being eavesdropped? -- what protects "the key-transport process" is asymmetric encryption. **The bind with asymmetric is performance**: public-key operations are orders of magnitude slower than AES, unsuitable for encrypting a whole disk or an entire video stream.

So every modern protocol uses hybrid mode, and TLS is the most typical example:

1. During the handshake, asymmetric algorithms complete identity verification and session-key negotiation (the client verifies the server certificate signature and negotiates a one-time symmetric key);
2. During the application-data phase, everything is encrypted with that symmetric key (AES-GCM and the like).

SSH works the same way: key exchange uses KEX (based on elliptic curves/DH), and once the channel is established the rest of the data goes over symmetric encryption. **Remember this division**: "asymmetric solves how to trust each other on a first meeting, symmetric solves how to talk efficiently after you have met."

This division also explains two common phenomena in ops. First, complaints that TLS certificates are "too big and too heavy" mostly come from the asymmetric operations in the handshake and the transfer of the certificate chain; HTTP/2, session resumption, and TLS 1.3's 0-RTT are all about compressing the cost of "the first meeting," not about replacing the asymmetric step -- without a public-key system, the two sides cannot agree on a key only they know over a public channel. Second, SSH goes through KEX on every login, but transferring large files afterwards is fast, because the symmetric cipher is what actually moves the data. Once you understand these two layers, questions like "why can you not use AES alone" or "why is RSA slow" land naturally on the right layer.

When selection lands on algorithm names, you can memorize one set of "good enough by default" modern combinations: on the TLS side, TLS 1.3 or 1.2 with an AEAD suite (AES-GCM, ChaCha20-Poly1305); on the SSH side, ed25519 for the key and the curve25519 family for KEX; ECDSA P-256 or RSA-3072+ for certificate signing. 3DES, RC4, SHA-1, and TLS 1.0/1.1 from older material appearing in a config should be treated as cleanup items -- **algorithm lists do expire, but the policy "use modern by default, explicitly disable old suites" does not**. The distro defaults across all three families have been tightening in this direction in recent years, so aligning with the distro default when writing a custom config is often safer than copying a five-year-old blog post.

### 1.2 Hashing Is Not Encryption

The last row of the table is the easiest to misuse and deserves its own expansion: hashing is one-way -- `sha256sum` cannot "decrypt" back to the original, so it **provides no confidentiality**, only integrity and fingerprints. A common misuse is "I stored the passwords as MD5 so it is safe" -- MD5/SHA-1 have been broken by collision attacks; password storage needs a deliberately slow KDF like bcrypt/scrypt/Argon2, not an ordinary hash. For everyday file integrity checking, SHA-256 is enough:

```bash
$ sha256sum backup.tar.gz
e3b0c442...7852b855  backup.tar.gz
```

Linux distro package-repo signing and ISO download verification all rest on the combination "hash + asymmetric signature": the repo signs the "package hash manifest" with a private key, and the client verifies with the public key -- this is exactly GPG's main battlefield in the next section, and the mathematical basis for `pacman`, `apt`, and `dnf` being able to "automatically trust the official sources." The "checking signature" prompt you see when installing software is that mechanism making a trust decision for you; its safety depends on **the repo public key in the system trust store not having been replaced** -- once the root of trust is lost, an automatically passing chain verification means nothing. This is also why baseline hardening (see [Hardening](./hardening.md)) protects write access to trust-anchor directories like `/etc/pacman.d/` and `/etc/apt/`.

## 2. GPG: Signing, Encryption, and the Trust Chain

The earlier sections keep emphasizing the "hash + signature" combination; as a tool that is GPG (GnuPG) -- an implementation of the OpenPGP standard. The most common ops use is **signing** (proving "this file really was published by me"), not encryption. Putting signing before encryption is not a typo: most teams never use GPG encrypted mail even once a year, but they sign a release, a config change, or a backup manifest almost every week; the return on investment is obvious at a glance. You can also say signing answers "**can this be trusted**," while encryption answers "**who can see it**" -- the former comes up at a far higher frequency in daily ops, so this section leads with signing and only turns on encryption when the threat model explicitly requires it. Installation on the three families:

```bash
# Debian/Ubuntu
sudo apt install gnupg
# Arch
sudo pacman -S gnupg
# RHEL/CentOS/Rocky
sudo dnf install gnupg2
```

Note that the RHEL family package name is `gnupg2`, but it still provides the `gpg` command -- package name and command name disagreeing is a confusion you run into when reading older material. After installing, confirm with `command -v gpg` rather than assuming the package name equals the command name; `gpg` behaves basically the same across the three families, the keyring directory defaults to `~/.gnupg/` everywhere, and migrating keyrings across distros is just copying that directory (watch ownership and permissions).

Migrating a keyring has one security detail that is often overlooked: copying `.gnupg` means copying every private key. The transport channel itself must be encrypted (scp/ssh, not a plain HTTP file-sync service), and on the target machine run `chmod 700 ~/.gnupg` before putting the files in, so another user on the same host cannot read them mid-transfer. For service accounts (a CI pipeline that must sign), do not reuse a personal keyring -- generate a separate signing key with a restricted purpose and limit its trust level. **Mixing a personal identity key with a machine identity key is the laziest move with the widest blast radius.**

The priority order for GPG in ops is worth stating plainly: **signing > encryption > key management**. Almost every team genuinely needs "published artifacts carry a signature, consumers verify it"; the full OpenPGP social model -- GPG encrypted mail, the Web Key Directory (WKD) -- rarely lands inside an enterprise. Investing time in wiring `--detach-sign` into the release pipeline pays back more than studying the six levels of the Web of Trust. The trust model itself can also be simplified to one sentence from an ops viewpoint: **you only need to know the one "team release key," and pin it into your configuration management**; the rest of the Web of Trust cross-signing network is almost never used on an intranet, so do not design process around it.

### 2.1 Generating a Key Pair

The key pair is the identity foundation for every later sign/verify action -- **a trusted key comes first, a trusted signature second**, and the algorithm choice and expiry policy made here will affect every `--verify` in the pipeline. The two decisions skipped at generation time (algorithm, expiry) get charged back at multiples during a "key rotation crisis" two years later, so this step is worth slowing down for. The generation action itself takes a minute, but **the three decisions around it** (who the uid is, when it expires, how the public key is distributed) determine this key's whole lifecycle across the team -- writing those decisions into a key registry is more reliable than digging through chat history afterwards. Newer GPG recommends the interactive full generation (algorithm and expiry can be specified), rather than blindly hitting enter:

```bash
$ gpg --full-generate-key
Your selection? 9          # ECC: Curve25519, the modern default
```

View and export after generating:

```bash
$ gpg --list-secret-keys
sec   ed25519 2026-09-22 [SC] [expires: 2027-09-22]
uid  [ultimate] Ops Admin <ops@example.com>
$ gpg --export -a "Ops Admin" > ops-public.asc          # public key, safe to distribute
$ gpg --export-secret-keys -a "Ops Admin" > ops-private.asc  # private key = high risk
```

The `[ultimate]` trust level indicates this is your own key. On algorithm choice, modern GPG defaults to/recommends ECC (Curve25519): short signatures, fast verification, the same lineage as SSH ed25519; fall back to RSA 3072+ only for compatibility with very old GnuPG or certain HSM scenarios. Do not set key expiry to "never" -- expiry is a form of **active lifecycle management**: a forced rotation at the deadline is safer than a "long-lived key" that has not changed in ten years, and it forces the team to work through the key-change process.

A private-key export file is the identity itself -- **putting it in a code repo, pasting it into a chat tool, or storing it alongside backups is all equivalent to handing your identity to someone**. The correct practice is to encrypt it immediately after export (at least wrap it in a passphrase or put it on an encrypted volume), and clean up the temporary copy with `gpg --delete-secret-keys`. Before and after exporting, `ls -l ~/.gnupg/` to check the permissions (should be `700`); a permission error on private-key material is a hair's breadth away from a leak.

### 2.2 Signing and Verification (The Highest-Frequency Ops Use)

When publishing a script, config, or software package, sign the file's hash asymmetrically, and the recipient verifies with your public key. Signing **combines** the hash and asymmetric cryptography from section 1: the hash gives the "content fingerprint," and the private-key signature gives "who owns that fingerprint" -- the recipient only needs your public key to verify both "it was not modified" and "it really came from you." This is also why distributing the public key (pinning it into a config repo or the distro metadata) matters more than the key itself: **when verification fails, confirm the root of trust first, then suspect the file.**

```bash
$ gpg --detach-sign deploy.sh
$ gpg --verify deploy.sh.sig deploy.sh
gpg: Good signature from "Ops Admin <ops@example.com>" [ultimate]
```

In the verification output, the things to watch are **`Good signature` and the signer's identity** -- if it shows a key you do not recognize, or reports `BAD signature`, the file has been tampered with or the signature does not match; stop using it immediately. There is a trap here that gets scripted: the exit code of `gpg --verify` can also be 0 when "the signature is valid but the signer is not in the trust ring," so **an automated pipeline must parse the key ID and `Good signature` from the output, not just check `$?`**. `gpg --verify` only checks that the signature is valid -- **it does not mean you trust this signer**; whether you trust them depends on whether you imported their public key and gave it a trust level:

```bash
$ gpg --import ops-public.asc
$ gpg --edit-key 9A3F21B0C4D5E6F7890123456789ABCDEF012345  # trust -> 3 (full trust)
```

Wiring signing into CI/CD has two more engineering details. First, **the signing key must not live in a code repo or as a plaintext CI variable**: inject it from a key management service (Vault, cloud KMS, a protected runner secret) and let it disappear when the pipeline ends; once a private key has entered git history, the only correct action is to revoke the old key and have everyone rotate trust, not `git rm` and move on. Second, **the verification step must fail fast**: put `gpg --verify` as the first line of the deploy script, with every later extraction and execution after it. Reversing the order means verifying code that has already run -- the same class of ordering discipline as the firewall's "allow before enable," except here what is being stopped is the supply chain rather than a network packet.

Encryption/decryption (symmetric and asymmetric) has everyday uses too, but note that once you forget the passphrase for GPG symmetric encryption (`gpg -c`) it **cannot be recovered** -- the same discipline as the LUKS reminder in section 5.

## 3. TLS and Certificates: The Trust Chain Behind HTTPS

### 3.1 What the Handshake Does

People who think "TLS handshake" means "capture packets in Wireshark" tend to underestimate how much it carries on the ops side: the handshake is not just the five-step sequence from the protocol textbook, it is **the place where the certificate, the cipher suite, and the client trust store meet** -- a handshake failure can almost always be traced to a misconfiguration in one of those three. HTTPS = HTTP over TLS. The handshake does three things: negotiate the cipher suite, verify the server's identity (the certificate chain), and derive the session key. Simplified sequence:

1. The client sends the TLS versions and algorithms it supports;
2. The server returns its certificate (with the public key and a CA signature);
3. The client verifies the signature chain against its built-in CA root certificates, confirming the domain matches and the validity period has not passed;
4. Both sides (in the ECDHE case) exchange parameters to derive the symmetric session key;
5. All subsequent application data is encrypted with that key, with AEAD authentication tags preventing tampering.

The key to understanding "why the client trusts the server" is step 3: **trust comes from the root CA existing in your system trust store** (all three families maintain this via the `ca-certificates` package), not from how "official" the certificate looks. A self-signed certificate is mathematically just as correct; it is simply that nobody vouches for it, so browsers/clients warn. The ops meaning of the trust store has two layers: first, a system upgrade refreshes the built-in root CA list, and services running a self-signed or self-hosted CA may still need the root certificate manually imported on some clients; second, **whoever controls write access to the trust store can make any certificate "trusted"** -- malware tampering with `ca-certificates` is a classic technique, and it is one reason AIDE monitors `/etc/ssl/certs`.

### 3.2 Inspecting Certificates with openssl

Certificate triage is a high-frequency ops action -- "the site will not open," "the client reports it as untrusted," "was it hijacked" all usually end up on these few commands. Three commands cover 90% of scenarios:

```bash
# view validity, issuer, subject
$ openssl s_client -connect example.com:443 -servername example.com 2>/dev/null \
    | openssl x509 -noout -dates -issuer -subject
notAfter=Sep 29 23:59:59 2026 GMT
issuer=C = US, O = Let's Encrypt, CN = R11

# view the full certificate chain (triaging a "missing intermediate")
openssl s_client -connect example.com:443 -showcerts </dev/null
# verify whether the system trusts the chain
openssl s_client -connect example.com:443 -verify_return_error </dev/null
```

`notAfter` expiry is one of the most common production incidents: an expired certificate means the site is unreachable, and clients do not "auto-renew." **Turning "days remaining" into a monitored metric** is more reliable than depending on the renewal script itself -- a renewal process that silently fails, a reload hook that never fires, one machine out of several that was missed; these all concentrate and blow up on the expiry date. Automated certificates (certbot / ACME clients and similar) need a proper **reload hook after renewal** -- many "renewal succeeded but the site still errors" incidents have the simple root cause that Nginx never reloaded the new certificate.

Monitoring "days remaining" can be very light: one cron running `openssl s_client` daily, extracting `notAfter`, computing the days, and pushing it to the alert channel with three thresholds at 30/14/7 days. That is a different thing from monitoring the renewal script's health -- **script monitoring tells you "the job ran," while days monitoring tells you "the certificate is still valid,"** and the latter is what the business actually cares about. Across multiple machines and domains, put the inventory (domain:port) in a text file and loop over it; there is no need to bring in a heavyweight certificate-management system unless you are already managing dozens of certificates.

Certificate-chain triage also has an empirical path: first `-showcerts` to see whether the server sent only the leaf certificate (a missing intermediate is endemic to self-hosted CAs and bad config), then `-verify_return_error` to see whether the system trust store accepts the whole chain, and finally check `-dates`. Three steps locate most "the browser reports untrusted but curl is fine" or "only some clients fail" chain problems -- different clients have different intermediate-certificate caching (AIA fetching) capabilities, and **sending the full chain from the server side is the lowest-effort interoperability fix.**

Self-signed certificates are only for intranet experiments or service-to-service mTLS; mind the algorithm and validity period when generating:

```bash
$ openssl req -x509 -newkey rsa:3072 -nodes -days 365 \
    -keyout server.key -out server.crt -subj "/CN=server.internal"
```

The private key `server.key` must have permissions `600` and be owned by the service account -- `openssl` will not stop you from making the private key world-readable, which is a permissions-layer matter; see [Hardening](./hardening.md). The division of labor between self-signed and public CA certificates is worth restating once more: self-signed suits **service-to-service mTLS, intranet experiments, and air-gapped environments**; sites facing the public internet must use a certificate issued by a trusted CA, otherwise every user sees a warning and the security warning eventually gets trained into a "click continue" muscle memory -- **wearing down user vigilance with warnings is a subtler long-term risk than the certificate itself expiring.**

Of the three-part certificate ops set (generate, renew, alert), the easiest to only do is the first: `openssl req` to generate a one-year certificate, paste it up, and then renew from memory. The correct shape is to put "alert 30 days before expiry" into monitoring, "reload after renewal" into a hook, and "is the chain complete" into the go-live check -- miss any of the three and the certificate will break in the middle of the night in the hardest way to diagnose. Self-signed setups do not go through ACME, but they should still get an expiry reminder on the certificate file; when an intranet service goes down because of an expired certificate, the browser's "not secure" warning will make people suspect an attack instead, sending the triage one step in the wrong direction from the start.

## 4. SSH Keys: Replacing Passwords with Asymmetry

Taking section 1's "asymmetric solves the first meeting" straight into daily work: SSH is where asymmetric encryption lands most routinely in ops -- the server holds the public key (`authorized_keys`), you hold the private key, and after the handshake an encrypted channel is established and authentication is complete. Compared with password login, key login solves both **brute-force resistance** (a 256-bit random private key cannot be dictionary-attacked) and **automation** (scripts run without interaction). Password login faces "tens of online guesses per second," key login faces "an offline brute force of 2^256" -- they are not battles on the same scale, which is also why almost every security baseline lists `PasswordAuthentication no` as mandatory. The two can also be compared to door locks: a password is a pin-tumbler lock that can be picked and tried again and again; a key is a quantum random code that is physically non-enumerable on every attempt. **Changing the lock is not hardening the old lock; it is replacing the threat model.**

Key selection today is nearly uncontroversial: always `ed25519` for a new environment -- short keys, fast signatures, simple implementations, the same lineage as GPG's ECC recommendation; fall back to `rsa` with 3072 bits or more only for compatibility with very old router/switch firmware. **Do not generate 2048-bit RSA as a new standard**; the defaults in older material are behind the current strength baseline. Conversely, do not chase novelty by adopting an emerging curve without wide support -- the first property of an ops key is interoperability, and the second is mathematical fashion. Selection can also be remembered as one contrast: SSH keys and GPG keys should **stay on the same generation** of algorithm (both ed25519), so the team's mental model, key-management scripts, and audit checklists can all share one set instead of writing two separate ones.

From a deployment-cost view, the key switchover is the **highest return on investment** item in a cryptography retrofit: no CA needed, no business code changes, no domain request, three commands. What actually slows a team down is never `ssh-keygen` but an undesigned switchover process -- whose key goes first, when the old password gets turned off, how to handle temporary contractors. Answer those three questions before you start; that matters more than agonizing over ed25519 versus RSA 3072 (the answer: ed25519 for new environments, RSA fallback only for old devices that do not support it).

```bash
$ ssh-keygen -t ed25519 -C "ops@$(hostname)"
$ ssh-copy-id user@server
$ ssh -o PreferredAuthentications=publickey user@server "echo ok"
ok
```

The public key (`.pub`) can be public; the private key (no extension) must be `chmod 600`. Add a passphrase to the private key and have `ssh-agent` remember it, balancing "a lost backup is not naked exposure" with "no passphrase typing day to day." A passphrase-less private key that gets copied away is a permanent backdoor until you discover it and rotate `authorized_keys` -- with a passphrase there are at least two extra hurdles: "need both the private-key file and the passphrase." Know the agent's own boundary too: `ssh-agent` keeps the decrypted private key in memory for signing, so **running an agent on a shared host or a compromised machine is high risk** (a process with permission on the same host can proxy logins through the agent socket); in high-risk environments use `ssh-add -c` to require confirmation on each use, or simply do not keep an agent resident. One step in the key lifecycle is often omitted: **revocation when someone leaves or changes role** -- `authorized_keys` has no global "change once, all invalidated" switch the way passwords do; every machine must be edited, and only fleet-wide config management can guarantee nothing is missed. That is also the practical reason to put public keys into the asset inventory (whose, issued to which machines, when).

```bash
$ eval "$(ssh-agent -s)"
$ ssh-add ~/.ssh/id_ed25519
Enter passphrase for /home/cui/.ssh/id_ed25519:
```

Server-side companion hardening (the full checklist is in [Hardening](./hardening.md)): `PasswordAuthentication no`, `PermitRootLogin no`, `PubkeyAuthentication yes`. **The order must be: confirm key login succeeds first, then turn off passwords** -- turning off passwords before setting up keys and locking yourself outside is the classic script, the same class of error as the firewall's "enable before allow." The `sshd` unit names differ across the three families (Debian is `ssh.service`, Arch/RHEL is `sshd.service`); after changing the config, run `sshd -t` for a syntax check before restarting -- details in the hardening page.

After the key switchover, one cleanup step is easy to miss: **sweep out the leftovers from the password era** -- expired keys in `/home/*/.ssh/authorized_keys`, temporary `PermitRootLogin yes` additions, `PasswordAuthentication yes` backup files opened for testing convenience; all of it should be reclaimed in the same switchover window. Verify by running `sshd -T | grep -iE 'passwordauth|permitroot'` again and confirming the effective values rather than what the file says; when the file and the effective values disagree (drop-in overrides, Match blocks), trust `sshd -T` -- this is also the first entry point for triaging "I turned it off but password login still works."

`authorized_keys` permissions and ownership are also a frequent fault point: the file owner must be the login user themselves, permissions `600`, and the `~/.ssh` directory `700` -- sshd refuses overly permissive key files for security reasons, and the symptom is "I pasted the public key and it still asks for a password." During triage, run `ls -la ~/.ssh` first and then `sshd -T` for the actual effective config; that is much faster than repeatedly reinstalling the key. Prefer `ssh-copy-id` for key distribution; it handles appending and permissions automatically. Manual `cat >>` is the main source of permission incidents.

## 5. Disk Encryption (LUKS): The Last Gate for Data at Rest

Data in transit has TLS, the file level has GPG, and what remains is a frequently ignored gap: **the disk itself** -- once data is written to sectors it lies there quietly until the drive is pulled, sent for repair, or resold at a used-goods market. LUKS closes this "data at rest" hole, and it is the only one of this page's four threads designed directly against the hardware-theft scenario. You can also restate the four threads by "where the data is": TLS covers what moves on the wire, GPG covers what is inside the published artifact, SSH keys cover the login session, and only LUKS handles what **still lies on the medium after power-off**. The four threads also have different ops rhythms: TLS/SSH are configured once and stay valid long term, GPG is used on the release cadence, and LUKS is **decided at creation time** (keyslots, passphrase, and header backup are largely settled at the moment `luksFormat` runs). Understand that, and you will naturally slow down while reading this section -- mistakes in the earlier sections can be fixed by changing config; mistakes here usually mean replacing the disk.

LUKS's "one-shot" nature also shows in the **priority of the backup strategy**: other config can be replayed from a repo if it goes wrong, but a lost LUKS header evaporates the whole volume's data together with the backups -- so the header backup location should be decided as "separated from the data itself, but at the same tier as your password manager," not casually dropped into a home directory on the same disk. Section 5.2 pairs this irreversible risk with `crypttab` boot unlock precisely to **put the risk and the escape route in the same field of view before you type uppercase YES.**

### 5.1 Concepts: What It Protects and What It Does Not

LUKS (Linux Unified Key Setup) is the standard **block device encryption** scheme on Linux, managed by `cryptsetup`. It encrypts the static data of an entire partition/volume: when a drive is pulled, a laptop is lost, or an old drive is handed off, there is no way to read the content without the key. It does **not** protect runtime data after boot -- once the system is unlocked, files on the decrypted volume are plaintext to the kernel and root; it also does not protect against a root-level attacker controlling the online system (who can read the unlocked volume directly or grab memory keys).

Drawing the boundary between LUKS and the earlier sections matters: TLS/SSH encrypt **data on the wire** (in transit), GPG encrypts **specific files** (optionally at rest), and LUKS encrypts **the static state of an entire device** (at rest). All three are loosely called "encryption," but the theft scenarios they defend against are entirely different -- an attacker who intercepts network packets is stopped by TLS, an attacker who picks up a drive only hits LUKS, and an attacker who has root is indifferent to all three once they are unlocked. **A mismatched threat model makes encryption equivalent to no encryption**, the theme this page keeps returning to.

With the threat model clear, the applicable scenarios are clear: **enable on mobile devices/laptops, recommend on servers holding sensitive data, limited benefit on pure-intranet servers with no sensitive data** (and you have to weigh the unattended-reboot unlock problem). That decision criterion can go straight into a go-live checklist: first ask "how likely is it that this machine's disk gets physically taken," then "how sensitive is the data leaked if it is taken" -- both answers high is what justifies the operational cost of unlocking and recovery. Cloud hosts commonly use a "host-level encryption plus you manage your own data" division, handing the physical layer to the cloud vendor's compliance commitment and concentrating on application-layer encryption (see sections 3 and 4) -- more pragmatic than forcing LUKS onto hardware you cannot touch.

### 5.2 Key Steps and Irreversible Risks

Once the conceptual boundaries are clear, the operational layer has one main line: **format -> map -> filesystem -> boot unlock**, plus two actions where you must stop and confirm (check the device name, back up the header). During installation, create the LUKS container on the partition (**this destroys the partition's existing data**), then create the mapping, format the filesystem, and write `crypttab` for boot unlock:

```bash
sudo cryptsetup luksFormat /dev/sdb2    # uppercase YES confirms; the data will be overwritten
sudo cryptsetup open /dev/sdb2 crypt_data
sudo mkfs.ext4 /dev/mapper/crypt_data
# /etc/crypttab: crypt_data /dev/sdb2 none luks,discard
```

The `luksFormat` confirmation prompt reads `Type uppercase yes` -- deliberately awkward, to prevent a fat-finger. **You must confirm the device path before creating**: running `luksFormat` on the wrong disk is unrecoverable (unless you have a LUKS header backup). Strongly recommended header backup:

```bash
sudo cryptsetup luksHeaderBackup /dev/sdb2 --header-backup-file luks-header.bak
```

After backing up the header you must also **verify it actually works**: use the backup file on another machine (or in an isolated environment on the same one) to walk the `cryptsetup luksOpen --header` recovery path once and confirm it prompts for the passphrase rather than reporting "invalid header." An unverified backup differs from no backup by one roll of bad luck -- this is the LUKS concretization of the same "recovery drill" discipline as section 7. Treat the backup file itself as key material: store it offline, tighten permissions, and keep it out of the same drawer as the passphrase.

A lost header means the data is permanently undecryptable, regardless of whether the passphrase is correct. Multiple keyslots are LUKS's recovery redundancy mechanism: leave one slot for yourself, one for the recovery process, one for ops handoff, so that losing any single passphrase does not brick the whole volume; use `luksAddKey`/`luksKillSlot` to add and remove slots when rotating passphrases, rather than recreating the container. Keep recovery passphrases offline (see the common pitfalls in section 6); how you store them matters as much as what you store -- written on a sticky note next to the monitor, even the best keyslot design is just theater.

LUKS2 is the current default format (newer `cryptsetup` defaults to `--type luks2`), supporting more flexible keyslots and the Argon2 KDF. The unattended server-reboot scenario needs a trade-off: writing the passphrase into `initramfs` is de facto decryption (an initramfs leak equals a key leak); common alternatives are network unlock, TPM automatic unlock, or **no encryption but strict control of physical and backup access** -- there is no free lunch of "fully automatic yet theft-proof," so trade off by threat model. State TPM's boundary clearly too: it defends against "the drive being pulled," not "the whole machine online and root-controlled" -- an attacker can trigger decryption from a TPM session. That does not contradict LUKS's offline-protection positioning; it just moves the root of trust from the passphrase to a hardware chip.

## 6. Common Pitfalls

Tool commands can be looked up in manuals; pitfalls only give immunity after you step in one (or read about someone else stepping in one). The ten below are ordered from "causes irreversible loss" to "causes false confidence" -- the first four are basically unrecoverable once stepped in, worth rereading before you act. The ordering criterion is not frequency of occurrence but **whether it can be remediated afterwards**: things you can reconfigure go later, things that are gone forever go first. Each pitfall is followed by "the corresponding correct action," so this section can be used directly as a pre-change checklist rather than just a collection of incident stories. The ten can also be compressed into two maxims: **back up and verify first for irreversible operations** (formatting, turning off passwords, deleting private keys), and **read back the effective values first for commands that only look successful** (certificates, `sshd -T`, signer lists) -- most pitfalls fit into one of these two.

1. **Using a hash as encryption.** `md5sum`/`sha256sum` cannot recover the original and provide no confidentiality. Use AES (`openssl enc`) or GPG for reversible encryption, and Argon2/bcrypt for password storage.
2. **Backing up private keys like ordinary files.** Once a GPG private key, SSH private key, or `server.key` lands in git or sits naked on cloud storage, it is equivalent to an identity leak. Permissions `600`, an independent encrypted backup, and `gpg --delete-secret-keys` to clean up temporary exports when needed.
3. **Turning off `PasswordAuthentication` before setting up keys**, locking yourself outside. Always succeed at logging in with the new method first, then turn off the old one; keep a console/VNC escape channel at the same time.
4. **SSH keys using RSA 2048 with no passphrase.** Prefer `ed25519`; fall back to RSA 3072+ only for old devices; add a passphrase to the private key plus `ssh-agent`.
5. **Verifying signatures by only looking at the command exit code, not the signer's identity.** The key ID in `gpg --verify` output must be the one you expected, or you may have verified someone else's "valid signature."
6. **Certificates only checked for "renewal succeeded," not the reload.** The ACME renewal hook must actually execute `nginx -s reload`/`systemctl reload apache2`, and the `notAfter` days remaining must be monitored.
7. **Typing enter on a `luksFormat` device name without even looking at it.** Run `lsblk` to check three times before an irreversible operation; do `luksHeaderBackup` first, then consider passphrase rotation and multiple keyslots (one for you, one for the recovery process).
8. **Believing full-disk encryption defends against online attacks.** LUKS defends against offline theft; defending against online attacks relies on least privilege, patching, and detection (see the hardening/intrusion detection pages). The two threat models differ and cannot substitute for each other.
9. **Mixing package names across the three families.** `gnupg` (Debian/Arch) versus `gnupg2` (RHEL); `cryptsetup` package names are basically identical but live in different repos. When writing cross-distro scripts, probe with `command -v` first.
10. **Archiving after encryption without verifying the decryption path.** Backup/transfer scenarios must run a **test decryption** once (a full round trip with the real key), or you may discover the key is wrong only on disaster-recovery day -- the recoverability of encryption must be proven by a drill.

Of the ten, items 1 and 8 are **threat model misjudgments** (wrong primitive, wrong defense target), items 2, 3, and 7 are **key/device operational incidents**, items 4, 5, 6, and 9 are **configuration and process details**, and item 10 is the only one aimed specifically at "your future self" -- an encryption system's failures usually do not surface at the moment of encrypting, only at the moment of recovery. When self-checking, ask item 10 first: for this data, if I lost the key today, could I get it back? If you cannot answer that, doing the other nine well still leaves it fragile.

## 7. In Practice: Wiring Encryption Into the Daily Workflow

The six sections above each cover one primitive or one scenario; in practice the real question is "**what do I do first tomorrow morning**." The checklist below is ordered by priority, with each item giving a trigger condition and a completion marker, and can be pasted directly into the team's go-live checklist. The order itself encodes the risk judgment: first stop the bleeding (entry authentication), then patch what will bleed (supply chain and transit), and only then the slow variables (device and certificate lifecycle). Treat the checklist as a "what to change on day one" map, not a one-time TODO to tick off: only the first three of the six are one-shot convergences; the last three recur with personnel, hardware, and certificate cycles. The checklist also implies a **dependency order**: the keys from item 1 are the object of the item 6 drill, and the `notAfter` alert in item 5 needs the alert channel from item 3 -- **leave the alert outlet in place while doing the first two**, or item 5 will need another change ticket reopened at go-live. The six can also be regrouped by "who benefits": items 1 and 4 mainly protect you (not locked out, not dumped as a data breach), while items 2, 3, and 5 protect **downstream consumers and your future self during triage** -- when a security checklist does not name its beneficiary, priority discussions degenerate into whoever shouts loudest.

The precondition for the checklist to land is that **every item has a completion marker (Definition of Done)**: item 1's marker is not "a key was generated" but "passwords are disabled and a login still succeeds from a new session, with `sshd -T` confirming `passwordauthentication no`"; item 2's is not "sign ran once" but "the consumer verified successfully on another clean machine." Without a readable-back completion marker, the checklist degrades into a ticking ritual after the first personnel change -- the same engineering habit as the [Hardening](./hardening.md) page pairing all nine steps with acceptance commands.

The "trigger condition" column of the checklist deserves its own emphasis: security habits only stick when hooked to concrete events -- a new hire onboarding (triggers item 1), a release pipeline going live (triggers item 2), purchasing new drives (triggers item 4), 30 days before certificate expiry (triggers item 5). Binding the six items to existing process hooks is more sustainable than starting a separate "security sprint week"; conversely, a checklist with no trigger conditions is destined to be skipped at the next business peak.

A minimal viable cryptography habit checklist, ordered by priority:

1. **Manage entry points**: switch SSH entirely to ed25519 keys and turn off passwords (after confirming the keys work).
2. **Software and config distribution**: `gpg --detach-sign` scripts/configs released externally; consumers run `gpg --verify` before executing.
3. **Transit verification**: large files go through `sha256sum`; prefer a TLS channel over bare FTP/HTTP across untrusted networks.
4. **Data at rest**: enable LUKS on laptops/portable drives holding customer data; on servers, evaluate the threat model before deciding on full-disk encryption, and back up the LUKS header.
5. **Certificate operations**: automated renewal plus expiry alerts (monitor `notAfter`), with a reload in the renewal hook.
6. **Drills**: pull one "recovery path" exercise each quarter -- decrypt a test file with a backup private key, unlock a test LUKS volume with the recovery passphrase. **Encryption without a drill is the same as none.**

These six cover the four surfaces of "transit, identity, at rest, recovery," which is exactly the four jobs this page opened with. The tool commands can vary by distro (`pacman -S`/`apt install`/`dnf install`), but the threat model and recovery discipline are completely consistent across the three families.

Why single out "drills" as its own item rather than folding it into the backup process? Because an encryption system's failure mode is unusual: the key material may sit intact in backups, but nobody remembers the passphrase, nobody knows which machine the private key corresponds to, and nobody has tested whether the recovery script can run in a clean environment -- **the failure does not error at encrypt time, it only reveals itself at decrypt time,** and that moment is usually disaster-recovery day. Making the recovery drill a fixed calendar event trades "some day of panic in the future" for "thirty minutes this afternoon."

Item 1 comes first because it changes **the surface currently under attack**: every machine on the public internet with port 22 open is having its password authentication continuously scanned; after switching to key login, the same scan wave's failure rate drops to zero immediately, and the Fail2Ban alert noise falls with it -- one of the few security hardenings where "you see the effect the same night you make the change." Items 2 and 3 change the trustworthiness of the **supply chain and transit**, with the payoff realized at the next software distribution or large-file transfer. Items 4 and 5 are bound to hardware procurement and the certificate lifecycle; the cadence can be slower, but **the header backup and the `notAfter` monitor are the two things that cannot wait** -- the former is a safety rope before an irreversible operation, the latter is the last alarm for "30 days to expiry and nobody managing it."

The item 6 drill enters the calendar from day one, because **recovery capability does not grow itself over time** -- it only decays as personnel change and formats are forgotten.

Fitting these six into a real team has two details that are easy to stumble on. First, **completion markers must be verifiable**: no checklist item may read "SSH is hardened" in a way that cannot be reconciled; it should read "`ssh -o PreferredAuthentications=publickey` still logs in after passwords are disabled, and `sshd -T` shows `passwordauthentication no`" -- a readable-back definition of done is what keeps it from degenerating into a verbal tradition after personnel rotation. Second, **the checklist must separate "one-time switchover" from "continuously running"**: items 1 and 2 converge once done, then only need rechecking on personnel change; items 5 and 6 are an infinite operational loop, and pausing once means handing back the corresponding protection. Many teams mix both on a single checklist and "tick" them year after year, and the continuous items are genuinely unexecuted by the second year -- recording them separately and assigning calendar owners to the continuous items is the sustainable approach.

## References

By this point, the four threads' respective "next digging directions" have already diverged: protocol details (TLS cipher suites, SSH KEX) suit continuing with the implementer's documentation; trust and signature models (GPG, repo keys) suit institutional design combined with your team's release process; disk encryption is install/ops oriented, governed by the distro manual and the cryptsetup documentation. **Choosing documentation by problem type is more effective than bookmarking a pile of man pages by tool name** -- most "encryption problems" end up as threat model questions, not parameter questions. Each of the four threads has an authoritative source: protocol and implementation details in the official OpenSSL/OpenSSH docs, trust and signature models in the GnuPG manual and the Arch Wiki entry, disk encryption in cryptsetup and the distro hardware encryption guides. The recommended reading order matches the body -- read section 1's primitive division through first, then go deep into the relevant tool's documentation as needed; starting from a single tool's man page tends to leave you remembering a pile of parameters while being unable to say what threat it actually protects against. One time-saving habit when consulting docs: **first ask "is this a property question or a parameter question"** -- a parameter question ends in three lines of man, a property question must return to the table in section 1, otherwise the deeper you dig the more off track you drift.

- `man gpg`, `man openssl`, `man ssh-keygen`, `man cryptsetup`, `man crypttab`
- GnuPG manual -- [gnupg.org](https://gnupg.org/documentation/)
- OpenSSL documentation -- [openssl.org](https://www.openssl.org/docs/)
- OpenSSH manual -- [openssh.com](https://www.openssh.com/manual.html)
- Arch Wiki - GnuPG -- [wiki.archlinux.org](https://wiki.archlinux.org/title/GnuPG)
- Arch Wiki - Disk/encryption (LUKS) -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Disk_encryption)
- Bird's Private Recipes (Lin's Linux Administration Guide) - System Security and Permissions -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0410accountmanager.php)
- Red Hat - Encrypting block devices using LUKS -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/security_hardening/encrypting-block-devices-using-luks_security-hardening)
- Let's Encrypt documentation -- [letsencrypt.org](https://letsencrypt.org/docs/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [coverage-matrix](/research/coverage-matrix.md)
- [README](README.md)
- [hardening](hardening.md)
- [intrusion-detection](intrusion-detection.md)
- [ssh](/server/ssh.md)
