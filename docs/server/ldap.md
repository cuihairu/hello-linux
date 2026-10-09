# LDAP 统一账号管理

十台 Linux 服务器，十份独立的 `/etc/passwd`，这是多数团队从第二台服务器起就欠下的债。日常账单大致三笔：改一次密码要在十台机器上各跑一遍 `passwd`，漏掉的那台下个季度还在用旧口令；员工离职删账号，靠表格逐台 `userdel`，漏删的就是一条长期潜伏的入口；sudo 白名单写在十份 sudoers 里，对齐靠人眼，谁先改谁就成了事实标准。痛点的共同根源是"账号真相"有十份副本。NIS（网络信息服务）是最早的回答——把 passwd/group 做成共享映射，客户端来查，但它明文传输、扁平命名空间、无逐条访问控制，密码哈希在内网上裸奔。生态已经给出判决：RHEL 8.3 起将 NIS 标记为弃用，RHEL 9 整体移除，Fedora 也在退役 ypbind 一族工具。接位的是 LDAP：一台目录服务器持有唯一的账号真相，十台客户端通过 SSSD 查询与认证，改一处、全网生效。本页按"目录模型 → 服务端 OpenLDAP → 建目录树 → TLS → 客户端 SSSD → 授权与访问控制"展开，三系（Debian/Ubuntu、RHEL/Rocky、Arch）对照给出，常见故障收拢在倒数第二节。

> 内容参考自 OpenLDAP 官方文档与 Ubuntu/RHEL/Arch 各自的目录服务文档，见文末参考资料。

## 学习目标

- 用树状命名空间（dc/ou/cn/uid）描述组织结构，读懂并书写 LDIF
- 说清 schema、objectClass 与"目录能存什么属性"的约束关系
- 完成 OpenLDAP 服务端安装、suffix 与管理员设定、目录树搭建与查询验证
- 用 TLS 证书保护 bind 过程，在 ldaps 与 StartTLS 之间做出有依据的取舍
- 三系配置 SSSD 客户端接入，用 `getent` 验证 NSS 生效并解决家目录创建
- 读懂 olcAccess 语义，配出"用户自改密码、管理员全权、他人只读"的基线

## 1. 目录服务模型：LDAP 到底是什么

### 1.1 一棵树：DN 与命名前缀

LDAP 把账号组织成一棵倒挂的树，每个条目（entry）在树上的位置就是它的 DN（Distinguished Name，可分辨名称），从叶子往根写、逗号拼接：`uid=alice,ou=people,dc=example,dc=com`。四个前缀覆盖九成场景——dc（Domain Component）承接 DNS 域名，example.com 拆成 `dc=example,dc=com` 作为树根；ou（Organizational Unit）是组织单元，人、组、服务账号在各自的分岔下；cn（Common Name）是通用的"名字"，组与管理员条目常用它；uid 专指登录名。DN 在全树唯一，这就是目录里账号的主键。

### 1.2 LDIF 与 schema：能存什么由谁说了算

LDIF（LDAP Data Interchange Format）是目录数据的文本表示，增删改查都在它之上进行。一个条目一段 LDIF：首行 `dn`，随后若干 `objectClass` 与属性值对。objectClass 是关键约束——它声明条目"是什么类型的东西"，并规定必填与可选属性：posixAccount（来自 nis schema）要求 `uid`、`uidNumber`、`gidNumber`、`homeDirectory` 缺一不可，少一个 `ldapadd` 就报 objectClass violation。装了哪些 schema，目录就能存哪些东西——默认的 core/cosine/nis/inetorgperson 覆盖 Unix 账号场景，要存 sudo 规则、邮件别名这类专门数据，就加载对应 schema。这与关系库"建表定字段"同构，只是表结构以 schema 文件形式随包分发。

### 1.3 只管目录，认证走 simple bind

一句容易误解的话先摆正：LDAP 是目录访问协议，本身不是一套认证体系。客户端验证密码的方式朴素直接——simple bind：报上 DN 与密码，服务端核对该条目的 `userPassword` 属性（以 `{SSHA}` 这类带盐哈希存储），对上即放行本次会话。生产上更讲究的分工一句话讲清：Kerberos 管认证（发票据，密码不过网），LDAP 管目录数据（身份属性、组成员），FreeIPA 与 Active Directory 就是把两者打包的产品。本页主线用 simple bind 起步，第 4 节解决它明文传输的问题；规模到了再上 Kerberos，两条路共用同一棵目录树。

## 2. 服务端：OpenLDAP 与 cn=config

### 2.1 三系安装对照

| 操作 | Debian/Ubuntu | RHEL/Rocky | Arch |
|------|---------------|-----------|------|
| 安装 | `apt install slapd ldap-utils` | `dnf install openldap-servers openldap-clients` | `pacman -S openldap` |
| 服务单元 | slapd.service | slapd.service | slapd.service |
| 配置目录 | `/etc/ldap/slapd.d/` | `/etc/openldap/slapd.d/` | `/etc/openldap/slapd.d/` |
| 数据目录 | `/var/lib/ldap` | `/var/lib/ldap` | `/var/lib/openldap/data` |

三系的服务单元难得一致都叫 `slapd`，差异集中在配置路径与包的拆分。RHEL 系有一处必须先交底：Red Hat 从 RHEL 8 起把 `openldap-servers` 移出了自家仓库，官方推荐的替代是 Red Hat Directory Server 或 IdM；Rocky 把这个包放回了 plus 仓库（`dnf --enablerepo=plus install openldap-servers`），RHEL 本体则需借助 EPEL，包版本偶有滞后，装前核实。Arch 的 openldap 包服务端与客户端同包，`/etc/openldap/` 下是配置与数据，启用 slapd.service 前需先设定 suffix 与 rootdn（Arch Wiki 给了基于 slapd.ldif 重建 cn=config 的步骤）。

### 2.2 Debian 系的 debconf 交互与重配

Debian/Ubuntu 上 `apt install slapd` 过程中 debconf 会问四件事：DNS 域名（决定 suffix）、组织名、管理员密码、数据库后端。装完即得一棵可用的小树：suffix 是你填的域名，rootdn 是 `cn=admin,<suffix>`。填错或想改不必卸载重装：

```bash
$ sudo dpkg-reconfigure slapd
# 按提示重设域名、组织名与管理员密码，数据库按新 suffix 重建；有数据先 slapcat 备份
```

这条路径的好处是 suffix 从安装时就是对的，第 3 节直接建目录。RHEL/Arch 装完的默认 suffix 还是占位的 `dc=my-domain,dc=com`（或为空），需要先按 3.1 节改配置。

### 2.3 cn=config：配置本身也是一棵目录

老教材里的 slapd.conf 单文件模型已退役（OpenLDAP 2.4 起默认 cn=config）：配置本身也是一棵 LDIF 树，落在 `/etc/ldap/slapd.d/`（Debian）或 `/etc/openldap/slapd.d/`（RHEL/Arch），用 ldapmodify 在线修改、即时生效，不用重启。改配置的动作从"编辑文件加重启"变成"向配置目录发 LDIF"，与后文改业务数据是同一套语法。本地 root 经 Unix 套接字以 SASL EXTERNAL 身份连入，即可读写整棵配置树：

```bash
$ sudo ldapsearch -Y EXTERNAL -H ldapi:/// -b cn=config '(olcDatabase={1}mdb)'
# -Y EXTERNAL 用套接字对端身份（本地 root）；ldapi:/// 是本地 Unix 套接字
# 输出中的 olcSuffix、olcRootDN 就是当前数据库的域与管理员
```

数据库名随版本可能是 `{1}mdb` 或老系统的 `{1}hdb`，先 `-b cn=config olcDatabase` 列一遍再操作。配置目录里的文件不宜手改——它们是 slapd 的输出物，经 ldapmodify 写入才能保持格式自洽。

## 3. 建目录树：suffix、rootdn 与首批条目

### 3.1 设定 suffix 与管理员

Debian 系安装时已完成这一步，可直接跳到 3.2。RHEL/Arch 需要改三条属性：olcSuffix（树根）、olcRootDN（超级管理员）、olcRootPW（密码哈希，由 slappasswd 生成）：

```bash
$ slappasswd        # 交互输两遍，输出 {SSHA}... 哈希贴进下面的 LDIF
$ cat > suffix.ldif <<'EOF'
dn: olcDatabase={1}mdb,cn=config
changetype: modify
replace: olcSuffix
olcSuffix: dc=example,dc=com
-
replace: olcRootDN
olcRootDN: cn=admin,dc=example,dc=com
-
replace: olcRootPW
olcRootPW: {SSHA}4XRhAeGlmS2GXjTQG7H8bKXq0cJFjUoP
EOF
$ sudo ldapmodify -Y EXTERNAL -H ldapi:/// -f suffix.ldif
```

LDIF 里用 `-` 分隔同一条目的多组修改，三个属性一次 replace 完成。olcRootDN 是这棵树的超级用户，密码哈希存进 cn=config——它独立于目录内任何条目，目录被清空也能凭它重建。

### 3.2 组织架构与用户：LDIF 实操

组织架构先建三个 ou：people 放人，groups 放组，services 放服务账号（只认密码、不登录 shell 的那些）。目录树从根往下建，LDIF 按顺序排：

```text
# base.ldif —— 树根与组织单元
dn: dc=example,dc=com
objectClass: dcObject
objectClass: organization
o: Example Inc
dc: example

dn: ou=people,dc=example,dc=com
objectClass: organizationalUnit
ou: people

dn: ou=groups,dc=example,dc=com
objectClass: organizationalUnit
ou: groups

dn: ou=services,dc=example,dc=com
objectClass: organizationalUnit
ou: services
```

写入用 `ldapadd`：`-x` 是 simple bind，`-D` 指定管理员 DN，`-W` 交互问密码。Debian 系安装时已建好根条目，从 `ou=people` 起追加即可，根条目重复添加会报 Already exists (68)：

```bash
$ ldapadd -x -D "cn=admin,dc=example,dc=com" -W -f base.ldif
# 每个条目回显一行 adding new entry "..."；有报错会指名道姓是哪一条
```

人与组成对添加，uidNumber/gidNumber 要全网唯一且不与各机器本地账号冲突——常见规划是本地账号止步于 9999，目录账号从 10000 起步：

```text
# alice.ldif —— 一个人与她的主组
dn: cn=dev,ou=groups,dc=example,dc=com
objectClass: posixGroup
cn: dev
gidNumber: 20001

dn: uid=alice,ou=people,dc=example,dc=com
objectClass: inetOrgPerson
objectClass: posixAccount
objectClass: shadowAccount
uid: alice
cn: Alice Chen
sn: Chen
uidNumber: 10001
gidNumber: 20001
homeDirectory: /home/alice
loginShell: /bin/bash
userPassword: {SSHA}q9kVz0eRbM3nWtYpLc2A8sDfGhJ5uXwQ   # slappasswd 生成
```

posixAccount 撑起 Unix 账号语义（必填四项见 1.2 节），inetOrgPerson 补人的自然属性，shadowAccount 给密码过期策略留了落点。改密码不必手写哈希：服务端用 `ldappasswd`，SSSD 接入后客户端的 `passwd` 命令也能直接改到目录里的密码（第 7 节的访问规则保证本人可写）。

### 3.3 查询验证

```bash
$ ldapsearch -x -b dc=example,dc=com '(uid=alice)'
# -x 匿名 simple bind（能否匿名读由第 7 节 olcAccess 决定）；-b 是搜索起点，命中即回显全部属性
```

`ldapsearch` 的参数组合是排障常用语：`-H` 换协议与地址（`ldaps://ldap.example.com` 或 `ldap://` 加 `-ZZ` 强制 StartTLS），`-D` 加 `-W` 换成管理员身份可读全部属性。能查到条目且属性齐全，服务端侧就闭环了。

## 4. TLS：明文 bind 不能上生产

simple bind 的密码是明文进网的——内网抓包即可截获，这与"内网就安全"的侥幸无关，是协议层事实。上 TLS 不是加分项，而是前置条件。

### 4.1 服务端证书三件套

```bash
$ cat > tls.ldif <<'EOF'
dn: cn=config
changetype: modify
add: olcTLSCertificateFile
olcTLSCertificateFile: /etc/ldap/tls/ldap.example.com.crt
-
add: olcTLSCertificateKeyFile
olcTLSCertificateKeyFile: /etc/ldap/tls/ldap.example.com.key
-
add: olcTLSCACertificateFile
olcTLSCACertificateFile: /etc/ldap/tls/ca.crt
EOF
$ sudo ldapmodify -Y EXTERNAL -H ldapi:/// -f tls.ldif
$ sudo chown openldap:openldap /etc/ldap/tls/*.key && sudo chmod 600 /etc/ldap/tls/*.key
```

三件套各管一头：证书文件对外亮明身份，私钥文件供握手签名，CA 证书用于校验客户端证书（做双向认证时必需，单向 TLS 也建议配上）。证书的 CN/SAN 必须与客户端连接用的主机名一致——签给 `ldap.example.com` 的证书，客户端用 IP 连就过不了主机名校验，这是排错节的老熟客。配完还要让 slapd 监听 636：Debian 系改 `/etc/default/slapd` 的 `SLAPD_SERVICES="ldap:/// ldaps:///"`，RHEL 系改 `/etc/sysconfig/slapd` 的 `SLAPD_URLS`，Arch 用 systemd 单元覆盖（路径随版本核实），改完 restart。

### 4.2 客户端 CA 信任与两种加密路径

客户端侧把 CA 证书纳入信任：系统级（放各系 CA 目录后跑 `update-ca-certificates` 或 `update-ca-trust`），或写进 OpenLDAP 客户端配置 `/etc/ldap/ldap.conf` 的 `TLS_CACERT`；SSSD 则在 sssd.conf 里用 `ldap_tls_cacert` 指定。加密路径两条：ldaps:///（636 端口）从握手起整条连接就是 TLS，端口固定、防火墙好收敛，忘开加密的明文会话从拓扑上不存在；StartTLS（389 端口）先明文连接再协商升级，复用一条通道，但协商窗口留有降级面。两者加密强度等价，差别在"从第几字节起是密文"——新部署建议 ldaps 单通道、防火墙只放 636；要维持既有 389 生态时用 StartTLS 并在服务端设为强制（olcSecurity 含 `tls=1`）。验证动作一致：`ldapwhoami -x -H ldaps://ldap.example.com -D "uid=alice,ou=people,dc=example,dc=com" -W` 返回 DN 且无告警，链路加密即闭环。

## 5. 客户端接入：SSSD 主线

服务端有了树，十台客户端接进来才完成"一致性"。现代主线是 SSSD（System Security Services Daemon）：一个本地守护进程上游对接 LDAP（或 AD/IPA），下游通过 NSS 与 PAM 两个标准接口供给系统——getent、login、sudo 全都不必知道账号在目录里。老路 nslcd/pam_ldap 在老文档里仍常见，属无缓存直连方案，缓存、离线登录、多域对接都是短板，新部署不建议再选。

### 5.1 三系安装与配置对照

| 操作 | Debian/Ubuntu | RHEL/Rocky | Arch |
|------|---------------|-----------|------|
| 安装 | `apt install sssd sssd-ldap` | `dnf install sssd sssd-ldap` | `pacman -S sssd` |
| NSS/PAM 接线 | 包脚本经 pam-auth-update 自动完成 | `authselect select sssd with-mkhomedir` | 手改 nsswitch.conf 与 system-auth |
| 家目录自动创建 | `apt install libpam-mkhomedir` 后 pam-auth-update 启用 | with-mkhomedir 已含，`systemctl enable --now oddjobd` | system-auth 的 session 段加 pam_mkhomedir.so |

配置文件三系同路同名：`/etc/sssd/sssd.conf`，语法一致，最小可用形态如下：

```text
# /etc/sssd/sssd.conf —— 权限必须 600，权限宽了 sssd 拒绝启动且报错不直说
[sssd]
services = nss, pam
domains = example.com

[domain/example.com]
id_provider = ldap
auth_provider = ldap
ldap_uri = ldaps://ldap.example.com
ldap_search_base = dc=example,dc=com
ldap_tls_cacert = /etc/ldap/tls/ca.crt
cache_credentials = True
# 保存后：chmod 600 此文件，再 systemctl enable --now sssd
```

`cache_credentials = True` 打开后，目录服务器短时不可达时已登录用户仍可本地认证（离线缓存），这是 SSSD 相对老方案的核心增益之一。RHEL 系的 `authselect select sssd` 会接管 NSS 与 PAM 的公共栈——改栈前先 `authselect current` 记下现状，与 PAM 页的"改前留后路"是同一条纪律。

### 5.2 nsswitch、PAM 与家目录

SSSD 供给账号的两条管线要在系统层接通。NSS 管查询，`/etc/nsswitch.conf` 的三行在 files 之后追加 sss：

```text
passwd: files sss
group:  files sss    # 顺序语义：先查本地文件，再问 sss
shadow: files sss
```

顺序写反（sss 提到 files 前）会让本地 root 都解析不出来——目录一抖，本机 sudo、cron、systemd 全部连锁遭殃。Debian 系装包时 libnss-sss/libpam-sss 的包脚本会自动改好这两处，检查即可；Arch 与手改场景需要自己编辑。PAM 管认证：pam_sss.so 挂进 auth 栈，登录时密码由 SSSD 转交目录核验——PAM 栈本身怎么读怎么改，见[安全篇 PAM 与 sudo](../security/pam-sudo.md)，本页不重复。家目录是最后一环：目录里的账号在本机没有 home，首登即摔（shell 退回根目录）。补法两派：Debian 系用 pam_mkhomedir 模块在登录时现建，RHEL 系用 oddjob-mkhomedir 服务代劳（with-mkhomedir 特性一并启用），Arch 手工往 system-auth 的 session 段加一行 pam_mkhomedir.so。

### 5.3 验证

```bash
$ getent passwd alice
alice:*:10001:20001:Alice Chen:/home/alice:/bin/bash
# NSS 生效的铁证：本地 /etc/passwd 没有她，这条记录来自目录；id alice 应同源
$ ssh alice@localhost    # 用目录密码登录，家目录自动创建
```

`getent` 是验收的关键动作：它走的就是 NSS 管线，与登录程序同源——getent 查得到而 ssh 登不进，问题在 PAM 侧；查不到，问题在 NSS/SSSD 侧。十台机器重复 5.1–5.3，这份配置适合交给自动化工具分发（见[自动化运维](../system-management/automation.md)）。

## 6. 授权与最小权限

账号进了目录，接着收敛"谁能干什么"。登录准入按组过滤：SSSD 的 ldap_access_filter 让"目录里有账号"与"允许登录这台机器"解耦——运维组十个人目录里都有账号，但数据库机只放行 dba 组：

```text
# /etc/sssd/sssd.conf 的 [domain/example.com] 段追加
access_provider = ldap
ldap_access_filter = memberOf=cn=dba,ou=groups,dc=example,dc=com
```

改动前先在目录侧对账：`ldapsearch -x -H ldaps://ldap.example.com -b ou=groups,dc=example,dc=com '(cn=dba)' memberUid` 列出组内登录名，与预期名单核对。两个注意点：OpenLDAP 默认不产出 memberOf 属性，需启用 memberof overlay（载入方式随版本核实）；过滤器配错时 SSSD 是默认拒绝而非放行——方向安全，但会把自己也锁在外面，改完留一个已登录会话再验证。sudo 规则入库一句带过：sudo 自带一套 LDAP schema，把 sudoers 规则作为条目写进目录即可十机共享一份（Debian 系为此拆出 sudo-ldap 包）；多数团队先用更轻的组合——组成员资格放目录、本地 sudoers 只写一行 `%ops ALL=(ALL:ALL) ALL`，到这一步已够用。末了是缓存失效：SSSD 在本地缓存目录数据，目录侧改了属性（加组、改名），客户端要等缓存过期或 `sudo sss_cache -E` 手动清空（用户、组、凭证一起失效）。排障口诀：目录改了、客户端没反应，先 `sss_cache -E` 再怀疑配置——顺序反了会白查半天。

## 7. 访问控制：olcAccess

前面几节默认"匿名可读、管理员全权"，真实目录要把读写面收窄。olcAccess 是一组有序规则：每条先声明管哪些条目与属性（`to ...`），再列谁可以做什么（`by ...`），自上而下首条命中即生效，by 子句同理，全部落空则默认拒绝。一条覆盖本页场景的基线：

```bash
$ cat > acl.ldif <<'EOF'
dn: olcDatabase={1}mdb,cn=config
changetype: modify
replace: olcAccess
olcAccess: {0}to attrs=userPassword
  by self write
  by anonymous auth
  by dn.exact="cn=admin,dc=example,dc=com" write
  by * none
olcAccess: {1}to *
  by dn.exact="cn=admin,dc=example,dc=com" write
  by * read
EOF
$ sudo ldapmodify -Y EXTERNAL -H ldapi:/// -f acl.ldif
```

逐条读：{0} 把密码属性收得最紧——本人可改（self write），匿名连接只许用它做认证比对（anonymous auth，是"验密码"而非"读哈希"），管理员可改，其余一律不可见；{1} 兜底为全员可读——uid、uidNumber、属组本来就是登录链路要查的公开数据，读不可耻，哈希不可见才是底线。序号 `{0}{1}` 是排序声明，replace 时整组重写。验证别靠想象：用 alice 的身份读别人的 userPassword 应得空结果，匿名查询允许但拿不到密码属性，即符合预期。

## 常见故障

**Invalid credentials (49)。** `ldapadd`/`ldapwhoami` 报 `ldap_bind: Invalid credentials (49)`：bind DN 或密码错。两种高频乌龙——DN 拼错一个 RDN（`cn=admin` 写成 `uid=admin`，目录里根本没有这个条目），或拿系统口令当 olcRootPW 设的密码。先验 DN 再验密码：`ldapsearch -x -b dc=example,dc=com '(cn=admin)'`，查无此人就先修 DN。

**TLS 主机名不匹配。** 客户端报 `Can't contact LDAP server (-1)`，服务端日志里有 `TLS: hostname does not match CN in peer certificate`：证书签给 ldap.example.com，客户端 URI 却写着 IP 或别名。根治是证书 SAN 覆盖所有接入名，或统一用 DNS 名连接；临时排查可加 `LDAPTLS_REQCERT=never` 确认病灶，生产禁用。

**nsswitch 顺序写反，本地 root 都解不出来。** `passwd: sss files` 一旦写反，名字解析先问目录；目录或 sssd 一抖，`id root` 落空，sudo、登录、cron 连锁罢工。修复要有物理通道：控制台或尚存的 root 会话把顺序改回 `files sss`。规范一句话：sss 永远在 files 之后。

**objectClass violation (65)。** `ldapadd` 报 `Object class violation` 并附缺失属性名：条目声明了某个 objectClass，却没给齐必填属性（posixAccount 的 homeDirectory 是常客）；另一种是 schema 没载——最小化安装里 nis schema 缺席时连 posixAccount 都不认识。先补属性；schema 缺失则加载对应文件，Debian 系在 `/etc/ldap/schema/` 附了转换好的 `.ldif`（如 misc.ldif），`ldapadd -Y EXTERNAL -H ldapi:/// -f` 即可载入。

**SSSD 缓存脏数据。** 目录侧删了账号或改了 uid，客户端 `getent` 仍吐旧值。先 `sudo sss_cache -E`；顽固时停 sssd、清 `/var/lib/sss/db/` 再启动——后者会连离线凭证一起清掉，用户需重新登录，两档手段按顺序用。

**防火墙挡 389/636。** 客户端报 `Can't contact LDAP server (-1)`，服务端 slapd 明明 active。先在客户端 `nc -zv ldap.example.com 636`（或 389）探路，不通再查服务端防火墙与云安全组；RHEL 系 `firewall-cmd --add-service=ldaps` 一次放行 636，完整策略见[防火墙篇](../security/firewall.md)。

## 与其它页的分工

单机的用户、组与密码文件在基础篇[账号管理](../basic/users/account_management.md)讲透，本页回答的是"十台机器如何共享同一份真相"；登录后的授权细节（PAM 栈、sudoers）在安全篇[PAM 与 sudo](../security/pam-sudo.md)展开，本页只在 SSSD 接线处碰到 PAM。同属多机一致性的兄弟场景各有落点：Samba 的共享盘账本独立成册（[Samba 文件共享](./samba.md)），NFS 两端 UID 对齐以目录账号为根治方案（[NFS 服务器](./nfs.md)）；账号一致性解决"人"的统一，软件环境的一致性则交给[容器](../server/container/docker.md)。

## 参考资料

- OpenLDAP 官方管理指南 — [openldap.org/doc/admin24](https://www.openldap.org/doc/admin24/)
- Ubuntu 服务器文档 — [ubuntu.com/server/docs](https://ubuntu.com/server/docs)
- Arch Wiki: OpenLDAP — [wiki.archlinux.org/title/OpenLDAP](https://wiki.archlinux.org/title/OpenLDAP)
- Red Hat 文档（SSSD 与目录服务） — [docs.redhat.com](https://docs.redhat.com/)
- man 手册 — man slapd-config、man sssd.conf、man sssd-ldap、man ldapsearch
