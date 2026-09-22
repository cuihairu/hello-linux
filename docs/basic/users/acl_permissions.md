# ACL 权限控制

传统 rwx 权限只有三组位：所有者、所属组、其他人。这个模型在"一人一文件"的世界里够用，但现实中的共享目录几乎总是提出三类位无法表达的需求——`/srv/projects` 属组是 `devops`，却要让只属于 `guest` 组的外包同学写其中一个子目录；家目录要让备份脚本以 `backup` 用户读，但不能把属主改掉。逐个 `chmod` 会破坏组语义，`chown` 会打断属主管线，于是 Linux 提供了 ACL（Access Control List）：在文件系统元数据里追加一张"针对任意用户/组的授权表"，与传统三位权限并行生效。理解 ACL 的关键不只是会敲 `setfacl`，而是搞懂 **mask** 字段——它像一道闸门，会悄悄收窄你精心设置的权限，也是"为什么我明明给了 rw 却写不进去"这类诡异问题的根源。

> 内容参考自 Arch Wiki 与 `man setfacl`/`man getfacl`，见文末参考资料。

## 学习目标

- 说清 ACL 解决了传统 rwx 的什么盲区
- 读懂 `getfacl` 输出中每一行（尤其是 `mask`）的含义
- 掌握 `setfacl` 的修改、递归与默认（default）ACL
- 会备份/恢复目录 ACL，知道 ext4 与 XFS 的支持情况

## 1. 为什么需要 ACL

传统模型的表达能力上限是"三组人"。当你要表达的是"**张三**这个特定用户对这个文件可读写"，而张三既不是属主、其主组也不是属组时，传统模型只剩下"其他人"这一档——给他开 `o+w` 意味着**所有**非属主非属组的人都能写。组方案也治标不治事：把张三临时拉进属组能解决一个文件，却会顺带打开该组能访问的全部文件。

ACL 把授权对象从三类扩展到任意数量的"具名用户/组"条目，同时保持向后兼容——不支持 ACL 的老程序调用 `stat()` 拿到的仍是传统三位权限（对应 ACL 里的 `user::`、`group::`、`other::`）。三大发行版家族的文件系统默认都支持 ACL：ext4、XFS、Btrfs、tmpfs 均开箱即用，无需内核参数调整；需要安装的只是用户态工具包。

```bash
# 三系安装 ACL 工具
$ sudo apt install acl        # Debian/Ubuntu
$ sudo pacman -S acl          # Arch
$ sudo dnf install acl        # RHEL/CentOS/Rocky
```

## 2. 读懂 getfacl 输出

先看一个未经修改的文件，ACL 与 `ls -l` 是一一对应的：

```bash
$ getfacl /srv/projects/notes.txt
# file: srv/projects/notes.txt
# owner: alice
# group: devops
user::rw-          ← 对应 ls -l 第一组 rwx（属主）
group::r--         ← 对应第二组 r-x 的读位（属组）
mask::rw-          ← 有效权限上限（见第 4 节）
other::r--         ← 对应第三组 r--
```

给 `guest` 用户单独加上读写后，多出来的就是一条**具名 ACL 条目**：

```bash
$ sudo setfacl -m u:guest:rw /srv/projects/notes.txt
$ getfacl /srv/projects/notes.txt
# file: srv/projects/notes.txt
# owner: alice
# group: devops
user::rw-
user:guest:rw-     ← 新增：针对具名用户的授权
group::r--
mask::rw-          ← mask 被自动抬升，以容纳 guest 的 rw
other::r--
```

对比 `ls -l` 会发现权限位串变长了——末尾出现的 `+` 号就是"存在 ACL"的标记：

```bash
$ ls -l /srv/projects/notes.txt
-rw-rw-r--+ 1 alice devops 0 Mar 15 10:24 /srv/projects/notes.txt
#           ↑ 有 + 号说明该文件带扩展 ACL
```

也可以直接为组授权，语义与具名用户一致，只是匹配对象换成组 GID：

```bash
$ sudo setfacl -m g:auditors:r /srv/projects/notes.txt
```

## 3. setfacl 常用操作

```bash
# 修改：给用户/组设置权限
$ sudo setfacl -m u:guest:rw file.txt
$ sudo setfacl -m g:auditors:r file.txt

# 同时给多者授权，用逗号分隔
$ sudo setfacl -m u:guest:rw,u:carol:r file.txt

# 递归应用到目录下已有的所有文件（-R）
$ sudo setfacl -R -m u:guest:rw /srv/projects/drafts/

# 删除某一条具名 ACL（-x，delete 模式）
$ sudo setfacl -x u:guest file.txt
$ sudo setfacl -x g:auditors file.txt

# 删除全部扩展 ACL，只留传统三位（-b，remove-all）
$ sudo setfacl -b file.txt

# 修改权限掩码（见下一节）
$ sudo setfacl -m m:r file.txt
```

一个必须区分的细节：`-R` 只影响**调用那一刻已经存在**的文件；之后新建的文件不会自动继承 ACL。要让新文件也带上授权条目，需要设置**默认 ACL（default ACL）**——它附着在目录上，像模板一样被 `open()`/`creat()` 创建的子文件与子目录继承：

```bash
# 为目录设置默认 ACL：今后在 drafts/ 下新建的文件自动继承 guest 的 rw
$ sudo setfacl -m d:u:guest:rw /srv/projects/drafts/

# 验证
$ touch /srv/projects/drafts/new.txt
$ getfacl /srv/projects/drafts/new.txt
# file: ...
user::rw-
user:guest:rw-     ← 新文件自动带上了，无需再手动 setfacl
group::r--
other::r--

# 清除默认 ACL
$ sudo setfacl -k /srv/projects/drafts/
```

注意 `d:` 前缀只在**目录**上有效；对普通文件设置 default ACL 会被拒绝。另外默认 ACL 的权限受目录自身 ACL 约束，若父目录 `group::r--`，子文件也继承不出写权限——权限是逐级"与"下来的。

## 4. mask：最容易踩的坑

mask 是 ACL 里的**有效权限上限**，它对所有非属主的 ACL 条目（具名用户、具名组、属组）做按位与运算。任何一条条目被 mask 收窄后，实际生效权限都会低于你设置的值：

```bash
# 场景：先把 mask 收紧为只读
$ sudo setfacl -m m:r file.txt

# 即便之前给 guest 设了 rw，实际生效也只剩 r
$ getfacl file.txt
user::rw-
user:guest:r--     ← 显示的是"实际生效"权限，已被 mask 截断
group::r--
mask::r--          ← 罪魁祸首
other::r--

# 验证：guest 现在写入会被拒绝
$ sudo -u guest tee -a file.txt < /dev/null
tee: file.txt: Permission denied
```

调用 `setfacl -m u:...:rw` 时，工具会尝试把 mask 自动抬到足以容纳新权限（所以你很少主动察觉它的存在）；但当有人显式设置过 mask、或用 `-b` 之外的方式部分清除过条目时，mask 可能停留在旧值。**排查"权限明明设了却无效"，第一件事就是 `getfacl` 看 mask 那一行**，这比反复重复 `setfacl` 有用得多。

具名组条目与属组条目（`group::`）共享同一个 mask。换句话说，mask 是"除属主和 other 之外所有授权的公共上限"，这一设计保证了不识别 ACL 的旧程序看到的 `ls -l` 第二组权限位（即属组权限）不会超过管理员的真实意图。

## 5. 三系默认 ACL 策略对照

三大发行版家族在 ACL 上的行为几乎一致，差别集中在默认挂载选项与文档习惯上：

| 主题 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 工具包 | `acl`（默认已装） | `acl`（base 组包含） | `acl`（默认已装） |
| ext4 挂载选项 | 默认即可（ACL 按需启用，无需 `acl` 选项） | 同左 | 同左 |
| 常见误用 | 用 `chmod 777` 代替 ACL | 同左 | 同左 |
| 查看支持 | `tune2fs -l /dev/sdX1 \| grep -i acl` | 同左 | `xfs_info` 默认开启 |

需要说明的是，历史上 ext2/3 需要在挂载时显式加 `acl` 选项，ext4 起内核默认启用 ACL 支持；XFS 则一直默认开启。因此三系上你都不需要改 `/etc/fstab`，装好 `acl` 包即可直接用 `setfacl`。

## 6. 备份与恢复

ACL 存储在文件系统元数据中，`cp` 一般不保留（除非用 `cp -a`/`--preserve=xattr`），迁移目录树时最稳妥的方式是先导出再回放：

```bash
# 导出（-R 递归；注意导出文件本身的格式是可回放的文本）
$ getfacl -R /srv/projects > /backup/projects.acl

# 回放到新的目录树（-R 递归应用）
$ sudo setfacl --restore=/backup/projects.acl

# 或写成管道
$ getfacl -R /srv/projects | sudo setfacl --restore=/dev/stdin
```

`--restore` 期望的输入正是 `getfacl -R` 生成的格式，文件里带 `# file:` 注释行做定位。做完整迁移（`rsync` 到新机器）时，把 ACL 导出文件与数据一起归档，恢复顺序是"先 rsync 数据，再 setfacl --restore"，反过来会导致 ACL 条目因目标文件不存在而被跳过。

## 7. 常见坑

1. **设了 ACL 却不生效**。先 `getfacl` 看 `mask` 是否收窄；再 `ls -l` 看是否有 `+` 号；最后 `id` 确认当前进程凭证里的 UID/GID 确实匹配条目。三步排查覆盖 90% 的场景。

2. **`-R` 与 default ACL 混淆**。`-R` 管存量文件，`d:` 管未来文件；只做其一都会留下"一半文件有权限、一半没有"的烂摊子。正确的批量授权姿势是两者一起做：

   ```bash
   $ sudo setfacl -R -m u:guest:rw /srv/projects/drafts/
   $ sudo setfacl -m d:u:guest:rw /srv/projects/drafts/
   ```

3. **用 ACL 绕过本该用组解决的问题**。如果十个人需要同样权限，建一个组然后 `setfacl -m g:team:rw` 比维护十条用户条目更易管理。ACL 的定位是"个别例外"，不是"替代组模型"。

4. **备份时丢掉 ACL**。普通 `tar` 不含 xattr（ACL 存于 xattr 的 `system.posix_acl_*` 键）。用 `tar --xattrs --xattrs-include='*'` 或直接按第 6 节导出 `getfacl` 文本。

5. **在不支持 ACL 的文件系统上操作**。FAT32、exFAT（U 盘常用）不支持 POSIX ACL，`setfacl` 会报 `Operation not supported`。跨系统共享 U 盘请改用挂载时的 `umask`/`fmask`/`dmask` 选项控制默认权限。

6. **误以为 ACL 能限制 root**。ACL 与传统 DAC 一样对 UID 0 无效；真正能约束 root 的是 SELinux/AppArmor 之类的 MAC，见[安全基础](../security.md)。

## 参考资料

- Arch Wiki - Access Control Lists — [wiki.archlinux.org](https://wiki.archlinux.org/title/Access_Control_Lists)
- 鸟哥的私房菜 - 文件权限与 ACL — [linux.vbird.org](https://linux.vbird.org/linux_basic/centos7/0210filepermission.php)
- `man getfacl`、`man setfacl`、`man acl`
- Debian 手册 - 权限与 ACL — [debian.org](https://www.debian.org/doc/manuals/debian-handbook/)
- RHEL 9 - 使用 ACL — [docs.redhat.com](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html-single/managing_storage/index)
