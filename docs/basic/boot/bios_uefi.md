# BIOS 与 UEFI

## 学习目标

- 理解 BIOS 和 UEFI 的区别
- 了解启动过程的基本原理
- 掌握 BIOS/UEFI 设置方法

## 1. BIOS

### 1.1 什么是 BIOS

BIOS（Basic Input/Output System）是固化在主板芯片上的固件，负责：
- 硬件自检（POST）
- 加载引导程序
- 提供基本的硬件控制

### 1.2 BIOS 的特点

- 使用 MBR（Master Boot Record）分区表
- MBR 限制：最大支持 2 TB 磁盘，最多 4 个主分区
- 启动方式：从 MBR 加载引导代码

### 1.3 MBR 结构

```
MBR（512 字节）
├── 引导代码（446 字节）
├── 分区表（64 字节）
│   ├── 分区表项 1（16 字节）
│   ├── 分区表项 2（16 字节）
│   ├── 分区表项 3（16 字节）
│   └── 分区表项 4（16 字节）
└── 签名（2 字节）
```

## 2. UEFI

### 2.1 什么是 UEFI

UEFI（Unified Extensible Firmware Interface）是新一代固件接口标准，替代 BIOS：
- 更快的启动速度
- 更大的磁盘支持
- 更安全的启动机制

### 2.2 UEFI 的特点

- 使用 GPT（GUID Partition Table）分区表
- GPT 限制：支持 9.4 ZB 磁盘，最多 128 个分区
- 支持 Secure Boot（安全启动）
- 支持网络启动

### 2.3 GPT 结构

```
GPT
├── 保护性 MBR（LBA 0）
├── GPT 头（LBA 1）
├── 分区表（LBA 2-33）
├── 分区 1-N
├── 备份分区表
└── 备份 GPT 头
```

## 3. BIOS vs UEFI

| 特性 | BIOS | UEFI |
|------|------|------|
| 分区表 | MBR | GPT |
| 最大磁盘 | 2 TB | 9.4 ZB |
| 最大分区数 | 4 个主分区 | 128 个 |
| 启动速度 | 较慢 | 较快 |
| 安全启动 | 不支持 | 支持 |
| 图形界面 | 无 | 有 |
| 网络支持 | 无 | 有 |

## 4. 启动过程

### 4.1 BIOS 启动流程

1. **POST（Power-On Self-Test）**：硬件自检
2. **加载 MBR**：从磁盘读取 MBR
3. **执行引导代码**：运行 MBR 中的引导代码
4. **加载引导程序**：加载 GRUB 等引导程序
5. **加载内核**：引导程序加载 Linux 内核
6. **启动系统**：内核初始化系统

### 4.2 UEFI 启动流程

1. **SEC（Security Phase）**：安全初始化
2. **PEI（Pre-EFI Initialization）**：早期初始化
3. **DXE（Driver Execution Environment）**：驱动加载
4. **BDS（Boot Device Selection）**：启动设备选择
5. **TSL（Transient System Load）**：临时系统加载
6. **RT（Runtime）**：运行时

## 5. 查看启动模式

```bash
# 查看是否为 UEFI 模式
ls /sys/firmware/efi

# 查看启动日志
dmesg | grep -i efi

# 查看分区表类型
fdisk -l /dev/sda

# 查看 UEFI 变量
efibootmgr
```

## 6. BIOS/UEFI 设置

### 6.1 进入设置

- **常见按键**：Del、F2、F10、F12、Esc
- **不同品牌**：
  - Dell：F2
  - HP：F10
  - Lenovo：F1 或 F2
  - ASUS：Del 或 F2

### 6.2 常见设置

- **启动顺序**：设置从哪个设备启动
- **Secure Boot**：启用/禁用安全启动
- **Legacy Mode**：启用/禁用传统模式
- **虚拟化**：启用/禁用 VT-x/AMD-V

## 参考资料

- [鸟哥的私房菜 - 开机流程](https://linux.vbird.org/linux_basic/0510osloader.php)
- [Arch Wiki - UEFI](https://wiki.archlinux.org/title/UEFI)
- [Arch Wiki - GRUB](https://wiki.archlinux.org/title/GRUB)
