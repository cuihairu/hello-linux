# 备份与恢复

备份是系统管理中最重要的任务之一，确保数据安全和业务连续性。

> 内容参考自 rsync、tar 手册和备份最佳实践，见文末参考资料。

## 学习目标

- 理解备份策略和类型
- 掌握常用备份工具（rsync、tar、dump）
- 学会制定备份计划和恢复测试
- 了解异地备份和云备份方案

## 1. 备份策略

### 1.1 备份类型

| 类型 | 说明 | 优点 | 缺点 |
|------|------|------|------|
| 完整备份 | 备份所有数据 | 恢复简单快速 | 耗时长，存储空间大 |
| 增量备份 | 只备份自上次备份后变化的数据 | 节省空间和时间 | 恢复需要所有增量备份 |
| 差异备份 | 备份自上次完整备份后变化的数据 | 恢复只需完整备份+差异备份 | 备份时间随时间增长 |

### 1.2 备份策略示例

```bash
# 策略1：每日完整备份
# 适合数据量小，变化不频繁的场景

# 策略2：每周完整备份 + 每日增量备份
# 适合大多数场景

# 策略3：每月完整备份 + 每周差异备份 + 每日增量备份
# 适合数据量大，变化频繁的场景
```

### 1.3 3-2-1 备份原则

```bash
# 3 份数据副本
# 2 种不同存储介质
# 1 份异地备份

# 示例：
# 1. 本地硬盘（生产数据）
# 2. 外部硬盘（本地备份）
# 3. 云存储（异地备份）
```

## 2. 备份工具

### 2.1 rsync

```bash
# rsync 是强大的文件同步工具，支持增量备份
# 基本语法
rsync [选项] 源目录 目标目录

# 本地备份
rsync -avz /source/ /backup/

# 远程备份
rsync -avz /source/ user@remote:/backup/

# 常用选项
# -a：归档模式（保留所有属性）
# -v：详细输出
# -z：压缩传输
# -n：模拟运行（不实际执行）
# --delete：删除目标中多余的文件
# --exclude：排除文件
# --progress：显示进度

# 示例：备份网站目录
rsync -avz --delete --exclude="*.log" /var/www/ /backup/www/
```

### 2.2 tar

```bash
# tar 是归档工具，常用于创建备份包
# 创建归档
tar -cvf backup.tar /path/to/directory

# 创建压缩归档
tar -czvf backup.tar.gz /path/to/directory

# 创建压缩归档（使用 bzip2）
tar -cjvf backup.tar.bz2 /path/to/directory

# 解压归档
tar -xvf backup.tar

# 解压压缩归档
tar -xzvf backup.tar.gz

# 查看归档内容
tar -tvf backup.tar

# 增量备份（使用 snar 文件）
tar -czvf backup-full.tar.gz --listed-incremental=/backup/snapshot.snar /data
tar -czvf backup-incr.tar.gz --listed-incremental=/backup/snapshot.snar /data
```

### 2.3 dump/restore

```bash
# dump 是专门用于文件系统备份的工具
# 安装
sudo apt install dump

# 完整备份
dump -0uf /backup/home.dump /home

# 增量备份
dump -1uf /backup/home.dump.1 /home

# 恢复
restore -rf /backup/home.dump
```

### 2.4 dd

```bash
# dd 是低级别的磁盘复制工具
# 备份整个磁盘
dd if=/dev/sda of=/backup/sda.img bs=4M

# 恢复磁盘
dd if=/backup/sda.img of=/dev/sda bs=4M

# 备份分区
dd if=/dev/sda1 of=/backup/sda1.img bs=4M

# 压缩备份
dd if=/dev/sda bs=4M | gzip > /backup/sda.img.gz
```

## 3. 备份方案

### 3.1 网站备份

```bash
#!/bin/bash
# 网站备份脚本

BACKUP_DIR="/backup/websites"
DATE=$(date +%Y%m%d_%H%M%S)
KEEP_DAYS=30

# 创建备份目录
mkdir -p "$BACKUP_DIR"

# 备份网站文件
rsync -avz --delete /var/www/ "$BACKUP_DIR/files_$DATE/"

# 备份数据库
mysqldump -u root -p'password' --all-databases | gzip > "$BACKUP_DIR/db_$DATE.sql.gz"

# 删除过期备份
find "$BACKUP_DIR" -name "files_*" -mtime +$KEEP_DAYS -exec rm -rf {} \;
find "$BACKUP_DIR" -name "db_*.sql.gz" -mtime +$KEEP_DAYS -delete

echo "备份完成: $BACKUP_DIR"
```

### 3.2 数据库备份

```bash
#!/bin/bash
# MySQL 备份脚本

BACKUP_DIR="/backup/mysql"
DATE=$(date +%Y%m%d_%H%M%S)
KEEP_DAYS=7

mkdir -p "$BACKUP_DIR"

# 备份所有数据库
mysqldump -u root -p'password' --all-databases | gzip > "$BACKUP_DIR/all_$DATE.sql.gz"

# 备份单个数据库
mysqldump -u root -p'password' mydb | gzip > "$BACKUP_DIR/mydb_$DATE.sql.gz"

# 删除过期备份
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$KEEP_DAYS -delete
```

### 3.3 系统备份

```bash
#!/bin/bash
# 系统备份脚本

BACKUP_DIR="/backup/system"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

# 备份重要目录
tar -czvf "$BACKUP_DIR/etc_$DATE.tar.gz" /etc
tar -czvf "$BACKUP_DIR/home_$DATE.tar.gz" /home
tar -czvf "$BACKUP_DIR/var_$DATE.tar.gz" /var/log

# 备份已安装软件包列表
dpkg --get-selections > "$BACKUP_DIR/packages_$DATE.list"
rpm -qa > "$BACKUP_DIR/packages_$DATE.rpm.list"

# 备份分区表
fdisk -l > "$BACKUP_DIR/partitions_$DATE.txt"
```

## 4. 恢复测试

### 4.1 恢复测试重要性

```bash
# 定期测试备份的恢复过程
# 确保备份数据完整可用
# 验证恢复流程的正确性
# 估计恢复时间（RTO）
```

### 4.2 恢复测试脚本

```bash
#!/bin/bash
# 恢复测试脚本

TEST_DIR="/tmp/restore_test"
BACKUP_FILE="/backup/websites/files_20240101_120000.tar.gz"

# 创建测试目录
mkdir -p "$TEST_DIR"

# 恢复备份
tar -xzvf "$BACKUP_FILE" -C "$TEST_DIR"

# 验证文件完整性
if [ -f "$TEST_DIR/index.html" ]; then
    echo "恢复测试成功"
else
    echo "恢复测试失败"
fi

# 清理测试目录
rm -rf "$TEST_DIR"
```

## 5. 异地备份

### 5.1 使用 rsync 远程备份

```bash
# 使用 SSH 密钥认证
rsync -avz -e ssh /backup/ user@remote:/remote/backup/

# 使用 rsync daemon
rsync -avz /backup/ remote::backup/
```

### 5.2 使用云存储

```bash
# 使用 rclone 支持多种云存储
# 安装
sudo apt install rclone

# 配置
rclone config

# 上传备份
rclone copy /backup remote:backup-bucket

# 下载备份
rclone copy remote:backup-bucket /restore
```

### 5.3 使用对象存储

```bash
# 使用 AWS CLI
aws s3 sync /backup s3://my-backup-bucket/

# 使用阿里云 OSS
ossutil cp -r /backup oss://my-backup-bucket/
```

## 6. 自动化备份

### 6.1 使用 cron 定时备份

```bash
# 编辑 crontab
crontab -e

# 每天凌晨 2 点备份
0 2 * * * /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1

# 每周日凌晨 3 点完整备份
0 3 * * 0 /usr/local/bin/full-backup.sh >> /var/log/backup.log 2>&1
```

### 6.2 使用 systemd timer

```bash
# 创建 service 文件
# /etc/systemd/system/backup.service
[Unit]
Description=Backup Service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/backup.sh

# 创建 timer 文件
# /etc/systemd/system/backup.timer
[Unit]
Description=Daily Backup Timer

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target

# 启用 timer
sudo systemctl enable backup.timer
sudo systemctl start backup.timer
```

## 7. 最佳实践

### 7.1 备份验证

```bash
# 定期验证备份完整性
# 检查备份文件大小
# 验证压缩文件
# 测试恢复过程
```

### 7.2 加密备份

```bash
# 使用 GPG 加密备份
tar -czvf - /data | gpg -e -r user@example.com > backup.tar.gz.gpg

# 解密备份
gpg -d backup.tar.gz.gpg | tar -xzvf -
```

### 7.3 备份监控

```bash
# 监控备份任务状态
# 检查备份文件大小
# 发送备份成功/失败通知
```

## 参考资料

- `man rsync`, `man tar`, `man dump`
- [rsync 手册](https://download.samba.org/pub/rsync/rsync.html)
- [tar 手册](https://www.gnu.org/software/tar/manual/)
- [备份最佳实践](https://www.backblaze.com/blog/the-3-2-1-backup-strategy/)
