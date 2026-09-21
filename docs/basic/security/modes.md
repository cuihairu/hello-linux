# SELinux 模式

## 学习目标

- 掌握 SELinux 三种模式的切换方法
- 了解各模式的应用场景
- 学会查看和修改 SELinux 模式

## 1. SELinux 模式详解

### 1.1 Enforcing 模式

强制模式是 SELinux 的默认生产模式：
- 所有违反策略的操作被拒绝
- 违规事件记录到日志
- 提供最强的安全保护

```bash
# 查看当前模式
getenforce

# 输出
Enforcing
```

### 1.2 Permissive 模式

宽容模式用于调试和测试：
- 违反策略的操作只记录不拒绝
- 用于排查 SELinux 相关问题
- 不提供实际安全保护

```bash
# 临时切换到 Permissive
sudo setenforce 0

# 验证
getenforce
# 输出：Permissive
```

### 1.3 Disabled 模式

禁用模式完全关闭 SELinux：
- SELinux 不生效
- 不记录任何违规事件
- 需要重启系统才能切换到此模式

## 2. 查看 SELinux 状态

### 2.1 使用 sestatus

```bash
# 查看详细状态
sestatus

# 输出示例
SELinux status:                 enabled
SELinuxfs mount:                /sys/fs/selinux
SELinux root directory:         /etc/selinux
Loaded policy name:             targeted
Current mode:                   enforcing
Mode from config file:          enforcing
Policy MLS status:              enabled
Policy deny_unknown status:     allowed
Memory protection checking:     actual (secure)
Max kernel policy version:      33
```

### 2.2 使用 getenforce

```bash
# 快速查看当前模式
getenforce
# 输出：Enforcing
```

## 3. 修改 SELinux 模式

### 3.1 临时修改（重启后失效）

```bash
# 切换到 Permissive
sudo setenforce 0

# 切换到 Enforcing
sudo setenforce 1
```

### 3.2 永久修改（需要重启）

```bash
# 编辑配置文件
sudo vim /etc/selinux/config

# 修改 SELINUX 参数
SELINUX=enforcing    # 强制模式
SELINUX=permissive   # 宽容模式
SELINUX=disabled     # 禁用

# 重启系统
sudo reboot
```

## 4. SELinux 配置文件

### 4.1 主配置文件

```bash
/etc/selinux/config
```

配置示例：

```bash
# This file controls the state of SELinux on the system.
# SELINUX= can take one of these three values:
#     enforcing - SELinux security policy is enforced.
#     permissive - SELinux prints warnings instead of enforcing.
#     disabled - No SELinux policy is loaded.
SELINUX=enforcing

# SELINUXTYPE= can take one of these three values:
#     targeted - Targeted processes are protected,
#     minimum - Modification of targeted policy.
#     mls - Multi Level Security protection.
SELINUXTYPE=targeted
```

### 4.2 策略类型

| 策略类型 | 说明 |
|---------|------|
| targeted | 保护特定服务，最常用 |
| minimum | targeted 的精简版 |
| mls | 多级安全保护 |

## 5. 模式切换场景

### 5.1 生产环境

```bash
# 建议使用 Enforcing 模式
SELINUX=enforcing
SELINUXTYPE=targeted
```

### 5.2 开发测试

```bash
# 可以使用 Permissive 模式调试
sudo setenforce 0

# 查看违规日志
sudo ausearch -m avc -ts recent
```

### 5.3 排查问题

```bash
# 临时切换到 Permissive
sudo setenforce 0

# 测试应用是否正常

# 如果正常，检查 SELinux 日志
sudo ausearch -m avc -ts recent

# 修复后切换回 Enforcing
sudo setenforce 1
```

## 6. 禁用 SELinux 的影响

### 6.1 安全风险

- 失去强制访问控制保护
- 进程可以访问任意资源
- 权限提升攻击更容易

### 6.2 不建议禁用

```bash
# 不建议在生产环境禁用 SELinux
# 如果遇到问题，应该修复策略而不是禁用
```

## 7. 两系差异

| 方面 | Debian/Ubuntu | RHEL/CentOS |
|------|---------------|-------------|
| 默认状态 | 通常禁用 | Enforcing |
| 配置文件 | /etc/selinux/config | /etc/selinux/config |
| 策略 | targeted | targeted |

## 参考资料

- [鸟哥的私房菜 - SELinux](https://linux.vbird.org/linux_basic/0410accountmanager.php#selinux)
- [Arch Wiki - SELinux](https://wiki.archlinux.org/title/SELinux)
- [RHEL SELinux 文档](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/using_selinux/index)
