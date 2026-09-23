# 服务器篇

个人电脑和服务器跑的是同一套 Linux，但使用方式完全不同：个人机注重交互体验，服务器则要求长时间无人值守、可远程维护、故障可恢复。学习服务器篇，本质上是学习如何把一台裸机变成可持续提供 Web、数据库、缓存等服务的生产环境。

> 内容参考自鸟哥的私房菜、Arch Wiki 和各服务官方文档，见各章节参考资料。

## 为什么要学服务器运维

很多初学者会问：本地已经能跑网站了，为什么还要单独学服务器？原因有三。

第一，**权限与进程模型不同**。服务器上服务以专用低权限用户运行（如 `nginx`、`www-data`、`mysql`），配置文件、日志、数据目录的属主和权限必须严格区分，和桌面环境"随便跑"的习惯冲突。理解这一点，才能理解后面反复出现的 403、Permission denied。

第二，**包管理与服务管理是基本功**。不同发行版安装软件的命令不同（Debian/Ubuntu 用 `apt`，RHEL/CentOS/Rocky 用 `dnf`，Arch 用 `pacman`），但服务生命周期统一由 `systemctl` 管理。先把这层对照关系理清，后面每个服务章节都不用重新摸索。

第三，**故障排查依赖日志与配置语法检查**。服务器没有图形界面报错弹窗，一切靠 `journalctl`、`/var/log/` 下的应用日志，以及 `nginx -t`、`apachectl configtest` 这类语法检查工具。本篇各章的"常见问题"节都按这个思路组织。

## 章节导读

本篇按"先 Web、再数据、再周边"的顺序编排，建议按序阅读：

| 章节 | 内容 | 阅读建议 |
|------|------|---------|
| [Web 服务器](./web/nginx.md) | Nginx 安装配置、反向代理、负载均衡、HTTPS | 入门首选，现代架构的流量入口 |
| [Apache](./web/apache.md) | Apache HTTP Server 详细配置 | 传统 LAMP、.htaccess 生态仍在大量使用 |
| [数据库](./database/mysql.md) | MySQL/MariaDB 安装配置、用户权限、备份恢复 | 与 Web 配合的核心存储 |
| [Redis](./redis.md) | Redis 安装配置、数据结构、持久化、集群 | 缓存与会话存储 |
| [FTP](./ftp.md) | vsftpd 安装配置、用户管理、安全设置 | 老系统对接时仍会遇到 |
| [容器](./container/docker.md) | Docker 安装、镜像管理、Compose、K8s 入门 | 现代部署的主流方式 |
| [监控](./monitoring/prometheus.md) | Prometheus + Grafana 监控方案 | 上线后必补的可观测性 |
| [DNS](./dns/bind.md) | BIND DNS 服务器配置 | 自建域名解析、内网 DNS |
| [邮件](./mail/postfix.md) | Postfix 邮件服务器配置 | 系统通知、告警邮件 |

Nginx 和 Apache 都是 HTTP 服务器，选型原则很简单：新项目、以反向代理和静态资源为主的场景优先 Nginx；已有大量 `.htaccess` 或依赖 `mod_php` 的遗留系统继续用 Apache。两者可以并存，也可以互为反向代理的前后端，相关章节会分别展开。

## 三发行版服务器环境速览

同一份教程在不同发行版上，包名、服务名、配置路径可能都不同。下表是后续章节会反复用到的对照，建议先记熟。

### 包管理器对照

| 发行版 | 包管理器 | 安装示例 | 更新索引 | 搜索 |
|--------|---------|---------|---------|------|
| Debian/Ubuntu | apt | `sudo apt install nginx` | `sudo apt update` | `apt search nginx` |
| RHEL/CentOS/Rocky | dnf | `sudo dnf install nginx` | `sudo dnf makecache` | `dnf search nginx` |
| Arch Linux | pacman | `sudo pacman -S nginx` | `sudo pacman -Sy` | `pacman -Ss nginx` |

`pacman -S` 中的 `S` 表示 Sync（从仓库同步安装），这是 Arch 用户最常用的子命令；对应的卸载是 `pacman -R`，升级是 `pacman -Syu`。Debian 系的 `apt` 是新一代前端，底层仍是 `dpkg`；RHEL 系的 `dnf` 取代了老的 `yum`，命令含义与 `apt` 大体对齐。

### 服务管理对照

无论用哪种包管理器安装，装完后的服务管理命令在三大发行版上是统一的，因为都用 systemd：

```bash
# 启动服务（三种发行版通用，服务名可能不同）
sudo systemctl start nginx        # Nginx
sudo systemctl start apache2      # Debian/Ubuntu 上的 Apache
sudo systemctl start httpd        # RHEL/Arch 上的 Apache
sudo systemctl start mysqld       # MySQL
sudo systemctl start mariadb      # MariaDB

# 设置开机自启
sudo systemctl enable nginx

# 查看状态与日志
systemctl status nginx
journalctl -u nginx -f
```

唯一要注意的是**服务名**随发行版和包名变化：Debian 的 Apache 包叫 `apache2`、服务也叫 `apache2`；RHEL 和 Arch 的包叫 `httpd`、服务叫 `httpd`。MySQL 在部分发行版中由 MariaDB 接替，服务名相应变为 `mariadb`。具体到每个服务的包名和路径，见对应章节的"安装"节。

### 目录约定速览

服务器软件的配置和数据通常遵循 FHS（文件系统层次标准）：

- 配置：`/etc/` 下按软件名分目录，如 `/etc/nginx/`、`/etc/apache2/`、`/etc/mysql/`
- 数据：`/var/lib/` 下存放数据库数据文件，`/var/www/` 存放网站源码
- 日志：统一在 `/var/log/`，如 `/var/log/nginx/`、`/var/log/httpd/`
- 运行时 PID：多在 `/run/` 或 `/var/run/`

记住"配置在 `/etc`、数据在 `/var/lib`、日志在 `/var/log`"这条主线，排查问题时就不会找错地方。

## 行业推荐方案

下表是常见的技术栈组合，可根据规模和团队熟悉度裁剪：

| 场景 | 推荐方案 |
|------|---------|
| 个人博客 | Nginx + MySQL + WordPress |
| 企业官网 | Nginx + MariaDB + Docker |
| 电商系统 | Nginx + MySQL 主从 + Redis + Docker |
| 缓存加速 | Redis + Memcached |
| 文件存储 | FTP + NFS + 对象存储 |
| 开发测试 | Docker Compose 一键部署 |
| 微服务 | Kubernetes + Prometheus + Grafana |

对于刚起步的项目，不必一上来就上 Kubernetes。一台 2 核 4G 的机器用 Nginx + MySQL + PHP-FPM 或 Nginx + Node.js 就能支撑相当流量，瓶颈往往先出现在数据库慢查询，而不是 Web 层并发。先按本篇把单机架构做扎实，再考虑水平扩展。

> 内容参考自 Arch Wiki、鸟哥的私房菜与各服务官方文档，见各章节参考资料。

## 学习目标

- 掌握三系包管理器与 systemd 服务管理的对照关系，能独立完成服务的安装、启停、开机自启与状态查看
- 理解服务器低权限用户模型与 FHS 目录约定，能快速定位配置（`/etc`）、数据（`/var/lib`）、日志（`/var/log`）
- 能用 `nginx -t`、`apachectl configtest` 做配置语法检查，并用 `systemctl status`、`journalctl` 排查启动失败
- 掌握 Nginx 反向代理、负载均衡与 HTTPS 的基本配置，理解 Nginx 与 Apache 的选型边界
- 会完成 MySQL/MariaDB 的用户权限配置与备份恢复，了解 Redis 持久化、Docker 部署与监控方案的定位
- 避开防火墙与 SELinux 导致的 403/连接不通问题，知道先查端口放行、再查安全上下文的排查顺序

## 常见问题

**Q：应该选哪个发行版做服务器？**

生产环境主流是 Debian/Ubuntu LTS 和 RHEL 系（含 Rocky、AlmaLinux），二者都有长期支持周期和广泛商业支持。Arch 是滚动更新，软件新但变动频繁，更适合学习和开发环境；如果用 Arch 部署，务必固定升级节奏并做好回滚预案（`pacman -Su` 升级前先看新闻页）。

**Q：服务启动失败，第一步查什么？**

先 `systemctl status <服务名>` 看退出码和最近几行日志，再用 `journalctl -u <服务名> -n 50` 看完整上下文。多数启动失败是配置语法错误或端口被占用，配置类错误用 `nginx -t`、`apachectl configtest`、`mysqld --validate-config` 一类工具可以提前发现。

**Q：改了配置要不要重启服务？**

优先 `reload`（不中断现有连接），仅在改了进程模型、监听端口等必须重建的配置时才 `restart`。reload 前先做语法检查，避免 reload 失败导致服务带着旧配置继续跑或直接退出。

**Q：防火墙和 SELinux 怎么处理？**

新装系统访问不通，先查防火墙是否放行端口（`firewall-cmd --list-ports` 或 `ufw status`），再查 SELinux/AppArmor 是否拦截。RHEL 系默认 Enforcing，Web 站点目录错误的 SELinux 上下文会导致 403，即使文件权限完全正确。各 Web 章节的"常见问题"节有具体排查命令。

## 参考资料

- 鸟哥的私房菜 - 服务器篇 — [linux.vbird.org](https://linux.vbird.org/linux_server/)
- Arch Wiki - HTTP server — [wiki.archlinux.org](https://wiki.archlinux.org/title/HTTP_server)
- Nginx 官方文档 — [nginx.org](https://nginx.org/en/docs/)
- MySQL 官方文档 — [dev.mysql.com](https://dev.mysql.com/doc/)
- Docker 官方文档 — [docs.docker.com](https://docs.docker.com/)
- Prometheus 官方文档 — [prometheus.io](https://prometheus.io/docs/)
