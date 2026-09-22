# 查找与定位

查找与定位命令用于在文件系统中搜索文件和内容。

> 内容参考自 find、locate、grep 手册和实际运维经验，见文末参考资料。

## 学习目标

- 掌握 find 命令的高级用法
- 学会使用 locate 快速查找文件
- 了解 grep、awk、sed 等文本搜索工具
- 掌握文件内容搜索和替换技巧

## 1. find 命令

### 1.1 基本语法

```bash
find [路径] [选项] [表达式]
```

### 1.2 按名称查找

```bash
# 查找文件
find /path -name "filename"

# 忽略大小写
find /path -iname "filename"

# 使用通配符
find /path -name "*.txt"

# 查找目录
find /path -type d -name "dirname"
```

### 1.3 按类型查找

```bash
# 查找普通文件
find /path -type f

# 查找目录
find /path -type d

# 查找符号链接
find /path -type l

# 查找块设备
find /path -type b

# 查找字符设备
find /path -type c
```

### 1.4 按大小查找

```bash
# 查找大于 100MB 的文件
find /path -size +100M

# 查找小于 1KB 的文件
find /path -size -1k

# 查找恰好 1GB 的文件
find /path -size 1G

# 查找空文件
find /path -empty
```

### 1.5 按时间查找

```bash
# 查找最近 7 天修改的文件
find /path -mtime -7

# 查找超过 30 天的文件
find /path -mtime +30

# 查找最近 1 天内访问的文件（-atime 单位为 24 小时）
find /path -atime -1

# 查找最近 10 天内状态改变的文件（-ctime 单位为 24 小时）
find /path -ctime -10

# 按分钟查找（-amin/-cmin 单位为分钟）
find /path -amin -60
find /path -cmin -10
```

### 1.6 按权限查找

```bash
# 查找权限为 755 的文件
find /path -perm 755

# 查找有执行权限的文件
find /path -executable

# 查找 SUID 文件
find /path -perm -4000

# 查找 SGID 文件
find /path -perm -2000
```

### 1.7 按所有者查找

```bash
# 查找属于特定用户的文件
find /path -user username

# 查找属于特定组的文件
find /path -group groupname

# 查找没有所有者的文件
find /path -nouser
```

### 1.8 执行操作

```bash
# 删除找到的文件
find /path -name "*.tmp" -delete

# 执行命令
find /path -name "*.txt" -exec ls -l {} \;

# 使用 xargs
find /path -name "*.txt" | xargs ls -l

# 交互式删除
find /path -name "*.tmp" -ok rm {} \;
```

### 1.9 组合条件

```bash
# AND 条件
find /path -name "*.txt" -size +1M

# OR 条件
find /path \( -name "*.txt" -o -name "*.log" \)

# NOT 条件
find /path -not -name "*.txt"

# 复杂组合
find /path -type f \( -name "*.txt" -o -name "*.log" \) -size +1M
```

## 2. locate 命令

### 2.1 基本用法

```bash
# locate 使用数据库快速查找文件
locate filename

# 忽略大小写
locate -i filename

# 限制结果数量
locate -n 10 filename

# 显示匹配统计
locate -c filename
```

### 2.2 更新数据库

```bash
# 更新数据库（需要 root 权限）
sudo updatedb

# 更新特定目录
sudo updatedb -U /path
```

### 2.3 配置文件

```bash
# /etc/updatedb.conf
# 排除路径
PRUNEPATHS="/tmp /var/spool /media"

# 排除文件系统
PRUNEFS="nfs nfs4 cifs"
```

## 3. grep 命令

### 3.1 基本用法

```bash
# 搜索字符串
grep "pattern" file

# 忽略大小写
grep -i "pattern" file

# 递归搜索
grep -r "pattern" /path

# 显示行号
grep -n "pattern" file

# 显示匹配行数
grep -c "pattern" file

# 反向匹配
grep -v "pattern" file
```

### 3.2 正则表达式

```bash
# 基础正则
grep "^start" file
grep "end$" file
grep "[0-9]" file

# 扩展正则
grep -E "pattern1|pattern2" file
grep -E "go+d" file
grep -E "go*d" file

# Perl 正则
grep -P "\d{3}" file
```

### 3.3 高级选项

```bash
# 显示匹配上下文
grep -A 3 -B 3 "pattern" file

# 只显示匹配部分
grep -o "pattern" file

# 排除目录
grep -r --exclude-dir=".git" "pattern" /path

# 排除文件
grep -r --exclude="*.log" "pattern" /path
```

## 4. awk 命令

### 4.1 基本用法

```bash
# 打印列
awk '{print $1}' file

# 打印多列
awk '{print $1, $3}' file

# 指定分隔符
awk -F: '{print $1}' /etc/passwd

# 条件过滤
awk '$3 > 100' file
```

### 4.2 模式匹配

```bash
# 匹配模式
awk '/pattern/' file

# 不匹配模式
awk '!/pattern/' file

# 范围匹配
awk '/start/,/end/' file
```

### 4.3 内置变量

```bash
# NR：当前行号
awk '{print NR, $0}' file

# NF：字段数
awk '{print NF, $0}' file

# FS：输入分隔符
awk 'BEGIN {FS=":"} {print $1}' file

# OFS：输出分隔符
awk 'BEGIN {OFS=","} {print $1, $2}' file
```

## 5. sed 命令

### 5.1 基本用法

```bash
# 替换
sed 's/old/new/' file

# 全局替换
sed 's/old/new/g' file

# 直接修改文件
sed -i 's/old/new/g' file

# 删除行
sed '3d' file
sed '/pattern/d' file
```

### 5.2 地址范围

```bash
# 特定行
sed '3s/old/new/' file

# 范围行
sed '3,5s/old/new/' file

# 匹配行
sed '/pattern/s/old/new/' file
```

### 5.3 高级操作

```bash
# 插入行
sed '3i\new line' file

# 追加行
sed '3a\new line' file

# 修改行
sed '3c\new line' file

# 打印特定行
sed -n '3p' file
```

## 6. which 和 whereis

### 6.1 which

```bash
# 查找命令位置
which python
which ls

# 查找所有匹配
which -a python
```

### 6.2 whereis

```bash
# 查找命令、源码、手册
whereis python

# 只查找二进制文件
whereis -b python

# 只查找源码
whereis -s python

# 只查找手册
whereis -m python
```

## 7. 实战案例

### 7.1 查找大文件

```bash
# 查找大于 100MB 的文件
find / -type f -size +100M -exec ls -lh {} \;

# 查找前 10 个大文件
find / -type f -exec du -h {} + | sort -rh | head -10
```

### 7.2 查找最近修改的文件

```bash
# 查找最近 24 小时修改的文件
find /var/log -type f -mtime -1

# 查找最近 7 天修改的配置文件
find /etc -type f -name "*.conf" -mtime -7
```

### 7.3 查找重复文件

```bash
# 使用 fdupes 查找重复文件
sudo apt install fdupes
fdupes -r /path

# 使用 find 和 md5sum
find /path -type f -exec md5sum {} \; | sort | uniq -d -w 32
```

### 7.4 批量重命名

```bash
# 使用 rename
rename 's/\.txt$/\.md/' *.txt

# 使用 find 和 mv
find /path -name "*.txt" -exec bash -c 'mv "$1" "${1%.txt}.md"' _ {} \;
```

### 7.5 日志分析

```bash
# 查找错误日志
grep -r "ERROR" /var/log/

# 统计错误数量
grep -c "ERROR" /var/log/syslog

# 查找特定时间段的日志
awk '/2024-01-01 10:00/,/2024-01-01 11:00/' /var/log/syslog
```

## 参考资料

- `man find`, `man locate`, `man grep`, `man awk`, `man sed`
- [find 手册](https://www.gnu.org/software/findutils/manual/)
- [grep 手册](https://www.gnu.org/software/grep/manual/)
- [awk 手册](https://www.gnu.org/software/gawk/manual/)
- [sed 手册](https://www.gnu.org/software/sed/manual/)