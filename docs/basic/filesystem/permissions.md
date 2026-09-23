# 文件权限

权限是 Linux 安全模型的第一道闸门：它决定谁的请求能在进入 SELinux/AppArmor 之前就被内核放行或拒绝。绝大多数"服务 403""脚本无法执行""别人能删我文件"的故障，根源都不是安全模块，而是 rwx 三组位、umask 默认值或特殊权限位中的某一个没配对。本章从 DAC（自主访问控制）的底层逻辑讲起，覆盖 umask、SUID/SGID/Sticky 的真实场景与坑，最后衔接到 ACL——当 rwx 的"三类主体"模型不够用时的扩展方案，并补充 Arch 打包生态下的权限惯例。

> 内容参考自 Arch Wiki、`man 7 capabilities` 与鸟哥的私房菜，见文末参考资料。

## 学习目标

- 读懂 `ls -l` 每一列的含义，理解目录与文件在 rwx 语义上的关键差异
- 说清 umask 的计算方式与它作为"安全默认值"的作用
- 判断 SUID/SGID/Sticky 何时该用、何时是提权漏洞
- 会用 ACL 补足 rwx 表达不了的权限，并知道何时该用 ACL 而非 chmod 777
- 了解 Arch 在权限方面的惯例（wheel/sudo、pacman 装包默认权限、.pacnew）

## 1. 权限基础：DAC 模型

### 1.1 查看权限

```bash
ls -la
# -rwxr-xr-x 1 user group 4096 Jan  1 00:00 file.txt
# drwxr-xr-x 2 user group 4096 Jan  1 00:00 dir/
```
权限字段拆开看：

```text
- rwx r-x r--
│ │   │   │
│ │   │   └── 其他用户（other）
│ │   └────── 所属组（group）
│ └────────── 所有者（user/owner）
└──────────── 文件类型（- 普通文件，d 目录，l 符号链接，s SUID，t sticky）
```

Linux 属于 **DAC（自主访问控制）**：文件的 owner 可以自行决定把权限开给谁。内核做检查的顺序是固定的——**先看进程 euid 是否等于文件 owner，是则用 user 位；否则看进程所属组是否命中文件 group，是则用 group 位；都不是则落到 other 位**。理解这个顺序，才能解释"为什么我把文件给了 alice，bob 还是读不了"（group 没对上、other 又是 `---`）。

### 1.2 rwx 在文件与目录上的语义差异

这是全章最容易被忽略、也最高频出错的点：

| 权限 | 对文件的含义 | 对目录的含义 |
|------|-------------|-------------|
| r（读） | 查看文件内容 | `ls` 列出目录条目（仅名字，不等于能进入） |
| w（写） | 修改文件内容 | **创建/删除/重命名其中的条目**——这才是目录写权限 |
| x（执行） | 作为程序运行 | `cd` 进入目录、`stat` 其中文件——**没有 x 再有 w 也写不进文件** |

推论：给目录 `rwx` 却不给子文件 `x`，用户能 `ls` 看到文件名但打不开；反过来，Web 服务器要读 `/var/www/html/index.html`，需要对 `/`、`/var`、`/var/www`、`/var/www/html` 每一层都有 `x`（可进入），对目标文件有 `r`。少任何一层 `x`，报错都是 `Permission denied`——排查时用 `namei -l /var/www/html/index.html` 一次性列出整条链的权限。

### 1.3 数字表示与常见组合

| 字符 | 数字 | | 组合 | 含义 | 适用场景 |
|------|------|-|------|------|---------|
| r | 4 | | 755 | rwxr-xr-x | 目录、可执行程序：owner 全权，他人可读可进入 |
| w | 2 | | 644 | rw-r--r-- | 普通配置/文档：owner 可写，他人只读 |
| x | 1 | | 700 | rwx------ | 私人目录：仅 owner 可进（`~`、SSH 密钥目录） |
| - | 0 | | 600 | rw------- | 私人文件：仅 owner 可读写（`~/.ssh/id_ed25519`、`/etc/shadow`） |

计算方式是三位八进制相加：`rwx = 4+2+1 = 7`，`r-x = 5`，`r-- = 4`。`chmod 755` 的含义是"owner 给满、group 和 other 给读+进入"。

**为什么 644/755 是安全默认**：other 位不写（`0` 或 `4/5` 中的 w=0）意味着同机其他普通用户改不了你的文件；若文件本身又是配置类，就无需再担心被低权用户篡改。反过来，`777` 把 other 的 w 打开，等于对全机用户开放写权限——它是"图省事"的头号来源，也是被扫描器盯上的常见面。

## 2. 修改权限

### 2.1 chmod

```bash
# 数字模式（设定，覆盖原权限）
chmod 755 file.txt
chmod -R 755 directory/     # 递归——对目录慎用，会把文件也改成可执行

# 字符模式（相对增减，语义更清晰，避免算错一位权限全变）
chmod u+x file.txt     # 给所有者加执行
chmod g-w file.txt     # 去掉组的写
chmod o=r file.txt     # 其他用户设为只读
chmod a+r file.txt     # 所有人加读
chmod 750 dir/         # 只改目录本身，不递归子文件
```

符号模式的价值在于**可读性**：`chmod o-w secrets/` 比 `chmod 750 secrets/` 更能表达意图，也避免了数字模式"算错一位、权限全变"的风险。

### 2.2 chown 与 chgrp

```bash
# 修改所有者（可同时带组；:group 速记=只改组；-R 递归）
sudo chown user file.txt
sudo chown user:group file.txt
sudo chown -R user:group directory/
sudo chown :group file.txt

# chgrp：非特权用户也可用（前提：自己是该组成员）
sudo chgrp staff file.txt
```

**决策后果**：`chown -R` 递归改目录时，目录里的 SUID 位、所有 ACL 一并不会自动清除——从别处 `cp -a` 进来的文件若带 SUID，所有权变了但特权位还在。复制不可信文件后应主动检查 `getcap -r` 和 `find . -perm -4000`。

## 3. umask：新建文件的默认权限从哪来

### 3.1 为什么需要 umask

`chmod` 管"已存在文件"，**umask 管"未来新建文件"**。若新建文件默认就是 `666`（人人可写），第一个用户改过的脚本第二个用户就能篡改——umask 的作用是在进程创建文件时**扣除**一组不该默认开放的位，相当于"权限的初始安全基线"。

计算规则（注意是"扣除"不是"相减的结果直接用"，实践中按位与非即可）：

```text
文件默认权限 = 666 & ~umask     （目录 = 777 & ~umask）
```

常用口算版本（umask 无 x 位时可近似记为减法）：

| umask | 新文件 | 新目录 | 常见于 |
|-------|--------|--------|--------|
| 0022 | 644 (rw-r--r--) | 755 (rwxr-xr-x) | **绝大多数发行版默认**（root/普通用户单人场景） |
| 0002 | 666 (rw-rw-r--) | 777 (rwxrwxrwx) | 协作组目录，组内成员可互写 |
| 0077 | 600 (rw-------) | 700 (rwx------) | 高安全场景、部分服务运行用户 |

```bash
# 查看当前 umask；新建文件/目录验证
umask                                  # 0022
touch test.txt && ls -l test.txt       # -rw-r--r-- ← 666 扣掉 022 得 644
mkdir testdir && ls -ld testdir        # drwxr-xr-x ← 777 扣掉 022 得 755
```

### 3.2 为什么服务器/共享目录要改 umask

默认 `0022` 的 other 位是 `r-x`，意味着**同机任何用户都能读你的新文件**。两种典型改法：

```bash
# 临时（仅当前 shell）
umask 0027      # 新文件 640、新目录 750：同组可读，other 无权限

# 持久化：写进 shell 配置
echo "umask 027" >> ~/.bashrc

# 协作组共享目录：进入目录时强制组权限 + 0002
chmod 2775 /srv/shared        # SGID 位见下节
# 该目录下新建文件自动属于目录的组，配合 umask 0002 组员可直接互写
```

**与 ACL 的配合**：umask 只影响"新建"，不能给已存在的文件补权限；也不能表达"只给某个用户写"。这两件事都是 ACL 的领域——umask 定基线，ACL 做个案。

## 4. 特殊权限：SUID、SGID、Sticky

三位特殊位在 `ls -l` 中表现为 user 的 `s`/`S`、group 的 `s`/`S`、other 的 `t`/`T`（大写表示对应的 x 未设置）。数字上分别占千位的 4、2、1。

### 4.1 SUID：以文件 owner 身份运行

**真实场景**：普通用户要改自己的密码，但密码哈希存在 root 所有的 `/etc/shadow`，普通进程没有写权限。`/usr/bin/passwd` 因此被设置了 SUID——执行的瞬间，进程的 **effective uid 变成文件 owner（root）**，得以写 shadow，退出后恢复普通身份。

```bash
ls -la /usr/bin/passwd
# -rwsr-xr-x 1 root root 55136 ... /usr/bin/passwd   （user 组的 x 位置显示为 s）

chmod u+s script      # 或数字模式：chmod 4755 script（4 + 755）
```

**为什么这是双刃剑**：SUID 程序等于"借给执行者一部分 owner 的权力"。若该程序有输入验证漏洞（可被注入、可被利用读任意文件），攻击者就拿到 root。因此：

- 生产系统上 SUID 二进制应当是**极少数**已审计过的标准工具（`passwd`、`sudo`、`su`、`mount`、`ping`——新内核中 ping 多用 capabilities 而非 SUID）
- **内核会忽略脚本上的 SUID 位**——`chmod 4755 evil.sh` 看似生效（`ls` 显示 s），执行时特权**不会**生效。这是刻意的安全设计（历史上曾被 `#!` 解析差异利用）。想给脚本提权，正确做法是包一层二进制或改用 `sudo` 授权具体命令
- 定期审计：`find / -perm -4000 -type f 2>/dev/null`，列出的每个文件都应能回答"为什么它需要 root"

**sudo vs SUID**：`sudo` 是"把**特定命令**的授权表写进 `/etc/sudoers`"，可审计、可撤销、有日志；SUID 是"把**整个程序**的 owner 权限交给任何能执行它的人"。新需求优先 `sudo`，SUID 留给发行版自带的基础工具。

### 4.2 SGID：组的两条用法

SGID 有两个不同语义，按对象区分：

**在目录上（更常用）——新建文件继承目录的组**

```bash
# 建团队共享目录：组 staff，组员可读写，新文件自动归 staff
sudo groupadd staff
sudo chgrp staff /srv/shared
sudo chmod 2775 /srv/shared      # 2 = SGID
ls -ld /srv/shared                # drwxrwsr-x ... group 的 x 位置为 s
```

没有 SGID 时，新建文件默认继承**创建者的主组**（而非目录的组），同组协作就会出现"文件组是 alice 私有组、bob 读不了"的碎裂状态。SGID 目录把组关系固定下来，是共享工作区的标准配置。

**在可执行文件上——运行时进程 euid 相关组变为文件的组**

```bash
chmod 2755 /usr/bin/wall
# 运行 wall 的进程以 root:root 的 wall 程序组身份执行，可写所有用户的 tty
```

日常较少手动设置，出现时与 SUID 同样需要审计。

### 4.3 Sticky bit：只能删自己的文件

**真实场景**：`/tmp` 要求所有用户可写（否则谁都没法暂存文件），但若没有附加约束，甲可以删掉乙正在用的临时文件——轻则干扰，重则为竞态攻击（symlink race）开门。Sticky bit 让**只有文件 owner（或目录 owner、root）能删除条目**，其余人 w 权只对"自己创建的文件"有效：

```bash
ls -ld /tmp
# drwxrwxrwt 15 root root 4096 ... /tmp     （other 的 t）

chmod +t dir         # 或 chmod 1755 dir
```

`/tmp`、`/var/tmp`、`/dev/shm` 是系统自带的 sticky 目录。自建的群共享临时目录若也允许多人写，同样应加 sticky，否则"共享"会退化成"互相删文件"。

### 4.4 特殊位组合速查

| 位 | 数字 | `ls -l` 表现 | 一句话场景 | 主要风险 |
|----|------|-------------|-----------|---------|
| SUID | 4xxx | user 位 `s` | `passwd` 改密码 | 程序漏洞→root 提权；误加在脚本上无效但会造成错觉 |
| SGID（文件） | 2xxx | group 位 `s` | 特定工具以组身份运行 | 扩大组的可写面 |
| SGID（目录） | 2xxx | group 位 `s` | 团队目录，新文件继承组 | 组成员即获得该目录下新建文件的组权限 |
| Sticky | 1xxx | other 位 `t` | `/tmp` 防互删 | 无（应普及） |

```bash
# 审计脚本：列出系统上所有 SUID/SGID 文件（新装系统后跑一次留底）
find / -xdev \( -perm -4000 -o -perm -2000 \) -type f 2>/dev/null | sort
```

## 5. ACL：当三类主体不够用

rwx 模型只有 owner/group/other 三个槽位。要表达"文件归开发组，但运维组的 bob 也要能读、审计组只能读不能写"，就需要 ACL 在槽位之外追加任意条目：

```bash
# 查看（设置了 ACL 的文件，ls -l 的 group 位后会出现 +）
getfacl file.txt
# user::rw-
# user:bob:rw-        ← 单独给 bob 开的
# group::r--
# mask::rw-           ← 有效上限：所有 group 类条目都受它压制
# other::r--

# 授予、递归 & 默认 ACL（目录上设 default，此后新建文件自动继承）
setfacl -m u:bob:rw file.txt
setfacl -m g:ops:r file.txt
setfacl -R -m u:bob:rX shared/
setfacl -m d:u:bob:rX shared/

# 删除单条、整体清除、备份恢复（运维交接常用）
setfacl -x u:bob file.txt
setfacl -b file.txt
getfacl -R /srv/shared > acl.bak
setfacl --restore=acl.bak
```

**什么时候用 ACL、什么时候 chmod**：

| 场景 | 选择 | 理由 |
|------|------|------|
| 普通文件默认权限不对 | 调 umask/chmod | ACL 是补丁，先保证基线正确 |
| 少数文件要给特定用户/组额外权限 | ACL | 不动其他人的 other 位 |
| 大规模"按部门"授权 | ACL 或分组 + 传统权限 | ACL 配 default 可继承，维护成本低 |
| 需要审计"谁被授权了什么" | ACL | `getfacl` 是清单，chown/chmod 表达不了 |

`ls -l` 只显示一个 `+`，不显示 ACL 内容——看到 `+` 就应条件反射去 `getfacl` 查看，否则容易漏掉一条历史授权。

## 6. Arch 惯例与包管理器视角

Arch 没有独立的"权限系统"，但社区与打包生态形成了几条稳定惯例，日常使用会反复遇到：

- **管理员通过 `wheel` 组 + sudo**：安装时创建的用户默认加入 `wheel`；`/etc/sudoers`（或 `/etc/sudoers.d/wheel`）中启用 `%wheel ALL=(ALL:ALL) ALL` 后，wheel 组成员可 `sudo`。这与 Debian 把首用户放进 `sudo` 组、RHEL 用 `wheel` 组的思路一致，Arch 的默认选择是 wheel。
- **pacman 装包时的权限由 PKGBUILD 决定**：官方包安装的二进制通常是 `root:root 755`，配置文件 `644`，敏感文件如 `/etc/shadow` 由 `filesystem`/`shadow` 包以 `600`/`640` 建好。也就是说**权限基线随包而来**，升级不会把你 chmod 过的配置"改回去"，但会为**新配置文件**生成 `.pacnew` 副本供你 diff——这是 Arch 处理"包默认值 vs 你的本地修改"的方式（Debian 用 `.dpkg-dist`，RHEL 用 `.rpmnew`，语义相近）。
- **PKGBUILD 审查与权限**：AUR 包在 `makepkg` 时默认**不会**以 root 运行（也不会以 root 身份执行任意脚本），需要特权的安装步骤通过 `sudo pacman -U` 完成——这条设计把"构建"与"提权"分离。相应地，给非 root 用户跑 `makepkg` 是官方明确的推荐，`pacman` 本身则必须 root。
- **清理权限相关缓存**：`pacman -Qkk` 可检查已装包文件的完整性（包括权限被篡改的检测入口之一）；怀疑 SUID 被恶意植入时，`pacman -Qk` 对比 + `pacman -S <pkg>` 重装对应包是标准修复路径。

三家对比一句话：Debian/Ubuntu 的 `sudo` 组、RHEL/Rocky 的 `wheel` 组、Arch 的 `wheel` 组，本质是同一套 DAC + sudo 模型的不同命名；真正需要额外注意的是 SELinux（RHEL 系默认开启）会在 DAC 之上再叠一层强制检查——`ls -Z` 看到的 context 不对，即使 rwx 全对，服务照样被拒。

## 7. 常见坑

- **`chmod -R 777` 治百病**——它把 other 的 w 打开，等于邀请全机用户改你的文件。正确姿势：先 `namei -l` 定位缺权限的层级，再对**那一层** `chmod`/`chown` 最小修复。
- **给目录加了 w 却忘了 x**——结果是谁都建不了文件（写条目需要 w，找到条目需要 x）。目录权限三件套通常是 `rwx`/`r-x`/`---` 按主体分配，不要只盯 w。
- **脚本加了 SUID 不生效**——内核忽略脚本 SUID，属预期行为；改用 sudo 授权具体命令。
- **SUID 二进制被塞进用户可控路径**——如 `/home/user/bin` 下出现 root 所有的 SUID 文件，几乎必是入侵痕迹。用 `find / -perm -4000` 定期对账。
- **忽略 `ls -l` 上的 `+` 和 `.`**——`+` 表示有 ACL，`.` 表示有 SELinux context（RHEL 系）；两者都意味着"权限不止 rwx 这一层"。
- **`umask 000` 的共享目录**——图省事把 umask 置 0，新文件人人可写。协作场景用 `0002` + SGID 目录即可，不需要放开 other。
- **ACL mask 被 chmod 意外重置**——对已有 ACL 的文件直接 `chmod` 会改动 mask，可能把 ACL 授权"压"到更小的有效权限；改动前先 `getfacl` 留底。
- **把 `/etc/shadow` 改成 644**——任何普通用户可读密码哈希，离线爆破风险。该文件应保持 `640 root:shadow` 或 `600`，用 `pacman -Qk`/`rpm -Va`/`dpkg -V` 一类校验命令发现篡改后尽快恢复。

## 参考资料

- `man chmod`、`man chown`、`man umask`、`man getfacl`、`man 7 capabilities`
- Arch Wiki - File permissions and attributes — [wiki.archlinux.org](https://wiki.archlinux.org/title/File_permissions_and_attributes)
- Arch Wiki - sudo（wheel 组配置） — [wiki.archlinux.org](https://wiki.archlinux.org/title/Sudo)
- Arch Wiki - makepkg、PKGBUILD 权限相关约定 — [wiki.archlinux.org](https://wiki.archlinux.org/title/PKGBUILD)
- 鸟哥的私房菜 - Linux 文件权限 — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0210filepermission.php)
- Debian Administrator - POSIX ACL — [debian.org](https://www.debian.org/doc/manuals/debian-reference/ch06.zh-cn.html)
