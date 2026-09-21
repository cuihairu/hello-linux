# Docker

Docker 是容器化技术的事实标准，将应用及其依赖打包成轻量级、可移植的容器。

> 内容参考自 Docker 官方文档和实际运维经验，见文末参考资料。

## 学习目标

- 理解容器与虚拟机的区别
- 掌握 Docker 安装、镜像和容器管理
- 学会 Dockerfile 编写和多阶段构建
- 掌握 Docker Compose 编排多容器应用
- 了解生产环境最佳实践

## 1. 容器基础

### 1.1 容器 vs 虚拟机

```
虚拟机                              容器
┌─────────┐ ┌─────────┐          ┌─────────┐ ┌─────────┐
│  App A  │ │  App B  │          │  App A  │ │  App B  │
├─────────┤ ├─────────┤          ├─────────┤ ├─────────┤
│ Guest OS│ │ Guest OS│          │  依赖库  │ │  依赖库  │
├─────────┴─┴─────────┤          ├─────────┴─┴─────────┤
│      Hypervisor      │          │     Docker Engine    │
├──────────────────────┤          ├──────────────────────┤
│      Host OS         │          │      Host OS         │
└──────────────────────┘          └──────────────────────┘
```

| 特性 | 虚拟机 | 容器 |
|------|--------|------|
| 启动时间 | 分钟级 | 秒级 |
| 资源占用 | 高（完整 OS） | 低（共享内核） |
| 隔离性 | 强 | 较强 |
| 镜像大小 | GB 级 | MB 级 |
| 性能 | 有损耗 | 接近原生 |

### 1.2 Docker 架构

```
┌─────────────────────────────────────────┐
│              Docker Client               │
│         (docker CLI / API)               │
├─────────────────────────────────────────┤
│            Docker Daemon                 │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │ Images  │ │Container│ │Networks │   │
│  └─────────┘ └─────────┘ └─────────┘   │
├─────────────────────────────────────────┤
│           Host OS (Linux Kernel)         │
│    (namespaces, cgroups, union fs)       │
└─────────────────────────────────────────┘
```

## 2. 安装

### 2.1 Debian/Ubuntu

```bash
# 卸载旧版本
sudo apt remove docker docker-engine docker.io containerd runc

# 安装依赖
sudo apt update
sudo apt install ca-certificates curl gnupg

# 添加 Docker GPG 密钥
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# 添加仓库
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 安装 Docker
sudo apt update
sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 将当前用户添加到 docker 组
sudo usermod -aG docker $USER
newgrp docker

# 验证安装
docker --version
docker run hello-world
```

### 2.2 RHEL/CentOS/Fedora

```bash
# Fedora
sudo dnf install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# CentOS/RHEL
sudo dnf install yum-utils
sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 启动并设置开机自启
sudo systemctl start docker
sudo systemctl enable docker

# 将当前用户添加到 docker 组
sudo usermod -aG docker $USER
```

## 3. 镜像管理

### 3.1 镜像操作

```bash
# 搜索镜像
docker search nginx

# 拉取镜像
docker pull nginx:latest
docker pull nginx:1.24         # 指定版本
docker pull mysql:8.0

# 查看本地镜像
docker images
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}"

# 删除镜像
docker rmi nginx:latest

# 删除所有未使用的镜像
docker image prune -a

# 导出镜像
docker save nginx:latest > nginx.tar

# 导入镜像
docker load < nginx.tar
```

### 3.2 镜像仓库

```bash
# 登录 Docker Hub
docker login

# 推送镜像
docker tag myapp:1.0 username/myapp:1.0
docker push username/myapp:1.0

# 拉取私有仓库镜像
docker pull registry.example.com/myapp:1.0
```

## 4. 容器管理

### 4.1 容器生命周期

```bash
# 创建并运行容器
docker run -d --name mynginx -p 80:80 nginx

# 参数说明
# -d: 后台运行
# --name: 容器名称
# -p 80:80: 端口映射（主机:容器）
# -v /host/path:/container/path: 挂载卷
# -e VAR=value: 环境变量
# --restart=always: 自动重启

# 查看运行中的容器
docker ps

# 查看所有容器
docker ps -a

# 停止容器
docker stop mynginx

# 启动容器
docker start mynginx

# 重启容器
docker restart mynginx

# 删除容器
docker rm mynginx

# 强制删除运行中的容器
docker rm -f mynginx
```

### 4.2 容器操作

```bash
# 查看容器日志
docker logs mynginx
docker logs -f mynginx            # 实时查看
docker logs --tail 100 mynginx    # 最后 100 行

# 进入容器
docker exec -it mynginx /bin/bash
docker exec -it mynginx sh        # Alpine 镜像

# 在容器中执行命令
docker exec mynginx cat /etc/nginx/nginx.conf

# 查看容器详细信息
docker inspect mynginx

# 查看容器资源使用
docker stats
docker stats mynginx

# 从容器复制文件
docker cp mynginx:/etc/nginx/nginx.conf ./nginx.conf

# 复制文件到容器
docker cp ./index.html mynginx:/usr/share/nginx/html/
```

### 4.3 数据持久化

```bash
# 使用绑定挂载
docker run -d -v /host/html:/usr/share/nginx/html nginx

# 使用 Docker Volume
docker volume create mydata
docker run -d -v mydata:/var/lib/mysql mysql

# 查看 Volume
docker volume ls
docker volume inspect mydata

# 删除 Volume
docker volume rm mydata
```

## 5. Dockerfile

### 5.1 基本语法

```dockerfile
# 基础镜像
FROM ubuntu:22.04

# 维护者信息
LABEL maintainer="admin@example.com"

# 设置环境变量
ENV DEBIAN_FRONTEND=noninteractive

# 安装依赖
RUN apt-get update && apt-get install -y \
    nginx \
    php-fpm \
    && rm -rf /var/lib/apt/lists/*

# 复制文件
COPY nginx.conf /etc/nginx/nginx.conf
COPY html/ /var/www/html/

# 设置工作目录
WORKDIR /var/www/html

# 暴露端口
EXPOSE 80

# 启动命令
CMD ["nginx", "-g", "daemon off;"]
```

### 5.2 多阶段构建

```dockerfile
# 构建阶段
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# 生产阶段
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### 5.3 最佳实践

```dockerfile
# 使用官方基础镜像
FROM node:18-alpine

# 使用非 root 用户
RUN addgroup -g 1001 -S appgroup
RUN adduser -u 1001 -S appuser -G appgroup

WORKDIR /app

# 先复制依赖文件（利用缓存）
COPY package*.json ./
RUN npm ci --only=production

# 再复制源代码
COPY . .

# 使用非 root 用户运行
USER appuser

EXPOSE 3000
CMD ["node", "server.js"]
```

## 6. Docker Compose

### 6.1 基本语法

```yaml
# docker-compose.yml
version: '3.8'

services:
  web:
    build: .
    ports:
      - "80:80"
    environment:
      - NODE_ENV=production
    volumes:
      - ./html:/var/www/html
    depends_on:
      - db
      - redis
    restart: unless-stopped

  db:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: rootpass
      MYSQL_DATABASE: myapp
      MYSQL_USER: appuser
      MYSQL_PASSWORD: apppass
    volumes:
      - db_data:/var/lib/mysql
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    restart: unless-stopped

volumes:
  db_data:
```

### 6.2 常用命令

```bash
# 启动所有服务
docker compose up -d

# 查看服务状态
docker compose ps

# 查看日志
docker compose logs
docker compose logs -f web

# 停止所有服务
docker compose down

# 停止并删除卷
docker compose down -v

# 重新构建并启动
docker compose up -d --build

# 扩展服务
docker compose up -d --scale web=3
```

### 6.3 实战：LNMP 环境

```yaml
version: '3.8'

services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./html:/var/www/html
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - php
    restart: unless-stopped

  php:
    image: php:8.2-fpm-alpine
    volumes:
      - ./html:/var/www/html
    restart: unless-stopped

  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: rootpass
      MYSQL_DATABASE: wordpress
    volumes:
      - mysql_data:/var/lib/mysql
    restart: unless-stopped

volumes:
  mysql_data:
```

## 7. 生产环境最佳实践

### 7.1 安全加固

```bash
# 1. 使用非 root 用户
USER appuser

# 2. 只读文件系统
docker run --read-only myapp

# 3. 限制资源
docker run --memory=512m --cpus=1 myapp

# 4. 使用 secrets
docker secret create db_password db_password.txt

# 5. 定期更新镜像
docker pull nginx:latest
```

### 7.2 日志管理

```json
// /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

### 7.3 镜像瘦身

```dockerfile
# 使用 Alpine 基础镜像
FROM node:18-alpine

# 合并 RUN 指令
RUN apk add --no-cache python3 make g++ && \
    npm install && \
    apk del python3 make g++

# 使用 .dockerignore
# node_modules
# .git
# *.md
```

## 8. 常见问题

### 8.1 容器无法启动

```bash
# 查看容器日志
docker logs mycontainer

# 查看容器详细信息
docker inspect mycontainer

# 检查端口冲突
ss -tlnp | grep 80
```

### 8.2 磁盘空间不足

```bash
# 查看 Docker 磁盘使用
docker system df

# 清理未使用的资源
docker system prune -a

# 清理构建缓存
docker builder prune
```

### 8.3 网络问题

```bash
# 查看网络
docker network ls

# 创建网络
docker network create mynet

# 连接网络
docker network connect mynet mycontainer

# 断开网络
docker network disconnect mynet mycontainer
```

## 参考资料

- Docker 官方文档 — [docs.docker.com](https://docs.docker.com/)
- Docker Hub — [hub.docker.com](https://hub.docker.com/)
- Docker Compose 文档 — [docs.docker.com/compose](https://docs.docker.com/compose/)
- Dockerfile 最佳实践 — [docs.docker.com/develop/develop-images/dockerfile_best-practices](https://docs.docker.com/develop/develop-images/dockerfile_best-practices/)
