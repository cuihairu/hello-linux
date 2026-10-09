# 源码编译与 Tarball 安装

包管理器解决不了的安装有三种：仓库里根本没有的软件、仓库版本赶不上上游修复的软件、以及需要改代码或选非常规编译选项的软件。这三种情况都指向同一条路——拿上游发布的源码压缩包（社区习惯叫 Tarball），自己在机器上编译、安装。代价也要先说清：脱离包数据库意味着升级靠自己盯、安全公告不会找上门、卸载没有一级命令兜底。本页讲清这条路的完整流程、每一步的判断依据，以及什么时候应该折返回包管理器。

> 内容参考自 GNU 构建系统文档、各项目源码包内的 README/INSTALL 与鸟哥私房菜第二十一章，见文末参考资料。

## 学习目标

- 判断一个安装需求该走包管理还是走源码，说出两条路的代价
- 三系装齐编译工具链，看懂 `./configure` 的检测逻辑与 `--prefix` 的含义
- 完成「下载 → 校验 → 解包 → configure → make → install」标准流程，报错会读 `config.log`
- 理解 `/usr/local` 惯例与 `ldconfig`/`PATH` 的收尾动作，知道卸载难题的两个解法
- 认清源码安装与包数据库脱节的长期代价，养成用包管理器兜底的回退习惯

## 1. 什么时候走源码

| 情况 | 走包管理 | 走源码 |
|------|---------|--------|
| 仓库里有，版本够用 | 默认选择 | 没必要 |
| 仓库没有（小众工具、自己写的软件） | 找第三方仓或 EPEL/AUR 之前先确认 | 合适 |
| 仓库版本太旧，需要上游修复 | backports/EPEL/AUR 试过再评估 | 合适 |
| 需要改代码、开特殊编译选项、嵌入自己的补丁 | 基本不可行（要自建包） | 合适 |
| 生产环境批量部署 | 强烈建议（可审计、可回滚） | 慎重，装机脚本化后再考虑 |

判断的核心不是「能不能装」，而是装完之后谁负责它：包管理器负责升级、安全更新与卸载一致性，源码安装只有你自己负责。源码装的东西系统层面不可见——`dnf list installed` 看不到它，`apt upgrade` 不会碰它，这正是它灵活的来源，也是隐患的来源。

## 2. 工具链准备

编译 C/C++ 软件需要编译器、构建工具与头文件。三系的安装入口：

| 操作 | Debian/Ubuntu | RHEL/Rocky | Arch |
|------|---------------|-----------|------|
| 编译工具组 | `apt install build-essential` | `dnf groupinstall "Development Tools"`（组名以 `dnf group list` 实测为准） | `pacman -S base-devel` |
| 头文件包惯例 | 库名 + `-dev`（如 `libssl-dev`） | 库名 + `-devel`（如 `openssl-devel`） | 不拆分，主包即含头文件 |

Arch 不拆 devel 包、RHEL 系按 `-devel` 拆、Debian 系按 `-dev` 拆——这条命名差异是源码安装最常踩的坑：configure 报「找不到 xxx.h」时，缺的就是对应库的开发包，三系各按各的惯例补装。包组名的教训在本仓有先例：组名随大版本会变，动手前用 `dnf group list` 看实测输出。

## 3. 标准流程

以一个假想的 `demo-app` 为例，六步走完：

```bash
$ wget https://example.com/dist/demo-app-1.4.2.tar.xz
$ sha256sum demo-app-1.4.2.tar.xz        # 与官网公布的校验值比对，防传输损坏与投毒
$ tar -xJf demo-app-1.4.2.tar.xz          # .xz 用 -xJf；.gz 用 -xzf
$ cd demo-app-1.4.2
$ less README INSTALL                     # 先读安装说明，特殊依赖与选项都写在这里
$ ./configure --prefix=/usr/local/demo-app
$ make -j"$(nproc)"                       # 并行编译，核数即线程数
$ sudo make install
```

### 3.1 configure 在做什么

`./configure` 是一份探测脚本：逐项检查编译器、函数库、头文件是否齐备，按探测结果生成 `Makefile`。`--prefix` 决定安装根目录，惯例是 `/usr/local` 下的独立子目录或直接 `/usr/local`——选 `/usr/local` 而不是 `/usr` 的原因很直接：`/usr` 是包管理器的领地，源码文件混进去之后，包管理器与你的文件互相覆盖、无从对账；`/usr/local` 按惯例归本地管理员，两边的账各记各的。

常用 configure 选项三个：`--prefix`（安装根）、`--with-xxx`/`--without-xxx`（开关可选特性）、`--enable-debug` 这类调试开关。全部选项 `./configure --help` 可查。

### 3.2 make 与安装

`make` 按 Makefile 编译，`make install` 把产物复制到 prefix 指定的位置。内存小的机器把 `-j` 降到 2 或去掉，交换不足时并行编译会被 OOM 杀掉，表现为 make 中途退出而非报错。编译产物依赖的动态库在安装后要让系统找得到：

```bash
$ sudo ldconfig                           # 刷新动态库缓存（prefix 在 /usr/local 时通常已覆盖）
$ echo 'export PATH=/usr/local/demo-app/bin:$PATH' >> ~/.bashrc
$ ldd /usr/local/demo-app/bin/demo-app    # 验证链接库全部解析，无 not found
```

## 4. 报错怎么读

configure 阶段的报错集中在三类，处置各有套路：

**checking for xxx... no，最后 error: xxx not found。** 缺依赖。看报错里点名的是哪个库，按三系惯例补装开发包（`libssl-dev` / `openssl-devel` / `openssl`），然后重跑 configure。`config.log` 里有探测的完整过程，报错含糊时翻它。

**C compiler cannot create executables。** 编译器本身不可用：没装 gcc、环境变量 CFLAGS 塞了编译器不认的参数、或缺 32 位支持。新机器上先确认第 2 节的工具组装齐。

**版本过旧。** 报错点明某个库的最低版本要求而系统里的是旧版。处置顺序：先找有没有更新的系统包，再评估要不要连依赖一起源码安装——依赖链一旦开始滚雪球，值得停下来重新考虑这个软件是否非装不可。

make 阶段的报错多半是上一环节漏了依赖，回到 configure 的输出逐条对照 `checking ... no` 的行。

## 5. 卸载与升级：两个解法

`make uninstall` 依赖 Makefile 记录了完整清单，很多项目根本没实现，不能指望。两个可靠解法：

**方案一：DESTDIR 演练出清单。** 先装进临时目录拿清单，再正式安装：

```bash
$ make install DESTDIR=/tmp/stage         # 全部文件落在 /tmp/stage 下
$ find /tmp/stage -type f | sed 's|^/tmp/stage||' > /usr/local/demo-app/MANIFEST
$ sudo rm -rf /tmp/stage
$ sudo make install                       # 正式安装
```

卸载时按 MANIFEST 删文件即可，升级前比对新旧清单还能查出该删的旧文件。

**方案二：GNU stow。** 每个软件装进 `/usr/local/stow/<name>` 自己的目录，用 stow 建符号链接归拢到公共路径，卸载等于 stow -D 删链接加删目录，多版本共存也顺手。管理多套源码安装时这个方案更省心。

升级 = 拉新版源码重复流程。装在独立 prefix 下的软件，升级前把旧版目录改名保留，新版验证无误再删旧目录——这是源码安装版的「版本回滚」。

## 6. 与包管理器的边界

三条纪律收住这条路的代价：

1. **优先级不变**：官方仓库 > 发行版背书的扩展源（EPEL、AUR）> 源码安装。AUR 的 PKGBUILD 本质是把源码编译流程包成了包，能走它就别手搓——装完进了包数据库，升级、卸载、依赖对账全部回归正常。
2. **别覆盖包管理的文件**：configure 时确认 prefix 不与已装包冲突；`/usr/local` 与 `/usr` 的分工就是为此存在的。
3. **登记台账**：`find /usr/local -maxdepth 2` 定期过一遍装了什么、什么时候装的。源码装的软件不进任何数据库，这台机器上「还有哪些软件」的答案里，只有你自己记得这部分。

## 7. 常见故障速查

| 症状 | 原因 | 处置 |
|------|------|------|
| configure: error: xxx not found | 缺依赖或缺开发包 | 按第 4 节补装，重跑 configure |
| C compiler cannot create executables | 工具链不齐或编译参数非法 | 装工具组；查 CFLAGS/CXXFLAGS |
| make: xxx: No such file or directory | 解包不完整或未先跑 configure | 重新解包校验；确认 configure 成功 |
| 安装后 command not found | prefix/bin 不在 PATH | 补 PATH 或确认 bin 子目录名 |
| 运行时 error while loading shared libraries | 动态库没进缓存 | 跑 `ldconfig`；确认库目录在 ld.so 配置里 |
| 磁盘满，make 中断 | 编译目录与临时目录吃满空间 | 清理后重跑；小内存机器减小 -j |

## 与其它页的分工

APT、DNF、pacman 三页（[APT](./apt.md)、[YUM/DNF](./yum.md)、[Pacman](./pacman.md)）是日常安装的主线，本页是它们覆盖不到时的补充——先翻那三页，找不到再回来。压缩与解包命令的完整语法见[压缩与归档](../../commands/compression.md)；给交叉架构编译是另一条工具链，见[交叉编译与嵌入式](../../source/cross-compile.md)；内核这类特殊构建有自己的流程，见[内核编译与模块开发](../../source/build-and-modules.md)。

## 参考资料

- GNU Autoconf 手册 — [gnu.org/software/autoconf/manual](https://www.gnu.org/software/autoconf/manual/)
- GCC 在线文档 — [gcc.gnu.org/onlinedocs](https://gcc.gnu.org/onlinedocs/)
- GNU stow — [gnu.org/software/stow](https://www.gnu.org/software/stow/)
- 鸟哥的私房菜 - 软件安装：源代码与 Tarball — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0520source_code_and_tarball.php)
- man 手册 — man gcc、man make、man ldconfig、man stow
