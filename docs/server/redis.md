# Redis

Redis 是开源的内存数据结构存储，用作数据库、缓存和消息中间件。

> 内容参考自 Redis 官方文档和实际运维经验，见文末参考资料。

## 学习目标

- 理解 Redis 的数据结构和用途
- 掌握 Redis 安装和配置
- 学会 Redis 持久化和高可用
- 了解 Redis 安全和性能优化

## 1. Redis 简介

### 1.1 特点

```bash
# Redis 特点
# 内存存储，高性能
# 支持多种数据结构
# 支持持久化
# 支持主从复制
# 支持集群
```

### 1.2 数据结构

| 类型 | 说明 | 示例 |
|------|------|------|
| String | 字符串 | SET key value |
| Hash | 哈希表 | HSET key field value |
| List | 列表 | LPUSH key value |
| Set | 集合 | SADD key member |
| Sorted Set | 有序集合 | ZADD key score member |

## 2. 安装

### 2.1 Debian/Ubuntu

```bash
# 安装 Redis
sudo apt update
sudo apt install redis-server

# 启动服务
sudo systemctl start redis-server
sudo systemctl enable redis-server

# 验证安装
redis-cli ping
```

### 2.2 RHEL/CentOS/Fedora

```bash
# 安装 Redis
sudo dnf install redis

# 启动服务
sudo systemctl start redis
sudo systemctl enable redis

# 验证安装
redis-cli ping
```

## 3. 配置

### 3.1 配置文件

```bash
# 主配置文件
/etc/redis/redis.conf

# 常用配置
bind 127.0.0.1          # 绑定地址
port 6379               # 监听端口
daemonize yes           # 后台运行
requirepass password    # 设置密码
maxmemory 256mb         # 最大内存
maxmemory-policy allkeys-lru  # 内存淘汰策略
```

### 3.2 安全配置

```bash
# 设置密码
requirepass your_password

# 绑定地址
bind 127.0.0.1

# 禁用危险命令
rename-command FLUSHDB ""
rename-command FLUSHALL ""
rename-command CONFIG ""
```

## 4. 基本操作

### 4.1 连接 Redis

```bash
# 连接本地 Redis
redis-cli

# 连接远程 Redis
redis-cli -h hostname -p port -a password

# 测试连接
redis-cli ping
```

### 4.2 字符串操作

```bash
# 设置键值
SET key value

# 获取值
GET key

# 设置带过期时间
SETEX key 60 value

# 递增
INCR key

# 递减
DECR key
```

### 4.3 哈希操作

```bash
# 设置哈希字段
HSET key field value

# 获取哈希字段
HGET key field

# 获取所有字段
HGETALL key

# 删除字段
HDEL key field
```

### 4.4 列表操作

```bash
# 左推入
LPUSH key value

# 右推入
RPUSH key value

# 获取列表范围
LRANGE key 0 -1

# 弹出元素
LPOP key
RPOP key
```

### 4.5 集合操作

```bash
# 添加成员
SADD key member

# 获取所有成员
SMEMBERS key

# 判断成员是否存在
SISMEMBER key member

# 删除成员
SREM key member
```

## 5. 持久化

### 5.1 RDB 持久化

```bash
# RDB 是快照方式
# 配置
save 900 1      # 900 秒内至少 1 个键被修改
save 300 10     # 300 秒内至少 10 个键被修改
save 60 10000   # 60 秒内至少 10000 个键被修改

# 手动触发
redis-cli BGSAVE
redis-cli SAVE
```

### 5.2 AOF 持久化

```bash
# AOF 是日志追加方式
# 配置
appendonly yes
appendfilename "appendonly.aof"
appendfsync everysec

# 重写 AOF
redis-cli BGREWRITEAOF
```

### 5.3 混合持久化

```bash
# Redis 4.0+ 支持混合持久化
aof-use-rdb-preamble yes
```

## 6. 主从复制

### 6.1 配置主从

```bash
# 从节点配置
replicaof 192.168.1.100 6379
masterauth your_password

# 查看复制状态
redis-cli INFO replication
```

### 6.2 哨兵模式

```bash
# 哨兵配置
# /etc/redis/sentinel.conf
sentinel monitor mymaster 192.168.1.100 6379 2
sentinel auth-pass mymaster your_password
sentinel down-after-milliseconds mymaster 5000
sentinel failover-timeout mymaster 60000

# 启动哨兵
redis-sentinel /etc/redis/sentinel.conf
```

## 7. 集群

### 7.1 创建集群

```bash
# 创建集群目录
mkdir -p /opt/redis-cluster/{7000,7001,7002,7003,7004,7005}

# 配置文件
port 7000
cluster-enabled yes
cluster-config-file nodes.conf
cluster-node-timeout 5000

# 启动节点
redis-server /opt/redis-cluster/7000/redis.conf

# 创建集群
redis-cli --cluster create 127.0.0.1:7000 127.0.0.1:7001 127.0.0.1:7002 127.0.0.1:7003 127.0.0.1:7004 127.0.0.1:7005 --cluster-replicas 1
```

## 8. 性能优化

### 8.1 内存优化

```bash
# 设置最大内存
maxmemory 256mb

# 内存淘汰策略
maxmemory-policy allkeys-lru

# 使用哈希压缩
hash-max-ziplist-entries 128
hash-max-ziplist-value 64
```

### 8.2 连接优化

```bash
# 设置最大连接数
maxclients 10000

# 设置超时时间
timeout 300

# 使用连接池
```

## 9. 监控

### 9.1 信息查看

```bash
# 查看服务器信息
redis-cli INFO

# 查看内存信息
redis-cli INFO memory

# 查看客户端信息
redis-cli INFO clients

# 查看复制信息
redis-cli INFO replication
```

### 9.2 慢查询日志

```bash
# 配置慢查询日志
slowlog-log-slower-than 10000
slowlog-max-len 128

# 查看慢查询日志
redis-cli SLOWLOG GET 10
```

## 10. 实战案例

### 10.1 缓存配置

```bash
# 使用 Redis 作为缓存
# 设置缓存过期时间
SETEX cache:key 3600 "cached_value"

# 使用哈希缓存对象
HSET user:1 name "John"
HSET user:1 age 30
EXPIRE user:1 3600
```

### 10.2 会话存储

```bash
# 使用 Redis 存储会话
# 设置会话
SETEX session:abc123 1800 '{"user_id": 1, "username": "john"}'

# 获取会话
GET session:abc123

# 删除会话
DEL session:abc123
```

### 10.3 消息队列

```bash
# 使用列表实现简单消息队列
# 生产者
LPUSH queue "message1"
LPUSH queue "message2"

# 消费者
BRPOP queue 0
```

## 参考资料

- Redis 官方文档 — [redis.io/documentation](https://redis.io/documentation)
- Redis 命令参考 — [redis.io/commands](https://redis.io/commands)
- Redis 配置参考 — [redis.io/docs/management/config](https://redis.io/docs/management/config)