# SELinux 模式

SELinux 有三种运行模式，选择哪一种直接决定系统的安全强度与排障方式。本节讲清三种模式的行为差异、三发行版默认值，以及切换模式时最容易踩的边界。

> 内容参考自 Red Hat 文档，见文末参考资料。

## 学习目标

- 分清 Enforcing、Permissive、Disabled 三种模式的行为差异与副作用
- 知道三发行版的默认模式，解释为什么不能简单"Disabled 了事"
- 会用 `getenforce`/`setenforce` 查看与临时切换，并理解临时的边界
- 掌握 `/etc/selinux/config` 永久配置与启动参数的优先级
- 能根据排障阶段选择合适模式：先 Permissive 取证，再 Enforcing 验证

## 1. 三种模式：行为与后果

| 模式 | 行为 | AVC 拒绝日志 | 适用场景 | 主要风险 |
|------|------|-------------|---------|---------|
| **Enforcing** | 强制执行策略，违规访问被真实拒绝 | 记录 | 生产环境（RHEL 系默认） | 策略缺口会阻断合法业务 |
| **Permissive** | 只记录不拒绝，访问实际放行 | 记录 | 策略调试、上线前观察期 | 误以为"没报错就是没策略问题"，带病上线 |
| **Disabled** | 不加载策略，SELinux 完全不参与决策 | 无（模块未加载） | 不推荐 | 标签不再维护，重新启用时必须全盘重建标签 |

三个关键认知：

**Enforcing 与 Permissive 的差别只在"是否执行拒绝"**。两者都会写 AVC 日志——所以用 Permissive 收集拒绝清单是安全的（业务不受影响），但收集到的拒绝不会自愈，业务看似正常实则策略仍有缺口，观察结束后必须逐条修复再切回 Enforcing。

**Disabled 不是"更宽松的 Permissive"，而是另一个世界**。Disabled 状态下内核不加载策略、进程和文件的新标签不再被维护；从 Disabled 切回 Enforcing/Permissive 时，大量文件会带着"上一次启用时的旧标签"或根本缺失标签，**必须在重启时执行全盘 relabel（`/.autorelabel` 或启动阶段自动重建）**，否则系统可能因关键文件标签错乱而无法启动或服务大面积异常。这也是"临时调试请用 Permissive，不要用 Disabled"的原因。

**模式检查发生在每次访问**，`setenforce` 切换立即对后续访问生效，无需重启（Disabled 与 Enforcing 之间的切换除外）。

## 2. 三发行版默认值

| 发行版 | 默认 MAC | 默认模式 | 说明 |
|--------|---------|---------|------|
| RHEL / CentOS / Rocky / Fedora | SELinux | **Enforcing** | 出厂即强制，targeted 策略 |
| Debian / Ubuntu | AppArmor | enforce（AppArmor 语义） | SELinux 默认未安装/未启用，`getenforce` 常报 `Disabled` 或命令不存在 |
| Arch | 无默认 MAC | SELinux 默认不启用 | 需自行安装工具链与策略后才谈得上模式选择 |

```bash
# RHEL/CentOS/Rocky：出厂应看到
$ getenforce
Enforcing

$ sestatus
SELinux status:                 enabled
SELinuxfs mount:                /sys/fs/selinux
SELinux root directory:         /etc/selinux
Loaded policy name:             targeted
Current mode:                   enforcing
Mode from config file:          enforcing
Policy MLS status:              enabled
Policy deny_unknown status:     allowed
Max kernel policy version:      33
```

Debian/Ubuntu 上常见输出（AppArmor 系统，SELinux 未启用）：

```bash
$ getenforce
Disabled
# 或
-bash: getenforce: command not found

# Ubuntu/Debian 真正该看的是
$ sudo aa-status | head -5
apparmor module is loaded.
34 profiles are loaded.
14 profiles are in enforce mode.
```

**不要**因为 Ubuntu 上 `getenforce` 返回 `Disabled` 就以为"SELinux 被关了"——它根本没装。两套体系的判断入口不同，先确认发行版再选命令（见[概念](./concept.md)第 5 节）。

## 3. 查看状态

```bash
getenforce      # 只输出 Enforcing / Permissive / Disabled（轻量，适合脚本）
sestatus        # 完整状态：是否启用、当前模式、配置文件模式、加载的策略、MLS 等
```

注意 `sestatus` 里两个模式字段可能不一致：

- `Current mode`：**运行时**当前模式。
- `Mode from config file`：**下次重启**将采用的模式。

排查"我明明 setenforce 了为什么重启后变了"时，先分清你改的是哪一个。

## 4. 临时切换：setenforce 的边界

`setenforce` 只改运行时模式，**不写配置文件，重启后回到配置文件指定的模式**：

```bash
sudo setenforce 0    # → 运行时切到 Permissive
sudo setenforce 1    # → 运行时切到 Enforcing
```

它有明确的适用边界，用错会带来两种事故：

**能做的**：在 Enforcing 与 Permissive 之间热切换。生产环境怀疑 SELinux 拦了业务时，`setenforce 0` 立刻放行观察，同时 `ausearch` 收集拒绝记录，修完策略再 `setenforce 1` 验证。

**不能做的**：
1. **不能用它切换到 Disabled**。`setenforce` 只接受 0（Permissive）和 1（Enforcing），Disabled 必须改配置文件并重启。
2. **Disabled 状态下 `setenforce` 无效**。策略模块根本没加载，写 `/sys/fs/selinux/enforce` 不会产生期望效果（或直接报错）。
3. **不是持久化手段**。重启后 `Current mode` 会回到 `Mode from config file`——只 `setenforce 0` 不改配置文件就去重启，服务会在下次开机重新被拦。

```bash
# 临时切 Permissive（重启失效）
$ sudo setenforce 0
$ getenforce
Permissive
```

## 5. 永久配置：/etc/selinux/config

持久模式写在 `/etc/selinux/config`（部分系统为 `/etc/sysconfig/selinux` 的符号链接）：

```bash
# /etc/selinux/config
# SELINUX= can take one of these three values:
#     enforcing - SELinux security policy is enforced.
#     permissive - SELinux prints warnings instead of enforcing.
#     disabled - No SELinux policy is loaded.
SELINUX=enforcing
# SELINUXTYPE= can take one of these three values:
#     targeted - only targeted processes are protected.
#     minimum - modification of targeted policy. Only selected processes are protected.
#     mls - Multi Level Security protection.
SELINUXTYPE=targeted
```

`SELINUX=` 只接受三个小写值：`enforcing`、`permissive`、`disabled`（历史文档里的大写写法多数系统兼容，但小写是标准）。`SELINUXTYPE=` 是策略类型，与运行模式是两个维度，改动需谨慎（见[策略配置](./policy_configuration.md)）。

**生效方式对照**：

| 从 → 到 | 操作 | 是否需要重启 | 额外步骤 |
|---------|------|-------------|---------|
| Enforcing ↔ Permissive | `setenforce 0/1` | 否 | — |
| 任意 → Disabled | 改配置文件 | 是 | 建议重启前不需要 relabel；**再次启用前**需准备 relabel |
| Disabled → Enforcing/Permissive | 改配置文件 | 是 | **必须全盘 relabel**，否则标签错乱 |

从 Disabled 切回 Enforcing 的正确姿势：

```bash
# 1. 改配置
sudo vim /etc/selinux/config      # SELINUX=enforcing

# 2. 标记重启时全盘重建标签（二选一）
sudo touch /.autorelabel          # 标准做法：下次启动自动 relabel，耗时较长属正常

# 3. 重启
sudo reboot
```

重启后 relabel 过程可能持续数分钟到更久，进度可在控制台看到；**此期间不要断电**，否则标签库可能损坏到需要再次 relabel。这就是第 1 节强调"调试用 Permissive、不要用 Disabled"的现实原因。

## 6. 选择建议

- **生产服务器（RHEL 系）**：保持 Enforcing。这是发行版安全基线的一部分，关闭它意味着放弃针对该服务的纵深防御。
- **新服务上线前 / 策略调试期**：先用 Permissive 跑一个完整业务周期，收集 `ausearch -m avc` 结果，批量修复后再切 Enforcing——比"先关掉，出事再说"可控得多。
- **紧急排障（生产已受影响）**：`setenforce 0` 立即止血 → `ausearch` 抓证据 → 修复（布尔值/fcontext/策略）→ `setenforce 1` 验证 → 视需要把观察结果固化进配置文件。
- **Debian/Ubuntu**：本文的 `setenforce`/`/etc/selinux/config` 流程不适用；AppArmor 用 `aa-complain`（相当于 complain≈Permissive）与 `aa-enforce` 切换单个 profile。
- **Arch**：默认无 SELinux 可关；若已自行启用，模式逻辑与 RHEL 相同，但 relabel 与策略维护责任完全在自己。

## 7. 常见坑

1. **`setenforce 0` 后以为"SELinux 关了"**：只是运行时 Permissive，重启即恢复；且 Disabled 标签漂移的风险远大于 Permissive 观察期。
2. **改了配置文件却不重启**：`/etc/selinux/config` 的修改不会热生效，当前 `Current mode` 不变——两个字段要分清。
3. **Disabled 直接改回 Enforcing 不 relabel**：文件标签停留在禁用前的状态，重启后服务大面积 `avc: denied`，极端情况进不了图形界面/起不来关键服务。务必 `touch /.autorelabel`。
4. **在 Debian/Ubuntu 上执行本节命令**：该系默认 AppArmor，`getenforce` 显示 Disabled 是"未安装"而非"被你关了"，改用 `aa-status`。
5. **在 Arch 上假设 `setenforce` 存在**：未自行启用 SELinux 时用户态工具缺失，命令会 not found，先确认 `/sys/fs/selinux` 是否存在。
6. **把 MLS 的 `s0` 差异当成模式问题**：同为 Enforcing，`level` 字段不同也会导致拒绝，那是策略的 MLS 维度，不是运行模式，见[概念](./concept.md)。

## 参考资料

- Red Hat - Using SELinux（模式切换章节） — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/using_selinux/index)
- `man getenforce` — [man7.org](https://man7.org/linux/man-pages/man8/getenforce.8.html)
- `man setenforce` — [man7.org](https://man7.org/linux/man-pages/man8/setenforce.8.html)
- `man setenforce`
- `man sestatus`
- Arch Wiki - SELinux — [wiki.archlinux.org](https://wiki.archlinux.org/title/SELinux)
- Debian Wiki - SELinux — [wiki.debian.org](https://wiki.debian.org/SELinux)
