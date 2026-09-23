# 网络管理

对服务器而言，
网络就是生命线：
SSH 连不上、
DNS 解析失败、
端口没监听、
防火墙拦了流量——
这些占了日常排障的一大半。
网络问题之所以让人害怕，
是因为它看起来"玄学"：
明明配置没错，
就是不通。
实际上，
网络排障有一条非常固定的推理链——
**本机配置对不对 → 本机能不能出去 → 中间路径通不通 → 目标服务活没活**——
每一环都有对应的命令。
网络管理章的任务，
就是把这条链上的每个节点和对应命令一一钉死，
让你下次遇到"连不上"时，
可以按顺序敲四条命令，
而不是胡乱重启网卡。

> 本章核心命令 `ip`、
> `ss`、
> `ping`、
> `curl`、
> `ssh`、
> `rsync` 在 **Debian/Ubuntu、
> Arch、
> RHEL/CentOS/Rocky** 三系上通用；
> 差异集中在**配置文件写在哪、
> 用哪个工具改网络、
> 默认防火墙是谁**，
> 文中会逐处标注。

## 为什么网络命令必须成体系地学

单条命令谁都会敲，难的是**知道该敲哪一条、以及结果怎么解读**。三个真实场景说明为什么：

1. **"网站打不开"至少有五种可能**：
   本机没 IP、
   网关不通、
   DNS 解析失败、
   目标端口被防火墙拦、
   目标服务没起。
   对应的检查分别是 `ip addr`、
   `ping 网关`、
   `ping/curl 域名`、
   `ss -tlnp`/`firewall-cmd --list-all`、
   `systemctl status 服务名`。
   没有体系化的命令地图，
   你只能靠重启碰运气。
2. **现代 Linux 已经淘汰了 `ifconfig`/`netstat`**。
   很多老教程还在教 `ifconfig eth0 192.168.1.10`，
   但这两条命令来自 net-tools 包，
   在 Arch 上默认根本没装。
   新标准是 `ip`（iproute2）和 `ss`，
   三系都预装。
   学新的，
   不要在新系统上复刻十年前的操作。
3. **远程管理是 Linux 的默认工作方式**。
   `ssh` 不只是"登录另一台机器"，
   它还承载端口转发、
   免密登录、
   跳板机、
   `scp`/`rsync` 文件同步。
   这一块不熟，
   任何自动化和多机协作都会卡住。

一句话总结本章的哲学：**网络问题先分层，分层之后每层都有唯一对应的命令**。

> 示例输出来自真实 Ubuntu 26.04 环境，见文末参考资料。

## 学习目标

- **配置与查看**：
  用 `ip link`/`ip addr`/`ip route` 查看与配置网卡、
  IP、
  路由，
  知道 `ifconfig` 已过时以及三系各自的持久化配置入口（Netplan、
  `.nmconnection`/NetworkManager、
  ifcfg 脚本）。
- **连接诊断**：
  用 `ss -tlnp` 查监听端口、
  `ping`/`traceroute` 测连通与路径、
  `dig`/`nslookup`/`host` 查 DNS、
  `mtr` 做"ping + traceroute"合体诊断。
- **应用层测试**：
  用 `curl`（含 `-I`、
  `-v`、
  `-o`、
  `-w`）和 `wget` 测试 HTTP 接口、
  下载文件、
  抓取状态码与耗时，
  能区分"网络通但服务 5xx"和"根本连不上"。
- **远程与传输**：
  熟练 `ssh`（密钥登录、
  `~/.ssh/config` 简写、
  端口转发 `-L`/`-R`）、
  `scp`/`sftp`、
  `rsync` 增量同步，
  以及权限与 host key 报错的处理。
- **防火墙意识**：
  知道三系默认防火墙不同（`ufw`/自选 nftables/`firewalld`），
  排障时先确认端口是否被本机规则拦掉。
- **排障框架**：能独立走完"ip → 网关 → DNS → 端口 → 应用"五步排查，并说出每一步失败分别意味着什么。

## 子页导读

| 子页 | 一句话导读 |
|------|------------|
| [网络管理命令](./network/network.md) | 配置与连通性的骨架：`ip` 系列（addr/link/route）、`ss` 端口监听、`ping`/`traceroute`/`mtr` 路径诊断、`dig`/`nslookup` DNS 查询，以及 NetworkManager/Netplan/ifcfg 三系配置入口。 |
| [网络工具](./network/network-tools.md) | 数据传输与远程操作：`curl`/`wget` HTTP 请求与下载、`ssh` 免密与端口转发、`scp`/`sftp`/`rsync` 文件同步、`nc`/`tcpdump` 抓包与端口探测、`nmap` 扫描与 `iptables`/`nftables` 基础。 |

推荐顺序：先读[网络管理命令](./network/network.md)把"本机网络状态"查清楚，再读[网络工具](./network/network-tools.md)处理"跨机器通信"。读完自检：当同事说"你的服务访问不了"，你能不假思索地依次跑出 `ip addr`、`ping -c 2 网关`、`curl -v http://服务地址`、`ss -tlnp | grep 端口`，本章即算过关。

## 三系差异速览

| 场景 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 查/配 IP | `ip`（预装） | `ip`（预装） | `ip`（预装） |
| 查端口 | `ss`（预装） | `ss`（预装） | `ss`（预装） |
| 旧命令 `ifconfig`/`netstat` | 需 `sudo apt install net-tools`/`netstat-tools` | 需 `sudo pacman -S net-tools`（部分已从仓库移除） | 需 `sudo dnf install net-tools`/`net-tools` |
| 持久化网络配置 | Netplan（`/etc/netplan/*.yaml`，`netplan apply`） | 常用 systemd-networkd（`/etc/systemd/network/*.network`）或 NetworkManager | ifcfg 脚本（`/etc/sysconfig/network-scripts/`，RHEL 9 起为 keyfiles）或 NetworkManager |
| 防火墙 | `ufw`（`sudo ufw allow 22/tcp`） | 自选 `nftables`/`iptables`，无默认前端 | `firewalld`（`sudo firewall-cmd --add-port=22/tcp --permanent`） |
| 网络服务重启 | `sudo netplan apply` | `sudo systemctl restart systemd-networkd` | `sudo nmcli connection up 网络名` 或重启 NetworkManager |
| 装 `curl`/`wget` | 通常预装 `curl`，`wget` 需安装 | `sudo pacman -S curl wget` | `sudo dnf install curl wget`（wget 可能未预装） |
| 装 `nmap`/`tcpdump` | `sudo apt install nmap tcpdump` | `sudo pacman -S nmap tcpdump` | `sudo dnf install nmap tcpdump` |

最容易踩的差异点是**改网络配置的位置**：
Ubuntu 用 Netplan YAML，
RHEL 用 ifcfg 或 keyfile，
Arch 常直接写 systemd-networkd 单元文件。
在 A 系统改好的配置文件拷到 B 系统不但不生效，
还可能让机器彻底失联——
远程改网络前，
一定先确认发行版和配置格式，
并保留回滚手段（控制台/带外管理）。

## 常见坑

1. **改错网络配置把自己踢下线**。
   远程执行 `netplan apply` 或重启 NetworkManager 前，
   先用 `netplan try`（Ubuntu 提供 120 秒回滚倒计时）或确保有控制台访问。
   SSH 会话断开而配置未生效时，
   不要反复重连，
   先从物理/云控制台进去。
2. **防火墙没开，
   却以为"服务没起"**。
   `ss -tlnp` 显示端口在监听，
   外部仍连不上，
   下一步就该查防火墙：
   Ubuntu `sudo ufw status`、
   RHEL `sudo firewall-cmd --list-all`、
   Arch 看 `nft list ruleset`。
   本机 `curl 127.0.0.1` 通、
   外部 IP 不通，
   几乎一定是防火墙或安全组。
3. **DNS 通了当网络通，
   或网络通了当 DNS 通**。
   `ping 域名` 失败可能只是 DNS 问题，
   `ping IP` 成功则说明链路没问题。
   诊断顺序固定：
   先 `ping 8.8.8.8`（测链路），
   再 `ping 域名`（测解析），
   两者分开看。
4. **`curl` 不加 `-I`/`-v`，
   看不出状态码**。
   `curl http://服务` 只输出 body，
   502/404 混在 HTML 里很难发现；
   加 `curl -s -o /dev/null -w '%{http_code}\n' URL` 只拿状态码，
   或 `curl -v` 看握手全过程。
5. **`ssh` 报 `Host key verification failed` 或 `Permission denied (publickey)`** 前两个是 known_hosts 记录了旧指纹（服务器重装后常见），
   后者是密钥/权限问题——
   检查 `~/.ssh` 为 `700`、
   `~/.ssh/authorized_keys` 为 `600`、
   `sshd_config` 中 `PubkeyAuthentication yes`。
6. **`rsync` 把本地路径和远端路径写反，
   或忘了目标目录后的 `/`**。
   `rsync -av dir/ user@host:/path/` 与 `rsync -av dir user@host:/path/` 结果不同（带尾斜杠是"拷内容"，
   不带是"拷目录本身"）。
   先 `rsync -avn` 干跑预览。
7. **在脚本里用 `ping -c` 忘记退出码**。
   Linux 的 `ping` 正常退出码是 0（通）/非 0（不通），
   可以直接用于 `if ping -c1 目标; then ...; fi`，
   不要解析输出文本。
8. **把云主机的安全组/ACL 忘在脑后**。
   本地 `firewalld` 全开了，
   云平台安全组没放行 443，
   外部照样不通。
   排查时"本机防火墙 → 云安全组 → 对端防火墙"三层都要过一遍。

## 常见问题

**Q1：`ping` 通但 `curl` 不通，问题出在哪？**

`ping` 走 ICMP，只证明"网络层可达"；
`curl` 走 TCP 应用层，还要过**端口、监听地址、防火墙/安全组**三关。
按层排查：
`ss -tlnp | grep 端口` 看服务是否在监听、绑的是 `0.0.0.0` 还是只绑了 `127.0.0.1`；
`curl -v` 看是连不上（超时/TCP 层）还是连上了但返回 5xx/4xx（应用层）；
本机 `ss` 有监听、外网不通，再去查安全组和 `iptables -L -n`。
把"通"拆成 ICMP 可达、TCP 握手成功、HTTP 返回正确三级，
九成"玄学网络问题"立刻变得可定位。

**Q2：`ip` 和 `ifconfig` 都能看地址，用哪个？**

用 **`ip`**（来自 `iproute2`，三系均预装）。
`ifconfig` 属于已停止维护的 `net-tools`，
在多网卡别名、IPv6、策略路由场景下信息不全甚至误导。
对应关系大致是：
`ifconfig` → `ip addr`，
`route -n` → `ip route`，
`arp -n` → `ip neigh`。
写进脚本/文档时统一用 `ip`，
避免新系统压根没装 `net-tools` 导致脚本第一步就挂。

**Q3：`ssh` 每次都要密码，能免密吗？**

可以，用**公钥登录**：
本地执行 `ssh-keygen -t ed25519` 生成密钥对，
再 `ssh-copy-id user@host`（或手动把 `~/.ssh/id_ed25519.pub` 追加到目标机的 `~/.ssh/authorized_keys`），
注意权限必须是 `chmod 700 ~/.ssh`、`chmod 600 ~/.ssh/authorized_keys`，
否则 sshd 会因"权限太开放"直接拒绝。
跳板机场景用 `~/.ssh/config` 的 `ProxyJump` 串起来，
比手工 `ssh -J` 更好记。
**不要**为了省事把私钥设成无口令后到处拷贝——
丢了私钥等于丢了整台机器的门。

**Q4：`firewall-cmd`、`nft`、`ufw`、安全组，到底改哪个？**

三系默认各不相同，但排查顺序是固定的：
先看**云平台安全组**（最外层，本地怎么开都白搭）→
再看**系统防火墙**：
Debian/Ubuntu 默认 `ufw`（若启用）、
RHEL/CentOS/Rocky 默认 `firewalld`（`firewall-cmd --list-ports`）、
Arch 常见 `nftables`/`iptables`（`nft list ruleset`）→
最后才怀疑应用自己的监听地址。
临时验证可以先 `systemctl stop firewalld`（或 `ufw disable`），
通了就说明是防火墙规则问题，再把规则补回去；
**验证完务必恢复**，不要把"关防火墙"当成解决方案提交到生产。

## 参考资料

- `man ip`, `man ss`, `man ping`, `man curl`, `man ssh`, `man rsync`, `man dig`
- 鸟哥的私房菜 - 网络基础与指令 — [linux.vbird.org](https://linux.vbird.org/linux_server/0110networkbasic.php)
- Arch Wiki - Networking — [wiki.archlinux.org](https://wiki.archlinux.org/title/Networking)
- Arch Wiki - iproute2 — [wiki.archlinux.org](https://wiki.archlinux.org/title/Iproute2)
- Arch Wiki - SSH — [wiki.archlinux.org](https://wiki.archlinux.org/title/SSH)
- Arch Wiki - nftables — [wiki.archlinux.org](https://wiki.archlinux.org/title/Nftables)
- iproute2 手册（ss/ip） — [man7.org](https://man7.org/linux/man-pages/man8/ip.8.html)
- curl 手册 — [curl.se](https://curl.se/docs/manpage.html)
- Red Hat 文档 - Configuring and managing networking — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_and_managing_networking/index)
- Ubuntu - Netplan 文档 — [netplan.io](https://netplan.io/)
