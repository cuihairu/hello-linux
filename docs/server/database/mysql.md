# MySQL

MySQL 是全球最流行的开源关系型数据库，广泛应用于 Web 应用；在 Linux 发行版仓库中，它常以 MariaDB 分支或 MySQL 官方包两种形态出现，安装方式和初始认证也不完全相同。本章覆盖三系安装、安全初始化、用户与权限模型（区别于文件权限）、备份恢复、主从复制和高频故障排查——先讲清概念差异，再给可执行的命令与 SQL。

学习数据库运维与学习 Web 服务器有一个共同方法论：**先确认"是哪一层的问题"，再动配置**。Web 是防火墙/权限/SELinux/语法四层，数据库是包与服务名/认证与 host/文件与 SELinux/复制状态四层；分层不清时，改错层看似"碰巧好了"，换环境立刻复发。下面各节都会按层展开，命令只作为验证手段，不是目的。

本章目标是能独立完成：三系安装与服务名识别、初始安全配置、用户与最小授权、备份恢复演练、主从搭建与状态解读，以及常见故障的分层排查。数据库变更往往不可逆（删库、覆盖权限、错误恢复），因此每一步都强调"先验证、再提交、可回读"——SQL 执行成功只是开始，`SHOW GRANTS`/`SELECT` 回读与应用侧连通性确认才算闭环。示例命令中的密码与 IP 仅为占位，生产请替换并走密钥管理，不要把真实口令写进文档或脚本明文。

> 内容参考自 MySQL 官方文档、鸟哥的私房菜和实际运维经验，见文末参考资料。

## 学习目标

- 掌握 MySQL/MariaDB 在 Debian、RHEL 系、Arch 上的安装差异
- 理解初始 root 认证方式与安全配置
- 掌握数据库、用户、权限管理
- 了解备份恢复、主从复制和故障排查

## 1. 安装

安装阶段就要决定三件事：用哪个分支、服务叫什么名、初始 root 怎么进。这三件事决定后面所有 systemctl 与排障命令的写法。跟着跨发行版教程抄命令是最常见的浪费时间方式——在 Debian 上敲 `systemctl start mariadb` 会 unit not found，在 Arch 上找 `/var/log/mysqld.log` 也会扑空。装完先做一次"版本 + 服务状态 + 本地登录"三连验证，再进入安全配置，避免在半初始化状态上调权限。


先明确关键差异：**Debian/Ubuntu 仓库默认是 Oracle MySQL（`mysql-server`）；RHEL/CentOS/Rocky/Alma 与 Arch 官方仓库默认是 MariaDB（`mariadb-server`/`mariadb`）**。客户端命令与 SQL 大多兼容，但服务名、日志路径、临时密码机制不同——跟着教程敲命令前先确认发行版与分支，否则 `systemctl start mysql` 会直接 unit not found。Fedora 也可能只带 MariaDB。需要原厂 MySQL 时，RHEL 系可加官方仓库，Arch 通常走 AUR 或自编译——先想清楚"要不要原厂"，再动手，能少走很多弯路。MariaDB 与 MySQL 在视图、插件、权限细节上仍有分叉，锁死一种分支写文档与运维手册，比在两套语义之间来回翻译更省心。

| 发行版 | 包名 | 服务名 | 初始 root |
|--------|------|--------|-----------|
| Debian/Ubuntu | mysql-server | mysql | auth_socket，`sudo mysql` 免密 |
| RHEL 系 MariaDB | mariadb-server | mariadb | 空/策略密码，跑 secure-installation |
| RHEL/MySQL 官方 | mysql-community-server | mysqld | `/var/log/mysqld.log` 临时密码 |
| Arch | mariadb | mariadb | 初始化后本地可进，建议立刻设密码 |

### 1.1 Debian/Ubuntu

Debian 系 root 默认走 `auth_socket`（Unix socket 免密），装完直接 `sudo mysql` 即可以 root 进入，**没有 temporary password**。按 RHEL 文档去日志找临时密码会扑空，这是两边最大的体验差异——先分清发行版再跟教程，能省掉半小时无头绪排查。安装命令是 `sudo apt update && sudo apt install mysql-server`，随后 `sudo systemctl enable --now mysql`。装完应立刻设 root 密码，并确认插件（8.0 默认 `caching_sha2_password`）与旧客户端是否兼容，不兼容时再评估是否改兼容插件（注意各版本对该插件的废弃策略不同）。auth_socket 只保护本机 root，应用账号仍要走密码与 host 限制，不要把两者混为一谈。

### 1.2 RHEL/CentOS/Fedora（MariaDB 默认）

这条路径拿到的是 MariaDB，工具与服务名以 mariadb 为前缀/单元名，和 MySQL 手册不能完全对照。默认源版本相对保守，换来的是与发行版生命周期一致的安全更新；需要新特性时再评估官方 MySQL 仓库或源码包。装完立刻 `enable --now` 并做本地登录验证，不要停在"包显示已安装"——安装成功与服务可用是两件事，监控与巡检也应盯 unit 状态而不是只盯 rpm/qyery 是否存在。


默认源安装 `sudo dnf install mariadb-server`，服务名 `mariadb`，`enable --now` 后用 `mariadb --version` 验证。这条路径拿到的是 MariaDB 而非 Oracle MySQL，文档与二进制名略有差异（如部分诊断工具叫 `mariadb-*`），排障时命令别照抄 MySQL 手册全文。

### 1.3 RHEL/CentOS 使用 MySQL 官方仓库

必须原厂 MySQL（依赖独有特性或认证插件）时再走此路径；仓库 RPM 版本号以官网为准，别照抄过期链接。临时密码只允许首次登录并立即修改；日志轮转过则需 `--skip-grant-tables` 重置（见第 8 节）。官方包与发行版 MariaDB 并存时可能抢 3306 与 unit 名，生产机不要混装——混装后 `systemctl start mysql` 成功但连上的其实是另一套数据目录，是最诡异的事故形态之一。

```bash
sudo dnf install https://dev.mysql.com/get/mysql80-community-release-el9-5.noarch.rpm
sudo dnf install mysql-community-server
sudo systemctl enable --now mysqld
sudo grep 'temporary password' /var/log/mysqld.log
```

### 1.4 Arch Linux

Arch 官方仓库是 MariaDB，用 `sudo pacman -S mariadb` 装完**必须先初始化系统表**再启动，否则数据目录为空、服务起不来。初始化命令是 `mariadb-install-db --user=mysql --basedir=/usr --datadir=/var/lib/mysql`，然后 `systemctl enable --now mariadb`。配置片段在 `/etc/my.cnf.d/`。Arch 滚动更新时注意先看 news，大版本 MariaDB 升级偶有需要手工跑升级步骤，直接 `-Syu` 跳过新闻页是 Arch 用户的老坑。

## 2. 安全配置

安全配置的目标不是"跑完向导"，而是收敛暴露面：谁能连、从哪连、连上来能干什么。向导处理匿名用户、测试库、root 远程这些实例级问题；账号级问题（应用最小授权、备份账号只读）必须在业务上线前单独做。Debian 的 auth_socket 与 RHEL 的临时密码是两种"首登路径"，搞混会在错误的地方找不存在的日志。安全与可用要平衡：过严的密码策略导致应用半夜改密失败，和过松导致被扫，都是生产事故，按环境分级执行并写进文档。


装完第一件事是收紧默认暴露面：删匿名用户、禁 root 远程、去掉测试库、设强密码。工具名随分支不同——MySQL 叫 `mysql_secure_installation`，MariaDB 叫 `mariadb-secure-installation`（多数发行版仍提供 `mysql_*` 兼容链接）。交互步骤本身不难，难在"每一步为什么选是"。匿名用户与测试库在生产没有存在价值，禁 root 远程则强迫你为应用建专用账号，权限边界从第一天就清晰，事后补救要改连接串和滚动重启，成本更高。向导跑完不等于安全完成：默认端口是否对公网开放、备份账号权限、应用账号最小授权，仍要在防火墙与 GRANT 层单独落实。

交互要点：设置 root 强密码（Debian 上若仍 auth_socket，可先跳过，后续 `ALTER USER`）；删除匿名用户——匿名账号是历史遗留的攻击面；禁止 root 远程登录——远程管理用限定来源 IP 的专用账号，而不是 root@`%`；删除测试库；重载权限表。密码强度由 `validate_password` 控制，官方 MySQL 默认较严，发行版 MariaDB 常较松，按团队规范选择，不要为了"顺利跑完向导"把密码设成弱口令再指望防火墙兜底。跑完向导后用一次真实应用连接测试，确认应用侧连接串与认证插件匹配；向导只覆盖"实例级"收紧，库表权限与备份账号仍要按最小权限单独建。

Debian MySQL 执行 `sudo mysql_secure_installation`，RHEL/Arch MariaDB 执行 `sudo mariadb-secure-installation`（或兼容命令 `mysql_secure_installation`）。两者交互问题顺序几乎一样，按提示选即可。

## 3. 用户管理

用户与权限决定"谁、从哪里、能对什么做什么"。MySQL 把这三件事压在 `user@host` + GRANT 上，比 Unix 的用户/组模型更细，也因此更容易配错 host 或过度授权。原则始终是最小权限：能库级就不给全局，能只读就不给写，应用与运维分账号。改权限后用 `SHOW GRANTS` 回读，再用目标来源实际连一次做验收——只看 SQL 执行成功不算完成，连接成功且权限符合预期才算。


MySQL 权限与 Unix 文件权限是**两套独立机制**：文件权限管进程能否读写磁盘上的数据文件，MySQL 权限管登录身份能对哪些库表执行哪些 SQL。文件权限全对仍可能 Access denied（GRANT 不足），有超级权限也可能被 SELinux 挡住数据目录。排查登录问题先走 MySQL 层（user@host、认证插件），写入文件的问题再看文件层与强制访问控制——两层混查会浪费大量时间。实践中可先用最小复现：本地 socket 登录是否成功、换 TCP 是否成功、错误码是 1045 还是 1130，错误码本身就能把问题劈成"认证失败"和"host 不匹配"两大类。

### 3.1 创建用户

创建用户时同时确定认证字符串与来源主机，两者缺一不可。生产习惯是：应用账号绑内网网段、管理账号绑跳板机 IP、复制账号只授复制权限；`'%'` 仅用于明确接受风险的隔离网络。密码使用密码管理器生成的随机串，避免复用与弱口令；账号命名带用途前缀（app_、backup_、repl_），出问题时能从用户名直接看出该找谁改密码。建完用目标来源真实连接一次，是成本最低的验收方式。


账号全名是 `user@host`，host 参与匹配——同一用户名从不同来源连接可能命中**不同账号**。"本机能连、远程不能连"时先查 `mysql.user` 有没有对应 host 条目，再查 `bind_address` 与防火墙。`%` 匹配任意主机，生产务必收窄到具体 IP/网段；密码应用强口令，应用账号不要给 SUPER/FILE 这类全局特权。建完账号用目标来源实际连一次，比只看 `SHOW GRANTS` 更可靠。注意 host 写 `localhost` 时通常走 socket，写 `127.0.0.1` 才走 TCP——排查"本地 TCP 连不上"要同时看这两种 host 是否都存在。

```sql
CREATE USER 'myuser'@'localhost' IDENTIFIED BY 'StrongPassword123!';
CREATE USER 'myuser'@'192.168.1.%' IDENTIFIED BY 'StrongPassword123!';
SELECT user, host FROM mysql.user;
```

### 3.2 权限管理

遵循最小权限：应用账号只给业务库的增删改查，备份账号要 `SELECT,SHOW VIEW,TRIGGER,LOCK TABLES`，不要给 `DROP`。`GRANT` 在 8.0 里通常即时生效，`FLUSH PRIVILEGES` 可保留为习惯动作。撤销与删除用 `REVOKE`/`DROP USER`，不要手改 `mysql.user` 表——绕过权限系统改表在版本升级后极易留下不一致状态。改完用 `SHOW GRANTS` 回读确认，比相信自己敲的字符更稳妥；对 `@'%'` 账号尤其要回读，host 写错一个符号权限就形同虚设。库级权限与表级权限可叠加，授 `mydb.*` 后不必再逐表 GRANT；列级权限仅在确需"只能看脱敏列"时使用，过度细分会把授权维护变成负担。

```sql
GRANT ALL PRIVILEGES ON mydb.* TO 'myuser'@'localhost';
GRANT SELECT ON mydb.* TO 'readonly'@'%';
SHOW GRANTS FOR 'myuser'@'localhost';
REVOKE ALL PRIVILEGES ON mydb.* FROM 'myuser'@'localhost';
DROP USER 'myuser'@'localhost';
```

### 3.3 修改密码

改密是"低频但影响面广"的操作：应用连接池、备份脚本、复制账号、监控探活都可能持有旧口令。正确顺序是先建新凭据或双账号并存，应用滚动切换并观察连接成功率，最后再删旧凭据；直接单点改 root 可能导致下一次定时任务立刻失败。口令轮换周期按合规要求执行，同时把存放位置从命令行/脚本明文迁到权限 600 的配置文件或密钥管理服务，避免"改了密码但旧密码还躺在 history 里"。

修改当前用户与其他用户都用 `ALTER USER` 语法，改完用新口令从应用侧真实连接一次做验收。若认证插件不匹配（如老驱动不支持新默认插件），会在应用日志里表现为间歇性认证失败——这时对齐插件与驱动版本，比反复改密码更有效。密码变更窗口内建议保留短暂双活，避免滚动发布未完成时一半实例连不上。

改密用 `ALTER USER 'myuser'@'localhost' IDENTIFIED BY '...';`，应用侧同步改连接池配置并滚动重启，避免一半实例连新密码一半连旧密码造成的间歇性认证失败。密码轮换窗口期可短暂双账号并存，切换完成再删旧账号。

## 4. 数据库操作

库表与数据操作是日常 SQL 的主体，也是权限验证的落点——账号能连上但 `CREATE TABLE` 报错，说明缺 DDL 权限而不是连接问题。本节命令按"库 → 表 → 行"三层组织，与 MySQL 权限粒度（全局/库/表/列）对齐：在哪一层操作，就该在哪一层授权。字符集与存储引擎两个全局选择，建议在建库时一次定好，事后改动要锁表并评估应用编码，代价远高于建库时多写两个选项。手改生产数据前先开事务并 SELECT 预览，确认行数再 COMMIT，比直接点"执行"安全得多。


### 4.1 数据库管理

新建业务库务必显式 `utf8mb4`，否则继承服务端默认字符集，后期转换成本高且易乱码。MySQL 里的 `utf8` 是三字节历史包袱，存不了 emoji，新库不要用。`DROP DATABASE` 不可逆，生产执行前先确认备份与依赖该库的应用是否已下线——`IF EXISTS` 只防"库不存在"的报错，防不了"删错库"。

查看库用 `SHOW DATABASES`；建库写明 `CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`；`USE` 切换当前库，`SELECT DATABASE()` 回显；删库用 `DROP DATABASE IF EXISTS`，执行前确认备份。

### 4.2 表管理

表结构是应用与数据库之间的契约：列类型、唯一约束、默认值一旦上线，改动成本随数据量与调用方数量上升。设计阶段优先选对类型与索引（时间用 `DATETIME`/`TIMESTAMP` 按需、金额用 `DECIMAL`、状态用小整型枚举），比事后频繁 `ALTER` 便宜。`SHOW CREATE TABLE` 是迁移与灾备的必带产物，和数据 dump 放在一起，才能在新环境完整重建。大表变更走在线 DDL 或业务低峰，变更前评估锁与复制延迟（从库重放 DDL 可能堵塞）。


表默认 `ENGINE=InnoDB` + `utf8mb4`。`SHOW CREATE TABLE` 拿建表全语句，迁移环境时最有用。生产大表 `ALTER` 可能长时间持锁，MySQL 8.0 部分操作支持 `ALGORITHM=INSTANT/INPLACE`，变更前确认算法并避开业务高峰——一次不当的 `ALTER` 可以让整站超时。加列尽量可空或带默认值，减少锁表与应用兼容问题；删列前先全库搜应用代码里的列名引用。

建表示例用 InnoDB + utf8mb4，含自增主键、唯一用户名与时间戳列。`DESCRIBE` 看结构，`SHOW CREATE TABLE` 拿完整 DDL；改表用 `ALTER TABLE ... ADD/MODIFY/DROP COLUMN`，删表 `DROP TABLE IF EXISTS`。生产 ALTER 先确认算法与锁影响。

```sql
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 4.3 数据操作

`UPDATE`/`DELETE` 不带 `WHERE` 会全表执行。不确定影响范围时，先用同一 `WHERE` 跑 `SELECT` 数行数，再执行写操作；客户端"0 行匹配"的警告要认真看，别连点两次确认——0 行有时意味着条件写错，继续"再执行一次"只会掩盖问题。应用层拼接 SQL 属于另一类风险，此处 SQL 示例仅作管理操作参考，业务代码请用参数化查询，防止注入的同时也让执行计划更稳定。生产手改数据建议开事务、先 SELECT 再 UPDATE、确认行数后 COMMIT，异常随时 ROLLBACK，比直接点"执行"安全得多。

插入用 `INSERT INTO ... VALUES`，查询用 `SELECT ... WHERE`，更新 `UPDATE ... SET ... WHERE`，删除 `DELETE ... WHERE`。示例见上文语句：无 `WHERE` 的 UPDATE/DELETE 是事故高发点，执行前先 SELECT 同条件核对影响行数。

## 5. 备份与恢复

备份策略要回答三个问题：保什么（单库/全库/是否含 routines）、多久一次（RPO）、能多快恢复（RTO）。三问没答案时，脚本往往抄自模板，出事才发现保错库或恢复要跑一天。逻辑备份便于跨版本迁移，物理备份适合大库快速拉起，生产常是"每日物理全备 + binlog 增量 + 定期逻辑导出关键库"组合。恢复演练不是可选项：把恢复步骤写进 runbook，在测试环境按剧本跑通并计时，才算拥有备份。


备份分**逻辑**（mysqldump，可移植、大库恢复慢）和**物理**（数据目录/xtrabackup，快、需版本一致）。小库用 mysqldump 足够，TB 级应上物理工具；完整策略与演练见系统管理篇。核心原则：**从未恢复演练过的备份等于没有备份**——备份成功日志刷屏，恢复时才发现没锁事务或缺权限，是最常见也最贵的事故。逻辑备份还分"全量+binlog 增量"与"仅全量"，有 RPO 要求的业务要算清两次备份之间允许丢多少数据，再决定备份频率与是否接 binlog 归档。

### 5.1 使用 mysqldump

mysqldump 是逻辑导出工具，优点是跨版本、跨引擎迁移方便，缺点是大库导出与恢复都慢，且默认在导出瞬间对表加读锁（InnoDB 可用 `--single-transaction` 改为一致性快照）。参数选择要与业务引擎、是否含存储过程、是否只要结构等需求对齐；把常用参数固化成脚本或 Makefile 目标，避免每次手敲漏掉 `--routines` 导致恢复后存储过程丢失——这类"备份成功、恢复不全"的缺口，只有演练才能暴露。


带 `-p` 交互输密码可避免进 shell 历史；自动化不要把密码写在命令行（`ps` 全进程可见），应用 `--defaults-extra-file` 指向权限 600 的配置文件。`--single-transaction` 在 InnoDB 上一致性快照导出，一般无需停库；混用 MyISAM 时再考虑锁表或分引擎处理。导出后 `gzip` 压缩能显著省磁盘，恢复管道也更简单。

核心形态：单库 `mysqldump -u root -p mydb > out.sql`；多库加 `--databases`；全库 `--all-databases`；只要结构 `--no-data`；生产加 `--single-transaction --routines --triggers` 并 `| gzip` 压缩。密码勿写在命令行，用 defaults-extra-file。

### 5.2 恢复数据

目标库需已存在，除非 dump 含 `CREATE DATABASE`。恢复后核对关键表行数与抽样数据；务必在测试环境先演练一遍导入路径，包括磁盘空间、字符集、权限——生产首次恢复就是最后一次演练的反面教材。压缩包恢复用 `gunzip < file.gz | mysql ...`，比先解压再导入少占一份磁盘。

恢复：`mysql -u root -p mydb < dump.sql` 导入单库；压缩包 `gunzip < dump.gz | mysql ...`；全库备份去掉目标库名直接重定向。导入前确认库存在、字符集与磁盘空间，并在测试环境先演练。

### 5.3 自动备份脚本

密码放进 `chmod 600` 的 `--defaults-extra-file`，避免出现在 `ps` 与命令行历史；`--routines --triggers` 连带存储过程与触发器。cron 失败要写日志并让监控能发现（非零退出码或日志告警），静默失败的定时任务最危险——等磁盘满或要恢复那天才第一次看见报错，通常已经晚了。保留天数 `KEEP_DAYS` 按恢复点目标（RPO）设定，别抄 7 天却要求能恢复上个月。

```bash
# /root/.my.cnf.backup（chmod 600）
[client]
user=backup
password=BackupPassword123!
```

```bash
#!/bin/bash
# /usr/local/bin/mysql_backup.sh
BACKUP_DIR="/var/backups/mysql"
DATE=$(date +%Y%m%d_%H%M%S)
KEEP_DAYS=7
mkdir -p "$BACKUP_DIR"
mysqldump --defaults-extra-file=/root/.my.cnf.backup \
  --single-transaction --routines --triggers \
  --all-databases | gzip > "$BACKUP_DIR/all_$DATE.sql.gz"
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +"$KEEP_DAYS" -delete
echo "Backup completed: $BACKUP_DIR/all_$DATE.sql.gz"
```

脚本 `chmod 700` 后写入 root crontab：`0 2 * * *` 每天凌晨 2 点执行，标准输出与错误追加到 `/var/log/mysql_backup.log`，便于次日巡检与监控抓取失败关键字。

## 6. 主从复制

复制把"单点写入"扩展成"一写多读"，也提供近实时的容灾副本，但异步复制在主库崩溃时仍可能丢最后一批事务，选型时要和业务一致性要求对齐。搭建过程本身不难，难在后续：延迟监控、双 No 处理、大事务导致的堵塞、以及升级时主从版本窗口。把 `SHOW REPLICA STATUS` 的关键字段做成监控面板，比出事再登机器敲命令可靠得多。复制账号、server-id、binlog 格式是三个最容易在初期埋雷的点，建拓扑时一次配对。


复制用于读写分离、容灾与在线备份。拓扑上一个 Source 挂多个 Replica，经 binlog 异步或半同步传输：异步可能丢最后一批事务，半同步/至少一次提交降低丢失窗口，按一致性要求选。搭建前确认：主从时钟大致同步、`server-id` 全局唯一、3306 互通且仅对复制网段放行。MySQL 8.0.23+ 推荐 `CHANGE REPLICATION SOURCE`，8.4 起移除旧语法；MariaDB 长期仍以 `CHANGE MASTER TO` 为主——**按实际分支选一种，不要混抄**，混用会直接语法报错。复制账号只授复制权限、限定来源，不要图省事用 root 做复制。

### 6.1 主服务器配置

主库是唯一写入口，配置重点在：稳定唯一的 `server-id`、开启并正确格式化的 binlog、以及最小权限的复制账号。`server-id` 冲突会导致复制静默异常，容器与多环境模板化部署时最容易撞号，建议按环境段编码。`binlog_format=ROW` 对数据一致性与安全性更稳妥，语句格式虽省空间但在函数不确定性上会翻车。配置变更（开 binlog、改格式）通常要重启实例，安排维护窗并确认从库能追上，避免切换窗口出现长时间不可用。


主库必须开 binlog，`binlog_format=ROW` 对数据一致性最稳（也能避免基于语句的复制在函数不确定性上翻车）。重启后 `SHOW MASTER STATUS` 记下 File/Position，从库要用；`binlog_do_db` 是白名单过滤，库多时注意别漏。复制账号单独建，只授 `REPLICATION SLAVE`，不要图省事用 root——root 失陷等于整个权限体系失陷，复制账号只需能读 binlog。

```ini
# Debian: /etc/mysql/mysql.conf.d/mysqld.cnf
# RHEL/Arch MariaDB: /etc/my.cnf.d/*.cnf
[mysqld]
server-id=1
log_bin=mysql-bin
binlog_do_db=mydb
binlog_format=ROW
```

```sql
CREATE USER 'repl'@'%' IDENTIFIED BY 'ReplPassword123!';
GRANT REPLICATION SLAVE ON *.* TO 'repl'@'%';
FLUSH PRIVILEGES;
SHOW MASTER STATUS;
```

### 6.2 从服务器配置

从库 `server-id` 必须不同，`read_only=1` 防误写（超级用户仍可写，应用账号应无 SUPER）。指向主库的账号、日志文件与位置后 `START REPLICA`，用 `SHOW REPLICA STATUS\G` 看双 Yes：IO 线程挂多为网络/账号/防火墙，SQL 线程挂多为主键冲突或结构不一致，`Seconds_Behind_Source` 反映延迟。主从数据已分叉时不要盲目 `START REPLICA`，先评估是否要重建从库或做数据修复，否则双 No 会一直卡住并掩盖真实问题。延迟监控应纳入告警，只靠页面上看"还行"会在主库抖动时措手不及；`Last_SQL_Error` 字段给出冲突原因，是 SQL 线程排障的第一落点。

```ini
[mysqld]
server-id=2
relay_log=mysql-relay-bin
log_bin=mysql-bin
read_only=1
```

```sql
CHANGE REPLICATION SOURCE TO
    SOURCE_HOST='192.168.1.100',
    SOURCE_USER='repl',
    SOURCE_PASSWORD='ReplPassword123!',
    SOURCE_LOG_FILE='mysql-bin.000001',
    SOURCE_LOG_POS=154;
START REPLICA;
SHOW REPLICA STATUS\G
```

## 7. 性能优化

数据库性能问题几乎总能归到四类：缓冲池不够（磁盘读占比高）、慢 SQL（缺索引、错误计划）、连接与锁（池配置错、长事务、死锁）、复制延迟（从库堵塞、大事务）。排查顺序建议：先 `SHOW STATUS` 看命中率与连接，再开慢日志抓 Top SQL，然后看 `innodb_trx` 与锁等待，最后才谈升级硬件。没有慢日志就调参数，等于蒙眼拧螺丝；先把最贵的三条 SQL 修掉，往往比把缓冲池翻倍更有效，也更便宜。调参要有对照组：改前后同一压测、同一数据量，否则"感觉快了"无法归因。


### 7.1 内存配置

内存配置的核心是让热数据尽量落在缓冲池，同时给操作系统与连接开销留出余量。专用库给 50%–70% 是经验起点，不是圣旨：同机还跑着应用、监控或日志采集时要下调；数据量远小于缓冲池时再调大也只是浪费。`max_connections`、排序缓冲等"每连接"参数与缓冲池相乘才是真实占用，改之前心算一遍上限内存。所有涉及重启的参数变更，安排在维护窗并准备好回滚值，避免半夜改错把库改挂。


InnoDB 缓冲池是最大头，专用数据库机常给物理内存 50%–70%，改后需重启才生效——热改不生效是很多"参数没用"错觉的来源。`max_connections` 不是越大越好——应用层应用连接池，服务端只留余量；连接暴涨往往是泄漏，不是需要更大上限。MySQL 8.0 已移除查询缓存，不要再抄老教程的 `query_cache_size`，写了只会得到 unknown variable。`sort_buffer_size`/`join_buffer_size` 是**每连接**分配的量，盲目调大乘上连接数会把内存吃穿；小内存机器上宁可让排序走磁盘，也不要让 OOM Killer 杀 mysqld。

```ini
[mysqld]
innodb_buffer_pool_size=2G
max_connections=500
sort_buffer_size=4M
```

### 7.2 慢查询日志

打开慢日志、把 `long_query_time` 降到 1–2 秒，才能暴露隐藏慢点。日志目录需 `mysql` 用户可写，否则静默写不进去——配置了却长期 0 字节时先查属主。`mysqldumpslow -s t` 按总耗时汇总，先修频次高且总时间长的语句，再抠单次极慢的冷查询。慢日志本身也占磁盘，轮转策略要一并配置，避免排查性能问题时先把磁盘写满。

```ini
[mysqld]
slow_query_log=1
slow_query_log_file=/var/log/mysql/slow.log
long_query_time=2
```

```bash
mysqldumpslow -s t -t 10 /var/log/mysql/slow.log
```

## 8. 常见问题

数据库故障按"连不上 / 连上但报错 / 连上但慢"三分，比按报错全文搜更快。连不上先分网络、host 匹配、认证三类；连上但报错看错误码（1045、1130、1062…）；连上但慢看 PROCESSLIST 与慢日志。生产处置原则：先只读止血或切流量，再在维护窗动权限与表结构——深夜手滑删表的代价，远高于多等一个发布窗口。排障时保留现场（错误码、PROCESSLIST、复制状态截图），修完再清理，避免"修好了但不知道为什么好"导致复发无法对照。


### 8.1 忘记 root 密码

思路：停服务 → `--skip-grant-tables` 无鉴权启动 → 改密 → 恢复正常启动。**跳过权限表等于关闭鉴权**，窗口期内任何能连到 3306 的人都可进来，务必先限制防火墙/绑定地址；公网数据库在这几分钟里被扫到就是裸奔。MySQL 8.0 与 MariaDB 改密语法略有差异（`ALTER USER` vs `SET PASSWORD ... PASSWORD()`），以实际分支报错为准，不要在报错后反复粘贴另一家的语法。改完务必去掉 skip 参数正常重启，并验证密码登录成功再离开；离开前确认没有残留的 `mysqld_safe --skip-grant-tables` 进程，否则下次排查会以为权限"时好时坏"。

```bash
sudo systemctl stop mariadb    # 或 mysql / mysqld
sudo mysqld_safe --skip-grant-tables &
mysql -u root
```

```sql
FLUSH PRIVILEGES;
ALTER USER 'root'@'localhost' IDENTIFIED BY 'NewPassword123!';
```

```bash
# 结束跳过权限进程后正常重启
sudo systemctl stop mariadb 2>/dev/null; pkill -f mysqld_safe
sudo systemctl start mariadb
```

### 8.2 连接数过多

`SHOW PROCESSLIST` 看当前会话，`KILL` 异常长连接，`Threads_connected` 对比 `max_connections`。连接暴涨常见于应用无连接池、连接泄漏，或 `max_connections` 过小导致大量 `Too many connections`。治本是收敛应用侧连接与杀掉僵死会话，而不是无限调大服务端上限——上限抬高后内存与线程开销一起抬高，高峰可能更不稳。长事务也会占连接并堵住 purge，`information_schema.innodb_trx` 要一起看；进程列表里 `Time` 很大的 `Sleep` 会话往往是应用没关连接，结合应用日志定位到是哪个服务实例。

用 `SHOW PROCESSLIST` 看会话，`SHOW VARIABLES LIKE 'max_connections'` 看上限，`SHOW STATUS LIKE 'Threads_connected'` 看当前数，`KILL <id>` 杀僵死会话。四条命令覆盖连接风暴的现场处置。

### 8.3 能本地连、不能远程连

按层排查：① `mysql.user` 是否有匹配的 host 条目（1130 错误多是这里）；② `bind_address` 是否只绑 `127.0.0.1`；③ 防火墙/云安全组是否放行 3306；④ 账号是否允许从该来源认证。远程 app 账号限定网段，避免 `'user'@'%'` 加弱口令暴露公网——**数据库端口不应直接对公网开放**，应经跳板机或仅内网访问，这一条比任何密码策略都更能挡住扫描器。安全组放行后仍连不上，再查 DNS/路由与服务器内防火墙是否叠了两层规则；云上常见"安全组开了但 OS 层 ufirewalld 还没开"，两层都要过。

## 常见坑速查

坑按"装错分支 / 服务名不对 / 认证与 host / 备份与复制"四类记，新问题先归类再查手册。速查用于止血，根因仍要回到对应章节：装错分支要明确是否混装，认证问题要回到 user@host 模型，复制双 No 要回到线程状态字段。把高频坑写进团队 runbook，并附上"验证命令"，交接时比口头经验可靠。


- 找不到 temporary password：那是 RHEL 系**官方 MySQL 包**的机制，Debian auth_socket 与 MariaDB 没有。
- Arch 装完起不来：先 `mariadb-install-db` 初始化，再 `systemctl start mariadb`。
- 服务名 mysql/mysqld 都不对：RHEL 默认源是 `mariadb`，官方 MySQL 才是 `mysqld`。
- 备份密码进 history/ps：改 `--defaults-extra-file`，文件 600。
- `SHOW REPLICA STATUS` 双 No：先分清 IO（网络/账号）还是 SQL（冲突/结构）线程。
- 远程报 1130：多半 host 不匹配，查 `SELECT user, host FROM mysql.user`。

## 本章小结

MySQL 运维可以收成四条主线：装对分支（MySQL vs MariaDB、包名服务名、初始认证）、管住权限（user@host、最小授权、与文件权限分层）、保住数据（mysqldump/defaults-extra-file、演练恢复、复制状态）、调优与分诊（缓冲池、慢日志、PROCESSLIST、错误码分层）。日常操作落在"小步改 → `SHOW` 回读 → 应用验证"闭环；疑难杂症多是把发行版差异、host 匹配、SELinux、复制线程状态混在一起查。先分层、再验证、最后才动生产，这套顺序与 Web 篇一致，也是 Linux 服务器排障的通用方法。

备份与权限变更属于"低频高危"操作：执行前写清影响面与回滚步骤，执行后保留输出与时间点，便于事后审计。把本章命令整理成带注释的 runbook，团队值班时按清单走，比依赖个人记忆更可靠。数据库与 Web 层的边界要守住：应用只持业务账号，运维才持管理账号，复制与备份各有专用身份——身份清晰，事故时的爆炸半径才可控。

## 使用建议

涉及生产数据的每一步都假设"会做错"来设计防护：删改先 SELECT、DDL 先看算法与锁、改权限先 SHOW GRANTS 回读、改配置先准备回滚值。值班同学按 runbook 执行时，清单里的"验证命令"与"回滚命令"要和主命令写在一起，避免出事时再翻文档拼命令。团队层面把高危操作做成双人复核或审批流，成本远低于一次误删的恢复代价。

## 参考资料

- MySQL 8.0 官方文档 — [dev.mysql.com/doc/refman/8.0](https://dev.mysql.com/doc/refman/8.0/en/)
- MariaDB Server 文档 — [mariadb.com/kb](https://mariadb.com/kb/en/documentation/)
- 鸟哥的私房菜 - MySQL — [linux.vbird.org](https://linux.vbird.org/linux_server/0420mysql.php)
- Arch Wiki - MariaDB — [wiki.archlinux.org](https://wiki.archlinux.org/title/MariaDB)
- MySQL Performance Blog — [percona.com/blog](https://www.percona.com/blog/)
