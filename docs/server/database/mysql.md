# MySQL

MySQL is the world's most popular open-source relational database, widely used in web applications; in Linux distribution repositories it usually appears in two forms, the MariaDB fork or the official MySQL packages, with installation and initial authentication not entirely identical. This chapter covers installation on the three distro families, secure initialization, the user and privilege model (distinct from file permissions), backup and restore, master-slave replication, and high-frequency fault troubleshooting -- concepts and differences first, then runnable commands and SQL.

Learning database ops shares a methodology with learning web servers: **first establish "which layer is at fault", then touch the config**. For the web it is four layers -- firewall / permissions / SELinux / syntax; for the database it is package and service name / authentication and host / files and SELinux / replication state. When the layers are not separated, changing the wrong layer may look "coincidentally fixed" and recurs immediately in another environment. Each section below unfolds layer by layer, with commands used as verification rather than as the goal.

The chapter's goal is that you can independently complete: installation on the three families and service-name identification, initial secure configuration, users and least privilege, backup and restore drills, master-slave setup and reading replication status, and layered troubleshooting of common faults. Database changes are often irreversible (dropping a database, overwriting privileges, a bad restore), so every step emphasizes "verify first, commit, and be able to read it back" -- a successful SQL execution is only the beginning; the loop closes with a `SHOW GRANTS`/`SELECT` readback and a connectivity check from the application side. Passwords and IPs in example commands are placeholders only; in production replace them and go through a key management service, and never write real credentials in plaintext into documents or scripts.

> Content draws on the official MySQL documentation, "Vbird's Linux Cabinet", and hands-on ops experience; see the references at the end.

## What This Page Covers

- Installation differences for MySQL/MariaDB on Debian, the RHEL family, and Arch
- Understanding the initial root authentication method and secure configuration
- Managing databases, users, and privileges
- Backup and restore, master-slave replication, and troubleshooting

## 1. Installation

The installation phase decides three things: which fork, what the service is called, and how to get into root initially. These three determine how every later `systemctl` and troubleshooting command is spelled. Copying commands from cross-distro documentation is the most common time sink -- typing `systemctl start mariadb` on Debian yields unit not found, and hunting for `/var/log/mysqld.log` on Arch also comes up empty. After installing, do a "version + service status + local login" three-way verification before entering secure configuration, avoiding tuning privileges in a half-initialized state.

First, the key differences: **Debian/Ubuntu repositories default to Oracle MySQL (`mysql-server`); RHEL/CentOS/Rocky/Alma and the Arch official repository default to MariaDB (`mariadb-server`/`mariadb`)**. Client commands and SQL are mostly compatible, but service names, log paths, and the temporary-password mechanism differ -- confirm the distro and fork before copying commands from documentation, otherwise `systemctl start mysql` fails outright with unit not found. Fedora may also ship only MariaDB. When you need upstream MySQL, the RHEL family can add the official repository, and Arch usually goes through the AUR or self-compilation -- decide whether you truly need upstream before starting, and you will save many detours. MariaDB and MySQL still diverge in views, plugins, and privilege details; pinning one fork for documentation and runbooks is less trouble than translating between two sets of semantics.

| Distro | Package | Service | Initial root |
|--------|------|--------|-----------|
| Debian/Ubuntu | mysql-server | mysql | auth_socket, passwordless via `sudo mysql` |
| RHEL family MariaDB | mariadb-server | mariadb | empty/policy password; run secure-installation |
| RHEL official MySQL | mysql-community-server | mysqld | temporary password in `/var/log/mysqld.log` |
| Arch | mariadb | mariadb | local login after initialization; set a password immediately |

### 1.1 Debian/Ubuntu

On the Debian family, root defaults to `auth_socket` (passwordless over the Unix socket), so right after installation `sudo mysql` gets you in as root, with **no temporary password**. Hunting the logs for a temporary password per RHEL documentation comes up empty -- the single biggest experience difference between the two sides; identify the distro before following documentation and you save half an hour of aimless troubleshooting. The install command is `sudo apt update && sudo apt install mysql-server`, followed by `sudo systemctl enable --now mysql`. Right after installing, set the root password and confirm whether the plugin (8.0 defaults to `caching_sha2_password`) is compatible with old clients; when it is not, evaluate switching to a compatible plugin (mind that deprecation policies for that plugin differ per version). auth_socket only protects local root; application accounts still need passwords and host restrictions -- do not conflate the two.

### 1.2 RHEL/CentOS/Fedora (MariaDB by Default)

This path yields MariaDB, with tools and the service prefixed/named mariadb, so the MySQL manual does not map one-to-one. The default repository version is relatively conservative, traded for security updates aligned with the distro's lifecycle; evaluate the official MySQL repository or source packages when new features are needed. Right after installing, `enable --now` and verify a local login -- do not stop at "the package says installed"; a successful installation and a working service are two different things, and monitoring and inspection should watch the unit's state, not merely whether rpm/qyery entries exist.

Install from the default repo with `sudo dnf install mariadb-server`, service name `mariadb`, verify with `mariadb --version` after `enable --now`. This path yields MariaDB rather than Oracle MySQL, with slightly different documentation and binary names (some diagnostic tools are called `mariadb-*`), so do not copy the MySQL manual verbatim when troubleshooting.

### 1.3 RHEL/CentOS with the Official MySQL Repository

Take this path only when you genuinely need upstream MySQL (depending on a specific feature or authentication plugin); the repository RPM version number follows the official site, so do not copy stale links. The temporary password allows only a first login and an immediate change; if the log has rotated away, reset with `--skip-grant-tables` (see section 8). When the official packages coexist with the distro's MariaDB, they may fight over port 3306 and the unit name -- do not mix them on a production machine; after mixing, `systemctl start mysql` succeeds but what you actually connect to is another data directory, one of the strangest incident shapes there is.

```bash
sudo dnf install https://dev.mysql.com/get/mysql80-community-release-el9-5.noarch.rpm
sudo dnf install mysql-community-server
sudo systemctl enable --now mysqld
sudo grep 'temporary password' /var/log/mysqld.log
```

### 1.4 Arch Linux

The Arch official repository ships MariaDB; after `sudo pacman -S mariadb` you **must initialize the system tables** before starting, otherwise the data directory is empty and the service will not come up. The initialization command is `mariadb-install-db --user=mysql --basedir=/usr --datadir=/var/lib/mysql`, then `systemctl enable --now mariadb`. Config snippets live in `/etc/my.cnf.d/`. During Arch rolling upgrades, check the news first -- major MariaDB upgrades occasionally need manual steps, and ` -Syu`-ing straight past the news page is an old Arch trap.

## 2. Secure Configuration

The goal of secure configuration is not "finishing the wizard" but shrinking the exposure surface: who can connect, from where, and what they can do once connected. The wizard handles instance-level matters -- anonymous users, the test database, remote root; account-level matters (least privilege for the application, a read-only backup account) must be done separately before the business goes live. Debian's auth_socket and RHEL's temporary password are two different "first-login paths", and mixing them up means looking for a nonexistent log in the wrong place. Security and availability must be balanced: an over-strict password policy making the application fail to rotate passwords at 3 a.m. and an over-loose one getting you scanned are both production incidents; enforce by environment tier and document it.

The first thing after installation is tightening the default exposure: remove anonymous users, disable remote root, drop the test databases, set a strong password. The tool name differs by fork -- `mysql_secure_installation` for MySQL, `mariadb-secure-installation` for MariaDB (most distros still provide `mysql_*` compatibility links). The interactive steps themselves are not hard; what is hard is "why yes at each step". Anonymous users and test databases have no place in production; disabling remote root forces you to create dedicated accounts for the application, so the privilege boundary is clear from day one -- fixing it after the fact means changing connection strings and rolling restarts, at a higher cost. Finishing the wizard does not equal finishing security: whether the default port is exposed to the public internet, backup account privileges, and least privilege for application accounts still have to be implemented separately at the firewall and GRANT layers.

Interactive highlights: set a strong root password (on Debian, if still on auth_socket you can skip it for now and use `ALTER USER` later); remove anonymous users -- anonymous accounts are a legacy attack surface; disable remote root login -- remote administration uses a dedicated account restricted to source IPs, not root@`%`; drop the test databases; reload the privilege tables. Password strength is governed by `validate_password`, stricter by default in official MySQL and often looser in distro MariaDB -- choose per your team's standard, and do not set a weak password just to get through the wizard while counting on the firewall. After the wizard, run a real application connection test to confirm the connection string and authentication plugin match on the application side; the wizard only covers instance-level tightening, and database-level privileges plus the backup account still need least-privilege creation separately.

On Debian MySQL run `sudo mysql_secure_installation`; on RHEL/Arch MariaDB run `sudo mariadb-secure-installation` (or the compatibility command `mysql_secure_installation`). The interactive questions are nearly in the same order; answer as prompted.

## 3. User Management

Users and privileges decide "who, from where, can do what to what". MySQL compresses all three into `user@host` plus GRANTs -- finer than Unix's user/group model, and consequently easier to misconfigure the host or over-grant. The principle is always least privilege: database-level when global is not needed, read-only when write is not needed, and separate accounts for application versus ops. After changing privileges, read back with `SHOW GRANTS`, then actually connect once from the intended source as acceptance -- a successful SQL execution alone is not done; a successful connection with the expected privileges is.

MySQL privileges and Unix file permissions are **two independent mechanisms**: file permissions govern whether a process may read and write the data files on disk, while MySQL privileges govern which SQL a login identity may run against which databases and tables. With file permissions all correct you can still get Access denied (insufficient GRANTs), and with superuser privileges you can still be blocked by SELinux at the data directory. When troubleshooting login problems, go through the MySQL layer first (user@host, authentication plugin), and look at the file layer plus mandatory access control only for write-to-file problems -- mixing the two wastes enormous amounts of time. In practice, start with a minimal reproduction: does a local socket login work, does TCP work, is the error code 1045 or 1130 -- the error code itself splits the problem into "authentication failed" and "host mismatch".

### 3.1 Creating Users

When creating a user, determine the authentication string and the source host at the same time; neither can be omitted. Production habits: application accounts bound to an intranet segment, administration accounts bound to the jump host's IP, replication accounts granted only replication privileges; `'%'` only in isolated networks where the risk is explicitly accepted. Use a random string from a password manager rather than reusing or weak passwords; name accounts with a purpose prefix (app_, backup_, repl_) so that when something breaks, the username alone shows who to ask for the new password. After creating the account, actually connect once from the intended source -- the cheapest form of acceptance.

An account's full name is `user@host`, and the host participates in matching -- the same username connecting from different sources may hit **different accounts**. When "local works but remote does not", first check whether `mysql.user` has an entry for the corresponding host, then check `bind_address` and the firewall. `%` matches any host; in production be sure to narrow it to specific IPs/segments. Use strong passwords, and do not grant application accounts global privileges like SUPER/FILE. After creating the account, connect once from the intended source -- more reliable than reading `SHOW GRANTS` alone. Note that a host of `localhost` usually goes over the socket, and only `127.0.0.1` goes over TCP -- when troubleshooting "local TCP will not connect", check whether both host entries exist.

```sql
CREATE USER 'myuser'@'localhost' IDENTIFIED BY 'StrongPassword123!';
CREATE USER 'myuser'@'192.168.1.%' IDENTIFIED BY 'StrongPassword123!';
SELECT user, host FROM mysql.user;
```

### 3.2 Privilege Management

Follow least privilege: application accounts get only CRUD on the business database; a backup account needs `SELECT,SHOW VIEW,TRIGGER,LOCK TABLES` and not `DROP`. `GRANT` usually takes effect immediately in 8.0, and `FLUSH PRIVILEGES` can be kept as a habit. Undo and remove with `REVOKE`/`DROP USER`; never hand-edit the `mysql.user` table -- bypassing the privilege system to edit tables easily leaves inconsistent state after a version upgrade. After changing, read back with `SHOW GRANTS` to confirm, more dependable than trusting what you typed; for `@'%'` accounts the readback matters especially, since one wrong character in the host makes the privilege a formality. Database-level and table-level privileges stack: after granting `mydb.*` there is no need to GRANT table by table; column-level privileges only where "may only see the desensitized column" is genuinely required -- excessive granularity turns privilege maintenance into a burden.

```sql
GRANT ALL PRIVILEGES ON mydb.* TO 'myuser'@'localhost';
GRANT SELECT ON mydb.* TO 'readonly'@'%';
SHOW GRANTS FOR 'myuser'@'localhost';
REVOKE ALL PRIVILEGES ON mydb.* FROM 'myuser'@'localhost';
DROP USER 'myuser'@'localhost';
```

### 3.3 Changing Passwords

A password change is "low-frequency but wide-blast-radius": application connection pools, backup scripts, replication accounts, and monitoring probes may all hold the old credential. The correct order is to create the new credential or run dual accounts in parallel, roll the application over while watching connection success rates, and only then delete the old credential; changing root at a single point directly may break the next scheduled job immediately. Rotate on the compliance schedule, and in the same move relocate storage from command-line/script plaintext into a 600-permission config file or a key management service, avoiding "changed the password but the old one still sits in history".

Use `ALTER USER` for changing both the current and other users' passwords, and after changing, actually connect once from the application side with the new credential as acceptance. If the authentication plugin does not match (say, an old driver does not support the new default plugin), it shows up as intermittent authentication failures in application logs -- aligning the plugin and driver versions works better there than repeatedly changing passwords. During the password change window, keep a short period of dual credentials to avoid half the instances failing to connect when a rolling release is unfinished.

Change passwords with `ALTER USER 'myuser'@'localhost' IDENTIFIED BY '...';`, update the connection pool config on the application side in step, and rolling-restart, to avoid intermittent authentication failures from half the instances using the new password and half the old. During the rotation window, dual accounts may briefly coexist; delete the old one after the switchover completes.

## 4. Database Operations

Databases, tables, and data manipulation are the bulk of daily SQL and also where privilege verification lands -- an account that connects but gets an error on `CREATE TABLE` means missing DDL privileges, not a connection problem. This section's commands are organized into three levels "database -> table -> row", aligned with MySQL's privilege granularity (global / database / table / column): at whatever level you operate, grant at that level. The two global choices -- character set and storage engine -- are best settled once at database creation; changing them later requires table locks and an application-encoding review, far more expensive than two extra options at creation. Before hand-editing production data, open a transaction and preview with SELECT, confirm the row count, then COMMIT -- far safer than clicking "execute" directly.

### 4.1 Database Management

A new business database must specify `utf8mb4` explicitly, otherwise it inherits the server's default charset, making later conversion costly and prone to mojibake. MySQL's `utf8` is a three-byte legacy that cannot store emoji -- do not use it for new databases. `DROP DATABASE` is irreversible; before running it in production, confirm the backup exists and that applications depending on the database have been decommissioned -- `IF EXISTS` only guards against the "database does not exist" error, not "dropped the wrong database".

List databases with `SHOW DATABASES`; create with `CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` written out; `USE` switches the current database and `SELECT DATABASE()` echoes it; drop with `DROP DATABASE IF EXISTS`, confirming the backup first.

### 4.2 Table Management

Table structure is the contract between the application and the database: column types, unique constraints, and defaults, once live, get more expensive to change as data volume and the number of callers grow. In the design phase, choosing the right types and indexes up front (timestamps as `DATETIME`/`TIMESTAMP` as needed, money as `DECIMAL`, status as a small integer enum) is cheaper than frequent `ALTER` later. `SHOW CREATE TABLE` is a mandatory artifact of migration and disaster recovery, stored alongside the data dump so a new environment can be rebuilt completely. Changes to large tables go through online DDL or an off-peak window, with locks and replication lag evaluated beforehand (a replica replaying DDL can stall).

Tables default to `ENGINE=InnoDB` + `utf8mb4`. `SHOW CREATE TABLE` yields the full CREATE statement, most useful when migrating environments. An `ALTER` on a large production table can hold locks for a long time; MySQL 8.0 supports `ALGORITHM=INSTANT/INPLACE` for some operations -- confirm the algorithm before the change and avoid business peaks, since one bad `ALTER` can take the whole site into timeouts. Prefer adding nullable or defaulted columns to reduce locks and compatibility problems; before dropping a column, search the whole codebase for references to it.

The CREATE TABLE example uses InnoDB + utf8mb4 with an auto-increment primary key, a unique username, and timestamp columns. `DESCRIBE` for structure, `SHOW CREATE TABLE` for the complete DDL; alter with `ALTER TABLE ... ADD/MODIFY/DROP COLUMN`, drop with `DROP TABLE IF EXISTS`. Confirm algorithm and lock impact for production ALTERs.

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

### 4.3 Data Manipulation

An `UPDATE`/`DELETE` without a `WHERE` runs on the whole table. When the impact is uncertain, run a `SELECT` with the same `WHERE` first to count rows, then execute the write; take the client's "0 rows matched" warning seriously and do not click confirm twice -- zero rows sometimes means the condition was written wrong, and "execute again" only masks the problem. Concatenated SQL at the application layer is another class of risk entirely; the SQL here is reference for administrative operations only -- business code should use parameterized queries, which prevent injection and also make execution plans more stable. For hand-editing production data, open a transaction, SELECT before UPDATE, confirm rows, then COMMIT, with ROLLBACK ready at any sign of trouble -- far safer than clicking "execute".

Insert with `INSERT INTO ... VALUES`, query with `SELECT ... WHERE`, update with `UPDATE ... SET ... WHERE`, delete with `DELETE ... WHERE`. See the statements above: an UPDATE/DELETE without WHERE is a high-incident spot, so SELECT with the same condition to verify the affected rows before executing.

## 5. Backup and Restore

A backup strategy must answer three questions: what is kept (single database / all / whether routines are included), how often (RPO), and how fast you can restore (RTO). Without answers, the script is usually copied from a template, and it is only when disaster hits that you discover the wrong database was covered or the restore takes a day. Logical backups ease cross-version migration; physical backups suit fast recovery of large databases; production usually combines "daily physical full backup + binlog incrementals + periodic logical exports of key databases". A restore drill is not optional: writing the restore steps into the runbook and timing a pass through them in a test environment is what having a backup means.

Backups split into **logical** (mysqldump -- portable, slow to restore large databases) and **physical** (data directory / xtrabackup -- fast, requires matching versions). mysqldump suffices for small databases; go physical at the terabyte scale. Full strategy and drills are in the system administration chapter. The core principle: **a backup that has never been restore-drilled is no backup** -- the backup success log scrolls happily, and it is only at restore time that you discover missing transaction locks or missing privileges, the most common and most expensive class of incident. Logical backups further split into "full + binlog incremental" and "full only"; for a business with an RPO requirement, calculate how much data loss is acceptable between backups before choosing frequency and whether to archive binlogs.

### 5.1 Using mysqldump

mysqldump is a logical export tool: its advantage is easy migration across versions and engines; its disadvantages are slow export and restore for large databases, plus a read lock on tables at the moment of dump by default (InnoDB can switch to a consistent snapshot with `--single-transaction`). Parameter choices must align with the business engine, whether stored procedures are included, whether only the schema is wanted, and so on; codify common parameters into a script or a Makefile target so you never forget `--routines` by hand and lose stored procedures on restore -- gaps of the "backup succeeded, restore incomplete" kind only drills expose.

Passing `-p` and typing the password interactively keeps it out of shell history; in automation, never put the password on the command line (visible to `ps` everywhere) -- use `--defaults-extra-file` pointing at a 600-permission config file. `--single-transaction` gives a consistent snapshot on InnoDB, generally without stopping the service; if MyISAM is mixed in, consider table locks or per-engine handling. Gzipping after export saves significant disk, and the restore pipeline is simpler too.

Core shapes: single database `mysqldump -u root -p mydb > out.sql`; multiple databases add `--databases`; all databases `--all-databases`; schema only `--no-data`; production adds `--single-transaction --routines --triggers` and pipes to `gzip`. Never put the password on the command line; use defaults-extra-file.

### 5.2 Restoring Data

The target database must already exist unless the dump contains `CREATE DATABASE`. After restore, verify key table row counts and spot-check data; rehearse the import path in a test environment first, including disk space, character sets, and permissions -- the first production restore is by definition the wrong place to discover problems. Restoring a compressed dump uses `gunzip < file.gz | mysql ...`, saving a copy on disk compared to decompressing first.

Restore: `mysql -u root -p mydb < dump.sql` imports a single database; `gunzip < dump.gz | mysql ...` for compressed dumps; for a full dump, drop the target database name and redirect directly. Before importing, confirm the database exists, the character set matches, and the disk has room -- and rehearse in a test environment first.

### 5.3 Automated Backup Scripts

Put the password in a `chmod 600` `--defaults-extra-file` so it never appears in `ps` or command history; `--routines --triggers` carry stored procedures and triggers along. A failed cron job must write logs and be discoverable by monitoring (non-zero exit code or a log alert) -- a silently failing scheduled task is the most dangerous kind; seeing the error for the first time on the day the disk fills or you need the restore is usually already too late. Set `KEEP_DAYS` from your recovery point objective (RPO); do not copy "7 days" while demanding you can restore last month's data.

```bash
# /root/.my.cnf.backup (chmod 600)
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

After `chmod 700`, put the script in root's crontab: `0 2 * * *` runs at 2 a.m. daily, with stdout and stderr appended to `/var/log/mysql_backup.log`, making next-day inspection and monitoring able to grep failure keywords.

## 6. Master-Slave Replication

Replication extends "single-point writes" into "one writer, many readers", and also provides a near-real-time disaster recovery replica -- but asynchronous replication can still lose the last batch of transactions when the source crashes, so align the choice with the business's consistency requirements. The setup itself is not hard; what is hard is everything after: lag monitoring, handling dual No, stalls caused by large transactions, and the version window between source and replica during upgrades. Turning the key fields of `SHOW REPLICA STATUS` into a monitoring dashboard is far more reliable than logging into machines and typing commands after the fact. The replication account, server-id, and binlog format are the three points most likely to bury mines early on -- get them right once when building the topology.

Replication serves read/write splitting, disaster recovery, and online backups. Topologically one Source feeds multiple Replicas, transmitted asynchronously or semi-synchronously via binlog: asynchronous may lose the last batch of transactions; semi-synchronous/at-least-once commit narrows the loss window -- choose per consistency requirements. Before setup, confirm: source and replica clocks roughly in sync, globally unique `server-id`, port 3306 reachable and opened only to the replication segment. MySQL 8.0.23+ recommends `CHANGE REPLICATION SOURCE`; the old syntax is removed from 8.4; MariaDB still primarily uses `CHANGE MASTER TO` -- **pick one per your actual fork and do not mix them**, since mixing produces a syntax error outright. Grant the replication account only replication privileges and restrict its source; do not use root for replication out of convenience.

### 6.1 Source Server Configuration

The source is the single write entry point; the config priorities are: a stable unique `server-id`, binlog enabled with the right format, and a least-privilege replication account. A `server-id` conflict causes silent replication misbehavior, most likely to collide when containerizing or templating deployments across environments -- encode the environment segment into the ID. `binlog_format=ROW` is the safer choice for data consistency and security; the statement format saves space but trips on nondeterministic functions. Config changes (enabling binlog, changing format) usually require an instance restart, so schedule a maintenance window and confirm replicas can catch up, avoiding long unavailability during a switchover.

The source must have binlog enabled, and `binlog_format=ROW` is the most stable for data consistency (also avoiding statement-based replication tripping over nondeterministic functions). After restart, note File/Position from `SHOW MASTER STATUS` -- the replica needs them; `binlog_do_db` is a whitelist filter, and with many databases mind not to miss one. Create the replication account separately with only `REPLICATION SLAVE` granted -- do not use root for convenience; a compromised root compromises the entire privilege system, while the replication account only needs to read binlog.

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

### 6.2 Replica Server Configuration

The replica's `server-id` must differ, and `read_only=1` guards against accidental writes (a superuser can still write; application accounts should have no SUPER). Point it at the source's account, log file, and position, then `START REPLICA`, and check for both Yes in `SHOW REPLICA STATUS\G`: a down IO thread is usually network/account/firewall, a down SQL thread usually primary key conflicts or structure mismatch, and `Seconds_Behind_Source` reflects the lag. When source and replica data have already diverged, do not blindly `START REPLICA` -- first evaluate whether to rebuild the replica or repair the data, otherwise the dual No keeps stalling and masks the real problem. Lag monitoring belongs in the alerting; relying on "looks fine" on a dashboard leaves you caught out when the source stumbles; the `Last_SQL_Error` field gives the conflict reason and is the first landing point for SQL thread debugging.

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

## 7. Performance Tuning

Database performance problems almost always reduce to four categories: insufficient buffer pool (high disk read ratio), slow SQL (missing indexes, bad plans), connections and locks (wrong pool config, long transactions, deadlocks), and replication lag (stalled replica, large transactions). Suggested investigation order: `SHOW STATUS` first for hit rates and connections, then enable the slow log to capture the top SQL, then look at `innodb_trx` and lock waits, and only then talk about hardware. Tuning parameters without a slow log is screwing blind; fixing the three costliest statements often beats doubling the buffer pool and costs less. Tuning needs a control: same benchmark and same data volume before and after, otherwise "feels faster" cannot be attributed.

### 7.1 Memory Configuration

The core of memory configuration is putting hot data in the buffer pool while leaving headroom for the OS and connection overhead. Giving a dedicated database box 50–70% is a starting point, not gospel: lower it when the app, monitoring, or log collection share the machine; raising it further when the data is far smaller than the pool is just waste. Per-connection parameters like `max_connections` and sort buffers multiply with the pool to give the real footprint -- do the mental math on the upper bound before changing. Every parameter change requiring a restart goes into a maintenance window with the rollback value ready, avoiding breaking the database at 3 a.m. with a typo.

The InnoDB buffer pool is the biggest item, commonly given 50–70% of physical RAM on a dedicated database machine, and it needs a restart to take effect -- "changing it live does nothing" is the source of many "the parameter does not work" illusions. Bigger `max_connections` is not better -- use connection pooling on the application side and leave only headroom server-side; a connection explosion is usually a leak, not a need for a higher ceiling. MySQL 8.0 removed the query cache; do not copy `query_cache_size` from old material, and you will get unknown variable. `sort_buffer_size`/`join_buffer_size` are allocated **per connection**, so blindly raising them multiplies out to eating memory alive; on a small-memory machine, better to sort to disk than to have the OOM Killer take out mysqld.

```ini
[mysqld]
innodb_buffer_pool_size=2G
max_connections=500
sort_buffer_size=4M
```

### 7.2 Slow Query Log

Enable the slow log and drop `long_query_time` to 1–2 seconds to expose hidden slow spots. The log directory must be writable by the `mysql` user, otherwise writes fail silently -- when a configured log stays at zero bytes for a long time, check the owner first. `mysqldumpslow -s t` summarizes by total time; fix high-frequency, high-total statements first, then pick at single cold queries that are extremely slow each time. The slow log itself consumes disk, so configure rotation alongside it, avoiding filling the disk while investigating a performance problem.

```ini
[mysqld]
slow_query_log=1
slow_query_log_file=/var/log/mysql/slow.log
long_query_time=2
```

```bash
mysqldumpslow -s t -t 10 /var/log/mysql/slow.log
```

## 8. Common Problems

Classify database faults as "cannot connect / connected but erroring / connected but slow" -- faster than searching the full error text. For cannot-connect, split into network, host matching, and authentication; for connected-but-erroring, look at the error code (1045, 1130, 1062...); for connected-but-slow, look at PROCESSLIST and the slow log. Production handling principles: stop the bleeding read-only or shift traffic first, then touch privileges and schema in a maintenance window -- the cost of a late-night fat-fingered DROP far exceeds waiting one more release window. During troubleshooting, preserve the scene (error code, PROCESSLIST, replication status screenshots) and clean up after fixing, so that "fixed but nobody knows why" cannot prevent comparison when it recurs.

### 8.1 Forgotten root Password

The approach: stop the service -> start with `--skip-grant-tables` -> change the password -> return to normal startup. **Skipping grant tables turns authentication off**, and during that window anyone who can reach 3306 can get in -- restrict the firewall/binding address first; a public database getting scanned in those few minutes is running naked. MySQL 8.0 and MariaDB differ slightly in password change syntax (`ALTER USER` vs `SET PASSWORD ... PASSWORD()`), so follow your fork's error message and do not keep pasting the other vendor's syntax after an error. After changing, be sure to remove the skip parameter, restart normally, and verify password login succeeds before leaving; also confirm no stray `mysqld_safe --skip-grant-tables` process remains, otherwise the next investigation will think privileges are "sometimes working, sometimes not".

```bash
sudo systemctl stop mariadb    # or mysql / mysqld
sudo mysqld_safe --skip-grant-tables &
mysql -u root
```

```sql
FLUSH PRIVILEGES;
ALTER USER 'root'@'localhost' IDENTIFIED BY 'NewPassword123!';
```

```bash
# After finishing the skip-grant-tables process, restart normally
sudo systemctl stop mariadb 2>/dev/null; pkill -f mysqld_safe
sudo systemctl start mariadb
```

### 8.2 Too Many Connections

`SHOW PROCESSLIST` for current sessions, `KILL` abnormal long connections, and compare `Threads_connected` against `max_connections`. A connection explosion usually means the application has no connection pool or leaks connections, or `max_connections` is too small and generates floods of `Too many connections`. The root fix is converging application-side connections and killing stale sessions, not endlessly raising the server ceiling -- a higher ceiling raises memory and thread overhead along with it and may be less stable at peaks. Long transactions also hold connections and block the purge, so look at `information_schema.innodb_trx` too; large-`Time` `Sleep` sessions in the process list are often the application failing to close connections -- correlate with application logs to find which service instance.

Use `SHOW PROCESSLIST` for sessions, `SHOW VARIABLES LIKE 'max_connections'` for the ceiling, `SHOW STATUS LIKE 'Threads_connected'` for the current count, and `KILL <id>` for stale sessions. These four commands cover on-scene handling of a connection storm.

### 8.3 Works Locally but Not Remotely

Debug layer by layer: ① does `mysql.user` have a matching host entry (error 1130 is usually here); ② is `bind_address` bound only to `127.0.0.1`; ③ does the firewall/cloud security group allow 3306; ④ is the account permitted to authenticate from that source. Restrict remote application accounts to their segment, and avoid `'user'@'%'` with a weak password exposed to the public internet -- **database ports should never be opened directly to the public internet**; go through a jump host or intranet only, a rule that blocks scanners better than any password policy. If it still fails after the security group is opened, check whether DNS/routing and the OS firewall stack two layers of rules -- on the cloud it is common for "the security group is open but firewalld at the OS layer is not"; both layers must pass.

## 9. Quick Reference of Common Traps

Remember traps in four classes -- wrong fork installed / wrong service name / authentication and host / backup and replication -- and classify new problems before consulting the manual. The quick reference is for stopping the bleeding; root causes still go back to their chapters: a wrong fork means checking whether packages are mixed, authentication problems go back to the user@host model, dual-No replication goes back to the thread status fields. Write high-frequency traps into the team runbook with their "verification commands"; on handover that is more reliable than verbal experience.

- Cannot find temporary password: that is a mechanism of the RHEL family's **official MySQL package**; Debian's auth_socket and MariaDB do not have it.
- Arch install will not start: run `mariadb-install-db` to initialize first, then `systemctl start mariadb`.
- Neither `mysql` nor `mysqld` as service name works: the RHEL default repo is `mariadb`; only official MySQL uses `mysqld`.
- Backup password in history/ps: switch to `--defaults-extra-file`, file mode 600.
- `SHOW REPLICA STATUS` shows dual No: first tell whether it is the IO thread (network/account) or the SQL thread (conflict/schema).
- Remote error 1130: usually a host mismatch; check `SELECT user, host FROM mysql.user`.

## Chapter Summary

MySQL ops compresses into four main lines: install the right fork (MySQL vs MariaDB, package and service names, initial authentication), control privileges (user@host, least privilege, layered apart from file permissions), protect the data (mysqldump/defaults-extra-file, restore drills, replication status), and tuning and triage (buffer pool, slow log, PROCESSLIST, error code layering). Daily operations live in the loop "small change -> `SHOW` readback -> application verification"; knotty problems are usually distro differences, host matching, SELinux, and replication thread states all mixed into one investigation. Separate layers first, verify next, and only then touch production -- the same order as the web chapter and the universal method for Linux server troubleshooting.

Backup and privilege changes are "low-frequency, high-risk" operations: before executing, write out the blast radius and rollback steps; after executing, keep the output and timestamp for later audit. Turning this chapter's commands into an annotated runbook that the on-call follows as a checklist is more reliable than relying on personal memory. Hold the boundary between database and application: the application holds only business accounts, ops holds administration accounts, and replication and backup each have their own dedicated identity -- with clear identities, the blast radius of an incident stays controllable.

## Practice Notes

Every step touching production data should be designed assuming "it will go wrong": SELECT before delete/update, check algorithm and locks before DDL, read back with SHOW GRANTS before changing privileges, and prepare a rollback value before changing config. When on-call follows the runbook, the checklist's "verification command" and "rollback command" must sit next to the main command, avoiding fumbling for documentation and assembling commands during an incident. At the team level, making high-risk operations require two-person review or an approval flow costs far less than recovering from one accidental deletion.

## References

- Official MySQL 8.0 documentation -- [dev.mysql.com/doc/refman/8.0](https://dev.mysql.com/doc/refman/8.0/en/)
- MariaDB Server documentation -- [mariadb.com/kb](https://mariadb.com/kb/en/documentation/)
- Arch Wiki - MariaDB -- [wiki.archlinux.org](https://wiki.archlinux.org/title/MariaDB)
- MySQL Performance Blog -- [percona.com/blog](https://www.percona.com/blog/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/server/README.md)