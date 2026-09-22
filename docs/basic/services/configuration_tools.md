# 系统配置工具

Linux 提供多种工具管理系统配置。绝大多数系统级配置最终都落在纯文本文件上，图形界面只是生成这些文本的前端——理解这一点，才能在没有显示器的服务器上从容配置一切。

> 内容参考自 Arch Wiki 与各工具官方文档，见文末参考资料。

## 1. 文本配置的哲学：为什么不用 GUI

Windows 时代养成的习惯是"改配置就打开设置面板"，Linux 则坚持**一切配置皆文本**。这不是审美偏好，而是运维工程的必然选择：

- **可审计**：`diff old.conf new.conf` 一眼看出改了什么，GUI 点了哪些勾则无从追溯。
- **可复现**：同一份 YAML/INI 拷到一百台机器，配置完全一致；GUI 点出来的状态因人而异。
- **可远程**：SSH 连上去 `vim` 五分钟完成的修改，要求先装桌面环境是不现实的。
- **可纳入版本管理**：配置文件放进 Git，变更历史、回滚、代码评审全部免费获得。

GUI 并非一无是处：初次探索某项功能时，图形界面能快速呈现"有哪些可选项"；`nmtui`、`netplan try` 这类半交互工具也常用于避免把远程网络配断。正确的姿势是：**用 GUI/交互工具探索，用文本文件固化**。本文介绍的三个网络方案（Netplan、systemd-networkd、nmcli）全部以文本为最终事实来源。

## 2. 三发行版网络配置对照

网络是装机后第一件必须配置的事，也是三系差异最大的地方。先看结论：

| 方案 | 主要发行版 | 配置位置 | 应用方式 | 适用场景 |
|------|-----------|---------|---------|---------|
| Netplan | Debian/Ubuntu | `/etc/netplan/*.yaml` | `sudo netplan apply` | 声明式 YAML，后端可选 networkd 或 NetworkManager |
| systemd-networkd | Arch（服务器）、可被 Netplan 用作后端 | `/etc/systemd/network/*.network` | `systemctl restart systemd-networkd` | 纯 systemd 栈，无额外依赖 |
| NetworkManager（nmcli） | RHEL/CentOS/Rocky、Arch（桌面）、Ubuntu 桌面 | `/etc/NetworkManager/system-connections/` | `nmcli connection up ...` | 桌面漫游、Wi-Fi、VPN，也适合服务器 |

三者互斥程度不高但**同一只网卡只能由一个管理者接管**，同时跑两个 DHCP 客户端会互相覆盖路由和 DNS，这是网络配置第一大坑。

### 2.1 Netplan（Debian/Ubuntu）

Netplan 本身不管理网卡，它读取 YAML 后**渲染**出 systemd-networkd 或 NetworkManager 的原生配置：

```yaml
# /etc/netplan/01-netcfg.yaml
network:
  version: 2
  renderer: networkd        # 服务器常用；桌面可改为 NetworkManager
  ethernets:
    enp3s0:
      dhcp4: true
    enp3s0-1:
      addresses: [192.168.10.5/24]
      routes:
        - to: default
          via: 192.168.10.1
      nameservers:
        addresses: [223.5.5.5, 114.114.114.114]
```

```bash
$ sudo netplan generate      # 只生成后端配置，不生效（安全检查用）
$ sudo netplan try           # 应用并在 120 秒无确认时自动回滚——远程必用
$ sudo netplan apply         # 立即应用（配错会断网，请先 try）
$ sudo netplan status        # 查看当前生效状态（Ubuntu 22.04+）
```

**坑**：YAML 缩进敏感，两个空格起步、禁止 Tab；远程会话改网络务必用 `netplan try` 而不是 `apply`，给自己留 120 秒后悔药。

### 2.2 systemd-networkd（Arch 服务器 / Netplan 后端）

配置文件是类 unit 的 INI 格式，按文件名字典序加载，`/etc` 覆盖 `/usr/lib`：

```ini
# /etc/systemd/network/20-wired.network
[Match]
Name=enp3s0

[Network]
DHCP=yes
# 静态地址示例：
# Address=192.168.10.5/24
# Gateway=192.168.10.1
# DNS=223.5.5.5
```

```bash
$ sudo systemctl enable --now systemd-networkd
$ networkctl status enp3s0     # 查看链路与地址状态
$ networkctl                   # 列出全部接口
```

Arch 官方安装介质装出来的最小系统往往尚未配置网络管理器；用 `pacman -S networkmanager` 或直接启用 `systemd-networkd` 二选一即可，装完同样要 `systemctl enable --now`。

### 2.3 nmcli（RHEL/CentOS/Rocky 默认）

RHEL 系默认由 NetworkManager 管网，`nmcli` 是它的命令行前端，也是三系里唯一能完整管理 Wi-Fi/VPN/移动宽带的工具：

```bash
$ nmcli device status
DEVICE  TYPE      STATE      CONNECTION
enp3s0  ethernet  connected  System eth0
lo      loopback  unmanaged  --

$ nmcli connection show
NAME         UUID                                  TYPE      DEVICE
System eth0  5fb07b73-9c18-4e4a-b2f3-7a3e9c2d1b40  ethernet  enp3s0

# 修改连接：设为 DHCP
$ sudo nmcli connection modify "System eth0" ipv4.method auto

# 手动改 IP 后需要 down/up 才生效
$ sudo nmcli connection down "System eth0" && sudo nmcli connection up "System eth0"

# 交互式编辑器（nmtui 之外的另一种选择）
$ nmcli connection edit "System eth0"
```

文本事实来源在 `/etc/NetworkManager/system-connections/`（keyfile 格式，权限 600），但**不建议直接编辑后重启服务**，用 `nmcli` 修改再 `nmcli connection reload` 更不容易写出非法文件。临时命令行界面用 `nmtui`。

RHEL 8 及更早常见 `/etc/sysconfig/network-scripts/ifcfg-*` 旧格式，RHEL 9 起新装默认 keyfile；无论哪种，`nmcli` 都是统一入口，脚本里优先用 `nmcli` 而不是 sed 配置文件。

## 3. 时间配置（timedatectl）

三系统一使用 systemd 的 `timedatectl`，时区与 NTP 一条命令搞定。时间不准会导致 TLS 证书校验失败、日志时间错乱、定时任务错峰，属于装机必查项：

```bash
$ timedatectl
               Local time: Tue 2026-09-22 10:30:41 CST
           Universal time: Tue 2026-09-22 02:30:41 UTC
                 RTC time: Tue 2026-09-22 02:30:41
                Time zone: Asia/Shanghai (CST, +0800)
System clock synchronized: yes
              NTP service: active
          RTC in local TZ: no

$ sudo timedatectl set-timezone Asia/Shanghai
$ sudo timedatectl set-ntp true      # 开启 NTP 同步
$ timedatectl list-timezones | grep Shanghai   # 查可用时区
```

RHEL 系实际跑的 NTP 守护进程多为 `chronyd`，Debian/Ubuntu 为 `systemd-timesyncd` 或 `ntp`/`chrony`，Arch 默认 `systemd-timesyncd`——但上层入口都是 `timedatectl set-ntp`，不必关心底层是谁。查看同步详情：chrony 环境用 `chronyc tracking`，通用入口用 `timedatectl timesync-status`。

## 4. 主机名（hostnamectl）

```bash
$ hostnamectl
 Static hostname: web01.example.com
       Icon name: computer-vm
         Chassis: vm
      Machine ID: 8f3a1c2e9b4d4a6e8c1f5d7b9e2a3c4d
        Boot ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890
Operating System: Debian GNU/Linux 12 (bookshelf)
          Kernel: Linux 6.1.0-13-amd64
    Architecture: x86-64

$ sudo hostnamectl set-hostname web01.example.com
```

`set-hostname` 会同步写 `/etc/hostname` 与 `/etc/hosts` 的相关条目（各发行版实现略有差异）。改完后新开的 shell/服务才看到新名字，运行中的进程不受影响。三系命令一致。

## 5. DNS 解析（resolvectl）

systemd-resolved 接管 DNS 后，`/etc/resolv.conf` 往往是指向 `/run/systemd/resolve/` 的符号链接，直接编辑会在下次网络变更时被覆盖——这是"改了 DNS 却不生效"的标准原因：

```bash
$ resolvectl status        # 查看各链路 DNS 与全局状态
$ resolvectl query example.com   # 测试解析（走 systemd-resolved 缓存）
$ resolvectl flush-caches  # 清空缓存
```

要固化 DNS，请在 Netplan 的 `nameservers`、`.network` 的 `DNS=` 或 nmcli 的 `ipv4.dns` 里配置，而不是手改 `resolv.conf`。未启用 systemd-resolved 的系统（部分 Debian/Ubuntu 版本仍直接管理 resolv.conf）则编辑 `/etc/resolv.conf` 即可——先用 `ls -l /etc/resolv.conf` 判断是文件还是链接。

## 6. 常见坑

1. **两套网络管理器打架**：NetworkManager 与 systemd-networkd 同时 enable 会导致 DHCP 互相覆盖。用 `systemctl --type=service | grep -E 'NetworkManager|networkd'` 检查，同一时间只留一个。
2. **远程改网络用 `apply` 断线**：Netplan 用 `netplan try`；nmcli 先 `connection clone` 一份可回滚的配置；systemd-networkd 改完先确认配置文件语法再 restart。
3. **配置文件改了没生效**：Netplan 要 `apply`；networkd 要 `restart systemd-networkd`；nmcli 修改连接后要 `down`+`up` 该连接。改文件 ≠ 生效。
4. **YAML 缩进/引号错误**：Netplan 用空格缩进，地址要加引号写成 `"192.168.10.5/24"` 的形式更稳妥（部分解析器对裸值敏感）；改完先 `netplan generate` 验证。
5. **手工编辑 NM 连接文件损坏**：`/etc/NetworkManager/system-connections/` 权限必须 600、格式非法会导致 NetworkManager 拒绝加载。优先用 `nmcli`，改完 `nmcli connection reload`。
6. **时区对了但时间不对**：`set-timezone` 只改时区；时钟不同步要 `set-ntp true` 并确认 `System clock synchronized: yes`，否则证书与日志仍会出问题。
7. **防火墙与 SELinux 不在本节范围**：三系默认防火墙差异见[系统服务管理](./system_services.md)，规则配置见[网络篇](../../network/firewall.md)，SELinux/AppArmor 见[安全基础](../security.md)。

## 参考资料

- Arch Wiki - Network configuration — [wiki.archlinux.org](https://wiki.archlinux.org/title/Network_configuration)
- Arch Wiki - systemd-networkd — [wiki.archlinux.org](https://wiki.archlinux.org/title/Systemd-networkd)
- Arch Wiki - NetworkManager — [wiki.archlinux.org](https://wiki.archlinux.org/title/NetworkManager)
- Netplan 官方文档 — [netplan.io](https://netplan.io/)
- `man timedatectl`、`man hostnamectl`、`man nmcli`、`man networkctl`
- timedatectl 手册页 — [man7.org](https://man7.org/linux/man-pages/man1/timedatectl.1.html)
- hostnamectl 手册页 — [man7.org](https://man7.org/linux/man-pages/man1/hostnamectl.1.html)
