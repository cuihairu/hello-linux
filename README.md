<p align="center"><img src="docs/public/logo.svg" width="64" height="64" alt="logo" /> </p>

# Hello Linux

<p align="center">
  <img src="docs/public/badges/topic.svg" alt="topic" />
  <img src="docs/public/badges/docs.svg" alt="docs" />
  <img src="docs/public/badges/license.svg" alt="license" />
  <img src="docs/public/badges/langs.svg" alt="langs" />
</p>

<div align="center">

</div>

从零开始学习 Linux，参考鸟哥的私房菜和 Arch Wiki，覆盖 Debian/Ubuntu、Arch、RHEL/CentOS/Rocky 三系。

## 内容

| 篇章 | 说明 |
|------|------|
| [基础篇](https://cuihairu.github.io/hello-linux/basic/overview.html) | 概念、安装、文件系统、开机流程、包管理、用户管理、服务、安全、日志 |
| [命令篇](https://cuihairu.github.io/hello-linux/commands/basic/file.html) | 文件/目录/文本/查找/压缩/系统/网络/包管理命令参考 |
| [硬件篇](https://cuihairu.github.io/hello-linux/hardware/architecture.html) | 体系结构、CPU、内存、存储、网络设备 |
| [系统管理篇](https://cuihairu.github.io/hello-linux/system-management/performance.html) | 性能优化、备份恢复、自动化运维、例行性工作、systemd 服务、日志系统、开机流程 |
| [服务器篇](https://cuihairu.github.io/hello-linux/server/web/nginx.html) | 网络参数、路由 NAT、Web 服务器、数据库、Redis、FTP、容器、监控、DNS、邮件、DHCP、Samba、NFS、NTP |
| [脚本篇](https://cuihairu.github.io/hello-linux/script/bash-basics.html) | Bash 基础、变量、条件判断、循环、函数、文本处理、正则表达式、调试、实战案例 |
| [安全篇](https://cuihairu.github.io/hello-linux/security/firewall.html) | 防火墙、入侵检测、加密技术、安全加固、PAM/sudo、SELinux 实战 |
| [网络篇](https://cuihairu.github.io/hello-linux/network/basics.html) | 网络基础、防火墙、VPN、负载均衡、网络监控、配置基础、故障排除、TCP/IP 要点、命令实战 |
| [源码篇](https://cuihairu.github.io/hello-linux/source/README.html) | 内核源码获取与编译、调度、内存、VFS、网络栈、中断、IPC、驱动、系统调用 |

完整目录见 [SUMMARY](https://cuihairu.github.io/hello-linux/SUMMARY.html)。

## 特点

- 每章配实战命令示例与真实终端输出
- 同时覆盖 Debian/Ubuntu、Arch、RHEL/CentOS/Rocky 三系
- 参考资料标注，无虚构内容
- 基于 VitePress 构建，支持本地搜索

## 本地运行

```bash
npm install
npm run docs:dev
```

构建与预览：

```bash
npm run docs:build
npm run docs:preview
```

链接检查与测试（CI 同款门禁）：

```bash
npm run docs:check   # 需先 docs:build 才含产物级 HTML 校验
npm run docs:test    # 单测
npm run docs:cov     # 覆盖率：check_links 与 tree_art 行+分支 100% 门禁（fail_under=100）
```

## 仓库脚本

| 脚本 | 用途 |
|------|------|
| `scripts/check_links.py` | 链接检查器：源码级（md 链接/锚点/图片）+ 索引级（SUMMARY 必须覆盖全部内容页、每个条目均出现在 nav/sidebar）+ 产物级（HTML 链接/锚点/资源）+ sitemap 对账（每条 loc 可达、每个页面在册）。`npm run docs:check` 即调用它，CI 额外加 `--require-html` 强制产物级校验 |
| `scripts/tree_art.py` | 多色字符画树渲染器：种子化高程 + 湿度双场生成岛屿世界，河流刻蚀入海，quadtree 字符组合叠加地形/水系/生物群落三通道配色。零第三方依赖，`--seed` 决定世界、同种子输出可复现 |

`tree_art.py` 用法（均已实跑验证）：

```bash
# 终端 ANSI 真彩输出（默认 160×64）
python3 scripts/tree_art.py --seed 7

# 静默模式 + 输出带图例的预览 HTML
python3 scripts/tree_art.py --seed 7 --w 80 --h 32 --quiet --html tree.html

# 配合 --png 截图出效果图（依赖 playwright）
python3 scripts/tree_art.py --seed 7 --html tree.html --png tree.png
```

## 构建部署

推送到 `main` 分支后自动通过 GitHub Actions 部署到 GitHub Pages。构建时生成 `sitemap.xml`（收录全部内容页、自动跟随新增页面；sub-path 站点的 base 拼接在 `transformItems` 内完成）。`robots.txt` 放行全站收录并指向上述 sitemap。

## 参考资料

- [鸟哥的私房菜](https://linux.vbird.org/)
- [Arch Wiki](https://wiki.archlinux.org/)
- [Debian 手册](https://www.debian.org/doc/manuals/debian-handbook/)
- [RHEL 文档](https://docs.redhat.com/)

## 维护备注

- 2026-10：外链残留批（全量外链核查收尾）。docs.redhat.com 域对 curl 全域 403（反爬），改以 WebFetch 直访 + access.redhat.com 301 重定向双通道仲裁死活。确认失效 13 处并修复：安装指南迁至 `interactively_installing_rhel_from_installation_media`（boot.md、bios_uefi.md）；GRUB2 内核命令行章节路径并入书根 `managing_monitoring_and_updating_the_kernel`（grub.md）；`html-single/managing_storage` 并入 `managing_storage_devices`（acl_permissions.md、disk_quotas.md）；`identity_management` 拆分后「管理用户和组」内容落在 `configuring_basic_system_settings` 第 7 章（users.md；account_management.md 原误指 using_selinux 一并归位）；`compressing_and_archiving_files`、`searching_files_and_file_contents` 两书自 RHEL 9 目录退役，改 GNU tar/findutils 手册（compression.md、find-and-locate.md）；DNF 书 slug 误缀 `installing_` 前缀改正（package.md）；`getting_started_with_the_red_hat_enterprise_linux_console` 书退役改鸟哥基础篇（commands/README.md）；tcpdump 章节已自监控书移除改书根（network-tools.md）；Arch Wiki `Network_debugging` 下线改 `Network_configuration`（network-tools.md）；hardware/network.md 的 `html-single` 路径归一为 `html` 形态。复验后判定存活的疑似项：`configuring_and_managing_networking`、`monitoring_and_managing_system_status_and_performance`（瞬态 404，301+目录在列复验）、uefi.org（浏览器可达、curl 反爬）、RHEL 7 备份分册与 security_hardening LUKS 章节（403/瞬态后复验可达）。末批疑瞬态定性存活保留：man.archlinux.org ×42（wayback 2026-07 快照 200 佐证，本机出口被连接层限速属探测方问题）、help.ubuntu.com ×4（域根 2026-09-30 快照 200，503/429 为反爬而非 404）、groups.google.com 帖（2026-07 快照 200）；fonts.googleapis.com/gstatic 裸域为 config 预连接合法用法，不计入外链。
- 2026-10：站点巡检轮（对照 SUMMARY 清单核对 126 个目录条目、站点 128 页（含目录页与首页）实际一致性 + 参考资料外链抽样）。结论：页面与清单一致，无薄页/空章节；`check_links` 静态与产物级检查 23462/23462 全绿。外链抽样 54 页 / 291 条：269 正常，确定 10 处失效并已换用实测可达的替代（docs.kernel.org 后缀迁移、Arch Wiki Checklist 并入主条目、chrony 文档路径迁移、鸟哥 NFS 章节号变更、man7 下架命令 at/ping/mtr 换 man.archlinux.org、RHEL 9 防火墙指南从 `configuring_and_managing_firewalls` 迁至 `configuring_firewalls_and_packet_filters`（含 security 篇 RHEL 8 时代 assembly 路径）、Cisco 21284 文档退役换 22166 BGP 排障页）；7 处反爬假阳性保留（elixir.bootlin.com ×5、cisecurity.org ×2，带 UA 实测 200）；6 处网络瞬态（000/ERR）登记不动（security.appspot.com、proftpd.org、hub.docker.com、wireguard.com、openvpn.net、libreswan.org）。
- 2026-10：清理了一条悬空 stash（基于 `9c8c35f` 的旧 WIP，混合了首页卡片去 emoji、README 标题重排、内联样式迁出与 vitepress 升级）。经 merge-tree 实测其中两处文件与迁移后的现行内容冲突；样式迁出与依赖升级两项已由后续提交以最终形态落地（`theme/style.css` 及其深色模式修复、`package.json` 的 `2.0.0-alpha.20`），首页卡片 emoji 在当时是约定风格（`style.css` 中"去装饰 emoji"仅指文档内表格；该批 emoji 后随 2026-10 的版式清理移除），故丢弃不作迁移。

## 许可证

[Apache License 2.0](LICENSE)