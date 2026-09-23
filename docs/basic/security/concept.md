# SELinux 概念

传统 Linux 权限（rwx + user/group）有一个结构性弱点：**root 说了算**。Web 服务被攻破时，攻击者拿到的往往是运行服务的进程身份；只要进程是 root、或能通过 sudo 提权，DAC 就全线失守——文件权限挡不住一个已经是 root 的进程。强制访问控制（MAC）正是为此设计的第二道闸：即便进程 uid 为 0，只要安全策略没写"允许它碰这个文件"，内核照样拒绝。SELinux（Security-Enhanced Linux）是 Linux 内核里实现 MAC 的主流框架，由 NSA 主导开发并合入主线，今天是 RHEL 系发行版的默认安全栈；本页从 DAC 的缺陷讲起，拆解安全上下文与类型强制（Type Enforcement），并对照 Debian/Ubuntu 的 AppArmor 与 Arch 的默认无 MAC 现状，帮你建立三系安全栈的全景。

> 内容参考自 Red Hat SELinux 文档与 Arch Wiki，见文末参考资料。

## 学习目标

- 说清 DAC 的结构性缺陷，能解释为什么 root 也需要被 MAC 约束
- 读懂安全上下文 `user:role:type:level` 各字段含义，会用 `ls -Z` 验证
- 理解类型强制（Type Enforcement）如何用一条 allow 规则做访问决定
- 画出 SELinux 完整决策流程：标签匹配 → 规则查找 → 允许/拒绝
- 对照三发行版 MAC 全景，知道 RHEL 用 SELinux、Ubuntu 用 AppArmor、Arch 默认无

## 1. 为什么需要 MAC：DAC 的结构性缺陷

在 SELinux 之前，Linux 只有 DAC（Discretionary Access Control，自主访问控制）：检查的依据是**进程的 uid/gid 与文件的 rwx 位**。这套模型有一个所有者无法自己修复的缺陷——**root 例外**。

用一个真实场景说明。假设你按最佳实践把 nginx 配置成 root 启动、bind 80 端口后降权为 `www-data` 用户。某天攻击者利用 nginx 的路径穿越漏洞，拿到了以 `www-data` 身份执行任意命令的能力：

```text
DAC 的判断路径：
  进程 uid=33 (www-data)
  目标文件 /etc/shadow  owner=root group=shadow  权限 0640
  → www-data 不在 root 也不在 shadow 组 → 拒绝 ✗

看起来安全？换个目标：
  目标文件 /var/lib/nginx/../../etc/ssh/sshd_config  （经漏洞构造的路径）
  若任何环节把权限放宽、或进程实际仍持有 root 能力（capabilities 未清干净）：
  进程 uid=0 → DAC 直接放行 ✓ ← 灾难发生在这里
```

DAC 无法回答的问题是：**"一个 Web 服务器进程，应不应该有权限读 SSH 配置或写系统目录？"**——无论运行它的用户是谁，这个问题的答案都应当是"不应该"。DAC 把这个决定权交给了文件所有者（通常是 root 自己），于是漏洞一旦突破第一层用户身份，后面再无拦截。

MAC（Mandatory Access Control，强制访问控制）把决定权收回给**系统安全策略**：策略由安全管理员（或发行版策略团队）制定，普通进程乃至 root 都无权修改。SELinux 是 Linux 内核中实现 MAC 的主流框架之一（通过 LSM，Linux Security Modules）。

| 模型 | 判断依据 | 谁能改规则 | root 是否例外 |
|------|---------|-----------|--------------|
| DAC | uid/gid + rwx | 文件所有者 | 是，root 全放行 |
| MAC（SELinux） | 安全上下文 + 策略规则 | 仅策略管理工具（需加载新策略） | 否，root 进程同样受策略约束 |

一个经典的说明（摘自 Arch Wiki 的 MAC 概述）：即便你用 `sudo` 把某个进程提权为 root，只要 SELinux 策略没有写"该进程可以访问目标资源"，提权本身也不会让它突破标签边界——**MAC 约束的是"类型对类型的访问"，与 uid 无关**。

## 2. 安全上下文：每个对象都带标签

SELinux 给每个进程和每个文件都贴上一个**安全上下文（security context）**，格式为：

```text
user : role : type : level
  ↓      ↓      ↓      ↓
SELinux  SELinux  决策   MLS 层级
用户身份  角色    的核心   （启用 MLS 时才有）
```

实际查看——`ls -Z` 看文件，`ps -eZ` 看进程（RHEL/CentOS/Rocky 与装了相应工具的 Debian/Ubuntu 通用；Arch 需自行启用 SELinux 后才有 `-Z` 支持）：

```bash
$ ls -Z /var/www/html/index.html
system_u:object_r:httpd_sys_content_t:s0  /var/www/html/index.html
# 解读：system_u=SELinux用户  object_r=对象角色  httpd_sys_content_t=类型  s0=低灵敏度级别

$ ps -eZ | grep -E 'httpd|nginx' | head -3
system_u:system_r:httpd_t:s0       1523 ?  00:00:01 nginx: master
system_u:system_r:httpd_t:s0       1524 ?  00:00:00 nginx: worker
# 进程的 type 是 httpd_t（"httpd 的域"），文件的 type 是 httpd_sys_content_t
```

日常决策里真正起作用的是 **type** 字段：进程的 type 决定它运行在哪个"域（domain）"，文件的 type 决定它属于哪"类资源"。`user` 和 `role` 在 targeted 策略下基本固定，排查时可以先忽略；`level` 只在 MLS/MCS（多级安全）启用时参与比较，RHEL 默认 targeted 策略下通常都是 `s0`，不构成实际限制。

**同名文件可以有不同标签，不同文件也可以有相同标签**——标签与 Unix 权限位是叠加关系，互不替代：

```bash
$ ls -lZ /var/www/html/
-rw-r--r-- root root system_u:object_r:httpd_sys_content_t:s0  index.html    # 策略允许 httpd 读
-rw-r--r-- root root system_u:object_r:default_t:s0           secrets.env    # 标签不对，httpd 读不到
```

两个文件 DAC 权限完全相同（都是 644、root 所有），但第二个因为 type 不是 `httpd_sys_content_t`，`httpd_t` 进程读取时会被 SELinux 拒绝——这就是"改了权限还是 500"这类玄学问题的根源。

## 3. 类型强制（Type Enforcement）：SELinux 的决策引擎

Type Enforcement（TE）是 SELinux 在 targeted 策略下的核心机制，规则形如：

```text
allow httpd_t httpd_sys_content_t : file { read open getattr };
#  ↑谓词  ↑主体类型     ↑客体类型        ↑允许的客体类与操作
```

读法：**"允许 `httpd_t` 类型的进程，对 `httpd_sys_content_t` 类型的文件执行 read/open/getattr"**。没有显式 allow 的组合，默认拒绝——这是 MAC 的"默认拒绝"原则，与防火墙同构。

因此排障时的日志（AVC 拒绝记录）也是按这个三元组组织的，读懂一行 AVC 就定位了问题两端：

```text
type=AVC msg=audit(2026-09-21 14:03:11.234:412) : avc:  denied  { name_connect }
  for  pid=1024 comm="httpd" dest=3306
  scontext=system_u:system_r:httpd_t:s0        ← 谁想访问（进程 type）
  tcontext=system_u:object_r:mysqld_port_t:s0  ← 想访问什么（目标 type）
  tclass=tcp_socket                            ← 想做什么操作（连接 TCP 端口）
```

这条记录说的是：`httpd_t` 想连到标记为 `mysqld_port_t` 的 3306 端口，策略里没有对应 allow 规则，于是被拒。修复方向取决于你的意图——本来就该让 Web 连数据库？打开相应布尔值或端口标签；本来不该连？拒绝是正确行为，无需修策略。[基本命令](./commands.md)一节会给出完整的三步排障流程。

## 4. 完整决策流程

一次文件访问的检查顺序：

```text
进程发起 open()
   │
   ├─① DAC 检查（uid/rwx/ACL）── 不通过 → EACCES（普通 Permission denied）
   │         ↓ 通过
   ├─② LSM/SELinux 检查
   │     subject: httpd_t（进程标签）
   │     object:  shadow_t（文件标签）
   │     class:   file
   │     operation: read
   │         ↓
   │     查策略：allow httpd_t shadow_t : file read ?
   │         ├─ 有规则 → 放行，进入③
   │         └─ 无规则 → 记录 AVC 日志 → EACCES
   │
   └─③ 内核执行实际读写
```

两个要点：

1. **DAC 先于 MAC**。DAC 都不通过的访问，根本轮不到 SELinux 判断——所以排查"权限被拒"时仍要先 `ls -l` 确认 rwx，再 `ls -Z` 确认标签，两层都要查。
2. **Enforcing 与 Permissive 的差异只在②的"拒绝"分支**：Enforcing 真的拒绝并写日志；Permissive 只写日志、行为上放行。这正是用 Permissive 模式收集完整拒绝清单再统一修策略的原理（见[模式](./modes.md)）。

## 5. 三发行版的 MAC 全景：SELinux 只是选项之一

再次强调本章的跨发行版视角——**不要把"SELinux"等同于"Linux 的 MAC"**：

**RHEL/CentOS/Rocky/Fedora**：SELinux 是默认且默认 Enforcing 的安全栈，`targeted` 策略保护 httpd、named、dhcpd 等关键守护进程，用户进程基本不被限制。整套工具链（`semanage`、`ausearch`、`sealert`）开箱可用，本文后续命令均以该环境为基准。

**Debian/Ubuntu**：默认启用的是 **AppArmor** 而非 SELinux。AppArmor 同样基于 LSM 框架，但用**文件路径**而非类型标签定义 profile：

```bash
# Debian/Ubuntu 上查看 AppArmor 状态
$ sudo aa-status
apparmor module is loaded.
34 profiles are loaded.
14 profiles are in enforce mode.
   /usr/sbin/tcpdump ...
0 profiles are in complain mode.
```

profile 放在 `/etc/apparmor.d/`，拒绝日志通常进 `/var/log/kern.log` 或 journal。概念上与 SELinux 的"域-类型"对应"profile-路径"，但命令、日志格式、策略语法完全不同——在 Ubuntu 上找 `ausearch -m avc` 会一无所获。Debian 也提供 SELinux 选项（`wiki.debian.org/SELinux`），但需要显式安装配置，非默认。

**Arch**：官方基线**不默认启用 SELinux，也不默认启用 AppArmor**。这不是疏忽而是 Arch 的设计取舍：Arch 提供接近上游的滚动更新和最小默认配置，把是否启用 MAC、启用哪一种留给用户决定。Arch 内核自 4.18 起已包含 SELinux 支持，但用户态工具、策略、以及大量需要重新编译以链接 libselinux 的核心包均需自行处理（详见 [Arch Wiki - SELinux](https://wiki.archlinux.org/title/SELinux)），属于明确的高级定制场景；AppArmor 同样可自行安装启用。对绝大多数 Arch 服务器，实际承担边界防护的是防火墙 + DAC + 最小安装。

**给运维的实践结论**：跨发行版脚本不要假设 `getenforce` 一定可用；RHEL 系排障用 `ausearch`，Debian/Ubuntu 用 `aa-status`，Arch 先 `cat /sys/kernel/security/lsm` 看当前加载了哪些 LSM 模块再决定用哪套工具。

## 6. 常见坑

1. **只查 rwx 不查标签**：`ls -l` 显示 777 依然被拒，八成是 type 不对，用 `ls -Z` 对比正常文件。
2. **把 AppArmor 报错当 SELinux 排查**：Ubuntu/Debian 默认 AppArmor，`ausearch` 查不到东西是正常的，改看 `aa-status` 与 kern.log。
3. **忽略 DAC 直接改策略**：MAC 检查在 DAC 之后，DAC 不过时改 SELinux 策略毫无作用；先解决权限位，再看标签。
4. **在 Arch 上照搬 RHEL 命令**：默认没有 SELinux 用户态工具，`getenforce`/`semanage` 均不可用，先确认 `/sys/fs/selinux` 是否挂载。
5. **混淆 `user` 字段与 Unix 用户**：`system_u` 是 SELinux 用户身份，与登录的 root/普通用户无关，不要试图用它定位"是谁执行的"，用 `ausearch -ui` 查 Unix uid。

## 参考资料

- Red Hat - Using SELinux — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/using_selinux/index)
- Red Hat - What is SELinux — [redhat.com](https://www.redhat.com/en/topics/linux/what-is-selinux)
- Arch Wiki - SELinux — [wiki.archlinux.org](https://wiki.archlinux.org/title/SELinux)
- Arch Wiki - AppArmor — [wiki.archlinux.org](https://wiki.archlinux.org/title/AppArmor)
- Debian Wiki - SELinux — [wiki.debian.org](https://wiki.debian.org/SELinux)
- Debian Wiki - AppArmor — [wiki.debian.org](https://wiki.debian.org/AppArmor)
- `man ls`（`-Z`）、`man ps`（`-Z`）、`man audit2why`
