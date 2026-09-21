# Prometheus + Grafana

Prometheus 是开源的监控和告警系统，Grafana 是可视化平台。两者结合是云原生时代最流行的监控方案。

> 内容参考自 Prometheus 和 Grafana 官方文档，见文末参考资料。

## 学习目标

- 掌握 Prometheus 安装配置
- 学会使用 Node Exporter 采集主机指标
- 掌握 PromQL 查询语言
- 学会 Grafana 仪表盘配置
- 了解告警规则配置

## 1. 架构

```
┌─────────────────────────────────────────────────┐
│                    Grafana                        │
│              (可视化仪表盘)                        │
└─────────────────────┬───────────────────────────┘
                      │ 查询
┌─────────────────────┴───────────────────────────┐
│                  Prometheus                       │
│         ┌─────────────┬─────────────┐            │
│         │  TSDB 存储   │  告警管理器  │            │
│         └─────────────┴─────────────┘            │
└─────────────────────┬───────────────────────────┘
                      │ 拉取指标
    ┌─────────────────┼─────────────────┐
    │                 │                 │
┌───┴───┐       ┌────┴────┐       ┌────┴────┐
│ Node  │       │  MySQL  │       │  Nginx  │
│Exporter│      │ Exporter│       │ Exporter│
└───────┘       └─────────┘       └─────────┘
   主机            数据库            Web服务器
```

## 2. 安装 Prometheus

### 2.1 下载安装

```bash
# 创建用户
sudo useradd --no-create-home --shell /bin/false prometheus

# 创建目录
sudo mkdir /etc/prometheus /var/lib/prometheus

# 下载
PROMETHEUS_VERSION="2.51.0"
wget https://github.com/prometheus/prometheus/releases/download/v${PROMETHEUS_VERSION}/prometheus-${PROMETHEUS_VERSION}.linux-amd64.tar.gz
tar xzf prometheus-${PROMETHEUS_VERSION}.linux-amd64.tar.gz

# 安装
sudo cp prometheus-${PROMETHEUS_VERSION}.linux-amd64/{prometheus,promtool} /usr/local/bin/
sudo cp -r prometheus-${PROMETHEUS_VERSION}.linux-amd64/{consoles,console_libraries} /etc/prometheus/

# 设置权限
sudo chown -R prometheus:prometheus /etc/prometheus /var/lib/prometheus
```

### 2.2 配置文件

```yaml
# /etc/prometheus/prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

alerting:
  alertmanagers:
    - static_configs:
        - targets: ['localhost:9093']

rule_files:
  - "rules/*.yml"

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'node'
    static_configs:
      - targets:
          - '192.168.1.100:9100'
          - '192.168.1.101:9100'
          - '192.168.1.102:9100'
```

### 2.3 Systemd 服务

```ini
# /etc/systemd/system/prometheus.service
[Unit]
Description=Prometheus
Wants=network-online.target
After=network-online.target

[Service]
User=prometheus
Group=prometheus
Type=simple
ExecStart=/usr/local/bin/prometheus \
    --config.file=/etc/prometheus/prometheus.yml \
    --storage.tsdb.path=/var/lib/prometheus/ \
    --web.console.templates=/etc/prometheus/consoles \
    --web.console.libraries=/etc/prometheus/console_libraries \
    --web.enable-lifecycle
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl start prometheus
sudo systemctl enable prometheus
```

访问 `http://localhost:9090` 即可打开 Prometheus Web UI。

## 3. Node Exporter

Node Exporter 采集主机指标（CPU、内存、磁盘、网络）。

### 3.1 安装

```bash
# 创建用户
sudo useradd --no-create-home --shell /bin/false node_exporter

# 下载
NODE_VERSION="1.7.0"
wget https://github.com/prometheus/node_exporter/releases/download/v${NODE_VERSION}/node_exporter-${NODE_VERSION}.linux-amd64.tar.gz
tar xzf node_exporter-${NODE_VERSION}.linux-amd64.tar.gz
sudo cp node_exporter-${NODE_VERSION}.linux-amd64/node_exporter /usr/local/bin/
```

### 3.2 Systemd 服务

```ini
# /etc/systemd/system/node_exporter.service
[Unit]
Description=Node Exporter
After=network.target

[Service]
User=node_exporter
Group=node_exporter
Type=simple
ExecStart=/usr/local/bin/node_exporter
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl start node_exporter
sudo systemctl enable node_exporter
```

## 4. PromQL 查询

### 4.1 基本查询

```promql
# CPU 使用率
100 - (avg by(instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)

# 内存使用率
(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100

# 磁盘使用率
(1 - (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"})) * 100

# 网络流量
irate(node_network_receive_bytes_total{device="eth0"}[5m])
irate(node_network_transmit_bytes_total{device="eth0"}[5m])
```

### 4.2 常用函数

```promql
# rate() - 计算每秒速率
rate(http_requests_total[5m])

# irate() - 瞬时速率
irate(http_requests_total[5m])

# increase() - 增加量
increase(http_requests_total[1h])

# sum() - 求和
sum(rate(http_requests_total[5m])) by (method)

# avg() - 平均值
avg(node_cpu_seconds_total) by (instance)

# topk() - 前 K 个
topk(5, rate(http_requests_total[5m]))
```

## 5. Grafana

### 5.1 安装

```bash
# Debian/Ubuntu
sudo apt install -y apt-transport-https software-properties-common
wget -q -O - https://apt.grafana.com/gpg.key | gpg --dearmor | sudo tee /usr/share/keyrings/grafana.gpg > /dev/null
echo "deb [signed-by=/usr/share/keyrings/grafana.gpg] https://apt.grafana.com stable main" | sudo tee /etc/apt/sources.list.d/grafana.list
sudo apt update
sudo apt install grafana

# RHEL/CentOS/Fedora
sudo dnf install grafana

# 启动并设置开机自启
sudo systemctl start grafana-server
sudo systemctl enable grafana-server
```

访问 `http://localhost:3000`，默认用户名/密码：admin/admin。

### 5.2 添加数据源

1. 登录 Grafana
2. Configuration → Data Sources → Add data source
3. 选择 Prometheus
4. URL 填写 `http://localhost:9090`
5. 点击 Save & Test

### 5.3 常用仪表盘

导入现成的仪表盘（Dashboard ID）：

| ID | 名称 | 说明 |
|----|------|------|
| 1860 | Node Exporter Full | 主机监控全貌 |
| 7362 | MySQL Overview | MySQL 监控 |
| 12708 | Nginx Overview | Nginx 监控 |
| 893 | Docker & System Monitoring | Docker 监控 |

导入步骤：
1. Dashboards → Import
2. 输入 Dashboard ID
3. 选择数据源
4. 点击 Import

## 6. 告警配置

### 6.1 告警规则

```yaml
# /etc/prometheus/rules/node_alerts.yml
groups:
  - name: node_alerts
    rules:
      - alert: HighCPUUsage
        expr: 100 - (avg by(instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "CPU 使用率过高 ({{ $labels.instance }})"
          description: "CPU 使用率已超过 80%，当前值: {{ $value }}"

      - alert: HighMemoryUsage
        expr: (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100 > 90
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "内存使用率过高 ({{ $labels.instance }})"
          description: "内存使用率已超过 90%，当前值: {{ $value }}"

      - alert: DiskSpaceLow
        expr: (1 - (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"})) * 100 > 90
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "磁盘空间不足 ({{ $labels.instance }})"
          description: "磁盘使用率已超过 90%，当前值: {{ $value }}"
```

### 6.2 Alertmanager

```bash
# 下载安装
ALERTMANAGER_VERSION="0.27.0"
wget https://github.com/prometheus/alertmanager/releases/download/v${ALERTMANAGER_VERSION}/alertmanager-${ALERTMANAGER_VERSION}.linux-amd64.tar.gz
tar xzf alertmanager-${ALERTMANAGER_VERSION}.linux-amd64.tar.gz
sudo cp alertmanager-${ALERTMANAGER_VERSION}.linux-amd64/{alertmanager,amtool} /usr/local/bin/
```

```yaml
# /etc/prometheus/alertmanager.yml
global:
  smtp_smarthost: 'smtp.example.com:587'
  smtp_from: 'alertmanager@example.com'
  smtp_auth_username: 'alertmanager@example.com'
  smtp_auth_password: 'password'

route:
  group_by: ['alertname']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 1h
  receiver: 'email'

receivers:
  - name: 'email'
    email_configs:
      - to: 'admin@example.com'
        send_resolved: true
```

## 7. MySQL 监控

### 7.1 MySQL Exporter

```bash
# 下载
MYSQL_EXPORTER_VERSION="0.15.1"
wget https://github.com/prometheus/mysqld_exporter/releases/download/v${MYSQL_EXPORTER_VERSION}/mysqld_exporter-${MYSQL_EXPORTER_VERSION}.linux-amd64.tar.gz
tar xzf mysqld_exporter-${MYSQL_EXPORTER_VERSION}.linux-amd64.tar.gz
sudo cp mysqld_exporter-${MYSQL_EXPORTER_VERSION}.linux-amd64/mysqld_exporter /usr/local/bin/
```

```sql
-- 创建监控用户
CREATE USER 'exporter'@'localhost' IDENTIFIED BY 'password';
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'exporter'@'localhost';
GRANT SELECT ON performance_schema.* TO 'exporter'@'localhost';
FLUSH PRIVILEGES;
```

```ini
# /etc/.mysqld_exporter.cnf
[client]
user=exporter
password=password
```

## 参考资料

- Prometheus 官方文档 — [prometheus.io/docs](https://prometheus.io/docs/)
- Grafana 官方文档 — [grafana.com/docs](https://grafana.com/docs/)
- Node Exporter — [github.com/prometheus/node_exporter](https://github.com/prometheus/node_exporter)
- PromQL 示例 — [prometheus.io/docs/prometheus/latest/querying/examples](https://prometheus.io/docs/prometheus/latest/querying/examples/)
