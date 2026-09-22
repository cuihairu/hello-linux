# 文件操作命令

## 学习目标

- 掌握文件的创建、查看、复制、移动和删除
- 了解文件的查找和比较方法
- 学会管理文件权限和属性

## 1. 文件创建

### 1.1 touch - 创建空文件

```bash
# 创建空文件
touch file.txt

# 创建多个文件
touch file1.txt file2.txt file3.txt

# 更新文件时间戳
touch -t 202401011200 file.txt

# 只更新访问时间
touch -a file.txt

# 只更新修改时间
touch -m file.txt
```

### 1.2 cat - 创建并写入内容

```bash
# 创建文件并写入内容
cat > file.txt << EOF
Hello
World
EOF

# 追加内容
cat >> file.txt << EOF
New line
EOF
```

## 2. 文件查看

### 2.1 cat - 查看文件内容

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

### 2.2 less/more - 分页查看

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

### 2.3 head/tail - 查看首尾

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

## 3. 文件复制

### 3.1 cp - 复制文件

```bash
# 复制文件
cp source.txt dest.txt

# 复制到目录
cp file.txt /path/to/dir/

# 递归复制目录
cp -r source_dir/ dest_dir/

# 保留属性
cp -p file.txt /backup/

# 交互式复制
cp -i file.txt /path/to/existing_file.txt

# 强制复制
cp -f file.txt /path/to/existing_file.txt
```

## 4. 文件移动

### 4.1 mv - 移动/重命名

```bash
# 移动文件
mv file.txt /path/to/dir/

# 重命名文件
mv old_name.txt new_name.txt

# 移动到目录
mv *.txt /path/to/dir/

# 交互式移动
mv -i file.txt /path/to/existing_file.txt

# 强制移动
mv -f file.txt /path/to/existing_file.txt
```

## 5. 文件删除

### 5.1 rm - 删除文件

```bash
# 删除文件
rm file.txt

# 交互式删除
rm -i file.txt

# 强制删除
rm -f file.txt

# 递归删除目录
rm -r directory/

# 强制递归删除
rm -rf directory/
```

## 6. 文件查找

### 6.1 find - 查找文件

```bash
# 按名称查找
find /path -name "*.txt"

# 按类型查找
find /path -type f -name "*.txt"

# 按大小查找
find /path -size +100M

# 按时间查找
find /path -mtime -7

# 按权限查找
find /path -perm 755

# 执行命令
find /path -name "*.txt" -exec rm {} \;
```

### 6.2 locate - 快速查找

```bash
# 更新数据库
sudo updatedb

# 查找文件
locate file.txt

# 按正则表达式查找
locate -r ".*\.txt$"
```

## 7. 文件比较

### 7.1 diff - 比较文件

```bash
# 比较文件
diff file1.txt file2.txt

# 并排显示
diff -y file1.txt file2.txt

# 统一格式
diff -u file1.txt file2.txt

# 比较目录
diff -r dir1/ dir2/
```

### 7.2 cmp - 逐字节比较

```bash
# 比较文件
cmp file1.txt file2.txt

# 显示不同字节
cmp -l file1.txt file2.txt
```

## 8. 文件链接

### 8.1 ln - 创建链接

```bash
# 创建硬链接
ln file.txt hard_link.txt

# 创建符号链接
ln -s file.txt soft_link.txt

# 创建目录链接
ln -s /path/to/dir link_name
```

## 9. 文件属性

### 9.1 stat - 查看文件状态

```bash
# 查看文件状态
stat file.txt

# 显示文件系统信息（BSD/macOS 语法；Linux 上用 `stat -f -c` 或 `df`）
stat -f file.txt
df -h file.txt
```

### 9.2 file - 查看文件类型

```bash
# 查看文件类型
file file.txt

# 查看 MIME 类型
file -i file.txt
```

## 参考资料

- [鸟哥的私房菜 - 文件与目录管理](https://linux.vbird.org/linux_basic/centos7/0220filemanager.php)
- [Arch Wiki - Core utilities](https://wiki.archlinux.org/title/Core_utilities)
- [Linux man pages](https://man7.org/linux/man-pages/)
