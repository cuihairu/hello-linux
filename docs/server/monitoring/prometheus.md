# Prometheus + Grafana

监控的本质问题不是"收集多少指标"，而是"故障时能否在五分钟内回答：哪里坏了、多严重、该找谁"。Prometheus 是为此设计的时序数据库与告警系统：它主动去各目标**拉取**（pull）指标，把带时间戳的数据存进本地 TSDB，再用 PromQL 做聚合查询；Grafana 站在它之上画图、做仪表盘，把查询结果变成人能一眼读懂的面板。为什么这套组合能成为云原生时代的默认答案？先对比两类模型：推模型（agent 把数据推给中心）在目标数暴涨时中心容易成为瓶颈与单点，且"目标还在不在"要靠超时猜测；拉模型里 Prometheus 按配置周期来取，目标列表即"存活清单"，挂掉的 exporter 下一次抓取直接缺席，`up` 指标立刻为 0——监控系统自己发现目标失联，而不是等对方来报到。本页按"为什么 pull → 三系安装 → node_exporter → PromQL → Grafana → 告警 → 常见坑"展开，安装部分给出 Debian/Ubuntu（apt）、Arch（pacman）、RHEL/CentOS/Rocky（dnf）三系对照；主机防火墙与端口暴露仍以[防火墙篇](../../security/firewall.md)为准。

> 内容参考自 Prometheus 与 Grafana 官方文档、Arch Wiki，见文末参考资料。

## 学习目标

- 理解 pull 模型与 scrape 配置如何同时完成"采集"与"存活探测"
- 掌握三发行版安装（apt / pacman / dnf），读懂 `systemctl` 与 `/metrics` 验收输出
- 部署 node_exporter 并说清它与 Prometheus 本体的职责分界
- 写出常用 PromQL（rate/irate/sum/topk），区分 counter 与 gauge
- 在 Grafana 接数据源、导仪表盘，并配置可触发的告警规则

## 1. 架构：为什么是拉模型

```text
node_exporter :9100 ──scrape/15s──▶ Prometheus（TSDB + 告警规则）──查询──▶ Grafana :3000
mysqld_export :9104 ──scrape/15s──▶        │ firing
                                           ▼
                                    Alertmanager ──▶ 邮件/IM
```

三层职责必须分清：**exporter** 只会说"我这里有一堆指标"（HTTP `/metrics` 文本），不懂存储也不懂告警；**Prometheus** 负责周期抓取、存时序、按规则求值；**Alertmanager** 接收 firing 的告警，做分组、抑制、路由到邮件或 IM。Grafana 是纯消费者——它查询 Prometheus，不参与采集链路，所以 Prometheus 挂了 Grafana 还在，只是图变空白。这个分界与"包管理器只管装、systemd 只管跑、日志只管记"的切分同理：每层可单独升级，排错时也能顺着"图空 → 查询无数据 → 抓取失败 → exporter 没起"一层层往下钉。

pull 模型还带来两个工程收益：目标只需暴露端口、无需知道中心在哪（NAT 后的机器也能被监控）；`job_name` + `static_configs` 把"谁该被采集"写成可版本化的 YAML，与 IaC 心智一致。代价是要主动维护目标列表——大规模动态环境后续会用服务发现（kubernetes_sd 等），但本页的静态配置已覆盖单机到小集群的主流场景。

部署顺序上也有一个不易察觉的依赖：先让 exporter 在目标机上吐出数据，再改 Prometheus 的 scrape 配置——反过来做会先看到一排 `up 0`，把"配置写错"和"目标没起"两种故障叠在一起，排障成本翻倍。同理，先在本机 `curl :9100/metrics` 验证文本格式，再跨机抓取，能把网络问题与指标问题分开。Grafana 侧则最后接入：数据源 Test 绿了再谈面板，避免在查询为空时怀疑图表配置。这条"exporter → scrape → 面板 → 告警"的单向构建顺序，与改 BIND 时"zone → checkconf → reload → dig"、改 Compose 时"YAML → config → up → ps"是同一种从底向上、每层验收再进下一层的纪律——跳步是监控、DNS、编排三个领域里共同的事故温床。

## 2. 安装（三发行版对照）

| 操作 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 安装 Prometheus | `apt install prometheus` | `sudo pacman -S prometheus` | `dnf install prometheus`（EPEL） |
| 安装 node_exporter | `apt install prometheus-node-exporter` | `pacman -S prometheus-node-exporter` | `dnf install prometheus-node-exporter` |
| 安装 Grafana | 官方 apt 源装 `grafana` | `pacman -S grafana` | 官方 dnf 源装 `grafana` |
| 搜索 | `apt search prometheus` | `pacman -Ss prometheus` | `dnf search prometheus` |
| 查看包信息 | `apt show prometheus` | `pacman -Qi prometheus` | `dnf info prometheus` |
| 查看文件列表 | `dpkg -L prometheus` | `pacman -Ql prometheus` | `rpm -ql prometheus` |
| 升级 | `apt upgrade` | `sudo pacman -Syu` | `dnf upgrade` |
| 卸载 | `apt remove prometheus` | `sudo pacman -R prometheus` | `dnf remove prometheus` |

Debian/Ubuntu 在 universe 源提供 `prometheus` 全家桶（Prometheus、node_exporter、Alertmanager 分包），一条 `apt install` 即齐；Arch 把它们都放在 extra，`pacman -S prometheus prometheus-node-exporter grafana` 三件套一步到位，systemd 单元随包装好直接 `systemctl enable --now`——三系里安装路径最短。RHEL/Rocky 的 Prometheus 包在 EPEL：先 `dnf install epel-release` 再装，版本往往比上游最新略旧，重要特性需求时用官方静态二进制（见 2.4）对照验证。Grafana 在 Debian/RHEL 都建议加官方仓库以获得较新版本与插件生态，Arch 则官方源即一等公民；装完单元名 Debian/RHEL 叫 `grafana-server`，Arch 包同样提供该 unit——三系验收动作相同：`systemctl status` 看 active，浏览器开 `:3000` 看登录页。升级纪律沿用各系习惯：Debian/RHEL 是 `apt upgrade`/`dnf upgrade`，Arch 保持 `pacman -Syu` 整体滚动，配置文件在包升级时的处理提示（dpkg conffile、`.pacnew`）与其他关键服务一样需要人工过目。

### 2.1 Debian/Ubuntu

```bash
$ sudo apt install prometheus prometheus-node-exporter
$ sudo systemctl enable --now prometheus node_exporter
$ curl -s localhost:9090/-/ready
Prometheus Server is Ready.
```

Debian 的默认配置在 `/etc/prometheus/prometheus.yml`，数据目录 `/var/lib/prometheus/`，权限已随包交给 `prometheus` 用户——**不要**再手工 `chown` 无关目录，包管理器默认的属主就是升级不打架的前提；要改采集目标直接编辑 YAML 后 `systemctl reload prometheus`（或 `kill -HUP`）即可热加载 scrape 配置。`enable --now` 一气呵成比先 `enable` 再 `start` 少记一步，也是三系通用的装服务姿势。装完先跑一次本机 `curl /-/ready` 再开浏览器，能把"服务没起"和"防火墙/端口问题"在终端里就分开——排障入口越早收敛到命令行，后面越省时间。

### 2.2 Arch

```bash
$ sudo pacman -S prometheus prometheus-node-exporter grafana
$ sudo systemctl enable --now prometheus node_exporter grafana-server
```

Arch 上三件套全在 extra，`pacman -S` 装完 unit 即可用；配置路径与上游一致：`/etc/prometheus/prometheus.yml`、`/etc/prometheus/alertmanager.yml`（若同时装了 `alertmanager` 包）、告警规则默认目录 `/etc/prometheus/`。与 Debian 拆包风格不同，Arch 惯例是把默认配置全部铺进 `/etc` 并标记为 backup，升级时若你改过会生成 `.pacnew`——`pacman -Ql prometheus | grep yml` 能快速列出包内全部 YAML，确认哪些是"出厂文件、改前可对照"。日常维护仍归 `pacman -Syu`，Prometheus 与 exporter 同仓库滚动，版本天然匹配。安装进度条与依赖解析输出对排障没有信息量，验收只看 `systemctl status` 与 `pacman -Qi` 两行即可。

### 2.3 RHEL/CentOS/Rocky（EPEL）

```bash
$ sudo dnf install epel-release prometheus prometheus-node-exporter
$ sudo systemctl enable --now prometheus node_exporter
$ firewall-cmd --permanent --add-port=9100/tcp && firewall-cmd --reload
```

EPEL 包的 Prometheus 版本策略偏保守，上线前 `dnf info prometheus` 看一眼版本再对照 changelog；数据与配置分别在 `/var/lib/prometheus`、`/etc/prometheus/`。9100 是否对抓取方开放按环境裁剪——Prometheus 与 exporter 同机时仅需回环，跨机抓取才需要放行源地址；规则本身仍以[防火墙篇](../../security/firewall.md)为准，本页不展开。

### 2.4 备选：官方静态二进制

三系包都不可用或需要最新版时，从官方 Release 下载 tar 包、解开把 `prometheus`/`promtool` 拷进 `/usr/local/bin`、配置放 `/etc/prometheus`、数据放 `/var/lib/prometheus`，再手写 unit 以非 root 用户运行——这是与 `pacman -S` 等价但"自管文件清单"的安装方式，代价是升级、回滚、安全公告全部自己负责；能用仓库的场景优先仓库，只有验证前沿特性才走此路。

## 3. node_exporter：主机指标从哪来

node_exporter 只做一件事：把 `/proc`、`/sys` 里的 CPU、内存、磁盘、网络读成 Prometheus 文本格式挂在 `:9100/metrics`。它**不**存储历史、**不**发告警，也**不**是 Prometheus 的一部分——分清这个边界，就能理解"node_exporter 挂了只影响新数据采集，已存时序仍可查询"，也能理解多机部署是"每台一个 exporter、中心一个 Prometheus"，而不是每台装全套。安装见第 2 节对照；跨机抓取时在 `prometheus.yml` 的 `node` job 下列出各机 `IP:9100`，抓取失败的实例 `up` 为 0 并进入告警视野——拉模型顺带完成了存活探测。单独部署与验收的最小流程：

```bash
$ sudo systemctl enable --now node_exporter
$ curl -s localhost:9100/metrics | head -3
# HELP node_cpu_seconds_total Seconds the CPUs spent in each mode.
# TYPE node_cpu_seconds_total counter
```

`curl` 能吐出以 `# HELP` 开头的指标文本即验收通过——这一步与 exporter 是否已被 Prometheus 抓取无关，后者去 Targets 页面看 `up`。跨机部署时重复同样三步即可：装包、enable、curl 本机 9100；exporter 不需要额外防火墙配置时只监听回环，由 Prometheus 侧主动拉取。若要把 node_exporter 与业务进程分开限流，可用 `web.listen-address` 换端口并在 scrape 配置里对应改 `targets`，但默认端口已足够覆盖单机到小集群场景。升级 exporter 时注意与 Prometheus 本体的指标名兼容性——个别 `node_*` 指标在大版本间会改名，升级前后各抓一次 `/metrics` 做 diff，能在告警规则失真前就发现差异。日常巡检不必登录每台机器：Targets 页面的 `last scrape` 与 `sample count` 就是抓取健康度的两列黄金指标，比逐机 curl 高效得多。

## 4. PromQL：查询语言速览

### 4.1 认识两类指标

Prometheus 里最要紧的类型区分是 **counter**（只增不减的累计值，如 `node_cpu_seconds_total`）与 **gauge**（可增可减的瞬时值，如 `node_memory_MemAvailable_bytes`）。counter 必须搭配 `rate()`/`irate()` 取区间斜率才是"每秒速率"，直接看原始值只会得到一条一路爬升的曲线——这是新手第一坑，也是 `rate` 与 `irate` 存在的全部理由：前者窗口平均更稳，后者对尖刺更敏感，告警常用前者、排障瞬时值可用后者。

### 4.2 常用表达式

```text
# CPU 使用率（counter → rate）/ 内存使用率（gauge 直接相除）
100 - (avg by(instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)
(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100
rate(http_requests_total[5m])          # 区间平均速率
increase(http_requests_total[1h])      # 一小时增量
sum(rate(http_requests_total[5m])) by (method)   # 按方法聚合
topk(5, rate(http_requests_total[5m]))           # 最忙的 5 个实例
```

写 PromQL 的固定套路：先确认指标是 counter 还是 gauge → counter 加 `rate`/`increase` → 需要跨实例汇总时 `sum by (标签)` → 排行用 `topk`。标签（`instance`、`job`、`method`）是多维查询的钥匙，`by` 子句决定聚合粒度——聚合前先想清楚"图上一行代表一台机还是一类机"，否则很容易把三台机的内存百分比又平均成一个没有意义的数。PromQL 本身不难，难的是选对指标与窗口：窗口小于两倍抓取间隔必空，窗口远大于业务周期又会把尖刺抹平；与 `pacman -Q` 查"当前装了什么"、journalctl 查"最近发生了什么"一样，查询窗口就是你对问题时间尺度的第一次假设。日常排障可先用浏览器 DevTools 或 Targets 页确认抓取正常，再进入 Explore 交互式试写表达式，确认有数后再固化到面板与告警规则，避免把一次性的猜想直接写进生产规则文件。练习时可先在 Prometheus 自带的 Graph 页交互式补全指标名，确认表达式在历史数据上有值，再原样粘进 Grafana 面板——直接在仪表盘上边改边试，图空白时很难分清是查询写错还是数据本身没有。压测或切换大范围时间轴前，先用较小区间确认逻辑正确，再逐步放宽，能减少一次查爆 TSDB、拖慢整机查询的事故。

## 5. Grafana：把查询变成可读的面板

### 5.1 接数据源与导仪表盘

登录 `:3000`（默认 admin/admin，首次强制改密）后：Configuration → Data Sources → Add data source → 选 Prometheus → URL 填 `http://localhost:9090` → Save & Test 显示绿色即通。仪表盘不必从零手画，Dashboards → Import 输入社区 Dashboard ID 即可复用成熟布局：1860（Node Exporter Full，主机全貌）、7362（MySQL）、12708（Nginx）、893（Docker & System）是最常用的四个；导入时选择刚建的数据源，Apply 即得到与 exporter 指标名对齐的全套面板。想改布局就 Save As 成自己的一份——直接改社区原盘会在下次导入/同步时被覆盖，与改发行版默认配置文件应保留 `.pacnew` 对照是同一种克制。

### 5.2 面板设计取舍

一页放二十个图不等于懂监控：首屏只放"红了就要动手"的黄金指标（可用性、延迟、流量、错误、饱和度），明细下钻到第二页。单位、阈值、`by (instance)` 的粒度都会影响误报观感——同一表达式在主机级与集群级面板上阈值不能照抄。几条能立刻提升可用性的具体做法：给关键面板加告警注解（Alerts → panel annotation），让"这条线为什么红了"直接显示在图上；用 dashboard variable 做实例下拉框（Query 变量取 `label_values(node_uname_info, instance)`），一个仪表盘覆盖全部主机而不是每机复制一份；自动刷新按场景选——排障时 5s/10s 便于观察实时变化，日常巡盘 30s/1m 即可，全站 1s 刷新只会徒增查询压力。Grafana 只读查询，图异常时排查顺序是：数据源 Test → Explore 里手跑同一条 PromQL → 看 `up` 与抓取时间戳，与"图空先查数据链路"的通用排障一致。

告警与面板共享同一条 PromQL 心智：面板里能画出来的尖刺，通常也该有对应的告警规则；反过来，长期无人查看的面板往往是告警缺失的盲区。把"黄金指标首屏 + 明细下钻 + 关键线配告警"当成一个整体来维护，比先堆图再补规则更省返工。变量、阈值、注解这些看似锦上添花的细节，实际决定的是值班同学半夜打开图时能不能三秒定位——它们不是装饰，而是人机界面的一部分。

## 6. 告警：从规则到通知

### 6.1 规则文件

告警规则是"每 evaluation_interval 求值一次的 PromQL"，持续满足 `for:` 时长才从 pending 转 firing——`for: 5m` 正是为了滤掉瞬时抖动，避免半夜被一次 GC 抖动叫醒。

```yaml
# /etc/prometheus/rules/node_alerts.yml
groups:
  - name: node_alerts
    rules:
      - alert: HighCPUUsage
        expr: 100 - (avg by(instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80
        for: 5m
        labels: { severity: warning }
        annotations:
          summary: "CPU 使用率过高 ({{ $labels.instance }})"
          description: "CPU 使用率已超过 80%，当前值: {{ $value }}"
      # 内存告警同构：node_memory_* 阈值 90，severity: critical
```

::: v-pre
主配置用 `rule_files` 引入这些 YAML，改完 `promtool check rules` 再 reload——与改 BIND 区域先 `named-checkzone` 是同一纪律：语法错误若拖到运行时才炸，告警通道会静默失明。Arch 用户加载规则前可先 `pacman -Ql prometheus | grep rules` 看包内是否自带示例规则文件，出厂样例往往就是 `rule_files` 默认引用的路径，改错文件名是最常见的"规则写了却不 evaluation"。`{{ $labels.instance }}`、`{{ $value }}` 在告警文案里注入实例名与当前值，收件人无需回平台就能判断严重度；`severity` 标签则是 Alertmanager 路由分诊的依据。磁盘类告警的 `expr` 与内存同构——把 `node_memory_*` 换成 `node_filesystem_*` 并按 `mountpoint` 过滤即可，不必再抄第三份 YAML。`for:` 与 `severity` 是最需要克制的两个旋钮：`for` 太短会被尖刺叫醒，`severity` 乱标会让路由树失去分诊意义。规则按组拆分（node/app/infra）比塞进一个大文件更利于评审与回滚。
:::

### 6.2 Alertmanager

Alertmanager 独立于 Prometheus 进程：Prometheus 只负责"规则成立 → 推送告警"，分组（同一实例多条告警合并成一封）、抑制（父故障触发时压掉衍生告警）、静默（维护窗口）与邮件/IM 路由全在 Alertmanager。主配置的 `alerting.alertmanagers` 指向它，自身配置（Arch 包默认 `/etc/prometheus/alertmanager.yml`，独立包常见 `/etc/alertmanager/alertmanager.yml`）声明 `route` 树与 `receivers`。SMTP 一段示意如下：

```yaml
global: { smtp_smarthost: 'smtp.example.com:587', smtp_from: 'alertmanager@example.com' }
route: { group_by: ['alertname'], group_wait: 10s, repeat_interval: 1h, receiver: 'email' }
receivers:
  - name: 'email'
    email_configs: [{ to: 'admin@example.com', send_resolved: true }]
```

`group_wait` 让同组告警攒一小会儿再发，避免故障瞬间邮件轰炸；`repeat_interval` 控制未恢复时的重提节奏；`send_resolved: true` 保证恢复也有通知——只收得到"出事"收不到"好了"的告警系统，会逼值班的人手动确认，设计上不可取。安装同样三系对照：Arch 是 `pacman -S alertmanager`，Debian 是 `apt install prometheus-alertmanager`，RHEL/EPEL 是 `dnf install prometheus-alertmanager`，装完 `systemctl enable --now alertmanager` 并核对 9093 被 Prometheus 正确引用。

## 7. 常见坑

**图全空但服务 active。** 先在 Grafana Explore 手跑一条 PromQL：有数据则是面板查询写错/数据源选错；无数据则 `curl localhost:9100/metrics` 看 exporter 是否吐数，再看 Prometheus 的 Status → Targets 页面——`up 0` 或整页 down 指向抓取配置（IP/端口写错、job 没 reload）或防火墙拦截；Targets 全绿仍无历史则是查询时间范围落在部署之前。链路固定为"面板 → 数据源 → Targets → exporter → 端口"，与 DNS 排障先分清"问的不是那台服务器"同一思路。

**`rate` 结果为 0 或空。** 确认指标是 counter 且被 `rate(x[窗口])` 包住；窗口必须大于等于两倍抓取间隔（15s 抓取配 `[1m]` 稳，配 `[5s]` 必空）；指标名/标签与 exporter 版本对不上（升级后改名）也会导致空结果——用 `/metrics` 原文 grep 一遍指标名最快。gauge 误加 `rate`、counter 误用裸查询，是代码评审里最值得盯的两类监控配置错误。

**node_exporter 起了但 Targets 无此实例。** 检查 `prometheus.yml` 是否写了该实例的 `targets`、改完是否 reload；实例在但持续 `up 0` 则查对端 9100 是否监听外网地址（exporter 默认可能只绑回环）、中间防火墙是否放行——放行规则仍以[防火墙篇](../../security/firewall.md)为准。另一常见低级错误是 job 复制粘贴后 `instance` 标签冲突或端口漏改，Targets 页面的 URL 一列能直接暴露。

**告警不触发 / 不发邮件。** 四段定位：Prometheus 的 Alerts 页面看规则是否 loaded、状态是 pending/firing/inactive——inactive 是 expr 写错或阈值过松；firing 但无通知则查 `alerting.alertmanagers` 是否可达；Alertmanager 的 Alerts 页有记录但无邮件，看 SMTP 配置与 `route` 是否匹配该 `severity` 标签；有邮件但被归到垃圾箱，多半是发件域名 SPF/PTR 未对齐（邮件信誉问题，参见[邮件篇](../mail/postfix.md)）。每一段都有独立 UI 或日志可查，把"规则、推送、路由、投递"当成四节车厢逐节检查，比盯着收件箱等信高效得多。

**磁盘被 TSDB 写满。** Prometheus 默认保留 15 天，时序量 = 目标数 × 指标数 × 抓取频率，盲目调低 `scrape_interval` 或对高基数标签（如把 `url` 原文当标签）会指数级放大存储。处置：`--storage.tsdb.retention.time` 收紧保留期 → 审计 `metric_relabel_configs` 丢弃无用指标 → 收敛标签基数，而不是不停加盘——加盘只推迟爆炸，高基数问题必须在配置层解决。与容器篇的镜像清理同理：先看构成（`promtool`/Targets 指标清单），再砍大头，最后才动存储硬件。

**告警风暴 / 同一故障多封信。** 多半是 Alertmanager 没分组或 `for` 太短：同一实例的 CPU、内存、磁盘告警应被 `group_by: ['instance']` 合并成一封；网络抖动造成的 `up 0` 瞬时告警则靠加大 `for` 或在 Alertmanager 做 inhibit（父故障压掉子告警）过滤。排查顺序固定为：看 Alerts 页状态 → 看 Alertmanager 路由树 → 看 receivers 是否匹配 `severity`，与前文"规则、推送、路由、投递"四节车厢法一致，不要一上来就改 SMTP。

**规则文件改了却不 evaluation。** 先 `promtool check rules 文件` 听语法，再确认主配置 `rule_files` 的 glob 是否真的覆盖了你的路径，最后 `systemctl reload prometheus`。三步都有明确的失败信号：check 报 YAML/表达式错误、glob 不匹配时 Alerts 页根本看不到组、没 reload 则进程还抱着旧规则——与 BIND 的 checkzone → checkconf → reload 是同一套从静态到生效的验收链，任何一步跳过都会在运行时以"静默不告警"的形式暴露。

## 参考资料

- Prometheus 官方文档 — [prometheus.io/docs](https://prometheus.io/docs/)
- PromQL 函数详解 — [prometheus.io/docs/prometheus/latest/querying/functions/](https://prometheus.io/docs/prometheus/latest/querying/functions/)
- Grafana 官方文档 — [grafana.com/docs](https://grafana.com/docs/)
- node_exporter — [github.com/prometheus/node_exporter](https://github.com/prometheus/node_exporter)
- Alertmanager — [prometheus.io/docs/alerting/latest/alertmanager/](https://prometheus.io/docs/alerting/latest/alertmanager/)
- Arch Wiki: Prometheus — [wiki.archlinux.org/title/Prometheus](https://wiki.archlinux.org/title/Prometheus)
