# 网络监控

单次 `ping` 只能告诉你"此刻通不通"，
而运维真正关心的是
"昨天通不通、平均丢包多少、
流量峰值出现在几点"。
**监控把瞬时观测变成时间序列**，
让"最近变慢了"这种模糊抱怨
变成可查证的曲线与告警。

本页覆盖两类互补的监控手段：
以 SNMP 为代表的传统设备监控，
和以 Prometheus + node_exporter
为代表的云原生主机监控，
并给出从指标到告警的完整路径。

> 内容参考自 Prometheus、node_exporter、
> Net-SNMP 官方文档与实际运维经验，
> 见文末参考资料。

## 学习目标

- 理解主动探测（active probing）
  与代理采集（agent/exporter）
  两种监控模型的取舍
- 掌握 SNMP 的基本工作方式与适用场景，
  会用 `snmpwalk`/`snmpget` 取一次数据
- 部署 Prometheus + node_exporter
  并写出第一个网络相关告警规则
- 会用 `vnstat`、`iftop`、`iperf3`
  完成带宽与延迟的本地分析
- 认识监控落地的高频坑
  （防火墙拦 exporter、指标基数爆炸、
  告警疲劳）

## 1. 为什么需要持续监控

监控的价值不在"看见图表"，
而在于回答三类
只能靠历史数据回答的问题。

**基线是什么**。
没有平时的流量曲线，
就无法判断今天的尖峰是异常还是常态。
基线还决定告警阈值——
拍脑袋设的 80% 往往半夜误报，
或在真正打满时沉默。

**趋势往哪走**。
端口流量每周稳定增长 5%，
比某一天突然的尖峰
更早预示扩容需求。
趋势也是预算沟通的语言：
"按当前斜率，Q3 会打满"
比"感觉最近有点满"有力得多。

**故障影响面多大**。
丢包从 0% 升到 0.1%
用户可能无感，升到 5% 就会投诉；
监控数据是定级与复盘的依据。
没有历史曲线，
复盘只能停留在"当时很忙"。

监控系统通常由三部分组成：
**采集**（exporter/agent/snmp poller
读取数据）、
**存储**（时序数据库按时间保存样本）、
**告警**（规则引擎对样本求值并通知）。
下面两节分别对应两种主流采集模型，
选型差异决定了后续所有运维动作。

## 2. 两种监控模型

### 2.1 主动探测：把监控端当"探针"

最简单的监控是监控端
周期性地 `ping`/`traceroute` 目标，
不依赖目标机器配合。
优点是零侵入、
适合探测网络路径与第三方服务；
缺点是只能看到
"从监控点出发"的视角，
拿不到目标机内部的 CPU、连接数等指标。

blackbox_exporter、`mtr` 巡检、
拨测系统都属此类，
适合回答
"链路通不通、证书何时过期、
HTTP 是否 200"。
它还有一个被低估的用途：
**模拟真实用户路径**——
从办公网、机房、公网
三个位置同时探测同一域名，
能立刻区分
"是目标挂了"还是"是某条路径挂了"。

主动探测的代价是覆盖面有限：
探测频率越高，成本越高，
而你永远无法探测到
"没写进探测列表"的故障。
因此它通常与下面的代理采集互补，
而不是替代。

### 2.2 代理采集：exporter / SNMP agent

要拿到机器内部指标，
必须在目标侧跑一个"翻译器"，
把内核数据转成监控系统能读的格式。
Prometheus 生态用 **exporter**，
传统网管生态用 **SNMP agent**。
两者解决同一问题，
只是协议与时代不同：

| 维度 | SNMP（传统） | Prometheus + node_exporter（现代） |
|------|-------------|----------------------------------|
| 协议 | UDP 161/162，ASN.1 BER 编码 | HTTP /metrics，纯文本 |
| 拉/推 | 监控端主动 get（拉），也可 trap（推） | 监控端主动 scrape（拉） |
| 典型对象 | 网络设备、打印机、遗留系统 | Linux/Windows 主机、云实例 |
| 配置中心化 | MIB + community/ACL，设备侧要配 ACL | 部署 exporter 即可，指标自动暴露 |
| 现状 | 存量网络设备仍是主流 | 新建 Linux 服务的默认选择 |

**结论先行**：
监控交换机、路由器、UPS、存储阵列等
**专有设备**，用 SNMP——
它们没有 exporter 可装；
监控**你自己的 Linux 服务器**，
优先 node_exporter——
指标更丰富、
与告警/大盘生态天然集成。
两者常常并存于同一套系统中，
由 Grafana 同时对接即可。

选型时还有一个现实因素：
**团队既有技能**。
已经熟练 Zabbix + SNMP 模板的团队
强行迁移 Prometheus，
学习成本往往超过收益；
而从零起步的云原生团队
再引入 Zabbix，
又会背上双套告警的维护负担。
监控系统切换的隐性成本
（告警规则重写、大盘重建、
值班习惯改变）
远高于软件本身，
没有明确痛点时不建议换。

## 3. SNMP：网络设备监控

### 3.1 概念：MIB、OID 与 community

SNMP 通过 **OID**
（对象标识符，一串点分数字，
如 `1.3.6.1.2.1.1.5.0` 表示 sysName）
读取设备状态，
OID 的语义定义在 **MIB**
（管理信息库）里。
v2c 使用明文 `community` 字符串作为口令
（默认 `public`/`private`），
**v3 加入了认证与加密**，
生产环境应优先 v3——
沿用默认 community
等同于把设备管理口挂在公网上。

在 Linux 上装好 agent 后，
即使监控的是本机，
也可以先用它练手理解协议
（三发行版包名一致，
Arch 用 `pacman -S net-snmp`，
Debian/Ubuntu 用
`apt install snmp snmpd`，
RHEL 系用
`dnf install net-snmp net-snmp-utils`）：

```bash
# 查询系统名（sysName.0 = 1.3.6.1.2.1.1.5.0）
$ snmpget -v2c -c public localhost 1.3.6.1.2.1.1.5.0
SNMPv2-MIB::sysName.0 = STRING: web01

# 列出系统描述
$ snmpwalk -v2c -c public localhost 1.3.6.1.2.1.1.1.0
SNMPv2-MIB::sysDescr.0 = STRING: Linux web01 5.15.0-91-generic ...
```

`snmpwalk`
从某个 OID 开始遍历子树，
是探索未知设备能力的常用手段；
`snmpget` 取单个值，
适合写进脚本定期采集。

给 SNMP 做基线监控时，
最常抓的三类数据是：
接口进出流量
（`ifInOctets`/`ifOutOctets`，
32 位计数器约 4G 翻转，
推荐用 64 位的
`ifHCInOctets`/`ifHCOutOctets`）、
接口错误/丢弃计数、
设备 CPU/温度（厂商私有 OID）。
32 位计数器溢出问题
在千兆以上链路几秒就会发生，
采集端必须按"两次采样差值 + 溢出回绕"
计算速率，
否则会周期性出现负值或尖刺——
这是 SNMP 流量监控最经典的坑。

### 3.2 在 Linux 上启用 snmpd

最小可用配置是
放开只读 community 并限制来源：

```bash
$ sudo apt install snmpd   # Arch: pacman -S snmp；RHEL: dnf install net-snmp
$ sudo systemctl enable --now snmpd
$ snmpget -v2c -c public 127.0.0.1 sysUpTime.0
SNMPv2-MIB::sysUpTime.0 = Timeticks: (123456) 0:20:34.56
```

常见坑是
**127.0.0.1 之外访问失败**：
发行版默认把 agent 绑在回环
或用 `snmpd.conf` 的
`agentaddress` 限制来源，
监控服务器远程采集会被静默丢弃。
解决办法是显式监听内网地址
并放行防火墙 UDP 161
（见[防火墙](./firewall.md)）：

```bash
# /etc/snmp/snmpd.conf 片段
agentaddress 127.0.0.1,192.168.1.100:161
rocommunity public 192.168.1.0/24
```

改完 `systemctl restart snmpd`，
再从监控端 `snmpget` 验证一次，
不要只相信 `systemctl status`
显示的 active——
**服务活着与端口可达是两件事**，
这是监控部署里最普遍的误区。
防火墙放行也别忘记：
UDP 161 不通时
`snmpget` 只会超时，
不会给出"拒绝连接"的明确错误，
很容易被误判为 agent 没起。

### 3.3 什么时候仍该选 SNMP

当被监控对象是以下几类时，
SNMP 几乎是唯一选项：
没有操作系统可安装 agent 的
交换机/路由器；
只能通过标准协议纳管的
UPS、PDU、存储；
以及必须统一到既有 NMS
（Zabbix、Nagios、LibreNMS）
的老数据中心。

Prometheus 生态也有 snmp_exporter，
可以把 SNMP 数据转成指标，
从而在同一大盘里
同时呈现交换机流量与服务器负载——
这是混合环境的常见架构：
**网络设备走 SNMP，
Linux 主机走 node_exporter，
Grafana 统一出图**。
这样既不要求厂商设备"变现代"，
也不放弃 PromQL 的查询能力。

## 4. Prometheus + node_exporter

### 4.1 架构与选型理由

Prometheus 采用**拉模型**：
server 周期性向各 target 的
`/metrics` 端点抓取样本，
存入本地时序库，
再由 PromQL 查询与规则引擎产生告警。
node_exporter 是其中负责
**主机指标**的 exporter，
暴露 CPU、内存、磁盘、
网络接口等数千个指标，
不改内核、以只读方式运行，
权限要求低，
适合大规模批量部署。

这套组合适合你的信号包括：
需要自定义告警规则
（PromQL 表达灵活）、
需要与 Kubernetes/Grafana 深度集成、
需要按标签
（region、env、team）多维下钻。
若团队已有成熟的 Zabbix 投入，
也没有必要强行迁移——
监控系统迁移成本
远高于收益的情况很常见。

拉模型还有一个运维上的好处：
**目标不可达时，
Prometheus 的 up 指标直接为 0**，
故障自动变成可查询的信号；
而推模型（agent 主动上报）
在网络分区时容易留下"沉默的缺口"，
分不清"没数据"是"没流量"还是"挂了"。
理解这个差异，
有助于设计更可靠的告警。

### 4.2 安装与部署

**node_exporter** 在三发行版均可安装
（Arch 用
`pacman -S prometheus-node-exporter`，
Debian/Ubuntu 用
`apt install prometheus-node-exporter`，
RHEL 系用
`dnf install prometheus-node-exporter`；
无包时也可直接从官方 release
下载二进制）：

```bash
# 以 Arch 为例
$ sudo pacman -S prometheus-node-exporter
$ sudo systemctl enable --now prometheus-node-exporter

# 验证指标端点
$ curl -s localhost:9100/metrics | head -5
# HELP node_cpu_seconds_total Seconds the cpus spent in each mode.
# TYPE node_cpu_seconds_total counter
node_cpu_seconds_total{cpu="0",mode="idle"} 1.234567e+06
```

二进制方式部署时，
建议创建专用系统用户、
用 systemd 托管，
并精简不需要的采集器，
降低开销与攻击面。
9100 端口只应对监控网段开放——
`/metrics` 会暴露主机名、
挂载点、网卡名等拓扑信息，
属于轻度敏感数据。

**Prometheus** 端配置抓取任务：

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'node'
    static_configs:
      - targets: ['localhost:9100', '192.168.1.101:9100']
        labels:
          env: prod
```

Debian/Ubuntu 与 RHEL 系
通常有官方包可直接
`apt install prometheus` /
`dnf install prometheus`
（RHEL 需先配置 EPEL 或官方 repo），
Arch 则 `pacman -S prometheus`。
用包管理器安装的优势是
自带 systemd 单元与配置目录约定，
升级时不必自己挪二进制。

`scrape_interval: 15s`
是默认值与多数场景的平衡点：
更短则数据更细、存储与查询压力更大，
更长则告警延迟上升。
网络接口类指标变化相对平缓，
15 秒足够；
若要捕捉秒级抖动，
应对关键 job 单独缩短间隔，
而不是全局收紧。

### 4.3 网络相关指标与告警

node_exporter 中
最常用于网络监控的指标：

| 指标 | 含义 | 告警思路 |
|------|------|----------|
| `node_network_receive_bytes_total` | 接口累计接收字节 | `rate()` 求带宽，超基线阈值告警 |
| `node_network_transmit_drop_total` | 发送方向丢包计数 | 增长率 > 0 持续数分钟即告警 |
| `node_network_up` | 接口状态（1/0） | =0 说明链路宕 |
| `node_network_receive_err_total` | 接收错误 | 持续增长提示链路质量问题 |
| `node_timex_sync_status` | 时间同步状态 | =0 影响 TLS、日志关联 |

把绝对计数变成"每秒速率"
是 PromQL 的基本功，
也是新手最常卡住的地方——
裸计数器只能看累计，
不能直接设阈值：

```text
# 过去 5 分钟平均每秒接收速率（换算成 bit/s 乘 8）
rate(node_network_receive_bytes_total{device="eth0"}[5m]) * 8

# 接口 down 告警
node_network_up{device="eth0"} == 0

# 发送丢包在最近 2 分钟内持续增长
increase(node_network_transmit_drop_total[2m]) > 0
```

配套的告警规则示例：

```yaml
groups:
  - name: network
    rules:
      - alert: InterfaceDown
        expr: node_network_up{device!~"lo|veth.*|docker.*"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "接口 {{ $labels.device }} 在 {{ $labels.instance }} 上已宕"

      - alert: HighDropRate
        expr: rate(node_network_transmit_drop_total[5m]) > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "{{ $labels.instance }} 丢包速率 {{ $value }}/s"
```

`for: 1m`
表示条件持续 1 分钟才触发，
用来过滤接口重启瞬间的抖动——
**没有 `for` 的告警
在维护窗口会制造大量噪音**，
这是告警疲劳的首要来源。
`device!~"lo|veth.*|docker.*"`
则过滤掉回环与虚拟设备，
否则容器宿主机会被噪声淹没。

写告警前先问三个问题：
这个告警谁看？
看到之后做什么？
什么情况下它会误报？
答不上来的规则先不要上线——
**告警的价值 = 准确率 × 响应动作**，
响了没人动的告警比不响更糟，
因为它会训练值班人员忽略通知。

### 4.4 Grafana 可视化

Grafana 把 PromQL 结果渲染成大盘。
部署同样有三系包
（Arch `pacman -S grafana`，
Debian/Ubuntu 按官方 repo
添加后 `apt install grafana`，
RHEL `dnf install grafana`），
启动 `grafana-server` 后访问 3000 端口，
添加 Prometheus 数据源即可。
社区仪表盘 ID 1860
（Node Exporter Full）几乎是标配，
导入后立即拥有 CPU、网络、
磁盘的全套视图。

看网络图时关注两点：
**接收与发送的对称性**
（突然单向打满往往是异常或 P2P 流量）、
**错误/丢包是否伴随流量增长**
（仅流量高而无错包
属正常扩容信号）。
大盘的真正作用是
**把基线画进人的直觉里**——
每天看一眼，
异常出现时不需要阈值也会觉得"不对劲"，
阈值只是把你不在屏幕前的那段时间补上。

## 5. 本地带宽与延迟分析

大盘告诉你"出事了"，
本地工具告诉你"出的是什么事"。
两者配合，
避免"看到告警却不知道在哪台机器复现"。

```bash
# 实时各连接带宽
# Arch: pacman -S iftop；Debian: apt install iftop；RHEL: dnf install iftop
$ sudo iftop -nNP -i eth0

# 接口级速率曲线
$ sudo nload eth0

# 历史流量报表（长期基线）
$ vnstat -d
   day        rx      |     tx      |    total    |   avg.     rx
-----------------------+-------------+-------------+---------------
2026-09-20    12.4 GiB |     8.9 GiB |     21.3 GiB |   24.0 KiB/s
```

`iftop` 适合定位"此刻谁在占带宽"，
`vnstat` 靠内核计数器做长期累计、
开销极低，
两者一个看瞬时、一个看历史，
互补而不冲突。
`nload` 更直观
但信息密度低于 `iftop`，
排障时优先 `iftop`。

带宽容量验证用 `iperf3`
（三发行版包名相同，
Arch `pacman -S iperf3`）：

```bash
# 服务端
$ iperf3 -s

# 客户端：30 秒压测，观察是否有重传
$ iperf3 -c 192.168.1.200 -t 30
[  5]   0.00-30.00  sec  3.42 GBytes   980 Mbits/sec    0 sender
[  5]   0.00-30.01  sec  3.42 GBytes   980 Mbits/sec         receiver
```

iperf3 从 3.1 起默认**单连接**，
多核交换机上可能测不满链路，
需要 `-P 4` 并行；
`sender`/`receiver` 数值差距大
或出现 retrans，
说明路径存在拥塞或丢包，
应转到 `mtr`/`tcpdump`
继续取证
（见[网络故障排除](./troubleshooting.md)）。

压测本身也有纪律：
**先申请窗口、限速、并确认对端在跑**。
对着生产 IP 直接满速 iperf3，
可能把业务挤掉——
监控告诉你链路快满了，
验证手段就不能成为压垮它的最后一根稻草。
把压测安排在业务低峰，
或用专门的打流机对打，
是更专业的做法。

## 6. 抓包与深度分析

监控发现异常后，
抓包是最终定性的手段。
`tcpdump` 的三发行版安装为
Debian/Ubuntu `apt install tcpdump`、
Arch `pacman -S tcpdump`、
RHEL `dnf install tcpdump`
（通常已预装）：

```bash
# 抓指定接口与端口，保存供 Wireshark 分析
$ sudo tcpdump -ni eth0 port 443 -w /tmp/tls.pcap -c 10000

# 只看握手与挥手，评估连接建立质量
$ sudo tcpdump -ni eth0 'tcp[tcpflags] & (tcp-syn|tcp-fin) != 0' and host 10.0.0.5
```

抓包文件配合 Wireshark
（Arch `pacman -S wireshark`，
Debian `apt install wireshark`，
RHEL `dnf install wireshark`）
可以看到 TCP 窗口、重传、
TLS 握手耗时等细节，
是区分"网络慢"与"应用慢"的终极依据。
**抓包有开销且涉及敏感数据**，
生产环境务必限定时长与 BPF 过滤条件，
落地后及时销毁文件——
含明文凭据的 pcap
本身就是安全事故的源头。

抓包与监控的衔接可以固化下来：
告警触发 → 自动在目标机
抓 60 秒相关端口 → 附进工单。
这样值班人员到达现场时
证据已经就位，
而不是从零开始敲命令。
对高频告警做这层自动化，
复盘质量会有质的变化。

## 7. Zabbix 与其他传统方案

Zabbix 代表另一类一体化方案：
agent、自动发现、模板、告警内置，
适合希望"开箱即用、少写查询"的团队。
部署流程是先准备好数据库
（MySQL/PostgreSQL），
导入官方 SQL，
再配置 `zabbix_server.conf`
的 `DBPassword`
并启动 `zabbix-server`、
`zabbix-agent` 与 Web 前端。
它的网络发现与低级发现（LLD）
可以自动登记交换机接口，
与 SNMP 模板配合良好，
是混合环境的另一种合理选择。

选型可以简化成一句话：
**要深度定制查询与云原生集成选 Prometheus，
要一体化与 SNMP 设备纳管选 Zabbix，
两者都可在同一大盘中共存**
（Grafana 同时接 Prometheus
与 Zabbix 数据源即可）。
真正决定成败的往往不是工具本身，
而是有没有人持续维护基线、
清理失效告警、
复盘误报——
监控是运营动作，
不是一次性安装。

## 8. 常见坑

- **exporter 起了但 Prometheus 抓不到**。
  九成是防火墙或 SELinux
  拦了 9100 端口。
  先 `curl -s 目标:9100/metrics`
  验证可达，
  再查 Prometheus 的
  Service Discovery 页面；
  细节见[防火墙](./firewall.md)
  的连通性取证。
- **SNMP 只在本机通**。
  默认 community/监听地址限制
  导致远程 get 超时，
  需调整 `agentaddress`
  与 `rocommunity`
  并放行 UDP 161；
  同时尽快把 community 换成 v3
  或至少限制来源网段。
- **用绝对计数器设阈值**。
  `node_network_receive_bytes_total`
  是累计值，永不下跌，
  直接 `> 1000000` 的规则会永久触发。
  必须套 `rate()`/`increase()`。
- **告警阈值拍脑袋**。
  没有基线就设阈值，
  结果要么天天误报被静默，
  要么真故障不响。
  先用 `vnstat`/大盘观察一周再定线，
  并为不同时间窗
  （工作日/周末）考虑分开策略。
- **忽略 `lo`、`veth`、`docker0` 噪声**。
  接口告警不加
  `device!~"lo|veth.*"` 过滤，
  回环抖动就会刷屏。
- **指标基数失控**。
  给每个请求路径都加 label
  会让时序库膨胀到不可用，
  网络类指标以接口、实例两个维度为宜。
- **监控端与被监控端时钟漂移**。
  样本时间戳错乱
  会导致查询结果"凭空缺数"，
  确保 NTP 同步（`chronyc tracking`）。
- **把监控当排障工具**。
  监控告诉你何时何地出问题，
  不告诉你根因——
  根因仍要回到
  [网络故障排除](./troubleshooting.md)
  的推理链与抓包证据。

## 9. 参考资料

- Prometheus 文档：<https://prometheus.io/docs/>
- node_exporter README：
  <https://github.com/prometheus/node_exporter>
- PromQL 函数手册：
  <https://prometheus.io/docs/prometheus/latest/querying/functions/>
- Grafana 文档：<https://grafana.com/docs/>
- Net-SNMP 手册：<https://www.net-snmp.org/docs/man/>
- SNMPv3 安全模型（RFC 3411-3415）
- Zabbix 文档：<https://www.zabbix.com/documentation>
- Arch Wiki - Prometheus：
  <https://wiki.archlinux.org/title/Prometheus>
- `man snmpget`、`man snmpwalk`、
  `man tcpdump`、`man vnstat`、`man iperf3`
