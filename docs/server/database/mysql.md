# MySQL

MySQL 是全球最流行的开源关系型数据库，广泛应用于 Web 应用。

> 内容参考自 MySQL 官方文档、鸟哥的私房菜和实际运维经验，见文末参考资料。

## 学习目标

- 掌握 MySQL 安装和安全配置
- 学会数据库、用户、权限管理
- 了解备份恢复和主从复制
- 掌握性能优化和故障排查

## 1. 安装

### 1.1 Debian/Ubuntu

```bash
# 使用官方仓库安装最新版本
sudo apt update
sudo apt install mysql-server

# 启动并设置开机自启
sudo systemctl start mysql
sudo systemctl enable mysql

# 验证安装
mysql --version
```

### 1.2 RHEL/CentOS/Fedora

```bash
# Fedora
sudo dnf install mysql-server

# CentOS/RHEL - 使用 MySQL 官方仓库
sudo dnf install https://dev.mysql.com/get/mysql80-community-release-el9-5.noarch.rpm
sudo dnf install mysql-community-server

# 启动并设置开机自启
sudo systemctl start mysqld
sudo systemctl enable mysqld

# 获取临时密码（CentOS/RHEL）
sudo grep 'temporary password' /var/log/mysqld.log
```

## 2. 安全配置

```bash
sudo mysql_secure_installation
```

交互式配置：
1. **设置 root 密码**：设置强密码
2. **删除匿名用户**：是
3. **禁止 root 远程登录**：是
4. **删除测试数据库**：是
5. **重新加载权限表**：是

## 3. 用户管理

### 3.1 创建用户

```sql
-- 登录 MySQL
mysql -u root -p

-- 创建本地用户
CREATE USER 'myuser'@'localhost' IDENTIFIED BY 'StrongPassword123!';

-- 创建远程用户
CREATE USER 'myuser'@'%' IDENTIFIED BY 'StrongPassword123!';

-- 创建指定 IP 段的用户
CREATE USER 'myuser'@'192.168.1.%' IDENTIFIED BY 'StrongPassword123!';
```

### 3.2 权限管理

```sql
-- 授予所有权限（指定数据库）
GRANT ALL PRIVILEGES ON mydb.* TO 'myuser'@'localhost';

-- 授予只读权限
GRANT SELECT ON mydb.* TO 'readonly'@'%';

-- 授予特定表的权限
GRANT SELECT, INSERT, UPDATE ON mydb.users TO 'myuser'@'localhost';

-- 刷新权限
FLUSH PRIVILEGES;

-- 查看用户权限
SHOW GRANTS FOR 'myuser'@'localhost';

-- 撤销权限
REVOKE ALL PRIVILEGES ON mydb.* FROM 'myuser'@'localhost';

-- 删除用户
DROP USER 'myuser'@'localhost';
```

### 3.3 修改密码

```sql
-- 修改当前用户密码
ALTER USER 'myuser'@'localhost' IDENTIFIED BY 'NewPassword123!';

-- root 修改其他用户密码
ALTER USER 'myuser'@'localhost' IDENTIFIED BY 'NewPassword123!';
```

## 4. 数据库操作

### 4.1 数据库管理

```sql
-- 查看所有数据库
SHOW DATABASES;

-- 创建数据库
CREATE DATABASE mydb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 使用数据库
USE mydb;

-- 查看当前数据库
SELECT DATABASE();

-- 删除数据库
DROP DATABASE IF EXISTS mydb;
```

### 4.2 表管理

```sql
-- 创建表
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 查看表结构
DESCRIBE users;
SHOW CREATE TABLE users;

-- 修改表
ALTER TABLE users ADD COLUMN phone VARCHAR(20);
ALTER TABLE users MODIFY COLUMN email VARCHAR(200);
ALTER TABLE users DROP COLUMN phone;

-- 删除表
DROP TABLE IF EXISTS users;
```

### 4.3 数据操作

```sql
-- 插入数据
INSERT INTO users (username, email, password) VALUES
('admin', 'admin@example.com', 'hashed_password'),
('user1', 'user1@example.com', 'hashed_password');

-- 查询数据
SELECT * FROM users;
SELECT username, email FROM users WHERE id = 1;
SELECT * FROM users ORDER BY created_at DESC LIMIT 10;

-- 更新数据
UPDATE users SET email = 'new@example.com' WHERE id = 1;

-- 删除数据
DELETE FROM users WHERE id = 1;
```

## 5. 备份与恢复

### 5.1 使用 mysqldump

```bash
# 备份单个数据库
mysqldump -u root -p mydb > mydb_backup.sql

# 备份多个数据库
mysqldump -u root -p --databases db1 db2 > multi_backup.sql

# 备份所有数据库
mysqldump -u root -p --all-databases > all_backup.sql

# 只备份表结构
mysqldump -u root -p --no-data mydb > schema.sql

# 只备份数据
mysqldump -u root -p --no-create-info mydb > data.sql

# 压缩备份
mysqldump -u root -p mydb | gzip > mydb_backup.sql.gz
```

### 5.2 恢复数据

```bash
# 恢复数据库
mysql -u root -p mydb < mydb_backup.sql

# 恢复压缩备份
gunzip < mydb_backup.sql.gz | mysql -u root -p mydb

# 恢复所有数据库
mysql -u root -p < all_backup.sql
```

### 5.3 自动备份脚本

```bash
#!/bin/bash
# /usr/local/bin/mysql_backup.sh

BACKUP_DIR="/var/backups/mysql"
DATE=$(date +%Y%m%d_%H%M%S)
KEEP_DAYS=7

# 创建备份目录
mkdir -p $BACKUP_DIR

# 备份所有数据库
mysqldump -u root -p'password' --all-databases | gzip > $BACKUP_DIR/all_$DATE.sql.gz

# 删除过期备份
find $BACKUP_DIR -name "*.sql.gz" -mtime +$KEEP_DAYS -delete

echo "Backup completed: $BACKUP_DIR/all_$DATE.sql.gz"
```

```bash
# 添加执行权限
sudo chmod +x /usr/local/bin/mysql_backup.sh

# 添加定时任务
sudo crontab -e
# 每天凌晨 2 点备份
0 2 * * * /usr/local/bin/mysql_backup.sh >> /var/log/mysql_backup.log 2>&1
```

## 6. 主从复制

### 6.1 主服务器配置

```ini
# /etc/mysql/mysql.conf.d/mysqld.cnf（Debian/Ubuntu）
# /etc/my.cnf（RHEL/CentOS）

[mysqld]
server-id=1
log_bin=mysql-bin
binlog_do_db=mydb
binlog_format=ROW
```

```bash
# 重启 MySQL
sudo systemctl restart mysql

# 创建复制用户
mysql -u root -p
```

```sql
CREATE USER 'repl'@'%' IDENTIFIED BY 'ReplPassword123!';
GRANT REPLICATION SLAVE ON *.* TO 'repl'@'%';
FLUSH PRIVILEGES;

-- 查看主服务器状态
SHOW MASTER STATUS;
```

### 6.2 从服务器配置

```ini
[mysqld]
server-id=2
relay_log=mysql-relay-bin
log_bin=mysql-bin
read_only=1
```

```bash
sudo systemctl restart mysql
mysql -u root -p
```

```sql
-- MySQL 8.0.23+ 新语法（旧版 CHANGE MASTER TO 仍在 8.0 可用，8.4 起移除）
CHANGE REPLICATION SOURCE TO
    SOURCE_HOST='192.168.1.100',
    SOURCE_USER='repl',
    SOURCE_PASSWORD='ReplPassword123!',
    SOURCE_LOG_FILE='mysql-bin.000001',
    SOURCE_LOG_POS=154;

START REPLICA;
SHOW REPLICA STATUS\G
```

## 7. 性能优化

### 7.1 内存配置

```ini
# /etc/mysql/mysql.conf.d/mysqld.cnf

[mysqld]
# InnoDB 缓冲池（建议物理内存的 50-70%）
innodb_buffer_pool_size=2G

# InnoDB 日志文件大小
innodb_log_file_size=256M

# 最大连接数
max_connections=500

# 查询缓存（MySQL 8.0 已移除）
# query_cache_size=64M

# 排序缓冲区
sort_buffer_size=4M

# 连接缓冲区
join_buffer_size=4M
```

### 7.2 慢查询日志

```ini
[mysqld]
slow_query_log=1
slow_query_log_file=/var/log/mysql/slow.log
long_query_time=2
```

```bash
# 分析慢查询
mysqldumpslow -s t -t 10 /var/log/mysql/slow.log
```

## 8. 常见问题

### 8.1 忘记 root 密码

```bash
# 停止 MySQL
sudo systemctl stop mysql

# 跳过权限验证启动
sudo mysqld_safe --skip-grant-tables &

# 登录并修改密码
mysql -u root
```

```sql
FLUSH PRIVILEGES;
ALTER USER 'root'@'localhost' IDENTIFIED BY 'NewPassword123!';
```

```bash
# 重启 MySQL
sudo systemctl restart mysql
```

### 8.2 连接数过多

```sql
-- 查看当前连接
SHOW PROCESSLIST;

-- 杀死连接
KILL connection_id;

-- 查看最大连接数
SHOW VARIABLES LIKE 'max_connections';
```

## 参考资料

- MySQL 8.0 官方文档 — [dev.mysql.com/doc/refman/8.0](https://dev.mysql.com/doc/refman/8.0/en/)
- 鸟哥的私房菜 - MySQL — [linux.vbird.org](https://linux.vbird.org/linux_server/0420mysql.php)
- MySQL Performance Blog — [percona.com/blog](https://www.percona.com/blog/)
