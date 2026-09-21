# SELinux 基本命令

管理 SELinux 的常用命令。

> 内容参考自 Red Hat 文档，见文末参考资料。

## 状态查看

```bash
getenforce          # 当前模式
sestatus            # 详细状态
```

## 安全上下文

```bash
# 查看文件上下文
ls -Z file.txt

# 查看进程上下文
ps auxZ | grep httpd

# 临时修改文件上下文
chcon -t httpd_sys_content_t file.txt

# 恢复默认上下文
restorecon -R /var/www/html/

# 永久添加上下文规则
sudo semanage fcontext -a -t httpd_sys_content_t "/data/www(/.*)?"
sudo restorecon -R /data/www/
```

## 布尔值

```bash
# 查看所有布尔值
getsebool -a

# 设置布尔值
sudo setsebool -P httpd_can_network_connect on
```

## 端口管理

```bash
# 查看端口标签
semanage port -l | grep http

# 添加端口
sudo semanage port -a -t http_port_t -p tcp 8080
```

## 日志分析

```bash
# 查看拒绝日志
sudo ausearch -m avc -ts recent

# 使用 sealert 分析
sudo sealert -a /var/log/audit/audit.log
```

## 参考资料

- `man semanage`、`man setsebool`、`man restorecon`
- Red Hat SELinux 命令 — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/using_selinux/index)
