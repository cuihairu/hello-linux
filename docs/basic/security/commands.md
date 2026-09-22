# SELinux 基本命令

管理 SELinux 的常用命令，以及一套从"服务被拒"到"最小化修复"的标准排障流程。

> 内容参考自 Red Hat 文档与各命令手册，见文末参考资料。

## 1. 状态查看

```bash
$ getenforce
Enforcing

$ sestatus
SELinux status:                 enabled
SELinuxfs mount:                /sys/fs/selinux
SELinux root directory:         /etc/selinux
Loaded policy name:             targeted
Current mode:                   enforcing
Mode from config file:          enforcing
Policy MLS status:              enabled
Policy deny_unknown status:     allowed
Max kernel policy version:      33
```

`Current mode` 是运行时模式，`Mode from config file` 是重启后的模式，两者可能不一致（刚 `setenforce` 过、或改了配置未重启）。Debian/Ubuntu 默认 AppArmor，这两条命令输出 `Disabled`/command not found 属正常，改用 `aa-status`；Arch 默认未启用 SELinux，先确认 `/sys/fs/selinux` 是否挂载。

## 2. 安全上下文

```bash
# 文件上下文
$ ls -Z /var/www/html/index.html
system_u:object_r:httpd_sys_content_t:s0  /var/www/html/index.html

# 进程上下文
$ ps -eZ | grep nginx
system_u:system_r:httpd_t:s0   1523 ?   00:00:01 nginx: master process

# 临时修改文件上下文（重启/restorecon 后会被策略默认规则覆盖——见第 6 节）
$ sudo chcon -t httpd_sys_content_t /data/www/new.html

# 按策略默认规则恢复上下文（日常最常用的"纠正"命令）
$ sudo restorecon -R /var/www/html/

# 递归预览将要改成什么（不实际修改，-v 显示；-n 只打印不执行）
$ sudo restorecon -R -n -v /data/www/
```

`restorecon` 的行为完全由策略文件（file contexts 配置）决定：策略说这个路径该是什么标签，它就改成什么。因此它是"恢复出厂标签"的工具；要**新增**一条永久标签规则，必须用 `semanage fcontext`（见第 6 节与[策略配置](./policy_configuration.md)）。

## 3. 布尔值（booleans）

布尔值是策略预留的开关，用来在不改策略代码的前提下打开/关闭一整类授权。这是**排障时优先级最高的修复手段**——它精确、可逆、有文档：

```bash
# 列出全部布尔值及当前状态
$ getsebool -a | grep httpd
httpd_can_network_connect --> off
httpd_can_network_connect_db --> off
httpd_enable_cgi --> on

# 持久打开（-P 写入磁盘，重启保留；不加 -P 仅当前有效）
$ sudo setsebool -P httpd_can_network_connect on

$ getsebool httpd_can_network_connect
httpd_can_network_connect --> on
```

常见场景速查：

| 业务需求 | 布尔值 |
|---------|--------|
| httpd/nginx 反向代理到后端端口 | `httpd_can_network_connect` |
| PHP/CGI 连数据库 | `httpd_can_network_connect_db` |
| httpd 写用户上传目录 | `httpd_enable_homedirs`（视策略版本，更多用 fcontext） |
| 允许 sshd 使用 PAM home 目录 | `ssh_use_pam` |

选布尔值之前先 `getsebool -a | grep 关键词` 搜一遍——targeted 策略为常见服务预留了大量开关，绝大多数"合法但被拦"的场景都有现成布尔值。

## 4. 端口标签

进程要监听的端口也带标签，标签与进程 type 不匹配时，bind 会被拒（典型：nginx 改监听 8080 被拒）：

```bash
# 查看端口标签
$ sudo semanage port -l | grep -E '^http_port_t|http_port_t'
http_port_t      tcp      80, 81, 443, 488, 8008, 8009, 8443, 9000

# 把 8080 加入 http_port_t（-a 新增；已存在则用 -m 修改）
$ sudo semanage port -a -t http_port_t -p tcp 8080

# 删除自定义条目
$ sudo semanage port -d -t http_port_t -p tcp 8080
```

`semanage` 属于 `policycoreutils-python-utils`（RHEL 系包名，不同版本可能略有差异），最小化安装的服务器上可能需要先安装。Arch/Debian 默认环境通常没有该命令，印证了前面章节的观点：**先确认发行版与 SELinux 是否真的启用，再执行本章命令**。

## 5. 日志分析：ausearch 标准流程

AVC 拒绝记录在 `/var/log/audit/audit.log`（RHEL 系），用 `ausearch` 查而不是裸 grep：

```bash
# 最近的 SELinux 拒绝（-m avc 匹配记录类型，-i 转换成可读文本）
$ sudo ausearch -m avc -ts recent -i
type=AVC msg=audit(09/22/26 14:03:11.234:412) : avc:  denied  { name_connect }
  for  pid=1024 comm="nginx" dest=3306 scontext=system_u:system_r:httpd_t:s0
  tcontext=system_u:object_r:mysqld_port_t:s0 tclass=tcp_socket

# 按时间窗口
$ sudo ausearch -m avc -ts today -i
$ sudo ausearch -m avc -ts 09/22/2026 14:00:00 -ei   # 到现在

# 按进程/用户/文件过滤
$ sudo ausearch -m avc -x nginx -i
$ sudo ausearch -m avc -ui 1000 -i
$ sudo ausearch -m avc -f /etc/shadow -i

# 今天的全部 AVC，交给 audit2why 解读（回答"为什么被拒"）
$ sudo ausearch -m avc -ts today | audit2why -a
```

`audit2why` 会把原始 AVC 翻译成人话（"该 access 被 policy 的 dontaudit 规则禁止"、"缺少 allow 规则"等），是判断"该开布尔值还是该加标签"的关键辅助。

`sealert` 是更友好的前端（`policycoreutils` 提供），对整份 audit 日志做聚合分析：

```bash
$ sudo sealert -a /var/log/audit/audit.log
```

输出会把同类拒绝归并、给出建议（有时直接提示可用的布尔值），排障时先跑 `sealert` 看汇总，再用 `ausearch` 取单条细节。

### 排障标准流程（务必按顺序）

```
① 确认模式          getenforce / sestatus
                      ├─ Disabled/非 SELinux 系统 → 换思路，别在这里耗
                      └─ Permissive → 日志只记录不拦，业务异常另有原因
                      └─ Enforcing 且业务异常 → 继续②

② 抓拒绝证据        sudo ausearch -m avc -ts recent -i
                      → 记下 scontext（谁）、tcontext（目标）、tclass+denied（动作）

③ 判断修复类型（按优先级，命中即停）
                      a) 有现成布尔值？      getsebool -a | grep <关键词>
                         → sudo setsebool -P <name> on
                      b) 是文件标签不对？     ls -Z 正常文件 vs 异常文件
                         → 临时: chcon -t <type> <file>
                           持久: semanage fcontext -a ... && restorecon -R ...
                      c) 是端口标签不对？     semanage port -l | grep <type>
                         → semanage port -a -t <type> -p tcp <port>
                      d) 都不是，策略真缺规则 → [策略配置] audit2allow（最后手段）

④ 验证              setenforce 1（若曾临时关闭）→ 复现业务操作 → 再次 ausearch 应无新增拒绝
```

**常见错误顺序**：一上来就 `setenforce 0` 或 `audit2allow`。前者掩盖问题且重启失效，后者可能引入过宽规则。正确姿势永远是：**先读日志，再按"布尔值 → 标签 → 端口 → 策略"的优先级做最小改动**。

## 6. chcon vs restorecon vs semanage fcontext

三个命令都改标签，语义完全不同，混用是最高频的错误：

| 命令 | 修改来源 | 持久性 | 典型用途 |
|------|---------|--------|---------|
| `chcon` | 直接指定 type，**不查策略** | ❌ 重启/restorecon 即被覆盖 | 临时验证"改了标签业务是否恢复" |
| `restorecon` | 按策略文件里的默认规则**恢复** | ✅ 恢复的就是策略值 | 纠正被 chcon/拷贝弄乱的标签 |
| `semanage fcontext -a` | 向策略数据库**新增**路径→type 规则 | ✅ 之后 restorecon 才能还原到这个新值 | 为自定义路径（如 `/data/www`）定义永久标签 |

```bash
# 错误但常见的写法：chcon 只是权宜之计
$ sudo chcon -t httpd_sys_content_t /data/www/app/index.html
$ ls -Z /data/www/app/index.html
system_u:object_r:httpd_sys_content_t:s0  ...        # 现在对了

$ sudo restorecon -R /data/www/
$ ls -Z /data/www/app/index.html
system_u:object_r:default_t:s0  ...                   # 又被打回原形！
# 因为策略里根本没规定 /data/www 的标签，restorecon 只能按默认规则打 default_t
```

正确的持久化写法：

```bash
$ sudo semanage fcontext -a -t httpd_sys_content_t "/data/www(/.*)?"
$ sudo restorecon -R /data/www/
$ ls -Z /data/www/app/index.html
system_u:object_r:httpd_sys_content_t:s0  ...        # 这次 restorecon 也会还原成 httpd_sys_content_t
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
