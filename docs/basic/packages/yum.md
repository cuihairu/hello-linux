# YUM/DNF 包管理（RHEL/CentOS/Fedora）

## 学习目标

- 掌握 YUM/DNF 的基本使用方法
- 了解软件源的配置
- 学会管理软件包

## 1. YUM/DNF 简介

- **YUM**：Yellowdog Updater Modified，RHEL/CentOS 7 及之前版本使用
- **DNF**：Dandified YUM，RHEL/CentOS 8+ 和 Fedora 使用，是 YUM 的替代品

### 1.1 常用命令

```bash
# 更新所有包
sudo yum update    # YUM
sudo dnf update    # DNF

# 安装软件包
sudo yum install package_name
sudo dnf install package_name

# 卸载软件包
sudo yum remove package_name
sudo dnf remove package_name

# 搜索软件包
yum search keyword
dnf search keyword

# 查看软件包信息
yum info package_name
dnf info package_name

# 列出已安装的包
yum list installed
dnf list installed

# 清理缓存
sudo yum clean all
sudo dnf clean all

# 查看历史
yum history
dnf history

# 回滚操作
sudo yum history undo transaction_id
sudo dnf history undo transaction_id
```

### 1.2 RPM 命令

RPM 是底层包管理工具：

```bash
# 安装 rpm 包
sudo rpm -ivh package.rpm

# 升级 rpm 包
sudo rpm -Uvh package.rpm

# 卸载包
sudo rpm -e package_name

# 查询已安装的包
rpm -qa

# 查询包安装的文件
rpm -ql package_name

# 查询文件属于哪个包
rpm -qf /path/to/file

# 查询包信息
rpm -qi package_name
```

## 2. 软件源配置

### 2.1 源配置文件

```bash
# YUM 源配置
/etc/yum.repos.d/

# DNF 源配置
/etc/yum.repos.d/  # 与 YUM 相同
```

### 2.2 源文件格式

```ini
[repo-name]
name=Repository Name
baseurl=http://mirror.example.com/centos/$releasever/os/$basearch/
gpgcheck=1
gpgkey=file:///etc/pki/rpm-gpg/RPM-GPG-KEY-centosofficial
enabled=1
```

### 2.3 使用国内源

```bash
# 备份原文件
sudo cp -r /etc/yum.repos.d /etc/yum.repos.d.bak

# 下载国内源配置（以阿里源为例）
sudo wget -O /etc/yum.repos.d/CentOS-Base.repo https://mirrors.aliyun.com/repo/Centos-7.repo

# 清理并重建缓存
sudo yum clean all
sudo yum makecache
```

## 3. 软件包组管理

### 3.1 包组命令

```bash
# 列出所有包组
yum groups list
dnf group list

# 查看包组信息
yum groups info "Development Tools"
dnf group info "Development Tools"

# 安装包组
sudo yum groupinstall "Development Tools"
sudo dnf group install "Development Tools"

# 卸载包组
sudo yum groupremove "Development Tools"
sudo dnf group remove "Development Tools"
```

## 4. 版本锁定

### 4.1 锁定包版本

```bash
# 安装插件
sudo yum install yum-plugin-versionlock

# 锁定版本
sudo yum versionlock add package_name

# 查看锁定列表
sudo yum versionlock list

# 解锁
sudo yum versionlock delete package_name
```

## 5. EPEL 源

EPEL（Extra Packages for Enterprise Linux）提供额外的软件包：

```bash
# 安装 EPEL 源
sudo yum install epel-release    # CentOS 7
sudo dnf install epel-release    # CentOS 8+

# 启用 EPEL 源
sudo yum --enablerepo=epel install package_name
sudo dnf --enablerepo=epel install package_name
```

## 6. YUM/DNF 对比

| 特性 | YUM | DNF |
|------|-----|-----|
| Python 版本 | Python 2 | Python 3 |
| 依赖解析 | 较慢 | 更快 |
| 内存使用 | 较高 | 更低 |
| 插件支持 | 丰富 | 内置 |
| 默认版本 | CentOS 7 | CentOS 8+ |

## 参考资料

- [鸟哥的私房菜 - 软件管理](https://linux.vbird.org/linux_basic/0520softwaremanager.php)
- [RHEL 文档 - 软件管理](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_software_with_the_dnf_tool/index)
- [DNF 文档](https://dnf.readthedocs.io/)
