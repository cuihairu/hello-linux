# 账号管理

Linux 通过用户和组机制管理权限。每个进程都以特定用户身份运行。

> 内容参考自 Arch Wiki 和 man 手册，见文末参考资料。

## 1. 用户类型

| 类型 | UID | 说明 |
|------|-----|------|
| root | 0 | 超级用户 |
| 系统用户 | 1-999 | 系统服务使用 |
| 普通用户 | 1000+ | 日常使用 |

## 2. 配置文件

```bash
# 用户信息
cat /etc/passwd
# 格式：用户名:密码:UID:GID:注释:主目录:Shell

# 用户密码（需 root）
sudo cat /etc/shadow

# 组信息
cat /etc/group
```

## 3. 用户管理命令

```bash
# 创建用户
sudo useradd -m -s /bin/bash username

# 设置密码
sudo passwd username

# 修改用户
sudo usermod -aG groupname username   # 添加到附加组
sudo usermod -s /bin/zsh username     # 修改 Shell

# 删除用户
sudo userdel -r username              # 删除用户和主目录
```

## 4. 组管理命令

```bash
# 创建组
sudo groupadd groupname

# 删除组
sudo groupdel groupname

# 查看用户所属组
groups username
id username
```

## 5. 用户切换

```bash
# 切换到 root
sudo su

# 切换到其他用户
su - username

# 以其他用户执行命令
sudo -u username command
```

## 6. sudo 配置

```bash
# 编辑 sudoers 文件
sudo visudo

# 添加用户到 sudo 组
sudo usermod -aG sudo username     # Debian/Ubuntu
sudo usermod -aG wheel username    # RHEL/CentOS
```

## 参考资料

- `man useradd`、`man passwd`、`man sudoers`
- Arch Wiki - Users and groups — [wiki.archlinux.org](https://wiki.archlinux.org/title/Users_and_groups)
