# 网络故障排除

网络故障排除是网络管理的重要技能，帮助快速定位和解决问题。

> 内容参考自网络诊断工具手册和实际运维经验，见文末参考资料。

## 学习目标

- 掌握网络故障排除的基本方法
- 学会使用常用网络诊断工具
- 了解常见网络问题的解决方案
- 掌握网络性能分析和优化

## 1. 故障排除方法

### 1.1 分层排除法

```bash
# OSI 模型分层排除
# 1. 物理层：检查网线、接口、设备状态
# 2. 数据链路层：检查 MAC 地址、交换机配置
# 3. 网络层：检查 IP 地址、路由表
# 4. 传输层：检查端口、防火墙
# 5. 应用层：检查服务状态、配置
```

### 1.2 故障排除步骤

```bash
# 1. 收集信息
# 2. 分析问题
# 3. 提出假设
# 4. 测试验证
# 5. 解决问题
# 6. 记录文档
```

## 2. 诊断工具

### 2.1 ping

```bash
# 测试网络连通性
ping example.com

# 指定次数
ping -c 4 example.com

# 指定间隔
ping -i 2 example.com

# 指定包大小
ping -s 1024 example.com

# 指定 TTL
ping -t 10 example.com
```

### 2.2 traceroute

```bash
# 跟踪数据包路径
traceroute example.com

# 使用 TCP
traceroute -T example.com

# 使用 UDP
traceroute -U example.com

# 指定端口
traceroute -p 80 example.com

# 禁用 DNS 解析
traceroute -n example.com
```

### 2.3 mtr

```bash
# 结合 ping 和 traceroute
mtr example.com

# 报告模式
mtr -r example.com

# 指定次数
mtr -c 100 example.com

# 显示 AS 号
mtr -z example.com
```

### 2.4 netstat

```bash
# 查看网络连接
netstat -tulnp

# 查看路由表
netstat -r

# 查看网络统计
netstat -s

# 查看特定端口
netstat -tulnp | grep :80

# 查看特定协议
netstat -tulnp | grep tcp
```

### 2.5 ss

```bash
# ss 是 netstat 的替代品
ss -tulnp

# 查看 TCP 连接
ss -t state established

# 查看特定端口
ss -tulnp | grep :80

# 查看连接统计
ss -s

# 查看套接字详细信息
ss -tulnp -i
```

### 2.6 nmap

```bash
# 端口扫描
nmap example.com

# 扫描特定端口
nmap -p 80,443 example.com

# 扫描端口范围
nmap -p 1-1000 example.com

# 服务版本检测
nmap -sV example.com

# 操作系统检测
nmap -O example.com

# 脚本扫描
nmap --script=default example.com
```

### 2.7 tcpdump

```bash
# 抓包分析
tcpdump -i eth0

# 捕获特定主机
tcpdump host 192.168.1.100

# 捕获特定端口
tcpdump port 80

# 捕获特定协议
tcpdump tcp

# 保存到文件
tcpdump -w capture.pcap

# 读取文件
tcpdump -r capture.pcap
```

## 3. 常见问题排查

### 3.1 网络不通

```bash
# 检查物理连接
ip link show

# 检查 IP 地址
ip addr show

# 检查路由表
ip route show

# 检查 DNS
cat /etc/resolv.conf

# 测试本地回环
ping 127.0.0.1

# 测试网关
ping 192.168.1.1

# 测试外部网络
ping 8.8.8.8
```

### 3.2 DNS 解析问题

```bash
# 检查 DNS 配置
cat /etc/resolv.conf

# 测试 DNS 解析
nslookup example.com
dig example.com

# 使用特定 DNS 服务器
nslookup example.com 8.8.8.8

# 检查 /etc/hosts
cat /etc/hosts
```

### 3.3 端口不通

```bash
# 检查端口监听
ss -tulnp | grep :80

# 检查防火墙
iptables -L -n

# 测试端口连通性
telnet example.com 80
nc -zv example.com 80

# 检查服务状态
systemctl status nginx
```

### 3.4 连接超时

```bash
# 检查网络延迟
ping example.com

# 检查路由路径
traceroute example.com

# 检查防火墙规则
iptables -L -n

# 检查网络拥塞
iftop
nload
```

### 3.5 网络性能问题

```bash
# 测试带宽
iperf3 -s  # 服务端
iperf3 -c server_ip  # 客户端

# 监控网络流量
iftop
nload
vnstat

# 查看网络错误
netstat -i
ip -s link show eth0
```

## 4. 无线网络故障

### 4.1 无线连接问题

```bash
# 查看无线接口
iwconfig

# 扫描无线网络
iwlist wlan0 scan

# 连接无线网络
wpa_supplicant -i wlan0 -c /etc/wpa_supplicant.conf

# 查看连接状态
wpa_cli status
```

### 4.2 无线信号问题

```bash
# 查看信号强度
iwconfig wlan0

# 查看连接信息
iw dev wlan0 link

# 查看信道信息
iw dev wlan0 info
```

## 5. 防火墙问题

### 5.1 iptables 调试

```bash
# 查看规则
iptables -L -n -v

# 查看特定链
iptables -L INPUT -n -v

# 调试模式
iptables -A INPUT -p tcp --dport 80 -j LOG --log-prefix "HTTP: "

# 查看日志
tail -f /var/log/syslog | grep HTTP
```

### 5.2 firewalld 调试

```bash
# 查看状态
firewall-cmd --state

# 查看规则
firewall-cmd --list-all

# 查看特定服务
firewall-cmd --list-services

# 查看端口
firewall-cmd --list-ports
```

## 6. VPN 故障

### 6.1 OpenVPN 故障

```bash
# 查看状态
systemctl status openvpn

# 查看日志
tail -f /var/log/openvpn/openvpn.log

# 测试连接
openvpn --config client.ovpn
```

### 6.2 WireGuard 故障

```bash
# 查看状态
wg show

# 查看配置
cat /etc/wireguard/wg0.conf

# 测试连接
ping 10.0.0.1
```

## 7. 网络监控

### 7.1 实时监控

```bash
# 监控网络流量
iftop
nload
bmon

# 监控连接
watch -n 1 "ss -tulnp"

# 监控日志
tail -f /var/log/syslog | grep -i network
```

### 7.2 历史数据

```bash
# 使用 vnstat
vnstat
vnstat -l  # 实时监控

# 使用 sar
sar -n DEV 1 10

# 使用 ifstat
ifstat 1 10
```

## 8. 自动化故障排除

### 8.1 故障排除脚本

```bash
#!/bin/bash
# 网络故障排除脚本

echo "=== 网络故障排除 ==="

# 检查本地连接
echo "1. 检查本地连接"
ping -c 2 127.0.0.1

# 检查网关
echo "2. 检查网关"
ping -c 2 192.168.1.1

# 检查 DNS
echo "3. 检查 DNS"
ping -c 2 8.8.8.8

# 检查外部网络
echo "4. 检查外部网络"
ping -c 2 example.com

# 检查端口
echo "5. 检查端口"
ss -tulnp | grep :80
```

### 8.2 监控告警

```bash
#!/bin/bash
# 网络监控告警脚本

THRESHOLD=100  # 延迟阈值（毫秒）

check_latency() {
    latency=$(ping -c 1 example.com | grep 'time=' | awk -F'time=' '{print $2}' | awk '{print $1}')
    if (( $(echo "$latency > $THRESHOLD" | bc -l) )); then
        echo "网络延迟过高: ${latency}ms" | mail -s "网络告警" admin@example.com
    fi
}

# 每 5 分钟检查一次
while true; do
    check_latency
    sleep 300
done
```

## 参考资料

- `man ping`, `man traceroute`, `man mtr`, `man netstat`, `man ss`, `man nmap`, `man tcpdump`
- [网络故障排除指南](https://www.cisco.com/c/en/us/support/docs/ip/routing-protocols/21284-troubleshooting-guide.html)
- [Linux 网络故障排除](https://www.redhat.com/sysadmin/troubleshoot-network)