# 选择合适的发行版

安装前先确定用哪个发行版。本节给出快速决策建议。

## 快速决策

```
你是谁？→ 选什么？
─────────────────────────────────────
学生/新手        → Ubuntu Desktop
开发者           → Ubuntu / Fedora
企业服务器       → Rocky Linux / Debian
安全测试         → Kali Linux
老电脑           → Xubuntu / Debian
```

## 桌面用户

| 需求 | 推荐 | 理由 |
|------|------|------|
| 刚接触 Linux | Ubuntu LTS | 资料最多，社区最活跃 |
| 电脑配置较低 | Xubuntu / Lubuntu | 轻量桌面环境 |
| 喜欢折腾 | Fedora | 软件最新 |
| 追求极简 | Arch Linux | 从零构建，学习最深 |

## 服务器用户

| 需求 | 推荐 | 理由 |
|------|------|------|
| 企业生产 | Rocky Linux / AlmaLinux | RHEL 兼容，长期支持 |
| 个人项目 | Ubuntu Server / Debian | 软件丰富，文档多 |
| 容器/云 | Ubuntu Server | Docker/K8s 支持好 |

## 下载

发行版官网下载 ISO 镜像，建议使用国内镜像加速：

| 发行版 | 国内镜像 |
|--------|---------|
| Ubuntu | https://mirrors.tuna.tsinghua.edu.cn/ubuntu-releases/ |
| Debian | https://mirrors.tuna.tsinghua.edu.cn/debian-cd/ |
| Rocky | https://mirrors.tuna.tsinghua.edu.cn/rocky/ |

下载后校验完整性：

```bash
sha256sum ubuntu-24.04-desktop-amd64.iso
```

## 参考资料

- [Ubuntu 下载](https://ubuntu.com/download)
- [Debian 下载](https://www.debian.org/distrib/)
- [Rocky Linux 下载](https://rockylinux.org/download)
- [DistroWatch](https://distrowatch.com/)
