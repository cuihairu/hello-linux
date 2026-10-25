# Automation

The real purpose of operational automation is not "type less" but **eliminate human variance**:
ten people doing the same job produce ten versions of the details, and the same person doing it three months later misses the pitfall they stepped in the first time.
Once the action is hardened into a script, a playbook, or a timer,
the result no longer depends on who is on duty, whether they remember, or how fast they type.
This page covers three blocks: **which tool to pick** (script vs Ansible),
**how it gets triggered** (cron vs systemd timer vs pipeline),
and **how to keep it from going wrong** (idempotency and common pitfalls).

> Content draws on the cron, systemd, and Ansible official documentation and automation practice; see the references at the end.
> Bash syntax, debugging, and shellcheck belong to the [Scripts section](../script/README.md);
> this page covers only selection and scheduling -- look up syntax questions in the Scripts section.

## What This Page Covers

- Make a reasoned choice among "write a script", "use Ansible", and "keep doing it by hand"
- Understand why idempotency is the lifeline of automation
- The semantic differences between cron and systemd timer, and the default state across the three distro families
- Understand the division between a pipeline (CI/CD) and a local timer
- Write a minimal working Ansible playbook and read the changed/ok feedback

## 1. When to Write a Script, When to Use Ansible

Tool choice is the first lesson on this page, because automating with the wrong tool is more expensive than not automating at all --
the error gets amplified on schedule by the timer.

**Division of labor first**: the [Scripts section](../script/README.md) solves "how to write the commands right" --
quotes, loops, `set -euo pipefail`, shellcheck;
this page solves "who executes what you wrote, and is it worth bringing in configuration management".
The two are upstream and downstream: the Scripts section is the workshop, this page is the dispatch room.

The criteria for the three paths:

| Criterion | Keep doing it by hand | Write a Shell script | Bring in Ansible |
|-----------|----------------------|---------------------|------------------|
| How often it runs | One-off, occasional | Periodic (daily/weekly) | Periodic, or "desired state stays resident" |
| Number of target machines | 1 | 1 to a few | 5 or more, or differentiated multi-role |
| Impact of failure | You can Ctrl-C right away | Controllable on a single box | Needs unified rollback, audit, approval |
| Who executes it | Only you | You + colleagues (readable is enough) | A team (needs review and idempotent semantics) |
| State description | "did it" | "run through the steps once" | "should look like this" (declarative) |

A few concrete scenarios to check against:

- **Compress and clean logs every week**: single box, periodic, fixed steps -- script + cron/timer, and that is the end of it.
- **Install a monitoring agent and change sshd config across 50 machines**:
  typing it will definitely miss something; a loop script runs but struggles to express "the difference per machine";
  Ansible's inventory + playbook naturally carries "who is which role".
  The [Configuration Management Tools](../commands/system/configuration-management.md) page in Commands
  has finer criteria for "when is it worth bringing in configuration management".
- **Setting up an environment on an unfamiliar machine for the first time**: do it by hand once first.
  Automating a flow you have not run through by hand is just putting an alarm on the error.
  Only after it runs smoothly twice do you settle it into a script -- this is the most easily skipped middle state.

Rule of thumb: **hand -> script -> configuration management** is a one-way upgrade chain,
and each step up requires the previous step to already be "running smoothly, handoff-ready".
In reverse, standing up an Ansible platform with AWX for 3 machines means learning and maintenance costs
that exceed the time it saves --
that is exactly what the 7th common pitfall in Commands is about.

## 2. Idempotency: The Lifeline of Automation

**Idempotent**: running the same operation once and running it N times leaves the same final state.
Timers and configuration management both **run your code over and over**;
non-idempotent code is correct the first time and starts breaking the scene the second:

```bash
# Non-idempotent: appends a line every run, so after three days the config has 30 identical records
echo "server 10.0.0.5" >> /etc/hosts

# Idempotent: check first, append only if absent
grep -qF "server 10.0.0.5" /etc/hosts || echo "server 10.0.0.5" >> /etc/hosts

# Non-idempotent: useradd errors out when the user already exists, and set -e aborts the script
useradd -m deploy

# Idempotent: existing counts as success, create only if absent
id -u deploy &>/dev/null || useradd -m deploy
```

Ansible bakes idempotency into module semantics: every module answers "has the target state already been reached",
only acts when it has not, and reports truthfully in the result:

```text
TASK [Install Nginx] ************************************************************
changed: [web1]
ok: [web2]                    # web2 already had it installed, no action this time -- this is the shape of idempotent feedback
```

When reading playbook output, **`changed` means something actually changed this run**,
and `ok` means the state was already correct; a run that is "all ok" is not useless --
it proves the desired state still holds (drift detection).
`ansible-playbook --check` (dry-run) reports "what would happen" before anything real happens,
the same safety habit as `rsync -n` and `apt upgrade --simulate`.

Before deciding a script is ready for cron/timer, ask yourself:
**will it break if run three times in a row, will it accumulate side effects**.
If you cannot write it idempotent, at least write it so failures are recognizable (exit code, log, alert);
see section 6 for the monitoring closed loop.

## 3. Scheduling and Triggers: cron, systemd timer, Pipeline

"There is no universal answer" is the honest one for "when should it run"; the three mainstream answers each solve a different problem.

### 3.1 cron: the Classic Five-Field Scheduler

```bash
$ crontab -e
# minute hour day-of-month month day-of-week  command
0 2 * * *    /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1
*/5 * * * *  /usr/local/bin/check-service.sh >> /var/log/check.log 2>&1
0 9 * * 1    /usr/local/bin/send-report.sh >> /var/log/report.log 2>&1
0 0 1 * *    /usr/local/bin/clean-logs.sh >> /var/log/clean.log 2>&1
```

The syntax is identical across the three families; old docs are safe to copy.
But three facts about the environment must be known:

- **The cron package is not preinstalled in all three families**.
  Debian/Ubuntu ships `cron` installed and enabled with the base system;
  RHEL/CentOS/Rocky uses `cronie`, installed and enabled by default;
  **Arch does not have cron by default** -- you need `sudo pacman -S cronie`
  and `systemctl enable --now crond`, or just switch to a timer (see 3.2).
- **The environment variables are extremely lean**. cron's `PATH` has only the basic few entries;
  always use absolute paths inside scripts; `HOME` and locale differ from a login shell.
- **Output goes to your mailbox by default**. A task without `>> log 2>&1`
  can silently vanish into the local MTA whether it succeeds or fails -- this is the number-one reason for "the script is obviously running but nobody knows it died".

Use `at` for one-off tasks (`apt install at` / `pacman -S at` / `dnf install at`,
on Arch you may likewise need to enable it manually):
after `at 02:00` type the commands and Ctrl+D to submit, `atq` to view, `atrm` to cancel.
`at` suits "run once tonight and that is it"; do not use it as a periodic scheduler.

### 3.2 systemd timer: Observable, Catch-Up-Capable, Dependency-Aware

timer = a `oneshot` service unit + a `.timer` trigger unit:

```ini
# /etc/systemd/system/my-task.service
[Unit]
Description=My task

[Service]
Type=oneshot
ExecStart=/usr/local/bin/my-task.sh

# /etc/systemd/system/my-task.timer
[Unit]
Description=Daily my-task at 02:00

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
$ sudo systemctl daemon-reload
$ sudo systemctl enable --now my-task.timer
$ systemctl list-timers my-task.timer
NEXT                      LEFT     LAST                        PASSED  UNIT
Tue 2026-01-20 02:00:00   6h left  Mon 2026-01-19 02:00:00    18h ago my-task.timer
```

Three substantive advantages over cron:
**logs are free** -- `journalctl -u my-task.service` gives the full output of the last run directly,
no need to wire up redirection yourself;
**`Persistent=true` catches up on misses** -- a 2am run missed because the machine was off or asleep
is fired automatically after boot, which is a must for desktops and non-24/7 servers;
**dependencies and conditions can be declared** -- `After=network-online.target`,
`ConditionPathExists=/backup` turn "do not back up if the disk is not mounted" into a declaration instead of a script if.
The cost is that unit file syntax requires consulting the manual (the `OnCalendar` notation in `man systemd.time` is wordier than five fields).

### 3.3 Pipeline: Event-Driven, Not Clock-Driven

cron and timer both answer "what time to run"; a pipeline answers
**"run when the code changes"** -- the trigger source is an event (git push, image build finished, PR merged),
which is the right shape for deployment and test tasks:

```bash
#!/bin/bash
# /var/repo/myapp.git/hooks/post-receive -- minimal pipeline: server-side hook, push deploys
GIT_WORK_TREE=/var/www/myapp git checkout -f
sudo systemctl restart myapp
```

The enterprise form is CI systems like Jenkins and GitLab CI:
checkout, build, test, and deploy chained into a pipeline with state and history.
Installing from the official Jenkins repository (keys are rotated periodically;
**defer to the current documentation at <https://pkg.jenkins.io/debian-stable> and
<https://www.jenkins.io/doc/book/installing/>**,
the commands below use early-2026 keys as an example):

```bash
# The year in the key filename changes (jenkins.io-2026.key is the current example only);
# fingerprints/keys rotate over time -- always defer to the latest values in the official docs before installing
# Debian/Ubuntu (LTS repo; for the weekly repo replace debian-stable with debian)
curl -fsSL https://pkg.jenkins.io/debian-stable/jenkins.io-2026.key \
  | sudo tee /usr/share/keyrings/jenkins-keyring.asc > /dev/null
echo "deb [signed-by=/usr/share/keyrings/jenkins-keyring.asc] \
https://pkg.jenkins.io/debian-stable binary/" \
  | sudo tee /etc/apt/sources.list.d/jenkins.list > /dev/null
sudo apt update && sudo apt install fontconfig openjdk-21-jre jenkins

# RHEL/CentOS/Rocky
sudo rpm --import https://pkg.jenkins.io/rpm-stable/jenkins.io-2026.key
sudo wget -O /etc/yum.repos.d/jenkins.repo \
  https://pkg.jenkins.io/rpm-stable/jenkins.repo
sudo dnf install fontconfig java-21-openjdk jenkins
```

The official Arch repos do not provide Jenkins;
you can use the AUR community package or run the official container image directly --
the container approach connects to the [Containers section](../server/container/docker.md) and is not expanded here.
Capistrano in the Ruby ecosystem (`gem install capistrano` then `cap production deploy`)
is an application deployment tool whose purpose overlaps with a pipeline and is not expanded here.
The selection criterion in one sentence: **periodic tasks use timer/cron, code-event-driven tasks use a pipeline,
multi-machine state convergence uses Ansible** -- the three frequently coexist rather than excluding each other.

### 3.4 cron vs timer vs Pipeline Quick Reference

| Dimension | cron | systemd timer | Pipeline (CI) |
|-----------|------|---------------|---------------|
| Trigger source | Clock | Clock (catch-up capable) | Code/event |
| Logs | Redirect yourself | journal built in | Platform built in |
| Missed trigger | Silently skipped | `Persistent=true` can catch up | Not applicable |
| Multi-machine distribution | Not solved | Not solved | Not solved (except deployment scenarios) |
| Learning cost | Lowest | Medium (unit syntax) | High (platform + pipeline syntax) |
| Typical task | Cleanup, reports, simple backups | Backups, inspections, tasks needing dependency checks | Build, test, release |

## 4. Ansible: The Default Answer for Multi-Machine Consistency

### 4.1 Installation Across the Three Families

| Item | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Full ansible (with collections) | `sudo apt install ansible` | `sudo pacman -S ansible` | Enable EPEL then `dnf install ansible` |
| Minimal ansible-core | `apt install ansible-core` | `sudo pacman -S ansible-core` | `sudo dnf install ansible-core` (bundled in AppStream) |
| Requirement on the managed side | Python 3 is enough, agentless | Same as left | Same as left (mind Python version alignment with the support matrix) |

One easy mix-up in the RHEL family: AppStream provides `ansible-core` (the minimal runtime) directly;
the full `ansible` package with community collections usually needs EPEL
(`sudo dnf install epel-release`).
The Python versions on both the controller and the managed side need checking against the
[Ansible support matrix](https://docs.ansible.com/);
"installed it but cannot connect / module missing" is mostly this reason.
On Arch, `pacman -S ansible` alone is enough, no AUR needed.

### 4.2 Inventory and Connectivity

```ini
# /etc/ansible/hosts
[webservers]
web1 ansible_host=192.168.1.100
web2 ansible_host=192.168.1.101

[dbservers]
db1 ansible_host=192.168.1.200
```

```bash
$ ansible all -m ping
web1 | SUCCESS => {
    "changed": false,
    "ping": "pong"
}
```

The `ping` module does not send ICMP; it runs a small bit of Python over SSH --
it is a smoke test of the whole "controller -> managed" chain:
if any link of SSH keys, sudo, or the Python interpreter is broken, it surfaces here.

### 4.3 Ad-hoc Commands: Temporary One-Time Actions

```bash
$ ansible all -m shell -a "uptime"                      # check load across the group
$ ansible webservers -m apt -a "name=nginx state=present"  # install a package (declarative)
$ ansible all -m copy -a "src=ntp.conf dest=/etc/ntp.conf"
$ ansible all -m service -a "name=nginx state=started enabled=yes"
```

Ad-hoc suits bulk actions that "run once and are done";
the same command run a second time should be settled into a playbook --
ad-hoc has no version history, so when something goes wrong there is nothing to diff, and that is the real dividing line between ad-hoc and playbook.

### 4.4 Playbook: Reviewable Desired State

```yaml
# playbook.yml
---
- hosts: webservers
  become: true
  tasks:
    - name: Install Nginx
      apt:
        name: nginx
        state: present

    - name: Copy configuration
      copy:
        src: nginx.conf
        dest: /etc/nginx/nginx.conf
      notify: Restart Nginx

    - name: Start and enable Nginx
      service:
        name: nginx
        state: started
        enabled: yes

  handlers:
    - name: Restart Nginx
      service:
        name: nginx
        state: restarted
```

Three key points: module names bind to the distro (`apt`/`pacman`/`dnf`/`yum` each has its own module,
while the `package` module chooses automatically, so prefer `package` when managing all three families);
`notify` makes "restart only when the config changed" a structured constraint instead of restarting every time;
each task's `changed/ok/failing` output is exactly the idempotent feedback described in section 2.
Before going to production, first `ansible-playbook --syntax-check` then a `--check` dry-run.

Roles break a playbook into reusable directories:

```text
roles/nginx/
  tasks/main.yml      # main flow
  handlers/main.yml   # linked actions such as restarts
  templates/nginx.conf.j2   # variable configuration template
  files/              # static files
  vars/main.yml       # high-priority variables
  defaults/main.yml   # overridable defaults
```

```yaml
- hosts: webservers
  roles:
    - nginx
    - php
```

The dividing line between defaults and vars is "put environment differences in defaults,
put values that must not change in this environment in vars" -- this is also the standard layout of the Ansible Galaxy ecosystem,
so you can map it directly when reading someone else's role.

## 5. Division of Labor with the Scripts Section: When to Stay at Scripts

Automation does not mean Ansible. The following tasks **end at script + timer**,
and bringing in Ansible is over-engineering:

- Log rotation, temp-file cleanup, and local self-monitoring on a single box;
- Logic that depends heavily on shell piping and text processing (Ansible modules are actually more roundabout for this);
- One-off migrations and stress-test scripts -- flows that are thrown away after they run.

And when these signals appear, it means it is time to upgrade to configuration management:
the same command now has three hand-typed variants across three machines;
a new hire is briefed on five steps verbally;
a postmortem finds that "only Zhang San knows how to change it".
The [Configuration Management Tools](../commands/system/configuration-management.md) page in Commands
also compares the positioning of Puppet/Chef/SaltStack --
their differences from Ansible (agent vs agentless, push vs pull) are expanded on that page,
and this page keeps only the default recommendation: **start with Ansible at 5 to 50 machines**.

Quality problems with the script itself -- quotes, loop subshells, `$@` vs `$*`,
shellcheck warnings -- all belong back to the [Scripts section](../script/README.md) and
[Script Debugging](../script/debugging.md), not repeated here.

## 6. Monitoring and Alerting Need Automating Too

Writing an inspection script is only half the job; the other half is **making it speak up when it fails**,
and it has to be handed to the scheduler in section 3, not written as a resident loop by hand:

```bash
#!/bin/bash
# check-thresholds.sh -- fired by cron/timer every 5 minutes
LOG=/var/log/system-monitor.log

# Use if/fi rather than `[ ... ] && ...`: when the condition is false the latter exits with code 1,
# making cron/systemd report the whole inspection as failed
disk=$(df -P / | awk 'NR==2{print $5}' | tr -d '%')
if [ "$disk" -gt 90 ]; then
    echo "$(date) DISK usage high on /: ${disk}%" >> "$LOG"
fi

# Use available for memory, not free (column meanings in Commands, Memory Management)
mem_avail=$(awk '/^MemAvailable:/{printf "%d", $2/1024}' /proc/meminfo)
if [ "$mem_avail" -lt 256 ]; then
    echo "$(date) LOW mem available: ${mem_avail}MB" >> "$LOG"
fi
```

The scheduling line (cron or timer, pick one):

```bash
*/5 * * * * /usr/local/bin/check-thresholds.sh   # cron version
# or a systemd timer with OnCalendar=*:0/5 (notation in 3.2)
```

Three deliberate tradeoffs, all from real pitfalls:

- **Reject `while true; do ...; sleep 300; done`**.
  It is a timer disguised as a daemon: after the process is OOM-killed the inspection vanishes silently,
  with no log boundaries, hard to restart, hard to audit.
  A single run pulled by `systemd` or cron comes with a lifecycle and logs by nature;
  short tasks should always be handed to the scheduler.
- **Confirm thresholds and channels with `command -v` first**.
  Minimal images often lack `bc` and `mail`;
  use integer arithmetic for the check (`[ ]`/`(( ))`) and a webhook for the channel for portability;
  the email vs webhook selection discussion is in
  [Commands, System Monitoring](../commands/system/monitoring.md).
- **There is no global standard for thresholds**.
  Collect a week of baseline before setting the line; numbers like 90% disk and a low `available` water mark
  must be able to answer "why this value";
  once the machine count grows, migrate these checks to Prometheus + alertmanager,
  see [Monitoring](../server/monitoring/prometheus.md).

## 7. Automating Configuration Files: etckeeper

`/etc` is the most frequently hand-edited and hardest to audit place.
etckeeper puts a Git over it: every package install/upgrade commits automatically, and changes can be diffed and rolled back:

```bash
# Installation across the three families: Debian/Ubuntu and the official Arch repos both ship it; the RHEL family has it in EPEL
sudo apt install etckeeper        # Debian/Ubuntu
sudo pacman -S etckeeper          # Arch
sudo dnf install epel-release && sudo dnf install etckeeper   # RHEL family

$ sudo etckeeper init
$ sudo etckeeper commit "initial import"
$ sudo etckeeper vcs log --oneline | head -3
```

It does not conflict with Ansible; their purposes complement each other:
etckeeper records **"what it was actually changed to"** (after-the-fact audit),
while Ansible constrains **"what it should be"** (up-front declaration).
Small teams often start with etckeeper --
the cost is one init, and it turns `/etc` from "Schrodinger's config" into a repository with history.

Containers and multi-machine orchestration belong to the [Containers section](../server/container/docker.md) and the servers section;
this page does not repeat Compose examples;
when you need "define a whole stack of services as code", read those two places first,
then come back here to pick a trigger for it (most likely a pipeline).

## 8. A Real-World Case: A Deployment Script with Backup and Rollback Awareness

```bash
#!/bin/bash
# deploy.sh -- single-box deployment: back up the current version first, then update, build, restart
set -euo pipefail

APP=myapp
DEPLOY_DIR=/opt/$APP
BACKUP_DIR=/var/backups/$APP
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"
tar -czf "$BACKUP_DIR/${APP}_${DATE}.tar.gz" -C "$DEPLOY_DIR" .

cd "$DEPLOY_DIR"
git pull --ff-only origin main
npm ci
npm run build

systemctl restart "$APP"
echo "deploy ok: $DATE"
```

The design points map to sections of this page:
`set -euo pipefail` stops at any failed step (so it does not restart a service with a half-built artifact);
`git pull --ff-only` refuses to fork, avoiding merge conflicts manufactured by an automatic deploy;
back up the current version before deploying so that **the rollback path exists from design time** --
the same discipline as [the backup page](./backup-and-recovery.md) "a restore drill is the real backup";
before `systemctl restart` run a service self-check: `nginx -t`, `sshd -t`,
`systemd-analyze verify myapp.service` (depends on the service),
and migration scripts should first do a `--check` dry-run.

The deploy.sh can be hung on a pipeline's post-receive hook (section 3.3)
or run by hand;
**do not** hang it on a once-every-five-minutes cron --
the trigger for a deployment should be a code event, not the clock.

## 9. Common Pitfalls

1. **A non-idempotent script goes straight into cron**.
   Append-style config, duplicate useradd, duplicate table creation --
   run it three times first as an acceptance test before scheduling (section 2).
2. **Output has nowhere to go**.
   cron tasks without redirection, timer tasks without checking the journal,
   and the failure is only found two weeks later. Acceptance bar: pick any day and be able to look up the last run's result.
3. **Relying on implicit state from the interactive environment**.
   crontab references a variable or `PATH` that only exists in `.bashrc`,
   so it works in the interactive terminal but fails in cron. Assign everything explicitly inside the script + absolute paths.
4. **`crontab` cannot be found on Arch**.
   No cron by default: `sudo pacman -S cronie` and enable crond,
   or switch to systemd timer -- the three-family comparison is in section 3.
5. **Changed a unit file and forgot `daemon-reload`**.
   When a timer/service does not take effect, run `systemctl daemon-reload` first,
   then `enable` + `start` (the two manage different things: one manages boot, the other manages right now).
6. **Mixed up Ansible package names/repos**.
   RHEL family AppStream is `ansible-core`, the full package is in EPEL;
   Arch uses `pacman -S ansible`; Debian/Ubuntu is `apt install ansible`.
   The typical symptom of installing the wrong package is that `ansible-galaxy` or a common collection is gone.
7. **A playbook defaults to the `shell` module**.
   `shell`/`command` cannot declare idempotency; prefer declarative modules like `apt`/`copy`/`template`/
   `service` so that `changed` means something.
8. **A `while true` resident inspection replaces the scheduler**.
   See section 6: when the process dies the monitoring dies, and it still occupies a process name that "looks like it is working".
9. **Copying pipeline keys straight from an old article**.
   Signing keys for repos like Jenkins rotate (the 2023 key was already invalid by 2026);
   the install command should always defer to the official docs at that time (what section 3.3 gives is the post-rotation form).
10. **Automated but never drilling the rollback**.
    The deployment script has a backup step, but nobody has tried `tar -xzf` back --
    consistent with the backup page's conclusion: **a flow that has been drilled is a flow that exists**.

## References

- `man cron`, `man crontab`, `man systemd.timer`, `man systemd.time`, `man at`
- cron(8)/crontab(5) online manual -- [man7.org](https://man7.org/linux/man-pages/man5/crontab.5.html)
- systemd.timer(5) -- [man7.org](https://man7.org/linux/man-pages/man5/systemd.timer.5.html)
- Ansible installation docs (with per-distro package names) -- [docs.ansible.com](https://docs.ansible.com/projects/ansible-core/devel/installation_guide/installation_distros.html)
- Ansible official documentation -- [docs.ansible.com](https://docs.ansible.com/)
- Arch Wiki - Ansible -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Ansible)
- Arch Wiki - Cron (cronie) -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Cron)
- Arch Wiki - systemd/Timers -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd/Timers)
- Jenkins installation docs (Linux packages, keys as given here) -- [jenkins.io](https://www.jenkins.io/doc/book/installing/)
- etckeeper official site -- [etckeeper.branchable.com](https://etckeeper.branchable.com/)
- Arch Wiki - Etckeeper -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Etckeeper)
- Bird's Private Recipes (Lin's Linux Administration Guide) - Scheduled tasks -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0430cron.php)
- Red Hat - Automation topics -- [redhat.com](https://www.redhat.com/en/topics/automation)
- [Scripts section](../script/README.md) (Bash syntax, debugging, and shellcheck)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [knowledge](/knowledge.md)
- [application-scenarios](/research/application-scenarios.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [ci-cd](/server/ci-cd.md)
- [ldap](/server/ldap.md)
- [README](README.md)
- [backup-and-recovery](backup-and-recovery.md)
