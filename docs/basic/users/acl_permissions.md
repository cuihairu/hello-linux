# ACL 权限控制

## 学习目标

- 理解 ACL 的概念和作用
- 掌握 ACL 的设置和管理方法
- 了解 ACL 与传统权限的关系

## 1. ACL 简介

ACL（Access Control List）提供了比传统权限更细粒度的访问控制。

### 1.1 为什么需要 ACL

传统权限只能设置：
- 所有者（user）
- 所属组（group）
- 其他用户（other）

ACL 可以：
- 为特定用户设置权限
- 为特定组设置权限
- 设置默认权限

### 1.2 ACL 类型

- **访问 ACL**：应用于文件或目录
- **默认 ACL**：仅应用于目录，新建文件继承

## 2. ACL 管理命令

### 2.1 查看 ACL

```bash
# 查看文件 ACL
getfacl file.txt

# 输出示例
# file: file.txt
# owner: user
# group: group
user::rw-
user:guest:rw-
group::r--
mask::rw-
other::r--
```

### 2.2 设置 ACL

```bash
# 为用户设置权限
setfacl -m u:username:rw file.txt

# 为组设置权限
setfacl -m g:groupname:r file.txt

# 设置 mask
setfacl -m m::rw file.txt

# 设置默认 ACL（目录）
setfacl -m d:u:username:rw directory/

# 递归设置
setfacl -R -m u:username:rw directory/
```

### 2.3 删除 ACL

```bash
# 删除特定用户 ACL
setfacl -x u:username file.txt

# 删除特定组 ACL
setfacl -x g:groupname file.txt

# 删除所有 ACL
setfacl -b file.txt

# 删除默认 ACL
setfacl -k directory/
```

## 3. ACL 掩码

ACL 掩码（mask）限制 ACL 权限的最大值：

```bash
# 查看掩码
getfacl file.txt | grep mask

# 设置掩码
setfacl -m m::rw file.txt

# 掩码影响
# 实际权限 = ACL 权限 AND 掩码
```

## 4. ACL 备份与恢复

### 4.1 备份 ACL

```bash
# 备份单个文件
getfacl file.txt > file.acl

# 备份目录
getfacl -R directory/ > directory.acl
```

### 4.2 恢复 ACL

```bash
# 恢复单个文件
setfacl --restore=file.acl

# 恢复目录
setfacl --restore=directory.acl
```

## 5. ACL 实际应用

### 5.1 共享目录场景

```bash
# 创建共享目录
sudo mkdir /shared
sudo chmod 770 /shared

# 为特定用户设置权限
sudo setfacl -m u:user1:rw /shared
sudo setfacl -m u:user2:r /shared

# 设置默认 ACL（新建文件继承）
sudo setfacl -m d:u:user1:rw /shared
sudo setfacl -m d:u:user2:r /shared
```

### 5.2 项目协作场景

```bash
# 项目目录
sudo mkdir /project
sudo chown :developers /project

# 设置 ACL
sudo setfacl -m g:developers:rw /project
sudo setfacl -m g:managers:r /project

# 默认 ACL
sudo setfacl -m d:g:developers:rw /project
```

## 6. ACL 与传统权限的关系

| 场景 | 传统权限 | ACL |
|------|---------|-----|
| 所有者 | user::rwx | user::rwx |
| 所属组 | group::rwx | group::rwx |
| 其他用户 | other::rwx | other::rwx |
| 特定用户 | 无法设置 | user:guest:rw- |
| 特定组 | 无法设置 | group:staff:r-- |
| 掩码 | 无 | mask::rw- |

## 7. 注意事项

1. **文件系统支持**：ext4、XFS 等支持 ACL
2. **挂载选项**：需要启用 ACL 支持
3. **备份**：ACL 不会自动备份，需要单独处理
4. **性能**：大量 ACL 可能影响性能

```bash
# 检查文件系统是否支持 ACL
mount | grep acl

# 启用 ACL（/etc/fstab）
/dev/sda1 / ext4 defaults,acl 0 1
```

## 参考资料

- [鸟哥的私房菜 - ACL](https://linux.vbird.org/linux_basic/0410accountmanager.php#acl)
- [Arch Wiki - Access Control Lists](https://wiki.archlinux.org/title/Access_Control_Lists)
