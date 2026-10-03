# Hello Linux

<div align="center">

<img src="docs/public/logo.svg" width="64" alt="Hello Linux">

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
npm run docs:cov     # 覆盖率：行+分支 100% 门禁（fail_under=100）
```

## 仓库脚本

| 脚本 | 用途 |
|------|------|
| `scripts/check_links.py` | 链接检查器：源码级（md 链接/锚点/图片）+ 产物级（HTML 链接/锚点/资源）。`npm run docs:check` 即调用它，CI 额外加 `--require-html` 强制产物级校验 |
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

推送到 `main` 分支后自动通过 GitHub Actions 部署到 GitHub Pages。

## 参考资料

- [鸟哥的私房菜](https://linux.vbird.org/)
- [Arch Wiki](https://wiki.archlinux.org/)
- [Debian 手册](https://www.debian.org/doc/manuals/debian-handbook/)
- [RHEL 文档](https://docs.redhat.com/)

## 维护备注

- 2026-10：清理了一条悬空 stash（基于 `9c8c35f` 的旧 WIP，混合了首页卡片去 emoji、README 标题重排、内联样式迁出与 vitepress 升级）。经 merge-tree 实测其中两处文件与迁移后的现行内容冲突；样式迁出与依赖升级两项已由后续提交以最终形态落地（`theme/style.css` 及其深色模式修复、`package.json` 的 `2.0.0-alpha.20`），首页卡片 emoji 为现行约定风格（`style.css` 中"去装饰 emoji"仅指文档内表格），故丢弃不作迁移。

## 许可证

[Apache License 2.0](LICENSE)
