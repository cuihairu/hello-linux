# Apache

The Apache HTTP Server (httpd) is one of the oldest and most richly-ecosystem'd web servers, known for its modular design and stability. Even in today's Nginx-dominated era, a large number of enterprise intranet systems, LAMP stacks, and sites that depend on `.htaccess` still run on Apache. This chapter first explains the design motivations behind the process model, virtual hosts, SSL, and the module system, then provides minimal usable configuration snippets, with a focus on the layered debugging approach for high-frequency faults such as 403/500.

> Content draws on the official Apache documentation, "Vbird's Linux Cabinet", and hands-on ops experience; see the references at the end.

## What This Page Covers

- Apache architecture and how the MPM works
- Getting fluent with virtual hosts, module enabling, and SSL configuration
- Installing and troubleshooting on Debian/Ubuntu, the RHEL family, and Arch
- Performance tuning and security hardening (including SELinux/AppArmor integration)

## 1. Apache Architecture

### 1.1 Process Model

Apache uses a multi-process model of "parent process manages, child processes handle requests". The parent starts as root, reads the configuration, binds the privileged ports (80/443), then drops privileges and forks child processes; the ones actually handling HTTP are these low-privilege children. A child crashing does not take the whole service down -- the parent replenishes as needed, and this is the foundation of Apache's stability.

Compared to event-driven Nginx, Apache is "heavier" per concurrent request: under prefork each connection corresponds to one process, and memory grows linearly with connection count. So when tuning Apache performance, the first switch to look at is always the MPM choice, never blindly raising `MaxRequestWorkers`. With that understood, every later parameter about threads, KeepAlive, and connection caps will not be tuned in the wrong direction.

From an ops perspective, also remember: the parent holds the privileged ports, and the children read site files after dropping privileges -- so site files only need to be readable by the running user, and should never be world-writable. When a child is killed by the OOM killer or a segfault, the parent refills it and the service self-heals after brief 500s; if the parent itself exits, systemd brings it back per the Restart policy, so monitoring should watch the unit's state rather than only port 80.

```text
                    ┌─────────────┐
                    │   Parent    │  <- manages child processes
                    │   Process   │
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
   ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐
   │   Child 1   │  │   Child 2   │  │   Child 3   │  <- handle requests
   └─────────────┘  └─────────────┘  └─────────────┘
```

### 1.2 MPM Modules

The MPM (Multi-Processing Module) decides how child processes are organized and is the first switch of Apache performance tuning. The default on the big three distros is mostly already `event`, but choosing per your business still requires understanding the differences: prefork is compatible with old non-thread-safe modules (such as legacy mod_php), occupies one process per connection, and has the highest memory overhead; worker puts threads inside processes, balancing compatibility against resources; event separates connection keeping from actual processing, so idle connections hold no worker threads, making it best for high concurrency and many long-lived KeepAlive connections.

Only one MPM can be enabled at a time. Check the current module with `httpd -V | grep MPM` or `apache2ctl -M`; switching requires editing the distro's module config and restarting the service -- it cannot be done online with reload, which only reloads config and some modules without rebuilding the process model. When migrating from prefork to event, if the business still depends on thread-unsafe legacy extensions, it manifests as random crashes or hung request handling, so confirm the extension list before switching; legacy PHP sites that cannot be upgraded are often forced to stay on prefork, which is the main reason it still exists on modern distros.

| MPM | Description | Suitable for |
|-----|------|---------|
| prefork | multi-process, one thread per process | compatibility with old modules; high memory use |
| worker | multi-process, multi-thread | a compromise between compatibility and resources |
| event | event-driven, connection separated from processing | high concurrency, long connections; the modern default |

## 2. Installation

Package names differ across the big three distros: Debian/Ubuntu call it `apache2`, the RHEL family calls it `httpd`, and Arch's package is `apache`. The service name matches the package name on Debian and RHEL (Arch's service is `httpd`), so when troubleshooting, `systemctl status` must target the right one -- documentation says `systemctl status httpd` and you get unit not found on Debian. After installing, verify the default page with `curl -I http://localhost`; if it does not open, first tell apart "service not up", "firewall not open", and "cloud security group not open on 80" -- check the three layers from inside out.

The Debian/Ubuntu package and service are both `apache2`. Refresh the index with `sudo apt update`, install with `sudo apt install apache2`, then `sudo systemctl enable --now apache2` completes enabling and starting in one go -- `enable --now` is equivalent to enable then start, the most convenient spelling under systemd. Verification is two steps: `apache2 -v` for version and compile flags, `curl -I http://localhost` to see whether the default site answers 200. Only when both pass is it "installed and listening"; passing only the first step will misjudge "service not running" as "installed fine".

On RHEL/CentOS/Fedora the package and service are both `httpd`; swap apt for `sudo dnf install httpd` and the service name for `httpd`, and the remaining systemctl and curl steps are identical. On machines where SELinux defaults to Enforcing, the site directory will additionally need a context later, or you will hit "403 despite all permissions being right" -- that is not an Apache config error but mandatory access control in the way, detailed in the hardening section.

On Arch Linux the official repository package is `apache`, installed with `sudo pacman -S apache`, while the service unit is still called `httpd.service`. Arch's config is a single `httpd.conf` plus `conf.d` snippets, without Debian's `a2ensite` symlink system -- enabling a site means putting the conf into the directory and reloading. The default site root is `/srv/http`, different from Debian/RHEL's `/var/www/html`, so watch out when copying paths; this is the path trap Arch users hit most often when copying old material. On every family, the firewall must be opened explicitly: firewalld uses `firewall-cmd --permanent --add-service=http` followed by a reload, UFW uses `ufw allow 80`; on cloud hosts also check the security group -- when the service starts but curl times out, the problem is almost always at the network layer rather than in Apache's config. Minimal install commands per distro are given below; the start and verify logic is identical across all three.

## 3. Configuration Files

### 3.1 File Locations

Apache's config layout splits into two schools by distro: the Debian family splits into multiple files enabled by symlinks (three pairs of available/enabled for sites/mods/conf), while the RHEL/Arch family centers on a main config plus `conf.d` snippets. Before changing config, confirm which school you are in, or you will create a file in the wrong directory that is never included -- half of all "changed it but nothing happened" cases are files in the wrong place. Debian's main config is `/etc/apache2/apache2.conf`, with sites and modules under `sites-available` and `mods-available`; RHEL/Arch's main config is `/etc/httpd/conf/httpd.conf`, snippets go in `conf.d/`, and on RHEL module loading mostly lives in `conf.modules.d/`.

What the two schools share is "the main config owns globals and includes, fine-grained config lives outside". Debian further splits the outside config into available/enabled, adding a layer of switch semantics suited to enabling and disabling multiple sites; RHEL/Arch take effect as soon as a file is dropped in, closer to WYSIWYG. When migrating machines, if you only copied sites-enabled and forgot the available directory structure, RHEL will feel like a dead end -- reading the main config's Include directives is always the first step to finding config.

| File | Description |
|------|------|
| /etc/apache2/apache2.conf | main config (Debian/Ubuntu) |
| /etc/httpd/conf/httpd.conf | main config (RHEL/CentOS/Arch) |
| /etc/apache2/sites-available/ | site configs (Debian) |
| /etc/apache2/sites-enabled/ | enabled sites (symlinks) |
| /etc/httpd/conf.d/ | site/module snippets (RHEL/Arch) |

### 3.2 Config Structure

The main config runs, top to bottom, through global directives (running user, logs, timeouts), module loading (`LoadModule`), the default virtual host, and include directives. Order is critical: module directives written before their `LoadModule` have no effect, and Include snippets merge according to where they appear. A common mistake is writing `RewriteEngine On` before mod_rewrite is loaded, so the rules "do nothing". After editing config, do not restart directly -- syntax check first (see section 10) and reload only after it passes; on a syntax error, reload fails and keeps the old configuration serving, which is a protection mechanism -- but do not skip the check and restart directly, turning a small rollback-able mistake into an outage. The running user (Debian's `www-data`, RHEL/Arch's `httpd`) decides which identity the children use to read site files, and getting it wrong causes 403 everywhere.

Typical skeleton: `ServerRoot` points at the config root, `User`/`Group` set the child identity, `LoadModule` follows as needed, and finally `<VirtualHost *:80>` declares the default or first site (`ServerName` + `DocumentRoot`). With this order understood, adding sites and modules below is repeating the same pattern, with no need to copy whole files each time.

## 4. Virtual Hosts

Virtual hosts let one Apache host multiple sites at once. Matching order: first an exact match of the Host against `ServerName`/`ServerAlias`, falling back to the default (first or marked Default) block when nothing matches. This is also the common reason for "DNS resolves right but a different site opens" -- a wrong ServerName, or a block that is simply not included. After editing, `apache2ctl -S` lists all loaded virtual hosts and their DocumentRoots, far faster than reading files. In multi-site days, logs, certificates, and DocumentRoots are isolated per site, so touching one site's conf at a time keeps the rollback surface small.

### 4.1 Name-Based Virtual Hosts

Name-based is the most-used form: one IP, one port, split by the Host header. The client resolves DNS first, then carries Host in the HTTP request header; Apache uses that header to pick one of several VirtualHosts. When nothing matches, the request falls to the default block, so the default block's DocumentRoot should never point at a sensitive directory. `AllowOverride All` lets a site override directory config with `.htaccess` -- flexible, but at the cost of an extra file read per request; when production has no distributed-config need, switching to `None` speeds things up -- disabling .htaccess is also a common hardening and performance move. `Require all granted` is 2.4 syntax replacing 2.2's `Order/Allow/Deny`; mixing the two generations' syntax is a high-frequency cause of 403 after an upgrade, so search globally for old directives during migration. Splitting error and access logs per site is recommended, otherwise multiple sites mix in one file and troubleshooting requires filtering by `ServerName` or reading per-vhost log files separately.

```apache
<VirtualHost *:80>
    ServerName example.com
    ServerAlias www.example.com
    DocumentRoot /var/www/example.com

    <Directory /var/www/example.com>
        AllowOverride All
        Require all granted
    </Directory>

    ErrorLog ${APACHE_LOG_DIR}/example.com.error.log
    CustomLog ${APACHE_LOG_DIR}/example.com.access.log combined
</VirtualHost>
```

### 4.2 Port-Based Virtual Hosts

When intranet tools or old clients can only reach non-standard ports, distinguish them with a second `Listen` plus a VirtualHost on a different port. The spelling is to add `Listen 8080` globally, then write a `<VirtualHost *:8080>` pointing at a different `DocumentRoot`. Every `Listen` must appear once globally, or all blocks on that port take no effect; port-based splitting does not depend on the Host header, suiting callers that cannot change Host. Note the firewall must open each business port separately -- with only 80 open, the site on 8080 is unreachable from outside forever, the classic source of "curl works locally but not from outside".

### 4.3 Enabling Sites

Debian manages symlinks with `a2ensite`/`a2dissite`; RHEL/Arch drop a `.conf` into `conf.d` (or the main config's Include). In either school, **after enabling, run configtest and reload, and confirm with `apache2ctl -S` that the site is in the list** -- a forgotten reload is the number one suspect for "config written but not effective". On Debian you can also `a2dissite 000-default` to disable the default welcome page, avoiding confusion when a new site's domain does not match and falls into the default block.

Enabling on Debian: `sudo a2ensite example.com.conf`, then after `configtest` passes, `reload apache2`; disabling uses `a2dissite`. RHEL/Arch have no a2ensite -- confirm the conf is in `conf.d`, pass `httpd -t`, then `reload httpd`. The last step in both schools is "test + reload"; the only difference is whether "enabling" means a symlink or dropping a file.

## 5. SSL Configuration

### 5.1 Enabling the SSL Module

On Debian the ssl module may not be enabled by default and needs `a2enmod ssl`; security headers additionally need the `headers` module. On RHEL/Arch ssl is usually loaded with the main package -- confirm with `httpd -M | grep ssl`. Certificate files should be owned by root with the private key at 600, and the intermediate certificate must be baked into the fullchain, or some browsers report an incomplete chain -- the most common certificate deployment trap. With overly loose private key permissions, Apache may refuse to load at startup, and the error log will mention key permission problems.

On Debian, `sudo a2enmod ssl headers` then restart the service; all three families can confirm the module is loaded with `httpd -M | grep ssl`. The headers module is often overlooked, and without it HSTS and security headers silently take no effect.

### 5.2 SSL Virtual Hosts

The 443 block carries the certificate and security parameters, and the 80 block does a 301 redirect -- `Redirect permanent` is the simplest, mod_rewrite also works; the goal is to funnel all plaintext traffic to HTTPS as soon as possible. `SSLProtocol` is restricted to TLS 1.2/1.3; only relax it if the business truly depends on very old clients, otherwise keep it tight. Once HSTS is issued with a long max-age, browsers force-lock HTTPS -- **enable it only after confirming the whole site works**, otherwise a not-ready certificate or redirect locks you out. TLS 1.3 cipher suites are negotiated by OpenSSL, and newer versions usually need no more fussing over `SSLHonorCipherOrder`; `SSLCertificateChainFile` has been folded into `SSLCertificateFile` in some newer versions (give the fullchain directly), so when reporting a chain error, check the directive name against your version's documentation. When certificate and private key do not match, the service can still start but the browser warns -- verifying them as a pair is more reliable than reading filenames.

```apache
<VirtualHost *:443>
    ServerName example.com
    DocumentRoot /var/www/example.com

    SSLEngine on
    SSLCertificateFile /etc/ssl/certs/example.com.crt
    SSLCertificateKeyFile /etc/ssl/private/example.com.key

    SSLProtocol -all +TLSv1.2 +TLSv1.3
    SSLCipherSuite ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256

    Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
</VirtualHost>

<VirtualHost *:80>
    ServerName example.com
    Redirect permanent / https://example.com/
</VirtualHost>
```

### 5.3 Let's Encrypt

certbot's Apache plugin rewrites virtual hosts and appends redirects automatically, more convenient than maintaining certificate paths by hand. Certificates are valid for 90 days, and after installing you must run `renew --dry-run` to verify the renewal timer, or the whole site becomes untrusted on expiry day. Installation per family is `apt install certbot python3-certbot-apache`, `dnf install certbot python3-certbot-apache`, and `pacman -S certbot`; on Arch the Apache plugin may be in the AUR depending on version, and you can also deploy manually via webroot plus a deploy hook. After obtaining a certificate, still run `apachectl configtest` -- certbot's rewrites occasionally introduce syntax issues.

To obtain a certificate, run `sudo certbot --apache -d example.com -d www.example.com` (replace with your actual domains), then be sure to verify renewal with `sudo certbot renew --dry-run`. certbot rewrites the vhost and appends the 80->443 redirect; after it finishes, running `apachectl configtest` once more is still recommended to confirm the automatic rewrite introduced no syntax problems.

## 6. Module Management

Apache's functionality comes almost entirely from modules, and enabling them on demand is the core capability that distinguishes it from monolithic servers. The principle: do not load modules you do not use -- it shrinks the attack surface and saves memory. The four most commonly enabled are `rewrite` (pretty URLs), `headers` (security headers/HSTS), `expires` (browser caching), and `deflate` (gzip compression). The module list is itself a "capability inventory": when debugging "why does this directive do nothing", check `apache2ctl -M` for the module first, faster than repeatedly changing parameters in config; security baseline scans also commonly start from surplus modules, disabling whatever can be disabled.

Debian's `a2enmod` operates the available/enabled symlinks; RHEL/Arch add or remove `LoadModule` comments in `conf.modules.d` or the main config. Either way, reload afterward and cross-check the list with `apache2ctl -M` or `httpd -M` -- if it is not in the list, no amount of directives does anything. Module directives must appear after the module is loaded, and `RewriteEngine` additionally requires the containing Directory's AllowOverride to permit rewriting. Give compression and caching to specific MIME types via `AddOutputFilterByType` and `ExpiresByType`, and do not recompress already-compressed images to waste CPU.

On Debian, one command enables the four common modules: `sudo a2enmod rewrite headers expires deflate`, then verify the list with `apache2ctl -M`. On RHEL/Arch, edit the `LoadModule` comments in `conf.modules.d` and reload, verifying with `httpd -M`.

Directory-level config writes `AllowOverride All` inside `<Directory /var/www/html>` to permit .htaccess; compression uses `AddOutputFilterByType DEFLATE` per MIME type; caching uses `ExpiresActive On` plus `ExpiresByType`, for example one year for images and one month for CSS. Directive position and module load order must be right, or nothing takes effect.

## 7. Performance Tuning

Tuning order: first match the MPM to the business, then the connection cap, and only then buffers. Blindly raising `MaxRequestWorkers` into the thousands is actually slower on small-memory machines through process contention -- every prefork child is a full memory footprint. Under event, the same memory supports far more concurrency than prefork, so **switching MPM is often more cost-effective than adding RAM**. Tuning needs a control: record TPS, P99, and RSS with the same benchmark script before and after, or "feels faster" cannot be distinguished from "the cache got warm".

`MaxRequestWorkers` (old name MaxClients) is the concurrency ceiling, roughly estimated as available memory divided by per-request average footprint. A non-zero `MaxConnectionsPerChild` periodically recycles children, relieving leaks and fragmentation. KeepAlive pays off noticeably for static sites; when Nginx in front already does long-connection aggregation, Apache can shorten `KeepAliveTimeout` to free processes. Leave `LimitRequestLine` and friends at defaults -- casually raising them only amplifies the slow-client attack surface. After changing the MPM or large parameters, restart at an off-peak time and watch connection counts with `ss`/a benchmark tool, rather than changing and never looking back.

An event MPM example goes in `mpm_event.conf`: it controls the starting process count, busy/idle thread watermarks, threads per child, the total request worker cap, and the child recycling cycle; it also enables KeepAlive with a per-connection request cap and idle timeout. Fine-tune values against memory and benchmark results -- do not blindly copy large numbers.

```apache
StartServers 3
MinSpareThreads 75
MaxSpareThreads 250
ThreadsPerChild 25
MaxRequestWorkers 400
MaxConnectionsPerChild 10000
KeepAlive On
KeepAliveTimeout 5
```

## 8. Security Hardening

### 8.1 Security Headers

Security response headers reduce clickjacking, MIME sniffing, and residual XSS risk, and require the `headers` module to be enabled first. `X-XSS-Protection` has been deprecated by mainstream browsers -- keeping it is harmless but no longer protective, and the modern approach is CSP. When rolling out CSP, start with Report-Only to observe false kills before switching to enforcement, avoiding blocking your own business scripts along the way; the `always` in `Header always set` guarantees error pages also carry the headers -- remove it and 4xx/5xx responses may lack them.

The common combination is: `X-Frame-Options SAMEORIGIN` against clickjacking, `X-Content-Type-Options nosniff` against MIME sniffing, `Referrer-Policy` controlling referrer leakage, and CSP's `default-src 'self'` restricting default load sources. All are written with `Header always set ...` so error pages carry them too.

### 8.2 Hiding Version Information

`ServerTokens Prod` returns only `Server: Apache`, with no version or module list; `ServerSignature Off` removes the version string from the error page footer. Together they prevent fingerprint-scanning for vulnerabilities, are low-cost must-dos, and can go in the global config to take effect site-wide. Note `ServerTokens` only takes effect when set globally and may not be accepted inside a VirtualHost.

Writing `ServerTokens Prod` and `ServerSignature Off` globally suffices -- the former tightens the Server response header, the latter removes the error page footer's version string.

### 8.3 Access Control

Directory-level control uses the 2.4 `Require` family: `Require ip` limits source segments, and `<DirectoryMatch>` batch-rejects dot-prefixed hidden files (`.git`, `.env`). If an admin panel is exposed to the public internet, be sure to add a network-layer allowlist or VPN on top -- do not rely on the application password alone; blocking scanners at the Apache layer does not mean the application's login page is not being hit. Multiple `Require` lines are OR-ed; for AND, wrap them in `<RequireAll>`.

Example: an admin directory allowing only trusted segments with `Require ip 192.168.1.0/24` alongside `Require ip 10.0.0.0/8`; `<DirectoryMatch "/\.">` with `Require all denied` batch-rejects hidden files. Multiple `Require` lines default to OR; wrap in `<RequireAll>` for AND.

### 8.4 SELinux and AppArmor (RHEL/Debian)

With all file permissions correct but still 403, suspect mandatory access control first. RHEL/CentOS/Rocky default to Enforcing; a wrong site directory context or an unenabled reverse-proxy boolean gets blocked, and the error page is often just an ordinary 403 -- you must read the `avc` logs to confirm. Custom paths (say `/data/www`) need permanent labeling with `semanage fcontext`; `restorecon` alone may revert after reboot. Debian derivatives may enable AppArmor; check profiles with `aa-status` and temporarily drop to warning with `aa-complain`. System-level principles are in the fundamentals chapter; the three server-side moves are: check the context, restorecon, enable the boolean.

```bash
ls -Z /var/www/html
sudo restorecon -Rv /var/www/html
sudo setsebool -P httpd_can_network_connect on
sudo ausearch -m avc -ts recent
```

## 9. Log Analysis

The `combined` access log format (including referrer and User-Agent) is enough for common analysis; only extend `LogFormat` with `$time`-style fields when you need durations. The status code distribution is a health snapshot: 2xx/3xx are normal, a 404 spike is mostly path changes or scanners, and persistent 5xx must be cross-read with error.log. In error.log, `(13)Permission denied` points at file permissions, `AH00037`-style warnings at paths, and `(111)Connection refused` at the upstream backend -- triaging by error code beats blind log searching. Error and access logs must be aligned on the timeline: a 5xx spike in access within the same minute often has its matching stack in error, and reading one side alone invites misjudgment.

Log rotation is managed by the distro's logrotate -- do not hand-`rm` a file being written, or the handle keeps holding the space until a service restart. The three analysis moves: Top IP, Top pages, status code distribution; small sites need not reach for ELK from day one. Read access and error against the same timeline -- an error log flooding at one moment often directly explains the 5xx spike in access.

Use `awk '{print $1}' ... | sort | uniq -c | sort -rn` for Top IP, `$7` for Top pages, and `$9` for the status code distribution; the pipeline logic is fixed, and changing the field number covers the three most common analyses.

## 10. Common Problems

### 10.1 403 Forbidden

403 means the request reached Apache but was refused -- TCP is through and HTTP arrived, so the access control layer turned it down. Walk the three layers "filesystem permissions -> directory directives -> SELinux/AppArmor"; do not keep re-editing `<Directory>` -- changing only one spot often "fixes" it by coincidence and recurs on another directory next time, with the root cause still sitting in the other two layers.

**Layer one**: check whether the running user can walk the `x` bits of every level of the path down to the file -- `namei -l` prints the entire path at once. **Layer two**: use `apache2ctl -S` to confirm the request lands in the expected VirtualHost and that the block has `Require all granted`; 2.2's Order/Allow has no effect under 2.4. **Layer three**: check whether the SELinux context is `httpd_sys_content_t`, restorecon it if wrong, and add semanage labeling for custom paths. If all three layers check out and it is still 403, look at whether a `DirectoryMatch` hidden-file rule is catching legitimate paths, or an alias points at a nonexistent path.

```bash
namei -l /var/www/html/index.html
apache2ctl -S
ls -Z /var/www/html && sudo restorecon -Rv /var/www/html
```

### 10.2 500 Internal Server Error

500 mostly comes from `.htaccess` syntax errors, missing modules, or an unhappy backend (such as PHP-FPM) -- an Apache config error of its own more often fails configtest outright rather than producing a runtime 500. Look at the last few dozen lines of error.log first, then configtest; if the log points at Rewrite/Header directives, the module is usually not enabled -- `a2enmod` then reload. In PHP scenarios, also check whether FPM is alive and read the PHP log -- do not spin your wheels in Apache's config, since the root cause of a 500 is often one layer down. A single stray space in `.htaccess` can 500 the whole site; temporarily setting `AllowOverride None` locally for comparison quickly binary-searches whether it is an htaccess problem, and binary search locates far faster than eyeballing line by line.

First `tail -n 50` the end of error.log, then `apache2ctl configtest` to rule out syntax; the two usually narrow a 500 to a specific module or .htaccess line within minutes.

### 10.3 Config Testing and Hot Reloading

The standard flow: edit -> syntax check -> reload -> read the logs. When the check fails, the old config keeps serving and a mistake does not go straight to outage -- but do not skip the check either. `-S` cross-checks virtual host matching, `-M` the module list, and both are powerful tools for debugging "config not effective"; reload does not drop existing connections and is preferred over restart in production. Run configtest once before and once after a complex change, and diffing the reported line numbers is far faster than scanning config with your eyes.

```bash
# Debian
sudo apache2ctl configtest && sudo apache2ctl -S

# RHEL/Arch
sudo httpd -t && sudo httpd -S

sudo systemctl reload apache2   # or httpd
```

## 11. Quick Reference of Common Traps

- Cannot open after installing: status first, then firewall/cloud security group for 80, then `curl -I localhost` to tell "not running" from "not open".
- vhost not effective: on Debian a forgotten `a2ensite` or reload; check the list with `apache2ctl -S`.
- 403 but `ls -la` looks fine: check SELinux `ls -Z`/`restorecon`, and whether a parent directory lacks `x`.
- Incomplete certificate: the intermediate was not baked into the fullchain, or key and certificate do not match.
- Mass 403 after upgrading 2.2 to 2.4: replace Order/Allow/Deny with Require throughout.
- Paths do not match the documentation after `pacman -S apache`: Arch uses `/etc/httpd`, sites go in `conf.d`, and there is no a2ensite.

## References

- Official Apache documentation -- [httpd.apache.org/docs](https://httpd.apache.org/docs/)
- "Vbird's Linux Cabinet" - WWW server -- [linux.vbird.org](https://linux.vbird.org/linux_server/centos6/0360apache.php)
- Arch Wiki - Apache HTTP Server -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Apache_HTTP_Server)
- Let's Encrypt -- [letsencrypt.org](https://letsencrypt.org/)
- Mozilla SSL Configuration Generator -- [ssl-config.mozilla.org](https://ssl-config.mozilla.org/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [coverage-matrix](/research/coverage-matrix.md)
- [README](/server/README.md)