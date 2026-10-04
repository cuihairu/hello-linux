# SELinux 实战

一台 Rocky 上的 httpd 部署完毕，防火墙放行、`chmod` 调到位、`curl` 本机一切正常，换到 `/srv/www` 立刻 403；Samba 共享本地读写全通，Windows 客户端一连就是"无权访问"——两种现场指向同一个嫌疑人：SELinux。它在传统权限（DAC）之上再加一层类型强制（MAC），拦你的时候不报权限错误、不改进程状态，只在审计日志里留下一条 AVC 拒绝，客户端侧看到的只有一句含糊的拒绝。基础篇已经讲过它是什么（[SELinux 概念](../basic/security/concept.md)、[模式](../basic/security/modes.md)、[命令](../basic/security/commands.md)、[策略配置](../basic/security/policy_configuration.md)），本页是服务器实战篇：RHEL/Rocky 生产机上被它拦住时的诊断与修正方法论，用 httpd、Samba、NFS 三个真实案例贯穿——学完这一页，`setenforce 0` 将从你的排障清单上消失。

> 内容参考自 SELinux 项目 Notebook 与 Red Hat 官方文档（概念框架参考鸟哥的私房菜基础篇），见文末参考资料。

## 学习目标

- 把"服务不工作"拆成 DAC 与 MAC 两层，用 AVC 证据而不是猜来定位
- 读懂 `ausearch` 的 scontext / tcontext / tclass 三元组，直接得出对症的修正手段
- 掌握三级修正的优先序：改标签 > 开端口 > 开布尔，最后才是自建模块
- 熟练 `semanage fcontext` + `restorecon` 的持久化组合，分清它与 `chcon` 的生命周期
- 知道 `audit2allow` 的适用边界与本地模块的生命周期管理

## 1. 从"关掉它"到"读懂它"

### 1.1 为什么 enforcing 是默认而不是找麻烦

RHEL 系默认 `enforcing`，常被第一次接触的人解读成"发行版故意找麻烦"。事实相反：confined 服务被拿下（RCE、XXE、反序列化）之后，SELinux 把攻击者的动作半径压回这个服务本该有的范围——httpd 即使被 webshell 控住，也读不到 `/etc/shadow`、连不出去随便的端口，这层收窄就是攻击面管理的日常。关掉它等于把"万一突破防线"的代价从"服务级"升到"主机级"，所以 `setenforce 0` 在生产上只有一种正当用法：**排除法的一步**——用它确认问题确实出在 MAC 层，确认完立刻改回来；把它留在变更单里当"修复"，是本页要消灭的坏习惯。

permissive 是正确的工作模式：策略照常求值、告警照常记录，只是不拦截。诊断期把机器临时切到 permissive（`setenforce 0`），让被拦的操作全部走通并把完整 AVC 队列攒出来，定位完再切回 enforcing 看是否清零——这是"读"而非"关"的正确姿势；模式的语义与三系默认值在[模式](../basic/security/modes.md)有完整展开，此处不重复。

### 1.2 本页方法论：四级修正的优先序

诊断从证据出发，修正则按"改动半径从小到大"排优先级。四个等级修的是不同东西，混用会留下越修越宽的策略债：

| 等级 | 手段 | 修的是什么 | 生命周期 |
|------|------|-----------|---------|
| 1 | `semanage fcontext` + `restorecon` | 文件"该是什么标签" | 持久（策略库） |
| 2 | `semanage port` | 端口"允许哪类服务绑" | 持久（策略库） |
| 3 | `setsebool -P` | 域的某项被禁能力 | 持久（策略库） |
| 4 | `audit2allow` 自建模块 | 现有规则里没有的新放行 | 持久，且**最宽** |
| 反例 | `setenforce 0` / 关策略 | 整层防御 | 半持久（重启回归，但没人记得改回） |

能用第 1 级修的绝不用第 2 级，能开布尔的绝不上第 4 级——这个顺序就是最小权限本身。案例部分（第 3-5 节）每一节都按"现象 → AVC 证据 → 选级修正 → 验证"走完整闭环。

## 2. 诊断的起点：AVC 拒绝

### 2.1 `ausearch`：把拒绝读成三元组

一切从审计日志开始。服务被拒后立刻取证：

```bash
$ sudo ausearch -m avc -ts recent
----
time->Thu Oct  2 21:14:37 2026
type=AVC msg=audit(1759415677.124:4256): avc:  denied  { read } for  pid=812 comm="httpd" \
  name="index.html" dev="dm-0" ino=5242931 \
  scontext=system_u:system_r:httpd_t:s0 \
  tcontext=unconfined_u:object_r:var_t:s0 \
  tclass=file permissive=0
```

逐段判读：`denied { read }` 是被拒的**动作集合**（可以同时出现 `{ read open }`）；`comm="httpd"` 是发起进程；主角是后面三个字段——**scontext**（主体：谁在动手，这里 `httpd_t` 是 httpd 的域）、**tcontext**（客体：动的是什么，`var_t` 意思是"标签没归到任何服务的普通变量文件"）、**tclass**（客体类别：文件、端口、能力、套接字……）；`permissive=0` 说明这条是真被拦（permissive 下为 1，只记账不拦）。

三元组一读，结论其实已经出来了："httpd 域要读一个标签为 `var_t` 的文件"——策略里没有这条放行，因为 `/var/www/html` 打的是 `httpd_sys_content_t`，而你新建的 `/srv/www` 还是裸的 `var_t`。**解法不是放行 `var_t`，而是把目录打成 `httpd_sys_content_t`**：放行动作会连带所有 `var_t` 文件（半个系统都在这个标签下），修正标签则恰好把这一个目录纳入 httpd 本就该有的权限。这个"改客体还是改规则"的判断，贯穿全页。

`ausearch -m avc -ts recent` 的 `recent` 也可换时间窗（`-ts today`、`-ts yesterday`）；带 `-ts boot` 能看本次开机以来的全部拒绝。setroubleshoot 装了之后（`dnf install setroubleshoot-server`）同一事件会有一份人话版：

```bash
$ journalctl -t setroubleshoot --since "21:10" | head -3
... SELinux is preventing httpd from read access on the file index.html.
... For complete SELinux failure messages run: sealert -l <uuid>
```

`sealert -l <uuid>` 给出进一步建议——它的输出当参考，最终判断仍以三元组为准。规则层面想反查"到底哪条策略管这事"，用 setools 套件的 `sesearch`：

```bash
$ sesearch --allow -s httpd_t -t var_t -c file
# 无输出 = 策略里确实没有 httpd_t 读 var_t 的放行
$ sesearch --allow -s httpd_t -t httpd_sys_content_t -c file | head -3
allow httpd_t httpd_sys_content_t:file { read open getattr ... };
```

查得到与查不到的对比，就是"标签错"最硬的证据。

## 3. 案例①：httpd 的目录、端口与反向代理

### 3.1 现象与取证：自定义目录 403

站点文档根从默认的 `/var/www/html` 挪到 `/srv/www`，权限给足 `755`、属主 `apache`，`curl` 仍 403。先用标签视角看现场——`ls -Zd` 直接打印上下文：

```bash
$ ls -Zd /var/www/html /srv/www
unconfined_u:object_r:httpd_sys_content_t:s0 /var/www/html
unconfined_u:object_r:var_t:s0               /srv/www
```

标签差异一目了然。配一条 AVC 佐证（tcontext 为 `var_t`），定性完成。

### 3.2 修正：持久打标签的两步组合

`semanage fcontext` 把"路径模式 → 类型"写进策略库，`restorecon` 按账本把现存文件的标签改到位——两步缺一不可：

```bash
$ sudo semanage fcontext -a -t httpd_sys_content_t "/srv/www(/.*)?"
$ sudo restorecon -Rv /srv/www
Relabeled /srv/www from unconfined_u:object_r:var_t:s0 to unconfined_u:object_r:httpd_sys_content_t:s0
Relabeled /srv/www/index.html from unconfined_u:object_r:var_t:s0 to unconfined_u:object_r:httpd_sys_content_t:s0
$ sudo systemctl restart httpd && curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/
200
```

注意 `-a` 是追加规则，目录后来换过路径要先 `-d` 删旧规则；正则 `(/.*)?` 覆盖目录自身与全部后代。对照组是 `chcon -t httpd_sys_content_t -R /srv/www`——它只改当前 inode 的标签，**不进策略库**，下次 `restorecon` 或文件系统 relabel 就打回原形。两者的分工一句话：`semanage fcontext` 立规矩、`restorecon` 执行、`chcon` 只是临时涂改。这与[策略配置](../basic/security/policy_configuration.md)第 3 节讲过的账本语义完全一致，本页强调的是它在真实故障里的位置——它是四级修正的第一级。

### 3.3 同一案例的第二现场：非标端口 8181

文档根通了，再把监听口从 80 改到 8181，服务起不来：

```bash
$ sudo systemctl status httpd --no-pager | head -5
Oct 02 21:22:11 rocky httpd[1044]: (13)Permission denied: AH00072: make_sock:
  could not bind to address [::]:8181
...
$ sudo ausearch -m avc -ts recent | grep tclass
type=AVC ... avc:  denied  { name_bind } for ... tclass=port
```

不是 `chmod`、不是端口占用，是 `{ name_bind }` 对 `tclass=port` 的拒绝——绑定这个端口本身需要类型授权。先看现有白名单，再登记新端口：

```bash
$ semanage port -l | grep http_port_t
http_port_t    tcp   80, 81, 443, 488, 8008, 8009, 8443, 9000
$ sudo semanage port -a -t http_port_t -p tcp 8181
$ sudo systemctl restart httpd && systemctl is-active httpd
active
```

端口登记只解决"SELinux 允许绑"，防火墙放行是另一条独立轨道——`firewall-cmd --add-port=8181/tcp` 属于[防火墙篇](./firewall.md)的职责；两层各自独立、都必须过，是本页反复出现的"每层只管自己那半"结构。

### 3.4 还差半步：反向代理出站连接

httpd 作为反向代理向后端 `8080` 发请求，页面 502，AVC 里出现 `{ name_connect }`：

```bash
$ sudo setsebool -P httpd_can_network_connect on
$ sudo setsebool -a | grep httpd_can_network_connect
httpd_can_network_connect --> on
```

`-P` 让设置持久化——漏掉 `-P` 是最高频的"重启后又坏了"。至此三级修正都过了：标签（3.2）、端口（3.3）、布尔（3.4），且一次都没碰 `setenforce`。回看 1.2 的优先序表，三个案例分别落在第 1、2、3 级——每一级修的都是"这个服务该有的能力"，策略整体的收紧程度分毫未动。

## 4. 案例②：Samba 共享目录

Samba 的完整部署（`smb.conf`、用户、共享定义）在[服务器篇 Samba](../server/samba.md)，其第 5 节已给出标签修正；本页补诊断路径与语义边界。典型现场：`smbclient -L` 列得出共享、一进就 `NT_STATUS_ACCESS_DENIED`，而同一路径用本地 `cat` 完全正常——**本地通、SMB 拒**，这个不对称本身就是信号：DAC 若拦你，本地也该拦；本地通说明 DAC 绿灯，只剩 MAC 层。

```bash
$ sudo ausearch -m avc -ts recent | grep -E "comm|scontext" | head -2
type=AVC ... comm="smbd" ... scontext=system_u:system_r:smbd_t:s0 \
  tcontext=unconfined_u:object_r:var_t:s0 tclass=dir
$ ls -Zd /srv/samba/data
unconfined_u:object_r:var_t:s0 /srv/samba/data
```

smbd 域对 `var_t` 目录的 `search` 被拒——与 httpd 案例同构，解法也同构（第 1 级）：

```bash
$ sudo semanage fcontext -a -t samba_share_t "/srv/samba(/.*)?"
$ sudo restorecon -Rv /srv/samba
```

语义边界要清楚：`samba_share_t` 打上之后，这个目录的访问权**整体移交**给 Samba 策略——smbd 对它可读写，但系统里其他 confined 域（httpd、sshd）默认拿不到，这正是标签的意义：给"谁的地盘"划界。共享家目录另有开关，`[homes]` 生效需要 `setsebool -P samba_enable_home_dirs on`；标签与布尔的分工是"地盘归属"对"额外能力"——前者用标签，后者用布尔，别拿布尔当地盘用（布尔没有隔离性，开了是对全域生效）。

## 5. 案例③：NFS 导出与布尔矩阵

NFS 的 SELinux 面比文件标签更靠近"能力开关"。服务器篇的 [NFS](../server/nfs.md) 提过这对布尔：默认只读导出放行、读写导出收紧——

```bash
$ getsebool -a | grep nfs_export
nfs_export_all_ro --> on
nfs_export_all_rw --> off
```

场景判断：`/etc/exports` 里给 `192.168.56.0/24` 开了 `rw`，客户端挂上却 `Read-only file system`——本地 `mount` 看着正常、`exports` 也对，症结在 `nfs_export_all_rw` 为 off。放开即通（`setsebool -P nfs_export_all_rw on`）。什么时候该开它：这台机器本来就专职做读写导出时；什么时候不该开：只给个别目录读写时——布尔是全域开关，没有"仅这个导出"的粒度，此时的正解其实是回到导出配置本身（exports 里没开 `rw` 的目录压根不该被当读写用），布尔只回答"这台 nfsd 有没有开读写导出的资格"。

RPC 侧一句话收尾：nfsd 与 rpc.* 守护进程的端口类型（`nfs_port_t` 等）由策略默认放行，`firewall-cmd --add-service=nfs` 放 2049 是防火墙的事，两层分工同 3.3——NFS 页的排错节已把 `exportfs -v` → `showmount` → 实测写 的顺序给了，MAC 异常就在"实测写"这一步之前插一层 `getsebool nfs_export*` 即可。

## 6. 策略本地化的最后一公里：`audit2allow`

三级都试过、AVC 仍新（域与客体的组合在策略里根本没这条规则），才轮到自建模块。闭环四步：

```bash
$ sudo ausearch -m avc -ts today | sudo audit2allow -M myhttpd
******************** IMPORTANT ***********************
To make this policy package active, type:
# semodule -i myhttpd.pp
$ cat myhttpd.te
module myhttpd 1.0;
require {
        type httpd_t;
        type var_t;
        class file read;
}
#============= httpd_t ==============
allow httpd_t var_t:file read;
$ sudo semodule -i myhttpd.pp
$ semodule -l | grep myhttpd
myhttpd    1.0
```

**`cat myhttpd.te` 这一步不能跳**——它就是你实际放行的内容。反面案例：一次排障生成的 `.te` 里写着 `allow httpd_t var_t:file *;`（`audit2allow` 看到的是今天所有 AVC 的并集，往往比你直觉的宽），装上去等于给 httpd 开了半个系统的读权限。生成的模块是两份文件：`.te` 是可读源码、`.pp` 是编译产物，**`.te` 要进版本库**（它是这份放行的唯一可审计文本），换机器、换版本时重新 `checkmodule -M -m -o` 编译或直接复用 `.pp`（同策略版本内）。

使用边界与[策略配置](../basic/security/policy_configuration.md)第 4 节的结论一致，本页加一条现场判据：**先问"标签对不对"，再问"该不该开布尔"，最后才问"要不要新规则"**——顺序错位（一上来就 `audit2allow`）的产物通常是"放行了错标签"，症状是当时好了、三个月后同型故障换个目录再来一遍。模块生命周期管理：

```bash
$ semodule -l                # 已装模块（-l 按字典序，-l --latest-version 看版本）
$ sudo semodule -r myhttpd   # 卸载
```

## 7. 模式与策略的管理面

### 7.1 运行时与持久化是两本账

`setenforce 0/1` 只改当前运行状态，重启后回归 `/etc/selinux/config` 的 `SELINUX=` 取值——排障时切了 permissive 忘改回，机器重启后"莫名好了"其实只是回归 enforcing 而问题仍在，这类幽灵故障在变更单上留一行"临时 permissive，回收时间"比任何技巧都值钱：

```bash
$ cat /etc/selinux/config
SELINUX=enforcing        # enforcing / permissive / disabled 三态
SELINUXTYPE=targeted     # targeted 为默认；minimum 与 mls 是另两档（见基础篇策略配置）
$ getenforce
Enforcing
$ sestatus
SELinux status:                 enabled
SELinuxfs mount:                /sys/fs/selinux
SELinux root directory:         /etc/selinux
Loaded policy name:             targeted
Current mode:                   enforcing
Mode from config file:          enforcing
```

`disabled` 与前两者的区别是量级的：它不加载策略子系统（`/sys/fs/selinux` 都不挂），从 disabled 切回 enforcing 必须全盘 relabel——**不要为了"省事"选 disabled**，那是把第 7 章整章绕开而不是解决。mls 档位一句话带过：多级安全标签（分类 + 等级），只有军政类场景需要，默认 targeted 不涉及。

### 7.2 relabel 的三种触发与账本语义

策略库变了、或文件系统在别处创建过（镜像克隆、外部拷入），标签要全盘按账本重打：

```bash
$ sudo touch /.autorelabel && sudo reboot      # 重启时全盘 relabel（最常用）
$ sudo fixfiles onboot                        # 登记开机 relabel（替代方案）
$ grep context= /etc/fstab                    # 按需给单个挂载打标签（省去全盘）
UUID=... /srv  ext4  defaults,context="system_u:object_r:var_t:s0"  0 2
```

`context=` 挂载选项适合"整个分区就是数据盘"的场景，写进去就免了每次 `restorecon`。账本语义收拢成本页最重要的一条纪律：**fcontext 规则是"路径正则 → 类型"的持久账本，`restorecon` 按账本执行，`chcon` 只改当下**——所以任何标签修正的正确形态都是先 `semanage fcontext -a` 再 `restorecon`（第 3.2 节的两步组合是它的模板），顺序颠倒则第二步无事可做。容器场景的对应物是卷挂载的 `:z`（共享重标）与 `:Z`（私有重标）：`podman run -v /srv/www:/var/www/html:Z ...` 让引擎自动做 `restorecon` 等价动作——忘了它，宿主机上的卷在容器里会以 AVC 拒绝的形式现身，症状与 3.1 完全相同。

## 8. 常见坑

**`setenforce 0` 之后忘了改回。** 临时绕过变永久裸奔，且下次故障会与本次混在一起。纪律：切换必须伴随变更单条目（"原因/回收时间/责任人"），排障完成后 `getenforce` 回读确认；更稳的做法是诊断窗口直接用 permissive 模式配置（`/etc/selinux/config`）而不是运行时 `setenforce`——重启即回归的特性反过来保护你。

**`chcon` 改了标签，重启后又 403。** relabel 把临时标签按账本重打，涂改自然被覆盖。`ls -Z` 若看到标签"自己变回去了"，先查 `semanage fcontext -l | grep 该路径`——账本里没有你要的条目，补上再 `restorecon`，这是 3.2 的两步组合，一步都不能省。

**`audit2allow` 生成的模块过宽。** `.te` 没看就装、且把历史 AVC 一起喂进去（不加 `-d` 精选单条 denial），放行常是 `*` 级别的并集。改法：只取当下那条 denial（`ausearch -m avc -ts recent` 的单条），生成后逐行读 `.te`，`require` 块里出现的每个类型都是你要连带放开的口子——出现意料之外的类型就停下来。

**permissive 下日志爆量。** permissive 是"拦下的都记账"，繁忙服务的 AVC 会以每秒数百条涌进 audit 日志，既可能撑爆 `/var/log/audit` 也淹没真正的证据。诊断窗口要短，配合 `ausearch -ts` 缩小时间窗取样，看完立即切回；长期学习用 permissive 前先确认 audit 轮转在跑（[日志系统](../system-management/logging.md)）。

**容器挂卷进来读不到。** 宿主机目录进了容器后服务报权限错，本地同路径测试正常——与 Samba 案例的"本地通、协议拒"同构。解法在 7.2：挂载时给 `:Z`/`:z`；已有卷可以宿主机侧 `restorecon -R`。K8s/OpenShift 场景对应的是 SCC 与 volume 走各自的 relabel 流，不展开。

**SELinux 拒绝了但日志里没有 AVC。** 三个可能按序排查：`ausearch` 时间窗太窄（换 `-ts boot`）；`auditd` 没在跑（`systemctl status auditd`——permissive/`semanage` 操作本身不依赖它，但取证依赖）；rate limit 吃掉了（`dmesg | grep -i audit` 看内核侧溢出告警，`/proc/sys/kernel/printk_ratelimit` 或 audit backlog 参数）。确诊前不要动策略——证据缺失时改策略，改的一定是猜的。

## 参考资料

- SELinux Project Notebook — [github.com/SELinuxProject/selinux-notebook](https://github.com/SELinuxProject/selinux-notebook)
- Red Hat 官方文档（含 SELinux 指南与各服务适用手册）— [docs.redhat.com](https://docs.redhat.com/)
- `semanage-fcontext` 手册 — man 8 semanage-fcontext
- `audit2allow` 手册 — man 1 audit2allow
- 服务域帮助页家族（`httpd_selinux`、`smbd_selinux` 等，RHEL 系安装策略后可用）— `man 8 httpd_selinux`
- Arch Wiki: SELinux — [wiki.archlinux.org/title/SELinux](https://wiki.archlinux.org/title/SELinux)
- 鸟哥的私房菜 — [linux.vbird.org](https://linux.vbird.org/)
