# 包管理命令

## 学习目标

- 掌握 APT 和 YUM/DNF 的使用方法
- 了解软件源的配置和管理
- 学会解决依赖问题

## 1. APT 包管理（Debian/Ubuntu）

### 1.1 基本操作

```bash
# 更新软件源
sudo apt update

# 升级所有包
sudo apt upgrade

# 安装软件包
sudo apt install package_name

# 安装多个包
sudo apt install package1 package2

# 卸载软件包
sudo apt remove package_name

# 卸载并删除配置
sudo apt purge package_name

# 自动删除不需要的依赖
sudo apt autoremove
```

### 1.2 查询操作

```bash
# 搜索软件包
apt search keyword

# 查看软件包信息
apt show package_name

# 列出已安装的包
apt list --installed

# 列出可升级的包
apt list --upgradable

# 查看包的依赖
apt depends package_name

# 查看包的反向依赖
apt rdepends package_name
```

### 1.3 dpkg 底层命令

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

## 2. YUM/DNF 包管理（RHEL/CentOS/Fedora）

### 2.1 基本操作

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

# 自动删除不需要的依赖
sudo yum autoremove
sudo dnf autoremove
```

### 2.2 查询操作

```bash
# 搜索软件包
yum search keyword
dnf search keyword

# 查看软件包信息
yum info package_name
dnf info package_name

# 列出已安装的包
yum list installed
dnf list installed

# 列出可升级的包
yum list updates
dnf list updates

# 查看包的依赖
yum deplist package_name
dnf repoquery --requires package_name
```

### 2.3 RPM 底层命令

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

## 3. 软件源管理

### 3.1 APT 源配置

```bash
# 源列表文件
/etc/apt/sources.list

# 额外源
/etc/apt/sources.list.d/

# 添加 PPA
sudo add-apt-repository ppa:user/ppa-name

# 删除 PPA
sudo add-apt-repository --remove ppa:user/ppa-name
```

### 3.2 YUM/DNF 源配置

```bash
# 源配置文件
/etc/yum.repos.d/

# 安装 EPEL 源
sudo yum install epel-release    # CentOS 7
sudo dnf install epel-release    # CentOS 8+

# 启用/禁用源
sudo yum --enablerepo=epel install package_name
sudo yum --disablerepo=epel install package_name
```

## 4. 版本锁定

### 4.1 APT 版本锁定

```bash
# 锁定包版本
sudo apt-mark hold package_name

# 解锁包版本
sudo apt-mark unhold package_name

# 查看锁定的包
apt-mark showhold
```

### 4.2 YUM/DNF 版本锁定

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

## 5. 本地仓库

### 5.1 创建 APT 本地仓库

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

### 5.2 创建 YUM/DNF 本地仓库

```bash
# 安装工具
sudo yum install createrepo

# 创建仓库目录
mkdir -p /tmp/myrepo

# 复制 rpm 包到仓库目录
cp *.rpm /tmp/myrepo/

# 创建仓库
createrepo /tmp/myrepo

# 添加源配置
sudo vim /etc/yum.repos.d/myrepo.repo
```

## 6. 常见问题

### 6.1 依赖问题

```bash
# APT 修复依赖
sudo apt --fix-broken install

# YUM 修复依赖
sudo yum clean all
sudo yum update
```

### 6.2 缓存问题

```bash
# APT 清理缓存
sudo apt clean
sudo apt autoclean

# YUM 清理缓存
sudo yum clean all
sudo yum makecache
```

### 6.3 锁文件问题

```bash
# APT 锁文件问题：先确认没有 apt/dpkg 进程在运行
ps aux | grep -E 'apt|dpkg' | grep -v grep

# 如果有残留进程，结束它们
sudo kill <PID>

# 修复中断的安装
sudo dpkg --configure -a
sudo apt --fix-broken install

# YUM 锁文件问题
ps aux | grep yum | grep -v grep
# 确认无进程后
sudo rm -f /var/run/yum.pid
```

## 7. 两系对比

| 操作 | APT (Debian/Ubuntu) | YUM/DNF (RHEL/CentOS) |
|------|---------------------|------------------------|
| 更新源 | apt update | yum makecache |
| 升级 | apt upgrade | yum update |
| 安装 | apt install | yum install |
| 卸载 | apt remove | yum remove |
| 搜索 | apt search | yum search |
| 信息 | apt show | yum info |

## 参考资料

- [鸟哥的私房菜 - 软件管理](https://linux.vbird.org/linux_basic/centos7/0520softwaremanager.php)
- [Debian 手册 - APT](https://www.debian.org/doc/manuals/debian-handbook/apt.zh-cn.html)
- [RHEL 文档 - DNF](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_software_with_the_dnf_tool/index)
