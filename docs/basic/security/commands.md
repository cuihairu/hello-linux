# SELinux 基本命令

## 学习目标

- 掌握 SELinux 状态查看命令
- 学会管理安全上下文
- 了解布尔值和策略管理

## 1. 状态查看命令

### 1.1 查看 SELinux 状态

```bash
# 查看当前模式
getenforce

# 查看详细状态
sestatus

# 查看 SELinux 是否启用
cat /etc/selinux/config | grep SELINUX
```

### 1.2 查看安全上下文

```bash
# 查看文件安全上下文
ls -Z file.txt

# 查看进程安全上下文
ps auxZ | grep httpd

# 查看当前用户安全上下文
id -Z
```

## 2. 安全上下文管理

### 2.1 chcon - 修改安全上下文

```bash
# 临时修改文件上下文
chcon -t httpd_sys_content_t /var/www/html/index.html

# 修改用户
chcon -u system_u /var/www/html/index.html

# 修改角色
chcon -r object_r /var/www/html/index.html

# 递归修改目录
chcon -R -t httpd_sys_content_t /var/www/html/

# 参考其他文件的上下文
chcon --reference=/var/www/html/index.html /new/file.html
```

### 2.2 restorecon - 恢复默认上下文

```bash
# 恢复文件默认上下文
restorecon /var/www/html/index.html

# 递归恢复目录
restorecon -R /var/www/html/

# 详细输出
restorecon -v /var/www/html/index.html

# 预览更改（不实际执行）
restorecon -n /var/www/html/index.html
```

### 2.3 semanage fcontext - 管理文件上下文

```bash
# 查看文件上下文规则
semanage fcontext -l

# 添加文件上下文规则
semanage fcontext -a -t httpd_sys_content_t "/data/www(/.*)?"

# 删除文件上下文规则
semanage fcontext -d "/data/www(/.*)?"

# 应用规则
restorecon -R /data/www/
```

## 3. 布尔值管理

### 3.1 查看布尔值

```bash
# 查看所有布尔值
getsebool -a

# 查看特定布尔值
getsebool httpd_can_network_connect

# 查看布尔值描述
semanage boolean -l
```

### 3.2 设置布尔值

```bash
# 临时设置布尔值
setsebool httpd_can_network_connect on

# 永久设置布尔值
setsebool -P httpd_can_network_connect on

# 批量设置
setsebool -P httpd_can_network_connect on httpd_can_sendmail on
```

## 4. 端口管理

### 4.1 查看端口标签

```bash
# 查看所有端口标签
semanage port -l

# 查看特定端口
semanage port -l | grep http
```

### 4.2 添加端口标签

```bash
# 添加端口标签
semanage port -a -t http_port_t -p tcp 8080

# 修改端口标签
semanage port -m -t http_port_t -p tcp 8080

# 删除端口标签
semanage port -d -t http_port_t -p tcp 8080
```

## 5. 日志分析

### 5.1 查看 SELinux 日志

```bash
# 查看审计日志
sudo ausearch -m avc

# 查看最近的日志
sudo ausearch -m avc -ts recent

# 查看特定类型的日志
sudo ausearch -m avc -c httpd
```

### 5.2 日志分析工具

```bash
# 安装 setroubleshoot
sudo yum install setroubleshoot    # RHEL/CentOS
sudo apt install setroubleshoot    # Debian/Ubuntu

# 查看 SELinux 警告
sudo sealert -a /var/log/audit/audit.log

# 查看特定事件
sudo sealert -l "*"
```

## 6. 策略管理

### 6.1 查看策略

```bash
# 查看已安装的策略
semodule -l

# 查看策略模块
semodule -lfull
```

### 6.2 策略模块管理

```bash
# 安装策略模块
semodule -i mymodule.pp

# 删除策略模块
semodule -r mymodule

# 启用策略模块
semodule -e mymodule

# 禁用策略模块
semodule -d mymodule
```

## 7. 常见问题排查

### 7.1 Web 服务器无法访问文件

```bash
# 检查文件上下文
ls -Z /var/www/html/

# 恢复默认上下文
restorecon -R /var/www/html/

# 检查布尔值
getsebool -a | grep httpd
```

### 7.2 服务无法绑定端口

```bash
# 检查端口标签
semanage port -l | grep http

# 添加端口标签
semanage port -a -t http_port_t -p tcp 8080
```

## 参考资料

- [鸟哥的私房菜 - SELinux](https://linux.vbird.org/linux_basic/0410accountmanager.php#selinux)
- [Arch Wiki - SELinux](https://wiki.archlinux.org/title/SELinux)
- [RHEL SELinux 命令](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/using_selinux/managing-confined-services_using-selinux)
