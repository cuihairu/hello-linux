# SELinux 概念

## 学习目标

- 理解 SELinux 的基本概念
- 了解 SELinux 与传统权限的区别
- 掌握 SELinux 的工作原理

## 1. SELinux 简介

SELinux（Security-Enhanced Linux）是由美国国家安全局（NSA）开发的强制访问控制（MAC）系统。

### 1.1 什么是 SELinux

- **强制访问控制（MAC）**：基于安全策略的访问控制
- **自主访问控制（DAC）**：传统的基于用户的访问控制

### 1.2 SELinux 的作用

- 限制进程只能访问必要的资源
- 防止权限提升攻击
- 提供细粒度的访问控制
- 满足安全合规要求

## 2. SELinux 与传统权限

### 2.1 传统权限（DAC）

```bash
# 传统权限基于用户和组
-rwxr-xr-x 1 root root 1234 Jan 1 00:00 file.txt

# 进程以用户身份运行
# root 进程可以访问所有文件
```

### 2.2 SELinux（MAC）

```bash
# SELinux 基于安全上下文
-rwxr-xr-x 1 root root system_u:object_r:httpd_sys_content_t 1234 Jan 1 00:00 file.txt

# 即使是 root 进程，也受 SELinux 策略限制
```

## 3. SELinux 核心概念

### 3.1 安全上下文

安全上下文是 SELinux 用于标识对象的标签：

```
user:role:type:level

# 示例
system_u:object_r:httpd_sys_content_t:s0
```

- **user**：SELinux 用户
- **role**：角色
- **type**：类型（最重要）
- **level**：安全级别

### 3.2 类型强制（Type Enforcement）

类型强制是 SELinux 的主要访问控制机制：

```bash
# 进程类型
httpd_t    # Apache 进程类型
sshd_t     # SSH 进程类型

# 文件类型
httpd_sys_content_t    # Web 内容类型
sshd_var_run_t         # SSH 运行时文件类型
```

### 3.3 策略规则

策略规则定义了类型之间的访问权限：

```bash
# 允许 httpd_t 访问 httpd_sys_content_t
allow httpd_t httpd_sys_content_t:file { read open getattr };

# 允许 sshd_t 读取 sshd_var_run_t
allow sshd_t sshd_var_run_t:file { read open getattr };
```

## 4. SELinux 工作流程

```
1. 进程请求访问文件
2. 检查 DAC 权限（传统权限）
3. 如果 DAC 允许，检查 SELinux 策略
4. 如果 SELinux 允许，访问成功
5. 如果 SELinux 拒绝，访问失败并记录日志
```

## 5. SELinux 优势

### 5.1 最小权限原则

```bash
# Apache 进程只能访问 Web 内容
# 即使被攻击，也无法访问其他文件
```

### 5.2 防止权限提升

```bash
# 即使 root 进程被攻击
# SELinux 仍然限制其访问范围
```

### 5.3 细粒度控制

```bash
# 可以精确控制每个进程的访问权限
# 例如：允许读取，禁止写入
```

## 6. SELinux 应用场景

- **Web 服务器**：限制 Apache/Nginx 的访问范围
- **数据库**：限制数据库进程的访问权限
- **容器**：隔离容器进程
- **政府/金融**：满足安全合规要求

## 7. SELinux 状态

| 状态 | 说明 |
|------|------|
| Enforcing | 强制模式，违反策略的操作被拒绝并记录 |
| Permissive | 宽容模式，违反策略的操作只记录不拒绝 |
| Disabled | 禁用模式，SELinux 不生效 |

## 参考资料

- [鸟哥的私房菜 - SELinux](https://linux.vbird.org/linux_basic/0410accountmanager.php#selinux)
- [Arch Wiki - SELinux](https://wiki.archlinux.org/title/SELinux)
- [Red Hat SELinux 文档](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/using_selinux/index)
