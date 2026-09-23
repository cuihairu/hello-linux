# SELinux 基本命令

服务突然起不来、浏览器返回 503、邮件被拒收——排到最后往往是 AVC denial 在作怪，而大多数人第一反应是 `setenforce 0` 把 SELinux 关掉了事。本页给出一条更稳妥的路径：先用 `getenforce`/`sestatus` 确认当前模式，用 `ls -Z`/`ps -Z` 读出对象与进程的安全上下文，再用 `ausearch`/`ausearch -m avc` 把内核拒绝记录翻译成人话，最后通过布尔值、端口标签、`restorecon`/`semanage fcontext` 做**最小化修复**——既放行业务，又不把 MAC 整个关掉。每一节都会对照说明 Debian/Ubuntu（AppArmor）与 Arch（默认无 SELinux）的差异，避免把 RHEL 文档的命令生搬到其他发行版上。

> 内容参考自 Red Hat 文档与各命令手册，见文末参考资料。

## 学习目标

- 熟练查看 SELinux 状态与安全上下文（`getenforce`、`ls -Z`、`ps -Z`）
- 会用布尔值与端口标签做最小改动放行，避免一出问题就关 SELinux
- 掌握 `ausearch` 排障标准流程：确认模式 → 读拒绝 → 定位类型 → 最小修复
- 分清 `chcon`、`restorecon`、`semanage fcontext` 的适用场景与持久化边界
- 能独立完成"服务被拒 → 定位 AVC → 修复 → 验证"的完整闭环

## 1. 状态查看

`getenforce` 只回答一个问题：内核当前处于 Enforcing、Permissive 还是 Disabled，它读的是运行时状态，`setenforce` 之后立刻就能看到变化。`sestatus` 给出更完整的画面：SELinuxfs 挂载点、根目录、加载的策略名、运行时模式与配置文件模式是否一致、策略是否启用 MLS 等。日常排障先跑一条 `getenforce` 就够；只有当你怀疑"改了配置没生效"或"有人临时关过"时，才需要 `sestatus` 里的两行模式对比。

```bash
$ getenforce
Enforcing

$ sestatus
Current mode:                   enforcing
Mode from config file:          enforcing
```

`Current mode` 是运行时模式，`Mode from config file` 是重启后的模式，两者可能不一致（刚 `setenforce` 过、或改了配置未重启）。Debian/Ubuntu 默认 AppArmor，这两条命令输出 `Disabled`/command not found 属正常，改用 `aa-status`；Arch 默认未启用 SELinux，先确认 `/sys/fs/selinux` 是否挂载。

## 2. 安全上下文

每个文件和每个进程都带一段安全上下文（security context），形如 `user:role:type:level`，内核做 MAC 判断时只看 `type` 字段。`ls -Z` 看文件的 type，`ps -Z` 看进程的 type——httpd 域的进程只能碰 `httpd_sys_content_t` 一类的文件，这就是"标签不匹配即拒绝"的根源。

```bash
$ ls -Z /var/www/html/index.html
system_u:object_r:httpd_sys_content_t:s0  /var/www/html/index.html

$ ps -eZ | grep nginx
system_u:system_r:httpd_t:s0   1523 ?  nginx: master process
```

改标签有两条路：`chcon` 直接写入指定 type，**不查策略**，重启或下次 `restorecon` 就会被打回原形，只适合临时验证；`restorecon` 按策略文件里的默认规则恢复"出厂标签"，是日常纠正标签漂移的标准动作；要**新增**一条永久路径→type 规则，必须先用 `semanage fcontext` 写入策略数据库，之后 `restorecon` 才能把它还原到新值（详见第 6 节与[策略配置](./policy_configuration.md)）。

```bash
$ sudo restorecon -R /var/www/html/
$ sudo restorecon -R -n -v /data/www/    # -n 只预览不修改，-v 显示将要改成什么
```

## 3. 布尔值（booleans）

布尔值是策略预留的开关，用来在不改策略代码的前提下打开/关闭一整类授权。这是**排障时优先级最高的修复手段**——它精确、可逆、有文档：targeted 策略为常见服务预留了大量开关，绝大多数"合法但被拦"的场景都有现成布尔值，先用 `getsebool -a | grep 关键词` 搜一遍往往就能命中。

```bash
$ getsebool -a | grep httpd
httpd_can_network_connect --> off
httpd_enable_cgi --> on

$ sudo setsebool -P httpd_can_network_connect on   # -P 写入磁盘，重启保留
$ getsebool httpd_can_network_connect
httpd_can_network_connect --> on
```

不加 `-P` 只对当前运行时生效，重启即丢失——这是"故障修好了又复发"的头号原因。常见场景速查：

| 业务需求 | 布尔值 |
|---------|--------|
| httpd/nginx 反向代理到后端端口 | `httpd_can_network_connect` |
| PHP/CGI 连数据库 | `httpd_can_network_connect_db` |
| httpd 写用户上传目录 | `httpd_enable_homedirs`（视策略版本，更多用 fcontext） |
| 允许 sshd 使用 PAM home 目录 | `ssh_use_pam` |

## 4. 端口标签

进程要监听的端口也带标签，标签与进程 type 不匹配时，bind 会被拒（典型：nginx 改监听 8080 被拒）。`semanage port -l` 列出所有端口标签及其覆盖的端口号；若业务端口不在列表里，用 `-a` 新增一条映射（已存在则用 `-m` 修改），不需要的自定义条目用 `-d` 删除。

```bash
$ sudo semanage port -l | grep http_port_t
http_port_t      tcp      80, 81, 443, 8008, 8443, 9000

$ sudo semanage port -a -t http_port_t -p tcp 8080
$ sudo semanage port -d -t http_port_t -p tcp 8080
```

`semanage` 属于 `policycoreutils-python-utils`（RHEL 系包名，不同版本可能略有差异），最小化安装的服务器上可能需要先安装。Arch/Debian 默认环境通常没有该命令，印证了前面章节的观点：**先确认发行版与 SELinux 是否真的启用，再执行本章命令**。

## 5. 日志分析：ausearch 标准流程

AVC 拒绝记录在 `/var/log/audit/audit.log`（RHEL 系），用 `ausearch` 查而不是裸 grep：`-m avc` 按记录类型过滤，`-ts` 限定时间窗口（`recent` 约最近十分钟，另有 `today`、`now` 或明确日期时间），`-i` 把原始字段翻译成可读文本。按进程（`-x`）、用户（`-ui`）、文件（`-f`）过滤可以把范围收窄到单次故障现场。

```bash
$ sudo ausearch -m avc -ts recent -i
type=AVC msg=audit(...) : avc:  denied  { name_connect }
  for pid=1024 comm="nginx" dest=3306
  scontext=system_u:system_r:httpd_t:s0
  tcontext=system_u:object_r:mysqld_port_t:s0

$ sudo ausearch -m avc -x nginx -i
$ sudo ausearch -m avc -ts today | audit2why -a
```

读懂上面第一条输出就抓住了排障的核心三要素：`scontext` 是谁被拒（httpd 域的 nginx）、`tcontext` 是想碰什么（MySQL 的 3306 端口标签）、`denied { name_connect }` 是想做什么动作。`audit2why -a` 会把原始 AVC 翻译成人话（"该 access 被 policy 的 dontaudit 规则禁止"、"缺少 allow 规则"等），是判断"该开布尔值还是该加标签"的关键辅助。

`sealert` 是更友好的前端（`policycoreutils` 提供），对整份 audit 日志做聚合分析，把同类拒绝归并并给出建议（有时直接提示可用的布尔值）。排障时先跑 `sealert -a /var/log/audit/audit.log` 看汇总，再用 `ausearch` 取单条细节。

### 排障标准流程（务必按顺序）

1. **确认模式**：`getenforce`/`sestatus`。显示 Disabled 或系统根本没启用 SELinux → 换思路，别在这里耗；Permissive → 日志只记录不拦，业务异常另有原因；Enforcing 且业务异常 → 进入第 2 步。
2. **抓拒绝证据**：`sudo ausearch -m avc -ts recent -i`，记下 `scontext`（谁）、`tcontext`（目标）、`tclass`+`denied`（动作）。
3. **判断修复类型**（按优先级，命中即停）：
   - 有现成布尔值？`getsebool -a | grep <关键词>` → 命中就 `sudo setsebool -P <name> on`；
   - 是文件标签不对？`ls -Z` 对比正常文件与异常文件 → 临时用 `chcon -t <type> <file>`，持久用 `semanage fcontext -a ...` 后 `restorecon -R ...`；
   - 是端口标签不对？`semanage port -l | grep <type>` → `semanage port -a -t <type> -p tcp <port>`；
   - 都不是，策略真缺规则 → 最后才考虑 [策略配置](./policy_configuration.md)中的 `audit2allow`。
4. **验证**：若曾临时关闭，先 `setenforce 1`，再复现业务操作，最后再次 `ausearch` 应无新增拒绝。

**常见错误顺序**：一上来就 `setenforce 0` 或 `audit2allow`。前者掩盖问题且重启失效，后者可能引入过宽规则。正确姿势永远是：**先读日志，再按"布尔值 → 标签 → 端口 → 策略"的优先级做最小改动**。

## 6. chcon vs restorecon vs semanage fcontext

三个命令都改标签，语义完全不同，混用是最高频的错误：

| 命令 | 修改来源 | 持久性 | 典型用途 |
|------|---------|--------|---------|
| `chcon` | 直接指定 type，**不查策略** | ❌ 重启/restorecon 即被覆盖 | 临时验证"改了标签业务是否恢复" |
| `restorecon` | 按策略文件里的默认规则**恢复** | ✅ 恢复的就是策略值 | 纠正被 chcon/拷贝弄乱的标签 |
| `semanage fcontext -a` | 向策略数据库**新增**路径→type 规则 | ✅ 之后 restorecon 才能还原到这个新值 | 为自定义路径（如 `/data/www`）定义永久标签 |

最常见的翻车现场是：给 `/data/www` 下的新站点 `chcon -t httpd_sys_content_t`，当场好了；过两天一跑 `restorecon -R /data/www/`，标签被打回 `default_t`，因为策略里根本没规定这个路径。正确的持久化写法是先把规则写进策略数据库，再让 `restorecon` 对齐：

```bash
$ sudo chcon -t httpd_sys_content_t /data/www/app/index.html   # 只管这一次
$ sudo semanage fcontext -a -t httpd_sys_content_t "/data/www(/.*)?"
$ sudo restorecon -R /data/www/                                # 从此每次都还原成它
```

一句话记忆：**`chcon` 改的是"这一次"，`semanage fcontext` 改的是"每一次"，`restorecon` 负责把当前状态对齐到策略**。详见[策略配置](./policy_configuration.md)。

## 7. 常见坑

1. **用 `grep` 直接翻 audit.log**：格式冗长且不含解释，用 `ausearch -i` 或 `sealert`；`audit.log` 可能很大，务必加 `-ts` 时间窗。
2. **`setsebool` 忘了 `-P`**：不加 `-P` 重启后开关丢失，故障"修好了又复发"。
3. **`semanage` command not found**：RHEL 最小化安装缺 `policycoreutils-python-utils`，先安装；Debian/Arch 默认环境本就没有——先确认 SELinux 是否在用。
4. **`chcon` 后重启"标签被改回去"**：见第 6 节，这是预期行为，改用 `semanage fcontext` + `restorecon`。
5. **在 Permissive 下验证修复**：Permissive 不拦任何访问，看不出修复是否生效；验证阶段务必 `setenforce 1` 再复现业务。
6. **把 AppArmor 拒绝当日志找不到**：Ubuntu/Debian 的拒绝在 kern.log/journal 的 apparmor 记录里，`ausearch -m avc` 必然为空。
7. **`-ts recent` 的窗口是最近 10 分钟**：更早的拒绝要用 `-ts today` 或明确起止时间，否则"查不到"只是时间窗太窄。
8. **先改策略后查 DAC**：MAC 排查前先 `ls -l` 确认 Unix 权限，DAC 不通过时 SELinux 根本没被咨询，改策略无意义。

## 参考资料

- Red Hat - Using SELinux（命令与排障章节） — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/using_selinux/index)
- `man semanage` — [man7.org](https://man7.org/linux/man-pages/man8/semanage.8.html)
- `man restorecon` — [man7.org](https://man7.org/linux/man-pages/man8/restorecon.8.html)
- `man setsebool` — [man7.org](https://man7.org/linux/man-pages/man8/setsebool.8.html)
- `man getsebool` — [man7.org](https://man7.org/linux/man-pages/man8/getsebool.8.html)
- `man ausearch` — [man7.org](https://man7.org/linux/man-pages/man8/ausearch.8.html)
- `man chcon` — [man7.org](https://man7.org/linux/man-pages/man1/chcon.1.html)
- `man sestatus`
- Arch Wiki - SELinux — [wiki.archlinux.org](https://wiki.archlinux.org/title/SELinux)
