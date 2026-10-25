# Basic SELinux Commands

A service suddenly will not start, the browser returns 503, mail gets rejected -- when you finally trace it to the end, an AVC denial is often the culprit, yet most people's first reaction is `setenforce 0` to switch SELinux off and move on. This page offers a steadier path: first confirm the current mode with `getenforce`/`sestatus`, then read the security contexts of objects and processes with `ls -Z`/`ps -Z`, then use `ausearch`/`ausearch -m avc` to translate the kernel's denial records into plain language, and finally make a **minimal fix** through booleans, port labels, or `restorecon`/`semanage fcontext` -- unblocking the workload without switching MAC off entirely. Every section also contrasts the differences on Debian/Ubuntu (AppArmor) and Arch (no SELinux by default), so you do not force RHEL-documentation commands onto other distros.

> Content draws on the Red Hat documentation and the man page of each command -- see the references at the end.

## What This Page Covers

- Check SELinux status and security contexts fluently (`getenforce`, `ls -Z`, `ps -Z`)
- Use booleans and port labels to allow access with minimal changes, instead of switching SELinux off at the first sign of trouble
- The standard `ausearch` troubleshooting flow: confirm the mode → read the denial → locate the types → minimal fix
- Tell apart when to use `chcon`, `restorecon`, and `semanage fcontext`, and where each one's persistence boundary lies
- Complete the full loop of "service denied → locate the AVC → fix → verify" on your own

## 1. Checking the Status

`getenforce` answers one question only: whether the kernel is currently in Enforcing, Permissive, or Disabled. It reads runtime state, so a change made by `setenforce` is visible immediately. `sestatus` gives a fuller picture: the SELinuxfs mount point, the root directory, the loaded policy name, whether the runtime mode and the config-file mode agree, whether the policy enables MLS, and so on. For everyday troubleshooting one `getenforce` is enough; only when you suspect "I changed the config but it did not take" or "someone temporarily disabled it" do you need the two-line mode comparison inside `sestatus`.

```bash
$ getenforce
Enforcing

$ sestatus
Current mode:                   enforcing
Mode from config file:          enforcing
```

`Current mode` is the runtime mode, `Mode from config file` is the mode after the next reboot, and the two can disagree (a recent `setenforce`, or an edited config without a reboot). On Debian/Ubuntu, which defaults to AppArmor, these two commands printing `Disabled`/command not found is normal -- use `aa-status` instead. On Arch, where SELinux is off by default, first confirm whether `/sys/fs/selinux` is mounted.

## 2. Security Contexts

Every file and every process carries a security context of the form `user:role:type:level`, and when the kernel makes a MAC decision it looks only at the `type` field. `ls -Z` shows a file's type, `ps -Z` a process's type -- processes in the httpd domain may only touch files of the `httpd_sys_content_t` kind; this is the root of "label mismatch means denied".

```bash
$ ls -Z /var/www/html/index.html
system_u:object_r:httpd_sys_content_t:s0  /var/www/html/index.html

$ ps -eZ | grep nginx
system_u:system_r:httpd_t:s0   1523 ?  nginx: master process
```

There are two ways to change a label. `chcon` writes the specified type directly, **without consulting policy** -- a reboot or the next `restorecon` snaps it back, so it suits only temporary verification. `restorecon` restores the "factory label" per the default rules in the policy files and is the standard move for correcting label drift day to day. To **add** a permanent path→type rule, you must first write it into the policy database with `semanage fcontext`; only then can `restorecon` restore files to the new value (see section 6 and [Policy Configuration](./policy_configuration.md)).

```bash
$ sudo restorecon -R /var/www/html/
$ sudo restorecon -R -n -v /data/www/    # -n previews without changing, -v shows what would change
```

## 3. Booleans

Booleans are switches the policy reserves for turning a whole class of permissions on or off without touching policy code. They are **the highest-priority fix while troubleshooting** -- precise, reversible, and documented: the targeted policy ships a large set of switches for common services, and most "legitimate but blocked" scenarios already have a ready-made boolean. A quick search with `getsebool -a | grep <keyword>` often lands a hit.

```bash
$ getsebool -a | grep httpd
httpd_can_network_connect --> off
httpd_enable_cgi --> on

$ sudo setsebool -P httpd_can_network_connect on   # -P writes to disk and survives reboot
$ getsebool httpd_can_network_connect
httpd_can_network_connect --> on
```

Without `-P` the change applies only to the current runtime and is lost on reboot -- the number-one cause of "the fault was fixed and then came back". Quick reference for common scenarios:

| Workload need | Boolean |
|---------|--------|
| httpd/nginx reverse-proxying to a backend port | `httpd_can_network_connect` |
| PHP/CGI connecting to a database | `httpd_can_network_connect_db` |
| httpd writing to user upload directories | `httpd_enable_homedirs` (depends on the policy version; fcontext is used more often) |
| Allowing sshd to use PAM home directories | `ssh_use_pam` |

## 4. Port Labels

The ports a process listens on carry labels too; when the label does not match the process type, the bind is refused (classic case: nginx switched to listen on 8080 and gets refused). `semanage port -l` lists every port label and the port numbers it covers; if your workload's port is not in the list, add a mapping with `-a` (use `-m` to modify an existing one), and delete a custom entry you no longer need with `-d`.

```bash
$ sudo semanage port -l | grep http_port_t
http_port_t      tcp      80, 81, 443, 8008, 8443, 9000

$ sudo semanage port -a -t http_port_t -p tcp 8080
$ sudo semanage port -d -t http_port_t -p tcp 8080
```

`semanage` ships in `policycoreutils-python-utils` (the RHEL-family package name; it may differ slightly across versions), and a minimal-install server may need it added first. Default Arch/Debian environments usually lack the command, which confirms the point made in the earlier sections: **confirm the distro and that SELinux is actually enabled before running this page's commands**.

## 5. Log Analysis: The Standard ausearch Flow

AVC denials are recorded in `/var/log/audit/audit.log` (RHEL family); query them with `ausearch` rather than a raw grep: `-m avc` filters by record type, `-ts` bounds the time window (`recent` is roughly the last ten minutes; there are also `today`, `now`, or an explicit date/time), and `-i` translates the raw fields into readable text. Filtering by process (`-x`), user (`-ui`), or file (`-f`) narrows the scope down to a single incident.

```bash
$ sudo ausearch -m avc -ts recent -i
type=AVC msg=audit(...) : avc:  denied  { name_connect }
  for pid=1024 comm="nginx" dest=3306
  scontext=system_u:system_r:httpd_t:s0
  tcontext=system_u:object_r:mysqld_port_t:s0

$ sudo ausearch -m avc -x nginx -i
$ sudo ausearch -m avc -ts today | audit2why -a
```

Read the first output above and you have the three core elements of troubleshooting: `scontext` is who was denied (nginx in the httpd domain), `tcontext` is what it tried to touch (the label on MySQL's port 3306), and `denied { name_connect }` is the action it attempted. `audit2why -a` translates raw AVCs into plain language ("this access is blocked by a dontaudit rule in the policy", "an allow rule is missing", and so on) and is the key helper for deciding "flip a boolean or add a label".

`sealert` (provided by `policycoreutils`) is a friendlier front end: it aggregates the whole audit log, groups similar denials, and offers suggestions (sometimes naming the exact boolean to flip). When troubleshooting, run `sealert -a /var/log/audit/audit.log` first for the summary, then pull individual details with `ausearch`.

### The Standard Troubleshooting Flow (follow the order strictly)

1. **Confirm the mode**: `getenforce`/`sestatus`. Disabled, or SELinux not enabled at all → change your hypothesis and do not burn time here; Permissive → the log only records and nothing is blocked, so the workload failure has another cause; Enforcing plus a failing workload → go to step 2.
2. **Capture the denial evidence**: `sudo ausearch -m avc -ts recent -i`; note down `scontext` (who), `tcontext` (the target), and `tclass`+`denied` (the action).
3. **Classify the fix** (in priority order; stop at the first hit):
   - An off-the-shelf boolean? `getsebool -a | grep <keyword>` → on a hit, `sudo setsebool -P <name> on`;
   - A wrong file label? Compare a working file and the failing one with `ls -Z` → `chcon -t <type> <file>` as a temporary fix, or `semanage fcontext -a ...` followed by `restorecon -R ...` for a persistent one;
   - A wrong port label? `semanage port -l | grep <type>` → `semanage port -a -t <type> -p tcp <port>`;
   - None of the above, and the policy truly lacks the rule → only then consider `audit2allow` from [Policy Configuration](./policy_configuration.md).
4. **Verify**: if you temporarily switched anything off, first `setenforce 1`, then reproduce the workload operation; a final `ausearch` should show no new denials.

**The usual wrong order**: jumping straight to `setenforce 0` or `audit2allow`. The former masks the problem and expires on reboot; the latter can introduce over-broad rules. The right approach is always: **read the logs first, then make the minimal change in the priority order boolean → label → port → policy**.

## 6. chcon vs restorecon vs semanage fcontext

All three commands change labels, but their semantics differ completely; mixing them up is the most frequent mistake:

| Command | What it changes | Persistence | Typical use |
|------|---------|--------|---------|
| `chcon` | Writes the type you specify, **policy not consulted** | Overwritten by a reboot/restorecon | Temporarily testing "does fixing the label restore the service" |
| `restorecon` | **Restores** per the default rules in the policy files | What it restores is the policy value | Correcting labels messed up by chcon/copies |
| `semanage fcontext -a` | **Adds** a path→type rule to the policy database | Only then can restorecon restore to this new value | Defining a permanent label for a custom path such as `/data/www` |

The classic faceplant: you run `chcon -t httpd_sys_content_t` on a new site under `/data/www` and it works on the spot; two days later a `restorecon -R /data/www/` knocks the label back to `default_t`, because the policy never defined this path at all. The correct persistent form writes the rule into the policy database first and then lets `restorecon` align:

```bash
$ sudo chcon -t httpd_sys_content_t /data/www/app/index.html   # covers this one time only
$ sudo semanage fcontext -a -t httpd_sys_content_t "/data/www(/.*)?"
$ sudo restorecon -R /data/www/                                # from now on every restore lands on it
```

One-line memory aid: **`chcon` changes "this once", `semanage fcontext` changes "every time", and `restorecon` aligns the current state back to the policy**. See [Policy Configuration](./policy_configuration.md).

## 7. Common Pitfalls

1. **Paging through audit.log with `grep`**: the format is verbose and carries no explanation -- use `ausearch -i` or `sealert`; `audit.log` can be huge, so always add a `-ts` time window.
2. **Forgetting `-P` on `setsebool`**: without `-P` the switch is lost on reboot, and the fault "comes back after being fixed".
3. **`semanage` command not found**: minimal RHEL installs lack `policycoreutils-python-utils` -- install it first; default Debian/Arch environments never had it -- first confirm SELinux is actually in use.
4. **After `chcon`, the label "reverts" on reboot**: see section 6 -- this is expected behavior; switch to `semanage fcontext` + `restorecon`.
5. **Verifying a fix under Permissive**: Permissive blocks nothing, so you cannot tell whether the fix worked; in the verification phase always `setenforce 1` before reproducing the workload.
6. **Looking for AppArmor denials and finding no logs**: on Ubuntu/Debian the denials sit in the apparmor entries of kern.log/journal; `ausearch -m avc` is guaranteed empty.
7. **The `-ts recent` window is the last 10 minutes**: for older denials use `-ts today` or an explicit time range, or "nothing found" just means the window is too narrow.
8. **Changing policy before checking DAC**: before any MAC troubleshooting, run `ls -l` to confirm the Unix permissions -- when DAC fails, SELinux is never even consulted, and policy changes are meaningless.

## References

- Red Hat - Using SELinux (commands and troubleshooting sections) -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/using_selinux/index)
- `man semanage` -- [man7.org](https://man7.org/linux/man-pages/man8/semanage.8.html)
- `man restorecon` -- [man7.org](https://man7.org/linux/man-pages/man8/restorecon.8.html)
- `man setsebool` -- [man7.org](https://man7.org/linux/man-pages/man8/setsebool.8.html)
- `man getsebool` -- [man7.org](https://man7.org/linux/man-pages/man8/getsebool.8.html)
- `man ausearch` -- [man7.org](https://man7.org/linux/man-pages/man8/ausearch.8.html)
- `man chcon` -- [man7.org](https://man7.org/linux/man-pages/man1/chcon.1.html)
- `man sestatus`
- Arch Wiki - SELinux -- [wiki.archlinux.org](https://wiki.archlinux.org/title/SELinux)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/basic/README.md)
- [security](/basic/security.md)
- [concept](concept.md)
- [selinux](/security/selinux.md)
