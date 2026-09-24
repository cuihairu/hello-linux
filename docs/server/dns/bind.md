# DNS 服务器（BIND）

DNS 是互联网的电话簿：人记域名，机器要 IP，中间这层翻译必须又快又稳。BIND（Berkeley Internet Name Domain）是历史最悠久、部署最广的权威 DNS 实现——从根服务器到企业内网解析器，背后跑的多半是它或它的直系后裔。要回答"为什么需要一台自己的 DNS"，先看三个真实场景：内网机器想用 `db.example.com` 这样的短名互访，不想为每台主机手工改 `/etc/hosts`；公司对外发布网站与邮件路由，MX/SPF 记录必须由可控的权威服务器回答；或者上游公共 DNS 被劫持、解析结果被投毒，你需要一个只信自己配置的递归出口。BIND 把"权威应答"和"递归查询"两种角色装进同一套配置体系，但两者的安全含义完全不同——把一台对公网开放递归的权威机配错，就可能变成被利用的放大攻击源。本页按"为什么 → 角色与架构 → 三系安装 → 正反向区域 → 主从复制 → dig 排错 → 常见坑"展开，安装部分给出 Debian/Ubuntu（apt）、Arch（pacman）、RHEL/CentOS/Rocky（dnf）三系对照，三系的差异集中在包名与 unit 名，配置语法本身完全一致；主机防火墙如何放行 53 端口不在本页展开，见[防火墙篇](../../security/firewall.md)。

> 内容参考自 BIND 官方文档与 Arch Wiki，见文末参考资料。

## 学习目标

- 分清 authoritative 与 recursive 两种角色，知道 zone 文件为何存在
- 掌握三发行版安装（apt / pacman / dnf），读懂 named-checkconf 验证输出
- 独立配置正向/反向区域，理解 SOA 序列号与传输（AXFR）的联动
- 会用 dig 追踪解析链路，定位 TTL、应答源与 NXDOMAIN 类故障
- 排查服务起不来、区域不生效、主从不同步等高频坑

## 1. DNS 为什么这样设计

### 1.1 权威与递归：一台服务器的两张面孔

DNS 查询从客户端视角只有两种形态。**递归查询**（recursive）是"你替我问到底"：浏览器问本地解析器 `www.example.com`，解析器替它走完根 → 顶级域 → 权威服务器的整条链，把最终 IP 带回来。**迭代查询**（iterative）是"你告诉我下一步问谁"：根服务器不直接给结果，只说"去问 .com 的权威"，解析器拿着 referral 继续问。多数终端设备只发递归查询；而根、顶级域以及企业自己的权威服务器，回答的主要是迭代 referral 与权威应答。

| 角色 | 谁在用 | BIND 中的含义 | 安全边界 |
|------|--------|----------------|----------|
| Recursive resolver | 内网终端、递归出口 | 允许 `recursion yes`，缓存上游结果 | 必须限制查询来源，否则成为开放递归放大器 |
| Authoritative server | 上游解析器、从服务器 | 对已配置的 zone 给出权威答案 | 只需对内/对上开放，一般无需对外递归 |

这个划分解释了最常见的配置事故：有人照抄教程在公网 IP 上同时开权威与全开放递归，服务器很快被扫描器盯上，带宽被 DNS 放大攻击打满。正确的姿势是——递归入口加 `allow-recursion`/`allow-query-cache` 网段白名单，权威角色只对 `allow-query` 允许的客户端应答，两者用视图（view）或干脆两台机器分开。类比包管理：`pacman -Sy` 对谁开放仓库索引是信任问题，`named` 对谁开放递归同样是信任问题，把"谁能来取"写清楚是同一套纪律；给仓库地址加签名、给查询入口加 ACL，本质上都是"先确认对端可信，再放数据出门"。

### 1.2 记录类型与 zone 文件为何存在

一条 DNS 记录回答一个具体问题：A/AAAA 把名字映射到 IPv4/IPv6，CNAME 给别名，MX 指定邮件落地，NS 声明谁有权威，PTR 做反向映射，TXT 承载 SPF/DKIM/DMARC 这类元数据。**zone 文件**就是某个域名（或网段反向域）的权威账本：SOA 记录声明序列号与刷新节奏，NS 记录列出名字服务器，其余记录逐条落盘。它存在的理由很朴素——DNS 的真相需要可版本化、可 diff、可离线审阅：改一条 A 记录 = 改一行文本 + 递增序列号，从服务器靠序列号判断是否要重新传输（AXFR/IXFR）。这与系统包的 `/var/lib/pacman/local` 数据库殊途同归：一边用文本 zone 表达"名字→地址"的期望状态，一边用数据库表达"包→文件"的安装状态，都追求单一真相源，改动留痕、校验可复现。

```text
客户端 ──递归──▶ 本地解析器 ──迭代──▶ 根 / TLD / 权威
                  ├── 命中缓存 → 直接应答（看 TTL）
                  └── 未命中 → 走完整条 referral 链
```

TTL（存活时间）是缓存协议的呼吸节奏：TTL 太长，改记录后传播慢，回滚也慢；TTL 太短，解析器反复回源，权威服务器压力大。上线前把关键记录 TTL 调低（如 60 秒），切换完成后再调回常态，是换 IP/迁移机房的标准手法——这一步经常被省略，结果就是"我明明改了记录，用户那边还是旧 IP"。理解这张分层图之后再动手配置，会发现自己要做的决定其实只有三件：这台机器是权威还是递归（或两者如何隔离）、谁允许来查、区域账本怎么版本化；其余语法细节查手册即可，取舍框架才是本页真正要留下的东西。

动手前再补两条跨发行版不会变的纪律：其一，**先 check 再 reload**——`named-checkzone` 与 `named-checkconf` 双绿之前不要碰生产进程，语法错误被拦在维护窗口外，比服务半死不活时深夜回滚便宜得多；其二，**serial 只增不改内容**——从服务器只比较大小，不比较哈希，同一 serial 下偷改 zone 是主从分叉的经典来源。这两条与包管理"先看依赖再升级、升级失败保留旧包"是同一种保守变更观：DNS 与软件包都是多机共享的状态，单点上的"改完了"不等于集群里的"都对了"。

## 2. 安装（三发行版对照）

| 操作 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 安装 | `apt install bind9 bind9utils` | `sudo pacman -S bind` | `dnf install bind bind-utils` |
| 搜索 | `apt search bind9` | `pacman -Ss bind` | `dnf search bind` |
| 查看包信息 | `apt show bind9` | `pacman -Qi bind` | `dnf info bind` |
| 查看文件列表 | `dpkg -L bind9` | `pacman -Ql bind` | `rpm -ql bind` |
| 升级 | `apt upgrade` | `sudo pacman -Syu` | `dnf upgrade` |
| 卸载 | `apt remove bind9` | `sudo pacman -R bind` | `dnf remove bind` |
| 解析工具 | `apt install dnsutils` | `pacman -S bind`（自带 dig） | `dnf install bind-utils` |

三系有一个容易踩的命名差异：Debian/Ubuntu 的服务单元叫 `bind9`，Arch 与 RHEL 系都叫 `named`——包名、unit 名、配置路径是三个独立维度，排错时先 `systemctl status` 对准 unit，再谈配置文件。Arch 用户日常仍从 `pacman -S bind` 起步，一条命令装齐守护进程与 dig/nslookup；Debian 若要 `dig` 还需另装 `dnsutils`，RHEL 则对应 `bind-utils`。升级路径也各归各：Arch 滚动更新走 `pacman -Syu`，Debian/RHEL 走 `apt upgrade`/`dnf upgrade`，改完配置都应先 `named-checkconf` 再重启——先验证、再生效，是改任何关键网络服务的通用顺序。

### 2.1 Debian/Ubuntu

```bash
$ sudo apt install bind9 bind9utils dnsutils
$ sudo systemctl enable --now bind9 && systemctl is-active bind9
active
```

Debian 把配置拆在 `/etc/bind/` 下多个片段文件里：`named.conf.options` 放全局选项，`named.conf.local` 放本地区域——与 apt 把源拆进 `sources.list.d/` 是同一哲学，升级包时本地改动不易被覆盖。`dnsutils` 只是客户端工具包（dig、nslookup、host），不装它服务照样能跑，但排障时会发现最常见的诊断命令全部缺失——装服务器的同时把客户端装齐，是 Debian 系与 Arch/RHEL 一个不起眼但很实用的差别（后两者 dig 随主包带来）。

### 2.2 Arch

```bash
$ sudo pacman -S bind
$ sudo systemctl enable --now named && dig -v | head -1
DiG 9.18.x
```

Arch 的 BIND 走官方 extra 仓库，`pacman -S bind` 一步到位，配置集中在单文件 `/etc/named.conf`（上游默认布局），区域文件惯例放 `/etc/named/` 或 `/var/lib/named/`，以文件内 `directory` 指令为准。安装后 `pacman -Ql bind | head` 可快速看清包铺了哪些 unit 与默认配置——和 Debian 用 `dpkg -L bind9`、RHEL 用 `rpm -ql bind` 查文件清单是同一动作，换的只是包管理器前面那半个词。滚动升级时保持 `pacman -Syu` 整体更新，BIND 与 dig 同包同仓库，不必担心客户端工具与守护进程版本错位。包管理器的依赖解析与安装进度行对排障没有信息量，验收固定看 `systemctl status` 与 `dig -v` 两行。

### 2.3 RHEL/CentOS/Rocky

```bash
$ sudo dnf install bind bind-utils
$ sudo systemctl enable --now named && systemctl is-active named
active
$ dig example.com @127.0.0.1 +short
192.168.1.100
```

RHEL 系主配置在 `/etc/named.conf`，区域默认落 `/var/named/`，权限由包默认的 `named` 用户与 SELinux 上下文共同约束——`restorecon -Rv /var/named` 是改完文件后常被忘掉的一步，权限或标签不对时 named 会以 `permission denied` 拒载区域，日志里只留下一句含糊的 `loading configuration: file not found` 类错误。RHEL 侧升级同样是一句 `dnf upgrade bind`，与 Debian 的 `apt upgrade bind9`、Arch 的 `pacman -Syu` 对齐节奏；三系共同点是"升级后必 reload 或重启、重启前必 checkconf"，包管理器换了，纪律不换。

## 3. 全局配置要点

### 3.1 主配置骨架

```text
// /etc/bind/named.conf.options（Debian 片段风格）
options {
    directory "/var/cache/bind";
    allow-query { localhost; 192.168.1.0/24; };
    allow-recursion { localhost; 192.168.1.0/24; };
    forwarders { 8.8.8.8; 1.1.1.1; };
    dnssec-validation auto;
    version "not available";
    listen-on { 127.0.0.1; 192.168.1.100; };
    listen-on-v6 { none; };
};
```

`allow-query` 管"谁能问权威"，`allow-recursion` 管"谁能让我递归"——两者常被混为一谈：只开前者、忘开后者，内网用户会看到"能解析公共域名、解析不了自家域名"或反过来的诡异现象，根因是两种访问被不同的 ACL 挡在了门外。`version "not available"` 抹掉横幅版本号，少送情报给扫描器；`listen-on-v6 { none; }` 在不用 IPv6 的机房还能少一个监听面。改完一律先跑 `named-checkconf`，语法错误会在重启前就被拦下，比服务起不来再翻日志省一半时间。

## 4. 正向解析

### 4.1 声明区域

BIND 9.18 起推荐 `type primary`/`type secondary`（`master`/`slave` 仍兼容但已弃用），新配置直接用新词，避免与旧文档混读时困惑：

```text
// named.conf.local（Debian）或 named.conf（Arch/RHEL）
zone "example.com" {
    type primary;
    file "/etc/bind/zones/db.example.com";   // Arch/RHEL 路径相应调整
    allow-transfer { 192.168.1.101; };       // 只放行从服务器
    also-notify { 192.168.1.101; };          // 序列号变化时主动通知
};
```

这段声明的四个字段各管一件事：`type` 决定本机是账本主人还是跟随者；`file` 指向真正落盘的 zone 文本（路径必须与 `directory` 约定一致，放错位置会在 named 日志里表现为 file not found）；`allow-transfer` 把 AXFR 收紧到从服务器 IP，避免整份区域被任意查询者拖走；`also-notify` 让序列号变化时主服务器主动敲从服务器的门，把传播从"等 Refresh 周期"压到秒级。写完先 `named-checkzone` 再 `named-checkconf`，两道闸都绿了才 `rndc reload`——顺序反了，单个 zone 的语法错误可能连累整台 named 起不来。

### 4.2 区域文件

区域文件本身是纯文本账本：TTL、SOA、NS，然后逐条记录。序列号、Refresh、Retry、Expire、Negative TTL 五个 SOA 字段从上到下依次解释"多久重新传输、失败重试间隔、从服务器多久宣告放弃"；CNAME 不可与 A/MX 共存、根域要留 A 给 `mail` 这类别名的宿主，都是写第一份 zone 时最容易踩的语法点：

```text
$TTL    86400
@       IN      SOA     ns1.example.com. admin.example.com. (
                        2024010101 ; Serial：改动必须递增
                        3600 1800 604800 86400 )
        IN      NS      ns1.example.com.
        IN      NS      ns2.example.com.
        IN      A       192.168.1.100
ns1     IN      A       192.168.1.100
www     IN      A       192.168.1.100
mail    IN      A       192.168.1.102
ftp     IN      CNAME   www.example.com.
        IN      MX 10   mail.example.com.
```

SOA 五元组里，**序列号是主从同步的心跳**：从服务器每次比较本地与主服务器的 serial，只有主的更大才拉取新区域——只改记录不改序列号，从服务器永远认为"没变"，这是主从不同步里排名第一的根因。惯例用 `YYYYMMDDNN`（日期加当日修订号），既好读又不会回绕。CNAME 的宿主不能再有其他记录（MX/A 不可共存于同一名字），邮件相关名字想兼做 A 记录时，记得给根域也留 A，否则 `mail.example.com` 的 CNAME 目标必须指向另一个纯 A 记录名。改完文件按顺序验证：`named-checkzone example.com /etc/bind/zones/db.example.com` 查区域，`named-checkconf` 查全局，最后 `rndc reload` 或重启服务让新 serial 生效——顺序反了，语法错误会连累整台服务器起不来。至于"这个 zone 文件该放哪个目录"，以发行版默认 `directory` 为准：Debian 片段里常见 `/etc/bind/zones/`，Arch/RHEL 多在 `/var/named/` 一带；放错位置 named 仍可能起来，但加载区域时报 file not found，排查时先 `ls` 再怀疑语法。

## 5. 反向解析

反向域把 IP 八位组倒写后挂上 `in-addr.arpa`：`192.168.1.100` 对应 zone `1.168.192.in-addr.arpa`，PTR 记录负责从地址答回名字。声明与记录合成一段即可——zone 声明里的 `type`/`file` 与正向区完全对称，差别只在文件名与 PTR 行：

```text
zone "1.168.192.in-addr.arpa" {
    type primary;
    file "/etc/bind/zones/db.192.168.1";
};
// db.192.168.1 —— SOA 与正向区同构，serial 同步递增
$TTL    86400
@       IN      SOA     ns1.example.com. admin.example.com. ( 2024010101 3600 1800 604800 86400 )
        IN      NS      ns1.example.com.
100     IN      PTR     www.example.com.
102     IN      PTR     mail.example.com.
```

PTR 目标必须写**全限定域名并以点结尾**，漏掉末尾的点会被拼成 `www.example.com.1.168.192.in-addr.arpa` 这样的笑话——这是反向区最常见的笔误。反向解析在实务中不是可选项：邮件服务器反查不通过会被对端降权甚至拒收，反向区写错的网络里排障时 `dig -x` 永远给不出可信答案。

正反向区成对维护时，把两侧 serial 绑在同一张变更单里改，能避免"正向已生效、反向还停在昨天"的半更新状态；反向区改动频率低，更容易被遗忘，巡检脚本里应把 `dig -x` 的期望结果与 `dig A` 一样纳入冒烟测试。若网段做了 DHCP 动态 PTR，注意与静态 PTR 的边界——同一地址不要同时存在手工与动态两条记录，BIND 只会按配置的优先级取其一，排查"反查结果不对"时先确认你改的是哪一类区。

## 6. 主从 DNS

### 6.1 主（primary）侧

主服务器沿用第 4 节的区域声明——`type primary`、`file` 指向权威账本，再补两行给从服务器开口（`allow-transfer` 与 `also-notify` 见第 4 节示例，此处不重复）。

### 6.2 从（secondary）侧

三系安装命令与主服务器相同——Debian 是 `sudo apt install bind9`，Arch 是 `sudo pacman -S bind`（另见第 2 节对照表），RHEL 是 `sudo dnf install bind`；装完差异只在 unit 名与配置路径，从服务器多一条区域声明：

```text
zone "example.com" {
    type secondary;
    file "db.example.com.slave";     // 相对 directory 的可写路径
    masters { 192.168.1.100; };
};
```

从服务器拉取成功后会把区域写进自己的工作目录，日志出现 `transfer of ... succeeded` 即握手完成。设计上要记住三点：AXFR 默认应收紧到从服务器 IP（全网任意查询都能拖走整个 zone 是信息泄露）；序列号以主为唯一真相源，永远不要手改从的文件；`also-notify` 让主在 reload 后主动推一把，把传播延迟从"等 Refresh 周期"压到秒级——与 `pacman` 升级后靠 systemd 单元即时拉起新版本，都是"变更后主动触发生效"的同一种思路。主从搭好后，日常巡检只需盯两件事：两侧 serial 是否一致，以及日志里有没有异常的 transfer 失败记录——这两条绿灯，比盯着每条 A 记录更省心。

## 7. 测试与 dig 排错

```bash
# 语法验证：改配置后的固定前奏
$ sudo named-checkconf
$ sudo named-checkzone example.com /etc/bind/zones/db.example.com
zone example.com/IN: loaded serial 2024010101
# 指定服务器查询 / 链路追踪 / 反向 / 响应码
$ dig @192.168.1.100 www.example.com A
www.example.com. 86400 IN A 192.168.1.100   # ANSWER SECTION 摘录
$ dig +trace example.com
$ dig -x 192.168.1.100
$ dig @192.168.1.100 no-such.example.com   # 关注 STATUS
$ sudo journalctl -u named -f              # Debian unit 名为 bind9
```

`named-checkzone` 打印 `loaded serial` 即区域文件被语法层接受；serial 数值要与你在 zone 里写的一致，对不上说明改的是另一份文件——多环境、多 zone 并存时这是最常见的"改了不生效"根因。`dig @IP` 里的 `@` 指定权威侧入口，排障时务必带上，否则本机缓存会把结果污染成"明明改了还是旧的"。`STATUS` 三态要背熟：`NOERROR` 空应答是"域名存在但没这条记录"，`NXDOMAIN` 是"整名不存在"，`SERVFAIL` 多指上游或 DNSSEC 校验失败——三种状态对应三条完全不同的处置路径，先读 STATUS 再翻日志能少走一半弯路。

排错时养成读三行的习惯：`STATUS` 判断是没域名（NXDOMAIN）还是没记录（NOERROR 空应答）；`ANSWER SECTION` 看结果与 TTL；`AUTHORITY SECTION`/`ADDITIONAL SECTION` 看是谁给的权威答复。`+trace` 把 referral 链摊开，"卡在根还是卡在权威"一眼可辨；nslookup 也能用，但交互模式对脚本化排查不友好，诊断场景优先 `dig`。区域改了没生效？按顺序检查：serial 是否递增 → `named-checkzone` 是否通过 → 是否 `rndc reload`/重启 → 查询时是否命中了本地缓存（先 `dig +norecurse @权威` 验证源头）——四步走完，绝大多数"改了不生效"都能定位到具体一环。把这四步写进变更单模板，比出事后在群里问"谁改了 DNS"更能省下深夜的时间。

## 8. 常见坑

**服务起不来 / 端口被占。** `systemctl status named`（或 Debian 的 `bind9`）看报错摘要，再 `journalctl -u named -e` 看全文。最常见三类：配置语法错（用 `named-checkconf` 复现即可）；53 端口被 systemd-resolved 或另一套 DNS 占用（`ss -ulnp | grep :53` 找到占用者）；权限/SELinux 拒绝区域文件读取（`ls -lZ` 对照包默认上下文，必要时 `restorecon`）。端口放行与入站策略仍以[防火墙篇](../../security/firewall.md)为准，本页不重复。

**同一台机上 systemd-resolved 与 named 抢 53。** 症状是 `bind9`/`named` 起到一半 `address already in use`，或起得来但查询被截到 127.0.0.53。`ss -ulnp | grep :53` 若指向 `systemd-resolved`，按本机角色二选一：本机仅做递归出口时可让 resolved 转发给 named；要当权威服务器则禁用 resolved 的监听（改 `resolved.conf` 的 DNS StubListener 或直接 `systemctl disable --now systemd-resolved`）并写好 `/etc/resolv.conf`——与端口占用类问题同一套处置顺序：先认占用者是谁，再决定让路还是关掉，不要两边同时改一半。

**改了记录不生效。** 按第 7 节四步法走：serial 没递增是主因之首；`named-checkzone` 报错则区域被拒载，named 会保持运行但该 zone 轮空；忘了 reload，进程还抱着旧缓存；最后一环是测试端自身缓存——用 `dig +norecurse @权威IP` 直击源头，才能把"权威没改"和"缓存没过期"分开。

**主从 serial 不同步。** 从服务器日志若长时间无 transfer 记录，先比对两侧 serial；相同时从机当然不动——问题回到主侧是否递增并 reload。serial 相同但内容不同属于人为事故，需要在主侧强制递增序列号重建真相；`allow-transfer` 没放行从机 IP 时，传输会被静默拒绝，日志里常见 `permission denied` 字样，对照 ACL 即可。

**公网开放递归被滥用。** 症状是带宽异常、`allow-recursion` 日志里出现陌生网段。处置顺序：收紧 ACL → 对纯权威角色考虑 `recursion no` → 必要时用视图把内外网应答拆开。这一条与"包管理仓库不要对不可信网络开放"同理：服务默认姿态应当是收窄信任面，再按需开口，而不是先全开再打补丁——`pacman` 源文件里的签名策略，和 named 的 ACL 表，写的是同一份信任名单。

**内网短名解析不到。** 确认 `/etc/resolv.conf` 指向了你的服务器；确认客户端网段在 `allow-query` 内；确认 zone 里的名字确实存在且 CNAME 没有悬空。与 `pacman -Ss` 搜不到包先怀疑索引没刷新一样，DNS 查不到先怀疑"问的不是你以为的那台服务器"——`dig @服务器IP 名字` 是最快的验尸工具。

**DNSSEC 校验失败（SERVFAIL）。** 症状是域名在公共解析器上正常、在自建递归上 SERVFAIL。依次检查：`dnssec-validation` 是否被改成 `no` 后又残留了损坏的托管密钥；上游 forwarder 是否返回了不完整的 DNSSEC 链；本机时间是否严重偏移（签名有效期以时钟为准，与 NTP 失步会让一切签名"过期"）。排查时先 `dig +cd` 绕过校验确认是数据问题还是校验问题，再决定是修时间、补 DS 记录还是回滚验证开关——与"图空先分清是查询错还是数据缺"一样，先隔离变量再改配置。

**AXFR 被拒 / 从服务器拿不到区。** 主侧 `allow-transfer` 没放行从机 IP、`named-checkzone` 在主侧就红了、或防火墙拦了 53/TCP——三者日志表现各不相同：ACL 拒绝常见 `permission denied`，语法红则传输根本不启动，防火墙表现为超时。在从服务器上 `dig AXFR example.com @主IP` 直接复现握手，比翻双向日志更快；与包管理"先本地 query 再查网络"的顺序相同：先证明服务层能应答，再怀疑链路。

**换 IP 后旧地址还在应答。** TTL 过长 + 中间层缓存（递归解析器、浏览器、libc 缓存）叠加的经典现象。处置：改记录前先降 TTL 到 60 并等到旧 TTL 过完，再切 A 记录，切完恢复常态 TTL；已切完才发现问题则要等各层缓存自然过期，无法强刷时只能加大新值覆盖。这条时间线写进变更单，比事后解释"为什么还指向旧机器"省力得多——DNS 没有全网 flush 按钮，预降 TTL 是唯一便宜的后悔药。

## 参考资料

- BIND 9 官方文档 — [bind9.readthedocs.io](https://bind9.readthedocs.io/)
- Arch Wiki: BIND — [wiki.archlinux.org/title/BIND](https://wiki.archlinux.org/title/BIND)
- Debian BIND 手册 — [bind9.readthedocs.io](https://bind9.readthedocs.io/en/latest/)
- 鸟哥的私房菜 - DNS — [linux.vbird.org](https://linux.vbird.org/linux_server/centos6/0350dns.php)
- RFC 1034/1035 — DNS 规范
- dig 手册 — [man dig](https://linux.die.net/man/1/dig)
