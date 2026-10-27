# Network Monitoring

A single `ping` only tells you
whether it works **right now**,
while what operations actually care about is
"did it work yesterday, what was the average loss,
at what hour did traffic peak."
**Monitoring turns an instantaneous observation into a time series**,
so that a vague complaint like
"it has gotten slower lately"
becomes a curve and an alert you can check.

This page covers two complementary monitoring approaches:
traditional device monitoring represented by SNMP,
and cloud-native host monitoring represented by
Prometheus + node_exporter,
plus the full path from a metric to an alert.

> Content adapted from the Prometheus, node_exporter,
> and Net-SNMP official documentation and hands-on
> operations experience; see the references at the end.

## What This Page Covers

- Understanding the trade-off between
  active probing and agent-based collection
  (agent/exporter)
- How SNMP basically works and where it fits,
  and being able to pull one round of data
  with `snmpwalk`/`snmpget`
- Deploying Prometheus + node_exporter
  and writing your first network-related alert rule
- Using `vnstat`, `iftop`, and `iperf3`
  for local bandwidth and latency analysis
- Recognizing the high-frequency pitfalls of monitoring
  (firewalls blocking the exporter,
  metric cardinality explosion,
  alert fatigue)

## 1. Why Continuous Monitoring

The value of monitoring is not "seeing charts";
it is answering three classes of questions
that only historical data can answer.

**What is the baseline**.
Without a normal traffic curve,
you cannot tell whether today's spike is abnormal or routine.
The baseline also sets the alert thresholds --
a threshold of 80% picked out of thin air
usually misfires at midnight,
or stays silent when the link is genuinely saturated.

**Which way is the trend going**.
A port growing a steady 5% per week
predicts the need for capacity long before
any single-day spike.
Trend is also the language for budget conversations:
"at the current slope it saturates in Q3"
beats "it feels a bit full lately" by a wide margin.

**How wide is the blast radius**.
When loss goes from 0% to 0.1% users may not notice;
at 5% they will complain.
Monitoring data is the basis for severity assignment and post-mortems.
Without historical curves,
a post-mortem stops at "we were busy at the time."

A monitoring system usually has three parts:
**collection** (exporter/agent/snmp poller reading data),
**storage** (a time-series database keeping samples over time),
**alerting** (a rule engine evaluating samples and notifying).
The next two sections correspond to the two mainstream collection
models, and that choice shapes every operations action that follows.

## 2. Two Monitoring Models

### 2.1 Active Probing: The Monitor as "the Probe"

The simplest monitoring is for the monitoring side to
periodically `ping`/`traceroute` its targets,
with no cooperation required from the target machine.
The advantage is zero intrusion,
which suits probing network paths and third-party services;
the drawback is that you only see
the viewpoint "starting from the monitoring point,"
and cannot reach the target's internal CPU, connection counts, and so on.

blackbox_exporter, scheduled `mtr` sweeps,
and synthetic probing systems all belong here,
and they answer
"is the link up, when does the certificate expire,
does HTTP return 200."
There is also an underrated use:
**simulating the real user's path** --
probing the same domain from the office network, the data center,
and the public internet at once
immediately separates
"the target is down" from "one particular path is down."

The cost of active probing is limited coverage:
the more often you probe, the more it costs,
and you can never probe a failure that
"was not written into the probe list."
So it usually complements the agent-based collection below
rather than replacing it.

### 2.2 Agent Collection: exporter / SNMP agent

To see inside a machine,
something on the target side has to act as a "translator,"
turning kernel data into a format the monitoring system can read.
The Prometheus ecosystem uses **exporters**;
the traditional network management ecosystem uses an **SNMP agent**.
Both solve the same problem,
just with different protocols and eras:

| Dimension | SNMP (traditional) | Prometheus + node_exporter (modern) |
|------|-------------|----------------------------------|
| Protocol | UDP 161/162, ASN.1 BER encoded | HTTP /metrics, plain text |
| Pull/push | the monitor gets actively (pull), traps also possible (push) | the monitor scrapes actively (pull) |
| Typical targets | network devices, printers, legacy systems | Linux/Windows hosts, cloud instances |
| Configuration | centralized MIB + community/ACL, ACLs needed on the device | deploy the exporter and metrics appear automatically |
| Today | still dominant on the installed base of network devices | the default choice for new Linux services |

**Conclusion first**:
for **proprietary devices** such as switches, routers, UPS units,
and storage arrays, use SNMP --
there is no exporter you can install on them.
For **your own Linux servers**, prefer node_exporter --
richer metrics, and it integrates natively with the
alerting/dashboard ecosystem.
The two often coexist in one system,
with Grafana pointing at both.

There is one practical factor in the choice as well:
**the skills the team already has**.
A team fluent in Zabbix + SNMP templates
that is forced onto Prometheus
usually pays more in learning cost than it gains;
and a cloud-native team starting from scratch
that also introduces Zabbix
takes on the burden of maintaining two alerting stacks.
The hidden cost of switching monitoring systems
(alert rules rewritten, dashboards rebuilt,
on-call habits changed)
is far higher than the software itself,
so do not switch without a clear pain point.

## 3. SNMP: Monitoring Network Devices

### 3.1 Concepts: MIB, OID, and Community

SNMP reads device state through **OIDs**
(object identifiers, a dotted string of numbers,
such as `1.3.6.1.2.1.1.5.0` for sysName),
and the meaning of an OID is defined in a **MIB**
(management information base).
v2c uses a plaintext `community` string as the password
(defaults `public`/`private`),
while **v3 adds authentication and encryption**;
production should prefer v3 --
keeping the default community is equivalent to
hanging the device's management interface on the public internet.

Once an agent is installed on Linux,
even when you are monitoring that very machine,
you can use it to learn the protocol
(the package names line up across the three families;
Arch uses `pacman -S net-snmp`,
Debian/Ubuntu uses `apt install snmp snmpd`,
and the RHEL family uses
`dnf install net-snmp net-snmp-utils`):

```bash
# Query the system name (sysName.0 = 1.3.6.1.2.1.1.5.0)
$ snmpget -v2c -c public localhost 1.3.6.1.2.1.1.5.0
SNMPv2-MIB::sysName.0 = STRING: web01

# List the system description
$ snmpwalk -v2c -c public localhost 1.3.6.1.2.1.1.1.0
SNMPv2-MIB::sysDescr.0 = STRING: Linux web01 5.15.0-91-generic ...
```

`snmpwalk`
walks the subtree under some OID,
and is the usual way to explore an unfamiliar device's capabilities;
`snmpget` fetches a single value,
which suits scripted periodic collection.

For SNMP baseline monitoring,
the three kinds of data grabbed most often are
interface in/out traffic
(`ifInOctets`/`ifOutOctets`;
the 32-bit counters wrap at about 4G,
so the 64-bit
`ifHCInOctets`/`ifHCOutOctets` are recommended),
interface error/discard counters,
and device CPU/temperature (vendor-private OIDs).
The 32-bit counter overflow happens within seconds
on links above a gigabit,
and the collector must compute rates as
"a difference between two samples plus wrap-around handling,"
or it will periodically produce negative values or spikes --
this is the classic pitfall of SNMP traffic monitoring.

### 3.2 Enabling snmpd on Linux

The minimal working configuration is
to open a read-only community and restrict its source:

```bash
$ sudo apt install snmpd   # Arch: pacman -S snmp; RHEL: dnf install net-snmp
$ sudo systemctl enable --now snmpd
$ snmpget -v2c -c public 127.0.0.1 sysUpTime.0
SNMPv2-MIB::sysUpTime.0 = Timeticks: (123456) 0:20:34.56
```

The common pitfall is
**access failing from anywhere but 127.0.0.1**:
distros bind the agent to loopback by default,
or `snmpd.conf`'s `agentaddress` restricts the source,
so remote collection from the monitoring server is silently dropped.
The fix is to listen explicitly on an internal address
and allow UDP 161 through the firewall
(see [Firewall](./firewall.md)):

```bash
# Excerpt from /etc/snmp/snmpd.conf
agentaddress 127.0.0.1,192.168.1.100:161
rocommunity public 192.168.1.0/24
```

After editing, `systemctl restart snmpd`
and verify once from the monitoring side with `snmpget`;
do not trust only the "active" shown by `systemctl status` --
**the service running and the port being reachable are two different things**,
the most widespread misconception in monitoring deployments.
And do not forget the firewall either:
when UDP 161 is blocked,
`snmpget` merely times out
instead of giving a clear "connection refused"
and is easily mistaken for a dead agent.

### 3.3 When SNMP Is Still the Right Choice

When the monitored object is one of the following,
SNMP is nearly the only option:
switches and routers with no OS on which you can install an agent;
UPS, PDU, and storage gear that can only be managed through the standard protocol;
and legacy data centers that must be unified under an existing NMS
(Zabbix, Nagios, LibreNMS).

The Prometheus ecosystem has snmp_exporter as well,
which converts SNMP data into metrics,
so one dashboard can show switch traffic and server load together --
the common architecture of a hybrid environment:
**network devices over SNMP,
Linux hosts over node_exporter,
and Grafana drawing both**.
This neither requires vendor hardware to "modernize"
nor gives up the query power of PromQL.

## 4. Prometheus + node_exporter

### 4.1 Architecture and Why It Fits

Prometheus uses a **pull model**:
the server periodically scrapes samples from each target's
`/metrics` endpoint,
stores them in its local time-series database,
and then PromQL queries and the rule engine produce alerts.
node_exporter is the exporter responsible for
**host metrics** there,
exposing thousands of metrics for CPU, memory, disk,
network interfaces and more,
running read-only without touching the kernel,
with low privilege requirements,
which suits large-scale batch deployment.

Signals that this combination is right for you:
you need custom alert rules (PromQL is expressive),
you need deep integration with Kubernetes/Grafana,
you need multi-dimensional drill-down by labels
(region, env, team).
If the team already has a mature Zabbix investment,
there is no need to force a migration --
cases where a monitoring system migration costs more
than it gains are common.

Pull has one more operational advantage:
**when a target is unreachable,
Prometheus's `up` metric is simply 0**,
so the failure automatically becomes a queryable signal.
A push model (agents reporting on their own)
tends to leave "silent gaps" during a network partition,
where you cannot tell whether "no data" means "no traffic" or "it is dead."
Understanding this difference
helps you design more reliable alerting.

### 4.2 Installation and Deployment

**node_exporter** installs on all three families
(Arch uses `pacman -S prometheus-node-exporter`,
Debian/Ubuntu uses `apt install prometheus-node-exporter`,
the RHEL family uses `dnf install prometheus-node-exporter`;
when there is no package, grab the binary from the official releases):

```bash
# Arch as the example
$ sudo pacman -S prometheus-node-exporter
$ sudo systemctl enable --now prometheus-node-exporter

# Verify the metrics endpoint
$ curl -s localhost:9100/metrics | head -5
# HELP node_cpu_seconds_total Seconds the cpus spent in each mode.
# TYPE node_cpu_seconds_total counter
node_cpu_seconds_total{cpu="0",mode="idle"} 1.234567e+06
```

When deploying from binaries,
create a dedicated system user,
manage it with systemd,
and trim the collectors you do not need
to cut overhead and attack surface.
Port 9100 should only be open to the monitoring network --
`/metrics` exposes topology details such as hostname,
mount points, and NIC names,
which count as mildly sensitive data.

On the **Prometheus** side, configure the scrape job:

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'node'
    static_configs:
      - targets: ['localhost:9100', '192.168.1.101:9100']
        labels:
          env: prod
```

Debian/Ubuntu and the RHEL family
usually have official packages so you can just
`apt install prometheus` /
`dnf install prometheus`
(the RHEL family needs EPEL or the official repo configured first),
while Arch uses `pacman -S prometheus`.
Installing through a package manager brings
a systemd unit and a conventional config directory,
so upgrades never require moving binaries by hand.

`scrape_interval: 15s`
is the default and the balance point for most cases:
shorter means finer data and more storage and query pressure,
longer means higher alert latency.
Network interface metrics change relatively slowly,
so 15 seconds is plenty;
to catch second-level jitter,
shorten the interval for the critical jobs alone
rather than tightening it globally.

### 4.3 Network Metrics and Alerts

The metrics from node_exporter
most often used for network monitoring:

| Metric | Meaning | Alerting idea |
|------|------|----------|
| `node_network_receive_bytes_total` | cumulative bytes received on the interface | `rate()` for bandwidth, alert past the baseline threshold |
| `node_network_transmit_drop_total` | TX-side drop counter | a growth rate > 0 sustained for minutes means alert |
| `node_network_up` | interface state (1/0) | =0 means the link is down |
| `node_network_receive_err_total` | receive errors | steady growth points at link quality trouble |
| `node_timex_sync_status` | time synchronization state | =0 hurts TLS and log correlation |

Turning absolute counters into
"a rate per second" is basic PromQL skill,
and also the step where people most often get stuck --
a raw counter only accumulates
and cannot take a threshold directly:

```text
# Average receive rate per second over the past 5 minutes (times 8 for bit/s)
rate(node_network_receive_bytes_total{device="eth0"}[5m]) * 8

# Interface down alert
node_network_up{device="eth0"} == 0

# TX drops growing continuously over the last 2 minutes
increase(node_network_transmit_drop_total[2m]) > 0
```

A matching example of alert rules:

```yaml
groups:
  - name: network
    rules:
      - alert: InterfaceDown
        expr: node_network_up{device!~"lo|veth.*|docker.*"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Interface {{ $labels.device }} is down on {{ $labels.instance }}"

      - alert: HighDropRate
        expr: rate(node_network_transmit_drop_total[5m]) > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "{{ $labels.instance }} drop rate {{ $value }}/s"
```

`for: 1m`
means the condition must hold for one minute before firing,
which filters out the blip at the instant an interface restarts --
**alerts without `for` create a great deal of noise during maintenance windows**,
the leading source of alert fatigue.
`device!~"lo|veth.*|docker.*"`
filters out loopback and virtual devices,
or container hosts get drowned in noise.

Before writing an alert, ask three questions:
who will look at it?
what do they do after seeing it?
under what conditions will it misfire?
A rule that cannot answer them should not ship --
**the value of an alert = accuracy × the response it triggers**,
and an alert that fires with nobody acting is worse than no alert,
because it trains on-call staff to ignore notifications.

### 4.4 Grafana Visualization

Grafana renders PromQL results into dashboards.
It also packages across the three families
(Arch `pacman -S grafana`,
after adding the official repo on Debian/Ubuntu, `apt install grafana`,
RHEL `dnf install grafana`);
once `grafana-server` is running, visit port 3000
and add the Prometheus data source.
Community dashboard ID 1860
(Node Exporter Full) is almost standard --
import it and you immediately have the full set of
CPU, network, and disk views.

When reading a network chart, watch two things:
**the symmetry between receive and transmit**
(a sudden one-sided saturation is usually an anomaly or P2P traffic),
and **whether errors/drops accompany a traffic increase**
(high traffic with no errors is a normal scaling signal).
The real job of a dashboard is
**drawing the baseline into your intuition** --
look once a day, and when something abnormal shows up
you feel "this is wrong" without any threshold;
the threshold only covers the hours you were not watching the screen.

## 5. Local Bandwidth and Latency Analysis

A dashboard tells you "something happened";
local tools tell you "what happened."
Used together, they save you from
"seeing an alert and not knowing which machine to reproduce it on."

```bash
# Per-connection bandwidth in real time
# Arch: pacman -S iftop; Debian: apt install iftop; RHEL: dnf install iftop
$ sudo iftop -nNP -i eth0

# Interface-level rate curve
$ sudo nload eth0

# Historical traffic report (long-term baseline)
$ vnstat -d
   day        rx      |     tx      |    total    |   avg.     rx
-----------------------+-------------+-------------+---------------
2026-09-20    12.4 GiB |     8.9 GiB |     21.3 GiB |   24.0 KiB/s
```

`iftop` suits locating "who is eating the bandwidth right now,"
`vnstat` accumulates long-term totals from kernel counters
at very low cost;
one looks at the instant, the other at history,
complementary rather than conflicting.
`nload` is more visual
but carries less information density than `iftop`,
so prefer `iftop` during troubleshooting.

For validating bandwidth capacity, use `iperf3`
(the same package name on all three families;
Arch: `pacman -S iperf3`):

```bash
# Server
$ iperf3 -s

# Client: 30-second test, watch for retransmissions
$ iperf3 -c 192.168.1.200 -t 30
[  5]   0.00-30.00  sec  3.42 GBytes   980 Mbits/sec    0 sender
[  5]   0.00-30.01  sec  3.42 GBytes   980 Mbits/sec         receiver
```

iperf3 uses a **single connection** by default from 3.1 on,
so on multi-core switches it may not saturate the link
and needs `-P 4` in parallel;
a large gap between the `sender` and `receiver` numbers
or the appearance of retransmits
means congestion or loss somewhere on the path,
and you should move on to `mtr`/`tcpdump`
for evidence
(see [Network Troubleshooting](./troubleshooting.md)).

Load testing itself has discipline:
**ask for a window first, rate-limit, and confirm the far end is running**.
Firing a full-speed iperf3 at a production IP
can crowd the business off the link --
monitoring tells you the link is nearly full,
so your verification method must not become the straw that breaks it.
Scheduling the test in a business trough,
or running it between dedicated traffic generators,
is the more professional approach.

## 6. Packet Capture and Deep Analysis

Once monitoring shows an anomaly,
packet capture is the final way to settle what it is.
`tcpdump` installs across the three families as
Debian/Ubuntu `apt install tcpdump`,
Arch `pacman -S tcpdump`,
RHEL `dnf install tcpdump`
(usually preinstalled):

```bash
# Capture a chosen interface and port, saved for Wireshark analysis
$ sudo tcpdump -ni eth0 port 443 -w /tmp/tls.pcap -c 10000

# Handshake and teardown only, to judge connection setup quality
$ sudo tcpdump -ni eth0 'tcp[tcpflags] & (tcp-syn|tcp-fin) != 0' and host 10.0.0.5
```

Capture files opened with Wireshark
(Arch `pacman -S wireshark`,
Debian `apt install wireshark`,
RHEL `dnf install wireshark`)
reveal TCP windows, retransmissions,
TLS handshake timings and other details,
and are the ultimate basis for separating
"the network is slow" from "the application is slow."
**Capturing costs resources and touches sensitive data**,
so in production always bound the duration and the BPF filter,
and destroy the file once you are done --
a pcap containing plaintext credentials
is itself the seed of a security incident.

The link between capture and monitoring can be made systematic:
alert fires -> automatically capture the relevant ports
for 60 seconds on the target -> attach it to the ticket.
That way the evidence is already in place
when the on-call engineer arrives
instead of starting from a blank terminal.
Automating this layer for high-frequency alerts
changes the quality of post-mortems outright.

## 7. Zabbix and Other Traditional Options

Zabbix represents the other kind of all-in-one solution:
agent, auto-discovery, templates, and alerting built in,
which suits teams that want
"works out of the box, few queries to write."
The deployment flow is to prepare a database
(MySQL/PostgreSQL) first,
import the official SQL,
then set `DBPassword` in `zabbix_server.conf`
and start `zabbix-server`,
`zabbix-agent`, and the web frontend.
Its network discovery and low-level discovery (LLD)
can register switch interfaces automatically
and pair well with SNMP templates,
making it another reasonable choice for hybrid environments.

The choice can be compressed to one sentence:
**pick Prometheus for deeply customized queries and cloud-native integration,
pick Zabbix for all-in-one operation and SNMP device management,
and both can coexist in the same dashboard**
(Grafana can point at Prometheus
and a Zabbix data source at the same time).
What usually decides success is not the tool itself
but whether somebody keeps maintaining the baselines,
retiring dead alerts,
and reviewing misfires --
monitoring is an operating practice,
not a one-time installation.

## 8. Common Pitfalls

- **The exporter is up but Prometheus cannot scrape it**.
  Nine times out of ten a firewall or SELinux
  is blocking port 9100.
  First verify reachability with
  `curl -s <target>:9100/metrics`,
  then look at Prometheus's Service Discovery page;
  for details see the connectivity evidence section of
  [Firewall](./firewall.md).
- **SNMP only works from localhost**.
  The default community and listening address restrictions
  make remote gets time out;
  adjust `agentaddress`
  and `rocommunity`
  and allow UDP 161;
  and move the community to v3 as soon as possible,
  or at least restrict it to a source subnet.
- **Setting thresholds on absolute counters**.
  `node_network_receive_bytes_total`
  is cumulative and never falls,
  so a rule like `> 1000000` fires forever.
  Wrap it in `rate()`/`increase()`.
- **Thresholds picked out of thin air**.
  Setting thresholds without a baseline
  produces either daily misfires that end up muted
  or real faults that never fire.
  Observe with `vnstat`/the dashboard for a week before drawing the line,
  and consider separate policies
  for different time windows (weekdays/weekends).
- **Ignoring the noise from `lo`, `veth`, and `docker0`**.
  Interface alerts without the
  `device!~"lo|veth.*"` filter
  get flooded by loopback flapping.
- **Metric cardinality out of control**.
  Adding a label for every request path
  bloats the time-series database until it is unusable;
  network metrics should stay at the two dimensions of
  interface and instance.
- **Clock drift between the monitor and the monitored**.
  Skewed sample timestamps
  make queries "lose data out of nowhere";
  make sure NTP is in sync (`chronyc tracking`).
- **Treating monitoring as a troubleshooting tool**.
  Monitoring tells you when and where the problem is,
  not the root cause --
  that still has to come back to
  [Network Troubleshooting](./troubleshooting.md)'s
  chain of reasoning and capture evidence.

## References

- Prometheus documentation -- [prometheus.io](https://prometheus.io/docs/)
- node_exporter README -- [github.com](https://github.com/prometheus/node_exporter)
- PromQL function reference -- [prometheus.io](https://prometheus.io/docs/prometheus/latest/querying/functions/)
- Grafana documentation -- [grafana.com](https://grafana.com/docs/)
- Net-SNMP manuals -- [net-snmp.org](https://www.net-snmp.org/docs/man/)
- SNMPv3 security model (RFC 3411-3415)
- Zabbix documentation -- [zabbix.com](https://www.zabbix.com/documentation)
- Arch Wiki - Prometheus -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Prometheus)
- `man snmpget`, `man snmpwalk`,
  `man tcpdump`, `man vnstat`, `man iperf3`

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)
- [load-balancing](load-balancing.md)
- [vpn](vpn.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [performance](/system-management/performance.md)
