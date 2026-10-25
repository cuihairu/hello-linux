# SELinux Modes

SELinux has three operating modes, and which one you pick directly determines both the system's security strength and how you troubleshoot it. This page makes the behavioral differences between the three modes clear, covers the defaults for each distro family, and spells out the boundaries you are most likely to trip over when switching modes.

> Content draws on the Red Hat documentation -- see the references at the end.

## What This Page Covers

- Distinguish the behavioral differences and side effects of Enforcing, Permissive, and Disabled
- Know each family's default mode and explain why you cannot simply "set it to Disabled and be done"
- Use `getenforce`/`setenforce` to check and switch temporarily, and understand the limits of a temporary switch
- Permanent configuration in `/etc/selinux/config` and the precedence of boot parameters
- Pick the right mode for each troubleshooting stage: Permissive first to gather evidence, then Enforcing to verify

## 1. The Three Modes: Behavior and Consequences

| Mode | Behavior | AVC denial logs | When to use | Main risk |
|------|------|-------------|---------|---------|
| **Enforcing** | Enforces the policy; violating access is really denied | Written | Production (the RHEL family default) | A policy gap can block legitimate workloads |
| **Permissive** | Only logs, does not deny; access is actually allowed | Written | Policy debugging, the observation window before going live | Assuming "no errors means no policy problem" and going live while still broken |
| **Disabled** | No policy loaded; SELinux does not take part in decisions at all | None (module not loaded) | Not recommended | Labels stop being maintained; re-enabling requires a full-disk relabel |

Three things to internalize:

**The difference between Enforcing and Permissive lies only in "whether the denial is enforced"**. Both write AVC logs -- so collecting a denial list in Permissive is safe (the workloads are unaffected), but the denials you collect do not heal themselves; the workloads may look fine while the policy still has gaps, so after the observation ends you must fix each one before switching back to Enforcing.

**Disabled is not "a looser Permissive", it is a different world**. In Disabled the kernel does not load the policy and new labels for processes and files are no longer maintained; when you switch back from Disabled to Enforcing/Permissive, many files still carry the old labels from the last time it was on, or have no label at all. **You must run a full-disk relabel at reboot (`/.autorelabel`, or automatic relabeling during boot)**, otherwise the system may fail to boot or throw widespread service failures because critical files have wrong labels. This is exactly why "use Permissive for temporary debugging, never Disabled".

**The mode check happens on every access**, so `setenforce` takes effect immediately for subsequent accesses with no reboot (except for switches between Disabled and Enforcing).

## 2. Defaults Across the Three Families

| Distro | Default MAC | Default mode | Notes |
|--------|---------|---------|------|
| RHEL/CentOS/Rocky/Fedora | SELinux | **Enforcing** | Enforced out of the box, targeted policy |
| Debian/Ubuntu | AppArmor | enforce (AppArmor semantics) | SELinux is not installed/enabled by default; `getenforce` often reports `Disabled` or the command does not exist |
| Arch | No default MAC | SELinux not enabled by default | Mode selection only matters after you install the toolchain and policy yourself |

```bash
# RHEL/CentOS/Rocky: what you should see out of the box
$ getenforce
Enforcing

$ sestatus
SELinux status:                 enabled
SELinuxfs mount:                /sys/fs/selinux
SELinux root directory:         /etc/selinux
Loaded policy name:             targeted
Current mode:                   enforcing
Mode from config file:          enforcing
Policy MLS status:              enabled
Policy deny_unknown status:     allowed
Max kernel policy version:      33
```

Typical output on Debian/Ubuntu (an AppArmor system, SELinux not enabled):

```bash
$ getenforce
Disabled
# Or
-bash: getenforce: command not found

# What you should really look at on Ubuntu/Debian
$ sudo aa-status | head -5
apparmor module is loaded.
34 profiles are loaded.
14 profiles are in enforce mode.
```

**Do not** think "SELinux was turned off" just because `getenforce` returns `Disabled` on Ubuntu -- it was never installed in the first place. The two systems have different entry points; confirm the distro first, then choose the command (see section 5 of [Concepts](./concept.md)).

## 3. Checking the Status

```bash
getenforce      # prints only Enforcing / Permissive / Disabled (lightweight, good for scripts)
sestatus        # full status: enabled or not, current mode, config-file mode, loaded policy, MLS, and so on
```

Note that the two mode fields in `sestatus` can disagree:

- `Current mode`: the **runtime** mode right now.
- `Mode from config file`: the mode that will be used **after the next reboot**.

When troubleshooting "I clearly ran setenforce, so why did it change after reboot", first figure out which of the two you actually changed.

## 4. Temporary Switching: The Limits of setenforce

`setenforce` changes only the runtime mode. **It does not write the config file, and after reboot the mode reverts to what the config file specifies**:

```bash
sudo setenforce 0    # → switch the runtime to Permissive
sudo setenforce 1    # → switch the runtime to Enforcing
```

It has clear boundaries, and using it wrong causes two kinds of incidents:

**What it can do**: hot-switch between Enforcing and Permissive. When you suspect SELinux is blocking a workload in production, `setenforce 0` lets it through immediately for observation while `ausearch` collects the denial records; after fixing the policy, `setenforce 1` verifies it.

**What it cannot do**:
1. **It cannot switch to Disabled**. `setenforce` only accepts 0 (Permissive) and 1 (Enforcing); Disabled requires editing the config file and rebooting.
2. **`setenforce` has no effect while Disabled**. The policy module is not loaded at all, so writing `/sys/fs/selinux/enforce` will not produce the expected result (or will error out directly).
3. **It is not a persistence mechanism**. After reboot, `Current mode` returns to `Mode from config file` -- if you only `setenforce 0` without changing the config file and then reboot, the service will be blocked again at the next boot.

```bash
# Switch to Permissive temporarily (lost after reboot)
$ sudo setenforce 0
$ getenforce
Permissive
```

## 5. Permanent Configuration: /etc/selinux/config

The persistent mode is set in `/etc/selinux/config` (on some systems this is a symbolic link to `/etc/sysconfig/selinux`):

```bash
# /etc/selinux/config
# SELINUX= can take one of these three values:
#     enforcing - SELinux security policy is enforced.
#     permissive - SELinux prints warnings instead of enforcing.
#     disabled - No SELinux policy is loaded.
SELINUX=enforcing
# SELINUXTYPE= can take one of these three values:
#     targeted - only targeted processes are protected.
#     minimum - modification of targeted policy. Only selected processes are protected.
#     mls - Multi Level Security protection.
SELINUXTYPE=targeted
```

`SELINUX=` accepts only three lowercase values: `enforcing`, `permissive`, `disabled` (the uppercase spellings found in older documentation are still accepted by most systems, but lowercase is the standard). `SELINUXTYPE=` is the policy type, which is a separate dimension from the running mode; change it with care (see [Policy Configuration](./policy_configuration.md)).

**How changes take effect**:

| From → To | Action | Reboot required | Extra steps |
|---------|------|-------------|---------|
| Enforcing ↔ Permissive | `setenforce 0/1` | No | — |
| Anything → Disabled | Edit the config file | Yes | No relabel needed before rebooting; **before re-enabling**, you need to prepare a relabel |
| Disabled → Enforcing/Permissive | Edit the config file | Yes | **A full-disk relabel is mandatory**, otherwise labels will be inconsistent |

The correct way to switch back from Disabled to Enforcing:

```bash
# 1. Edit the config
sudo vim /etc/selinux/config      # SELINUX=enforcing

# 2. Mark a full relabel at reboot (pick one)
sudo touch /.autorelabel          # The standard approach: automatic relabel on next boot; a longer run is normal

# 3. Reboot
sudo reboot
```

After reboot, the relabeling process can take several minutes or longer, and you can watch progress on the console; **do not cut power during this window**, or the label store may end up corrupted enough to need another relabel. This is the real reason section 1 insists on "use Permissive for debugging, never Disabled".

## 6. Choosing a Mode

- **Production servers (RHEL family)**: keep Enforcing. It is part of the distro's security baseline, and turning it off means giving up the defense in depth for that service.
- **Before going live with a new service / during policy debugging**: run a full business cycle in Permissive first, collect the `ausearch -m avc` results, fix them in bulk, then switch to Enforcing -- far more controllable than "disable it first and deal with it when something breaks".
- **Emergency troubleshooting (production already impacted)**: `setenforce 0` to stop the bleeding immediately → `ausearch` to capture evidence → fix (boolean/fcontext/policy) → `setenforce 1` to verify → persist the observed results into the config file if needed.
- **Debian/Ubuntu**: the `setenforce` / `/etc/selinux/config` procedure in this page does not apply; AppArmor switches individual profiles with `aa-complain` (complain is roughly Permissive) and `aa-enforce`.
- **Arch**: there is no SELinux to disable by default; if you enabled it yourself, the mode logic is the same as RHEL, but the responsibility for relabeling and policy maintenance is entirely yours.

## 7. Common Pitfalls

1. **Assuming "SELinux is off" after `setenforce 0`**: that is only runtime Permissive and is restored on reboot; and the label-drift risk of Disabled is far greater than that of a Permissive observation period.
2. **Editing the config file but not rebooting**: changes to `/etc/selinux/config` do not take effect at runtime, and `Current mode` stays unchanged -- keep the two fields straight.
3. **Switching Disabled straight back to Enforcing without a relabel**: file labels remain in the pre-disable state, and after reboot services produce `avc: denied` en masse; in the extreme case you cannot get into the graphical interface or critical services will not come up. Always `touch /.autorelabel`.
4. **Running this page's commands on Debian/Ubuntu**: that family defaults to AppArmor, and `getenforce` showing Disabled means "not installed", not "you turned it off" -- use `aa-status` instead.
5. **Assuming `setenforce` exists on Arch**: without SELinux enabled by hand, the userspace tools are absent and the command will not be found; first check whether `/sys/fs/selinux` exists.
6. **Treating an MLS `s0` difference as a mode problem**: even with the same Enforcing mode, a differing `level` field can also cause denials -- that is the MLS dimension of the policy, not the running mode. See [Concepts](./concept.md).

## References

- Red Hat - Using SELinux (mode switching section) -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/using_selinux/index)
- `man getenforce` -- [man7.org](https://man7.org/linux/man-pages/man8/getenforce.8.html)
- `man setenforce` -- [man7.org](https://man7.org/linux/man-pages/man8/setenforce.8.html)
- `man sestatus`
- Arch Wiki - SELinux -- [wiki.archlinux.org](https://wiki.archlinux.org/title/SELinux)
- Debian Wiki - SELinux -- [wiki.debian.org](https://wiki.debian.org/SELinux)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/basic/README.md)
- [security](/basic/security.md)
- [concept](concept.md)
- [selinux](/security/selinux.md)
