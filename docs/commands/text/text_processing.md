# 文本处理命令

## 学习目标

- 掌握文本的搜索、替换和处理
- 了解正则表达式的使用
- 学会使用文本处理工具

## 1. 文本查看

### 1.1 cat - 查看文件

```bash
# 查看文件内容
cat file.txt

# 显示行号
cat -n file.txt

# 显示非打印字符
cat -A file.txt

# 合并文件
cat file1.txt file2.txt > combined.txt
```

### 1.2 less/more - 分页查看

```bash
# 使用 less 查看
less file.txt

# 使用 more 查看
more file.txt

# less 快捷键
# 空格：下一页
# b：上一页
# /pattern：搜索
# q：退出
```

### 1.3 head/tail - 查看首尾

```bash
# 查看前 10 行
head file.txt

# 查看前 20 行
head -n 20 file.txt

# 查看后 10 行
tail file.txt

# 查看后 20 行
tail -n 20 file.txt

# 实时查看
tail -f file.txt
```

## 2. 文本搜索

### 2.1 grep - 搜索文本

```bash
# 搜索字符串
grep "pattern" file.txt

# 忽略大小写
grep -i "pattern" file.txt

# 递归搜索
grep -r "pattern" /path/

# 显示行号
grep -n "pattern" file.txt

# 显示匹配行数
grep -c "pattern" file.txt

# 反向匹配
grep -v "pattern" file.txt

# 显示匹配行及前后文
grep -A 3 -B 3 "pattern" file.txt
```

### 2.2 egrep/fgrep - 扩展搜索

`egrep` 和 `fgrep` 是 `grep -E` 和 `grep -F` 的别名。POSIX 已弃用（deprecated），部分新系统已移除，推荐直接用 `grep -E` / `grep -F`：

```bash
# 使用扩展正则表达式（等价于 egrep）
grep -E "pattern1|pattern2" file.txt

# 固定字符串搜索（更快，等价于 fgrep）
grep -F "fixed string" file.txt
```

## 3. 文本替换

### 3.1 sed - 流编辑器

```bash
# 替换第一个匹配
sed 's/old/new/' file.txt

# 替换所有匹配
sed 's/old/new/g' file.txt

# 全局替换（所有行）
sed 's/old/new/g' file.txt > new_file.txt

# 直接修改文件
sed -i 's/old/new/g' file.txt

# 删除行
sed '3d' file.txt          # 删除第 3 行
sed '3,5d' file.txt        # 删除 3-5 行
sed '/pattern/d' file.txt  # 删除匹配行

# 插入行
sed '3i\new line' file.txt

# 追加行
sed '3a\new line' file.txt
```

### 3.2 awk - 文本处理

```bash
# 打印指定列
awk '{print $1}' file.txt

# 打印多列
awk '{print $1, $3}' file.txt

# 指定分隔符
awk -F: '{print $1}' /etc/passwd

# 条件过滤
awk '$3 > 100' file.txt

# 模式匹配
awk '/pattern/' file.txt

# 计算总和
awk '{sum += $1} END {print sum}' file.txt

# 格式化输出
awk '{printf "%-10s %s\n", $1, $2}' file.txt
```

## 4. 文本排序

### 4.1 sort - 排序

```bash
# 按字母排序
sort file.txt

# 按数字排序
sort -n file.txt

# 反向排序
sort -r file.txt

# 按指定列排序
sort -k2 file.txt

# 去重
sort -u file.txt

# 指定分隔符
sort -t: -k3 -n /etc/passwd
```

### 4.2 uniq - 去重

```bash
# 去重（需要先排序）
sort file.txt | uniq

# 显示重复行
sort file.txt | uniq -d

# 显示唯一行
sort file.txt | uniq -u

# 统计重复次数
sort file.txt | uniq -c
```

## 5. 文本转换

### 5.1 tr - 字符转换

```bash
# 转换为大写
tr 'a-z' 'A-Z' < file.txt

# 转换为小写
tr 'A-Z' 'a-z' < file.txt

# 删除字符
tr -d 'a' < file.txt

# 压缩重复字符
tr -s ' ' < file.txt
```

### 5.2 cut - 提取列

```bash
# 按字符提取
cut -c1-10 file.txt

# 按分隔符提取
cut -d: -f1 /etc/passwd

# 提取多列
cut -d: -f1,3 /etc/passwd
```

### 5.3 paste - 合并文件

```bash
# 按列合并
paste file1.txt file2.txt

# 指定分隔符
paste -d: file1.txt file2.txt
```

## 6. 文本统计

### 6.1 wc - 统计

```bash
# 统计行数
wc -l file.txt

# 统计单词数
wc -w file.txt

# 统计字符数
wc -c file.txt

# 显示所有统计
wc file.txt
```

## 7. 文本比较

### 7.1 diff - 比较文件

```bash
# 比较文件
diff file1.txt file2.txt

# 并排显示
diff -y file1.txt file2.txt

# 统一格式
diff -u file1.txt file2.txt

# 生成补丁
diff -u file1.txt file2.txt > patch.txt

# 应用补丁
patch file1.txt < patch.txt
```

## 8. 正则表达式

### 8.1 基本正则表达式

| 符号 | 说明 |
|------|------|
| `.` | 匹配任意字符 |
| `*` | 匹配前一个字符 0 次或多次 |
| `^` | 匹配行首 |
| `$` | 匹配行尾 |
| `[]` | 匹配字符集 |
| `[^]` | 匹配不在字符集中的字符 |
| `\` | 转义字符 |

### 8.2 扩展正则表达式

| 符号 | 说明 |
|------|------|
| `+` | 匹配前一个字符 1 次或多次 |
| `?` | 匹配前一个字符 0 次或 1 次 |
| `()` | 分组 |
| `|` | 或 |
| `{n}` | 匹配 n 次 |
| `{n,}` | 匹配至少 n 次 |
| `{n,m}` | 匹配 n 到 m 次 |

### 8.3 示例

```bash
# 匹配 IP 地址
grep -E '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' file.txt

# 匹配邮箱
grep -E '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' file.txt

# 匹配日期
grep -E '[0-9]{4}-[0-9]{2}-[0-9]{2}' file.txt
```

## 9. 高级文本处理

### 9.1 xargs - 构建命令行

```bash
# 从标准输入构建命令
find . -name "*.txt" | xargs rm

# 指定分隔符
echo "file1 file2 file3" | xargs -n 1 rm

# 处理特殊字符
find . -name "*.txt" -print0 | xargs -0 rm
```

### 9.2 tee - 输出到文件和屏幕

```bash
# 输出到屏幕和文件
echo "hello" | tee file.txt

# 追加到文件
echo "hello" | tee -a file.txt

# 输出到多个文件
echo "hello" | tee file1.txt file2.txt
```

## 参考资料

- [鸟哥的私房菜 - 正则表达式与文本处理](https://linux.vbird.org/linux_basic/centos7/0330regularex.php)
- [Arch Wiki - Core utilities](https://wiki.archlinux.org/title/Core_utilities)
- [Linux man pages](https://man7.org/linux/man-pages/)
