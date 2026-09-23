# 用户管理

## 本章导语

Linux 是多用户系统，从你按下开机键到看到登录提示符的那一刻起，机器上已经跑着几十个不同身份的进程：`systemd` 以 root 身份管理服务，`sshd` 以 root 身份监听 22 端口再降权处理连接，你的浏览器则以你自己的 UID 运行。"谁在运行、以什么权限运行"这个问题贯穿 Linux 的整个安全模型——文件权限的 rwx 三位数字、sudo 的提权日志、磁盘上 `/home` 的归属，全部建立在用户与组这套机制之上。分不清主组与补充组，你就会对 `ls -l` 第三列的组名感到困惑；理解了它，你就知道为什么把用户加入 `docker` 组之后不用 sudo 也能操作 Docker 套接字，以及为什么这在安全上等同于给了对方 root。

本章分三页：账号管理解决"人"的问题——UID/GID 如何分配、`usermod` 的哪些场景最常用、为什么宁可用 sudo 也不要长期以 root 登录；ACL 权限控制解决"三位权限不够用"的问题——当 owner/group/other 三类无法表达"给张三单独开读写"时怎么办；磁盘配额解决"资源被一个人吃光"的问题——多人共用的服务器上如何防止单用户写满 `/home`。三页层层递进：先有人，再有权限，最后有资源上限。

> 本页以 **Debian/Ubuntu、Arch、RHEL/CentOS/Rocky** 三大发行版家族为主线对照讲解，凡涉及具体命令或默认配置差异都会标注所属家族。内容参考自 Arch Wiki、鸟哥的私房菜与各发行版官方文档，见文末参考资料。

## 学习目标

学完本章三页内容后，你应当能够：

1. **解释 UID/GID 的作用**：说清内核判断权限时看的其实是数字而不是用户名，以及 UID 0、系统 UID、普通 UID 的分界。
2. **区分主组与补充组**：在真实终端上用 `id` 命令验证一个用户属于哪些组，并解释这些组各自带来什么权限。
3. **独立完成账号操作**：创建、改名、锁密码、加组、删除用户，每一步都知道它改动了 `/etc/passwd`、`/etc/group` 还是 `/etc/shadow` 中的哪一行。
4. **做出正确的提权决策**：解释为什么日常应该用 `sudo` 而不是 `su -` 长期挂着 root，并知道 Arch 默认用 `wheel` 组承载 sudo 资格、Debian/Ubuntu 用 `sudo` 组的差异。
5. **按场景选择工具**：面对"给某人开目录权限"和"限制某人磁盘用量"两类需求，分别选出 ACL 与配额，而不是盲目 `chmod 777`。
6. **避开常见坑**：不把 `userdel -r` 用在还被 NFS 挂载的家目录上，不误删主组，不在编辑 `/etc/sudoers` 时留下语法错误导致自己被锁在系统外。

## 子页导读

本章由三页构成，建议按顺序阅读，每页约 10–15 分钟：

- **[账号管理](./users/account_management.md)** — 人从哪里来。从 `/etc/passwd` 的一行真实内容讲起，拆解 UID/GID、主组/补充组的由来，覆盖 `useradd`/`usermod`/`userdel` 的典型场景（改 Shell、锁账号、批量加组），重点讲清 sudo 与直接 root 的坑，并给出 Arch 的 `wheel` 组惯例与三系 sudo 配置对照。本页解决"这个用户是怎么被创建和管理的"。

- **[ACL 权限控制](./users/acl_permissions.md)** — 三位权限之外的精细授权。先讲为什么传统 rwx 表达不了"给 guest 单独开写"，再展开 `getfacl`/`setfacl` 的真实输出，解释 mask 这一最容易被忽视的字段（它会悄悄收窄你设的权限），覆盖默认 ACL 让新建文件自动继承的技巧，以及备份恢复脚本。本页解决"如何不改属主属组就给特定人开权限"。

- **[磁盘配额](./users/disk_quotas.md)** — 资源上限。先讲多人服务器上一个人写满 `/home` 会让所有人登录失败的真实事故，再展开软限制（soft，超过有宽限期）与硬限制（hard，绝对上限）的语义差别，覆盖 ext4 与 XFS 在启用方式上的关键差异（XFS 要在挂载选项里带 `quota=`），以及 `repquota` 报告解读。本页解决"如何限制单个用户的磁盘用量"。

## 三系差异速览

本章涉及的操作在三大发行版家族上的默认行为对照：

| 主题 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 普通用户默认主 UID | 1000 起 | 1000 起 | 1000 起 |
| `useradd` 默认 Shell | `/bin/sh`（dash），常需 `-s /bin/bash` | `/bin/bash` | `/bin/bash` |
| sudo 资格组 | `sudo` 组 | `wheel` 组（默认已启用 `%wheel`） | `wheel` 组 |
| 安装 sudo | `apt install sudo`（桌面版默认带） | `pacman -S sudo`（基础包即含） | 默认已装 |
| 编辑 sudoers | `visudo` | `visudo` | `visudo` |
| 默认密码哈希 | yescrypt（较新） | yescrypt | sha512crypt |
| 常用 ACL 工具包 | `apt install acl` | `pacman -S acl` | `dnf install acl` |
| 配额工具包 | `apt install quota` | `pacman -S quota-tools` | `dnf install quota` |

一张表记不住没关系，进入子页后每条命令都会带上发行版标注。真正需要先建立的直觉只有一条：**三系的用户模型完全一致（都是 UID/GID + 主组/补充组），差异只在默认值和包名上**——这与包管理那种"换发行版命令就换"的差异有本质区别。

## 常见问题

新手进入本章前最常问的四个问题，先集中回答：

**Q：我应该一直用 root 登录吗？**
不应该。root（UID 0）没有任何权限限制，一条 `rm -rf /` 或一次敲错的 `dd of=/dev/sda` 就是不可逆事故。日常用普通用户 + `sudo`，既保留了提权能力，又在 `/var/log/auth.log`（Debian/Ubuntu）或 `/var/log/secure`（RHEL 系）里留下了完整的操作审计记录。详见[账号管理](./users/account_management.md)。

**Q：`usermod -aG` 和 `usermod -G` 有什么区别？**
`-aG` 是**追加**到补充组，`-G` 是**覆盖**整个补充组列表。漏掉 `-a` 会把用户从其他所有补充组里移除——比如刚把运维同事加进 `sudo` 组，顺手又执行了一次不带 `-a` 的 `usermod -G docker`，他就会莫名其妙失去 sudo 资格。这是本章最高频的事故。

**Q：改了用户所属组，为什么新权限不生效？**
补充组在登录时一次性读入进程凭证，已经开着的 SSH 会话不会自动刷新。重新登录（或用 `newgrp groupname` 临时切换）即可。

**Q：什么时候该用 ACL 而不是 chmod/chown？**
当你不想（或没权限）改变文件的属主属组，却要给某个特定用户或组单独授权时。典型场景：共享目录 `/srv/projects` 属主是 `root:devops`，但只想让 `guest` 账号能写其中一个子目录。`chmod` 做不到"只对一个人开"，ACL 可以。详见 [ACL 权限控制](./users/acl_permissions.md)。

## 参考资料

- Arch Wiki - Users and groups — [wiki.archlinux.org](https://wiki.archlinux.org/title/Users_and_groups)
- Arch Wiki - sudo — [wiki.archlinux.org](https://wiki.archlinux.org/title/Sudo)
- Arch Wiki - Access Control Lists — [wiki.archlinux.org](https://wiki.archlinux.org/title/Access_Control_Lists)
- Arch Wiki - Disk quota — [wiki.archlinux.org](https://wiki.archlinux.org/title/Disk_quota)
- 鸟哥的私房菜 - 用户与群组 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0410account-manager.php)
- Debian 手册 - 用户与权限 — [debian.org](https://www.debian.org/doc/manuals/debian-handbook/)
- RHEL 9 文档 - 管理用户和组 — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/identity_management/)
- `man useradd`、`man usermod`、`man sudoers`、`man setfacl`、`man edquota`
