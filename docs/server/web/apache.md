# Apache

Apache HTTP Server 是最流行的 Web 服务器之一，以稳定性和丰富的模块著称。

> 内容参考自 Apache 官方文档、鸟哥的私房菜和实际运维经验，见文末参考资料。

## 学习目标

- 理解 Apache 架构和工作原理
- 掌握虚拟主机和 SSL 配置
- 学会性能调优和安全加固

## 1. Apache 架构

### 1.1 进程模型

```
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

| MPM | 说明 | 适用场景 |
|-----|------|---------|
| prefork | 多进程模型 | 兼容性好，内存占用高 |
| worker | 多进程多线程 | 性能好，内存占用低 |
| event | 事件驱动 | 高并发，长连接 |

## 2. 安装

### 2.1 Debian/Ubuntu

```bash
# 安装 Apache
sudo apt update
sudo apt install apache2

# 启动服务
sudo systemctl start apache2
sudo systemctl enable apache2

# 验证安装
apache2 -v
curl -I http://localhost
```

### 2.2 RHEL/CentOS/Fedora

```bash
# 安装 Apache
sudo dnf install httpd

# 启动服务
sudo systemctl start httpd
sudo systemctl enable httpd

# 验证安装
httpd -v
curl -I http://localhost
```

## 3. 配置文件

### 3.1 文件位置

| 文件 | 说明 |
|------|------|
| /etc/apache2/apache2.conf | 主配置文件（Debian/Ubuntu） |
| /etc/httpd/conf/httpd.conf | 主配置文件（RHEL/CentOS） |
| /etc/apache2/sites-available/ | 站点配置（Debian/Ubuntu） |
| /etc/apache2/sites-enabled/ | 已启用站点（符号链接） |
| /etc/apache2/conf-available/ | 全局配置 |
| /etc/apache2/mods-available/ | 模块配置 |

### 3.2 配置结构

```apache
# 全局配置
ServerRoot "/etc/apache2"
User www-data
Group www-data

# 模块加载
LoadModule mpm_event_module modules/mod_mpm_event.so
LoadModule rewrite_module modules/mod_rewrite.so

# 虚拟主机
<VirtualHost *:80>
    ServerName example.com
    DocumentRoot /var/www/html
</VirtualHost>
```

## 4. 虚拟主机

### 4.1 基于域名的虚拟主机

```apache
# /etc/apache2/sites-available/example.com.conf
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

```apache
# 监听多个端口
Listen 80
Listen 8080

<VirtualHost *:80>
    ServerName example.com
    DocumentRoot /var/www/html
</VirtualHost>

<VirtualHost *:8080>
    ServerName app.example.com
    DocumentRoot /var/www/app
</VirtualHost>
```

### 4.3 启用站点

```bash
# Debian/Ubuntu
sudo a2ensite example.com.conf
sudo systemctl reload apache2

# 禁用站点
sudo a2dissite example.com.conf
sudo systemctl reload apache2
```

## 5. SSL 配置

### 5.1 启用 SSL 模块

```bash
# 启用模块
sudo a2enmod ssl
sudo systemctl restart apache2
```

### 5.2 SSL 虚拟主机

```apache
# /etc/apache2/sites-available/example.com-ssl.conf
<VirtualHost *:443>
    ServerName example.com
    DocumentRoot /var/www/example.com
    
    SSLEngine on
    SSLCertificateFile /etc/ssl/certs/example.com.crt
    SSLCertificateKeyFile /etc/ssl/private/example.com.key
    SSLCertificateChainFile /etc/ssl/certs/example.com-chain.crt
    
    # SSL 优化
    SSLProtocol -all +TLSv1.2 +TLSv1.3
    SSLCipherSuite ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256
    SSLHonorCipherOrder off
    
    # HSTS
    Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
</VirtualHost>

# HTTP 重定向到 HTTPS
<VirtualHost *:80>
    ServerName example.com
    Redirect permanent / https://example.com/
</VirtualHost>
```

### 5.3 Let's Encrypt

```bash
# 安装 certbot
sudo apt install certbot python3-certbot-apache

# 获取证书
sudo certbot --apache -d example.com -d www.example.com

# 测试续期
sudo certbot renew --dry-run
```

## 6. 模块管理

### 6.1 常用模块

```bash
# 启用模块
sudo a2enmod rewrite
sudo a2enmod headers
sudo a2enmod expires
sudo a2enmod deflate

# 禁用模块
sudo a2dismod module_name

# 查看已加载模块
apache2ctl -M
```

### 6.2 模块配置

```apache
# 启用 URL 重写
<Directory /var/www/html>
    AllowOverride All
</Directory>

# 启用压缩
LoadModule deflate_module modules/mod_deflate.so
AddOutputFilterByType DEFLATE text/html text/plain text/xml text/css text/javascript

# 启用缓存
LoadModule expires_module modules/mod_expires.so
ExpiresActive On
ExpiresByType image/jpeg "access plus 1 year"
ExpiresByType text/css "access plus 1 month"
```

## 7. 性能调优

### 7.1 MPM 配置

```apache
# /etc/apache2/mods-available/mpm_event.conf
<IfModule mpm_event_module>
    StartServers 3
    MinSpareThreads 75
    MaxSpareThreads 250
    ThreadLimit 64
    ThreadsPerChild 25
    MaxRequestWorkers 400
    MaxConnectionsPerChild 10000
</IfModule>
```

### 7.2 缓冲区配置

```apache
# 增加缓冲区
LimitRequestLine 8190
LimitRequestFields 100
LimitRequestFieldSize 8190
```

### 7.3 连接配置

```apache
# KeepAlive 配置
KeepAlive On
MaxKeepAliveRequests 100
KeepAliveTimeout 5
```

## 8. 安全加固

### 8.1 安全 Headers

```apache
# 添加安全 Headers
Header always set X-Frame-Options "SAMEORIGIN"
Header always set X-Content-Type-Options "nosniff"
Header always set X-XSS-Protection "1; mode=block"
Header always set Referrer-Policy "strict-origin-when-cross-origin"
```

### 8.2 隐藏版本信息

```apache
# 隐藏版本信息
ServerTokens Prod
ServerSignature Off
```

### 8.3 访问控制

```apache
# 限制访问
<Directory /var/www/admin>
    Require ip 192.168.1.0/24
    Require ip 10.0.0.0/8
</Directory>

# 禁止访问隐藏文件
<DirectoryMatch "/\.">
    Require all denied
</DirectoryMatch>
```

## 9. 日志分析

### 9.1 日志格式

```apache
# 自定义日志格式
LogFormat "%h %l %u %t \"%r\" %>s %b \"%{Referer}i\" \"%{User-Agent}i\"" combined
LogFormat "%h %l %u %t \"%r\" %>s %b" common
```

### 9.2 常用分析命令

```bash
# 查看访问量前 10 的 IP
awk '{print $1}' /var/log/apache2/access.log | sort | uniq -c | sort -rn | head -10

# 查看访问量前 10 的页面
awk '{print $7}' /var/log/apache2/access.log | sort | uniq -c | sort -rn | head -10

# 查看 HTTP 状态码分布
awk '{print $9}' /var/log/apache2/access.log | sort | uniq -c | sort -rn
```

## 10. 常见问题

### 10.1 403 Forbidden

```bash
# 检查文件权限
ls -la /var/www/html

# 检查目录配置
<Directory /var/www/html>
    Require all granted
</Directory>
```

### 10.2 500 Internal Server Error

```bash
# 检查错误日志
tail -f /var/log/apache2/error.log

# 检查 .htaccess 语法
apache2ctl configtest
```

### 10.3 配置测试

```bash
# 测试配置语法
sudo apache2ctl configtest

# 查看完整配置
sudo apache2ctl -S

# 重新加载配置
sudo systemctl reload apache2
```

## 参考资料

- Apache 官方文档 — [httpd.apache.org/docs](https://httpd.apache.org/docs/)
- 鸟哥的私房菜 - WWW 服务器 — [linux.vbird.org](https://linux.vbird.org/linux_server/0360apache.php)
- Let's Encrypt — [letsencrypt.org](https://letsencrypt.org/)