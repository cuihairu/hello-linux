# Redis

Redis 是开源的内存数据结构存储，常被同时当作数据库、缓存和消息中间件使用。它存在的理由可以用一组数量级来说明：机械盘随机读大约 10 毫秒，SSD 大约 100 微秒，而内存访问在 100 纳秒量级——同样是一次"按键取值"，内存比机械盘快约五个数量级。电商秒杀计数、网页会话、排行榜这类数据如果每请求都走关系库，磁盘 I/O 会立刻成为瓶颈；把它们放进 Redis，单实例轻松支撑十万级 QPS。但天下没有免费的午餐：内存比磁盘贵、断电即失，于是"哪些数据该进 Redis、数据丢了怎么办、内存满了怎么办"成为使用 Redis 必须先想清楚的三个问题。本页先讲清这些"为什么"，再给出 Debian/Ubuntu（apt）、Arch（pacman）、RHEL/CentOS/Rocky（dnf）三系的安装与配置方法，以及真实终端输出和常见坑。本页按"为什么 → 三系安装 → 连接与基本命令 → 监听绑定与密码 → 持久化 → 内存与淘汰 → 主从哨兵集群 → 监控与慢查询 → 常见坑"展开。

> 内容参考自 Redis 官方文档与 Arch Wiki，见文末参考资料。

## 学习目标

- 理解内存存储的性能来源与代价，明确 Redis 的适用边界
- 掌握三发行版安装（apt / pacman / dnf）、监听绑定与密码设置的正确姿势
- 分清 RDB 与 AOF 的原理、丢失窗口与适用场景
- 掌握常见数据结构的命令与典型业务用法
- 了解主从、哨兵、集群解决的问题，并能排查绑定、密码、内存淘汰类故障

## 1. 为什么是 Redis

### 1.1 内存数据库的取舍

传统关系库把数据放在磁盘上，用 B+ 树组织，换来的好处是容量大、崩溃不丢数据；代价是每次查询都可能触发随机 I/O。Redis 把全部数据集放在内存里，用哈希表等结构直接寻址，一次 `GET` 只需几次内存访问，因此延迟稳定在微秒级。代价同样明确：内存容量远小于磁盘，所以 Redis 需要 `maxmemory` 上限与淘汰策略；进程崩溃或断电会让未持久化的写入消失，所以需要 RDB/AOF。可以把它理解为"用持久化机制给内存数据补一道保险，用淘汰策略给容量上限一个出口"。

### 1.2 数据结构带来的表达力

单纯的键值对（如 Memcached）只能存字符串，业务要实现排行榜、时间线、去重名单，就得在应用层自己拼数据结构。Redis 把常见结构做进服务端，一次往返即可完成原本需要多次数据库交互的逻辑：

| 类型 | 底层要点 | 典型场景 | 代表命令 |
|------|----------|----------|----------|
| String | 简单动态字符串 | 缓存对象、计数器、分布式锁 | `SET` / `GET` / `INCR` |
| Hash | ziplist/listpack 与哈希表转换 | 对象字段级读写，省带宽 | `HSET` / `HGETALL` |
| List | 快速头尾插入的列表 | 消息队列、时间线 | `LPUSH` / `BRPOP` |
| Set | 无序去重集合 | 标签、共同好友 | `SADD` / `SISMEMBER` |
| Sorted Set | 带分值的有序集合 | 排行榜、延时队列 | `ZADD` / `ZREVRANGE` |

判断是否该用 Redis 的标准很简单：数据是否热、是否能容忍丢失、是否需要极低延迟。日志归档、大对象冷数据仍应放磁盘存储，硬塞进 Redis 只会把内存打爆。反过来，也不必神化 Redis——它解决的是"访问速度"和"共享状态"问题，不解决事务一致性与复杂关联查询；该留在 MySQL 里的订单主数据，没有理由搬进内存。三发行版的安装命令会在下一节逐一给出，Arch 读者记住主线即可：官方仓库用 `pacman -S` 安装、`pacman -Syu` 升级，配置与服务管理和另外两系一致。

## 2. 安装（三发行版对照）

三系软件包名并不一致：Debian/Ubuntu 的包叫 `redis-server`，Arch 与 RHEL 系都叫 `redis`；服务单元名也跟着包走，Debian 是 `redis-server.service`，Arch 和 RHEL 是 `redis.service`。下表是安装、查询、升级、卸载的完整对照，右侧一列专门给出 Arch 的 `pacman` 用法：

| 操作 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 安装 | `sudo apt install redis-server` | `sudo pacman -S redis` | `sudo dnf install redis` |
| 搜索 | `apt search redis` | `sudo pacman -Ss redis` | `dnf search redis` |
| 查看包信息 | `apt show redis-server` | `pacman -Qi redis` | `dnf info redis` |
| 查看包文件列表 | `dpkg -L redis-server` | `pacman -Ql redis` | `rpm -ql redis` |
| 升级 | `sudo apt upgrade` | `sudo pacman -Syu` | `sudo dnf upgrade` |
| 卸载 | `sudo apt remove redis-server` | `sudo pacman -R redis` | `sudo dnf remove redis` |

Arch 用户注意：`pacman -S` 安装官方 extra 仓库中的 `redis` 即可，不需要 AUR；日常升级请坚持 `pacman -Syu` 全量滚动升级，**不要**用 `pacman -Sy` 只同步数据库不升级已装软件——那会造成部分升级（partial upgrade）而破坏依赖一致性。若忘记配置文件在哪，先 `pacman -Ql redis` 列出包内全部文件，比到处 `find` 更快。

### 2.1 Debian/Ubuntu

```bash
$ sudo apt update && sudo apt install redis-server
Setting up redis-server (7:7.0.15-1~deb12u5) ...
$ sudo systemctl enable --now redis-server && redis-cli ping
PONG
```

Debian 的服务名是 `redis-server`，配置文件在 `/etc/redis/redis.conf`，数据默认落盘到 `/var/lib/redis`。装完立刻 `redis-cli ping` 得到 `PONG` 是最小验收标准，说明进程已监听且协议正常。

### 2.2 Arch

```bash
$ sudo pacman -Syu redis
resolving dependencies...
Packages (1) redis-7.2.5-1

Total Download Size:   1.20 MiB
:: Proceed with installation? [Y/n] y
(1/1) checking keys in keyring                   [######################] 100%
(1/1) checking package integrity                 [######################] 100%
(1/1) loading package files                      [######################] 100%
(1/1) checking for file conflicts                [######################] 100%
(1/1) checking available disk space              [######################] 100%
:: Processing package changes...
(1/1) installing redis                           [######################] 100%
$ sudo systemctl enable --now redis
$ redis-cli ping
PONG
```

Arch 上包名与服务名都是 `redis`，配置同样是 `/etc/redis/redis.conf`。升级 Redis 属于正常滚动升级的一部分，跟随 `pacman -Syu` 一起走即可；升级后若有不兼容变更，官方会在 `/usr/share/doc/redis/` 或公告中说明，用 `pacman -Ql redis` 可以核对新版本投放了哪些文件。

### 2.3 RHEL/CentOS/Rocky

```bash
$ sudo dnf install redis
 redis  x86_64  7.0.10-1.el9  appstream
Complete!
$ sudo systemctl enable --now redis && redis-cli ping
PONG
```

Fedora 与 Rocky/CentOS Stream 的 `redis` 包位于 AppStream，配置文件 `/etc/redis/redis.conf`，服务 `redis.service`。若同机还装过 Redis 的旧 EPEL 版本，先 `rpm -qi redis` 确认来源仓库，避免两套源混装。

## 3. 连接与基本命令

`redis-cli` 是随包附带的官方命令行客户端。本地无密码连接直接回车即可，远程连接需要显式指定主机、端口与密码。命令不区分大小写，但惯例用大写写命令、小写写键名；交互模式里 `HELP @list` 可以按类别列出该结构的全部子命令，比翻手册快：

```bash
$ redis-cli
127.0.0.1:6379> set greeting hello
OK
127.0.0.1:6379> get greeting
"hello"
127.0.0.1:6379> setex session:abc 3600 '{"uid":1}'
OK
127.0.0.1:6379> incr page:views
(integer) 1
127.0.0.1:6379> exit

# 远程连接（-a 会在进程列表中暴露密码，交互式里用 AUTH 更稳妥）
$ redis-cli -h 192.168.1.100 -p 6379
192.168.1.100:6379> AUTH your_password
OK
192.168.1.100:6379> INFO server | head -3
# Server
redis_version:7.2.5
```

常用结构的最短示例：

```bash
# Hash：字段级更新，适合用户资料
127.0.0.1:6379> hset user:1 name alice age 30
(integer) 2
127.0.0.1:6379> hget user:1 name
"alice"

# List：左进右出即 FIFO 队列；Sorted Set：按分值排名
127.0.0.1:6379> lpush queue job1 job2
(integer) 2
127.0.0.1:6379> zadd rank 100 alice 95 bob
(integer) 2
127.0.0.1:6379> zrevrange rank 0 0
1) "alice"
```

选型时有一个容易踩的细节：String 存整个 JSON 对象最直观，但只想改其中一个字段时必须读出、反序列化、改完再写回，既浪费带宽也容易产生并发覆盖；改用 Hash 后 `HSET user:1 age 31` 只传输增量，这正是"结构选对、网络减半"的由来。

## 4. 监听绑定与密码：先懂再配

### 4.1 bind 与 protected-mode 的配合

Redis 默认只监听回环地址，并开启保护模式（protected-mode）。保护模式的逻辑是：**没有配置 `bind` 到非回环地址、也没有设置密码时，只接受本机连接**；一旦从外部连入，服务端会拒绝并提示处于保护模式。这解释了两个高频现象：在云主机上改了 `bind 0.0.0.0` 却没设密码，外网仍然连不上（被保护模式拦下）；或者容器里忘设密码直接暴露端口，被扫描器秒破后 `FLUSHALL` 清库。

正确的选择只有两种——要么只听回环、让应用与 Redis 同机或经隧道访问，要么绑内网并配齐密码与防火墙：

```ini
# 方案 A（推荐）：只监听本机，应用与 Redis 同机部署
bind 127.0.0.1 -::1

# 方案 B：必须跨机访问时，绑定内网地址 + 必须设密码 + 防火墙限源
bind 192.168.1.100
requirepass 强密码
protected-mode yes
```

切勿图省事设 `bind 0.0.0.0` 且不设密码把 6379 暴露到公网——Redis 协议没有内置传输加密，密码以明文经过网络，公网上等于裸奔。需要跨公网时应走 SSH 隧道、WireGuard 或云厂商内网，防火墙规则参见[防火墙篇](../security/firewall.md)。

### 4.2 密码与危险命令

Redis 6 之前只有一种认证方式 `requirepass`；6.0 起引入 ACL，可以按用户限制密码、键前缀与命令集。单应用单账号的场景用 `requirepass` 足够：

```ini
requirepass 使用长随机密码
# 可选：重命名或禁用高危命令
rename-command FLUSHALL ""
rename-command FLUSHDB ""
rename-command CONFIG ""
```

除了密码，还应在系统层收口：`requirepass` 只防"能连上的人"，不防"能登录这台机器的人"。本机任何有 shell 权限的用户都能 `redis-cli` 连上回环端口，因此 Redis 运行账号不要与业务账号混用，`/etc/redis` 配置目录权限保持 `600`/`root` 属主，日志里也不要打印密码。

注意：`rename-command CONFIG ""` 之后，你自己也将无法用 `redis-cli config get *` 排查问题，禁用前先权衡运维路径。设置或修改密码的推荐流程是写入配置文件后执行 `redis-cli CONFIG SET requirepass ...` 热更新，再落盘，避免改文件不生效导致重启后才"突然"要密码。

## 5. 持久化：内存数据如何扛住重启

### 5.1 为什么必须理解持久化

Redis 数据在内存里，进程一退内存即散。持久化解决"重启后数据还在吗"，但两种机制的丢失窗口和恢复方式完全不同——选错的直接后果是故障演练时发现"最近一分钟的订单没了"。注意持久化保护的是"进程还能拉起"的场景；整机磁盘损毁的兜底仍要靠把 RDB 文件复制到异地，或依赖从节点继续对外服务。

### 5.2 RDB：定时快照

RDB 在满足触发条件时把整个数据集 fork 出子进程写成一个二进制快照文件（默认 `dump.rdb`）。子进程利用 fork 时的写时复制（COW）与主进程共享内存，快照期间只有被修改的页才真正复制，因此对线上延迟影响可控。触发规则形如"多少秒内有多少键被修改就保存一次"：

```ini
# 现代 Redis 默认的三条规则（随版本可能调整）
save 3600 1      # 1 小时内至少 1 个键被修改
save 300 10      # 5 分钟内至少 10 个键被修改
save 60 10000    # 1 分钟内至少 10000 个键被修改
```

规则是"或"的关系，任一满足即触发 `BGSAVE`。写入极稀疏的实例可能很久不快照，重启丢失窗口会远大于预期——这类实例要么手动定期 `BGSAVE`，要么干脆依赖 AOF。

RDB 的优点是文件紧凑、恢复速度快（直接加载整个快照），适合做冷备与全量复制；缺点是两次快照之间的写入全部丢失，丢失窗口等于触发间隔，最坏可达一小时。手动触发用 `redis-cli BGSAVE`（后台）或 `SAVE`（阻塞，仅维护窗口且数据量小时使用）。

### 5.3 AOF：追加写日志

AOF 把每条改数据的命令追加到 `appendonly.aof`，重启时重放日志重建数据。可靠性由 `appendfsync` 决定：

| 策略 | 行为 | 丢失窗口 | 性能 |
|------|------|----------|------|
| `always` | 每条命令 fsync | 几乎不丢 | 最慢 |
| `everysec`（默认） | 每秒 fsync 一次 | 最多约 1 秒 | 推荐 |
| `no` | 交给内核刷盘 | 取决于系统 | 最快 |

```ini
appendonly yes
appendfilename "appendonly.aof"
appendfsync everysec
```

启用 AOF 后，恢复顺序是先读 AOF；若同时保留 RDB 且开了混合持久化，RDB 快照会作为重放起点，大幅缩短启动时间。运维上还要给 AOF 所在磁盘留足空间——日志只增不删，忘了配自动重写就会把分区写满。

AOF 文件会随时间膨胀（包含大量中间状态），Redis 通过"重写"（rewrite）把当前数据集重新压缩成最短命令集。`BGREWRITEAOF` 手动触发；自动重写由 `auto-aof-rewrite-percentage` 与 `auto-aof-rewrite-min-size` 控制。旧版 AOF 在崩溃后恢复需要重放全部命令，大文件恢复慢——Redis 4.0 的混合持久化正是为此：重写时先写入 RDB 格式的全量数据、再追加增量 AOF 命令，兼顾恢复速度与丢失窗口：

```ini
aof-use-rdb-preamble yes    # 现代版本默认开启
```

### 5.4 怎么选

只当缓存、丢几小时无所谓（如页面热点数据）：可以只开 RDB，甚至依赖主从兜底。存会话、购物车、计数等"丢一秒很难受"的数据：开 AOF `everysec`。既要快又要稳：RDB + AOF 双开并启用混合持久化，这也是当前默认建议。判断是否真的持久化成功，重启后 `redis-cli LASTSAVE` 返回值应变化，或 `redis-cli INFO persistence` 里 `rdb_last_bgsave_status:ok` / `aof_last_write_status:ok`。还要区分"持久化成功"与"数据不丢"：`everysec` 依然允许约一秒丢失，真正要求零丢失只能 `always` 并接受吞吐下降——先和业务确认能接受的窗口，再动配置，而不是反过来。

## 6. 内存上限与淘汰策略

不设 `maxmemory` 的 Redis 会一直吃到把宿主机内存耗尽、触发 OOM killer 为止——宿主机上往往还有 MySQL 和应用，被杀的可能不只是 Redis。因此生产环境**必须**显式设置：

```ini
maxmemory 256mb
maxmemory-policy allkeys-lru
```

策略选择取决于数据角色：`noeviction`（默认）是内存满后拒绝写入并报错，适合把 Redis 当真数据库、宁可写失败也不丢数据的场景；`allkeys-lru` 在所有键里按最近最少使用淘汰，是缓存的标准答案；`volatile-lru` 只淘汰设了过期时间的键；`allkeys-random` 随机淘汰，仅适合访问完全均匀的场景；`volatile-ttl` 淘汰最先过期的键。给缓存键统一设置 `EXPIRE`/`SETEX` 过期时间还有一个附带好处：即使误配成 `volatile-*` 策略，也有明确的淘汰候选，而不是无键可驱逐。最常见的事故是"当缓存用却忘了改策略"：内存一满，所有写入开始返回错误，表现为接口大面积 `OOM command not allowed`。

查看当前内存占用与驱逐情况：

```bash
$ redis-cli INFO memory | grep -E 'used_memory_human|maxmemory_human|evicted_keys'
used_memory_human:12.48M
maxmemory_human:256.00M
evicted_keys:0
```

`maxmemory` 也不必拍脑袋：先观察 `used_memory_human` 在业务高峰的水位，再预留约 20%～30% 给 fork 期间的写时复制开销——快照生成瞬间子进程会短暂多占内存，贴着上限配置容易在 `BGSAVE` 时触发内存告警。

`evicted_keys` 持续增长说明容量偏小或热数据比例低，应先加内存再考虑其他优化。小对象过多时，Hash/List/Set 的紧凑编码阈值（`hash-max-listpack-entries` 等，旧称 ziplist）也值得按实际对象大小调整，但改之前先用 `OBJECT ENCODING` 确认当前编码，不确定就不动。另外别忘了给大键瘦身：一个 String 键塞进几十 MB 的 JSON，会让每次淘汰、复制、快照都变重，`redis-cli --bigkeys` 扫描是上线前的例行体检。

## 7. 主从、哨兵与集群

单实例的两个单点问题是"挂了没人顶"和"容量到顶"。主从复制解决前者的一半：从节点执行 `replicaof 主IP 6379` 即可全量同步 + 增量复制，主挂了可以手动切，但人工切换有中断。哨兵（Sentinel）把切换自动化：奇数个哨兵进程监控主节点，多数派确认故障后自动提升从节点并改写客户端配置，典型三哨兵 + 一主两从。为什么必须奇数个？因为判定故障要多数派同意，两个哨兵在一边宕机后无法形成多数，宁可不切也不脑裂。配置骨架：

```ini
# /etc/redis/sentinel.conf
sentinel monitor mymaster 192.168.1.100 6379 2    # 2 = 需要 2 个哨兵同意才判定故障
sentinel auth-pass mymaster 主密码
sentinel down-after-milliseconds mymaster 5000
sentinel failover-timeout mymaster 60000
```

容量横向扩展则用集群（Cluster）：16384 个哈希槽分布在多个主节点上，数据按 `CRC16(key) % 16384` 落槽，每个槽可有从节点。最小生产规模是三主三从——槽虽多，但"能否容忍一节点挂掉"由主节点数量的多数派决定，两个主节点挂一个就失去多数，所以至少三个。建集群的典型输出：

```bash
# 每个节点：port 7000、cluster-enabled yes、cluster-config-file nodes.conf
$ redis-cli --cluster create 127.0.0.1:7000 127.0.0.1:7001 127.0.0.1:7002 \
    127.0.0.1:7003 127.0.0.1:7004 127.0.0.1:7005 --cluster-replicas 1
>>>[OK] All 16384 slots covered.
```

客户端连接集群必须使用集群模式（如 `redis-cli -c` 或应用侧 cluster 模式），否则跨槽 `MGET` 会收到 `MOVED` 重定向错误。哨兵与集群都要求客户端改造：哨兵模式要从 Sentinel 获取当前主地址，集群模式要按槽路由——上生产前先在测试环境把客户端连法跑通，比上线后再补课便宜得多。

## 8. 监控与慢查询

`INFO` 是最常用的自检入口：`redis-cli INFO clients` 看连接数，`INFO replication` 看主从状态（`role:master` / `role:slave`、`master_link_status:up`），`INFO stats` 看命中率与拒绝连接数。缓存场景重点盯 `keyspace_hits` 与 `keyspace_misses` 计算命中率，长期低于 90% 通常意味着键设计过散或 TTL 过短。慢查询由慢日志单独记录，阈值单位是微秒：

```bash
$ redis-cli SLOWLOG GET 2
1) 1) (integer) 42  2) (integer) 1726800000  3) (integer) 15231
   4) 1) "LRANGE"  2) "biglist"  3) "0"  4) "-1"
```

阈值用 `slowlog-log-slower-than 10000`（10ms）与 `slowlog-max-len 128` 控制。`LRANGE key 0 -1` 拉取百万级列表这类命令即使 O(N) 也会拖垮事件循环，应改为分页 `LRANGE` 或拆分数据结构。慢日志只记录超过阈值的命令，不等于全量审计；要长期观测延迟趋势，应把 `INFO` 指标接入 Prometheus——与之对接可用 `redis_exporter` 暴露指标，接入方法见[监控篇](monitoring/prometheus.md)。

## 9. 常见坑

**改了 redis.conf 不生效。** 配置文件只有启动时读取；热改用 `redis-cli CONFIG SET ...`，或改文件后 `systemctl restart redis-server`（Debian）/ `systemctl restart redis`（Arch、RHEL）。确认实际加载的是哪份配置：`redis-cli INFO server | grep config_file`——容器或手工编译场景常出现"改了 /etc 下的文件，进程却读着 /usr/local/etc 的旧配置"。

**服务起来了但外网连不上。** 依次检查三点：`ss -tlnp | grep 6379` 看监听地址是否只有 `127.0.0.1`；protected-mode 是否在无密码时拦截了外部连接；云安全组/防火墙是否放行 6379。绑定与密码的完整逻辑见第 4 节；本机自测用 `redis-cli -h 127.0.0.1 ping` 与 `redis-cli -h 本机内网IP ping` 对比，能区分"没监听"与"被防火墙拦"。

**连接报 `NOAUTH Authentication required` 或 `ERR Client sent AUTH, but no password is set`。** 前者是服务端设了密码而客户端没带密码；后者相反——常见于从旧无密码配置升级后客户端仍写死 `-a` 参数。以 `CONFIG GET requirepass` 的返回为准对齐两端。

**内存写满后接口报错。** 见第 6 节：要么设小了 `maxmemory`，要么策略仍是 `noeviction` 却当缓存在用。应急时 `redis-cli CONFIG SET maxmemory-policy allkeys-lru` 可立刻放行写入，但别忘了同步改进配置文件，否则下次重启又回到老问题。

**`MISCONF Redis is configured to save RDB snapshots...`。** 这是 Redis 主动自保：最近的 RDB/AOF 写盘失败（磁盘满、权限、只读文件系统）时拒绝继续写入以免持久化与内存状态脱节。先 `df -h` 查磁盘，再看 `redis-cli INFO persistence` 的错误计数。

**Arch 升级后行为异常。** 先 `pacman -Qi redis` 确认版本，再对照官方公告；想搜同名相关包用 `pacman -Ss redis`。不要用 `pacman -Sy` 加装旧版本"回退"，正确做法是等上游修包或从缓存重装：`pacman -S redis`。删除配置再安装用 `pacman -Rs`，彻底清配置才用 `-Rns`；不确定包提供哪些文件时，`pacman -Ql redis` 仍是第一选择。

**fork 报警与大内存实例。** RDB/AOF 重写都会 fork，`vm.overcommit_memory` 必须为 1，否则 fork 可能直接失败。这属于内核参数，与用 apt、pacman 还是 dnf 装的 Redis 无关，三系都要检查：

```bash
$ sysctl vm.overcommit_memory
vm.overcommit_memory = 1
```

## 参考资料

- Redis 官方文档 — [redis.io/docs](https://redis.io/docs/)
- Redis 持久化说明 — [redis.io/docs/latest/operate/oss_and_stack/management/persistence/](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- Redis 配置索引 — [redis.io/docs/latest/operate/oss_and_stack/management/config/](https://redis.io/docs/latest/operate/oss_and_stack/management/config/)
- Arch Wiki: Redis — [wiki.archlinux.org/title/Redis](https://wiki.archlinux.org/title/Redis)
- 鸟哥的私房菜 - Redis 应用 — [linux.vbird.org](https://linux.vbird.org/linux_server/redis.php)
