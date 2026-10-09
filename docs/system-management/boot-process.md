# 开机流程与引导排错

开机是管理员唯一无法"先登进去再看看"的环节：深夜机房里那台重启后停在黑屏的服务器，不会给你 SSH，也不会给你 journalctl——你得靠脑子里的流程图判断它卡在哪一棒。本页把从按下电源到登录提示符的整条链路拆成五棒接力：固件、引导器、内核与 initramfs、systemd、登录，每一棒讲清"交接物是什么、卡住的现场长什么样、手里有哪些工具"；再补启动性能分析三板斧。与基础篇两页分工明确：[BIOS 与 UEFI](../basic/boot/bios_uefi.md) 讲固件本身怎么工作，[GRUB 引导程序](../basic/boot/grub.md) 讲引导器结构与救援重装，本页讲整条链路怎么读、卡住怎么救；systemd 的服务管理细节另见 [systemd 服务与程序管理](./services-systemd.md)，本页只取与开机直接相关的部分。

> 内容参考自 Arch Wiki 与 systemd 官方文档（概念框架参考鸟哥的私房菜），见文末参考资料。

## 学习目标

- 把开机过程拆成五棒接力，说出每一棒的交接物与典型卡死现场
- 会用 GRUB 菜单临时改内核参数救急（去 quiet、nomodeset、进 initramfs shell）
- 分清三系 initramfs 工具（initramfs-tools / dracut / mkinitcpio），知道何时必须重建
- 能诊断 systemd 阶段的 job 卡住与 90 秒超时，分清 rescue 与 emergency
- 会用 systemd-analyze 三板斧定位启动慢的真凶，不被 blame 误导

## 1. 开机是接力赛

### 1.1 五棒与交接物

```text
按下电源 ─▶ 固件 POST/UEFI ─▶ 引导器 GRUB ─▶ 内核 + initramfs ─▶ systemd ─▶ 登录提示符
              NVRAM 启动项       grub.cfg        挂载真根+switch_root   default.target   getty / SDDM
```

| 棒次 | 阶段 | 交接物 | 卡住的典型现场 |
|------|------|--------|----------------|
| 1 | 固件 | 按 BootOrder 找到启动介质（ESP 里的 .efi 或 MBR 代码） | 无任何输出、直接进固件设置界面 |
| 2 | 引导器 | 加载内核镜像与命令行（vmlinuz、initramfs、root=UUID…） | grub> 提示符、菜单选择后黑屏 |
| 3 | 内核与 initramfs | 挂载真根文件系统并 switch_root | 内核 panic（VFS: Unable to mount root fs） |
| 4 | systemd | 按 default.target 拉起服务 | "A start job is running for…" 90 秒倒计时 |
| 5 | 登录 | getty 或显示管理器出登录框 | 黑屏有鼠标指针、无登录界面 |

排错的总纲就藏在这张表里：**先定位卡在第几棒，再查那一棒的处置**。每一棒都有自己的观察窗口——固件的自检画面与蜂鸣、GRUB 的菜单与提示符、内核解压后的滚动输出、systemd 的绿色 `[ OK ]` 行；在第四棒的 journalctl 里找第一棒的病，是新手最常走的弯路。判断依据是"屏幕上最后出现了谁"：什么都没有是第一棒，停在 grub> 是第二棒，panic 打印是第三棒，job 倒计时是第四棒，有输出但无登录框是第五棒。

### 1.2 一条会反复用到的纪律

五棒里越靠前的问题越"硬"——固件与引导器阶段没有日志可查（journald 还没起），只能靠屏幕与串口；越靠后的问题越"软"——systemd 阶段的一切都会留下 journal，`journalctl -b -p err` 一把抓。所以排错的姿势是倒着来的：能进系统就看日志倒推，进不了系统就沿着五棒正着扫现场。这也是为什么本页把"逃生门"（临时改参数、initramfs shell、救援模式）分散安排在各棒小节里，而不是集中放在文末——你在哪一棒被困住，就在那一棒拿工具。

## 2. 固件阶段

### 2.1 固件在做什么

通电后的第一棒只做三件事：初始化 CPU 与内存、枚举硬件（POST 自检）、按 NVRAM 里的 BootOrder 找到启动程序。UEFI 与 Legacy BIOS 的本质差异在于最后一步——Legacy 从磁盘第一个扇段读 512 字节的 MBR 代码，UEFI 则是把引导变成"运行一个程序"：从 FAT32 的 ESP 分区里按路径加载 `shimx64.efi` → `grubx64.efi`。两种模式的判断方法（`/sys/firmware/efi` 是否存在、`efibootmgr` 是否报错）在[基础篇](../basic/boot/bios_uefi.md)有完整演示，此处不重复。

启动项本身是管理员在这一棒唯一常打交道的对象。条目丢失或顺序错乱（常见于主板电池没电、固件刷新、双系统安装器抢写 NVRAM）后，机器会绕过你的 GRUB 直接进了 U 盘或固件界面：

```bash
$ efibootmgr -v | head -4        # 看现有条目与顺序（细节见基础篇）
BootCurrent: 0001
Timeout: 0 seconds
BootOrder: 0001,0000,0003
Boot0001* Linux Boot Manager ...
$ sudo efibootmgr -o 0001,0000,0003   # 重排：把正确的条目提到最前
```

条目彻底丢失时的兜底是固件的默认回退路径 `\EFI\BOOT\BOOTX64.EFI`——`grub-install` 会顺带铺一份，所以"重装引导器"往往比"手抠 NVRAM"省事，具体步骤见[GRUB 引导程序](../basic/boot/grub.md)的救援一节。

Secure Boot 在这一棒值得多说两句：它要求被加载的每个环节都有可信签名，代价是未签名内核模块（典型如自行编译的 DKMS 显卡驱动）会被拒绝加载，日志里留下 `Key was rejected by service` 或 Lockdown 相关提示——遇到"模块明明装了加载不了"，先想起来这里。需要继续开着 Secure Boot 又要载自编模块的，标准流程是把模块签名登记进机器主人密钥（MOK）：`mokutil --import 驱动.der` 设置一次性密码，重启后 shim 会先进入蓝色登记界面，确认后该签名对本机长期有效——这比"干脆关掉 Secure Boot"多花两分钟，换来的是其他安全收益原样保留；Arch 用户没有发行版代管的 shim 信任链，通常用 `sbctl` 自管密钥或明确关闭。

### 2.2 卡住现场判读

这一棒故障的排除法很干脆：**换一个已知能启动的介质（Live USB）试**。Live 能亮，固件无罪，病在磁盘上的引导链；Live 也不亮，是硬件或显示输出层的事，与操作系统无关。服务器场景再加两条路：其一，内核命令行加 `console=ttyS0,115200` 后，固件与内核的输出都能走串口，机房里不必接显示器——很多"黑屏"其实只是显示输出没接对；其二，带 BMC/IPMI 的服务器用带外口把"显示器+键盘"虚拟出来（如 `ipmitool sol activate` 重定向串口控制台），人在工位就能看到第一棒的现场，这是第五棒之后的任何日志都补不回来的视角。

## 3. 引导器阶段

### 3.1 菜单不出现

GRUB 菜单一闪而过或不出现，多半不是故障而是配置使然：`/etc/default/grub` 里 `GRUB_TIMEOUT=0` 或 `GRUB_TIMEOUT_STYLE=hidden` 都会隐藏菜单。临时唤出的按键按启动模式分：Legacy 按住 `Shift`，UEFI 狂按 `Esc`。要永久显示菜单，改完 `/etc/default/grub` 后按发行版重新生成配置——Debian/Ubuntu 是 `update-grub`，Arch 是 `grub-mkconfig -o /boot/grub/grub.cfg`，RHEL 系命令与路径都带 2（`grub2-mkconfig -o /boot/grub2/grub.cfg`），三系差异与 grub.cfg 的三层生成结构在[GRUB 页](../basic/boot/grub.md)有完整对照，本页不展开。

### 3.2 菜单是急救台：临时改参数

GRUB 菜单按 `e` 可以临时编辑启动项，Ctrl+X 生效、重启即失——这是不加任何改动就能拿到的救生索。[GRUB 页](../basic/boot/grub.md) 已演示过追加 `systemd.unit=rescue.target` 进单用户模式，本页补三条排错场景下最常用的改法：

| 改什么 | 在哪改 | 救什么 |
|--------|--------|--------|
| 去掉 `quiet splash` | linux 行尾 | 让内核滚动输出全部可见，卡在哪一行一目了然 |
| 追加 `nomodeset` | linux 行尾 | 显卡驱动接管早于登录导致的黑屏，先用 VESA 亮起来再说 |
| 追加 initramfs shell 参数 | linux 行尾 | 在挂真根之前拿到一个 shell，做 fsck、查驱动、改密码 |

第三条的三系写法不同，值得单独记——initramfs 的"打断"关键字由各家的生成工具定义：

```text
rd.break            # RHEL 系（dracut）：停在挂真根前，shell 在 initramfs 里
break=premount      # Arch（mkinitcpio）与 Debian（initramfs-tools）通用写法
init=/bin/bash      # 三系通用：跳过 systemd，真根挂好后直接给 bash
```

`init=/bin/bash` 最猛也最常用（root 密码遗忘的教科书解法），代价是没有 systemd 的环境：文件系统只读、没有任务控制（提示 `can't access tty; job control turned off`），进去后先 `mount -o remount,rw /` 再干活，改完 `exec /sbin/init` 或直接重启。

### 3.3 持久化改动

临时验证有效的参数要落进 `/etc/default/grub` 才能长久：`GRUB_CMDLINE_LINUX` 对所有启动项生效，`GRUB_CMDLINE_LINUX_DEFAULT` 只加在默认项上（恢复模式等特殊项不受影响）——排错参数（如 `nomodset`）放 DEFAULT 即可，别让救援模式也背着它。改完照例按三系命令重新生成，这一步的纪律与 BIND 的"先 checkconf 再 reload"同源：生成器会做语法与路径检查，直接手改 `/boot/grub2/grub.cfg` 这类自动生成文件，下次内核更新就被无声覆盖，是"改了又变砖"的第一根因。

排错路上反复会用到的内核参数收敛成一张速查表，临时改在菜单 `e` 里，验证有效再回本节持久化：

| 参数 | 作用 | 典型场景 |
|------|------|----------|
| `quiet splash`（去掉） | 显示内核完整滚动输出 | 黑屏前最后一行是关键证据 |
| `nomodeset` | 禁用早期显卡 KMS，退回 VESA | 换驱动/内核后黑屏 |
| `loglevel=7` | 提高内核日志详细度 | 需要更早更细的输出时 |
| `console=ttyS0,115200` | 输出重定向到串口 | 服务器无显示器排错 |
| `systemd.unit=rescue.target` | 进入单用户检修态 | 改密码、改配置 |
| `systemd.unit=emergency.target` | 进入最小急救态 | fsck、修 fstab |
| `rd.break` / `break=premount` | 停在 initramfs shell | 挂真根之前的问题 |
| `init=/bin/bash` | 绕过 systemd 直接 bash | root 密码遗忘教科书解法 |

### 3.4 卡住现场判读

停在 `grub>` 或 `grub rescue>` 提示符，说明 GRUB 的核心代码找到了、但配置或模块没跟上——`grub rescue>` 更糟（前缀模块丢失），两者的手工恢复（`normal` 命令、set root/insmod 路径）与完整救援流程见[GRUB 页](../basic/boot/grub.md)。菜单选择后黑屏无输出，优先怀疑内核参数：`quiet splash` 把错误吞了，去掉再看；刚换过显卡驱动或内核的机器先试 `nomodeset`。

真落在 `grub>` 提示符上时，最短路径往往是"手工把系统点起来"——不重装、不修配置，先用三行命令证明内核与真根都还健康，修复就可以留到进系统后从容做：

```text
grub> ls                                    # 枚举分区，找到根或 /boot 所在（如 (hd0,gpt2)）
grub> set root=(hd0,gpt2)
grub> linux /vmlinuz-linux root=UUID=xxxx-… rw    # Arch 路径；Debian/RHEL 为 /boot/vmlinuz-版本号
grub> initrd /initramfs-linux.img                 # 同上，随发行版调整文件名
grub> boot
```

UUID 用 `ls (hd0,gpt2)/` 翻文件确认盘符对不对——这里最值钱的不是命令本身，而是"当场就能区分盘坏了还是配置坏了"的判别力：三行能 boot，问题只在 grub.cfg；`ls` 都读不出分区，先查盘与固件。

停在 `grub>` 或 `grub rescue>` 提示符，说明 GRUB 的核心代码找到了、但配置或模块没跟上——`grub rescue>` 更糟（前缀模块丢失），两者的手工恢复（`normal` 命令、set root/insmod 路径）与完整救援流程见[GRUB 页](../basic/boot/grub.md)。菜单选择后黑屏无输出，优先怀疑内核参数：`quiet splash` 把错误吞了，去掉再看；刚换过显卡驱动或内核的机器先试 `nomodeset`。

## 4. 内核与 initramfs 阶段

### 4.1 initramfs 是过渡房

内核解压后手里只有一个内存里的微型根——initramfs。它的唯一使命是把"挂上真根"之前的事干完：加载存储驱动（nvme、raid、文件系统模块）、解密 LUKS、激活 LVM、按 `root=UUID=…` 找到并检查真根，然后 `switch_root` 把进程的根切到磁盘上、exec 真正的 init（systemd）。类比搬迁：真根是新家，initramfs 是拆迁过渡房——住不久，但没有它你进不了新家；过渡房里没带够家具（驱动），新家再好也搬不进去。

这解释了一条高频纪律：**换了内核或新增存储驱动后必须重建 initramfs**。内核模块按版本严格匹配——`modinfo -F vermagic 模块名` 打印的版本魔串必须与运行内核分毫不差，你给当前内核装的阵列卡驱动只落在真根的 `/lib/modules/$(uname -r)/` 里，而 initramfs 是生成那一刻的打包快照，之后真根里新装什么它都不知道。不重建，卡就"装了但开机看不见"，然后是熟悉的 panic。三系工具与重建命令对照：

| 操作 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 工具 | initramfs-tools | mkinitcpio | dracut |
| 重建当前内核 | `update-initramfs -u` | `mkinitcpio -P` | `dracut -f` |
| 配置文件 | `/etc/initramfs-tools/` | `/etc/mkinitcpio.conf` + `.d/` | `/etc/dracut.conf.d/` |
| 额外塞驱动 | `/etc/initramfs-tools/modules` | `MODULES+=(xxx)` | `add_drivers+=" xxx "` |
| 列出镜像内容 | `lsinitramfs /boot/initrd.img-…` | `lsinitcpio -a` | `lsinitrd /boot/initramfs-…` |

"列内容"一行在排错时是硬通货：怀疑驱动没进包，一条命令直接看真相，不用靠猜。配套的还有"加密盘怎么被解开"——用了 LUKS 的机器，initramfs 还要在挂真根前先解密，三系在这条路径上的参数习惯不同：Arch 用 `cryptdevice=UUID=…:cryptroot root=/dev/mapper/cryptroot` 一条参数说清，RHEL/dracut 用 `rd.luks.uuid=luks-…`，Debian 则靠 `/etc/crypttab` 被 initramfs-tools 打包进去。它们不需要背，但要知道"密码提示符停在开机早期"属于这一棒而非 systemd——改 crypttab 或 dracut 配置后忘了重建 initramfs，加密盘就会在你以为改好了的那次重启上等你。

### 4.2 内核 panic 三因速查

这一棒失败的最后画面几乎总是 `Kernel panic - not syncing: VFS: Unable to mount root fs on unknown-block(0,0)`，但背后是三种病，处置完全不同。**其一，根设备定位错**：`root=` 的 UUID 拷错、分区被重划——去 initramfs shell 里 `blkid` 逐个核对，再修 grub.cfg 的生成源。**其二，驱动缺失**：initramfs 里没有该存储控制器的模块——现象同上但 `ls /dev/nvme*`（或相应设备节点）为空，重建 initramfs 并确认驱动进了包。**其三，文件系统损坏**：输出里出现 fsck/superblock 相关报错而不是纯 VFS——在 initramfs shell 里 `fsck -y /dev/…` 修完再继续启动。三种病的分界线都在 panic 打印的最后一屏，拍照或串口留档是机房里的标准动作。第三种病在 initramfs shell 里的完整处置长这样：

```bash
$ fsck -y /dev/vda2                  # -y 对所有交互问答答"是"，修复日志逐条滚动
/dev/vda2: UNEXPECTED INCONSISTENCY; RUN fsck MANUALLY.
        ... 修复若干 inode/日志项 ...
/dev/vda2: ***** FILE SYSTEM WAS MODIFIED *****
$ exit                               # 退出 shell，initramfs 继续原启动流程
```

修完 `exit` 让流程接着走而不是硬重启，是给自己留验证机会：文件系统修好了但内核仍 panic，说明还有第二处病；直接 hard reset 则一切归零重来。

### 4.3 两个逃生门

进 initramfs 环境的门有两扇，工具不同、入口相同（都是内核命令行）：RHEL 系用 `rd.break`，Arch 与 Debian 用 `break=premount`（见 3.2 的表）。进去后根在 `/sysroot` 且常为只读，`mount -o remount,rw /sysroot` 后即可改文件、跑 fsck，教科书场景（root 密码遗失）的完整序列：

```bash
switch_root:/(initramfs)# mount -o remount,rw /sysroot
switch_root:/(initramfs)# chroot /sysroot                  # 换根后路径与 passwd 都按真根算
bash-5.2# passwd root
New password: ...
passwd: password updated successfully
bash-5.2# touch /.autorelabel                            # RHEL 系且开着 SELinux 时必做，重打文件标签
bash-5.2# exit; exit                                     # 两层退出，流程继续正常启动
```

要做完整修复（重装 GRUB、重建 initramfs），标准姿势是继续挂 ESP 与虚拟文件系统后 chroot——完整命令序列在[GRUB 页](../basic/boot/grub.md)的救援一节，此处不重复。`init=/bin/bash` 则是跳过 initramfs 之后一切的核弹级选项，适合"我只想改一个文件"的场景。

## 5. systemd 阶段

### 5.1 default.target 的解析链

真根挂好、systemd 起来后，第一件事是读 `/etc/systemd/system/default.target`——它通常是个符号链接，指向 `multi-user.target`（服务器常态）或 `graphical.target`（桌面）。这条解析链有两个入口可以干预：持久层用 `systemctl set-default multi-user.target` 改链接，临时层在内核命令行加 `systemd.unit=rescue.target` 覆盖一次。日常核对用 `systemctl get-default`；"我明明装的桌面版，怎么开机是黑底命令行"这类问题，答案九成在这个链接上。

### 5.2 job 卡住与 90 秒倒计时

屏幕停在 `A start job is running for xxx` 并倒数 90 秒，是这一棒的招牌故障。先看正在跑什么：

```bash
$ systemctl list-jobs
JOB UNIT                             TYPE  STATE
2334 NetworkManager-wait-online.service start running
2340 dev-disk-by\x2duuidxxxx.device  start running     # 有设备在等

2 jobs listed.
$ journalctl -b -p err --no-pager | tail -5   # 同一时刻的错误日志对照看
```

倒计时的元凶基本分两族。**等网络**：`NetworkManager-wait-online.service` 对"联网就绪"的判定比多数业务需要严格（任一网卡没拿到地址就等满超时），处置是 `systemctl disable NetworkManager-wait-online.service`——除非真有服务依赖启动序（如挂网络存储），否则它对服务器纯属仪式。**等设备**：fstab 里的挂载点对应的设备迟迟不出现（U 盘没插、盘符变了），处置是在 fstab 选项里加 `nofail`（等不到也继续开机）与 `x-systemd.device-timeout=5s`（把 90 秒压到 5 秒），网络存储再加 `_netdev`。两族的共同点是"超时只是症状，等的东西才是病"——倒计时结束进的多半是 emergency 模式，那里才是真实现场。等设备一族的修法举一个真实例子：fstab 里那行早就不存在的 U 盘备份挂载，每次开机都让全场陪它等 90 秒：

```text
# /etc/fstab —— 修复前后对照
UUID=xxxx-xxxx  /mnt/backup  ext4  defaults                 0 2    # 修复前：等不到就卡 90 秒
UUID=xxxx-xxxx  /mnt/backup  ext4  nofail,x-systemd.device-timeout=5s  0 2   # 修复后：5 秒放行
```

`systemctl daemon-reload` 让改过的 fstab 生效，一次 `journalctl -b -u dev-disk-…` 能确认设备单元不再无限等待。顺带一句：`nofail` 之外还有 `noauto`（干脆不自动挂），备份盘这类"在不在都行"的介质两个都合适；网络存储则要 `_netdev` 声明依赖网络就绪，否则它在网络起来之前就被催挂载，白等一场。

### 5.3 rescue 与 emergency 的区别

两个降级模式经常被混为一谈，分界其实简单：**rescue.target 是"单用户检修态"**——本地文件系统照常挂载、网络与其他多用户服务停掉、给 root 一个 sulogin 的 shell，适合改配置、修密码这类"系统本身健康、我需要安静环境"的活；**emergency.target 是"最小急救态"**——只挂根且常为只读、其余一概不拉，文件系统检查失败或 systemd 自身出错时被动的落点，适合 fsck、修 fstab 这种"系统已经不健康"的场景。进入方式对称：内核命令行 `systemd.unit=rescue.target` 与 `systemd.unit=emergency.target`，或传统的 `1` 与 `emergency`。判断该进哪个的口诀：能正常挂载就用 rescue，挂载都成问题才用 emergency。

### 5.4 第五棒：登录提示符

systemd 把 target 拉完，最后交给登录层：服务器上是 getty（`getty@tty1.service` 及其模板实例，背后是 agetty + login），桌面发行版则是显示管理器（`display-manager.service`，sddm/gdm/lightdm 三选一）。这一棒的故障特征很有辨识度：**系统其实在跑**——网口灯在闪、SSH 能连、`systemctl status` 全绿，只是本地屏幕黑着或没有登录框。判别手法是 Ctrl+Alt+F2 切到裸 tty：裸 tty 能出登录提示符，说明内核与 getty 健康，问题锁死在图形栈（显示管理器或显卡驱动），去 `journalctl -b -u display-manager` 里找证据；裸 tty 也黑，才回头查更早的棒次。远程管理视角下这一棒几乎隐形——它只影响"坐在机器前的人"，所以服务器装机时顺手确认 `systemctl enable getty@tty1` 与 SSH 服务的自启，是让第五棒永远不占你时间的两句保险。

## 6. 启动性能分析

### 6.1 三板斧

`systemd-analyze` 的三板斧正好沿五棒接力给出证据链。第一斧看总量：

```bash
$ systemd-analyze
Startup finished in 2.3s (firmware) + 3.1s (loader) + 8.9s (kernel)
                      + 12.6s (initrd) + 24.5s (userspace) = 51.4s
```

输出五段与第 1 节的五棒一一对应——firmware 与 loader 慢是固件侧的事（硬件自检、ESP 读取），操作系统无能为力，先认清哪几秒不归你管再动手。第二斧看个体：`systemd-analyze blame` 列每个服务的初始化耗时；第三斧看路径：`systemd-analyze critical-chain multi-user.target` 给出拖住目标的关键链。

### 6.2 别被 blame 骗了

blame 是三板斧里最常被误读的：systemd 并行拉服务，一个排在 blame 榜首的服务可能只是"恰好被别人堵在路上"——它自己耗时短，等的时间长。真正的答案永远在 critical-chain：链上的服务才是串行瓶颈，优化它才有收益。看一段典型输出：

```bash
$ systemd-analyze critical-chain --no-pager | head -8
The time when unit became active or started is printed after the "@" character.
The time the unit took to start is printed after the "+" character.
multi-user.target +0.0s
└─NetworkManager-wait-online.service @21.3s +2.1s
  └─NetworkManager.service @1.8s +0.4s
    └─basic.target @1.7s
      └─...
```

链上 `NetworkManager-wait-online` 在第 21.3 秒才等完——这就是 5.2 节那个老朋友，disable 它之后 critical-chain 换人，再优化下一位。另外两个常见收益点：清掉不需要 enable 的服务（清单思路见[服务管理页](./services-systemd.md)），以及把 `plymouth-quit-wait` 这类纯装饰开销摘掉；想看时间轴全图，`systemd-analyze plot > boot.svg` 出一张可缩放的 SVG，肉眼扫异常段很直观。系统级性能优化的更大盘子（CPU/IO 调优）另见[性能优化](./performance.md)。

## 7. 排错与常见坑

**黑屏无输出。** 先分清"无背光"与"有输出但黑"：前者是硬件/供电层，后者才与引导链相关。判别用排除法——Live USB 能亮则固件无罪；服务器走串口 `console=ttyS0,115200` 把现场引出来。刚装完显卡驱动或升级内核的黑屏，GRUB 菜单加 `nomodeset` 先亮起来，再卸驱动回退。

**卡在 "A start job is running for…" 90 秒。** 按 5.2 节两族排查：`systemctl list-jobs` 看在等网络还是等设备；wait-online 类直接 disable，设备类查 fstab 加 `nofail` 与 `x-systemd.device-timeout=5s`。倒计时走完进的 emergency 模式不是故障本身，是被扣下的现场。

**内核 panic：VFS: Unable to mount root fs。** 按 4.2 节三因速查：UUID 拷错/分区变动、initramfs 缺驱动、文件系统损坏。留档最后一屏，进 initramfs shell（`rd.break` 或 `break=premount`）用 `blkid` 与 `ls /dev/…` 分辨是"找不到盘"还是"盘在但挂不上"，再对号入座。

**手改 grub.cfg 重启变砖。** `/boot/grub2/grub.cfg` 这类文件由生成器产出，内核更新即被覆盖；正确的持久化入口是 `/etc/default/grub`（或 `/etc/grub.d/` 自定义脚本）加三系各自的 mkconfig 命令。已经变砖的，按[GRUB 页](../basic/boot/grub.md)的 Live USB + chroot 流程重装。

**initramfs 重建失败。** 最常见是 `/boot` 分区满——每个内核的镜像加 initramfs 动辄上百 MB，旧内核攒几年就爆。清旧内核：Debian `apt autoremove --purge`、RHEL `dnf remove kernel-…`（保留当前与前一个）、Arch `paccache -rk2`。其次是内核头或固件包缺失导致生成中断，看 mkinitcpio/dracut 的报错行补包即可。

**装好驱动重启不认盘。** 驱动只装进了真根，initramfs 快照里没有（4.1 节）。三系补法：Arch 改 `mkinitcpio.conf` 的 `MODULES` 后 `mkinitcpio -P`，RHEL 在 dracut 配置 `add_drivers` 后 `dracut -f`，Debian 写 `/etc/initramfs-tools/modules` 后 `update-initramfs -u`。判断"驱动在不在 initramfs 里"，`lsinitrd`/`lsinitcpio` 能直接列内容。

**屏幕全黑但系统其实在跑。** 先摸现象再动手：网口灯闪、ping 得通、SSH 能进——第五棒的典型现场（5.4 节），Ctrl+Alt+F2 切 tty 分清图形栈与内核；连 ping 都不通才回头按第一到第四棒扫。无显示输出的服务器装机时把 `console=ttyS0` 配好、带外口留好，这一类"黑屏恐慌"从一开始就不会发生。

**改了默认目标不生效。** `systemctl set-default` 改的是符号链接，而内核命令行的 `systemd.unit=` 优先级更高——上次排错留下的临时参数若被写进了 `GRUB_CMDLINE_LINUX`，就会一直压过你的设置。`systemctl get-default` 核对链接、`cat /proc/cmdline` 核对实际生效命令行，两相对照立刻见分晓。

## 参考资料

- Arch Wiki: Boot process — [wiki.archlinux.org/title/Boot_process](https://wiki.archlinux.org/title/Boot_process)
- Arch Wiki: GRUB — [wiki.archlinux.org/title/GRUB](https://wiki.archlinux.org/title/GRUB)
- Arch Wiki: Mkinitcpio — [wiki.archlinux.org/title/Mkinitcpio](https://wiki.archlinux.org/title/Mkinitcpio)
- systemd-analyze 手册 — [freedesktop.org](https://www.freedesktop.org/software/systemd/man/systemd-analyze.html)
- systemd 启动流程官方说明 — [systemd.io/BOOT](https://systemd.io/BOOT)（固件之后到用户态的官方口径）
- 鸟哥的私房菜 — 开机流程、关机流程 — [linux.vbird.org](https://linux.vbird.org/)
- man dracut / man mkinitcpio / man initramfs-tools（三系 initramfs 工具各自的手册）
