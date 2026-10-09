# CI/CD 与持续交付

把变更送上服务器的老办法是 SSH 登进去改：手敲命令、复制文件、重启服务。这台机器多了这套手动步骤，第二台机器就会多出另一套，第三台开始谁也说不清线上到底跑着什么。CI/CD 把「变更」本身变成一条可重复的流水线：代码进仓库就自动构建、自动测试，通过后按既定策略发布——同样的输入永远得到同样的结果，每一步有日志，出错能回滚。本页讲流水线的解剖结构、三种主流平台的取舍、交付物的两种形态与部署策略的选择，以及 secrets 管理这条红线。

> 内容参考自 GitHub Actions、GitLab CI 与 Jenkins 官方文档（入口 2026-10-10 实测可达），见文末参考资料。

## 学习目标

- 说清 CI 与 CD 的分界：集成验证、可发布、自动上线各自指什么
- 三种主流平台的定义文件与 runner 模型，知道什么规模选什么
- 读懂并写出一份最小可用的流水线定义
- 区分制品与镜像两种交付物，理解不可变部署的思想
- 给部署策略做选择，为 secrets 立下不进仓库的规矩

## 1. 两个词的分界

**CI（持续集成）**：每次推送都自动构建并跑测试，问题在合并前暴露，分支存活时间被压短。**CD（持续交付）**：构建产物随时处于可发布状态，发布动作按需触发；再往前一步是持续部署——通过全部检查后自动上线，无人值守。多数团队的落点是「CI 全自动 + 交付半自动」，最后那一下上不上线留给人的判断。

手工部署的四个固有问题依次被流水线消化：步骤靠人记（流水线定义即文档）、结果不可重复（环境由定义文件描述）、过程不可审计（每次运行留完整日志）、回滚靠记忆（制品有版本，回滚是选版本号）。

## 2. 三种主流平台

| 维度 | GitHub Actions | GitLab CI | Jenkins |
|------|---------------|-----------|---------|
| 定义文件 | `.github/workflows/*.yml` | `.gitlab-ci.yml` | `Jenkinsfile` |
| 执行模型 | 托管 runner 或自托管 runner | 平台自带或自装 gitlab-runner | 独立服务，controller 加 agent |
| 与代码托管的关系 | 与 GitHub 深度一体 | 与 GitLab 一体 | 独立于托管平台 |
| 托管 SaaS | GitHub 提供 | gitlab.com 提供 | 需自建 |
| 适合场景 | 代码在 GitHub、中小团队 | 自托管 GitLab 已在用 | 存量流程复杂、插件生态依赖重 |

选型一句话：代码托管在哪，流水线就先看哪家的内置方案——集成成本最低；托管平台满足不了（内网构建机、特殊硬件、合规要求）再自建 runner，这不需要换平台；Jenkins 的价值在存量，新项目起 Jenkins 已经很少见。自托管 Git 生态里 Gitea 也兼容 Actions 语义（兼容程度随版本核实），小团队可以一并考虑。

## 3. 流水线解剖

一份 GitHub Actions 定义，覆盖「推送即检查」的最小闭环：

```yaml
# .github/workflows/ci.yml
name: ci
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: shellcheck scripts/*.sh        # 静态检查
      - run: pytest tests/ -q               # 单元测试
      - run: make build                     # 构建产物
      - uses: actions/upload-artifact@v4
        with:
          name: demo-app
          path: dist/
```

结构三层：`on` 定触发（push、PR、定时 cron、tag），`jobs` 定并行单元，`steps` 定串行动作。GitLab 的对应写法更扁平——`.gitlab-ci.yml` 里每个顶层块是一个 job，`stages: [test, build, deploy]` 声明执行阶段，同 stage 并行、跨 stage 串行，`rules`/`only` 控触发。两家的动词不同，骨架一致：触发条件 → 检查与测试 → 产出带版本的交付物。

流水线必须快。测试超过十分钟没人愿意推小步提交，团队行为随之退化成攒大提交——把最慢的检查挪到合并前、把其余留到合并后，比单纯加机器更有效。

## 4. 制品与镜像

交付物两种形态，对应两种部署思想：

**制品（artifact）**：构建输出的软件包或二进制——tar 包、jar、编译好的二进制。部署 = 把制品送上目标机，配上 systemd 单元。适合单机或少量的传统部署。

**容器镜像**：制品加上它需要的整个用户态环境，打成一个不可变单元。部署 = 拉镜像、起新容器、切流量。环境差异被镜像吸收，「在我机器上是好的」这类问题失去了土壤。

两种形态共享同一条纪律：**交付物带版本**。镜像 tag 用 git tag 或 commit 短哈希，不用 `latest`——`latest` 在回滚时是个赌注，`demo-app:20261010-a1b2c3d` 才是可指认的坐标。不可变部署的思想由此而来：服务器上不手动改任何文件，要变更就走一次新的构建与部署，旧版本镜像留着，回滚只是把流量切回去。

## 5. 部署策略

| 策略 | 动作 | 回滚 | 适用 |
|------|------|------|------|
| 原地更新 | 停服务、换文件、`systemctl restart` | 换回旧制品再重启 | 单机、允许分钟级中断 |
| 滚动更新 | 逐台或逐实例换，健康检查通过再下一台 | 逐台退回 | 多实例、无状态服务 |
| 蓝绿 | 两套完整环境，流量整体切换 | 切回旧环境 | 中断成本高、资源买得起 |
| 金丝雀 | 小流量先跑新版本，观察指标再放量 | 切流量即回滚 | 流量大、可观测性成熟 |

规模与回滚成本的权衡贯穿全表：单机原地更新最省事，前提是接受停机窗口；多实例无状态服务上滚动更新是默认答案；蓝绿与金丝雀买的是「回滚秒级」，花的钱与复杂度也随之上升。无论哪种，部署的终点都该落在 systemd 单元上——[systemd 服务与程序管理](../system-management/services-systemd.md)页的单元语义、`systemctl` 状态查询与 journal 日志，就是流水线落地之后的服务治理面。原地更新在 systemd 语境下的最小形态：`/opt/demo-app` 下按版本放目录，`current` 符号链接指版本，`ExecStart=/opt/demo-app/current/bin/demo-app`，回滚 = 改链接 + restart。

## 6. Secrets 红线

数据库口令、API 密钥、证书私钥——统称 secrets，规矩只有一条：**不进代码仓库**，私有仓库也不行。仓库历史是持久的，今天删掉明天还在历史里；仓库访问权迟早要给协作者与 CI 系统。

三层的替代方案按优先级排：CI 平台的 secrets 机制（GitHub 的 repository secrets、GitLab 的 CI/CD variables）作为第一层，注入为环境变量，平台负责掩码日志输出；有专门设施就用 Vault 这类 secret 管理器，支持轮换与审计；最不济也是部署时从受控存储拉取，落盘权限收到 600。补充两条：同一 secret 按环境拆分（dev 与 prod 永远不同值，防止测试脚本误连生产）；泄露后的处置是**轮换**而不是删提交——旧值当成已泄露处理，换新值才是止损。

## 7. 常见故障

**流水线全绿，上线就坏。** 流水线环境与生产环境不一致：依赖版本、系统库、配置值都可能是裂缝。缓解靠环境分层（CI 里跑测试、staging 里跑部署演练）与容器化（镜像把环境带过去），根因是环境漂移，不是测试没写够。

**runner 磁盘满。** 缓存、旧镜像、历史制品长期堆积。自托管 runner 定期清理构建目录与 dangling 镜像，平台侧配置制品保留期——保留 90 份没有意义的构建只会换来回滚时找不到可用制品的另一种尴尬。

**secrets 出现在日志里。** 程序把环境变量全量打印、错误栈带连接串。构建前用 `grep -r` 对敏感变量名做一次流水线自检，平台的掩码机制只挡已知值，挡不住自定义格式化输出。

**并发部署互踩。** 两个分支同时触发部署，half-old-half-new 的状态比全旧更难查。平台都有并发控制（GitHub 的 concurrency group、GitLab 的 resource_group），同一目标的部署排队执行。

**回滚没有预案。** 出事时才发现旧制品没归档、数据库迁移不可逆。回滚能力是设计出来的：制品按版本保留、数据库变更向后兼容（先扩后删）、演练过一次才算数。

## 与其它页的分工

变更落地后的机器状态管理（批量装包、改配置）是 [自动化运维](../system-management/automation.md)的领地——Ansible 描述的是「机器应该是什么样」，CI/CD 描述的是「变更如何被重复验证与发布」，两者互补而非竞争。容器镜像的构建细节见[容器](./container/docker.md)；部署通道的 SSH 配置见[SSH 远程登录](./ssh.md)；交付后的服务治理与日志见[systemd 服务与程序管理](../system-management/services-systemd.md)；上线后的指标观察接[监控](./monitoring/prometheus.md)。应用场景一节的运维自动化阅读路径给出了这几页的推荐顺序。

## 参考资料

- GitHub Actions 文档 — [docs.github.com/actions](https://docs.github.com/actions)
- GitLab CI/CD 文档 — [docs.gitlab.com/ci/](https://docs.gitlab.com/ci/)
- Jenkins 用户文档 — [jenkins.io/doc/](https://www.jenkins.io/doc/)
- UNIX and Linux System Administration Handbook 第 5 版第 26 章（Continuous Integration and Delivery） — [admin.com](https://www.admin.com/)
- man 手册 — man systemd.unit、man systemctl
