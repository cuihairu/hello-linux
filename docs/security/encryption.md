# 加密技术

加密技术是信息安全的核心，用于保护数据的机密性和完整性。

> 内容参考自 OpenSSL、GPG 官方文档和加密学实践，见文末参考资料。

## 学习目标

- 掌握对称加密和非对称加密
- 学会使用 GPG 和 SSL/TLS
- 了解数字证书和 PKI

## 1. 加密基础

### 1.1 加密类型

| 类型 | 说明 | 示例 |
|------|------|------|
| 对称加密 | 加密和解密使用相同密钥 | AES、DES、3DES |
| 非对称加密 | 使用公钥加密，私钥解密 | RSA、ECC、DSA |
| 哈希函数 | 单向加密，生成固定长度摘要 | SHA-256、MD5、SHA-1 |

### 1.2 加密应用场景

```bash
# 数据加密
# 身份认证
# 数字签名
# 密钥交换
# 完整性校验
```

## 2. GPG

### 2.1 安装

```bash
# Debian/Ubuntu
sudo apt install gnupg

# RHEL/CentOS
sudo dnf install gnupg2
```

### 2.2 生成密钥对

```bash
# 生成密钥对
gpg --gen-key

# 查看密钥列表
gpg --list-keys
gpg --list-secret-keys

# 导出公钥
gpg --export -a "Your Name" > public.key

# 导出私钥
gpg --export-secret-keys -a "Your Name" > private.key
```

### 2.3 加密和解密

```bash
# 加密文件
gpg -e -r "Recipient Name" file.txt

# 解密文件
gpg -d file.txt.gpg > file.txt

# 对称加密
gpg -c file.txt

# 对称解密
gpg -d file.txt.gpg > file.txt
```

### 2.4 数字签名

```bash
# 签名文件
gpg -s file.txt

# 验证签名
gpg --verify file.txt.gpg

# 分离签名
gpg --detach-sig file.txt

# 验证分离签名
gpg --verify file.txt.sig file.txt
```

### 2.5 密钥管理

```bash
# 导入公钥
gpg --import public.key

# 信任密钥
gpg --edit-key "Key ID"
trust
quit

# 删除密钥
gpg --delete-key "Key ID"
gpg --delete-secret-key "Key ID"
```

## 3. SSL/TLS

### 3.1 基本概念

```bash
# SSL/TLS 用于网络通信加密
# HTTPS = HTTP + SSL/TLS

# 握手过程
# 1. 客户端发送支持的加密套件
# 2. 服务器选择加密套件并发送证书
# 3. 客户端验证证书并生成密钥
# 4. 双方使用密钥加密通信
```

### 3.2 OpenSSL

```bash
# 查看证书信息
openssl x509 -in certificate.crt -text -noout

# 验证证书
openssl verify -CAfile ca.crt certificate.crt

# 测试 HTTPS 连接
openssl s_client -connect example.com:443

# 生成自签名证书
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes
```

### 3.3 证书格式

```bash
# PEM 格式（文本）
-----BEGIN CERTIFICATE-----
...
-----END CERTIFICATE-----

# DER 格式（二进制）
# PKCS#12 格式（包含证书和私钥）
openssl pkcs12 -export -out certificate.pfx -inkey key.pem -in cert.pem
```

## 4. 数字证书

### 4.1 证书类型

| 类型 | 说明 | 验证级别 |
|------|------|---------|
| DV | 域名验证 | 验证域名所有权 |
| OV | 组织验证 | 验证组织真实性 |
| EV | 扩展验证 | 最高级别验证 |

### 4.2 证书链

```bash
# 根证书 → 中间证书 → 服务器证书

# 查看证书链
openssl s_client -connect example.com:443 -showcerts

# 验证证书链
openssl verify -CAfile ca.crt -untrusted intermediate.crt server.crt
```

### 4.3 证书管理

```bash
# 查看证书有效期
openssl x509 -in certificate.crt -noout -dates

# 查看证书颁发者
openssl x509 -in certificate.crt -noout -issuer

# 查看证书主题
openssl x509 -in certificate.crt -noout -subject
```

## 5. SSH 加密

### 5.1 SSH 密钥认证

```bash
# 生成 SSH 密钥对
ssh-keygen -t ed25519 -C "your_email@example.com"

# 复制公钥到服务器
ssh-copy-id user@server

# 使用密钥登录
ssh -i ~/.ssh/id_ed25519 user@server
```

### 5.2 SSH 配置

```bash
# ~/.ssh/config
Host myserver
    HostName server.example.com
    User myuser
    IdentityFile ~/.ssh/id_ed25519
    Port 22
```

### 5.3 SSH 安全加固

```bash
# /etc/ssh/sshd_config
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
ClientAliveInterval 300
ClientAliveCountMax 2
```

## 6. 实战案例

### 6.1 文件加密脚本

```bash
#!/bin/bash
# 文件加密脚本

encrypt_file() {
    local file=$1
    local recipient=$2
    
    gpg -e -r "$recipient" "$file"
    echo "文件已加密: $file.gpg"
}

decrypt_file() {
    local file=$1
    
    gpg -d "$file" > "${file%.gpg}"
    echo "文件已解密: ${file%.gpg}"
}

# 使用
encrypt_file "secret.txt" "Your Name"
decrypt_file "secret.txt.gpg"
```

### 6.2 证书监控脚本

```bash
#!/bin/bash
# 证书监控脚本

DOMAIN="example.com"
DAYS=30

# 检查证书有效期
expiry_date=$(openssl s_client -connect "$DOMAIN:443" 2>/dev/null | openssl x509 -noout -enddate | cut -d= -f2)
expiry_epoch=$(date -d "$expiry_date" +%s)
current_epoch=$(date +%s)
days_left=$(( (expiry_epoch - current_epoch) / 86400 ))

if [ $days_left -lt $DAYS ]; then
    echo "证书将在 $days_left 天后过期"
    # 发送告警
fi
```

### 6.3 自动备份加密

```bash
#!/bin/bash
# 自动备份加密脚本

BACKUP_DIR="/var/backups"
DATE=$(date +%Y%m%d_%H%M%S)
RECIPIENT="backup@example.com"

# 创建备份
tar -czf "$BACKUP_DIR/backup_$DATE.tar.gz" /important/data

# 加密备份
gpg -e -r "$RECIPIENT" "$BACKUP_DIR/backup_$DATE.tar.gz"

# 删除未加密备份
rm "$BACKUP_DIR/backup_$DATE.tar.gz"

echo "加密备份完成"
```

## 参考资料

- [GPG 手册](https://gnupg.org/documentation/)
- [OpenSSL 文档](https://www.openssl.org/docs/)
- [SSH 手册](https://www.openssh.com/manual.html)
- [数字证书原理](https://www.ssl.com/faqs/what-is-a-certificate-authority/)