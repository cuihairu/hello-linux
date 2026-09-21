# SELinux 策略配置

## 学习目标

- 理解 SELinux 策略的结构
- 掌握策略配置方法
- 学会创建自定义策略模块

## 1. 策略基础

### 1.1 策略类型

- **Targeted 策略**：保护特定服务，最常用
- **MLS 策略**：多级安全保护
- **Minimum 策略**：Targeted 的精简版

### 1.2 策略组件

```
策略 = 类型 + 规则 + 布尔值 + 上下文
```

## 2. 策略规则

### 2.1 allow 规则

```bash
# 基本语法
allow source_type target_type : object_class permissions;

# 示例：允许 httpd 读取 Web 内容
allow httpd_t httpd_sys_content_t : file { read open getattr };
```

### 2.2 常见规则类型

| 规则类型 | 说明 |
|---------|------|
| allow | 允许访问 |
| dontaudit | 不记录拒绝日志 |
| neverallow | 永不允许（编译时检查） |

## 3. 策略模块管理

### 3.1 查看已安装模块

```bash
# 列出所有模块
semodule -l

# 查看模块详情
semodule -lfull
```

### 3.2 安装模块

```bash
# 安装策略模块
sudo semodule -i mymodule.pp

# 启用模块
sudo semodule -e mymodule

# 禁用模块
sudo semodule -d mymodule

# 删除模块
sudo semodule -r mymodule
```

## 4. 创建自定义策略模块

### 4.1 使用 audit2allow

```bash
# 从日志生成策略
sudo ausearch -m avc | audit2allow -M mymodule

# 查看生成的策略
cat mymodule.te

# 编译并安装
sudo semodule -i mymodule.pp
```

### 4.2 手动创建策略

创建 `.te` 文件：

```bash
# mymodule.te
policy_module(mymodule, 1.0)

# 定义类型
type myapp_t;
type myapp_exec_t;

# 定义域转换
domain_type(myapp_t)
domain_entry_file(myapp_t, myapp_exec_t)

# 允许规则
allow myapp_t myapp_exec_t:file { read open execute };
```

### 4.3 编译策略

```bash
# 编译策略模块
checkmodule -M -m -o mymodule.mod mymodule.te

# 创建策略包
semodule_package -o mymodule.pp -m mymodule.mod

# 安装策略包
sudo semodule -i mymodule.pp
```

## 5. 常见策略配置

### 5.1 Web 服务器策略

```bash
# 允许 httpd 网络连接
sudo setsebool -P httpd_can_network_connect on

# 允许 httpd 发送邮件
sudo setsebool -P httpd_can_sendmail on

# 允许 httpd 访问家目录
sudo setsebool -P httpd_enable_homedirs on
```

### 5.2 数据库策略

```bash
# 允许 MySQL 网络连接
sudo setsebool -P mysqld_connect_any on

# 允许 PostgreSQL 网络连接
sudo setsebool -P postgresql_can_rsync on
```

### 5.3 SSH 策略

```bash
# 允许 SSH 使用非标准端口
sudo semanage port -a -t ssh_port_t -p tcp 2222

# 允许 SSH X11 转发
sudo setsebool -P ssh_sysadm_login on
```

## 6. 策略调试

### 6.1 查看拒绝日志

```bash
# 查看 AVC 拒绝日志
sudo ausearch -m avc -ts recent

# 使用 sealert 分析
sudo sealert -a /var/log/audit/audit.log
```

### 6.2 生成策略建议

```bash
# 从日志生成策略建议
sudo ausearch -m avc | audit2allow -w

# 生成策略模块
sudo ausearch -m avc | audit2allow -M mymodule
```

## 7. 策略文件结构

### 7.1 文件类型

| 文件 | 说明 |
|------|------|
| .te | 策略源文件 |
| .if | 接口文件 |
| .fc | 文件上下文文件 |
| .pp | 编译后的策略包 |

### 7.2 示例策略文件

```bash
# mymodule.te
policy_module(mymodule, 1.0)

# mymodule.if
interface(`myapp_domtrans',`
    gen_requires(`
        type myapp_t;
        type myapp_exec_t;
    ')
    domtrans_pattern($1, myapp_exec_t, myapp_t)
')

# mymodule.fc
/usr/bin/myapp  --  gen_context(system_u:object_r:myapp_exec_t,s0)
```

## 8. 最佳实践

### 8.1 策略设计原则

1. **最小权限**：只授予必要的权限
2. **类型隔离**：为每个应用定义独立的类型
3. **布尔值控制**：使用布尔值提供灵活配置

### 8.2 调试流程

1. 查看拒绝日志
2. 分析原因
3. 生成策略建议
4. 测试策略
5. 部署到生产环境

## 参考资料

- [鸟哥的私房菜 - SELinux 策略](https://linux.vbird.org/linux_basic/0410accountmanager.php#selinux_policy)
- [Arch Wiki - SELinux 策略](https://wiki.archlinux.org/title/SELinux/Policy)
- [RHEL SELinux 策略编写](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/using_selinux/writing-a-custom-selinux-policy_using-selinux)
