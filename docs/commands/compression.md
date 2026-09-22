# 压缩与归档

压缩与归档命令用于打包和压缩文件，节省存储空间和传输时间。

> 内容参考自 tar、gzip、bzip2、xz 手册和实际运维经验，见文末参考资料。

## 学习目标

- 掌握 tar 归档工具的使用
- 学会使用 gzip、bzip2、xz 等压缩工具
- 了解 zip、unzip 等跨平台压缩工具
- 掌握压缩和归档的最佳实践

## 1. tar 命令

### 1.1 基本用法

```bash
# 创建归档
tar -cvf archive.tar /path/to/directory

# 创建压缩归档（gzip）
tar -czvf archive.tar.gz /path/to/directory

# 创建压缩归档（bzip2）
tar -cjvf archive.tar.bz2 /path/to/directory

# 创建压缩归档（xz）
tar -cJvf archive.tar.xz /path/to/directory

# 解压归档
tar -xvf archive.tar

# 解压压缩归档
tar -xzvf archive.tar.gz

# 查看归档内容
tar -tvf archive.tar
```

### 1.2 常用选项

```bash
# -c：创建归档
# -x：解压归档
# -t：查看归档内容
# -v：详细输出
# -f：指定文件名
# -z：使用 gzip 压缩
# -j：使用 bzip2 压缩
# -J：使用 xz 压缩
# -C：指定解压目录
# --exclude：排除文件
```

### 1.3 高级用法

```bash
# 排除文件
tar -czvf archive.tar.gz --exclude="*.log" /path

# 排除目录
tar -czvf archive.tar.gz --exclude="node_modules" /path

# 从文件读取排除列表
tar -czvf archive.tar.gz --exclude-from=exclude.txt /path

# 增量备份
tar -czvf backup-full.tar.gz --listed-incremental=/backup/snapshot.snar /data
tar -czvf backup-incr.tar.gz --listed-incremental=/backup/snapshot.snar /data

# 分卷压缩
tar -czvf - /path | split -b 1G - archive.tar.gz.

# 合并分卷
cat archive.tar.gz.* | tar -xzvf -
```

## 2. gzip 命令

### 2.1 基本用法

```bash
# 压缩文件
gzip file.txt

# 解压文件
gzip -d file.txt.gz

# 保留原文件
gzip -k file.txt

# 显示压缩比
gzip -l file.txt.gz
```

### 2.2 常用选项

```bash
# -1 到 -9：压缩级别（1 最快，9 最小）
gzip -9 file.txt

# -c：输出到标准输出
gzip -c file.txt > file.txt.gz

# -r：递归压缩目录
gzip -r /path

# -t：测试压缩文件完整性
gzip -t file.txt.gz
```

## 3. bzip2 命令

### 3.1 基本用法

```bash
# 压缩文件
bzip2 file.txt

# 解压文件
bzip2 -d file.txt.bz2

# 保留原文件
bzip2 -k file.txt

# 显示压缩比
bzip2 -l file.txt.bz2
```

### 3.2 常用选项

```bash
# -1 到 -9：压缩级别
bzip2 -9 file.txt

# -c：输出到标准输出
bzip2 -c file.txt > file.txt.bz2

# -t：测试压缩文件完整性
bzip2 -t file.txt.bz2
```

## 4. xz 命令

### 4.1 基本用法

```bash
# 压缩文件
xz file.txt

# 解压文件
xz -d file.txt.xz

# 保留原文件
xz -k file.txt

# 显示压缩比
xz -l file.txt.xz
```

### 4.2 常用选项

```bash
# -0 到 -9：压缩级别
xz -9 file.txt

# -c：输出到标准输出
xz -c file.txt > file.txt.xz

# -t：测试压缩文件完整性
xz -t file.txt.xz

# -T：多线程压缩
xz -T 0 file.txt
```

## 5. zip 和 unzip

### 5.1 zip 命令

```bash
# 压缩文件
zip archive.zip file1.txt file2.txt

# 压缩目录
zip -r archive.zip /path/to/directory

# 排除文件
zip -r archive.zip /path -x "*.log"

# 分卷压缩
zip -r -s 1G archive.zip /path
```

### 5.2 unzip 命令

```bash
# 解压文件
unzip archive.zip

# 解压到指定目录
unzip archive.zip -d /path

# 查看内容
unzip -l archive.zip

# 测试完整性
unzip -t archive.zip
```

## 6. 7z 命令

### 6.1 安装

```bash
# Debian/Ubuntu
sudo apt install p7zip-full

# RHEL/CentOS
sudo dnf install p7zip
```

### 6.2 基本用法

```bash
# 创建压缩包
7z a archive.7z file1.txt file2.txt

# 解压
7z x archive.7z

# 查看内容
7z l archive.7z

# 测试完整性
7z t archive.7z
```

## 7. 压缩工具对比

| 工具 | 压缩率 | 速度 | 扩展名 | 特点 |
|------|--------|------|--------|------|
| gzip | 中等 | 快 | .gz | 最常用，兼容性好 |
| bzip2 | 高 | 慢 | .bz2 | 压缩率高，速度慢 |
| xz | 最高 | 最慢 | .xz | 压缩率最高，速度最慢 |
| zip | 中等 | 快 | .zip | 跨平台，支持密码 |
| 7z | 高 | 中等 | .7z | 支持多种压缩算法 |

## 8. 实战案例

### 8.1 备份压缩

```bash
#!/bin/bash
# 备份压缩脚本

BACKUP_DIR="/backup"
DATE=$(date +%Y%m%d_%H%M%S)

# 创建备份
tar -czvf "$BACKUP_DIR/backup_$DATE.tar.gz" /important/data

# 检查备份大小
ls -lh "$BACKUP_DIR/backup_$DATE.tar.gz"

# 删除 30 天前的备份
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +30 -delete
```

### 8.2 日志压缩

```bash
#!/bin/bash
# 日志压缩脚本

LOG_DIR="/var/log"
ARCHIVE_DIR="/var/log/archive"
DATE=$(date +%Y%m%d)

# 创建归档目录
mkdir -p "$ARCHIVE_DIR"

# 压缩旧日志（先打包，确认成功后再删除源文件，避免数据丢失）
find "$LOG_DIR" -name "*.log" -mtime +7 -print0 | tar -czf "$ARCHIVE_DIR/logs_$DATE.tar.gz" --null -T -

# 确认归档完整后再删除源文件
find "$LOG_DIR" -name "*.log" -mtime +7 -delete
```

### 8.3 文件传输压缩

```bash
# 压缩后传输
tar -czvf - /path | ssh user@remote "cat > /remote/backup.tar.gz"

# 远程解压
ssh user@remote "tar -xzvf /remote/backup.tar.gz -C /remote/path"
```

### 8.4 分卷压缩大文件

```bash
# 分卷压缩
tar -czvf - /large/path | split -b 1G - archive.tar.gz.

# 合并分卷
cat archive.tar.gz.* | tar -xzvf -

# 传输分卷
scp archive.tar.gz.* user@remote:/path
```

## 9. 性能优化

### 9.1 选择压缩级别

```bash
# 快速压缩
gzip -1 file.txt

# 最大压缩
gzip -9 file.txt

# 平衡压缩
gzip -6 file.txt
```

### 9.2 多线程压缩

```bash
# 使用 pigz（并行 gzip）
sudo apt install pigz
pigz file.txt

# 使用 pbzip2（并行 bzip2）
sudo apt install pbzip2
pbzip2 file.txt

# 使用 pxz（并行 xz）
sudo apt install pxz
pxz file.txt
```

### 9.3 压缩算法选择

```bash
# 对于文本文件：使用 gzip 或 bzip2
# 对于二进制文件：使用 xz
# 对于需要密码：使用 zip 或 7z
# 对于跨平台：使用 zip
```

## 10. 故障排查

### 10.1 压缩文件损坏

```bash
# 测试压缩文件完整性
gzip -t file.txt.gz
bzip2 -t file.txt.bz2
xz -t file.txt.xz

# gzip 无法修复损坏的压缩文件；-f 只是覆盖同名输出，不是"修复"
# 损坏时应重新归档源数据，或用 backup 中的历史副本
```

### 10.2 磁盘空间不足

```bash
# 检查磁盘空间
df -h

# 清理临时文件
rm -f /tmp/*.tar.gz

# 使用流式压缩
tar -czvf - /path | ssh user@remote "cat > /remote/backup.tar.gz"
```

### 10.3 权限问题

```bash
# 保留文件权限
tar -czvf archive.tar.gz --preserve-permissions /path

# 恢复文件权限
tar -xzvf archive.tar.gz --preserve-permissions
```

## 参考资料

- `man tar`, `man gzip`, `man bzip2`, `man xz`, `man zip`, `man unzip`
- [tar 手册](https://www.gnu.org/software/tar/manual/)
- [gzip 手册](https://www.gnu.org/software/gzip/manual/)
- [bzip2 手册](https://sourceware.org/bzip2/manual.html)
- [xz 手册](https://tukaani.org/xz/man/xz.1.txt)