# 网络工具

排障最怕的不是命令多，而是**不知道此刻该用哪一个**：`ping` 通了 `curl` 却超时，你可能会反复重试 ping；DNS 换了好几个 `nameserver` 还是解析失败，问题可能出在 `/etc/hosts` 的优先级。本页把这些工具按**场景**摆开——先回答"什么时候用哪个"，再给每个工具的关键用法、真实输出与判断线索。命令级语法细节以 `man` 为准，本页只收录实战里真正会敲的那些。

> 与前一页的分工：[网络管理命令](./network.md) 管"本机状态"（接口、路由、端口、配置入口、DNS 路径），本页管"主动探测与传输"（ping/trace/DNS 查询/HTTP/远程复制/抓包）。防火墙规则见[网络篇 · 防火墙](../../network/firewall.md)。除特别标注外，`ping`、`dig`、`curl`、`ssh`、`rsync`、`tcpdump` 在 **Debian/Ubuntu、Arch、RHEL/CentOS/Rocky** 上通用；`traceroute` 与 `nmap` 三系默认都不一定装，首次用前先装包。

## 学习目标

- 建立"问题分层 → 对应工具"的决策习惯，不盲目重试同一条命令
- 用 `ping`/`mtr`/`traceroute` 区分"不通在哪一段"
- 用 `dig`/`host`/`resolvectl` 区分"解析失败在哪一步"
- 用 `curl -w` 拆解连接、TTFB、总耗时，定位"慢"发生在哪层
- 用 `tcpdump` 快速抓一眼端口有没有流量、TCP 有没有握手成功
- 用 `nmcli` 在 NetworkManager 机器上查/改连接（RHEL 8+、Arch 桌面、部分 Ubuntu）

## 1. 什么时候用哪个：场景决策表

排障的固定顺序是：**链路 → 路径 → DNS → 应用端口 → 应用逻辑**。每一层都有对应工具，跳层重试只会浪费时间。

| 现象/问题 | 第一反应 | 为什么是它 | 进一步 |
|-----------|----------|------------|--------|
| "网络好像不通" | `ping -c 4 网关` | 先确认本机到第一跳活着 | 失败查 `ip addr`、`ip route` |
| "目标整体不通" | `ping -c 4 目标IP` | 用 IP 排除 DNS 干扰 | 通则查 DNS，不通进下一层 |
| "不知道断在哪" | `mtr -rw 目标IP` | 一发输出路径+丢包+延迟 | 无 mtr 用 `traceroute -n` |
| "域名解析失败/结果不对" | `dig 目标域名` | 直接问指定解析器，绕过应用缓存 | 见第 3 节判断链路 |
| "curl 慢/超时" | `curl -o /dev/null -sw ...` | 把 DNS/连接/TTFB/总时长分开 | 对比 IP 直连与域名访问 |
| "端口通没通" | `timeout 3 bash -c '</dev/tcp/主机/端口'` 或 `nc -zv` | TCP 握手层面测试 | 通了但 HTTP 错再查应用 |
| "连接建立了但数据怪" | `tcpdump -ni 网卡 port 端口` | 抓包看真实报文方向与标志位 | 对照服务端日志 |
| "要改 Wi-Fi/网卡连接"（NM 环境） | `nmcli device status` | NetworkManager 是 RHEL8+/Arch 桌面入口 | `nmcli connection up` |
| "批量传文件/增量同步" | `rsync -avz --dry-run` | 先看会传什么，避免覆盖事故 | 见第 6 节 |
| "测网速/文件下载" | `curl -o /dev/null URL` | 只要吞吐不要文件 | 大文件分段用 `-C -` 续传 |

一个容易搞反的例子：`ping 通、curl 不通`。ping 走 ICMP，curl 走 TCP 80/443——通前者只证明三层可达，不证明四层端口放行或服务在监听。此时应该 `ss -tlnp` 看监听、防火墙页查放行、`tcpdump` 看 SYN 有没有回 SYN-ACK。

还有一个和"该用哪个"同样重要的问题：**该在什么机器上用**。本机排障直接敲命令即可；要确认"是不是只有我这边坏"，应在另一台机器（最好另一网段/云区域）对同一目标再跑一遍——两台都失败才指向目标或中间路径，只有一台失败则回本机查路由、DNS、代理（`curl` 会走 `http_proxy` 环境变量，`ping` 不会，这也是"浏览器能开、curl 却怪"的常见根源）。把"换一台、换一个工具、换一层"当成三个正交开关，比在同一台机器上反复重试同一命令有效得多。

## 2. 路径与延迟：ping / traceroute / mtr

### 2.1 ping —— 回答"通不通、稳不稳"

```bash
$ ping -c 4 192.168.5.11
PING 192.168.5.11 (192.168.5.11) 56(84) bytes of data.
64 bytes from 192.168.5.11: icmp_seq=1 ttl=64 time=0.467 ms
64 bytes from 192.168.5.11: icmp_seq=2 ttl=64 time=0.443 ms
64 bytes from 192.168.5.11: icmp_seq=3 ttl=64 time=0.486 ms
64 bytes from 192.168.5.11: icmp_seq=4 ttl=64 time=0.455 ms

--- 192.168.5.11 ping statistics ---
4 packets transmitted, 4 received, 0% packet loss, time 3005ms
rtt min/avg/max/mdev = 0.443/0.462/0.486/0.024 ms
```

读四个数：`ttl=64` 经常见但不代表只有 64 跳（对端会重写）；`time` 是往返延迟，同网段应在 1ms 内，跨洋可能 150–300ms；`packet loss` 非零但 `time` 正常，优先怀疑中间丢包或限速 ICMP；`mdev`（抖动）大说明链路质量不稳，即使平均延迟好看。**先 `ping -c 4 网关`，再 `ping -c 4 1.1.1.1`（或 `223.5.5.5`），最后才 ping 域名**——三步把"本机/出口/域名"拆开。

公网测试时 ICMP 可能被运营商或云安全组丢弃，`Request timeout` 不一定等于业务不通：改用 `curl` 或 `nc` 测真实业务端口。Linux 的 `ping` 默认持续发，Ctrl-C 结束；Windows 风格的 `-n` 不存在，用 `-c`。三系都由 `iputils` 提供（RHEL 最小化可能要 `sudo dnf install iputils`）。

多网卡机器上还要多问一句：**ping 从哪张网卡出去了**。`ping -I ens18 目标` 或先看 `ip route get 目标`，否则默认路由绑在管理网上，你测的却是另一条链路的健康度，结论会张冠李戴。容器内 ping 若显示 TTL 很低或完全不通，先确认是否有 NET_ADMIN/网络命名空间限制，不要直接怪宿主机。

### 2.2 traceroute —— 回答"断在哪一跳"

traceroute 的输出形态固定：第一行给目标解析结果与跳数上限，之后每行一跳、附三次采样毫秒数。`-n` 禁止反解主机名，排障必加——反解本身可能卡住或返回误导性名字。某一跳连续 `* * *` 只说明**该设备不回 ICMP 超时**，不代表后面不通；要看最后一跳是否到达目标。**某一跳之后全部超时，且目标也不通**，断点就在这附近，把该 IP 交给运营商或云工单。三系包名：Debian/Ubuntu `traceroute`，Arch `pacman -S traceroute`，RHEL `dnf install traceroute`。

traceroute 与 mtr 的原理差异也值得知道一点：traceroute 用递增 TTL 触发中间设备回"超时报文"，mtr 则是持续采样做统计。因此单次 traceroute 的某一跳延迟会抖，要判断"是不是某段慢"，优先信 mtr 的 Avg/Best/Wrst，而不是一次 traceroute 里最大的那个数字。UDP 模式（Linux 默认）在防火墙只放 ICMP 时可能全星号，换 `traceroute -I`（ICMP）或 `traceroute -T`（TCP 80）往往能通——**换协议重试不是作弊，是在探测过滤策略**。

### 2.3 mtr —— ping 与 traceroute 合体

mtr 报告模式的表头是 HOST 加一列统计（Loss%、Snt、Last、Avg、Best、Wrst、StDev），每跳一行。`-r` 报告模式（跑完退出，适合脚本），`-c` 指定轮数。**中间某跳 `Loss%` 高但其后各跳正常**，通常是该跳对 ICMP 限速，可忽略；**从某跳开始 Loss 持续 100% 且后续恢复不了**，断点在此。公网出口常见第 2–3 跳丢包而最终通达，别误判为故障。Arch 安装：`sudo pacman -S mtr`；RHEL：`sudo dnf install mtr`。

`StDev`（标准差）和 `Wrst` 往往比 `Avg` 更有诊断价值：Avg 只有 20ms 但 Wrst 到 400ms，说明路径上有队列抖动或间歇性拥塞，视频会议/数据库长连接会先感知，HTTP 短连接却可能"看起来正常"。对比基线时要在**相同时段、相同目标、相同 `-c` 轮数**下跑，否则跨晚高峰的数据没有可比性。输出存档成文本（重定向即可）纳入变更前后对比，比截图更方便 grep。

## 3. DNS 查询：dig / host / nslookup / resolvectl

解析问题要拆成三步：**本地 hosts 有没有抢先？解析器配置对不对？上游答得对不对？** `dig` 默认读 `/etc/resolv.conf`，所以它通而应用不通时，问题在 `nsswitch`/`hosts` 或应用缓存；它也不通，再查解析器与上游。

完整 `dig` 输出里真正要盯的只有四处：`HEADER` 的 `status`（`NOERROR`/`NXDOMAIN`/`SERVFAIL`）、`flags` 里有没有 `ra`（递归可用）、`ANSWER SECTION` 的记录与 TTL、末尾的 `SERVER` 与 `Query time`。示例里 `status: NOERROR`、一条 A 记录、`SERVER: 127.0.0.53#53` 说明**问的是本机 stub**，不是直接问上游；`Query time: 12 msec` 突然变成秒级，优先怀疑上游 RTT 或超时重试，而不是本地 CPU。

关键三行的判读可以再压一遍：`status: NOERROR` 表示权威应答（`NXDOMAIN` 才是域名不存在）；`ANSWER SECTION` 的 A 记录是结果；`SERVER` 显示 127.0.0.53 就意味着后面若要区分 stub 与上游，必须再 `dig @上游` 打一枪对照。

```bash
dig @223.5.5.5 example.com A +short          # 直接问公共 DNS，+short 只要答案
dig example.com AAAA                         # IPv6 记录
dig example.com MX +noall +answer            # 邮件交换记录
dig example.com NS                           # 权威 NS
dig +trace example.com                       # 从根开始逐级追踪
dig -x 198.18.0.47                           # PTR 反解
```

`+short` 在脚本里最常用；`+trace` 输出很长，只在怀疑"我问到的不是权威结果"时用。`host` 是 dig 的精简版（`host example.com`），`nslookup` 是老工具，交互模式下不读 `/etc/hosts`，**排查本地 hosts 覆盖时不要用它当依据**——`getent ahosts 域名` 或 `ping 域名` 才反映应用真实路径。

还有一个分层实验值得养成习惯：同一域名依次 `getent` → `dig`（默认走 stub）→ `dig @8.8.8.8`（直连上游）。三者结果不一致时，差异本身就指明了故障层——`getent` 差而 dig 正常，问题在 nsswitch/hosts；默认 dig 差而 `@上游` 正常，问题在本机 stub 或网卡 DNS 下发；连 `@上游` 都差，问题在出网 UDP/TCP 53 或上游本身。`dig` 的 `status` 只描述 DNS 协议层，`NOERROR` 但 `ANSWER: 0` 是"域名存在但没有该记录"（如只有 AAAA 没有 A），和 `NXDOMAIN`（名字不存在）不是一回事，脚本判断时别混用。

systemd-resolved 环境下还有状态查询（与[网络管理命令](./network.md)第 5 节同源）：

```bash
$ resolvectl query example.com
example.com: 198.18.0.47 -- link: ens18
-- Information acquired via protocol DNS in 2.9ms.

$ resolvectl flush-caches      # 改上游后清缓存
```

典型误判：改了 `/etc/resolv.conf` 就 `dig` 新服务器——若该文件是指向 `127.0.0.53` 的 stub 链接，你改的字段可能被 resolved 忽略或覆盖。用 `ls -l /etc/resolv.conf` 先看链接，再用 `dig @服务器` 显式指定来验证上游本身是否正常。

## 4. HTTP 与传输：curl / wget

`curl` 是排障主力，`wget` 更偏"下载文件"。判断"网站慢在哪"必须拆阶段，而不是只看总时间：

```bash
$ curl -o /dev/null -sw 'DNS:%{time_namelookup}s TCP:%{time_connect}s TLS:%{time_appconnect}s TTFB:%{time_starttransfer}s 总:%{time_total}s HTTP:%{http_code}\n' https://www.qq.com/
DNS:0.011193s TCP:0.014423s TLS:0.077196s TTFB:0.099884s 总:0.099915s HTTP:200
```

- `time_namelookup` 大 → DNS 问题，回到第 3 节
- `time_connect`（TCP）大 → 三次握手慢，查路由/丢包/端口被墙
- `time_appconnect`（TLS）大 → 证书链或加密协商问题
- `time_starttransfer`（TTFB）大 → 服务器应用慢，不是网络层
- `http_code` 4xx/5xx → 网络通，应用拒绝或报错，看服务日志

把域名换成裸 IP 再跑一遍 `-w`，能立刻区分 DNS 与网络：IP 直连快而域名慢，问题 100% 在解析；两者一样慢，问题在路径或对端。HTTP 码语义也要能口算：`301/302` 是跳转（`curl -L` 才跟），`403` 是权限/网关策略，`502/504` 是上游应用或超时——**504 更像应用太慢，502 更像上游进程挂了**，别一律当"网络抖动"重试。脚本里同时固定 `--max-time` 与检查 `http_code`，避免把 404 当成功、把挂死当慢。

常用一条龙的要点可以用一句话串起来：要头不要体用 `-I`（HEAD），要过程用 `-v`（看 SNI/证书/HTTP 版本），要落盘用 `-sSL -o`，要防挂死必须 `--max-time`，要测虚拟主机用 `-H 'Host: ...'`，要发布切换用 `--resolve` 把域名钉到指定 IP，要模拟接口用 `-X`/`-d`/`-H` 组出正确的 method、body 与头。脚本里检查退出码与 `http_code`，不要只看 curl 是否打印了内容。

`-v` 的输出里若 TLS 失败，先看证书链是否完整、系统时间是否正确（时间错会导致"证书还没生效/已过期"假故障）。`wget` 等价用法：`wget -O file URL`、`wget -c` 断点续传；两者都默认不校验证书以外的业务语义，脚本里请检查退出码。

wget 与 curl 的分工可以再明确一点：curl 是**探测器**（HEAD、自定义头、分段计时、模拟客户端），wget 是**搬运工**（递归 `-r`、限速、断点、镜像站点）。要"测网站好不好"用 curl，要"把一棵目录树拉下来"用 wget 更省事。两人都尊重代理环境变量，也都会在 3xx 时表现不同（curl 默认不跟跳转，wget 默认跟）——把这条写进脚本注释，能省掉无数次"为什么和浏览器不一样"的争论。

HTTPS 相关还有两个必会参数：`-k`/`--insecure` 跳过证书校验**只许用于内网临时探测**，进生产脚本等于关掉中间人防护；`--cacert 指定CA.pem` 在自签环境中更正确。`curl -I` 若返回 `HTTP/1.1 405`，先确认对端是否只实现 GET——HEAD 不被支持不等于站点坏了。HTTP/2 下握手耗时统计仍体现在 `time_appconnect`，若 TTFB 远大于 TLS 完成时间，瓶颈已在应用侧，继续调超时参数没有意义。

## 5. 远程与抓包：ssh / scp / rsync / tcpdump

远程操作与抓包之所以放在同节，是因为它们共享一个前提：**你已经知道该连谁、该看哪块网卡**。前面几节解决"网络通不通"，这一节解决"通了之后怎么安全地动机器、怎么留下证据"。ssh 会话本身也是最常用的"带外观测通道"——机器 HTTP 挂了但 SSH 还在，优先用 ssh 进去跑 `ss`/`journalctl`，比在客户端反复 curl 有用得多。

### 5.1 ssh —— 会话与端口转发

`ssh` 的常用形态可以收成三组：连接组是端口 `-p`、身份 `-i`、跳板 `-J`；转发组是本地 `-L`（把远端回环服务拉到本机端口）；调试组是先 `nc`/`</dev/tcp` 测 22 端口、再看服务端 `ss -tlnp | grep :22`、最后才怀疑密钥与密码。`-L 8080:127.0.0.1:80` 是访问"只在远端回环监听的服务"的标准姿势（例如远端 `127.0.0.1:3306`）。

`-J bastion`（ProxyJump）适合"公网只能到跳板机、业务机在内网"的拓扑，比旧式 `-o ProxyCommand="ssh -W %h:%p bastion"` 更短也更少配错。首次连接务必人工核对指纹（或用 `known_hosts` 预置），脚本里的 `StrictHostKeyChecking=no` 只应出现在一次性、可抛弃的 CI 容器里。认证失败与连接超时是两类问题：前者能看到 SSH banner 和协商日志，后者连 banner 都没有——**先分清"连不上"还是"不让登录"**，再去翻 `authorized_keys` 权限或密码策略；服务端日志（`sshd` journal）永远比客户端空转更接近真相。

### 5.2 scp 与 rsync —— 什么时候用哪个

`scp` 适合**一次性、单文件、路径简单**；`rsync` 适合**目录、增量、断点、带宽控制、删除同步**。生产同步优先 rsync，因为它支持 `--dry-run` 预览：

```bash
scp report.txt user@host:/tmp/
scp -r project/ user@host:/backup/

rsync -avz --dry-run project/ user@host:/backup/project/   # 只演练不传输
rsync -avz --delete project/ user@host:/backup/project/     # 真删远端多余文件（危险，先 dry-run）
rsync -avz --progress -e "ssh -p 2222" large/ user@host:/data/
```

`-a` 保留权限/时间/软链，`-v` 详细，`-z` 传输压缩。**`--delete` 必须在 `--dry-run` 确认过清单后再去掉**；源尾斜杠（`a/` 与 `a`）语义不同，会决定是同步目录本身还是其内容。三系均用 `rsync` 包，systemd 环境还可能见到 `rsync.service` 守护模式。

选型可以再记两条经验：小文件成千上万时，rsync 的增量与元数据保留几乎总优于 scp/scp -r；单个几 GB 的冷备、只要"推过去完事"，scp 甚至 `curl -T` 也够用。走非 22 端口时，rsync 用 `-e "ssh -p 2222"` 而不是把端口塞进目标路径。大目录首次同步先 `--dry-run | tail` 看路径拼接是否符合预期（尤其 `/path/` vs `/path`），确认后再去掉 dry-run；带 `--delete` 的定时任务，日志里保留 dry-run 的对照输出，出事时能快速回答"删了什么"。

带宽紧张时再加 `--bwlimit=5000`（单位 KB/s），或用 `ionice`/`nice` 降低抓盘优先级；源在机械盘、目标在云盘的场景，第一次全量往往受源端随机读限制，**别把吞吐低直接归罪于网络**——先 `rsync --progress` 看是不是在原地读大量小文件。涉及符号链接与权限时，`-a` 已展开为 `-rlptgoD`，一般不要自行拆掉 `-p`/`-g`/`-o`，否则备份到新机器后属主权限全乱。

### 5.3 tcpdump —— 看一眼真实报文

抓包是"证据"，在防火墙规则、服务日志互相矛盾时一锤定音。最常用的三个动作：抓某端口、只看握手、存成文件给 Wireshark。

```bash
sudo tcpdump -ni ens18 port 80 and host 192.168.5.125 -c 20
sudo tcpdump -ni ens18 'tcp[tcpflags] & tcp-syn != 0' -c 10     # 只看 SYN（含 SYN-ACK/RST）
sudo tcpdump -ni ens18 port 443 -w /tmp/https.pcap              # 落盘，离线分析
```

`-n` 不反解、`-i` 指定网卡（不写会抓所有接口，生产机很吵）。输出解读：`Flags [S]` 是 SYN、`Flags [S.]` 是 SYN-ACK、`Flags [R.]` 是 RST——**只看到发出的 SYN、没有 SYN-ACK 返回**，说明路径或对端没接；**SYN-ACK 有但应用报连接被拒**，查服务是否监听及 `ss -tlnp`。抓不到任何包时，先确认接口对（`ip -br link`）、再确认过滤条件写对（`port` 不要带 `tcp.` 之类错误前缀）。安装：三系包名都是 `tcpdump`，未预装时 `apt install tcpdump` / `pacman -S tcpdump` / `dnf install tcpdump`。

抓包前先明确要回答的**唯一问题**（谁先发、有没有 RST、TLS 有没有完成），再设计过滤条件；否则全接口裸抓既吵又容易在合规上出问题。云主机/共享网络里抓到别人的流量只看自己关心的五元组即可，不要外传 pcap。若本机抓不到、但应用明显有连接，检查是不是走了代理或 `nsenter` 进了别的网络命名空间——**看不到包不等于没流量，可能是你抓错了 netns**。

## 6. NetworkManager：nmcli 场景速查

**只在 NetworkManager 管理网络的机器上使用**——RHEL/CentOS/Rocky 8+、Fedora、Arch 桌面、部分 Ubuntu（装了 `network-manager` 的桌面版）默认如此；用 `nmcli general status` 无响应或 `nmcli` 报错时，说明系统走的是 systemd-networkd/ifupdown，改用[网络管理命令](./network.md)第 4 节的入口，不要硬写 NM 配置文件。

`connection` 是**配置文件**，`device` 是**硬件设备**——"连接已保存但没生效"往往是 `connection up` 没执行，或设备处于 `unmanaged`（`nmcli device set eth0 managed yes` 可恢复）。改完 DNS 后 `resolvectl flush-caches`，否则解析层还留着旧缓存。这些操作会写入 `/etc/NetworkManager/system-connections/`（keyfile，权限 600），重启后仍生效——这正是它与临时 `ip addr add` 的区别。

nmcli 的常用句型可以收成五类：查状态 `general status`/`device status`/`connection show`，无线 `device wifi list`，激活停用 `connection up|down 名称`，改配置 `connection modify 名称 字段 值`，重下发生效 `device reapply 网卡`。现场使用时，`nmcli device status` 一行就能给出设备名、类型、`connected`/`disconnected`/`unmanaged` 三态；桌面"连不上 Wi-Fi"十有八九在这里显示 `disconnected` 而用户以为已连。脚本化改配置前先 `nmcli -t -f NAME connection show` 拿连接名（`-t` 简洁模式适合解析），再 `connection modify`——**别用中文/空格的显示名硬编码**，新建连接时用 `nmcli con add ... con-name wired1` 起个稳定的 ASCII 名。改完用 `nmcli -t -f GENERAL.STATE device show eth0` 确认 `100`（connected），比看 NetworkManager 图标可靠。

什么时候该放弃 nmcli、回到声明式文件？需要把网络配置纳入 Git、做无人值守批量部署时，keyfile（`.nmconnection`）比一串 `nmcli modify` 更易审阅；需要在无 NM 的服务器上保持最小依赖时，直接用 networkd/Netplan。**nmcli 的优势是交互与状态一体，不是唯一真理**——选型标准仍是前一页第 4 节那张总表：先确认这台机器归谁管，再决定改哪里。RHEL 8 以后 `network-scripts` 已退场，老文档里的 `ifup ifcfg-eth0` 不要再抄进新项目。

## 7. 常见坑

1. **ping 通就以为端口通**。ICMP 与 TCP 是两条路；用 `nc -zv host port`、`curl` 或 `</dev/tcp` 验证目标端口。
2. **traceroute 中间全是 `*` 就判死刑**。只要最后一跳到达目标，中间星号只是设备不回 ICMP。
3. **用 nslookup 验证 /etc/hosts**。nslookup 不走 `files`，结果与业务不一致；用 `getent ahosts` 或直接 `ping 域名`。
4. **dig 显示 127.0.0.53 就以为配置没生效**。systemd-resolved 的 stub 就是本机入口，真正上游看 `resolvectl dns`。
5. **curl 超时不设 `--max-time`**。交互时靠人 Ctrl-C，脚本里会永久挂起，必须 `--max-time`。
6. **rsync 直接上 `--delete`**。先 `--dry-run` 看清单，确认源尾斜杠，再删。
7. **tcpdump 不加 `-i`/`-n`**。全接口抓包又反解主机名，输出慢且难读；生产上明确 `-ni 网卡` 并加 `host`/`port` 过滤。
8. **在 networkd/Netplan 机器上跑 nmcli 改配置**。`nmcli` 只对 NetworkManager 有效，改错入口=白改。先 `netplan status` 或 `systemctl is-active NetworkManager` 判断。
9. **traceroute/nmap/mtr 以为三系都预装**。默认往往没有：`apt install traceroute`、`sudo pacman -S traceroute`、`dnf install traceroute`；`nmap` 同理（且属扫描工具，只对授权目标使用）。
10. **把 mtr 中间跳高丢包当故障**。以"后续跳是否恢复、目标是否可达"为准。
11. **只在一端测就下结论**。对称问题要两端互测（A→B 与 B→A，或加一台 C），单边数据无法区分"我方出口坏"与"对方入口坏"。
12. **忽略代理环境变量**。`curl`/`wget` 尊重 `http_proxy`/`https_proxy`，`ping`/`nc`/`tcpdump` 不走代理——"curl 超时但 ping 正常"时，先 `env | grep -i proxy` 再谈网络。

## 8. 工具组合的实战推演

单独会用每个命令只是及格，能按场景把它们串起来才是排障的分水岭。下面四个推演不给新的语法，只示范**判断顺序**——请对照第 1 节的决策表一起读，遇到类似工单时按同样顺序走。

**场景一：用户反馈"站点打不开"，但公司另一台机器正常。** 先在用户机器 `ping -c 3 目标IP` 排除整体断网；再 `dig 目标域名` 对比两台机器的解析结果，若 A 记录不同，查 `/etc/resolv.conf`、`hosts` 与代理；若解析一致，用 `curl -o /dev/null -sw ...` 看卡在 DNS、TCP 还是 TLS；最后 `nc -zv 目标 443` 与 `ss -ant` 确认是连不上还是连上后应用报错。全程不要超过五条命令，每条只推翻或确认一个假设——**换一条命令换一个假设，而不是把 curl 加 -v 重试二十遍**。

**场景二：服务间偶发超时，日志没有明确错误。** 这类问题的答案几乎总在"抖动"而不是"不通"。对可疑链路跑 `mtr -rw -c 50` 看 StDev/Wrst；同时在两端 `tcpdump` 抓握手与 RST，看超时瞬间是 SYN 无应答还是应用拖着不回；若中间有代理或网关，用 `curl` 分段耗时区分是网关慢还是后端慢。单次 ping 通会带来虚假安全感，**必须用足够轮数的统计工具看尾部延迟**，否则你会在午夜前宣布"网络正常"。

**场景三：变更后部分客户端无法解析域名。** 先确认是"全部客户端"还是"部分网络区域"——部分则优先怀疑分区域下发的 DNS/防火墙 53 策略，而不是权威服务器；在故障客户端 `dig @已知好的上游 域名`，好则本机解析链路坏，坏则出网 53 或上游坏；再看 `resolvectl dns` 是否下发了你预期的 nameserver，以及 `hosts:` 有没有被人加了通配劫持。修复后用 `dig +short` 与业务 `getent` 双验收，避免只修了命令行、没修应用进程仍在用的旧缓存。

**场景四：半夜收到磁盘 IO 高、网络也告警。** 先别当成两件孤立的事：大文件写盘与网络同步可能互相放大。用 `ss -s` 看连接是否暴涨，`tcpdump -c` 采样是否仍在大量传输，`curl` 或应用侧指标判断是谁在拉数据；若是备份任务，回到 rsync 的 `--bwlimit` 与计划时间。**工具的价值在于把"网络抖"和"盘在叫"拆成可分别修复的两个信号**，而不是让两个告警一起闪烁到天亮。

这四个场景背后的共同骨架是：**从粗到细、从本机到全网、从确定性命令到统计性命令**。ping/mtr/nc/dig 是确定性的探测点，curl -w 与 tcpdump 是分层证据，mtr 统计与日志趋势是尾巴上的抖动。只要每次只推进一层，工具列表再长也不会乱。

## 参考资料

- `man ping`, `man traceroute`, `man mtr`, `man dig`, `man curl`, `man rsync`, `man tcpdump`, `man nmcli`
- [鸟哥的私房菜 - 网络除错工具与指令示例](https://linux.vbird.org/linux_server/0110network_basic.php#tool_ifconfig)
- [Arch Wiki - Network debugging](https://wiki.archlinux.org/title/Network_debugging)
- [Arch Wiki - NetworkManager (nmcli)](https://wiki.archlinux.org/title/NetworkManager)
- [dig 手册（ISC BIND）](https://bind9.readthedocs.io/en/latest/manpages.html)
- [curl 手册 - 字典变量（-w）](https://curl.se/docs/manpage.html)
- [tcpdump 手册](https://www.tcpdump.org/manpages/tcpdump.1.html)
- [Red Hat - Using tcpdump to capture network traffic](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/monitoring_and_managing_system_status_and_performance/monitoring-network-activity-using-tcpdump_monitoring-and-managing-system-status-and-performance)
