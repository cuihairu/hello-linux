# SELinux 策略配置

当布尔值、端口标签、文件标签都无法覆盖你的需求时，才需要真正面对策略本身。本节讲清 targeted/minimum/mls 三种策略的定位、file contexts 的持久化配置方法，以及 `audit2allow` 这把双刃剑的正确用法。

> 内容参考自 Red Hat 文档与 Arch Wiki，见文末参考资料。

## 学习目标

- 分清 targeted、minimum、mls 三种策略的定位与适用场景
- 理解 file contexts 为什么是策略记忆标签的正确载体
- 掌握 `semanage fcontext` 持久化自定义标签 + `restorecon` 生效的流程
- 认识 `audit2allow` 的双刃剑属性，知道何时可用、何时危险
- 对照三发行版，确认相关命令与策略包的可用性差异

## 1. 策略类型：targeted、minimum、mls

RHEL 系在 `/etc/selinux/config` 里用 `SELINUXTYPE=` 选择已安装的策略包，最常见的三种各有明确分工：

| 策略 | 保护范围 | 典型用户 | 说明 |
|------|---------|---------|------|
| **targeted**（默认） | 仅指定守护进程（httpd、named、dhcpd、samba…）在受限域内；用户进程基本不受限 | 绝大多数服务器 | 用"只管该管的"换取易用性，是发行版默认 |
| **minimum** | targeted 的精简子集，常用于容器/最小镜像 | 受限环境 | 规则更少、攻击面更小，但可保护的服务也少 |
| **mls**（Multi-Level Security） | 全系统按安全等级（confidential/secret…）强制分级 | 军工/强合规场景 | 日常运维复杂度极高，绝非默认推荐 |

```bash
# 查看当前加载的策略
$ sestatus | grep 'Loaded policy'
Loaded policy name:             targeted

# 查看系统里安装了哪些策略包
$ ls /etc/selinux/
config  mls  minimum  targeted
```

日常排障**几乎不会**需要切换策略类型——切换意味着全部安全上下文重新打标、大量域/类型规则重新对齐，等同于一次安全架构变更，必须停机规划。下面两节的日常配置（file contexts、audit2allow）全部基于当前策略（99% 情况是 targeted）。

## 2. 文件上下文（file contexts）：策略如何记住"该是什么标签"

targeted 策略为标准路径预置了标签规则（`/var/www/html → httpd_sys_content_t`、`/etc/ssh → sshd_exec_t` 相关…）。规则以**正则**形式存在策略数据库里，`restorecon` 每次执行就是把磁盘上文件的标签与这些规则对齐。

查看某路径当前生效的策略标签（不看文件实际标签，看"应该是什么"）：

```bash
$ matchpathcon -V /var/www/html/index.html
/var/www/html/index.html  system_u:object_r:httpd_sys_content_t:s0

# 与实际标签对比（实际标签用 ls -Z）
$ ls -Z /var/www/html/index.html
system_u:object_r:default_t:s0  /var/www/html/index.html   # 不一致 → 需要 restorecon
```

两者不一致 = 文件标签被 `chcon`/拷贝/恢复备份等操作弄脏了，`restorecon` 一发即可纠正：

```bash
$ sudo restorecon -R -v /var/www/html/
```

**问题在于自定义路径**：策略数据库里没有 `/data/www` 的规则，`matchpathcon` 只能给出 fallback（通常是 `default_t`），`restorecon` 也永远打不上 `httpd_sys_content_t`——这正是第 3 节 `semanage fcontext` 存在的原因。

## 3. 持久化自定义标签：semanage fcontext

`chcon` 改的是 inode 当前值，重启即被策略默认规则（或缺失规则下的 default）冲掉。要让 `/data/www` **永久**属于 `httpd_sys_content_t`，必须把规则写进策略数据库：

```bash
# -a 新增规则；目标类型 httpd_sys_content_t；路径支持正则
$ sudo semanage fcontext -a -t httpd_sys_content_t "/data/www(/.*)?"

# 让规则立刻落到现有文件（新文件只要父目录规则正确也会继承）
$ sudo restorecon -R -v /data/www/
$ ls -Z /data/www/app/index.html
system_u:object_r:httpd_sys_content_t:s0  /data/www/app/index.html

# 确认规则已入库
$ semanage fcontext -l | grep '/data/www'
/data/www(/.*)?    all files    system_u:object_r:httpd_sys_content_t:s0
```

路径正则要点（与 `semanage` 文档一致）：

- `"/data/www(/.*)?"` 匹配目录本身及其所有后代——**目录和文件要一起覆盖**，只写 `"/data/www"` 不会管到里面的文件。
- 字面量里的 `.` 要注意正则语义；路径含特殊字符时按 `semanage-fcontext(8)` 的规则转义。
- 修改已存在规则用 `-m`，删除用 `-d`：

```bash
$ sudo semanage fcontext -m -t httpd_sys_sys_content_t "/data/www(/.*)?"
$ sudo semanage fcontext -d "/data/www(/.*)?"
```

**完整持久化流程固定为两步**：`semanage fcontext`（写策略）→ `restorecon`（应用到磁盘）。只做第一步，现有文件仍是旧标签；只做第二步，没有规则可依、改了也会被下次 relabel 冲掉。

`semanage` 其他常用子命令（与 fcontext 同属策略数据库操作）：

```bash
semanage port -l                    # 端口标签（见命令篇）
semanage user -l                    # SELinux 用户映射
semanage login -l                   # 登录用户 → SELinux 用户
semanage boolean -l                 # 布尔值（只读；修改用 setsebool -P）
```

RHEL 最小化安装需 `policycoreutils-python-utils` 提供 `semanage`。

## 4. audit2allow：最后手段，不是第一步

当第 1–3 节的手段（布尔值 → fcontext/端口标签）都确认不适用、策略确实缺少一条业务必需的 allow 规则时，才用 `audit2allow` 把拒绝日志转成策略模块：

```bash
# 从今天的 AVC 拒绝生成模块源码（先审阅再编译！）
$ sudo ausearch -m avc -ts today | audit2allow -R -W mypolicy -N mypolicy
# -W 写出 .te 源文件  -N 指定模块名  -R 同时生成 requires

$ cat mypolicy.te        # ← 必须人工审阅这一行 allow 是否合理
module mypolicy 1.0;
require { type httpd_t; type mysqld_port_t; class tcp_socket name_connect; }
allow httpd_t mysqld_port_t:tcp_socket name_connect;

# 确认无误后编译安装（-i 安装本地模块）
$ sudo checkmodule -M -m -o mypolicy.mod mypolicy.te
$ sudo semodule_package -o mypolicy.pp -m mypolicy.mod
$ sudo semodule -i mypolicy.pp

# 确认已加载
$ sudo semodule -l | grep mypolicy
```

更简单的一次性写法（把审核结果直接灌给 semodule，**风险更高，务必先看过生成内容**）：

```bash
$ sudo ausearch -m avc -ts today | audit2allow -a -M adhoc_fix
```

### 为什么这是"最后手段"

1. **审计问题**：`audit2allow` 的唯一依据是"日志里出现过这条拒绝"，它不理解业务意图——一次误操作、一次攻击探测产生的拒绝，都可能被生成为合法 allow。
2. **规则过宽**：生成的 `allow` 常常带满 `*` 权限（`{ read write open getattr ... }`），远超业务实际所需；正确做法是手工把权限缩到最小。
3. **掩盖根因**：很多时候拒绝的真正原因是文件标签错了（该 `restorecon`）或端口标签没加（该 `semanage port`），直接 allow 等于用策略模块给错误状态盖章。
4. **不可维护**：自定义模块散落在 `local` 组件里，升级发行版策略包时可能冲突，且无人记得它为什么存在——必须在模块 `.te` 文件注释里写清业务背景并纳入版本管理。

**决策口诀**：能用布尔值就用布尔值；能用 fcontext/端口标签就用标签；两者都不行、且拒绝合理出现在业务路径上，才生成模块——生成后必须审阅、缩权、注释、入库。

## 5. 三发行版对照：本节命令的可用性

| 操作 | RHEL/CentOS/Rocky | Debian/Ubuntu | Arch |
|------|-------------------|---------------|------|
| 查 file context 规则 | `matchpathcon`、`semanage fcontext -l` | 默认 SELinux 未启用，无对应；AppArmor 看 profile 文件 | 默认未启用，自行启用后可用同套工具 |
| 持久化自定义标签 | `semanage fcontext` + `restorecon` | 不适用（改 `/etc/apparmor.d/` profile） | 自行启用后同 RHEL |
| 策略模块管理 | `semodule -i/-l/-r` | 不适用 | 自行启用后同 RHEL |
| 布尔值 | `setsebool -P` / `getsebool -a` | 不适用（AppArmor 无布尔值概念） | 同上 |

Debian/Ubuntu 的 AppArmor 对应概念是 **profile**（基于路径而非 type 标签）：新增规则 = 编辑 `/etc/apparmor.d/<profile>` 后 `apparmor_parser -r` 或重启服务；不存在"给文件改标签"这一步。Arch 默认两者都没有，策略配置无从谈起——再次印证：动手前先 `getenforce`/`aa-status`/`cat /sys/kernel/security/lsm` 确认现场。

## 6. 常见坑

1. **只 `restorecon` 不 `semanage fcontext`**：自定义路径没有策略规则，restorecon 打不上你想要的标签，下次 relabel 更是必然回退——顺序不能反，缺一不可。
2. **fcontext 路径没写 `(/.*)?`**：只覆盖了目录本身，里面的文件仍是旧标签，业务依旧被拒；目录与后代要一起匹配。
3. **`audit2allow -a` 不看直接装**：可能把攻击探测或标签错误固化成 allow；永远先 `-W` 生成 `.te` 审阅。
4. **用 audit2allow 解决本该 restorecon 的问题**：拒绝日志里 tcontext 是 `default_t` 十有八九是标签缺失，先 `matchpathcon` 对比，修标签而不是加 allow。
5. **自定义模块不留文档**：半年后没人知道为何有这条 allow；`.te` 里写清业务原因，模块源文件进 Git。
6. **把切换 `SELINUXTYPE` 当日常操作**：targeted↔mls 是架构级变更，全盘 relabel + 业务复测，不能随配随切。
7. **在 Debian/Ubuntu/Arch 上跑本节命令**：默认环境没有 SELinux 策略栈（或 AppArmor），`semanage`/`semodule`/`matchpathcon` 要么不存在要么不生效——先读[概念](./concept.md)第 5 节确认现场。

## 参考资料

- Red Hat - Using SELinux（Customizing SELinux / Policy 章节） — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/using_selinux/index)
- `man semanage-fcontext` — [man7.org](https://man7.org/linux/man-pages/man8/semanage-fcontext.8.html)（经 semanage 手册页 [man7.org](https://man7.org/linux/man-pages/man8/semanage.8.html) 索引）
- `man audit2allow` — [man7.org](https://man7.org/linux/man-pages/man1/audit2allow.1.html)
- `man semodule` — [man7.org](https://man7.org/linux/man-pages/man8/semodule.8.html)
- `man matchpathcon`
- Arch Wiki - SELinux（Policy / audit2allow 章节） — [wiki.archlinux.org](https://wiki.archlinux.org/title/SELinux)
- Debian Wiki - SELinux — [wiki.debian.org](https://wiki.debian.org/SELinux)
