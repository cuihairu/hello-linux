# The Servers Section

Personal computers and servers run the same Linux, but they are used in very different ways: a personal machine optimizes for interactive experience, while a server is expected to run unattended for long stretches, be maintainable remotely, and recover from failure. Studying the servers section is, in essence, learning how to turn a bare metal machine into a production environment that can keep delivering websites, databases, caches, and other services.

> Content draws on "Vbird's Linux Cabinet", the Arch Wiki, and each service's official documentation; see the references at the end of each chapter.

## Real Scenarios in Server Operations

When you actually deploy something, one question keeps coming up: my site already runs on my own machine, why do I still need to learn servers separately? There are three reasons.

First, **the permission and process model is different**. On a server, services run as dedicated low-privilege users (such as `nginx`, `www-data`, `mysql`), and the ownership and permissions of config files, logs, and data directories must be kept strictly distinct -- which clashes with the desktop habit of "just run it". Only once you understand this do the repeated 403s and "Permission denied" errors later on make sense.

Second, **package management and service management are basic skills**. Install commands differ across distros (`apt` on Debian/Ubuntu, `dnf` on RHEL/CentOS/Rocky, `pacman` on Arch), but the service lifecycle is uniformly managed by `systemctl`. Get this mapping straight first, and every service chapter afterward needs no re-exploration.

Third, **troubleshooting depends on logs and config syntax checks**. A server has no graphical error dialogs; everything runs on `journalctl`, the application logs under `/var/log/`, and syntax checkers like `nginx -t` and `apachectl configtest`. The "Common Failures" section of every chapter here is organized around exactly this approach.

## Reading Guide

This section is organized by networking, web, data, and ancillary services; the table below gives scenario-based entry points:

| Chapter | Content | Reading advice |
|------|------|---------|
| [Network Parameters](./network-parameters.md) | NIC naming, persisting IP/routes, sysctl network parameters | The first step in getting a server online; prerequisite for every service chapter |
| [Routing and NAT](./routing-nat.md) | policy routing, iptables/nftables NAT, port forwarding | Turning a single machine into a gateway, sharing internet access on an internal network |
| [SSH Remote Login](./ssh.md) | openssh-server across the three distro families, key authentication, sshd_config, client config, firewall and SELinux, troubleshooting | The first thing to set up once a server is online |
| [Web Servers](./web/nginx.md) | Nginx installation and configuration, reverse proxy, load balancing, HTTPS | The recommended starting point; the traffic entry of a modern architecture |
| [Apache](./web/apache.md) | Detailed Apache HTTP Server configuration | Traditional LAMP; the `.htaccess` ecosystem is still widely used |
| [Databases](./database/mysql.md) | MySQL/MariaDB installation and configuration, user privileges, backup and restore | The core storage that works alongside the web tier |
| [Redis](./redis.md) | Redis installation and configuration, data structures, persistence, clustering | Caching and session storage |
| [FTP](./ftp.md) | vsftpd installation and configuration, user management, security settings | Still encountered when integrating with legacy systems |
| [Containers](./container/docker.md) | Docker installation, image management, Compose, intro to K8s | The mainstream way to deploy today |
| [KVM Virtualization](./virtualization/kvm.md) | The KVM/QEMU/libvirt stack, building machines with virt-install, networking and storage, snapshots and clones | When you need to run a heterogeneous kernel or whole-machine isolation |
| [Cloud Computing and cloud-init](./cloud-computing.md) | IaaS/PaaS/SaaS models, instances and images, cloud-init injection, metadata, security groups | Essential reference before moving to the cloud or building your own images |
| [CI/CD and Continuous Delivery](./ci-cd.md) | pipelines on three platforms, artifacts and images, deployment strategies, the secrets red line | The first investment once changes start piling up |
| [LDAP Unified Account Management](./ldap.md) | OpenLDAP server and directory tree, SSSD client integration, TLS and access control | When accounts across many machines need a single point of control |
| [Monitoring](./monitoring/prometheus.md) | The Prometheus + Grafana monitoring stack | Observability you must add after launch |
| [DNS](./dns/bind.md) | BIND DNS server configuration | Self-hosted domain resolution, internal DNS |
| [Mail](./mail/postfix.md) | Postfix mail server configuration | System notifications and alert emails |
| [DHCP Server](./dhcp.md) | dhcpd/Kea address allocation, leases and static reservations | Automatic IP assignment on an internal network |
| [Samba File Sharing](./samba.md) | smb.conf, user mapping, multi-platform client access | Sharing directories across platforms |
| [NFS Server](./nfs.md) | exports, fsid=0, client mounting and troubleshooting | Sharing between Linux machines; common for containers and backups |
| [NTP Time Service](./ntp.md) | chrony configuration, stratum levels and drift compensation | Consistent log timestamps; the basis for working across machines |

Nginx and Apache are both HTTP servers, and the selection rule is simple: for new projects dominated by reverse proxying and static assets, prefer Nginx; for legacy systems with a large stock of `.htaccess` files or a dependence on `mod_php`, keep using Apache. The two can coexist, and either can sit in front of the other as a reverse proxy -- the relevant chapters cover both arrangements.

## The Three Distro Families at a Glance

On different distros, the same documentation may refer to different package names, service names, and config paths. The table below is the mapping the following chapters use repeatedly; it is worth memorizing up front.

### Package Manager Comparison

| Distro | Package manager | Install example | Refresh index | Search |
|--------|---------|---------|---------|------|
| Debian/Ubuntu | apt | `sudo apt install nginx` | `sudo apt update` | `apt search nginx` |
| RHEL/CentOS/Rocky | dnf | `sudo dnf install nginx` | `sudo dnf makecache` | `dnf search nginx` |
| Arch Linux | pacman | `sudo pacman -S nginx` | `sudo pacman -Sy` | `pacman -Ss nginx` |

The `S` in `pacman -S` stands for Sync (install by synchronizing from the repositories) and is the subcommand Arch users reach for most; the matching removal command is `pacman -R` and the upgrade is `pacman -Syu`. On Debian-family systems `apt` is the newer front end, with `dpkg` still underneath; on the RHEL family `dnf` has replaced the old `yum`, and its command meanings broadly align with `apt`.

### Service Management Comparison

However you installed the software, the service management commands are identical on the three major distros afterwards, because all of them use systemd:

```bash
# Start a service (works on all three distros; the service name may differ)
sudo systemctl start nginx        # Nginx
sudo systemctl start apache2      # Apache on Debian/Ubuntu
sudo systemctl start httpd        # Apache on RHEL/Arch
sudo systemctl start mysqld       # MySQL
sudo systemctl start mariadb      # MariaDB

# Enable start at boot
sudo systemctl enable nginx

# Check status and logs
systemctl status nginx
journalctl -u nginx -f
```

The only thing to watch is that **service names** vary by distro and package: Debian's Apache package is called `apache2` and so is its service; RHEL and Arch call both the package and the service `httpd`. On some distros MySQL has been succeeded by MariaDB, in which case the service name becomes `mariadb`. For the exact package names and paths of each service, see the "Installation" section of the corresponding chapter.

### Directory Conventions at a Glance

Server software configuration and data generally follow the FHS (Filesystem Hierarchy Standard):

- Configuration: a per-software directory under `/etc/`, such as `/etc/nginx/`, `/etc/apache2/`, `/etc/mysql/`
- Data: database data files live under `/var/lib/`, website source under `/var/www/`
- Logs: uniformly under `/var/log/`, such as `/var/log/nginx/`, `/var/log/httpd/`
- Runtime PID files: usually under `/run/` or `/var/run/`

Keep the main line in mind -- "config in `/etc`, data in `/var/lib`, logs in `/var/log`" -- and you will never look in the wrong place when troubleshooting.

## Common Recommended Stacks

The table below lists typical technology stack combinations; trim them according to your scale and your team's familiarity:

| Scenario | Recommended stack |
|------|---------|
| Personal blog | Nginx + MySQL + WordPress |
| Corporate website | Nginx + MariaDB + Docker |
| E-commerce system | Nginx + MySQL master-slave + Redis + Docker |
| Cache acceleration | Redis + Memcached |
| File storage | FTP + NFS + object storage |
| Development and testing | one-command deployment with Docker Compose |
| Microservices | Kubernetes + Prometheus + Grafana |

For a project that is just getting started, there is no need to reach for Kubernetes on day one. A 2-core, 4 GB machine running Nginx + MySQL + PHP-FPM, or Nginx + Node.js, can carry a considerable amount of traffic; the bottleneck usually shows up in slow database queries before it shows up as web-tier concurrency. Build the single-machine architecture solidly according to this section first, then consider horizontal scaling.

> Content draws on the Arch Wiki, "Vbird's Linux Cabinet", and each service's official documentation; see the references at the end of each chapter.

## What This Section Covers

- Knowing the mapping between the three distros' package managers and systemd service management
- Understanding the low-privilege user model on servers and the FHS directory conventions
- Being able to check config syntax with `nginx -t` and `apachectl configtest`, and to troubleshoot startup failures with `systemctl status` and `journalctl`
- Basic configuration of Nginx reverse proxy, load balancing, and HTTPS
- Being able to set up MySQL/MariaDB user privileges and backup/restore, and understanding where Redis persistence, Docker deployment, and monitoring solutions fit
- Avoiding the 403s and blocked connections caused by the firewall and SELinux

## Common Questions

**Q: Which distro should I pick for a server?**

Production environments are dominated by Debian/Ubuntu LTS and the RHEL family (including Rocky and AlmaLinux); both have long support cycles and broad commercial backing. Arch is a rolling release -- the software is new but changes frequently -- so it is better suited to learning and development environments. If you do deploy on Arch, be sure to fix an upgrade cadence and have a rollback plan (read the news page before running `pacman -Su`).

**Q: A service fails to start -- what do I check first?**

Run `systemctl status <service>` first to see the exit code and the last few log lines, then use `journalctl -u <service> -n 50` for the full context. Most startup failures are config syntax errors or a port already in use; tools like `nginx -t`, `apachectl configtest`, and `mysqld --validate-config` catch config errors ahead of time.

**Q: Do I have to restart the service after changing its config?**

Prefer `reload` (it does not break existing connections); only `restart` when you have changed something that must be rebuilt, such as the process model or the listening port. Run a syntax check before reloading, so that a failed reload does not leave the service running on its old config or exiting outright.

**Q: How do I deal with the firewall and SELinux?**

On a freshly installed system that cannot be reached, first check whether the firewall is allowing the port (`firewall-cmd --list-ports` or `ufw status`), then check whether SELinux/AppArmor is blocking it. RHEL-family systems default to Enforcing, and a wrong SELinux context on a web document root produces 403s even when the file permissions are perfectly correct. The "Common Failures" section of each web chapter has the specific commands.

## References

- "Vbird's Linux Cabinet" - server edition -- [linux.vbird.org](https://linux.vbird.org/linux_server/)
- Arch Wiki - HTTP server -- [wiki.archlinux.org](https://wiki.archlinux.org/title/HTTP)
- Nginx official documentation -- [nginx.org](https://nginx.org/en/docs/)
- MySQL official documentation -- [dev.mysql.com](https://dev.mysql.com/doc/)
- Docker official documentation -- [docs.docker.com](https://docs.docker.com/)
- Prometheus official documentation -- [prometheus.io](https://prometheus.io/docs/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [coverage-matrix](/research/coverage-matrix.md)
- [README](/system-management/README.md)