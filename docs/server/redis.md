# Redis

Redis is an open-source in-memory data structure store, often used at once as a database, a cache, and a message broker. Its reason for existing can be stated in one set of magnitudes: a mechanical disk does a random read in about 10 milliseconds, an SSD in about 100 microseconds, and memory access is on the order of 100 nanoseconds -- the same "fetch a value by key" is roughly five orders of magnitude faster in memory than on a mechanical disk. If data like flash-sale counters, web sessions, and leaderboards went to a relational database on every request, disk I/O would become the bottleneck immediately; put them in Redis and a single instance comfortably carries hundreds of thousands of QPS. But there is no free lunch: memory is more expensive than disk and vanishes on power loss, so "which data belongs in Redis", "what happens if the data is lost", and "what happens when memory runs out" are the three questions you must settle before using Redis. This page explains those "why" questions first, then gives install and configuration methods for the three distro families -- Debian/Ubuntu (apt), Arch (pacman), and RHEL/CentOS/Rocky (dnf) -- along with real terminal output and common traps. It is organized as "why -> three-distro install -> connecting and basic commands -> listen binding and password -> persistence -> memory and eviction -> replication, Sentinel, and Cluster -> monitoring and slow queries -> common traps".

> Content draws on the official Redis documentation and the Arch Wiki; see the references at the end.

## What This Page Covers

- Understanding where the performance of in-memory storage comes from and what it costs, so Redis's boundaries of applicability are clear
- Installing on the three distros (apt / pacman / dnf), and the correct posture for listen binding and passwords
- Telling apart the principles, loss windows, and use cases of RDB versus AOF
- Knowing the commands of the common data structures and their typical business uses
- Understanding what master-replica, Sentinel, and Cluster each solve

## 1. Why Redis

### 1.1 The Trade-offs of an In-Memory Database

Traditional relational databases keep data on disk organized as B+ trees; what they buy is large capacity and no data loss on crash; what they pay is that every query can trigger random I/O. Redis keeps the entire dataset in memory and addresses it directly through structures like hash tables, so a single `GET` costs a few memory accesses and latency stays at the microsecond level. The costs are equally clear: memory capacity is far smaller than disk, so Redis needs a `maxmemory` cap and an eviction policy; a process crash or power loss erases unpersisted writes, so RDB/AOF are needed. Think of it as "adding an insurance policy on top of memory data with persistence, and giving the capacity ceiling an outlet with eviction".

### 1.2 Expressiveness from Data Structures

A pure key-value store (like Memcached) can only hold strings, so implementing leaderboards, timelines, and dedup lists means assembling data structures in the application layer yourself. Redis builds the common structures into the server, so logic that used to take many database round trips completes in one:

| Type | Under-the-hood notes | Typical scenario | Representative commands |
|------|----------|----------|----------|
| String | simple dynamic string | caching objects, counters, distributed locks | `SET` / `GET` / `INCR` |
| Hash | conversion between ziplist/listpack and hash table | field-level reads and writes of objects, saving bandwidth | `HSET` / `HGETALL` |
| List | list with fast head/tail insertion | message queues, timelines | `LPUSH` / `BRPOP` |
| Set | unordered deduplicating set | tags, common friends | `SADD` / `SISMEMBER` |
| Sorted Set | ordered set with scores | leaderboards, delayed queues | `ZADD` / `ZREVRANGE` |

The test for whether Redis should be used is simple: is the data hot, can you tolerate loss, does it need very low latency? Log archives and large cold objects still belong in disk storage; cramming them into Redis only blows up memory. Conversely, there is no need to deify Redis -- it solves "access speed" and "shared state", not transactional consistency or complex joins; order master data that belongs in MySQL has no reason to move into memory. The install commands for the three distros come in the next section; Arch readers only need to remember the main line: install from the official repositories with `pacman -S`, upgrade with `pacman -Syu`, and config and service management match the other two families.

## 2. Installation (Three Distros Compared)

The package names are not identical across the families: Debian/Ubuntu's package is called `redis-server`, while Arch and the RHEL family both call it `redis`; the service unit name follows the package, `redis-server.service` on Debian and `redis.service` on Arch and RHEL. The table below is the complete comparison of install, search, upgrade, and remove, with the rightmost column giving Arch's `pacman` usage specifically:

| Action | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Install | `sudo apt install redis-server` | `sudo pacman -S redis` | `sudo dnf install redis` |
| Search | `apt search redis` | `sudo pacman -Ss redis` | `dnf search redis` |
| Show package info | `apt show redis-server` | `pacman -Qi redis` | `dnf info redis` |
| List package files | `dpkg -L redis-server` | `pacman -Ql redis` | `rpm -ql redis` |
| Upgrade | `sudo apt upgrade` | `sudo pacman -Syu` | `sudo dnf upgrade` |
| Remove | `sudo apt remove redis-server` | `sudo pacman -R redis` | `sudo dnf remove redis` |

Note for Arch users: `pacman -S` installs `redis` from the official extra repository, no AUR needed; for routine upgrades stick to the full rolling upgrade `pacman -Syu`, and **never** use `pacman -Sy` to sync the database without upgrading installed packages -- that creates a partial upgrade and breaks dependency consistency. If you forget where the config file is, list everything in the package with `pacman -Ql redis` first; it beats running `find` all over the system.

### 2.1 Debian/Ubuntu

```bash
$ sudo apt update && sudo apt install redis-server
Setting up redis-server (7:7.0.15-1~deb12u5) ...
$ sudo systemctl enable --now redis-server && redis-cli ping
PONG
```

Debian's service name is `redis-server`, the config file is `/etc/redis/redis.conf`, and data lands in `/var/lib/redis` by default. Getting `PONG` from `redis-cli ping` immediately after install is the minimum acceptance standard: the process is listening and the protocol works.

### 2.2 Arch

```bash
$ sudo pacman -Syu redis
resolving dependencies...
Packages (1) redis-7.2.5-1

Total Download Size:   1.20 MiB
:: Proceed with installation? [Y/n] y
(1/1) checking keys in keyring                   [######################] 100%
(1/1) checking package integrity                 [######################] 100%
(1/1) loading package files                      [######################] 100%
(1/1) checking for file conflicts                [######################] 100%
(1/1) checking available disk space              [######################] 100%
:: Processing package changes...
(1/1) installing redis                           [######################] 100%
$ sudo systemctl enable --now redis
$ redis-cli ping
PONG
```

On Arch both the package and the service are called `redis`, and the config is again `/etc/redis/redis.conf`. Upgrading Redis is part of a normal rolling upgrade and rides along with `pacman -Syu`; when an upgrade contains incompatible changes, the official notes describe them in `/usr/share/doc/redis/` or the announcement, and `pacman -Ql redis` shows which files the new version dropped in.

### 2.3 RHEL/CentOS/Rocky

```bash
$ sudo dnf install redis
 redis  x86_64  7.0.10-1.el9  appstream
Complete!
$ sudo systemctl enable --now redis && redis-cli ping
PONG
```

The `redis` package of Fedora and Rocky/CentOS Stream lives in AppStream, with config file `/etc/redis/redis.conf` and service `redis.service`. If an older EPEL build of Redis was also installed on the same machine, run `rpm -qi redis` first to confirm the source repository, and avoid mixing the two sources.

## 3. Connecting and Basic Commands

`redis-cli` is the official command-line client that ships with the package. A local passwordless connection is just pressing Enter; a remote connection needs host, port, and password stated explicitly. Commands are case-insensitive, but by convention commands are written uppercase and key names lowercase; in interactive mode `HELP @list` lists every subcommand of a structure by category, faster than flipping through the manual:

```bash
$ redis-cli
127.0.0.1:6379> set greeting hello
OK
127.0.0.1:6379> get greeting
"hello"
127.0.0.1:6379> setex session:abc 3600 '{"uid":1}'
OK
127.0.0.1:6379> incr page:views
(integer) 1
127.0.0.1:6379> exit

# Remote connection (-a exposes the password in the process list; AUTH in the interactive shell is safer)
$ redis-cli -h 192.168.1.100 -p 6379
192.168.1.100:6379> AUTH your_password
OK
192.168.1.100:6379> INFO server | head -3
# Server
redis_version:7.2.5
```

The shortest examples for the common structures:

```bash
# Hash: field-level updates, suited to user profiles
127.0.0.1:6379> hset user:1 name alice age 30
(integer) 2
127.0.0.1:6379> hget user:1 name
"alice"

# List: push left, pop right gives a FIFO queue; Sorted Set: ranked by score
127.0.0.1:6379> lpush queue job1 job2
(integer) 2
127.0.0.1:6379> zadd rank 100 alice 95 bob
(integer) 2
127.0.0.1:6379> zrevrange rank 0 0
1) "alice"
```

One detail is easy to step on when choosing: storing a whole JSON object in a String is the most intuitive, but changing a single field means reading it out, deserializing, modifying, and writing back -- wasting bandwidth and inviting concurrent overwrites; switch to a Hash and `HSET user:1 age 31` transfers only the delta, which is where "pick the right structure, halve the network" comes from.

## 4. Listen Binding and Passwords: Understand Before You Configure

### 4.1 How bind and protected-mode Work Together

By default Redis listens only on the loopback address and has protected mode enabled. The logic of protected mode: **when no `bind` to a non-loopback address is configured and no password is set, only local connections are accepted**; the moment an external connection arrives, the server refuses it and says it is in protected mode. This explains two high-frequency phenomena: changing to `bind 0.0.0.0` on a cloud host without setting a password and still not being able to connect from outside (blocked by protected mode); or forgetting the password in a container and exposing the port outright, getting swept by a scanner within seconds and `FLUSHALL`ed.

There are only two correct choices -- listen on loopback only and let the application share the machine with Redis or reach it through a tunnel, or bind to an internal address with a full password and firewall in place:

```ini
# Option A (recommended): listen on localhost only; the application and Redis share a machine
bind 127.0.0.1 -::1

# Option B: when cross-machine access is required, bind an internal address + password is mandatory + firewall restricts the source
bind 192.168.1.100
requirepass a-strong-password
protected-mode yes
```

Never take the shortcut of `bind 0.0.0.0` with no password and expose 6379 to the public internet -- the Redis protocol has no built-in transport encryption, the password crosses the network in cleartext, and on the public internet that is walking around naked. For cross-internet access use an SSH tunnel, WireGuard, or the cloud provider's private network; firewall rules are in the [Firewall](../security/firewall.md) page.

### 4.2 Passwords and Dangerous Commands

Before Redis 6 the only authentication method was `requirepass`; since 6.0 there are ACLs, which can restrict passwords, key prefixes, and command sets per user. For the single-application single-account scenario `requirepass` is enough:

```ini
requirepass a-long-random-password
# Optional: rename or disable high-risk commands
rename-command FLUSHALL ""
rename-command FLUSHDB ""
rename-command CONFIG ""
```

Beyond the password, tighten things at the system layer too: `requirepass` only defends against "people who can connect", not "people who can log into this machine". Any local user with a shell can connect to the loopback port with `redis-cli`, so the account Redis runs as should not be shared with business accounts, the `/etc/redis` config directory should stay at `600` permissions owned by root, and passwords should never be printed to logs.

Note: after `rename-command CONFIG ""`, you yourself will no longer be able to debug with `redis-cli config get *`; weigh your operations path before disabling it. The recommended process for setting or changing the password is to write it into the config file, apply it live with `redis-cli CONFIG SET requirepass ...`, and then persist it -- so that a file edit that did not take effect does not only surface as a sudden password prompt after a restart.

## 5. Persistence: How In-Memory Data Survives a Restart

### 5.1 Why You Must Understand Persistence

Redis data lives in memory; when the process exits the memory is gone. Persistence answers "is the data still there after a restart", but the two mechanisms have completely different loss windows and recovery paths -- choosing wrong means discovering during a fire drill that "the orders of the last minute are gone". Note that persistence protects the scenario where "the process can still be brought back"; for a whole-disk failure the fallback is still copying the RDB file off-site, or letting replicas keep serving.

### 5.2 RDB: Periodic Snapshots

When its triggers are met, RDB forks a child process that writes the entire dataset into one binary snapshot file (default `dump.rdb`). The child shares memory with the parent through copy-on-write (COW) at fork time, so only modified pages are actually copied during the snapshot and the impact on production latency stays controlled. The trigger rules look like "save when N keys are modified within T seconds":

```ini
# The three default rules of modern Redis (may change with version)
save 3600 1      # at least 1 key modified within 1 hour
save 300 10      # at least 10 keys modified within 5 minutes
save 60 10000    # at least 10000 keys modified within 1 minute
```

The rules are ORed; satisfying any one triggers `BGSAVE`. An instance with extremely sparse writes may go a long time without a snapshot, and its loss window on restart will be far larger than expected -- such instances should either run `BGSAVE` manually on a schedule or simply rely on AOF.

RDB's advantage is a compact file and fast recovery (the whole snapshot loads at once), which suits cold backups and full replication; its disadvantage is that every write between two snapshots is lost, with a loss window equal to the trigger interval, up to an hour in the worst case. Trigger it manually with `redis-cli BGSAVE` (background) or `SAVE` (blocking, only in a maintenance window with a small dataset).

### 5.3 AOF: The Append-Only Log

AOF appends every data-changing command to `appendonly.aof` and replays the log on restart to rebuild the data. Reliability is decided by `appendfsync`:

| Policy | Behavior | Loss window | Performance |
|------|------|----------|------|
| `always` | fsync on every command | almost nothing lost | slowest |
| `everysec` (default) | fsync once per second | up to about 1 second | recommended |
| `no` | leave flushing to the kernel | depends on the system | fastest |

```ini
appendonly yes
appendfilename "appendonly.aof"
appendfsync everysec
```

With AOF enabled, recovery reads the AOF first; if RDB is also kept and hybrid persistence is on, the RDB snapshot serves as the replay starting point, cutting startup time dramatically. Ops-wise, leave enough room on the AOF's disk -- the log only grows, and forgetting automatic rewriting will fill the partition.

AOF files swell over time (they contain many intermediate states); Redis compacts the current dataset into the shortest command set through a "rewrite". `BGREWRITEAOF` triggers it manually; automatic rewriting is controlled by `auto-aof-rewrite-percentage` and `auto-aof-rewrite-min-size`. Older AOFs need every command replayed after a crash, and recovery is slow on large files -- this is exactly why Redis 4.0 introduced hybrid persistence: at rewrite time it first writes the full dataset in RDB format and then appends incremental AOF commands, balancing recovery speed against the loss window:

```ini
aof-use-rdb-preamble yes    # enabled by default in modern versions
```

### 5.4 How to Choose

Cache only, and losing a few hours does not matter (say, hot page data): RDB alone is fine, or even just relying on replicas. Sessions, shopping carts, counters -- data where losing a second hurts: enable AOF with `everysec`. Want both fast and stable: enable RDB and AOF together with hybrid persistence, which is also today's default recommendation. To judge whether persistence actually succeeded, `redis-cli LASTSAVE` should return a different value after a restart, or `redis-cli INFO persistence` should show `rdb_last_bgsave_status:ok` / `aof_last_write_status:ok`. Also distinguish "persistence succeeded" from "no data loss": `everysec` still allows about a second of loss, and truly zero loss means `always` with the throughput drop that comes with it -- agree on the acceptable window with the business first, then change the config, not the other way around.

## 6. Memory Limit and Eviction Policies

A Redis without `maxmemory` keeps eating until the host runs out of memory and the OOM killer fires -- and the host usually also runs MySQL and the application, so Redis is not necessarily the one that gets killed. In production you **must** set it explicitly:

```ini
maxmemory 256mb
maxmemory-policy allkeys-lru
```

The policy choice follows the data's role: `noeviction` (default) rejects writes with an error once memory is full, suited to treating Redis as a real database where a failed write beats lost data; `allkeys-lru` evicts the least recently used among all keys and is the standard answer for caches; `volatile-lru` evicts only keys with an expiry set; `allkeys-random` evicts at random and only suits perfectly uniform access; `volatile-ttl` evicts the key closest to expiry. Setting `EXPIRE`/`SETEX` uniformly on cache keys has one side benefit: even if you misconfigure a `volatile-*` policy, there are clear eviction candidates instead of nothing to evict. The most common incident is "used as a cache but forgot to change the policy": once memory fills, every write starts returning errors, showing up as widespread `OOM command not allowed` from the API.

Check current memory usage and evictions:


```bash
$ redis-cli INFO memory | grep -E 'used_memory_human|maxmemory_human|evicted_keys'
used_memory_human:12.48M
maxmemory_human:256.00M
evicted_keys:0
```

`maxmemory` need not be a guess either: observe where `used_memory_human` sits at business peak, then reserve about 20-30% for the copy-on-write overhead during fork -- at the instant a snapshot is created the child briefly holds extra memory, and configuring right at the cap tends to trip memory alarms during `BGSAVE`.

Steadily growing `evicted_keys` means capacity is too small or the hot-data ratio is too low; add memory before considering other optimizations. With many small objects, the compact-encoding thresholds of Hash/List/Set (`hash-max-listpack-entries` and friends, formerly ziplist) may be worth adjusting to actual object sizes, but confirm the current encoding with `OBJECT ENCODING` first and leave it alone if unsure. And do not forget to slim the big keys: a String key stuffed with tens of megabytes of JSON makes every eviction, replication, and snapshot heavier; `redis-cli --bigkeys` is the routine pre-launch physical.

## 7. Replication, Sentinel, and Cluster

A single instance has two single points of failure: "nothing takes over when it dies" and "capacity runs out". Master-replica replication solves half of the first: a replica runs `replicaof <master IP> 6379` and gets full plus incremental synchronization; when the master dies you can switch by hand, but a manual switch means an interruption. Sentinel automates the switch: an odd number of Sentinel processes watch the master, and once a majority confirms the failure they automatically promote a replica and rewrite the client configuration -- typically three Sentinels with one master and two replicas. Why odd? Because declaring a failure needs a majority; two Sentinels cannot form one after a single outage, and it would rather not switch than split the brain. The configuration skeleton:

```ini
# /etc/redis/sentinel.conf
sentinel monitor mymaster 192.168.1.100 6379 2    # 2 = two Sentinels must agree to declare failure
sentinel auth-pass mymaster the-master-password
sentinel down-after-milliseconds mymaster 5000
sentinel failover-timeout mymaster 60000
```

For horizontal capacity you use Cluster: 16384 hash slots spread across multiple masters, data lands in a slot by `CRC16(key) % 16384`, and each slot can have replicas. The minimum production size is three masters and three replicas -- there are many slots, but "can we tolerate one node dying" is decided by a majority of the masters; with two masters, losing one loses the majority, hence at least three. Typical output when creating a cluster:

```bash
# Each node: port 7000, cluster-enabled yes, cluster-config-file nodes.conf
$ redis-cli --cluster create 127.0.0.1:7000 127.0.0.1:7001 127.0.0.1:7002 \
    127.0.0.1:7003 127.0.0.1:7004 127.0.0.1:7005 --cluster-replicas 1
>>>[OK] All 16384 slots covered.
```

Clients must connect in cluster mode (such as `redis-cli -c` or the client library's cluster mode), or a cross-slot `MGET` returns a `MOVED` redirection error. Both Sentinel and Cluster require client changes: Sentinel mode must fetch the current master address from the Sentinels, and cluster mode must route by slot -- get the client wiring working in a test environment before going to production; it is far cheaper than catching up after launch.

## 8. Monitoring and Slow Queries

`INFO` is the most-used self-check entry: `redis-cli INFO clients` for connection counts, `INFO replication` for replica state (`role:master` / `role:slave`, `master_link_status:up`), `INFO stats` for hit rate and refused connections. In cache scenarios keep an eye on `keyspace_hits` and `keyspace_misses` to compute the hit rate; persistently below 90% usually means the key design is too scattered or the TTLs are too short. Slow queries are recorded separately in the slow log, with the threshold in microseconds:

```bash
$ redis-cli SLOWLOG GET 2
1) 1) (integer) 42  2) (integer) 1726800000  3) (integer) 15231
   4) 1) "LRANGE"  2) "biglist"  3) "0"  4) "-1"
```

The threshold is controlled with `slowlog-log-slower-than 10000` (10 ms) and `slowlog-max-len 128`. Commands like `LRANGE key 0 -1` over a million-entry list will drag down the event loop even though they are O(N); use paginated `LRANGE` or split the data structure instead. The slow log only records commands over the threshold and is not a full audit; to observe latency trends over time, feed the `INFO` metrics into Prometheus -- the `redis_exporter` exposes the metrics for this, with the wiring described in the [Monitoring](./monitoring/prometheus.md) page.

## 9. Common Traps

**Edits to redis.conf have no effect.** The config file is only read at startup; for a live change use `redis-cli CONFIG SET ...`, or edit the file and `systemctl restart redis-server` (Debian) / `systemctl restart redis` (Arch, RHEL). Confirm which config was actually loaded: `redis-cli INFO server | grep config_file` -- in container or hand-built scenarios it is common to "edit the file under /etc while the process reads the old config in /usr/local/etc".

**The service is up but external connections fail.** Check three things in order: `ss -tlnp | grep 6379` to see whether the listening address is only `127.0.0.1`; whether protected mode blocked external connections because there is no password; whether the cloud security group / firewall opened 6379. The full logic of binding and passwords is in section 4; for a local test, compare `redis-cli -h 127.0.0.1 ping` with `redis-cli -h <local internal IP> ping` -- that separates "not listening" from "blocked by the firewall".

**Connections report `NOAUTH Authentication required` or `ERR Client sent AUTH, but no password is set`.** The first means the server has a password and the client did not send one; the second is the reverse -- typically after upgrading from an old passwordless config while the client still hard-codes the `-a` flag. Align the two ends against the return of `CONFIG GET requirepass`.

**The API errors out once memory is full.** See section 6: either `maxmemory` was set too small, or the policy is still `noeviction` while the data is used as a cache. In an emergency `redis-cli CONFIG SET maxmemory-policy allkeys-lru` lets writes through immediately, but do not forget to fix the config file too, or the same problem returns at the next restart.

**`MISCONF Redis is configured to save RDB snapshots...`.** This is Redis protecting itself: when the recent RDB/AOF writes to disk failed (disk full, permissions, read-only filesystem), it refuses to keep writing so that persistence and in-memory state do not diverge. Check the disk with `df -h` first, then look at the error counters in `redis-cli INFO persistence`.

**Abnormal behavior after an Arch upgrade.** Confirm the version with `pacman -Qi redis` first, then compare against the official announcement; search for related packages by name with `pacman -Ss redis`. Do not "roll back" by installing an old version with `pacman -Sy`; the correct move is to wait for upstream to fix the package or reinstall from the cache with `pacman -S redis`. Remove config along with the package with `pacman -Rs`, and use `-Rns` only for a thorough purge; when unsure which files a package provides, `pacman -Ql redis` remains the first choice.

**fork warnings and large-memory instances.** Both RDB and AOF rewriting fork, so `vm.overcommit_memory` must be 1 or the fork can fail outright. This is a kernel parameter, unrelated to whether Redis was installed with apt, pacman, or dnf, and it must be checked on all three families:

```bash
$ sysctl vm.overcommit_memory
vm.overcommit_memory = 1
```

## References

- Redis official documentation -- [redis.io/docs](https://redis.io/docs/)
- Redis persistence notes -- [redis.io/docs/latest/operate/oss_and_stack/management/persistence/](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/)
- Redis configuration index -- [redis.io/docs/latest/operate/oss_and_stack/management/config/](https://redis.io/docs/latest/operate/oss_and_stack/management/config/)
- Arch Wiki: Redis -- [wiki.archlinux.org/title/Redis](https://wiki.archlinux.org/title/Redis)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](README.md)