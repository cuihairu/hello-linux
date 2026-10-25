# SELinux in Practice

httpd is deployed on a Rocky box: the firewall lets traffic through, `chmod` is dialed in, and `curl` from localhost works fine -- but move the docroot to `/srv/www` and you instantly get a 403. A Samba share reads and writes fine locally, but the moment a Windows client connects it gets "access denied" -- both scenes point at the same suspect: SELinux. It adds a layer of type enforcement (MAC) on top of traditional permissions (DAC); when it blocks you, it reports no permission error and does not touch the process state, it just leaves one AVC denial in the audit log, and the client side sees nothing but a vague denial message. The basics already cover what it is ([SELinux Concepts](../basic/security/concept.md), [Modes](../basic/security/modes.md), [Commands](../basic/security/commands.md), [Policy Configuration](../basic/security/policy_configuration.md)); this page is the server-side practice guide: the diagnosis-and-fix methodology for when it blocks you on a RHEL/Rocky production box, threaded through three real cases -- httpd, Samba, NFS. Read this page and `setenforce 0` disappears from your troubleshooting checklist.

> Content draws on the SELinux Project Notebook and the official Red Hat documentation (conceptual framing follows Bird's Private Recipes (Lin's Linux Administration Guide)) -- see the references at the end.

## What This Page Covers

- Break "the service does not work" into the DAC and MAC layers, and pin it down with AVC evidence instead of guesses
- Read the `scontext` / `tcontext` / `tclass` triple out of `ausearch` and derive the right fix directly
- Know the priority of the three-tier fix: change the label > open the port > flip the boolean, with a custom module only as the last step
- Use the persistent combo of `semanage fcontext` + `restorecon` fluently, and tell its lifecycle apart from `chcon`
- Know where `audit2allow` applies and how to manage a local module's lifecycle

## 1. From "Turning It Off" to "Reading It"

### 1.1 Why enforcing Is the Default, Not a Nuisance

The RHEL family defaults to `enforcing`, which first-timers often read as "the distro is deliberately making trouble". The truth is the opposite: once a confined service is taken over (RCE, XXE, deserialization), SELinux compresses the attacker's radius of action back to what that service was supposed to have in the first place -- httpd, even when a webshell has it, cannot read `/etc/shadow` or connect out to arbitrary ports; that narrowing is day-to-day attack-surface management. Turning it off raises the cost of a "breakthrough" from "service level" to "host level", so on production `setenforce 0` has only one legitimate use: **one step in elimination** -- use it to confirm the problem really sits on the MAC layer, then switch straight back. Leaving it on the change ticket as a "fix" is the bad habit this page exists to kill.

Permissive is the correct working mode: the policy is evaluated as usual, alerts are recorded as usual, the only difference is it does not block. During diagnosis, switch the box to permissive temporarily (`setenforce 0`), let the blocked operations all go through and accumulate the complete AVC queue, then switch back to enforcing and check whether the count clears to zero -- that is "reading" it, not "turning it off". The semantics of the modes and each family's default are fully laid out in [Modes](../basic/security/modes.md); not repeated here.

### 1.2 This Page's Method: The Four-Level Fix Priority

Diagnosis starts from evidence; fixes are ranked by "smallest to largest change radius". The four levels fix different things, and mixing them leaves policy debt that grows wider the more you patch:

| Level | Mechanism | What it fixes | Lifecycle |
|------|------|-----------|---------|
| 1 | `semanage fcontext` + `restorecon` | the label a file "should carry" | persistent (policy store) |
| 2 | `semanage port` | which services a port "may bind to" | persistent (policy store) |
| 3 | `setsebool -P` | a capability disabled for a domain | persistent (policy store) |
| 4 | `audit2allow` custom module | a new allow absent from the existing rules | persistent, and the **widest** |
| anti-example | `setenforce 0` / disable policy | the whole defense layer | half-persistent (reverts on reboot, but nobody remembers to change it back) |

If level 1 can fix it, never reach for level 2; if a boolean works, never escalate to level 4 -- this ordering is least privilege itself. Every case below (sections 3-5) walks the full loop: "symptom -> AVC evidence -> pick a level and fix -> verify".

## 2. The Starting Point of Diagnosis: AVC Denials

### 2.1 `ausearch`: Reading a Denial as a Triple

Everything starts from the audit log. Capture evidence the moment a service is denied:

```bash
$ sudo ausearch -m avc -ts recent
----
time->Thu Oct  2 21:14:37 2026
type=AVC msg=audit(1759415677.124:4256): avc:  denied  { read } for  pid=812 comm="httpd" \
  name="index.html" dev="dm-0" ino=5242931 \
  scontext=system_u:system_r:httpd_t:s0 \
  tcontext=unconfined_u:object_r:var_t:s0 \
  tclass=file permissive=0
```

Read it field by field: `denied { read }` is the **set of denied actions** (you can see `{ read open }` at once); `comm="httpd"` is the initiating process; the leads are the three fields after it -- **scontext** (subject: who is acting; here `httpd_t` is httpd's domain), **tcontext** (object: what it acts on; `var_t` means "an ordinary variable file not labeled for any service"), **tclass** (object class: file, port, capability, socket...); `permissive=0` says this one was really blocked (under permissive it is 1: logged, not blocked).

Read the triple and the conclusion is already out: "the httpd domain wants to read a file labeled `var_t`" -- the policy has no such allow, because `/var/www/html` is stamped `httpd_sys_content_t`, while your freshly created `/srv/www` is still bare `var_t`. **The fix is not to allow `var_t`; it is to stamp the directory `httpd_sys_content_t`**: allowing the action would take every `var_t` file along with it (half the system sits under that label), while fixing the label pulls exactly this one directory into the permissions httpd was always meant to have. This "fix the object or fix the rule" judgment runs through the whole page.

The `recent` in `ausearch -m avc -ts recent` can be swapped for other windows (`-ts today`, `-ts yesterday`); with `-ts boot` you see every denial since this boot. Once setroubleshoot is installed (`dnf install setroubleshoot-server`), the same event gets a human-readable copy:

```bash
$ journalctl -t setroubleshoot --since "21:10" | head -3
... SELinux is preventing httpd from read access on the file index.html.
... For complete SELinux failure messages run: sealert -l <uuid>
```

`sealert -l <uuid>` offers further suggestions -- treat its output as a reference; the final judgment still rests on the triple. To reverse-look up "which policy rule actually governs this", use `sesearch` from the setools suite:

```bash
$ sesearch --allow -s httpd_t -t var_t -c file
# No output = the policy truly has no allow for httpd_t to read var_t
$ sesearch --allow -s httpd_t -t httpd_sys_content_t -c file | head -3
allow httpd_t httpd_sys_content_t:file { read open getattr ... };
```

The contrast between "found" and "not found" is the hardest evidence that the label is wrong.

## 3. Case 1: httpd Directories, Ports, and Reverse Proxy

### 3.1 Symptoms and Evidence: A Custom Directory Returns 403

The site's document root moved from the default `/var/www/html` to `/srv/www`, permissions are a full `755`, the owner is `apache`, and `curl` still returns 403. Look at the scene through the label lens first -- `ls -Zd` prints the context directly:

```bash
$ ls -Zd /var/www/html /srv/www
unconfined_u:object_r:httpd_sys_content_t:s0 /var/www/html
unconfined_u:object_r:var_t:s0               /srv/www
```

The label difference is obvious at a glance. Pair it with one AVC to corroborate (tcontext is `var_t`), and the diagnosis is complete.

### 3.2 The Fix: The Two-Step Persistent Labeling Combo

`semanage fcontext` writes "path pattern -> type" into the policy store, and `restorecon` realigns existing files' labels against that ledger -- neither step can be skipped:

```bash
$ sudo semanage fcontext -a -t httpd_sys_content_t "/srv/www(/.*)?"
$ sudo restorecon -Rv /srv/www
Relabeled /srv/www from unconfined_u:object_r:var_t:s0 to unconfined_u:object_r:httpd_sys_content_t:s0
Relabeled /srv/www/index.html from unconfined_u:object_r:var_t:s0 to unconfined_u:object_r:httpd_sys_content_t:s0
$ sudo systemctl restart httpd && curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/
200
```

Note that `-a` appends a rule; if the directory's path has changed since, delete the old rule with `-d` first; the regex `(/.*)?` covers the directory itself and all of its descendants. The control case is `chcon -t httpd_sys_content_t -R /srv/www` -- it only changes the current inode's label, **it never enters the policy store**, and the next `restorecon` or filesystem relabel washes it back to square one. The division of labor in one sentence: `semanage fcontext` makes the rule, `restorecon` executes it, `chcon` is only a temporary doodle. This is exactly the ledger semantics section 3 of [Policy Configuration](../basic/security/policy_configuration.md) walked through; what this page stresses is where it sits in a real outage -- it is level one of the four-level fix.

### 3.3 The Same Case, Second Scene: Non-Standard Port 8181

The docroot works now; change the listening port from 80 to 8181 and the service will not start:

```bash
$ sudo systemctl status httpd --no-pager | head -5
Oct 02 21:22:11 rocky httpd[1044]: (13)Permission denied: AH00072: make_sock:
  could not bind to address [::]:8181
...
$ sudo ausearch -m avc -ts recent | grep tclass
type=AVC ... avc:  denied  { name_bind } for ... tclass=port
```

Not `chmod`, not port contention -- it is a `{ name_bind }` denial against `tclass=port`: binding this port itself requires type authorization. Check the existing allowlist first, then register the new port:

```bash
$ semanage port -l | grep http_port_t
http_port_t    tcp   80, 81, 443, 488, 8008, 8009, 8443, 9000
$ sudo semanage port -a -t http_port_t -p tcp 8181
$ sudo systemctl restart httpd && systemctl is-active httpd
active
```

Port registration only solves "SELinux allows the bind"; the firewall rule is a separate, independent track -- `firewall-cmd --add-port=8181/tcp` belongs to [the Firewall page](./firewall.md); the two layers are independent and both must pass -- that "each layer only handles its own half" structure recurs throughout this page.

### 3.4 Half a Step More: Reverse Proxy Outbound Connections

httpd acts as a reverse proxy and sends requests to a backend on `8080`; the page returns 502, and `{ name_connect }` shows up in the AVC:

```bash
$ sudo setsebool -P httpd_can_network_connect on
$ sudo setsebool -a | grep httpd_can_network_connect
httpd_can_network_connect --> on
```

`-P` makes the setting persist -- missing `-P` is the highest-frequency cause of "it broke again after reboot". With this, all three fix levels have been exercised: label (3.2), port (3.3), boolean (3.4), and `setenforce` was never touched once. Look back at the priority table in 1.2: the three cases land on levels 1, 2, and 3 respectively -- each level fixes only "a capability this service was supposed to have", and the overall tightness of the policy has not loosened by a single iota.

## 4. Case 2: Samba Share Directories

The complete Samba deployment (`smb.conf`, users, share definitions) lives in [Server: Samba](../server/samba.md), whose section 5 already gives the label fix; this page adds the diagnosis path and the semantic boundary. The typical scene: `smbclient -L` lists the share, but stepping into it yields `NT_STATUS_ACCESS_DENIED`, while the same path works perfectly with a local `cat` -- **local works, SMB denies**. That asymmetry is itself the signal: if DAC were blocking you, local would be blocked too; local working means DAC is green and only the MAC layer remains.

```bash
$ sudo ausearch -m avc -ts recent | grep -E "comm|scontext" | head -2
type=AVC ... comm="smbd" ... scontext=system_u:system_r:smbd_t:s0 \
  tcontext=unconfined_u:object_r:var_t:s0 tclass=dir
$ ls -Zd /srv/samba/data
unconfined_u:object_r:var_t:s0 /srv/samba/data
```

The smbd domain's `search` on a `var_t` directory was denied -- structurally identical to the httpd case, and so is the fix (level 1):

```bash
$ sudo semanage fcontext -a -t samba_share_t "/srv/samba(/.*)?"
$ sudo restorecon -Rv /srv/samba
```

The semantic boundary must be clear: once `samba_share_t` is stamped, access to that directory is **handed over wholesale** to Samba's policy -- smbd can read and write it, but the system's other confined domains (httpd, sshd) cannot get to it by default. That is exactly what labels mean: drawing the boundary of "whose territory this is". Shared home directories have a separate switch; `[homes]` only takes effect with `setsebool -P samba_enable_home_dirs on`. The division between labels and booleans is "territory ownership" versus "extra capability" -- use a label for the former and a boolean for the latter; do not use a boolean as territory (a boolean has no isolation; once it is on, it is on for every domain).

## 5. Case 3: NFS Exports and the Boolean Matrix

NFS's SELinux surface sits closer to "capability switches" than to file labels. The [NFS](../server/nfs.md) page in the server section mentioned this boolean pair: read-only exports are allowed by default, read-write exports are tightened --

```bash
$ getsebool -a | grep nfs_export
nfs_export_all_ro --> on
nfs_export_all_rw --> off
```

Scenario judgment: `/etc/exports` grants `rw` to `192.168.56.0/24`, the client mounts, yet gets `Read-only file system` -- a local `mount` looks normal and `exports` is correct, so the crux is `nfs_export_all_rw` being off. Flip it on and it works (`setsebool -P nfs_export_all_rw on`). When to turn it on: when this box is dedicated to read-write exports anyway. When not to: when only individual directories need read-write -- a boolean is a whole-system switch with no "just this export" granularity; the correct answer here is actually to return to the export configuration itself (a directory without `rw` in exports should never be treated as read-write in the first place), and the boolean only answers "does this nfsd hold the qualification to serve read-write exports at all".

One line to close the RPC side: the port types of the nfsd and rpc.* daemons (`nfs_port_t`, etc.) are allowed by the policy by default, and `firewall-cmd --add-service=nfs` opening 2049 is the firewall's job; the two-layer division is the same as in 3.3. The NFS page's troubleshooting section already gave the sequence `exportfs -v` -> `showmount` -> actual write test; when MAC misbehaves, just insert a `getsebool nfs_export*` check one step before "the actual write test".

## 6. The Last Mile of Policy Localization: `audit2allow`

Only when all three levels have been tried and the AVC is still new (the subject-object combination has no rule in the policy at all) does a custom module come into play. The closed loop in four steps:

```bash
$ sudo ausearch -m avc -ts today | sudo audit2allow -M myhttpd
******************** IMPORTANT ***********************
To make this policy package active, type:
# semodule -i myhttpd.pp
$ cat myhttpd.te
module myhttpd 1.0;
require {
        type httpd_t;
        type var_t;
        class file read;
}
#============= httpd_t ==============
allow httpd_t var_t:file read;
$ sudo semodule -i myhttpd.pp
$ semodule -l | grep myhttpd
myhttpd    1.0
```

**Do not skip the `cat myhttpd.te` step** -- it is exactly what you are actually allowing. A counter-example: a `.te` generated during one troubleshooting run contained `allow httpd_t var_t:file *;` (what `audit2allow` saw was the union of all of today's AVCs, often wider than your instinct suggests); installing it amounts to handing httpd read access to half the system. A generated module is two files: `.te` is the readable source, `.pp` is the compiled artifact, and **the `.te` belongs in version control** (it is the only auditable text of this allow). When you move machines or versions, recompile with `checkmodule -M -m -o` or reuse the `.pp` directly (within the same policy version).

The usage boundary matches the conclusion of section 4 in [Policy Configuration](../basic/security/policy_configuration.md); this page adds one field criterion: **first ask "is the label right?", then ask "should a boolean be flipped?", and only last ask "do I need a new rule?"** -- an inverted order (jumping straight to `audit2allow`) usually produces "an allow for the wrong label"; the symptom is that it works for the moment, and three months later the same kind of outage comes back through a different directory. Module lifecycle management:

```bash
$ semodule -l                # installed modules (-l is alphabetical; -l --latest-version shows versions)
$ sudo semodule -r myhttpd   # remove
```

## 7. The Management Plane for Modes and Policy

### 7.1 Runtime and Persistence Are Two Separate Ledgers

`setenforce 0/1` changes only the current runtime state; after reboot the mode returns to the `SELINUX=` value in `/etc/selinux/config` -- switch to permissive while troubleshooting, forget to change it back, and a machine that "mysteriously got better" after reboot has simply returned to enforcing while the problem is still there. In that situation, one line on the change ticket -- "temporary permissive, recovery time" -- is worth more than any trick:

```bash
$ cat /etc/selinux/config
SELINUX=enforcing        # enforcing / permissive / disabled (three states)
SELINUXTYPE=targeted     # targeted is the default; minimum and mls are the other two tiers (see Policy Configuration)
$ getenforce
Enforcing
$ sestatus
SELinux status:                 enabled
SELinuxfs mount:                /sys/fs/selinux
SELinux root directory:         /etc/selinux
Loaded policy name:             targeted
Current mode:                   enforcing
Mode from config file:          enforcing
```

The difference between `disabled` and the other two is one of magnitude: it does not load the policy subsystem at all (`/sys/fs/selinux` is not even mounted), and switching back from disabled to enforcing requires a full-disk relabel -- **do not pick disabled "to keep things simple"**, that bypasses the whole of this chapter rather than solving it. The mls tier in one sentence: multi-level security labels (classification + level); only military/government scenarios need it, and the default targeted policy does not involve it.

### 7.2 Three Triggers for Relabeling and the Ledger Semantics

The policy store changed, or the filesystem was created elsewhere (image cloning, an external copy-in) -- labels must then be re-stamped system-wide against the ledger:

```bash
$ sudo touch /.autorelabel && sudo reboot      # full-disk relabel at reboot (most common)
$ sudo fixfiles onboot                        # register a relabel at boot (alternative)
$ grep context= /etc/fstab                    # label a single mount on demand (skips the full relabel)
UUID=... /srv  ext4  defaults,context="system_u:object_r:var_t:s0"  0 2
```

The `context=` mount option suits the "this whole partition is a data disk" scenario; once it is written in, you are done running `restorecon` every time. The ledger semantics collapse into this page's single most important discipline: **fcontext rules are the persistent ledger of "path regex -> type", `restorecon` executes against the ledger, and `chcon` only changes the present** -- so the correct shape of any label fix is always `semanage fcontext -a` first and `restorecon` after (the two-step combo in section 3.2 is its template); reverse the order and the second step has nothing to do. The container counterpart is the volume-mount flags `:z` (shared relabel) and `:Z` (private relabel): `podman run -v /srv/www:/var/www/html:Z ...` lets the engine perform the `restorecon`-equivalent action automatically -- forget it, and a volume mounted from the host will surface inside the container as AVC denials, with symptoms identical to 3.1.

## 8. Common Pitfalls

**You ran `setenforce 0` and forgot to change it back.** A temporary bypass becomes permanent naked exposure, and the next outage gets tangled up with this one. The discipline: every switch must come with a change-ticket entry ("reason / recovery time / owner"), and once troubleshooting is done, read it back with `getenforce` to confirm. The steadier practice is to use the permissive mode setting in the config (`/etc/selinux/config`) for the diagnosis window rather than a runtime `setenforce` -- the reboot-reverts property ends up protecting you.

**You changed a label with `chcon`, and after reboot it is 403 again.** Relabeling re-stamps temporary labels against the ledger, so the doodle is naturally overwritten. If `ls -Z` shows a label "changing back on its own", first check `semanage fcontext -l | grep <that path>` -- the ledger has no entry for what you want; add it, then `restorecon`. That is the two-step combo from 3.2, and not one step of it can be skipped.

**A module generated by `audit2allow` is too broad.** Installed without reading the `.te`, and historical AVCs fed in along with it (no `-d` to cherry-pick a single denial), the allow is often a `*`-level union. The fix: take only the denial at hand (the single entry from `ausearch -m avc -ts recent`), read the generated `.te` line by line, and remember that every type appearing in the `require` block is a door you are opening alongside -- an unexpected type means stop.

**Logs explode under permissive.** Permissive means "log everything you would have blocked"; a busy service's AVCs pour into the audit log at hundreds per second, which can both fill up `/var/log/audit` and drown the real evidence. Keep the diagnosis window short, sample with a narrow `ausearch -ts` window, and switch back the moment you are done; before using permissive for long-term learning, confirm audit rotation is running ([Logging](../system-management/logging.md)).

**A mounted volume cannot be read inside the container.** A host directory lands in the container and the service reports a permission error, while testing the same path locally is fine -- structurally identical to the Samba case's "local works, protocol denies". The fix is in 7.2: add `:Z`/`:z` at mount time; for an existing volume, run `restorecon -R` from the host side. The K8s/OpenShift counterpart is SCC and volume relabel flows, each on its own track -- not expanded here.

**SELinux denied it, but there is no AVC in the log.** Three possibilities, checked in order: the `ausearch` time window is too narrow (switch to `-ts boot`); `auditd` is not running (`systemctl status auditd` -- permissive/`semanage` operations themselves do not depend on it, but forensics do); rate limiting ate them (`dmesg | grep -i audit` for kernel-side overflow warnings, `/proc/sys/kernel/printk_ratelimit` or the audit backlog parameters). Do not touch the policy before the diagnosis is confirmed -- when evidence is missing, whatever policy you change is a guess.

## References

- SELinux Project Notebook -- [github.com/SELinuxProject/selinux-notebook](https://github.com/SELinuxProject/selinux-notebook)
- Red Hat official documentation (including the SELinux guide and per-service applicability manuals) -- [docs.redhat.com](https://docs.redhat.com/)
- `semanage-fcontext` man page -- man 8 semanage-fcontext
- `audit2allow` man page -- man 1 audit2allow
- Service-domain help page family (`httpd_selinux`, `smbd_selinux`, etc.; available on the RHEL family once the policy is installed) -- `man 8 httpd_selinux`
- Arch Wiki: SELinux -- [wiki.archlinux.org/title/SELinux](https://wiki.archlinux.org/title/SELinux)
- Bird's Private Recipes (Lin's Linux Administration Guide) -- [linux.vbird.org](https://linux.vbird.org/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [glossary](/glossary.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [README](README.md)
- [apparmor](apparmor.md)
- [hardening](hardening.md)
