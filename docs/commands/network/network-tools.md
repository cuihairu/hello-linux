# 网络工具

网络工具用于网络诊断、数据传输和远程管理。

> 内容参考自 curl、wget、OpenSSH 手册和实际运维经验，见文末参考资料。

## 学习目标

- 掌握 curl、wget 等数据传输工具
- 学会使用 ssh、scp、rsync 等远程管理工具
- 了解网络诊断工具
- 掌握网络安全工具

## 1. curl 命令

### 1.1 基本用法

```bash
# curl 用于传输数据
curl http://example.com

# 下载文件
curl -O http://example.com/file.zip

# 保存到指定文件
curl -o output.html http://example.com

# 显示响应头
curl -I http://example.com

# 显示详细信息
curl -v http://example.com
```

### 1.2 HTTP 方法

```bash
# GET 请求（默认）
curl http://example.com

# POST 请求
curl -X POST -d "param1=value1&param2=value2" http://example.com/api

# PUT 请求
curl -X PUT -d "data" http://example.com/api/resource

# DELETE 请求
curl -X DELETE http://example.com/api/resource

# PATCH 请求
curl -X PATCH -d "data" http://example.com/api/resource
```

### 1.3 请求头和数据

```bash
# 设置请求头
curl -H "Content-Type: application/json" http://example.com

# 发送 JSON 数据
curl -X POST -H "Content-Type: application/json" -d '{"key":"value"}' http://example.com/api

# 发送文件
curl -X POST -F "file=@/path/to/file" http://example.com/upload

# 设置 User-Agent
curl -A "Mozilla/5.0" http://example.com
```

### 1.4 认证

```bash
# 基本认证
curl -u username:password http://example.com

# Bearer Token
curl -H "Authorization: Bearer token" http://example.com

# 客户端证书
curl --cert client.pem --key client.key https://example.com
```

### 1.5 代理

```bash
# 使用 HTTP 代理
curl -x http://proxy:8080 http://example.com

# 使用 SOCKS 代理
curl --socks5 proxy:1080 http://example.com

# 代理认证
curl -x http://proxy:8080 -U username:password http://example.com
```

### 1.6 常用选项

```bash
# 跟随重定向
curl -L http://example.com

# 设置超时
curl --connect-timeout 10 --max-time 30 http://example.com

# 限制下载速度
curl --limit-rate 100K http://example.com

# 断点续传
curl -C - -O http://example.com/largefile.zip

# 静默模式
curl -s http://example.com

# 显示进度条
curl -# http://example.com
```

## 2. wget 命令

### 2.1 基本用法

```bash
# wget 用于下载文件
wget http://example.com/file.zip

# 下载到指定目录
wget -P /path/to/dir http://example.com/file.zip

# 下载并重命名
wget -O newname.zip http://example.com/file.zip

# 后台下载
wget -b http://example.com/largefile.zip
```

### 2.2 递归下载

```bash
# 递归下载整个网站
wget -r http://example.com

# 限制递归深度
wget -r -l 2 http://example.com

# 下载特定类型文件
wget -r -A "*.html,*.css,*.js" http://example.com

# 排除特定文件
wget -r -R "*.gif,*.jpg" http://example.com

# 不访问父目录
wget -r -np http://example.com/dir/
```

### 2.3 常用选项

```bash
# 设置重试次数
wget --tries=3 http://example.com

# 设置超时
wget --timeout=30 http://example.com

# 限制下载速度
wget --limit-rate=100k http://example.com

# 断点续传
wget -c http://example.com/largefile.zip

# 静默模式
wget -q http://example.com

# 显示进度
wget --progress=dot http://example.com
```

### 2.4 镜像网站

```bash
# 镜像整个网站
wget --mirror --convert-links --adjust-extension --page-requisites --no-parent http://example.com

# 选项说明
# --mirror：递归下载，等同于 -r -N -l inf --no-remove-listing
# --convert-links：转换链接为本地链接
# --adjust-extension：添加适当的扩展名
# --page-requisites：下载页面所需的所有文件
# --no-parent：不访问父目录
```

## 3. ssh 命令

### 3.1 基本用法

```bash
# ssh 用于安全远程登录
ssh username@hostname

# 指定端口
ssh -p 2222 username@hostname

# 执行远程命令
ssh username@hostname "ls -la"

# 指定私钥
ssh -i ~/.ssh/id_rsa username@hostname
```

### 3.2 配置文件

```bash
# ~/.ssh/config
Host myserver
    HostName server.example.com
    User myuser
    Port 2222
    IdentityFile ~/.ssh/id_rsa

# 使用配置
ssh myserver
```

### 3.3 端口转发

```bash
# 本地端口转发
ssh -L 8080:localhost:80 username@hostname

# 远程端口转发
ssh -R 8080:localhost:80 username@hostname

# 动态端口转发（SOCKS 代理）
ssh -D 1080 username@hostname
```

### 3.4 SSH 密钥管理

```bash
# 生成密钥对
ssh-keygen -t ed25519 -C "your_email@example.com"

# 复制公钥到服务器
ssh-copy-id username@hostname

# 查看密钥指纹
ssh-keygen -lf ~/.ssh/id_ed25519.pub

# 启动 ssh-agent
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
```

### 3.5 安全配置

```bash
# /etc/ssh/sshd_config
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
ClientAliveInterval 300
ClientAliveCountMax 2
AllowUsers username

# 重启 SSH 服务
sudo systemctl restart sshd
```

## 4. scp 命令

### 4.1 基本用法

```bash
# scp 用于安全复制文件
scp file.txt username@hostname:/path/to/remote/

# 从远程复制到本地
scp username@hostname:/path/to/remote/file.txt /local/path/

# 复制目录
scp -r directory/ username@hostname:/path/to/remote/

# 指定端口
scp -P 2222 file.txt username@hostname:/path/to/remote/
```

### 4.2 常用选项

```bash
# 保留文件属性
scp -p file.txt username@hostname:/path/

# 显示进度
scp -v file.txt username@hostname:/path/

# 限制带宽
scp -l 1000 file.txt username@hostname:/path/

# 使用压缩
scp -C file.txt username@hostname:/path/
```

## 5. rsync 命令

### 5.1 基本用法

```bash
# rsync 用于文件同步
rsync -avz /local/path/ username@hostname:/remote/path/

# 从远程同步到本地
rsync -avz username@hostname:/remote/path/ /local/path/

# 本地同步
rsync -avz /source/path/ /destination/path/
```

### 5.2 常用选项

```bash
# 归档模式（保留所有属性）
rsync -a

# 详细输出
rsync -v

# 压缩传输
rsync -z

# 删除目标中多余的文件
rsync --delete

# 模拟运行（不实际执行）
rsync -n

# 显示进度
rsync --progress

# 限制带宽
rsync --bwlimit=1000
```

### 5.3 排除文件

```bash
# 排除特定文件
rsync -avz --exclude="*.log" /source/ /destination/

# 排除多个文件
rsync -avz --exclude={"*.log","*.tmp"} /source/ /destination/

# 从文件读取排除列表
rsync -avz --exclude-from=exclude.txt /source/ /destination/
```

### 5.4 实战案例

```bash
# 网站备份
rsync -avz --delete /var/www/ /backup/www/

# 数据库备份同步
rsync -avz /backup/mysql/ remote:/backup/mysql/

# 增量备份
rsync -avz --link-dest=/backup/latest /source/ /backup/$(date +%Y%m%d)/
```

## 6. 网络诊断工具

### 6.1 ping 命令

```bash
# ping 测试网络连通性
ping example.com

# 指定次数
ping -c 4 example.com

# 指定间隔
ping -i 2 example.com

# 指定包大小
ping -s 1024 example.com
```

### 6.2 traceroute 命令

```bash
# traceroute 跟踪数据包路径
traceroute example.com

# 使用 TCP
traceroute -T example.com

# 使用 UDP
traceroute -U example.com

# 指定端口
traceroute -p 80 example.com
```

### 6.3 mtr 命令

```bash
# mtr 结合 ping 和 traceroute
mtr example.com

# 报告模式
mtr -r example.com

# 指定次数
mtr -c 100 example.com
```

### 6.4 netstat 命令

```bash
# 查看网络连接
netstat -tulnp

# 查看路由表
netstat -r

# 查看网络统计
netstat -s

# 查看特定端口
netstat -tulnp | grep :80
```

### 6.5 ss 呑令

```bash
# ss 是 netstat 的替代品
ss -tulnp

# 查看 TCP 连接
ss -t state established

# 查看特定端口
ss -tulnp | grep :80

# 查看连接统计
ss -s
```

### 6.6 nmap 命令

```bash
# nmap 网络扫描
nmap example.com

# 扫描端口
nmap -p 80,443 example.com

# 扫描整个端口范围
nmap -p 1-65535 example.com

# 服务版本检测
nmap -sV example.com

# 操作系统检测
nmap -O example.com
```

## 7. 实战案例

### 7.1 网站监控脚本

```bash
#!/bin/bash
# 网站监控脚本

URL="http://example.com"
LOG_FILE="/var/log/website_monitor.log"

check_website() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    local status=$(curl -s -o /dev/null -w "%{http_code}" "$URL")
    local response_time=$(curl -s -o /dev/null -w "%{time_total}" "$URL")
    
    if [ "$status" -eq 200 ]; then
        echo "[$timestamp] $URL 正常 (状态码: $status, 响应时间: ${response_time}s)" >> "$LOG_FILE"
    else
        echo "[$timestamp] $URL 异常 (状态码: $status)" >> "$LOG_FILE"
        # 发送告警
        echo "网站异常: $URL (状态码: $status)" | mail -s "网站告警" admin@example.com
    fi
}

# 每 5 分钟检查一次
while true; do
    check_website
    sleep 300
done
```

### 7.2 批量服务器管理

```bash
#!/bin/bash
# 批量服务器管理脚本

SERVERS=("server1" "server2" "server3")
COMMAND="$1"

for server in "${SERVERS[@]}"; do
    echo "=== $server ==="
    ssh "$server" "$COMMAND"
    echo ""
done
```

### 7.3 自动备份脚本

```bash
#!/bin/bash
# 自动备份脚本

SOURCE_DIR="/var/www"
BACKUP_DIR="/backup"
REMOTE_SERVER="backup.example.com"
DATE=$(date +%Y%m%d_%H%M%S)

# 本地备份
rsync -avz --delete "$SOURCE_DIR/" "$BACKUP_DIR/current/"

# 远程备份
rsync -avz --delete "$SOURCE_DIR/" "$REMOTE_SERVER:/backup/www/"

# 创建压缩包
tar -czf "$BACKUP_DIR/www_$DATE.tar.gz" -C "$BACKUP_DIR" current/

# 删除过期备份
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +30 -delete
```

## 参考资料

- `man curl`, `man wget`, `man ssh`, `man scp`, `man rsync`
- [curl 手册](https://curl.se/docs/manpage.html)
- [wget 手册](https://www.gnu.org/software/wget/manual/)
- [OpenSSH 手册](https://www.openssh.com/manual.html)
- [rsync 手册](https://download.samba.org/pub/rsync/rsync.html)