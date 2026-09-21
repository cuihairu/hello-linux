# SELinux 策略配置

SELinux 策略定义了进程对资源的访问规则。

> 内容参考自 Red Hat 文档，见文末参考资料。

## 1. 策略类型

| 策略 | 说明 |
|------|------|
| targeted | 保护特定服务，最常用 |
| minimum | targeted 的精简版 |
| mls | 多级安全保护 |

## 2. 策略模块管理

```bash
# 列出已安装模块
semodule -l

# 安装模块
sudo semodule -i mymodule.pp

# 删除模块
sudo semodule -r mymodule
```

## 3. 从日志生成策略

```bash
# 从拒绝日志生成策略
sudo ausearch -m avc | audit2allow -M mymodule

# 查看建议
sudo ausearch -m avc | audit2allow -w

# 安装生成的策略
sudo semodule -i mymodule.pp
```

## 4. 常见布尔值

```bash
# 允许 httpd 网络连接
sudo setsebool -P httpd_can_network_connect on

# 允许 httpd 发送邮件
sudo setsebool -P httpd_can_sendmail on
```

## 参考资料

- Red Hat SELinux 策略编写 — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/using_selinux/writing-a-custom-selinux-policy_using-selinux)
- `man audit2allow`、`man semodule`
