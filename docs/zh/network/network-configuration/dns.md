# DNS 配置与解析路径

> 本文属于[网络配置基础](../network-configuration.md)——
> 从 `getaddrinfo()`
> 到 `/etc/resolv.conf` 的完整链路，
> 以及怎么改 DNS 才不会被覆盖。

## 解析链路全景

DNS 出问题时，
很多人只会反复
`vi /etc/resolv.conf`，
却发现"改了又被改回去"。
要避免这种徒劳，
必须先看清完整链路。

1. 应用调用 `getaddrinfo()`（glibc）。
2. glibc 读取 `/etc/nsswitch.conf`
   的 `hosts:` 行，
   常见为 `files dns`
   或 `files resolve dns`，
   决定先查 `/etc/hosts`
   还是直接走 DNS；
   启用 `resolve` 时
   还会经 systemd-resolved
   的 D-Bus 接口。
3. 若走 DNS，
   查询被发往
   `/etc/resolv.conf`
   里列出的 `nameserver`。
4. 在启用了 systemd-resolved 的系统上，
   `/etc/resolv.conf`
   是指向 `127.0.0.53:53`
   的符号链接，
   真正的上游 DNS 配置在
   `/etc/systemd/resolved.conf`，
   由 resolved 汇聚后再对外查询。
5. NetworkManager 也可能托管
   `resolv.conf`
   （`PEERDNS=yes` 时），
   DHCP 下发的 DNS 会直接写进去。

因此 `resolv.conf`
既可能是真实文件，也可能是 symlink；
改错对象就会出现
"保存成功但立刻被还原"。
确认归属：

```bash
$ ls -l /etc/resolv.conf
lrwxrwxrwx 1 root root 39 ... /etc/resolv.conf -> ../run/systemd/resolve/stub-resolv.conf

$ resolvectl status
Link 2 (eth0)
    Current DNS Server: 192.168.1.1
       DNS Servers: 8.8.8.8 8.8.4.4
```

Ubuntu 22.04+ 与多数新发行版
默认走 stub 模式（`127.0.0.53`）；
RHEL 默认不用 resolved，
由 NetworkManager 直接写
`/etc/resolv.conf` 真实文件。
**先用 `ls -l` 看清链接关系，
再决定改哪里**。

链路里最容易被忽略的是第 2 步：
`nsswitch.conf` 决定了
`files` 与 `dns` 谁先谁后。
有人在 `/etc/hosts`
加了条目却不生效，
原因往往是这台机器的
`hosts:` 行把 `dns` 排在了前面，
或者中间插了 `mymachines`、`resolve`
之类模块改变了顺序。
**改 hosts 不生效时，
先 `grep '^hosts' /etc/nsswitch.conf`**，
再怀疑缓存或权限。

## 配置文件与生效方式

```bash
# /etc/resolv.conf 基本条目
nameserver 8.8.8.8
nameserver 8.8.4.4
search example.com
options timeout:2 attempts:3

# /etc/hosts 本地静态映射
127.0.0.1   localhost
192.168.1.100 myserver.example.com myserver

# systemd-resolved 的持久配置
# /etc/systemd/resolved.conf
[Resolve]
DNS=8.8.8.8 8.8.4.4
FallbackDNS=1.1.1.1
```

`options timeout`/`attempts`
控制单次查询超时与重试，
弱网环境下适当放宽
可减少解析假失败。
修改 resolved 配置后需
`sudo systemctl restart systemd-resolved`；
修改 `nsswitch.conf`
则影响全局解析顺序，
动之前先确认没有应用依赖特定顺序。

NetworkManager 场景下，
正确做法是改连接的 DNS 属性
而不是直接编辑文件——
后者会在下次 DHCP 续租时被覆盖：

```bash
$ sudo nmcli connection modify office ipv4.dns "8.8.8.8 8.8.4.4"
$ sudo nmcli connection up office
```

每个 `nameserver`
必须单独占一行，
写成
`nameserver 8.8.8.8 8.8.4.4`
只会解析第一个、
甚至整行报错——
这是从脚本 `echo`
拼配置时最常见的低级错误。

## 观测与排障

观测与排障用这几条命令：
`resolvectl statistics` 看缓存统计，
`resolvectl query example.com` 验证单条解析，
`dig +norecurse example.com @192.168.1.1`
强制绕过缓存直问指定上游，
`sudo resolvectl flush-caches` 清缓存。

`dig @服务器`
可以直接指定上游，
用来区分
"本地配置错"与"上游 DNS 坏"：
若 `dig @8.8.8.8`
能解析而默认查询失败，
问题一定在本机的
resolv.conf/resolved 配置；
两者都失败则是上游或出口问题。
这条分界与
[网络故障排除](../troubleshooting.md)
中的推理链完全一致。

解析类问题还有一类是**搜索域副作用**：
配了 `search example.com` 后，
访问短名 `myserver`
会先拼成 `myserver.example.com` 查询。
多区域环境里，
搜索域顺序不同可能解析到
错误的同名主机——
"ping 通了却是另一台机器"
往往就是它干的。
排查时用 `dig +short FQDN.`
（注意末尾带点）绕过搜索域，
即可确认是不是这个问题。

绑定与 VLAN 拓扑有各自的解析与性能议题，见
[绑定、VLAN 与性能调优](advanced-topology.md)。
