# Nginx

Nginx（Engine X）是俄罗斯工程师 Igor Sysoev 开发的高性能 Web 服务器，以事件驱动架构著称，单机可支撑数万并发连接。

> 内容参考自 Nginx 官方文档、鸟哥的私房菜和实际运维经验，见文末参考资料。

## 学习目标

- 理解 Nginx 的架构和工作原理
- 掌握虚拟主机、反向代理、负载均衡配置
- 学会 HTTPS 部署和安全加固
- 了解性能调优和故障排查

## 1. Nginx 架构

### 1.1 进程模型

Nginx 采用 Master-Worker 多进程架构：

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

与 Apache 的对比：

| 特性 | Nginx | Apache |
|------|-------|--------|
| 并发模型 | 事件驱动 | 进程/线程模型 |
| 内存占用 | 低 | 高 |
| 静态文件 | 极快 | 一般 |
| 动态处理 | 反向代理 | 内置模块 |
| 配置风格 | 集中式 | .htaccess 分散式 |

### 1.2 安装

```bash
# Debian/Ubuntu - 官方源
sudo apt update
sudo apt install nginx

# Debian/Ubuntu - 官方仓库（获取最新版本）
curl -fsSL https://nginx.org/keys/nginx_signing.key | sudo gpg --dearmor -o /usr/share/keyrings/nginx-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/nginx-archive-keyring.gpg] http://nginx.org/packages/mainline/debian $(lsb_release -cs) nginx" | sudo tee /etc/apt/sources.list.d/nginx.list
sudo apt update
sudo apt install nginx

# RHEL/CentOS/Fedora
sudo dnf install nginx

# 启动并设置开机自启
sudo systemctl start nginx
sudo systemctl enable nginx

# 验证安装
nginx -v
curl -I http://localhost
```

## 2. 配置文件结构

### 2.1 文件位置

| 文件 | 说明 |
|------|------|
| /etc/nginx/nginx.conf | 主配置文件 |
| /etc/nginx/conf.d/*.conf | 站点配置（通用） |
| /etc/nginx/sites-available/ | 站点配置（Debian/Ubuntu） |
| /etc/nginx/sites-enabled/ | 已启用站点（符号链接） |
| /var/log/nginx/access.log | 访问日志 |
| /var/log/nginx/error.log | 错误日志 |

### 2.2 配置结构

```nginx
# 全局块
user nginx;
worker_processes auto;                    # 自动匹配 CPU 核心数
error_log /var/log/nginx/error.log warn;
pid /run/nginx.pid;

# events 块 - 连接处理
events {
    worker_connections 1024;              # 每个 Worker 最大连接数
    use epoll;                            # Linux 下使用 epoll
    multi_accept on;                      # 一次接受多个连接
}

# http 块 - HTTP 协议配置
http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # 日志格式
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;

    # 性能优化
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;

    # Gzip 压缩
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    # 包含站点配置
    include /etc/nginx/conf.d/*.conf;
}
```

## 3. 虚拟主机

### 3.1 基于域名的虚拟主机

```nginx
# /etc/nginx/conf.d/example.com.conf
server {
    listen 80;
    server_name example.com www.example.com;

    root /var/www/example.com;
    index index.html index.htm;

    # 站点根目录
    location / {
        try_files $uri $uri/ =404;
    }

    # 静态文件缓存
    location ~* \.(jpg|jpeg|png|gif|ico|css|js)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # 禁止访问隐藏文件
    location ~ /\. {
        deny all;
    }

    access_log /var/log/nginx/example.com.access.log;
    error_log /var/log/nginx/example.com.error.log;
}
```

### 3.2 基于端口的虚拟主机

```nginx
server {
    listen 8080;
    server_name localhost;

    root /var/www/app;
    index index.html;
}
```

### 3.3 创建站点目录

```bash
# 创建目录
sudo mkdir -p /var/www/example.com

# 设置权限
sudo chown -R www-data:www-data /var/www/example.com    # Debian/Ubuntu
sudo chown -R nginx:nginx /var/www/example.com          # RHEL/CentOS
sudo chmod -R 755 /var/www/example.com

# 创建测试页面
echo "<h1>Hello from example.com</h1>" | sudo tee /var/www/example.com/index.html

# 测试配置
sudo nginx -t

# 重新加载
sudo systemctl reload nginx
```

## 4. 反向代理

### 4.1 基本反向代理

```nginx
server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;

        # 传递客户端信息
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 超时设置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

### 4.2 WebSocket 代理

```nginx
server {
    listen 80;
    server_name ws.example.com;

    location /ws {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

### 4.3 多应用代理

```nginx
server {
    listen 80;
    server_name app.example.com;

    # 前端
    location / {
        root /var/www/frontend;
        try_files $uri $uri/ /index.html;
    }

    # API 后端
    location /api {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # 静态资源
    location /static {
        alias /var/www/static;
        expires 30d;
    }
}
```

## 5. 负载均衡

### 5.1 upstream 配置

```nginx
# 负载均衡后端
upstream backend {
    # 轮询（默认）
    server 192.168.1.101:8080;
    server 192.168.1.102:8080;
    server 192.168.1.103:8080;

    # 加权轮询
    # server 192.168.1.101:8080 weight=3;
    # server 192.168.1.102:8080 weight=2;
    # server 192.168.1.103:8080 weight=1;

    # IP Hash（会话保持）
    # ip_hash;

    # 最少连接
    # least_conn;

    # 备用服务器
    server 192.168.1.104:8080 backup;

    # 健康检查
    server 192.168.1.101:8080 max_fails=3 fail_timeout=30s;
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

| 策略 | 说明 | 适用场景 |
|------|------|---------|
| 轮询 | 依次分配请求 | 通用场景 |
| 加权轮询 | 按权重分配 | 服务器性能不同 |
| IP Hash | 同一 IP 分配到同一后端 | 需要会话保持 |
| 最少连接 | 分配到连接数最少的后端 | 长连接应用 |

## 6. HTTPS 配置

### 6.1 Let's Encrypt 免费证书

```bash
# 安装 certbot
sudo apt install certbot python3-certbot-nginx    # Debian/Ubuntu
sudo dnf install certbot python3-certbot-nginx    # RHEL/CentOS

# 获取证书
sudo certbot --nginx -d example.com -d www.example.com

# 测试续期
sudo certbot renew --dry-run

# certbot 会自动添加定时任务
```

### 6.2 手动配置 HTTPS

```nginx
server {
    listen 443 ssl http2;
    server_name example.com;

    # 证书路径
    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

    # SSL 优化
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # HSTS
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    root /var/www/example.com;
    index index.html;
}

# HTTP 重定向到 HTTPS
server {
    listen 80;
    server_name example.com www.example.com;
    return 301 https://$server_name$request_uri;
}
```

## 7. 安全加固

### 7.1 安全 Headers

```nginx
server {
    # ... 其他配置 ...

    # 安全 Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';" always;
}
```

### 7.2 限流配置

```nginx
# 定义限流区域
http {
    # 每秒 10 个请求
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

    # 每个 IP 最多 100 个连接
    limit_conn_zone $binary_remote_addr zone=addr:10m;
}

server {
    location /api {
        limit_req zone=api burst=20 nodelay;
        limit_conn addr 100;
        proxy_pass http://backend;
    }
}
```

### 7.3 IP 白名单/黑名单

```nginx
# 白名单
location /admin {
    allow 192.168.1.0/24;
    allow 10.0.0.0/8;
    deny all;
    proxy_pass http://backend;
}

# 黑名单（使用 map）
map $remote_addr $blocked {
    default 0;
    192.168.1.100 1;
    10.0.0.50 1;
}

server {
    if ($blocked) {
        return 403;
    }
}
```

## 8. 性能调优

### 8.1 Worker 配置

```nginx
# 自动匹配 CPU 核心数
worker_processes auto;

# 绑定 CPU（可选）
worker_cpu_affinity 0001 0010 0100 1000;

# 增加打开文件数
worker_rlimit_nofile 65535;

events {
    worker_connections 10240;
    use epoll;
    multi_accept on;
}
```

### 8.2 缓冲区配置

```nginx
# 客户端请求缓冲
client_body_buffer_size 16k;
client_header_buffer_size 1k;
client_max_body_size 100m;
large_client_header_buffers 4 8k;

# 代理缓冲
proxy_buffering on;
proxy_buffer_size 4k;
proxy_buffers 8 16k;
proxy_busy_buffers_size 32k;
```

### 8.3 缓存配置

```nginx
# 定义缓存区域
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=my_cache:10m max_size=1g inactive=60m;

server {
    location / {
        proxy_cache my_cache;
        proxy_cache_valid 200 302 10m;
        proxy_cache_valid 404 1m;
        proxy_cache_key $scheme$proxy_host$request_uri;
        add_header X-Cache-Status $upstream_cache_status;
        proxy_pass http://backend;
    }
}
```

## 9. 日志分析

### 9.1 日志格式

```nginx
# 自定义日志格式
log_format detailed '$remote_addr - $remote_user [$time_local] '
                    '"$request" $status $body_bytes_sent '
                    '"$http_referer" "$http_user_agent" '
                    '$request_time $upstream_response_time';
```

### 9.2 常用分析命令

```bash
# 查看访问量前 10 的 IP
awk '{print $1}' /var/log/nginx/access.log | sort | uniq -c | sort -rn | head -10

# 查看访问量前 10 的页面
awk '{print $7}' /var/log/nginx/access.log | sort | uniq -c | sort -rn | head -10

# 查看 HTTP 状态码分布
awk '{print $9}' /var/log/nginx/access.log | sort | uniq -c | sort -rn

# 查看每小时访问量
awk '{print $4}' /var/log/nginx/access.log | cut -d: -f2 | sort | uniq -c

# 查看慢请求（响应时间 > 1s）
awk '$NF > 1.0 {print $0}' /var/log/nginx/access.log
```

### 9.3 GoAccess 实时分析

```bash
# 安装
sudo apt install goaccess

# 实时分析
goaccess /var/log/nginx/access.log --log-format=COMBINED -o /var/www/html/report.html
```

## 10. 常见问题

### 10.1 502 Bad Gateway

```bash
# 检查后端服务是否运行
systemctl status your-app

# 检查端口是否监听
ss -tlnp | grep 8080

# 检查 Nginx 错误日志
tail -f /var/log/nginx/error.log
```

### 10.2 413 Request Entity Too Large

```nginx
# 增加客户端请求体大小限制
client_max_body_size 100m;
```

### 10.3 配置测试

```bash
# 测试配置语法
sudo nginx -t

# 查看完整配置
sudo nginx -T

# 重新加载配置
sudo systemctl reload nginx
```

## 参考资料

- Nginx 官方文档 — [nginx.org/en/docs](https://nginx.org/en/docs/)
- Nginx Beginner's Guide — [nginx.org/en/docs/beginners_guide.html](https://nginx.org/en/docs/beginners_guide.html)
- 鸟哥的私房菜 - WWW 服务器 — [linux.vbird.org](https://linux.vbird.org/linux_server/0360apache.php)
- Let's Encrypt — [letsencrypt.org](https://letsencrypt.org/)
- Mozilla SSL Configuration Generator — [ssl-config.mozilla.org](https://ssl-config.mozilla.org/)
