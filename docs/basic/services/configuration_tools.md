# 系统配置工具

Linux 提供多种工具管理系统配置。

> 内容参考自 Arch Wiki 和各工具文档，见文末参考资料。

## 1. 网络配置

### Netplan（Ubuntu）

```yaml
# /etc/netplan/01-netcfg.yaml
network:
  version: 2
  ethernets:
    eth0:
      dhcp4: true
```

```bash
sudo netplan apply
```

### NetworkManager

```bash
nmcli connection show
nmcli device status
nmtui   # 文本界面
```

## 2. 时间配置

```bash
# 查看时间
timedatectl

# 设置时区
sudo timedatectl set-timezone Asia/Shanghai

# 启用 NTP
sudo timedatectl set-ntp true
```

## 3. 主机名

```bash
# 查看
hostnamectl

# 设置
sudo hostnamectl set-hostname my-server
```

## 4. 防火墙

```bash
# ufw (Debian/Ubuntu) —— 先放行 SSH 再启用，避免远程锁死
sudo ufw allow 22/tcp
sudo ufw enable
sudo ufw status

# firewalld (RHEL/CentOS)
sudo firewall-cmd --add-port=22/tcp --permanent
sudo firewall-cmd --reload
```

## 5. SELinux

```bash
# 查看状态
getenforce
sestatus

# 临时关闭
sudo setenforce 0
```

## 参考资料

- Arch Wiki - System maintenance — [wiki.archlinux.org](https://wiki.archlinux.org/title/System_maintenance)
- `man timedatectl`、`man hostnamectl`、`man nmcli`
