# 自动化运维

自动化运维通过脚本和工具减少手动操作，提高效率和一致性。

> 内容参考自 cron、systemd、Ansible 文档和自动化实践，见文末参考资料。

## 学习目标

- 掌握 cron 和 systemd timer 定时任务
- 学会使用 Ansible 进行配置管理
- 了解自动化部署和持续集成
- 掌握监控和告警自动化

## 1. 定时任务

### 1.1 cron

```bash
# cron 是 Linux 系统的定时任务调度器
# 编辑 crontab
crontab -e

# 查看 crontab
crontab -l

# crontab 格式
# 分 时 日 月 周 命令
# *  *  *  *  *  command

# 示例
# 每天凌晨 2 点执行备份
0 2 * * * /usr/local/bin/backup.sh

# 每 5 分钟检查一次服务
*/5 * * * * /usr/local/bin/check-service.sh

# 每周一上午 9 点发送报告
0 9 * * 1 /usr/local/bin/send-report.sh

# 每月 1 日清理日志
0 0 1 * * /usr/local/bin/clean-logs.sh
```

### 1.2 systemd timer

```bash
# systemd timer 是 cron 的现代替代品
# 创建 service 文件
# /etc/systemd/system/my-task.service
[Unit]
Description=My Task

[Service]
Type=oneshot
ExecStart=/usr/local/bin/my-task.sh

# 创建 timer 文件
# /etc/systemd/system/my-task.timer
[Unit]
Description=My Task Timer

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target

# 启用和启动
sudo systemctl enable my-task.timer
sudo systemctl start my-task.timer

# 查看定时器状态
sudo systemctl list-timers
```

### 1.3 at

```bash
# at 用于一次性定时任务
# 安装
sudo apt install at

# 创建任务
at 2:00 AM
at> /usr/local/bin/backup.sh
at> Ctrl+D

# 查看待执行任务
atq

# 删除任务
atrm 任务号
```

## 2. Ansible

### 2.1 安装和配置

```bash
# 安装 Ansible
sudo apt install ansible

# 配置主机清单
# /etc/ansible/hosts
[webservers]
web1 ansible_host=192.168.1.100
web2 ansible_host=192.168.1.101

[dbservers]
db1 ansible_host=192.168.1.200

# 测试连接
ansible all -m ping
```

### 2.2 Ad-hoc 命令

```bash
# 执行单次命令
ansible all -m shell -a "uptime"

# 安装软件
ansible webservers -m apt -a "name=nginx state=present"

# 复制文件
ansible all -m copy -a "src=/local/file dest=/remote/file"

# 管理服务
ansible all -m service -a "name=nginx state=started"
```

### 2.3 Playbook

```yaml
# playbook.yml
---
- hosts: webservers
  become: yes
  tasks:
    - name: Install Nginx
      apt:
        name: nginx
        state: present
    
    - name: Start Nginx
      service:
        name: nginx
        state: started
        enabled: yes
    
    - name: Copy configuration
      copy:
        src: nginx.conf
        dest: /etc/nginx/nginx.conf
      notify: Restart Nginx
  
  handlers:
    - name: Restart Nginx
      service:
        name: nginx
        state: restarted
```

### 2.4 角色（Role）

```bash
# 角色目录结构
roles/
  nginx/
    tasks/
      main.yml
    handlers/
      main.yml
    templates/
      nginx.conf.j2
    files/
      index.html
    vars/
      main.yml
    defaults/
      main.yml

# 使用角色
---
- hosts: webservers
  roles:
    - nginx
    - php
```

## 3. 自动化部署

### 3.1 使用 Git 钩子

```bash
# 服务器端 post-receive 钩子
#!/bin/bash
# /var/repo/myapp.git/hooks/post-receive

GIT_WORK_TREE=/var/www/myapp git checkout -f

# 重启服务
sudo systemctl restart myapp
```

### 3.2 使用 Capistrano

```bash
# Capistrano 是 Ruby 编写的部署工具
# 安装
gem install capistrano

# 初始化
cap install

# 部署
cap production deploy
```

### 3.3 使用 Jenkins

```bash
# Jenkins 是持续集成工具
# Debian/Ubuntu：需先添加官方 apt 仓库
sudo wget -O /usr/share/keyrings/jenkins-keyring.asc https://pkg.jenkins.io/debian/jenkins.io-2023.key
echo "deb [signed-by=/usr/share/keyrings/jenkins-keyring.asc] https://pkg.jenkins.io/debian binary/" | sudo tee /etc/apt/sources.list.d/jenkins.list > /dev/null
sudo apt update
sudo apt install jenkins

# RHEL/CentOS：使用官方 yum 仓库
sudo wget -O /etc/yum.repos.d/jenkins.repo https://pkg.jenkins.io/redhat-stable/jenkins.repo
sudo rpm --import https://pkg.jenkins.io/redhat-stable/jenkins.io-2023.key
sudo dnf install jenkins

# 配置任务
# 1. 创建新任务
# 2. 配置源代码管理
# 3. 配置构建触发器
# 4. 配置构建步骤
# 5. 配置构建后操作
```

## 4. 监控自动化

### 4.1 监控脚本

```bash
#!/bin/bash
# 系统监控脚本

LOG_FILE="/var/log/system-monitor.log"

# 检查 CPU 使用率
cpu_usage=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}')
if (( $(echo "$cpu_usage > 80" | bc -l) )); then
    echo "[$(date)] CPU 使用率过高: $cpu_usage%" >> "$LOG_FILE"
fi

# 检查内存使用率
mem_usage=$(free -m | awk 'NR==2{printf "%.2f", $3*100/$2}')
if (( $(echo "$mem_usage > 80" | bc -l) )); then
    echo "[$(date)] 内存使用率过高: $mem_usage%" >> "$LOG_FILE"
fi

# 检查磁盘使用率
disk_usage=$(df -h / | awk 'NR==2{print $5}' | tr -d '%')
if [ $disk_usage -gt 80 ]; then
    echo "[$(date)] 磁盘使用率过高: $disk_usage%" >> "$LOG_FILE"
fi
```

### 4.2 告警通知

```bash
#!/bin/bash
# 告警通知脚本

send_alert() {
    local message=$1
    local email="admin@example.com"
    
    # 发送邮件
    echo "$message" | mail -s "系统告警" "$email"
    
    # 发送 Slack 通知
    curl -X POST -H 'Content-type: application/json' \
        --data "{\"text\":\"$message\"}" \
        https://hooks.slack.com/services/xxx/yyy/zzz
}

# 使用
send_alert "CPU 使用率超过 80%"
```

## 5. 配置管理自动化

### 5.1 使用 etckeeper

```bash
# etckeeper 使用 Git 管理 /etc 目录
# 安装
sudo apt install etckeeper

# 初始化
sudo etckeeper init

# 提交更改
sudo etckeeper commit "Initial commit"

# 查看历史
sudo etckeeper vcs log
```

### 5.2 使用 Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  web:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./html:/usr/share/nginx/html
    restart: unless-stopped

  db:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: rootpass
    volumes:
      - db_data:/var/lib/mysql
    restart: unless-stopped

volumes:
  db_data:
```

## 6. 实战案例

### 6.1 自动化部署脚本

```bash
#!/bin/bash
# 自动化部署脚本

APP_NAME="myapp"
DEPLOY_DIR="/opt/$APP_NAME"
BACKUP_DIR="/var/backups/$APP_NAME"
DATE=$(date +%Y%m%d_%H%M%S)

# 备份当前版本
mkdir -p "$BACKUP_DIR"
tar -czf "$BACKUP_DIR/$APP_NAME_$DATE.tar.gz" -C "$DEPLOY_DIR" .

# 拉取最新代码
cd "$DEPLOY_DIR"
git pull origin main

# 安装依赖
npm install

# 构建应用
npm run build

# 重启服务
sudo systemctl restart "$APP_NAME"

echo "部署完成"
```

### 6.2 自动化监控告警

```bash
#!/bin/bash
# 自动化监控告警脚本

THRESHOLD_CPU=80
THRESHOLD_MEM=80
THRESHOLD_DISK=90

check_and_alert() {
    # 检查 CPU
    cpu=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}')
    if (( $(echo "$cpu > $THRESHOLD_CPU" | bc -l) )); then
        send_alert "CPU 使用率过高: $cpu%"
    fi
    
    # 检查内存
    mem=$(free -m | awk 'NR==2{printf "%.2f", $3*100/$2}')
    if (( $(echo "$mem > $THRESHOLD_MEM" | bc -l) )); then
        send_alert "内存使用率过高: $mem%"
    fi
    
    # 检查磁盘
    disk=$(df -h / | awk 'NR==2{print $5}' | tr -d '%')
    if [ $disk -gt $THRESHOLD_DISK ]; then
        send_alert "磁盘使用率过高: $disk%"
    fi
}

# 每 5 分钟检查一次
while true; do
    check_and_alert
    sleep 300
done
```

## 参考资料

- `man cron`, `man crontab`, `man systemd.timer`
- [Ansible 文档](https://docs.ansible.com/)
- [Jenkins 文档](https://www.jenkins.io/doc/)
- [自动化运维最佳实践](https://www.redhat.com/en/topics/automation)