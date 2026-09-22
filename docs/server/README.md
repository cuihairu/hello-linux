# 服务器篇

Linux 服务器搭建和运维，涵盖 Web、数据库、容器、监控、DNS、邮件等核心服务。

> 内容参考自鸟哥的私房菜、Arch Wiki 和各服务官方文档，见各章节参考资料。

## 内容

| 章节 | 内容 |
|------|------|
| [Web 服务器](./web/nginx.md) | Nginx、Apache 安装配置、反向代理、HTTPS |
| [Apache](./web/apache.md) | Apache HTTP Server 详细配置 |
| [数据库](./database/mysql.md) | MySQL 安装配置、备份恢复 |
| [Redis](./redis.md) | Redis 安装配置、数据结构、持久化、集群 |
| [FTP](./ftp.md) | vsftpd 安装配置、用户管理、安全设置 |
| [容器](./container/docker.md) | Docker 安装、镜像管理、Compose、K8s 入门 |
| [监控](./monitoring/prometheus.md) | Prometheus + Grafana 监控方案 |
| [DNS](./dns/bind.md) | BIND DNS 服务器配置 |
| [邮件](./mail/postfix.md) | Postfix 邮件服务器配置 |

## 行业推荐方案

| 场景 | 推荐方案 |
|------|---------|
| 个人博客 | Nginx + MySQL + WordPress |
| 企业官网 | Nginx + MariaDB + Docker |
| 电商系统 | Nginx + MySQL 主从 + Redis + Docker |
| 缓存加速 | Redis + Memcached |
| 文件存储 | FTP + NFS + 对象存储 |
| 开发测试 | Docker Compose 一键部署 |
| 微服务 | Kubernetes + Prometheus + Grafana |

## 参考资料

- [鸟哥的私房菜 - 服务器篇](https://linux.vbird.org/linux_server/)
- [Nginx 官方文档](https://nginx.org/en/docs/)
- [MySQL 官方文档](https://dev.mysql.com/doc/)
- [Docker 官方文档](https://docs.docker.com/)
- [Prometheus 官方文档](https://prometheus.io/docs/)
