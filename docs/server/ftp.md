# FTP 服务器

FTP（File Transfer Protocol，RFC 959）是互联网上最早一批应用层协议之一，用一对 TCP 连接完成文件的列出、上传与下载。它的历史地位毋庸置疑，但在今天的生产环境里，主流选择已经悄悄换成了跑在 SSH 上的 SFTP，原因并不玄学：FTP 的控制连接全程明文，`USER`/`PASS` 在网络上裸奔；一次会话要同时占用 21 端口、20 端口（主动模式）或一段十位数的被动端口，防火墙与 NAT 的规则随之膨胀；它还没有会话加密、审计与细粒度授权的现代语义。于是"新系统直接 SFTP，只有遇到必须兼容的旧客户端、匿名分发目录时才部署 FTP"成了常见工程决策。本页仍然完整讲解 FTP 的工作原理与 vsftpd 部署——理解主动/被动模式的端口行为，对排查任何穿越防火墙的协议都大有裨益——并在需要时给出 Debian/Ubuntu（apt）、Arch（pacman）、RHEL/CentOS/Rocky（dnf）三系安装对照。本页按"工作原理 → 选型 → 三系安装 → vsftpd 配置 → 用户与场景 → 常见坑 → 日志排障 → 迁移 SFTP"展开。

> 内容参考自 vsftpd、ProFTPD 官方文档与 Arch Wiki，见文末参考资料。

## 学习目标

- 说清 FTP 控制连接与数据连接的分工，以及主动/被动模式各自适合的网络环境
- 理解生产环境转向 SFTP 的原因，能在 FTP 与 SFTP 之间做出有依据的选型
- 对比 vsftpd 与 ProFTPD 的定位差异，完成三发行版安装（apt / pacman / dnf）
- 配置被动端口范围、chroot 与 TLS，掌握虚拟用户方案
- 排查 PASV 地址错误、chroot 拒绝启动、LIST 断连等高频故障

## 1. FTP 如何工作：两条连接的学问

### 1.1 控制连接与数据连接

FTP 与众不同之处是把"命令"和"数据"拆到两条 TCP 连接上。客户端先连服务器的 **21 端口**（控制连接），所有交互命令——登录、`LIST`、`RETR`（下载）、`STOR`（上传）——都在这条连接上以文本发送；真正的文件字节流则走另一条**数据连接**。拆开的好处是传输大文件时仍能随时发 `ABOR` 中止，坏处是数据连接的建立方向有两种玩法，也就是主动与被动模式。

```text
主动模式（Active）：客户端 ≥1024 端口 ──21──▶ 服务器
                    服务器 20 端口 ──────▶ 客户端 ≥1024 端口（数据）
被动模式（Passive）：客户端 ≥1024 端口 ──21──▶ 服务器
                    客户端 ≥1024 端口 ──────▶ 服务器高位端口（数据）
```

主动模式要求**服务器主动连回客户端**。这在双方都公网直连的时代没问题，可一旦客户端躲在 NAT 或公司防火墙后面，入站 SYN 根本到不了它——于是列表卡住、下载超时，控制连接却"看起来正常"。被动模式把方向反过来：服务器先开好一个（或一段）高位端口，告诉客户端"你来连我"，客户端全部出站连接，天然穿透客户端侧的 NAT。今天的客户端默认几乎都是被动模式，服务器侧的代价是：**必须在防火墙上放行配置的被动端口范围**，否则控制连接正常、一传文件就挂。

### 1.2 为什么生产环境多转 SFTP

把 FTP 留在内网遗留系统、把新系统直接上 SFTP，是基于下面几点事实的常规判断，而不是跟风：

- **加密与凭据安全。** 标准 FTP 的密码与文件内容全部明文；FTPS（FTP over TLS）能加密，但要额外管理证书与又一批端口。SFTP 是 SSH 协议的一个子系统，一条 22 端口搞定认证、命令与数据，复用你多半已经加固过的 SSH。
- **防火墙与 NAT 友好。** SFTP 只有一个端口，不需要"被动端口段 + NAT 地址改写"这套组合拳；运维的心智负担从"FTP 为什么又抽风"变成普通的 SSH 访问控制。
- **权限模型。** SFTP 天然可以按 SSH 账户做限制（如 `ForceCommand internal-sftp` + chroot），而 FTP 虚拟用户需要额外的 PAM/数据库配置才达到同等效果。
- **生态现状。** 主流自动化工具、CI 与云存储网关对 SFTP 的支持已是标配；仍坚持 FTP 的多是行业遗留规范或客户指定的对接方式。

什么时候仍值得部署 FTP：面向公众的匿名只读分发（内核镜像站的经典场景）、必须对接只支持 FTP 的旧设备/旧客户端、以及已有大量 FTP 脚本且改造成本高的内部系统。决策时顺手确认一点：新上的 FTP 务必启用 TLS，并限制被动端口范围，别让"兼容旧协议"变成"裸奔的新风险"。

## 2. 选型：vsftpd 还是 ProFTPD

两者都是成熟的开源 FTP 服务器，定位略有不同：

| 维度 | vsftpd | ProFTPD |
|------|--------|---------|
| 设计取向 | 以安全和性能为先，代码量小，历史漏洞少 | 功能全面，配置风格类 Apache |
| 配置形态 | 单文件 `/etc/vsftpd.conf`，选项平铺 | 主配置 + 类 `.htaccess` 的目录级配置 |
| 典型用户 | 匿名大文件分发、追求最小攻击面的场景 | 需要复杂权限、目录级覆盖的托管场景 |
| TLS | 内建 `ssl_enable` | 内建 `mod_tls` |
| 虚拟用户 | PAM + 用户数据库 | 原生 SQL/LDAP 等多种后端 |

经验法则：没有特殊目录级需求时选 vsftpd——它的默认姿态更保守，社区资料也多；需要"每个目录自己一套规则"再考虑 ProFTPD。两者在三系发行版里都能直接装：Debian/Ubuntu 用 `apt install vsftpd` 或 `apt install proftpd-core`，Arch 用 `pacman -S vsftpd` 或 `pacman -S proftpd`，RHEL 系用 `dnf install vsftpd`。本页后续以 vsftpd 为主线，因为它的被动模式与 chroot 行为最具教学价值，也是多数发行版默认仓库里的首选。

## 3. 安装（三发行版对照）

下表汇总安装、查询与卸载命令，右列是 Arch 的 `pacman` 现实对照：

| 操作 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 安装 vsftpd | `sudo apt install vsftpd` | `sudo pacman -S vsftpd` | `sudo dnf install vsftpd` |
| 安装 ProFTPD | `sudo apt install proftpd-core` | `sudo pacman -S proftpd` | `sudo dnf install proftpd` |
| 搜索 | `apt search vsftpd` | `pacman -Ss ftp server` | `dnf search vsftpd` |
| 查看包信息 | `apt show vsftpd` | `pacman -Qi vsftpd` | `dnf info vsftpd` |
| 查看配置文件路径 | `dpkg -L vsftpd` | `pacman -Ql vsftpd` | `rpm -ql vsftpd` |
| 卸载 | `sudo apt remove vsftpd` | `sudo pacman -R vsftpd` | `sudo dnf remove vsftpd` |

Arch 侧请记住两条惯例：仓库包一律 `pacman -S` 安装、`pacman -Syu` 随系统滚动升级，不要用 `pacman -Sy` 单独同步数据库后装包；配置文件路径用 `pacman -Ql vsftpd` 查询，Debian 的 `dpkg -L` 与 RHEL 的 `rpm -ql` 是等价操作。安装前备份配置文件是三系通用的好习惯，Debian/Arch 的配置都在 `/etc/vsftpd.conf`，RHEL 系在 `/etc/vsftpd/vsftpd.conf`。

### 3.1 Debian/Ubuntu

```bash
$ sudo apt update && sudo apt install vsftpd
$ sudo cp /etc/vsftpd.conf /etc/vsftpd.conf.bak
$ sudo systemctl enable --now vsftpd
```

### 3.2 Arch

```bash
$ sudo pacman -Syu vsftpd
resolving dependencies...
Packages (1) vsftpd-3.0.7-1

:: Proceed with installation? [Y/n] y
(1/1) installing vsftpd                            [######################] 100%
$ sudo systemctl enable --now vsftpd
$ pacman -Ql vsftpd | grep -E 'vsftpd.conf|service'
vsftpd /etc/vsftpd.conf
vsftpd /usr/lib/systemd/system/vsftpd.service
```

Arch 的 `vsftpd` 包直接给出 `vsftpd.service` 单元与 `/etc/vsftpd.conf`，匿名根目录默认是 `/srv/ftp`（与 FHS 对 `/srv` 的定位一致）。升级时跟随 `pacman -Syu` 即可；若只要刷新这一包，也请用完整依赖的 `pacman -S vsftpd` 触发重装，而不是绕过依赖管理器手动解压二进制。

### 3.3 RHEL/CentOS/Rocky

```bash
$ sudo dnf install vsftpd
$ sudo cp /etc/vsftpd/vsftpd.conf /etc/vsftpd/vsftpd.conf.bak
$ sudo systemctl enable --now vsftpd
```

验证服务与端口（三系相同的验收标准）：

```bash
$ systemctl is-active vsftpd
active
$ ss -tlnp | grep vsftpd
LISTEN 0 128 0.0.0.0:21 0.0.0.0:* users:(("vsftpd",pid=812,fd=3))
```

## 4. vsftpd 核心配置

### 4.1 基本开关

`/etc/vsftpd.conf`（RHEL 为 `/etc/vsftpd/vsftpd.conf`）里，决定"能不能用"的是少数几个开关。改完执行 `systemctl restart vsftpd` 生效——vsftpd 不会热加载配置。

```ini
listen=YES                    # 独立进程模式；用 xinetd 托管时须改 NO
anonymous_enable=NO           # 匿名访问默认应关闭
local_enable=YES              # 允许本地用户登录
write_enable=YES              # 允许执行 STOR/DELE 等写命令
local_umask=022               # 上传文件的权限掩码
chroot_local_user=YES         # 把本地用户锁在各自家目录
allow_writeable_chroot=NO     # 见下文"常见坑"，勿轻易改 YES
xferlog_enable=YES            # 传输日志
use_localtime=YES             # 目录时间用本地时区
```

`chroot_local_user=YES` 是权限收敛的关键：没有它，用户登录后 `cd /etc` 就能看到整台服务器的文件树。锁进家目录之后，用户视角的 `/` 就是他的家，这是 FTP 服务器最基本的隔离。

### 4.2 被动模式端口：必须与防火墙说好同一种语言

被动模式默认会在 1024 以上**随机**开端口，防火墙没法逐个放行，所以要把范围钉死，并告知客户端公网地址：

```ini
pasv_enable=YES
pasv_min_port=10000
pasv_max_port=10100
pasv_address=203.0.113.10      # 服务器公网 IP；域名可用 pasv_addr_resolve=YES
```

端口段选多大？每个并发数据连接吃一个端口，`max_per_ip=5` 的服务器 100 个端口足够；范围过宽会放大扫描面。防火墙只需放行 21 与此段——完整的 nftables/firewalld 写法属于通用防火墙知识，见[防火墙篇](../security/firewall.md)，这里不重复展开。注意云环境还有**安全组**一层：只在主机 iptables 放行而忘了安全组，症状与防火墙拦截完全一样。

`pasv_address` 在 NAT 后面是必需的：若不写，服务器会把自己的内网 IP 写进 `227 Entering Passive Mode (192,168,1,10,...)` 应答，客户端拿着这个地址连当然超时。判断方法是用客户端看 PASV 应答里的 IP 是否为公网地址。

### 4.3 启用 TLS

控制通道加密解决"密码明文"问题。先准备证书（生产用 CA 签发的证书，测试可自签）：

```bash
$ sudo openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout /etc/ssl/private/vsftpd.pem -out /etc/ssl/private/vsftpd.pem
```

```ini
ssl_enable=YES
allow_anon_ssl=NO
force_local_logins_ssl=YES
force_local_data_ssl=YES
rsa_cert_file=/etc/ssl/private/vsftpd.pem
rsa_private_key_file=/etc/ssl/private/vsftpd.pem
```

`force_local_logins_ssl=YES` 之后，未加密登录会被拒绝；老客户端若因此连不上，先确认它是否支持 FTPS，而不是急着把加密关掉。

## 5. 用户管理

### 5.1 本地用户与目录权限

给 Web 上传等场景建专用系统用户，比共享 root 或公共账户干净得多：

```bash
$ sudo useradd -m -s /usr/sbin/nologin ftpupload
$ sudo passwd ftpupload
$ sudo chown -R ftpupload:ftpupload /var/www/html
```

结合 `chroot_local_user=YES` 与 `local_root`/`user_sub_token`，可以让每个用户看到独立目录。注意家目录本身不可写的要求（见常见坑），上传目录应是家目录下的子目录并单独授权。

### 5.2 虚拟用户：三种发行版的现实差异

虚拟用户把"FTP 账号"与"系统账号"解耦——账号存在数据库/文件里，登录后统一映射到一个低权限系统用户，即使泄露也无法 SSH 上机。但三系的 PAM 生态不同，方案必须分开说，照抄跨发行版教程会直接失败：

- **Debian/Ubuntu**：`db-util` 提供 `db_load`，可把明文账号文件转成 `pam_userdb` 认读的 `.db` 数据库；PAM 配置 `auth required pam_userdb.so db=/etc/vsftpd/virtual_users`。
- **Arch**：当前 PAM 不再自带 `pam_userdb.so`，Arch Wiki 的推荐路线是 `libpam_pwdfile` + `htpasswd` 生成密码文件，PAM 写 `auth required pam_pwdfile.so pwdfile /etc/vsftpd/.passwd`。别在 Arch 上照搬 Debian 的 `db_load` 教程。
- **RHEL/CentOS/Rocky**：与 Debian 同属 `pam_userdb` 路线，`db_load` 由 `libdb-utils` 提供（包名与 Debian 的 `db-util` 不同）。

Debian 上生成虚拟用户数据库的流程如下（其余发行版按上文换工具）：

```bash
$ sudo apt install db-util
$ printf 'user1\npass1\nuser2\npass2\n' | sudo tee /etc/vsftpd/virtual_users.txt
$ sudo db_load -T -t hash -f /etc/vsftpd/virtual_users.txt /etc/vsftpd/virtual_users.db
$ sudo chmod 600 /etc/vsftpd/virtual_users.db
```

vsftpd 侧启用 `guest_enable=YES`、`guest_username=ftpupload`（映射目标）、`pam_service_name=vsftpd_virtual`。密码文件权限务必收紧，否则等于把口令哈希暴露给本机所有用户。

## 6. 实战场景

**只读匿名镜像站**：`anonymous_enable=YES`、`anon_root=/srv/ftp`、保持 `write_enable` 对匿名关闭，配合 `anon_max_rate` 限速。匿名可写是重大配置错误——公开上传目录几乎必然被塞垃圾或当作攻击跳板。

**站点内容上传**：专用系统用户 + chroot + 仅子目录可写，再叠加 TLS 强制。上线前用真实客户端（curl、FileZilla）各测一遍被动模式，浏览器直接打开 `ftp://` 的行为不代表客户端兼容性。

```bash
$ curl -s ftp://user@203.0.113.10/ --user user:secret -o /dev/null -w '%{http_code}\n'
226   # 1xx/2xx 即控制会话成功；卡住无输出多半是 PASV 端口未放行
```

## 7. 常见坑

**`500 OOPS: refusing to run with writable root inside chroot()`，服务起不来或登录即断。** vsftpd 2.3.5 起禁止 chroot 目录本身可写（可写根目录会让用户跳出语义上的 jail）。正确修法是保持家目录 `555` 只读、在其下建 `upload/` 子目录 `750` 并交给用户；只有确认风险后才用 `allow_writeable_chroot=YES` 逃生，别把它当默认配置抄进生产。

**能登录，`pwd` 正常，一 `ls` 就掉线或超时。** 控制连接与数据连接是两条流：控制通、数据挂，九成是被动端口没放行（主机 firewalld/iptables 与云安全组各查一遍），或是 `pasv_address` 写成了内网 IP。主动模式下则反过来查客户端侧是否拦了服务器的入站 20 端口。

**客户端打印 `227 Entering Passive Mode (192,168,x,x,...)` 后卡死。** 就是上一条的 NAT 场景：在配置里写 `pasv_address` 公网 IP，或 `pasv_addr_resolve=YES` + 域名让服务器启动时解析。用 `tcpdump -i any -nn port 10000:10100` 能直接看到数据连接 SYN 是否到达主机。

**`LIST` 命令触发 GnuTLS/连接重置类错误。** 部分环境下 vsftpd 的沙箱与网络命名空间冲突，官方论坛与 Arch Wiki 归纳的缓解项是 `seccomp_sandbox=NO`（降低沙箱强度，改前先确认不是证书或防火墙问题）。IPv4/IPv6 混用时还须遵守 `listen` 与 `listen_ipv6` 互斥的约束，同时打开两者会报 `run two copies of vsftpd`。

**改了配置不生效。** vsftpd 无热加载：`systemctl restart vsftpd` 必做；改错配置它会直接退出，用 `journalctl -u vsftpd -e` 看最后几行。三系排查思路一致，Arch 用户重装验证可用 `pacman -S vsftpd` 覆盖本地改动（有本地修改时 `pacman` 会先提示冲突），Debian 对应 `apt reinstall vsftpd`，RHEL 对应 `dnf reinstall vsftpd`。

**部署顺序踩坑。** 先 `pacman -Syu`（或 `apt full-upgrade`、`dnf upgrade`）把系统与 vsftpd 升到当前版本，再改配置——拿着五年前的教程对今天的版本逐行核对，是 FTP 故障单里最常见的浪费。升级后用 `pacman -Ql vsftpd` 或对应工具复核配置文件路径有没有变，再对照[参考资料](https://wiki.archlinux.org/title/Very_Secure_FTP_Daemon)里的变更说明。

## 8. 日志与排障入口

```bash
# 传输日志（xferlog_enable=YES 时）
$ sudo tail -f /var/log/xferlog
Wed Sep 21 10:22:31 2026 1 192.168.1.50 /pub/iso.iso a _ o a0 ftp user 0 c /pub/iso.iso

# 协议级调试：临时打开 log_ftp_protocol=YES 后重启，能看到每条 FTP 命令
$ sudo journalctl -u vsftpd -f
```

排障顺序建议固定为：`systemctl status vsftpd` 确认进程 → `ss -tlnp` 确认 21 与被动段监听 → 本机 `curl ftp://127.0.0.1` 排除应用层 → 再上外部客户端复现。这样能把"服务没起、端口没开、模式不匹配、权限不够"四类问题一次分清。

## 9. 从 FTP 迁移到 SFTP

既然生产多转 SFTP，迁移怎么做才不翻车？分三步走。**第一步盘点**：用访问日志统计哪些客户端、哪些脚本在用 FTP，区分"活跃流量"与"僵尸配置"——很多 FTP 服务的真实用户只有两三个定时任务。**第二步双栈过渡**：OpenSSH 与 vsftpd 可以并行监听（22 与 21 端口不冲突），把支持 SFTP 的客户端先切过去，脚本侧把 `curl ftp://` 换成 `sftp://` 或 `scp`/`rsync -e ssh`，URL 语法几乎同构，改造量通常很小。**第三步收口**：确认日志里 FTP 会话归零后，`systemctl disable --now vsftpd`，再从防火墙撤掉 21 与被动端口段——只关服务不关防火墙不算完成，反之只关防火墙会让服务在监控里持续报错。

切换时权限映射要单独验证：FTP 虚拟用户映射到的系统账户，与 SFTP 的 `ChrootDirectory` 规则并不等价——OpenSSH 要求 chroot 目录及其各级父目录**必须**属主为 root 且不可写，用户可写区要放在 chroot 内的子目录里。这个约束与 vsftpd 拒绝可写 chroot 根的逻辑殊途同归，理解了"为什么 jail 根目录不能可写"（防止用户通过改权限间接逃逸），两套服务的配置就能一次配对，而不是每次出问题都重查手册。

迁移期间的验收很简单：`sftp -v user@host` 能完成认证与 `pwd`，`put`/`get` 各传一个测试文件，再核对权限位与属主是否与 FTP 时代一致。三发行版的 OpenSSH 都是基础组件，Debian 的 `openssh-server`、Arch 的 `openssh`（`pacman -S openssh`）、RHEL 的 `openssh-server` 装好即用，不需要引入任何第三方守护进程。

## 参考资料

- vsftpd 官方与 FAQ — [security.appspot.com/vsftpd.html](https://security.appspot.com/vsftpd.html)
- Arch Wiki: vsftpd — [wiki.archlinux.org/title/Very_Secure_FTP_Daemon](https://wiki.archlinux.org/title/Very_Secure_FTP_Daemon)
- ProFTPD 官方文档 — [proftpd.org/docs](https://proftpd.org/docs/)
- FTP 协议规范 — [RFC 959](https://tools.ietf.org/html/rfc959)
- RFC 2428（EPRT/EPSV，IPv6 下的 FTP 扩展）— [tools.ietf.org](https://tools.ietf.org/html/rfc2428)
