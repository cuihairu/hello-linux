# SELinux Policy Configuration

Only when booleans, port labels, and file labels all fail to cover your needs do you have to face the policy itself. This page explains the positioning of the three policies targeted/minimum/mls, how to persistently configure file contexts, and the correct use of `audit2allow` -- a double-edged sword.

> Content draws on the Red Hat documentation and the Arch Wiki -- see the references at the end.

## What This Page Covers

- Distinguish the positioning and use cases of the targeted, minimum, and mls policies
- Why file contexts are the correct vehicle for making labels stick
- The flow of persisting custom labels with `semanage fcontext` and applying them with `restorecon`
- The double-edged nature of `audit2allow`
- Comparing the three distro families for the availability of the relevant commands and policy packages

## 1. Policy Types: targeted, minimum, mls

The RHEL family uses `SELINUXTYPE=` in `/etc/selinux/config` to select an installed policy package; the three most common have clear, distinct roles:

| Policy | Protected scope | Typical users | Notes |
|------|---------|---------|------|
| **targeted** (default) | Only designated daemons (httpd, named, dhcpd, samba...) run in a confined domain; user processes are largely unrestricted | The vast majority of servers | Trades breadth for usability by "confining only what needs confining"; the distro default |
| **minimum** | A slimmed-down subset of targeted, common in containers and minimal images | Constrained environments | Fewer rules and a smaller attack surface, but also fewer services it can protect |
| **mls** (Multi-Level Security) | The whole system is classified and enforced by security level (confidential/secret...) | Defense contractors / strict compliance scenarios | Extremely complex to operate day to day; never the recommended default |

```bash
# Show the currently loaded policy
$ sestatus | grep 'Loaded policy'
Loaded policy name:             targeted

# List which policy packages are installed on the system
$ ls /etc/selinux/
config  mls  minimum  targeted
```

Day-to-day troubleshooting **almost never** requires switching policy type -- a switch means re-labeling every security context and re-aligning a large body of domain/type rules, which amounts to a security-architecture change and must be planned with downtime. The routine configuration in the next two sections (file contexts, audit2allow) is all built on the current policy (targeted in 99% of cases).

## 2. File Contexts: How the Policy Remembers "What the Label Should Be"

The targeted policy ships default label rules for standard paths (`/var/www/html → httpd_sys_content_t`, `/etc/ssh → sshd_exec_t`, and related). The rules live in the policy database as **regular expressions**, and each `restorecon` run is simply aligning the labels of files on disk with those rules.

Check the policy label currently in effect for a path (not the file's actual label, but what it *should* be):

```bash
$ matchpathcon -V /var/www/html/index.html
/var/www/html/index.html  system_u:object_r:httpd_sys_content_t:s0

# Compare with the actual label (use ls -Z for the actual label)
$ ls -Z /var/www/html/index.html
system_u:object_r:default_t:s0  /var/www/html/index.html   # Mismatch → restorecon is needed
```

A mismatch means the file's label was dirtied by a `chcon`, a copy, a backup restore, or similar operation; one `restorecon` run corrects it:

```bash
$ sudo restorecon -R -v /var/www/html/
```

**The catch is custom paths**: the policy database has no rule for `/data/www`, so `matchpathcon` can only return the fallback (usually `default_t`), and `restorecon` can never stamp `httpd_sys_content_t` onto it -- this is exactly why section 3's `semanage fcontext` exists.

## 3. Persisting Custom Labels: semanage fcontext

`chcon` changes only the inode's current value, and a reboot washes it away under the policy's default rule (or the default when a rule is missing). To make `/data/www` belong to `httpd_sys_content_t` **permanently**, the rule must be written into the policy database:

```bash
# -a adds a rule; target type httpd_sys_content_t; the path supports regex
$ sudo semanage fcontext -a -t httpd_sys_content_t "/data/www(/.*)?"

# Apply the rule to existing files immediately (new files inherit it as long as the parent directory rule is correct)
$ sudo restorecon -R -v /data/www/
$ ls -Z /data/www/app/index.html
system_u:object_r:httpd_sys_content_t:s0  /data/www/app/index.html

# Confirm the rule has been stored in the database
$ semanage fcontext -l | grep '/data/www'
/data/www(/.*)?    all files    system_u:object_r:httpd_sys_content_t:s0
```

Notes on path regular expressions (consistent with the `semanage` documentation):

- `"/data/www(/.*)?"` matches the directory itself and all of its descendants -- **cover the directory and the files inside together**; writing only `"/data/www"` leaves the files within untouched.
- A literal `.` carries regex semantics; when a path contains special characters, escape them according to the rules in `semanage-fcontext(8)`.
- Use `-m` to modify an existing rule and `-d` to delete one:

```bash
$ sudo semanage fcontext -m -t httpd_sys_sys_content_t "/data/www(/.*)?"
$ sudo semanage fcontext -d "/data/www(/.*)?"
```

**The complete persistence flow is always two steps**: `semanage fcontext` (write the policy) → `restorecon` (apply it to disk). Doing only the first step leaves existing files with their old labels; doing only the second leaves nothing to rule by, and any change gets washed out by the next relabel.

Other frequently used `semanage` subcommands (policy-database operations like fcontext):

```bash
semanage port -l                    # port labels (see the commands page)
semanage user -l                    # SELinux user mappings
semanage login -l                   # login users → SELinux users
semanage boolean -l                 # booleans (read-only; change with setsebool -P)
```

A minimal RHEL install needs `policycoreutils-python-utils` to provide `semanage`.

## 4. audit2allow: A Last Resort, Not a First Step

Only when the tools of sections 1-3 (booleans → fcontext/port labels) are all confirmed inapplicable, and the policy genuinely lacks one allow rule the business requires, should you use `audit2allow` to turn denial logs into a policy module:

```bash
# Generate module source from today's AVC denials (review before compiling!)
$ sudo ausearch -m avc -ts today | audit2allow -R -W mypolicy -N mypolicy
# -W writes out the .te source file  -N sets the module name  -R also generates requires

$ cat mypolicy.te        # ← you must manually review whether this allow line is reasonable
module mypolicy 1.0;
require { type httpd_t; type mysqld_port_t; class tcp_socket name_connect; }
allow httpd_t mysqld_port_t:tcp_socket name_connect;

# Compile and install once you are sure (-i installs a local module)
$ sudo checkmodule -M -m -o mypolicy.mod mypolicy.te
$ sudo semodule_package -o mypolicy.pp -m mypolicy.mod
$ sudo semodule -i mypolicy.pp

# Confirm it is loaded
$ sudo semodule -l | grep mypolicy
```

A simpler one-shot form (pipes the result straight into semodule -- **higher risk, so always read the generated content first**):

```bash
$ sudo ausearch -m avc -ts today | audit2allow -a -M adhoc_fix
```

### Why This Is a "Last Resort"

1. **Audit problems**: the only basis for `audit2allow` is "this denial appeared in the log", and it does not understand business intent -- a denial produced by a mistaken operation or by an attacker probing can just as easily be turned into a legitimate allow.
2. **Rules too broad**: the generated `allow` often comes with the full `*` permission set (`{ read write open getattr ... }`), far beyond what the workload actually needs; the correct approach is to trim the permissions to the minimum by hand.
3. **Masking the root cause**: very often the real reason for the denial is a wrong file label (which should be `restorecon`ed) or a missing port label (which should be added with `semanage port`); granting an allow outright is rubber-stamping a broken state with a policy module.
4. **Unmaintainable**: custom modules sit scattered inside the `local` component, can conflict when the distro's policy package is upgraded, and nobody remembers why they exist -- the business context must be written into comments in the module's `.te` file and committed to version control.

**The decision rule**: if a boolean works, use a boolean; if fcontext/port labels work, use labels; only when both fail, and the denial legitimately appears on a business path, generate a module -- and after generating it you must review, trim, comment, and commit.

## 5. Across the Three Families: Availability of This Page's Commands

| Operation | RHEL/CentOS/Rocky | Debian/Ubuntu | Arch |
|------|-------------------|---------------|------|
| Look up a file context rule | `matchpathcon`, `semanage fcontext -l` | SELinux not enabled by default, no equivalent; AppArmor reads profile files | Not enabled by default; once you enable it yourself the same toolset works |
| Persist a custom label | `semanage fcontext` + `restorecon` | Not applicable (edit the profile in `/etc/apparmor.d/`) | Same as RHEL once enabled by hand |
| Manage policy modules | `semodule -i/-l/-r` | Not applicable | Same as RHEL once enabled by hand |
| Booleans | `setsebool -P` / `getsebool -a` | Not applicable (AppArmor has no boolean concept) | Same as above |

The corresponding AppArmor concept on Debian/Ubuntu is the **profile** (path-based rather than type-label-based): adding a rule means editing `/etc/apparmor.d/<profile>` and then running `apparmor_parser -r` or restarting the service; there is no "change the label on a file" step at all. Arch defaults to having neither, so policy configuration is a non-starter -- once again: before touching anything, run `getenforce`/`aa-status`/`cat /sys/kernel/security/lsm` to confirm what you are actually dealing with.

## 6. Common Pitfalls

1. **`restorecon` without `semanage fcontext`**: a custom path has no policy rule, so restorecon cannot stamp the label you want, and the next relabel is guaranteed to revert it -- the order cannot be flipped, and neither step can be skipped.
2. **The fcontext path is missing `(/.*)?`**: only the directory itself is covered, so the files inside keep their old labels and the service is still denied; match the directory and its descendants together.
3. **Running `audit2allow -a` and installing without reading**: this can harden an attacker probe or a label mistake into a permanent allow; always use `-W` to generate the `.te` and review it first.
4. **Using audit2allow to solve what should be a restorecon problem**: when the tcontext in the denial log is `default_t`, nine times out of ten the label is missing -- compare with `matchpathcon` first and fix the label rather than adding an allow.
5. **Leaving custom modules undocumented**: half a year later nobody knows why this allow exists; write the business reason into the `.te` and put the module source in Git.
6. **Treating a `SELINUXTYPE` switch as a routine operation**: targeted↔mls is an architecture-level change requiring a full relabel plus a business retest, not something to flip casually.
7. **Running this page's commands on Debian/Ubuntu/Arch**: the default environments have no SELinux policy stack (or AppArmor), and `semanage`/`semodule`/`matchpathcon` either do not exist or do not take effect -- read section 5 of [Concepts](./concept.md) first to confirm what you are dealing with.

## References

- Red Hat - Using SELinux (Customizing SELinux / Policy sections) -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/using_selinux/index)
- `man semanage-fcontext` -- [man7.org](https://man7.org/linux/man-pages/man8/semanage-fcontext.8.html) (indexed via the semanage man page [man7.org](https://man7.org/linux/man-pages/man8/semanage.8.html))
- `man audit2allow` -- [man7.org](https://man7.org/linux/man-pages/man1/audit2allow.1.html)
- `man semodule` -- [man7.org](https://man7.org/linux/man-pages/man8/semodule.8.html)
- `man matchpathcon`
- Arch Wiki - SELinux (Policy / audit2allow sections) -- [wiki.archlinux.org](https://wiki.archlinux.org/title/SELinux)
- Debian Wiki - SELinux -- [wiki.debian.org](https://wiki.debian.org/SELinux)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/basic/README.md)
- [security](/basic/security.md)
- [commands](commands.md)
- [modes](modes.md)
- [selinux](/security/selinux.md)
