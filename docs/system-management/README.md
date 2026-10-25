# System Management

Once the system is installed and commands are second nature, what actually separates a good administrator is three unglamorous things:
**what state is this machine in right now (observation), what do you do when data is gone (backup), and how do you stop typing the same work by hand twice (automation)**.
This section revolves around those three: Performance, Backup and Recovery, and Automation form the mainline;
Scheduled Tasks, systemd Services and Programs, Logging, and Boot Process and Troubleshooting
are the four pages you inevitably land on when the mainline becomes day-to-day work.
The three share one underlying logic -- look at the facts first, design the response second, and finally harden the response into a repeatable mechanism.
Drop the first link and tuning is gambling, backup is a placebo, and automation just batch-replicates the error;
drop the last two and observation and experience stay locked in personal memory, never settling into team assets.

> This section follows a "why first, how second" style: the concept paragraphs at the start of each chapter are as important as the commands that follow;
> examples carry real terminal output wherever possible; tool installation sections give the three-family
> (Debian/Ubuntu, Arch, RHEL/CentOS/Rocky) comparison;
> where a version difference is uncertain, leave it out rather than mark it "verify against your version".

## Overview: Why These Three Belong in One Section

Performance, backup, and automation look like separate domains on the surface but are one causal chain in day-to-day operations.
When the server "gets slow", the first step is not tuning a parameter but using observation tools to prove whether the bottleneck is CPU, memory, or disk
-- that is the job of [Performance](./performance.md);
when business data "is gone", being able to recover it presupposes that at least one copy was taken by policy long ago
-- that is the job of [Backup and Recovery](./backup-and-recovery.md);
and a schedule like "run the backup script by hand at 2am every Wednesday" will sooner or later break from one lapse in the on-call rotation
-- that is the job of [Automation](./automation.md):
hand the action to cron or systemd timer, hand multi-machine configuration to Ansible,
and let humans only look at results and handle exceptions.

In reverse, the three also constrain each other:
only with backup discipline do you dare to tune boldly (a bad change can roll back);
without automation, neither backup nor inspection can guarantee frequency;
without observation data, you do not even know what to back up or what to tune.
This is also why the subpage order is "Performance -> Backup -> Automation":
**look at the state first, protect the data second, and finally hand repetitive work to the machine**.

## Content Index

These pages are ordered by performance observation, data protection, automation, and day-to-day operations; each part comes with operations you can verify in the terminal:

1. **Observe**: in [Performance](./performance.md),
   work through the decision path of the "load / memory / IO" triangle,
   understand why "observation comes before tuning",
   and the two most-misread metric pairs: `load average` vs CPU%, and `available` vs `free`.
   Single-command syntax is a quick lookup in [Commands: System](../commands/system.md);
   this page focuses on "reading the conclusion".
2. **Build a safety net**: read [Backup and Recovery](./backup-and-recovery.md),
   understand what each number in the 3-2-1 strategy guards against,
   distinguish the boundaries of rsync mirror sync, hard-link snapshots, and whole-disk images,
   and actually run a restore drill yourself -- **a backup never drilled is no backup at all**.
3. **Hand it to the machine**: read [Automation](./automation.md),
   judge the line between "write a script" and "use Ansible",
   understand why idempotency is the lifeline of automation,
   and make a reasoned choice among cron, systemd timer, and pipeline.
4. **Land it in daily work**: read [Scheduled Tasks](./scheduled-tasks.md)
   and [systemd Services and Programs](./services-systemd.md),
   turn the plan chosen in the previous stop into crontab entries, timers, and unit files;
   then use [Logging](./logging.md) to answer "what did they actually do",
   and [Boot Process](./boot-process.md)
   to handle the last-resort question "why did not it come up after the reboot".

When time is short, I check Performance's "observation first" and "common misreadings", and Backup's 3-2-1 and restore drill; they cover the judgment biases that crop up most often in day-to-day troubleshooting.

In real work, this content surfaces by scenario: check monitoring and inspection results daily, verify backups and restore drills when taking over data, evaluate Ansible and timer once the machine count grows, and look up scheduling and logs while on duty. Settling conclusions into your environment's own checklist beats flipping through docs repeatedly.

## Reading the Subpages

| Chapter | One-Line Guide | For Whom |
|---------|----------------|----------|
| [Performance](./performance.md) | why observation comes before tuning, the load/memory/IO triangle, common misreadings of `load` vs CPU% and `available` vs `free`, the USE method, and evidence-based tuning | people tortured by "the server is so slow" |
| [Backup and Recovery](./backup-and-recovery.md) | what each number in 3-2-1 guards against, rsync incremental vs hard-link snapshots vs whole-disk images, a restore drill is the real backup, and cron vs timer scheduling differences across the three families | people responsible for data safety |
| [LVM](./lvm.md) | the PV/VG/LV three-layer model, creating volumes and growing/shrinking, snapshot rollback, pvmove to swap disks, and the stack order with RAID/LUKS | people who need to grow a disk online, take snapshots, or swap disks |
| [Automation](./automation.md) | when to write a script vs when to use Ansible, why idempotency matters, cron vs timer vs pipeline, and the division of labor with the Scripts section | people who want to hand off repetitive labor |
| [Scheduled Tasks](./scheduled-tasks.md) | how to choose among at/cron/systemd timer, crontab syntax and logs, anacron as a backstop, and timer units in practice | people who want the machine to run work on time |
| [systemd Services and Programs](./services-systemd.md) | unit structure and dependencies, targets, journal integration, resource control, and systemctl troubleshooting | people stuck on systemctl/journalctl |
| [Logging](./logging.md) | journald persistence and querying, rsyslog filtering and forwarding, log rotation and centralized collection | people who need to know "what happened yesterday" |
| [Boot Process](./boot-process.md) | the full chain firmware -> GRUB -> initramfs -> systemd, locating and rescuing failed boots | people who cannot boot and need it back |

The seven pages can be read independently, but dependencies exist:
Performance's observation conclusions decide the backup window (do not run full backups at peak hours),
Backup's scheduling choice directly reuses Automation's cron/timer knowledge,
and Automation's script quality in turn depends on whether you have formed the "measure first" habit Performance insists on.
The other four pages center on day-to-day execution:
Scheduled Tasks turns Automation's choices into crontab and timer entries,
the systemd page explains under what identity those tasks run,
Logging answers "did they succeed",
and Boot handles the last-resort "why did not it come up after the reboot".
Reading with the question "how does the previous page's conclusion constrain the next" sticks far better than memorizing commands in isolation.

> Content draws on the Arch Wiki, Bird's Private Recipes (Lin's Linux Administration Guide), and each tool's official documentation -- see the references in each chapter.

## What This Section Covers

- Understanding "observation comes before tuning"
- The meaning of each number in the 3-2-1 backup strategy
- Running a restore drill independently
- The division of labor among cron, systemd timer, and pipeline
- Drawing the line between "write a script" and "use Ansible"
- Installing sysstat, rsync, Ansible, and the like across the three distro families

## Division of Labor with Other Sections

The boundaries between this section and the others are below; where there is overlap, the owning section is authoritative:

- **With [Fundamentals](../basic/README.md)**:
  service units, log rotation, and package management concepts are "what they are" in Fundamentals;
  this section is "how to use them" in observation, backup, and scheduling scenarios.
- **With [Commands: System](../commands/system.md)**:
  single-command syntax and output interpretation for `ps`/`free`/`vmstat` and the like live in Commands;
  this section's Performance page only adds the "triangle decision" and "misreading corrections" on top,
  without rehashing every column meaning at length, and gives cross-references when needed.
- **With [Scripts](../script/README.md)**:
  the Scripts section covers Bash syntax, debugging, and shellcheck;
  this section's Automation page covers **selection and scheduling** -- what deserves a script, what belongs to Ansible,
  and who executes what is written. The principle: look up syntax in Scripts, look up architecture here.
- **With [Servers](../server/README.md)**:
  deploying and tuning specific services such as Nginx and MySQL lives in Servers;
  this section only shows generic actions like a database export in backup examples.
- **With [Security](../security/README.md) and [Network](../network/README.md)**:
  hardening baselines and firewall policy live in Security, connectivity troubleshooting in Network;
  when this section's backup touches encryption it only covers GPG usage -- go back to Security for security policy design.

## Three-Family Management Tools at a Glance

The same management task often means different package names and default states across the three families.
The table below is the "install base table" this section reuses throughout, collecting the three-family package names and default states for the high-frequency tools;
each subpage still gives its own three-family install comparison in its tools section
(Performance section 6, Backup section 4.1, Automation section 4.1),
and adds family-specific tools not listed here such as borg, rclone, bpftrace, and cpupower, plus the "one more step after install" --
where the two disagree, the subpage is authoritative:

| Task | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Performance stats (iostat/sar/mpstat) | `sudo apt install sysstat` | `sudo pacman -S sysstat` | `sudo dnf install sysstat` |
| Dynamic tracing (bcc toolset) | `sudo apt install bpfcc-tools` | `sudo pacman -S bcc bcc-libbpf-tools` | `sudo dnf install bcc-tools` (verify with `dnf search bcc` before install) |
| Real-time monitoring `htop`/`iotop` | `sudo apt install htop iotop` | `sudo pacman -S htop iotop` | `sudo dnf install htop iotop` |
| File sync / incremental backup `rsync` | `sudo apt install rsync` | `sudo pacman -S rsync` | `sudo dnf install rsync` |
| System snapshots Timeshift | `sudo apt install timeshift` (universe) | `sudo pacman -S timeshift` | `dnf install epel-release` first, then `dnf install timeshift` |
| Scheduled tasks cron | `cron` is installed and enabled by default on the base system | Not preinstalled: `sudo pacman -S cronie` then `systemctl enable --now crond`, or use systemd timer directly | `cronie` is installed and enabled by default |
| Modern timers systemd timer | systemd is preinstalled, universal across the three families | Same as left | Same as left |
| Configuration management Ansible | `sudo apt install ansible` | `sudo pacman -S ansible` | `sudo dnf install ansible-core` (AppStream; the full `ansible` package is in EPEL) |

Three frequent misreadings are worth clearing up at the start.

**There is no `apt` on Arch; install packages with `pacman -S` only**.
This section writes Arch install actions uniformly as `sudo pacman -S package`;
when unsure of a package name, search with `pacman -Ss keyword` first,
Debian/Ubuntu uses `apt search`, the RHEL family uses `dnf search`.
Once all three families are installed, verify the command is really available with `command -v tool`,
which is far more reliable than remembering "preinstalled or not".

**"Preinstalled" does not mean "collecting/enabled"**.
Debian/Ubuntu's `sysstat` does not start collecting after install by default (you must change `/etc/default/sysstat`),
installing cron does not mean your tasks are scheduled,
and installing Timeshift does not mean the snapshot schedule is on --
every "one more step after install" in this section is called out explicitly.

**The RHEL family's `ansible` and `ansible-core` are not the same thing**.
AppStream provides only the minimal `ansible-core`;
the full `ansible` package with community collections is usually in EPEL.
The Python versions on both the controller and the managed side also need checking against the Ansible support matrix --
this is the most common reason for "installed but will not run" in mixed three-family environments.

## Reading Conventions

- **Real output first**: example output comes from typical development/LAN environments;
  different numbers on your machine are normal, focus on the field structure and the reasoning to the conclusion.
- **Why before how**: concept paragraphs matter as much as commands;
  skipping concepts to copy commands directly leaves you without judgment when things go wrong.
- **Do not write what is uncertain**: deprecated parameters and behaviors that depend on a specific kernel version are left out,
  or explicitly marked "verify against your version".
- **Cross-reference instead of repeat**: lookup material like column meanings and command syntax points to the Commands section;
  this section keeps only the "how to reach the conclusion" part.

"Experience posts" in operations age extremely fast:
kernel parameters popular ten years ago may be harmful today,
and a command may have been removed in a newer version.
This section keeps only principles and mainstream tools that survive version changes.
When in doubt, go back to the corresponding man page (`man rsync`, `man systemd.timer`, `man crontab`) --
that is always more reliable than search engine results.

## References

- Bird's Private Recipes (Lin's Linux Administration Guide) - System management unit -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/)
- Arch Wiki - System maintenance -- [wiki.archlinux.org](https://wiki.archlinux.org/title/System_maintenance)
- Arch Wiki - Pacman (Arch package habits) -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- Arch Wiki - Improving performance -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Improving_performance)
- Brendan Gregg - Linux Performance Methods -- [brendangregg.com](https://www.brendangregg.com/linuxperf.html)
- RHEL 9 Monitoring and managing system status and performance -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/monitoring_and_managing_system_status_and_performance/index)
- rsync official documentation -- [download.samba.org](https://download.samba.org/pub/rsync/rsync.html)
- Backblaze - The 3-2-1 Backup Strategy -- [backblaze.com](https://www.backblaze.com/blog/the-3-2-1-backup-strategy/)
- systemd.timer(5) -- [man7.org](https://man7.org/linux/man-pages/man5/systemd.timer.5.html)
- Ansible official documentation -- [docs.ansible.com](https://docs.ansible.com/)
- `man crontab`, `man rsync`, `man tar`, `man systemd.timer`

<!-- BACKLINKS-AUTO -->
## Related Pages

- [coverage-matrix](/research/coverage-matrix.md)
