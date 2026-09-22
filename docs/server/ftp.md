# FTP 服务器

FTP（文件传输协议）用于在网络上传输文件。

> 内容参考自 vsftpd、ProFTPD 官方文档和实际运维经验，见文末参考资料。

## 学习目标

- 理解 FTP 工作原理和模式
- 掌握 vsftpd 安装和配置
- 学会用户管理和权限控制
- 了解 FTP 安全和性能优化

## 1. FTP 基础

### 1.1 工作模式

```bash
# 主动模式（Active）
# 客户端连接服务器 21 端口
# 服务器连接客户端随机端口

# 被动模式（Passive）
# 客户端连接服务器 21 端口
# 客户端连接服务器随机端口

# 被动模式更适合防火墙环境
```

### 1.2 FTP 命令

```bash
# 常用命令
USER username   # 用户名
PASS password   # 密码
LIST            # 列出文件
RETR filename   # 下载文件
STOR filename   # 上传文件
DELE filename   # 删除文件
MKD dirname     # 创建目录
RMD dirname     # 删除目录
CWD dirname     # 切换目录
PWD             # 显示当前目录
```

## 2. vsftpd 安装

### 2.1 Debian/Ubuntu

```bash
# 安装 vsftpd
sudo apt update
sudo apt install vsftpd

# 启动服务
sudo systemctl start vsftpd
sudo systemctl enable vsftpd

# 备份配置文件
sudo cp /etc/vsftpd.conf /etc/vsftpd.conf.backup
```

### 2.2 RHEL/CentOS/Fedora

```bash
# 安装 vsftpd
sudo dnf install vsftpd

# 启动服务
sudo systemctl start vsftpd
sudo systemctl enable vsftpd

# 备份配置文件
sudo cp /etc/vsftpd/vsftpd.conf /etc/vsftpd/vsftpd.conf.backup
```

## 3. 配置

### 3.1 基本配置

```bash
# /etc/vsftpd.conf 或 /etc/vsftpd/vsftpd.conf

# 基本设置
listen=YES                    # 独立模式
listen_ipv6=NO               # 禁用 IPv6
anonymous_enable=NO          # 禁用匿名访问
local_enable=YES             # 允许本地用户
write_enable=YES             # 允许写入
local_umask=022              # 文件权限掩码
dirmessage_enable=YES        # 显示目录消息
use_localtime=YES            # 使用本地时间
xferlog_enable=YES           # 启用传输日志
connect_from_port_20=YES     # 使用端口 20
```

### 3.2 用户配置

```bash
# 限制用户访问目录
chroot_local_user=YES        # 限制用户在家目录
chroot_list_enable=YES       # 启用用户列表
chroot_list_file=/etc/vsftpd.chroot_list  # 用户列表文件

# 用户列表文件
# /etc/vsftpd.chroot_list
# 每行一个用户名
```

### 3.3 被动模式配置

```bash
# 被动模式设置
pasv_enable=YES              # 启用被动模式
pasv_min_port=10000          # 最小端口
pasv_max_port=10100          # 最大端口
pasv_address=your_server_ip  # 服务器 IP
```

### 3.4 安全配置

```bash
# 安全设置
ssl_enable=YES               # 启用 SSL
allow_anon_ssl=NO            # 禁止匿名 SSL
force_local_data_ssl=YES     # 强制数据连接 SSL
force_local_logins_ssl=YES   # 强制登录 SSL
ssl_tlsv1=YES                # 启用 TLSv1
ssl_sslv2=NO                 # 禁用 SSLv2
ssl_sslv3=NO                 # 禁用 SSLv3
rsa_cert_file=/etc/ssl/certs/vsftpd.pem
rsa_private_key_file=/etc/ssl/private/vsftpd.key
```

## 4. 用户管理

### 4.1 虚拟用户

```bash
# 创建虚拟用户数据库
# 安装工具
sudo apt install db-util

# 创建用户文件
# /etc/vsftpd/virtual_users.txt
user1
password1
user2
password2

# 生成数据库文件
sudo db_load -T -t hash -f /etc/vsftpd/virtual_users.txt /etc/vsftpd/virtual_users.db

# 配置 PAM
# /etc/pam.d/vsftpd_virtual
auth required pam_userdb.so db=/etc/vsftpd/virtual_users
account required pam_userdb.so db=/etc/vsftpd/virtual_users

# 修改 vsftpd 配置
guest_enable=YES
guest_username=ftp
pam_service_name=vsftpd_virtual
```

### 4.2 用户权限

```bash
# 设置用户权限
local_root=/var/www/$USER
user_sub_token=$USER

# 创建用户目录
sudo mkdir -p /var/www/user1
sudo chown ftp:ftp /var/www/user1
```

## 5. 防火墙配置

### 5.1 iptables

```bash
# 允许 FTP 控制端口
sudo iptables -A INPUT -p tcp --dport 21 -j ACCEPT

# 允许被动模式端口范围
sudo iptables -A INPUT -p tcp --dport 10000:10100 -j ACCEPT

# 允许 FTP 数据端口
sudo iptables -A INPUT -p tcp --dport 20 -j ACCEPT
```

### 5.2 firewalld

```bash
# 添加 FTP 服务
sudo firewall-cmd --permanent --add-service=ftp

# 添加被动模式端口范围
sudo firewall-cmd --permanent --add-port=10000-10100/tcp

# 重新加载规则
sudo firewall-cmd --reload
```

## 6. 性能优化

### 6.1 连接限制

```bash
# 限制连接数
max_clients=100
max_per_ip=5

# 限制传输速率
local_max_rate=1000000  # 1MB/s
```

### 6.2 日志配置

```bash
# 日志文件
xferlog_file=/var/log/vsftpd.log

# 日志格式
log_ftp_protocol=YES
```

## 7. 实战案例

### 7.1 Web 托管 FTP

```bash
# 配置 Web 托管 FTP
# 创建用户
sudo useradd -m -s /bin/bash webuser
sudo passwd webuser

# 设置目录权限
sudo chown -R webuser:www-data /var/www/html
sudo chmod -R 755 /var/www/html

# 配置 vsftpd
local_enable=YES
write_enable=YES
chroot_local_user=YES
local_root=/var/www/html
```

### 7.2 匿名 FTP

```bash
# 配置匿名 FTP（只读）
anonymous_enable=YES
anon_root=/var/ftp
no_anon_password=YES
anon_max_rate=500000
```

## 8. 故障排查

### 8.1 常见问题

```bash
# 连接被拒绝
# 检查服务状态
sudo systemctl status vsftpd

# 检查防火墙
sudo iptables -L -n

# 检查配置文件
sudo vsftpd -v

# 权限问题
# 检查目录权限
ls -la /var/www/

# 检查用户权限
id username
```

### 8.2 日志分析

```bash
# 查看日志
sudo tail -f /var/log/vsftpd.log

# 分析连接
sudo grep "CONNECT" /var/log/vsftpd.log

# 分析错误
sudo grep "ERROR" /var/log/vsftpd.log
```

## 参考资料

- vsftpd 官方文档 — [security.appspot.com/vsftpd](https://security.appspot.com/vsftpd/)
- [vsftpd 配置指南](https://wiki.archlinux.org/title/Very_Secure_FTP_Daemon)
- [FTP 协议详解](https://tools.ietf.org/html/rfc959)