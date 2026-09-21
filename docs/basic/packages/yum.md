# YUM/DNF 包管理

YUM/DNF 是 RHEL/CentOS/Fedora 系的包管理工具。DNF 是 YUM 的替代品，语法兼容。

> 内容参考自 RHEL 文档，见文末参考资料。

## 常用命令

```bash
# 更新系统
sudo dnf update

# 安装软件
sudo dnf install package_name

# 卸载软件
sudo dnf remove package_name

# 搜索软件
dnf search keyword

# 查看软件信息
dnf info package_name

# 列出已安装的包
dnf list installed

# 清理缓存
sudo dnf clean all
```

## RPM 底层命令

```bash
# 安装 rpm 包
sudo rpm -ivh package.rpm

# 卸载包
sudo rpm -e package_name

# 查询文件属于哪个包
rpm -qf /path/to/file

# 查询包安装的文件
rpm -ql package_name
```

## EPEL 源

```bash
# 安装 EPEL 源
sudo dnf install epel-release

# 从 EPEL 安装软件
sudo dnf --enablerepo=epel install package_name
```

## 国内镜像源

```bash
# 备份
sudo cp -r /etc/yum.repos.d /etc/yum.repos.d.bak

# 下载阿里源（CentOS 7）
sudo wget -O /etc/yum.repos.d/CentOS-Base.repo https://mirrors.aliyun.com/repo/Centos-7.repo
sudo yum makecache
```

## YUM 与 DNF 对比

| 特性 | YUM | DNF |
|------|-----|-----|
| Python | Python 2 | Python 3 |
| 依赖解析 | 较慢 | 更快 |
| 默认版本 | CentOS 7 | CentOS 8+ / Fedora |

## 参考资料

- RHEL DNF 文档 — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_software_with_the_dnf_tool/index)
- `man dnf`、`man rpm`
