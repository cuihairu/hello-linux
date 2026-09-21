# ACL 权限控制

ACL（Access Control List）提供比传统权限更细粒度的访问控制，可以为特定用户或组设置权限。

> 内容参考自 Arch Wiki，见文末参考资料。

## 1. 为什么需要 ACL

传统权限只能设置所有者、所属组和其他人三类权限。ACL 可以为任意用户或组单独设置权限。

## 2. 查看 ACL

```bash
getfacl file.txt
```

输出示例：
```
# file: file.txt
# owner: user
# group: group
user::rw-
user:guest:rw-
group::r--
mask::rw-
other::r--
```

## 3. 设置 ACL

```bash
# 为用户设置权限
setfacl -m u:username:rw file.txt

# 为组设置权限
setfacl -m g:groupname:r file.txt

# 递归设置
setfacl -R -m u:username:rw directory/

# 设置默认 ACL（新建文件继承）
setfacl -m d:u:username:rw directory/
```

## 4. 删除 ACL

```bash
# 删除特定用户 ACL
setfacl -x u:username file.txt

# 删除所有 ACL
setfacl -b file.txt
```

## 5. 备份与恢复

```bash
# 备份
getfacl -R directory/ > acl_backup.txt

# 恢复
setfacl --restore=acl_backup.txt
```

## 参考资料

- `man getfacl`、`man setfacl`
- Arch Wiki - Access Control Lists — [wiki.archlinux.org](https://wiki.archlinux.org/title/Access_Control_Lists)
