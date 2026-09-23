# 邮件服务器（Postfix）

邮件是互联网最古老仍大规模运转的协议族之一：SMTP 负责把信从一台主机投递到另一台，POP3/IMAP 负责把信从收件箱取到用户终端。Postfix 是高性能的邮件传输代理（MTA），设计目标只有一个——在不可信的公网环境下，安全、可靠地收发邮件。要回答"为什么自建邮件服务器"，先看现实约束：公司域名邮箱 `alice@corp.example` 想完全掌控投递日志与归档策略；内网设备告警要发到指定收件箱，不想把凭据交给第三方转发服务；或者邮件网关需要按内容策略做中继管控。但自建的代价同样要先说清楚——反垃圾、送达率、SPF/DKIM 对齐、IP 信誉这些事不会因为"装好了 Postfix"就自动完成，配置开放中继或忽略反向解析的服务器会在几小时内被各大邮箱服务商拉黑。本页按"为什么 → 角色与队列 → 三系安装 → 核心配置 → Dovecot → 反垃圾入门 → 常见坑"展开，安装部分给出 Debian/Ubuntu（apt）、Arch（pacman）、RHEL/CentOS/Rocky（dnf）三系对照；防火墙放行 25/587/993 见[防火墙篇](../../security/firewall.md)，不确定的策略细节本页不写。

> 内容参考自 Postfix 官方文档与 Arch Wiki，见文末参考资料。

## 学习目标

- 画清 MUA/MTA/MDA 分工，理解队列在投递中的角色
- 掌握三发行版安装（apt / pacman / dnf），读懂 postqueue -p 队列输出
- 配好 main.cf 核心参数与别名，验证 mydestination/mynetworks 边界
- 理解 SPF/DKIM/DMARC 各自防什么，能读懂 TXT 记录
- 识别开放中继、证书过期、队列堆积等高频故障并收敛

## 1. 邮件系统为什么分成这么多角色

### 1.1 MUA、MTA、MDA 的分工

一封邮件从写完到落进收件人邮箱，至少经过三类程序：**MUA**（邮件用户代理，如 Thunderbird/Outlook）负责撰写与展示；**MTA**（邮件传输代理，Postfix/Sendmail）负责在主机之间按 SMTP 协议接力投递；**MDA**（邮件投递代理，Dovecot/Procmail）负责把到达本机的信放进用户邮箱并供 IMAP/POP3 读取。Postfix 处于链条中段——它既监听 25 端口接收外来的信，也主动连对端 25 端口把信送出去；Dovecot 则站在用户侧，用 993/995 把信呈现给邮件客户端。

| 组件 | 职责 | 常见软件 | 典型端口 |
|------|------|----------|----------|
| MUA | 写信、读信 | Thunderbird、Outlook、mutt | 587/993（经 Dovecot） |
| MTA | 主机间投递 | Postfix、Sendmail | 25 |
| MDA | 落箱与取信 | Dovecot、Procmail | 143/993、110/995 |

这个分层不是学术洁癖，而是故障域切分：用户连不上收件箱，先查 Dovecot 与证书；外网投递被拒，先查 Postfix 队列与对端响应码；本机信发不出去堆积，看 `postqueue -p`。与系统里"包管理器管安装、systemd 管进程、日志子系统管留痕"的切分同理——邮件栈把"写、传、存"拆开，每一段才能独立升级、独立排障，而不会牵一发动全身。

### 1.2 队列：为什么"发送成功"不等于"对方已收"

Postfix 收到信后先写入队列再异步投递：进程崩溃、对端临时 4xx、DNS 解析失败都会让信留在队列里重试（默认最多约 5 天）。`postqueue -p` 就是查看这张待办清单的窗口，`postcat -q 队列ID` 可回放单封信的头信息与投递轨迹。队列存在的意义是把"瞬时故障"与"永久丢失"隔开——网络抖一下不必让用户重写邮件，但如果队列只进不出，往往意味着出站被拦（对端拒绝、DNS 无 MX、防火墙挡了 25），必须主动查因，而不是等它自己好转。类比包缓存：`pacman` 的下载缓存断网也能续传安装，邮件队列断网也能暂存重试，但两者都需要"事后确认真的落地"这一步，缓存命中不等于任务完成。

**开放中继是邮件服务器的第一大红线**：`mynetworks` 之外的客户端若能借你的服务器投递任意地址，你的 IP 会迅速被用来发垃圾邮件并进入黑名单。配置原则只有一条——`mynetworks` 只写信任网段，`smtpd_relay_restrictions` 保持"认证者与本机网段可转发，其余一律拒收未认证的外投请求"，改完用第三方中继测试工具或自建双机验证，而不是凭感觉上线。

## 2. 安装（三发行版对照）

| 操作 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 安装 | `apt install postfix` | `sudo pacman -S postfix` | `dnf install postfix` |
| 搜索 | `apt search postfix` | `pacman -Ss postfix` | `dnf search postfix` |
| 查看包信息 | `apt show postfix` | `pacman -Qi postfix` | `dnf info postfix` |
| 查看文件列表 | `dpkg -L postfix` | `pacman -Ql postfix` | `rpm -ql postfix` |
| 升级 | `apt upgrade` | `sudo pacman -Syu` | `dnf upgrade` |
| 卸载 | `apt remove postfix` | `sudo pacman -R postfix` | `dnf remove postfix` |
| 取信组件 | `apt install dovecot-imapd` | `pacman -S dovecot` | `dnf install dovecot` |

Debian 安装过程会弹 debconf 交互界面，选 "Internet Site" 并填入完全限定主机名（如 `mail.example.com`），它会预填 `myhostname`/`mydomain` 的初值——选错后面 `main.cf` 还要改，但至少有了起点。Arch 用户从官方 extra 仓库一条 `pacman -S postfix` 装齐，主配置即上游默认的 `/etc/postfix/main.cf`，无 debconf 环节，全部参数靠事后编辑，因此更要逐项核对第 3 节的清单。RHEL 系 `dnf install postfix` 后 unit 固定叫 `postfix`，日志进 `journalctl -u postfix` 或 `/var/log/maillog`（rsyslog 布局与 Debian 的 `/var/log/mail.log` 不同，排障时别在错误的路径下守着空文件）。三系升级语义一致：Debian/RHEL 走 `apt upgrade`/`dnf upgrade`，Arch 保持 `pacman -Syu` 滚动更新，升级后若有 `main.cf` 本地改动，确认包管理器的 `.pacnew`/dpkg conffile 提示，避免被上游默认覆盖——出问题时先 `pacman -Qmq` 式地问清"哪些是我手工改过的文件"，再决定回滚哪一份，比对着整份 main.cf 盲猜高效得多。

### 2.1 Debian/Ubuntu

```bash
$ sudo apt update
$ sudo apt install postfix mailutils
$ sudo dpkg-reconfigure postfix    # 未在安装时选型则补选 Internet Site
$ sudo systemctl enable --now postfix
$ sudo systemctl status postfix
● postfix.service - Postfix Mail Transport Agent
   Loaded: loaded (/lib/systemd/system/postfix.service; enabled)
   Active: active (running)
```

`mailutils` 提供本机 `mail` 命令，测试环回投递时不必先配好完整 MUA；`dpkg-reconfigure postfix` 可随时重跑选型向导，不必卸载重装。

### 2.2 Arch

```bash
$ sudo pacman -S postfix dovecot
resolving dependencies...
Packages (2) dovecot-2.3.x  postfix-3.8.x

Total Download Size:   8.73 MiB
:: Proceed with installation? [Y/n] y
(2/2) installing dovecot                         [######################] 100%
$ sudo systemctl enable --now postfix dovecot
$ postconf mail_version
mail_version = 3.8.x
```

Arch 上 Postfix 与 Dovecot 都在 extra，`pacman -S postfix dovecot` 一次装齐传输与取信两侧；`postconf mail_version` 是快速验证二进制与文档版本是否对得上的小技巧。若后续要做 DKIM 签名，对应软件同样来自仓库：`pacman -S opendkim`，与 Debian 的 `apt install opendkim`、RHEL 的 `dnf install opendkim` 职责完全相同，差别只在配置片段默认是否已 `include` 进主配置——Arch 惯例是改完 conf.d 片段后自己确认 include 链完整，`pacman -Ql opendkim` 可列出包铺设的全部默认文件。验证清单类文件时也别忘了 `pacman -Ql postfix` 对照出厂清单，升级前后各跑一次，能立刻发现 `.pacnew` 里丢了哪些自定义行——和 Debian 用 `dpkg -L postfix` 是同一把尺子。

### 2.3 RHEL/CentOS/Rocky

```bash
$ sudo dnf install postfix
$ sudo systemctl enable --now postfix
$ sudo alternatives --config mta    # 若系统存在多个 MTA，确保 postfix 胜出
$ postconf -n | head
```

`postconf -n` 输出"非默认即当前生效"的关键参数，是三系通用的配置体检入口——上线前把这份输出存进变更单，日后对比能立刻看出谁改了 `mynetworks` 或 `relayhost`。SELinux 环境下若自定义了证书/别名路径出现拒绝，用 `ausearch -m avc -ts recent` 确认上下文，再 `restorecon` 对齐，与 BIND 那边处理区域文件权限是同一套路。

## 3. 核心配置（main.cf）

### 3.1 必须核对的参数

```text
# /etc/postfix/main.cf
myhostname = mail.example.com
mydomain = example.com
myorigin = $mydomain
# 本机接收哪些目的地的信——域名写全，漏了会被拒收
mydestination = $myhostname, localhost.$mydomain, localhost, $mydomain
# 谁可以借道外投——只写信任网段，宁窄勿宽
mynetworks = 127.0.0.0/8, 192.168.1.0/24
inet_interfaces = all
inet_protocols = ipv4

message_size_limit = 52428800    # 50MB，按对端常见上限设防
mailbox_size_limit = 1073741824  # 1GB

alias_maps = hash:/etc/aliases
alias_database = hash:/etc/aliases
```

`mydestination` 决定"这台服务器认为自己是哪些域的终点"：本域用户互寄会本地落箱，写漏了域会把本应收下的信拒之门外或试图外投出去绕一圈。`mynetworks` 与 `relayhost` 一收一放：前者定义信任边界，后者定义"出站是否经企业网关"（办公室 IP 常被上游封 25，此时把 `relayhost = [smtp.corp.example]:587` 指到可信网关反而更稳）。改参用 `postconf -e '参数 = 值'` 比手工编辑更不易破坏语法，改完 `systemctl reload postfix` 生效——先写入、再校验、后生效的节奏，与改任何关键服务配置一致。

### 3.2 别名与本地投递

```text
# /etc/aliases
root: admin@example.com
postmaster: admin@example.com
webmaster: admin@example.com

$ sudo newaliases    # 别名文件是 db 格式，改完必须重建索引
```

RFC 要求每个对外域存在可投递的 `postmaster`，别名表正是把系统账号映射到真实邮箱的地方；`newaliases` 不跑，改动不会生效——与 `pacman` 装完包但未 `systemctl enable` 服务"装了却没跑"的坑如出一辙，都是"文件改了、索引/启用没跟上"。同理，Arch 上若用 `pacman -S` 装了 `postfix` 却忘了 `systemctl enable --now postfix`，端口同样不会有人监听；把"装、配、启、验"四步当固定动作清单执行，三系只是把第一步的动词换掉。

## 4. Dovecot：让用户把信取走

### 4.1 安装与关键配置

安装命令见第 2 节对照表；配置聚焦三件事——协议、邮箱位置、认证与 TLS：

```text
# /etc/dovecot/dovecot.conf
protocols = imap pop3

# /etc/dovecot/conf.d/10-mail.conf
mail_location = mbox:~/mail:INBOX=/var/mail/%u

# /etc/dovecot/conf.d/10-auth.conf
disable_plaintext_auth = yes
auth_mechanisms = plain login

# /etc/dovecot/conf.d/10-ssl.conf
ssl = required
ssl_cert = </etc/ssl/certs/mail.example.com.pem
ssl_key = </etc/ssl/private/mail.example.com.key
```

`mail_location` 必须与 Postfix 的落箱方式一致（mbox 对 mbox，Maildir 对 Maildir），两边各说各话时症状是"SMTP 显示投递成功、客户端收件箱却是空的"——信其实躺在另一种格式的目录里。`disable_plaintext_auth = yes` 与 `ssl = required` 保证凭据不走明文；证书可用 Let's Encrypt 或企业 CA，过期后 IMAPS/SMTPS 会直接握手失败，证书到期提醒应与系统补丁提醒进同一张值班表。Arch 上 Dovecot 为单包 `pacman -S dovecot`，Debian 拆成 `dovecot-core`/`dovecot-imapd`/`dovecot-pop3d` 多包，RHEL 为 `dovecot` 一包——装完都用 `systemctl enable --now dovecot` 起服务，再 `dovecot -n` 输出生效配置做验收，与 `postconf -n` 是同一把尺子。

## 5. SPF、DKIM、DMARC 入门

三者解决同一问题的不同侧面：**谁有权代表这个域发信**。SPF 在 DNS TXT 里列出允许发信的 IP/MX（`v=spf1 mx a:mail.example.com ip4:203.0.113.10 -all`），收件方比对信封来源；DKIM 用私钥对邮件头签名、公钥发布在 `mail._domainkey.example.com` 的 TXT 里，防篡改并建立域级信誉；DMARC 则告诉收件方"SPF/DKIM 都对不齐时怎么办"（`_dmarc.example.com` TXT，`p=quarantine` 或 `p=reject`），并提供 `rua` 聚合报告地址。配置顺序有讲究：先确保出站 IP 出现在 SPF 中、DKIM 签名稳定生效，最后再把 DMARC 从 `p=none` 观察模式逐步收紧到 `reject`——跳过观察期直接 `reject`，是对齐配置有误时最经典的"己方邮件被静默丢弃"事故。OpenDKIM 的密钥生成与权限收紧属于明确成熟的操作（`opendkim-genkey` 后限制目录属主），但筛选器选择、报告邮箱归档等策略因组织而异，本页只给方向，细节以官方文档与实测报告为准。

## 6. 测试与验证

```bash
# 本机队列与配置
$ postqueue -p
$ postconf -n
$ doveconf -n | head

# 端口与 SMTP 对话
$ nc -zv mail.example.com 25     # SMTP
$ nc -zv mail.example.com 587    # Submission
$ nc -zv mail.example.com 993    # IMAPS
$ telnet mail.example.com 25
220 mail.example.com ESMTP Postfix

# 环回投递与日志
$ echo "Test" | mail -s "Test Subject" postmaster
$ sudo tail -f /var/log/mail.log     # Debian 布局
# $ sudo journalctl -u postfix -f     # 或 RHEL 的 /var/log/maillog
```

`telnet`/`nc` 手工说 SMTP 是最直接的验收：看 220 横幅确认 Postfix 在答话，`EHLO`、`MAIL FROM`、`RCPT TO` 逐步走，对端返回码会精确告诉你卡在哪一层（550 多是地址/策略拒绝，4xx 是临时故障会进队列重试）。本机测试与外网测试要分开：环回成功只证明本地投递与别名链路通，送达 Gmail/QQ 等公网邮箱还依赖反向解析、SPF/DKIM 对齐、IP 信誉——后者只能靠真实外投加投递报告确认，没有捷径。

## 7. 常见坑

**开放中继 / 被列入黑名单。** 先 `postconf -n` 检查 `mynetworks` 是否被改成 `0.0.0.0/0` 或留有出厂占位；再用外部中继检测确认对外是否真的拒转。已进黑名单则按各 RBL 网站流程申请移除，同时堵住源头——队列里 `deferred` 的外投堆积、异常发信量都是旁证。防火墙与出站策略仍走[防火墙篇](../../security/firewall.md)统一流程，本页只解决"配置边界"。

**外网收不到信 / 端口不通。** 顺序排查：`nc -zv` 测 25 是否可达（云厂商默认常封出站 25，入站是否放行看防火墙）→ MX 记录是否指向本机且 A/AAAA 可解析 → `inet_interfaces` 是否监听了外网地址 → `mydestination` 是否包含目标域。DNS 侧细节见[DNS 篇](../dns/bind.md)，两篇的交界点是 MX 与 PTR：MX 错信根本到不了，PTR 错信到得了但外投信誉差。

**队列只增不减。** `postqueue -p` 看积压对象，`postcat` 看单封投递日志；`deferred` 多指向对端 4xx、DNS 或证书问题，`active` 卡住则怀疑出站连接被拦。确认根因前不要盲目 `postqueue -f` 强投——对端若在限流，强投只会延长退避；查清后按需 `postsuper -d` 删除废信或等待重试窗口。

**改了 main.cf 不生效。** Postfix 读的是"编译后"的配置：手工编辑后要 `postfix reload`/`systemctl reload postfix`，用 `postconf -e` 写入后同样要 reload；`postconf -n` 与文件不一致说明改错文件或没 reload。别名忘记 `newaliases`、DKIM 忘记重启 OpenDKIM，都属于"文件改了、生效步骤漏了"的同一类失误。

**Dovecot 证书/权限导致收信失败。** `dovecot -n` 确认 `ssl` 与路径生效；`ls -l` 查证书私钥是否可被 dovecot 用户读取（常是 Let's Encrypt 续期后权限被重置）；邮箱目录属主不对时症状为登录成功但列表为空或写入报错。排障入口固定为：先 `doveconf -n` 看配置，再 `journalctl -u dovecot -e` 看拒绝原因——与 Postfix 侧"先 postconf -n、再看日志"完全对称。

## 参考资料

- Postfix 官方文档 — [postfix.org](http://www.postfix.org/documentation.html)
- Postfix 配置参考 — [postfix.org/CONF_README](http://www.postfix.org/CONF_README.html)
- Dovecot 官方文档 — [doc.dovecot.org](https://doc.dovecot.org/)
- Arch Wiki: Postfix — [wiki.archlinux.org/title/Postfix](https://wiki.archlinux.org/title/Postfix)
- Arch Wiki: Dovecot — [wiki.archlinux.org/title/Dovecot](https://wiki.archlinux.org/title/Dovecot)
- 鸟哥的私房菜 - 邮件服务器 — [linux.vbird.org](https://linux.vbird.org/linux_server/0380mail.php)
- OpenDMARC/SPF 概览 — [dmarc.org](https://dmarc.org/)
