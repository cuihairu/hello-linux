# 应用场景调研

文档要服务谁，决定要写什么。本页按四类场景列出外部可核实的事实，再逐类给出对本仓的要求与阅读路径，结论直接进 [差异表](./coverage-matrix.md)。本页引用的站点在 2026-10-08 均为实取（A 级）。

## 1. 场景与事实

### 1.1 服务器与云计算

openEuler 官网首页写明它是「面向数字基础设施的开源操作系统」，覆盖「服务器、云计算、边缘计算、嵌入式」四大核心场景，并同时支持 ARM、x86、RISC-V、LoongArch、PowerPC、SW-64 等多种计算架构（[openeuler.org](https://www.openeuler.org/)，2026-10-08 实取）。同为国内主流服务器发行版的 Anolis OS 把自己的定位写成「能为云上典型场景提供需求定制和优化的能力，100% 兼容 CentOS 软件生态」，并提供 CentOS 迁移脚本入口（[openanolis.cn](https://www.openanolis.cn/)，2026-10-08 实取）。

两条事实的含金量在于：服务器场景的读者处在「存量 CentOS 迁移 + 多架构并存」的状态，文档必须同时给出 RHEL 系命令与迁移注意点，不能只写一套。

### 1.2 边缘与嵌入式

同一段 openEuler 表述把边缘计算与嵌入式单列成两类场景，与服务器、云并列——这类设备上没有图形界面、存储小、启动链路与桌面机不同，涉及交叉编译、设备树、内核裁剪与启动引导。本仓当前对这条链的支撑是：源码篇的设备驱动框架页与硬件篇的体系结构页提到设备树，但全仓 `交叉编译` 零命中，没有面向嵌入式的独立入口。

### 1.3 桌面与开发

ArchWiki 目录页（镜像实取）把「视觉美化」（25 页）、「图形用户界面」（3 页）、「本地化」（14 页）、「输入」（2 页）并列为系统管理类目下的独立子项，说明桌面栈在同类权威文档里占一块固定篇幅。本仓现状（2026-10-08 统计）：全仓 `Wayland` 只在选发行版页出现 1 次、`Xorg` 只在 GRUB 页出现 1 次、`GNOME` 6 次且全部在安装与发行版介绍段落——桌面在调研时点是实打实的空白，本轮以新增的[桌面图形栈](../hardware/desktop-stack.md)页填补。

### 1.4 运维自动化

本仓自己的外链结构可以反推运维读者的工具面（本地全量统计，2026-10-08）：`docs.ansible.com` 7 条、`prometheus.io` 6 条、`docs.docker.com` 4 条、`www.brendangregg.com` 5 条，加上系统管理篇的自动化运维、备份恢复、例行性排程、性能优化四页——自动化、监控、备份、排程这条运维主线已经成形。缺的是把「多机账号一致性」（LDAP/SSSD，鸟哥服务器篇第十一章）纳入同一主线。

## 2. 场景对本仓的要求

| 场景 | 关键要求 | 本仓现状 | 处置 |
|------|---------|---------|------|
| 服务器与云 | 三系命令并排、存量系统迁移视角、多架构 | 服务器篇 21 页 + 系统管理篇 9 页，三系对照贯穿全仓 | 已覆盖 |
| 边缘与嵌入式 | 交叉编译、设备树、启动链路、无图形界面 | 此前只有设备树提及，无嵌入式入口 | 已补页（交叉编译与嵌入式），阅读路径见 4.2 节 |
| 桌面与开发 | Xorg/Wayland、显示管理器、桌面环境、输入法与字体 | 零散提及 | 补页（桌面图形栈） |
| 运维自动化 | 调度、编排、监控、备份、账号一致性 | 四条主线已有，账号一致性缺 | 已补 LVM、AppArmor、LDAP 三页 |
| 安全合规 | MAC 强制访问控制在两套发行版上的差异 | SELinux 5 页成体系，AppArmor 只有对照表一行 | 补页（AppArmor） |
| 虚拟化 | KVM/libvirt 建机与网络，与容器的分工 | 硬件篇给了安装命令，服务器篇只有容器页 | 补页（KVM 虚拟化） |

原先「记为缺口但本轮不补」的两项（嵌入式交叉编译专题、LDAP 统一账号）已在后续增量补齐，落成 [交叉编译与嵌入式](../source/cross-compile.md) 与 [LDAP 统一账号管理](../server/ldap.md) 两页；2026-10-10 差异表部分覆盖项 SSH 补独立页面 [SSH 远程登录](../server/ssh.md)，基础篇「第二十一章」补 [源码编译与 Tarball 安装](../basic/packages/tarball.md)，USAH 扩展选题补 [云计算与 cloud-init](../server/cloud-computing.md)、[CI/CD 与持续交付](../server/ci-cd.md) 两页；USAH 31 章与 TLCL 36 章逐条核对进[覆盖核对与差异表](./coverage-matrix.md) §4、§5；补全记录见 [缺口补全与核对修订](./gap-fill.md)。

## 4. 场景阅读路径

按第 1 节的四类场景，各给一条本仓页面的阅读顺序，从装机走到对应场景的进阶页。链接均指向仓库内页面，其中桌面一栏含本轮新增的[桌面图形栈](../hardware/desktop-stack.md)与[KVM 虚拟化](../server/virtualization/kvm.md)两页。

### 4.1 服务器与云

1. [安装 Linux](../basic/installation.md)，先有一台能登录的机器
2. [服务器网络参数配置](../server/network-parameters.md)，上线前配好地址、网关与 DNS
3. [SSH 远程登录](../server/ssh.md)，把管理通道配成密钥认证
4. [Nginx](../server/web/nginx.md)，搭一个对外的 Web 服务
5. [性能优化](../system-management/performance.md)，负载上来之后的排查手段
6. [安全加固](../security/hardening.md)，对外服务必须回头补的一课

### 4.2 边缘与嵌入式

1. [计算机体系结构](../hardware/architecture.md)，ARM、RISC-V 等架构与设备树的硬件视角
2. [设备驱动框架](../source/driver-framework.md)，设备树如何落到驱动
3. [交叉编译与嵌入式](../source/cross-compile.md)，交叉工具链、内核裁剪、rootfs 与 U-Boot 启动链
4. [内核编译与模块开发](../source/build-and-modules.md)，内核裁剪与编译的落点
5. [开机流程与引导排错](../system-management/boot-process.md)，无图形界面设备的启动链路

### 4.3 桌面与开发

1. [选择合适的发行版](../basic/installation/choose_distribution.md)，桌面发行版怎么挑
2. [安装过程](../basic/installation/process.md)，装出带桌面的系统
3. [桌面图形栈](../hardware/desktop-stack.md)，Xorg/Wayland、显示管理器、字体与输入法
4. [KVM 虚拟化](../server/virtualization/kvm.md)，开发测试用虚拟机的建法
5. [文本编辑和查看工具](../commands/text/editors.md)，改配置、写代码的日用工具

### 4.4 运维自动化

1. [自动化运维](../system-management/automation.md)，脚本与 Ansible 之间怎么选
2. [例行性工作排程](../system-management/scheduled-tasks.md)，cron 与 systemd timer
3. [Prometheus + Grafana](../server/monitoring/prometheus.md)，监控主线
4. [备份与恢复](../system-management/backup-and-recovery.md)，故障前的兜底手段
5. [账号管理](../basic/users/account_management.md)，单机账号是基线
6. [LDAP 统一账号管理](../server/ldap.md)，多机账号一个出口管

## 5. 参考资料

- openEuler 官网（场景与架构表述）— [openeuler.org](https://www.openeuler.org/)，2026-10-08 实取
- OpenAnolis 龙蜥社区（Anolis OS 定位与 CentOS 兼容）— [openanolis.cn](https://www.openanolis.cn/)，2026-10-08 实取
- ArchWiki 目录页（桌面与系统管理类目结构）— [wiki.archlinux.org](https://wiki.archlinux.org/title/Table_of_contents)，本轮经中文镜像 [wiki.archlinux.org.cn](https://wiki.archlinux.org.cn/title/Table_of_contents) 实取结构
- 鸟哥的私房菜服务器架设篇（场景分部）— [vbird.org.cn/linux_server/rocky9/](https://vbird.org.cn/linux_server/rocky9/)，2026-10-08 实取
- 本仓外链统计：本地扫描 `docs/**/*.md`，2026-10-08
