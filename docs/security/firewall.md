# 防火墙

防火墙是网络安全的第一道防线，用于控制网络流量。本篇从**安全策略视角**讲防火墙：不只是"怎么开一个端口"，而是"默认该拒绝什么、白名单怎么设计、规则顺序为什么重要、被拒绝的流量去哪看"。日常端口放行的命令速查在[网络篇 · 防火墙](../network/firewall.md)，两篇配合使用。

> 内容参考自 Arch Wiki、netfilter 手册、firewalld 文档和实际运维经验，见文末参考资料。

## 导语

防火墙排在安全篇第一位，除了"它在攻击发生前生效"，还因为它是**唯一一层输出可以直接当审计证据的控制**：`ufw status`、`firewall-cmd --list-all`、`nft list ruleset` 的打印结果就是机器当前的暴露面声明，换人接手时读一遍即可对账。后面几层的输出要么是日志（要解读）、要么是配置文件（要推断生效值），只有防火墙的状态几乎是自解释的——先把这道可自解释的闸建好，再叠加需要解读的层，学习曲线才平滑。这条"先做可自解释的、再做需要解读的"的顺序，也是安全篇整体编排的暗线：防火墙 → 加固 → 检测 → 加密，可审计性依次下降，对读者前置知识的要求依次上升。也可以把四层读成四种证据形态：**状态、清单、时间线、密钥材料**——防火墙给状态，加固给清单，检测给时间线，加密管密钥；四份证据拼起来才是完整的安全姿态说明。

本篇默认你已经具备网络篇的基础（端口、协议、监听与连接的概念），命令细节不再展开；若对 `ss -tulnp` 的输出还陌生，先补[网络篇 · 防火墙](../network/firewall.md)再回来，否则第 3–5 节的"验证"步骤会跟不上。前置不够时的症状很具体：看到"放行 22"不联想到 `ss -tulnp` 里应该多出 LISTEN，看到"被拒绝"也不知道去哪看丢包计数——**验证步骤依赖网络篇的观测工具，本篇只补策略这一半。**

一个容易和防火墙混淆的概念是**云安全组**：它是云厂商在虚拟交换机上实现的另一层过滤，规则模型类似（入站/出站白名单）但管理入口在控制台、不随主机镜像走。本篇讲的主机防火墙与安全组必须**同时配置且互相印证**——主机侧拒绝、安全组放行的组合是安全的（双层门禁），主机侧放行、安全组拒绝则会让"我明明 allow 了"的排障浪费半天。两层都写进配置仓库，是云时代防火墙运维的新默认动作。

> 内容参考自 ufw、firewalld、nftables 官方文档与 Arch Wiki，见文末参考资料。

## 为什么先学防火墙

一台刚装好的 Linux 服务器，默认行为往往是"什么都不拦"：所有端口对外可达、转发不设限、出站不设限。只要它一接公网，几分钟内就会被扫描器摸清开放端口——如果你顺手装的数据库、调试端口恰好暴露，被利用只是时间问题。防火墙解决的就是这个问题：在内核层面（netfilter）按规则决定每个数据包**放行还是丢弃**，把攻击面从"整台机器"压缩到"明确声明过的几个端口"。

值得先建立一个尺度感：公开研究和事故复盘反复表明，大量"重大入侵"的起点并不需要零日漏洞，而是**本不该开放的端口碰上了没打补丁的服务**。Redis 未授权访问、数据库弱口令暴露、管理后台对全网敞开——这些案例的共同点是防火墙层本可以零成本拦下，却因为"先上线再说"被跳过了。防火墙是所有安全投入里**单位成本收益最高**的一层：它不需要改业务代码、不需要购买许可证，只需要你在上线前花十分钟把默认策略想清楚。

三系发行版的差异在这里第一次变得刺眼：Ubuntu 有 `ufw` 但默认没启用，RHEL 系开箱就跑着 `firewalld`，Arch 则什么都不预装、由你自选 `nftables` 或 `iptables`。拿着一系的命令去另一系执行，轻则报 `command not found`，重则在远程会话里把自己锁在门外。这种差异不是历史包袱的偶然结果，而是三家对"安全默认值"的不同回答：RHEL 选择了"默认开、白名单短"，Ubuntu 选择了"工具备好、启用权交给你"，Arch 选择了"不替你做决定"。理解这个取向差异，比背下三套命令更重要。

把防火墙排在安全篇第一章，也不是因为它最"高级"，而是因为**它是唯一一层能在攻击发生前就生效的控制**：入侵检测要在事后才能告警，加密要等数据被访问才有意义，加固基线则需要时间逐步落实——只有防火墙，在你敲下回车的那一刻就把不符合策略的包挡在了协议栈之外。先建立这道闸，后面三层的工作量都会显著下降：没有爆破流量，Fail2Ban 的告警会安静得多；没有无关端口，补丁压力面也更小。**防火墙拒绝日志是"有人在门外"的第一手信号**——它给第 6 节的日志衔接供数，也给检测篇的 Fail2Ban 提供后端——先有这层粗筛，后面的细粒度工具才不会一开始就淹没在全网扫描噪音里。

三个绕不开的真实场景：

1. **公网爆破**。SSH 端口暴露后，`journalctl -u sshd` 每小时能翻出几百条 `Failed password`。封 IP 是治标，防火墙把 SSH 限制到办公网段或改成非默认端口才是治本——这属于策略设计，不是简单放行。
2. **调试端口忘了关**。Redis 的 6379、数据库的 3306 在开发时图方便对全网开放，上线后没人记得收回。默认拒绝 + 显式白名单的策略，能让这类遗漏变成"业务报错"而不是"数据泄露"，问题会立刻暴露在你面前。
3. **服务器被当跳板**。不设限的 FORWARD 链和出站策略，会让失陷主机成为攻击内网的跳板。安全视角的防火墙不止管入站，也管转发与（必要时）出站。

这三条场景分别对应入站暴露面、策略遗漏与横向移动三个经典攻击面，也预告了本篇的三个重点章节：默认拒绝策略（治场景二）、zone/规则模型（让场景一可管理）、forward 与出站控制（治场景三）。读的时候可以带着这个问题——"我现在的机器，这三条各占哪一条？"——多数人会发现三条全中。

还有一类常被低估的场景是**云上"两层墙"只配一层**：安全组（云厂商的虚拟防火墙）和主机防火墙是两道独立闸门，控制台里那条为了调试临时放开的 `0.0.0.0/0` 规则，往往比主机上的 ufw 配置存活更久。排查暴露面时必须两层都看——只查主机策略会漏掉安全组的全开条目，反之亦然。把两层配置都纳入配置仓库管理，是消除这类"幽灵规则"的唯一可靠办法。

鸟哥的教程把防火墙类比成大楼门禁：**默认拒绝 = 没有工卡一律不进，白名单 = 给每个需要进出的岗位单独发卡**。顺序同样关键——先发卡再启用门禁，还是先启用门禁再发卡，决定了会不会有人（包括你自己）被关在门外。

还有一点容易被初学者忽略：防火墙是**内核态**的决定，不是某个用户态程序的"建议"。netfilter 挂钩在协议栈上，数据包还没送到你的进程就已经被裁决了——这意味着防火墙配置错误的后果比应用配置错误更直接（连不上就是连不上，没有降级路径），也意味着防火墙救不了应用层漏洞（80 端口放行了，SQL 注入照样发生）。把防火墙放在"减少暴露面"的位置理解，而不是"万能防护"，后面几章的分工才不会乱。

### 与网络篇的分工

同一个 ufw 命令在本篇和[网络篇 · 防火墙](../network/firewall.md)都会出现，但阅读目的不同：网络篇按"我想开 80 端口该敲什么"组织，是**操作速查**；本篇按"这台机器的默认策略是什么、为什么这么设计、如何验证与留痕"组织，是**策略设计**。第一次配防火墙建议先读本篇建立模型，之后日常放行端口直接翻网络篇即可；排查"端口明明开了却访问不了"这类问题，两篇的清单也建议都过一遍（主机策略、云安全组、zone 绑定三层都可能拦人）。两篇的分工也可以记成"**网络篇管连通，本篇管边界**"——连通性问题用 `ss`/`ip`/`ping` 定位，边界问题用 `ufw status`/`nft list ruleset` 定位；混用观测工具会把策略问题误诊成路由问题，反之亦然。

> 内容参考自 Arch Wiki、netfilter 手册、firewalld 文档和实际运维经验，见文末参考资料。

## 学习目标

- 说清三系默认防火墙差异（ufw / firewalld / nftables）及各自适用场景
- 理解 zone 与规则链两种模型，能读懂 `firewall-cmd --list-all` 与 `nft list ruleset` 输出
- 掌握"先 allow 后 enable"的铁律，避免远程锁死
- 设计默认拒绝 + 白名单的服务器策略，并配好日志与限速
- 知道规则如何持久化，以及与 Fail2Ban、日志系统的衔接点

五条目标里前两条是"看懂现状"，后三条是"改出正确状态"——这也是本篇章节的排列逻辑：先建立词汇与模型（第 2 节），再分别在三套前端上落地（3–5 节），最后补上观测与验收（6–8 节）。只读不练的话，最容易卡在第 2 节的策略词汇上；建议读完第 2 节就找一台虚拟机，把默认拒绝和一条业务端口真正配出来。目标本身也可以按"读输出 / 改状态 / 验结果"三分：能读懂 `nft list ruleset` 的人，才有资格写规则；能回读验证的人，才有资格在生产上 `enable`——**看不懂现状就改，是本篇自锁坑的共同前置错误。** 第 3–5 节三套前端不必同时精通，但**至少要有一套能默写验证步骤**，其余两套会读即可——深度优先比横向浅尝更接近真实值班需要。

练习时推荐用可快照的虚拟机：第 3.1 节的自锁坑在物理机或不可回滚的云主机上代价很高，快照让你能把"锁死"变成一次可重放的实验——这比在心里默背一百遍"先 allow 后 enable"都管用。做完第 3 节再做第 4、5 节各一遍，三套前端都亲手锁一次（然后快照恢复），你对顺序纪律的记忆会比任何告警弹窗都深。

学完本篇的操作性检验：给你一台全新的三系之一的虚拟机，你应该能在**不把自己锁在门外**的前提下，默认拒绝入站、放行 SSH 与业务端口、开启丢包日志，并能用一条回读命令向同事解释当前策略。做不到回读解释，说明策略还只存在于记忆里，没有变成可审计的配置。

## 1. 三系默认防火墙差异

先给结论，再解释为什么这张表值得背下来：**你在哪家发行版上，决定了你的第一组防火墙命令、第一个配置文件路径，以及"这台机器出厂是否已经受保护"**。跨发行版运维最常见的事故之一，就是拿着 RHEL 文档里的 `firewall-cmd` 去 Ubuntu 上执行，或者把 Ubuntu 的 `ufw enable` 流程照搬到一台已经跑着 firewalld 的机器——两套管理器同时存在时，规则可能互相覆盖，排查起来极其痛苦。这张表还值得连同"云安全组"一起记：主机侧只是第一道闸，**云上还有一道不随镜像走的闸**；三系差异解决的是"主机上用哪套命令"，安全组解决的是"这台机器在不在"——两层叠起来才是完整的入站路径。

| 对比项 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|--------|---------------|------|-------------------|
| 默认方案 | Ubuntu：`ufw` 已安装、**默认未启用**；Debian 服务器常不预装 | 无默认，自选 `nftables`/`iptables`/`ufw` | `firewalld` 默认安装并启用 |
| 前端命令 | `ufw` | `nft`（内核原生）、`iptables`（Arch 默认走 nft 后端） | `firewall-cmd` |
| 底层 | iptables/nftables | nftables（或兼容层） | nftables（RHEL 8+）/ iptables（RHEL 7） |
| 持久化 | `ufw` 自动保存到 `/etc/ufw/` | `nftables.service` 读 `/etc/nftables.conf` | firewalld 配置库自动持久 |
| 安装命令 | `sudo apt install ufw` | `sudo pacman -S nftables` | `sudo dnf install firewalld` |

先确认三系各自的起点，这一步决定你后面所有命令的写法。Debian/Ubuntu 上 ufw 通常随系统安装但处于 `Status: inactive`——它装好了却没接管流量，这是"默认不拦"的直接证据；Arch 上什么都不预装，需要主动 `sudo pacman -S nftables ufw` 把工具放进系统；RHEL/CentOS/Rocky 则相反，`systemctl status firewalld` 出厂就是 `active (running)` 且 `enabled`，开机即防护。同一个"检查防火墙"动作，三系给出三种完全不同的第一印象，这不是操作错误，而是发行版安全策略的差异。

Arch 上如果选择 `iptables` 而不是 `nft`，注意自 2018 年起 Arch 官方仓库的 `iptables` 包默认链接到 nft 后端（`iptables-nft`），语法不变但底层已是 nftables——`iptables-save` 的输出与内核实际规则的关系需要留意。生产新装环境更推荐直接学 `nft`，语法更简洁且是内核原生接口。这条差异也解释了为什么 Arch Wiki 把 iptables 条目标注为"兼容层"：你在写老语法，内核执行的却是新引擎，两者的调试工具（`nft monitor` 比 `iptables -L -v` 更能反映真实）并不通用。

三条选型经验：**云主机/单机服务用 ufw 最省心**（规则少、心智负担低）；**多网卡、多 zone 的企业边界机用 firewalld**（zone 模型天生适合"内网口一套、外网口一套"）；**需要精细控制转发/NAT/限速的网关用 nftables**（表达力最强，但要自己写配置文件）。三者底层都是 netfilter，不存在"谁更安全"，只有"谁的策略模型更适合你这台机器"。真正拉开差距的是**你有没有把默认策略想清楚**：一个写满 allow 规则但 policy 是 accept 的 nft 配置，安全程度并不比一台没装防火墙的机器高多少；反过来，哪怕只用 ufw 的三条默认规则，只要先放行了 SSH 再启用，攻击面就已经收缩了一个数量级。工具是载体，策略才是本体——这也是本篇不按"命令大全"组织，而按"策略 → 实现 → 验证"组织的原因。

## 2. 安全策略模型：默认拒绝与白名单

无论用哪套前端，安全策略的核心就三句话。这三句话与发行版无关，也是后面三套前端（ufw/firewalld/nftables）翻译时的唯一母本——**先在纸上写清楚这三句话，再翻译成语法**，比对着手册边查边抄安全得多：

1. **入站默认拒绝（deny incoming）**——没显式允许的端口一律丢弃。
2. **白名单而不是黑名单**——允许列表短且可审计；黑名单永远追不完扫描源。
3. **状态化匹配**——放行"已建立的连接"，避免为每个回包写规则。

对应到 nftables 的表达就是：`policy drop` + `ct state established,related accept` + 逐个业务端口 `accept`。ufw 出厂默认策略恰好就是 `deny (incoming), allow (outgoing)`，这也是它"默认未启用"的原因之一——一旦 `ufw enable`，没放行的端口立刻不可达。

把这三句话摊开成一张对照表，方便写策略文档时直接引用：

| 概念 | 一句话定义 | 反模式（黑名单思维） | 在三系里的落点 |
|------|-----------|---------------------|---------------|
| 入站默认拒绝 | 未显式允许即丢弃 | "先把服务跑起来，安全以后再说" | `policy drop` / `deny (incoming)` / zone 默认 |
| 白名单 | 只列需要进来的端口/网段 | "封掉扫得最凶的那几个 IP" | 逐端口 `accept` / rich rule / ufw allow |
| 状态化匹配 | 已建立连接的回包自动放行 | 为每个回包手写反向规则 | `ct state established,related accept` |
| 最小暴露面 | 只开业务真正需要的口 | 图方便对 `0.0.0.0/0` 全开调试端口 | 来源限定 + 云安全组对齐 |

### 2.1 为什么默认拒绝

默认拒绝的本质是**把"未知"等同于"危险"**：新服务上线、新漏洞曝光、新扫描源出现时，策略不需要临时反应——它们本来就被丢掉了。黑名单模型恰好相反，每次新威胁都要人工追加规则，安全水位永远滞后于攻击面。鸟哥用门禁类比时强调过同一点：大楼不会因为"最近小偷多"才开始查工卡，而是从第一天起就没有工卡进不来。

运维视角还有两个常被低估的收益。其一，**默认拒绝让配置自解释**：`ufw status` 或 `nft list ruleset` 的输出就是这台机器"声明过的暴露面"，新人接手时读一遍策略即可建立信任边界，而不必先理解每条历史遗留的 ACCEPT 从何而来。其二，**它把失误暴露成故障而不是漏洞**：忘放行的端口会立刻报"连不上"，逼你补规则；全放行下忘关的端口则静默躺在公网上，可能几个月后才在扫描报告里被发现。安全设计里"快速失败"比"静默成功"有价值得多——防火墙是少数把这条工程原则直接变成安全属性的地方。

三套前端只是这三句话的三种方言：ufw 把"白名单"抽象成几条简单规则，firewalld 把白名单按 zone 分组管理，nft 则把完整策略摊在一个配置文件里供你逐行审阅。**换发行版时迁移的不是命令，而是这三句话**——先在纸上写清楚"入站默认拒绝、放行 22/80/443、established 放行、转发关闭"，再翻译成当前系统的语法，比对着手册现查现抄安全得多。状态化匹配（conntrack）之所以重要，是因为它让白名单模型变得可行：没有它，你得为每个 TCP 连接的回包单独写允许规则，规则集会膨胀到无法维护。

一个常见争论是**出站要不要也默认拒绝**。纯服务器场景通常保持 `allow (outgoing)` 以免业务异常；但对安全要求高的机器（跳板机、支付网关）可以改为出站白名单，代价是每新增一个外部依赖都要加规则。折中做法是先用日志观察出站流量一段时间，再决定白名单内容——**没有流量画像就直接收紧出站，是把自己锁死的另一种方式**。

白名单不是没有成本，它的代价是**维护纪律**：每上一个新业务都要记得补规则，每换一个监控地址都要检查出站是否放行。很多团队最后退回"全放行 + 定期盘点"，不是模型错了，而是没有把"加规则"纳入发布流程。让白名单可持续的常见做法有三：把防火墙规则写进与部署脚本同源的配置仓库；在上线检查单里固定一条"端口是否已按需放行"；每月用 `ss -tulnp` 与防火墙规则做一次对账，找出"服务在听但规则没开"或"规则还在但服务已下线"的孤儿项。**对账频率比规则数量更能决定这套模型活多久。**

`drop` 与 `reject` 的区别也值得记牢：`drop` 直接丢包，客户端等到超时；`reject` 回一个 ICMP 拒绝，客户端立刻失败。对外默认用 `drop`（不暴露端口状态、不浪费攻击者时间），仅在内网排障时临时用 `reject` 便于确认"规则生效了"。

### 两种规则组织方式：链式与区域式

三套前端在"规则怎么组织"上分成两个流派——这不是实现细节，而是**你写策略、读输出、排障时脑内画的那张图**。理解这一点后阅读任何一份配置都不会迷路。**链式模型**（iptables/nftables）把规则挂在 INPUT/OUTPUT/FORWARD 这类钩子上，按写入顺序线性匹配——规则顺序就是语义的一部分，插错位置等于改了策略。**区域式模型**（firewalld）先问"这个包从哪个接口/来源进来"，再套用该 zone 的服务白名单——规则顺序不再重要，重要的是**归属**。ufw 介于两者之间：它内部仍编译成链式规则，但对外只暴露"放行/拒绝"两条语义，替你管好了顺序。

选型时的隐含问题其实是："我的机器有多复杂的信任分区？"单网卡单角色的云主机，链式（或 ufw 的简化视图）足够；一台同时暴露办公网、管理网、DMZ 的边界机，zone 模型能把三套策略物理隔开，不至于让规则表膨胀成上千行。**没有最好的模型，只有与信任结构匹配的模型**——这也是为什么迁移服务器时照抄规则经常失败：两台机器的信任结构不同，规则本就不该一字不差。

## 3. ufw：Debian/Ubuntu 的默认选择

### 3.1 先放行，再启用（本篇最重要的坑）

ufw 的 `enable` 会立刻应用默认拒绝策略。如果你在远程 SSH 会话里先执行 `ufw enable`、还没来得及放行 22 端口，连接会在几秒内中断——**规则顺序错误直接把管理员锁在门外**，云主机上只能靠控制台 VNC 救援。正确顺序永远是：

```bash
# ① 先放行 SSH（远程会话的救命规则）
$ sudo ufw allow 22/tcp
Rules added

# ② 再启用防火墙
$ sudo ufw enable
Firewall is active and enabled on system startup

# ③ 确认状态与默认策略
$ sudo ufw status verbose
Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), disabled (routed)
New profiles: skip

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW IN    Anywhere
```

`status verbose` 的三行默认策略是安全审计的第一眼信息：`deny (incoming)` 说明白名单模型已生效，`disabled (routed)` 说明这台机器不转发流量（不是路由器就该保持如此）。若你是在本机物理终端操作，顺序错了还能补救；纯 SSH 环境务必在 `enable` 前用 `ufw status` 自查一遍放行列表。

为什么这个坑值得单独成节？因为它同时踩中了两个容易被忽略的事实：其一，**ufw 的默认策略在 `enable` 的瞬间就生效**，不存在"启用后再慢慢加规则"的缓冲期；其二，**SSH 是你唯一的远程修改通道**（云主机例外），掐断它等于放弃了所有远程纠错手段。把这两点想明白，你就会把"先 allow 后 enable"从一条口诀升级成操作纪律：任何"改变访问控制面"的动作（启用防火墙、切换默认 zone、改 sshd 认证方式），都必须在**保留旧通道的同时开一条新通道并验证**，验证成功再关闭旧通道。防火墙、SSH、sudoers 三处的自锁事故，本质都是违反了这条纪律。

### 3.2 日常规则与限速

启用只是起点，日常运维里 90% 的动作都在本节：放行新业务端口、给敏感服务加来源限制、给 SSH 上限速、删掉过期规则。把这四类动作练熟，防火墙就从"装上就不敢碰"变成可以随业务演进的常规配置。日常规则围绕"放行、限速、删除"三类动作。放行可以用服务名（`ufw allow http`，依赖 `/etc/ufw/applications.d` 的 profile）也可以用裸端口；限定来源的写法 `ufw allow from 192.168.1.0/24 to any port 3306` 是数据库、Redis 这类"只该内网可达"服务的标准姿势。删除时优先用 `ufw status numbered` 查编号再 `ufw delete N`——按内容删除容易因端口写法不一致（`22` 与 `22/tcp` 是两条规则）而删不掉。

```bash
$ sudo ufw allow 80/tcp
$ sudo ufw allow 443/tcp
$ sudo ufw allow from 192.168.1.0/24 to any port 3306
$ sudo ufw limit 22/tcp          # SSH 限速：时间窗内超限即拒
Rules added (with rate limits)
$ sudo ufw status numbered       # 带编号查看，配合 delete N 使用
```

`ufw limit` 是常被忽略的利器：它用 recent 模块实现每 IP 速率限制，不装 Fail2Ban 也能挡住最基础的口令喷洒。但它是**阈值触发、非智能封禁**，持续低速的爆破仍需配合[入侵检测](./intrusion-detection.md)的 Fail2Ban。两者的关系可以这样记：`limit` 是防火墙自带的应急阀，Fail2Ban 是读日志的专职保安；前者不依赖日志格式、立即可用，后者能识别更复杂的模式（Web 登录失败、扫描 UA），生产上通常同时启用。

规则改动即时生效，且 ufw 自动持久化到 `/etc/ufw/user.rules`，无需手动 save——这与 iptables 裸用形成鲜明对比（见 5.4）。不要同时用 `ufw` 和裸 `iptables` 管理同一台机器：ufw 操作的是自己的规则集，裸 iptables 追加的规则可能在 ufw reload 时被冲掉或插到错误位置，两套管理源打架是经典故障。

服务名（`http`、`https`、`ssh`）与裸端口的等价关系也值得一提：`ufw allow http` 依赖 `/etc/ufw/applications.d` 里的 profile 定义，读一下该目录就能知道 `http` 具体开了哪些端口；profile 缺失时用裸端口更直白。团队环境建议统一写法——要么全用服务名便于业务方自述需求，要么全用端口便于审计脚本解析，混用会让后续的规则盘点变困难。

## 4. firewalld：RHEL 系的 zone 模型

RHEL 系从 CentOS 7 起就把 firewalld 设为默认，它的设计出发点和 ufw 不同：ufw 面向"单机单角色"的简洁场景，firewalld 面向"一台机器连接多个网络、需要按信任级别分治"的企业环境。理解这个定位差异，就不会奇怪为什么 firewalld 的概念看起来"更重"。

firewalld 的核心概念是 **zone（区域）**：把网络接口/来源划分到不同信任级别的区域，每个 zone 有自己的服务与端口白名单。这解决了一个 ufw 难以优雅处理的问题——同一台机器双网卡，内网口走 `trusted`、外网口走 `public`，策略互不干扰。

内置 zone 从宽松到严格大致是：`trusted`（全放行）→ `internal`/`home`/`work`（较宽松）→ `public`（默认，仅 ssh 等）→ `external`/`dmz` → `block`（拒绝并回 ICMP）→ `drop`（静默丢弃）。**新装系统的默认 zone 几乎总是 `public`**，它只放行 ssh 和 dhcpv6-client——这是 RHEL 系开箱比 Ubuntu"裸奔"更安全的直接原因。

zone 模型的实务要点有三条。其一，**接口决定 zone**：一个接口同一时刻只属于一个 zone，规则随接口走，换网卡名（云厂商常见）后绑定可能失效，需要回查。其二，**source 可以覆盖接口**：同一条网卡上，来自 192.168.1.0/24 的包可以走 `home`、其余走 `public`，用 `--add-source` 实现基于来源的策略分叉，这在"管理网和业务网共用一块网卡"的场景里非常实用。其三，**zone 名不是安全承诺**：把接口丢进 `trusted` 意味着全放行，和没有防火墙只差一个命令——误把生产网口设成 `trusted` 是 zone 模型特有的事故，改完务必 `--list-all` 复核。

```bash
$ sudo firewall-cmd --list-all
public (active)
  target: default
  interfaces: ens160
  services: ssh dhcpv6-client
  ports:
  forward: no
  masquerade: no
  rich rules:
```

输出里 `services: ssh dhcpv6-client` 就是白名单本身；`masquerade: no` 说明未开 NAT（服务器不该开，除非它真是网关）。**每次登录新机器，把这条命令当防火墙的"体检报告"先读一遍**，比任何文档都可靠。加规则时注意 **runtime 与 permanent 两个视图**——firewalld 把"当前内存里的规则"和"重启后要加载的配置库"分成两套，这是它与 ufw（改了即持久）最大的操作差异：

```bash
# --permanent 只写配置库，不立即生效；漏掉 --reload 是最常见失误
$ sudo firewall-cmd --permanent --add-service=http
success
$ sudo firewall-cmd --reload
success

# 限定来源的富规则（Rich Rule）：SSH 只对运维网段开放
$ sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" \
    source address="192.168.1.0/24" port port="22" protocol="tcp" accept'
```

`--permanent` 忘了 `--reload` 的症状是"明明加了规则却不生效"，重启后又"莫名其妙好了"——排障时先用 `firewall-cmd --list-all`（runtime）和 `firewall-cmd --list-all --permanent` 对比，一眼就能看出两者是否同步。另一个坑是**接口绑定**：接口属于哪个 zone 决定它套用哪套规则，用 `firewall-cmd --get-zone-of-interface=ens160` 确认，不要假设接口一定在 `public`。

runtime/permanent 双视图带来的另一个隐性风险是**"临时规则"被当成永久规则**：不带 `--permanent` 的改动在 reload 或重启后消失，同事复现你的环境时发现规则不在，互相怀疑"你是不是没保存"。团队协作时把规则写法固化进脚本（全部带 `--permanent`，末尾统一 `--reload`），或反过来全部先 runtime 验证再批量 permanent 化——**一个团队只选一种节奏**，比每个人按当天心情选更不容易出事。

## 5. nftables 与 iptables：Arch 与网关场景

### 5.1 为什么新环境推荐 nftables

iptables 的规则是逐条线性匹配的字符串拼接，表/链/匹配扩展分散在多个独立内核模块；nftables 一次性提交整个规则集，支持集合（set）、更清晰的语法和更好的性能。Arch Wiki 也明确建议新部署使用 nftables。对安全策略而言，最实际的好处是**一个配置文件描述完整策略**，便于版本管理与审计。

从维护成本看，这个"一个文件"的意义比语法好看更大：nft 配置可以整个进 git，改动 diff 一眼可见；iptables 规则散落在交互式命令与持久化文件两处，diff 时常对不上。性能层面，规则数量上千后 nft 的批量提交与集合匹配优势才会显现，单机几十条规则的场景两者体感无差——**选 nft 的主要理由是工程可维护性，不是跑分**。对正在维护存量 iptables 的团队，也不必急于重写：iptables-nft 后端会继续可用，迁移可以在下次大改策略时自然发生。

### 5.2 一份可直接用的服务器策略

```bash
#!/usr/sbin/nft -f
# /etc/nftables.conf —— 默认拒绝 + 白名单的服务器基线
flush ruleset

table inet filter {
    chain input {
        type filter hook input priority 0; policy drop;
        iif "lo" accept
        ct state established,related accept
        ip protocol icmp limit rate 5/second accept
        ip6 nexthdr icmpv6 accept
        tcp dport 22 accept
        tcp dport { 80, 443 } accept
        log prefix "nft-input-dropped: " flags all counter drop
    }
    chain forward {
        type filter hook forward priority 0; policy drop;
    }
    chain output {
        type filter hook output priority 0; policy accept;
    }
}
```

逐段解释这份配置为什么长这样：`table inet` 的 `inet` 家族让 IPv4/IPv6 共用一套规则，天然堵住"只配了 v4"的漏洞；`policy drop` 是链级默认动作，写在链头意味着**任何未被后续规则匹配的包直接丢弃**，白名单模型由此成立；`lo` 与 `established,related` 是所有服务器的两条地基，缺 `lo` 会让本机进程间通信（数据库连 127.0.0.1）一起被拒，缺 `established` 则 TCP 回包被掐断、表现为"连上就卡死"；ICMP 限速放行 ping 但不当放大器；最后的 `log ... drop` 让丢弃留痕，便于后面接日志与 Fail2Ban。`flush ruleset` 放在文件头是刻意的：**每次加载都是全量替换而非增量叠加**，避免多次 `nft -f` 后规则堆积成无法解释的谜团——代价是手工 `nft add rule` 的临时规则会被冲掉，调试时要清楚哪些是文件里的、哪些是敲进去的。

加载后建议通读一遍实际生效的规则（`sudo nft list ruleset`），对照文件确认无出入。Arch 上 `sudo pacman -S nftables` 之后 `systemctl enable --now nftables`，服务开机即读 `/etc/nftables.conf`。`policy drop` 写在链头是整段策略的安全锚点——**审计一份 nft 配置，先看 policy 再看规则**，这个阅读顺序在 nftables 与 iptables 上同样适用。

### 5.3 iptables 的位置

老系统与大量教程仍是 iptables 语法。核心心智模型是"表 × 链"：`filter` 管放行丢弃、`nat` 管地址转换、`mangle` 管包修改；入站走 `INPUT`、转发走 `FORWARD`、出站走 `OUTPUT`。规则**自上而下匹配、命中即停**，所以"允许已建立连接"必须写在拒绝之前。

顺序是这段命令的全部要点：回环、已建立连接、业务端口三条必须在默认策略生效语境下"先被考虑"，然后才用 `-P INPUT DROP` 把兜底改为丢弃。`-P INPUT DROP` 与逐条 `-A` 拒绝的语义差别在于**默认策略兜底**：即使你忘记写最后的拒绝规则，未匹配流量仍被丢弃。旧教程里的 `-m state` 已被 `-m conntrack` 取代，新配置请写 conntrack——两者在现代内核上通常都能工作，但 conntrack 是当前文档与示例的标准词汇，排查问题时搜索它才能找到最新资料。

```bash
$ sudo iptables -A INPUT -i lo -j ACCEPT
$ sudo iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
$ sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT
$ sudo iptables -P INPUT DROP
$ sudo iptables -L INPUT -n --line-numbers   # 回读确认 policy 已是 DROP
```

### 5.4 规则持久化（三系各不相同）

裸 iptables/nft 规则重启即失，持久化方式三系完全不同，这是迁移机器时最容易踩的坑：

- **Debian/Ubuntu**：`sudo apt install iptables-persistent`（或 `netfilter-persistent`），保存用 `sudo netfilter-persistent save`，规则落在 `/etc/iptables/rules.v4`。
- **Arch**：`sudo pacman -S nftables` 后启用 `nftables.service`（读 `/etc/nftables.conf`）；用 iptables 则装 `iptables` 包并启用 `iptables.service`（读 `/etc/iptables/iptables.rules`）。
- **RHEL/CentOS/Rocky**：firewalld 自身即持久层；若强制用 iptables，装 `iptables-services` 后 `sudo iptables-save > /etc/sysconfig/iptables`。

ufw 是这里唯一"改了就存"的方案——它的每条规则即时写入 `/etc/ufw/user.rules`，没有"忘记 save"这个失败模式。代价是 ufw 的表达力上限：复杂限速、多表协同这类需求迟早要下沉到 nft，届时要接受"配置文件 + 服务启用"的完整持久化链条。判断一条规则是否真的持久，最可靠的办法不是回忆自己敲过什么，而是**改完配置后模拟一次重启路径**：`systemctl restart nftables`（或 firewalld reload）再 `nft list ruleset`/`firewall-cmd --list-all` 回读——重启路径走得通，才叫持久化完成。

## 6. 日志、限速与检测衔接

前几节解决"拦不拦"，本节解决"拦完之后看得见、扛得住"。防火墙在防御体系里的位置其实有三层：**网络边界**（挡掉不该进来的）、**观测源**（记录谁在敲门）、**限流阀**（让敲门的性价比变低）——只用第一层是残缺的，许多"配了防火墙仍被打穿"的案例，缺口都不在规则表而在日志与限速。

只拦不记的防火墙是"哑巴门禁"：出了事你不知道谁在敲门。nftables/iptables 的 `log` 前缀、ufw 的 logging、firewalld 的拒绝日志，最终都会汇入内核日志再由 journald 收集，查询入口统一是 `journalctl -k`（或带关键字过滤）。开日志要有分寸：`ufw logging high` 会记录每个包的进出，日志本身可能被刷爆磁盘——服务器上 `low` 足够，它记录被拦截的连接而非每一片包。日志等级选错的两种失败模式都真实发生过：`high` 把磁盘写满导致服务崩溃，`off` 则让一次成功的入侵连时间线都还原不出来——**日志是检测层的原料，也是事后取证的唯一底稿**，值得在上线检查单里单独占一行。

```bash
$ sudo ufw logging on
$ sudo firewall-cmd --set-log-denied=all          # firewalld 侧开关
$ journalctl -k --grep "nft-input-dropped" | tail -5
Sep 22 10:14:02 web01 kernel: nft-input-dropped: IN=ens160 SRC=203.0.113.7 ...
```

日志本身必须轮转，否则会吃满磁盘——轮转策略见[基础篇 · 日志系统](../basic/log.md)。防火墙日志更重要的用途是**喂给检测层**：持续的 `Failed`/`dropped` 模式是爆破的直接证据，[入侵检测](./intrusion-detection.md)的 Fail2Ban 正是解析这类日志做自动封禁的。分工很清晰：**防火墙负责拦与记，Fail2Ban 负责根据记录自动拉黑，AIDE 负责发现"文件被改了"**。三层各司其职，任何一层单独存在都有盲区：只有防火墙则对低频爆破反应迟钝，只有 Fail2Ban 则挡不住没写进日志模式的攻击，只有 AIDE 则对"开门请贼"式的端口暴露毫无感知。

限速是另一条廉价防线：nft 的 `limit rate`、iptables 的 `-m limit`、ufw 的 `limit` 关键字，都能让扫描与放大攻击的性价比骤降。对 ICMP、SSH 这类"常被拿来练手"的协议默认加上限，是安全基线的一部分。限速与封禁的差别也值得区分：限速是**持续生效的流量整形**，不会因为误判而永久拒绝正常用户；封禁是**离散的惩罚状态**，需要解封流程兜底。新策略先用限速观察，确认模式清晰后再交给 Fail2Ban 做封禁，是更稳妥的渐进路径。

## 7. 常见坑

规则本身很少"写错"，事故几乎都出在**顺序、持久化、双栈与双层边界**上。下面十条按"发生频率 × 恢复代价"排序，前四条都属于能把人关在门外或让防火墙形同虚设的级别，值得在动手前重读一遍。把它们当 checklist 过一遍再上线，比出事后翻 man page 有效得多。

1. **先 `ufw enable` 后放行 SSH，把自己锁在门外**。铁律：先 `ufw allow 22/tcp` 再 `ufw enable`。纯 SSH 会话里操作前，用 `ufw status` 确认 22 在列表里。这是本篇开篇就强调的顺序问题，也是实际救援工单里最高频的一条。
2. **firewalld 加了 `--permanent` 却忘了 `--reload`**。配置库改了、内存没改，重启后才"莫名生效"。改完规则用 `--list-all` 与 `--list-all --permanent` 对比确认，两者输出不一致就说明只改了一半。
3. **nft/iptables 改了配置忘了持久化**，重启后防火墙"消失"。Arch 记住 `systemctl enable nftables`；裸 iptables 记住各系的持久化工具（5.4）。临时敲进内存的规则只活到下次重启，不能算"配置完成"。
4. **规则顺序颠倒**：把 `policy drop` 或大范围 DROP 写在 ESTABLISHED/业务端口之前，表现为"全部拒绝"或"回包被掐断"。地基三条（lo、established、业务端口）永远在前——这是线性匹配语义决定的，不是习惯问题。
5. **ufw 与裸 iptables 混用**。两套管理源互相覆盖，reload 后规则错乱。一台机器只选一个管理层；排查时若发现 `iptables -L` 的内容与 `ufw status` 对不上，基本可以断定有人绕过了 ufw。
6. **忽略 IPv6**。只配了 iptables/ip6tables 之一，另一半就是敞开的。ufw 默认处理双栈（`/etc/default/ufw` 中 `IPV6=yes`）；nft 用 `table inet` 天然双栈；手动 iptables 时必须同时维护 `ip6tables`。
7. **把 `reject` 当默认动作对外使用**。对外 `drop` 更稳妥：不回应等于端口不存在，`reject` 反而帮攻击者完成探测。内网排障临时用 `reject` 可以，写进基线就不合适了。
8. **服务器上开了 masquerade/转发却不知道**。`forward` 链不是 `drop` 的机器可能已被当跳板。用 `firewall-cmd --list-all` 的 `masquerade: no`、`nft list ruleset` 的 forward policy 自查，纳入月度巡检项。
9. **云安全组与主机防火墙只配了一层**。云环境常见"安全组放开了、主机防火墙也关了"的双重裸奔。两层都要配，且互相矛盾时以更严格者为准——安全组是网络边界，主机防火墙是进程边界，缺谁都留了口子。
10. **规则加了但接口不在预期 zone**。firewalld 下接口绑定错了 zone，规则形同虚设，用 `--get-zone-of-interface` 确认。多网卡机器改网卡名（ens160 变更）后也要回查绑定关系。

排障时建议养成固定的检查顺序，能过滤掉大部分"玄学"：先看云安全组（网络边界），再看主机防火墙状态与默认策略（`ufw status verbose` / `firewall-cmd --list-all` / `nft list ruleset`），再看具体规则与 zone 归属，最后才怀疑应用本身监听错了地址（`ss -tulnp` 里 `127.0.0.1:8080` 和 `0.0.0.0:8080` 是两回事）。**四层各查一遍，比在任何一层反复试探都快**——绝大多数"防火墙不生效"最终发现是查错了层。

十条坑还可以按"谁最先发现"再分一次类：第 1–4 条会在**你自己操作时**立刻或重启后暴露（锁死、reload 忘记、持久化缺失、顺序颠倒），属于流程纪律问题；第 5–8 条要靠**巡检或对账**才会浮出（混用、IPv6、reject、转发），平时完全静默；第 9、10 条则依赖**换人接手或云控制台盘点**——它们藏在另一套管理系统里，主机上 `iptables -L` 看一万遍也看不到安全组里那条 `0.0.0.0/0`。按发现渠道准备检查手段，比按工具分类背命令更贴近真实运维：手动操作配固定操作顺序，静默项配月度巡检，跨系统项配交接检查单。

## 8. 实战：一台公网 Web 服务器的策略清单

前七节按概念与工具展开，本节把它们压成**一台最常见角色（公网 Nginx/Apache 反代或静态站）从零到可审计**的执行序列。清单可以整段抄进上线模板，每步后的回读命令就是该步的验收标准——**没有回读的步骤不算完成**，这是本篇反复出现的纪律在实操里的最终形态。

按安全视角给新服务器过一遍基线（三系殊途同归，命令按各自默认栈选）。清单刻意按执行顺序排列，理由在每步之后：

1. 确认默认策略是拒绝入站：ufw 看 `Default: deny (incoming)`，firewalld 看 `public` zone 只有 `ssh`，nft 看 `policy drop`。**先读现状再动手**，避免在不知情的既有策略上叠加。
2. **先**放行 SSH（有条件就限定来源网段或用 `ufw limit`），**再**启用防火墙。顺序理由见 3.1，这一步是整个清单里唯一可能把自己锁死的。
3. 只放行业务端口 80/443；数据库、Redis 端口只允许内网来源。业务端口用服务名或端口皆可，但来源限定要写清楚——"对全网开放的 3306"比"没开 3306"更危险，因为它看起来已经"配过了"。
4. 开启日志（`ufw logging on` / nft `log` / firewalld log-denied），确认 `journalctl -k` 能看到丢包记录。日志是后面所有检测与排障的数据源，没有它，封禁和复盘都无从谈起。
5. 关闭无关能力：非路由器不要 masquerade，非容器宿主确认 FORWARD 链为 drop。这一步常被跳过，却是"服务器被当跳板"类事故的直接堵点。
6. 与检测层握手：把日志交给 Fail2Ban（见[入侵检测](./intrusion-detection.md)），把防火墙配置纳入 AIDE 监控范围（`/etc/ufw/`、`/etc/nftables.conf`）。配置文件进了完整性检查，被人偷偷 `ufw allow from 0.0.0.0/0` 才有机会在下一次扫描时暴露。
7. 云主机核对安全组/防火墙规则，确保没有历史遗留的 `0.0.0.0/0` 全开条目。云环境的"两层墙"必须同时收口，只配主机层等于把边界让给控制台里那条半年前的临时规则。

七步之间存在依赖顺序，不能为了"快"打乱：第 1、2 步决定你还有没有远程通道，第 4、5 步决定策略是否可观测，第 6、7 步把防火墙从孤立配置变成整体防御的一环。尤其**不要把"开日志"拖到最后**——日志要在策略生效的第一时间打开，否则中间那段试错期的丢包记录就永久缺失了，事后复盘"为什么用户连不上"只能靠猜。

清单跑通之后，把它固化成脚本或 Ansible 片段比每次手敲更可靠：机器会重建，人会忘记细节，只有"能重复执行的清单"才算资产。固化时给每步加一行回读命令（第 1 步后 `ufw status verbose`、第 2 步后 `ufw status numbered | grep 22`），让脚本在任何一步失败时立刻停住——防火墙脚本的半成品状态比不执行更危险，它可能停在"已 enable 但还没放行 SSH"的瞬间。回读结果顺手存进配置仓库，和规则文件放一起，下次审计时 diff 的就是"声明的策略"与"实际生效的策略"是否一致。

跑完这七步，你的机器对全网扫描呈现的将只有"声明过的端口 + 已限速的 SSH"，其余流量安静地消失在 `drop` 里——这正是白名单模型想要的结果。

清单的价值在于**可复核**：换人接手时，新管理员不必理解你的每条命令，只要按这七步回读一次状态，就能知道当前机器是否仍处在你声称的策略下。建议把回读命令（`ufw status verbose` / `firewall-cmd --list-all` / `nft list ruleset`）的输出存档到配置仓库，每次变更后 diff 一次——防火墙配置和代码一样需要版本管理，"最后一次修改是谁、为什么"应该有据可查。

## 参考资料

防火墙是少数"三系文档都要读"的领域：ufw 的权威说明在 Ubuntu/Debian 侧，firewalld 在 Red Hat 侧，nftables 则以 Arch Wiki 与 netfilter 上游文档最成体系。建议的阅读顺序是先用本篇建立策略模型，再按你实际使用的前端深入对应文档——反过来先啃手册，容易陷入参数细节而忘记默认策略是什么。读完本篇再回头对照[网络篇 · 防火墙](../network/firewall.md)的操作速查，会发现同一条命令在两篇里的侧重点不同：那边讲"怎么敲"，这边讲"该不该开、开了谁负责"——两篇配合使用效果最好。三系之外若要继续深挖 netfilter 匹配与 NAT 细节，再进入上游文档与鸟哥的防火墙章节；**带着策略问题去查手册，比按手册顺序通读更能留下可用的记忆**。

- `man ufw`、`man firewall-cmd`、`man nft`、`man iptables`
- Arch Wiki - Ufw — [wiki.archlinux.org](https://wiki.archlinux.org/title/Ufw)
- Arch Wiki - nftables — [wiki.archlinux.org](https://wiki.archlinux.org/title/Nftables)
- Arch Wiki - Iptables — [wiki.archlinux.org](https://wiki.archlinux.org/title/Iptables)
- firewalld 文档 — [firewalld.org](https://firewalld.org/documentation/)
- netfilter 项目与文档 — [netfilter.org](https://www.netfilter.org/documentation/)
- 鸟哥的私房菜 - 系统安全与防火墙 — [linux.vbird.org](https://linux.vbird.org/linux_server/0140tcpip_firewall.php)
- Red Hat - 用 firewalld 配置防火墙 — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_and_managing_networking/assembly_using-firewalld-to-manage-the-firewall_configuring-and-managing-networking)
