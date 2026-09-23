# Docker

Docker 是容器化技术的事实标准：它把应用代码、运行时与依赖库打包成一个标准化的"镜像"，在任何装了 Docker 引擎的 Linux 上都能以相同方式启动。要回答"为什么需要容器"，先看两个反复上演的场景——开发说"在我机器上是好的"，一上线就崩，因为生产是另一套库版本；运维想把一台大服务器上的十几个服务拆开，虚拟机方案每台要几 GB 内存、启动按分钟计，资源开销根本批不下来。容器给出的答案是：**不复制操作系统，只隔离进程的视图**。所有容器共享宿主机内核，各自的文件系统由镜像提供，启动是秒级、镜像是 MB 级——这正是它介于"裸机部署"和"完整虚拟机"之间的生态位。本页按"为什么 → 镜像与分层（含与包管理器的对照）→ 日常操作 → Compose 场景 → 与 systemd 的关系 → 常见坑"展开，安装部分给出 Debian/Ubuntu（apt）、Arch（pacman）、RHEL/CentOS/Rocky（dnf）三系对照；主机防火墙如何放行容器端口不在本页展开，见[防火墙篇](../../security/firewall.md)。

> 内容参考自 Docker 官方文档与 Arch Wiki，见文末参考资料。

## 学习目标

- 说清容器与虚拟机的边界，理解 namespaces/cgroups/联合文件系统各解决什么问题
- 掌握三发行版安装（apt / pacman / dnf），理解镜像分层与包管理器的异同
- 熟练完成镜像、容器、数据卷的日常操作，并读懂真实终端输出
- 会写 Dockerfile、用 Compose 编排多服务，知道 Compose 与 systemd 的职责分界
- 排查端口冲突、磁盘打满、重启策略失效等高频故障

## 1. 容器为什么存在

### 1.1 与虚拟机的本质区别

虚拟机通过 Hypervisor 模拟出一整台机器，每个 VM 内跑自己的内核与用户态，隔离最彻底，代价是 GB 级镜像与分钟级启动。容器把"用户态"打包、"内核"共享：镜像只含发行版用户空间与应用，启动时不过是拉起一个（或一组）受限制的进程。Linux 内核的三块能力拼出了这个模型——**namespaces** 隔离视图（每个容器以为自己有独立的进程树、网络、挂载点），**cgroups** 限制用量（CPU、内存配额，防止单容器吃光宿主机），**联合文件系统**（overlay2 等）把只读镜像层与可写层叠成一个完整根目录。

| 特性 | 虚拟机 | 容器 |
|------|--------|------|
| 启动时间 | 分钟级 | 秒级 |
| 资源占用 | 高（完整 OS） | 低（共享内核） |
| 隔离性 | 强（独立内核） | 较强（同内核，共享 syscall 面） |
| 镜像大小 | GB 级 | MB～百 MB 级 |
| 性能 | 有虚拟化损耗 | 接近原生 |

需要强隔离的异构负载、要跑不同内核的场景，虚拟机仍不可替代；同宿主机上密集部署同构服务，容器是更经济的选择。两者也常组合使用：先用虚拟机切物理机，再在 VM 里用容器提高密度。选型时问自己两个问题就够——是否需要独立内核（需要则 VM），是否接受共享内核带来的攻击面（接受则容器，再叠加非 root、只读根系统等加固）。也别把"容器 = 更安全"当成口号：容器缩小了部署单元，但共享内核意味着逃逸面仍然存在，安全结论要回到刚才两个问题上做权衡。

### 1.2 镜像分层：与 pacman/apt 装包的对照

理解 Docker 最关键的一步，是把它和你已经熟悉的包管理器对照着看。Arch 用户用 `pacman -S nginx` 安装 Nginx 时，包管理器把文件**直接铺进系统根文件系统**的 `/usr`、`/etc`——这些改动立刻影响当前系统，卸载靠数据库记账回滚；`pacman -Ql nginx` 能列出装了哪些文件，`pacman -Syu` 升级会原地替换旧文件。Docker 镜像则是**分层的只读快照**：Dockerfile 里每条 `RUN`/`COPY` 生成一层，层与层叠加上面再盖一个可写层，共同构成容器看到的根目录。

```text
┌─────────────────────────┐
│  可写层（容器运行时改动）  │  ← docker exec 进去改的文件落在这里
├─────────────────────────┤
│  层 N：COPY app /app     │  ← 只读
├─────────────────────────┤
│  层 N-1：RUN npm ci      │  ← 只读，有缓存
├─────────────────────────┤
│  基础镜像 node:20-alpine │  ← 只读，类似"发行版 base 组"
└─────────────────────────┘
```

三条由此推出的实战结论：**其一**，层是不可变的，`docker exec` 里 `apt install`/`pacman -S` 改出来的东西只活在可写层，容器删了就没——所以临时调试无妨，固化配置必须写进 Dockerfile；**其二**，构建时只要某条指令及其之前的内容没变，该层及以下全部命中缓存直接复用，这与包管理器"已满足依赖就跳过下载"是同一种省功哲学，因此 Dockerfile 惯例是把不常变的 `COPY package.json`、依赖安装放在源码 `COPY` 之前；**其三**，多镜像可共享同一基础层，就像多台 Arch 机器共享同一组 pacman 包缓存——`docker images` 里显示的 Size 远小于各镜像体积之和，原因就是去重共享。清理逻辑也能对上：`pacman -Sc` 清理不再需要的包缓存，`docker system prune` 清理悬空镜像与停止的容器，二者都是"回收构建副产品"，动手前都应确认没有在用对象。再往下追一层：`pacman` 管的是"一台机器上系统软件的状态"，镜像管的是"一份可任意复制的文件系统快照"——前者追求唯一真相源，后者追求处处一致，理解这个差别就不会再把 `pacman -Syu` 和 `docker pull` 混为一谈。分层带来的另一个实际收益是分发效率：内网里只需同步变化的层，正如升级时 `pacman` 也只下载有差异的包，全量重传在两种模型里都是要避免的浪费。把这三点刻进肌肉记忆，Dockerfile 的写法与排错思路会自然变得顺手。

### 1.3 Docker 架构

```text
docker CLI ──(REST API /var/run/docker.sock)──▶ dockerd 守护进程
                                                 ├─ 镜像存储（content-addressed）
                                                 ├─ 容器运行时（runc/containerd）
                                                 └─ 网络（bridge/host/…）
```

`docker` 命令只是客户端，真正的重活由 `dockerd` 完成。理解这点才能解释后面的常见问题：为什么 `docker ps` 报 `Cannot connect to the Docker daemon`——是守护进程没跑或当前用户没权限访问 socket，与镜像本身无关。CLI 与守护进程分离还带来一个实用推论：远程机器上的 Docker 可以通过指定 `DOCKER_HOST` 或配置 TLS 证书来管理，本页默认讨论最常见的"本机 CLI + 本机守护进程"形态。守护进程自身的崩溃恢复交给 systemd（`Restart=on-failure` 随包默认），这与后续"容器要不要 restart 策略"是两个层次的问题，别混在一个配置里改。三发行版在这一层完全一致：不管包来自 apt、pacman 还是 dnf，unit 名都叫 `docker.service`，运维脚本可以原样复用。

## 2. 安装（三发行版对照）

| 操作 | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| 安装 | `apt install docker-ce …`（官方源） | `sudo pacman -S docker docker-compose` | `dnf install docker-ce …`（官方源） |
| 搜索 | `apt search docker` | `pacman -Ss docker` | `dnf search docker` |
| 查看包信息 | `apt show docker-ce` | `pacman -Qi docker` | `dnf info docker-ce` |
| 查看文件列表 | `dpkg -L docker-ce` | `pacman -Ql docker` | `rpm -ql docker-ce` |
| 升级 | `apt upgrade` | `sudo pacman -Syu` | `dnf upgrade` |
| 卸载 | `apt remove docker-ce` | `sudo pacman -R docker` | `dnf remove docker-ce` |

说明两点：Debian/Ubuntu 与 RHEL 系的 Docker CE 均来自 Docker 官方仓库（发行版自带源里的版本通常滞后），Arch 则直接在官方 extra 仓库，`pacman -S docker` 一步到位——这也是三系里安装路径最短的一支，`pacman -Syu` 后即可 `systemctl enable --now docker`。Arch 的 Compose 独立包叫 `docker-compose`（`pacman -S docker-compose`，提供 `docker-compose` 命令）；Debian/RHEL 官方源装的 `docker-compose-plugin` 提供的是 `docker compose` 子命令——两者语法同为 Compose 规范，按你装到的入口选用即可。RHEL 系另注：Red Hat 官方主推无守护进程的 Podman，与 Docker CLI 高度兼容；本页聚焦 Docker，若你的规范允许 Podman，`dnf install podman` 是仓库内一等公民方案。

### 2.1 Debian/Ubuntu（官方仓库）

```bash
$ sudo apt update
$ curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
$ echo "deb [signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
$(. /etc/os-release && echo $VERSION_CODENAME) stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
$ sudo apt update && sudo apt install docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
```

GPG 密钥与专用 `sources.list.d` 条目的目的只有一个：让 apt 校验包签名，确保装到的二进制确实来自 Docker 官方。发行版自带源里的 `docker.io` 包版本通常滞后数月，生产环境一般直接用官方源。

### 2.2 Arch

```bash
$ sudo pacman -Syu docker docker-compose
resolving dependencies...
Packages (5) containerd-2.0.x  docker-27.x.x  docker-compose-2.x.x
             libseccomp-2.5.x  runc-1.2.x

Total Download Size:   85.42 MiB
:: Proceed with installation? [Y/n] y
(5/5) installing docker                             [######################] 100%
$ sudo systemctl enable --now docker
$ docker --version
Docker version 27.x.x, build abcdef1
```

Arch 上 `pacman -S docker` 会连同 `containerd`、`runc` 一起拉入（Docker 的运行时依赖），无需添加任何第三方源；`docker-compose` 作为独立包按需安装。日常升级保持 `pacman -Syu` 整体滚动，Docker 引擎与 CLI、containerd 版本由同一仓库保证匹配——手搓二进制混搭版本是自制发行版的做法，不适用于 Arch。

### 2.3 RHEL/CentOS/Rocky（官方仓库）

```bash
$ sudo yum-config-manager --add-repo \
    https://download.docker.com/linux/centos/docker-ce.repo
$ sudo dnf install docker-ce docker-ce-cli containerd.io docker-buildx-plugin
$ sudo systemctl enable --now docker
```

`yum-config-manager` 只是把 Docker 的官方 repo 文件写进 `/etc/yum.repos.d/`，之后 `dnf` 的解析、签名验证与升级都走正常通道。Rocky/CentOS 上若之前装过发行版自带的 `podman`/`docker` 兼容包，先卸载避免文件冲突，再装 Docker CE。

### 2.4 验证与用户组

三系安装完的验收动作完全相同——只是前面的包管理器换成了 apt、pacman 或 dnf：

```bash
$ sudo systemctl status docker
● docker.service - Docker Application Container Engine
   Active: active (running) since Tue 2026-09-22 09:14:02 CST
$ sudo usermod -aG docker $USER    # 重新登录后生效
$ docker run hello-world
Hello from Docker!
```

`Hello from Docker!` 出现即全链路（客户端→守护进程→拉镜像→建容器→跑进程）打通。把用户加入 `docker` 组等价于授予 root 权限（守护进程以 root 运行、可挂载宿主机任意路径），仅对确需免 sudo 的受信账号开启；`newgrp docker` 可免重新登录立即生效。

## 3. 镜像与容器日常

```bash
# 镜像：拉取、列表、离线转移
$ docker pull nginx:1.27
$ docker images
REPOSITORY   TAG       IMAGE ID       SIZE
nginx        1.27      605c77e624dd   187MB
$ docker save nginx:1.27 -o nginx.tar && docker load -i nginx.tar

# 容器：生命周期与观察
$ docker run -d --name web -p 8080:80 --restart unless-stopped nginx
$ docker ps
CONTAINER ID   IMAGE   STATUS         PORTS                  NAMES
b3f1c2d4e5a6   nginx   Up 2 minutes   0.0.0.0:8080->80/tcp   web
$ docker logs --tail 20 web
$ docker exec -it web sh              # Alpine 基底用 sh，Debian 基底可用 bash
$ docker stats --no-stream
$ docker rm -f web
```

`-p 8080:80` 的含义是"宿主机 8080 → 容器 80"，写反是新手第一坑；端口只写了容器侧（`-p 80`）则由 Docker 随机映射到宿主机高位端口——测试可以用，生产必须写死宿主机端口，否则每次重建都变，下游配置全要跟着改。`--restart unless-stopped` 让容器在守护进程重启、宿主机重启后自动拉起（详见第 6 节与 systemd 的分工）。`docker save`/`load` 则是内网隔离环境的标配动作——生产机不通外网时，在有网机器拉好镜像打成 tar 搬运，等价于离线拷一个 pacman 缓存包目录（Arch 的 `/var/cache/pacman/pkg` 同样是为离线与回滚准备的）。镜像固定 tag 而不是 `latest` 也是同理：可预期的升级才是升级，`latest` 每次 pull 都可能给你惊喜，回滚时才发现上一版早已不在。

### 3.1 数据持久化

容器文件系统随容器销毁而消失，两类持久化各司其职：**绑定挂载**把宿主机路径直接映射进容器，适合配置文件与代码热更新（改宿主机文件立即生效）；**数据卷**由 Docker 管理目录，适合数据库数据（权限、备份路径统一受控）。判断口诀：人要直接编辑的用 bind mount，机器读写且要求生命周期独立于容器的用 volume——数据库数据文件永远选后者，否则 `docker rm` 会连数据一起带走。

```bash
$ docker volume create mysql-data
$ docker run -d --name db -v mysql-data:/var/lib/mysql \
    -e MYSQL_ROOT_PASSWORD=secret mysql:8.0
$ docker volume ls
$ docker run -v /opt/webhtml:/usr/share/nginx/html:ro nginx   # :ro 容器内只读
```

`:ro` 是常被忽略的最小加固：只读内容就不给写权限，防容器被攻破后篡改静态资源。持久化与日志同理，都遵循"容器是易耗品、数据与日志要活在容器外"的原则——理解了这一点，卷、bind mount、日志限额就不再是三个孤立配置，而是同一条工程纪律的三个落点。备份策略也顺势清晰：数据卷用常规文件备份工具从宿主机的 volume 目录拷走，bind mount 直接备份宿主机路径，都不需要"进容器"备份。

## 4. Dockerfile 要点

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev          # 依赖层稳定，命中缓存
COPY . .
RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app
USER app                       # 非 root 运行
EXPOSE 3000
CMD ["node", "server.js"]
```

三条被反复验证的实践：**先 COPY 依赖清单再 COPY 源码**，源码改一行不会重跑依赖安装；**`npm ci` 而非 `npm install`**（按 lock 文件精确安装，构建可复现，各语言生态的等价物是 `pip install -r`、`go mod download`——镜像构建的可复现性靠 lockfile，不靠宿主机的系统包管理器）；**USER 切换非 root**，与宿主机上不用 root 跑服务是同一条纪律。顺带一提，镜像里那句 `apk add`/`apt-get install` 只影响本镜像层，绝不会动到宿主机的 pacman/apt 数据库——这正是"容器把包管理关进笼子"的含义，也是它敢于在生产机上同时跑多套栈的前提：宿主机的 `pacman -Q` 清单与镜像内的包列表是两套互不干扰的世界，升级谁都不影响另一个的可复现性。多阶段构建则把编译器留在前一阶段，最终镜像只 `COPY --from=builder` 产物，体积常从 GB 级降到几十 MB，运行时也不再携带编译器与源码——攻击面与磁盘占用同时下降。镜像体积减半往往意味着拉取时间减半，这在弹性扩容场景里直接换算成冷启动速度：

```dockerfile
FROM golang:1.22 AS builder
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -o /out/app ./cmd/app

FROM alpine:3.20
COPY --from=builder /out/app /usr/local/bin/app
USER nobody
CMD ["/usr/local/bin/app"]
```

`FROM alpine` 换成目标发行版的精简镜像即可；若团队内部用 `pacman` 维护基础环境，也可以先用 Arch 基底镜像 `pacman -Syu` 打好依赖层再往上叠应用层——只要该层稳定，后续构建永远命中缓存。`.dockerignore` 与 `.gitignore` 同理：`node_modules`、`.git` 不进上下文，构建更快也更安全（避免密钥被 `COPY . .` 误打进镜像）。构建产物体积不是越小越好——牺牲必要的调试符号、健康检查工具去换几 MB，排障时会加倍奉还；在"够用且可维护"与"极致精简"之间取平衡，才是成熟团队的选择。

## 5. Docker Compose：多服务的一页纸编排

单容器用 `docker run` 尚可，一个 Web 应用通常"应用 + 数据库 + 缓存"三件套，手写三个 run 命令还要人肉记依赖顺序——Compose 把整套拓扑写进一个 YAML，`up -d` 一条命令拉起，删掉即清理。版本控制友好也是它被广泛采纳的原因：YAML 进 git，评审拓扑变更与评审代码是同一套流程，环境定义不再散落在某位工程师的 shell 历史里。它最典型的三个适用场景：**本地开发环境一键复现**（新人克隆仓库后 `compose up` 即得与 CI 一致的依赖）、**中小型生产部署的单机编排**（不引入 Kubernetes 的前提下管理多服务）、**可复现的演示与测试夹具**（每次 `down -v && up` 都是干净环境）。

```yaml
# docker-compose.yml
services:
  web:
    build: .
    ports:
      - "8080:80"
    volumes:
      - ./html:/usr/share/nginx/html:ro
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: example
      MYSQL_DATABASE: app
    volumes:
      - db_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      retries: 10
    restart: unless-stopped

volumes:
  db_data:
```

常用命令序列（`down` 与 `down -v` 的一字之差，决定数据库数据卷是否陪葬——写进变更单前请再读一遍）：

```bash
$ docker compose up -d            # 后台创建网络、卷并启动
$ docker compose ps
$ docker compose logs -f web
$ docker compose exec db mysql -u root -p   # 进容器执行一次性命令
$ docker compose pull && docker compose up -d   # 更新镜像并滚动重启
$ docker compose down             # 停止并移除容器（保留数据卷）
$ docker compose down -v          # 连数据卷一起删——生产慎用
```

`version:` 顶层键在新版 Compose 规范中已废弃，可省略。`depends_on` 默认只保证**启动顺序**、不保证"就绪"；数据库进程起来不代表能接受连接，所以上面用了 `condition: service_healthy` 配合 `healthcheck`——这是从"能跑"到"可用"的关键一步，也是排"应用先于数据库就绪而崩溃重启"这类问题的标准解法。健康检查命令应探测"能否提供服务"（如 `mysqladmin ping`、HTTP `GET /health`），而不是"进程在不在"——进程僵死但端口不通的情况，恰恰是 healthcheck 最该抓住的。

另一个 LNMP（Nginx + PHP-FPM + MySQL）式的组合与上例结构相同：共享数据卷挂 PHP 代码，Nginx `depends_on` PHP-FPM，MySQL 用命名卷保数据。想加缓存服务，多声明一个 `redis` 服务并让应用 `depends_on` 即可——Compose 的可组合性正来自"每个服务一份声明、依赖画在图里"。超出单机范围（多节点调度、滚动升级、服务发现）后再评估 Kubernetes；在那之前，Compose 已经覆盖了绝大多数团队的编排需求，不必为了"看起来云原生"提前复杂化。反过来，如果整套应用其实只是一个二进制加一个配置文件，强行拆成三个服务反而是负担——先问"是否真的需要独立伸缩或独立发布"，再决定要不要引入新的服务边界。写完 YAML 记得跑 `docker compose config` 做一次语法展开，能把缩进错误、变量未定义这类低级问题挡在上线之前。

## 6. 与 systemd 的关系

Docker 不是和 systemd 抢活干的另一套 init：`docker.service` 本身就是普通的 systemd 单元，`systemctl enable docker` 负责"开机把守护进程拉起来"（Arch 上安装后同样一条 `systemctl enable --now docker`，与 pacman 装完启用其他服务毫无区别）；容器则是 dockerd 管理的子进程，systemd 默认**看不见**它们。职责分界可以记成三层：

- **引擎层归 systemd**：`dockerd` 的启动、崩溃重启、开机自启，全部由 `docker.service` 决定。引擎没起，一切容器命令都会报连接失败。
- **容器层归 Docker 自己**：单容器用 `--restart=no|always|on-failure|unless-stopped` 表达"引擎还在时你挂了要不要拉起"；`unless-stopped` 与 `always` 的差别在于人工 `docker stop` 过的容器，前者不会在引擎重启时被强行拉回——日常运维更常用它。
- **不要双重管理**：同一个业务，要么交给 Compose/`--restart` 自管，要么写一个 systemd 单元去执行 `docker compose up`（`ExecStop` 对应 `down`），二者只选一条指挥链。常见错误是既给容器 `--restart=always`，又写 systemd `ExecStart=docker run ...`——引擎启动会拉起容器，systemd 再跑一次 `run`，立刻撞名冲突。

`depends_on` 只管 Compose 内部顺序，管不了"引擎尚未就绪"；而 `After=docker.service` + `Requires=docker.service` 是自定义单元等待引擎的标准写法。需要开机自动恢复整套 Compose 应用时，也可直接 `systemctl enable` 对应单元或用 `restart: unless-stopped` + 引擎自启达成同样效果——两条路都通，选定一条写进运维手册即可。同理，监控要么看宿主机上 dockerd 的 systemd 状态，要么通过 cAdvisor/container exporter 看容器指标，别指望 `systemctl status` 能列出容器业务名。容器日志默认走 JSON 文件驱动，生产上应在 `/etc/docker/daemon.json` 限制 `max-size`/`max-file`，否则一个刷日志的应用就能写满宿主机磁盘；把日志并入 journald 或对接[日志篇](../../basic/log.md)的做法见对应章节，防火墙与端口暴露策略仍以[防火墙篇](../../security/firewall.md)为准，本页不重复。一句话总结本节：**systemd 管"引擎活着"，Docker 管"容器活着"，两者通过 restart 策略与 unit 依赖衔接，各管一层才不会互相打架。**

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "live-restore": true
}
```

改完文件用 `dockerd --validate` 或重启前先 `systemctl cat docker` 确认没有覆盖的 drop-in 干扰，JSON 语法错误会让引擎直接拒绝启动——这是改 `daemon.json` 最容易踩的坑，改完务必先验证再重启。三个配置项各管一件事：日志限额防磁盘被打满，`live-restore` 保升级窗口业务不断，缺省的 json-file 驱动则保证 `docker logs` 可用——别为了"精简"随手删掉驱动配置，排障时会想念它的。`live-restore` 开启后，升级或重启 dockerd 时容器继续运行，不会因引擎维护窗口把业务打断——生产建议开启；重启引擎前先确认它已生效，否则"只是升级个引擎"也会把全部容器按停，这正是把引擎层与容器层职责分清楚的实际收益。改坏 `daemon.json` 导致引擎起不来的急救方法：`journalctl -u docker -e` 看解析错误，修正 JSON 后再 `systemctl start docker`——先看日志再动手，能省掉一半的"我什么都没改它就坏了"。这几个参数改完都应走同一套"改前备份、改后验证、验证过再重启"的流程，和改任何关键系统配置没有区别。

## 7. 常见坑

**`Cannot connect to the Docker daemon at unix:///var/run/docker.sock`。** 先 `systemctl is-active docker`；未运行则 `systemctl start docker`。Active 仍报错多为权限：当前用户不在 `docker` 组（`id -nG` 检查），或在 rootless/Podman 环境用了错误的 socket 路径。不要用 `sudo` 掩盖长期配置问题，也不要无脑把所有人塞进 `docker` 组——组权限等于 root，审批口径应与 sudoers 一致。三发行版装完后的组添加命令完全相同，包管理器（apt、pacman、dnf）只负责把二进制和 unit 文件铺到位。组改完记得让用户重新登录（或 `newgrp docker`），否则会继续报同样的错——权限变更不生效的排查，永远先问"会话是不是旧的"。

**端口绑定失败 `port is already allocated`。** `ss -tlnp | grep 8080` 找出占用者——常见是宿主机本就跑了 Nginx/Apache，或上一个容器没删干净。改映射端口（如 `-p 8081:80`）比强杀宿主机服务更安全；Compose 项目间端口冲突则改各自的 `ports` 或用不同宿主机端口段。放行规则本身仍走[防火墙篇](../../security/firewall.md)的统一流程，这里只解决"谁在占端口"。顺带一提：`docker ps` 里 `0.0.0.0:8080` 表示绑定了所有网卡，只想让本机访问应写成 `127.0.0.1:8080:80`——很多"端口暴露到公网"的事故，根因就是少写了这个前缀。

**容器起不来就退出。** `docker logs 容器名` 看应用自己的报错；日志空白时 `docker inspect` 看 `State.OomKilled`——内存超限被 cgroup 杀掉的典型痕迹，用 `--memory` 明确限额并同步调大应用配置。镜像架构不匹配（在 x86 机器拉了 arm64 镜像）会报 `exec format error`，`docker manifest inspect` 可预先核对。Compose 环境下先 `docker compose logs 服务名`，多数"起不来"其实是 healthcheck 一直不过，根因仍指向依赖服务未就绪。另一个隐蔽来源是宿主机内核与镜像的兼容性：极老的内核跑新镜像里的新 glibc 可能直接报错，升级内核或换基于较老用户态的基础镜像即可，这类问题与镜像内容本身无关。

**磁盘被镜像和日志吃满。** 按顺序收敛：`docker system df` 看构成 → `docker image prune -a` 清无引用镜像 → `docker builder prune` 清构建缓存 → 最后才考虑 `docker system prune -a`（会删所有未运行容器与无 tag 镜像，等于重置）。清理策略建议平时只跑不带 `-a` 的 prune，把 `-a` 留给明确的维护窗口。Arch 用户此时也别忘了宿主机侧：`pacman -Sc` 与 `pacman -Scc` 回收包缓存是两层不同缓存，磁盘紧张时两边都要查；Debian 用 `apt clean`，RHEL 用 `dnf clean all`。

**升级后的 API 版本报错。** `client version too new` 类错误说明 CLI 与守护进程版本错位。三系统一对齐即可：Arch 上一条 `pacman -Syu` 同时升级 docker 相关全家桶；Debian/RHEL 用 `apt upgrade docker-ce` / `dnf upgrade docker-ce` 并重启引擎；手搓二进制的环境则回到包管理——`pacman -Ql docker` 这类"文件到底谁提供"的疑问，在包管理器里永远比在 `/usr/local` 里翻找更快得到答案。版本对齐后若业务镜像仍报错，再查镜像构建时用的 API 版本是否高于引擎支持范围，按需重建镜像。把"引擎版本、镜像 tag、Compose 文件"三者当作一组联动的版本号管理，升级事故会少一大半。

**Compose 改了不生效 / 卷权限诡异。** `docker compose up -d` 只对变更的服务重建容器；纯配置文件（非挂载卷）改动要 `docker compose up -d --force-recreate` 或干脆 `down && up`。Bind mount 权限遵循**宿主机 UID**：容器内进程 UID 1000 写宿主机目录，权限按宿主机 1000 核对，`chown` 在宿主机做，不要在容器里做完一删容器就丢。这与系统包管理器管理的权限语义不同——`pacman -Ql` 看到的属主随包安装落盘、重启不变，bind mount 的属主则完全由宿主机目录现状决定，迁移环境前先在宿主机侧对齐属主与权限位。

**`exec format error`、`no space left on device` 却 `df -h` 显示有空间。** 后者常是 inode 耗尽（`df -i`）或 Docker 存储驱动的独立分区满——`docker system df -v` 定位具体是镜像、容器还是卷占的大头。排障时把这两条与"守护进程没起"、"端口冲突"并列成固定检查清单，能覆盖绝大多数报修单；Arch 环境再补一条 `pacman -Qdt` 看孤儿依赖、`df -h /var/lib/docker` 确认存储驱动所在分区，三系各自的检查入口不同，但"先分清元数据、缓存、业务数据哪类占满"的思路一致。

## 8. 生产清单（速查）

上线前逐条打勾：非 root 运行（`USER`）、资源限额（`--memory`/`--cpus`）、日志限额（`daemon.json`）、`--restart` 或 Compose `restart` 已设、镜像固定版本 tag 而非 `latest`、密钥不进镜像（用环境变量注入或 secrets）、`docker system df` 有例行清理任务、防火墙只放行确需的宿主机端口。以上每一条对应的"为什么"都在前文出现过——清单只是把长文压成可执行的最后一步。落地时建议把"镜像固定 tag + 非 root + 日志限额"作为合并代码的检查项，把"磁盘清理 + 版本升级（Debian/RHEL 走 apt/dnf，Arch 走 `pacman -Syu`）"写进例行运维日历；安全基线的更完整清单见[加固篇](../../security/hardening.md)。记住容器安全的边界：镜像里的非 root、只读根、最小依赖管的是"容器被攻破后损失多大"，宿主机的防火墙、补丁与准入控制管的是"会不会被攻破"——两层缺一不可，别指望只做一层就高枕无忧。把清单贴在发布流程里，比把长文收藏进书签有用得多；条目拿不准时回到对应章节重读"为什么"，答案几乎总在那里。最后一句提醒：容器解决的是交付一致性，不解决架构质量——把一团乱麻的单体塞进镜像，它依然是一团乱麻，只是换了个更方便回滚的包装。真正成熟的团队，是让镜像、Compose、systemd 与防火墙规则各自待在版本库里，各司其职，谁也不越界替谁做决定。这也是本页把"为什么"放在每节开头的原因：工具会换，取舍的框架留下。

## 参考资料

- Docker 官方文档 — [docs.docker.com](https://docs.docker.com/)
- Docker Compose 规范 — [docs.docker.com/compose](https://docs.docker.com/compose/)
- Dockerfile 最佳实践 — [docs.docker.com/build/building/best-practices/](https://docs.docker.com/build/building/best-practices/)
- Docker Hub — [hub.docker.com](https://hub.docker.com/)
- Arch Wiki: Docker — [wiki.archlinux.org/title/Docker](https://wiki.archlinux.org/title/Docker)
- containerd 文档 — [containerd.io/docs](https://containerd.io/docs/)
