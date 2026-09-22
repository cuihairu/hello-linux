# 目录操作命令

## 学习目标

- 掌握目录的创建、删除和切换
- 了解目录的查看和管理方法
- 学会使用目录相关的快捷操作

## 1. 目录创建

### 1.1 mkdir - 创建目录

```bash
# 创建目录
mkdir directory

# 创建多级目录
mkdir -p parent/child/grandchild

# 创建多个目录
mkdir dir1 dir2 dir3

# 设置权限
mkdir -m 755 directory

# 显示创建过程
mkdir -v directory
```

## 2. 目录删除

### 2.1 rmdir - 删除空目录

```bash
# 删除空目录
rmdir directory

# 删除多级空目录
rmdir -p parent/child/grandchild
```

### 2.2 rm - 删除目录

```bash
# 递归删除目录
rm -r directory

# 强制递归删除
rm -rf directory

# 交互式删除
rm -ri directory
```

## 3. 目录切换

### 3.1 cd - 切换目录

```bash
# 切换到指定目录
cd /path/to/directory

# 切换到家目录
cd ~
cd

# 切换到上一次目录
cd -

# 切换到上级目录
cd ..

# 切换到当前目录
cd .
```

### 3.2 pwd - 显示当前目录

```bash
# 显示当前目录
pwd

# 显示物理路径（解析符号链接）
pwd -P
```

## 4. 目录查看

### 4.1 ls - 列出目录内容

```bash
# 列出文件
ls

# 长格式显示
ls -la

# 显示隐藏文件
ls -a

# 按时间排序
ls -lt

# 按大小排序
ls -lS

# 递归显示
ls -R

# 人类可读大小
ls -lh
```

### 4.2 tree - 树状显示

```bash
# 显示目录树
tree

# 只显示目录
tree -d

# 显示层级
tree -L 2

# 显示隐藏文件
tree -a
```

## 5. 目录复制

### 5.1 cp - 复制目录

```bash
# 递归复制目录
cp -r source_dir dest_dir

# 保留属性
cp -rp source_dir dest_dir

# 交互式复制
cp -ri source_dir dest_dir

# 强制复制
cp -rf source_dir dest_dir
```

## 6. 目录移动

### 6.1 mv - 移动/重命名目录

```bash
# 移动目录
mv source_dir /path/to/dest/

# 重命名目录
mv old_name new_name
```

## 7. 目录查找

### 7.1 find - 查找目录

```bash
# 按名称查找目录
find /path -type d -name "dirname"

# 按时间查找目录
find /path -type d -mtime -7

# 按大小查找目录
find /path -type d -size +100M
```

## 8. 目录大小

### 8.1 du - 查看目录大小

```bash
# 查看目录大小
du -sh directory

# 查看所有文件大小
du -ah directory

# 查看总大小
du -sh *

# 排序显示
du -sh * | sort -hr
```

### 8.2 df - 查看磁盘使用

```bash
# 查看磁盘使用情况
df -h

# 查看指定文件系统
df -h /home

# 显示文件系统类型
df -Th
```

## 9. 目录权限

### 9.1 chmod - 修改目录权限

```bash
# 修改目录权限
chmod 755 directory

# 递归修改权限
chmod -R 755 directory

# 添加执行权限
chmod +x directory
```

### 9.2 chown - 修改目录所有者

```bash
# 修改所有者
chown user directory

# 修改所有者和组
chown user:group directory

# 递归修改
chown -R user:group directory
```

## 10. 目录链接

### 10.1 ln - 创建目录链接

```bash
# 创建符号链接
ln -s /path/to/directory link_name

# 创建硬链接（目录不能创建硬链接）
# ln directory hard_link  # 会报错
```

## 11. 目录比较

### 11.1 diff - 比较目录

```bash
# 比较目录
diff -r dir1 dir2

# 只显示不同文件
diff -rq dir1 dir2
```

## 12. 目录打包

### 12.1 tar - 打包目录

```bash
# 打包目录
tar -cvf archive.tar directory

# 打包并压缩
tar -czvf archive.tar.gz directory

# 解包
tar -xvf archive.tar

# 解包并解压
tar -xzvf archive.tar.gz
```

## 13. 常用技巧

### 13.1 批量创建目录

```bash
# 使用 brace expansion
mkdir dir_{1..10}

# 创建目录结构
mkdir -p project/{src,bin,doc,test}
```

### 13.2 目录操作快捷方式

```bash
# 快速回到家目录
cd ~

# 快速到上次目录
cd -

# 快速到上级目录
cd ..

# 使用 pushd/popd 管理目录栈
pushd /path/to/dir
popd
dirs
```

## 参考资料

- [鸟哥的私房菜 - 文件与目录管理](https://linux.vbird.org/linux_basic/centos7/0220filemanager.php)
- [Arch Wiki - Core utilities](https://wiki.archlinux.org/title/Core_utilities)
- [Linux man pages](https://man7.org/linux/man-pages/)
