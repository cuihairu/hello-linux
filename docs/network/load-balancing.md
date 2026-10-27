# Load Balancing

A single server always has a ceiling,
yet the availability demands of a business
often exceed what any one machine can promise.
Load balancing resolves exactly that tension:
**spread requests across many backends,
and pull one out automatically when it fails**.
It is not a small trick of "configure an upstream and you are done,"
but a complete system involving L4/L7 layering and selection,
algorithm semantics,
health checks, and a highly available VIP.

This page first nails down the layers and the choices
(which decide 80% of the architecture),
then gives deployable configurations and troubleshooting
approaches for Nginx, HAProxy, and LVS.

> Content adapted from the Nginx, HAProxy, and IPVS
> official documentation and hands-on operations
> experience; see the references at the end.

## What This Page Covers

- Telling L4 and L7 load balancing apart,
  and choosing Nginx or HAProxy by the shape of the business
- Understanding where round-robin, weighting, least-connection,
  and consistent hashing apply and where they bite
- Configuring health checks, session persistence, and failover,
  and understanding the role of the Keepalived VIP
- Recognizing common configuration traps
  (no active health checks in the open-source editions,
  timeout chains, sticky sessions failing)

## 1. Why Load Balancing

A load balancer carries four duties at once,
and each one is exposed the moment something fails.

**Horizontal scaling**.
When traffic grows you add machines,
and the application layer never has to know.
Scaling turns from "change the code" into "change a weight,"
which is a huge organizational shift --
capacity decisions no longer need a development slot.

**Failure removal**.
When a backend dies,
the load balancer takes it out of the forwarding pool
and users barely notice --
this is where "high availability" actually lands.
A "multi-machine deployment" without removal
only multiplies the probability of failure by the machine count,
and users see more errors, not fewer.

**A single front door**.
SSL offloading, rate limiting, canaries, and logging
all converge at the entry layer
instead of being repeated on every backend.
Certificate rotation goes from "change N machines" to "change one place,"
and that order-of-magnitude difference in operational steps
shows up the first time a certificate expires.

**Traffic shaping**.
Route different requests to different resource pools
by weight, region, or path
(static assets to CDN nodes,
dynamic requests to the compute pool).
This makes "different traffic under the same domain"
governable separately for the first time.

Without load balancing,
a full disk on any single machine is a site-wide incident;
with it,
a single machine failing is demoted from "outage" to "slightly less capacity."
Of course the price is that the entry point itself becomes a new single point of failure --
which is exactly why section 6's Keepalived exists.

## 2. L4 and L7: Layer First, Then Choose

### 2.1 The Essential Difference Between the Two Layers

**L4 (transport layer)** load balancing
only looks at IP and port,
forwards TCP/UDP connections to the backend as they are,
and never parses application-layer content.
The representative implementations are LVS (IPVS),
HAProxy in `mode tcp`,
and cloud providers' layer-4 listeners.

**L7 (application layer)** load balancing
parses the HTTP request
(Host, path, headers, cookie)
and dispatches on application semantics,
which allows URL-based routing,
SSL offloading, a WAF, and rewriting request headers.
The representatives are Nginx,
HAProxy in `mode http`,
and the various API gateways.

For the backend the difference matters a lot:
in L4 mode the source address the backend sees
is the real client
(or an address after SNAT),
and the connection is end to end;
in L7 mode the backend receives a fresh connection
originated by the load balancer,
and must recover the real client IP from headers like `X-Forwarded-For` --
without that header,
backend logs and risk controls
see nothing but the load balancer's address.

Another difference is **failure semantics**:
an L4 connection failure is visible to the client
(cannot connect is cannot connect),
while L7 can take a backend's failure
on an already-established connection
and turn it into a 502/504,
or even rewrite it into a custom error page.
The latter gives you room for graceful degradation;
the former hands the choice to the client's retry logic.
When designing error pages and retry policies,
first know which layer you are standing on.

### 2.2 Selection Matrix

| Requirement | Recommendation | Why |
|------|------|------|
| Pure HTTP/web apps, needing routing by domain/path | **Nginx** | mature L7, intuitive config, rich ecosystem |
| Fine-grained TCP proxying + strong health checks + a stats page | **HAProxy** | both L4 and L7, active health checks and the stats page are its strengths |
| Long-lived connections such as databases, non-HTTP protocols | **HAProxy (tcp) or LVS** | no application-layer parsing, high forwarding efficiency |
| Very high concurrency, layer-4 forwarding, tens of thousands of RPS and up | **LVS (IPVS)** | in-kernel forwarding, minimal overhead |
| Working alongside hardware firewalls / traditional network gear | LVS / cloud SLB | kernel/infrastructure solutions sit closer to the network |
| One entry point doing SSL offloading plus unified rate limiting | Nginx or HAProxy | L7 terminates TLS and takes the load off the backends |

**Rule of thumb**:
small and medium HTTP businesses
start most easily with Nginx;
once you need active health checks,
mixed TCP proxying, or fine-grained stickiness,
move to HAProxy
or put a layer of HAProxy in front;
a single-layer Nginx runs out of CPU before the backends do
at around a hundred thousand concurrent connections,
and at that point hand L4 to LVS/a cloud SLB
and let Nginx do only L7.

One thing must be stated clearly:
**open-source Nginx has no true active health checks** --
it removes a failed backend passively
(connection failure, timeout)
on the next forwarding decision,
and requests in the interval still fail once;
active probing health checks
are a commercial feature of Nginx Plus.
The open-source HAProxy, by contrast, fully supports `check`.
This difference often causes
the complaint that "Nginx removes backends too slowly,"
so factor it into the selection.

One more combination is worth remembering:
**HAProxy for L4 and health checks,
Nginx for L7 routing and caching**.
Each layer does one job and both configs stay simple,
at the price of one extra forwarding hop.
There is no free lunch in architecture;
the point is to keep each layer's responsibility narrow enough
that a problem never requires reading two config files.

### 2.3 Forwarding Algorithms

The algorithm decides how a request lands on a backend,
and each has its limits:

| Algorithm | Behavior | Applies to | Trap |
|------|------|------|------|
| round-robin | handed out in turn | homogeneous, stateless backends | sessions get split across backends |
| weighted round-robin | proportional to weight | uneven server capacity | weights are static config, blind to live load |
| least-conn | to the backend with fewest connections | long connections, requests with very different costs | short-term hotspots can still skew |
| IP/source hashing | same IP lands on the same backend | stickiness needed without shared session storage | after NAT many users share one IP, severe skew |
| consistent hashing | a hash ring, backend changes affect only a local region | cache affinity | removing a backend triggers a local cache stampede |
| random | plain random | very large fleets, avoiding synchronized oscillation | can be uneven over short windows |

**The right posture for session persistence**
is to have the application store sessions externally
(Redis/database) first,
so the load balancer only does stateless distribution;
only when the application cannot be changed
should you fall back to IP hash or cookie stickiness --
the latter loses sessions when users switch networks
(Wi-Fi to 4G),
and hash skew is hard to reconcile.
Nginx open source's `sticky`
directive is a Plus feature;
in an open-source environment use `ip_hash`,
or solve it at the application layer.

There is also an easily overlooked precondition
for choosing an algorithm:
**first confirm the backends are actually homogeneous**.
Old and new versions running side by side,
machines three times apart in specification,
one machine whose disks are already aging --
all of these turn "fair distribution"
into "pushing traffic toward the weakest box."
Before rolling out a new algorithm,
look at the per-backend connection distribution statistics;
that finds more problems than reading the docs ten times.

## 3. Nginx Load Balancing

### 3.1 Basic Configuration

```nginx
upstream backend {
    # round-robin (the default)
    server 192.168.1.101:8080;
    server 192.168.1.102:8080;
    server 192.168.1.103:8080 weight=3;

    # session persistence (the open-source edition has ip_hash; sticky is a Plus feature)
    # ip_hash;
    # least_conn;
}

server {
    listen 80;
    server_name app.example.com;

    location / {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

The `proxy_set_header` trio almost has to be there:
without `X-Forwarded-For`,
every client IP in the backend logs
turns into the load balancer's address;
without `Host`,
a backend serving several sites by domain
gets the wrong virtual host;
without `X-Forwarded-Proto`,
https links generated by the application can come out as http,
showing up as "mixed content warnings on the page."

Two modifiers are also common:
`backup` makes that backend take no traffic normally
and activate only when the primary pool is entirely down,
which suits a cold-standby transition;
`down` is a manual withdrawal,
used for planned maintenance
and far cleaner than editing firewall rules.

### 3.2 Passive Health Checks and Timeouts

```nginx
upstream backend {
    server 192.168.1.101:8080 max_fails=3 fail_timeout=30s;
    server 192.168.1.102:8080 max_fails=3 fail_timeout=30s;
    server 192.168.1.103:8080 backup;
}
```

`max_fails=3 fail_timeout=30s`
means three failures within 30 seconds
marks the backend unavailable,
and it is retried after those 30 seconds --
this is a **passive** judgment:
requests in the window may still be routed there and fail.
If the business is extremely sensitive to availability,
pair it with external active probing
(the monitoring system `curl`-ing the health endpoint)
or switch to HAProxy.

Three timeouts have to be straightened out,
otherwise you get "502 even though the backend is clearly alive":

```nginx
proxy_connect_timeout 5s;
proxy_send_timeout    60s;
proxy_read_timeout    60s;
```

A `proxy_read_timeout`
shorter than the business's worst-case duration
is the number one cause of 502/504 --
monitoring shows a normal backend RT
while the gateway reports 504,
so check these three values first.
Before tuning a timeout, get the business P99 first
and set the gateway timeout
a safe margin above P99
rather than inflating it without limit --
an over-generous timeout holds connections
to a failed backend for a long time and drags down the whole pool.

### 3.3 SSL Offloading

```nginx
server {
    listen 443 ssl http2;
    server_name app.example.com;
    ssl_certificate     /etc/nginx/ssl/app.pem;
    ssl_certificate_key /etc/nginx/ssl/app.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / { proxy_pass http://backend; }
}
```

Once TLS is terminated at the entry,
the leg between backend and load balancer
can run plain HTTP (inside a trusted internal network),
which saves backend CPU and unifies certificate management.
If the two cross an untrusted network,
keep encrypting with `proxy_pass https://`
or HAProxy `mode tcp` --
**"internal network" is not a free pass on trust**;
"internal" links crossing data centers or availability zones
should be re-evaluated for encryption.

Two practical details on certificate management as well:
after ACM/Let's Encrypt renews automatically,
you must reload for it to take effect;
during a canary rollout, verify the new certificate
on one entry machine first,
then spread it to all of them --
a site-wide outage caused by a misconfigured certificate
is more painful to recover than a backend failure.

## 4. HAProxy

### 4.1 Installation

All three families package it:
Arch uses `pacman -S haproxy`,
Debian/Ubuntu uses `apt install haproxy`,
and RHEL/CentOS/Rocky uses
`dnf install haproxy`.

### 4.2 Configuration Structure

A HAProxy configuration is made of
`global`, `defaults`,
`frontend`, and `backend` sections,
whose separation of duties is clearer than Nginx's mixed configuration:

```bash
# /etc/haproxy/haproxy.cfg
global
    daemon
    maxconn 256

defaults
    mode http
    timeout connect 5s
    timeout client  50s
    timeout server  50s
    option httplog

frontend http-in
    bind *:80
    default_backend servers

backend servers
    balance roundrobin
    option httpchk GET /health
    server web1 192.168.1.101:8080 check inter 2s rise 2 fall 3
    server web2 192.168.1.102:8080 check inter 2s rise 2 fall 3
```

The semantics of
`check inter 2s rise 2 fall 3`
are: probe every 2 seconds,
mark UP after 2 consecutive successes,
mark DOWN after 3 consecutive failures.
Compared with Nginx's passive mode,
**active probing completes the removal
before a user request ever arrives**,
which measurably lowers the failure rate --
this is HAProxy's core advantage under strict SLAs.

Designing the health check path is itself real work:
`GET /health` returning 200
does not mean the business is usable --
if it does not check the database,
the check stays green when the database is down.
Only by pulling critical dependencies into the check,
or by offering graded health endpoints
(`/health/ready` checks dependencies,
`/health/live` checks only the process),
does removal truly reflect business state.
An overly heavy check backfires:
probing 50 interfaces × 3 paths every second
is itself a noticeable load.

Non-HTTP traffic such as databases
only needs `mode` switched to `tcp`,
with `option mysql-check`
(or the generic `option tcp-check`) doing the probing:

```bash
frontend mysql-in
    bind *:3306
    mode tcp
    default_backend mysql-servers

backend mysql-servers
    mode tcp
    balance roundrobin
    option mysql-check user haproxy
    server db1 192.168.1.101:3306 check
    server db2 192.168.1.102:3306 check backup
```

The `backup` flag
keeps that backend out of normal traffic
and activates it only when every primary is DOWN --
commonly used for the "cold standby promoted to primary" transition.
Read/write splitting, on the other hand,
needs read/write routing
at the application or proxy layer;
`balance` alone cannot tell statement types apart.

### 4.3 Statistics and Operations

```bash
# stats listen (in defaults or a frontend)
stats enable
stats uri /stats
stats realm HAProxy\ Statistics
stats auth admin:StrongPass

# day-to-day operations
sudosystemctl start haproxy
sudosystemctl reload haproxy        # graceful reload, no dropped connections
curl -s http://localhost/stats | head
```

The difference between `reload`
and `restart` must be memorized:
reload spawns a new process
and lets the old one exit after draining its existing connections,
so connections are not interrupted;
restart kills the process outright
and every request in flight fails.
**Use reload for any configuration change**,
and check the stats page once before and once after
to confirm the backend states match your expectation.

The stats page is the first stop
for investigating "where did the traffic go":
current connections per backend,
queue length,
and error counts are all visible at a glance.
If some backend shows zero connections for a long time,
look at its `check` state first,
then at the weight and the `backup` flag --
nine out of ten cases of "uneven traffic" are explained on this page,
so there is no need to suspect the algorithm's implementation immediately.

The stats endpoint itself needs protecting too:
bind it to an internal address,
set a strong password,
or fence the source off with a firewall --
it exposes the complete topology and traffic picture
and has no business being on the public internet.

## 5. LVS: In-Kernel Layer-4 Forwarding

LVS (Linux Virtual Server)
is implemented through the IPVS kernel module,
sits on the forwarding path after the `INPUT` chain,
carries none of the overhead of a user-space proxy process,
and suits being the outermost layer-4 entry point.
Three forwarding modes:

- **NAT**: both directions have their addresses rewritten
  by the load balancer.
  Simple to implement, but it becomes the bandwidth bottleneck.
- **DR (direct routing)**:
  only the destination MAC is rewritten,
  and responses go from the backend straight to the client.
  Highest performance,
  but the load balancer and the backends must share a broadcast domain.
- **TUN (IP tunneling)**:
  the backend tunnels its replies back,
  which allows deployment across subnets,
  at the cost of the most complex configuration.

```bash
# Install the administration tool (Arch: pacman -S ipvsadm)
sudo apt install ipvsadm        # Debian/Ubuntu
sudo dnf install ipvsadm        # RHEL/CentOS/Rocky

# Add a virtual service: round-robin
sudo ipvsadm -A -t 192.168.1.100:80 -s rr
sudo ipvsadm -a -t 192.168.1.100:80 -r 192.168.1.101:8080 -m
sudo ipvsadm -a -t 192.168.1.100:80 -r 192.168.1.102:8080 -m

# Show rules and statistics
sudo ipvsadm -Ln
sudo ipvsadm -Ln --stats
```

`-s rr` is the scheduling algorithm
(also `lc` for least connection,
`sh` for source hashing,
`wlc` for weighted least connection, and so on),
and `-m` means NAT mode
(`-g` for DR, `-i` for TUN).
IPVS rules carry no application-layer health check of their own;
in production they are usually paired with
Keepalived's `check` script or a controller;
in the cloud, just use a managed SLB
and skip this whole layer of self-built complexity.

Before choosing LVS, do the arithmetic:
the performance it brings is often invisible
below tens of thousands of RPS,
while the troubleshooting complexity rises immediately --
rules live in the kernel,
health checks in user space,
VIP movement at the network layer,
and three planes have to be evidenced separately.
**Good enough is good enough;
do not adopt LVS to look professional**.
Only when a single Nginx box truly hits its ceiling
does it become the right answer.

## 6. High Availability: Keepalived and the VIP

The load balancer itself is a single point of failure;
Keepalived's VRRP protocol
moves a **virtual IP (VIP)** between two nodes --
the master holds it while alive,
the backup takes over on failure,
and clients only ever notice that the IP did not change:

```bash
# /etc/keepalived/keepalived.conf (example for the master node)
vrrp_script chk_haproxy {
    script "/usr/bin/killall -0 haproxy"
    interval 2
    weight 2
}

vrrp_instance VI_1 {
    state MASTER
    interface eth0
    virtual_router_id 51
    priority 101
    advert_int 1

    virtual_ipaddress {
        192.168.1.100/24
    }

    track_script {
        chk_haproxy
    }
}
```

`track_script`
makes the VIP failover look not only at Keepalived itself
but also at whether the HAProxy process is alive --
otherwise you get
"HAProxy is dead but the VIP is still here," which is fake high availability.
The backup node's configuration is identical except
`state BACKUP` and a smaller `priority`;
`virtual_router_id`
must match, since both belong to the same VRRP group.

Common traps:
**VRRP multicast filtered by the switch**,
so master and backup cannot see each other,
and after a split brain two VIPs coexist and collide over ARP;
and the VIP bound to the wrong NIC
(`interface` mistyped on a multi-NIC machine).
To check whether a failover actually took effect,
use `ip addr show`
to see which machine holds the VIP,
and `arping` from the other one
to verify that ARP has been updated.

The heartbeat link deserves one more thought:
if master and backup are joined by a single network,
a blip on that link triggers a pointless failover.
When you can, run VRRP over a dedicated heartbeat NIC,
or at least reduce `priority`'s sensitivity to link flapping.
Do not skip failover drills either --
a high-availability setup that has never been exercised
is, in essence, merely "Keepalived installed."

## 7. In Practice: A Complete Entry Path for a Web App

Combine the elements above into
the smallest deployable shape:

```nginx
upstream web_app {
    least_conn;
    server 192.168.1.101:8080 weight=3 max_fails=3 fail_timeout=30s;
    server 192.168.1.102:8080 weight=2 max_fails=3 fail_timeout=30s;
    server 192.168.1.103:8080 weight=1 backup;
}

server {
    listen 443 ssl http2;
    server_name app.example.com;
    ssl_certificate     /etc/nginx/ssl/app.pem;
    ssl_certificate_key /etc/nginx/ssl/app.key;

    location /healthz {
        proxy_pass http://web_app/health;
        access_log off;
    }

    location / {
        proxy_pass http://web_app;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout    60s;
    }
}
```

The order of deployment matters:
**validate the syntax first in a test environment with sudo nginx -t --
once the output says `syntax is ok` and `test is successful`,
reload with sudo systemctl reload nginx;
confirm the health check path is reachable first,
and only then add the backend to the pool**.
Doing it the other way around
(adding the backend before configuring the check)
produces a window during which
traffic is sent to half-ready instances.

Right after going live, do three things:
check whether
`upstream_response_time` in the access log looks normal;
check that the per-backend connection distribution matches the weights;
and simulate one backend going down,
confirming that removal and recovery
behave as `max_fails` promises.
**Verify the removal path before the first failure ever happens**,
otherwise when a real failure arrives
you are running an experiment in production.

## 8. Monitoring and Tuning

The load balancer is the best vantage point
for observing business health;
core metrics and what they mean:

| Metric | Source | What to watch |
|------|------|--------|
| connections per backend | stats / `ss` | whether it is skewed long-term (algorithm or weight problem) |
| 5xx rate | Nginx access log / HAProxy stats | the direct signal of an upstream failure |
| time to first byte, TTFB | `$upstream_response_time` | separating a slow gateway from a slow backend |
| health check failures | HAProxy stats / monitoring | one backend failing versus the whole pool failing |
| throughput and bandwidth | [Network Monitoring](./network-monitoring.md) | the basis for scaling decisions |

Tuning follows "measure first, adjust after":
`maxconn` is not "the bigger the better" --
beyond the file descriptor limit connections are refused outright;
the `timeout` chain has to match the business's real latency distribution
(leave headroom above P99);
buffers and `proxy_buffering`
affect memory use and slow-client behavior.
Every tuning change should be paired with
exporting the config via `nginx -T`,
keeping it under version control,
and retaining a rollback version.

When you wire in Prometheus,
nginx-exporter/haproxy-exporter
turn the stats above into metrics;
the alert rules should cover at least
persistent connection errors,
any backend whose `check` state stays DOWN
for more than two minutes,
and a sudden jump in the overall 5xx ratio.
See [Network Monitoring](./network-monitoring.md).

One more metric that is easy to miss is **the queue**:
a non-zero HAProxy `backlog`/`qcur`
means requests are lining up,
and both insufficient backend capacity
and a misjudged health check
can push it up.
The 5xx rate still flat while the queue climbs
is an early sign of a capacity problem --
far earlier than user complaints.

## 9. Common Pitfalls

- **Assuming open-source Nginx probes proactively**.
  It only removes passively,
  so a failed backend still receives requests
  during the judgment window;
  if you need active checks, use HAProxy or Nginx Plus.
- **`proxy_read_timeout`
  shorter than the business duration**,
  which reproduces 504 reliably.
  Compare against the business P99 before changing timeouts; do not tune blind.
- **Forgetting to pass `X-Forwarded-For`**,
  so the backend's security policies, rate limits, and audit logs
  all work off the wrong client IP.
- **IP Hash versus changing public client IPs**.
  Mobile networks and shared NAT egress
  make sessions drift across backends;
  change the application if you can,
  and do not expect hashing to solve everything.
- **Using restart instead of reload**.
  It severs existing connections at the instant of the change,
  which users experience as "every release causes a blip."
- **Weights falling out of step with real capacity**.
  A new machine comes online and its weight is never raised,
  or an old machine is downgraded and its weight never lowered,
  leaving a hotspot permanently skewed --
  review the per-backend request distribution on the stats page regularly.
- **ARP not converged after a VIP failover**.
  At the instant Keepalived switches,
  some clients still hold the old MAC,
  which shows up as sporadic failures in the seconds after the switch;
  shorten `advert_int`
  and make sure the switch permits VRRP multicast.
- **Health check path not matching the real business path**.
  `/health` returns 200
  while a downstream dependency of the real endpoint is down,
  and the load balancing layer is completely unaware --
  a health check should probe at least one critical dependency.
- **No rate limiting at the entry**.
  A single misbehaving client can fill the connection table;
  L7 `limit_req`
  or HAProxy's `stick-table`
  rate limiting is cheap insurance.

## References

- Nginx load balancing documentation -- [nginx.org](https://nginx.org/en/docs/http/load_balancing.html)
- Nginx reverse proxy parameters -- [nginx.org](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- HAProxy official documentation and Configuration Manual -- [haproxy.org](https://www.haproxy.org/#ref)
- Arch Wiki - HAProxy -- [wiki.archlinux.org](https://wiki.archlinux.org/title/HAProxy)
- LVS project and documentation -- [linuxvirtualserver.org](https://www.linuxvirtualserver.org/)
- Keepalived official documentation -- [keepalived.org](https://keepalived.readthedocs.io/en/latest/)
- `man haproxy`, `man ipvsadm`,
  `man nginx`, `man 8 keepalived`

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)
