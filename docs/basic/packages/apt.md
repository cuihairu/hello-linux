# APT 包管理（Debian/Ubuntu）

## 学习目标

- 掌握 APT 的基本使用方法
- 了解软件源的配置
- 学会管理软件包

## 1. APT 简介

APT（Advanced Package Tool）是 Debian/Ubuntu 系列的包管理工具。

### 1.1 常用命令

```bash
# 更新软件源列表
sudo apt update

# 升级所有已安装的包
sudo apt upgrade

# 升级系统（可能删除旧包）
sudo apt full-upgrade

# 安装软件包
sudo apt install package_name

# 安装多个包
sudo apt install package1 package2

# 安装本地 deb 包
sudo apt install ./package.deb

# 卸载软件包
sudo apt remove package_name

# 卸载并删除配置文件
sudo apt purge package_name

# 自动删除不需要的依赖
sudo apt autoremove

# 搜索软件包
apt search keyword

# 查看软件包信息
apt show package_name

# 列出已安装的包
apt list --installed

# 清理下载的包缓存
sudo apt clean
sudo apt autoclean
```

### 1.2 dpkg 命令

dpkg 是底层包管理工具：

```bash
# 安装 deb 包
sudo dpkg -i package.deb

# 卸载包
sudo dpkg -r package_name

# 卸载并删除配置
sudo dpkg -P package_name

# 查看已安装的包
dpkg -l

# 查看包安装的文件
dpkg -L package_name

# 查看文件属于哪个包
dpkg -S /path/to/file

# 修复依赖关系
sudo apt --fix-broken install
```

## 2. 软件源配置

### 2.1 源列表文件

```bash
# 主源列表
/etc/apt/sources.list

# 额外源
/etc/apt/sources.list.d/
```

### 2.2 源格式

```
deb http://archive.ubuntu.com/ubuntu/ jammy main restricted
deb-src http://archive.ubuntu.com/ubuntu/ jammy main restricted
```

- `deb`：二进制包
- `deb-src`：源代码包
- `http://...`：源地址
- `jammy`：发行版代号
- `main restricted`：组件

### 2.3 使用国内源

```bash
# 备份原文件
sudo cp /etc/apt/sources.list /etc/apt/sources.list.bak

# 编辑源列表
sudo vim /etc/apt/sources.list
```

清华大学源（Ubuntu 24.04）：

```
deb https://mirrors.tuna.tsinghua.edu.cn/ubuntu/ noble main restricted universe multiverse
deb-src https://mirrors.tuna.tsinghua.edu.cn/ubuntu/ noble main restricted universe multiverse
deb https://mirrors.tuna.tsinghua.edu.cn/ubuntu/ noble-updates main restricted universe multiverse
deb-src https://mirrors.tuna.tsinghua.edu.cn/ubuntu/ noble-updates main restricted universe multiverse
deb https://mirrors.tuna.tsinghua.edu.cn/ubuntu/ noble-backports main restricted universe multiverse
deb-src https://mirrors.tuna.tsinghua.edu.cn/ubuntu/ noble-backports main restricted universe multiverse
deb https://mirrors.tuna.tsinghua.edu.cn/ubuntu/ noble-security main restricted universe multiverse
deb-src https://mirrors.tuna.tsinghua.edu.cn/ubuntu/ noble-security main restricted universe multiverse
```

## 3. PPA（Personal Package Archive）

### 3.1 添加 PPA

```bash
# 添加 PPA
sudo add-apt-repository ppa:user/ppa-name

# 更新并安装
sudo apt update
sudo apt install package_name
```

### 3.2 删除 PPA

```bash
# 删除 PPA
sudo add-apt-repository --remove ppa:user/ppa-name

# 或手动删除
sudo rm /etc/apt/sources.list.d/user-ubuntu-ppa-name-*.list
```

## 4. 版本锁定

### 4.1 锁定包版本

```bash
# 锁定包版本
sudo apt-mark hold package_name

# 解锁包版本
sudo apt-mark unhold package_name

# 查看锁定的包
apt-mark showhold
```

## 5. 本地仓库

### 5.1 创建本地仓库

```bash
# 安装工具
sudo apt install dpkg-dev

# 创建仓库目录
mkdir -p /tmp/myrepo

# 复制 deb 包到仓库目录
cp *.deb /tmp/myrepo/

# 生成 Packages 文件
cd /tmp/myrepo
dpkg-scanpackages . /dev/null | gzip -9c > Packages.gz

# 添加到源列表
echo "deb [trusted=yes] file:/tmp/myrepo ./" | sudo tee /etc/apt/sources.list.d/myrepo.list

# 更新
sudo apt update
```

## 参考资料

- [鸟哥的私房菜 - 软件管理](https://linux.vbird.org/linux_basic/0520softwaremanager.php)
- [Debian 手册 - 软件包管理](https://www.debian.org/doc/manuals/debian-handbook/apt.zh-cn.html)
- [Ubuntu Wiki - APT](https://help.ubuntu.com/community/AptGet/Howto)
