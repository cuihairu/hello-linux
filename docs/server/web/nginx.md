# Nginx

Nginx (Engine X) is a high-performance web server developed by Russian engineer Igor Sysoev, known for its event-driven architecture, capable of sustaining tens of thousands of concurrent connections on a single machine. Today it is both a static asset server and the de facto standard entry point for reverse proxying, load balancing, and HTTPS offloading. This chapter starts from the process model and covers virtual hosts, reverse proxying, load balancing, HTTPS, security hardening, and 502/403 debugging; before each config block, it states what problem that block solves, then gives a minimal usable example.

The goal of this chapter is not to memorize every directive but to build a complete mental model of "config structure -> traffic path -> fault layering". After reading, you should be able to independently complete: installation and service management on the three distro families, taking a site and a reverse proxy live, HTTPS and basic hardening, and rapid triage of 502/403/413. Each section first explains why that config is needed, then gives a minimal example; examples can be renamed and used directly, but in production replace them with your own domains, paths, and backend ports, and run `nginx -t` before reloading.

> Content draws on the official Nginx documentation, "Vbird's Linux Cabinet", and hands-on ops experience; see the references at the end.

## What This Page Covers

- Nginx's architecture and how it works
- Getting fluent with virtual host, reverse proxy, and load balancing configuration
- Installing on the three big distros, deploying HTTPS, and hardening
- Performance tuning and troubleshooting (including SELinux/AppArmor)

## 1. Nginx Architecture

Understanding the architecture is what lets you form correct hypotheses during troubleshooting: Master down means the whole service is gone, Worker down is refilled by the Master, a config error is caught by `nginx -t` before reload, and a correct config that was never reloaded gives you "changed it but no response". Mapping the symptom onto the right layer of the architecture is more efficient than hunting line by line through config files. Event driving makes the per-machine concurrency ceiling far higher than the traditional process model, but high concurrency is not high throughput -- the backend application, database connection pool, or disk IO may all become the bottleneck first, so monitoring must cover the whole chain, not just the Nginx process's CPU.

### 1.1 Process Model

Nginx uses a Master-Worker multi-process architecture: the Master reads config, manages Worker lifecycles, and handles signals; Workers handle connections with a single-threaded event loop, avoiding process/thread switching overhead. Each Worker can manage tens of thousands of connections simultaneously -- this is where "low-spec machines surviving high concurrency" comes from; the bottleneck is more often the system's file descriptors and the backend service than Nginx itself. On reload, the Master reads the new config, starts new Workers, and lets old Workers exit after draining their existing connections, so hot reload does not interrupt long-lived connections -- which is also why you can reload frequently after config changes with peace of mind, as long as configtest passes.

The Worker count is usually set to `auto` (equal to the CPU core count). The theoretical concurrency ceiling is roughly `worker_processes x worker_connections`, minus outbound connections to upstream -- in a reverse proxy scenario each client connection usually corresponds to one connection to the backend, so the ceiling must be counted in both directions. Compared with Apache: Nginx has centralized config, is memory-friendly, and excels at reverse proxying; Apache has a process/thread model, supports `.htaccess`, and has a mature dynamic module ecosystem. The choice need not be either-or -- modern frontend stacks that are mostly static prefer Nginx, legacy LAMP can stay on Apache, and the two can also be chained, with Nginx doing TLS offloading and static caching while Apache/the application handles dynamic requests. The more common production shape is: Nginx at the outermost layer receiving traffic, with application containers or Apache behind it -- once the responsibility boundary is clear, troubleshooting is fast too.

```text
                    ┌─────────────┐
                    │   Master    │  <- reads config, manages Workers
                    │   Process   │
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
   ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐
   │   Worker 1   │  │   Worker 2   │  │   Worker 3   │  <- handle requests
   └─────────────┘  └─────────────┘  └─────────────┘
```

| Feature | Nginx | Apache |
|------|-------|--------|
| Concurrency model | event-driven | process/thread model |
| Memory footprint | low | high |
| Static files | extremely fast | average |
| Dynamic handling | mainly reverse proxy | built-in modules / multi-process |
| Config style | centralized | .htaccess distributed |

### 1.2 Installation

Installation itself rarely goes wrong; failures are mostly "the three things after installing": the service not enabled, the firewall not opened, and owner/paths copied from the wrong distro's documentation. Making these three a go-live checklist can eliminate more than half of the "new machine won't open" tickets. Package manager differences only affect the install commands, not the core knowledge of systemd and config structure that follows -- which is why this chapter puts the three-family comparison in the README first: remember the tool differences first, then focus on Nginx itself.

All three distros' official repositories provide the nginx package, and after installing, the same systemd unit name `nginx` manages it -- different package managers, identical service lifecycle, one of systemd's unifying benefits. Debian's default site directory is `/var/www/html`, Arch's is `/srv/http`; the running user is commonly `www-data` on Debian and `nginx` on RHEL/Arch -- do not copy the wrong group name into ownership settings, or you get 403. For the latest mainline you can switch to Nginx's official apt repository (import the signing key first, then write the sources list); the RHEL family just needs `dnf install nginx`; Arch uses the official repository with `sudo pacman -S nginx`, and during upgrades watch the news to avoid config format change traps. After installing on any of the three, `sudo systemctl enable --now nginx`, then verify with `nginx -v` and `curl -I http://localhost`; if curl returns the distro's welcome page, both the process and the default server are fine, and you can next replace it with your own server block.

The verification order is best fixed as: is the package installed (`nginx -v`) -> is the service active (`systemctl status`) -> does it work locally (`curl -I localhost`) -> does it work externally (curl from another machine or a browser). Each failing step corresponds to a completely different cause, and skipping steps in troubleshooting invites spinning on the wrong layer. If after installing the browser times out instead of a 404, check the firewall first: for firewalld run `firewall-cmd --permanent --add-service=http` then reload; for UFW run `ufw allow 80`. Cloud hosts also have the security group's inbound rules, a second layer alongside the host firewall, both required -- when this layer is closed, the Nginx logs are often completely quiet, easily misjudged as a config error.

```bash
# Debian/Ubuntu / RHEL / Arch comparison
sudo apt update && sudo apt install nginx
sudo dnf install nginx
sudo pacman -S nginx

sudo systemctl enable --now nginx
nginx -v && curl -I http://localhost
```

## 2. Configuration File Structure

The config structure decides "where to change it and whether it will take effect". The global block affects processes and logs, events affects connection handling, http affects site-wide protocol behavior, and server/location affect single-site routing -- writing at the wrong level is a common mistake: putting `client_max_body_size` inside a location that only covers some paths leaves other paths still returning 413; putting `limit_req_zone` in server (syntactically it belongs in http) makes reload fail outright. When unsure, first check the official directive's scope, then decide http versus server, instead of pasting it wherever the error appeared.

### 2.1 File Locations

| File | Description |
|------|------|
| /etc/nginx/nginx.conf | main config file |
| /etc/nginx/conf.d/*.conf | site configs (RHEL/Arch/general) |
| /etc/nginx/sites-available/ | site configs (Debian/Ubuntu) |
| /etc/nginx/sites-enabled/ | enabled sites (symlinks) |
| /var/log/nginx/access.log | access log |
| /var/log/nginx/error.log | error log |

Debian defaults to the sites-available/enabled symlink style; RHEL/Arch more commonly use conf.d. Wherever the main config's `include` points is where config loads from -- when you cannot find a site config, look at the include first instead of repeatedly searching the whole disk. When splitting logs per site, the path is usually written inside the corresponding server block, and the global default log only covers requests not otherwise specified.

### 2.2 Config Structure

The config consists of a global block, an events block, an http block, and nested server/location blocks. **Directives end with semicolons and blocks use braces -- the missing semicolon is the most common syntax error**, and `nginx -t` will point at the line number. The global block defines processes and logs, events defines connection handling, and http holds common optimizations, log formats, and each server; servers split by domain, and locations do path-level routing. Once "block nesting" is understood, debugging "why this line does nothing" only asks three questions: was it written in the right block? is that block included? did reload succeed? -- these three cover the vast majority of "config not effective" problems.

`worker_processes auto` together with `worker_connections` decides theoretical concurrency; check `ulimit -n` before changing, and raise systemd's `LimitNOFILE` in step, or it silently falls back to the default 1024 after a restart and high concurrency hits `too many open files`. Add gzip types per your business, and do not recompress already-compressed assets to waste CPU. `sendfile`/`tcp_nopush`/`tcp_nodelay` pay off on the static send path -- leave them on.

```nginx
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /run/nginx.pid;

events {
    worker_connections 1024;
    use epoll;
    multi_accept on;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    log_format main '$remote_addr [$time_local] "$request" $status $body_bytes_sent';
    access_log /var/log/nginx/access.log main;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    include /etc/nginx/conf.d/*.conf;
}
```

## 3. Virtual Hosts

Virtual hosts solve the splitting problem of "one machine, one IP, multiple sites". HTTP/1.1 distinguishes sites by the Host header, and Nginx matches it with `server_name` -- DNS only points the domain at this machine; which server block actually gets chosen happens at the application layer. With that division understood, "DNS is right but the default page opens" is no longer mysterious: either Host was not written right, or the request never entered the expected server block. Multiple sites should be one domain per server, with logs, certificates, and root directories all separated so debugging does not contaminate across sites. After editing a server block, `nginx -t` then reload, and verify the match locally with a `curl -H 'Host: ...'` carrying the Host header -- far faster than waiting for DNS to propagate and trying again.

### 3.1 Name-Based Virtual Hosts

Server blocks match Host by `server_name`; when nothing matches, the request falls to the first block on that port (or the `default_server`). This is also why "the domain resolves right but the welcome page opens" -- Host did not match and the request entered the default server. After configuring, be sure to `nginx -t` then reload, avoiding a broken brace taking the whole site down.

`try_files` tries files/directories in order and can finally return 404; give static assets their own location with expiry headers; `location ~ /\.` blocks `.git` and `.env`, a low-cost hardening move. SPAs must remember the `try_files ... /index.html` fallback, or frontend-route refreshes will 404 -- such 404s only appear when "refreshing a non-root path" and are easily misjudged as backend faults. Split access logs per site so later Top-pages statistics need no domain grep first; `server_name` supports wildcards and `default_server`, and a multi-domain entry point converges more cheaply with one server.

```nginx
server {
    listen 80;
    server_name example.com www.example.com;
    root /var/www/example.com;
    index index.html;
    location / { try_files $uri $uri/ =404; }
    location ~ /\. { deny all; }
    access_log /var/log/nginx/example.com.access.log;
    error_log /var/log/nginx/example.com.error.log;
}
```

### 3.2 Port-Based Virtual Hosts

When the same machine opens ports like 8080 for internal tools or debug services, another `listen` suffices. Port blocks and domain blocks do not interfere with each other, but the firewall must open each business port separately. Port splitting does not depend on Host, suiting callers that cannot change request headers; when mixed with domain blocks, note that server_name cannot be identical on the same `listen`, or the later one takes no effect.

Write a `server` block with `listen 8080`, `server_name localhost` (or a dedicated domain), and `root` pointing at another site directory -- no interference with the domain block on 80.

### 3.3 Creating the Site Directory

The site directory is where config meets disk: wherever `root` in the Nginx config points, the running user must be able to read. Any of directory permissions, ownership, or SELinux context being wrong slides you from "config correct" to 403. It is recommended to create site roots separately rather than mixing them with system directories -- migration and backup are cleaner; a unified `/var/www/<domain>` convention in development saves the cost of inventing paths at each deployment.

Create the directory, align ownership with the running user, drop in a test page, syntax check, reload -- this five-step chain is the minimal loop for every new site going live. A wrong owner (www-data vs nginx) makes Nginx itself unable to read the index, appearing as 403 rather than 404, which must be distinguished from "file does not exist": 404 means the path was not found, 403 means the path exists but the identity is insufficient, and the error log hints differ accordingly. After creating, `curl -I` a self-test before configuring DNS, keeping problems local; test again after DNS propagates, avoiding treating "local OK" as "everywhere OK".

Steps: `mkdir -p` to create; `chown` with `www-data` on Debian and `nginx` on RHEL/Arch; `chmod 755` to ensure readable and traversable; `tee` a test page; finally `nginx -t` then `systemctl reload nginx`. A wrong owner gives an immediate 403; these five steps are the fixed moves for launching a new site and are best codified into a script.

## 4. Reverse Proxy

A reverse proxy faces the opposite way from a forward proxy: a forward proxy goes out for the client, a reverse proxy receives traffic for the server (Nginx in front, application behind). To the client the backend is invisible, believed to be talking to Nginx; to the backend the source is usually an intranet loopback address, with real client information carried entirely by forwarded headers. There is also a security dimension: the backend never goes to the public internet, the attack surface converges on Nginx and the WAF, and application vulnerabilities are not directly exposed to scanners. When debugging "backend got the wrong Host/IP" bugs, check this group of `proxy_set_header` first -- faster than reading application code; a missing `X-Forwarded-Proto` also makes the backend misjudge the protocol and generate wrong redirect URLs.

Reverse proxying is Nginx's most frequent use: the client only faces Nginx, and the backend hides in the intranet. The benefits are unified TLS, easy horizontal scaling, backend restarts not interrupting the public service, plus caching, rate limiting, and canary releases at the edge. The core is a single `proxy_pass`, but **request headers must be forwarded correctly**, or the Host and client IP the backend sees are all Nginx's own, distorting logs, rate limiting, and risk control. When debugging "backend got the wrong Host" bugs, check this group of `proxy_set_header` first -- faster than reading application code.

### 4.1 Basic Reverse Proxy

`X-Real-IP`/`X-Forwarded-For`/`X-Forwarded-Proto` tell the backend the real IP and original protocol respectively; tune timeouts per your business, and raise `proxy_read_timeout` for long queries, or the backend is still computing while Nginx has already returned 504. Whether `proxy_pass` ends with a `/` changes the URI replacement rule: with `/` it replaces the location prefix, without it the full URI is passed through -- the classic trap behind proxied-path 404s; after changing, verify with a `curl` in a test environment, where comparing the `Location` response header is most intuitive.

The core inside the location is `proxy_pass` plus four `proxy_set_header` lines (Host, X-Real-IP, X-Forwarded-For, X-Forwarded-Proto), then `proxy_read_timeout` per your business. Missing forwarding headers distort backend logs, and too-short timeouts make long-query endpoints stably 504 -- these two problems account for more than half of reverse-proxy debugging.

### 4.2 WebSocket Proxying

WebSocket upgrades one short request into a long-lived connection, and the proxy layer must forward all protocol headers needed for the upgrade, or the handshake fails on either the Nginx or the backend side and the browser only sees the connection close immediately. Long-lived connections also bring two derived problems: one is idle timeouts cut by middleboxes (needs application-level heartbeats or a larger `proxy_read_timeout`), the other is Workers filling up with long connections (mind the `worker_connections` and `limit_conn` quotas). When debugging, first look at the handshake status code in the browser's Network panel -- 101 means the upgrade succeeded, while a still-200/502 means an upgrade header or backend handling problem.

WebSocket requires HTTP/1.1 with correct Upgrade/Connection settings, both or nothing, or the first screen works and the long connection drops instantly. Proxy only the `/ws` path -- do not enable upgrade headers site-wide, since adding Upgrade to every location can interfere with ordinary requests' connection reuse. If the proxy layer also has gzip, turn it `gzip off` for the WebSocket path to avoid compressing upgraded frames into garbage.

The WebSocket location must have: `proxy_http_version 1.1`, `Upgrade $http_upgrade`, `Connection "upgrade"`, plus `proxy_pass` and Host. Missing any one fails the handshake; enable it only for the `/ws` path, not site-wide.

### 4.3 Multi-Application Proxying

An SPA frontend's `try_files` fallback to index.html is what keeps route refreshes from 404ing; APIs forward to the backend with a prefix location, and static assets can use `alias` with long caching. Mind location priority: exact `=` > `^~` > regex > longest prefix; when mixing regex and prefix, sort out the matching tree before changing, or you get "changed A but hit B". When API and static live under the same server, know in advance whether a long prefix or regex matches first, and use `^~` to disable regex fallback when necessary.

Frontend `location /` uses `try_files` falling back to `index.html`; `location /api` forwards to the backend forwarding Host/Real-IP; `location /static` mounts a static directory with `alias` and `expires 30d`. The three each do their own job, and adding a new prefix path means copying the `/api` block and changing `proxy_pass`.

## 5. Load Balancing

The prerequisite for load balancing is stateless backends or externally-storable sessions; stateful backends without session persistence make user requests drift across backends, appearing as randomly dropped logins. In selection: for small traffic a single-host upstream with round robin is enough; session-sensitive businesses should prefer changing the architecture (sessions in Redis) over relying on IP Hash; many long connections favor least_conn. The balancer itself must also be highly available -- with a single Nginx, put DNS round robin, a Keepalived VIP, or a cloud SLB in front, or one dead Nginx takes the whole site down no matter how stable the backend is.

### 5.1 upstream Configuration

`upstream` gathers several backends into one logical name that `proxy_pass` references directly, so scaling only means editing upstream members and reloading, without touching business locations -- the key design that peels "topology" out of business config. Round robin by default; `weight` adjusts the ratio; `ip_hash` provides session persistence; `backup` steps in only when everything is down; `max_fails`/`fail_timeout` are the open-source edition's only **passive** health check -- a backend is taken out only after real requests fail to the threshold, with no active probing. When all backends are down with no backup, clients get 502 directly. The open-source edition has no active liveness probing (that needs Nginx Plus or an external checker), and application-level heartbeats can compensate. Upstream domain resolution results are by default fetched only at startup/reload; when using DNS for dynamic discovery, pair it with `resolver` or external tooling, or in container environments a drifted IP keeps being hit at the old address; in K8s, a Service change without a reload not hitting new Pods is a classic trap.

```nginx
upstream backend {
    server 192.168.1.101:8080 weight=3 max_fails=3 fail_timeout=30s;
    server 192.168.1.102:8080;
    server 192.168.1.104:8080 backup;
}
server {
    listen 80;
    server_name app.example.com;
    location / {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 5.2 Load Balancing Strategies

Strategy selection is fundamentally a trade-off among "fairness, performance, sessions": round robin is fairest, weighted accounts for machine differences, least connections reduces long-request pileups, and IP Hash preserves sessions but may hammer one machine with hot IPs. Session persistence is a temporary measure; in the long run, move login state and shopping carts into shared storage so backends return to stateless, and scaling and releases are not shackled by sticky sessions. Whatever the strategy, pair it with a backup or an upstream SLB to avoid a single point of total failure; after changing strategy, observe the distribution under load or real traffic to prevent a wrong weight from saturating one machine.

| Strategy | Description | Suitable for |
|------|------|---------|
| round robin | requests assigned in sequence | homogeneous, stateless backends |
| weighted round robin | assigned by weight | servers of differing performance |
| IP Hash | same IP to same backend | session persistence needed |
| least connections | assigned to the one with fewest connections | long connections, big duration variance |

For stateful services it is better to externalize sessions into Redis and escape IP Hash -- mobile networks and proxy egresses make client IPs change frequently, so the same user's requests drift. Load balancing solves "horizontal scaling and fault isolation", not the backend's own slow queries; look at application latency before adding machines, or you are only moving the queue from the frontend to upstream.

## 6. HTTPS Configuration

HTTPS = HTTP + TLS; the certificate proves "I really am example.com", and the key completes the handshake and encryption. Without a certificate, or with a mismatched one, the browser blocks the page; `nginx -t` can only check paths and syntax and cannot catch semantic errors like "the certificate's domain does not match server_name" -- the latter needs browser details or `openssl s_client`. In production, certificates come from three sources: Let's Encrypt (free with automatic renewal), commercial CAs (compatibility endorsement), and internal CAs (self-signed for enterprise intranets). Personal and small-to-medium sites should prefer Let's Encrypt, paired with automatic renewal and expiry monitoring, far more reliable than manual annual renewal. After going live on HTTPS, keep the 80 redirect, or old http links in bookmarks fail outright.

### 6.1 Let's Encrypt Free Certificates

certbot's nginx plugin automatically rewrites server blocks and installs the renewal timer -- the most convenient path. Certificates are valid for 90 days, and after installing you must `renew --dry-run` to confirm the renewal chain, or the whole site becomes untrusted on expiry day -- many incidents are not "did not renew" but "renewed successfully and never reloaded". Installation per family is `apt install certbot python3-certbot-nginx`, `dnf install certbot python3-certbot-nginx`, and `pacman -S certbot certbot-nginx` (the Arch-side plugin package is `certbot-nginx`, in the official extra repo); `--webroot` manual deployment also works. Remember `nginx -t && systemctl reload nginx` in the renewal hook -- swapping the certificate without reloading can leave old connections holding the old cert; monitoring certificate days remaining exposes problems earlier than monitoring the process.

Obtain with `sudo certbot --nginx -d example.com -d www.example.com`; verify renewal with `sudo certbot renew --dry-run`. The plugin rewrites the server block and installs the timer; after it finishes, running `nginx -t` and one more reload is still recommended to confirm the automatic rewrite is clean.

### 6.2 Manual HTTPS Configuration

Manual configuration suits scenarios needing precise control over protocol versions, cipher suites, and HSTS details, and eases version management (certificate paths and server blocks go into the config repository). Compared with the plugin's automatic rewrite, the manual way has clearer responsibility: certificate updates, reloads, and redirect rules are all maintained by you, so renewal hooks and expiry monitoring matter even more. After writing the 443 block, use `openssl s_client -connect example.com:443 -servername example.com` to check whether the certificate chain and domain match, then confirm in a browser that there are no warnings -- passing at the tool layer is not passing at the browser layer; look at both.

From Nginx 1.25.1, HTTP/2 uses the standalone directive `http2 on;`; the old `listen 443 ssl http2` is deprecated (some versions only warn, some no longer honor it). Below gives both the 443 main site and the 80 redirect; `ssl_protocols` locks 1.2/1.3, and cipher suites can be copied per compatibility tier from the Mozilla generator. When HSTS carries a long `max-age`, **enable it only after confirming the whole site is HTTPS**, otherwise the browser locks out HTTP access and a not-ready certificate locks you out. A wrong certificate path makes `nginx -t` fail outright -- do not reload a config that failed testing.

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name example.com;
    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    root /var/www/example.com;
    index index.html;
}
server {
    listen 80;
    server_name example.com www.example.com;
    return 301 https://$server_name$request_uri;
}
```

## 7. Security Hardening

Hardening has three layers: transport (TLS, HSTS), HTTP (security headers, rate limiting, allowlists), and system (SELinux/AppArmor, firewall). Doing only one of the layers always leaves gaps -- enabling HTTPS without HSTS still lets users be downgraded to HTTP; setting CSP without converging surplus exposure leaves the attack surface in place. This section unfolds the HTTP layer, cross-referencing the system layer with the fundamentals chapter and each chapter's SELinux section to avoid the same commands repeating across chapters until they warp. After hardening, spot-check response headers with `curl -I` and browser devtools -- config written is not config live in production, and `add_header` inheritance rules especially invite "why do some pages not have it" misjudgments.

### 7.1 Security Headers

Security headers prevent clickjacking and MIME sniffing, and CSP governs script sources. `X-XSS-Protection` is deprecated -- do not add it; browsers have been removing it and keeping it only inflates response size. Rewriting `add_header` inside a location **overrides** the parent's same-named directive -- for site-wide security headers, put them at the server/http layer or write them in full at every layer; this is the root cause of "some pages lack security headers", verifiable by spot-checking a few URL classes with `curl -I`. Roll out CSP with Report-Only first to observe false kills before enforcing, and tighten the business script source list gradually rather than locking it all at once -- leave room for third-party analytics, fonts, and CDNs in the list, or you get a blank page on day one.

Write at the server or http layer: `X-Frame-Options SAMEORIGIN`, `X-Content-Type-Options nosniff`, `Referrer-Policy strict-origin-when-cross-origin`, and CSP `default-src 'self'`, all with `always` so 4xx/5xx responses emit them too.

### 7.2 Rate Limiting

`limit_req_zone` defines the per-IP rate at the http layer, referenced inside locations; `burst` allows brief bursts to queue, and `nodelay` admits queued requests immediately. Writing only a zone without burst means a user double-clicking can 503; the default status code is 502, and `limit_req_status 429` gives a more apt value -- 502 makes monitoring misjudge it as an upstream fault, while 429 better matches the "rate limited" semantics. `limit_conn` caps concurrent connections, preventing one IP from opening a flood of connections and taking down the backend. Rate limiting is the brake that protects the backend; it cannot replace business authentication and a WAF; login and SMS endpoints additionally need stricter rates, or brute-forcing within the limit threshold remains.

At the http layer use `limit_req_zone` for the per-IP rate (say 10r/s) and `limit_conn_zone` for connections; inside the location, reference with `limit_req zone=api burst=20 nodelay` and `limit_conn addr 100` to cap concurrency, then `proxy_pass`.

### 7.3 IP Allowlist/Blocklist

Allowlists are evaluated in `allow`/`deny` order (first match wins, with a closing `deny all` at the end); large blocklists are better `map`-ped into a variable and answered with 403. For admin entry points, the more robust option is opening only to the intranet or VPN, treating the application-layer allowlist as defense in depth rather than the sole barrier. When egress or office IPs change frequently, the allowlist needs a change process alongside, or you lock yourself out the day after going live.

Inside `location /admin`, first `allow` trusted segments, then close with `deny all`, and finally `proxy_pass`; order decides the match result, and the allowlist must come before the deny.

### 7.4 SELinux and AppArmor

On the RHEL family, 403/502 despite correct permissions points first at SELinux: the site directory context should be `httpd_sys_content_t`, restorecon it if wrong; reverse proxying may be blocked from outbound connections by default and needs `setsebool -P httpd_can_network_connect on`. The evidence is in `avc: denied` (`ausearch -m avc`). On Debian with AppArmor enabled, `aa-status` shows the nginx profile, temporarily `aa-complain` to downgrade to warnings before returning to enforce. System-level principles are in the fundamentals chapter; the three server-side moves above cover the vast majority of cases, and custom directories need permanent labeling or the change reverts on reboot.

```bash
ls -Z /var/www/html
sudo restorecon -Rv /var/www/html
sudo setsebool -P httpd_can_network_connect on
sudo ausearch -m avc -ts recent
```

## 8. Performance Tuning

Classify the performance problem before turning knobs: insufficient capacity (add workers/connections/machines), high latency (slow upstream, buffers, DNS), or high error rate (502/413/timeouts -- fix as a fault first, optimize later). Tuning without baseline data is mysticism -- record QPS, P99, CPU, and RSS with the same benchmark script before and after to judge whether the direction is right. Nginx itself is usually not the bottleneck; most "Nginx is slow" cases are actually a slow upstream application or slow disk/network -- first cut the responsibility apart with `$upstream_response_time`, then decide whether to tune Nginx or fix the app. The tuning order is always: confirm the bottleneck is in Nginx, then touch workers/buffers, and only then consider adding machines.

### 8.1 Worker Configuration

`worker_processes auto` is enough unless NUMA pinning requires manual `worker_cpu_affinity`. After raising `worker_rlimit_nofile`, raise systemd's `LimitNOFILE` in step or it silently falls back after restart. In events, `use epoll` is Linux's optimal event model, and `worker_connections` is set against the file descriptor limit -- check ulimit first, then pick the number; reverse the order and you hit `too many open files` at peak. After tuning, benchmark and compare rather than changing 1024 to ten thousand on a feeling.

The three key spots: `worker_processes auto`; `worker_rlimit_nofile 65535` (plus systemd `LimitNOFILE` in step); and `worker_connections`, `use epoll`, `multi_accept on` inside `events`. Set values from benchmarks and the ulimit ceiling, in the order of checking file descriptors before deciding connection counts.

### 8.2 Buffer Configuration

Buffers and request body limits directly decide "can large files be transferred, and can the frontend hold when the backend is slow". The defaults target small-request scenarios, and uploads, exports, and large JSON endpoints must be adjusted explicitly. Bigger is not free: larger buffers mean a single connection can consume more memory, so in DoS scenarios use them alongside rate limiting and `limit_conn`. Validate such parameters with `nginx -t` before and after, and hit them with a real-sized request in a test environment, avoiding configs that only "look right".

`client_max_body_size` defaults to only 1M, and upload endpoints that do not change it stably 413 -- the most forgotten line in the whole site, with a 413 page that never hints "which line to change", so newcomers hunt in vain at the application layer. Proxy buffering is fine on by default, with Nginx serving cached data first when the backend is slow; only raise `large_client_header_buffers` when there really are oversized Cookies/URLs, since blind increases also widen the attack surface. After changing, be sure to configtest -- bracket and semicolon errors block the reload outright. With multiple proxy layers, a limit takes effect at the outermost layer and inner changes show no effect; rate limits, body limits, and timeouts all share this "outermost first" property, so debug from the public entry inward.

Set `client_max_body_size 100m` at the http or server layer to fix 413, and tune `client_body_buffer_size`, `proxy_buffering on`, and the `proxy_buffers` family as needed; default buffering is already on, and only touch proxy_buffer_* when debugging slow origin fetches.

### 8.3 Caching Configuration

`proxy_cache_path` defines the cache zone at the http layer, and the directory must be writable by the nginx user or the cache silently fails. The `X-Cache-Status` header shows HIT/MISS/BYPASS, more intuitive than reading logs; personalized-Cookie responses need `proxy_cache_bypass`/`no-cache` bypasses to avoid leaking one user's content to another. The cache key by default includes scheme/host/uri, and whether the query string participates is decided per business with `proxy_cache_key`. After a release, remember to purge or shorten `inactive`, or users may refresh the old page forever.

At the http layer `proxy_cache_path` declares the cache directory and `keys_zone`; in server/location, `proxy_cache my_cache` enables it and `proxy_cache_valid` sets the TTL, with the `X-Cache-Status` header watching HIT/MISS. The directory owner must be the running user or the cache silently writes nothing.

## 9. Log Analysis

The goal of log analysis is translating "a user reported an error" into "which layer, which request, what reason". The access log gives the request dimension (status code, duration, path), the error log the process dimension (upstream failures, permissions, config warnings), and aligned on a timeline the two carry far more than either alone. Shell pipelines suffice for small traffic; consider structured collection when traffic grows. No matter how the tooling changes, first make sure the logs carry `$request_time` and `$upstream_response_time`, or no platform can compute "which segment is slow".

Decide the problem domain before picking fields: for stability look at status code distribution and error keywords, for capacity at QPS and concurrency, for performance at duration percentiles and upstream time, and for security at abnormal UAs and sensitive path probing. The Top-IP three moves (awk, sort, uniq -c) are the baseline capability of manual analysis, still used for quick verification even after adopting ELK. Log rotation belongs to logrotate -- do not hand-delete a file being written, or the handle keeps holding the space until the process restarts, which is often how the "ghost incident" of a full disk happens.

The access log is the first scene of troubleshooting; extend the `main` format with `$request_time` and `$upstream_response_time` to tell "slow at client/network" from "slow at backend" -- without those two fields, a slow request only shows a 200 with nowhere to start. Status code distribution, Top IP, and Top pages need only the `awk | sort | uniq -c` three moves, and small traffic need not reach for ELK from day one. GoAccess suits quickly producing an HTML report on a single host, packaged as `goaccess` on all three families. Hand log rotation to logrotate and do not `rm` a file being written; compare error and access on the same timeline, where a 5xx spike often matches the upstream timeout log immediately. Exporting access lines whose `$upstream_response_time` exceeds a threshold into a weekly report is more sustainable than flipping through files by hand.

Status codes and Top IP use the same `awk | sort | uniq -c | sort -rn` pipeline as Apache; installing GoAccess is `apt`/`dnf`/`pacman -S goaccess` on the three families, then `goaccess ... --log-format=COMBINED -o report.html` for the report.

## 10. Common Problems

Common problems are triaged by status code or symptom, faster than paging through config files. Each subsection gives "symptom -> layering order -> minimal commands", where commands only verify hypotheses -- do not run them blindly before forming one. In production, stop the bleeding first (roll back config, shed traffic, enable a backup backend), then reproduce the root cause back in the lab -- treating production as an experimental bench is a common source of debugging incidents. For 5xx, look at error.log and the upstream first; for 4xx, permissions, allowlists, and paths first; do not apply the same "retry everything" to both.

### 10.1 502 Bad Gateway

502 means Nginx failed to get a response from the upstream: the backend is not up, the port is wrong, or a timeout/connection refusal -- the problem is "behind" Nginx and unrelated to the site's static permissions. A fixed order -- **process -> port -> error log -> timeout/SELinux** -- avoids spinning your wheels in Nginx's config. `Connection refused` means the backend is not listening; `upstream timed out` means it is too slow; in SELinux scenarios also consider `httpd_can_network_connect` being off. If the application's port is reachable but still 502, check protocol mismatch (say HTTP hitting an HTTPS port) and whether the IP hardcoded in upstream has drifted. When debugging, `curl` the backend port directly first; if it connects, look at Nginx, and if not, do not touch Nginx's config -- reversing the order wastes enormous time.

```bash
systemctl status your-app
ss -tlnp | grep 8080
tail -f /var/log/nginx/error.log
```

### 10.2 403 Forbidden

403 means Nginx or the system refused the request, entirely different from 502. Three causes: the directory lacks an index and autoindex is off, `deny`/allowlist not admitting, or **system permissions or SELinux context wrong**. First `namei -l` for the whole path's permissions, then `ls -Z` for context; hidden-file `deny` rules sometimes catch legitimate dot-prefixed paths, so temporarily commenting out that location for comparison verifies it. When customizing the site root, remember parent directories need execute permission too.

```bash
namei -l /var/www/example.com/index.html
ls -la /var/www/example.com
ls -Z /var/www/example.com && sudo restorecon -Rv /var/www/example.com
```

### 10.3 413 Request Entity Too Large

413 means the request body exceeds `client_max_body_size`, unrelated to the backend -- the error is generated at Nginx's packet-receiving stage, and the backend log is often completely quiet. When locating, confirm this value layer by layer from the public entry, rather than only changing the Nginx in front of the innermost application. If the business allows chunked upload or direct upload to object storage, keeping a smaller limit at the gateway and offloading large traffic to the storage service saves bandwidth and lowers the risk of memory exhaustion by malicious large payloads.


```nginx
client_max_body_size 100m;   # http or server layer
```

After changing, `nginx -t && systemctl reload nginx`. With multiple proxy layers on the chain, **the outermost limit takes effect first**, and changing only the inner layer shows nothing -- confirm layer by layer from the public entry, do not change the last layer in vain. In architectures where uploads go directly to object storage, only open a large body on the paths that need proxying, avoiding a site-wide relaxation.

### 10.4 Config Testing

The standard flow: edit -> `nginx -t` -> reload -> read error.log. A failed reload does not kill the old workers and the new config takes no effect either, so "changed it but no response" first makes you suspect whether reload errored -- same behavior as Apache, and a common trait of all hot-reloading services. `nginx -T` prints the full runtime text with all includes merged, the ultimate means of confirming "was this line ever loaded"; run it once before and once after a complex change, where the diff output is most intuitive. When the test errors, do not force through with `-s reload` -- fix the syntax before going live; binding configtest as the last step of the deployment script catches bad configs right in the release pipeline.

```bash
sudo nginx -t
sudo nginx -T
sudo systemctl reload nginx
```

## 11. Quick Reference of Common Traps

Each item below corresponds to a "why" from an earlier section; the quick reference is for stopping the bleeding in production, after which you should still return to the relevant section to understand the mechanism. Remember traps grouped as "config syntax / matching and paths / permissions and SELinux / upstream and timeouts / certificates and security headers"; when meeting a new problem, first decide its class, then apply that debugging chain -- faster than trial and error one by one.

- Wrote it but no effect: missing semicolon/brace, or a forgotten reload; `nginx -t` points at the line, fix there.
- On Arch, after `pacman -S nginx` the default page is at `/srv/http`, not `/var/www/html`.
- Backend sees IP as 127.0.0.1: missing X-Real-IP/X-Forwarded-For pass-through.
- HSTS enabled and HTTP unreachable: max-age too long with certificate/redirect not ready; clear the browser's HSTS.
- WebSocket keeps dropping: missing `proxy_http_version 1.1` or the Upgrade header.
- Uploads always 413: `client_max_body_size` defaults to 1M, and the outermost Nginx is what needs changing.

## Chapter Summary

Nginx knowledge compresses into four main lines: process and config structure (master/worker, block nesting, configtest), the traffic entry (server_name, location matching, the default server), the boundary with the backend (proxy header pass-through, upstream strategies, timeouts and buffers), and the public face (TLS, HSTS, security headers, rate limiting). Most daily operations live in the loop "edit server/location -> `nginx -t` -> reload -> read error.log"; knotty problems are mostly SELinux, outermost-layer-first across multiple proxy layers, and mistaking upstream faults for Nginx faults. Remember the four main lines and the triage order -- more useful than memorizing every directive's default value, because default values change with versions while the layered debugging method does not.

When going live and making changes, keep the rhythm of "small steps, test first, then reload, watch error.log" -- safer than one big change; a rollback plan matters as much as config version management. Monitoring should cover at least process liveness, 5xx ratio, upstream latency, and certificate days remaining -- these four cover the early signals of most faults in this chapter. Nginx is only one link in the chain; only when its collaboration boundaries with the application, database, and firewall are clear does troubleshooting speed really improve.

## Practice Notes

For production changes: change in a test environment first, pass `nginx -t`, reload at off-peak, watch error.log for several minutes, and confirm nothing abnormal before walking away. Rollback only requires restoring the previous config and testing+reloading again -- Nginx's hot reload makes rollback cheap enough that skipping tests "for fear of not getting back" is unnecessary. Put site configs into Git and route changes through review, far more reliable than a half-finished vim session on a production machine.

## References

- Official Nginx documentation -- [nginx.org/en/docs](https://nginx.org/en/docs/)
- Nginx Beginner's Guide -- [nginx.org/en/docs/beginners_guide.html](https://nginx.org/en/docs/beginners_guide.html)
- "Vbird's Linux Cabinet" - WWW server -- [linux.vbird.org](https://linux.vbird.org/linux_server/centos6/0360apache.php)
- Arch Wiki - Nginx -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Nginx)
- Let's Encrypt -- [letsencrypt.org](https://letsencrypt.org/)
- Mozilla SSL Configuration Generator -- [ssl-config.mozilla.org](https://ssl-config.mozilla.org/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [knowledge](/knowledge.md)
- [application-scenarios](/research/application-scenarios.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [README](/server/README.md)