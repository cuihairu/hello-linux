# 账号管理

## 学习目标

- 理解 Linux 用户和组的概念
- 掌握用户和组的管理命令
- 了解用户配置文件

## 1. 用户基础

### 1.1 用户类型

| 类型 | UID 范围 | 说明 |
|------|---------|------|
| root | 0 | 超级用户 |
| 系统用户 | 1-999 | 系统服务使用 |
| 普通用户 | 1000+ | 日常使用 |

### 1.2 用户配置文件

```bash
# 用户信息
/etc/passwd

# 格式
用户名:密码:UID:GID:注释:主目录:Shell

# 示例
root:x:0:0:root:/root:/bin/bash
user:x:1000:1000:User:/home/user:/bin/bash
```

```bash
# 用户密码
/etc/shadow

# 格式
用户名:加密密码:最后修改:最小间隔:最大间隔:警告期:失效期:保留

# 示例
root:$6$...:19000:0:99999:7:::
```

## 2. 用户管理命令

### 2.1 useradd - 创建用户

```bash
# 基本创建
sudo useradd username

# 指定参数
sudo useradd -m -s /bin/bash -g groupname username

# 常用参数
-m    # 创建主目录
-s    # 指定 Shell
-g    # 指定主组
-G    # 指定附加组
-d    # 指定主目录路径
-e    # 指定过期日期
-c    # 添加注释
```

### 2.2 usermod - 修改用户

```bash
# 修改 Shell
sudo usermod -s /bin/zsh username

# 添加到附加组
sudo usermod -aG groupname username

# 修改主目录
sudo usermod -d /new/home username

# 锁定用户
sudo usermod -L username

# 解锁用户
sudo usermod -U username

# 修改过期日期
sudo usermod -e 2025-12-31 username
```

### 2.3 userdel - 删除用户

```bash
# 删除用户
sudo userdel username

# 删除用户及其主目录
sudo userdel -r username
```

### 2.4 passwd - 设置密码

```bash
# 修改当前用户密码
passwd

# 修改其他用户密码（root）
sudo passwd username

# 锁定用户
sudo passwd -l username

# 解锁用户
sudo passwd -u username

# 查看密码状态
sudo passwd -S username
```

## 3. 组管理

### 3.1 组配置文件

```bash
# 组信息
/etc/group

# 格式
组名:密码:GID:组成员

# 示例
root:x:0:
user:x:1000:user
```

### 3.2 groupadd - 创建组

```bash
# 创建组
sudo groupadd groupname

# 指定 GID
sudo groupadd -g 1001 groupname
```

### 3.3 groupmod - 修改组

```bash
# 修改组名
sudo groupmod -n newname oldname

# 修改 GID
sudo groupmod -g 1002 groupname
```

### 3.4 groupdel - 删除组

```bash
# 删除组
sudo groupdel groupname
```

## 4. 用户信息查询

```bash
# 查看当前用户
whoami

# 查看用户信息
id username

# 查看当前登录用户
who

# 查看用户登录历史
last

# 查看用户最近登录
lastlog
```

## 5. 用户切换

```bash
# 切换到 root
sudo su

# 切换到指定用户
su - username

# 以其他用户执行命令
sudo -u username command

# 保持当前环境
su username
```

## 6. 两系差异

| 方面 | Debian/Ubuntu | RHEL/CentOS |
|------|---------------|-------------|
| 默认 Shell | /bin/bash | /bin/bash |
| 用户创建 | useradd -m | useradd |
| sudo 配置 | /etc/sudoers | /etc/sudoers |
| root 密码 | 安装时设置 | 安装时设置 |

## 参考资料

- [鸟哥的私房菜 - 账号管理](https://linux.vbird.org/linux_basic/0410accountmanager.php)
- [Arch Wiki - Users and groups](https://wiki.archlinux.org/title/Users_and_groups)
