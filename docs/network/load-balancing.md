# 负载均衡

负载均衡用于将流量分配到多个服务器，提高可用性和性能。

> 内容参考自 Nginx、HAProxy 官方文档和实际运维经验，见文末参考资料。

## 学习目标

- 理解负载均衡算法
- 掌握 Nginx 和 HAProxy 配置
- 了解健康检查和故障转移

## 1. 负载均衡基础

### 1.1 工作原理

```
客户端 → 负载均衡器 → 后端服务器1
                   → 后端服务器2
                   → 后端服务器3
```

### 1.2 负载均衡算法

| 算法 | 说明 | 适用场景 |
|------|------|---------|
| 轮询 | 依次分配请求 | 通用场景 |
| 加权轮询 | 按权重分配 | 服务器性能不同 |
| IP Hash | 同一 IP 分配到同一后端 | 需要会话保持 |
| 最少连接 | 分配到连接数最少的后端 | 长连接应用 |
| 响应时间 | 分配到响应最快的后端 | 性能优化 |

## 2. Nginx 负载均衡

### 2.1 基本配置

```nginx
# 定义后端服务器
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

### 2.2 健康检查

```nginx
upstream backend {
    server 192.168.1.101:8080 max_fails=3 fail_timeout=30s;
    server 192.168.1.102:8080 max_fails=3 fail_timeout=30s;
    server 192.168.1.103:8080 backup;
}
```

### 2.3 会话保持

```nginx
# 使用 IP Hash
upstream backend {
    ip_hash;
    server 192.168.1.101:8080;
    server 192.168.1.102:8080;
}

# 使用 cookie（sticky 指令是 Nginx Plus 商业版特性，开源版请使用 ip_hash）
upstream backend {
    ip_hash;
    server 192.168.1.101:8080;
    server 192.168.1.102:8080;
}
```

## 3. HAProxy

### 3.1 安装

```bash
# Debian/Ubuntu
sudo apt update
sudo apt install haproxy

# RHEL/CentOS
sudo dnf install haproxy
```

### 3.2 基本配置

```bash
# /etc/haproxy/haproxy.cfg
global
    daemon
    maxconn 256

defaults
    mode http
    timeout connect 5000ms
    timeout client 50000ms
    timeout server 50000ms

frontend http-in
    bind *:80
    default_backend servers

backend servers
    balance roundrobin
    server server1 192.168.1.101:8080 check
    server server2 192.168.1.102:8080 check
    server server3 192.168.1.103:8080 check
```

### 3.3 负载均衡算法

```bash
# 轮询
balance roundrobin

# 最少连接
balance leastconn

# 源地址哈希
balance source

# URI 哈希
balance uri
```

### 3.4 健康检查

```bash
backend servers
    balance roundrobin
    option httpchk GET /health
    server server1 192.168.1.101:8080 check inter 2000 rise 2 fall 3
    server server2 192.168.1.102:8080 check inter 2000 rise 2 fall 3
```

### 3.5 管理命令

```bash
# 启动服务
sudo systemctl start haproxy
sudo systemctl enable haproxy

# 查看状态
sudo systemctl status haproxy

# 重新加载配置
sudo systemctl reload haproxy

# 查看统计信息
# 访问 http://your-ip:8400/stats
```

## 4. LVS（Linux Virtual Server）

### 4.1 基本概念

```bash
# LVS 是内核级负载均衡
# 性能更高，配置更复杂

# 三种模式
# NAT 模式
# DR 模式（直接路由）
# TUN 模式（IP 隧道）
```

### 4.2 安装

```bash
# 安装 ipvsadm
sudo apt install ipvsadm
```

### 4.3 配置示例

```bash
# 添加虚拟服务器
sudo ipvsadm -A -t 192.168.1.100:80 -s rr

# 添加后端服务器
sudo ipvsadm -a -t 192.168.1.100:80 -r 192.168.1.101:8080 -m
sudo ipvsadm -a -t 192.168.1.100:80 -r 192.168.1.102:8080 -m

# 查看规则
sudo ipvsadm -L -n

# 保存规则
sudo ipvsadm-save > /etc/ipvsadm.rules
```

## 5. 实战案例

### 5.1 Web 应用负载均衡

```nginx
# Nginx 配置
upstream web_app {
    least_conn;
    server 192.168.1.101:8080 weight=3;
    server 192.168.1.102:8080 weight=2;
    server 192.168.1.103:8080 weight=1;
    
    # 健康检查
    server 192.168.1.101:8080 max_fails=3 fail_timeout=30s;
    server 192.168.1.102:8080 max_fails=3 fail_timeout=30s;
}

server {
    listen 80;
    server_name app.example.com;
    
    location / {
        proxy_pass http://web_app;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # 超时设置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

### 5.2 数据库负载均衡

```bash
# HAProxy 配置
frontend mysql-in
    bind *:3306
    mode tcp
    default_backend mysql-servers

backend mysql-servers
    mode tcp
    balance roundrobin
    option mysql-check user haproxy
    server mysql1 192.168.1.101:3306 check
    server mysql2 192.168.1.102:3306 check backup
```

### 5.3 高可用负载均衡

```bash
# Keepalived + HAProxy
# /etc/keepalived/keepalived.conf

vrrp_script chk_haproxy {
    script "killall -0 haproxy"
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
        192.168.1.100
    }
    
    track_script {
        chk_haproxy
    }
}
```

## 6. 监控和调优

### 6.1 监控指标

```bash
# 连接数
# 响应时间
# 错误率
# 后端健康状态
```

### 6.2 性能调优

```bash
# 调整连接数
# 调整超时时间
# 调整缓冲区大小
# 启用压缩
```

## 参考资料

- [Nginx 负载均衡文档](https://nginx.org/en/docs/http/load_balancing.html)
- [HAProxy 文档](https://www.haproxy.com/documentation/)
- [LVS 文档](http://www.linuxvirtualserver.org/)