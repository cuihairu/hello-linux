# 文本处理

文本处理是 Shell 脚本的核心技能，grep、sed、awk 是三大利器。

> 内容参考自 GNU 手册和 Shell 编程实践，见文末参考资料。

## 学习目标

- 掌握 grep 搜索和过滤
- 学会 sed 流编辑器
- 掌握 awk 文本分析
- 了解其他文本处理工具

## 1. grep - 搜索过滤

### 1.1 基本用法

```bash
# 搜索包含 pattern 的行
grep "pattern" file

# 忽略大小写
grep -i "pattern" file

# 显示行号
grep -n "pattern" file

# 反向匹配
grep -v "pattern" file

# 递归搜索目录
grep -r "pattern" directory/

# 只显示匹配部分
grep -o "pattern" file

# 统计匹配行数
grep -c "pattern" file
```

### 1.2 正则表达式

```bash
# 基础正则
grep "^start" file      # 以 start 开头
grep "end$" file        # 以 end 结尾
grep "^$" file          # 空行
grep "[0-9]" file       # 包含数字
grep "[^a-z]" file      # 非小写字母

# 扩展正则（-E 或 egrep）
grep -E "cat|dog" file  # cat 或 dog
grep -E "go+d" file     # 一个或多个 o
grep -E "go*d" file     # 零个或多个 o
grep -E "go?d" file     # 零个或一个 o
grep -E "(ab)+" file    # 一个或多个 ab
```

### 1.3 实用示例

```bash
# 查找进程
ps aux | grep nginx

# 查找文件内容
grep -r "TODO" *.py

# 排除目录
grep -r --exclude-dir=".git" "pattern" .

# 显示匹配上下文
grep -A 3 -B 3 "error" log.txt  # 前后各3行
```

## 2. sed - 流编辑器

### 2.1 基本用法

```bash
# 替换第一个匹配
sed 's/old/new/' file

# 替换所有匹配
sed 's/old/new/g' file

# 原地修改文件
sed -i 's/old/new/g' file

# 只显示修改的行
sed -n 's/old/new/p' file
```

### 2.2 地址范围

```bash
# 第 5 行
sed '5s/old/new/' file

# 第 5 到 10 行
sed '5,10s/old/new/' file

# 从第 5 行到文件末尾
sed '5,$s/old/new/' file

# 匹配 pattern 的行
sed '/pattern/s/old/new/' file
```

### 2.3 删除和插入

```bash
# 删除行
sed '3d' file           # 删除第3行
sed '3,5d' file         # 删除第3到5行
sed '/pattern/d' file   # 删除匹配行
sed '/^$/d' file        # 删除空行

# 插入行
sed '3i\新行' file      # 在第3行前插入
sed '3a\新行' file      # 在第3行后插入
sed '1i\标题' file      # 在文件开头插入
```

### 2.4 实用示例

```bash
# 删除注释行
sed '/^#/d' file

# 删除空行
sed '/^$/d' file

# 去除行首空格
sed 's/^[[:space:]]*//' file

# 去除行尾空格
sed 's/[[:space:]]*$//' file

# 提取配置值
sed -n 's/^name=\(.*\)/\1/p' config.txt
```

## 3. awk - 文本分析

### 3.1 基本语法

```bash
# 打印所有行
awk '{print}' file

# 打印第一列
awk '{print $1}' file

# 打印多列
awk '{print $1, $3}' file

# 指定分隔符
awk -F: '{print $1}' /etc/passwd
```

### 3.2 模式匹配

```bash
# 匹配包含 pattern 的行
awk '/pattern/ {print}' file

# 条件过滤
awk '$3 > 100 {print}' file

# 多条件
awk '$1 == "admin" && $3 > 100 {print}' file
```

### 3.3 内置变量

```bash
# NR: 当前行号
awk '{print NR, $0}' file

# NF: 当前行的字段数
awk '{print NF, $0}' file

# FS: 输入字段分隔符
awk 'BEGIN {FS=":"} {print $1}' /etc/passwd

# OFS: 输出字段分隔符
awk 'BEGIN {OFS=","} {print $1, $2}' file
```

### 3.4 实用示例

```bash
# 统计行数
awk 'END {print NR}' file

# 求和
awk '{sum += $3} END {print sum}' file

# 去重
awk '!seen[$0]++' file

# 格式化输出
awk '{printf "%-20s %10d\n", $1, $2}' file

# 多文件处理
awk 'FNR==1 {print "=== " FILENAME " ==="} {print}' file1 file2
```

## 4. 其他工具

### 4.1 cut - 提取列

```bash
# 按分隔符提取
cut -d: -f1 /etc/passwd

# 按字符位置提取
cut -c1-10 file

# 按字节提取
cut -b1-10 file
```

### 4.2 sort - 排序

```bash
# 基本排序
sort file

# 数字排序
sort -n file

# 逆序排序
sort -r file

# 按列排序
sort -k2 file

# 去重
sort -u file
```

### 4.3 uniq - 去重

```bash
# 去重（需要先排序）
sort file | uniq

# 统计重复次数
sort file | uniq -c

# 只显示重复行
sort file | uniq -d

# 只显示唯一行
sort file | uniq -u
```

### 4.4 tr - 字符转换

```bash
# 小写转大写
tr 'a-z' 'A-Z' < file

# 删除字符
tr -d '0-9' < file

# 压缩重复字符
tr -s ' ' < file

# 替换字符
tr ',' '\t' < file
```

### 4.5 wc - 统计

```bash
# 统计行数
wc -l file

# 统计单词数
wc -w file

# 统计字符数
wc -c file
```

## 5. 管道组合

### 5.1 常用组合

```bash
# 查找最多的 IP
awk '{print $1}' access.log | sort | uniq -c | sort -rn | head -10

# 统计每小时请求数
awk '{print $4}' access.log | cut -d: -f2 | sort | uniq -c

# 查找大文件
find / -type f -size +100M -exec ls -lh {} \; | awk '{print $5, $9}'

# 监控日志
tail -f /var/log/syslog | grep --line-buffered "error"
```

### 5.2 实战案例

```bash
# 分析 Nginx 访问日志
cat access.log | \
  awk '{print $1}' | \
  sort | uniq -c | \
  sort -rn | head -20

# 提取邮箱
grep -oE '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' file

# 统计代码行数
find . -name "*.py" -exec wc -l {} + | tail -1
```

## 参考资料

- `man grep`, `man sed`, `man awk`
- [GNU Grep 手册](https://www.gnu.org/software/grep/manual/)
- [GNU Sed 手册](https://www.gnu.org/software/sed/manual/)
- [GNU Awk 手册](https://www.gnu.org/software/gawk/manual/)
- [Awk 编程语言](https://ia802309.us.archive.org/25/items/pdfy-MgN0H1joIoDVoIC7/The_AWK_Programming_Language.pdf)
