# SELinux 模式

SELinux 有三种运行模式。

> 内容参考自 Red Hat 文档，见文末参考资料。

## 三种模式

| 模式 | 说明 | 用途 |
|------|------|------|
| Enforcing | 强制模式，违反策略被拒绝 | 生产环境 |
| Permissive | 宽容模式，只记录不拒绝 | 调试测试 |
| Disabled | 禁用模式 | 不推荐 |

## 查看状态

```bash
getenforce      # 查看当前模式
sestatus        # 查看详细状态
```

## 临时切换

```bash
sudo setenforce 0    # 切换到 Permissive
sudo setenforce 1    # 切换到 Enforcing
```

## 永久配置

编辑 `/etc/selinux/config`：

```bash
SELINUX=enforcing    # 或 permissive, disabled
SELINUXTYPE=targeted
```

重启生效。

## 参考资料

- Red Hat SELinux 文档 — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/using_selinux/index)
