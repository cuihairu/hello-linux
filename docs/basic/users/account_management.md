# 账号管理

Linux 从设计之初就是多用户系统：每个进程在内核里都挂着一个 UID，内核做权限判断时**只看数字不看名字**——`ls -l` 显示的 `user`、`root` 只是 `/etc/passwd` 反查出来的可读别名。理解这一点，后面所有权限问题都会变得直白：所谓"root 无所不能"，本质是"UID 0 绕过了 DAC 检查"；所谓"把用户加入 docker 组"，本质是让该用户的进程凭证里多了一个 GID，从而匹配上 `/var/run/docker.sock` 的组权限位。本页从三份核心配置文件讲起，再到增删改查命令，最后落到 sudo 与 root 的选择——这是每个 Linux 使用者必须建立的第一套心智模型。

> 内容参考自 Arch Wiki、鸟哥的私房菜和各发行版 man 手册，见文末参考资料。

## 学习目标

- 理解 UID/GID、主组与补充组的设计动机，并能在终端上验证
- 看懂 `/etc/passwd`、`/etc/shadow`、`/etc/group` 每个字段的含义
- 掌握 `useradd`/`usermod`/`userdel` 的高频场景（含 `-aG` 的正确用法）
- 分清 sudo 与直接 root 的利弊，掌握三系（含 Arch 的 wheel 惯例）sudo 配置

## 1. 为什么需要用户与组

一切皆文件的 Linux 里，权限最终落在文件的三位 rwx 上，而这三位分别对应**所有者（user）**、**所属组（group）**、**其他人（other）**。没有用户概念，就无法区分"谁是所有者"；没有组概念，就只能给每个人单独 chmod——当团队有十个人时会立刻失控。组的存在让权限可以按角色批量授予：把十个开发者的账号都加入 `devops` 组，然后让共享目录的属组等于 `devops`，一次 `chgrp` 就完成授权，人员进出只需要增删组成员。

内核层面，每个进程携带一组凭证：真实 UID、有效 UID、一组 GID（第一个是主组，其余是补充组）。打开文件时，内核按"有效 UID → 有效 GID → 补充组"的顺序依次匹配文件属主、属组、其他人三类权限位，第一个匹配上的规则生效。这就是为什么补充组能带来权限——它参与匹配，而且在匹配属组之前就会被检查。

```bash
$ id
uid=1000(alice) gid=1000(alice) groups=1000(alice),27(sudo),999(docker)
```

`id` 输出的三段要分开读：`uid=1000` 是用户自己的 UID；`gid=1000` 是主组（primary group），创建用户时自动生成的同名组；`groups=` 里除第一个外都是补充组（supplementary groups）。它是排查权限问题的第一手证据：文件属组是 999（docker）而你的 groups 列表里没有 999，权限就一定不通。

## 2. 用户类型与 UID 分配

Linux 按 UID 区分身份，三系的分界大体一致（Debian/Ubuntu 与 Arch 使用 `systemd-sysusers`/`adduser` 约定，RHEL 系沿用 UID 1–999 为系统账号的传统）：

| 类型 | UID 范围 | 说明 | 典型例子 |
|------|---------|------|---------|
| 超级用户 | 0 | 唯一的 root，绕过 DAC 权限检查 | `root` |
| 系统用户 | 1–999 | 供服务进程使用，通常无登录 Shell | `sshd`、`www-data`、`nobody` |
| 普通用户 | 1000+ | 日常登录的账号 | 你创建的每一个账号 |

```bash
$ head -2 /etc/passwd
root:x:0:0:root:/root:/bin/bash
daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin

$ awk -F: '$3 >= 1000 {print $1, $3}' /etc/passwd
alice 1000
```

`/etc/passwd` 每行七列，用冒号分隔：用户名、密码占位、UID、GID、注释、家目录、登录 Shell。把 Shell 写成 `/usr/sbin/nologin`（或 `/sbin/nologin`）即可禁止该账号交互登录——这是系统账号的标准做法，服务进程启动时并不需要"登录"这一步。

## 3. 核心配置文件

三个文件分工明确，改动任何一个都会即时影响系统行为：

| 文件 | 内容 | 权限 | 是否存放密码 |
|------|------|------|-------------|
| `/etc/passwd` | 用户名、UID、GID、Shell 等公开信息 | 644（所有人可读） | 否（密码字段是 `x` 占位） |
| `/etc/shadow` | 密码哈希、过期策略 | 640（仅 root 与 shadow 组） | 是 |
| `/etc/group` | 组名、组 GID、组成员列表 | 644 | 否 |

`/etc/passwd` 的一行形如 `alice:x:1000:1000:Alice Chen:/home/alice:/bin/bash`，七列依次是用户名、密码占位（真实哈希在 shadow）、UID、GID、GECOS 注释、家目录、Shell。`/etc/shadow` 的一行用冒号切成九段：用户名、密码哈希（`$y$` 开头表示 yescrypt，较新发行版默认）、上次改密日期（自 1970-01-01 起的天数）、最短有效期（0 = 可随时改）、最长有效期（99999 = 永不过期）、警告期（默认 7 天），其后还有过期日、停用日等保留字段。`/etc/group` 则是 `组名:x:GID:成员1,成员2`，Debian/Ubuntu 的 `sudo` 组与 Arch/RHEL 的 `wheel` 组都靠这里的成员列表决定谁能提权。

```bash
$ grep alice /etc/passwd
alice:x:1000:1000:Alice Chen:/home/alice:/bin/bash

$ sudo grep alice /etc/shadow
alice:$y$j9T$Xk3v...:19685:0:99999:7:::

$ grep -E 'wheel|sudo' /etc/group
sudo:x:27:alice,bob
wheel:x:10:alice
```

把密码从 `/etc/passwd` 挪到 `/etc/shadow` 是历史演进的结果：早年所有账号信息放同一文件，任何能读文件的用户都能拿到全部密码哈希做离线爆破；拆分后公开信息与机密信息物理隔离，`/etc/passwd` 可以放心保持 world-readable（很多老工具仍依赖这一点反查用户名）。

## 4. 创建与删除用户

```bash
$ sudo useradd -m -s /bin/bash alice   # -m 建家目录；Debian 默认 shell 是 dash，显式指定 bash 更稳妥
$ sudo useradd -m alice                # Arch 与 RHEL 系默认已是 bash，可省略 -s
$ sudo passwd alice                    # 交互设置密码，会提示输入两次
$ sudo userdel -r alice                # -r 连同家目录一起删
userdel: home/alice not found so not removed
```

**常见坑**：`userdel -r` 若提示 `not found so not removed`，通常说明家目录路径与 `/etc/passwd` 记录不一致（比如手动 `mv` 过目录），此时不要想当然地 `rm -rf /home/alice`——先 `grep alice /etc/passwd` 核对第六列到底写的是什么。另外，当家目录在 NFS 等网络文件系统上时，`-r` 的行为受 `/etc/login.defs` 中 `USERDEL_CMD` 与 `REMOVE_HOME` 配置影响，批量清理共享存储上的账号前务必先确认。

## 5. usermod 的典型场景

`usermod` 是日常最高频的修改命令，几个必须记住的用法：

```bash
$ sudo usermod -aG docker alice   # 追加进补充组；-a 是 append，绝不能漏！
$ sudo usermod -G docker alice    # 危险：漏掉 -a 变成"覆盖"，会踢掉 alice 的 sudo、adm 等组
$ sudo usermod -s /bin/zsh alice  # 改登录 Shell
$ sudo usermod -L alice && sudo usermod -U alice   # 锁定 / 解锁（密码字段前加 !）
$ sudo usermod -d /home/alice2 -m alice            # 改用户名并迁移家目录
$ sudo usermod -c "Alice Chen" alice               # 改注释字段
```

锁定后可用 `sudo passwd -S alice` 查看状态，第二列显示 `L` 即已锁定。改完补充组后，**必须重新登录**新权限才对已有会话生效：补充组列表在登录时一次性读入进程凭证，运行中的 shell 不会自动刷新。验证方法是新开一个 SSH 会话再执行 `id`。

## 6. 组管理

```bash
$ sudo groupadd devops
$ getent group devops
devops:x:1001:alice,bob
$ sudo gpasswd -M alice,bob,carol devops   # 以组为中心批量写入成员名单
$ groups alice
alice : alice sudo devops
$ sudo groupdel devops                     # 组内还有成员时会拒绝，先清空成员
```

`gpasswd -M`（设置成员列表）与 `usermod -aG`（把某人追加进组）是两种互补的操作：前者是"以组为中心"整体设置名单，后者是"以人为中心"追加。批量初始化团队账号时用 `gpasswd -M` 一次性写入更不容易出错。

## 7. sudo 与直接使用 root

**为什么推荐 sudo 而不是一直用 root**：root（UID 0）没有权限边界，一条手滑的 `rm -rf /var/lib/mysql` 就是生产事故。`sudo` 带来三个 root 直接登录没有的好处：每次提权都有明确的触发动作（可审计）、只在需要时短暂拥有特权（最小权限）、并且默认在超时后自动收回凭证（通常 15 分钟）。审计日志位置因系而异——Debian/Ubuntu 在 `/var/log/auth.log`，RHEL/CentOS/Rocky 与 Arch 在 `/var/log/secure`（Arch 默认可能只写 journal，可用 `journalctl -t sudo` 查看）。

三系的 sudo 资格组约定不同，这是新手跨发行版最容易踩的坑：

| 发行版家族 | 资格组 | 默认 sudoers 规则 |
|-----------|--------|------------------|
| Debian/Ubuntu | `sudo` | `%sudo ALL=(ALL:ALL) ALL`（安装时创建的首个用户自动加入） |
| Arch | `wheel` | `%wheel ALL=(ALL:ALL) ALL`（基础 sudo 包自带，用户需自行加入 wheel） |
| RHEL/CentOS/Rocky | `wheel` | `# %wheel ALL=(ALL) ALL`（默认**注释**，需手动取消注释） |

```bash
$ sudo usermod -aG sudo alice    # Debian/Ubuntu：加入 sudo 组即可
$ sudo usermod -aG wheel alice   # Arch / RHEL 系：加入 wheel 组
$ sudo visudo                    # RHEL 系还需编辑 sudoers，取消 # %wheel ALL=(ALL) ALL 的注释
```

编辑 sudoers **必须用 `visudo`**，它会在保存前做语法检查，发现错误直接拒绝写入。直接 `vim /etc/sudoers` 一旦留下语法错误，下次任何 `sudo` 调用都会失败——如果你恰好又是唯一管理员，就把自己锁在系统外了，只能靠 Live USB 救援。更稳妥的做法是在 `/etc/sudoers.d/` 下放独立文件（Debian/Ubuntu 的 `010_admin`，或任意不带 `.` 的文件名），内容一行即可：

```text
alice ALL=(ALL:ALL) ALL
```

验证配置是否生效：切换到目标用户后执行 `sudo -l`，它会明确列出当前用户被允许执行什么——没有输出或提示 `not allowed` 就说明组还没生效（重新登录）或 sudoers 规则没写对。这是排查"为什么我 sudo 不了"的第一条命令。

```bash
$ su - alice
$ sudo -l
User alice may run the following commands on ubuntu-lab:
    (ALL : ALL) ALL
```

**一个反面案例**：图省事直接给所有人开免密 sudo（`NOPASSWD:ALL`）看似方便，实则让任何拿到 SSH 会话的人（包括被入侵的服务账号）都能零成本提权。正确的做法是把提权资格收敛到少数管理员组，并且永远不要让服务账号（如 `www-data`、`nginx`）出现在 sudo 组里。

## 8. 用户切换

```bash
$ su - alice     # 正确：带 "-" 会加载目标用户的完整登录环境（HOME、PATH、shell rc 都重置）
$ su alice       # 危险：当前环境（含 root 的 PATH）被保留，容易误操作
$ sudo -u www-data -H php /var/www/html/index.php   # 以其他用户执行单条命令
$ sudo -i        # 以 root 执行：交互式 root shell，会加载 root 的登录环境
```

`su - username` 中那个容易被忽略的 `-` 决定了你是在"以 alice 的身份操作"还是"在 root 的残留环境里碰巧把 HOME 改成了 alice 的"。脚本里批量切换用户时，`su - user -c 'command'` 是比裸 `su user` 更可靠的选择。

## 9. 常见坑

1. **漏掉 `usermod -aG` 的 `-a`**。如前所述，`-G` 单独使用会清空其他补充组。养成肌肉记忆：加组永远写 `-aG`。排查方法是 `id username` 对比改动前后的 groups 列表。

2. **改了组不重新登录**。补充组不热更新，SSH 会话里 `newgrp groupname` 只能临时生效到当前 shell，持久生效必须重连。

3. **直接编辑 `/etc/sudoers`**。必须 `visudo`，或在 `/etc/sudoers.d/` 放文件。语法错误会让所有 sudo 调用失败。

4. **删除用户时连带删掉共享资源**。`userdel -r` 只负责家目录；如果该用户在共享目录（如 `/srv/git`）里创建过文件，删除账号后这些文件会留下"孤儿 UID"，`chown` 不回去。批量清理前先 `find /srv -uid <UID>` 排查。

5. **把系统账号的 Shell 改成交互式**。给 `www-data` 之类的账号开放 `/bin/bash` 会扩大攻击面——一旦 Web 应用被 GetShell，攻击者直接获得可交互 shell。系统账号保持 `/usr/sbin/nologin`。

6. **在 Arch 上照抄 Debian 教程加 `sudo` 组**。Arch 的资格组是 `wheel`，`usermod -aG sudo` 在 Arch 上会因为组不存在而直接报错（或建出一个无用的新组），随后你会发现 sudo 依然不可用。

## 参考资料

- Arch Wiki - Users and groups — [wiki.archlinux.org](https://wiki.archlinux.org/title/Users_and_groups)
- Arch Wiki - sudo — [wiki.archlinux.org](https://wiki.archlinux.org/title/Sudo)
- 鸟哥的私房菜 - 用户与群组管理 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0410account-manager.php)
- Debian 手册 - 系统管理员视角 — [debian.org](https://www.debian.org/doc/manuals/debian-handbook/)
- RHEL 9 - 管理用户和组 — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/using_selinux/)
- Ubuntu 文档 - sudo — [help.ubuntu.com](https://help.ubuntu.com/community/Sudo)
- `man useradd`、`man usermod`、`man userdel`、`man groupadd`、`man gpasswd`、`man sudoers`、`man visudo`
