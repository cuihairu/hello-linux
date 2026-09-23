# Nginx

Nginx（Engine X）是俄罗斯工程师 Igor Sysoev 开发的高性能 Web 服务器，以事件驱动架构著称，单机可支撑数万并发连接。今天它既是静态资源服务器，也是反向代理、负载均衡和 HTTPS 卸载的事实标准入口。本章从进程模型讲起，覆盖虚拟主机、反向代理、负载均衡、HTTPS、安全加固与 502/403 排查；每个配置块前先说明它解决什么问题，再给最小可用示例。

> 内容参考自 Nginx 官方文档、鸟哥的私房菜和实际运维经验，见文末参考资料。

## 学习目标

本章目标不是背下全部指令，而是建立"配置结构 → 流量路径 → 故障分层"的完整心智模型。学完后应能独立完成：三系安装与服务管理、站点与反代上线、HTTPS 与基础加固、以及 502/403/413 的快速分诊。每一节先讲为什么需要这段配置，再给最小示例；示例可直接改名使用，但生产环境请按自身域名、路径与后端端口替换，并在 reload 前跑 `nginx -t`。


- 理解 Nginx 的架构和工作原理
- 掌握虚拟主机、反向代理、负载均衡配置
- 学会在三大发行版安装、部署 HTTPS 和安全加固
- 了解性能调优和故障排查（含 SELinux/AppArmor）

## 1. Nginx 架构

理解架构是为了排障时能建立正确假设：Master 挂了服务整体没了，Worker 挂了由 Master 补，配置错在 reload 前被 `nginx -t` 拦住，配置对但没 reload 则页面"改了没反应"。把现象映射到架构上的哪一层，比在配置文件里逐行找更高效。事件驱动让单机并发上限远高于传统进程模型，但并发高不等于吞吐高——后端应用、数据库连接池、磁盘 IO 都可能先成为短板，监控要覆盖整条链路而不只是 Nginx 进程 CPU。


### 1.1 进程模型

Nginx 采用 Master-Worker 多进程架构：Master 读取配置、管理 Worker 生命周期、处理信号；Worker 用单线程事件循环处理连接，避免进程/线程切换开销。每个 Worker 可同时管理上万连接，这是"低配机器扛高并发"的来源——瓶颈更多在系统文件描述符和后端服务，而不是 Nginx 本身。reload 时 Master 读新配置、起新 Worker、让旧 Worker 处理完存量连接后退出，所以热加载不中断长连接；这也是为什么改配置可以放心频繁 reload，只要 configtest 通过。

Worker 数通常设 `auto`（等于 CPU 核数）。理论并发上限约等于 `worker_processes × worker_connections`，还要扣掉与上游的出站连接——反代场景下每个客户端连接往往对应一条到后端的连接，上限要按双向一起算。与 Apache 对比：Nginx 集中式配置、内存友好、擅长反代；Apache 进程/线程模型、支持 `.htaccess`、动态模块生态成熟。选型不必非此即彼——静态为主的现代前端栈优先 Nginx，遗留 LAMP 可继续 Apache，两者也可前后串联，Nginx 做 TLS 卸载与静态缓存，Apache/应用处理动态请求。生产上更常见的形态是：Nginx 在最外层收流量，后面挂应用容器或 Apache，职责边界清晰后排障也快。

```
                    ┌─────────────┐
                    │   Master    │  ← 读取配置、管理 Worker
                    │   Process   │
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
   ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐
   │   Worker 1   │  │   Worker 2   │  │   Worker 3   │  ← 处理请求
   └─────────────┘  └─────────────┘  └─────────────┘
```

| 特性 | Nginx | Apache |
|------|-------|--------|
| 并发模型 | 事件驱动 | 进程/线程模型 |
| 内存占用 | 低 | 高 |
| 静态文件 | 极快 | 一般 |
| 动态处理 | 反向代理为主 | 内置模块/多进程 |
| 配置风格 | 集中式 | .htaccess 分散式 |

### 1.2 安装

安装本身很少出错，出错多在"装完之后的三件事"：服务没 enable、防火墙没放行、属主/路径按错发行版抄。把这三件事做成上线检查清单，可以消灭一大半"新机器打不开"的工单。包管理器差异只影响安装命令，不影响后续 systemd 与配置结构的主干知识——这也是本篇在 README 里先给三系对照表的原因：先记住工具差异，再专注 Nginx 本身。


三大发行版官方源都提供 nginx 包，装完用同一个 systemd 单元名 `nginx` 管理——包管理器不同，服务生命周期却一致，这是 systemd 统一带来的好处。Debian 默认站点目录 `/var/www/html`，Arch 默认 `/srv/http`；运行用户 Debian 常是 `www-data`，RHEL/Arch 多是 `nginx`——写属主时别抄错组名，否则 403。要最新 mainline 可改 Nginx 官方 apt 仓库（先导 signing key，再写 sources 列表）；RHEL 系 `dnf install nginx` 即可；Arch 用官方仓库 `sudo pacman -S nginx`，升级时留意 news 避免配置格式变更踩坑。三系安装后统一 `sudo systemctl enable --now nginx`，再用 `nginx -v` 与 `curl -I http://localhost` 验证；curl 若返回发行版欢迎页，说明进程与默认 server 都正常，接下来再替换成自己的 server 块。

验证顺序建议固定为：包是否装上（`nginx -v`）→ 服务是否 active（`systemctl status`）→ 本机是否通（`curl -I localhost`）→ 外部是否通（换一台机器 curl 或浏览器）。每一步失败对应完全不同的原因，跳步排查容易在错误的层上打转。装完若浏览器连接超时而非 404，先查防火墙：firewalld 执行 `firewall-cmd --permanent --add-service=http` 后 reload，UFW 执行 `ufw allow 80`。云主机还有安全组入方向，与本机防火墙是两层，缺一不可——这层不通时 Nginx 日志里往往一片安静，很容易误判成配置错误。

```bash
# Debian/Ubuntu / RHEL / Arch 对照
sudo apt update && sudo apt install nginx
sudo dnf install nginx
sudo pacman -S nginx

sudo systemctl enable --now nginx
nginx -v && curl -I http://localhost
```

## 2. 配置文件结构

配置结构决定"改哪里、会不会生效"。全局块影响进程与日志，events 影响连接处理，http 影响全站协议行为，server/location 影响单站路由——写错层级是常见失误：把 `client_max_body_size` 写进只覆盖部分路径的 location，别的路径仍 413；把 `limit_req_zone` 写进 server（语法上应放 http），reload 直接失败。分不清时先看官方指令作用域，再决定放 http 还是 server，而不是哪里报错就粘到哪里。


### 2.1 文件位置

| 文件 | 说明 |
|------|------|
| /etc/nginx/nginx.conf | 主配置文件 |
| /etc/nginx/conf.d/*.conf | 站点配置（RHEL/Arch/通用） |
| /etc/nginx/sites-available/ | 站点配置（Debian/Ubuntu） |
| /etc/nginx/sites-enabled/ | 已启用站点（符号链接） |
| /var/log/nginx/access.log | 访问日志 |
| /var/log/nginx/error.log | 错误日志 |

Debian 默认 sites-available/enabled 软链接风格；RHEL/Arch 更常用 conf.d。主配置末尾 `include` 到哪，配置就从哪加载——找不到站点配置时先看 include，而不是反复搜全盘。日志按站点拆分时，路径通常写在对应 server 块内，全局默认日志只覆盖未单独指定的请求。

### 2.2 配置结构

配置由全局块、events 块、http 块及嵌套 server/location 组成。**指令以分号结尾，块用花括号——少分号是最常见语法错误**，`nginx -t` 会指到行号。全局块定进程与日志，events 定连接处理，http 内放通用优化、日志格式与各 server；server 按域名分流，location 做路径级路由。理解"块嵌套"后，排"某行无效"只需问三个问题：写在了正确的块里吗？该块被 include 了吗？reload 成功了吗？——这三问能覆盖绝大多数配置不生效问题。

`worker_processes auto` 与 `worker_connections` 共同决定理论并发，改前先 `ulimit -n`，并同步提高 systemd `LimitNOFILE`，否则重启回落默认 1024，高并发出现 `too many open files`。gzip 常用类型按业务加，别对已压缩资产再压一遍浪费 CPU。`sendfile`/`tcp_nopush`/`tcp_nodelay` 对静态发送路径有收益，保持开启即可。

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

## 3. 虚拟主机

虚拟主机解决"一台机器、一个 IP、多个站点"的分流问题。HTTP/1.1 靠 Host 头区分站点，Nginx 用 `server_name` 与之匹配——DNS 只负责把域名指到这台机器，真正选中哪个 server 块发生在应用层。理解这个分工后，"DNS 对了但打开默认页"就不再神秘：要么 Host 没写对，要么请求根本没进到预期的 server 块。多站点应一域名一 server，日志、证书、根目录都分开，排障时不会互相污染。改完 server 块先 `nginx -t` 再 reload，并用带 Host 头的 `curl -H 'Host: ...'` 在本机验证匹配结果，比等 DNS 生效后再试快得多。


### 3.1 基于域名的虚拟主机

server 块按 `server_name` 匹配 Host；都匹配不上时落到该端口第一个（或 `default_server`）块。这也是"域名解析对了却打开欢迎页"的原因——Host 没匹配上，进了默认 server。配置后务必 `nginx -t` 再 reload，避免括号写错导致整站失效。

`try_files` 按序尝试文件/目录，最后可回 404；静态资源单独 location 加过期头；`location ~ /\.` 拦 `.git`、`.env`，是低成本加固。SPA 记得 `try_files ... /index.html` 兜底，否则前端路由刷新必 404——这类 404 只在"刷新非根路径"时出现，容易被误判成后端故障。访问日志按站点拆开，后面做 Top 页面统计不用先 grep 域名；`server_name` 支持通配与 `default_server`，多域名入口用一条 server 收口更省配置。

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

### 3.2 基于端口的虚拟主机

同一机器给内部工具、调试服务开 8080 等端口时，用另一个 `listen` 即可。端口块与域名块互不干扰，但防火墙要对每个业务端口分别放行。端口分流不依赖 Host，适合无法改请求头的调用方；与域名块混用时，注意同一 `listen` 上 server_name 不能完全相同，否则后写的不生效。

写一个 `server` 块，`listen 8080`、`server_name localhost`（或专用域名）、`root` 指向另一站点目录即可，与 80 上的域名块互不干扰。

### 3.3 创建站点目录

站点目录是配置与磁盘的交汇点：Nginx 配置里的 `root` 指到哪里，运行用户就要能读到哪里。目录权限、属主、SELinux 上下文三者任一不对，都会从"配置正确"滑向 403。建议站点根目录单独建、不与系统目录混放，迁移与备份都更干净；开发环境可用统一的 `/var/www/<域名>` 约定，减少每次上线现想路径的成本。


建目录、属主对准运行用户、放测试页、语法检查、reload——这条五步链是每次上线新站的最小闭环。属主写错（www-data vs nginx）会让 Nginx 自己读不到 index，表现为 403 而非 404，和"文件不存在"要区分开：404 是路径没找到，403 是路径在但身份不够，错误日志里的提示也不一样。创建后先 `curl -I` 自测再配 DNS，能把问题收敛在本机；DNS 生效后再测一遍，避免把"本机 ok"当成"全网 ok"。

步骤：`mkdir -p` 建目录；`chown` 属主 Debian 用 `www-data`、RHEL/Arch 用 `nginx`；`chmod 755` 保证可读可进入；`tee` 写测试页；最后 `nginx -t` 通过再 `systemctl reload nginx`。属主写错会直接 403，这五步是上线新站的固定动作，建议做成脚本固化。

## 4. 反向代理

反向代理与正向代理方向相反：正向代理替客户端出网，反向代理替服务端收流量（Nginx 在前、应用在后）。对客户端而言后端不可见，只以为在和 Nginx 通信；对后端而言来源往往是内网回环地址，真实客户端信息全靠转发头带进来。安全上还有一层意义：后端不出公网，攻击面收敛到 Nginx 与 WAF，应用漏洞不直接暴露在扫描器面前。排"后端拿到错误 Host/IP"类 bug 时，第一时间检查这组 `proxy_set_header`，比翻应用代码快；`X-Forwarded-Proto` 缺失还会让后端误判协议，生成错误的重定向 URL。


反向代理是 Nginx 最高频用法：客户端只面对 Nginx，后端藏在内网。好处是统一 TLS、便于横向扩展、后端重启不中断对外服务，还能在边缘做缓存、限流与灰度。核心就一条 `proxy_pass`，但**请求头必须正确透传**，否则后端看到的 Host、客户端 IP 全是 Nginx 自己，日志、限流、风控都会失真。排"后端拿到错误 Host"类 bug 时，第一时间检查这组 `proxy_set_header`，比翻应用代码快。

### 4.1 基本反向代理

`X-Real-IP`/`X-Forwarded-For`/`X-Forwarded-Proto` 分别告诉后端真实 IP 与原始协议；超时按业务调，长查询要加大 `proxy_read_timeout`，否则后端还在算、Nginx 已返回 504。`proxy_pass` 末尾有无 `/` 改变 URI 替换规则：有 `/` 替换 location 前缀，无 `/` 完整转发——代理路径 404 的经典陷阱，改完先在测试环境 `curl` 验证，对比 `Location` 响应头最直观。

location 内核心是 `proxy_pass` 加四条 `proxy_set_header`（Host、X-Real-IP、X-Forwarded-For、X-Forwarded-Proto），再按业务设 `proxy_read_timeout`。缺透传头后端日志会失真，超时过短则长查询接口稳定 504——这两类问题占反代排障的一大半。

### 4.2 WebSocket 代理

WebSocket 把一次短请求升级为长连接，代理层必须完整转发升级所需的协议头，否则握手在 Nginx 或后端任一侧失败，浏览器只看到连接立刻关闭。长连接还带来两个衍生问题：一是空闲超时被中间设备掐断（需要应用层心跳或调大 `proxy_read_timeout`），二是 Worker 被大量长连接占满（注意 `worker_connections` 与 `limit_conn` 的配额）。排障时先用浏览器 Network 看握手状态码，101 才算升级成功，仍是 200/502 则升级头或后端处理有问题。


WebSocket 必须 HTTP/1.1 并正确设置 Upgrade/Connection，缺一不可，否则首屏正常、长连接立刻断开。只代理 `/ws` 路径即可，不必整站开升级头——给所有 location 加 Upgrade 反而可能干扰普通请求的连接复用。代理层若还有 gzip，对 WebSocket 路径应 `gzip off`，避免把升级后的帧再压坏。

WebSocket 的 location 必须：`proxy_http_version 1.1`、`Upgrade $http_upgrade`、`Connection "upgrade"`，外加 `proxy_pass` 与 Host。缺任一条都会握手失败；只对 `/ws` 路径开，不要整站加升级头。

### 4.3 多应用代理

SPA 前端 `try_files` 回退 index.html 是路由刷新不 404 的关键；API 用前缀 location 转发到后端，静态可用 `alias` 加长缓存。注意 location 优先级：精确 `=` > `^~` > 正则 > 最长前缀，正则与前缀混用时先理清匹配树再改，否则容易出现"改了 A 结果命中 B"。API 与静态都在同一 server 下时，先匹配长前缀还是正则要心里有数，必要时用 `^~` 关掉正则回跳。

前端 `location /` 用 `try_files` 回退 `index.html`；`location /api` 转发到后端并透传 Host/Real-IP；`location /static` 用 `alias` 挂静态目录并 `expires 30d`。三条各司其职，加新前缀路径时复制 `/api` 块改 `proxy_pass` 即可。

## 5. 负载均衡

负载均衡的前提是后端无状态或会话可外置；有状态又不做会话保持，用户请求会在多台后端间漂移，表现为随机掉登录。选型上，小流量单机 upstream 轮询足够；会话敏感优先改架构（Redis 存会话）而不是依赖 IP Hash；长连接多用 least_conn。均衡器本身也要高可用——Nginx 单点时应在前面再挂一层 DNS 轮询、Keepalived VIP 或云 SLB，否则一台 Nginx 挂了全站不可用，后端再稳也没用。


### 5.1 upstream 配置

`upstream` 把多台后端收成一个逻辑名，`proxy_pass` 直接引用这个名字，扩缩容只需改 upstream 成员并 reload，不必动业务 location——这是把"拓扑"从业务配置里剥出来的关键设计。默认轮询；`weight` 调配比；`ip_hash` 做会话保持；`backup` 只在全挂时顶上；`max_fails`/`fail_timeout` 是开源版唯一的**被动**健康检查——只有请求真的失败到阈值才摘除，没有主动拨测。后端全挂且无 backup 时客户端直接 502。开源版没有主动探活，需要 Nginx Plus 或外部检查器，可用应用层心跳弥补。上游域名解析结果默认只在启动/重载时取一次，用 DNS 做动态发现时要配合 `resolver` 或外部工具，否则容器环境里 IP 漂移后会一直打到旧地址；K8s 里 Service 变更后不 reload 就打不到新 Pod，是经典坑。

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

### 5.2 负载均衡策略

策略选择本质是对"公平、性能、会话"三者的权衡：轮询最公平，加权照顾机器差异，最少连接减少长请求堆积，IP Hash 保会话但可能把热点 IP 打到同一台。会话保持是临时手段，长期应把登录态、购物车等放到共享存储，让后端回到无状态，扩容与发布才不会被粘性会话绑死。无论哪种策略，都要配 backup 或前置 SLB，避免单点全挂；策略变更后用压测或真实流量观察分布，防止权重改错导致一台机器被打满。


| 策略 | 说明 | 适用场景 |
|------|------|---------|
| 轮询 | 依次分配请求 | 后端同构、无状态 |
| 加权轮询 | 按权重分配 | 服务器性能不同 |
| IP Hash | 同一 IP 同一后端 | 需要会话保持 |
| 最少连接 | 分配到连接数最少者 | 长连接、耗时差异大 |

有状态服务更推荐把会话外置 Redis，摆脱 IP Hash——移动网络、代理出口让客户端 IP 频繁变化，同一用户请求会漂移。负载均衡解决的是"水平扩展与故障隔离"，解决不了后端自身的慢查询；先看应用延迟再加机器，否则只是把排队从前端挪到上游。

## 6. HTTPS 配置

HTTPS = HTTP + TLS，证书用于证明"我确实是 example.com"，密钥用于完成握手与加密。没有证书或证书不匹配，浏览器会拦下页面；`nginx -t` 只能查路径与语法，查不出"证书域名与 server_name 不一致"这类语义错误——后者要看浏览器详情或 `openssl s_client`。生产上证书来源三类：Let's Encrypt（免费自动续期）、商业 CA（需要兼容性背书）、内部 CA（企业内网自签）。个人与中小站首选 Let's Encrypt，配合自动续期与到期监控，比手工年更可靠得多。上线 HTTPS 后仍要保留 80 跳转，否则收藏夹里的旧 http 链接会直接失败。


### 6.1 Let's Encrypt 免费证书

certbot 的 nginx 插件自动改写 server 块、安装续期 timer，是最省事的路径。证书 90 天有效，装完必须 `renew --dry-run` 确认续期链路，否则到期当天全站不信任——很多事故不是没续，是续成功却没 reload。三系安装为 `apt install certbot python3-certbot-nginx`、`dnf install certbot python3-certbot-nginx`、`pacman -S certbot`（nginx 插件视版本在官方源或 AUR），也可 `--webroot` 手动部署。续期 hook 里记得 `nginx -t && systemctl reload nginx`，只换证书不 reload 时旧连接可能仍握着旧证；监控证书剩余天数比监控进程更早暴露问题。

获取：`sudo certbot --nginx -d example.com -d www.example.com`；验证续期：`sudo certbot renew --dry-run`。插件会改写 server 块并安装 timer，跑完仍建议 `nginx -t` 再 reload 一次，确认自动改写干净。

### 6.2 手动配置 HTTPS

手动配置适合需要精确控制协议版本、套件、HSTS 细则的场景，也便于版本管理（证书路径与 server 块进配置仓库）。与插件自动改写相比，手动方式责任更清晰：证书更新、reload、跳转规则都自己维护，因此更要配好续期 hook 与到期监控。写完 443 块后，用 `openssl s_client -connect example.com:443 -servername example.com` 检查证书链与域名是否匹配，再开浏览器确认无告警——工具层通过不等于浏览器层通过，两端都要看。


Nginx 1.25.1 起，HTTP/2 用独立指令 `http2 on;`；旧的 `listen 443 ssl http2` 已过时（部分版本仅告警，部分不再生效）。下面同时给 443 主站与 80 跳转；`ssl_protocols` 锁 1.2/1.3，套件可对照 Mozilla 生成器按兼容档位抄。HSTS 带长 `max-age` 时**确认全站 HTTPS 再开**，否则浏览器锁死 HTTP 访问，证书没就绪时会把自己锁在门外。证书路径写错时 `nginx -t` 就会报错，不要带着测试失败的配置 reload。

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

## 7. 安全加固

安全加固分三层：传输层（TLS、HSTS）、HTTP 层（安全头、限流、白名单）、系统层（SELinux/AppArmor、防火墙）。只做其中一层都会留缺口——只开 HTTPS 不设 HSTS，用户仍可能被降级到 HTTP；只设 CSP 不收敛多余暴露面，攻击面依然在。本节按 HTTP 层展开，系统层与基础篇、各章 SELinux 节交叉引用，避免同一套命令在多章重复到走形。加固后要用 `curl -I` 与浏览器开发者工具抽查响应头，配置写了不等于线上生效，`add_header` 继承规则尤其容易让人误判"为什么有的页面没有"。


### 7.1 安全 Headers

安全头防点击劫持、MIME 嗅探，CSP 管脚本来源。`X-XSS-Protection` 已废弃，不要再加——它由浏览器逐步移除，留着只增加响应体积。`add_header` 在 location 内重写会**覆盖**父级同名指令——安全头想全局生效宜放 server/http 层，或每层写全，这是"部分页面没有安全头"的根因，用 `curl -I` 抽查几类 URL 即可验证。CSP 先 Report-Only 观察误杀再强制，业务脚本来源清单要逐步收紧而不是一次锁死；第三方统计、字体、CDN 都要在清单里留位置，否则上线即白屏。

在 server 或 http 层写入：`X-Frame-Options SAMEORIGIN`、`X-Content-Type-Options nosniff`、`Referrer-Policy strict-origin-when-cross-origin`、CSP `default-src 'self'`，均带 `always`，保证 4xx/5xx 也输出。

### 7.2 限流配置

`limit_req_zone` 在 http 层定义每 IP 速率，location 内引用；`burst` 允许短暂突发排队，`nodelay` 立即放行排队请求。只写 zone 不给 burst 时，用户双击都可能 503；状态码默认 502，可用 `limit_req_status 429` 改贴切值——502 会让监控误判成上游故障，改 429 更贴"限流"语义。`limit_conn` 限并发连接，防单 IP 开大量连接拖垮后端。限流是保护后端的刹车，不能替代业务鉴权与 WAF；对登录、短信类接口还要单独更严的速率，否则限流阈值内的刷接口依然存在。

http 层用 `limit_req_zone` 定每 IP 速率（如 10r/s）、`limit_conn_zone` 定连接数；location 里 `limit_req zone=api burst=20 nodelay` 与 `limit_conn addr 100` 引用并限并发，再 `proxy_pass`。

### 7.3 IP 白名单/黑名单

白名单用 `allow`/`deny` 顺序判断（先匹配先生效，末尾 `deny all` 收口）；大量黑名单更适合 `map` 成变量再返回 403。管理入口更稳妥的是只对内网或 VPN 开放，应用层白名单当纵深防御，不要当唯一屏障。出网或办公网 IP 变更频繁时，白名单要配套变更流程，否则上线第二天自己就被锁在外面。

`location /admin` 内先 `allow` 可信网段，再 `deny all` 收口，最后 `proxy_pass`；顺序决定匹配结果，白名单必须写在 deny 之前。

### 7.4 SELinux 与 AppArmor

RHEL 系上权限正确仍 403/502，先查 SELinux：站点目录上下文应为 `httpd_sys_content_t`，错则 `restorecon`；反向代理默认可能禁止外连，需 `setsebool -P httpd_can_network_connect on`。证据在 `avc: denied`（`ausearch -m avc`）。Debian 若启用 AppArmor，`aa-status` 查 nginx profile，临时 `aa-complain` 降告警再改回 enforce。系统级原理见基础篇；服务侧以上三板斧覆盖绝大多数场景，自定义目录记得永久打标，否则重启回退。

```bash
ls -Z /var/www/html
sudo restorecon -Rv /var/www/html
sudo setsebool -P httpd_can_network_connect on
sudo ausearch -m avc -ts recent
```

## 8. 性能调优

性能问题先分类再调参：容量不够（加 worker/连接数/机器）、延迟高（查上游慢、缓冲、DNS）、错误率高（502/413/超时，先当故障修再谈优化）。没有基线数据的调参是玄学——改前后用同一压测脚本记录 QPS、P99、CPU 与 RSS，才能判断方向对不对。Nginx 本身通常不是瓶颈，多数"nginx 慢"实际是上游应用慢或磁盘/网络慢，先用 `$upstream_response_time` 把责任段切开，再决定是调 Nginx 还是修应用。调参顺序永远是：先确认瓶颈在 Nginx，再动 worker/缓冲，最后才考虑加机器。


### 8.1 Worker 配置

`worker_processes auto` 已够用，除非 NUMA 绑定才手动 `worker_cpu_affinity`。`worker_rlimit_nofile` 调大后必须同步 systemd `LimitNOFILE`，否则重启静默回落。events 里 `use epoll` 是 Linux 最优事件模型，`worker_connections` 结合文件描述符上限设定——先查 ulimit，再定数值，顺序反了会在高峰期踩 `too many open files`。调完建议压测对比，而不是凭感觉把 1024 直接改成一万。

关键三处：`worker_processes auto`；`worker_rlimit_nofile 65535`（并同步 systemd `LimitNOFILE`）；`events` 内 `worker_connections`、`use epoll`、`multi_accept on`。数值按压测与 ulimit 上限设定，顺序是先查文件描述符再定连接数。

### 8.2 缓冲区配置

缓冲与请求体限制直接决定"能不能传大文件、后端慢时前端扛不扛得住"。默认值面向小请求场景，上传、导出、大 JSON 接口必须显式调整。调大不是免费的：更大的缓冲意味着单连接可占更多内存，DoS 场景下要与限流、`limit_conn` 一起用。改这类参数前后都应用 `nginx -t` 验证，并在测试环境用真实大小的请求打一发，避免只在配置里"看起来对"。


`client_max_body_size` 默认仅 1M，上传接口不改会稳定 413——全站最常忘的一行，且 413 响应页不会提示"去改哪一行"，新人常在应用层空找。代理缓冲默认开启即可，后端慢时 Nginx 先回缓存数据；`large_client_header_buffers` 只在确有超长 Cookie/URL 时加大，盲目加同样放大攻击面。改完务必 configtest，括号与分号错误会直接拦下 reload。多层代理时限制在最外层生效，内层改了也看不到效果；限流、body 限制、超时都有这个"外层优先"性质，排障从公网入口往里走。

在 http 或 server 层设置 `client_max_body_size 100m` 解决 413，并按需调 `client_body_buffer_size`、`proxy_buffering on` 与 `proxy_buffers` 系列；默认缓冲已开启，只在排查慢回源时才动 proxy_buffer_*。

### 8.3 缓存配置

`proxy_cache_path` 在 http 层定义缓存区，目录需 nginx 用户可写，否则缓存静默失效。`X-Cache-Status` 头显示 HIT/MISS/BYPASS，比翻日志直观；带个性化 Cookie 的响应要 `proxy_cache_bypass`/`no-cache` 旁路，避免串号。缓存键默认含 scheme/host/uri，查询串是否参与用 `proxy_cache_key` 按业务定。发布后记得 `purge` 或调短 `inactive`，否则用户可能盯旧页面刷新到天荒地老。

http 层 `proxy_cache_path` 声明缓存目录与 `keys_zone`；server/location 里 `proxy_cache my_cache` 开启，`proxy_cache_valid` 定 TTL，并用 `X-Cache-Status` 头观察 HIT/MISS。目录属主必须是运行用户，否则缓存静默不写。

## 9. 日志分析

日志分析的目标是把"用户报错"翻译成"哪一层、哪条请求、什么原因"。访问日志给出请求维度（状态码、耗时、路径），错误日志给出进程维度（上游失败、权限、配置警告），两者时间对齐后信息量远大于单看。小流量用 shell 管道足够，流量上来再考虑结构化采集；无论工具怎么换，先保证日志里有 `$request_time` 与 `$upstream_response_time`，否则任何平台都算不出"慢在哪段"。

分析时先定问题域再选字段：稳定性看状态码分布与 error 关键字，容量看 QPS 与并发，性能看耗时分位与上游耗时，安全看异常 UA 与敏感路径探测。Top IP 三板斧（awk、sort、uniq -c）是手工分析的底线能力，即使以后上了 ELK 也仍用于快速验证。日志轮转由 logrotate 负责，不要手工删除正在写入的文件，否则句柄仍占空间直到进程重启——磁盘满的"灵异事件"经常由此而来。


日志分析的目标是把"用户报错"翻译成"哪一层、哪条请求、什么原因"。访问日志给出请求维度（状态码、耗时、路径），错误日志给出进程维度（上游失败、权限、配置警告），两者时间对齐后信息量远大于单看。小流量用 shell 管道足够，流量上来再考虑结构化采集；无论工具怎么换，先保证日志里有 `$request_time` 与 `$upstream_response_time`，否则任何平台都算不出"慢在哪段"。


访问日志是排障第一现场；`main` 格式可扩展 `$request_time` 与 `$upstream_response_time`，才能区分"慢在客户端/网络"还是"慢在后端"——没有这两个字段，慢请求只能看到状态码 200，无从下手。状态码分布、Top IP、Top 页面用 `awk | sort | uniq -c` 三板斧即可，小流量不必一上来就上 ELK。GoAccess 适合单机快速出 HTML 报告，三系包名都是 `goaccess`。日志轮转交给 logrotate，不要 `rm` 正在写的文件；error 与 access 按时间轴对照，5xx 尖刺往往能立刻对上上游超时日志。把 access 里 `$upstream_response_time` 超过阈值的行导出来做周报，比人肉翻文件可持续。

状态码、Top IP 用与 Apache 相同的 `awk | sort | uniq -c | sort -rn` 管道；安装 GoAccess 三系均为 `apt`/`dnf`/`pacman -S goaccess`，再 `goaccess ... --log-format=COMBINED -o report.html` 出报告。

## 10. 常见问题

常见问题按状态码或现象分诊，比按配置文件翻页更快。每个小节给出"现象 → 分层顺序 → 最小命令"，命令只用来验证假设，不要在没形成假设前盲目跑。线上处置时先止血（回滚配置、摘流量、启用 backup 后端），再回实验室复现根因——把生产当实验台是排障事故的常见来源。5xx 优先看 error.log 与上游，4xx 优先看权限、白名单与路径，两者不要混用同一套"重试大法"。


### 10.1 502 Bad Gateway

502 表示 Nginx 收到上游响应失败：后端没起来、端口不对、超时或连接被拒——问题在 Nginx 的"后面"，与站点静态权限无关。固定顺序——**进程 → 端口 → 错误日志 → 超时/SELinux**——可避免在 Nginx 配置里空转。`Connection refused` 是后端未监听；`upstream timed out` 是后端过慢；SELinux 场景还要想到 `httpd_can_network_connect` 未开。应用层端口通了但仍 502，再查协议不匹配（如把 HTTP 打到 HTTPS 端口）以及 upstream 里写死的 IP 是否已漂移。排障时先 `curl` 直连后端端口，通了再查 Nginx，不通就别改 Nginx 配置——顺序反了会浪费大量时间。

```bash
systemctl status your-app
ss -tlnp | grep 8080
tail -f /var/log/nginx/error.log
```

### 10.2 403 Forbidden

403 是 Nginx 或系统拒绝了请求，与 502 完全不同。三类原因：目录缺 index 且无 autoindex、`deny`/白名单没放行、**系统权限或 SELinux 上下文不对**。先 `namei -l` 看整条路径权限，再 `ls -Z` 查上下文；隐藏文件 `deny` 规则有时会误伤以点开头的合法路径，临时注释该 location 对比验证。自定义站点根目录时，别忘了父级目录也要有执行权限。

```bash
namei -l /var/www/example.com/index.html
ls -la /var/www/example.com
ls -Z /var/www/example.com && sudo restorecon -Rv /var/www/example.com
```

### 10.3 413 Request Entity Too Large

413 是请求体超过 `client_max_body_size`，与后端无关——错误在 Nginx 收包阶段就产生了，后端日志往往一片安静。定位时从公网入口逐层确认该值，而不是只改最内层应用前的那台 Nginx。若业务允许分片上传或直传对象存储，也可在网关层保持较小限制，把大流量卸载到存储服务，既省带宽又降低被恶意大包打满内存的风险。


```nginx
client_max_body_size 100m;   # http 或 server 层
```

改完 `nginx -t && systemctl reload nginx`。链路上有多层代理时，**最外层限制先生效**，只改内层看不到效果——从公网入口逐层确认，别在最后一层空改。上传走对象存储直传的架构，可只在需要代理的路径开大 body，避免全站放宽。

### 10.4 配置测试

标准动线：编辑 → `nginx -t` → reload → 看 error.log。reload 失败不杀旧 worker，新配置也不生效，"改了没反应"先怀疑 reload 是否报错——这与 Apache 行为一致，也是所有热加载服务的共同点。`nginx -T` 打印合并所有 include 后的运行时全文，是确认"某行到底有没有加载"的终极手段；改复杂配置前后各跑一次，diff 输出最直观。测试报错时不要用 `-s reload` 强行覆盖，先修语法再上线；把 configtest 绑进部署脚本的最后一步，可以在发布流水线里直接拦下坏配置。

```bash
sudo nginx -t
sudo nginx -T
sudo systemctl reload nginx
```

## 常见坑速查

下面每一条都对应前面某一节的"为什么"，速查用于线上止血，回头仍应回到对应章节理解机制。把坑按"配置语法 / 匹配与路径 / 权限与 SELinux / 上游与超时 / 证书与安全头"归类记忆，遇到新问题先判断属于哪一类，再套用对应排查链，比逐条试错快。


- 写完没生效：少分号/花括号，或忘了 reload；`nginx -t` 指到行号就改哪。
- Arch 下 `pacman -S nginx` 后默认页在 `/srv/http`，不是 `/var/www/html`。
- 后端看到 IP 是 127.0.0.1：缺 X-Real-IP/X-Forwarded-For 透传。
- HSTS 开了打不开 HTTP：max-age 过长且证书/跳转未就绪，需清浏览器 HSTS。
- WebSocket 老断：缺 `proxy_http_version 1.1` 或 Upgrade 头。
- 上传必 413：`client_max_body_size` 默认 1M，且要改最外层 Nginx。

## 本章小结

Nginx 的知识可以收成四条主线：进程与配置结构（master/worker、块嵌套、configtest）、流量入口（server_name、location 匹配、默认块）、与后端的边界（反代头透传、upstream 策略、超时与缓冲）、对外的门面（TLS、HSTS、安全头、限流）。日常多数操作落在"改 server/location → `nginx -t` → reload → 看 error.log"这条闭环上；疑难杂症多是 SELinux、多层代理外层优先、以及把上游故障误当成 Nginx 故障。把四条主线与分诊顺序记熟，比背下每一个指令的默认值更有用——默认值会随版本变，分层排查的方法不会。

上线与变更时，保持"小步改、先测试、再 reload、盯 error.log"的节奏，比一次性大改更安全；回滚预案与配置版本管理同等重要。监控至少覆盖进程存活、5xx 比例、上游延迟与证书剩余天数，这四项能覆盖本章大部分故障的早期信号。Nginx 只是链路的一环，与应用、数据库、防火墙的协作边界清晰了，排障速度才会真正变快。


Nginx 的知识可以收成四条主线：进程与配置结构（master/worker、块嵌套、configtest）、流量入口（server_name、location 匹配、默认块）、与后端的边界（反代头透传、upstream 策略、超时与缓冲）、对外的门面（TLS、HSTS、安全头、限流）。日常多数操作落在"改 server/location → `nginx -t` → reload → 看 error.log"这条闭环上；疑难杂症多是 SELinux、多层代理外层优先、以及把上游故障误当成 Nginx 故障。把四条主线与分诊顺序记熟，比背下每一个指令的默认值更有用——默认值会随版本变，分层排查的方法不会。

## 使用建议

生产变更请遵循：先在测试环境改、`nginx -t` 通过、低峰 reload、盯 error.log 数分钟、确认无异常再离开。回滚只需恢复上一版配置并再次 test+reload，Nginx 的热加载机制让回滚成本足够低，因此没有必要为"怕回不去"而跳过测试。把站点配置纳入 Git，变更走评审，比在生产机上 vim 到一半断连可靠得多。

## 参考资料

- Nginx 官方文档 — [nginx.org/en/docs](https://nginx.org/en/docs/)
- Nginx Beginner's Guide — [nginx.org/en/docs/beginners_guide.html](https://nginx.org/en/docs/beginners_guide.html)
- 鸟哥的私房菜 - WWW 服务器 — [linux.vbird.org](https://linux.vbird.org/linux_server/0360apache.php)
- Arch Wiki - Nginx — [wiki.archlinux.org](https://wiki.archlinux.org/title/Nginx)
- Let's Encrypt — [letsencrypt.org](https://letsencrypt.org/)
- Mozilla SSL Configuration Generator — [ssl-config.mozilla.org](https://ssl-config.mozilla.org/)
