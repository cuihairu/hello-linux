# 网络管理命令

## 学习目标

- 掌握网络配置和诊断命令
- 了解网络连接和状态查看
- 学会排查网络问题

## 1. 网络配置

### 1.1 ip - 网络配置

```bash
# 查看网络接口
ip link show

# 查看 IP 地址
ip addr show

# 查看特定接口
ip addr show eth0

# 添加 IP 地址
sudo ip addr add 192.168.1.100/24 dev eth0

# 删除 IP 地址
sudo ip addr del 192.168.1.100/24 dev eth0

# 启用接口
sudo ip link set eth0 up

# 禁用接口
sudo ip link set eth0 down
```

### 1.2 ifconfig - 网络配置（旧版）

```bash
# 查看网络接口
ifconfig

# 查看特定接口
ifconfig eth0

# 配置 IP 地址
sudo ifconfig eth0 192.168.1.100 netmask 255.255.255.0

# 启用接口
sudo ifconfig eth0 up

# 禁用接口
sudo ifconfig eth0 down
```

### 1.3 route - 路由配置

```bash
# 查看路由表
ip route show

# 添加默认网关
sudo ip route add default via 192.168.1.1

# 添加静态路由
sudo ip route add 10.0.0.0/8 via 192.168.1.1

# 删除路由
sudo ip route del 10.0.0.0/8

# 查看路由表（旧版）
route -n
```

## 2. 网络诊断

### 2.1 ping - 连通性测试

```bash
# 测试连通性
ping 8.8.8.8

# 指定次数
ping -c 4 8.8.8.8

# 指定间隔
ping -i 2 8.8.8.8

# 指定包大小
ping -s 1024 8.8.8.8
```

### 2.2 traceroute - 路由追踪

```bash
# 追踪路由
traceroute 8.8.8.8

# 使用 TCP
traceroute -T 8.8.8.8

# 使用 UDP
traceroute -U 8.8.8.8

# 指定端口
traceroute -p 80 8.8.8.8
```

### 2.3 mtr - 网络诊断

```bash
# 实时诊断
mtr 8.8.8.8

# 报告模式
mtr -r 8.8.8.8

# 指定次数
mtr -c 100 8.8.8.8
```

## 3. 端口和连接

### 3.1 netstat - 网络状态

```bash
# 查看所有连接
netstat -a

# 查看 TCP 连接
netstat -at

# 查看 UDP 连接
netstat -au

# 查看监听端口
netstat -ltnp

# 查看路由表
netstat -r
```

### 3.2 ss - 套接字统计

```bash
# 查看所有连接
ss -a

# 查看 TCP 连接
ss -t

# 查看 UDP 连接
ss -u

# 查看监听端口
ss -ltnp

# 查看特定端口
ss -tlnp | grep :80
```

### 3.3 lsof - 打开文件

```bash
# 查看网络连接
lsof -i

# 查看特定端口
lsof -i :80

# 查看特定协议
lsof -i tcp

# 查看特定进程
lsof -i -p PID
```

## 4. DNS 查询

### 4.1 nslookup - DNS 查询

```bash
# 查询域名
nslookup example.com

# 查询特定 DNS 服务器
nslookup example.com 8.8.8.8

# 查询特定记录类型
nslookup -type=MX example.com
```

### 4.2 dig - DNS 查询

```bash
# 查询域名
dig example.com

# 查询特定记录类型
dig example.com MX

# 查询特定 DNS 服务器
dig @8.8.8.8 example.com

# 简洁输出
dig +short example.com

# 反向查询
dig -x 8.8.8.8
```

### 4.3 host - DNS 查询

```bash
# 查询域名
host example.com

# 查询特定记录类型
host -t MX example.com

# 反向查询
host 8.8.8.8
```

## 5. 网络工具

### 5.1 wget - 下载工具

```bash
# 下载文件
wget http://example.com/file.txt

# 指定输出文件名
wget -O output.txt http://example.com/file.txt

# 后台下载
wget -b http://example.com/file.txt

# 限速下载
wget --limit-rate=1m http://example.com/file.txt

# 断点续传
wget -c http://example.com/file.txt
```

### 5.2 curl - URL 工具

```bash
# 获取页面内容
curl http://example.com

# 保存到文件
curl -o output.txt http://example.com

# 显示响应头
curl -I http://example.com

# POST 请求
curl -X POST -d "data=value" http://example.com

# 指定请求头
curl -H "Content-Type: application/json" http://example.com
```

### 5.3 scp - 远程复制

```bash
# 复制到远程
scp file.txt user@remote:/path/

# 从远程复制
scp user@remote:/path/file.txt .

# 递归复制目录
scp -r directory/ user@remote:/path/

# 指定端口
scp -P 2222 file.txt user@remote:/path/
```

### 5.4 rsync - 远程同步

```bash
# 同步目录
rsync -avz source/ user@remote:/path/

# 从远程同步
rsync -avz user@remote:/path/ source/

# 模拟运行
rsync -avzn source/ user@remote:/path/

# 排除文件
rsync -avz --exclude="*.log" source/ user@remote:/path/
```

## 6. 网络安全

### 6.1 nmap - 端口扫描

```bash
# 扫描端口
nmap 192.168.1.1

# 扫描特定端口
nmap -p 80,443 192.168.1.1

# 扫描所有端口
nmap -p- 192.168.1.1

# 服务版本检测
nmap -sV 192.168.1.1

# 操作系统检测
nmap -O 192.168.1.1
```

### 6.2 tcpdump - 抓包工具

```bash
# 抓取所有包
sudo tcpdump -i eth0

# 抓取特定端口
sudo tcpdump -i eth0 port 80

# 抓取特定主机
sudo tcpdump -i eth0 host 192.168.1.1

# 保存到文件
sudo tcpdump -i eth0 -w capture.pcap

# 读取文件
sudo tcpdump -r capture.pcap
```

## 7. 两系差异

| 方面 | Debian/Ubuntu | RHEL/CentOS |
|------|---------------|-------------|
| 网络配置 | Netplan | NetworkManager |
| 防火墙 | ufw | firewalld |
| 网络工具 | iproute2 | iproute2 |

## 参考资料

- [鸟哥的私房菜 - 网络命令](https://linux.vbird.org/linux_server/0110networkbasic.php)
- [Arch Wiki - Network configuration](https://wiki.archlinux.org/title/Network_configuration)
- [Linux man pages](https://man7.org/linux/man-pages/)
