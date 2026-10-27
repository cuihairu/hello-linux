# Prometheus + Grafana

The essential question of monitoring is not "how many metrics to collect" but "when something breaks, can you answer within five minutes: what broke, how badly, and who to call". Prometheus is the time-series database and alerting system designed for exactly that: it actively **pulls** metrics from each target, stores timestamped data in a local TSDB, and aggregates with PromQL; Grafana stands on top, drawing charts and dashboards that turn query results into panels a human reads at a glance. Why did this combination become the default answer of the cloud-native era? First compare the two models: in a push model (agents pushing data to a center), the center easily becomes the bottleneck and single point of failure as the target count explodes, and "is the target still alive" has to be guessed from timeouts; in the pull model Prometheus comes on the configured schedule, and the target list *is* the liveness list -- a dead exporter simply fails to show up at the next scrape and its `up` metric immediately goes to 0: the monitoring system discovers the lost target itself instead of waiting for it to report in. This page is organized as "why pull -> installation on the three families -> node_exporter -> PromQL -> Grafana -> alerting -> common traps"; the installation section compares Debian/Ubuntu (apt), Arch (pacman), and RHEL/CentOS/Rocky (dnf); host firewall and port exposure remain governed by the [Firewall](../../security/firewall.md) page.

> Content draws on the official Prometheus and Grafana documentation and the Arch Wiki; see the references at the end.

## What This Page Covers

- How the pull model and scrape config accomplish "collection" and "liveness probing" at once
- Installing on the three distros (apt / pacman / dnf) and reading `systemctl` and `/metrics` acceptance output
- Deploying node_exporter and drawing its responsibility boundary against Prometheus itself
- Writing common PromQL (rate/irate/sum/topk) and telling counters from gauges
- Connecting the data source in Grafana, importing dashboards, and configuring alert rules that actually fire

## 1. Architecture: Why the Pull Model

```text
node_exporter :9100 ──scrape/15s──▶ Prometheus (TSDB + alert rules) ──query──▶ Grafana :3000
mysqld_export :9104 ──scrape/15s──▶        │ firing
                                           ▼
                                    Alertmanager ──▶ email/IM
```

Three layers of responsibility must be told apart: the **exporter** only says "I have a bunch of metrics here" (HTTP `/metrics` text), understanding neither storage nor alerting; **Prometheus** handles periodic scraping, time-series storage, and rule evaluation; **Alertmanager** receives firing alerts and does grouping, inhibition, and routing to email or IM. Grafana is a pure consumer -- it queries Prometheus and is not part of the collection chain, so when Prometheus dies Grafana survives, with blank charts. This boundary is the same division as "the package manager only installs, systemd only runs, the log only records": each layer upgrades independently, and troubleshooting can nail down layer by layer along "blank chart -> no data in query -> scrape failing -> exporter down".

The pull model brings two more engineering payoffs: a target only needs to expose a port and never needs to know where the center is (machines behind NAT can still be monitored); and `job_name` + `static_configs` write "who should be collected" as versionable YAML, consistent with the IaC mindset. The cost is that the target list must be maintained actively -- large dynamic environments later use service discovery (kubernetes_sd etc.), but the static config on this page already covers the mainstream cases from a single machine to a small cluster.

There is also a subtle dependency in deployment order: first make the exporter emit data on the target machine, then change Prometheus's scrape config -- do it the other way round and you first see a row of `up 0`, stacking "config written wrong" and "target not up" into one fault and doubling the debugging cost. Likewise, verifying the text format with a local `curl :9100/metrics` before scraping across machines separates network problems from metric problems. On the Grafana side, connect last: talk panels only after the data source's Test is green, avoiding suspecting chart config when the query is empty. This one-way build order "exporter -> scrape -> panel -> alert" is the same bottom-up, per-layer-acceptance-before-advancing discipline as BIND's "zone -> checkconf -> reload -> dig" and Compose's "YAML -> config -> up -> ps" -- skipping steps is a shared breeding ground for incidents across monitoring, DNS, and orchestration alike.

## 2. Installation (Three Distros Compared)

| Action | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Install Prometheus | `apt install prometheus` | `sudo pacman -S prometheus` | `dnf install prometheus` (EPEL) |
| Install node_exporter | `apt install prometheus-node-exporter` | `pacman -S prometheus-node-exporter` | `dnf install prometheus-node-exporter` |
| Install Grafana | `grafana` from the official apt repo | `pacman -S grafana` | `grafana` from the official dnf repo |
| Search | `apt search prometheus` | `pacman -Ss prometheus` | `dnf search prometheus` |
| Show package info | `apt show prometheus` | `pacman -Qi prometheus` | `dnf info prometheus` |
| List files | `dpkg -L prometheus` | `pacman -Ql prometheus` | `rpm -ql prometheus` |
| Upgrade | `apt upgrade` | `sudo pacman -Syu` | `dnf upgrade` |
| Remove | `apt remove prometheus` | `sudo pacman -R prometheus` | `dnf remove prometheus` |

Debian/Ubuntu provide the whole `prometheus` family in the universe repo (Prometheus, node_exporter, and Alertmanager as separate packages), one `apt install` away; Arch puts them all in extra, so `pacman -S prometheus prometheus-node-exporter grafana` lands the trio in one step with systemd units installed alongside, ready for `systemctl enable --now` -- the shortest installation path of the three. On RHEL/Rocky the Prometheus package is in EPEL: install `dnf install epel-release` first, and the version is often slightly behind upstream latest -- when you need important features, cross-verify against the official static binaries (see 2.4). For Grafana, Debian/RHEL are both advised to add the official repository for newer versions and the plugin ecosystem, while on Arch the official repo is already first-class; after installing, the unit is called `grafana-server` on Debian/RHEL and `grafana` on Arch -- acceptance is identical on all three: `systemctl status` shows active, and a browser at `:3000` shows the login page. Upgrade discipline follows each family's habit: `apt upgrade`/`dnf upgrade` on Debian/RHEL, steady rolling with `pacman -Syu` on Arch, and the config-file handling notices during package upgrades (dpkg conffile, `.pacnew`) need human review like any other critical service.

### 2.1 Debian/Ubuntu

```bash
$ sudo apt install prometheus prometheus-node-exporter
$ sudo systemctl enable --now prometheus node_exporter
$ curl -s localhost:9090/-/ready
Prometheus Server is Ready.
```

Debian's default config is at `/etc/prometheus/prometheus.yml`, the data directory `/var/lib/prometheus/`, with ownership already handed to the `prometheus` user by the package -- do **not** hand-`chown` unrelated directories; the package manager's default ownership is what makes upgrades conflict-free. To change scrape targets, edit the YAML and `systemctl reload prometheus` (or `kill -HUP`) to hot-reload the scrape config. `enable --now` in one breath is one step less to remember than `enable` then `start`, and is the shared service-start posture across all three families. Right after installing, run a local `curl /-/ready` before opening the browser, separating "service not up" from "firewall/port problem" right in the terminal -- the earlier the debugging entry converges to the command line, the more time you save afterwards.

### 2.2 Arch

```bash
$ sudo pacman -S prometheus prometheus-node-exporter grafana
$ sudo systemctl enable --now prometheus node_exporter grafana
```

On Arch all three are in extra, usable right after `pacman -S`; config paths match upstream: `/etc/prometheus/prometheus.yml`, `/etc/prometheus/alertmanager.yml` (if the `alertmanager` package is also installed), and the alert rules directory defaults to `/etc/prometheus/`. Unlike Debian's split-package style, Arch convention lays all default configs into `/etc` and marks them as backups, generating a `.pacnew` on upgrade if you edited them -- `pacman -Ql prometheus | grep yml` quickly lists every YAML in the package, confirming which are "factory files you can diff against before editing". Daily maintenance still belongs to `pacman -Syu`, with Prometheus and the exporter rolling in the same repository and versions naturally matching. The install progress bar and dependency resolution output carry no troubleshooting information; acceptance only needs two lines: `systemctl status` and `pacman -Qi`.

### 2.3 RHEL/CentOS/Rocky (EPEL)

```bash
$ sudo dnf install epel-release prometheus prometheus-node-exporter
$ sudo systemctl enable --now prometheus node_exporter
$ firewall-cmd --permanent --add-port=9100/tcp && firewall-cmd --reload
```

The EPEL package's Prometheus version policy is conservative; before going live, glance at the version with `dnf info prometheus` and compare against the changelog. Data and config live in `/var/lib/prometheus` and `/etc/prometheus/`. Whether 9100 is open to the scraper depends on the environment -- with Prometheus and the exporter on the same machine only loopback is needed, and cross-machine scraping needs the source address opened; the rules themselves remain governed by the [Firewall](../../security/firewall.md) page, not expanded here.

### 2.4 Alternative: Official Static Binaries

When no distro package works or you need the latest version, download the tar from the official releases, unpack it, copy `prometheus`/`promtool` into `/usr/local/bin`, put config in `/etc/prometheus` and data in `/var/lib/prometheus`, then hand-write a unit running as a non-root user -- an installation equivalent to `pacman -S` but with "self-managed file inventory", at the cost of owning upgrades, rollbacks, and security advisories yourself; prefer repositories whenever they work, and take this path only to verify cutting-edge features.

## 3. node_exporter: Where Host Metrics Come From

node_exporter does exactly one thing: read CPU, memory, disk, and network from `/proc` and `/sys` into Prometheus text format and serve it at `:9100/metrics`. It does **not** store history, does **not** send alerts, and is **not** part of Prometheus -- with this boundary clear, you can understand that "a dead node_exporter only affects new data collection while stored time series remain queryable", and that multi-machine deployment means "one exporter per machine, one Prometheus at the center", not the full stack on every box. Installation is in the section 2 comparison; for cross-machine scraping, list each machine's `IP:9100` under the `node` job in `prometheus.yml`, and instances that fail to scrape show `up` 0 and enter the alerting view -- the pull model incidentally completes liveness probing. The minimal flow for standalone deployment and acceptance:

```bash
$ sudo systemctl enable --now node_exporter
$ curl -s localhost:9100/metrics | head -3
# HELP node_cpu_seconds_total Seconds the CPUs spent in each mode.
# TYPE node_cpu_seconds_total counter
```

A `curl` emitting metric text starting with `# HELP` means acceptance passed -- this step is unrelated to whether Prometheus has scraped the exporter yet; check `up` on the Targets page for that. Cross-machine deployment repeats the same three steps: install the package, enable, curl local 9100; when the exporter needs no extra firewall config it listens on loopback only, with Prometheus pulling actively from its side. To rate-limit node_exporter separately from application processes, change the port with `web.listen-address` and correspondingly update `targets` in the scrape config, though the default port already covers everything from a single machine to a small cluster. When upgrading the exporter, mind metric-name compatibility with Prometheus itself -- some `node_*` metrics get renamed between major versions, and capturing `/metrics` once before and once after to diff finds the differences before alert rules go stale. Daily inspection need not log into every machine: the Targets page's `last scrape` and `sample count` are the two golden columns of scrape health, far more efficient than curling each box.

## 4. PromQL: A Query Language Tour

### 4.1 Two Metric Types

The most important type distinction in Prometheus is **counter** (a cumulative value that only grows, such as `node_cpu_seconds_total`) and **gauge** (an instantaneous value that goes up and down, such as `node_memory_MemAvailable_bytes`). A counter must be paired with `rate()`/`irate()` to yield the interval slope -- the "per-second rate"; reading the raw value directly only gives you a curve climbing all the way up. This is the common first pitfall and the entire reason `rate` and `irate` exist: the former averages over a window and is steadier, the latter is more sensitive to spikes; alerting usually uses the former, while instantaneous-value debugging can use the latter.

### 4.2 Common Expressions

```text
# CPU usage (counter -> rate) / memory usage (gauge divided directly)
100 - (avg by(instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)
(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100
rate(http_requests_total[5m])          # average rate over the window
increase(http_requests_total[1h])      # increase over an hour
sum(rate(http_requests_total[5m])) by (method)   # aggregate by method
topk(5, rate(http_requests_total[5m]))           # the 5 busiest instances
```

The fixed routine for writing PromQL: first confirm whether the metric is a counter or a gauge -> add `rate`/`increase` to counters -> when aggregating across instances, `sum by (label)` -> use `topk` for rankings. Labels (`instance`, `job`, `method`) are the keys to multi-dimensional queries, and the `by` clause decides the aggregation granularity -- before aggregating, think through "does one line on this chart represent one machine or a class of machines", otherwise it is easy to average three machines' memory percentages into a meaningless number. PromQL itself is not hard; what is hard is choosing the right metric and window: a window under twice the scrape interval is guaranteed empty, and a window far longer than the business cycle smears spikes away. Just as `pacman -Q` asks "what is installed right now" and journalctl asks "what happened recently", the query window is your first hypothesis about the problem's time scale. In daily troubleshooting, confirm scraping is healthy with browser DevTools or the Targets page first, then write expressions interactively in Explore, and once confirmed to have data, solidify them into panels and alert rules -- avoiding writing a one-off guess straight into production rule files. While practicing, use Prometheus's built-in Graph page to interactively complete metric names and confirm the expression has values on historical data, then paste it as-is into a Grafana panel -- editing and trying directly on a dashboard makes it hard to tell a wrong query from genuinely missing data when the chart is blank. Before a load test or a wide time-range switch, confirm the logic on a smaller interval first and widen gradually, sparing yourself one incident of blowing up the TSDB and slowing the whole query path.

## 5. Grafana: Turning Queries into Readable Panels

### 5.1 Connecting the Data Source and Importing Dashboards

After logging in at `:3000` (default admin/admin, password change forced on first login): Configuration -> Data Sources -> Add data source -> pick Prometheus -> URL `http://localhost:9090` -> Save & Test showing green means connected. Dashboards need not be drawn from scratch: Dashboards -> Import and enter a community Dashboard ID to reuse a mature layout; the four most used are 1860 (Node Exporter Full, whole-host view), 7362 (MySQL), 12708 (Nginx), and 893 (Docker & System); at import, choose the data source you just created and Apply yields a full set of panels aligned with the exporter's metric names. If you want to change the layout, Save As your own copy -- editing the community original directly gets overwritten on the next import/sync, the same restraint as keeping `.pacnew` around when editing distro default config files.

### 5.2 Panel Design Trade-offs

Twenty charts on one page does not equal understanding monitoring: the first screen holds only the golden metrics that mean "act when it turns red" (availability, latency, traffic, errors, saturation), with details drilled down to the second page. Units, thresholds, and the granularity of `by (instance)` all affect how the false alarms look -- the same expression cannot copy thresholds between a host-level and a cluster-level panel. A few concrete moves that immediately improve usability: add alert annotations to key panels (Alerts -> panel annotation) so "why did this line go red" shows right on the chart; use a dashboard variable for an instance dropdown (a Query variable taking `label_values(node_uname_info, instance)`) so one dashboard covers all hosts instead of one copy per machine; choose auto-refresh by scenario -- 5s/10s during troubleshooting for watching real-time changes, 30s/1m for daily patrols, while a site-wide 1s refresh only adds query pressure. Grafana reads only; when a chart misbehaves, the debug order is: data source Test -> run the same PromQL by hand in Explore -> check `up` and scrape timestamps, consistent with the general rule "blank chart -> check the data chain first".

Alerts and panels share one PromQL mindset: a spike you can draw on a panel usually deserves a corresponding alert rule; conversely, a panel nobody looks at for a long time is often a blind spot where alerts are missing. Maintaining "golden metrics on the first screen + drill-down details + alerts on the key lines" as one whole saves rework compared to piling up charts and patching rules afterward. Variables, thresholds, and annotations -- seemingly icing on the cake -- actually decide whether the on-call engineer can locate a problem in three seconds at 3 a.m.; they are not decoration but part of the human-machine interface.

## 6. Alerting: From Rules to Notifications

### 6.1 Rule Files

An alert rule is "PromQL evaluated once per evaluation_interval", moving from pending to firing only after the `for:` duration is continuously satisfied -- `for: 5m` exists precisely to filter transient jitter so a single GC hiccup does not wake you at midnight.

```yaml
# /etc/prometheus/rules/node_alerts.yml
groups:
  - name: node_alerts
    rules:
      - alert: HighCPUUsage
        expr: 100 - (avg by(instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80
        for: 5m
        labels: { severity: warning }
        annotations:
          summary: "High CPU usage ({{ $labels.instance }})"
          description: "CPU usage has exceeded 80%, current value: {{ $value }}"
      # The memory alert is isomorphic: swap node_memory_* with a 90 threshold, severity: critical
```

::: v-pre
The main config pulls these YAMLs in with `rule_files`; after editing, `promtool check rules` then reload -- the same discipline as `named-checkzone` before changing BIND zones: if a syntax error only explodes at runtime, the alerting channel goes silently blind. Before loading rules, Arch users can run `pacman -Ql prometheus | grep rules` to see whether the package ships example rule files -- the factory samples are often exactly the paths `rule_files` references by default, and getting the filename wrong is the most common "rule written but never evaluated" cause. `{{ $labels.instance }}` and `{{ $value }}` inject the instance name and current value into the alert text, so recipients judge severity without returning to the platform; the `severity` label is the basis for Alertmanager's routing triage. Disk alert `expr` is isomorphic to memory -- swap `node_memory_*` for `node_filesystem_*` and filter by `mountpoint`, no need to copy a third YAML. `for:` and `severity` are the two knobs needing the most restraint: too short a `for` wakes you for spikes, and randomly assigned `severity` destroys the routing tree's triage value. Splitting rules by group (node/app/infra) reviews and rolls back better than one big file.
:::

### 6.2 Alertmanager

Alertmanager is independent of the Prometheus process: Prometheus only does "rule holds -> push the alert"; grouping (merging multiple alerts from one instance into one message), inhibition (suppressing derived alerts when a parent fault fires), silencing (maintenance windows), and email/IM routing all live in Alertmanager. The main config's `alerting.alertmanagers` points at it, and its own config (the Arch package defaults to `/etc/prometheus/alertmanager.yml`; standalone installs commonly `/etc/alertmanager/alertmanager.yml`) declares the `route` tree and `receivers`. An SMTP sketch:

```yaml
global: { smtp_smarthost: 'smtp.example.com:587', smtp_from: 'alertmanager@example.com' }
route: { group_by: ['alertname'], group_wait: 10s, repeat_interval: 1h, receiver: 'email' }
receivers:
  - name: 'email'
    email_configs: [{ to: 'admin@example.com', send_resolved: true }]
```

`group_wait` holds same-group alerts briefly so a fault moment does not flood your inbox; `repeat_interval` controls the re-notification cadence while unresolved; `send_resolved: true` guarantees recovery notices too -- an alerting system where you only ever hear "something broke" and never "it is fine again" forces the on-call to confirm manually, which is poor design. Installation likewise differs per family: `pacman -S alertmanager` on Arch, `apt install prometheus-alertmanager` on Debian, `dnf install prometheus-alertmanager` on RHEL/EPEL; after installing, `systemctl enable --now alertmanager` and confirm port 9093 is correctly referenced by Prometheus.

## 7. Common Traps

**Charts entirely blank while the service is active.** First run one PromQL by hand in Grafana Explore: data present means the panel query or data source is wrong; no data means `curl localhost:9100/metrics` to see whether the exporter emits anything, then Prometheus's Status -> Targets page -- `up 0` or the whole page down points at the scrape config (wrong IP/port, job not reloaded) or a firewall block; Targets all green yet no history means the query's time range predates the deployment. The chain is fixed: "panel -> data source -> Targets -> exporter -> port", the same thinking as DNS debugging's "you are not asking that server".

**`rate` results are 0 or empty.** Confirm the metric is a counter and wrapped in `rate(x[window])`; the window must be at least twice the scrape interval (15s scraping pairs with `[1m]`, while `[5s]` is guaranteed empty); a metric name or label that no longer matches the exporter version (renamed after an upgrade) also yields empty -- grepping the metric name in the raw `/metrics` is fastest. Adding `rate` to a gauge and querying a counter raw are the two monitoring-config error classes most worth watching in code review.

**node_exporter is up but Targets has no such instance.** Check whether `prometheus.yml` lists the instance's `targets` and whether you reloaded after editing; if the instance exists but stays `up 0`, check whether the far side's 9100 listens on an external address (the exporter may default to loopback only) and whether the intervening firewall allows it -- the opening rules remain governed by the [Firewall](../../security/firewall.md) page. Another common beginner error is a copy-pasted job with conflicting `instance` labels or a forgotten port change; the Targets page's URL column exposes it directly.

**Alerts do not fire / no email.** Locate in four segments: Prometheus's Alerts page shows whether the rule is loaded and whether the state is pending/firing/inactive -- inactive means the expr is wrong or the threshold too loose; firing but no notification means checking whether `alerting.alertmanagers` is reachable; Alertmanager's Alerts page has records but no email means looking at the SMTP config and whether the `route` matches that `severity` label; email arrives but lands in spam means the sending domain's SPF/PTR is probably not aligned (an email reputation matter, see the [Mail](../mail/postfix.md) chapter). Every segment has its own UI or log to consult; treating "rule, push, route, delivery" as four train cars and checking them in order beats staring at the inbox waiting for a letter.

**Disk filled by the TSDB.** Prometheus retains 15 days by default, and time-series volume = number of targets x metrics per target x scrape frequency; blindly lowering `scrape_interval` or using high-cardinality labels (say the raw `url` as a label) multiplies storage exponentially. Handling: tighten retention with `--storage.tsdb.retention.time` -> audit `metric_relabel_configs` to drop useless metrics -> converge label cardinality, rather than endlessly adding disks -- adding disks only postpones the explosion, and the cardinality problem must be solved at the config layer. Same as image cleanup in the containers chapter: look at the breakdown first (`promtool`/the Targets metric list), cut the bulk, and only then touch storage hardware.

**Alert storms / multiple emails for one fault.** Usually Alertmanager not grouping or too short a `for`: CPU, memory, and disk alerts from one instance should be merged into one message by `group_by: ['instance']`; transient `up 0` alerts from network jitter are filtered by increasing `for` or inhibiting in Alertmanager (parent fault suppresses child alerts). The debug order is fixed: Alerts page state -> Alertmanager routing tree -> whether receivers match `severity`, consistent with the four-carriage "rule, push, route, delivery" method above; do not jump straight to editing SMTP.

**Rule file changed but never evaluated.** First `promtool check rules FILE` for syntax, then confirm the main config's `rule_files` glob actually covers your path, and finally `systemctl reload prometheus`. All three steps have explicit failure signals: check reports a YAML/expression error, a non-matching glob means the group is invisible on the Alerts page, and no reload means the process still holds the old rules -- the same static-to-effective acceptance chain as BIND's checkzone -> checkconf -> reload, where any skipped step surfaces at runtime as "silently no alerting".

## References

- Official Prometheus documentation -- [prometheus.io/docs](https://prometheus.io/docs/)
- PromQL function reference -- [prometheus.io/docs/prometheus/latest/querying/functions/](https://prometheus.io/docs/prometheus/latest/querying/functions/)
- Official Grafana documentation -- [grafana.com/docs](https://grafana.com/docs/)
- node_exporter -- [github.com/prometheus/node_exporter](https://github.com/prometheus/node_exporter)
- Alertmanager -- [prometheus.io/docs/alerting/latest/alertmanager/](https://prometheus.io/docs/alerting/latest/alertmanager/)
- Arch Wiki: Prometheus -- [wiki.archlinux.org/title/Prometheus](https://wiki.archlinux.org/title/Prometheus)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [monitoring](/commands/system/monitoring.md)
- [knowledge](/knowledge.md)
- [application-scenarios](/research/application-scenarios.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [README](/server/README.md)
- [ci-cd](/server/ci-cd.md)
- [redis](/server/redis.md)
- [automation](/system-management/automation.md)
- [backup-and-recovery](/system-management/backup-and-recovery.md)