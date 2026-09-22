# 硬件篇

本篇介绍计算机硬件的工作原理和 Linux 下的管理方法，涵盖从体系结构到具体设备的完整知识。

## 内容

| 章节 | 内容 |
|------|------|
| [计算机体系结构](./architecture.md) | 冯·诺依曼体系、指令执行、总线、寄存器、中断、存储层次 |
| [CPU](./cpu.md) | 核心/线程、缓存、指令集、频率管理、NUMA |
| [内存](./memory.md) | DRAM 原理、DDR 代际、ECC、Swap、大页内存 |
| [存储设备](./storage.md) | HDD/SSD/NVMe、RAID、分区、文件系统选型 |
| [网络设备](./network.md) | 网卡、驱动、性能调优、无线网络 |

## 学习建议

1. 先读**体系结构**，建立整体认知
2. 按需学习具体设备章节
3. 每章都配有实战命令，建议动手练习

## 参考资料

- Patterson & Hennessy《计算机组成与设计》
- Bryant & O'Hallaron《深入理解计算机系统》(CSAPP)
- [Arch Wiki - Hardware](https://wiki.archlinux.org/title/Category:Hardware)
- [Linux Hardware Database](https://linux-hardware.org/)
