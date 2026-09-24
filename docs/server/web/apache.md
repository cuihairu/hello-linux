# Apache

Apache HTTP Server（httpd）是历史最悠久、生态最丰富的 Web 服务器之一，以模块化设计和稳定著称。即便在 Nginx 盛行的今天，大量企业内网系统、LAMP 架构和依赖 `.htaccess` 的站点仍在使用 Apache。本章先讲清进程模型、虚拟主机、SSL 与模块体系的设计动机，再给最小可用的配置片段，并重点覆盖 403/500 这类高频故障的分层排查思路。

> 内容参考自 Apache 官方文档、鸟哥的私房菜和实际运维经验，见文末参考资料。

## 学习目标

- 理解 Apache 架构和 MPM 工作原理
- 掌握虚拟主机、模块启用和 SSL 配置
- 学会在 Debian/Ubuntu、RHEL 系、Arch 上安装与排障
- 学会性能调优和安全加固（含 SELinux/AppArmor 衔接）

## 1. Apache 架构

### 1.1 进程模型

Apache 采用"父进程管理 + 子进程处理请求"的多进程模型。父进程以 root 启动，负责读取配置、绑定特权端口（80/443），随后降权并 fork 出子进程；真正处理 HTTP 的是这些低权限子进程。子进程崩溃不会拖垮整个服务，父进程会按需补充，这是 Apache 稳定性的根基。

与事件驱动的 Nginx 相比，Apache 每个并发请求更"重"：prefork 下每个连接对应一个进程，内存随连接数线性增长。因此调 Apache 性能时，第一个要看的永远是 MPM 选型，而不是盲目加 `MaxRequestWorkers`。理解这一点，后面所有关于线程、KeepAlive、连接上限的参数才不会调反方向。

从运维视角还应记住：父进程持有特权端口，子进程降权后读站点文件——所以站点文件只要给到运行用户可读即可，不必也不应放开全局可写。子进程被 OOM 或段错误杀掉时，父进程会补，短暂 500 后自愈；若父进程本身退出，systemd 会按 Restart 策略拉起，监控应盯 unit 状态而不是只盯 80 端口。

```text
                    ┌─────────────┐
                    │   Parent    │  ← 管理子进程
                    │   Process   │
                    └──────┬──────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
   ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐
   │   Child 1   │  │   Child 2   │  │   Child 3   │  ← 处理请求
   └─────────────┘  └─────────────┘  └─────────────┘
```

### 1.2 MPM 模块

MPM（Multi-Processing Module）决定子进程如何组织，是 Apache 性能调优的第一个开关。三大发行版默认大多已是 `event`，但按业务选型仍需理解差异：prefork 兼容非线程安全旧模块（如老 mod_php），一个连接占一个进程，内存开销最大；worker 在进程里塞线程，兼顾兼容与资源；event 把连接保持和实际处理分离，闲置连接不占工作线程，最适合高并发与大量 KeepAlive 长连接。

同一时刻只能启用一个 MPM。用 `httpd -V | grep MPM` 或 `apache2ctl -M` 查看当前模块；切换需要改发行版的模块配置并重启服务，不能靠 reload 在线完成——reload 只重载配置与部分模块，不重建进程模型。从 prefork 迁到 event 时，若业务仍依赖线程不安全的旧扩展，会表现为随机崩溃或请求处理卡住，先确认扩展清单再切；无法升级的遗留 PHP 站点往往被迫停在 prefork，这是它在现代发行版上仍存在的主要原因。

| MPM | 说明 | 适用场景 |
|-----|------|---------|
| prefork | 多进程，每进程单线程 | 兼容旧模块，内存占用高 |
| worker | 多进程多线程 | 兼容与资源的折中 |
| event | 事件驱动，连接与处理分离 | 高并发、长连接，现代默认 |

## 2. 安装

三大发行版的包名不同：Debian/Ubuntu 叫 `apache2`，RHEL 系和 Arch 叫 `httpd`。服务名与包名一致，排错时 `systemctl status` 的目标要对号入座——教程写 `systemctl status httpd`，你在 Debian 上会得到 unit not found。装完后用 `curl -I http://localhost` 验证默认页；打不开先分清是服务没起、防火墙没放行，还是云安全组没开 80，三层从内到外查。

Debian/Ubuntu 包与服务名均为 `apache2`。先 `sudo apt update` 刷新索引，再 `sudo apt install apache2` 安装，接着用 `sudo systemctl enable --now apache2` 一次完成启用与启动——`enable --now` 等价于先 enable 再 start，是 systemd 下最省事的写法。验证分两步：`apache2 -v` 看版本与编译参数，`curl -I http://localhost` 看默认站点是否响应 200。两步都过了，才说明"装上了且在听"；只跑第一步成功会把"服务没起"误判成"装好了"。

RHEL/CentOS/Fedora 包与服务名均为 `httpd`，把 apt 换成 `sudo dnf install httpd`、服务名换成 `httpd` 即可，其余 systemctl 与 curl 步骤完全相同。SELinux 默认 Enforcing 的机器，后面站点目录还要补上下文，否则会遇到"权限全对仍 403"——这不是 Apache 配置错误，是强制访问控制在拦，详见安全加固节。

Arch Linux 官方仓库提供 `httpd`，用 `sudo pacman -S httpd` 安装。Arch 的配置是单文件 `httpd.conf` 加 `conf.d` 片段，没有 Debian 的 `a2ensite` 软链接体系，启用站点等于把 conf 放进目录并 reload。默认站点根目录是 `/srv/http`，与 Debian/RHEL 的 `/var/www/html` 不同，抄路径时注意；这也是 Arch 用户照搬教程时最容易踩的路径坑。无论哪一系，防火墙都要显式放行：firewalld 用 `firewall-cmd --permanent --add-service=http` 后 reload，UFW 用 `ufw allow 80`；云主机再查安全组——服务启动但 curl 超时时，问题几乎总在网络层而不是 Apache 配置。下面按发行版给出最小安装命令，启动与验证逻辑三系一致。

## 3. 配置文件

### 3.1 文件位置

Apache 的配置布局按发行版分成两派：Debian 系拆成多文件用软链接启用（sites/mods/conf 三套 available/enabled），RHEL/Arch 系以主配置加 `conf.d` 片段为主。改配置前先确认自己在哪一派里，否则会在错误目录新建永远不被 include 的文件——"改了没生效"有一半原因是文件放错地方。Debian 主配置在 `/etc/apache2/apache2.conf`，站点与模块在 `sites-available`、`mods-available`；RHEL/Arch 主配置在 `/etc/httpd/conf/httpd.conf`，片段进 `conf.d/`，RHEL 的模块加载多在 `conf.modules.d/`。

两派的共同点是"主配置负责全局与 include，细粒度配置外置"。Debian 把外置配置再拆成 available/enabled，多一层开关语义，适合多站点启停；RHEL/Arch 直接放文件即生效，更接近"所见即所得"。迁移机器时若只拷了 sites-enabled 而忘了可用目录结构，在 RHEL 上会显得无从下手——先读主配置的 Include 指令，永远是找配置的第一步。

| 文件 | 说明 |
|------|------|
| /etc/apache2/apache2.conf | 主配置（Debian/Ubuntu） |
| /etc/httpd/conf/httpd.conf | 主配置（RHEL/CentOS/Arch） |
| /etc/apache2/sites-available/ | 站点配置（Debian） |
| /etc/apache2/sites-enabled/ | 已启用站点（软链接） |
| /etc/httpd/conf.d/ | 站点/模块片段（RHEL/Arch） |

### 3.2 配置结构

主配置从上到下依次是全局指令（运行用户、日志、超时）、模块加载（`LoadModule`）、默认虚拟主机与包含指令。顺序很关键：`LoadModule` 之前写的模块指令不会生效，Include 片段按出现位置参与合并。新手常见错误是把 `RewriteEngine On` 写在 mod_rewrite 加载之前，规则"写了没反应"。改完配置不要直接重启，先语法检查（见第 10 节），通过后再 reload；语法错误时 reload 会失败并保留旧配置继续服务，这是保护机制——但也不要跳过检查直接 restart，把可回滚的小错变成宕机。运行用户（Debian `www-data`、RHEL/Arch `httpd`）决定了子进程读站点文件的身份，改错会导致全局 403。

典型骨架：`ServerRoot` 指向配置根目录，`User`/`Group` 设定子进程身份，随后按需 `LoadModule`，最后用 `<VirtualHost *:80>` 声明默认或首个站点（`ServerName` + `DocumentRoot`）。理解这个顺序后，往下加站点与模块就是重复同一模式，不必每次整文件照抄。

## 4. 虚拟主机

虚拟主机让一台 Apache 同时托管多个站点。匹配顺序：先按 `ServerName`/`ServerAlias` 精确匹配 Host，匹配不到落到默认（第一个或标记 Default）块。这也是"域名解析对了却打开别的站"的常见原因——ServerName 写错，或该块根本没被 include。改完用 `apache2ctl -S` 列出所有已加载虚拟主机及 DocumentRoot，比翻文件快得多。多站点时代日志、证书、DocumentRoot 都按站点隔离，一次只动一个站点的 conf，回滚面更小。

### 4.1 基于域名的虚拟主机

基于域名是最常用形态：同一 IP、同一端口，靠 Host 头分流。客户端先做 DNS 解析，再在 HTTP 请求头里带上 Host；Apache 用这个头在多个 VirtualHost 里选一个。匹配不到时落到默认块，所以默认块的 DocumentRoot 不要指向敏感目录。`AllowOverride All` 允许站点用 `.htaccess` 覆盖目录配置，灵活但每请求多一次文件读取，生产若无分布式配置需求可改 `None` 提速——关掉 .htaccess 也是常见加固与提速手段。`Require all granted` 是 2.4 语法，替代 2.2 的 `Order/Allow/Deny`；混用两代语法是升级后 403 的高频原因，迁移时要全局搜旧指令。错误日志与访问日志建议按站点拆分，否则多站混在一个文件里，排障时要先过滤 `ServerName` 或按 vhost 日志文件分开看。

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

### 4.2 基于端口的虚拟主机

内网工具、旧客户端只能访问非标端口时，用第二个 `Listen` 加不同端口的 VirtualHost 区分。写法是在全局加 `Listen 8080`，再写一个 `<VirtualHost *:8080>` 指向另一 `DocumentRoot`。每个 `Listen` 必须在全局出现一次，否则该端口上所有块都不生效；端口分流不依赖 Host 头，适合无法改 Host 的调用方。注意防火墙要对每个业务端口分别放行，只开 80 时 8080 上的站点在外网永远打不通——这是"本机 curl 通、外网不通"的经典来源。

### 4.3 启用站点

Debian 用 `a2ensite`/`a2dissite` 管理软链接；RHEL/Arch 把 `.conf` 放进 `conf.d`（或主配置 Include）即可。无论哪一派，**启用后都要 configtest 并 reload，并用 `apache2ctl -S` 确认站点在列表里**——忘了 reload 是"配置写了没生效"的第一嫌疑。Debian 上还可 `a2dissite 000-default` 关掉默认欢迎页，避免新站域名未匹配时落进默认块造成困惑。

Debian 启用站点：`sudo a2ensite example.com.conf`，再 `configtest` 通过后 `reload apache2`；禁用用 `a2dissite`。RHEL/Arch 没有 a2ensite，确认 conf 已放入 `conf.d` 后 `httpd -t` 通过再 `reload httpd`。两派最后一步都是"测试 + reload"，差别只在"启用"这一下是软链接还是落文件。

## 5. SSL 配置

### 5.1 启用 SSL 模块

Debian 上 ssl 模块可能默认未启用，需 `a2enmod ssl`；发安全头还要 `headers` 模块。RHEL/Arch 的 ssl 通常随主包加载，用 `httpd -M | grep ssl` 确认。证书文件属主应为 root、私钥 600，中间证书要打进 fullchain，否则部分浏览器报证书链不完整——这是证书部署最常见的坑。私钥权限过松时 Apache 启动可能直接拒绝加载，错误日志会提示 key 权限问题。

Debian 上 `sudo a2enmod ssl headers` 后重启服务；三系均可用 `httpd -M | grep ssl` 确认模块已加载。headers 模块常被忽略，缺了它 HSTS 与安全头会静默不生效。

### 5.2 SSL 虚拟主机

443 块挂证书与安全参数，80 块做 301 跳转——跳转用 `Redirect permanent` 最简单，也可用 mod_rewrite，目标是让所有明文流量尽快收口到 HTTPS。`SSLProtocol` 限制到 TLS 1.2/1.3；业务若依赖极老客户端再放宽，否则保持收紧。HSTS 一旦下发且 max-age 很长，浏览器会强制锁 HTTPS——**确认全站可用后再开**，否则证书或跳转没就绪时会把自己锁在门外。TLS 1.3 的套件由 OpenSSL 协商，新版通常不必再纠结 `SSLHonorCipherOrder`；`SSLCertificateChainFile` 在部分新版本并入 `SSLCertificateFile`（直接给 fullchain），报链错误时对照当前版本文档核对指令名。证书与私钥不匹配时服务能启动但浏览器告警，用成对文件校验比只看文件名可靠。

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

certbot 的 Apache 插件会自动改写虚拟主机、追加重定向，比手工维护证书路径省事。证书 90 天有效，装完必须 `renew --dry-run` 验证续期 timer，否则到期当天全站不信任。三系安装分别是 `apt install certbot python3-certbot-apache`、`dnf install certbot python3-certbot-apache`、`pacman -S certbot`；Arch 的 Apache 插件视版本可能在 AUR，也可改 webroot 手动部署加 deploy hook。获取证书后仍要 `apachectl configtest`，certbot 改写配置偶尔会引入语法问题。

获取证书执行 `sudo certbot --apache -d example.com -d www.example.com`（按实际域名替换），之后务必 `sudo certbot renew --dry-run` 验证续期。certbot 会改写 vhost 并追加 80→443 跳转，跑完仍建议再 `apachectl configtest` 一次，确认自动改写没有引入语法问题。

## 6. 模块管理

Apache 的功能几乎全部由模块提供，按需启停是它区别于单体服务的核心能力。原则：不用的模块不加载，既降攻击面也省内存。最常开的四个是 `rewrite`（伪静态）、`headers`（安全头/HSTS）、`expires`（浏览器缓存）、`deflate`（gzip 压缩）。模块列表本身就是一份"能力清单"：排"某指令无效"时先 `apache2ctl -M` 看模块在不在，比在配置里反复改参数快；安全基线扫描也常从多余模块下手，能关则关。

Debian 的 `a2enmod` 操作 available/enabled 软链接；RHEL/Arch 在 `conf.modules.d` 或主配置里增删 `LoadModule` 注释。改完都要 reload，并用 `apache2ctl -M` 或 `httpd -M` 核对列表——列表里没有，写再多指令也是空转。模块指令要出现在模块加载之后，且 `RewriteEngine` 还要求所在 Directory 的 AllowOverride 允许重写。压缩与缓存按 `AddOutputFilterByType`、`ExpiresByType` 给到具体 MIME 类型即可，不要对已压缩的图片再压一遍浪费 CPU。

Debian 一条命令启用四个常用模块：`sudo a2enmod rewrite headers expires deflate`，再用 `apache2ctl -M` 核对列表。RHEL/Arch 则改 `conf.modules.d` 里的 `LoadModule` 注释后 reload，核对用 `httpd -M`。

目录级配置写 `<Directory /var/www/html>` 内 `AllowOverride All` 允许 .htaccess；压缩用 `AddOutputFilterByType DEFLATE` 按 MIME 类型开启；缓存用 `ExpiresActive On` 加 `ExpiresByType`，例如图片缓存一年、CSS 缓存一个月。指令位置与模块加载顺序要对，否则写了不生效。

## 7. 性能调优

调优顺序：先 MPM 与业务匹配，再连接数上限，最后才动缓冲区。盲目把 `MaxRequestWorkers` 拉到数千，在小内存机器上会因进程争抢更慢——每个 prefork 子进程都是一份内存占用。event 下同内存能撑的并发远高于 prefork，**换 MPM 往往比加内存更划算**。调优要有对照：改前后用同一压测脚本记录 TPS、P99 与 RSS，否则"感觉快了"无法区分是配置生效还是缓存变热。

`MaxRequestWorkers`（旧名 MaxClients）是并发天花板，估算约等于可用内存除以单请求平均占用。`MaxConnectionsPerChild` 非零可定期回收子进程，缓解泄漏与碎片。KeepAlive 对静态站收益明显；前面已有 Nginx 做长连接聚合时，Apache 侧可缩短 `KeepAliveTimeout` 释放进程。`LimitRequestLine` 等保持默认即可，随意调大会放大慢速攻击面。改 MPM 或大参数后建议低峰重启并用 `ss`/压测工具观察连接数，而不是改完不看效果。

event MPM 示例放在 `mpm_event.conf`：控制起始进程数、忙闲线程水位、每进程线程数、总请求 Worker 上限与子进程回收周期；同时打开 KeepAlive 并限制单连接请求数与空闲超时。数值按内存与压测结果微调，不要无脑抄大数。

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

## 8. 安全加固

### 8.1 安全 Headers

安全响应头降低点击劫持、MIME 嗅探与残留 XSS 风险，需先启用 `headers` 模块。`X-XSS-Protection` 已被主流浏览器废弃，保留无害但不再提供防护，现代做法是 CSP。CSP 上线先用 Report-Only 观察误杀，再切强制，避免把业务脚本一并拦掉；`Header always set` 里的 `always` 保证错误页也带头，去掉后 4xx/5xx 可能缺安全头。

常用组合是：`X-Frame-Options SAMEORIGIN` 防点击劫持，`X-Content-Type-Options nosniff` 防 MIME 嗅探，`Referrer-Policy` 控制来源泄露，CSP 的 `default-src 'self'` 限制默认加载源。均用 `Header always set ...` 写入，保证错误页也带头。

### 8.2 隐藏版本信息

`ServerTokens Prod` 只回 `Server: Apache`，不带版本与模块列表；`ServerSignature Off` 去掉错误页页脚版本串。两者叠加避免被按指纹扫漏洞，属于低成本必做项，放在全局配置即可全站生效。注意 `ServerTokens` 只在全局设置有效，写在 VirtualHost 内可能不被接受。

在全局写 `ServerTokens Prod` 与 `ServerSignature Off` 两条即可，前者收敛 Server 响应头，后者去掉错误页页脚版本串。

### 8.3 访问控制

目录级控制用 2.4 的 `Require` 系列：`Require ip` 限定来源网段，`<DirectoryMatch>` 批量拒绝点开头的隐藏文件（`.git`、`.env`）。管理后台若暴露公网，务必再套网络层白名单或 VPN，不要只靠应用密码——Apache 层拦住了扫描器，不代表应用层登录页没被打。`Require` 多条时是"或"关系，要"且"需包进 `<RequireAll>`。

示例：管理目录只允许可信网段 `Require ip 192.168.1.0/24`，配合 `Require ip 10.0.0.0/8`；`<DirectoryMatch "/\.">` 内 `Require all denied` 批量拒绝隐藏文件。多条 `Require` 默认是"或"，要"且"需包进 `<RequireAll>`。

### 8.4 SELinux 与 AppArmor（RHEL/Debian）

文件权限全对却仍 403，优先怀疑强制访问控制。RHEL/CentOS/Rocky 默认 Enforcing，站点目录上下文错误、反向代理布尔值未开都会被拦，且错误页往往只是普通 403，必须看 `avc` 日志才能确认。自定义路径（如 `/data/www`）要 `semanage fcontext` 永久打标，只 `restorecon` 可能重启回退。Debian 衍生版可能启用 AppArmor，`aa-status` 查 profile，临时 `aa-complain` 可降为告警。系统级原理见基础篇；服务侧三板斧：看上下文、restorecon、开布尔值。

```bash
ls -Z /var/www/html
sudo restorecon -Rv /var/www/html
sudo setsebool -P httpd_can_network_connect on
sudo ausearch -m avc -ts recent
```

## 9. 日志分析

访问日志用 `combined` 格式（含来源页与 User-Agent）足以支撑常见分析；需要耗时时再扩展 `LogFormat` 加 `$time` 类字段。状态码分布是健康度快照：2xx/3xx 正常，404 飙升多为路径变更或扫描器，5xx 持续出现必须结合 error.log。error.log 里 `(13)Permission denied` 指向文件权限，`AH00037` 类警告指向路径，`(111)Connection refused` 指向上游后端——按错误码分诊比盲目搜日志快。error 与 access 要按时间轴对齐：同一分钟 access 里 5xx 尖刺往往能在 error 里找到对应堆栈，单看一边容易误判。

日志轮转由发行版 logrotate 管理，不要手工 `rm` 正在写的文件，否则句柄仍占空间直到重启服务。分析三板斧：Top IP、Top 页面、状态码分布，小流量站点不必一上来就上 ELK。access 与 error 要对着时间看——同一时刻 error 刷屏往往能直接解释 access 里的 5xx 尖刺。

用 `awk '{print $1}' ... | sort | uniq -c | sort -rn` 统计 Top IP，`$7` 统计 Top 页面，`$9` 统计状态码分布；管道逻辑固定，改字段号即可覆盖三种常用分析。

## 10. 常见问题

### 10.1 403 Forbidden

403 表示请求已到 Apache 但被拒绝——TCP 是通的，HTTP 也到了，是访问控制层挡下的。按"文件系统权限 → 目录指令 → SELinux/AppArmor"三层走，不要只反复改 `<Directory>`；只改一处常常碰巧"好了"，下次换目录又复发，根因仍留在另外两层。

**第一层**看运行用户能否沿路径每一级 `x` 位走到文件，`namei -l` 一次打印整条路径。**第二层**用 `apache2ctl -S` 确认落到预期 VirtualHost，且对应块有 `Require all granted`；2.2 的 Order/Allow 在 2.4 下无效。**第三层**查 SELinux 上下文是否 `httpd_sys_content_t`，错则 restorecon，自定义路径再补 semanage 打标。三层都查完仍 403，再看是否被 `DirectoryMatch` 的隐藏文件规则误伤，或别名指向了不存在的路径。

```bash
namei -l /var/www/html/index.html
apache2ctl -S
ls -Z /var/www/html && sudo restorecon -Rv /var/www/html
```

### 10.2 500 Internal Server Error

500 多来自 `.htaccess` 语法错误、模块缺失或后端（如 PHP-FPM）异常——Apache 自身配置错更常见的是 configtest 直接失败，而不是运行中 500。先看 error.log 最后几十行，再 configtest；日志若指向 Rewrite/Header 指令，通常是模块未启用，`a2enmod` 后 reload。PHP 场景另查 FPM 是否存活与 php 日志，不要在 Apache 配置里空转——500 的根因经常在下一层。`.htaccess` 里一个多余空格就能让整站 500，本地临时 `AllowOverride None` 对比可快速二分是否 htaccess 问题，二分法定位比逐行肉眼审快得多。

先 `tail -n 50` 看 error.log 末尾，再 `apache2ctl configtest` 排除语法问题；两者通常几分钟内就能把 500 收敛到具体模块或 .htaccess 行。

### 10.3 配置测试与热加载

标准动线：编辑 → 语法检查 → reload → 看日志。检查失败时旧配置继续服务，改错不会直接宕机，但也不要跳过检查。`-S` 核对虚拟主机匹配，`-M` 核对模块列表，两者是排"配置没生效"的利器；reload 不断开已有连接，生产优先于 restart。复杂改动前后各跑一次 configtest，diff 报错行号，比肉眼扫配置快得多。

```bash
# Debian
sudo apache2ctl configtest && sudo apache2ctl -S

# RHEL/Arch
sudo httpd -t && sudo httpd -S

sudo systemctl reload apache2   # 或 httpd
```

## 11. 常见坑速查

- 装完打不开：先 status，再防火墙/云安全组 80，再 `curl -I localhost` 区分没起和没放行。
- vhost 没生效：Debian 忘了 `a2ensite` 或 reload；`apache2ctl -S` 看列表。
- 403 但 `ls -la` 正常：查 SELinux `ls -Z`/`restorecon`，以及父目录缺不缺 `x`。
- 证书不完整：中间证书没打进 fullchain，或私钥与证书不匹配。
- 2.2 升 2.4 后大片 403：全面替换 Order/Allow/Deny 为 Require。
- `pacman -S httpd` 后路径对不上教程：Arch 是 `/etc/httpd`，站点进 `conf.d`，无 a2ensite。

## 参考资料

- Apache 官方文档 — [httpd.apache.org/docs](https://httpd.apache.org/docs/)
- 鸟哥的私房菜 - WWW 服务器 — [linux.vbird.org](https://linux.vbird.org/linux_server/centos6/0360apache.php)
- Arch Wiki - Apache HTTP Server — [wiki.archlinux.org](https://wiki.archlinux.org/title/Apache_HTTP_Server)
- Let's Encrypt — [letsencrypt.org](https://letsencrypt.org/)
- Mozilla SSL Configuration Generator — [ssl-config.mozilla.org](https://ssl-config.mozilla.org/)
