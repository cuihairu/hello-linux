# 邮件服务器（Postfix）

Postfix 是高性能的邮件传输代理（MTA），用于发送和接收电子邮件。

> 内容参考自 Postfix 官方文档和鸟哥的私房菜，见文末参考资料。

## 学习目标

- 理解邮件系统架构
- 掌握 Postfix 安装和基本配置
- 了解 SPF、DKIM、DMARC 配置
- 学会 Dovecot 配置（IMAP/POP3）

## 1. 邮件系统架构

```
发件人 → MUA → MTA → [互联网] → MTA → MDA → MUA → 收件人
                     │
              ┌──────┴──────┐
              │   Postfix   │
              │  (发送/接收) │
              └──────┬──────┘
                     │
              ┌──────┴──────┐
              │   Dovecot   │
              │ (IMAP/POP3) │
              └─────────────┘
```

| 组件 | 说明 | 软件 |
|------|------|------|
| MUA | 邮件用户代理 | Thunderbird、Outlook |
| MTA | 邮件传输代理 | Postfix、Sendmail |
| MDA | 邮件投递代理 | Dovecot、Procmail |

## 2. 安装

```bash
# 安装过程中选择 "Internet Site" 并输入域名
sudo apt update
sudo apt install postfix

# RHEL/CentOS/Fedora
sudo dnf install postfix

# 启动并设置开机自启
sudo systemctl start postfix
sudo systemctl enable postfix
```

## 3. 基本配置

### 3.1 主配置文件

```bash
# /etc/postfix/main.cf

# 基本设置
myhostname = mail.example.com
mydomain = example.com
myorigin = $mydomain
mydestination = $myhostname, localhost.$mydomain, localhost, $mydomain
mynetworks = 127.0.0.0/8, 192.168.1.0/24

# 监听地址
inet_interfaces = all
inet_protocols = ipv4

# 邮箱大小限制
message_size_limit = 52428800    # 50MB
mailbox_size_limit = 1073741824  # 1GB

# 别名
alias_maps = hash:/etc/aliases
alias_database = hash:/etc/aliases
```

### 3.2 设置别名

```bash
# /etc/aliases
root: admin@example.com
postmaster: admin@example.com
webmaster: admin@example.com

# 更新别名数据库
sudo newaliases
```

## 4. 安装 Dovecot

```bash
# 安装
sudo apt install dovecot-core dovecot-imapd dovecot-pop3d

# 启动并设置开机自启
sudo systemctl start dovecot
sudo systemctl enable dovecot
```

### 4.1 Dovecot 配置

```bash
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

## 5. SPF、DKIM、DMARC

### 5.1 SPF（Sender Policy Framework）

在 DNS 中添加 TXT 记录：

```
example.com.  IN TXT "v=spf1 mx a:mail.example.com ip4:192.168.1.100 -all"
```

### 5.2 DKIM（DomainKeys Identified Mail）

```bash
# 安装 opendkim
sudo apt install opendkim opendkim-tools

# 生成密钥
sudo opendkim-genkey -D /etc/opendkim/keys/example.com -d example.com -s mail

# 设置权限
sudo chown -R opendkim:opendkim /etc/opendkim

# DNS 记录
mail._domainkey.example.com. IN TXT "v=DKIM1; k=rsa; p=MIGfMA0GCS..."
```

### 5.3 DMARC

在 DNS 中添加 TXT 记录：

```
_dmarc.example.com. IN TXT "v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com"
```

## 6. 测试

```bash
# 测试 SMTP 连接
telnet mail.example.com 25

# 发送测试邮件
echo "Test" | mail -s "Test Subject" user@example.com

# 查看邮件日志
sudo tail -f /var/log/mail.log

# 测试端口
nc -zv mail.example.com 25    # SMTP
nc -zv mail.example.com 587   # Submission
nc -zv mail.example.com 993   # IMAPS
```

## 7. 安全加固

### 7.1 禁止开放中继

```bash
# /etc/postfix/main.cf
smtpd_relay_restrictions =
    permit_mynetworks
    permit_sasl_authenticated
    reject_unauth_destination
```

### 7.2 启用 SASL 认证

```bash
# 安装 SASL
sudo apt install libsasl2-modules

# /etc/postfix/main.cf
smtpd_sasl_auth_enable = yes
smtpd_sasl_security_options = noanonymous
smtpd_sasl_local_domain = $myhostname
```

## 参考资料

- Postfix 官方文档 — [postfix.org](http://www.postfix.org/documentation.html)
- Dovecot 官方文档 — [dovecot.org](https://doc.dovecot.org/)
- 鸟哥的私房菜 - 邮件服务器 — [linux.vbird.org](https://linux.vbird.org/linux_server/0380mail.php)
- SPF 记录检查 — [spf-record.com](https://www.spf-record.com/)
