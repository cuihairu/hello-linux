# 磁盘配额

## 学习目标

- 理解磁盘配额的概念和作用
- 掌握磁盘配额的设置方法
- 了解磁盘配额的管理命令

## 1. 磁盘配额简介

磁盘配额用于限制用户或组可以使用的磁盘空间。

### 1.1 配额类型

- **用户配额**：限制单个用户的磁盘使用
- **组配额**：限制组的磁盘使用
- **软限制**：可以暂时超过，但会有警告
- **硬限制**：绝对不能超过

### 1.2 适用场景

- 共享服务器
- 多用户系统
- 云服务器

## 2. 配置磁盘配额

### 2.1 启用配额支持

```bash
# 编辑 /etc/fstab
sudo vim /etc/fstab

# 添加 usrquota 和 grpquota 选项
/dev/sda1 /home ext4 defaults,usrquota,grpquota 0 2

# 重新挂载
sudo mount -o remount /home
```

### 2.2 安装配额工具

```bash
# Debian/Ubuntu
sudo apt install quota

# RHEL/CentOS
sudo yum install quota
```

### 2.3 初始化配额

```bash
# 创建配额文件
sudo quotacheck -cugm /home

# 启用配额
sudo quotaon /home

# 查看配额状态
sudo quotaon -p /home
```

## 3. 配额管理命令

### 3.1 edquota - 编辑配额

```bash
# 编辑用户配额
sudo edquota -u username

# 编辑组配额
sudo edquota -g groupname

# 编辑宽限时间
sudo edquota -t
```

### 3.2 quota - 查看配额

```bash
# 查看当前用户配额
quota

# 查看指定用户配额
sudo quota -u username

# 查看组配额
sudo quota -g groupname
```

### 3.3 repquota - 配额报告

```bash
# 生成配额报告
sudo repquota /home

# 生成详细报告
sudo repquota -a
```

### 3.4 quotaoff - 禁用配额

```bash
# 禁用配额
sudo quotaoff /home

# 禁用所有配额
sudo quotaoff -a
```

## 4. 配额配置示例

### 4.1 用户配额示例

```bash
# 编辑用户配额
sudo edquota -u username

# 输出示例
# Filesystem    blocks    soft    hard    inodes    soft    hard
# /dev/sda1     102400    500000  600000  1000      0       0
```

- **blocks**：已使用的磁盘块数
- **soft**：软限制（块数）
- **hard**：硬限制（块数）
- **inodes**：已使用的 inode 数
- **soft**：软限制（inode 数）
- **hard**：硬限制（inode 数）

### 4.2 批量设置配额

```bash
# 复制用户配额
sudo edquota -p username1 username2 username3

# 使用脚本批量设置
for user in user1 user2 user3; do
    sudo edquota -u $user <<EOF
/dev/sda1 0 500000 600000 0 0 0
EOF
done
```

## 5. 配额警告

### 5.1 warnquota - 发送警告

```bash
# 配置警告邮件
sudo vim /etc/warnquota.conf

# 发送警告
sudo warnquota
```

### 5.2 自动警告

```bash
# 编辑 crontab
sudo crontab -e

# 添加定时任务
0 2 * * 0 /usr/sbin/warnquota
```

## 6. 配额维护

### 6.1 修复配额

```bash
# 检查配额一致性
sudo quotacheck -cugm /home

# 强制检查
sudo quotacheck -cugmf /home
```

### 6.2 查看配额日志

```bash
# 查看配额日志
sudo quotastats

# 查看内核配额统计
cat /proc/sys/fs/quota
```

## 7. 两系差异

| 方面 | Debian/Ubuntu | RHEL/CentOS |
|------|---------------|-------------|
| 包名 | quota | quota |
| 配置文件 | /etc/fstab | /etc/fstab |
| 命令 | 相同 | 相同 |

## 参考资料

- [鸟哥的私房菜 - 磁盘配额](https://linux.vbird.org/linux_basic/0410accountmanager.php#quota)
- [Arch Wiki - Disk quota](https://wiki.archlinux.org/title/Disk_quota)
