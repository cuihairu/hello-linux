# Hello Linux

从零开始学习 Linux，参考鸟哥的私房菜和 Arch Wiki，覆盖 Debian/Ubuntu 和 RHEL/CentOS 两系。

## 内容

| 篇章 | 说明 |
|------|------|
| [基础篇](https://cuihairu.github.io/hello-linux/basic/) | 概念、安装、文件系统、开机流程、包管理、用户管理、服务、安全、日志 |
| [命令篇](https://cuihairu.github.io/hello-linux/commands/) | 文件/目录/文本/查找/压缩/系统/网络/包管理命令参考 |
| [硬件篇](https://cuihairu.github.io/hello-linux/hardware/) | 体系结构、CPU、内存、存储、网络设备 |
| [系统管理篇](https://cuihairu.github.io/hello-linux/system-management/) | 性能优化、备份恢复、自动化运维 |
| [服务器篇](https://cuihairu.github.io/hello-linux/server/) | Web服务器、数据库、Redis、FTP、容器、监控、DNS、邮件 |
| [脚本篇](https://cuihairu.github.io/hello-linux/script/) | Bash基础、变量、条件判断、循环、函数、文本处理、正则表达式、调试、实战案例 |
| [安全篇](https://cuihairu.github.io/hello-linux/security/) | 防火墙、入侵检测、加密技术、安全加固 |
| [网络篇](https://cuihairu.github.io/hello-linux/network/) | 网络基础、防火墙、VPN、负载均衡、网络监控、配置基础、故障排除 |

## 特点

- 每章配实战命令示例
- 同时覆盖 Debian/Ubuntu 和 RHEL/CentOS 两系
- 参考资料标注，无虚构内容
- 基于 VitePress 构建，支持搜索

## 本地运行

```bash
npm install
npm run docs:dev
```

## 构建部署

推送到 `main` 分支后自动通过 GitHub Actions 部署到 GitHub Pages。

## 参考资料

- [鸟哥的私房菜](https://linux.vbird.org/)
- [Arch Wiki](https://wiki.archlinux.org/)
- [Debian 手册](https://www.debian.org/doc/manuals/debian-handbook/)
- [RHEL 文档](https://docs.redhat.com/)

## 许可证

[Apache License 2.0](LICENSE)
