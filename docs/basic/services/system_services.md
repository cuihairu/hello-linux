# System Service Management

Whether a server can recover its workload automatically after a power-cycle restart depends on whether the service was correctly "enabled"; whether a problem in one service can be located quickly depends on whether you know how to read its logs. Both of these have a unified answer in the systemd era: `systemctl` handles start/stop and autostart, while `journalctl` collects service output by unit. This page starts from "why systemd replaced SysV init," dissects the unit file structure and dependency declarations, focuses on the easiest-to-confuse `enable` vs `start`, then walks through the common `journalctl` query patterns, and finally contrasts the three distributions' differences in default service names (such as Debian's `ssh` vs the other families' `sshd`) and firewalls -- the commands themselves are highly consistent across the three families; the watershed is in the defaults and package names.

> Content adapted from the Arch Wiki systemd documentation and Bird's Private Recipes (Lin's Linux Administration Guide); see the references at the end.

## What This Page Covers

- Why systemd replaced SysV init, and how to read the unit file structure and dependency declarations
- Becoming fluent with `systemctl` and accurately distinguishing `enable` from `start` (the most frequent pitfall)
- Common `journalctl` patterns for querying service logs
- The target-replaces-runlevel and timer-replaces-cron correspondences
- Contrasting the three distributions' default services and firewalls, so you avoid running one family's commands on another

## 1. Why systemd Replaced SysV init

Early Linux used SysV init to manage boot: a pile of scripts numbered `S01`, `S12` under `/etc/rc.d/rc3.d/` ran serially, with dependencies agreed on purely by number order. Three fatal problems made it unable to cope with modern systems:

- **Serial boot was too slow**: each script finished before the next started, so unrelated services also queued up.
- **Dependencies were implicit and fragile**: once a number was manually changed, NFS could mount before the network was ready, SSH could start before the host keys were generated.
- **Management entry points were scattered**: `service`, `chkconfig`, and `init` each handled their own slice, and status queries had no unified format.

systemd's answer was to unify "everything boot must do" under a single abstraction, the **unit file** (an INI-style declarative configuration), declare dependencies explicitly with fields like `After=` and `Wants=`, allow independent units to start in parallel, and provide one entry point, `systemctl`, for querying, starting/stopping, and managing autostart. All three distributions (Debian/Ubuntu, Arch, RHEL/CentOS/Rocky) use systemd as the default init system, and the commands are completely identical.

On Debian/Ubuntu the SSH service name is usually `ssh` (`sshd` is an alias); on Arch and the RHEL family it is `sshd`. Below I use `sshd` uniformly. The commands are completely identical across the three distributions; the only difference is this default naming.

## 2. Basic systemctl Operations

Start with a real status output, and note the `Loaded` and `Active` lines -- they answer "will it autostart after a reboot" and "is it running right now" respectively:

```bash
$ systemctl status sshd
● sshd.service - OpenSSH server daemon
     Loaded: loaded (/usr/lib/systemd/system/sshd.service; enabled; vendor preset: disabled)
     Active: active (running) since Mon 2026-09-21 08:15:03 CST; 1 day 3h ago
   Main PID: 1102 (sshd)

Sep 21 08:15:03 web01 systemd[1]: Started OpenSSH server daemon.
```

The common operations split into two categories by semantics; mixing them up is the most common source of errors:

```bash
# -- changes "current state", lost after reboot --
sudo systemctl start sshd      # start immediately
sudo systemctl stop sshd       # stop immediately
sudo systemctl restart sshd    # stop then start again (the process PID changes)
sudo systemctl reload sshd     # no process restart, only re-read config (requires service support)

# -- changes "boot intent", still in effect after reboot --
sudo systemctl enable sshd     # create the autostart symlink
sudo systemctl disable sshd    # remove the autostart symlink
```

Group the query commands by purpose: `status` gives the overall status (including recent logs), `is-active` answers only active/inactive, `is-enabled` answers only enabled/disabled, `list-units --type=service` lists the already-loaded services, and `list-unit-files --type=service` lists all manageable service files on the system.

The underlying implementation of `enable` is merely creating/removing symlinks: running `sudo systemctl enable sshd` prints `Created symlink /etc/systemd/system/multi-user.target.wants/sshd.service → /usr/lib/systemd/system/sshd.service.`, and `disable` shows the corresponding `Removed` line -- whether the symlink exists is the basis for `is-enabled`.

## 3. The Big Pitfall: enable != start

This is the most-asked question in service management and deserves its own section.

| Operation | Affects now | Affects after reboot | Typical misuse |
|-----------|-------------|----------------------|----------------|
| `start` | Runs immediately | Does not autostart after reboot | You install a service and only `start` it, then the whole workload drops when the server reboots |
| `enable` | Does not start the service | Autostarts on next boot | Assuming an enabled service is running, when in fact `Active: inactive` |
| `enable --now` | Yes | Yes | The correct one-step form (systemd >= 220) |

All four combinations of states are legal and common, so you must read both `status` lines together:

```bash
# enabled + inactive: autostart enabled but currently stopped (will be pulled up on next boot)
$ sudo systemctl stop sshd && systemctl status sshd | head -3
● sshd.service - OpenSSH server daemon
     Loaded: loaded (/usr/lib/systemd/system/sshd.service; enabled)
     Active: inactive (dead)

# disabled + active: running now but gone after reboot (the most common incident state)
$ sudo systemctl disable sshd && sudo systemctl start sshd
$ systemctl status sshd | head -3
     Loaded: loaded (/usr/lib/systemd/system/sshd.service; disabled)
     Active: active (running) since Tue 2026-09-22 09:41:12 CST; 2s ago
```

The correct pattern, universal across the three families, is to `enable --now` a service immediately after installing it. Services installed with `pacman` on Arch (such as `pacman -S nginx`) obey this same rule: the package only lays the unit file into `/usr/lib/systemd/system/`; whether it autostarts is still your decision.

## 4. Unit File Structure and Dependencies

Unit files live in three directories by source, ordered from lowest to highest priority:

| Directory | Purpose | Editing advice |
|-----------|---------|----------------|
| `/usr/lib/systemd/system/` | Ships with the software package (the RHEL-family path; the common equivalent on Debian/Ubuntu/Arch is `/lib/systemd/system/` or `/usr/lib/systemd/system/`) | Do not edit directly; an upgrade will overwrite it |
| `/run/systemd/system/` | Generated at runtime | Generally leave alone |
| `/etc/systemd/system/` | Administrator's local edits and custom units | **Edit units only here** |

Three sections of a typical service unit:

```ini
# /etc/systemd/system/sshd.service (illustrative; use the distribution's shipped file in practice)
[Unit]
Description=OpenSSH server daemon
After=network.target cryptsetup.target
Wants=sshd-keygen.service

[Service]
Type=notify
ExecStart=/usr/sbin/sshd -D $OPTIONS
ExecReload=/bin/kill -HUP $MAINPID
Restart=on-failure
RestartSec=4s

[Install]
WantedBy=multi-user.target
```

Dependency declarations answer only "order and what gets dragged along," not "whether to start at all":

- `After=` / `Before=`: govern **order** of starting only; they do not imply "the other side must start first."
- `Wants=`: weak dependency. If the other side fails to start, you still start.
- `Requires=`: strong dependency. If the other side fails to start, you fail and exit too.
- `BindsTo=`: stronger than `Requires`; if the other side stops mid-run, you are stopped as well.
- `Conflicts=`: mutually exclusive; if I start, you do not start (such as `graphical.target` vs some rescue modes).

Querying the dependency tree -- forward shows "who do I depend on," `--reverse` shows "who depends on me":

```bash
$ systemctl list-dependencies sshd.service
sshd.service
├─sshd-keygen.service
├─system.slice
├─basic.target
│ └─network.target
└─multi-user.target

$ systemctl list-dependencies --reverse network.target
network.target
└─sshd.service
```

After modifying a unit file you must let systemd re-read it, otherwise it keeps working from the old in-memory definition. `daemon-reload` by itself does not restart any service; after re-reading you still need `restart` so a running process picks up the new configuration. Neither step can be skipped:

```bash
sudo systemctl daemon-reload   # re-read unit definitions
sudo systemctl restart sshd    # let the running process pick up the new config
```

## 5. target: Replacing Runlevels

SysV runlevels 0-6 have been replaced by target units; day to day you only need to care about two:

| target | Corresponding scenario |
|--------|------------------------|
| `multi-user.target` | Command line only (~= runlevel 3) |
| `graphical.target` | Graphical interface (~= runlevel 5, includes multi-user internally) |

```bash
$ systemctl get-default
graphical.target
$ sudo systemctl set-default multi-user.target   # recreate the default.target symlink to point at multi-user.target
```

Switching the **current** run environment uses `isolate` (it starts/stops a whole group of units); do not use `start`/`stop` on a target: `sudo systemctl isolate multi-user.target` switches immediately to command line only, and `sudo systemctl isolate graphical.target` switches back to the graphical interface immediately. isolate stops every service in the current environment that is not in the target target's dependency tree, so confirm before running it over a remote session that you will not lock yourself out.

## 6. timer: systemd's Scheduled Tasks

Each `.timer` corresponds to a `.service` of the same name: the timer is responsible for "when to trigger," the service for "what to do after triggering." The advantages over cron are: the task runs in its own cgroup, dependencies can be declared, the result lands in the journal automatically, and missed intervals can be caught up with `Persistent=true`.

```bash
$ systemctl list-timers
NEXT                         LEFT       UNIT             ACTIVATES
Tue 2026-09-22 00:00:00 CST  14h left   logrotate.timer  logrotate.service
```

In the output, `NEXT`/`LEFT` are the next trigger time and countdown, `LAST`/`PASSED` are the last trigger time, and `UNIT`/`ACTIVATES` list the timer and the service it triggers -- when debugging "why did the scheduled task not run," look at this screen first.

The most common timer example -- run a backup at 2:30 AM every day:

```ini
# /etc/systemd/system/backup.timer
[Unit]
Description=Nightly backup

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true

[Install]
WantedBy=timers.target
```

Enabling the backup timer only takes `sudo systemctl enable --now backup.timer` (the timer itself needs enable, the service does not), then confirm the next trigger time with `systemctl list-timers backup.timer`.

User-level personal tasks can keep using `crontab -e` with no problem at all; for system-level tasks bound to a service's lifecycle, prefer timer. A service triggered by a timer that fails is still recorded in the journal as usual; check each run's result with `journalctl -u backup.service`.

## 7. Three-Family Default Services and Firewall Differences

Same commands, different factory state; this is where migrating machines most easily goes wrong:

| Item | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|--------------------|
| SSH service name | `ssh.service` | `sshd.service` | `sshd.service` |
| Default firewall | Ubuntu enables ufw; Debian usually does not enable one | No default; you install and configure it yourself | firewalld enabled by default |
| Firewall query | `sudo ufw status` | Depends on the installed solution | `sudo firewall-cmd --state` |
| Common log files | `/var/log/syslog`, `/var/log/auth.log` | Journal-centric by default | `/var/log/messages`, `/var/log/secure` |
| Service package source | `apt` (e.g. `apt install nginx`) | `pacman` (e.g. `pacman -S nginx`) | `dnf` (e.g. `dnf install nginx`) |

No matter which package manager you use, the flow is the same: **install -> `systemctl enable --now` -> confirm `enabled + active` with `systemctl status` -> verify the logs show no errors with `journalctl -u`**. Any service installed with `pacman` on Arch follows this flow; the package will not enable it for you (a few packages use a pacman hook as an exception, but you should still run `is-enabled` once after installing).

## 8. Common Pitfalls

1. **Only `start`, not `enable`**: the service disappears after a reboot. Run `systemctl enable --now` right after installing, and verify with `is-enabled` before going live.
2. **Edited the unit but did not reload**: after editing `/etc/systemd/system/*.service` you must `daemon-reload`, otherwise systemd does not notice; if you changed `ExecStart` you also need `restart`.
3. **Using `start`/`stop` on a target**: switching runlevels uses `isolate`; `systemctl stop graphical.target` will not work as expected.
4. **Killing a service process**: a direct `kill` makes systemd think the service exited unexpectedly, and it may keep restarting it per the `Restart=` policy. Always use `systemctl stop` to stop a service.
5. **Forgetting to unmask after masking**: `systemctl mask` chains the unit to `/dev/null`, which is more thorough than `disable` and even rejects a manual `start`; remember `unmask` once debugging is done.
6. **Assuming a failed reload means the config is broken**: only services that declare `ExecReload=` or use `Type=notify`/support reload can be `reload`ed; otherwise you get an error, and you should use `restart` instead.
7. **Only reading the tail of `status` when a service fails to start**: `journalctl -u <unit> -n 50 --no-pager` shows the full error; `systemctl status` only truncates the last few lines.
8. **Assuming the service name is the same across families**: on Debian/Ubuntu `systemctl status sshd` usually works via the alias, but in scripts you should use `ssh.service` or first confirm with `systemctl list-unit-files | grep ssh`, to avoid failure from a missing alias.

## References

- `man systemctl`, `man systemd.unit`, `man systemd.timer`
- Arch Wiki - systemd -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd)
- Arch Wiki - systemd timers -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd/Timers)
- Bird's Private Recipes (Lin's Linux Administration Guide) - Getting to know system services (daemons) -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0560daemons.php)
- Bird's Training Materials - Service management and boot flow management -- [linux.vbird.org](https://linux.vbird.org/linux_basic_train/centos8/unit13.php)
- Red Hat documentation - Configuring basic system settings (including systemd service management) -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_basic_system_settings/index)
- systemctl man page -- [man7.org](https://man7.org/linux/man-pages/man1/systemctl.1.html)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/basic/README.md)
- [services](/basic/services.md)
- [configuration_tools](configuration_tools.md)
- [configuration-management](/commands/system/configuration-management.md)
- [process](/commands/system/process.md)
- [glossary](/glossary.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [routing-nat](/server/routing-nat.md)
- [process-scheduling](/source/process-scheduling.md)
- [scheduled-tasks](/system-management/scheduled-tasks.md)
- [services-systemd](/system-management/services-systemd.md)
