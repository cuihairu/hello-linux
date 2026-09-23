# 安全篇

## 本章导语

Linux 系统安全是运维和开发的基础技能，涵盖防火墙、入侵检测、加密等核心主题。本篇在基础篇"安全基础"（SELinux 概念）之上，把注意力放到一台联网服务器真正要处理的四件事上：**拦住不该进来的流量、发现已经发生的变化、保护传输与静态数据、把系统本身的攻击面收到最小**。

很多人的"安全"停留在两个动作上：装完系统改一下密码、有空时跑一次 `apt upgrade`。这两件事当然要做，但它们离真实威胁很远。一台暴露在公网的 SSH 端口每小时会收到成百上千次口令爆破；一个被植入的 Web Shell 不会触发任何"密码错误"告警，只会安静地修改几个文件；一块从服务器上拆走的旧硬盘，只要没有加密，里面的数据库导出文件就是明文的。

安全篇要建立的是一条**分层防线**的直觉，而不是罗列工具：

1. **预防层**——防火墙把攻击面收缩到"业务必需的端口"，SSH 加固与最小化安装减少可被利用的入口。这一层做得好，大部分扫描和爆破根本到不了你的服务。
2. **检测层**——预防层必然有遗漏，所以需要文件完整性检查（AIDE）、主机审计（auditd）与响应式封禁（Fail2Ban），回答"系统在我没注意的时候被动过吗"。
3. **机密层**——TLS 保护网络传输，GPG 保护文件与软件分发的信任链，LUKS 保护磁盘失窃场景下的静态数据。
4. **基线层**——安全加固把上面三层固化成可复查的基线：该关的服务关掉、补丁节奏定下来、SSH 配置可审计。

四层之间有明确的依赖顺序：没有防火墙就谈入侵检测是在噪音里捞针；没有加密，检测再灵敏也挡不住数据被直接读走；没有加固基线，前三层的配置会随时间漂移失效。这也是本篇章节顺序的由来。

> 内容参考自 Arch Wiki、鸟哥的私房菜与各工具官方文档，见各章节参考资料。

## 学习路线（建议顺序）

建议按顺序阅读，每一环都为下一环提供前提：

| 阶段 | 章节 | 为什么放在这里 |
|------|------|----------------|
| 1. 收缩入口 | [防火墙](./firewall.md) | 安全的第一道闸：先决定"谁 allowed 进来"，再谈其它一切 |
| 2. 保护数据 | [加密技术](./encryption.md) | 流量进了门还要防窃听与篡改；SSH 密钥登录是后面加固的前提 |
| 3. 发现异常 | [入侵检测](./intrusion-detection.md) | 预防有缺口，需要文件完整性、审计日志与 Fail2Bans 补位 |
| 4. 固化基线 | [安全加固](./hardening.md) | 把前三步连同服务、补丁、MAC 收束成一份可复查的基线 |

一个可操作的自检标准：学完本篇后，你应该能在一台全新的虚拟机上回答——"这台机器的防火墙默认策略是什么、SSH 用什么方式认证、文件被篡改怎么发现、哪些服务是多余的、安全事件去哪查日志"。五个问题都能答上来，安全篇就算过关。

## 三系安全栈速览

三个发行版家族的**默认安全栈差异很大**，这是本篇最重要的背景。同样是"开个防火墙"，命令完全不同；同样是"查 SELinux 拒绝"，在 Ubuntu 上根本找不到 `getenforce`：

| 对比项 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|--------|---------------|------|-------------------|
| 默认防火墙 | `ufw`（Ubuntu 出厂安装、默认未启用；Debian 服务器常不预开） | 无默认方案，自选 `nftables`/`iptables`/`ufw` | `firewalld` 默认启用 |
| 防火墙前端 | `ufw`（底层 iptables/nftables） | `nft` 为内核原生接口；Arch 的 iptables 包默认走 nft 后端 | `firewall-cmd` |
| 强制访问控制 | AppArmor（默认启用） | 默认不启用 SELinux 也不启用 AppArmor | SELinux（Enforcing） |
| 认证日志 | `/var/log/auth.log` | journal（装 rsyslog 后才有文本文件） | `/var/log/secure` |
| 审计框架 | `auditd` 需自行安装 | `audit` 包需自行安装 | `auditd` 默认安装并启用 |
| 安装安全工具 | `sudo apt install 包名` | `sudo pacman -S 包名` | `sudo dnf install 包名` |

本篇每个子页都会给出三系工具安装对照。常见安全工具在 Arch 上都进官方仓库，用 `pacman` 即可装齐，不需要碰 AUR：

```bash
# Debian/Ubuntu
sudo apt install ufw aide fail2ban lynis gnupg

# Arch
sudo pacman -S ufw aide fail2ban lynis gnupg

# RHEL/CentOS/Rocky（fail2ban/lynis 等常在 EPEL）
sudo dnf install epel-release
sudo dnf install firewalld aide fail2ban lynis gnupg2
```

注意两处包名细节：Arch 上 `pacman -S audit` 提供的是 auditd 守护进程；RHEL 系上 GPG 的包名是 `gnupg2`（Debian/Arch 是 `gnupg`）。装包前用 `pacman -Ss 关键词`、`apt search`、`dnf search` 各自确认一次，是三系通用的习惯。

## 子页导读

本篇共四个子页，每页回答一类问题，互不重复：

- [防火墙](./firewall.md) — 三系默认防火墙差异、zone 与规则模型、默认拒绝策略怎么设计、"先放行再启用"的锁死坑、与网络篇操作速查的分工。回答"流量该放谁进来"。
- [入侵检测](./intrusion-detection.md) — 文件完整性（AIDE）与主机入侵检测的分工、Fail2Ban 响应式封禁、auditd 审计规则与 journald 的衔接、rkhunter/OSSEC 的定位。回答"系统被动过吗、怎么发现"。
- [加密技术](./encryption.md) — 对称与非对称为什么都要有、TLS 握手与证书链、SSH 密钥认证、GPG 签名信任链、LUKS 磁盘加密的概念与风险。回答"数据怎么保密、身份怎么证明"。
- [安全加固](./hardening.md) — 最小化安装、冗余服务清理、补丁节奏、SSH 加固、内核参数、三系 MAC 默认差异与基线自查。回答"这台机器的攻击面还能再小吗"。

与其它篇的分工请认准：**防火墙的"怎么开端口"操作速查在[网络篇 · 防火墙](../network/firewall.md)，本篇讲安全策略视角**（默认拒绝、白名单、日志与限速）；**SELinux/AppArmor 的概念与排障在[基础篇 · 安全基础](../basic/security.md)**，本篇只讲它在加固基线中的位置；**日志协议与轮转在[基础篇 · 日志系统](../basic/log.md)**，本篇只讲安全事件该去哪查。

## 学习目标

- 理解分层防线：预防（防火墙）、检测（IDS/审计）、机密（加密）、基线（加固）各解决什么问题
- 掌握三系默认防火墙差异，能独立设计"默认拒绝 + 白名单"的服务器策略
- 理解对称/非对称加密的分工，会用 GPG 签名验签、用 SSH 密钥替代口令登录
- 掌握 AIDE 文件完整性检查与 auditd 审计规则的基本用法，知道 audit 日志与 journald 的关系
- 能按最小化原则审视一台服务器：多余服务、未打补丁、过弱 SSH 配置逐项收口

## 常见问题

**Q：我只是一台内网开发机，也需要学完整套安全篇吗？**
内网不等于安全，但优先级可以调整。最低基线是三件事：SSH 改密钥登录、防火墙只放行业务端口、系统保持补丁更新。入侵检测与磁盘加密可以放到接触敏感数据或需要合规审计时再补。

**Q：三系命令总记混，有没有一条判断法则？**
有：**名字里带发行版血统的命令都不是 Linux 标准**——`ufw` 是 Debian 系习惯、`firewall-cmd` 是 RHEL 系习惯、`nft` 才是三系都有的内核接口；`apt`/`pacman`/`dnf` 同理。见命令篇的三系对照表。

**Q：安全篇和网络篇的防火墙内容重复吗？**
视角不同。网络篇回答"怎么快速放行 80 端口"，本篇回答"默认该拒绝什么、为什么要先 allow 再 enable、日志和限速怎么配"。两篇配合读：网络篇当速查手册，本篇当策略设计指南。

**Q：装安全工具必须用发行版包管理器吗，能不能源码编译？**
生产环境优先包管理器（`apt`/`pacman`/`dnf`），因为升级链路和签名验证由仓库负责。源码编译适合需要特定版本的场景，但要自己承担后续 CVE 跟进，初学者不建议。

## 参考资料

- Arch Wiki - Security — [wiki.archlinux.org](https://wiki.archlinux.org/title/Security)
- Arch Wiki - Pacman — [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- 鸟哥的私房菜 - 系统安全与权限控制 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0430su.php)
- Debian 安全手册 — [debian.org](https://www.debian.org/doc/manuals/debian-handbook/)
- Ubuntu 安全 — [ubuntu.com/security](https://ubuntu.com/security)
- Red Hat 安全强化 — [redhat.com](https://www.redhat.com/en/topics/security)
- CIS Benchmarks — [cisecurity.org](https://www.cisecurity.org/cis-benchmarks/)
