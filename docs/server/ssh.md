# SSH 远程登录

装完一台服务器，第一件要配的事就是远程登录：之后所有的部署、排错、备份都从这条通道走。SSH 的特殊之处在于它是多数机器上唯一预授权的公网入口，配错的代价不是「功能不可用」，而是整机失联。本页按「装起来 → 跑起来 → 连得上 → 收得住」的顺序讲服务端主线，客户端用法见[网络工具](../commands/network/network-tools.md)，加固清单见[安全加固](../security/hardening.md)，密钥生成见[加密技术](../security/encryption.md)。

> 内容参考自 OpenSSH 官方文档、Arch Wiki 与 RHEL 文档，见文末参考资料。包版本事实于 2026-10-10 经 Arch 官方包 API 与 CentOS Stream 9 镜像目录实取。

## 学习目标

- 三系安装 openssh-server，说清服务名差异（`sshd` 与 `ssh`）与配置路径
- 完成密钥认证闭环：生成、分发、禁用密码登录，每一步都知道为什么
- 读懂 sshd_config 的核心项，改完用 `sshd -t` 与 `sshd -T` 回读
- 用 `~/.ssh/config` 把别名、跳板、连接复用固化下来
- 改端口后正确处理防火墙与 SELinux，常见故障能按日志定位

## 1. 安装与服务

| 操作 | Debian/Ubuntu | RHEL/Rocky | Arch |
|------|---------------|-----------|------|
| 安装 | `apt install openssh-server` | `dnf install openssh-server` | `pacman -S openssh` |
| 服务单元 | `ssh.service` | `sshd.service` | `sshd.service` |
| 配置目录 | `/etc/ssh/` | `/etc/ssh/` | `/etc/ssh/` |
| 主配置 | `/etc/ssh/sshd_config` | 同左 | 同左 |
| 日志 | journal（`ssh` 单元） | journal（`sshd` 单元） | journal（`sshd` 单元） |

服务名差异是排错第一坑：Debian 系单元叫 `ssh`，RHEL 系与 Arch 叫 `sshd`，`systemctl status ssh` 在 RHEL 上会报单元不存在。包版本现状：Arch 的 openssh 在 core（10.6p1），EL9 的 openssh/openssh-clients/openssh-server 三件套在 BaseOS（9.9p1）。

```bash
$ sudo systemctl enable --now sshd    # Debian 系把 sshd 换成 ssh
$ sudo systemctl status sshd         # 确认 active 且监听 22
$ sudo ss -tlnp | grep :22           # 监听地址与进程对得上
```

改端口（`Port 2222`）之前先做完第 5 节的防火墙与 SELinux 准备，再重启服务，否则就是主动断自己的管理通道。

## 2. 密钥认证

密码登录能跑，但爆破脚本盯的就是 22 端口的密码提示。生产基线是只留密钥认证，分四步走：

```bash
$ ssh-keygen -t ed25519 -C "ops@example.com"   # 客户端生成，口令可留空给自动化用
$ ssh-copy-id -i ~/.ssh/id_ed25519.pub user@server   # 公钥追加到服务端 ~/.ssh/authorized_keys
$ ssh user@server                            # 先验证密钥能登，再动服务端配置
$ sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
$ sudo systemctl restart sshd
```

顺序有讲究：先验证密钥可用，再关密码登录。反过来的话，密钥分发有任何一步出错，密码一关就再也进不去。`authorized_keys` 的权限是第二道坎——服务端 `~/.ssh` 要 700、`authorized_keys` 要 600，属主必须是登录用户本人，权限宽了 sshd 直接拒绝使用密钥（日志里报 `Authentication refused: bad ownership or modes`）。

`ssh-agent` 管私钥口令：`eval $(ssh-agent)` 起代理，`ssh-add ~/.ssh/id_ed25519` 把密钥加进去，之后同机 ssh 不再重复输口令。自动化场景（CI、批量脚本）用无口令密钥，但要意识到这把密钥文件本身变成了唯一凭证，落盘范围要收紧。

## 3. sshd_config 核心项

主配置是 `/etc/ssh/sshd_config`，改动后先 `sudo sshd -t` 验语法，再重启。常用项按作用分四组：

| 组 | 指令 | 说明 |
|----|------|------|
| 监听 | `Port`、`ListenAddress` | 改端口必配；`ListenAddress 0.0.0.0` 是默认全监听 |
| 认证 | `PermitRootLogin`、`PasswordAuthentication`、`PubkeyAuthentication` | root 直登建议 `no`；密码登录建议 `no`；密钥登录保持 `yes` |
| 准入 | `AllowUsers`、`AllowGroups`、`DenyUsers` | 账号层白名单，即使密码策略被绕过，名单外账号也建不了会话 |
| 会话 | `MaxAuthTries`、`LoginGraceTime`、`X11Forwarding`、`AllowTcpForwarding` | 认证尝试上限、握手窗口、转发开关；逐项理由与默认值对照见[安全加固](../security/hardening.md) 第 5 节 |

两个进阶机制值得知道。`Match` 块按条件覆盖主配置，比如只对某个网段放开密码登录：

```text
# /etc/ssh/sshd_config
PasswordAuthentication no
Match Address 10.0.0.0/8
    PasswordAuthentication yes
```

drop-in 目录 `/etc/ssh/sshd_config.d/*.conf` 优先级高于主文件，发行版升级时改动落在 drop-in 里不会被覆盖。改完用 `sudo sshd -T` 回读运行时生效值——配置文件里写了不等于运行时采纳，drop-in 与 Match 块都可能改写主文件的行。

## 4. 客户端配置

`~/.ssh/config` 把常用连接固化成别名，免掉每次敲全参数：

```text
# ~/.ssh/config
Host bastion
    HostName 203.0.113.10
    User ops
    IdentityFile ~/.ssh/id_ed25519

Host db-*
    ProxyJump bastion
    User ops
    ServerAliveInterval 60
    ControlMaster auto
    ControlPath ~/.ssh/cm-%r@%h:%p
```

`ProxyJump` 让内网机器经跳板机直达，比旧式 `ProxyCommand` 短且少配错。`ControlMaster` 复用连接后，同一批机器的连续 ssh 免重复握手，批量操作快一截。首次连接务必人工核对指纹（`known_hosts` 预置或当面确认），脚本里的 `StrictHostKeyChecking=no` 只应出现在一次性、可抛弃的 CI 容器里。

## 5. 防火墙与 SELinux

改端口后，新端口要在防火墙与 SELinux 两侧都放行，缺一侧的表现都是「连接被拒但服务明明在跑」：

| 操作 | Debian/Ubuntu | RHEL/Rocky | Arch |
|------|---------------|-----------|------|
| 放行 22 | `ufw allow ssh` | `firewall-cmd --add-service=ssh --permanent && firewall-cmd --reload` | 默认无防火墙，装 ufw 同 Debian 列 |
| 放行自定义端口 | `ufw allow 2222/tcp` | `firewall-cmd --add-port=2222/tcp --permanent && firewall-cmd --reload` | 同 Debian 列 |
| SELinux 端口标签 | 默认无 SELinux | `semanage port -a -t ssh_port_t -p tcp 2222` | 默认无 SELinux |

RHEL 系改端口后漏掉 `semanage` 是最常见的「改完连不上」：sshd 起在 2222，但 SELinux 只允许 ssh_port_t 标签的端口，新端口不在标签里，连接在握手前就被内核拦掉。`semanage port -l | grep ssh` 可以回读当前标签集合。

## 6. 安全强化延伸

密钥认证与 root 禁用之外，还有三层可选加固，按成本从低到高：

- **爆破限速**：fail2ban 盯 journal 里的认证失败，超限封 IP；轻量替代是 nftables 对单 IP 的新建连接限速。本仓[入侵检测](../security/intrusion-detection.md)页有对应工具链。
- **证书认证**：用 CA 签发用户证书，`TrustedUserCAKeys` 指定信任的 CA 公钥，免掉逐机维护 `authorized_keys`。适合机器与人员都多的团队，指令以 man sshd_config 为准（本机 OpenSSH 10.2 实测条目存在）。
- **双因素**：`AuthenticationMethods publickey,keyboard-interactive` 叠加 PAM 第二因子，本仓[PAM 与 sudo](../security/pam-sudo.md)页讲 PAM 接线。

每加一项都要能说出防的是什么攻击、可能影响哪类客户端，说不出就不加——这条纪律的完整论述在[安全加固](../security/hardening.md)。

## 7. 常见故障

**Permission denied (publickey,password)。** 先 `ssh -v` 看客户端实际提供了哪个密钥、服务端是否接受；再查 `~/.ssh` 与 `authorized_keys` 的属主和权限（700/600）；RHEL 系加查 SELinux（`ausearch -m avc -ts recent` 或 `/var/log/audit/audit.log`）。三类原因按这个顺序排，多数是前两类。

**Connection refused。** 服务没起、端口不对、防火墙拦，三者表现一样。`systemctl status sshd` 看服务，`ss -tlnp | grep :22` 看监听，`firewall-cmd --list-all` 或 `ufw status` 看防火墙，逐层排除。

**Host key verification failed。** 服务端重装或换机器后指纹变了，`ssh-keygen -R host` 清掉旧记录重新核对。别图省事直接删 `known_hosts`——那等于放弃指纹核对。

**改端口后连不上。** 按第 5 节查防火墙与 SELinux 两侧；确认客户端命令带 `-p 2222`。

**禁用密码后锁死。** 这是变更纪律问题不是技术问题：改认证方式前开一个新会话验证通过再关旧会话，验证动作写在变更单上。控制台与带外管理（IPMI、云控制台）是最后逃生通道，动 sshd 之前确认它可用。

## 8. 与其它页的分工

客户端命令用法（`-J` 跳板、`-L` 本地转发、`-v` 调试）在[网络工具](../commands/network/network-tools.md) 一节；sshd_config 加固清单与变更三步纪律在[安全加固](../security/hardening.md) 第 5 节；密钥生成与口令管理在[加密技术](../security/encryption.md)；多机账号一致性由 [LDAP 统一账号管理](./ldap.md) 与 SSSD 解决，SSH 的 `AllowUsers` 白名单与目录账号可以叠加使用。

## 参考资料

- OpenSSH 官方文档 — [openssh.com/manual.html](https://www.openssh.com/manual.html)
- Arch Wiki: OpenSSH — [wiki.archlinux.org/title/OpenSSH](https://wiki.archlinux.org/title/OpenSSH)
- RHEL 文档（sshd 配置与 SELinux 端口标签） — [docs.redhat.com](https://docs.redhat.com/)
- man 手册 — man sshd_config、man ssh_config、man ssh-keygen
