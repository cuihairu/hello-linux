# Advanced Account Privileges: PAM and sudo

Why can an account created with `useradd` log in as soon as the right password is typed, and why are you shut out after three wrong attempts? When an ordinary user runs `sudo`, on what grounds does the system decide "this person may run this command as root"? The answers to both live not in the user database itself but in two separate mechanisms: PAM (Pluggable Authentication Modules) decides "who gets through the door of authentication", and sudo decides "who borrows root's hand once inside". The basics already covered the ABC of users, groups and password files in [Account Management](../basic/users/account_management.md); this page digs one layer deeper into the mechanism: why changing password policy means editing text under `/etc/pam.d/`, how to configure failed-login lockout so that it really takes effect, and how to write a sudoers allowlist that is precise without leaving a privilege-escalation backdoor. These two mechanisms are the foundation of the security chapter's later [Hardening](./hardening.md) -- half of the hardening checklist, once it comes down to implementation, means editing PAM or sudoers.

> Content draws on the official Linux-PAM and sudo documentation and the Arch Wiki (the conceptual framework follows Bird's Private Recipes); see the references at the end.

## What This Page Covers

- Build the layered mental model of privileges: authentication (PAM) and authorization (sudo)
- Read `/etc/pam.d/` rule files: module type, control flag, call order
- Configure failed-login lockout (pam_faillock), password complexity (pam_pwquality) and source-of-login restrictions (pam_access) independently
- The sudoers four-tuple syntax, alias grouping, and the limits of NOPASSWD
- Recognize escalation backdoors in an allowlist (shell escapes via find/vi/pagers), and build the reviewing instinct for "command allowlists"

## 1. Two Layers of Privilege: Authenticate First, Then Authorize

Take `ssh alice@server` apart and privileges are really two segments. The first is **authentication**: proving "you are alice" -- checking a password, a fingerprint, a one-time code. The second is **authorization**: once authentication passes, deciding "what alice may do" -- which files she can read (traditional rwx and [ACL](../basic/users/acl_permissions.md)), and which commands she may run and as whom (sudo). The two mechanisms are completely independent: how a password is checked and how many failures lock an account is PAM's call; whether alice may run `systemctl restart nginx` is sudoers' call.

| Question | Mechanism | Where it is configured | What a mistake costs |
|----------|-----------|------------------------|----------------------|
| Who can log in, and how it is verified | PAM | `/etc/pam.d/` and `/etc/security/` | A mistake can lock you out of the system |
| What root may be borrowed for after login | sudo | `/etc/sudoers` and `/etc/sudoers.d/` | A mistake can leave an escalation backdoor |

This layering explains a common confusion: why does changing a `PASS_MAX_LEN`-style parameter in `/etc/login.defs` leave new passwords unaffected? Because passwords go through PAM's `password` stack both when they are set and when they are checked, and the real authority lives in the rule files under `pam.d` and in `pwquality.conf` -- the rule files are the single source of truth for authentication policy. Conversely, put alice in the `wheel` group and she can sudo, but her login password is still locked when it should be -- being loose about authorization never dilutes the strictness of authentication. When troubleshooting, ask "which segment is stuck" first; that beats diving into configuration files. Login fails -> look at the PAM logs; a command will not run -> look at sudoers and the audit logs. Two paths, never mixed.

## 2. What PAM Is: the Plugin Stack Behind a Login

PAM (Pluggable Authentication Modules) pulls "how to authenticate" out of every program and turns it into a set of pluggable middleware. sshd, login, su, sudo, `passwd`... these programs do not write a single line of password-checking logic themselves; when they start authenticating they call the PAM library and announce their service name. PAM takes that name, looks for the rule file of the same name under `/etc/pam.d/` (the `sshd` service looks for `/etc/pam.d/sshd`), and calls the modules in the file's order, one line at a time. **Service name = file name** is the first clue when troubleshooting: to see how `sudo` itself authenticates, read `/etc/pam.d/sudo`; to see all the checkpoints of an ssh login, read `/etc/pam.d/sshd`. The old single-file `/etc/pam.conf` is still supported, but modern distros all use the `pam.d/` directory -- each file there is one service's authentication checklist, the same philosophy as apt splitting sources into `sources.list.d/`: isolated per service, so upgrades do not tread on each other.

```text
sshd process --service name "sshd"--> libpam --> /etc/pam.d/sshd
                                        ├── auth rule 1  pam_faillock  (preauth)
                                        ├── auth rule 2  pam_unix      (check the password)
                                        ├── account …    pam_nologin   (check /etc/nologin)
                                        ├── session …    pam_systemd   (register the cgroup)
                                        └── password …   pam_pwquality (only when changing the password)
```

Modules themselves are shared libraries under `/usr/lib/` (Debian under `/usr/lib/x86_64-linux-gnu/security/`, Arch and RHEL under `/usr/lib/security/` -- `ls` that directory to see which building blocks the system has); the rule file is only the blueprint for assembling those blocks. The same block is reused by every service: `pam_unix.so` checks passwords for sshd and does the same job for su and sudo. To understand one machine's authentication behavior, reading five or six of the high-frequency files under `/etc/pam.d/` end to end beats reading ten documents -- each is a dozen lines with identical syntax, the readability dividend PAM designed in for administrators. One command is enough to see how many doors a system really has:

```bash
$ ls -m /etc/pam.d/
chfn, chpasswd, chsh, common-account, common-auth, common-password,
common-session, common-session-noninteractive, cron, login, newusers, other,
passwd, remote, runuser, runuser-l, sshd, su, su-l, sudo, sudo-i
# Each name is one set of checkpoints; change common-* in one place and every service that @include's it changes together
```

## 3. PAM Rules in Practice: Reading and Changing Them

### 3.1 Syntax of a rule line

Each rule line has four fields: **module type, control flag, module path, module arguments**. The module type says "which of the four authentication jobs this line handles": `auth` (verifying identity), `account` (is the account usable -- expired, locked), `session` (things before and after the login -- environment, audit, cgroup), `password` (policy and hashing when changing a password). The control flag says "what to do when this line fails", and it is the easiest place to get lost; four keywords in one table:

| Control flag | If this line fails | If this line succeeds | Typical role |
|--------------|--------------------|------------------------|-------------|
| required | keep walking the stack; overall verdict is failure | go to the next line | the serious default checkpoint |
| requisite | **fail immediately**, do not run later lines | go to the next line | a prerequisite check with veto power |
| sufficient | keep going (overall success if no required has failed so far) | **succeed immediately**, skip the later lines of the same kind | a backup authentication path (fingerprint, falling back to password when it fails) |
| optional | does not affect the overall outcome | does not affect the overall outcome | side roles such as logging or creating a session |

The elegance of this semantics is "walk the whole way even on failure" (required): even when the first gate is doomed, PAM still traverses the stack, so an attacker cannot infer from "which checkpoint reported the error" where exactly they were tripped up -- slower, but it leaks less information. Debian-family rule files also show the bracketed form `[success=1 default=ignore]`, a more precise version of the control flag: "on success skip the next line, otherwise pretend you did not see it" -- look the semantics up in the action table of `man pam.conf`; when reading rules, memorize the keyword form first and treat the bracketed form as a dialect.

### 3.2 Two real files side by side

Debian/Ubuntu split the common stacks into four files -- `common-auth`, `common-account`, `common-session`, `common-password` -- and each service's rule file pulls them in with `@include`, so a change lands in the common files once and takes effect for ssh, login and every other entry at the same time. RHEL and Arch write the common stacks directly into `system-auth` (on RHEL 9 and later these are in fact symlinks into files under `/etc/authselect/`, managed by authselect). Two real excerpts side by side:

```text
# /etc/pam.d/common-auth (Debian/Ubuntu, excerpt)
auth	[success=1 default=ignore]	pam_unix.so nullok
auth	requisite			pam_deny.so
auth	required			pam_permit.so

# /etc/pam.d/system-auth (RHEL/Arch style, excerpt)
auth	required	pam_env.so
auth	required	pam_faillock.so preauth audit deny=4 unlock_time=1200
auth	sufficient	pam_unix.so try_first_pass nullok
auth	required	pam_faillock.so authfail audit deny=4 unlock_time=1200
auth	required	pam_deny.so
```

Read the Debian version line by line: `pam_unix` is the line that actually checks `/etc/shadow`, and on success it skips the next line (`success=1`); if it fails, the `pam_deny` that follows always fails, guaranteeing that the stack refuses when "no module allowed it"; the trailing `pam_permit` always succeeds as a backstop, giving the stack an explicit ending when "everything before passed". The two extra `pam_faillock` lines in the RHEL version are the failed-login lockout configured in 3.3 -- note their **positional discipline**: `preauth` counts the old score before `pam_unix`, `authfail` records after it, and the two lines bracket the real checking module; drop either one and the count is incomplete.

### 3.3 Change 1: failed-login lockout

Account for brute force with a lock: lock the account for a while after N consecutive failures -- that is `pam_faillock`'s job (its predecessor `pam_tally2` retired with old PAM versions; do not copy that name out of old documents). Parameters live in `/etc/security/faillock.conf`, which is cleaner than writing a long string of arguments into the rule line:

```text
# /etc/security/faillock.conf
deny = 4              # Lock after 4 consecutive failures
unlock_time = 1200    # Auto-unlock after 20 minutes
even_deny_root        # Count root too (careful: keep an escape hatch on the physical console)
audit                 # Write lockout events to the audit log
```

How the configuration gets attached differs across the three families -- the first place on this page where "one task, three landing points" shows up: Debian/Ubuntu add two faillock lines to `common-auth` (`preauth`/`authfail` bracketing `pam_unix`, copying the RHEL layout from 3.2); RHEL 8/9 attach it in one step with `authselect enable-feature with-faillock`; Arch means editing `/etc/pam.d/system-auth` directly (pambase upgrades leave a `.pacnew` -- remember to merge). Verification is not guesswork: take a test account and deliberately get it wrong:

```bash
$ echo 'wrong-password' | su - testuser -c whoami 2>&1 | head -2
su: Authentication failure
$ faillock --user testuser
testuser:
When                Type  Source                 Valid
2026-10-02 21:04:11 R     ssh:notty              V
2026-10-02 21:04:19 R     ssh:notty              V
# Once deny failures have piled up, even the correct password is rejected -- that is the evidence the lockout is live
$ sudo faillock --user testuser --reset    # Manual unlock
```

The `faillock` command is the observation window onto this mechanism: with no arguments it lists all failures, `--user` looks at one person, `--reset` zeroes the count and unlocks. Add it to the [Intrusion Detection](./intrusion-detection.md) inspection checklist; that beats finding out about a brute-force campaign from the logs days later.

### 3.4 Change 2: password complexity

In the `password` stack that `passwd` walks when changing a password, `pam_pwquality` reviews the quality of the new passphrase before it is actually changed (its predecessor is called `pam_cracklib`, the name you will find in older material). Parameters again live in a separate file `/etc/security/pwquality.conf`:

```text
# /etc/security/pwquality.conf
minlen = 12      # At least 12 characters
dcredit = -1     # At least 1 digit (negative = a minimum)
ucredit = -1     # At least 1 uppercase letter
ocredit = -1     # At least 1 special character
lcredit = -1     # At least 1 lowercase letter
maxrepeat = 3    # At most 3 identical characters in a row
```

The landing points again split three ways: Debian/Ubuntu edit `common-password` (on the prerequisite that the `libpam-pwquality` package is installed -- without it that block simply does not exist); RHEL edits the corresponding `password-auth` stack (or goes through the authselect profile); Arch edits the `password` section of `system-auth`. Verification has a shortcut: `pwscore`, the scorer shipped with pwquality, scores a passphrase directly, with no need to actually change a password and find out:

```bash
$ echo 'abc123' | pwscore
Password quality failed: The password is shorter than 8 characters
$ echo 'correct-horse-battery-staple' | pwscore
72
```

Note that `pwscore` validates against its own default configuration, and whether it reads `pwquality.conf` depends on how the distro packages it -- it is good as a "feel trainer" for what scores well, but production verification still goes through the real `passwd` interaction. After changing these two places, the discipline is **verify login and password change in a second terminal before closing the first window** -- the typical symptom of a broken PAM change is not an error message, it is that nobody can log in at all.

### 3.5 Acceptance checklist for a change

Any PAM change is only finished once "another session really can log in"; walk four steps and you can close it out. There is no equivalent of a `visudo -c`-style pre-check here (PAM has no official syntax checking tool), so it leans more on process: first run `pam-auth-update --test` (Debian) or `authselect check` (RHEL) to confirm you have not broken the common stack's references; then walk the target scenario in a **second terminal** with `ssh testuser@localhost` (to verify faillock, deliberately fail until it locks); then read every line PAM reports in `journalctl -u ssh -e`: `Failed password` is the expected trace of the test, while `error: PAM: ...` is hard evidence that the stack is broken; finally confirm that the observation surfaces of `faillock`/`pwscore` match expectations. If any of the four steps fails, roll back to the pre-change state and think again -- this is "verify first, then take effect" for PAM changes, the same conservative change philosophy as bumping a DNS serial or editing firewall rules.

### 3.6 sudo itself must pass PAM too

The easy link to forget: when you type `sudo`, the sudo program itself has to authenticate "you are you" -- `/etc/pam.d/sudo` is its checkpoint file (Debian-family `@include common-auth` as usual; Arch/RHEL pull in `system-auth`). So the faillock added to `common-auth` in 3.3 protects the ssh login path and the sudo escalation path at the same time -- the payoff of the common stack. One exception is equally worth knowing: root running `sudo` is never asked for a password -- `root ALL=(ALL:ALL) ALL` in sudoers clears it at the authorization layer, so authentication is never reached; and an ordinary user not being re-prompted across several minutes of consecutive `sudo` is sudo's own timestamp cache (booked per user and terminal under `/run/sudo/ts/`), which has nothing to do with PAM -- `sudo -k` manually voids the cache so the next call must ask, muscle memory before handing over a terminal.

### 3.7 The session section: setting the stage and striking it

Is identity fully settled after `auth`? Not quite -- the session section still has to set the stage for the login: environment, resource limits, audit and cgroup all get prepared. Two high-frequency modules deserve knowing on their own: `pam_limits.so` reads `/etc/security/limits.conf` to decide this session's file-handle and process limits (large services must tune this, otherwise `Too many open files` comes from an invisible ceiling at the moment of login), and `pam_systemd.so` registers the login session with systemd-logind -- the sessions `loginctl` shows and the environment inheritance when switching users both start with it. Both interact in ways that defy intuition: when limits are configured but not taking effect, first confirm that the line `session required pam_limits.so` really is in the session stack (Debian-family check `common-session`, RHEL/Arch `system-auth` -- the three families land in different places again), then confirm you did not come in through a path that skips the session section; no session walked, no stage set:

```bash
$ ulimit -n        # Max open files of this session (a ready probe for whether limits took effect)
$ cat /etc/security/limits.d/99-services.conf
*    soft    nofile    65535
*    hard    nofile    65535
$ loginctl show-session $(loginctl | awk '$3=="alice"{print $1; exit}') | head -5
```

The "strike the stage" side of the `session` section matters just as much: at logout, modules clean up in reverse stack order -- who created a temp file, who tore down the audit trail. Watch the ordering semantics when editing the session section (moving an `optional` cleanup module can leave session accounts nobody reclaims), and this is why security audit modules such as `pam_loginuid` should be marked `required`: a login with incomplete audit records is more dangerous than no login at all. Another contrasting scenario is processes started directly by systemd service units -- they never go through PAM at all, and their resource limits belong to `LimitNOFILE=`; do not go chasing a service's file-handle problem in limits.conf, the two ledgers are unrelated.

### 3.8 Does key-based login bypass PAM

A question that comes up often: with SSH keys configured, is the password checkpoint a formality? Half. With `PubkeyAuthentication yes`, sshd validates the public key and no longer calls `pam_authenticate` -- the password-checking line in the `auth` stack does not participate at all, and `faillock`'s failure count only climbs with password attempts: log in with a leaked private key and password lockout cannot touch you. But the `account` and `session` stacks run as usual -- an expired account (`chage -E 2026-01-01`) vetoes a key login just the same, and `pam_limits`' handle limits and `pam_systemd`'s session registration apply to key sessions too. The opposite trap is more common: `usermod -L` locks the password field (adds a `!` prefix in `/etc/shadow`) and seals only the `auth` stack -- **locking an account does not lock out key-based logins**. To truly cut someone off, pick one of three: delete their `authorized_keys` entry, change the login shell to `/sbin/nologin`, or expire the account with `chage -E` -- the latter two work precisely because of the `account` stack.

### 3.9 Restricting where logins come from: pam_access

Some defenses sit in front of password checks: "this origin is not allowed to come here at all". `pam_access.so` reads `/etc/security/access.conf`, one rule per line, formatted as **`+`/`-` : user/group : origin**; the typical use is "root may only ssh from the ops bastion host". Rules are evaluated **top down and the first match wins**, so an allow must be written before the catch-all deny -- reverse the order and the leading `-:root:ALL` shuts the bastion host out as well:

```text
# /etc/security/access.conf
# Rules are read top down and the first match wins: allow the bastion first, then deny everything else as a backstop
+:root:192.168.56.10
-:root:ALL
```

Each of the three fields has its quirks: groups must be written in `(wheel)` parentheses -- a leading `@` means a netgroup, do not use it for ordinary user groups; origins support IPs, network ranges such as `192.168.56.`, hostnames and `LOCAL` (local sessions; note that `ssh root@localhost` still goes over a network connection and does not count as `LOCAL` -- a detail `access.conf(5)` calls out by name); the origin field also supports `EXCEPT`, so `-:root:ALL EXCEPT 192.168.56.10` does in one line what the two lines above do in two. On the wiring side, `pam_access` is not enabled by any service file out of the box: Debian/Ubuntu's `/etc/pam.d/sshd` keeps a commented-out line `account required pam_access.so`, and uncommenting it makes it live; RHEL/Arch's sshd file has no such line, so add the same line in the `account` section yourself (the `sshd` file is not under authselect's management, so editing it directly is safe). It hooks into the `account` stack -- the same gate as the expiry check in 3.8. Verification has to originate outside the allowlist (with keys already configured, the only thing that can block you is the account stack):

```bash
$ ssh root@192.168.56.10        # Initiated from 192.168.56.55 (not on the allowlist)
Permission denied (publickey,password).
$ journalctl -t sshd --since "5 min ago" | grep pam_access
Oct 03 10:21:47 db1 sshd[2101]: pam_access(sshd:account): access denied for user `root' from `192.168.56.55'
```

## 4. sudo's Complete Syntax: How to Write an Allowlist

### 4.1 The four-tuple of a single grant

A sudoers grant line is a four-tuple: **who, on which machine = (as whom), what to run**. `alice ALL=(root) /usr/bin/systemctl restart nginx` reads "alice, on any machine, as root, may run only this one command". `ALL` is the wildcard host name -- always use it for a single machine, where it only really means something when several machines share one sudoers. All four positions can be collected into aliases, which keeps rules readable and reusable:

```text
# /etc/sudoers.d/ops (or the main file under visudo; same syntax)
Cmnd_Alias NETCMDS  = /usr/bin/ip, /usr/bin/ping, /usr/bin/traceroute
Cmnd_Alias BACKUP   = /usr/local/bin/backup.sh
User_Alias OPS      = alice, bob

OPS     ALL=(root) NETCMDS
backup  ALL=(root) NOPASSWD: BACKUP
Defaults timestamp_timeout = 5
```

Three details are worth money: first, commands must be written with **absolute paths** -- `ip` is not acceptable, `/usr/bin/ip` is -- this guards against PATH hijacking; second, `NOPASSWD:` applies only to the block of commands right after it, not to the person for the whole line, let alone as a default for the whole file; third, `Defaults timestamp_timeout = 5` squeezes "no password re-ask for a few minutes after typing it" down from the default 15 minutes to 5 -- a trade-off between session security and annoyance, tune it to your team's taste. Rule files belong under `/etc/sudoers.d/`, named by purpose (`ops`, `backup`), leaving the main file to the distro defaults -- the same "local changes live apart from the package manager's territory" philosophy again.

The editing entry point is always one: `visudo`. It is not "an alias for vi" but a dedicated editor with syntax checking -- it parses before saving and, on a syntax error, refuses to write and drops you back into the editor. Bypassing it and running `vim /etc/sudoers` directly means one slip of a character can put sudo on strike for everyone, possibly on a machine where you have no root shell. `visudo -c` gives existing files a health check at any time, and `visudo -f /etc/sudoers.d/ops` checks a single fragment:

```bash
$ sudo visudo -c
/etc/sudoers: parsed OK
/etc/sudoers.d/ops: parsed OK
```

`visudo -c -f` is also a gate in CI and pre-launch checks: push a badly written file through it and it pins the error down to line and column and rejects the file outright (`-c` reads without writing; you only need `sudo` when you cannot read a system fragment set to 0440 yourself):

```bash
$ printf 'user ALL=(ALL) ALL\nbad line here ((\n' > /tmp/bad
$ visudo -c -f /tmp/bad
/tmp/bad:2:10: syntax error: expecting '=' but found 'h'
bad line here ((
         ^
visudo: invalid sudoers file
$ echo $?
1
```

Older sudo (1.8 and earlier, as on RHEL 8) reports `>>> /tmp/bad: syntax error near line 2 <<<` -- the format differs, the refusal to write is the same.

Dangerous phrasings and their tightening, in a four-row table that closes this section:

| Dangerous phrasing | Why it is dangerous | Tightened phrasing |
|--------------------|---------------------|--------------------|
| `(ALL) ALL` (to a non-admin) | It grants root by equivalence, and the allowlist exists in name only | List the absolute paths of the business commands one by one |
| `/usr/bin/find *` | `*` swallows any argument, and `-exec` revives a shell | Pin the full command and its fixed arguments, e.g. `find /var/backup -name '*.log'` |
| `NOPASSWD: ALL` (granted for "efficiency") | Nobody verifies identity any more; it is passwordless root handed to somebody else | Only a single high-frequency, low-risk command deserves NOPASSWD |
| `ALL, !/usr/bin/su` ("exclude the dangerous one") | It only excludes one command; everything else was already allowed -- false confidence | Enumerate what to allow positively; do not build on a deny |

### 4.2 Querying and verifying

sudo ships with two query keys: `sudo -l` lists "what may I run" (always start an authorization investigation here), and `sudo -ll` gives the long format including the source file; an administrator adds `-U` to inspect someone else:

```bash
$ sudo -l -U alice
User alice may run the following commands on db1:
    (root) /usr/bin/ip, /usr/bin/ping, /usr/bin/traceroute
```

Note that the order `sudo -l` displays is sudo's **last match wins** semantics: when several rules hit the same user, the later one overrides the earlier -- so a "be permissive first, then narrow" formulation (ALL first, restrictions after) must put the narrowing rules at the end, and reversing that order makes them do nothing. This is also why the granting habit is "start from zero and allow one command at a time" rather than "grant everything, then patch": same origin as the [Firewall](./firewall.md) default-deny philosophy -- the hallmark of an allowlist is narrowness, not length.

### 4.3 Environment variables: why sudo "cannot find the command"

sudo does `env_reset` by default: at the moment of escalation it clears the environment down to a tiny allowlist and replaces PATH with the fixed value set by `Defaults secure_path` in sudoers. The design guards against environment injection -- a malicious `PATH`, `LD_PRELOAD` or `PYTHONPATH` can all slip into the root process on the back of the escalation; once the environment is wiped, every trap the attacker left in their own shell is defused. The cost is script ergonomics: scripts that depend on a self-installed path suddenly get `command not found` under `sudo`, and eight times out of ten it is because secure_path does not cover it. The right fix is not to switch off env_reset but to allowlist what you need:

```text
# /etc/sudoers.d/env
Defaults secure_path = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
Defaults env_keep += "HTTP_PROXY HTTPS_PROXY EDITOR"
```

`sudo -E` preserves the caller's environment wholesale, but that is a hammer for exceptional cases -- it is tearing down the firewall for convenience, and standards should keep it out of production scripts; if a few variables will not get through, name them with `env_keep`. Reading the situation is simple too: `sudo env | grep -i proxy` shows at a glance which variables are alive, far faster than guessing from documentation.

## 5. sudo's Security Boundary: Backdoors Inside the Allowlist

### 5.1 A command usable as a shell is a root grant

The naive idea behind an allowlist is "allow only this command", but it carries a hidden premise: **the command itself must not become a gateway to arbitrary commands**. Three classic cases: whitelisting `/usr/bin/find` -- `sudo find / -name x -exec /bin/sh \;`, where `-exec` makes find spawn a root shell for you; whitelisting `/usr/bin/vi` -- typing `:!sh` inside vi also lands a root shell; and `less` or git's pager (while paging through `sudo git log`) accepting `!sh` as well. The common thread: all three retain the ability to execute external commands internally, and sudo only controls the entrance, not the interior.

```bash
# Each one is a textbook privilege escalation -- whitelisting them makes the allowlist an empty gesture
$ sudo find /tmp -name '*.log' -exec /bin/sh \;
$ sudo vi /etc/hosts    # Inside vi: type !sh and press Enter
$ sudo git log -p       # Inside the pager: type !sh and press Enter
```

So the reviewing principle for allowlists: **any command that can execute arbitrary code gets no place on the allowlist** -- editors, pagers, interpreters (python/perl/node REPLs and `-c`), compilers, find/tar with `-exec`/`--exec`, and package managers (the headline case in the next section). This principle outlasts a list of vulnerabilities: lists go stale, the viewpoint "what can this command do in its interior" does not. When granting operations access, prefer tools that narrow themselves through their parameters (`systemctl restart nginx` with the service name pinned), or simply wrap a script that does exactly one thing and put the script on the allowlist -- the script has to be owned by root and not writable by the allowlisted user before it qualifies as a "command".

sudoers actually ships a building block for this hazard -- the `NOEXEC:` tag, placed before a command so that sudo intercepts any `execve` call inside it; `find -exec` and `vi :!sh` receive `EPERM` on the spot and cannot swap shells:

```text
# The damage-limiting formulation when you are forced to allow find -- the interior is still there, but no shell comes out
ops  ALL=(root) NOEXEC: /usr/bin/find /var/backup -name '*.log'
```

`NOEXEC` is a patch, not an amulet: it stops `execve`, but cannot stop privilege misuse inside the allowed program's own logic (reading sensitive files, changing anything it already has the rights to change). If you can enumerate positively, do not rely on it as a backstop. One line on implementation: on modern Linux sudo intercepts `execve` at the syscall layer with seccomp, while older versions and some platforms fell back to injecting a `noexec` LD_PRELOAD library -- the common point of both routes is "only controls swapping processes, not what that process may do".

### 5.2 Auditing: who borrowed root, and when

Every use of sudo leaves a trace in the authentication log (Debian/Ubuntu: `/var/log/auth.log`, RHEL-family: `/var/log/secure`, Arch: primarily the journal -- see the division of labor in [System Logs](../basic/log/syslog.md)):

```bash
$ journalctl -t sudo --since today
Oct 02 10:12:31 db1 sudo[3121]:   alice : TTY=pts/1 ; PWD=/home/alice ; USER=root ;
    COMMAND=/usr/bin/ip addr
$ sudo grep COMMAND /var/log/auth.log | tail -3
```

The log carries all five elements -- who, on which terminal, the working directory, as whom, and what was run -- so after-the-fact accountability and anomaly detection (a sudo in the middle of the night, a sudo from an unfamiliar origin) both ride on it. Since sudo 1.9 the session's input and output can also be recorded (`Defaults log_input,log_output`, written under `/var/log/sudo-io/`), which suits guarding the most sensitive bastion host -- the trade-off being that storage and privacy compliance have to be thought through together, so do not turn it on globally by default. The audit difference between `su -` and sudo is also worth remembering: everything after an su is attributed to "the su action", with no trace of the follow-up commands, while sudo records each command separately -- the mechanical basis for the frontline rule "use sudo, do not hand out the root password".

### 5.3 su -, sudo -i, sudo -s: three ways to borrow root

The three everyday escalation entries get mixed up, but their semantics fork three ways: `su -` asks for **the target user's password** (root by default) and buys a complete login environment; `sudo -i` asks for **your own password** (or nothing at all, when passwordless) and likewise simulates root's login shell; `sudo -s` also asks for your own password, but inherits your current environment variables instead of rebuilding a login environment. Put the three in one table and the choice is obvious:

| Route | Whose password is asked | Environment semantics | Audit granularity |
|-------|-------------------------|------------------------|-------------------|
| `su -` | root's password | a complete login environment (login shell) | records a single "su event"; later commands leave no trace |
| `sudo -i` | your own password | simulates root's login environment | the entry is recorded; input/output recording can be configured for the session |
| `sudo -s` | your own password | inherits the current environment, only the identity changes | same as `sudo -i` |

The engineering trade-offs follow from this table: the fewer people who know the root password the better (password changes, accountability and offboarding are all simpler), so `su -` retreats to an emergency channel on the physical console, and everyday use is `sudo <single command>` -- do not open an interactive shell unless you have to; when you genuinely need a full environment to troubleshoot, reach for `sudo -i` instead of asking someone for the root password -- which is exactly what the audit capability in 5.2 exists for. `sudo -s` belongs to "this script scenario where I just want to work with my own PATH and proxy variables", used and left, not a standing habit.

## 6. Distro Differences and Modern Alternatives

| Task | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Install the PAM framework | `apt install libpam-modules` | `pacman -S pam pambase` | `dnf install pam` |
| Install sudo | `apt install sudo` | `pacman -S sudo` | `dnf install sudo` |
| Password quality module | `apt install libpam-pwquality` | `pacman -S libpwquality` | `dnf install libpwquality` |
| Module library directory | `/usr/lib/x86_64-linux-gnu/security/` | `/usr/lib/security/` | `/usr/lib/security/` |
| Common stack management | `pam-auth-update` (menu-driven) | hand-edited (watch for `.pacnew`) | `authselect` (profile-driven) |
| Admin group | `sudo` group | `wheel` group (the default rules are commented out and must be enabled yourself) | `wheel` group (live as soon as sudo is installed) |

One sentence expanding the group difference: Debian's habit is to put administrators in the `sudo` group (matching the default rule `%sudo ALL=(ALL:ALL) ALL`); RHEL-family uses the `wheel` group, activated as soon as the sudo package is installed; Arch's sudoers keeps both wheel lines commented out by default -- uncomment either `%wheel ALL=(ALL:ALL) ALL` or its passwordless variant yourself, in keeping with Arch's minimalist-by-default temperament. Desktop and server scenarios also have a third player, polkit: mounting a disk in a graphical session, NetworkManager changing network settings, PackageKit installing packages -- these "action-level" grants are adjudicated by polkit rule files, and the admin group is wheel there too. The division of labor with sudo is "command-level goes to sudoers, action-level goes to polkit"; on servers you meet almost only the former, while in mixed desktop environments you have to check both.

## 7. Common Pitfalls

**A syntax error from editing /etc/sudoers directly puts sudo entirely on strike.** The symptom is everyone's `sudo` reporting a `parse error`, at exactly the moment when you happen to have no root shell open. Order of operations: first try `pkexec visudo` (if polkit is still alive it can save you); if that fails you have to log in as root on the physical console (assuming the root password is not locked) or mount the disk in a live/rescue environment and fix it back -- the same procedure as [Boot Rescue](../system-management/boot-process.md). Prevention has one iron rule: never take the express lane past visudo, and edit fragment files with `visudo -f` as well so that it checks the file before saving.

**Breaking PAM and locking yourself out.** Typical root causes: commenting out `pam_unix.so` in the `session` section (session setup failure = login failure), or reordering the `auth` lines wrongly. PAM errors often show up only in the logs (`journalctl -u ssh` or the `FAILURE` lines of the auth log), while the login side merely sees "wrong password". Three disciplines: keep **one already-logged-in root session open** before changing anything; change one thing at a time and verify it in a second terminal before moving to the next; after the change, `su` to yourself as a smoke test before logging out. If you are genuinely locked out, boot a live environment and put the file back -- which is also why 3.2 insists on "understand before editing": PAM files are short, and reading them costs far less than trial and error.

**pam_pwquality configured but not taking effect.** Three common root causes: the module package is not installed (Debian's `libpam-pwquality` is a separate package; without it the `.so` referenced by the rule line simply does not exist, and the stack skips or errors according to the control flag); the wrong file was edited (on RHEL 9 `/etc/pam.d/system-auth` is a symlink into `/etc/authselect/`, and editing it directly is wiped by the next `authselect` invocation -- use `authselect enable-feature` or edit the profile; on Debian it must land in `common-password`, which services share via `@include`); the parameter file was edited but the `pam_pwquality.so` line still carries old arguments -- in-line arguments take precedence over `pwquality.conf`, and when the two disagree the line wins. Always verify by walking a real `passwd`; do not trust "file changed = policy in effect".

**faillock counts do not climb, nobody gets locked.** Nine times out of ten it is a layout problem: the `preauth` line must sit **before** `pam_unix.so` and the `authfail` line **after** it -- only the pair bracketing it constitutes complete bookkeeping; if you added only `authfail` and `pam_unix` is `sufficient` with a short-circuited success path, the failure path still never reaches the recording line. Another possibility is a `deny` set far too high, or a test interval longer than the failure-record window (by default the last 15 minutes). Watch the count climb live with `faillock --user` from 3.3; that is far clearer than logging in again and again.

**Passwordless sudo not taking effect.** Check in order: `sudo -l -U user` first to see the effective rule set (note last match wins -- later rules override earlier ones); group rules need the `%` prefix (`%wheel` is a group, `wheel` is a username, and a typo does not raise an error, it simply does not match); whether the user is really in the group is obvious at a glance from `id user`; fragment file permissions must be 0440 (`chmod 440 /etc/sudoers.d/ops`) -- too permissive and sudo silently ignores the file, a silent-ignore design that has left countless people wondering "but the file is definitely written, right?".

**NOPASSWD for the package manager means everyone is root.** `apt`, `dnf` and `pacman` run maintenance scripts as root executing arbitrary code -- installing one malicious deb is a complete escalation, and user-space package managers like npm and pip are the same. The allowlist principle applies again here: package managers, interpreters and editors all belong to the "far too capable in their interior" class; if you must grant one, wrap it in a script that pins the behavior (say, a wrapper that only permits `apt upgrade`), and accept the reality that this does not shrink the attack surface -- it only swaps in auditing. The related checks are already in the baseline checklist for [Hardening](./hardening.md).

## References

- Linux-PAM project -- [kernel.org/pub/linux/libs/pam](https://www.kernel.org/pub/linux/libs/pam/)
- Linux-PAM source and documentation -- [github.com/linux-pam/linux-pam](https://github.com/linux-pam/linux-pam)
- sudo official documentation -- [sudo.ws/docs](https://www.sudo.ws/docs/)
- man pages -- man pam, man pam.conf, man sudoers
- Arch Wiki: Sudo -- [wiki.archlinux.org/title/Sudo](https://wiki.archlinux.org/title/Sudo)
- Arch Wiki: PAM -- [wiki.archlinux.org/title/PAM](https://wiki.archlinux.org/title/PAM)
- Bird's Private Recipes -- account management chapter [linux.vbird.org](https://linux.vbird.org/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [glossary](/glossary.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [README](README.md)
- [ldap](/server/ldap.md)
- [ssh](/server/ssh.md)
