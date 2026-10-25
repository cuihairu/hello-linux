# Firewall

A firewall is the first line of defense for network security, used to control network traffic. This chapter takes the **security-policy perspective** on firewalls: not just "how to open a port," but "what should be denied by default, how to design an allowlist, why rule order matters, and where to look at denied traffic." For the daily quick reference on opening ports, see [Network · Firewall](../network/firewall.md) -- the two chapters are meant to be used together.

> Content adapted from the Arch Wiki, the netfilter manual, the firewalld documentation, and real operations experience; see the references at the end.

## Introduction

The firewall comes first in this chapter not only because "it takes effect before the attack happens," but because it is the **only layer whose output can be read directly as audit evidence**: the printed results of `ufw status`, `firewall-cmd --list-all`, and `nft list ruleset` are the machine's current declaration of its exposure. When someone new takes over, reading them once is enough to reconcile the state. The later layers' output is either logs (which need interpretation) or configuration files (which need you to infer the effective value); only the firewall's state is almost self-explanatory -- build this self-explanatory gate first, then layer on the layers that need interpretation, and the learning curve stays smooth. This "build the self-explanatory one first, then the one that needs interpretation" order is also the hidden thread running through the whole security chapter: firewall, then hardening, then detection, then encryption, with auditability decreasing step by step and the reader's prerequisite knowledge increasing step by step. You can also read the four layers as four forms of evidence: **state, inventory, timeline, and key material** -- the firewall gives state, hardening gives inventory, detection gives a timeline, and encryption manages keys; only the four pieces put together make a complete statement of security posture.

This chapter assumes you already have the Network chapter's basics (ports, protocols, the concepts of listening and connecting) and will not expand on command details; if you are still unfamiliar with the output of `ss -tulnp`, go read [Network · Firewall](../network/firewall.md) first and come back, or the "verification" steps in sections 3-5 will be hard to follow. The symptoms of missing prerequisites are very concrete: seeing "allow 22" you do not think of there being one more LISTEN in `ss -tulnp`; seeing "denied" you do not know where to look at dropped-packet counters -- **the verification steps depend on the Network chapter's observation tools; this chapter only supplies the policy half.**

One concept easily confused with the firewall is the **cloud security group**: it is another layer of filtering implemented by the cloud provider on the virtual switch, with a similar rule model (inbound/outbound allowlist) but managed from a console rather than traveling with the host image. The host firewall covered here and the security group must be **configured together and cross-checked** -- host-side deny plus security-group allow is safe (a double gate), but host-side allow plus security-group deny will waste half a day of "I clearly allowed it" troubleshooting. Writing both layers into the configuration repository is the new default action for firewall operations in the cloud era.

## The Firewall's Place in Security Policy

A freshly installed Linux server often defaults to "block nothing": all ports reachable from outside, forwarding unrestricted, outbound unrestricted. The moment it touches the public internet it will have its open ports mapped out by scanners within minutes -- if the database or debug ports you casually installed happen to be exposed, exploitation is only a matter of time. This is the problem the firewall solves: at the kernel level (netfilter) it decides for every packet **allow or drop** by rule, compressing the attack surface from "the whole machine" down to "the few ports explicitly declared."

It is worth establishing a sense of scale first: public research and incident postmortems repeatedly show that the starting point of many "major breaches" does not require a zero-day, but rather **a port that should never have been open meeting a service that was not patched**. Redis with no authorization, a database exposed with a weak password, an admin panel open to the entire internet -- the common thread in these cases is that the firewall layer could have stopped it for free, but it was skipped because of "ship it first, worry later." The firewall is the layer of security investment with the **highest return per unit cost**: it does not require changing business code, it does not require buying a license, it only requires that you spend ten minutes before going live thinking through the default policy.

The three-family differences are not just about command names; they also reflect each distribution's trade-offs on default protection. The specific default tools and states are in the table below. Taking one family's commands and running them on another is, at best, a `command not found` error and, at worst, locking yourself out of the machine in a remote session. Understanding each family's orientation matters more than memorizing three sets of commands.

Putting the firewall first in this chapter is not because it is the most "advanced," but because **it is the only layer that takes effect before the attack happens**: intrusion detection can only alert after the fact, encryption only matters once data is accessed, and a hardening baseline takes time to put in place step by step -- only the firewall, the moment you press enter, blocks packets that do not conform to policy outside the protocol stack. Build this gate first and the workload of the later three layers drops significantly: with no brute-force traffic, Fail2Ban's alerts are far quieter; with no irrelevant ports, the patching pressure surface is smaller too. **Firewall denial logs are the first-hand signal of "someone is at the door"** -- they feed section 6's log connection and supply the backend for the detection chapter's Fail2Ban -- have this coarse pre-filter first and the fine-grained tools downstream will not be drowned in internet-wide scan noise from the start.

Three unavoidable real-world scenarios:

1. **Public brute-force**. Once the SSH port is exposed, `journalctl -u sshd` turns up hundreds of `Failed password` lines every hour. Banning IPs treats the symptom; the firewall limiting SSH to the office subnet or switching to a non-default port treats the cause -- this is policy design, not a simple allow.
2. **A debug port forgotten and left open**. Redis on 6379, a database on 3306, opened to the whole internet for convenience during development and nobody remembers to retract them after launch. A default-deny plus explicit-allowlist policy turns these oversights into "a business error" rather than "a data breach," and the problem surfaces in front of you immediately.
3. **A server used as a jump box**. An unrestricted FORWARD chain and outbound policy turn a compromised host into a springboard into the internal network. A security-perspective firewall governs not only inbound traffic but also forwarding and (when necessary) outbound.

These three scenarios map respectively to the classic attack surfaces of inbound exposure, policy omission, and lateral movement, and they preview this chapter's three focus sections: default-deny policy (for scenario two), zone/rule model (to make scenario one manageable), and forward plus outbound control (for scenario three). Read with this question in mind -- "my current machine, which of these three does it hit?" -- most people will find all three.

Another under-appreciated scenario is a **cloud "two-layer wall" configured only one layer**: the security group (the cloud provider's virtual firewall) and the host firewall are two independent gates, and the `0.0.0.0/0` rule opened in the console for temporary debugging often survives longer than the ufw configuration on the host. When triaging exposure you must check both layers -- checking only the host policy misses the security group's open-all entries, and vice versa. Bringing both layers under configuration-repository management is the only reliable way to eliminate these "ghost rules."

Lin's material likens the firewall to a building access control: **default deny = no badge, no entry; allowlist = issue a separate card for each role that needs to come and go**. Order matters just the same -- issuing cards before enabling access control, or enabling access control before issuing cards, decides whether someone (including you) gets locked outside.

There is also a point easy to overlook: the firewall is a **kernel-space** decision, not a "suggestion" from some userspace program. netfilter hooks into the protocol stack, so packets are already adjudicated before they reach your process -- this means a firewall misconfiguration has more direct consequences than an application misconfiguration (cannot connect means cannot connect, there is no degradation path), and it also means the firewall cannot save you from an application-layer vulnerability (port 80 is allowed, SQL injection happens all the same). Treat the firewall as "reduce the exposure surface," not "universal protection," and the division of labor in the later chapters will not get muddled.

### Division of Labor with the Network Chapter

The same ufw command appears both here and in [Network · Firewall](../network/firewall.md), but the reading goal differs: the Network chapter is organized around "I want to open port 80, what do I type," a **quick reference for operations**; this chapter is organized around "what is this machine's default policy, why is it designed this way, how to verify and leave a trail," a **policy design** guide. The first time you configure a firewall, read this chapter first to build the model, then flip to the Network chapter directly for daily port openings; for problems like "the port is clearly open but I cannot reach it," it is worth going through both chapters' checklists (host policy, cloud security group, and zone binding -- all three can block you). The division of labor can also be remembered as "**the Network chapter manages connectivity, this chapter manages boundaries**" -- connectivity problems are located with `ss`/`ip`/`ping`, boundary problems with `ufw status`/`nft list ruleset`; mixing up the observation tools will misdiagnose a policy problem as a routing problem and vice versa.

## What This Chapter Covers

- Explain the three families' default firewall differences (ufw / firewalld / nftables) and each one's applicable scenario
- The zone and rule-chain models
- Get the "allow first, then enable" iron rule to avoid a remote lockout
- Design a default-deny plus allowlist server policy, with logging and rate limits configured
- Know how rules persist, and the connection points with Fail2Ban and the logging system

Of the five goals the first two are "understand the current state" and the last three are "change to the correct state" -- which is also the ordering logic of this chapter's sections: first build the vocabulary and model (section 2), then land it on the three front ends respectively (sections 3-5), and finally add observation and acceptance (sections 6-8). If you only read and do not practice, the place you get stuck most easily is section 2's policy vocabulary; after reading section 2 it is worth finding a VM and actually configuring a default deny and one business port. The goals themselves can also be split three ways -- "read output / change state / verify result": only someone who can read `nft list ruleset` is qualified to write rules; only someone who can read back and verify is qualified to `enable` in production -- **changing before understanding the current state is the common precondition for every self-lock pitfall in this chapter.** The three front ends in sections 3-5 do not all need to be mastered at once, but **at least one needs to have its verification steps memorized**, with the other two readable -- depth-first comes closer to the real needs of an on-call shift than a shallow sweep across all of them.

For practice, a snapshot-capable VM is recommended: the self-lock pitfall in section 3.1 costs a lot on physical machines or non-rollback-able cloud hosts, and a snapshot turns "lockout" into a replayable experiment -- better than reciting "allow first, then enable" a hundred times in your head. After finishing section 3, run sections 4 and 5 through once each, and lock yourself out by hand on all three front ends (then restore from snapshot); your memory of the ordering discipline will run deeper than any warning popup.

The operational check for having read this chapter: given a brand-new VM from any of the three families, you can verify with these records that, **without locking yourself out**, you set default-deny inbound, allowed SSH and business ports, turned on dropped-packet logging, and can explain the current policy to a colleague with a single read-back command. If you cannot read back and explain, the policy still lives only in your memory and has not become auditable configuration.

## 1. Three-Family Default Firewall Differences

Conclusion first, then why this table is worth memorizing: **which distribution you are on decides your first set of firewall commands, your first configuration file path, and "whether this machine leaves the factory already protected."** One of the most common incidents in cross-distribution operations is taking `firewall-cmd` from RHEL documentation and running it on Ubuntu, or applying Ubuntu's `ufw enable` flow to a machine that is already running firewalld -- when two managers coexist, rules can overwrite each other and triage becomes extremely painful. This table is also worth memorizing together with the "cloud security group": the host side is only the first gate, and **on the cloud there is another gate that does not travel with the image**; the three-family differences solve "which commands to use on the host," and the security group solves "does this machine even exist" -- only the two layers stacked make a complete inbound path.

| Item | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|--------|---------------|------|-------------------|
| Default solution | Ubuntu: `ufw` installed, **not enabled by default**; Debian servers often not preinstalled | None; pick `nftables`/`iptables`/`ufw` yourself | `firewalld` installed and enabled by default |
| Front-end command | `ufw` | `nft` (kernel-native), `iptables` (Arch defaults to the nft backend) | `firewall-cmd` |
| Underneath | iptables/nftables | nftables (or the compatibility layer) | nftables (RHEL 8+) / iptables (RHEL 7) |
| Persistence | `ufw` saves automatically to `/etc/ufw/` | `nftables.service` reads `/etc/nftables.conf` | firewalld's configuration store is persistent automatically |
| Install command | `sudo apt install ufw` | `sudo pacman -S nftables` | `sudo dnf install firewalld` |

Confirm each family's starting point first, because this step decides how all your later commands are written. On Debian/Ubuntu, ufw is usually installed with the system but sits at `Status: inactive` -- it is installed but has not taken over traffic, which is direct evidence of "block nothing by default"; on Arch nothing is preinstalled, so you actively run `sudo pacman -S nftables ufw` to put the tools into the system; on RHEL/CentOS/Rocky it is the opposite -- `systemctl status firewalld` is `active (running)` and `enabled` out of the box, so it protects from boot. The same "check the firewall" action gives three completely different first impressions across families; this is not an operator error but a difference in distribution security policy.

If you choose `iptables` rather than `nft` on Arch, note that since 2018 the official Arch repository's `iptables` package defaults to linking against the nft backend (`iptables-nft`): the syntax is unchanged but the underlying engine is already nftables -- the relationship between `iptables-save` output and the kernel's actual rules is worth paying attention to. For new production installs it is better to learn `nft` directly, with more concise syntax and a kernel-native interface. This difference also explains why the Arch Wiki labels the iptables entry a "compatibility layer": you are writing old syntax while the kernel runs a new engine, and the two debugging tools are not interchangeable (`nft monitor` reflects reality better than `iptables -L -v`).

Three selection heuristics: **use ufw for cloud hosts / single-role services** (few rules, low mental load); **use firewalld for multi-NIC, multi-zone enterprise boundary machines** (the zone model naturally fits "one set for the internal NIC, another for the external NIC"); **use nftables for gateways that need fine-grained control of forwarding/NAT/rate limits** (most expressive, but you write the configuration file yourself). All three share netfilter underneath; there is no "which is safer," only "whose policy model fits this machine better." What really makes the difference is **whether you thought through the default policy**: an nft configuration full of allow rules with `accept` as the policy is not much safer than a machine with no firewall; conversely, even with just ufw's three default rules, if you allowed SSH before enabling, the attack surface has already shrunk by an order of magnitude. The tool is the carrier; the policy is the substance -- which is also why this chapter is organized "policy -> implementation -> verification" rather than as a "command reference."

## 2. The Security Policy Model: Default Deny and Allowlist

No matter which front end you use, the core of a security policy is three sentences. These three sentences are distribution-independent and are the only master document when translating into the three front ends (ufw/firewalld/nftables) -- **write the three sentences clearly on paper first, then translate into syntax**, which is far safer than copying from a manual line by line as you go:

1. **Deny inbound by default** -- any port not explicitly allowed is dropped.
2. **Allowlist rather than denylist** -- the allow list is short and auditable; a denylist can never keep up with scan sources.
3. **Stateful matching** -- allow "established connections" so you do not write a rule for every reply packet.

The nftables expression of the same is: `policy drop` + `ct state established,related accept` + `accept` for each business port. ufw's out-of-the-box default policy happens to be `deny (incoming), allow (outgoing)`, which is also one reason it is "not enabled by default" -- once `ufw enable` runs, any port that was not allowed becomes unreachable immediately.

Spread these three sentences out into a comparison table so they can be cited directly when writing a policy document:

| Concept | One-sentence definition | Anti-pattern (denylist thinking) | Where it lands in the three families |
|------|-----------|---------------------|---------------|
| Deny inbound by default | Drop if not explicitly allowed | "Get the service running first, think about security later" | `policy drop` / `deny (incoming)` / zone default |
| Allowlist | List only the ports/subnets that need to come in | "Block the few IPs that scan the hardest" | Per-port `accept` / rich rule / ufw allow |
| Stateful matching | Reply packets of established connections are allowed automatically | Hand-write a reverse rule for every reply | `ct state established,related accept` |
| Minimal exposure surface | Open only the ports the business truly needs | Open debug ports to `0.0.0.0/0` for convenience | Source restriction + alignment with the cloud security group |

### 2.1 Why Default Deny

The essence of default deny is **treating "unknown" as "dangerous"**: when a new service goes live, a new vulnerability is disclosed, or a new scan source appears, the policy does not need to react on the spot -- they were dropped all along. The denylist model is the exact opposite: every new threat requires a manual rule addition, so the security waterline always lags the attack surface. Lin, in the access-control analogy, stressed the same point: a building does not start checking badges because "there have been more burglars lately," it simply does not let anyone in without a badge from day one.

There are two under-appreciated benefits from an operations angle. First, **default deny makes configuration self-explanatory**: the output of `ufw status` or `nft list ruleset` is this machine's "declared exposure surface," and a newcomer can establish the trust boundary by reading the policy once, without first understanding where each legacy ACCEPT came from. Second, **it exposes mistakes as failures rather than vulnerabilities**: a forgotten port immediately reports "cannot connect," forcing you to add the rule; a forgotten port under an all-allow configuration lies quietly on the public internet and may only be found months later in a scan report. In security design, "fail fast" is far more valuable than "succeed silently" -- the firewall is one of the few places where this engineering principle becomes a security property directly.

The three front ends are just three dialects of the same three sentences: ufw abstracts "allowlist" into a few simple rules, firewalld groups the allowlist by zone, and nft lays the complete policy out in a single configuration file for you to review line by line. **When migrating between distributions you migrate not the commands but these three sentences** -- first write "deny inbound by default, allow 22/80/443, allow established, forward off" clearly on paper, then translate into the current system's syntax, which is far safer than looking things up in a manual as you go. Stateful matching (conntrack) matters because it makes the allowlist model viable: without it you would have to write an allow rule for every TCP reply packet, and the ruleset would swell past any point of maintenance.

A common debate is **whether outbound should also be denied by default**. For a pure server scenario it is usually kept as `allow (outgoing)` so the business does not break; but for high-security machines (jump hosts, payment gateways) it can be switched to an outbound allowlist, at the cost of adding a rule for every new external dependency. A middle path is to observe outbound traffic with logging for a while first, then decide the allowlist content -- **tightening outbound directly without a traffic profile is another way to lock yourself out.**

An allowlist is not free; its cost is **maintenance discipline**: every new service launch must remember to add a rule, and every monitoring address change must check whether outbound is allowed. Many teams end up retreating to "all-allow plus periodic inventory," not because the model is wrong but because they did not put "add a rule" into the release process. Three common practices keep an allowlist sustainable: put firewall rules in the same configuration repository as the deployment scripts; fix one line in the launch checklist -- "is the port allowed as needed"; and reconcile `ss -tulnp` against firewall rules once a month to find orphans -- "the service is listening but the rule was not opened" or "the rule is still there but the service was shut down." **Reconciliation frequency decides how long this model survives more than rule count does.**

The difference between `drop` and `reject` is also worth memorizing: `drop` discards the packet outright and the client waits for a timeout; `reject` returns an ICMP rejection and the client fails immediately. Use `drop` by default for external traffic (it does not reveal port state and does not waste the attacker's time), and use `reject` only temporarily for internal triage, so you can confirm "the rule took effect."

### Two Ways to Organize Rules: Chain and Zone

The three front ends split into two schools on "how rules are organized" -- and this is not an implementation detail but **the mental picture you draw when writing policy, reading output, and debugging**. Once you understand this, reading any configuration will not leave you lost. The **chain model** (iptables/nftables) hangs rules on hooks like INPUT/OUTPUT/FORWARD and matches them linearly in write order -- rule order is part of the semantics, so inserting in the wrong place changes the policy. The **zone model** (firewalld) first asks "which interface/source did this packet come from" and then applies that zone's service allowlist -- rule order no longer matters, what matters is **belonging**. ufw sits between the two: internally it still compiles to chain rules, but it exposes only the two semantics "allow/deny" and manages order for you.

The implicit question behind selection is actually: "how complex are the trust partitions on my machine?" A single-NIC, single-role cloud host is served by the chain model (or ufw's simplified view); a boundary machine exposing the office network, a management network, and a DMZ at the same time benefits from the zone model, which physically separates three sets of policy so the rule table does not swell past a thousand lines. **There is no best model, only the model that matches your trust structure** -- which is also why copying rules during a server migration often fails: two machines have different trust structures, so the rules should not be identical anyway.

## 3. ufw: The Default Choice for Debian/Ubuntu

### 3.1 Allow First, Then Enable (The Most Important Pitfall in This Chapter)

ufw's `enable` applies the default-deny policy immediately. If you run `ufw enable` in a remote SSH session and have not yet allowed port 22, the connection drops within seconds -- **a wrong rule order locks the administrator out of the machine**, and on a cloud host you can only rescue via the console's VNC. The correct order is always:

```bash
# 1. Allow SSH first (the lifesaving rule for a remote session)
$ sudo ufw allow 22/tcp
Rules added

# 2. Then enable the firewall
$ sudo ufw enable
Firewall is active and enabled on system startup

# 3. Confirm state and default policy
$ sudo ufw status verbose
Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), disabled (routed)
New profiles: skip

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW IN    Anywhere
```

The three default-policy lines in `status verbose` are the first glance at a security audit: `deny (incoming)` means the allowlist model is in effect, and `disabled (routed)` means this machine does not forward traffic (which is correct for anything that is not a router). If you are at the physical console, a wrong order can still be recovered; in a pure SSH environment, always self-check the allow list with `ufw status` before `enable`.

Why does this pitfall deserve its own section? Because it trips over two facts that are easy to overlook at the same time: first, **ufw's default policy takes effect the instant `enable` runs**, with no grace period of "enable first, then slowly add rules"; second, **SSH is your only remote modification channel** (except on cloud hosts), and cutting it off means abandoning all remote correction. Once you understand these two points, "allow first, then enable" upgrades from a mnemonic to an operating discipline: any action that "changes the access-control surface" (enabling a firewall, switching the default zone, changing sshd's authentication method) must **open a new channel and verify it while keeping the old one intact**, and only close the old one after verification succeeds. The self-lock incidents around firewalls, SSH, and sudoers are all violations of this discipline in substance.

### 3.2 Daily Rules and Rate Limiting

Enabling is only the starting point; 90% of daily operations live in this section: allowing new business ports, restricting sources for sensitive services, rate-limiting SSH, and deleting stale rules. Once these four actions become second nature, the firewall shifts from "installed and never touched again" to routine configuration that evolves with the business. Daily rules revolve around three action types: allow, rate-limit, and delete. Allowing can use a service name (`ufw allow http`, relying on profiles in `/etc/ufw/applications.d`) or a bare port; the source-restricted form `ufw allow from 192.168.1.0/24 to any port 3306` is the standard posture for "internal-network-only" services like databases and Redis. When deleting, prefer looking up the number with `ufw status numbered` and then `ufw delete N` -- deleting by content is easy to fail because of inconsistent port notation (`22` and `22/tcp` are two different rules).

```bash
$ sudo ufw allow 80/tcp
$ sudo ufw allow 443/tcp
$ sudo ufw allow from 192.168.1.0/24 to any port 3306
$ sudo ufw limit 22/tcp          # SSH rate limit: reject on exceeding within the window
Rules added (with rate limits)
$ sudo ufw status numbered       # View with numbers, used with delete N
```

`ufw limit` is an under-appreciated weapon: it implements per-IP rate limiting with the recent module, and can stop the most basic password spray even without Fail2Ban. But it is **threshold-triggered, not intelligent banning** -- sustained low-rate brute-force still needs Fail2Ban from [Intrusion Detection](./intrusion-detection.md). The relationship can be remembered this way: `limit` is the emergency valve built into the firewall, and Fail2Ban is the dedicated security guard who reads logs; the former does not depend on log format and is usable immediately, while the latter recognizes more complex patterns (web login failures, scanning user agents) and is usually enabled alongside it in production.

Rule changes take effect immediately, and ufw persists them automatically to `/etc/ufw/user.rules` with no manual save -- in sharp contrast to raw iptables (see 5.4). Never manage the same machine with both `ufw` and raw `iptables`: ufw operates on its own ruleset, and rules appended via raw iptables may be flushed or inserted at the wrong position when ufw reloads -- two management sources fighting each other is a classic failure.

The equivalence between service names (`http`, `https`, `ssh`) and bare ports is also worth a note: `ufw allow http` depends on the profile definitions in `/etc/ufw/applications.d`, and reading that directory tells you exactly which ports `http` opens; when a profile is missing, a bare port is more direct. Teams should standardize the notation -- either all service names so the business side can describe needs in its own words, or all ports so audit scripts can parse them easily; mixing them makes the later rule inventory difficult.

## 4. firewalld: The Zone Model for the RHEL Family

The RHEL family has used firewalld as the default since CentOS 7, and its design starting point differs from ufw: ufw targets the simple "single machine, single role" scenario, while firewalld targets enterprise environments where "one machine connects multiple networks and needs to be partitioned by trust level." Understanding this positioning difference explains why firewalld's concepts look "heavier."

firewalld's core concept is the **zone**: network interfaces/sources are partitioned into zones of different trust levels, and each zone has its own service and port allowlist. This solves a problem ufw handles uneasily -- a machine with two NICs where the internal NIC uses `trusted` and the external NIC uses `public`, with policies that do not interfere with each other.

The built-in zones run from loosest to strictest roughly as: `trusted` (allow all) -> `internal`/`home`/`work` (fairly loose) -> `public` (default, usually only a few services allowed) -> `external`/`dmz` -> `block` (deny and return ICMP) -> `drop` (drop silently). **The default zone on a fresh system is almost always `public`**; common services include `ssh` and `dhcpv6-client`, and environments with the Web console installed and enabled may also include `cockpit`. The specific allowlist varies with the system image and install options, so it cannot be inferred from the zone name -- treat the current output of `firewall-cmd --list-all` as authoritative. Compared with Ubuntu's ufw not being enabled by default, this usually means the RHEL family already has firewalld running out of the box.

Three practical points about the zone model. First, **the interface decides the zone**: an interface belongs to only one zone at a time, rules travel with the interface, and after a NIC name change (common with cloud providers) the binding may go stale and need to be rechecked. Second, **source can override the interface**: on the same NIC, packets from 192.168.1.0/24 can use `home` while everything else uses `public`, implemented with `--add-source` for source-based policy branching, which is very useful in "management network and business network share one NIC" scenarios. Third, **a zone name is not a security promise**: putting an interface in `trusted` means allow all, only one command away from having no firewall -- accidentally setting a production NIC to `trusted` is a zone-model-specific incident, so always recheck with `--list-all` after changing.

```bash
$ sudo firewall-cmd --list-all
public (active)
  target: default
  interfaces: ens160
  services: ssh dhcpv6-client
  ports:
  forward: no
  masquerade: no
  rich rules:
```

The above is a trimmed example; `services` varies by system and install options. For instance, the RHEL configuration in Red Hat's documentation includes `cockpit dhcpv6-client ssh`. The service list in the output is the current allowlist; `masquerade: no` means NAT is not on (a server should not run it unless it really is a gateway). **Every time you log into a new machine, read this command once as the firewall's "health report"** -- more reliable than any documentation. When adding rules, note the **two views: runtime and permanent** -- firewalld splits "the rules currently in memory" from "the configuration store to be loaded after reboot" into two sets, which is its biggest operational difference from ufw (which persists on change):

```bash
# --permanent writes only the configuration store, not effective immediately; missing --reload is the most common mistake
$ sudo firewall-cmd --permanent --add-service=http
success
$ sudo firewall-cmd --reload
success

# Source-restricted rich rule: SSH open only to the ops subnet
$ sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" \
    source address="192.168.1.0/24" port port="22" protocol="tcp" accept'
```

The symptom of `--permanent` without `--reload` is "I clearly added the rule but it does not take effect," then "mysteriously works" again after a reboot -- during triage, first compare `firewall-cmd --list-all` (runtime) against `firewall-cmd --list-all --permanent`, and you can see at a glance whether the two are in sync. Another pitfall is **interface binding**: which zone an interface belongs to decides which set of rules it applies, confirm with `firewall-cmd --get-zone-of-interface=ens160`, and do not assume the interface is always in `public`.

The runtime/permanent dual view brings another hidden risk: **temporary rules mistaken for permanent ones** -- changes without `--permanent` disappear on reload or reboot, and a colleague reproducing your environment finds the rule gone and the two of you start suspecting "did you not save?" In team work, fix the rule-writing convention into scripts (all with `--permanent`, a single `--reload` at the end), or do the reverse and verify everything at runtime first before promoting it in bulk to permanent -- **a team picks one rhythm**, which is far less accident-prone than everyone choosing based on their mood of the day.

## 5. nftables and iptables: Arch and Gateway Scenarios

### 5.1 Why nftables for New Environments

iptables rules are a linear match of concatenated strings, with tables/chains/match extensions scattered across several independent kernel modules; nftables submits the entire ruleset at once and supports sets, cleaner syntax, and better performance. The Arch Wiki also explicitly recommends nftables for new deployments. For security policy, the most practical benefit is **a single configuration file describing the complete policy**, which is easy to version-control and audit.

From a maintenance-cost view, this "one file" matters more than pretty syntax: nft configurations can go into git whole, with diffs visible at a glance; iptables rules are scattered across interactive commands and a persistence file, and diffs often do not line up. Performance-wise, the advantage of nft's batched submission and set matching only shows up after the rule count passes a thousand; with a few dozen rules on a single host the two feel identical -- **the main reason to pick nft is engineering maintainability, not benchmark scores**. For teams maintaining a legacy iptables base, there is no rush to rewrite: the iptables-nft backend will keep working, and the migration can happen naturally at the next major policy change.

### 5.2 A Server Policy You Can Use Directly

```bash
#!/usr/sbin/nft -f
# /etc/nftables.conf -- server baseline: default deny + allowlist
flush ruleset

table inet filter {
    chain input {
        type filter hook input priority 0; policy drop;
        iif "lo" accept
        ct state established,related accept
        ip protocol icmp limit rate 5/second accept
        ip6 nexthdr icmpv6 accept
        tcp dport 22 accept
        tcp dport { 80, 443 } accept
        log prefix "nft-input-dropped: " flags all counter drop
    }
    chain forward {
        type filter hook forward priority 0; policy drop;
    }
    chain output {
        type filter hook output priority 0; policy accept;
    }
}
```

An explanation of why this configuration looks this way, section by section: `table inet`'s `inet` family lets IPv4/IPv6 share one set of rules, naturally closing the "only v4 was configured" hole; `policy drop` is the chain-level default action, written at the chain head so **any packet not matched by a later rule is dropped outright**, which is what makes the allowlist model work; `lo` and `established,related` are the two foundations of every server -- missing `lo` drops local inter-process communication (a database connecting to 127.0.0.1) along with it, while missing `established` severs TCP reply packets and manifests as "connects then hangs"; ICMP is rate-limited to allow ping but not to be used as an amplifier; the final `log ... drop` leaves a trace of drops, so logs and Fail2Ban can be attached later. `flush ruleset` at the top of the file is deliberate: **every load is a full replacement rather than an incremental addition**, avoiding an inexplicable mess after multiple `nft -f` runs -- the cost is that temporary rules added manually with `nft add rule` get flushed, so during debugging keep clear what is in the file and what was typed in.

After loading, read through the actually effective rules once (`sudo nft list ruleset`) and compare against the file to confirm there are no discrepancies. On Arch, `sudo pacman -S nftables` followed by `systemctl enable --now nftables` makes the service read `/etc/nftables.conf` at boot. `policy drop` at the chain head is the security anchor of the whole policy -- **when auditing an nft configuration, look at the policy before the rules**, and this reading order applies to nftables and iptables alike.

### 5.3 Where iptables Fits

Older systems and a great deal of documentation still use iptables syntax. The core mental model is "table x chain": `filter` manages allow/drop, `nat` manages address translation, and `mangle` manages packet modification; inbound goes through `INPUT`, forwarding through `FORWARD`, and outbound through `OUTPUT`. Rules **match top to bottom and stop at the first hit**, so "allow established connections" must be written before the deny.

Order is the entire point of these commands: the three lines for loopback, established connections, and business ports must be "considered first" in the context where the default policy will take effect, and only then does `-P INPUT DROP` change the fallback to drop. The semantic difference between `-P INPUT DROP` and per-line `-A` denies is **default-policy fallback**: even if you forget the final deny rule, unmatched traffic is still dropped. The `-m state` in older material has been replaced by `-m conntrack`; write conntrack in new configurations -- both usually work on modern kernels, but conntrack is the standard term in current documentation and examples, and searching for it is what finds the most up-to-date material.

```bash
$ sudo iptables -A INPUT -i lo -j ACCEPT
$ sudo iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
$ sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT
$ sudo iptables -P INPUT DROP
$ sudo iptables -L INPUT -n --line-numbers   # Read back to confirm the policy is now DROP
```

### 5.4 Rule Persistence (Different Across All Three Families)

Raw iptables/nft rules are lost on reboot, and the persistence mechanisms differ completely across families -- this is the easiest pitfall to hit when migrating machines:

- **Debian/Ubuntu**: `sudo apt install iptables-persistent` (or `netfilter-persistent`), save with `sudo netfilter-persistent save`, rules land in `/etc/iptables/rules.v4`.
- **Arch**: `sudo pacman -S nftables` then enable `nftables.service` (reads `/etc/nftables.conf`); for iptables, install the `iptables` package and enable `iptables.service` (reads `/etc/iptables/iptables.rules`).
- **RHEL/CentOS/Rocky**: firewalld is itself the persistence layer; if you insist on iptables, install `iptables-services` then `sudo iptables-save > /etc/sysconfig/iptables`.

ufw is the only "saved on change" solution here -- every rule is written to `/etc/ufw/user.rules` immediately, with no "forgot to save" failure mode. The cost is ufw's expressiveness ceiling: complex rate limiting and multi-table coordination eventually sink to nft, at which point you accept the full persistence chain of "configuration file plus service enablement." The most reliable way to judge whether a rule is truly persistent is not to recall what you typed, but **to simulate one reboot path after changing the configuration**: `systemctl restart nftables` (or a firewalld reload) then read back with `nft list ruleset`/`firewall-cmd --list-all` -- only if the reboot path works does it count as persistence complete.

## 6. Logging, Rate Limiting, and Detection Handoff

The earlier sections solve "block or not"; this one solves "seeable and resilient after blocking." The firewall's place in the defense actually has three layers: **network boundary** (keep what should not come in from coming in), **observation source** (record who is knocking), and **rate-limiting valve** (make knocking not worth it) -- using only the first layer is incomplete, and in many "configured a firewall but still got broken through" cases the gap is not in the rule table but in logging and rate limiting.

A firewall that blocks without logging is a "mute doorman": when something goes wrong you do not know who is knocking. The `log` prefix in nftables/iptables, ufw's logging, and firewalld's denial logs all end up in kernel logs and are collected by journald, with a unified query entry of `journalctl -k` (or with keyword filtering). Turn on logging with restraint: `ufw logging high` logs every packet in and out, and the logs themselves can fill the disk -- `low` is enough on a server, since it records blocked connections rather than every packet. Both failure modes from a wrong log level have actually happened: `high` fills the disk and crashes a service, while `off` leaves even a successful intrusion with no timeline to reconstruct -- **logs are the raw material of the detection layer and the only base document for after-the-fact evidence**, so they deserve their own line in the launch checklist.

```bash
$ sudo ufw logging on
$ sudo firewall-cmd --set-log-denied=all          # firewalld-side switch
$ journalctl -k --grep "nft-input-dropped" | tail -5
Sep 22 10:14:02 web01 kernel: nft-input-dropped: IN=ens160 SRC=203.0.113.7 ...
```

Logs themselves must be rotated, or they will fill the disk -- see [Basics · Logging System](../basic/log.md) for rotation policy. The more important use of firewall logs is **feeding the detection layer**: a sustained `Failed`/`dropped` pattern is direct evidence of brute-force, and Fail2Ban in [Intrusion Detection](./intrusion-detection.md) is exactly what parses this kind of log for automatic banning. The division of labor is clear: **the firewall blocks and records, Fail2Ban auto-blacklists based on the records, and AIDE discovers "the file changed."** The three layers each do their own job, and any single one alone has blind spots: firewall only reacts slowly to low-frequency brute-force, Fail2Ban only fails against attacks that were not written into the log pattern, and AIDE only is blind to "open the door and invite the thief in" port exposure.

Rate limiting is another cheap line of defense: nft's `limit rate`, iptables' `-m limit`, and ufw's `limit` keyword can all make the cost-benefit of scanning and amplification attacks drop sharply. Adding caps by default to protocols "often used for practice" like ICMP and SSH is part of a security baseline. The difference between rate limiting and banning is also worth separating: rate limiting is **continuously effective traffic shaping** that will not permanently deny normal users on a false positive; banning is a **discrete penalty state** that needs an unban process as a backstop. A new policy should start with rate limiting to observe, and only hand off to Fail2Ban for banning once the pattern is clear -- a more conservative, incremental path.

## 7. Common Pitfalls

Rules themselves are rarely "written wrong"; incidents almost always come from **order, persistence, dual-stack, and double-layer boundaries**. The ten below are ordered by "frequency x recovery cost," and the first four are all at the level of locking you out or making the firewall pointless -- worth rereading before you start. Running them through as a checklist before going live beats paging through man pages after the fact far more effectively.

1. **`ufw enable` before allowing SSH, locking yourself out**. Iron rule: `ufw allow 22/tcp` first, then `ufw enable`. In a pure SSH session, use `ufw status` before acting to confirm 22 is in the list. This is the ordering issue emphasized at the start of this chapter and the single most frequent entry in real rescue tickets.
2. **firewalld `--permanent` added but `--reload` forgotten**. The configuration store changed, memory did not, and it "mysteriously works" only after a reboot. After changing rules, compare `--list-all` against `--list-all --permanent` to confirm; inconsistent output means only half was changed.
3. **nft/iptables configuration changed but not persisted**, so the firewall "disappears" after reboot. On Arch remember `systemctl enable nftables`; for raw iptables remember each family's persistence tool (5.4). Temporary rules typed into memory live only until the next reboot and do not count as "configuration complete."
4. **Reversed rule order**: `policy drop` or a broad DROP written before ESTABLISHED/business ports, manifesting as "deny all" or "reply packets severed." The three foundations (lo, established, business ports) always come first -- this is decided by linear-match semantics, not by habit.
5. **Mixing ufw with raw iptables**. The two management sources overwrite each other and rules get scrambled after a reload. Pick one management layer per machine; during triage, if `iptables -L` content does not match `ufw status`, you can basically conclude someone bypassed ufw.
6. **Ignoring IPv6**. Only one of iptables/ip6tables configured, the other half is wide open. ufw handles dual-stack by default (`IPV6=yes` in `/etc/default/ufw`); nft is naturally dual-stack with `table inet`; with manual iptables you must maintain `ip6tables` at the same time.
7. **Using `reject` as the default action externally**. `drop` is safer externally: no response means the port does not exist, while `reject` actually helps the attacker complete probing. `reject` is fine temporarily for internal triage, but not appropriate in a baseline.
8. **masquerade/forwarding left on a server without knowing**. A machine whose forward chain is not `drop` may already be acting as a jump box. Self-check with `firewall-cmd --list-all`'s `masquerade: no` and nft's forward policy in `nft list ruleset`, and make it a monthly inspection item.
9. **Cloud security group and host firewall configured only one layer**. The common cloud case is "security group opened, host firewall also off" -- double naked exposure. Configure both layers, and when they contradict each other the stricter one wins -- the security group is the network boundary, the host firewall is the process boundary, and missing either leaves a hole.
10. **Rule added but the interface is not in the expected zone**. Under firewalld, a wrong zone binding makes the rule pointless; confirm with `--get-zone-of-interface`. On multi-NIC machines, also recheck the binding after a NIC name change (ens160 changed).

During triage, build a fixed checking order to filter out most of the "mysticism": look at the cloud security group first (network boundary), then the host firewall state and default policy (`ufw status verbose` / `firewall-cmd --list-all` / `nft list ruleset`), then the specific rules and zone belonging, and only then suspect the application itself listening on the wrong address (`127.0.0.1:8080` and `0.0.0.0:8080` in `ss -tulnp` are two different things). **Checking each of the four layers once is faster than probing the same layer repeatedly** -- most "firewall not working" cases end up as a wrong-layer lookup.

The ten pitfalls can be reclassified by "who finds them first": items 1-4 surface **during your own operation** immediately or after a reboot (lockout, forgotten reload, missing persistence, reversed order), which are process-discipline issues; items 5-8 only surface through **inspection or reconciliation** (mixing, IPv6, reject, forwarding) and are completely silent otherwise; items 9 and 10 depend on **handoff or a cloud console inventory** -- they hide in another management system, and looking at `iptables -L` on the host a thousand times will never show the security group's `0.0.0.0/0`. Prepare checking tools by discovery channel rather than memorizing commands by tool category: fixed operation order for manual actions, monthly inspection for silent items, and a handoff checklist for cross-system items.

## 8. Practice: A Policy Checklist for a Public Web Server

The first seven sections unfold by concept and tool; this one compresses them into an execution sequence taking **the most common role (a public Nginx/Apache reverse proxy or static site) from zero to auditable**. The checklist can be copied into a launch template whole, and the read-back command after each step is that step's acceptance criterion -- **a step without a read-back is not complete**, which is the practical final form of the discipline repeated throughout this chapter.

Run a baseline pass over a new server from the security angle (the three families converge, pick commands per your default stack). The checklist is deliberately ordered by execution sequence, with the reasoning after each step:

1. Confirm the default policy is deny-inbound: for ufw look at `Default: deny (incoming)`, for firewalld check whether the current `public` zone's service/port allowlist matches expectations, for nft look at `policy drop`. **Read the current state before acting**, to avoid layering onto an existing policy you did not know about.
2. **First** allow SSH (restrict the source subnet or use `ufw limit` if possible), **then** enable the firewall. The reasoning for the order is in 3.1; this is the only step in the whole checklist that can lock you out.
3. Allow only the business ports 80/443; database and Redis ports only from internal sources. Business ports can use service names or ports, but the source restriction must be written clearly -- "3306 open to the whole internet" is more dangerous than "3306 not opened," because it looks like it was already "configured."
4. Turn on logging (`ufw logging on` / nft `log` / firewalld log-denied), and confirm `journalctl -k` can see dropped-packet records. Logs are the data source for all later detection and triage; without them, banning and postmortem are both impossible.
5. Turn off irrelevant capabilities: no masquerade on a non-router, and confirm the FORWARD chain is drop on a non-container host. This step is often skipped but is the direct blocker for "server used as a jump box" incidents.
6. Hand off to the detection layer: feed the logs to Fail2Ban (see [Intrusion Detection](./intrusion-detection.md)) and bring the firewall configuration under AIDE monitoring (`/etc/ufw/`, `/etc/nftables.conf`). Once configuration files are under integrity checks, a covert `ufw allow from 0.0.0.0/0` has a chance of surfacing at the next scan.
7. On a cloud host, reconcile the security group/firewall rules to make sure there are no leftover `0.0.0.0/0` open-all entries. The cloud's "two-layer wall" must be closed at both ends; configuring only the host layer hands the boundary over to a temporary rule in the console from six months ago.

There is a dependency order among the seven steps that should not be scrambled for speed: steps 1 and 2 decide whether you still have a remote channel, steps 4 and 5 decide whether the policy is observable, and steps 6 and 7 turn the firewall from an isolated configuration into part of the overall defense. In particular, **do not leave "turn on logging" until last** -- logs must be on the moment the policy takes effect, otherwise the dropped-packet records from the trial-and-error period in between are permanently lost and postmortem "why could the user not connect" can only be guessed.

Once the checklist runs cleanly, fixing it into a script or Ansible fragment is more reliable than retyping it each time: machines get rebuilt and people forget details, so only a "repeatably executable checklist" counts as an asset. When fixing it in, add a read-back command after each step (after step 1, `ufw status verbose`; after step 2, `ufw status numbered | grep 22`) so the script stops immediately when any step fails -- a half-finished firewall script state is more dangerous than not running at all, because it can stop at "enabled but SSH not yet allowed." Store the read-back results in the configuration repository next to the rule file, so that the next audit diffs "the declared policy" against "the actually effective policy."

After running these seven steps, what your machine presents to an internet-wide scan is only "the declared ports plus the rate-limited SSH," with all other traffic quietly vanishing into `drop` -- exactly what the allowlist model wants.

The checklist's value is **recheckability**: when someone new takes over, the incoming administrator does not have to understand each of your commands, only read the state back once through these seven steps, and they will know whether the current machine is still under the policy you claim. Archive the read-back command outputs (`ufw status verbose` / `firewall-cmd --list-all` / `nft list ruleset`) to the configuration repository and diff once after every change -- firewall configuration needs version control like code, and "who last modified it and why" should be traceable.

## References

Firewalls are one of the few areas where "documentation from all three families must be read": the authoritative ufw material is on the Ubuntu/Debian side, firewalld on the Red Hat side, and nftables is most systematically covered by the Arch Wiki and upstream netfilter docs. The suggested reading order is to use this chapter first to build the policy model, then dive into the corresponding documentation for the front end you actually use -- reading manuals first, in the order they are written, easily gets you lost in parameter details and forgets what the default policy is. After reading this chapter, go back and compare the operation quick reference in [Network · Firewall](../network/firewall.md), and you will notice the same command is emphasized differently in the two: over there it is "how to type it," here it is "should it be opened, and who is responsible once it is" -- the two work best together. Beyond the three families, if you want to dig deeper into netfilter matching and NAT details, move on to the upstream documentation and Lin's firewall chapter; **going to the manual with a policy question in hand leaves more usable memory than reading the manual in order.**

- `man ufw`, `man firewall-cmd`, `man nft`, `man iptables`
- Arch Wiki - Ufw -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Ufw)
- Arch Wiki - nftables -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Nftables)
- Arch Wiki - Iptables -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Iptables)
- firewalld documentation -- [firewalld.org](https://firewalld.org/documentation/)
- netfilter project and documentation -- [netfilter.org](https://www.netfilter.org/documentation/)
- Bird's Private Recipes (Lin's Linux Administration Guide) - System Security and Firewall -- [linux.vbird.org](https://linux.vbird.org/linux_server/rocky9/0180firewall.php)
- Red Hat - Configuring Firewalls with firewalld -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_firewalls_and_packet_filters/)
- Red Hat - Viewing firewalld's Current Settings (includes the `cockpit dhcpv6-client ssh` configuration example) -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_firewalls_and_packet_filters/using-and-configuring-firewalld)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [glossary](/glossary.md)
- [README](/network/README.md)
- [commands-practice](/network/commands-practice.md)
- [firewall](/network/firewall.md)
- [tcpip-essentials](/network/tcpip-essentials.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [README](README.md)
- [hardening](hardening.md)
- [intrusion-detection](intrusion-detection.md)
- [pam-sudo](pam-sudo.md)
- [selinux](selinux.md)
- [cloud-computing](/server/cloud-computing.md)
- [docker](/server/container/docker.md)
- [dhcp](/server/dhcp.md)
- [bind](/server/dns/bind.md)
- [ftp](/server/ftp.md)
- [ldap](/server/ldap.md)
- [postfix](/server/mail/postfix.md)
- [prometheus](/server/monitoring/prometheus.md)
- [network-parameters](/server/network-parameters.md)
- [nfs](/server/nfs.md)
- [ntp](/server/ntp.md)
- [redis](/server/redis.md)
- [routing-nat](/server/routing-nat.md)
- [samba](/server/samba.md)
- [network-stack](/source/network-stack.md)
