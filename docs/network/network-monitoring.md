# 网络监控

网络监控用于实时监控网络状态和性能。

> 内容参考自 Prometheus、Grafana、Zabbix 官方文档和实际运维经验，见文末参考资料。

## 学习目标

- 掌握网络监控工具使用
- 学会使用 Prometheus 和 Grafana
- 了解网络性能分析和故障排查

## 1. 网络监控工具

### 1.1 常用命令

```bash
# 查看网络连接
ss -tulnp
netstat -tulnp

# 查看路由表
ip route show
route -n

# 查看网络接口
ip addr show
ifconfig

# 查看网络流量
iftop
nload
vnstat
```

### 1.2 网络诊断

```bash
# ping 测试
ping -c 4 8.8.8.8

# traceroute
traceroute 8.8.8.8

# mtr（结合 ping 和 traceroute）
mtr 8.8.8.8

# DNS 查询
nslookup example.com
dig example.com
```

## 2. Prometheus

### 2.1 安装

```bash
# 下载安装包
wget https://github.com/prometheus/prometheus/releases/download/v2.45.0/prometheus-2.45.0.linux-amd64.tar.gz
tar -xzf prometheus-2.45.0.linux-amd64.tar.gz
sudo mv prometheus-2.45.0.linux-amd64 /opt/prometheus

# 创建用户
sudo useradd --no-create-home --shell /bin/false prometheus

# 设置权限
sudo chown -R prometheus:prometheus /opt/prometheus
```

### 2.2 配置

```yaml
# /opt/prometheus/prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'node'
    static_configs:
      - targets: ['localhost:9100']
```

### 2.3 启动服务

```bash
# 创建 systemd 服务
sudo tee /etc/systemd/system/prometheus.service <<EOF
[Unit]
Description=Prometheus
Wants=network-online.target
After=network-online.target

[Service]
User=prometheus
Group=prometheus
Type=simple
ExecStart=/opt/prometheus/prometheus --config.file=/opt/prometheus/prometheus.yml --storage.tsdb.path=/opt/prometheus/data

[Install]
WantedBy=multi-user.target
EOF

# 启动服务
sudo systemctl daemon-reload
sudo systemctl start prometheus
sudo systemctl enable prometheus
```

## 3. Node Exporter

### 3.1 安装

```bash
# 下载安装包
wget https://github.com/prometheus/node_exporter/releases/download/v1.6.1/node_exporter-1.6.1.linux-amd64.tar.gz
tar -xzf node_exporter-1.6.1.linux-amd64.tar.gz
sudo mv node_exporter-1.6.1.linux-amd64 /opt/node_exporter

# 创建用户
sudo useradd --no-create-home --shell /bin/false node_exporter

# 设置权限
sudo chown -R node_exporter:node_exporter /opt/node_exporter
```

### 3.2 启动服务

```bash
# 创建 systemd 服务
sudo tee /etc/systemd/system/node_exporter.service <<EOF
[Unit]
Description=Node Exporter
Wants=network-online.target
After=network-online.target

[Service]
User=node_exporter
Group=node_exporter
Type=simple
ExecStart=/opt/node_exporter/node_exporter

[Install]
WantedBy=multi-user.target
EOF

# 启动服务
sudo systemctl daemon-reload
sudo systemctl start node_exporter
sudo systemctl enable node_exporter
```

## 4. Grafana

### 4.1 安装

```bash
# 添加仓库
sudo apt install -y software-properties-common
sudo add-apt-repository "deb https://packages.grafana.com/oss/deb stable main"
wget -q -O - https://packages.grafana.com/gpg.key | sudo apt-key add -

# 安装
sudo apt update
sudo apt install grafana

# 启动服务
sudo systemctl start grafana-server
sudo systemctl enable grafana-server
```

### 4.2 配置

```bash
# 访问 Grafana
# http://your-ip:3000
# 默认用户名/密码: admin/admin

# 添加数据源
# Configuration → Data Sources → Add data source
# 选择 Prometheus
# URL: http://localhost:9090

# 导入仪表盘
# Dashboards → Import
# 输入仪表盘 ID（如 1860）
```

## 5. Zabbix

### 5.1 安装

```bash
# 添加仓库
wget https://repo.zabbix.com/zabbix/6.4/ubuntu/pool/main/z/zabbix-release/zabbix-release_6.4-1+ubuntu22.04_all.deb
sudo dpkg -i zabbix-release_6.4-1+ubuntu22.04_all.deb
sudo apt update

# 安装 Zabbix
sudo apt install zabbix-server-mysql zabbix-frontend-php zabbix-apache-conf zabbix-sql-scripts zabbix-agent
```

### 5.2 配置

```bash
# 创建数据库
sudo mysql -u root -p
CREATE DATABASE zabbix CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
CREATE USER 'zabbix'@'localhost' IDENTIFIED BY 'password';
GRANT ALL PRIVILEGES ON zabbix.* TO 'zabbix'@'localhost';
FLUSH PRIVILEGES;

# 导入数据
zcat /usr/share/zabbix-sql-scripts/mysql/server.sql.gz | mysql -uzabbix -p zabbix

# 配置 Zabbix
sudo vim /etc/zabbix/zabbix_server.conf
DBPassword=password

# 启动服务
sudo systemctl start zabbix-server zabbix-agent apache2
sudo systemctl enable zabbix-server zabbix-agent apache2
```

## 6. 网络性能分析

### 6.1 iperf

```bash
# 安装
sudo apt install iperf3

# 服务端
iperf3 -s

# 客户端
iperf3 -c server-ip

# 带宽测试
iperf3 -c server-ip -t 60
```

### 6.2 tcpdump

```bash
# 捕获所有流量
sudo tcpdump -i eth0

# 捕获特定端口
sudo tcpdump -i eth0 port 80

# 捕获特定主机
sudo tcpdump -i eth0 host 192.168.1.100

# 保存到文件
sudo tcpdump -i eth0 -w capture.pcap

# 读取文件
sudo tcpdump -r capture.pcap
```

### 6.3 Wireshark

```bash
# 安装
sudo apt install wireshark

# 分析 pcap 文件
wireshark capture.pcap
```

## 7. 实战案例

### 7.1 网络监控脚本

```bash
#!/bin/bash
# 网络监控脚本

LOG_FILE="/var/log/network_monitor.log"

monitor() {
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    # 网络连接数
    connections=$(ss -tulnp | wc -l)
    
    # 网络流量
    rx_bytes=$(cat /proc/net/dev | grep eth0 | awk '{print $2}')
    tx_bytes=$(cat /proc/net/dev | grep eth0 | awk '{print $10}')
    
    # 网络延迟
    latency=$(ping -c 1 8.8.8.8 | grep 'time=' | awk -F'time=' '{print $2}' | awk '{print $1}')
    
    echo "[$timestamp] 连接数: $connections, 接收: $rx_bytes bytes, 发送: $tx_bytes bytes, 延迟: $latency ms" | tee -a "$LOG_FILE"
}

# 每分钟监控一次
while true; do
    monitor
    sleep 60
done
```

### 7.2 网络告警脚本

```bash
#!/bin/bash
# 网络告警脚本

THRESHOLD=1000  # 延迟阈值（毫秒）
EMAIL="admin@example.com"

check_latency() {
    local latency=$(ping -c 1 8.8.8.8 | grep 'time=' | awk -F'time=' '{print $2}' | awk '{print $1}')
    
    if (( $(echo "$latency > $THRESHOLD" | bc -l) )); then
        echo "网络延迟过高: ${latency}ms" | mail -s "网络告警" "$EMAIL"
    fi
}

# 每 5 分钟检查一次
while true; do
    check_latency
    sleep 300
done
```

## 参考资料

- [Prometheus 文档](https://prometheus.io/docs/)
- [Grafana 文档](https://grafana.com/docs/)
- [Zabbix 文档](https://www.zabbix.com/documentation)
- [tcpdump 手册](https://www.tcpdump.org/manpages/)