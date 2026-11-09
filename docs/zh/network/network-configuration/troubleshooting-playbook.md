# 实战案例与常见坑

> 本文属于[网络配置基础](../network-configuration.md)——
> 固定顺序的诊断脚本、迁移检查清单，
> 以及配置管理的高频坑。

## 一键诊断脚本

把[管理者识别](manager-detection.md)、
[路由](routing.md)、
[DNS](dns.md)
的观测命令串起来，
形成最小诊断集，
任何网络工单先跑一遍：

```bash
#!/bin/bash
echo "=== 1. 接口状态 ==="
ip -br addr
echo "=== 2. 路由 ==="
ip route show
echo "=== 3. DNS 来源 ==="
ls -l /etc/resolv.conf
grep -E '^hosts' /etc/nsswitch.conf
echo "=== 4. 连通性 ==="
ping -c 2 -W 2 192.168.1.1 >/dev/null && echo "网关: OK" || echo "网关: FAIL"
ping -c 2 -W 2 8.8.8.8      >/dev/null && echo "公网: OK" || echo "公网: FAIL"
ping -c 2 -W 2 example.com   >/dev/null && echo "DNS : OK" || echo "DNS : FAIL"
```

脚本的价值在于**顺序固定**：
先看配置（1-2），
再看解析来源（3），
最后分层探测（4）。
任何一步 FAIL
都能把范围收窄到对应层，
避免上来就抓包的低效。
把网关地址与目标域名
提成脚本头部变量，
换环境时只改两行即可复用。

## 迁移检查清单

跨发行版迁移或重装后，
按清单核对可避免多数配置丢失：

1. 确认新系统的网络管理器
   （[管理者检测命令](manager-detection.md)），选对配置入口。
2. 导出旧机地址、路由、DNS
   （`ip addr`、`ip route`、
   `cat /etc/resolv.conf`），
   对照写入新配置。
3. 用 `netplan try` / `nmcli con up` /
   `networkctl reload` 应用，
   并保留回滚窗口。
4. 验证三层连通
   （网关、公网 IP、域名），
   再验证业务端口。
5. 确认配置写在了持久层，
   而不是仅用 `ip` 临时改过——
   重启一次做终检。

清单的第 5 步最容易被跳过，
却正是"上午配好、下午重启就丢"
的唯一防线。
把重启验证写进变更流程，
比记住每个管理器的细节更省心。

## 常见坑

- **改了 resolv.conf 立刻被还原**。
  多半是它由 systemd-resolved
  或 NetworkManager 托管。
  按[解析链路全景](dns.md)先 `ls -l` 判断归属，
  改管理器暴露的配置项，
  而不是直接编辑文件。
- **Netplan apply 后失联**。
  YAML 缩进错误或
  `renderer` 与实际后端不匹配
  会导致 apply 失败或接口消失。
  远程操作务必用 `netplan try`，
  给系统留 60 秒自动回滚。
- **两个管理器同时 active**。
  NetworkManager 与 networkd 并存
  会互相覆盖地址与 DNS，
  表现为配置"随机"回滚。
  用 `systemctl disable`
  停掉不需要的那个，
  只保留单一管理者。
- **设备名漂移导致配置失效**。
  克隆虚拟机或调整硬件后
  `eth0` 可能变成 `ens192`，
  基于名字的匹配全部落空。
  改用 MACAddress 匹配，
  或启用 `net.ifnames=0`
  统一命名
  （需评估对既有运维脚本的影响）。
- **把 `ip route show cache`
  当排障依据**。
  新版内核已移除路由缓存，
  该命令无输出是正常现象，
  不是"缓存丢了"。
- **强制网卡速率/双工**。
  除非交换机侧也显式配置，
  否则保持自协商；
  双工不匹配的症状是
  "半通不通、大量 retrans"，
  在 `ethtool` 与交换机端口两侧
  都要核对。
- **VLAN 子接口 UP 但收不到流量**。
  检查交换机 trunk
  是否放行该 VLAN，
  以及父接口是否处于正确模式；
  用 `tcpdump -e`
  看帧 tag 是否匹配。
- **永久路由写进了临时脚本**。
  `rc.local` 或运维临时命令里的
  `ip route add`
  重启即失。
  按[添加与持久化](routing.md)改回管理器配置。

配置正确后仍然存在的故障，
继续用分层推理，见
[网络故障排除](../troubleshooting.md)。
