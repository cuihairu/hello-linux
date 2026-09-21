# Linux 的历史

从 Unix 到 GNU/Linux，理解这段历史有助于理解 Linux 的设计哲学和文化。

> 内容参考自官方文档和历史文献，见文末参考资料。

## 学习目标

- 了解 Unix 的诞生和发展
- 理解 GNU 项目的起源和目标
- 掌握 Linux 发展的重要里程碑

## 1. Unix 时代（1969-1983）

### 1.1 诞生

1969 年，贝尔实验室的 Ken Thompson 和 Dennis Ritchie 在 DEC PDP-7 上开发了 Unix。

| 年份 | 事件 |
|------|------|
| 1969 | Unix 在贝尔实验室诞生 |
| 1971 | Unix 第一版发布，用汇编语言编写 |
| 1973 | 用 C 语言重写 Unix（划时代之举） |
| 1975 | Unix 第六版发布，广泛分发到大学 |
| 1977 | BSD（Berkeley Software Distribution）诞生 |
| 1979 | Unix 第七版，商业化的开始 |
| 1983 | AT&T 发布 System V |

### 1.2 Unix 的分裂

Unix 逐渐分裂为两大流派：

```
                    Unix
                     │
        ┌────────────┴────────────┐
        │                         │
    AT&T System V              BSD
    (商业版)                  (学术版)
        │                         │
   ┌────┴────┐              ┌────┴────┐
   │ Solaris │              │ FreeBSD │
   │ HP-UX   │              │ NetBSD  │
   │ AIX     │              │ OpenBSD │
   └─────────┘              └─────────┘
```

### 1.3 POSIX 标准

1988 年，IEEE 发布 POSIX（Portable Operating System Interface）标准，统一 Unix 系统调用接口。

```bash
# 查看系统是否遵循 POSIX
getconf POSIX_VERSION
```

## 2. GNU 运动（1983-1991）

### 2.1 起源

1983 年，Richard Stallman 在 MIT 发起 GNU（GNU's Not Unix）项目，目标是创建一个完全自由的类 Unix 操作系统。

Stallman 的动机：
- 打印机驱动的源代码被厂商拒绝分享
- 软件私有化阻碍了技术进步
- 希望建立一个自由软件社区

### 2.2 自由软件定义

自由软件的四项基本自由：

| 自由 | 说明 |
|------|------|
| 自由 0 | 运行程序的自由 |
| 自由 1 | 研究和修改源代码的自由 |
| 自由 2 | 重新分发副本的自由 |
| 自由 3 | 分发修改版本的自由 |

### 2.3 GPL 许可证

1989 年，Stallman 创建了 GNU 通用公共许可证（GPL），确保软件的自由传播。

```bash
# 查看 GPL 许可证
cat /usr/share/common-licenses/GPL-3
```

### 2.4 GNU 项目成果

| 年份 | 项目 | 说明 |
|------|------|------|
| 1984 | GNU Emacs | 文本编辑器 |
| 1987 | GCC 0.9 | GNU 编译器 |
| 1988 | GNU Make | 构建工具 |
| 1990 | glibc | C 标准库 |
| 1990 | GNU Hurd | 内核（未完成） |

到 1991 年，GNU 已经有了除内核以外的几乎所有组件。

## 3. Linux 的诞生（1991）

### 3.1 Linus Torvalds

1991 年，芬兰赫尔辛基大学的学生 Linus Torvalds 开始编写一个操作系统内核。

### 3.2 著名的 Usenet 帖子

1991 年 8 月 25 日，Linus 在 comp.os.minix 新闻组发表了著名的帖子：

```
From: torvalds@klaava.Helsinki.FI (Linus Benedict Torvalds)
Newsgroups: comp.os.minix
Subject: What would you like to see most in minix?
Date: 25 Aug 91 23:19:35 GMT

Hello everybody out there using minix -

I'm doing a (free) operating system (just a hobby, won't be big and
professional like gnu) for 386(486) AT clones...
```

### 3.3 版本里程碑

| 版本 | 日期 | 重要变化 |
|------|------|---------|
| 0.01 | 1991.09.17 | 首次公开发布 |
| 0.02 | 1991.10.05 | 支持 bash 和 gcc |
| 0.12 | 1991.11 | 支持虚拟内存 |
| 1.0 | 1994.03.14 | 首个正式版本 |
| 2.0 | 1996.06.09 | 支持多架构 |
| 2.6 | 2003.12.17 | 内核模式抢占 |
| 3.0 | 2011.07.21 | 版本号变更 |
| 4.0 | 2015.04.12 | Live patching |
| 5.0 | 2019.03.03 | 支持 Energy Aware Scheduling |
| 6.0 | 2022.10.02 | 支持更多硬件 |

```bash
# 查看当前内核版本
uname -r

# 查看内核发布日志
zless /usr/share/doc/linux/changelog.Debian.gz
```

## 4. 发行版的兴起（1992-至今）

### 4.1 早期发行版

| 年份 | 发行版 | 说明 |
|------|--------|------|
| 1992 | SLS | 最早的发行版之一 |
| 1993 | Slackware | 最古老的活跃发行版 |
| 1993 | Debian | Ian Murdock 创立 |
| 1994 | Red Hat | 商业 Linux 发行版 |
| 1994 | SUSE | 德国发行版 |

### 4.2 现代发行版

| 年份 | 发行版 | 说明 |
|------|--------|------|
| 2002 | Arch Linux | 滚动更新 |
| 2004 | Ubuntu | 基于 Debian，推动桌面普及 |
| 2004 | CentOS | RHEL 的社区克隆 |
| 2009 | Chrome OS | 基于 Gentoo |
| 2020 | Rocky Linux | CentOS 的替代品 |

### 4.3 发行版家谱

```
Slackware (1993)
    └── SUSE (1994)

Debian (1993)
    ├── Ubuntu (2004)
    │   ├── Linux Mint
    │   ├── Pop!_OS
    │   └── Kali Linux
    └── Knoppix

Red Hat (1994)
    ├── RHEL (2000)
    │   ├── CentOS (2004, 已转型)
    │   ├── Rocky Linux (2021)
    │   └── AlmaLinux (2021)
    └── Fedora (2003)
```

## 5. Linux 的今天

### 5.1 应用领域

| 领域 | 份额 | 说明 |
|------|------|------|
| 服务器 | ~80% | Web、云计算、数据库 |
| 超级计算机 | 100% | Top 500 全部运行 Linux |
| 移动设备 | ~75% | Android 基于 Linux 内核 |
| 嵌入式 | 广泛 | 路由器、智能家居、汽车 |
| 桌面 | ~4% | 开发者、技术爱好者 |

### 5.2 主要贡献者

```bash
# 查看内核贡献统计
# 参考：https://www.linuxfoundation.org/publications
```

| 贡献者 | 说明 |
|--------|------|
| Intel | 硬件支持和驱动 |
| Red Hat | 内核核心开发 |
| Google | 容器、调度器 |
| Meta | 性能优化 |
| ARM | 架构支持 |
| 社区个人 | 大量贡献者 |

## 参考资料

- The Unix Heritage Society — [tuhs.org](https://www.tuhs.org/)
- GNU Project History — [gnu.org](https://www.gnu.org/gnu/gnu-history.html)
- Linus Torvalds 原始 Usenet 帖子 — [groups.google.com](https://groups.google.com/g/comp.os.minix/c/dlNtH7RRrGA)
- Linux Kernel Archives — [kernel.org](https://www.kernel.org/)
- LWN.net Kernel Newbies — [kernelnewbies.org](https://kernelnewbies.org/LinuxVersions)
- DistroWatch — [distrowatch.com](https://distrowatch.com/)
