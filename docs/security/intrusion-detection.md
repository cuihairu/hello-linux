# Intrusion Detection

An intrusion detection system (IDS) monitors and detects malicious activity. A firewall solves "keep the bad guys out," but **not getting in** and **never having been in** are two different things: a backdoor can get in through one successful password brute-force, an upload vulnerability, or even a supply-chain update, and then quietly modify a few files. This chapter covers host-side detection on Linux -- file integrity checking, reactive banning, kernel auditing, and rootkit scanning -- and ties them into the logging system as one actionable chain.

> Content adapted from the official Fail2Ban, AIDE, auditd, and rkhunter documentation and the Arch Wiki; see the references at the end.

## Introduction

Confusing "detection" with "prevention" is one of the most expensive mistakes in security practice. Many people assume everything is fine once the firewall is installed, until one day they find a uid 0 account added to `/etc/passwd`, or a `.php` file sitting in the web directory that nobody noticed for half a year. Prevention **reduces entry points in advance**; detection **answers three questions after the fact**: was a file touched (integrity), is someone trying the door (authentication and network behavior), and what did a process do (system-call auditing). The three questions also map exactly to three different points on the attack timeline -- **integrity looks at "already landed," banning at "currently attempting," auditing at "already inside"** -- draw the timeline and the tool positions in the next five sections will not get mixed up.

There is another subtler difference in division of labor: the firewall's failure mode is "blocked the wrong thing and took the business down" (found immediately), while detection's failure mode is "nothing was detected at all" (never raises an alarm). **Silent failure** is a risk unique to detection systems -- the tool is not installed, the service is not started, the log path is wrong, the alert email went to an inbox nobody reads, and on a dashboard all of these look indistinguishable from "the system is very safe." This is why every section here emphasizes "verify the signal": check status after installing, check init after starting, run ausearch after adding a rule -- **every step must actively prove it is working** rather than assume it is. One more engineering technique worth remembering against silent failure: **make "no events" itself an observable metric** -- if a signal type is at zero for N days in a row, that is not "all is well" but "the probe may have fallen off," and the metric should trigger a health check rather than a celebration.

The detection system also has an under-appreciated property: it is the **only security layer that automatically accumulates value over time** -- the longer the logs are kept and the more continuously the baseline is maintained, the more accurate timeline reconstruction and anomaly comparison become; firewalls and encryption are more like "a snapshot of the moment they were configured." Put the other way, detection is also the layer **most afraid of interruption**: three months of missing logs in the middle means a blind spot for those three months that can never be backfilled. Those two facts together explain why this chapter treats "persist, rotate, and connect alerts" as load-bearing walls throughout rather than dumping them into an appendix.

On tool selection there is also a "coverage vs depth" trade-off worth stating up front: the four classes of tools can be installed as just two to get "basic awareness," or all four can be deployed with centralized aggregation -- the former takes an hour, the latter is a quarter of engineering work. This chapter assumes the reader gets to the former first: **make the signals exist, then optimize their quality**. Between a "deep platform" with no signals and "two tools" with no platform, always pick the latter first, because it can at least answer "was /etc touched last night."

The relationship between detection and compliance/alerting can also be drawn as a line up front, to avoid going down the wrong path later: this chapter focuses on **how to produce trustworthy signals on the host**; how signals enter a SIEM, how shift work is staffed, and how tickets are opened by severity belong to the monitoring and response system, and this chapter only handles wiring up the exits (email, webhook, journal). **The deliverable of a detection system is not a dashboard, it is "an event stream someone will act on"** -- until the exits are wired, the output of all four classes of tools is just quiet text files.

On Linux the three questions each have dedicated tools, all tightly tied to the distribution's default stack: file integrity uses AIDE, authentication brute-force uses Fail2Ban, and behavioral auditing uses auditd -- and auditd events also intersect with journald, so it is easy to get lost when querying logs. This chapter unfolds "problem -> tool -> landing," and gives the three-family installation differences at every step (on the Arch side, use `pacman -S` from the official repositories throughout, no AUR needed).

Another easily misdirected starting point is "buy a commercial IDS or start with open source." At scales from a single host to a few dozen, the coverage of the open-source trio already far exceeds "commercial products that are installed but never looked at"; commercial platforms add value through unified UI, threat intelligence, and compliance reporting, not through sharper detection algorithms. Get this chapter's chain running first -- with a baseline, banning, attribution, and alerts -- and only then evaluate platformization; reversing the order most commonly ends with a pile of agents with no filters configured and a dashboard that is forever loading.

## Why Intrusion Detection Is Needed

Three real scenarios show the cost of "prevent only, no detect":

1. **A web shell triggers no protection at all**. The attacker plants a one-liner trojan in `/var/www/html/` through an upload vulnerability; no firewall rule changes, there is no anomalous SSH login -- every alert based on "network entry" is silent. Only file integrity checking will find this extra file at the next scan.
2. **Low-speed brute-force does not look like an attack**. One SSH attempt per minute looks uneventful in the logs; but over a week that is tens of thousands. The value of tools like Fail2Ban is turning "patterns in the logs" into "automatic blacklisting," without relying on a human staring at a screen.
3. **A rootkit replaced the system binaries**. `ls` and `ps` have been swapped for versions that hide their own processes, so everything you see is "normal." rkhunter compares against a known-signature and file-checksum database and is the coarse filter for this class of scenario -- it can only find known patterns, but known patterns cover the majority of entry-level backdoors.

One viewpoint worth internalizing: **detection tools do not stop an attack from happening, they shorten the "time to discover" (MTTD)**. With a limited security budget, the "firewall + AIDE + Fail2Ban + log persistence" combination has far better cost-effectiveness than buying a commercial IDS whose alerts are never read. The three scenarios can also be reclassified by "how silent the protection was": scenarios 1 and 3 are protection that was **completely uninvolved** (no deny was triggered), scenario 2 is protection that was **involved but took no action** (logs rising, no blacklisting) -- the former forces you onto FIM/coarse filtering, the latter forces you onto reactive tooling, and **"how silent the protection was" decides which class of detection to add** rather than "what the industry recommends installing," which is far more actionable. Ranking priorities by silence level also yields a practical inference: **fill the silentest class first** -- the more alerts you already have, the more the remaining blind spots are worth filling before adding another tool to an already-covered scenario.

The value of MTTD can be felt quantitatively: for the same web shell, discovered by Fail2Ban/monitoring within 10 minutes, the loss is usually confined to a single response; discovered by accident in a quarterly audit 30 days later, the room for data theft, lateral movement, and log clearing in between is entirely different. What a detection budget really buys is **time** -- shortening the gap between an intrusion happening and someone acting. This is also why this chapter repeatedly stresses "wire alerts to a channel": a detector sitting on disk that nobody reads means MTTD equals infinity, and the strongest tool is a paperweight. MTTD and MTTA (mean time to acknowledge) are also often used interchangeably: detection solves the former, shift work and runbooks solve the latter -- the drill in section 8 of this chapter provides measurement points for both, and **teams that do not drill have both numbers as estimates**. Measurement itself can start light: put a timestamp on alert messages and have the shift group record the first human acknowledgement time, and a week later you can compute a real baseline -- **an MTTD target without measurement is just a wish**.

The three scenarios can also be mapped back onto the three families' default stacks: scenario 1 requires actively installing AIDE on all three (none ships with full FIM); scenario 2 is easier to observe first in logs on the RHEL family (auditd/firewalld run by default), while on Arch even the persistence of authentication logs must be confirmed first; scenario 3 has only signature-based coarse filtering to rely on across all three. **The default stack decides the "starting altitude," not the "ceiling"** -- regardless of distribution, if you do not actively build the detection chain, the three scenarios end the same way. Remembering the three-family differences as "starting altitude" also yields a practical inference: **on Arch you write two extra lines of persistence, on RHEL you read one more layer of type labels** -- the same chain, different missing steps, the same missing awareness.

## What This Chapter Covers

- Distinguish the responsibility boundaries of file integrity checking (FIM), host IDS, reactive banning, and the audit framework
- AIDE's initialization, check, and update flow
- Configure Fail2Ban's SSH jail, handling the three families' log path differences (especially Arch's journald backend)
- Writing auditd rules
- Being able to connect detection results into log rotation and alert chains, avoiding "detected but nobody knows"

The five goals are deliberately ordered "distinguish -> single tool -> cross-tool -> close the loop": the first two solve "do you know what is being detected," the middle two solve "can you configure it," and the last one solves "once configured, does anyone know." Most failed detection projects die on the last one -- tools complete, services green, but the alerts going into an email box nobody has logged into for three years. While reading, mark the "verification signal" at the end of each section; they correspond to the verifiable actions in the goals. The four-tool table in section 1 is the map for all later subsections; it is worth copying onto a sticky note and consulting it as you hit sections 3-5.

The operational check for having read this: given a new server, you can verify with these records that within one hour you installed the trio, completed AIDE baseline initialization, got Fail2Ban's sshd jail to appear in the status list, and could use `ausearch -k identity` to look up the change you just made to `/etc/passwd`. If all four steps run through independently, every link in the detection chain (collection, matching, attribution, response) is wired, rather than just packages being installed. The check deliberately includes "actively create a signal": a detection system without a controlled trigger cannot distinguish "no attack" from "not looking" -- these two states look identical on a dashboard.

After the check, add an oral question that tests the boundary: **why can Fail2Ban not replace a firewall, AIDE cannot replace backups, and auditd cannot replace a HIDS's real-time alerting**? Each of the three answers maps to one tool's capability ceiling; being unable to answer means you are still at the "tool stacking" stage rather than the "chain design" stage. The table in section 1 is the map for those three answers and is worth rereading before starting to configure.

## 1. The Detection Landscape: Distinguish Four Classes of Tools First

Some people understand "intrusion detection" as one piece of software, install it and be done; in fact host detection is a **combination of four classes of tools**, each answering different questions and covering different stages of the attack chain. Distinguish them first and the "positioning" in each later section will not be confused -- which is also the only way to understand why any single tool alone is not enough. Also do not conflate "host IDS" with network IDS/NIDS: NIDS watches a traffic mirror and answers "is anyone attacking," while all four classes here run on the host and answer "once in, how did the system state change" -- in enterprise environments the two complement each other, and for a personal server get this chapter solid first. The four classes can also be split once more by **signal source**: FIM and rkhunter read "the current state of the filesystem," Fail2Ban reads "patterns in text logs," and auditd reads "the kernel event stream" -- the reliability, noise characteristics, and triage entry points of the three sources are all different, so mixing them up in memory causes chaos, while organizing by source pins every tool's position immediately. Organizing by source has a byproduct too: **the triage path is pinned as well** -- for state-type problems look at the database and diffs, for pattern-type problems look at regexes and log formats, for event-type problems look at keys and `ausearch`, and the three entry points do not overlap each other.

| Class | Representative tools | Question answered | Limits |
|------|---------|-----------|------|
| File integrity (FIM) | AIDE, Tripwire | Was a critical file changed | Only sees static files, not runtime behavior |
| Reactive banning | Fail2Ban | Who is repeatedly failing attempts | Depends on log format; cannot stop someone who already has credentials |
| System auditing | auditd | Who performed which system call on what | Rules must be designed; noisy; needs periodic cleanup |
| Rootkit scanning | rkhunter, chkrootkit | Are there known backdoor signatures | Signature database lags; only good as a coarse filter |

The four classes complement rather than replace each other: AIDE cannot see "who" changed the file, and auditd can give the caller but will not tell you "what this file should have been"; Fail2Ban is effective at banning IPs, but internal lateral movement does not need brute-force at all. Complete host detection = **FIM (change) + auditing (behavior) + banning (repeated failure) + logs (timeline)**. The four classes can also be read as four "question phrasings" -- "was it changed" is FIM, "who changed it" is auditd, "who is trying" is Fail2Ban, and "what did it look like before" is the timeline's logs; **when choosing tools, look up by phrasing rather than memorizing a feature list**, which is much less likely to pick wrong.

The landing cost of the four classes is also asymmetric, worth keeping in mind when selecting: Fail2Ban shows results with almost zero configuration, AIDE needs baseline maintenance, auditd needs rule design and noise governance, and rkhunter is just a scheduled job plus signature database updates. **Investment should scale with "how sensitive the data on this machine is"** -- a public web host gets FIM and banning first, a database host holding customer data gets full auditing, and skipping levels (deploying the full set of audit rules before even knowing the log paths) usually ends with alerts turned off in the first week.

The four classes can also be understood from the attacker's perspective on coverage: entry (brute-force/exploitation) has its window compressed by Fail2Ban and the firewall; landing after entry (planting a web shell, changing config) surfaces at AIDE's next scan; persistence after landing (adding cron jobs, changing authentication files) leaves an identity-bearing evidence chain with auditd; and concealing itself (rootkit) is coarse-filtered by rkhunter. **At least one class of tool is watching every stage of the attack chain** -- this is what "defense in depth" concretely means on host detection: not seeking any single all-rounder, but seeking a state where no single point of failure leaves you fully blind.

Reading this coverage table as a "detection budget allocation table" also works: if you can only invest in one thing, most public web hosts should pick AIDE first (directly hits the web-shell scenario); if two, add Fail2Ban (keep the noise at the door so AIDE's reports are cleaner); auditd and rkhunter are the third and fourth steps when you "need attribution" and "need routine coarse filtering" respectively. **The investment order follows attack frequency, not how flashy the tool is.**

Three-family installation comparison (tools are almost all in the official repositories, and `pacman` does it in one go):

```bash
# Debian/Ubuntu -- install all at once
sudo apt install aide fail2ban auditd rkhunter
# Arch -- auditd is provided by the audit package
sudo pacman -S aide fail2ban audit rkhunter
# RHEL/CentOS/Rocky -- auditd is already there by default; the rest often need EPEL
sudo dnf install epel-release && sudo dnf install aide fail2ban rkhunter
```

Worth remembering for Arch package-name details: `pacman -S audit` installs the audit daemon (providing `auditd`, `ausearch`), not "an audit report tool"; the RHEL family's GPG-related package name is `gnupg2` -- unrelated here but part of the same security toolchain, so do not mix package names across families. After installing any tool, first confirm the executable is in place with `command -v` before talking about configuration.

The landing order for the four classes also matters: **Fail2Ban first (results in minutes, depends on logs existing), then AIDE (needs baseline init, completable the same day), then auditd (rules need designing, better fewer than garbage), and rkhunter last (just make it a scheduled job)**. Reversing this and fiddling with the full set of auditd rules first usually abandons it in the first week from excessive noise, and drags along Fail2Ban -- that "low-hanging fruit" -- as something that also never gets installed. The order reflects operational reality: the detection system is layered on incrementally, not built all at once.

When selecting, also distinguish the boundary between "open-source single-host tools" and "commercial EDR/managed detection": all four classes here are **single-host, self-sufficient, and independent of external services**, suited to personal servers, internal machines, and budget-limited teams; commercial EDR adds behavioral telemetry, cloud correlation, and threat intelligence, at the cost of fees and data flowing out. For most readers, getting this chapter's four classes solid is the highest-return path -- they cost nothing and cover the four most fundamental observation surfaces of "files, behavior, failure, backdoors"; EDR is an enhancement on top, not a replacement.

## 2. AIDE: File Integrity Checking

Among the four classes, FIM is the highest return on investment: small configuration, explainable false positives, and near-certain hits against web shells and tampering. This section explains AIDE's principle, the three-step initialization, and configuration boundaries all at once -- once the principle is understood, Tripwire or a similar tool follows by analogy. Placing AIDE first among the four is also because it is closest to the "security baseline" intuition: define normal first, then find anomalies, and this pattern is reused by auditd's `-k` attribution and Fail2Ban's filter thresholds later. The three subsections of this section can also be read as one pipeline: **2.1 understand what it compares against, 2.2 get the comparison running, 2.3 make the comparison results worth reading** -- swapping the order (racing to configure scope first, understanding the principle later) is the most common source of runaway noise.

AIDE also has an under-appreciated property: it is the **only one of the four that works offline / without a network** -- no external intelligence, no log pipeline, it just needs the local database and the filesystem to diff against. This makes it the standard answer for "how to detect tampering on an air-gapped machine"; the cost is that it can only see "what changed compared to last time," not who changed it or when -- **attribution waits for section 4's auditd; AIDE is only responsible for putting the change on the table.**

### 2.1 Principle and Positioning

AIDE (Advanced Intrusion Detection Environment) works in a naive but reliable way: **first compute the attributes of the system's critical files (permissions, ownership, hash, timestamps) once and store them as a baseline database, then recompute and diff periodically afterwards**. Any change outside your expectations gets listed. It does not care about the attack path, only about "what is different from last time" -- which is exactly why web shells, a tampered `sshd`, and a doctored `cron` cannot escape it. Picture its output as a "health checkup report of the system's vital organs": normal operations issue this report proactively (update the baseline), and an intrusion leaves uninvited anomalies in it. The principle sounds simple, but the operational difficulty lands entirely on two words: **which are "critical," and when to "update"** -- too many is noise, updating too late is noise, and updating too early may wash an anomaly clean; sections 2.2 and 2.3 unfold around those two words.

The FIM acronym (File Integrity Monitoring) describes AIDE more accurately than "HIDS": it is not monitoring "intrusion," it is monitoring **file state**. Distinguishing the two terms matters for triage -- when AIDE reports `/etc/passwd` changed, it does not know whether you ran `useradd` or an attacker added a backdoor account; **judging "normal change or intrusion" is always a human's job**, and the tool only puts the change in front of you. This is also why AIDE must be bound to a change-management process: with a change window and approval records, a diff has a control group; AIDE without a process turns every alert into Schrödinger's anomaly. Conversely, if the change process is complete enough that "every diff can be traced back to a ticket," AIDE's false-positive rate naturally drops close to zero -- **the tool's noise level is an amplifier of process maturity**, which is also the structural reason this chapter places detection after hardening and change discipline.

Its natural blind spots must also be clear: it **covers only the paths declared in the configuration** (usually `/etc`, `/usr/bin`, `/boot`, etc.), not in-memory processes and network connections; business directories like `/var/www` must be added explicitly to be checked. So "AIDE reported nothing" does not equal "the system is clean," only "the monitored files did not change." There is also a more hidden blind spot: **the time window**. Tampering between two scans, if the attacker changes it and then changes it back (exploiting only within the window), static diffing cannot see it at all -- that is auditd's job. The complementary relationship between FIM and auditing is expanded in section 4.

### 2.2 Initialization, Checking, and Updating

The three-step flow itself is only three commands, but **each step's artifact path is a cross-distribution difference point**, and also where first-time enablement most easily goes wrong -- first draw "where the database is and what points at what," then type the commands, which is far faster than the reverse trial and error.

```bash
$ sudo aideinit
$ sudo aide --init
$ ls -lh /var/lib/aide/
-rw-r--r-- 1 root root 1.2M Sep 22 10:00 aide.db.new.gz
$ sudo aide --check
```

The initialization artifact's filename/compression differs slightly across distributions (the Debian family commonly has `aide.db.new.gz`, Arch commonly uncompressed or with a self-specified path) -- `database_out` in `/etc/aide/aide.conf` is authoritative, and **when unsure, read the configuration rather than writing a path from memory**. Debian's `aideinit` is a distribution wrapper, while Arch uses the generic `aide --init`; `init` often produces a `.new` database, which must first be copied to the formal database that `database_in` points at before `--check` (or `aide -C`). The standard three steps on first enablement are: init -> install the output database as the formal one -> `--check` should show no changes. Much material treats "check right after init" as a shortcut, and the first check then reports a pile of differences -- because the check is still using an empty or old database, not because you were intruded. The handoff between the three steps is the part of AIDE most easily done wrong; on first enablement, confirm every step's database path with `ls`.

Separating the database file's "formal path vs generated path" is essentially giving the security baseline an atomic switch point: the new database is generated first, confirmed by hand or script, then renamed into effect, so a failure midway does not lose the last usable baseline. This pattern shows up in certificate rotation and key updates too (write `.new` first, then rename), and treating it as general operational knowledge is more useful than memorizing AIDE commands separately; conversely, if you save effort and overwrite the formal database directly, one failed `--init` can leave the whole site without a comparison baseline, with no error to warn you.

`--check` lists per-file attribute differences when something changed (illustrative; real output depends on your configuration):

```bash
$ sudo aide --check | head -20
The following files were changed:
 /etc/passwd
   Size : 1520 -> 1548
   Sha256 : a1b2... -> c3d4...
AIDE found differences between database and filesystem!!
```

Reading the report needs focus: **first check whether the path is within the expected change scope, then check the change type**. Large swathes of hash changes under `/usr/bin` after a system upgrade window are normal (just rebuild the baseline); an extra uid 0 line in `/etc/passwd` outside a change window is a top-tier alert. **The baseline database must be updated after every system upgrade and software package install**, otherwise the next run is all noise from normal changes and a real intrusion is drowned in it -- this is AIDE's most frequent operational incident: alert fatigue leads people to turn off the whole check. Writing "rebuild the baseline" as the closing step of the change process, at the same level as "restart the service," is the key to keeping AIDE alive long-term.

Baseline updating also needs to separate two granularities, "rebuild the whole database" versus "confirm item by item": after a full upgrade, `/usr/bin` suits a whole-database rebuild (the change itself is expected), while for a production window where only two configuration files changed, the steadier approach is to read the `--check` output by hand first, confirm every item is on the change ticket, then update selectively -- **blind rebuilding whitewashes intrusion traces together with your normal changes**, a risk more hidden than noise: if the attacker completes persistence before you rebuild, the baseline update actually clears their record. This is where reconciling the change ticket against AIDE output is worth it.

### 2.3 Configuration Points

With the principle and three-step flow both correct, AIDE can still be abandoned by the team within two weeks because of **monitoring scope and noise control** -- the configuration points are almost all about "how to make the report worth reading," not "how to monitor more files." Read this section as "report user-experience design": the reader is the on-call engineer, and their patience is one page of diffs.

Configuration design also needs to reserve a "false-positive appeal channel": every change judged normal should leave a trace back in the change ticket or the baseline update record, not just a verbal "that was me" in chat. With a searchable record, the next similar change can be auto-allowed; without a record, the same class of false positive replays verbatim at every monthly inspection -- **noise control is not a one-time tuning, it is a loop that sediments appeals into rules**.

The core of `/etc/aide/aide.conf` is "rule macro + monitored path." A rule macro bundles a set of attributes (permissions, ownership, hash, timestamps, etc.) under a name, and a path then references the macro -- this way adjusting monitoring strength only changes the macro definition, with no per-path edits:

```bash
# /etc/aide/aide.conf (excerpt)
database_in=file:/var/lib/aide/aide.db
database_out=file:/var/lib/aide/aide.db.new
NORMAL = p+i+n+u+g+s+m+c+sha256   # Rule macro: permissions/ownership/hash etc.
/boot    NORMAL
/bin     NORMAL
/etc     NORMAL
/usr/bin NORMAL
/var/www NORMAL                     # Add business directories as needed (high-incidence zone for web shells)
!/var/log                           # Exclude high-change directories, or it is all noise
!/var/cache
```

The design principle for monitoring scope: **fewer and precise beats more and noisy**. Stuffing all of `/usr` and `/var` in produces hundreds of "changes" on the first upgrade and the team loses trust fast; cover `/etc` + binary directories + business directories first, run stably for a while, then expand gradually. The `!` exclusion items are as important as the positive monitoring -- once high-write paths like `/var/log`, `/var/cache`, and package-manager caches are included, AIDE becomes a boy-who-cried-wolf that only shouts "changed again." Running it on a schedule can use cron or a systemd timer alike, and the key is **the result must be able to get out** (email, webhook, monitoring system), otherwise it is as good as not running. AIDE does not alert on its own; it only produces a diff. Wiring that diff to a channel someone watches is what closes the loop on detection.

```bash
# Check daily at 3:30 and output only when there are changes (paired with mail or external collection)
30 3 * * * /usr/bin/aide --check 2>&1 | grep -q "No differences" || /usr/sbin/sendmail -t < /tmp/aide.report
```

## 3. Fail2Ban: Turning Log Patterns into Automatic Bans

AIDE is "reconciliation after the fact"; Fail2Ban is "loss control during" -- the only one of the four classes that acts while an attack is in progress, and therefore the only one that can **hurt normal users by mistake**. This section's space is deliberately weighted toward parameters and boundaries, because Fail2Ban's configuration itself usually runs through in ten minutes; the hard part is tuning the thresholds to "block brute-force, let colleagues through." You can also read Fail2Ban as "**an automatic trigger wired to the logs**" -- the trigger's sensitivity (maxretry/findtime) and the trigger's blast radius (bantime, whole subnet or single IP) must be tuned together, because moving only one parameter necessarily tips the scale: too sensitive and you hit your own people, too wide a blast radius and one misjudgment takes down a whole network segment -- **parameters take effect as a group, and tuning discussions should be per combination.**

### 3.1 How It Works

Fail2Ban is the only one of the four classes that **detects and acts simultaneously**: it is not satisfied with recording "someone is trying" -- the instant the threshold trips, it blocks the source. This active response is both its selling point and the source of its misfire risk, which is why this section spends more space on "boundaries and parameters" than on the commands themselves. Once this is understood, tuning stops being "copy an optimal config" and becomes answering three questions: how long to ban (bantime), how many failures count as malicious (maxretry), and how wide the window is (findtime) -- the three must be calibrated together, and changing any single one tips the scale. The three parameters' defaults come from the assumption of "a human slipping while typing at an interactive SSH login"; if your entry point is an **unattended API**, failures are almost certainly malicious and maxretry can be lower; if it is an **office network behind shared NAT**, bantime must be more conservative -- **parameters follow the user profile of the entry point, not the documentation.**

Fail2Ban is a **log-driven responder**: tail the authentication log -> match failure patterns with a regex (the filter) -> once the threshold is exceeded within the window, call iptables/nftables/firewalld to ban the source IP. It creates no new detection capability; it automates "the brute-force you should have spotted in the logs anyway." This also determines its two boundaries: **when the log format changes, the filter must change with it**; and **it is completely blind to an attacker who logged in with valid credentials** (that is auditd's and a HIDS's job).

Placing Fail2Ban in the attack-chain view makes its position clearer: it acts at the **front-most "getting in the door" stage**, blocking large-scale indiscriminate scanning at the password-attempt step; once the attacker gets in the door with valid credentials, Fail2Ban's entire model ("the same source failing repeatedly in a short window") collapses -- there are no failures, only successful sessions. So it can never stand alone as a defense line and must be stacked with AIDE (changing files inside shows up) and auditd (touching sensitive objects inside leaves evidence). **Fail2Ban saves log noise, not intrusion detection itself.**

Another easily misunderstood point is ban granularity: Fail2Ban bans by **IP**, and behind a NAT there may be an entire office segment -- hitting colleagues who share the egress is a common incident, and also the reason to start `bantime` at a short value. Conversely, real attackers rotate IPs (botnets, proxy pools), and single-IP bans cannot stop organized brute-force; what is needed then is tighter maxretry, switching SSH to key login, or introducing aggregate bans by prefix/ASN -- **Fail2Ban is a tourniquet, not an immune system.**

The correct posture for configuration files is **write only `jail.local`, never edit the distribution's `jail.conf`** -- package upgrades overwrite the `.conf`, while `.local` has higher priority and belongs to you. This "distribution config vs user config" separation is common across Linux services (sshd also allows `sshd_config.d/`); remember the pattern and, before changing any software's default configuration, ask "will an upgrade wipe it out":

```bash
# /etc/fail2ban/jail.local
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log     # Debian/Ubuntu; on the RHEL family use /var/log/secure
maxretry = 3
findtime = 600
bantime = 3600
```

The three time parameters decide the jail's "temperament" and are worth tuning per business: `findtime` is the counting window (here, more than `maxretry` failures within 10 minutes triggers), `bantime` is the ban duration (1 hour for a first offense; in production it is often configured incrementally, starting from `bantime = 10m` with `bantime.increment` making bans progressively longer), and a `maxretry` that is too loose does not stop brute-force while too tight easily hits normal users sharing an egress IP. Start with conservative values, watch the logs for a week, then tighten -- far steadier than starting with a gut-feel "5 failures, ban for a day."

The three families' log path differences must be handled correctly: Debian/Ubuntu uses `/var/log/auth.log`, RHEL/CentOS/Rocky uses `/var/log/secure`, and **Arch has neither by default** (see [Logging System](../basic/log.md)) -- on Arch the authentication events live in journald, and the jail must switch to the systemd backend:

```bash
# Arch jail.local snippet
[sshd]
enabled = true
backend = systemd
maxretry = 3
```

`backend = systemd` makes Fail2Ban read the journal directly instead of a file, the standard practice on Arch; after installing rsyslog you can also switch back to a file path, but the systemd backend has one less dependency. This backend difference is also the root of why the three families' Fail2Ban documentation contradicts each other: online documentation assumes Debian's auth.log style, and if you copy it onto Arch, the service starts but the jail is empty -- **"service running" does not mean "jail working"**; you must verify the jail list and counters with the status command. After changing the configuration, restart for it to take effect and confirm the jail is running:

```bash
$ sudo systemctl enable --now fail2ban
$ sudo fail2ban-client status
Jail list:	sshd
$ sudo fail2ban-client status sshd
Currently banned:	1
Banned IP list:	203.0.113.7
```

A non-zero `Currently banned` means the whole banning chain (filter match -> firewall command invocation) is through; a high `Total failed` with zero banned usually means the filter regex does not match the current log format (common after an sshd version or log-template change); a jail missing from the list entirely means `enabled = true` was written wrong or the backend would not start. Triage follows those three steps: **first check the jail is listed, then check failed is climbing, finally check banned is nonzero.** For manual intervention use `fail2ban-client set sshd banip/unbanip` -- emergency-unbanning your own IP depends on it, and it is worth writing this command on page one of the operations manual, because on the afternoon you ban yourself, it is the only thing you will want to type.

### 3.2 Custom Filters and Multi-Service Expansion

SSH is only the starting point -- the web service on a public-facing machine is just as much a brute-force hotspot, and Fail2Ban's filter.d ecosystem has accumulated plenty of ready-made regexes. Nginx/Apache 404 probing and WordPress login attempts all have ready-made filters (under `filter.d/`), just enable them in a jail -- **every jail you enable is one more class of logs being scanned continuously**, but keep the count under control: running filters against ten low-traffic services at once costs more to maintain than it returns; prioritize the services that actually face the public internet. Custom filter regexes must use the `<HOST>` placeholder to mark the source IP, and after writing, dry-run them with `fail2ban-regex`:

```bash
$ sudo fail2ban-regex /var/log/nginx/error.log /etc/fail2ban/filter.d/nginx-http-auth.conf
Failregex: 12 total
```

`fail2ban-regex` validates the regex hit rate without banning anyone -- **regex first, then go live** is the only safe way to avoid "ban the wrong person / miss the right one." The `Failregex`/`Ignoreregex` counts it prints are the filter's unit tests: zero hits means the regex is wrong or the log-format assumption does not hold, and an abnormally high hit count means checking whether normal requests are being swept in too. Putting the `fail2ban-regex` verification step into the filter-change checklist gives every jail a regression test.

## 4. auditd: Kernel-Level Auditing and Its Handoff with journald

AIDE gives a "result snapshot" and Fail2Ban gives "automatic handling of repeated failures"; to answer "**who, in what identity, at what time, did what to which object**," you must drop down to the kernel audit layer. This section explains auditd's positioning, rules, and log ownership all at once, and incidentally resolves the common confusion when it and journald fight over logs -- the spot where three-family triage most easily turns into finger-pointing. If the previous two sections are "was the door touched, is someone kicking the door," auditd is the **bodycam footage**: it is not responsible for blocking, only for making every "it wasn't me" in the postmortem provable or disprovable. You could also say the first three sections answer "what anomaly happened," while this one starts answering "can the **attribution chain** close" -- without attribution, an alert can only trigger a costly response like "reinstall the system," never a precise one like "hold the specific operation accountable."

auditd's cost is also worth stating up front: it is the **easiest of the four to turn into noise** -- one overly broad `-a always,exit` rule can multiply log volume tenfold and drag down the disk and the search experience together. So this section's rule design sticks to "few, and with keys" -- every rule must be able to answer "why am I watching it, and which `-k` do I fish with when something happens"; a rule that cannot answer is better left unwritten. The noise-governance approach continues from AIDE excluding high-change directories; only for auditd "high change" becomes high-frequency system calls. Excessive noise brings a secondary risk: **once genuinely important identity events drown, the team habitually skips ausearch results** -- once an attribution tool is treated as a "log ocean," its value goes to zero even if the rules themselves were written correctly.

### 4.1 Its Division of Labor with AIDE

AIDE answers "the file changed"; auditd answers "**who, when, in what identity, made which system call on which object**." auditd is fed by the kernel's audit subsystem and records an event stream rather than a file snapshot, so it can catch "changed and then changed back," and also covers behavior outside AIDE's scope (opening sensitive devices, switching users). Use both together and you get the complete picture of "change + attribution."

Think of the two as two kinds of forensic notes: AIDE is the **scene photo** (afterward, compare where the differences are), auditd is the **surveillance video** (the process is continuous and replayable). The photo can show the vault door had its lock replaced; the video can show who used the key, how long the door was open, and which drawers were touched. The team that keeps only photos most often writes "files were tampered with, source unknown" in the incident report; the team that keeps only video drowns in a sea of syscalls unable to find the point -- **you need both, and both must be time-alignable.**

### 4.2 Writing Rules and Querying Events

Rules live in `/etc/audit/rules.d/*.conf`; `-w` watches a path, `-p` specifies the triggering operations (`w` write, `a` attribute, `r` read, `x` execute), and `-k` attaches a keyword for retrieval. Three identity files plus one sshd configuration is the widely accepted starter setup, with the best coverage-to-noise ratio:

```bash
# /etc/audit/rules.d/security.rules
-w /etc/passwd      -p wa -k identity
-w /etc/shadow      -p wa -k identity
-w /etc/sudoers     -p wa -k identity
-w /etc/ssh/sshd_config -p wa -k sshd_config
```

Start it (Debian/Ubuntu/Arch; the RHEL family usually already has it enabled) and search by keyword (much faster than grepping raw logs):

```bash
$ sudo systemctl enable --now auditd
$ ausearch -k identity -i
type=SYSCALL msg=audit(...) comm=useradd euid=0 name="/etc/passwd"
```

`-i` translates numeric uids into readable usernames and is nearly always worth adding during triage. The value of `ausearch -k` is that the label was planted back at rule-design time -- **a rule without `-k` is fishing in the ocean**, leaving `ausearch` nothing but a full scan. Another discipline of rule design is **watch only objects that change identity, permissions, or authentication configuration**: one rule each on `/etc/passwd`, `/etc/shadow`, `/etc/sudoers`, and `sshd_config` is enough to start; adding `-w` on `/etc/hosts` or all of `/home` makes event volume spiral out of control fast, and the extra events help attribution very little. Audit is a scarce **attribution** data source; abused, and nobody queries it anymore. Audit logs default to `/var/log/audit/audit.log` and grow fast, so rotation is mandatory (auditd's own `size` parameter in `auditd.conf`, or hand it to logrotate; see [Logging System](../basic/log.md)).

Two more steps of rule landing are easy to miss: after writing the `.conf`, make auditd reload it (`augenrules --load` or `service auditd restart`, commands differ slightly across families), and confirm the rules are really in the kernel with `auditctl -l` -- **writing the file does not mean the rule is in effect**, the same class of "dual view" trap as sysctl and firewalld permanent. On latency-sensitive machines, also mind audit's failure policy (on `disk_full`, drop events or panic): production defaults to dropping events to protect the business, but you must monitor `auditd`'s error counters, or the attribution chain silently narrows without you knowing.

### 4.3 What It Has to Do with journald

A point of easy confusion: **auditd is not a replacement for journald; the two share a data source but have different entry points**. Kernel audit events get written by auditd to its own log file; meanwhile systemd-journald has a built-in audit bridge that takes some audit messages into the journal (with `_AUDIT_`-prefixed fields). So you may see similar events in two places -- `journalctl --grep "_AUDIT_"` for the journal side, `ausearch -k` for the dedicated audit log; their timestamps agree but field completeness differs.

Practical advice: **attribution goes to `ausearch -k`; timeline stitching uses `journalctl`**. The timestamps agree, so audit keyword events can be spliced into the service-log timeline for context -- a typical triage script: see an Nginx 500 in the journal, use the same time window's `ausearch -k identity` to check whether the identity files were changed, then decide whether it is an application problem or someone touched the configuration. On the RHEL family auditd is enabled by default; Debian/Ubuntu and Arch do not install it by default -- another piece of the three families' "security stack" difference (see the three-family comparison in [Hardening](./hardening.md)).

The auditd/journald split can be remembered as "**the dedicated log handles attribution, the journal handles the timeline**": to answer "who changed shadow," always use `ausearch`; to answer "what happened to the service around the shadow change," align the two by time. Do not try to move all audit events into the journal as the sole store -- audit's volume and field structure were not designed for the journal, and forcing them together just makes both hard to query.

## 5. rkhunter and OSSEC: Coarse Filtering and a Full HIDS

The tools in the first four sections each specialize in one thing; the two in this section take the other road: rkhunter does **broad coarse filtering** with a signature database, and OSSEC does **platform-style HIDS** with a complete agent. When choosing, first ask about scale and depth needs, not feature-list length. Most single-host readers need only remember "rkhunter goes into the scheduled jobs, OSSEC goes into the bookmarks for now"; the real decision point arrives the day the fleet grows to dozens of machines and needs a unified alert panel. Compressing the two into one section is also a reminder: **a "full HIDS" is not mandatory; the coarse filter plus the first four sections' combination already covers most of a single host's risk** -- the longer the tool list, the bigger the maintenance surface, and a half-hearted platform is worse than two specialized tools used well. The two tools' failure modes are worth memorizing side by side too: rkhunter's failure is **a stale signature database causing false negatives**, OSSEC's is **rules/agents not fully rolled out causing coverage holes** -- one dies of "not fed," the other of "not spread," both silently. Coarse filtering and the full HIDS also share a positioning: both stand on the premise that the first four sections' **signals are trustworthy** -- with no persistent logs OSSEC cannot attribute either, and with a polluted baseline rkhunter's file checksums are equally distorted. That is why this section is at the end, not the beginning: it is not an importance ranking but a **dependency order** -- get the specialized tools stable first, then decide whether to go platform-first; doing it the other way around is the classic budget black hole of detection projects.

rkhunter (Rootkit Hunter) scans for rootkits, backdoors, and suspicious attributes (SUID, hidden directories) using a signature database plus known-file checksums. It is suited to being a **routine coarse filter**, not a sole defense line. It also forms a complementary pair with AIDE: AIDE compares against **a baseline you maintain yourself**, while rkhunter compares against **known-malicious signatures maintained by vendors/the community** -- the former catches "changes your machine should not have," the latter catches "bad things that have appeared on other people's machines"; scan both lines to cover configuration drift and known backdoor patterns alike (commands below):

rkhunter's common commands are short: `rkhunter --update` refreshes the signature database, `rkhunter --check` scans interactively, and `--check --sk` skips the enter-key confirmations in a script-friendly way.

Before the first scan, run `rkhunter --propupd` to record the current file-attribute baseline, or it will flag "normal file attributes" as anomalies -- the same reason AIDE needs init: **a coarse filter also needs a reference for "what normal looks like."** A signature database that is never updated is likewise useless for nothing -- put `--update` into the same scheduled job as system patching. A warning in the rkhunter report does not mean compromised: attribute changes, known-rootkit leftover entries, and suspicious kernel modules all need human review; most warnings show up in batches after a normal upgrade, and checking them one by one is far more rational than "reinstall at the first red line."

OSSEC/Wazuh is a full HIDS: log analysis + file integrity + registry-style configuration monitoring + rootkit detection, with centralized alerting. Its capability covers the first three sections of this chapter, but it introduces a daemon, a rule set, and (in the Wazuh case) separate management components, so its operational cost is clearly higher. Selection experience: **for a single host or a small fleet, the AIDE + Fail2Ban + auditd trio is enough; go to Wazuh when you have many machines and need a unified alert panel** -- have "detection awareness" first, then talk "platformization," or the platform just becomes a dashboard nobody looks at. The sensible time to upgrade from the trio to a platform is: the alert channel already has stable human response, and the per-machine baseline process is already fixed, so the platform merely centralizes the same workflow; reversed, the platform just amplifies the chaos across dozens of machines.

## 6. Connection to the Logging System

However correct a single host's detection is configured, if the logs themselves are unreliable (not persisted, not rotated, not forwarded), the whole chain's foundation is loose. This section wires the first five sections' outputs into the logging system, and is the step where the chapter transitions from "tools" to "a system" -- the full expansion of logging details is in [Basics · Logging System](../basic/log.md); here we care only about the detection-side connection points.

The detection tools' outputs all eventually return to the log chain, otherwise they are running silently. This section is often skipped as "nice to have," but it is actually the chapter's load-bearing wall: all the tools in the first five sections -- collecting, banning, attributing -- **converge into one timeline of "someone did something at some time"** -- once the timeline is severed, isolated alerts are just noise, and the postmortem cannot reassemble the full story.

1. **Fail2Ban reads logs**: depends on authentication logs existing with a stable format (section 3).
2. **AIDE/auditd produce alerts**: written to logs or pushed to monitoring, they must be consumed by a person or a system.
3. **The logs themselves must be persisted and rotated**: without journal persistence, clues are lost on reboot; without audit.log rotation, the disk fills.

The three families' differences at this link center on "where is the authentication log": `/var/log/auth.log` on Debian/Ubuntu, `/var/log/secure` on RHEL, the journal on Arch. When writing cross-distribution monitoring scripts, **use `journalctl -u fail2ban` or the tool's own status command as the liveness probe; do not hardcode log paths.** This principle generalizes to the whole detection stack: probe liveness with service state (`systemctl is-active`), not with "did the log file get new lines today," because a silent machine may simply be unattacked, not undetected.

The log chain's health check is worth fixing as three commands: `journalctl --disk-usage` to see the journal is being written, `fail2ban-client status` to see the jails are listed, and `aide --version`/the most recent check time to see FIM is still running. The output details differ across families but the semantics agree -- **whichever of these three breaks, that layer of this chapter is effectively not installed.** Log protocols, facility/severity, and rotation details are in [Basics · Logging System](../basic/log.md); this chapter does not repeat them.

## 7. Common Pitfalls

With the tools installed correctly, detection can still fail a whole layer at a time -- and the failure mode is not a crash but **everything looking normal**. The ten below are ordered from "makes a whole detection layer ineffective" to "drags the machine down." The first five share the property that **the tool looks like it is running but has no detection power**, which is more dangerous than not being installed at all, because the dashboard is all green: the on-call person does not question green lights, and the auditor only looks for red ones -- **silent failure is a failure mode unique to detection systems, and the reason this chapter keeps demanding "actively create a signal."**

1. **AIDE initialized but the baseline never updated**. Every system upgrade produces a flood of "changes," the team quickly goes numb to alerts, and a real intrusion goes unread. Rule: **rebuild the baseline after every change window**, and wire AIDE reports into the alert channel.
2. **AIDE monitoring scope too wide**. Exclude high-change paths like `/var/log` and `/proc`; go narrow first then wide, and let two weeks of noise volume decide whether to expand.
3. **Fail2Ban on Arch copying Debian's `logpath` verbatim**. Arch has no `/var/log/auth.log` by default; the jail silently fails or spins empty -- you must use `backend = systemd`.
4. **Editing the distribution's `jail.conf` instead of writing `jail.local`**. One package upgrade overwrites it, and every custom ban policy vanishes unnoticed.
5. **Banning yourself or the office subnet after going live**. Validate filters with `fail2ban-regex` beforehand, start `bantime` at a short value; and keep an emergency path with `fail2ban-client set sshd unbanip`.
6. **Audit rules without a `-k` keyword**. Events get recorded all the same, but `ausearch` cannot retrieve by topic, and afterward only a full grep remains -- equivalent to no detection design.
7. **audit.log not rotated until the disk fills**. Audit event volume far exceeds ordinary service logs and must be explicitly capped; a full disk makes auditd drop events or even drag down services that depend on disk writes -- secondary incidents from logs filling the disk are common in production, and rotation is not optional.
8. **Treating rkhunter as real-time protection**. It is an offline scanner; the window between two scans depends entirely on the other layers; with a stale signature database, not even "after the fact" can be trusted.
9. **Tool installed but the service not enabled**. `pacman -S aide`, `apt install fail2ban` only put binaries on disk; `systemctl enable --now` is when work begins -- the same old trap on all three families; see [Basics · System Services](../basic/services.md).
10. **Alerts going to an email box nobody reads**. The last link of the detection chain is "a person or a ticketing system"; failed mail delivery or an ignored inbox equals not installed.

The ten pitfalls collapse into three classes: baseline maintenance (1, 2, 8), configuration correctness (3, 4, 6, 9), and response chain (5, 7, 10). Scanning by class during self-audit finds systemic gaps faster than reciting the list item by item -- for example, discovering "two hits in the baseline class" means the whole change process was never wired to AIDE, not that AIDE itself is broken.

The three classes also map to different owners: baseline class goes to the **change process** (the release owner checks it off at close-out), configuration correctness goes to the **tool owner** (whoever introduced Fail2Ban maintains jail.local's three-family differences), and response chain goes to the **on-call and alerting platform** (the same notification channel as firewall logs and monitoring). Map the ten items onto three responsibility surfaces, and the monthly security meeting no longer needs to recite the checklist -- just ask each surface for its last check time -- **the point of classifying is to find process gaps, not to add memorization load.**

## 8. Practice: A Single-Host Detection Baseline Checklist

The first seven sections go tool by tool; this one compresses them into an execution sequence taking **one machine from zero to all three layers of signal**. The order deliberately matches section 1's landing advice, and each step's acceptance signal corresponds to the "verification" passages earlier -- the checklist is not new content, it arranges the scattered acceptance actions into a timeline. If you keep only one page from this chapter, it is these seven steps; the first seven sections exist to explain why each step "must happen at that point," and this section compresses the dependencies into a printable order. The division of labor between these seven steps and the hardening chapter's nine is also worth pinning down once more: **hardening defines "what the system should look like," this checklist defines "who is watching that it stays that way"** -- the two checklists can go into the same launch ticket, but the check logic differs: hardening items verify "effective values," detection items verify "can the signal be triggered."

Configure a minimum usable detection capability on a new server; the order cannot be reversed -- each step presupposes the previous step's output (no logs means no Fail2Ban, no baseline means no integrity checking). The checklist is deliberately designed so that **each step produces a verifiable signal**: after install you can see the binary, after init you can see the database file, after the jail starts status shows counters, and once auditd has rules you can ausearch them -- a missing signal at any step means the next layer is not really in place, without waiting for "an incident to discover it was never installed." During execution, paste each step's read-back output into the change ticket, the same discipline as the evidence line in section 9 of [Hardening](./hardening.md): **the detection baseline itself must be auditable too, or the postmortem cannot say "what was actually being checked at the time."** The printable form of the seven steps has one more design intent: **every step's acceptance verb is "can see / can query / can trigger"** -- no step's completion criterion is "the configuration file has been saved"; raising the definition of done from "wrote it" to "can prove it" is the checklist's single most central constraint.

1. Confirm log persistence (`journalctl --disk-usage` non-empty, authentication logs present or the journald backend available).
2. Install the trio: AIDE + Fail2Ban + auditd (three-family commands in section 1; on Arch use `pacman -S aide fail2ban audit`).
3. Initialize AIDE and **immediately** `--check` to confirm no differences, then put it on a schedule.
4. Write `jail.local` to enable the sshd jail, pick the right logpath/backend per distribution, and confirm the jail is listed with `fail2ban-client status`.
5. Add 2-4 auditd key-file rules (`-k identity`/`-k sshd_config`), and verify events are queryable with `ausearch -k identity`.
6. Wire AIDE reports and Fail2Ban ban events to a channel you will actually look at (email, IM webhook, or a monitoring system).
7. Run one drill: temporarily change `/etc/passwd`, run `aide --check`, confirm the change gets caught, then rebuild the baseline.

After these seven steps you can at least answer three questions: **were critical files changed, is someone brute-forcing, and who touched a sensitive file**. That is the minimum usable line for host detection -- everything after, platformization and centralization, is additive scaling on top of this base.

The checklist, section 8 of [Firewall](./firewall.md), and section 9 of [Hardening](./hardening.md) are **three segments of one launch pipeline**, and the suggested order is: hardening inventory and patching -> firewall close-out -> detection go-live. Detection comes after the firewall because Fail2Ban's ban action depends on a usable firewall backend; hardening comes first because the detection baseline (AIDE) is best initialized while the system's contents are relatively stable -- reversed, either the jail cannot invoke the backend or the baseline is washed into noise by patch changes right after being built. Used together, the three checklists cover the three observation surfaces of "state, traffic, events"; missing any one leaves a blind spot in the postmortem.

Step 7, the "drill," is the easiest to skip and the best at exposing configuration problems: creating one controlled change by hand and verifying the alert actually fires is more reliable than reading the documentation ten times. The drill is also testing the last few meters of the alert chain -- did the AIDE report actually send, can the Fail2Ban ban be seen, did the person on call get notified. **An undrilled detection system should be assumed to fail on the exact day you need it most** -- the same discipline as the encryption recovery drill (see [Encryption](./encryption.md)). Set the drill frequency at the same level as the patch cycle: one small-change verification monthly, one full-chain tabletop exercise quarterly.

## References

This chapter's toolchain spans the user space and the kernel, so the references are also layered: AIDE/Fail2Ban/rkhunter are user-space tools with documentation on their respective sites; auditd rule syntax is authoritative in the Linux kernel documentation (distribution manuals often lag); and the Arch Wiki's Fail2Ban/AIDE entries are the clearest on the journald backend and package-name differences, making them the first cross-distribution triage reference. The suggested approach is to read the Arch Wiki entry for a tool first to build the big picture, then check parameter details against the official documentation.

Fix a lookup order for triage too: **first check this chapter's "verification signal" for the section, then the Arch Wiki for distribution differences, and only then the upstream man page.** Most "detection not working" problems stop at step one (service not started, jail missing, baseline not initialized), a few at step two (log path, package name, backend); the cases that genuinely need the man page are the minority involving rule syntax. Write these three steps into the runbook and a newcomer can self-check most chain problems within ten minutes -- the way this chapter's documentation is consumed should itself be layered like detection, not re-read from the top every time.

- `man aide`, `man fail2ban-client`, `man auditctl`, `man ausearch`, `man rkhunter`
- AIDE official documentation -- [aide.github.io](https://aide.github.io/)
- Fail2Ban documentation -- [fail2ban.org](https://www.fail2ban.org/)
- Arch Wiki - Fail2Ban -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Fail2ban)
- Arch Wiki - AIDE -- [wiki.archlinux.org](https://wiki.archlinux.org/title/AIDE)
- auditd / Audit documentation (kernel) -- [docs.kernel.org](https://man.archlinux.org/man/auditctl.8)
- OSSEC documentation -- [ossec.net](https://www.ossec.net/docs/)
- rkhunter manual -- [sourceforge.net](https://rkhunter.sourceforge.net/)
- Bird's Private Recipes (Lin's Linux Administration Guide) - Account and Permission Management -- [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0210filepermission.php)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [coverage-matrix](/research/coverage-matrix.md)
- [README](README.md)
- [firewall](firewall.md)
- [hardening](hardening.md)
- [pam-sudo](pam-sudo.md)
- [ssh](/server/ssh.md)
