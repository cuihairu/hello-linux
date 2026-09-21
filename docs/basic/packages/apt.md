# APT 包管理

APT（Advanced Package Tool）是 Debian/Ubuntu 系的包管理工具。

> 内容参考自 Debian 手册和 Ubuntu 文档，见文末参考资料。

## 常用命令

```bash
# 更新软件源
sudo apt update

# 升级系统
sudo apt upgrade

# 安装软件
sudo apt install package_name

# 卸载软件
sudo apt remove package_name

# 卸载并删除配置
sudo apt purge package_name

# 自动删除不需要的依赖
sudo apt autoremove

# 搜索软件
apt search keyword

# 查看软件信息
apt show package_name

# 列出已安装的包
apt list --installed

# 清理缓存
sudo apt clean
```

## dpkg 底层命令

```bash
# 安装 deb 包
sudo dpkg -i package.deb

# 查看包安装的文件
dpkg -L package_name

# 查看文件属于哪个包
dpkg -S /path/to/file

# 修复依赖
sudo apt --fix-broken install
```

## 国内镜像源

```bash
# 备份
sudo cp /etc/apt/sources.list /etc/apt/sources.list.bak

# 替换为清华源（Ubuntu 24.04）
sudo sed -i 's|http://archive.ubuntu.com|https://mirrors.tuna.tsinghua.edu.cn|g' /etc/apt/sources.list
sudo apt update
```

## 版本锁定

```bash
# 锁定版本
sudo apt-mark hold package_name

# 解锁
sudo apt-mark unhold package_name
```

## 参考资料

- Debian APT 手册 — [debian.org](https://www.debian.org/doc/manuals/debian-handbook/apt.zh-cn.html)
- `man apt`、`man dpkg`
