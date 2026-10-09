# KVM 虚拟化

容器解决的是同一内核下如何隔离进程，虚拟机回答的是另一个问题——这台机器上要不要有第二个内核。判断可以直接给：要跑与宿主机不同内核或不同操作系统（Linux 宿主机上跑 Windows、BSD，或在同一台机器上验证另一套发行版），或要用硬件边界隔离不同租户、保留整机快照回滚的能力，选虚拟机；同内核服务的密集部署，继续用[容器](../container/docker.md)。KVM 是 Linux 内核自带的虚拟化方案：内核模块借助 CPU 的 VT-x/AMD-V 硬件辅助直接执行客户机指令，QEMU 负责模拟设备，libvirt 把两者收拢成统一的 API 与工具链。这套组合是 Linux 世界使用最广的服务器虚拟化栈，Red Hat 的企业虚拟化产品线就建立在它之上。

> 内容参考自 libvirt 与 QEMU/KVM 官方文档、Arch Wiki，见文末参考资料。

## 学习目标

- 分清 KVM、QEMU、libvirt、virsh 的层次关系，能顺着一条 `virsh start` 讲清命令最终落到哪一层
- 会检查 CPU 虚拟化标志与内核模块状态，能在固件、内核两层之间定位"为什么开不了 KVM"
- 掌握 Debian/Ubuntu、Arch、RHEL/Rocky 三系安装路径，理解 libvirt 组与 qemu:///system 的权限关系
- 能配置默认 NAT 网络与桥接网络，知道虚拟机要拿局域网 IP 时改动落在哪一层配置
- 会用 virt-install 建虚拟机、用 virsh 完成日常管理、用 qemu-img 管理镜像与快照
- 能按"虚拟机 vs 容器"分工表对具体场景给出选型，并说明依据

## 1. 四个名字的关系：内核、设备、管理、前端

初学者容易把 KVM、QEMU、libvirt、virsh 当成四个同类工具来比较，实际上它们是自下而上的四层，缺一层整条链路就不通：

| 层 | 组件 | 职责 | 形态 |
|---|------|------|------|
| 内核层 | KVM（`kvm.ko`、`kvm_intel`/`kvm_amd`） | 依赖 CPU 的 VT-x/AMD-V 硬件辅助虚拟化 CPU 与内存，客户机指令大部分直接在物理 CPU 上执行 | 内核模块，随内核发布 |
| 设备层 | QEMU | 模拟整机外设：磁盘控制器、网卡、显卡、中断控制器；没有 /dev/kvm 时也能纯软件模拟整机，只是速度明显下降 | 用户态进程，每台虚拟机一个 |
| 管理层 | libvirt（libvirtd 及模块化守护进程） | 统一 API：以 XML 描述虚拟机、网络、存储池，负责生命周期、热插拔、迁移 | 守护进程 + 库 |
| 前端层 | virsh / virt-manager / virt-install | 调 libvirt API 的命令行与图形工具 | 客户端程序 |

一条 `virsh start debian12` 的完整路径是：virsh 连上 libvirtd 的 socket，libvirtd 读 `/etc/libvirt/qemu/debian12.xml` 里的定义，fork 出 qemu 进程；qemu 打开 `/dev/kvm` 请求硬件辅助，自己继续模拟磁盘与网卡。理解分层之后故障定位就有了抓手：qemu 起不来，报错落在内核层（KVM 不可用）还是配置层（磁盘路径、XML 语法）一眼可分；virsh 连不上则与 KVM 本身无关，是 libvirt 层的问题——层与层的边界，对应完全不同的排查入口。

补充 QEMU 的独立价值：它脱离 KVM 也能跑（TCG 动态翻译，纯软件模拟），所以 x86 宿主机上可以直接起 ARM 镜像做跨架构验证，代价是执行速度远低于硬件辅助路径。日常服务器负载必须走 `/dev/kvm`，这一点是前提条件，不是可选项。

## 2. 前置检查：CPU、固件与内核模块

```bash
# 1) CPU 是否带虚拟化扩展：vmx 对应 Intel VT-x，svm 对应 AMD-V；输出大于 0 即具备
$ egrep -c '(vmx|svm)' /proc/cpuinfo
16
# lscpu 同样能看到这一行
$ lscpu | grep -i virtualization
Virtualization:                  VT-x
# 2) 内核模块是否加载：Intel 机器是 kvm_intel，AMD 机器是 kvm_amd
$ lsmod | grep kvm
kvm_intel     438272  0
kvm          1130496  1 kvm_intel
# 3) Debian/Ubuntu 可用 kvm-ok 做一站式体检（来自 cpu-checker 包）
$ sudo kvm-ok
INFO: /dev/kvm exists
KVM acceleration can be used
```

`egrep` 输出为 0 只有两种可能：CPU 硬件不支持，或者固件里没开。服务器上后者远比前者常见——进 BIOS/UEFI，Intel 平台找 "Intel Virtualization Technology / VT-x"，AMD 平台找 "SVM Mode"，打开后冷启动。模块没加载时 `sudo modprobe kvm_intel`（AMD 为 `kvm_amd`）手动拉起，多数发行版会在检测到硬件支持时自动加载；若 modprobe 报 Operation not supported，多半仍是固件开关没生效，回 BIOS 再查一遍。

另一个高频场景：宿主机本身就是虚拟机（云主机，或物理机上的 VM），此时 `/dev/kvm` 是否可用取决于上层是否开了嵌套虚拟化。Intel 平台在上层宿主加载模块时加 `kvm_intel nested=1`（AMD 的嵌套默认开启），云主机则要看厂商是否允许。嵌套没开时，二层虚拟机拿不到硬件加速或退回纯软件模拟——表现为本节的检查不过关，而不是安装报错。

## 3. 安装（三系对照）

| 操作 | Debian/Ubuntu | Arch | RHEL/Rocky |
|------|---------------|------|-----------|
| 安装 | `sudo apt install qemu-kvm libvirt-daemon-system libvirt-clients virtinst` | `sudo pacman -S qemu-full libvirt virt-manager dnsmasq` | `sudo dnf install @virtualization`（EL7 软件组；EL8/9 用 `dnf module install virt`，或直接 `dnf install qemu-kvm libvirt virt-install`） |
| 启用服务 | `sudo systemctl enable --now libvirtd` | 同左 | 同左 |
| 图形前端 | 追加 `virt-manager` | 已随上行装入 | 追加 `virt-manager` / `virt-viewer` |

包名差异值得说明：Debian 把守护进程拆成 `libvirt-daemon-system`、客户端拆成 `libvirt-clients`（virsh 在后者里），virt-install 与 virt-clone 都来自 `virtinst` 包；Arch 的 `qemu-full` 覆盖全部机型与工具（含 qemu-img），`virt-manager` 包依赖拆分出来的 `virt-install` 包；RHEL 8/9 把虚拟化打包成 `virt` 模块，`@virtualization` 是 EL7 时代的软件组写法，组名不存在的版本按包名安装即可。NAT 网络的 DHCP/DNS 由 dnsmasq 提供——Debian/RHEL 系会被依赖自动带入，Arch 上它是 libvirt 的可选依赖，要显式安装（顺带确认 `iptables-nft` 在场，默认网络需要它下防火墙规则）。

装完的用户组动作三系一致，权限含义也一致：

```bash
$ sudo usermod -aG libvirt,kvm $USER   # 重新登录后生效，newgrp libvirt 可立即生效
$ virsh --connect qemu:///system list --all
 Id   Name   State
--------------------
```

`libvirt` 组决定能否访问系统实例的 socket（`qemu:///system`，即 libvirtd 管理的那套虚拟机），`kvm` 组决定能否直接读写 `/dev/kvm`。不加组也能用 sudo 干活，但把日常账号放进 libvirt 组免 sudo 操作，是三系共同的惯例；组成员变更后必须重新登录，否则报错依旧，容易被误判成安装失败。

## 4. 网络：NAT 起步，桥接平权

### 4.1 默认 NAT 网络

libvirt 自带一个名为 `default` 的 NAT 网络：宿主机上多出一块 `virbr0` 网桥（地址 192.168.122.1），dnsmasq 负责给虚拟机发 192.168.122.0/24 段的地址，出网流量经宿主机 NAT 转发。效果是虚拟机能访问外网与宿主机，但局域网其它机器与外网访问不到虚拟机——要把端口发布出去，得在宿主机做 DNAT，规则写法见[路由与 NAT 篇](../routing-nat.md)。

```bash
$ virsh net-list --all                  # default 常见于 inactive 状态
 Name      State      Autostart   Persistent
---------------------------------------------
 default   inactive   no          yes
$ virsh net-start default && virsh net-autostart default  # 拉起并设为随服务自启
$ ip addr show virbr0                   # 应看到 192.168.122.1/24
$ sysctl net.ipv4.ip_forward            # NAT 依赖转发开关，确认是 1
```

### 4.2 桥接：让虚拟机拿局域网 IP

NAT 把虚拟机藏在宿主机后面，有些场景行不通：虚拟机要对外提供服务、要被局域网直接访问、要像物理机一样从路由器拿地址。做法是在宿主机建网桥 `br0`，物理网卡降为网桥成员，IP 挪到 br0 上，虚拟机的虚拟网卡直接挂 br0——从此虚拟机与宿主机在局域网里平权。麻烦在于"宿主机怎么建桥"恰好是三系差异最大的地方。

Debian 传统 ifupdown，写 `/etc/network/interfaces`：

```text
auto br0
iface br0 inet dhcp
    bridge_ports enp3s0        # 物理网卡降为成员，地址挪到 br0
```

Ubuntu 较新版本用 netplan，写 `/etc/netplan/*.yaml`：

```yaml
network:
  version: 2
  ethernets:
    enp3s0: { dhcp4: no }
  bridges:
    br0:
      interfaces: [enp3s0]
      dhcp4: true
```

RHEL 系与桌面态 Ubuntu 常见 NetworkManager：

```bash
nmcli con add type bridge ifname br0 con-name br0
nmcli con add type bridge-slave ifname enp3s0 master br0
# 原网卡上的 IPv4 配置要挪到 br0，再重启连接
```

一个共同的风险必须先讲：建桥是把宿主机自己的网络推倒重接，配错一处 SSH 立刻失联。远程操作前确认有带外控制台（iLO/iDRAC/IPMI 或云厂商串口），或用 `at` 挂一个几分钟后执行的还原脚本兜底；改完用 `ip addr` 核对地址挂在 br0 上、物理网卡不再持有 IP，才算接对了。顺带一句 macvtap：`<interface type='direct'>` 让虚拟机直接借用物理网卡收发，省去建桥，但宿主机与同网卡上的虚拟机之间默认无法互通，临时实验可用，正式环境仍选桥接。

## 5. 存储：镜像格式与存储池

### 5.1 qcow2 与 raw

| | qcow2 | raw |
|--|-------|-----|
| 空间占用 | 稀疏分配，按实际写入增长，`ls` 的虚拟大小远大于 `du` 的真实占用 | 文件即全量（文件系统稀疏文件除外） |
| 内部快照 | 支持，状态存在镜像文件内部 | 不支持 |
| 后备镜像链 | 支持 backing file，可做差量盘 | 不支持 |
| I/O 路径 | 多一层元数据，开销集中在随机写时的查找与分配 | 无格式开销，路径最短 |

选型判断：系统盘、需要快照回滚的测试机、要派生差量盘的模板，用 qcow2；对随机写敏感的数据库盘，要么 raw 放本地盘，要么直接给虚拟机挂 LVM 块设备。也别把 raw 神化——顺序读写在两种格式间差距不大，qcow2 的开销集中在随机写，而稀疏分配省下的磁盘同样是真金白银，容量紧张的机器 qcow2 往往是更务实的选择。

### 5.2 qemu-img 日常

```bash
$ qemu-img create -f qcow2 /var/lib/libvirt/images/db01.qcow2 20G
$ qemu-img info /var/lib/libvirt/images/db01.qcow2
virtual size: 20 GiB
disk size: 196 KiB        # 实际磁盘占用——虚拟大小与真实占用的差距一目了然
$ qemu-img convert -O raw -p db01.qcow2 db01.raw   # -p 显示进度；转换会读全链，顺带摊平后备链
```

`convert` 是最常用的搬运动作：换格式、摊平快照链、把 LVM 块设备导出成文件，都走它。

### 5.3 存储池

libvirt 用存储池（storage pool）回答"镜像放在哪、由谁记账"：装好即有的 `default` 池对应 `/var/lib/libvirt/images` 目录，`virsh pool-list` 看池，`virsh vol-list default` 看卷。池还能指向 LVM 卷组、iSCSI、NFS。要注意记账边界——手工 `qemu-img create` 出来的文件 libvirt 看不见，要么用 `virsh vol-create-as` 让池来建，要么建完 `virsh pool-refresh` 补登记。根分区偏小的机器，应当尽早用 `virsh pool-define-as dir --target /data/vm-images` 把池指向大盘分区，而不是等着 `/var` 被写满（见常见故障）。

### 5.4 virtio 为什么快

模拟设备慢在"连协议一起仿真"：客户机内核以为自己在操作真实的 IDE 磁盘或 e1000 网卡，每次读写 I/O 寄存器都要从客户机陷出到 QEMU。virtio 是半虚拟化驱动——客户机内核明确知道自己跑在虚拟机里，用共享内存环形队列与宿主机批量交换数据，绕开了对真实硬件寄存器协议的逐条仿真。所以本页 virt-install 示例里磁盘 `bus=virtio`、网卡 `model=virtio` 是默认选择；Linux 客户机内核自带 virtio 驱动，Windows 客户机需要额外挂 virtio-win 驱动盘安装。虚拟机里磁盘设备名是 `/dev/vda` 而不是 `/dev/sda`，看到 vda 就说明 virtio 生效了。

## 6. 用 virt-install 建虚拟机

```bash
$ virt-install \
    --name debian12 \          # 虚拟机名，之后 virsh 全程用它指代
    --memory 2048 \            # 内存，单位 MiB
    --vcpus 2 \                # vCPU 个数
    --disk path=/var/lib/libvirt/images/debian12.qcow2,size=20,format=qcow2,bus=virtio \
    --cdrom /var/lib/libvirt/images/debian-12.5.0-amd64-netinst.iso \
    --network network=default,model=virtio \   # 挂到 default NAT 网络
    --graphics spice \         # 图形控制台协议，virt-manager / virt-viewer 连它
    --os-variant debian12      # 来自 osinfo 数据库，osinfo-query os 查全列表
```

逐参数拆开看：

- `--name` / `--memory` / `--vcpus` 对应 XML 里的名称、内存与 vCPU 数量。内存与 vCPU 可用 `virsh setmem` / `setvcpu` 在线调整（上限受定义时的 max 值约束），改名则要 dumpxml 导出改完再重定义。
- `--disk` 的每个字段各管一件事：`path` 是镜像落点（放在存储池目录内），`size=20` 是 20 GiB 的虚拟大小，`format=qcow2` 前文刚对比过，`bus=virtio` 决定客户机看到 vda 还是 sda。
- `--cdrom` 挂 ISO 作光驱，只在安装时需要；`--location` 是它的替代品，好处是能配合 `--extra-args 'console=ttyS0'` 把安装过程重定向到串口。
- `--network network=default` 接 4.1 的 NAT 网络，换成 `bridge=br0` 就接到 4.2 的局域网桥上，网卡模型同样选 virtio。
- `--graphics spice` 提供图形控制台；无图形环境的服务器改用 `--graphics none --console pty,target_type=serial`，配合 `--location` 与 `--extra-args`，纯文本完成安装。
- `--os-variant` 不只是个标签：它决定 QEMU 暴露的机型与一系列针对该发行版的优化开关。写错不一定立刻报错，但会平白多踩兼容性坑，装前用 `osinfo-query os` 核对一次。

装完之后，日常管理就是下面这组 virsh：

```bash
$ virsh list --all                          # 含关机虚拟机的完整清单
$ virsh start debian12                      # 开机
$ virsh shutdown debian12                   # ACPI 关机；客户机不响应时才用下一个
$ virsh destroy debian12                    # 拔电源式强停，丢未落盘数据，仅应急
$ virsh console debian12                    # 串口控制台，Ctrl+] 退出
$ virsh domblklist debian12                 # 磁盘清单，找 qcow2 路径靠它
$ virsh domifaddr debian12 --source lease   # 从 dnsmasq 租约查 NAT 网络里的 IP
$ virsh autostart debian12                  # 设为随 libvirtd 开机自启
$ virsh edit debian12                       # 改 XML 定义，保存前自动做语法校验
```

两个习惯值得固定下来。其一，关机优先 `shutdown`——它发 ACPI 事件，等价于按一下电源键，`destroy` 留给客户机卡死的场景；客户机要响应 shutdown 需装 acpid（多数发行版镜像已带），要让 `domifaddr` 查得更准，在客户机里装 qemu-guest-agent，virsh 的 `--source agent` 就能用上。其二，改配置永远走 `virsh edit`，不要直接改 `/etc/libvirt/qemu/*.xml`——libvirtd 持有定义，直接改文件既不生效也可能被运行态覆盖。

## 7. 快照与克隆

### 7.1 内部快照与外部快照

```bash
# 内部快照：状态写进 qcow2 文件内部的快照区
$ virsh snapshot-create-as debian12 clean-install --description "装完系统打点"
$ virsh snapshot-list debian12
$ virsh snapshot-revert debian12 clean-install     # 一键回滚到打点时刻
$ virsh snapshot-delete debian12 clean-install
# 外部快照：原镜像转为只读基盘，新写入落入 overlay 文件
$ virsh snapshot-create-as debian12 snap2 --disk-only --atomic
$ qemu-img info /var/lib/libvirt/images/debian12.qcow2   # 可见 backing file 指向上一环
```

内部快照有两个前提：磁盘是 qcow2（raw 没有内部快照存储），且客户机用传统 BIOS 启动——UEFI 固件的 NVRAM 变量不在 qcow2 里，libvirt 会直接拒绝为这类虚拟机做内部快照。运行中的虚拟机加 `--memspec` 可以把内存状态一并写进 qcow2，回滚后进程现场仍在。外部快照生成的是后备链（base 加 overlay），更灵活也更麻烦：virsh 的 `snapshot-revert` 不支持回滚到外部快照，合并要靠 `virsh blockcommit`；链上任何一环都不能单独删除或改名，动手前先 `qemu-img info --backing-chain` 看清链条。需要"随时回滚"的测试场景，内部快照更顺手；把回滚做在文件系统层（btrfs/ZFS 快照）也是成熟做法，此时虚拟机内部无需任何配合。

### 7.2 克隆与链式镜像的坑

```bash
$ virt-clone --original debian12 --name debian12-tpl --auto-clone
# 磁盘整盘复制，UUID 与 MAC 由 virt-clone 重新生成
```

克隆只解决宿主机侧的重复：客户机内部仍是同一份 `/etc/machine-id`、同一组 SSH 主机密钥、同一个主机名。machine-id 相同会让 NAT 网络里的 dnsmasq 把两台机器当成同一个 DHCP 客户端，可能分到同一个地址；SSH 主机密钥相同则触发中间人告警。批量派生前用 libguestfs 的 `virt-sysprep` 重置这些标识，比逐台手工改可靠。

"模板基盘 + 差量盘"是克隆的文件级版本：`qemu-img create -f qcow2 -b base.qcow2 -F qcow2 diff.qcow2` 让新虚拟机只写差异，省空间也省部署时间，坑也随之集中——基盘一旦改名或移动，整条链断掉，用 `qemu-img rebase -u` 修正路径；基盘绝不能以读写方式被多台虚拟机共享，新版 QEMU 会用文件锁拒绝第二个写者（报 `Failed to get "write" lock`），这是保护机制而不是故障；要彻底解开链条，`qemu-img convert` 成新文件即摊平。纪律只有一条：模板保持只读，派生盘各自独立，删任何一环之前先看清链条关系。

## 8. 虚拟机 vs 容器：分工与选型

| 维度 | 虚拟机（KVM） | 容器（Docker 等） |
|------|--------------|------------------|
| 隔离边界 | 整机：独立内核、独立设备视图，Hypervisor 划界 | 进程：共享宿主机内核，namespace/cgroup 划界 |
| 可运行的系统 | 内核与宿主机无关，Windows、BSD、任意 Linux 皆可 | 只能是宿主机内核之上的 Linux 用户态 |
| 启动 | 十秒到分钟级，完整引导过程 | 秒级，本质是拉起受限进程 |
| 单机密度 | 低，每台都要完整内核与基础内存 | 高，同内核下可密集部署 |
| 快照与回滚 | 整机快照，连内核状态一起冻结 | 镜像层加数据卷，不含运行中的内核状态 |
| 迁移 | libvirt 在线热迁移是成熟能力 | 重新调度再拉起，无内存态迁移 |
| 典型场景 | 异构 OS、强隔离租户、整机快照、内核实验 | 同构服务的密集部署与快速交付 |

选型只问一个问题：负载要不要一个不同的内核。要——跑 Windows、验证另一套发行版内核、给不同租户硬件级边界——虚拟机没有替代品；不要——同内核的 Web、缓存、任务进程——容器的密度与速度优势难以撼动。生产环境里两者更多是叠加而非二选一：物理机上用虚拟机切出带独立内核的边界，虚拟机里再用容器提高密度。[容器篇](../container/docker.md)第 1 节的同一张表给出了反向视角，对照着读，选型的两个方向就都齐了。

## 常见故障

**virsh 报 failed to connect to the hypervisor。** 按"URI → 进程 → 权限"的顺序查：`virsh --connect qemu:///system list` 显式指定系统实例，普通用户默认可能连到每用户独立的 `qemu:///session`，看不到系统虚拟机；`systemctl status libvirtd` 确认守护进程活着，部分新发行版把守护进程拆成 virtqemud、virtnetworkd 等模块化单元，单元名相应变化；进程正常仍 Permission denied，把用户加入 `libvirt` 组并重新登录。三处都对上仍不通，再 `journalctl -u libvirtd -n 50` 看守护进程自己的日志。

**桥接改完宿主机失联。** 根因几乎都是"IP 没挪到 br0 上"——物理网卡与网桥两处都配了地址导致路由混乱，或网桥根本没有接管连接。预防比修复重要：执行这类改动前先确认带外控制台可达，或挂延时还原脚本；修复时把 IP、网关、DNS 全部搬进 br0 的配置，物理网卡只留成员身份，`ip addr` 核对地址落在 br0 后再断开控制台。无线网卡不要做桥接，多数无线驱动不支持多地址帧，直接不通。

**默认存储池路径不存在。** 报 no storage pool 'default' 或找不到 `/var/lib/libvirt/images`：目录被清理，或 `default` 池处于 inactive。`virsh pool-list --all` 看状态，inactive 就 `virsh pool-start default`；目录确实没了就重建后 `virsh pool-refresh`。更根本的解法见 5.3 节——把池定义到大分区上，virt-install 的 `--disk` 路径随之更新。

**虚拟机起不来，报 VT-x 不可用。** qemu 报 the virtualization extensions are not available 或 `/dev/kvm` 缺失，按"固件 → 内核 → 嵌套"三层查：`egrep -c '(vmx|svm)' /proc/cpuinfo` 为 0 而 CPU 规格本身支持，是 BIOS 里 VT-x/AMD-V 没开；数值正常但模块缺失，`modprobe kvm_intel`（AMD 为 `kvm_amd`）看报错；宿主机本身是虚拟机时，确认上层开了嵌套虚拟化（Intel 需 `kvm_intel nested=1`），否则二层虚拟机退回纯软件模拟，速度明显下降。

**宿主机磁盘被镜像写满。** qcow2 只增不减是设计行为：删客户机内的文件不会缩小镜像，内部快照也全部藏在 qcow2 里。处置顺序：`df -h /var/lib/libvirt/images` 定位分区，`qemu-img info --backing-chain` 找链上最大的环节，客户机内 `fstrim -a`（磁盘设备开 discard）回收空洞，必要时 `qemu-img convert` 重写一份干净镜像，再逐个 `virsh snapshot-delete` 回收快照。扩容走 `qemu-img resize` 加客户机内 growpart；但根治手段还是让存储池一开始就待在大盘分区上。

## 参考资料

- libvirt 文档 — [libvirt.org/docs.html](https://libvirt.org/docs.html)
- QEMU 文档 — [www.qemu.org/docs/master](https://www.qemu.org/docs/master/)
- Arch Wiki: KVM — [wiki.archlinux.org/title/KVM](https://wiki.archlinux.org/title/KVM)
- Arch Wiki: Libvirt — [wiki.archlinux.org/title/Libvirt](https://wiki.archlinux.org/title/Libvirt)
- Red Hat 产品文档（虚拟化） — [docs.redhat.com](https://docs.redhat.com/)
