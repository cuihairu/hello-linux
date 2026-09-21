# SELinux 概念

SELinux（Security-Enhanced Linux）是 Linux 的强制访问控制（MAC）安全机制。

> 内容参考自 Red Hat SELinux 文档和 Arch Wiki，见文末参考资料。

## 1. DAC vs MAC

| 模型 | 说明 | 特点 |
|------|------|------|
| DAC | 自主访问控制 | 传统权限，基于用户/组 |
| MAC | 强制访问控制 | SELinux，基于安全策略 |

## 2. 安全上下文

SELinux 为每个对象分配安全标签：

```bash
# 查看文件上下文
ls -Z file.txt
# system_u:object_r:httpd_sys_content_t:s0

# 查看进程上下文
ps auxZ | grep httpd
```

格式：`user:role:type:level`

## 3. 类型强制

SELinux 通过类型（Type）控制访问：

```bash
# 进程类型
httpd_t    # Apache
sshd_t     # SSH

# 文件类型
httpd_sys_content_t    # Web 内容
```

## 4. 工作流程

```
进程请求访问 → 检查 DAC → 检查 SELinux 策略 → 允许/拒绝
```

## 参考资料

- Red Hat SELinux 文档 — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/using_selinux/index)
- Arch Wiki - SELinux — [wiki.archlinux.org](https://wiki.archlinux.org/title/SELinux)
