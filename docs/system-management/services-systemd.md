# Advanced systemd Services and Program Management

Being able to start and stop services with `systemctl` is only the beginning -- the basics page's [System Service Management](../basic/services/system_services.md) walks through the start/enable/start divide and stops at the threshold. Actually "managing" services well means clearing four hurdles: surviving distro upgrades without losing your customizations, reading the dependency chain when systemd refuses to start something, putting a resource cage on a service so one runaway process cannot drag the whole box into OOM, and going straight from `status` to the journal to the root cause on failure. These four map onto unit file lookup priority, dependency transactions, cgroup membership, and diagnostic tooling respectively; this page follows that order: first build the full unit picture and the three-territory judgment, then break down dependency semantics and transaction rollback, then cover drop-in overrides and template instantiation done right, and finally cgroup membership, resource limits, and a reusable failure-diagnosis flow.

> Content adapted from the systemd official documentation and the Arch Wiki (conceptual framework from Bird's Private Recipes (Lin's Linux Administration Guide)); see the references at the end.

## What This Page Covers

- Read the three-level lookup order of unit files and the effective-definition judgment, so local customizations survive upgrades
- Tell apart the failure-propagation semantics of `Wants` / `Requires` / `BindsTo`
- Use drop-in overrides and template units to manage customizations and multi-instance
- cgroup process membership
- Build the `status -> journal -> analyze` diagnosis flow, and read exit codes and restart rate limiting

## 1. From "Can Use" to "Can Manage"

Four signals say you should read this page. First, you changed a service's config and wanted to "quickly" tweak a default, so you edited the file under `/usr/lib/systemd/system/` -- after the upgrade the change is gone, and you suspect the package manager "overwrote the config". Second, a service will not start, `systemctl status` shows a single `Dependency failed` with nothing after it, and you cannot tell which link broke. Third, a Java service ate all the memory in the middle of the night and dragged the whole box into OOM, taking SSH down with it, when it was "supposed to use only 2G". Fourth, you ran `systemctl disable` on a service, it is still alive after reboot, and you start to doubt enable/disable ever worked.

The answers to these four map onto: the three-level lookup priority of units, failure propagation in dependency transactions, cgroup resource limits, and the fact that "more than just enable can bring you up". In systemd's design these are one thing -- a unit is not a startup script but a declarative description: systemd reads all the declarations, computes a single boot transaction, and then fulfills that declaration inside a cgroup. Once you understand the mainline "declaration -> transaction -> cgroup fulfillment", every detail on this page has a place.

## 2. The Unit Landscape and Lookup Order

### 2.1 Unit Types at a Glance

`systemctl list-unit-files --type=service` -- swap `--type=` and you switch to another unit type. The common types each own one job:

| Type | Responsibility | Typical example |
|------|----------------|-----------------|
| `service` | Lifecycle of a regular daemon | `nginx.service`, `sshd.service` |
| `socket` | Listen on a socket and pull the service up only when someone connects (socket activation) | `ssh.socket`, `cups.socket` |
| `timer` | Time-triggered start, cron's successor | `fstrim.timer`, `man-db.timer` |
| `target` | Grouping of boot-stage dependencies, runs' successor | `multi-user.target`, `graphical.target` |
| `path` | Watch a path change, then trigger a service | `cups.path` |
| `mount` / `automount` | Mount-point management and lazy mounting | `home.automount` |
| `device` | udev device event trigger (rarely hand-written) | `dev-sda1.device` |
| `swap` | Swap-space management unit | `swapfile.swap` |
| `slice` | cgroup resource grouping, the quota container | `system.slice`, `user.slice` |
| `scope` | Registry for externally created process groups (`systemd-run --scope`) | `run-1234.scope` |

Two high-frequency entry points hide in that table: `socket`-type lets a service idle at zero cost (distros use it for on-demand SSH and CUPS; section 7's "disabled but still auto-starts" is mostly about this), and `slice`-type is where section 5's resource limits land -- a quota is not attached to a service out of thin air but to the slice cgroup container.

### 2.2 Three Territories and the Effective-Definition Judgment

systemd looks up multiple candidate paths for the same unit in a fixed order, **earlier directories override later ones**:

```text
/etc/systemd/system/     ← Administrator territory: everything you and systemctl edit lands here, highest priority
/run/systemd/system/     ← Runtime territory: definitions generated by systemd/programs during this boot, gone on reboot
/usr/lib/systemd/system/ ← Package manager territory: vendor definitions installed by dpkg/rpm/pacman, refreshed on upgrade
```

On Debian/Ubuntu the often-seen `/lib/systemd/system` is a symlink to `/usr/lib/systemd/system` (usr-merge layout), two names for the same territory. Three disciplines follow: **never hand-edit package manager files** (an upgrade reverts them, and it may also trigger a conffile conflict prompt on the dpkg side); **your customizations go only under `/etc`** (they survive upgrades); and **tell apart "changed" from "effective"** -- there are three levels of tooling for the effective-definition judgment:

```bash
# 1) Which files make up the effective definition: the first few lines of comments are the answer
$ systemctl show nginx -p FragmentPath -p DropInPaths
FragmentPath=/usr/lib/systemd/system/nginx.service
DropInPaths=/etc/systemd/system/nginx.service.d/override.conf

# 2) Full inventory: who is overridden, who is extended, who is masked (output shown)
$ systemd-delta
OVERRIDEN /usr/lib/systemd/system/nginx.service → /etc/systemd/system/nginx.service
EXTENDED  /usr/lib/systemd/system/nginx.service → /etc/systemd/system/nginx.service.d/override.conf

# 3) List all candidates and states for one unit type
$ systemctl list-unit-files --type=timer | head -4
UNIT FILE                    STATE
fstrim.timer                 enabled
man-db.timer                 static
```

`FragmentPath` points to the main unit file, `DropInPaths` lists every added override -- when you suspect a customization was lost after an upgrade, read these two lines first; it is far faster than crawling directories. `systemd-delta` is a good helper for the "first post-boot inspection": three lines of output tell you how many deviations from vendor default this machine has. The three-family service-name difference covered in the basics page (Debian's `ssh` vs. the other families' `sshd`) is equally obvious in `list-unit-files` output and is not expanded here.

## 3. Dependencies and Boot Transactions

### 3.1 Failure Propagation Across Three Dependency Kinds

A dependency directive is more than "do they start together" -- more important is **what it drags you down to when the other side fails**:

| Directive | Other side fails to activate | Other side stopped or crashes | Typical use |
|-----------|------------------------------|-------------------------------|-------------|
| `Wants=` | You start as normal | You are unaffected | Weak association: target grouping, optional companion |
| `Requires=` | You do not start (when paired with `After=`) | You are stopped along with it | Hard prerequisite: data directory, key agent |
| `BindsTo=` | You do not start | You are stopped -- **inactive for any reason** counts | Hard bound: device unplugged, network interface vanishes |

The line between `Wants` and `Requires` is "does failure propagate": in `Wants`'s world nginx does not care whether the log collector came up; in `Requires`'s world if the database dies the application must exit with it -- otherwise you get the ghost state of "half a system still serving". `BindsTo` is harsher than `Requires`: `Requires` mainly guards against "startup failure" and "explicit stop", while `BindsTo` (usually paired with `After=`) also counts the other side crashing on its own -- it is essential for device units and containers bound to a network interface. Like package-manager dependencies -- `pacman -S` pulls up the "install" half, while the runtime "whoever crashes drags whom" is the other half of the ledger; the value of a declarative system is that both halves are written in config and auditable.

### 3.2 `After` / `Before` Only Order Things

The most frequent misunderstanding: add one line `After=network.target` to a unit and believe you "depend on the network being ready". `After` only answers "when both start, who goes first"; it **creates no pull-up relationship** -- the other side is not started because of this line, and its startup failure does not propagate to you. To pull it up you need `Wants` / `Requires`; to order you use `After`; the two are often written together but their duties are cleanly separate.

A second gotcha: `network.target` only means the network-management service "is started", not that the NIC got an IP. Services that "must have an address to work" such as SSH, NFS, and remote databases should be `network-online.target`, and the distro must enable the wait component (`systemd-networkd-wait-online.service` or `NetworkManager-wait-online.service`), otherwise you get the race condition of "occasionally does not come up after reboot" -- the ordering declaration is right, nobody executes the wait, and you are still gambling.

### 3.3 Target Grouping and the Dependency Graph

A target is the "packing point" for dependencies: dozens of services each `WantedBy=multi-user.target`, and at boot you only pull that one target, with systemd computing the whole graph. Two graphs are routine diagnostics:

```bash
# Who multi-user.target pulls in (the whole boot picture)
$ systemctl list-dependencies multi-user.target
● multi-user.target
  ├─nginx.service
  ├─sshd.service
  └─...

# Who pulled me in (reverse accountability: who put me in the boot sequence)
$ systemctl list-dependencies --reverse nginx.service
nginx.service
└─multi-user.target
```

### 3.4 Transactionality and Failure Rollback

A single `systemctl start` does not light off scripts one by one -- it computes the dependency closure into a set of jobs and submits them as a **transaction**: only act if everything is satisfied, and if any required link fails, cancel the related jobs together -- systemd does not allow the system to be left in a "half started" state, which is the core advantage of declarative over scripted. When boot hangs you can read the pending job queue directly:

```bash
$ systemctl list-jobs
JOB UNIT                       TYPE   STATE
152 nginx.service              start  waiting     ← waiting on the jobs ahead of it
151 network-wait.service       start  running    ← the one actually holding the queue
```

Queueing itself is not scary; **queueing behind a job that never finishes** is. The `waiting` unit is the victim; the `running` one that will not return is the suspect. The `Dependency failed` in `status` at startup failure is the transaction refusing to execute -- working backwards through the table in section 3.1 tells you whether it is `Wants` (harmless) or `Requires` (fatal) and locates the break.

## 4. Drop-ins and Template Units

### 4.1 Why You Must Use Drop-ins

Writing customizations into `/usr/lib/systemd/system` carries a triple cost: reverted by an upgrade (the package manager refreshing its own territory is entirely proper), flagged by `dpkg -V` verification (you changed its file), and unsynchronizable across machines (your change is mixed into the vendor file and cannot be diffed separately). A drop-in puts the override into `/etc/systemd/system/<unit>.d/*.conf` -- systemd layers it on top of the priority from section 2.2, the vendor file is not touched, and your declaration stacks on top. `systemctl edit` is the formal entry point for this path:

```bash
$ sudo systemctl edit nginx.service
# Automatically creates and opens /etc/systemd/system/nginx.service.d/override.conf
```

The wrap-up order after saving is fixed: `systemctl daemon-reload` -> `systemctl restart`. Whether the change comes from direct editing or `systemctl edit`, treat reload as the closing action -- it is idempotent, harmless to run twice, and if you miss it systemd still holds the old definition in memory (the first pitfall in section 7).

### 4.2 A Complete Override Example

```text
# /etc/systemd/system/nginx.service.d/override.conf
[Unit]
# Needs the real IP before starting (pair with the wait component from section 3.2)
After=network-online.target
Wants=network-online.target

[Service]
# Environment files go in /etc/default (Debian family) or /etc/sysconfig (RHEL family) by distro convention
EnvironmentFile=-/etc/default/nginx
# Resource cage: memory ceiling, see section 5.3
MemoryMax=512M
# Auto-restart on failure, parameter linkage in section 6.4
Restart=on-failure
```

The leading `-` on the `EnvironmentFile` line means "do not error if the file is missing" -- in service-level config this tolerant form is required, otherwise a missing optional file can keep the service from starting. If the override touches `ExecStart`, the rule turns sharply stricter: **exec directives must be unique within a unit**, and writing a second one outright is refused by systemd (an error like `Duplicate ExecStart`); the right way is to clear it first, then define:

```text
[Service]
ExecStart=                       ← this line is the clearing, not a typo
ExecStart=/usr/sbin/nginx -g 'daemon off;'
```

### 4.3 Three Ways to Use `systemctl edit` and How to Revert

`systemctl edit nginx.service` edits (or creates) the drop-in and is the most common entry point; `--full` copies the **entire** unit into `/etc` for editing -- for "too many changes, item-by-item override is not worth it", at the cost of parting ways with the vendor file forever: new defaults after an upgrade no longer flow in automatically and you have to watch them yourself; `--runtime` writes the override under `/run`, vanishing on reboot, the gray-release form for "want to try a version but fear leaving a mess". To revert everything back to the distro original:

```bash
$ sudo systemctl revert nginx.service   # Removes all local overrides for this unit
$ systemd-delta | grep nginx            # Confirm no override residue remains
```

### 4.4 Template Units: One Definition, N Instances

A filename with `@` is a template (such as `sshd-alt@.service`); it does not start directly but instantiates by parameter. Here is a complete multi-instance SSH example built from scratch (adjust paths and parameters to your target distro):

```text
# /etc/systemd/system/sshd-alt@.service -- hand-written template, illustrative
[Unit]
Description=OpenSSH server (instance %i)
After=network.target

[Service]
ExecStart=/usr/sbin/sshd -D -f /etc/ssh/sshd_config.%i -o PidFile=/run/sshd-%i.pid
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```text
# /etc/ssh/sshd_config.2222 -- instance config must be self-contained:
# once sshd -f is given, the main config /etc/ssh/sshd_config is not read; Port/HostKey etc. must be written fully here
Port 2222
HostKey /etc/ssh/ssh_host_ed25519_key
PasswordAuthentication no
```

```bash
$ sudo systemctl enable --now sshd-alt@2222
$ ss -tlnp | grep :2222                  # Confirm the listener
$ ssh -p 2222 alice@192.168.56.10        # Log in on the alternate port
$ systemctl list-units 'sshd-alt@*'      # Instantiated list
```

Instance-name expansion has two specifiers: `%i` is the instance name processed by systemd escape rules, `%I` is the restored raw instance name -- when the instance name may contain path-like characters, **build file paths with `%I`**, and `%i` everywhere else (the distro-shipped sshd template is the model). `%n` (full unit name), `%p` (name without the instance suffix), and `%%` (a literal `%`) need only be known; the full table is under "Specifiers" in `man systemd.unit`. The payoff of templates is clear in the context of section 2: one declaration in version control, multi-machine multi-instance derived one by one via `enable sshd@chat`, no more copy-pasting N configs that differ by one line.

## 5. cgroup and Process Membership

### 5.1 The CGroup Section in `status`

```bash
$ systemctl status nginx --no-pager | tail -8
     CGroup: /system.slice/nginx.service
             ├─1234 nginx: master process /usr/sbin/nginx
             ├─1240 nginx: worker process
             └─1241 nginx: worker process
```

This tree is where systemd fulfills its declaration for the service: the master and all workers live in the single `/system.slice/nginx.service` cgroup cell. Membership means three layers -- **accounting** (the Memory/CPU numbers in `status` aggregate from this cell), **limiting** (the quotas in section 5.3 act on this cell), and **reaping** (on stop systemd sweeps this cell, leaving none). Understanding the third explains the next question.

### 5.2 The Two Semantics of kill

A hand `kill 1234` only kills the master: the workers are still alive, `Restart=on-failure` pulls up a new master -- the old workers are unmanaged and the new master hits a port conflict, the classic double-run incident. `systemctl stop` goes through cgroup reaping: `KillMode=control-group` (the default) sends `SIGTERM` to the whole group, and if they still have not exited after `TimeoutStopSec` (default 90 seconds) it follows with `SIGKILL` -- the graceful window is exactly the time the application has to handle `TERM`. To signal the whole group while running without restarting:

```bash
$ sudo systemctl kill -s SIGUSR1 nginx    # Whole group receives it (e.g. nginx hot reload)
$ sudo systemctl kill --kill-who=main nginx  # Main process only, use with care
```

The division of labor is clear: **day-to-day operations touch only `systemctl`**; manual process killing is for debugging only, and after killing always follow with `systemctl status` to confirm there is no restart loop and no zombie workers.

### 5.3 Resource Cages and Slices

Quota directives (cgroup v2 unified naming; the v1-era `MemoryLimit` has been replaced by `MemoryMax`):

| Directive | Effect | Example |
|-----------|--------|---------|
| `MemoryMax=` | Hard memory ceiling; the kernel OOM killer kills processes in the cgroup when exceeded | `MemoryMax=512M` |
| `CPUQuota=` | CPU average ceiling; `50%` is half a core | `CPUQuota=50%` |
| `TasksMax=` | Process/thread count ceiling; guards against fork bombs | `TasksMax=128` |
| `AllowedCPUs=` | Pin the running cores | `AllowedCPUs=0-3` |

Written in a drop-in's `[Service]` section they apply to that service; to limit a group of services together, use a slice:

```text
# /etc/systemd/system/db.slice -- shared quota container for a group of services
[Slice]
CPUQuota=200%
MemoryMax=2G
```

A service writes `Slice=db.slice` in its `[Service]` section to move in -- a slice is a branch of the cgroup tree, the quota takes effect on the branch and covers every unit under it, the same single-point-declaration idea as "write the trust list once and the whole family obeys". For one-off jobs, `systemd-run` gives a temporary cage: `systemd-run --scope -p MemoryMax=512M ./heavy-job` pulls up a limited task on the spot, no unit file needed first. A pair of browsing tools -- `systemd-cgls` to see who lives in which cell, `systemd-cgtop` to sort by usage and pick out the inflated one:

```bash
$ systemd-cgtop | head -4
Path                                       Tasks   %CPU   Memory  Input/s Output/s
/                                            213   12.4     4.2G      -        -
/system.slice/nginx.service                    5    0.3   14.2M      -        -
/system.slice/postgresql.service-DB.slice      8    2.1    1.7G      -        -
```

What you see at a glance is the usage projection of that cgroup tree from section 5.1: which cell's memory is abnormal, which cell's CPU stays high -- the answer is far more direct than needle-hunting in a process list.

## 6. The Failure-Diagnosis Playbook

### 6.1 Read `systemctl status` Line by Line

First read a healthy output and memorize each field's "normal value" so anomalies are obvious:

```text
● nginx.service - A high performance web server
     Loaded: loaded (/usr/lib/systemd/system/nginx.service; enabled; preset: enabled)
     Active: active (running) since Mon 2026-09-29 08:00:12 CST; 3 days ago
       Tasks: 5 (limit: 4915)
      Memory: 14.2M (peak: 39.8M)
         CPU: 1min 23s
```

The `limit` on the `Tasks` line is the whole-machine `TasksMax` ceiling; getting close to it means checking for fork runaway. `Memory`'s `peak` records the historical high and is the basis for setting `MemoryMax` (the last pitfall in section 7). `CPU` is cumulative usage; combined with uptime it gives a rough sense of the load level. Now the failure scene:

```text
● nginx.service - A high performance web server
     Loaded: loaded (/usr/lib/systemd/system/nginx.service; enabled; vendor preset: disabled)
     Active: failed (Result: exit-code) since Tue 2026-10-02 03:12:45 CST; 11min ago
    Process: 1234 ExecStart=/usr/sbin/nginx -g 'daemon off;' (code=exited, status=1/FAILURE)
   Main PID: 1234 (code=exited, status=1/FAILURE)
```

The `Loaded` line reads three things: the path (is it overridden by `/etc`, per section 2.2), `enabled/disabled` (the boot intent), and `vendor preset` (the factory default). The `Active` line is the state machine: `active (running)` persistent, `active (exited)` a one-shot task completed successfully, `inactive (dead)` not running, `activating/deactivating` transitional, `failed` failure -- the `Result:` after `failed` is the first triage field: `exit-code` for exit code (next subsection), `timeout` for timeout, `resource` for a quota ceiling hit (per section 5.3).

### 6.2 Logs and Post-Hoc Evidence

```bash
$ journalctl -u nginx -p err --since "10 min ago"   # Only err and above, narrow the scope first
$ journalctl -u nginx -f                            # Follow the live action
$ systemctl show nginx -p Result -p ExecMainStatus -p NRestarts
Result=exit-code
ExecMainStatus=1
NRestarts=3
```

The three `show` properties are the minimal evidence set at a crash scene: failure type, exit code, and how many restarts. A high `NRestarts` says the application is in a crash-restart loop; the direction is to read the application's own logs for the root cause. Journal persistence and retrieval are expanded in the basics page's [System Logs](../basic/log/syslog.md) and are not repeated here.

### 6.3 Locating Slow Boot

```bash
$ systemctl analyze blame | head        # Per-unit elapsed time ranking
$ systemctl analyze critical-chain nginx.service  # The real critical path it sits on
```

`blame`'s numbers are **concurrent**, not additive as a total -- multiple services run at the same time, so the ranking only tells you who is slow individually. To see "who is holding me up", `critical-chain` walks the dependency chain layer by layer and gives the wait time, with the `+` prefix marking the real incremental time on the chain; `systemd-analyze plot > boot.svg` outputs the full boot timeline, and opening it in a browser is one chart that shows who is waiting serially.

### 6.4 Exit Codes and Restart Rate Limiting

The `status=` / `signal=` on the `Process:` line are high-frequency signatures:

| Signature | Meaning | First action |
|-----------|---------|--------------|
| `status=1/FAILURE` | The application itself errored out | Read the last few lines in the journal before exit |
| `status=203/EXEC` | The `ExecStart` path does not exist or has no execute bit | Check the absolute path (systemd **does not use PATH**) |
| `status=217/USER` | The user named by `User=` does not exist | Check `/etc/passwd` and the unit spelling |
| `signal=SIGKILL` | Force-killed: OOM or a stop-timeout finisher | Find `oom-kill` / `Killing process` in the journal |
| `code=timeout` | Startup timeout | A `Type=notify` service did not become ready within `TimeoutStartSec` |

Auto-stopping a crash loop uses two directives together: `[Service] Restart=on-failure` decides "restart on failure", while `[Unit] StartLimitIntervalSec=30` + `StartLimitBurst=5` decides "if it crashes 5 times in 30 seconds, give up" -- after systemd prints `start request repeated too quickly` the unit sits in `failed`, and any `start` is refused. The handling order is fixed: read logs and fix the root cause -> `systemctl reset-failed nginx` to clear the failure accounting -> then `start`. A rate-limited `Restart=always` equals letting a must-crash service burn disk and alerts forever; rate limiting and restart are two halves of the same config.

## 7. Common Gotchas

**Changed a unit file but it does not take effect -- forgot `systemctl daemon-reload`.** The symptom is that the config is clearly written and `restart` ran, yet the behavior is still the old one. systemd re-parses unit files only at reload time, so every `start/restart` after that runs against the old definition in memory. The order is always `daemon-reload` -> `restart/enable`; judge "effective" with `systemctl show -p DropInPaths` or the header comments of `systemctl cat`, not "I just saved it". Changes made through `systemctl edit` also wrap up the same way; reload is idempotent and harmless.

**Overriding `ExecStart` by writing a second line outright -- the unit is refused at load time.** The error looks like `Duplicate ExecStart`, and the service simply does not come up. Exec directives must be unique within a unit; when overriding, first write an empty `ExecStart=` line to clear the inherited value, then write the new one (section 4.2 example). The same applies to `ExecStop` and other list-type appendable directives besides `Environment` -- clearing before defining is the only safe way.

**`disable`d but it still auto-starts at boot -- more than just enable can bring you up.** Three common sources: pulled in by another unit's `Wants=/Requires=` (`systemctl list-dependencies --reverse <target unit>` to reverse-lookup); what was actually enabled is the companion `.socket` unit, so a connection still activates the service (`systemctl is-enabled ssh.socket` against `ssh.service`); and when a unit has no `[Install]` section `is-enabled` shows `static`, on which disable is entirely ineffective -- it is always decided by whatever depends on it. A single reverse-lookup command settles it, far more efficient than repeatedly disabling and starting on luck.

**`stop` hangs for 90 seconds then the process goes to SIGKILL -- the application does not answer `TERM` or the timeout was not tuned.** The symptom is `systemctl stop` hanging for a long time, eventually logging `Killing process ... with SIGKILL`. Two directions, pick one: the application implements a graceful shutdown (catch `SIGTERM`, release the listener, then exit); or systemd tunes `TimeoutStopSec` to actual need (180s is reasonable for database-class services) and confirms `ExecStop` uses the right stop method. The cost of a SIGKILL finisher is more than ugly -- in-flight transactions may be cut in half, and application-level data consistency can only lean on your own journal.

**Template instance name does not match -- `%i` is unexpanded or expands to an unexpected value.** The symptom is `systemctl start sshd-alt@2222` reporting `Unit sshd-alt@2222.service not found` (the template filename is misspelled, no instantiable `@.service` after the `@`), or the service starts but reads the wrong config file. Two-step verification: `systemctl cat sshd-alt@2222` to see the fully expanded definition, and `systemctl status 'sshd-alt@*'` (glob) to list the actually existing instances. When the instance name has special characters, tell `%i` (escaped) from `%I` (raw) and build paths with `%I` -- a wrong expansion means sshd opens a config file whose name contains escape characters and then silently falls back to defaults, the port never matches and you cannot tell why.

**`MemoryMax` is set but the service is still OOM-killed -- the limit is below the application's real need.** The symptom is the service dying hours in, with `Memory cgroup out of memory: Killed process ...` or `oom-kill` traces in the journal, and `Result:` showing `signal=SIGKILL`. A limit is not a round number pulled from thin air: first observe the real peak with `systemctl status` (or the `MemoryPeak` property), and leave headroom for startup and caching -- setting `MemoryMax` below the application's steady state is fitting it with a time bomb. The companion trap is `TasksMax`: too small leaves a `max ... tasks` hint in the journal, and on the application side shows up as `fork: retry: Resource temporarily unavailable` -- task limiting is for fork bombs, not for saving resources.

## References

- systemd.unit(5) official man page -- [freedesktop.org](https://www.freedesktop.org/software/systemd/man/systemd.unit.html)
- systemd.service(5) official man page -- [freedesktop.org](https://www.freedesktop.org/software/systemd/man/systemd.service.html)
- Arch Wiki: Systemd -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd)
- systemd official documentation index -- [freedesktop.org/software/systemd](https://www.freedesktop.org/software/systemd/)
- systemd project documentation portal -- [systemd.io](https://systemd.io/) (design documents and topic index, including unit types, cgroup delegation, etc.)
- man systemctl / man systemd-delta / man systemd.resource-control
- Bird's Private Recipes (Lin's Linux Administration Guide) -- [linux.vbird.org](https://linux.vbird.org/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [glossary](/glossary.md)
- [knowledge](/knowledge.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [gap-fill](/research/gap-fill.md)
- [ci-cd](/server/ci-cd.md)
- [README](/source/README.md)
- [tracing-tools](/source/tracing-tools.md)
- [userland](/source/userland.md)
- [README](README.md)
- [boot-process](boot-process.md)
