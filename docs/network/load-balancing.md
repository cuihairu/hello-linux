# 负载均衡

单台服务器的容量总有上限，
而业务的可用性要求
却往往高于任何单机承诺。
负载均衡解决的正是这对矛盾：
**把请求分散到多台后端，
并在某台故障时自动摘除**。
它不是"配个 upstream 就完事"的小技巧，
而是涉及 L4/L7 分层选型、算法语义、
健康检查与高可用 VIP 的完整体系。

本页先讲清分层与选型
（这决定了 80% 的架构选择），
再给出 Nginx、HAProxy、LVS
的可落地配置与排障思路。

> 内容参考自 Nginx、HAProxy、IPVS
> 官方文档与实际运维经验，
> 见文末参考资料。

## 学习目标

- 分清 L4 与 L7 负载均衡的差异，
  能按业务特征选型 Nginx 或 HAProxy
- 理解轮询、加权、最少连接、
  一致性哈希等算法的适用与陷阱
- 配置健康检查、会话保持与故障转移，
  理解 Keepalived VIP 的角色
- 识别常见配置坑
  （开源版无主动健康检查、超时链、
  会话粘性失效）

## 1. 为什么需要负载均衡

负载均衡同时承担四个职责，
缺一个都会在故障时暴露。

**水平扩展**。
流量增长时加机器即可，
应用层无需感知。
扩容从"改代码"变成"改权重"，
这是组织层面的巨大变化——
容量决策不再需要研发排期。

**故障摘除**。
某台后端挂掉，
负载均衡器把它移出转发池，
用户几乎无感——
这是"高可用"的真正落点。
没有摘除机制的"多台部署"
只是把故障概率乘以机器数，
用户看到的错误反而更多。

**统一入口**。
SSL 卸载、限流、灰度、日志
都收敛在入口一层实现，
不必每个后端重复配置。
证书轮换从"改 N 台"变成"改一处"，
运维动作的数量级差异
会在第一次证书过期时体现。

**流量塑形**。
按权重、地域、路径
把不同请求导向不同资源池
（如静态资源走 CDN 节点、
动态请求走计算池）。
这让"同一个域名下的不同流量"
第一次可以被分别治理。

没有负载均衡时，
任何一台机器的磁盘写满
都是全站事故；
有了它，
单机故障从"故障"降级为"容量略降"。
当然，代价是入口本身成了新单点——
这就是第 6 节 Keepalived 存在的理由。

## 2. L4 与 L7：先分层再选型

### 2.1 两层的本质差异

**L4（传输层）** 负载均衡
只看 IP 和端口，
把 TCP/UDP 连接原样转发给后端，
不解析应用层内容。
代表实现是 LVS（IPVS）、
HAProxy 的 `mode tcp`、
云厂商的四层监听器。

**L7（应用层）** 负载均衡
会解析 HTTP 请求
（Host、路径、Header、Cookie），
按应用语义分发，
可以做基于 URL 的路由、
SSL 卸载、WAF、改写请求头。
代表是 Nginx、HAProxy 的
`mode http`、各类 API 网关。

对后端而言差异很关键：
L4 模式下后端看到的源 IP
是真实客户端
（或经 SNAT 后的地址），
连接是端到端的；
L7 模式下后端收到的是
负载均衡器发起的新连接，
必须靠 `X-Forwarded-For` 等头
还原真实客户端 IP——
少了这个头，
后端日志与风控看到的
全是负载均衡器的地址。

另一个差异是**故障语义**：
L4 的连接建立失败对客户端可见
（连不上就是连不上），
L7 可以在连接已建立的前提下
把某个后端的失败转成 502/504，
甚至改写成自定义错误页。
后者给了你优雅降级的空间，
前者则把选择权交给了客户端重试逻辑。
设计错误页与重试策略时，
必须先知道自己站在哪一层。

### 2.2 选型矩阵

| 需求 | 推荐 | 理由 |
|------|------|------|
| 纯 HTTP/Web 应用，要按域名/路径分流 | **Nginx** | L7 能力成熟、配置直观、生态丰富 |
| 需要精细 TCP 代理 + 强健康检查 + 统计页 | **HAProxy** | L4/L7 双模，主动健康检查与 stats 页面是强项 |
| 数据库等长连接、非 HTTP 协议 | **HAProxy (tcp) 或 LVS** | 不解析应用层，转发效率高 |
| 超高并发、四层转发、万级 RPS 以上 | **LVS (IPVS)** | 内核态转发，开销极低 |
| 与硬件防火墙/传统网络设备联动 | LVS / 云 SLB | 内核/基础设施层方案更贴近网络 |
| 单一入口做 SSL 卸载 + 统一限流 | Nginx 或 HAProxy | L7 终结 TLS，减轻后端压力 |

**经验法则**：
中小规模 HTTP 业务
从 Nginx 起步最省力；
一旦需要主动健康检查、
TCP 混合代理、细粒度会话保持，
迁到 HAProxy
或在其前加一层 HAProxy；
单层 Nginx 在十万级并发以上
会先于后端耗尽 CPU，
此时把 L4 交给 LVS/云 SLB，
Nginx 只做 L7。

需要明确的是，
**开源 Nginx 没有真正的主动健康检查**——
它靠被动方式
（连接失败、超时）
在下一次转发时摘除故障后端，
期间的请求会失败一次；
主动探测式健康检查
是 Nginx Plus 的商业特性。
HAProxy 开源版则完整支持 `check`。
这个差异经常导致
"Nginx 摘除太慢"的投诉，
选型时务必计入。

还有一类常见组合值得记住：
**HAProxy 做 L4/健康检查，
Nginx 做 L7 路由与缓存**。
两层各司其职，
配置都保持简单，
代价是多一跳转发。
架构没有免费午餐，
关键是让每一层的职责单一到
出问题时不用翻两份配置。

### 2.3 转发算法

算法决定请求如何落到后端，
各有边界：

| 算法 | 行为 | 适用 | 陷阱 |
|------|------|------|------|
| 轮询 round-robin | 依次分发 | 后端同构、无状态服务 | 会话被切到不同后端 |
| 加权轮询 | 按权重比例 | 服务器性能不均 | 权重靠静态配置，感知不到实时负载 |
| 最少连接 least-conn | 给连接数最少的后端 | 长连接、耗时差异大的请求 | 短时间热点仍可能倾斜 |
| IP/源地址哈希 | 同 IP 落同一后端 | 需要会话保持且无共享会话存储 | NAT 后大量用户同 IP，严重倾斜 |
| 一致性哈希 | 哈希环，后端变动只影响局部 | 缓存亲和场景 | 后端摘除会引发局部击穿 |
| 随机 | 简单随机 | 超大规模、避免同步震荡 | 短窗口内可能不均 |

**会话保持的正确姿势**
是优先让应用把会话放到外部存储
（Redis/数据库），
负载均衡只做无状态分发；
只有在无法改造应用时
才退而求其次用 IP Hash 或 Cookie 粘性——
后者在用户更换网络
（Wi-Fi 到 4G）时会丢会话，
且哈希倾斜难以调和。
Nginx 开源版的 `sticky`
指令是 Plus 特性，
开源环境请用 `ip_hash`，
或在应用层解决。

算法选择还有一个容易忽略的前提：
**先确认后端是否真的同构**。
新旧版本混跑、
机器配置差三倍、
某台机器磁盘已老——
这些都会让"公平分发"
变成"把流量往最弱的机器上引"。
上线新算法前先看
每后端的连接分布统计，
比读十遍文档更能发现问题。

## 3. Nginx 负载均衡

### 3.1 基础配置

```nginx
upstream backend {
    # 轮询（默认）
    server 192.168.1.101:8080;
    server 192.168.1.102:8080;
    server 192.168.1.103:8080 weight=3;

    # 会话保持（开源版可用 ip_hash；sticky 为 Plus 特性）
    # ip_hash;
    # least_conn;
}

server {
    listen 80;
    server_name app.example.com;

    location / {
        proxy_pass http://backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`proxy_set_header` 三件套几乎必须出现：
不传 `X-Forwarded-For`，
后端日志里的客户端 IP
会全部变成负载均衡器地址；
不传 `Host`，
按域名分站的后端
会收到错误的虚拟主机；
不传 `X-Forwarded-Proto`，
应用生成的 https 链接可能变成 http，
表现为"页面混合内容报警"。

`backup` 与 `down` 两个修饰词也常用：
`backup` 让该后端平时不接流量、
仅当主池全挂时启用，
适合冷备过渡；
`down` 则是人工摘除，
用于计划内维护，
比改防火墙干净得多。

### 3.2 被动健康检查与超时

```nginx
upstream backend {
    server 192.168.1.101:8080 max_fails=3 fail_timeout=30s;
    server 192.168.1.102:8080 max_fails=3 fail_timeout=30s;
    server 192.168.1.103:8080 backup;
}
```

`max_fails=3 fail_timeout=30s`
表示 30 秒内失败 3 次
则标记为不可用，
30 秒后重新尝试——
这是**被动**判定：
期间仍可能有请求被转过去并失败。
若业务对可用性极敏感，
应配合外部主动探测
（监控系统 `curl` 健康检查接口）
或换 HAProxy。

三个超时要理顺，
否则会出现"后端明明没挂却 502"：

```nginx
proxy_connect_timeout 5s;
proxy_send_timeout    60s;
proxy_read_timeout    60s;
```

`proxy_read_timeout`
小于业务最长耗时
是 502/504 的头号原因——
监控看到后端 RT 正常、
网关却报 504，
优先核对这三个值。
调超时前先拿到业务 P99，
把网关超时设在
P99 加安全余量的位置，
而不是无限放大——
过大的超时会把故障后端的连接
长时间占住，拖累整个池子。

### 3.3 SSL 卸载

```nginx
server {
    listen 443 ssl http2;
    server_name app.example.com;
    ssl_certificate     /etc/nginx/ssl/app.pem;
    ssl_certificate_key /etc/nginx/ssl/app.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / { proxy_pass http://backend; }
}
```

在入口终结 TLS 后，
后端到负载均衡器之间
可走明文 HTTP（内网信任域内），
既省后端 CPU 又统一证书管理。
若两者之间跨不可信网络，
用 `proxy_pass https://`
或 HAProxy `mode tcp`
继续加密——
**"内网"不是信任的免检通道**，
跨机房、跨可用区的"内网"
都应重新评估是否加密。

证书管理还有两个实务细节：
ACM/Let's Encrypt 自动续期后
必须 reload 才生效；
灰度时先在一台入口机验证新证书，
再铺开到全部入口——
证书配错导致的全站不可用，
比后端故障恢复起来更麻烦。

## 4. HAProxy

### 4.1 安装

三发行版均有打包，
Arch 用 `pacman -S haproxy`，
Debian/Ubuntu 用 `apt install haproxy`，
RHEL/CentOS/Rocky 用
`dnf install haproxy`。

### 4.2 配置结构

HAProxy 配置由
`global`、`defaults`、
`frontend`、`backend` 四段构成，
职责比 Nginx 的混合式配置更清晰：

```bash
# /etc/haproxy/haproxy.cfg
global
    daemon
    maxconn 256

defaults
    mode http
    timeout connect 5s
    timeout client  50s
    timeout server  50s
    option httplog

frontend http-in
    bind *:80
    default_backend servers

backend servers
    balance roundrobin
    option httpchk GET /health
    server web1 192.168.1.101:8080 check inter 2s rise 2 fall 3
    server web2 192.168.1.102:8080 check inter 2s rise 2 fall 3
```

`check inter 2s rise 2 fall 3`
的语义是：
每 2 秒探测一次，
连续 2 次成功标记为 UP、
连续 3 次失败标记为 DOWN。
相比 Nginx 的被动模式，
**主动探测能在用户请求到达之前
就完成摘除**，
显著降低失败率——
这是 HAProxy 在严格 SLA 场景中的核心优势。

健康检查路径的设计本身是技术活：
`GET /health` 返回 200
不代表业务可用——
如果它不检查数据库，
数据库挂掉时检查依然绿灯。
把关键依赖纳入检查、
或提供分级健康端点
（`/health/ready` 查依赖、
`/health/live` 只查进程），
才能让摘除真正反映业务状态。
检查过重则会反噬：
每秒探测 50 个接口 × 3 条路径，
本身就是可观的负载。

数据库等非 HTTP 流量
只需把 `mode` 换成 `tcp`，
并用 `option mysql-check`
（或通用 `option tcp-check`）
做探测：

```bash
frontend mysql-in
    bind *:3306
    mode tcp
    default_backend mysql-servers

backend mysql-servers
    mode tcp
    balance roundrobin
    option mysql-check user haproxy
    server db1 192.168.1.101:3306 check
    server db2 192.168.1.102:3306 check backup
```

`backup` 标记
让该后端平时不接流量，
仅当所有主后端都 DOWN 时启用——
常用于"冷备升主"的过渡形态。
读写分离场景则要配合
应用侧或 proxy 层的
读写路由，
单靠 `balance` 无法区分语句类型。

### 4.3 统计与运维

```bash
# stats listen（defaults 或 frontend 中）
stats enable
stats uri /stats
stats realm HAProxy\ Statistics
stats auth admin:StrongPass

# 运维动作
sudo systemctl start haproxy
sudo systemctl reload haproxy        # 平滑重载，不断连接
curl -s http://localhost/stats | head
```

`reload` 与 `restart`
的区别必须牢记：
reload 会派生新进程、
让旧进程处理完存量连接后退出，
连接不中断；
restart 直接杀进程，
正在传输的请求会全部失败。
**任何配置变更都用 reload**，
并在变更前后各看一次 stats 页面
确认后端状态符合预期。

stats 页面是排查"流量去哪了"
的第一入口：
每后端的当前连接数、
队列长度、
错误计数一目了然。
若某后端连接数长期为 0，
先看它的 `check` 状态，
再看权重与 `backup` 标记——
九成的"流量不均"都能在这一页解释，
不必立刻怀疑算法实现。

stats 端点本身也要保护：
绑定内网地址、
设强口令、
或直接用防火墙圈死来源——
它暴露了完整的拓扑与流量信息，
不该出现在公网。

## 5. LVS：内核态四层转发

LVS（Linux Virtual Server）
通过内核模块 IPVS 实现，
工作在 `INPUT` 链之后的转发路径上，
没有用户态代理进程的开销，
适合做最前面的四层入口。
三种转发模式：

- **NAT**：进出流量都经负载均衡器改写地址，
  实现简单但它是带宽瓶颈。
- **DR（直接路由）**：
  只改写目标 MAC，
  响应由后端直接回给客户端，
  性能最高，
  但要求负载均衡器与后端在同一广播域。
- **TUN（IP 隧道）**：
  后端封装隧道回包，
  可跨网段部署，配置最复杂。

```bash
# 安装管理工具（Arch: pacman -S ipvsadm）
sudo apt install ipvsadm        # Debian/Ubuntu
sudo dnf install ipvsadm        # RHEL/CentOS/Rocky

# 添加虚拟服务：轮询
sudo ipvsadm -A -t 192.168.1.100:80 -s rr
sudo ipvsadm -a -t 192.168.1.100:80 -r 192.168.1.101:8080 -m
sudo ipvsadm -a -t 192.168.1.100:80 -r 192.168.1.102:8080 -m

# 查看规则与统计
sudo ipvsadm -Ln
sudo ipvsadm -Ln --stats
```

`-s rr` 是调度算法
（还支持 `lc` 最少连接、
`sh` 源地址哈希、
`wlc` 加权最少连接等），
`-m` 表示 NAT 模式
（`-g` DR、`-i` TUN）。
IPVS 规则本身不带应用层健康检查，
生产上常与 Keepalived 的
`check` 脚本或控制器配合使用；
云环境则直接用托管 SLB
省掉这层自建复杂度。

选 LVS 前先算一笔账：
它带来的性能收益
在万级 RPS 以下往往不明显，
而排障复杂度立刻上升——
规则在内核里、
健康检查在用户态、
VIP 漂移在网络层，
三个平面要分别取证。
**够用就好，
不要为了"看起来专业"上 LVS**。
确实到了单机 Nginx 瓶颈时，
它才是正确的答案。

## 6. 高可用：Keepalived 与 VIP

负载均衡器自身是单点，
用 Keepalived 的 VRRP 协议
把一个**虚拟 IP（VIP）**
在两台节点间漂移：
主节点活着时持有 VIP，
故障时备节点接管，
客户端只感知 IP 未变：

```bash
# /etc/keepalived/keepalived.conf（主节点示例）
vrrp_script chk_haproxy {
    script "/usr/bin/killall -0 haproxy"
    interval 2
    weight 2
}

vrrp_instance VI_1 {
    state MASTER
    interface eth0
    virtual_router_id 51
    priority 101
    advert_int 1

    virtual_ipaddress {
        192.168.1.100/24
    }

    track_script {
        chk_haproxy
    }
}
```

`track_script`
让 VIP 漂移不只看 Keepalived 自身，
还看 HAProxy 进程是否存活——
否则会出现
"HAPoxy 挂了但 VIP 还在"的假高可用。
备节点配置相同但
`state BACKUP`、`priority` 更小，
`virtual_router_id`
必须一致（属于同一 VRRP 组）。

常见陷阱：
**VRRP 组播被交换机过滤**
导致主备无法感知彼此、
脑裂后两个 VIP 并存引发 ARP 冲突；
以及 VIP 绑在错误网卡
（多网卡机器上 `interface` 写错）。
切换是否生效，
用 `ip addr show`
看 VIP 落在哪台机器、
并在另一台 `arping`
验证 ARP 是否更新。

心跳链路的设计值得多想一层：
主备之间若只有一条网络互联，
那条链路闪断就会触发无谓切换。
有条件时把 VRRP 走独立的心跳口，
或至少降低 `priority`
对链路抖动的敏感度。
切换演练也别省——
没演过 failover 的高可用配置，
本质上只是"装了 Keepalived"。

## 7. 实战：Web 应用的完整入口

把前面的元素组合成
一个可上线的最小形态：

```nginx
upstream web_app {
    least_conn;
    server 192.168.1.101:8080 weight=3 max_fails=3 fail_timeout=30s;
    server 192.168.1.102:8080 weight=2 max_fails=3 fail_timeout=30s;
    server 192.168.1.103:8080 weight=1 backup;
}

server {
    listen 443 ssl http2;
    server_name app.example.com;
    ssl_certificate     /etc/nginx/ssl/app.pem;
    ssl_certificate_key /etc/nginx/ssl/app.key;

    location /healthz {
        proxy_pass http://web_app/health;
        access_log off;
    }

    location / {
        proxy_pass http://web_app;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout    60s;
    }
}
```

部署顺序有讲究：
**先在测试环境 `sudo nginx -t` 校验语法——
输出 `syntax is ok`、`test is successful`
后再 `sudo systemctl reload nginx`；
先确认健康检查路径可达，
再把后端纳入池**。
反过来（先加后端再配检查）
会导致一段窗口期
把流量打到半就绪的实例上。

上线后立刻做三件事：
看 access log 里
`upstream_response_time` 是否正常；
看每后端连接分布是否符合权重；
模拟一台后端宕机，
确认摘除与恢复的行为
与 `max_fails` 预期一致。
**第一次故障发生之前
就把摘除路径验证过**，
否则真正的故障来临时，
你是在拿生产环境做实验。

## 8. 监控与调优

负载均衡器是观察业务健康的最佳位置，
核心指标与含义：

| 指标 | 来源 | 关注点 |
|------|------|--------|
| 每后端连接数 | stats / `ss` | 是否长期倾斜（算法或权重问题） |
| 5xx 率 | Nginx access log / HAProxy stats | 上游故障的直接信号 |
| 首字节时间 TTFB | `$upstream_response_time` | 区分网关慢与后端慢 |
| 健康检查失败次数 | HAProxy stats / 监控 | 单后端故障 vs 整池故障 |
| 吞吐与带宽 | [网络监控](./network-monitoring.md) | 扩容决策依据 |

调优遵循"先测量后调整"：
`maxconn` 不是越大越好——
超过文件描述符上限会直接拒绝连接；
`timeout` 链要与业务真实耗时分布匹配
（P99 之上留余量）；
缓冲区与 `proxy_buffering`
影响内存占用和慢客户端场景。
所有调优应配合 `nginx -T`
导出配置、版本化管理，
并保留回滚版本。

接入 Prometheus 时，
nginx-exporter/haproxy-exporter
可以把上述 stats 变成指标，
告警规则建议至少覆盖：
持续的连接错误、
任一后端 `check` 状态为 DOWN
超过 2 分钟、
整体 5xx 比例突增。
详见[网络监控](./network-monitoring.md)。

还有一个容易漏掉的指标是**队列**：
HAProxy 的 ` backlog`/`qcur`
非零意味着请求在排队，
后端处理能力不足或健康检查误判
都会导致它升高。
5xx 还没涨、队列先涨，
是容量问题的早期信号——
比等用户投诉早得多。

## 9. 常见坑

- **以为 Nginx 开源版会主动探活**。
  它只做被动摘除，
  故障后端在判定窗口内
  仍会接到请求；
  需要主动检查请用 HAProxy 或 Nginx Plus。
- **`proxy_read_timeout`
  小于业务耗时**，
  稳定复现 504。
  先对照业务 P99 再改超时，不要盲调。
- **忘记传 `X-Forwarded-For`**，
  后端安全策略、限流、审计
  全部基于错误的客户端 IP 工作。
- **IP Hash 与用户公网 IP 变化**。
  移动网络、NAT 共享出口
  会导致会话在后端间漂移；
  能改应用就改应用，
  别指望哈希解决一切。
- **reload 用成 restart**。
  配置变更瞬间切断存量连接，
  用户表现为"发布就抖动"。
- **权重与实际容量脱节**。
  新机器上线忘了调权重，
  或旧机器降配没调回，
  导致热点长期倾斜——
  用 stats 页的每后端请求分布
  定期复核。
- **VIP 漂移后 ARP 未收敛**。
  Keepalived 切换瞬间
  部分客户端仍持有旧 MAC，
  表现为切换后几十秒内偶发不通；
  可缩短 `advert_int`
  并确保交换机允许 VRRP 组播。
- **健康检查路径与真实业务路径不一致**。
  `/health` 返回 200
  但真实接口依赖的下游已挂，
  负载均衡层完全无感知——
  健康检查应至少探测一个关键依赖。
- **入口没有限流**。
  单个异常客户端就能打满连接表；
  L7 层的 `limit_req`
  或 HAProxy 的 `stick-table`
  rate-limit 是廉价的保险。

## 10. 参考资料

- Nginx 负载均衡文档：
  <https://nginx.org/en/docs/http/load_balancing.html>
- Nginx reverse proxy 参数：
  <https://nginx.org/en/docs/http/ngx_http_proxy_module.html>
- HAProxy 官方文档与 Configuration Manual：
  <https://www.haproxy.org/#ref>
- Arch Wiki - HAProxy：
  <https://wiki.archlinux.org/title/HAProxy>
- LVS 项目与文档：<https://www.linuxvirtualserver.org/>
- Keepalived 官方文档：
  <https://keepalived.org/documentation.html>
- `man haproxy`、`man ipvsadm`、
  `man nginx`、`man 8 keepalived`
