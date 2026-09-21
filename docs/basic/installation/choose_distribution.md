# 选择合适的 Linux 发行版

## 学习目标

- 了解不同发行版的特点和适用场景
- 掌握选择发行版的考虑因素
- 学会下载和验证发行版镜像

## 1. 选择考虑因素

### 1.1 用途

| 用途 | 推荐发行版 |
|------|-----------|
| 桌面办公 | Ubuntu、Linux Mint、Fedora |
| 服务器 | RHEL、Rocky Linux、Debian、Ubuntu Server |
| 开发环境 | Ubuntu、Fedora、Arch Linux |
| 安全测试 | Kali Linux、Parrot OS |
| 嵌入式 | Debian、Yocto |
| 学习 | Ubuntu、CentOS（历史） |

### 1.2 硬件配置

| 硬件 | 推荐 |
|------|------|
| 老旧电脑 | Lubuntu、Xubuntu、Debian |
| 新电脑 | Ubuntu、Fedora |
| 服务器 | Ubuntu Server、Debian、Rocky Linux |

### 1.3 技术水平

| 水平 | 推荐 |
|------|------|
| 新手 | Ubuntu、Linux Mint |
| 有经验 | Debian、Fedora |
| 专家 | Arch Linux、Gentoo |

## 2. 获取发行版

### 2.1 官方下载

- **Ubuntu**：https://ubuntu.com/download
- **Debian**：https://www.debian.org/distrib/
- **Fedora**：https://fedoraproject.org/
- **Rocky Linux**：https://rockylinux.org/

### 2.2 镜像站点

使用国内镜像可以加快下载速度：

- **清华源**：https://mirrors.tuna.tsinghua.edu.cn/
- **阿里源**：https://mirrors.aliyun.com/
- **中科大源**：https://mirrors.ustc.edu.cn/

### 2.3 验证镜像

下载后务必验证镜像的完整性：

```bash
# 验证 SHA256
sha256sum ubuntu-24.04-desktop-amd64.iso

# 验证 GPG 签名（需要先导入公钥）
gpg --verify SHA256SUMS.gpg SHA256SUMS
sha256sum -c SHA256SUMS
```

## 3. 制作启动盘

### 3.1 Windows

- **Rufus**：https://rufus.ie/
- **balenaEtcher**：https://www.balena.io/etcher/

### 3.2 macOS/Linux

```bash
# 使用 dd 命令（谨慎使用，确认设备名）
sudo dd if=ubuntu-24.04-desktop-amd64.iso of=/dev/sdX bs=4M status=progress
sync

# 或使用 balenaEtcher（图形界面）
```

## 参考资料

- [鸟哥的私房菜 - 安装 Linux](https://linux.vbird.org/linux_basic/0160startlinux.php)
- [Arch Wiki - Installation guide](https://wiki.archlinux.org/title/Installation_guide)
