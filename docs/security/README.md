# 安全篇

Linux 系统安全是运维和开发的基础技能，涵盖防火墙、入侵检测、加密等核心主题。

> 内容参考自 Arch Wiki、安全厂商文档和实际运维经验，见各章节参考资料。

## 学习目标

- 掌握防火墙配置和网络隔离
- 学会入侵检测和日志分析
- 了解加密技术和证书管理
- 掌握安全加固最佳实践

## 内容

| 章节 | 内容 |
|------|------|
| [防火墙](./firewall.md) | iptables、nftables、firewalld 配置 |
| [入侵检测](./intrusion-detection.md) | Fail2Ban、AIDE、OSSEC |
| [加密技术](./encryption.md) | GPG、SSL/TLS、SSH 加密 |
| [安全加固](./hardening.md) | 系统加固、最小权限、审计 |
| [安全审计](./audit.md) | 日志审计、合规检查、漏洞扫描 |
| [网络安全](./network-security.md) | VPN、网络隔离、入侵防御 |

## 快速入门

```bash
# 检查防火墙状态
sudo iptables -L -n

# 检查 SSH 配置
sudo grep -E "^PermitRootLogin|^PasswordAuthentication" /etc/ssh/sshd_config

# 检查系统更新
sudo apt update && sudo apt list --upgradable
```

## 参考资料

- [Arch Wiki - Security](https://wiki.archlinux.org/title/Security)
- [Ubuntu Security](https://ubuntu.com/security)
- [Red Hat Security](https://www.redhat.com/en/topics/security)
- [CIS Benchmarks](https://www.cisecurity.org/cis-benchmarks/)