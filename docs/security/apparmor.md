# AppArmor in Practice

nginx runs fine on an Ubuntu box: the config file reads straight from the default `/etc/nginx/nginx.conf`, `systemctl status nginx` is green, but the one thing that fails is loading a newly mounted site certificate from `/opt/certs/site.crt` -- `cannot load certificate`. `ls -l` shows the permissions are complete, the owner is correct, a manual `cat` as root works, and `nginx -t` passes. It is only when you scroll `/var/log/syslog` that you spot the one line you would normally overlook: `kernel: audit: type=1400 audit(...): apparmor="DENIED" operation="open" profile="/usr/sbin/nginx" name="/opt/certs/site.crt"`. Ordinary permissions did not stop it; AppArmor inside the kernel did -- and it did so with no fanfare, the process receiving only a return value conceptually equivalent to `EACCES`.

This is the most intuitive divide between AppArmor and SELinux: it does not stamp every file with a "type label", it binds a **profile to a program path**, then lists what that program may touch with **file-path wildcards**. A certificate under `/etc/nginx/` is fine; move it to `/opt/certs/` and it breaks -- not because the label changed, but because the path rule no longer covers it. Understand this one point, "path versus label", and almost every MAC-class outage on Ubuntu can be located in minutes. For the SELinux troubleshooting methodology see [SELinux in Practice](./selinux.md); the two fix mindsets mirror each other, but the commands and the objects you read are completely different.

> Content draws on the AppArmor project documentation and the Ubuntu/Arch Wikis -- see the references at the end.

## What This Page Covers

- Make the difference clear: AppArmor enforces by path, SELinux by label
- Read the three fields `operation=` / `profile=` / `name=` and derive which rule to change straight from one denial
- Use `aa-status`, `aa-complain`, `aa-enforce` to switch between enforce and complain safely
- Write a minimal working profile (file `rwk`, `network`, `capability`) and reload-verify with `apparmor_parser -r`
- The boundary of Docker's `docker-default` profile and `--security-opt apparmor=`
- Tell apart how the three distro families treat AppArmor by default, so you do not cross-port a distro

## 1. AppArmor's Model: It Binds the Program, Not the File

### 1.1 The Unit of Enforcement Is the "Program Path"

AppArmor's core object is the **profile**, and the header of a profile is that program's absolute path:

```
/usr/sbin/nginx {
  ...
}
```

The rules say "what this program may do": which paths it may read, which it may write, whether it may open network sockets, whether it may use a given `capability`. Once the program executes, the kernel slots it into the corresponding profile by its path, and from then on every action passes the profile before DAC is even discussed. **A profile is bound to the binary path** -- if the path changes (an upgrade moves the install directory, a symlink, a mount elsewhere inside a container), or the program is executed under a different name, the profile may fail to apply or may match a different profile. This is a recurring blind spot in AppArmor troubleshooting: `systemctl status` looks completely normal, yet what it is running is a "profile-unconstrained" process.

### 1.2 Path Rules and Permission Letters

File rules use combinations of permission letters; the three you reach for most are read, write, and lock:

```
/etc/nginx/nginx.conf r,                          # read-only
/var/log/nginx/** rw,                             # read/write the directory and its descendants
/var/lib/nginx/** rwk,                            # plus an exclusive lock
```

`r` is read, `w` is write, `k` is file lock (the `flock`/`fcntl` family), `m` is an executable memory mapping via `mmap`, `x` is execute (split into `ix`/`ux`/`px`/`cx`, which determines whether the profile is inherited or switched on execute). Among the wildcards, `*` does not cross directories while `**` does -- writing `/etc/nginx/*` as `/etc/**` is the most common "handy over-broadening" in a config file. Beyond that there are two other rule families:

```
network inet tcp,                                 # allow IPv4 TCP sockets
network inet6 stream,
capability net_bind_service,                      # allow binding ports below 1024
capability setuid,
```

`network` allows by protocol family and type, and `capability` maps to the kernel's capability bits. A profile does not need to spell out every rule explicitly -- the `#include <abstractions/base>` it pulls in already preshades a large batch of "every program will use" general rules (loading shared libraries, reading `/etc/ld.so.cache`, reading locale, basic `/proc` entries, and so on); what actually needs your hand are only that program's own few.

### 1.3 Contrast with SELinux

The two frameworks solve the same problem -- add a mandatory layer on top of DAC -- but at the operational level they share almost no line. The table below puts every row you will actually touch in day-to-day troubleshooting side by side:

| Comparison | AppArmor | SELinux |
|--------|----------|---------|
| Enforcement target | program path -> file/network/capability path | process type label -> resource type label |
| Policy language | profile text (path wildcards + permission letters) | type enforcement rules (`allow domain type:class permission`) |
| Default distros | Ubuntu/Debian, SUSE/OpenSUSE enabled by default | RHEL/CentOS/Rocky/Fedora default to Enforcing |
| Label spread problem | none (files carry no labels; a new file needs no stamping) | yes (new directories/files default to `var_t`; needs `semanage fcontext`) |
| Troubleshooting log | `apparmor="DENIED"` in `dmesg`/`journalctl -k` | `AVC` in `/var/log/audit/audit.log`, read with `ausearch` |
| Denial fields | `operation=` `profile=` `name=` | `scontext` / `tcontext` / `tclass` |
| Policy tools | `aa-status`, `aa-complain`, `aa-genprof`, `aa-logprof` | `semanage`, `restorecon`, `setsebool`, `audit2allow` |
| Status query | `aa-status`, `cat /sys/module/apparmor/parameters/enabled` | `getenforce`, `sestatus` |
| Container default | Docker attaches `docker-default` to every container | depends on the host and runtime configuration |

Two criteria worth memorizing: **on Ubuntu, `getenforce` returning empty output is not a mistyped command, it means this machine does not use SELinux**; **on RHEL, `aa-status` reporting `command not found` is the same story**. See `name=` / `profile=` and it is AppArmor; see `scontext` / `tcontext` and it is SELinux -- the two field families never appear together. The contrast table stops at this row; how to actually change things, and which rule to change, is covered in the subsections below.

## 2. Status and Modes

### 2.1 Three States

`aa-status` is AppArmor's overview entry point, and its output is far more detailed than `getenforce`:

```bash
$ sudo aa-status
apparmor module is loaded.
34 profiles are loaded.
32 profiles are in enforce mode.
   /usr/bin/man
   /usr/sbin/nginx
   ...
2 profiles are in complain mode.
   /usr/sbin/foo
0 processes have profiles defined.
0 processes are unconfined but have a profile defined.
```

The semantics of the three tiers must be kept apart:

- **enforce**: the rules are evaluated as usual, any overstep is really denied and the process gets an error return; this is the default state.
- **complain**: the rules are evaluated as usual, but an overstep is **only recorded, never blocked**, the process runs normally, and the log carries an `apparmor="ALLOWED"`. It is the safety net for debugging -- behavior is unchanged, but you can accumulate the full set of "actions that would have been blocked".
- **unconfined**: the process is unconstrained by any profile; AppArmor imposes no enforcement on it. The trailing `unconfined but have a profile defined` in `aa-status` means "the program path can match some profile, but that profile has not been loaded" -- this is the false-protection state worth watching for while troubleshooting.

There is one more tier, `kill` mode (write `flags=(kill)` in the profile; an overstep kills the process outright, harder than enforce), almost never used in practice -- knowing it exists is enough. To judge whether a given process is actually under management, one command:

```bash
$ cat /proc/$(pgrep -f nginx | head -1)/attr/current
/usr/sbin/nginx (enforce)
# Output "unconfined" means this process is covered by no profile
```

### 2.2 The Module and the Parser

AppArmor is one kernel module plus a userspace toolset. Confirm the kernel side:

```bash
$ cat /sys/module/apparmor/parameters/enabled
Y                       # AppArmor is ready in the kernel; N or a missing file = not enabled
```

The core on the userspace side is `apparmor_parser` -- it compiles the profile text under `/etc/apparmor.d/` into the kernel:

```bash
$ sudo apparmor_parser -r /etc/apparmor.d/usr.sbin.nginx   # reload a single profile
$ sudo apparmor_parser -a /etc/apparmor.d/usr.sbin.nginx   # load (use when it is not loaded)
$ sudo apparmor_parser -R /etc/apparmor.d/usr.sbin.nginx   # unload
$ sudo systemctl reload apparmor                           # reload every profile
```

`apparmor_parser` is also your **syntax checker** while writing profiles: with `-r`, if the profile has a spelling or structural error, it dumps the error to stderr and refuses to load, leaving the old profile in effect -- so there is no need to worry before editing a profile, a mistake will not leave the program unprotected immediately, though you will see a parse failure.

## 3. The Fix Trajectory: From One Denial to a Minimal Allow

Aligning with the "priority" thinking in [SELinux in Practice](./selinux.md), AppArmor fixes are also ranked smallest to largest change radius. The difference is that AppArmor has no "label" layer, so there is no "change the label" step at all -- the starting point is **read the denial, then decide which rule to change**.

### 3.1 Reading the Three Fields of a Denial

The denial appears in both the kernel ring buffer and the journal; you can look at either:

```bash
$ sudo dmesg | grep -i apparmor | tail -3
[12345.678] audit: type=1400 audit(1759415677.124:4256): apparmor="DENIED" \
  operation="open" profile="/usr/sbin/nginx" name="/opt/certs/site.crt" \
  pid=812 comm="nginx" requested_mask="r" denied_mask="r" fsuid=0 ouid=0

$ journalctl -k | grep apparmor | tail -3        # equivalent entry point; more common on systemd boxes
$ grep apparmor /var/log/syslog | tail -3        # Debian/Ubuntu syslog also carries a copy
```

The three fields decide what you change:

- **`operation=`**: the type of denied action -- `open` (open a file), `exec` (execute), `connect` (connect out), `bind` (bind), `capability` (use some capability), `file_lock`, and so on. It tells you whether this is a file-rule, network-rule, or capability-rule problem.
- **`profile=`**: which profile blocked it (here `/usr/sbin/nginx`). Note it may disagree with `comm=` (the process name); trust `profile=`.
- **`name=`**: the path/resource of the accessed object. It is the direct basis for the fix -- add this one path to the profile and this one denial is resolved.

`requested_mask="r" denied_mask="r"` are the requested and finally denied permissions; in the nginx case a read was requested and a read was denied, so adding a `/opt/certs/** r,` rule to the profile is enough. If `operation="capability"` is followed by `capname=`, you fall through to the bottom and need a `capability` rule.

### 3.2 Temporarily Loosening with `aa-complain` to Locate

Once one denial is resolved there is often a second and a third -- the program touches a string of files on startup. Rather than guess one at a time, flip the profile to complain first and let the program record every action that "would have been blocked":

```bash
$ sudo aa-complain /usr/sbin/nginx
Setting /usr/sbin/nginx to complain mode.
# Now check /var/log/syslog; the apparmor="ALLOWED" records hold the full action set
```

`aa-complain` changes only the runtime state and never touches the profile text on disk; its counterparts are `aa-enforce` (switch back to enforcing) and `aa-disable` (unload this profile entirely). **Keep the diagnosis window short** -- while in complain this program is effectively unconstrained, so switch back the instant you finish locating:

```bash
$ sudo aa-enforce /usr/sbin/nginx
```

### 3.3 Two Paths to a Persistent Fix

A temporary loosening is not a fix. A persistent fix has two paths, chosen by change radius.

**Edit the local override fragment (recommended).** `/etc/apparmor.d/local/` is the directory dedicated to appending local rules, and many distro-shipped profiles end with `#include <local/usr.sbin.nginx>`. Edit here instead of the distro file, and upgrades will not conflict:

```bash
$ sudo tee -a /etc/apparmor.d/local/usr.sbin.nginx <<'EOF'
/opt/certs/** r,
/var/log/nginx/extra/** rw,
EOF
$ sudo apparmor_parser -r /etc/apparmor.d/usr.sbin.nginx
```

**Reuse an `abstractions/` fragment.** Under `/etc/apparmor.d/abstractions/` sit rule collections for "a class of resource": `base` (fundamentals), `ssl_certs` (certificate directories), `nameservice` (DNS/hostname related), `php`, `python`, and more. If what you need to allow lines up with an abstraction's scope, an `#include <abstractions/name>` is steadier than writing paths by hand; before touching anything, reverse-search existing profiles with `grep -rn "path keyword" /etc/apparmor.d/` and copy the established idiom -- by far the least trouble.

### 3.4 Generating Candidate Rules with Tools

`aa-logprof` scans recent denials/ALLOWEDs in the log and interactively asks you one by one "add this to the profile?"; press `a` (allow) and it writes the rule into the corresponding profile. `aa-genprof` is for generating a brand-new profile from scratch. The output of both is a **candidate**, not a verdict:

```bash
$ sudo aa-logprof
Reading log entries from /var/log/syslog.
Profile: /usr/sbin/nginx
Path: /opt/certs/site.crt
  New Mode: r
(A)llow / (D)eny / (I)gnore / (N)ew / (G)lob / (Q)uit
```

The boundary of the tools must be spelled out: they will allow "every request that appeared in this log", which can be wider than what you want. Read each path and permission it offers before allowing, and reject items unrelated to this business case -- the same discipline as "read the `.te` that `audit2allow` generated" in section 6 of [SELinux in Practice](./selinux.md).

### 3.5 `aa-disable` Is the Last Step

`aa-disable` unloads an entire profile, which is the same as turning AppArmor off for that program. It belongs only in two situations: the profile is grossly out of sync with the program version and you need to redo it; or you have confirmed during troubleshooting that the problem really is AppArmor, need business to recover first, and will rewrite the rules later -- **both require a "temporarily disabled, recovery time" ticket**. AppArmor profiles are usually narrower and more precise than a full SELinux policy, and most denials resolve with a single added path rule; truly needing a full disable is rare.

## 4. Writing a Custom Profile

### 4.1 The Minimal Skeleton

Write a profile for a small home-compiled program at `/usr/local/bin/mytool`, saved to `/etc/apparmor.d/usr.local.bin.mytool` (the convention is to replace `/` in the path with `.`):

```
# /etc/apparmor.d/usr.local.bin.mytool
#include <tunables/global>

/usr/local/bin/mytool {
  #include <abstractions/base>          # general rules for the loader, locale, base libraries

  /usr/local/bin/mytool mr,              # self readable/executable mapping
  /usr/local/share/mytool/** r,          # read-only resources
  /var/lib/mytool/** rwk,                # data dir: read, write, lock
  /var/log/mytool/** rw,                 # log dir

  network inet tcp,                      # allow IPv4 TCP sockets
  network inet6 tcp,

  capability net_bind_service,           # allow binding low ports
}
```

`#include <tunables/global>` opens almost every profile; it brings in variable definitions like `@{HOME}` and `@{PROC}`. `#include <abstractions/base>` covers the general rules most programs need; skip it and you must hand-write shared-library loading, `/proc/self/**`, locale, and so on line by line, which you will basically get wrong. The rest of the skeleton is the program's three kinds of demands: file `rwk`, network `network`, capability `capability`.

### 4.2 Loading and Verifying

Once written, do not jump straight to enforcing -- follow the two-step "observe in complain first, then verify in enforce":

```bash
# 1. Syntax-check and load
$ sudo apparmor_parser -r /etc/apparmor.d/usr.local.bin.mytool
# If you see "AppArmor parser error ... line N", go back to the profile at that line (often a missing comma or a closing brace)

# 2. Switch to complain first, run a business cycle, and confirm everything meant to be allowed is
$ sudo aa-complain /usr/local/bin/mytool
$ sudo journalctl -k | grep apparmor | grep -v DENIED | tail
#    If the logs show only apparmor="ALLOWED" and none of the records you wanted, the rules already cover it

# 3. Switch to enforce and test for real
$ sudo aa-enforce /usr/local/bin/mytool
$ sudo aa-status | grep mytool
   /usr/local/bin/mytool
```

The core criterion for verification: **after switching the profile to enforce, every business function works normally**. Any single failure leaves an `apparmor="DENIED"` in `dmesg` -- go back to 3.1, read the three fields, add a rule to the profile, `apparmor_parser -r` to reload, and loop until denials hit zero. This is AppArmor's "incremental allow": every denial is a precise permission request, read one by one, allow one by one, and the profile grows into a shape that fits the workload as it runs.

## 5. The Three Families Today

AppArmor's adoption runs opposite to SELinux's: it was born in the SUSE family, adopted by default by Ubuntu from 7.10 onward, and is growing ever more common across Debian; meanwhile the RHEL family took the SELinux route and does not ship AppArmor at all by default.

**Ubuntu / Debian.** Ubuntu enables AppArmor by default and ships profiles for a large number of common services (nginx, mysqld, dockerd, snap related, `man`, and more) -- no install or configuration needed, enforcing out of the box. Debian enabled AppArmor by default from 10 onward, with the profiles shipped in packages covering slightly less ground than Ubuntu. Status and version:

```bash
$ sudo aa-status | head -3
$ dpkg -l | grep -E 'apparmor|apparmor-profiles'   # are both the package and the profile package installed
$ sudo apt install apparmor-profiles               # install the "extra but not enabled by default" profile collection
```

**Arch.** Arch ships neither SELinux nor AppArmor by default -- the MAC layer out of the box is empty. To use AppArmor you install it yourself, start it yourself, and enable it at boot yourself:

```bash
$ sudo pacman -S apparmor
$ sudo systemctl enable --now apparmor.service
$ cat /sys/module/apparmor/parameters/enabled
Y                       # Output N or a missing file means the kernel did not select apparmor as an enabled LSM
```

Arch's default LSM enable list does not include apparmor; after installing you must also write `lsm=landlock,lockdown,yama,integrity,apparmor,bpf` into the kernel boot parameters (the GRUB or systemd-boot config), otherwise the check above returns N. Installing it does not mean any profile is in effect -- the profiles bundled in Arch's `apparmor` package are few, and business programs need profiles written or ported from another distro. This is why many RHEL-oriented and Ubuntu-oriented hardening checklists come up "half missing" on Arch: over there it is the default state, while here you have to build the baseline by hand.

**RHEL / CentOS / Rocky.** These default to SELinux Enforcing; the distro does not provide AppArmor and there is no official package in the repos. **Installing AppArmor on the RHEL family is not the normal path** -- running two MAC stacks at once brings hard-to-reconcile semantic conflicts (which one blocks first, how the logs split, who writes the policy), and the community basically does not do it. Any `AVC` that appears on the RHEL family is handled through [SELinux in Practice](./selinux.md); do not try to look it up with `aa-status`.

One line for each family: **Ubuntu/Debian is AppArmor's home turf, Arch you build yourself, the RHEL family goes with the SELinux stack.** Before copying commands across distros, run `aa-status` or `getenforce` once to confirm which side you are on.

## 6. Containers and AppArmor

On a host with AppArmor enabled, Docker attaches a profile called `docker-default` to **every container** by default -- it gives container processes a moderate constraint: disabling several dangerous mounts and kernel operations, allowing network and ordinary file activity. This profile is managed by the container runtime itself; you do not need to write it:

```bash
$ docker run --rm alpine sh -c 'cat /proc/self/attr/current'
docker-default (enforce)
```

To override it, the runtime offers `--security-opt`:

```bash
# Use a custom profile: load it on the host first, then reference it by name
$ sudo apparmor_parser -r /etc/apparmor.d/docker-myname
$ docker run --security-opt apparmor=docker-myname ...

# Fully strip the container of AppArmor confinement -- use with care
$ docker run --security-opt apparmor=unconfined ...
```

`apparmor=unconfined` means this container is **no longer constrained by AppArmor**; every action of every process inside lands directly on the host's DAC. The risk is concrete: once the container is breached (RCE, dependency poisoning), the attacker has more freedom of movement, and the bar for container escape and lateral movement drops accordingly. It is not a reason to disable it, but it should be an explicit choice made after "I know what I am giving up, and have left other means in place" -- in production it should not appear in default boot arguments, it should appear in the review record. The reverse usage is to tighten a container's profile below `docker-default`: write a dedicated profile for a container that runs a single service and reads a single directory, shrinking the attack surface below the default.

## 7. Common Failures

**The service is silently denied on startup; the log holds only a vague permission error.** The symptom is `systemctl start` returning failure, or the program reporting `EACCES` on startup, while `ls -l` shows the permissions are fine. The first move is `journalctl -k | grep apparmor` (or `dmesg | grep -i apparmor`) to find an `apparmor="DENIED"`; if you cannot find one, then look at DAC (SELinux's AVC lives in a different log) -- **AppArmor denials do not surface as ordinary file-permission errors; they are kernel-side MAC denials, and the process receives only a vague `EACCES`-style return**. This is structurally identical to the opening scenario of [SELinux in Practice](./selinux.md).

**`aa-status` shows a profile as not loaded.** Three possibilities: the profile file is not in the right place (it must be under `/etc/apparmor.d/`, and the filename must correspond to the program path); `apparmor_parser -r` reported a syntax error and you missed it (rerun and look at stderr); `apparmor.service` is not running or the module is not loaded (`cat /sys/module/apparmor/parameters/enabled` returning `N` means fix the kernel/service layer first).

**A profile is wrong and `apparmor_parser` errors out.** The error gives the filename and line number; the three most common kinds are a missing trailing comma (every rule line must end with `,`); a missing right brace `}` or misplaced nesting (an `#include`d abstraction may also carry braces); a miswritten path wildcard (mixing `**` and `*`, or an unescaped special character in the path). When `apparmor_parser -r` fails, **the old profile is still in effect** -- a mistake will not leave the program naked, so fix by line number and reload.

**After an upgrade or reinstall the profile no longer matches the new path.** A program update changing the install directory, changing the log path, or reading one more new config file will all cause a previously correct profile to start reporting denials. The symptom is "it worked yesterday, it denies today". The handling is to go back to 3.1, read the denial, and add the new path to the local override fragment under `/etc/apparmor.d/local/` -- **change the local fragment, not the distro profile file**, because the next upgrade overwrites the latter.

**You finish debugging and forget to switch back to enforce.** After `aa-complain` the program is effectively unconstrained; if you forget `aa-enforce`, that service on that box sits in a "the rules are decorative" state for the long term. The discipline is identical to SELinux's `setenforce 0`: a switch must be logged in the change ticket (reason, recovery time, owner), and once troubleshooting ends, confirm with `aa-status | grep -A2 complain` that no residue is left in the complain list -- **leftover complain entries are the most direct signal of this class of incident**.

**You forget to reload after `aa-disable`.** Disabling is a runtime state, not a disk change -- the profile file is still there, it just is not in effect. After fixing the file you need `apparmor_parser -r` to reload before it returns to enforce (or write `flags=(enforce)` in the profile so it enforces on load). State and file are two separate ledgers, the same principle as "after changing `semanage fcontext` you need `restorecon`" in SELinux.

## References

- AppArmor project documentation (official wiki, including profile syntax and the tool manuals) -- [gitlab.com/apparmor/apparmor/-/wikis/Documentation](https://gitlab.com/apparmor/apparmor/-/wikis/Documentation)
- Ubuntu Server documentation -- [ubuntu.com/server/docs](https://ubuntu.com/server/docs)
- Arch Wiki: AppArmor -- [wiki.archlinux.org/title/AppArmor](https://wiki.archlinux.org/title/AppArmor)
- AppArmor man pages (`apparmor_parser`, `aa-status`, `aa-complain`, `aa-logprof`, and more) -- [manpages.ubuntu.com](https://manpages.ubuntu.com/)
- `man 5 apparmor.d` (profile syntax), `man 8 apparmor_parser`

<!-- BACKLINKS-AUTO -->
## Related Pages

- [knowledge](/knowledge.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [gap-fill](/research/gap-fill.md)
- [README](README.md)
- [hardening](hardening.md)
