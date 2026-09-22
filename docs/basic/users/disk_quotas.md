# 磁盘配额

磁盘配额用于限制用户或组可以使用的磁盘空间，防止单个用户占用过多资源。

> 内容参考自 Arch Wiki，见文末参考资料。

## 1. 启用配额

### 编辑 /etc/fstab

```bash
# 添加 usrquota,grpquota 选项
/dev/sda1  /home  ext4  defaults,usrquota,grpquota  0  2
```

### 安装工具

```bash
sudo apt install quota      # Debian/Ubuntu
sudo yum install quota      # RHEL/CentOS
```

### 初始化

```bash
# 修改 fstab 后必须先重新挂载，否则 quotacheck 会失败
sudo mount -o remount /home

sudo quotacheck -cugm /home
sudo quotaon /home
```

## 2. 设置配额

```bash
# 编辑用户配额
sudo edquota -u username

# 输出示例
# Filesystem    blocks    soft    hard    inodes    soft    hard
# /dev/sda1     102400    500000  600000  1000      0       0
```

- **soft**：软限制，可以暂时超过
- **hard**：硬限制，绝对不能超过

## 3. 查看配额

```bash
# 查看当前用户
quota

# 查看指定用户
sudo quota -u username

# 生成报告
sudo repquota /home
```

## 4. 批量设置

```bash
# 复制配额到其他用户
sudo edquota -p user1 user2 user3
```

## 参考资料

- `man edquota`、`man quota`、`man quotacheck`
- Arch Wiki - Disk quota — [wiki.archlinux.org](https://wiki.archlinux.org/title/Disk_quota)
