# Docker

Docker is the de facto standard for containerization: it packs application code, runtime, and dependency libraries into a standardized "image" that starts in the same way on any Linux machine with the Docker engine installed. To answer "why containers", first look at two scenarios that play out repeatedly -- the developer says "it works on my machine" and it crashes in production, because production runs a different set of library versions; operations wants to split a dozen services off a big server, and the VM approach needs several GB of memory per instance with startup measured in minutes, so the resource overhead simply cannot be cut. The answer containers give: **do not copy the operating system, only isolate the process's view**. All containers share the host kernel, each filesystem comes from its image, startup is measured in seconds, and images in megabytes -- exactly the niche between "bare-metal deployment" and "a full virtual machine". This page is organized as "why -> images and layering (including a comparison with package managers) -> day-to-day operations -> Compose scenarios -> the relationship with systemd -> common traps"; the installation section compares Debian/Ubuntu (apt), Arch (pacman), and RHEL/CentOS/Rocky (dnf); opening container ports in the host firewall is covered on the [Firewall](../../security/firewall.md) page instead.

> Content draws on the official Docker documentation and the Arch Wiki; see the references at the end.

## What This Page Covers

- Drawing the boundary between containers and virtual machines
- Installing on the three distros (apt / pacman / dnf)
- Handling day-to-day image, container, and volume operations fluently, and reading real terminal output
- Writing a Dockerfile and orchestrating multiple services with Compose
- Debugging the high-frequency faults: port conflicts, full disks, restart policies not working

## 1. Why Containers Exist

### 1.1 The Essential Difference from Virtual Machines

A virtual machine simulates an entire machine through a hypervisor, running its own kernel and user space inside each VM -- the most thorough isolation, at the cost of gigabyte-scale images and minute-scale startup. A container packages the "user space" and shares the "kernel": the image contains only the distro user space and the application, and starting one is simply launching a constrained process (or set of them). Three Linux kernel capabilities assemble this model: **namespaces** isolate the view (each container believes it has its own process tree, network, and mount points), **cgroups** limit usage (CPU and memory quotas, so one container cannot eat the host alive), and the **union filesystem** (overlay2 and friends) stack read-only image layers with a writable layer into one complete root directory.

| Feature | Virtual machine | Container |
|------|--------|------|
| Startup time | minutes | seconds |
| Resource footprint | high (full OS) | low (shared kernel) |
| Isolation | strong (independent kernel) | fairly strong (same kernel, shared syscall surface) |
| Image size | GB scale | MB to a few hundred MB |
| Performance | virtualization overhead | near-native |

For heterogeneous workloads needing strong isolation, and for scenarios requiring a different kernel, virtual machines remain irreplaceable; for dense deployment of homogeneous services on one host, containers are the more economical choice. The two are also often combined: carve up physical machines with VMs first, then raise density with containers inside them. When choosing, two questions suffice -- does it need an independent kernel (yes -> VM), and do you accept the attack surface that comes with a shared kernel (yes -> container, then layer on hardening such as non-root and a read-only root filesystem). Do not treat "container = safer" as a slogan either: containers shrink the deployment unit, but a shared kernel means the escape surface is still there, and the security conclusion has to weigh the same two questions.

With the division of labor between namespaces and cgroups understood, many "container weirdnesses" dissolve on their own: `top` inside a container shows the host's total memory (the cgroup limit lives elsewhere), editing `/etc/resolv.conf` in a container affects only that container (mount namespace), and the PIDs seen by `docker top` line up with the host's `ps` (the pid namespace remaps rather than hides). When troubleshooting, first ask "is this a view problem or a quota problem", and go check the namespace view or the cgroup limit accordingly -- far more effective than blindly restarting the container, and methodologically the same move as "tell DNS from firewall first".

### 1.2 Image Layering: Compared to Installing with pacman/apt

The most critical step in understanding Docker is comparing it to a package manager you already know. When an Arch user installs Nginx with `pacman -S nginx`, the package manager lays files **directly into the system root filesystem** under `/usr` and `/etc` -- these changes affect the running system immediately, and removal is rolled back via database bookkeeping; `pacman -Ql nginx` lists what was installed, and a `pacman -Syu` upgrade replaces old files in place. A Docker image, by contrast, is a **layered read-only snapshot**: each `RUN`/`COPY` in the Dockerfile produces a layer, layers stack, and a writable layer is capped on top -- together they form the root directory the container sees.

```text
writable layer (changes made via docker exec land here)   <- the only writable one
layer N: COPY app /app                                    <- read-only
layer N-1: RUN npm ci                                     <- read-only, cacheable
base image node:20-alpine                                 <- read-only, like a distro base package group
```

Three practical conclusions follow. **First**, layers are immutable: an `apt install`/`pacman -S` run inside `docker exec` lives only in the writable layer and dies with the container -- fine for temporary debugging, but permanent configuration must be written into the Dockerfile. **Second**, at build time as long as an instruction and everything before it is unchanged, that layer and all below it hit the cache and are reused directly -- the same work-saving philosophy as a package manager skipping downloads when dependencies are satisfied, which is why Dockerfile convention puts rarely-changing `COPY package.json` and dependency installation before the source-code `COPY`. **Third**, multiple images can share the same base layers, just as several Arch machines share one pacman package cache -- the `Size` shown by `docker images` is far smaller than the sum of image sizes precisely because of shared, deduplicated layers. The cleanup logic maps too: `pacman -Sc` reclaims package caches no longer needed, `docker system prune` reclaims dangling images and stopped containers -- both are "reclaiming build byproducts", and both warrant confirming nothing in use is affected first. One level deeper: `pacman` manages "the state of system software on one machine", while an image manages "a filesystem snapshot that can be copied anywhere" -- the former seeks a single source of truth, the latter uniformity everywhere, and understanding this difference stops `pacman -Syu` and `docker pull` from being confused ever again. Layering brings another concrete payoff in distribution efficiency: across an intranet only the changed layers need syncing, just as `pacman` on upgrade only downloads differing packages -- a full retransfer is waste in both models. Cement these three points into muscle memory and both Dockerfile style and troubleshooting thinking become natural.

### 1.3 Docker Architecture

```text
docker CLI ──(REST API /var/run/docker.sock)──▶ dockerd daemon
                                                 ├─ image storage (content-addressed)
                                                 ├─ container runtime (runc/containerd)
                                                 └─ networking (bridge/host/…)
```

The `docker` command is only a client; the real heavy lifting is done by `dockerd`. Understanding this explains the common questions below: why `docker ps` reports `Cannot connect to the Docker daemon` -- the daemon is not running or the current user lacks permission to reach the socket, nothing to do with the image itself. Separating CLI from daemon also yields a practical corollary: Docker on a remote machine can be managed by setting `DOCKER_HOST` or configuring TLS certificates; this page by default discusses the most common "local CLI plus local daemon" shape. The daemon's own crash recovery is handed to systemd (`Restart=on-failure` by package default), which is a different level of question from "should a container have a restart policy" -- do not mix the two in one config. All three distros are identical at this layer: whether the package comes from apt, pacman, or dnf, the unit is called `docker.service`, and ops scripts can be reused verbatim.

## 2. Installation (Three Distros Compared)

| Action | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Install | `apt install docker-ce …` (official repo) | `sudo pacman -S docker docker-compose` | `dnf install docker-ce …` (official repo) |
| Search | `apt search docker` | `pacman -Ss docker` | `dnf search docker` |
| Show package info | `apt show docker-ce` | `pacman -Qi docker` | `dnf info docker-ce` |
| List files | `dpkg -L docker-ce` | `pacman -Ql docker` | `rpm -ql docker-ce` |
| Upgrade | `apt upgrade` | `sudo pacman -Syu` | `dnf upgrade` |
| Remove | `apt remove docker-ce` | `sudo pacman -R docker` | `dnf remove docker-ce` |

Two notes: Docker CE on Debian/Ubuntu and the RHEL family comes from Docker's official repository (versions in the distro's own repos usually lag), while on Arch it is directly in the official extra repository, one `pacman -S docker` away -- also the shortest installation path of the three, after which `systemctl enable --now docker` follows `pacman -Syu`. Arch's standalone Compose package is `docker-compose` (`pacman -S docker-compose`, providing the `docker-compose` command); the `docker-compose-plugin` installed from the official Debian/RHEL repos provides the `docker compose` subcommand -- both share Compose-spec syntax, so pick whichever entry you ended up with. One more note for the RHEL family: Red Hat officially promotes the daemonless Podman, highly compatible with the Docker CLI; this page focuses on Docker, but if your specification allows Podman, `dnf install podman` is a first-class in-repository option.

### 2.1 Debian/Ubuntu (Official Repository)

```bash
$ sudo apt update
$ curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
$ echo "deb [signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list
$ sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

The GPG key and the dedicated `sources.list.d` entry serve exactly one purpose: let apt verify package signatures so the binaries you install genuinely come from Docker's official channel. The `docker.io` package in the distro's own repos typically lags by months; production environments generally use the official repository directly.

### 2.2 Arch

```bash
$ sudo pacman -Syu docker docker-compose
$ sudo systemctl enable --now docker && docker --version
Docker version 27.x.x, build abcdef1
```

On Arch, `pacman -S docker` pulls in `containerd` and `runc` as well (Docker's runtime dependencies), with no third-party repository needed; `docker-compose` is installed on demand as a standalone package. Keep daily upgrades rolling with `pacman -Syu` as a whole -- the Docker engine, CLI, and containerd versions are guaranteed to match by the same repository; hand-assembling mismatched binaries is homebrew-distro practice and does not apply to Arch. The installation progress bar itself carries no troubleshooting information; acceptance is fixed on two lines: `systemctl is-active docker` and `docker --version`. When the version numbers line up and the service is active, the installation phase can be closed out.

### 2.3 RHEL/CentOS/Rocky (Official Repository)

```bash
$ sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
$ sudo dnf install docker-ce docker-ce-cli containerd.io docker-buildx-plugin
$ sudo systemctl enable --now docker
```

`yum-config-manager` merely writes Docker's official repo file into `/etc/yum.repos.d/`, after which `dnf`'s resolution, signature verification, and upgrades all go through the normal channel. On Rocky/CentOS, if you previously installed the distro's own `podman`/`docker` compatibility packages, remove them first to avoid file conflicts, then install Docker CE.

### 2.4 Verification and User Groups

The acceptance steps after installing on all three families are completely identical -- only the package manager in front changes to apt, pacman, or dnf:

```bash
$ systemctl is-active docker
active
$ sudo usermod -aG docker $USER    # takes effect after re-login
$ docker run hello-world
Hello from Docker!
```

`Hello from Docker!` appearing means the whole chain is connected through (client -> daemon -> pulling the image -> creating the container -> running the process). Adding the user to the `docker` group is equivalent to granting root (the daemon runs as root and can mount any host path), so enable it only for trusted accounts that genuinely need sudoless operation; `newgrp docker` applies it immediately without re-login. If during acceptance `is-active` returns `active` yet `hello-world` still fails, check group membership and session caching first (`id -nG` already containing docker, whether the current shell was opened after the group change), rather than suspecting the image pull -- fixing the three-layer check order "service layer, permission layer, network layer" avoids repeatedly reinstalling packages at the least likely link. This section's actions are identical on all three families; the only difference is the package manager verb before the first line -- `apt` on Debian, `pacman` on Arch, `dnf` on RHEL -- the same set of memory anchors as the comparison tables in other chapters of this site.

## 3. Day-to-Day Images and Containers

```bash
# images: pull, list, offline transfer
$ docker pull nginx:1.27 && docker images
nginx   1.27   605c77e624dd   187MB
$ docker save nginx:1.27 -o nginx.tar && docker load -i nginx.tar
# containers: lifecycle and observation
$ docker run -d --name web -p 8080:80 --restart unless-stopped nginx
$ docker ps
b3f1c2d4e5a6   nginx   Up 2 minutes   0.0.0.0:8080->80/tcp   web
$ docker logs --tail 20 web
$ docker exec -it web sh              # sh on Alpine-based images; bash on Debian-based ones
$ docker rm -f web
```

`docker run` outputs only the one line with the container ID -- by design it wants you to verify immediately with `docker ps`/`logs` rather than stare at the ID guessing what happened. The minimal day-to-day troubleshooting set is exactly the group above: `ps` for state, `logs` for application output, `exec` to step in and check files and environment variables, `stats` for resources (add `--no-stream` when you want a single frame). Once these four are muscle memory, pair them with `inspect` for structured fields (`State.OomKilled`, `Mounts`, `NetworkSettings`), and the vast majority of "will not start, will not connect, will not write" can be located to a layer without ever looking at the host's process table -- an image problem, a port problem, or a volume permission problem; `inspect`'s JSON field names themselves correspond to those three root causes.

`-p 8080:80` means "host 8080 -> container 80", and reversing it is the common first pitfall; writing only the container side (`-p 80`) has Docker map it to a random high host port -- fine for testing, but production must pin the host port, otherwise it changes on every recreation and every downstream config has to follow. `--restart unless-stopped` makes the container come back automatically after a daemon restart or a host reboot (see section 6 for the division of labor with systemd). `docker save`/`load` are standard moves for isolated intranets -- when a production machine has no internet, pull the image on a connected machine, tar it up, and carry it over, equivalent to copying a pacman package cache directory offline (Arch's `/var/cache/pacman/pkg` is likewise prepared for offline use and rollback). Pinning an image tag rather than `latest` follows the same logic: only an expected upgrade is an upgrade; `latest` may surprise you on every pull, and when you want to roll back you discover the previous version is long gone.

### 3.1 Data Persistence

A container's filesystem vanishes with the container; two kinds of persistence each do their own job: a **bind mount** maps a host path straight into the container, suited to config files and hot-reloaded code (editing the host file takes effect immediately); a **data volume** is a Docker-managed directory, suited to database data (permissions and backup paths under unified control). The selection rule: what humans edit directly gets a bind mount, what machines read and write with a lifecycle independent of the container gets a volume -- database data files always choose the latter, otherwise `docker rm` takes the data with it.

```bash
$ docker volume create mysql-data
$ docker run -d --name db -v mysql-data:/var/lib/mysql \
    -e MYSQL_ROOT_PASSWORD=secret mysql:8.0
$ docker run -v /opt/webhtml:/usr/share/nginx/html:ro nginx   # :ro read-only inside the container
```

`:ro` is the most commonly overlooked minimal hardening: do not grant write permission on read-only content, preventing a compromised container from tampering with static assets. Persistence and logging share the same principle -- "containers are disposable; data and logs must live outside them" -- and with that understood, volumes, bind mounts, and log limits stop being three isolated configs and become three landing points of one engineering discipline. The backup strategy follows just as clearly: copy data volumes off the host's volume directory with ordinary file backup tools, and back up the host path directly for bind mounts -- neither needs "going inside the container" to back up. `docker volume inspect mysql-data` reveals the volume's real path on the host; when migrating machines, stop the container, copy that directory, then create a volume of the same name on the new machine and mount it back -- far less error-prone than "exporting and importing an image with the data". Another difference between volumes and bind mounts is portability: named volumes declared in Compose travel freely up and down with the project, while absolute-path bind mounts must be rewritten when the machine changes -- keeping "paths humans write" and "paths machines manage" apart is the underlying habit that avoids trouble in cross-environment deployment.

## 4. Dockerfile Essentials

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev          # stable dependency layer, hits the cache
COPY . .
RUN addgroup -g 1001 -S app && adduser -u 1001 -S app -G app
USER app                       # run as non-root
EXPOSE 3000
CMD ["node", "server.js"]
```

Three repeatedly validated practices: **COPY the dependency manifest before the source code**, so changing one line of source does not rerun dependency installation; **`npm ci` rather than `npm install`** (installs exactly per the lockfile, making builds reproducible -- the equivalents in other language ecosystems are `pip install -r` and `go mod download`; reproducibility of image builds rests on the lockfile, not on the host's system package manager); and **USER switching to non-root**, the same discipline as not running services as root on the host. Incidentally, an `apk add`/`apt-get install` inside the image affects only that image's layer and never touches the host's pacman/apt databases -- that is precisely what "putting package management in a cage" means, and why it dares to run multiple stacks simultaneously on a production machine: the host's `pacman -Q` list and the packages inside an image are two mutually non-interfering worlds, and upgrading one does not affect the reproducibility of the other. Multi-stage builds leave the compiler in the earlier stage and have the final image only `COPY --from=builder` the artifact, often cutting size from gigabytes to tens of megabytes, and the runtime image no longer carries the compiler or source -- attack surface and disk footprint both drop. Halving image size often means halving pull time, which in elastic-scaling scenarios translates directly into cold-start speed:

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

Swap `FROM alpine` for your target distro's slim image; if your team maintains the base environment with `pacman`, you can also build the dependency layer first with an Arch base image's `pacman -Syu` and stack the application layer on top -- as long as that layer is stable, every later build hits the cache. `.dockerignore` works like `.gitignore`: keeping `node_modules` and `.git` out of the context makes builds faster and safer (avoiding keys being accidentally `COPY`-ed into an image). Smaller build artifacts are not always better -- trading away necessary debug symbols and health-check tools to save a few megabytes is paid back double during troubleshooting; the mature team's choice is the balance between "good enough and maintainable" and "as small as possible".

## 5. Docker Compose: One-Page Orchestration for Multiple Services

`docker run` is still workable for a single container, but a web application is usually a trio of "app + database + cache", and writing three run commands by hand means remembering the dependency order yourself -- Compose writes the whole topology into one YAML, brings it up with a single `up -d`, and cleans up when deleted. Being version-control friendly is another reason it is widely adopted: the YAML goes into git, and reviewing a topology change uses the same process as reviewing code; the environment definition no longer lives scattered in someone's shell history. Its three most typical use cases: **one-click reproduction of a local dev environment** (a newcomer clones the repo and `compose up` gets dependencies identical to CI), **single-host orchestration for small and medium production deployments** (managing multiple services without introducing Kubernetes), and **reproducible demos and test fixtures** (every `down -v && up` is a clean environment).

```yaml
# docker-compose.yml
services:
  web:
    build: .
    ports: ["8080:80"]
    volumes: ["./html:/usr/share/nginx/html:ro"]
    depends_on: { db: { condition: service_healthy } }
    restart: unless-stopped
  db:
    image: mysql:8.0
    environment: { MYSQL_ROOT_PASSWORD: example, MYSQL_DATABASE: app }
    volumes: ["db_data:/var/lib/mysql"]
    healthcheck: { test: ["CMD", "mysqladmin", "ping", "-h", "localhost"], interval: 10s, retries: 10 }
    restart: unless-stopped
volumes: { db_data: }
```

The common command sequence (the one-character difference between `down` and `down -v` decides whether the database data volume is buried with it -- read it once more before writing it into a change ticket):

```bash
$ docker compose up -d            # create network and volumes and start in the background
$ docker compose ps && docker compose logs -f web
$ docker compose exec db mysql -u root -p   # run a one-off command inside the container
$ docker compose pull && docker compose up -d   # update images and rolling-restart
$ docker compose down             # stop and remove containers (data volumes kept)
$ docker compose down -v          # delete data volumes too -- use with care in production
```

The top-level `version:` key is deprecated in the new Compose spec and can be omitted. `depends_on` by default guarantees only **startup order**, not readiness: a database process being up does not mean it can accept connections, hence the `condition: service_healthy` plus `healthcheck` above -- this is the key step from "can run" to "usable", and the standard solution for problems like "the app crashes and restarts because it became ready before the database". Health check commands should probe "can it serve" (such as `mysqladmin ping` or an HTTP `GET /health`), not "is the process there" -- a hung process whose port does not respond is exactly what a healthcheck should catch. After writing the YAML, run `docker compose config` once for a syntax expansion, keeping indentation errors and undefined variables out of production; the `config` output is also often pasted into the change ticket as a readable list of "which services exactly are we starting this time". In daily work, `up -d` after a config change is gentler than `down && up` -- unchanged services are not recreated, connections and caches survive, and only services whose ports, volumes, or environment variables actually changed get rolled over.

Another LNMP-style combination (Nginx + PHP-FPM + MySQL) has the same structure as the example above: a shared data volume holds the PHP code, Nginx `depends_on` PHP-FPM, and MySQL keeps its data in a named volume. To add a cache, declare one more `redis` service and have the app `depends_on` it -- Compose's composability comes precisely from "one declaration per service, dependencies drawn in the graph". Beyond a single host (multi-node scheduling, rolling upgrades, service discovery), evaluate Kubernetes next; until then, Compose already covers the orchestration needs of the vast majority of teams, and there is no need to complicate things early to "look cloud-native". Conversely, if the whole application is really just one binary plus one config file, forcing it into three services is a burden -- first ask "does it truly need independent scaling or independent release", then decide whether to introduce a new service boundary.

Once the orchestration file is in git, review focus naturally shifts from "were the commands typed right" to "is the topology declaration reasonable": are ports pinned to the host, do secrets go through environment variables rather than plaintext, does the healthcheck probe business availability, and is the restart policy clearly divided from systemd -- these four map exactly onto the four preceding subsections. Treat the Compose file as an executable architecture diagram to maintain: a newcomer reads the YAML to understand the dependencies, with no need to archaeology anyone's shell history.

## 6. The Relationship with systemd

Docker is not another init competing with systemd for work: `docker.service` is itself an ordinary systemd unit, and `systemctl enable docker" handles "bring the daemon up at boot" (on Arch, installing is followed by the same `systemctl enable --now docker`, no different from enabling any other service after pacman); containers, meanwhile, are child processes managed by dockerd, which systemd by default **cannot see**. The division of responsibility can be remembered as three layers:

- **The engine layer belongs to systemd**: `dockerd`'s startup, crash restart, and boot autostart are all decided by `docker.service`. With the engine down, every container command reports a connection failure.
- **The container layer belongs to Docker itself**: a single container uses `--restart=no|always|on-failure|unless-stopped` to express "if you go down while the engine is still here, should I bring you back"; the difference between `unless-stopped` and `always` is that a container manually `docker stop`-ed will not be forcibly dragged back when the engine restarts -- the former is more commonly used in daily ops.
- **Do not double-manage**: one business either gets Compose/`--restart` self-management, or a systemd unit that runs `docker compose up` (with `ExecStop` corresponding to `down`) -- pick one chain of command. The common mistake is giving a container `--restart=always` *and* writing a systemd `ExecStart=docker run ...` -- the engine start pulls up the container, systemd runs `run` again, and you immediately collide on the name.

`depends_on` only governs ordering inside Compose and cannot handle "the engine is not ready yet", while `After=docker.service` + `Requires=docker.service` is the standard way for a custom unit to wait for the engine. To have the whole Compose application recover automatically at boot, you can also simply `systemctl enable` the corresponding unit or achieve the same with `restart: unless-stopped` + engine autostart -- both paths work; choose one and write it into the ops runbook. Likewise, monitoring either watches the dockerd systemd state on the host or reads container metrics via cAdvisor/container exporters -- do not expect `systemctl status` to list container business names. Container logs default to the JSON file driver, and production should limit `max-size`/`max-file` in `/etc/docker/daemon.json`, otherwise a single log-spamming application can fill the host's disk; routing logs into journald or integrating with the [Logging](../../basic/log.md) chapter is covered there, and firewall and port exposure policy remains governed by the [Firewall](../../security/firewall.md) page, not repeated here. One sentence to sum up this section: **systemd keeps "the engine alive", Docker keeps "containers alive", the two connect through restart policies and unit dependencies, and each owning one layer is what stops them fighting.**

```json
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "live-restore": true
}
```

After editing the file, validate with `dockerd --validate`, or check `systemctl cat docker` before restarting to make sure no overriding drop-in interferes; a JSON syntax error makes the engine refuse to start outright -- the easiest trap when editing `daemon.json`, so always validate before restarting. The three settings each own one thing: the log limits prevent the disk from being filled, `live-restore` keeps business running through the upgrade window, and the default json-file driver guarantees `docker logs` works -- do not casually delete the driver config for "simplicity"; you will miss it when troubleshooting. With `live-restore` on, containers keep running when dockerd is upgraded or restarted, so business is not interrupted by the engine's maintenance window -- recommended in production; before restarting the engine, confirm it is in effect, otherwise "just upgrading the engine" stops every container, which is exactly the practical payoff of separating engine-layer and container-layer responsibilities. The emergency fix for a `daemon.json` typo that stops the engine coming up: `journalctl -u docker -e` to see the parse error, fix the JSON, then `systemctl start docker` -- look at the log before acting, and you save half the "I changed nothing and it just broke". All these parameters should follow the same process: back up before, verify after, restart only once verified -- no different from changing any critical system config.

One easily-missed interaction between engine config and container restart policies: with `live-restore: false` (one of the default behaviors), an engine upgrade stops all containers along with it -- even if every container has `--restart=always`, the recovery window depends on systemd bringing `docker.service` back up and dockerd rebuilding each container one by one, and any slow link in that dependency chain is felt by the business as an unplanned hiccup. Conversely, turning on live-restore while letting the engine's `WantedBy=multi-user.target` lapse means the containers do not come back after a host reboot either: engine autostart, live-restore, and container restart policies must all be in place before the "host reboot -> engine ready -> containers ready" chain is closed. The acceptance method is direct: after editing `daemon.json`, reboot the machine once inside a maintenance window and observe whether `docker ps` recovers to its pre-change state without human intervention -- a recovery you can reproduce is a real recovery; policy assumptions written in a document do not count.

## 7. Common Traps

**`Cannot connect to the Docker daemon at unix:///var/run/docker.sock`.** Check `systemctl is-active docker` first; if not running, `systemctl start docker`. Still failing while active is usually permissions: the current user is not in the `docker` group (`id -nG` to check), or a wrong socket path is being used in a rootless/Podman environment. Do not paper over a long-term configuration problem with `sudo`, and do not blindly add everyone to the `docker` group -- group membership equals root, and the approval standard should match sudoers. The group-add command after installing on all three distros is identical; the package manager (apt, pacman, dnf) only lays down the binaries and unit files. After changing groups, remember to have the user re-login (or `newgrp docker`), otherwise the same error persists -- when a permission change does not take effect, always first ask "is this session stale".

**Port binding fails with `port is already allocated`.** `ss -tlnp | grep 8080` to find the occupant -- commonly the host itself is already running Nginx/Apache, or a previous container was not cleaned up. Changing the mapped port (say `-p 8081:80`) is safer than killing a host service; between Compose projects, change each project's `ports` or use different host port ranges. The opening rule itself still goes through the unified process on the [Firewall](../../security/firewall.md) page; here we only solve "who is holding the port". One more note: `0.0.0.0:8080` in `docker ps` means bound to all interfaces; for localhost-only access write `127.0.0.1:8080:80` -- many "port exposed to the public internet" incidents trace back to exactly this missing prefix.

**Container starts then exits.** `docker logs NAME` for the application's own errors; when logs are blank, `docker inspect` for `State.OomKilled` -- the typical trace of being killed by a cgroup over a memory limit; set an explicit `--memory` and raise the application's config to match. An image architecture mismatch (pulling an arm64 image on an x86 machine) reports `exec format error`, and `docker manifest inspect` can check in advance. Under Compose, start with `docker compose logs SERVICE` -- most "will not start" cases are actually a healthcheck never passing, with the root cause still pointing at a dependency service not ready. Another hidden source is compatibility between the host kernel and the image: a very old kernel running a new glibc in a modern image may fail outright; upgrade the kernel or switch to a base image with older user space -- such problems have nothing to do with the image content itself.

**Disk eaten by images and logs.** Converge in order: `docker system df` for the breakdown -> `docker image prune -a` to clear unreferenced images -> `docker builder prune` to clear build cache -> only then consider `docker system prune -a` (which deletes all non-running containers and untagged images -- effectively a reset). The recommended cleanup policy is to run prune without `-a` routinely and reserve `-a` for a defined maintenance window. Arch users should not forget the host side at this point either: `pacman -Sc` and `pacman -Scc` reclaim two different cache layers, and with a tight disk both need checking; Debian uses `apt clean`, RHEL uses `dnf clean all`.

**API version errors after an upgrade.** A `client version too new` style error means CLI and daemon versions are mismatched. Align the three: on Arch a single `pacman -Syu` upgrades the whole docker family of packages; on Debian/RHEL `apt upgrade docker-ce` / `dnf upgrade docker-ce` plus an engine restart; environments with hand-assembled binaries go back to the package manager -- questions like "who provides this file" (`pacman -Ql docker`) always get answered faster in the package manager than by digging through `/usr/local`. If the business image still errors after versions align, check whether the API version used at image build time exceeds the engine's supported range and rebuild as needed. Managing "engine version, image tag, Compose file" as one linked set of version numbers cuts upgrade incidents by more than half.

**Compose changes not taking effect / weird volume permissions.** `docker compose up -d` only recreates containers for changed services; a pure config-file change (not a mounted volume) needs `docker compose up -d --force-recreate` or simply `down && up`. Bind mount permissions follow **the host UID**: a process with UID 1000 inside the container writing to a host directory is checked against host UID 1000; do `chown` on the host, not inside the container, where it is lost the moment the container is deleted. This differs from the ownership semantics managed by system package managers -- the owners seen via `pacman -Ql` land on disk with the package and survive reboots, while a bind mount's owners are entirely determined by the host directory's current state; align owners and permission bits host-side before migrating environments.

**`exec format error`, or `no space left on device` while `df -h` shows space.** The latter is often inode exhaustion (`df -i`) or a full partition holding Docker's storage driver -- `docker system df -v` pinpoints whether images, containers, or volumes are the bulk. Put these two alongside "daemon not starting" and "port conflict" as a fixed checklist and it covers the vast majority of tickets; Arch environments add one more: `pacman -Qdt` for orphaned dependencies and `df -h /var/lib/docker` for the partition holding the storage driver -- the check entry points differ per family, but the thinking is the same: first tell metadata, cache, and business data apart to see which kind filled up.

## 8. Production Checklist (Quick Reference)

Check off each item before going live -- the checklist compresses the long prose above into one executable last step, and every item's "why" appeared earlier.

- [ ] Runs as non-root (`USER`)
- [ ] Resource limits (`--memory` / `--cpus`)
- [ ] Log limits (`daemon.json` max-size / max-file)
- [ ] `--restart` or Compose `restart` policy set
- [ ] Image pinned to a version tag, not `latest`
- [ ] Secrets stay out of the image (env injection or secrets)
- [ ] A routine cleanup job runs `docker system df`
- [ ] Firewall opens only the host ports genuinely needed

A fuller hardening checklist is on the [Hardening](../../security/hardening.md) page. Remember the boundary of container security: non-root in the image, a read-only root, and minimal dependencies govern "how much damage a compromised container can do", while the host's firewall, patches, and admission control govern "whether it gets compromised at all" -- both layers are necessary. A truly mature team keeps images, Compose files, systemd units, and firewall rules each in version control, each doing its own job, none overstepping to decide for another; when an item is uncertain, go back to its chapter and reread the "why".

## References

- Official Docker documentation -- [docs.docker.com](https://docs.docker.com/)
- Docker Compose specification -- [docs.docker.com/compose](https://docs.docker.com/compose/)
- Dockerfile best practices -- [docs.docker.com/build/building/best-practices/](https://docs.docker.com/build/building/best-practices/)
- Docker Hub -- [hub.docker.com](https://hub.docker.com/)
- Arch Wiki: Docker -- [wiki.archlinux.org/title/Docker](https://wiki.archlinux.org/title/Docker)
- containerd documentation -- [containerd.io/docs](https://containerd.io/docs/)

<!-- BACKLINKS-AUTO -->
## Related Pages

- [glossary](/glossary.md)
- [knowledge](/knowledge.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [gap-fill](/research/gap-fill.md)
- [README](/server/README.md)
- [ci-cd](/server/ci-cd.md)
- [ldap](/server/ldap.md)
- [routing-nat](/server/routing-nat.md)
- [kvm](/server/virtualization/kvm.md)
- [automation](/system-management/automation.md)