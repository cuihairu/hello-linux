# Hello Linux

从零开始学习 Linux，参考鸟哥的私房菜和 Arch Wiki，覆盖 Debian/Ubuntu 和 RHEL/CentOS 两系。

## 内容

| 篇章 | 说明 |
|------|------|
| [基础篇](https://cuihairu.github.io/hello-linux/basic/) | 概念、安装、文件系统、开机流程、包管理、用户管理、服务、安全、日志 |
| [命令篇](https://cuihairu.github.io/hello-linux/commands/) | 文件/目录/文本/系统/网络/包管理命令参考 |
| [硬件篇](https://cuihairu.github.io/hello-linux/hardware/) | 体系结构、CPU、内存、存储、网络设备 |
| [系统管理](https://cuihairu.github.io/hello-linux/system-management/) | 性能优化 |
| [网络篇](https://cuihairu.github.io/hello-linux/network/) | 网络基础、防火墙 |

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

[GPL-3.0](LICENSE)
