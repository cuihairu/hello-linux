# 文件权限

## 学习目标

- 理解 Linux 文件权限的概念
- 掌握权限的表示方法和修改命令
- 了解特殊权限（SUID、SGID、Sticky Bit）

## 1. 权限基础

### 1.1 权限类型

每个文件和目录都有三种基本权限：

| 权限 | 文件 | 目录 |
|------|------|------|
| 读（r） | 查看文件内容 | 列出目录内容 |
| 写（w） | 修改文件内容 | 创建/删除文件 |
| 执行（x） | 执行文件 | 进入目录 |

### 1.2 权限表示

```bash
# 查看文件权限
ls -la

# 输出示例
-rw-r--r-- 1 user group 1234 Jan 1 00:00 file.txt
drwxr-xr-x 2 user group 4096 Jan 1 00:00 directory/
```

权限表示方法：
- **字符表示**：rwxr-xr--
- **数字表示**：754

数字表示对照：
- r = 4
- w = 2
- x = 1
- \- = 0

### 1.3 权限计算

```
rwx r-x r--
 7   5   4

rwx = 4+2+1 = 7
r-x = 4+0+1 = 5
r-- = 4+0+0 = 4
```

## 2. 修改权限

### 2.1 chmod - 修改权限

```bash
# 字符模式
chmod u+x file.txt        # 给用户添加执行权限
chmod g-w file.txt        # 移除组的写权限
chmod o=r file.txt        # 设置其他用户为只读
chmod a+r file.txt        # 给所有用户添加读权限

# 数字模式
chmod 755 file.txt        # rwxr-xr-x
chmod 644 file.txt        # rw-r--r--
chmod 700 directory/      # rwx------

# 递归修改目录权限
chmod -R 755 directory/
```

### 2.2 chown - 修改所有者

```bash
# 修改所有者
chown user file.txt

# 修改所有者和组
chown user:group file.txt

# 递归修改
chown -R user:group directory/

# 只修改组
chown :group file.txt
```

### 2.3 chgrp - 修改组

```bash
# 修改组
chgrp group file.txt

# 递归修改
chgrp -R group directory/
```

## 3. 特殊权限

### 3.1 SUID（Set User ID）

当文件设置了 SUID 位，执行时以文件所有者的身份运行：

```bash
# 设置 SUID
chmod u+s file.txt
chmod 4755 file.txt

# 查看 SUID 文件
find / -perm -4000 2>/dev/null

# 常见例子
ls -la /usr/bin/passwd
# -rwsr-xr-x 1 root root ... /usr/bin/passwd
```

### 3.2 SGID（Set Group ID）

当目录设置了 SGID 位，新建的文件继承目录的组：

```bash
# 设置 SGID
chmod g+s directory/
chmod 2755 directory/

# 查看 SGID 文件
find / -perm -2000 2>/dev/null
```

### 3.3 Sticky Bit

当目录设置了 Sticky Bit，只有文件所有者才能删除文件：

```bash
# 设置 Sticky Bit
chmod +t directory/
chmod 1755 directory/

# 查看 Sticky Bit 目录
find / -perm -1000 2>/dev/null

# 常见例子
ls -la /tmp
# drwxrwxrwt ...
```

## 4. 默认权限

### 4.1 umask

umask 决定新建文件和目录的默认权限：

```bash
# 查看当前 umask
umask

# 设置 umask
umask 022

# 文件默认权限 = 666 - umask
# 目录默认权限 = 777 - umask
```

### 4.2 默认 umask 值

| 发行版 | 默认 umask |
|--------|-----------|
| root | 022 |
| 普通用户 | 002 或 022 |

## 5. ACL 权限控制

ACL（Access Control List）提供更细粒度的权限控制：

```bash
# 查看 ACL
getfacl file.txt

# 设置 ACL
setfacl -m u:user:rw file.txt
setfacl -m g:group:r file.txt

# 删除 ACL
setfacl -x u:user file.txt

# 递归设置
setfacl -R -m u:user:rw directory/
```

## 参考资料

- [鸟哥的私房菜 - 文件权限](https://linux.vbird.org/linux_basic/0210filepermission.php)
- [Arch Wiki - File permissions and attributes](https://wiki.archlinux.org/title/File_permissions_and_attributes)
