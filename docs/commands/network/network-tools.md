# Network Tools

Troubleshooting is least afraid of too many commands and most afraid of **not knowing which one to reach for right now**: `ping` gets through but `curl` times out, and you may end up retrying ping over and over; you swap in several `nameserver` addresses and resolution still fails, when the real problem may be `/etc/hosts` precedence. This page lays the tools out by **scenario** -- first answering "which one when", then giving each tool's key usages, real output, and reading clues. For command-level syntax details, trust `man`; this page collects only what you would actually type in the field.

> Division of labour with the previous page: [Network Management Commands](./network.md) covers "local state" (interfaces, routes, ports, configuration entry points, the DNS path), while this page covers "active probing and transfer" (ping/trace/DNS queries/HTTP/remote copy/packet capture). Firewall rules are in [Network chapter - Firewall](../../network/firewall.md). Unless noted otherwise, `ping`, `dig`, `curl`, `ssh`, `rsync`, and `tcpdump` work the same across **Debian/Ubuntu, Arch, and RHEL/CentOS/Rocky**; `traceroute` and `nmap` are not installed by default on any of the three families, so install the package before first use.

## What This Page Covers

- Building the "layered problem -> matching tool" decision habit instead of blindly retrying the same command
- Using `ping`/`mtr`/`traceroute` to separate "which segment is broken"
- Using `dig`/`host`/`resolvectl` to separate "which step of resolution failed"
- Using `curl -w` to break connect, TTFB, and total time apart, locating which layer is "slow"
- Using `tcpdump` for a quick look at whether a port has traffic and whether TCP handshakes succeed
- Using `nmcli` to inspect and change connections on NetworkManager machines (RHEL 8+, Arch desktops, some Ubuntu)

## 1. Which one when: the scenario decision table

The fixed troubleshooting order is: **link -> path -> DNS -> application port -> application logic**. Each layer has its tools; skipping a layer and retrying only wastes time.

| Symptom / problem | First move | Why this one | Further |
|-----------|----------|------------|--------|
| "The network seems down" | `ping -c 4 gateway` | First confirm the local machine can reach the first hop | On failure check `ip addr`, `ip route` |
| "The target is entirely unreachable" | `ping -c 4 targetip` | Using the IP rules out DNS interference | If it works, check DNS; if not, go one layer deeper |
| "I do not know where it breaks" | `mtr -rw targetip` | One shot yields path + loss + latency | Without mtr, use `traceroute -n` |
| "Domain resolution fails / the answer is wrong" | `dig targetdomain` | Ask a named resolver directly, bypassing application caches | See section 3 to judge the chain |
| "curl is slow / times out" | `curl -o /dev/null -sw ...` | Splits DNS/connect/TTFB/total time apart | Compare direct-IP access against domain access |
| "Is the port open" | `timeout 3 bash -c '</dev/tcp/host/port'` or `nc -zv` | Tests at the TCP handshake layer | If it opens but HTTP errors, check the application |
| "The connection is established but the data looks wrong" | `tcpdump -ni interface port port` | Capture real packets: direction and flags | Cross-check the server log |
| "Need to change a Wi-Fi or NIC connection" (NM environments) | `nmcli device status` | NetworkManager is the RHEL 8+ / Arch desktop entry point | `nmcli connection up` |
| "Bulk file transfer / incremental sync" | `rsync -avz --dry-run` | See what would transfer first, avoiding overwrite accidents | See section 6 |
| "Speed test / file download" | `curl -o /dev/null URL` | Want throughput, not the file | For large files, resume with `-C -` |

An easily inverted example: **`ping` works but `curl` does not**. ping walks ICMP, curl walks TCP 80/443 -- passing the former only proves layer-3 reachability, not that the layer-4 port is allowed or that the service is listening. The right moves then are `ss -tlnp` to see listeners, the firewall page to check the allow rules, and `tcpdump` to see whether SYNs come back with SYN-ACKs.

There is a question as important as "which tool": **which machine to run it on**. For local troubleshooting, just type the command; to confirm "is it only broken on my side", rerun the same test from another machine (ideally another subnet or cloud region) against the same target -- only when both fail does it point at the target or the path in between, while one side failing sends you back to the local machine to check routing, DNS, and proxies (`curl` honours the `http_proxy` environment variable, `ping` does not, which is also a common root of "the browser opens fine but curl acts odd"). Treating "switch machine, switch tool, switch layer" as three orthogonal switches beats retrying the same command on the same machine over and over.

## 2. Path and latency: ping / traceroute / mtr

### 2.1 ping -- answers "is it up, is it stable"

```bash
$ ping -c 4 192.168.5.11
PING 192.168.5.11 (192.168.5.11) 56(84) bytes of data.
64 bytes from 192.168.5.11: icmp_seq=1 ttl=64 time=0.467 ms
64 bytes from 192.168.5.11: icmp_seq=2 ttl=64 time=0.443 ms
64 bytes from 192.168.5.11: icmp_seq=3 ttl=64 time=0.486 ms
64 bytes from 192.168.5.11: icmp_seq=4 ttl=64 time=0.455 ms

--- 192.168.5.11 ping statistics ---
4 packets transmitted, 4 received, 0% packet loss, time 3005ms
rtt min/avg/max/mdev = 0.443/0.462/0.486/0.024 ms
```

Read four numbers: `ttl=64` is common but does not mean only 64 hops (the peer rewrites it); `time` is round-trip latency, under 1 ms on the same subnet, possibly 150-300 ms cross-ocean; non-zero `packet loss` with normal `time` points first at intermediate loss or ICMP rate limiting; large `mdev` (jitter) means an unstable link, even if the average latency looks good. **First `ping -c 4 gateway`, then `ping -c 4 1.1.1.1` (or `223.5.5.5`), and only then ping a domain** -- three steps that split "local machine / egress / domain" apart.

On the public internet, ICMP may be dropped by carriers or cloud security groups, and `Request timeout` does not necessarily mean the business is down: switch to `curl` or `nc` against the real service port. Linux `ping` sends continuously by default and ends with Ctrl-C; the Windows-style `-n` does not exist, use `-c`. All three families ship it from `iputils` (RHEL minimal may need `sudo dnf install iputils`).

On a multi-NIC machine, ask one more question: **which NIC did the ping leave from**. Use `ping -I ens18 target` or first check `ip route get target`, otherwise the default route is bound to the management network while you are measuring the health of a different link, and the conclusion lands on the wrong head. If pings from inside a container show a very low TTL or fail entirely, first confirm whether NET_ADMIN or network namespace restrictions apply -- do not blame the host outright.

### 2.2 traceroute -- answers "which hop is the break at"

traceroute output has a fixed shape: the first line gives the resolved target and the hop limit, then one line per hop with three sampled timings. `-n` disables reverse hostname lookups -- always add it when troubleshooting, because the lookup itself can hang or return misleading names. A hop showing `* * *` only means **that device does not answer ICMP time-exceeded**, not that everything behind it is broken; what matters is whether the last hop reaches the target. **If everything after some hop times out, and the target is also unreachable**, the break is near there -- hand that IP to the carrier or a cloud ticket. Package names across the three families: Debian/Ubuntu `traceroute`, Arch `pacman -S traceroute`, RHEL `dnf install traceroute`.

The difference in principle between traceroute and mtr is worth knowing: traceroute uses incrementing TTLs to make intermediate devices return "time exceeded" messages, while mtr samples continuously and computes statistics. So a single traceroute hop's latency jitters; to judge "is a certain segment slow", trust mtr's Avg/Best/Wrst over the biggest number in one traceroute run. UDP mode (the Linux default) may come back all stars when the firewall allows only ICMP; switching to `traceroute -I` (ICMP) or `traceroute -T` (TCP 80) often gets through -- **retrying with a different protocol is not cheating, it is probing the filtering policy**.

### 2.3 mtr -- ping and traceroute combined

The header of mtr's report mode is HOST plus a column of statistics (Loss%, Snt, Last, Avg, Best, Wrst, StDev), one line per hop. `-r` is report mode (runs and exits, script-friendly), `-c` sets the round count. **One middle hop with high `Loss%` but normal hops after it** usually means that hop rate-limits ICMP -- ignore it; **Loss stuck at 100% from some hop onward with no recovery** means the break is there. Public-internet egresses often show loss on hops 2-3 yet full reachability in the end -- do not misread that as a fault. Install on Arch: `sudo pacman -S mtr`; on RHEL: `sudo dnf install mtr`.

`StDev` (standard deviation) and `Wrst` are often more diagnostic than `Avg`: an Avg of 20 ms with a Wrst of 400 ms means queueing jitter or intermittent congestion somewhere on the path -- video calls and long-lived database connections feel it first, while short HTTP connections may "look fine". When comparing baselines, run at **the same time of day, the same target, and the same `-c` round count**, otherwise numbers across evening peak are not comparable. Save outputs as text (plain redirection) into before/after change comparisons -- far easier to grep than screenshots.

## 3. DNS queries: dig / host / nslookup / resolvectl

Break resolution problems into three steps: **did local hosts win the race? is the resolver configured right? does upstream answer correctly?** `dig` reads `/etc/resolv.conf` by default, so if it works while the application does not, the problem is in `nsswitch`/`hosts` or the application cache; if dig fails too, then check the resolver and upstream.

In a full `dig` output, only four spots matter: the `status` in `HEADER` (`NOERROR`/`NXDOMAIN`/`SERVFAIL`), whether `flags` contains `ra` (recursion available), the records and TTL in `ANSWER SECTION`, and the trailing `SERVER` and `Query time`. In the example, `status: NOERROR`, one A record, and `SERVER: 127.0.0.53#53` mean **you asked the local stub**, not upstream directly; `Query time: 12 msec` suddenly growing to seconds points at upstream RTT or timeout retries, not local CPU.

The three key lines, compressed once more: `status: NOERROR` means an authoritative answer (`NXDOMAIN` is the one that means the name does not exist); the A record in `ANSWER SECTION` is the result; a `SERVER` of 127.0.0.53 means that to separate stub from upstream you must fire one more `dig @upstream` for comparison.

```bash
dig @223.5.5.5 example.com A +short          # ask public DNS directly; +short prints just the answer
dig example.com AAAA                         # IPv6 records
dig example.com MX +noall +answer            # mail exchanger records
dig example.com NS                           # authoritative NS
dig +trace example.com                       # trace level by level from the root
dig -x 198.18.0.47                           # PTR reverse lookup
```

`+short` is the scripting workhorse; `+trace` output is very long -- use it only when you suspect "the answer I got is not authoritative". `host` is dig-lite (`host example.com`); `nslookup` is the old tool, and in interactive mode it does not read `/etc/hosts` -- **never use it as evidence when tracking local hosts overrides**: `getent ahosts domain` or `ping domain` are what reflect the application's real path.

There is also a layering experiment worth making a habit: run the same domain through `getent`, then `dig` (default, via the stub), then `dig @8.8.8.8` (direct upstream). When the three disagree, the disagreement itself names the broken layer -- `getent` wrong with dig fine means nsswitch/hosts; default dig wrong with `@upstream` fine means the local stub or the NIC's delivered DNS; even `@upstream` wrong means outbound UDP/TCP 53 or upstream itself. `dig`'s `status` describes only the DNS protocol layer: `NOERROR` with `ANSWER: 0` means "the name exists but has no such record" (an AAAA-only domain, say) -- not the same thing as `NXDOMAIN` (the name does not exist); do not conflate the two in scripts.

Under systemd-resolved there are also status queries (same source as section 5 of [Network Management Commands](./network.md)):

```bash
$ resolvectl query example.com
example.com: 198.18.0.47 -- link: ens18
-- Information acquired via protocol DNS in 2.9ms.

$ resolvectl flush-caches      # flush the cache after changing upstream
```

A classic misjudgement: editing `/etc/resolv.conf` and immediately digging the new server -- if that file is a stub link to `127.0.0.53`, the field you edited may be ignored or overwritten by resolved. Check the link with `ls -l /etc/resolv.conf` first, then verify upstream itself by naming it explicitly with `dig @server`.

## 4. HTTP and transfer: curl / wget

`curl` is the troubleshooting workhorse; `wget` leans towards "downloading files". Judging "where is the site slow" requires splitting stages, not staring at total time:

```bash
$ curl -o /dev/null -sw 'DNS:%{time_namelookup}s TCP:%{time_connect}s TLS:%{time_appconnect}s TTFB:%{time_starttransfer}s total:%{time_total}s HTTP:%{http_code}\n' https://www.qq.com/
DNS:0.011193s TCP:0.014423s TLS:0.077196s TTFB:0.099884s total:0.099915s HTTP:200
```

- Large `time_namelookup` -> a DNS problem, back to section 3
- Large `time_connect` (TCP) -> slow three-way handshake; check routing, loss, or port blocking
- Large `time_appconnect` (TLS) -> certificate chain or crypto negotiation problem
- Large `time_starttransfer` (TTFB) -> the server application is slow, not the network layer
- `http_code` 4xx/5xx -> network is fine, the application refuses or errors; read the service logs

Swap the domain for a bare IP and rerun `-w`, and DNS versus network separates instantly: direct-IP fast with the domain slow means the problem is 100% in resolution; both equally slow means the path or the peer. HTTP code semantics should be mental arithmetic: `301/302` are redirects (`curl -L` to follow), `403` is permissions or gateway policy, `502/504` are upstream application or timeout -- **504 reads more like "the application is too slow", 502 more like "the upstream process is dead"**; do not retry them all as "network jitter". In scripts, always pin `--max-time` and check `http_code` together, so a 404 is not counted as success and a hang is not counted as slow.

The daily one-liner kit in one sentence: headers without the body use `-I` (HEAD), the process use `-v` (watch SNI/certs/HTTP version), saving to disk use `-sSL -o`, death protection must be `--max-time`, virtual-host testing uses `-H 'Host: ...'`, cutover rehearsal uses `--resolve` to pin a domain to a chosen IP, and API simulation uses `-X`/`-d`/`-H` to compose the right method, body, and headers. In scripts, check the exit code and `http_code` -- do not settle for "curl printed something".

If TLS fails in `-v` output, first check whether the certificate chain is complete and the system clock is right (a wrong clock creates fake "certificate not yet valid / already expired" faults). `wget` equivalents: `wget -O file URL`, `wget -c` to resume; neither validates anything beyond certificate semantics, so check exit codes in scripts.

The split between wget and curl, stated once more: curl is the **probe** (HEAD, custom headers, staged timings, client simulation); wget is the **mover** (recursive `-r`, rate limiting, resume, mirroring). To ask "is the site good" use curl; to pull down a directory tree, wget saves effort. Both honour proxy environment variables, and both behave differently on 3xx (curl does not follow redirects by default, wget does) -- write that into a script comment and spare yourself endless "why is this different from the browser" arguments.

Two more must-know HTTPS parameters: `-k`/`--insecure` skips certificate validation and is **for temporary intranet probing only** -- in a production script it disables man-in-the-middle protection; `--cacert cacert.pem` is the correct way in self-signed environments. If `curl -I` returns `HTTP/1.1 405`, first check whether the peer implements GET only -- an unsupported HEAD does not mean the site is broken. Under HTTP/2 the handshake timing still lands in `time_appconnect`; if TTFB dwarfs the TLS completion time, the bottleneck is already on the application side and further timeout tuning is pointless.

## 5. Remote access and packet capture: ssh / scp / rsync / tcpdump

Remote operations and packet capture share a section because they share one premise: **you already know whom to connect to and which NIC to watch**. The earlier sections settle "is the network up"; this one settles "once it is up, how to touch the machine safely and how to leave evidence". The ssh session itself is also the most common out-of-band observation channel -- when HTTP is dead but SSH lives, getting in over ssh to run `ss`/`journalctl` beats curl-ing from the client again and again.

### 5.1 ssh -- sessions and port forwarding

The everyday shapes of `ssh` collapse into three groups: connection -- port `-p`, identity `-i`, jump host `-J`; forwarding -- local `-L` (pulls a service on the remote loopback to a local port); debugging -- test port 22 with `nc`/`</dev/tcp` first, then check `ss -tlnp | grep :22` on the server, and only then suspect keys and passwords. `-L 8080:127.0.0.1:80` is the standard way to reach "a service listening only on the remote loopback" (a remote `127.0.0.1:3306`, say).

`-J bastion` (ProxyJump) suits the topology "the public internet reaches only the bastion, the business hosts sit inside" -- shorter and less error-prone than the old `-o ProxyCommand="ssh -W %h:%p bastion"`. On first connection, always verify the fingerprint by hand (or preseed `known_hosts`); `StrictHostKeyChecking=no` in a script belongs only in one-shot, disposable CI containers. Authentication failure and connection timeout are two different problems: the former shows the SSH banner and negotiation logs, the latter never even gets a banner -- **first separate "cannot connect" from "not allowed in"**, then go dig through `authorized_keys` permissions or password policy; the server-side log (the `sshd` journal) is always closer to the truth than a spinning client.

### 5.2 scp and rsync -- when to use which

`scp` fits **one-shot, single-file, simple paths**; `rsync` fits **directories, increments, resume, bandwidth control, delete-sync**. Prefer rsync for production syncs because it supports a `--dry-run` preview:

```bash
scp report.txt user@host:/tmp/
scp -r project/ user@host:/backup/

rsync -avz --dry-run project/ user@host:/backup/project/   # rehearse only, transfer nothing
rsync -avz --delete project/ user@host:/backup/project/     # really deletes extra files on the remote (dangerous, dry-run first)
rsync -avz --progress -e "ssh -p 2222" large/ user@host:/data/
```

`-a` preserves permissions, times, and symlinks; `-v` is verbose; `-z` compresses the transfer. **Remove `--dry-run` only after its listing passes review**; the trailing slash on the source (`a/` vs `a`) changes semantics -- syncing the directory itself or its contents. All three families use the `rsync` package; on systemd hosts you may also meet the `rsync.service` daemon mode.

Two more selection rules of thumb: for thousands of small files, rsync's incrementality and metadata preservation almost always beat scp/`scp -r`; for one cold backup of a few GB where "push it and be done" is enough, scp or even `curl -T` will do. Off port 22, rsync takes `-e "ssh -p 2222"` rather than stuffing the port into the target path. Before a large directory's first sync, run `--dry-run | tail` to check the path assembly (especially `/path/` vs `/path`), confirm, then drop dry-run; for cron jobs carrying `--delete`, keep the dry-run comparison output in the log so you can answer "what did it delete" quickly when something goes wrong.

When bandwidth is tight, add `--bwlimit=5000` (unit KB/s), or lower disk priority with `ionice`/`nice`; with a spinning-disk source and a cloud-disk target, the first full run is usually bound by random reads on the source -- **do not blame the network for low throughput right away**: check with `rsync --progress` whether it is grinding through hordes of small files. With symlinks and permissions involved, `-a` already expands to `-rlptgoD`; generally do not strip `-p`/`-g`/`-o` yourself, or ownership and permissions will be a mess on the new machine after restore.

### 5.3 tcpdump -- a look at real packets

Packet capture is **evidence**: when firewall rules and service logs contradict each other, it settles the case. The three most-used moves: capture a port, watch only the handshake, save to a file for Wireshark.

```bash
sudo tcpdump -ni ens18 port 80 and host 192.168.5.125 -c 20
sudo tcpdump -ni ens18 'tcp[tcpflags] & tcp-syn != 0' -c 10     # SYNs only (including SYN-ACK/RST)
sudo tcpdump -ni ens18 port 443 -w /tmp/https.pcap              # write to disk for offline analysis
```

`-n` disables name resolution, `-i` selects the NIC (omit it and you capture on all interfaces -- very noisy on a production box). Reading the output: `Flags [S]` is SYN, `Flags [S.]` is SYN-ACK, `Flags [R.]` is RST -- **seeing only outgoing SYNs with no SYN-ACK coming back** means the path or the peer is not picking up; **SYN-ACKs present but the application reports connection refused** -- check whether the service listens at all, and `ss -tlnp`. If you capture nothing at all, first confirm the interface (`ip -br link`), then the filter syntax (`port` should not carry bogus prefixes like `tcp.`). Install: the package is `tcpdump` on all three families -- `apt install tcpdump` / `pacman -S tcpdump` / `dnf install tcpdump` when not preinstalled.

Before capturing, fix the **single question** you want answered (who sends first, is there an RST, did TLS complete), then design the filter; otherwise a bare capture on all interfaces is noisy and can also raise compliance issues. On a shared cloud host, look only at your own five-tuples in the captured traffic and never pass the pcap around. If the local capture shows nothing while the application clearly has connections, check whether traffic goes through a proxy or whether you `nsenter`ed into a different network namespace -- **no packets in the capture does not mean no traffic; it may mean you are capturing in the wrong netns**.

## 6. NetworkManager: an nmcli scenario cheat sheet

**Use only on machines where NetworkManager manages the network** -- RHEL/CentOS/Rocky 8+, Fedora, Arch desktops, and some Ubuntu (desktop editions with `network-manager`) default to it; when `nmcli general status` hangs or `nmcli` errors out, the system runs systemd-networkd or ifupdown instead -- switch to the entry points in section 4 of [Network Management Commands](./network.md) and do not force-write NM configuration files.

A `connection` is a **configuration file**; a `device` is the **hardware** -- "connection saved but not active" usually means `connection up` was never run, or the device sits in `unmanaged` (`nmcli device set eth0 managed yes` recovers it). After changing DNS, run `resolvectl flush-caches`, or the resolution layer keeps serving the old cache. These operations write into `/etc/NetworkManager/system-connections/` (keyfile, mode 600) and survive reboots -- exactly what sets them apart from a temporary `ip addr add`.

The everyday nmcli patterns collapse into five classes: status `general status`/`device status`/`connection show`, wireless `device wifi list`, activate/deactivate `connection up|down name`, change configuration `connection modify name field value`, re-push `device reapply interface`. In the field, `nmcli device status` gives device name, type, and the three states `connected`/`disconnected`/`unmanaged` in one line; desktop "cannot join the Wi-Fi" shows `disconnected` here nine times out of ten while the user believes they are connected. Before scripting configuration changes, fetch connection names with `nmcli -t -f NAME connection show` (`-t` terse mode parses cleanly), then `connection modify` -- **never hardcode display names containing spaces or non-ASCII characters**; when creating a connection, give it a stable ASCII name with `nmcli con add ... con-name wired1`. Afterwards confirm `100` (connected) with `nmcli -t -f GENERAL.STATE device show eth0` -- more reliable than the NetworkManager icon.

When should you abandon nmcli for declarative files? When network configuration must go into Git or ship in unattended bulk deployments, a keyfile (`.nmconnection`) reviews better than a pile of `nmcli modify` calls; when a server must stay minimal without NM, go straight to networkd/Netplan. **nmcli's strength is interactive state in one place, not the only truth** -- the selection criteria remain the master table in section 4 of the previous page: first confirm who manages this machine, then decide where to change things. Since RHEL 8, `network-scripts` is gone; stop copying `ifup ifcfg-eth0` from old documents into new projects.

## 7. Common pitfalls

1. **Assuming the port is open because ping works**. ICMP and TCP are two different roads; verify the target port with `nc -zv host port`, `curl`, or `</dev/tcp`.
2. **Sentencing a route to death because the middle is all `*`**. As long as the last hop reaches the target, middle stars only mean those devices do not answer ICMP.
3. **Using nslookup to verify /etc/hosts**. nslookup skips `files`, so its results diverge from the application; use `getent ahosts` or just `ping domain`.
4. **Seeing 127.0.0.53 in dig and concluding the configuration never applied**. The systemd-resolved stub is the local entry point; the real upstream is in `resolvectl dns`.
5. **Running curl without `--max-time`**. Interactively a human hits Ctrl-C; in a script it hangs forever -- `--max-time` is mandatory.
6. **Firing `--delete` at rsync right away**. Review the listing with `--dry-run` first, confirm the source's trailing slash, then delete.
7. **Running tcpdump without `-i`/`-n`**. Capturing all interfaces while resolving hostnames is slow and unreadable; in production, pin `-ni interface` and add a `host`/`port` filter.
8. **Running nmcli on a networkd/Netplan machine to change configuration**. `nmcli` only affects NetworkManager; the wrong entry point equals no change at all. Decide first with `netplan status` or `systemctl is-active NetworkManager`.
9. **Assuming traceroute/nmap/mtr are preinstalled on all three families**. They usually are not: `apt install traceroute`, `sudo pacman -S traceroute`, `dnf install traceroute`; same for `nmap` (and it is a scanning tool -- aim it only at authorized targets).
10. **Reading high middle-hop loss in mtr as a fault**. Judge by "do later hops recover, is the target reachable".
11. **Concluding after testing one end only**. Symmetric problems need tests from both ends (A->B and B->A, or add a C); one-sided data cannot separate "my egress is broken" from "their entrance is broken".
12. **Ignoring proxy environment variables**. `curl`/`wget` honour `http_proxy`/`https_proxy`; `ping`/`nc`/`tcpdump` do not -- when "curl times out but ping is fine", run `env | grep -i proxy` before talking about the network.

## 8. Real-world walkthroughs of tool combinations

Knowing each command individually is a pass; stringing them together by scenario is the watershed of troubleshooting. The four walkthroughs below add no new syntax -- they demonstrate **the order of judgement**. Read them against the decision table in section 1 and walk the same order when a similar ticket arrives.

**Scenario one: a user reports "the site will not open", but another machine in the office is fine.** On the user's machine, first `ping -c 3 targetip` to rule out a total outage; then `dig targetdomain` and compare the two machines' answers -- different A records means check `/etc/resolv.conf`, `hosts`, and proxies; identical answers means run `curl -o /dev/null -sw ...` to see whether it stalls at DNS, TCP, or TLS; finally `nc -zv target 443` and `ss -ant` to confirm whether the connection fails or connects and then the application errors. No more than five commands end to end, each one overturning or confirming exactly one hypothesis -- **swap the command to swap the hypothesis, instead of re-running curl -v twenty times**.

**Scenario two: intermittent timeouts between services, with no clear error in the logs.** The answer to this class is almost always in "jitter", not "down". Run `mtr -rw -c 50` on the suspect path and read StDev/Wrst; capture handshakes and RSTs with `tcpdump` on both ends to see whether the timeout moment is a SYN with no reply or an application dragging its feet; if a proxy or gateway sits in the middle, use `curl`'s staged timings to tell gateway-slow from backend-slow. A single successful ping brings false comfort -- **you must use a statistical tool with enough rounds to see tail latency**, or you will declare "the network is fine" before midnight.

**Scenario three: after a change, some clients cannot resolve the domain.** First establish whether it is "all clients" or "some network zones" -- if some zones, suspect the zone-scoped DNS delivery or a firewall policy on port 53 before suspecting the authoritative server; on a broken client run `dig @knowngoodupstream domain`: a good answer means the local resolution chain is broken, a bad one means outbound 53 or upstream is broken; then check whether `resolvectl dns` delivered the nameservers you expected, and whether someone added a wildcard hijack to `hosts:`. After the fix, double-accept with `dig +short` and the business `getent`, so you fix both the command line and the stale cache the application process still holds.

**Scenario four: at 2 a.m. you get a disk-IO-high alert plus a network alert.** Do not treat them as two unrelated events: a large file write and a network sync can amplify each other. Use `ss -s` to check whether connections exploded, sample with `tcpdump -c` whether bulk transfer continues, and use `curl` or application metrics to tell who is pulling data; if it is a backup job, fall back to rsync's `--bwlimit` and its schedule window. **The value of the tools is splitting "network jitter" and "the disks are screaming" into two separately fixable signals** -- not letting two alarms blink together until dawn.

The shared skeleton behind these four scenarios: **coarse to fine, local machine to whole network, deterministic commands to statistical commands**. ping/mtr/nc/dig are deterministic probes; curl -w and tcpdump are layered evidence; mtr statistics and log trends are the jitter in the tail. As long as you advance one layer at a time, no tool list is long enough to get lost.

## References

- `man ping`, `man traceroute`, `man mtr`, `man dig`, `man curl`, `man rsync`, `man tcpdump`, `man nmcli`
- Bird's Private Recipes (Lin's Linux Administration Guide) - network debugging tools and command examples -- [linux.vbird.org](https://linux.vbird.org/linux_server/centos6/0110network_basic.php#tool_ifconfig)
- Arch Wiki - Network configuration (includes the Troubleshooting section) -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Network_configuration)
- Arch Wiki - NetworkManager (nmcli) -- [wiki.archlinux.org](https://wiki.archlinux.org/title/NetworkManager)
- dig manual (ISC BIND) -- [bind9.readthedocs.io](https://bind9.readthedocs.io/en/latest/manpages.html)
- curl manual - write-out variables (-w) -- [curl.se](https://curl.se/docs/manpage.html)
- tcpdump manual -- [tcpdump.org](https://www.tcpdump.org/manpages/tcpdump.1.html)
- Red Hat - Monitoring and managing system status and performance -- [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/monitoring_and_managing_system_status_and_performance/index)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/commands/README.md)
- [network](/commands/network.md)
- [network](network.md)
- [commands-practice](/network/commands-practice.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [routing-nat](/server/routing-nat.md)
- [ssh](/server/ssh.md)
