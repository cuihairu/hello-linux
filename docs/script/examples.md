# 实战案例

本章提供实用的脚本案例，涵盖系统管理、自动化运维等场景。

> 内容参考自实际运维经验和开源项目，见文末参考资料。

## 学习目标

- 掌握系统监控脚本编写
- 学会自动备份和日志分析
- 了解批量操作和自动化部署

## 1. 系统监控

### 1.1 系统资源监控

```bash
#!/bin/bash
# 系统资源监控脚本

LOG_FILE="/var/log/system_monitor.log"

monitor() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    # CPU 使用率
    cpu=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}')
    
    # 内存使用率
    mem=$(free -m | awk 'NR==2{printf "%.2f%%", $3*100/$2}')
    
    # 磁盘使用率
    disk=$(df -h / | awk 'NR==2{print $5}')
    
    # 负载
    load=$(uptime | awk -F'load average:' '{print $2}')
    
    echo "[$timestamp] CPU: $cpu%, 内存: $mem, 磁盘: $disk, 负载: $load" | tee -a "$LOG_FILE"
}

# 每 5 分钟监控一次
while true; do
    monitor
    sleep 300
done
```

### 1.2 进程监控

```bash
#!/bin/bash
# 进程监控脚本

process_name="nginx"
log_file="/var/log/process_monitor.log"

check_process() {
    if pgrep -x "$process_name" > /dev/null; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] $process_name 正在运行" >> "$log_file"
    else
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] $process_name 未运行，正在重启..." >> "$log_file"
        systemctl restart "$process_name"
    fi
}

# 每分钟检查一次
while true; do
    check_process
    sleep 60
done
```

### 1.3 端口监控

```bash
#!/bin/bash
# 端口监控脚本

ports=(22 80 443 3306)
log_file="/var/log/port_monitor.log"

check_port() {
    local port=$1
    if ss -tlnp | grep -q ":$port"; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] 端口 $port 正常" >> "$log_file"
    else
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] 端口 $port 异常" >> "$log_file"
    fi
}

for port in "${ports[@]}"; do
    check_port "$port"
done
```

## 2. 自动备份

### 2.1 数据库备份

```bash
#!/bin/bash
# MySQL 自动备份脚本

BACKUP_DIR="/var/backups/mysql"
DATE=$(date +%Y%m%d_%H%M%S)
KEEP_DAYS=7

# 数据库配置
DB_USER="root"
DB_PASS="password"
DB_NAME="mydb"

# 创建备份目录
mkdir -p "$BACKUP_DIR"

# 备份数据库
mysqldump -u"$DB_USER" -p"$DB_PASS" "$DB_NAME" | gzip > "$BACKUP_DIR/${DB_NAME}_$DATE.sql.gz"

# 检查备份是否成功
if [ $? -eq 0 ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 备份成功: ${DB_NAME}_$DATE.sql.gz"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 备份失败" >&2
    exit 1
fi

# 删除过期备份
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$KEEP_DAYS -delete
```

### 2.2 文件备份

```bash
#!/bin/bash
# 文件备份脚本

SOURCE_DIR="/var/www"
BACKUP_DIR="/var/backups/files"
DATE=$(date +%Y%m%d_%H%M%S)
KEEP_DAYS=30

# 创建备份目录
mkdir -p "$BACKUP_DIR"

# 使用 rsync 增量备份
rsync -avz --delete "$SOURCE_DIR/" "$BACKUP_DIR/current/"

# 创建压缩包
tar -czf "$BACKUP_DIR/files_$DATE.tar.gz" -C "$BACKUP_DIR" current/

# 删除过期备份
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +$KEEP_DAYS -delete
```

### 2.3 远程备份

```bash
#!/bin/bash
# 远程备份脚本

SOURCE_DIR="/var/www"
REMOTE_USER="backup"
REMOTE_HOST="backup.example.com"
REMOTE_DIR="/backups"
DATE=$(date +%Y%m%d_%H%M%S)

# 使用 rsync 远程备份
rsync -avz -e ssh "$SOURCE_DIR/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/current/"

# 远程创建压缩包
ssh "$REMOTE_USER@$REMOTE_HOST" "cd $REMOTE_DIR && tar -czf files_$DATE.tar.gz current/"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 远程备份完成"
```

## 3. 日志分析

### 3.1 Nginx 日志分析

```bash
#!/bin/bash
# Nginx 日志分析脚本

LOG_FILE="/var/log/nginx/access.log"

echo "=== Nginx 日志分析 ==="
echo ""

# 总请求数
echo "总请求数: $(wc -l < "$LOG_FILE")"

# 独立 IP 数
echo "独立 IP 数: $(awk '{print $1}' "$LOG_FILE" | sort -u | wc -l)"

# 请求量前 10 的 IP
echo ""
echo "请求量前 10 的 IP:"
awk '{print $1}' "$LOG_FILE" | sort | uniq -c | sort -rn | head -10

# 请求量前 10 的页面
echo ""
echo "请求量前 10 的页面:"
awk '{print $7}' "$LOG_FILE" | sort | uniq -c | sort -rn | head -10

# HTTP 状态码分布
echo ""
echo "HTTP 状态码分布:"
awk '{print $9}' "$LOG_FILE" | sort | uniq -c | sort -rn

# 每小时请求量
echo ""
echo "每小时请求量:"
awk '{print $4}' "$LOG_FILE" | cut -d: -f2 | sort | uniq -c
```

### 3.2 系统日志分析

```bash
#!/bin/bash
# 系统日志分析脚本

LOG_FILE="/var/log/syslog"

echo "=== 系统日志分析 ==="
echo ""

# 错误日志数
echo "错误日志数: $(grep -c "error" "$LOG_FILE")"

# 警告日志数
echo "警告日志数: $(grep -c "warning" "$LOG_FILE")"

# 最近的错误
echo ""
echo "最近的错误:"
grep "error" "$LOG_FILE" | tail -5

# 最近的警告
echo ""
echo "最近的警告:"
grep "warning" "$LOG_FILE" | tail -5
```

## 4. 批量操作

### 4.1 批量创建用户

```bash
#!/bin/bash
# 批量创建用户脚本

USER_FILE="users.txt"

while IFS=, read -r username password fullname; do
    # 跳过空行和注释
    [[ "$username" =~ ^#.*$ || -z "$username" ]] && continue
    
    # 创建用户
    if useradd -m -c "$fullname" -s /bin/bash "$username"; then
        echo "$username:$password" | chpasswd
        echo "用户 $username 创建成功"
    else
        echo "用户 $username 创建失败" >&2
    fi
done < "$USER_FILE"
```

### 4.2 批量执行命令

```bash
#!/bin/bash
# 批量执行命令脚本

HOSTS_FILE="hosts.txt"
COMMAND="$1"

while IFS= read -r host; do
    # 跳过空行和注释
    [[ "$host" =~ ^#.*$ || -z "$host" ]] && continue
    
    echo "=== $host ==="
    ssh "$host" "$COMMAND"
    echo ""
done < "$HOSTS_FILE"
```

### 4.3 批量文件处理

```bash
#!/bin/bash
# 批量文件处理脚本

find /path -name "*.txt" -type f | while read -r file; do
    echo "处理文件: $file"
    
    # 备份原文件
    cp "$file" "$file.bak"
    
    # 处理文件
    sed -i 's/old/new/g' "$file"
    
    echo "处理完成: $file"
done
```

## 5. 自动化部署

### 5.1 应用部署脚本

```bash
#!/bin/bash
# 应用部署脚本

APP_NAME="myapp"
DEPLOY_DIR="/opt/$APP_NAME"
BACKUP_DIR="/var/backups/$APP_NAME"
DATE=$(date +%Y%m%d_%H%M%S)

# 创建备份
mkdir -p "$BACKUP_DIR"
tar -czf "$BACKUP_DIR/$APP_NAME_$DATE.tar.gz" -C "$DEPLOY_DIR" .

# 停止服务
systemctl stop "$APP_NAME"

# 更新代码
cd "$DEPLOY_DIR"
git pull origin main

# 安装依赖
npm install

# 构建应用
npm run build

# 启动服务
systemctl start "$APP_NAME"

echo "部署完成"
```

### 5.2 Docker 部署

```bash
#!/bin/bash
# Docker 部署脚本

APP_NAME="myapp"
IMAGE_NAME="$APP_NAME:latest"

# 构建镜像
docker build -t "$IMAGE_NAME" .

# 停止旧容器
docker stop "$APP_NAME" 2>/dev/null || true
docker rm "$APP_NAME" 2>/dev/null || true

# 启动新容器
docker run -d \
    --name "$APP_NAME" \
    -p 8080:8080 \
    -v /data/$APP_NAME:/app/data \
    --restart unless-stopped \
    "$IMAGE_NAME"

echo "Docker 部署完成"
```

## 6. 实用工具

### 6.1 系统清理脚本

```bash
#!/bin/bash
# 系统清理脚本

echo "=== 系统清理 ==="

# 清理 apt 缓存
apt clean
echo "apt 缓存已清理"

# 清理日志文件
find /var/log -name "*.log" -type f -mtime +30 -delete
echo "过期日志已清理"

# 清理临时文件
rm -rf /tmp/*
echo "临时文件已清理"

# 清理 Docker
docker system prune -f
echo "Docker 资源已清理"

echo "清理完成"
```

### 6.2 系统信息脚本

```bash
#!/bin/bash
# 系统信息脚本

echo "=== 系统信息 ==="
echo ""

# 主机名
echo "主机名: $(hostname)"

# 系统版本
echo "系统版本: $(cat /etc/os-release | grep PRETTY_NAME | cut -d'"' -f2)"

# 内核版本
echo "内核版本: $(uname -r)"

# CPU 信息
echo "CPU: $(lscpu | grep 'Model name' | cut -d: -f2 | xargs)"

# 内存信息
echo "内存: $(free -h | awk 'NR==2{print $2}')"

# 磁盘信息
echo "磁盘:"
df -h | grep -E "^/dev" | awk '{print "  " $6 ": " $2 " 总计, " $3 " 已用, " $4 " 可用"}'

# IP 地址
echo "IP 地址:"
ip -4 addr show | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | grep -v '127.0.0.1' | awk '{print "  " $1}'
```

## 参考资料

- [Bash 脚本示例](https://github.com/awesome-lists/awesome-bash)
- [Shell 脚本编程实战](https://www.oreilly.com/library/view/bash-cookbook/0596526784/)
- [Linux 系统管理脚本](https://github.com/topics/shell-script)