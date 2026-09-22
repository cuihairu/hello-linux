# 文件权限

Linux 通过权限机制控制用户对文件的访问。本章介绍基本权限和特殊权限。

> 内容参考自 Arch Wiki 和 man 手册，见文末参考资料。

## 学习目标

- 理解权限的表示方法
- 掌握 chmod、chown 命令
- 了解 SUID、SGID、Sticky Bit

## 1. 权限基础

### 1.1 查看权限

```bash
ls -la
# -rwxr-xr-x 1 user group 4096 Jan 1 00:00 file.txt
# drwxr-xr-x 2 user group 4096 Jan 1 00:00 dir/
```

权限字段解读：

```
- rwx r-x r--
│ │   │   │
│ │   │   └── 其他用户（other）
│ │   └────── 所属组（group）
│ └────────── 所有者（user）
└──────────── 文件类型（- 普通文件，d 目录，l 链接）
```

### 1.2 权限含义

| 权限 | 文件 | 目录 |
|------|------|------|
| r（读） | 查看内容 | 列出内容 |
| w（写） | 修改内容 | 创建/删除文件 |
| x（执行） | 执行程序 | 进入目录 |

### 1.3 数字表示

| 字符 | 数字 |
|------|------|
| r | 4 |
| w | 2 |
| x | 1 |
| \- | 0 |

```
rwx = 4+2+1 = 7
r-x = 4+0+1 = 5
r-- = 4+0+0 = 4
```

常见组合：

| 数字 | 含义 | 适用场景 |
|------|------|---------|
| 755 | rwxr-xr-x | 目录、可执行文件 |
| 644 | rw-r--r-- | 普通文件 |
| 700 | rwx------ | 私人目录 |
| 600 | rw------- | 私人文件 |

## 2. 修改权限

### 2.1 chmod

```bash
# 数字模式
chmod 755 file.txt
chmod -R 755 directory/

# 字符模式
chmod u+x file.txt     # 给所有者添加执行权限
chmod g-w file.txt     # 移除组的写权限
chmod o=r file.txt     # 设置其他用户为只读
chmod a+r file.txt     # 给所有人添加读权限
```

### 2.2 chown

```bash
# 修改所有者
sudo chown user file.txt

# 修改所有者和组
sudo chown user:group file.txt

# 递归修改
sudo chown -R user:group directory/

# 只修改组
sudo chown :group file.txt
```

### 2.3 chgrp

```bash
sudo chgrp group file.txt
```

## 3. umask

umask 决定新建文件的默认权限：

```bash
# 查看 umask
umask

# 文件默认权限 = 666 - umask
# 目录默认权限 = 777 - umask
```

## 4. 特殊权限

### 4.1 SUID

执行时以文件所有者身份运行：

```bash
# 设置 SUID
chmod u+s file
chmod 4755 file

# 示例
ls -la /usr/bin/passwd
# -rwsr-xr-x 1 root root ... /usr/bin/passwd
```

### 4.2 SGID

新建文件继承目录的组：

```bash
# 设置 SGID
chmod g+s directory
chmod 2755 directory
```

### 4.3 Sticky Bit

只有文件所有者才能删除文件：

```bash
# 设置 Sticky Bit
chmod +t directory
chmod 1755 directory

# 示例
ls -la /tmp
# drwxrwxrwt ...
```

## 5. ACL

ACL 提供更细粒度的权限控制：

```bash
# 查看 ACL
getfacl file.txt

# 设置 ACL
setfacl -m u:guest:rw file.txt
setfacl -m g:staff:r file.txt

# 递归设置
setfacl -R -m u:guest:rw directory/

# 删除 ACL
setfacl -x u:guest file.txt
```

## 参考资料

- `man chmod`、`man chown`、`man getfacl`
- Arch Wiki - File permissions and attributes — [wiki.archlinux.org](https://wiki.archlinux.org/title/File_permissions_and_attributes)
- 鸟哥的私房菜 - 文件权限 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0210filepermission.php)
