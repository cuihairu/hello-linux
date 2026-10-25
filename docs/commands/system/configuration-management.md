# Configuration Management Tools

A machine's configuration lives in text files; one hundred machines' configurations stay consistent only with **tools**. Configuration management spans two levels: **picking the right entry point on a single host** (where network, time, hostname, and kernel parameters get written, and how they take effect), and **converging state across many hosts with declarative tools** (Ansible and the like). Getting the former wrong loses network and data; getting the latter wrong reproduces the incident across the whole fleet in half an hour.

> Content drawn from the official documentation of Ansible, Puppet, Chef, and SaltStack plus the Arch Wiki; see the references at the end.

## What This Page Covers

- Why text configuration beats GUI, and the single-host entry points across the three distro families
- sysctl persistence: path differences across the three families and how to verify
- The mainline usage of Ansible inventory, ad-hoc, playbook, and roles
- Where Puppet/Chef/Salt sit differently
- Building the "change config -> verify -> can roll back" habit

## 1. Why Configuration Management Is Needed

`ssh` into ten machines and edit them by hand: the first one succeeds, the third gets a fat-fingered edit, the seventh is missed entirely -- this is not an attitude problem, it is a **change-method** problem. Configuration management writes the "desired final state" as code, and lets the tool compare, converge, and report drift. That buys four things hand work cannot deliver:

- **Consistency**: 100 machines converge on the same declaration, not on "the way I happened to do it last time".
- **Repeatability**: scaling to a new data center = running the same playbook again, not rewriting a checklist.
- **Auditability**: configuration lives in Git; who changed `nginx.conf` from A to B and when is visible at a glance in a diff.
- **Reversibility**: check out the previous commit; no need to reverse-`sed` production from memory.

### 1.1 Why Text Configuration Beats GUI

Options you can flip with two clicks -- why do Linux operators insist on "everything is text"? Because the GUI assumes **local, visible, one-off, unaudited**, and on a server none of those four assumptions hold:

1. **Diffable**: `diff -u old.conf new.conf` is your change review; a GUI checkbox state cannot be reviewed and cannot enter Git.
2. **Copyable**: the same YAML lands identically on 100 machines; hand-clicking the GUI on every host guarantees configuration drift.
3. **Reachable remotely**: SSH is five milliseconds away; installing a desktop environment and GPU drivers just to edit a config is absurd, and headless servers are the vast majority of Linux servers.
4. **Automatable**: the underlying object of a tool like Ansible is text, commands, and modules, not mouse events.

GUI is not worthless: first-time exploration of options, or using an **interactive tool with rollback** such as `nmtui`/`netplan try` to avoid cutting off a remote network, are both practical. The right posture is: **explore with interactive tools, solidify with text files**. The full principles and operations for the single-host entry points (Netplan/nmcli/networkd, timedatectl, hostnamectl) are already covered in [System Configuration Tools](../../basic/services/configuration_tools.md); this chapter does not repeat them, keeping only a quick reference and cross-references. First, the sysctl persistence lesson where the most people trip:

### 1.2 Single-Host Configuration: Three-Family Entry Points at a Glance

Do the first baseline configuration after install in the order "network -> time -> hostname -> kernel parameters". The differences across the three families concentrate in the **network front end**; time and hostname are unified by systemd:

| Item | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|--------|---------------|------|-------------------|
| Network front end | **Netplan** (`/etc/netplan/*.yaml` -> `netplan apply`/`try`) | **systemd-networkd** (`/etc/systemd/network/*.network`) or NetworkManager | **NetworkManager** (`nmcli`, keyfile in `/etc/NetworkManager/system-connections/`) |
| Network verification | `netplan status` + `ip addr` | `networkctl status` + `ip addr` | `nmcli device status` + `ip addr` |
| Time | `timedatectl set-timezone` / `set-ntp` | same as left | same as left (often chronyd underneath) |
| Hostname | `hostnamectl set-hostname` | same as left | same as left |
| Kernel parameters | `/etc/sysctl.d/*.conf` | `/etc/sysctl.d/*.conf` | `/etc/sysctl.d/*.conf` (legacy `/etc/sysctl.conf`) |

Three points on the network routes (details and YAML examples in [System Configuration Tools](../../basic/services/configuration_tools.md) and [Network Configuration Basics](../../network/network-configuration.md)):

- **Netplan does not manage NICs directly**; it only renders YAML into networkd or NetworkManager configuration. In a remote session always `sudo netplan try` (auto-rollback after 120 seconds without confirmation) instead of jumping straight to `apply`.
- **nmcli is the unified entry point for NetworkManager**, and the only tool across the three families that fully covers Wi-Fi/VPN. After changing a connection you must `connection down/up` for it to land; the text source of truth is the keyfile (permissions must be 600).
- **systemd-networkd** is the pure systemd stack, commonly used for minimal Arch server installs; after changes `systemctl restart systemd-networkd`, then verify with `networkctl`.

A single NIC can have only one manager: enabling NetworkManager and networkd at the same time makes them overwrite each other's DHCP and routes -- the number-one pitfall in network configuration.

Time and hostname commands are identical across the three families:

```bash
$ timedatectl
System clock synchronized: yes
              NTP service: active

$ sudo timedatectl set-timezone Asia/Shanghai
$ sudo timedatectl set-ntp true
$ sudo hostnamectl set-hostname web01.example.com
```

A drifting clock causes TLS verification failures, scrambled log timestamps, and skewed scheduled jobs -- a must-check on any install, with `System clock synchronized: yes` in `timedatectl` as the completion bar.

### 1.3 sysctl Persistence: Path Differences and Verification

Kernel parameters are a high-frequency object at the "single-host level" of configuration management (`vm.swappiness`, `net.ipv4.ip_forward`, `fs.file-max`). Change them **at runtime** with `sysctl -w`; for **persistence** all three families recommend writing `/etc/sysctl.d/99-<topic>.conf`, loaded at boot by systemd-sysctl in priority order (`/etc` overrides a same-named file in `/usr/lib`):

```bash
# /etc/sysctl.d/99-forward.conf
net.ipv4.ip_forward=1
```

```bash
$ sudo sysctl --system | grep ip_forward         # confirm this line is in the merged result
$ sudo sysctl -p /etc/sysctl.d/99-forward.conf   # take effect without a reboot
```

| Item | Debian/Ubuntu | Arch | RHEL/CentOS/Rocky |
|------|---------------|------|-------------------|
| Recommended path | `/etc/sysctl.d/*.conf` | `/etc/sysctl.d/*.conf` | `/etc/sysctl.d/*.conf` |
| Legacy `/etc/sysctl.conf` | read by default by `sysctl -p` | not recommended | common in older material, may still be present |
| Boot-time loading | systemd-sysctl | same as left | same as left |

**Pitfall**: `echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf` may be **lost after a reboot** on a load chain that only reads the `.d` directory; always re-check with `sysctl --system` or after a reboot. Memory-related swappiness/vfs_cache_pressure follow the same rule; the full discussion is in [Memory Management](./memory.md).

Single-host configuration answers "is this one machine right"; the automation tools below answer "are a thousand machines still consistent".

## 2. Choosing a Configuration Management Tool

Four mainstream tools are often discussed side by side, but their positioning differs: some favor agentless lightness, some favor large-scale strong consistency, and some take "change as code" all the way. Look at the summary table first, then decide which to go deep on:

| Tool | Language | Architecture | Topology scale | Learning curve | Typical use |
|------|----------|------|----------|----------|----------|
| **Ansible** | Python | agentless, SSH | hundreds to thousands | low | fast delivery, mixed environments, one-off tasks and continuous convergence |
| Puppet | Ruby | C/S (agent) | thousands to tens of thousands | medium-high | long-term compliance, enterprises with strict change windows |
| Chef | Ruby | C/S (client) | thousands to tens of thousands | medium-high | deep DevOps integration, Ruby tech stack |
| SaltStack | Python | C/S (minion), ZeroMQ | tens of thousands, minute-level rollout | medium | large scale, environments needing high-concurrency execution |

Do not get stuck on "which is stronger": **no agent + YAML + a huge catalog of ready-made modules** makes Ansible the de facto default; organizations with existing Puppet/Chef assets can keep digging in; Salt's performance edge shows up clearly at "run one command across ten-thousand-scale hosts at once". This page and the remaining examples use Ansible as the main line -- it is also the only option where you can run your first ad-hoc command within five minutes, the fastest feedback loop.

## 3. Ansible: Agentless Automation

### 3.1 Installation (all three families, including pacman)

The control node only needs a Python environment and the `ansible` command installed from the package manager; on first connect Ansible probes the interpreter version on the managed side. Install on the three families (same package name, different front ends):

```bash
sudo apt update && sudo apt install ansible   # Debian/Ubuntu
sudo pacman -S ansible                        # Arch (pacman -Syu full upgrade first, to avoid partial upgrade)
sudo dnf install ansible                      # RHEL/CentOS/Rocky
```

Arch note: on a rolling release "install just one package" can trigger a partial upgrade, so always `pacman -Syu` first. Verify after install:

```bash
$ ansible --version
ansible [core 2.16.3]
  config file = /etc/ansible/ansible.cfg
```

The control node needs Python; the managed side also depends on Python by default (Ansible pushes/calls it), so minimal images need a preinstall or `ansible_python_interpreter` set. Connections are SSH-based; set up keys and `~/.ssh/config` first, otherwise every ad-hoc command asks for a password.

### 3.2 Core Concepts

- **Control node**: the machine running `ansible`/`ansible-playbook`.
- **Managed node**: hosts in the inventory being managed, reached over SSH (or WinRM, etc.).
- **Inventory**: defines "who is managed"; can be grouped and carry variables.
- **Module**: an atomic unit of capability (`apt`, `copy`, `systemd`...); each task calls one module.
- **Playbook**: a script in YAML: which hosts, under which identity, in what order, run which tasks.
- **Role**: a directory convention that packages tasks/handlers/templates/vars for reuse.

### 3.3 The Inventory File

The default location is `/etc/ansible/hosts`; in a project it is more common to specify your own with `-i inventory/hosts`:

```ini
# inventory/hosts
[webservers]
192.168.10.20 ansible_user=deploy
192.168.10.21 ansible_user=deploy ansible_port=2222

[dbservers]
192.168.10.30

[prod:children]
webservers
dbservers

[webservers]                # append to the same group; range shorthand supported
192.168.10.2[0:9]
```

Variables can live on a host line, in `[group:vars]`, or in `group_vars/`/`host_vars/` directories -- **do not put sensitive variables (passwords, tokens) into Git in plaintext**; encrypt and store them with Ansible Vault (`ansible-vault encrypt`).

### 3.4 ad-hoc: A One-Command Playbook

Good for inspection and one-off operations; essentially a "single-task playbook":

```bash
$ ansible all -m ping
192.168.10.20 | SUCCESS => {"ping": "pong"}

$ ansible webservers -m shell -a "df -h | head -5"
$ ansible all -m package -a "name=nginx state=present" --become   # auto-selects apt/pacman/dnf
$ ansible all -m copy -a "src=files/motd dest=/etc/motd mode=0644" --become
```

**When crossing distros, prefer `ansible.builtin.package`** (or dispatch `apt`/`dnf`/`pacman` modules on `ansible_os_family`); do not hard-code `apt` in a playbook, or the same flow fails outright on Rocky. `-m shell` goes through shell interpretation; use a named module whenever you can, and both idempotency and readability improve considerably.

### 3.5 Playbook

A playbook is the declarative core: it describes the **desired state** and can be re-run safely (idempotent), rather than being "a script to run once":

The minimal runnable structure looks like this (install -> push config -> ensure the service; config changes only trigger a restart via the handler):

```yaml
# deploy-nginx.yml
---
- hosts: webservers
  become: true
  tasks:
    - ansible.builtin.package: { name: nginx, state: present }
    - ansible.builtin.template:
        src: nginx.conf.j2
        dest: /etc/nginx/nginx.conf
        mode: "0644"
      notify: Restart nginx
    - ansible.builtin.systemd:
        name: nginx
        state: started
        enabled: true
  handlers:
    - name: Restart nginx
      ansible.builtin.systemd: { name: nginx, state: restarted }
```

```bash
$ ansible-playbook -i inventory/hosts deploy-nginx.yml
$ ansible-playbook --check --diff deploy-nginx.yml   # dry run: no writes, differences only
$ ansible-playbook --limit 192.168.10.20 deploy-nginx.yml
```

**Make `--check --diff` a habit first** -- it is the "netplan try" of the automation era. `notify`/`handlers` solidify "restart only when the config changed", avoiding a blind restart on every task. A production-ready playbook (with `validate` syntax checking) is in the hands-on case in section 5.

### 3.6 Common Modules (by purpose)

| Purpose | Module | Notes |
|--------|------|------|
| Files | `copy`, `template`, `file`, `lineinfile`, `replace` | `template` supports Jinja2 variable rendering |
| Package management | `apt`, `dnf`, `pacman`, `package` | prefer `package` when crossing distros |
| Services | `systemd` (or `service`) | all three families use systemd; semantics match `systemctl` |
| Users and groups | `user`, `group`, `authorized_key` | managing SSH public keys is safer than changing passwords |
| Commands | `command`, `shell`, `script`, `raw` | no idempotency guarantee; put last and use `creates`/`changed_when` |
| Network/firewall | `nmcli`, `ufw`, `firewalld` | for rule management see [Firewall](../../network/firewall.md) |

### 3.7 Roles and Project Structure

Once a playbook grows past a few dozen lines, split it into roles: once tasks, handlers, templates, and variables are separated into fixed directories, multiple playbooks can combine and reuse the same nginx logic, and a review needs only the diff. The directory convention looks like this (referenced in `site.yml` with `roles: [nginx]`):

```text
roles/nginx/{tasks,handlers,templates,files,defaults,vars}/...
# referenced in site.yml:
# - hosts: webservers
#   roles: [nginx]
```

`tasks` holds tasks, `handlers` holds restart logic, `templates` holds Jinja2, `defaults` holds low-priority variables overridable by inventory, and `vars` holds high-priority ones (use sparingly). Roles can be published to Galaxy for reuse; team-internal roles live in a private Git repo and are pulled with `ansible-galaxy install -r requirements.yml` -- by this point the "configuration as code" loop is closed: Inventory + Playbook + Role all go into version control.

## 4. Puppet / Chef / SaltStack Overview

The fundamental difference from Ansible is **architecture and execution model**: these keep a resident agent on the managed side, with a server periodically pushing or pulling the desired state, suitable for thousand-host scale and strict compliance auditing; Ansible is agentless, with the control side connecting over SSH and running on the fly. Minimal working examples follow, enough to build the concept; go to the official documentation for depth.

### 4.1 Puppet (declarative, Ruby DSL)

Puppet uses resources to declare "nginx must be installed and running at boot on this machine"; the server compiles a catalog and the agent applies it periodically:

```puppet
package { 'nginx': ensure => installed }
service { 'nginx': ensure => running, enable => true }
file { '/etc/nginx/nginx.conf':
  ensure => file, mode => '0644',
  source => 'puppet:///modules/nginx/nginx.conf',
}
```

The concept chain is resource -> class -> module -> manifest, naturally suited to "weekly reconciliation" style compliance. The official repository provides `puppet-agent`; on Arch it usually comes via the AUR or a self-built repo, so confirm with `pacman -Ss puppet` whether the repos carry it before installing.

### 4.2 Chef (Ruby, strong procedural flavor)

```ruby
package 'nginx'
service 'nginx' do
  action [:enable, :start]
end
```

A recipe makes up a cookbook, and a node carries a run list. High flexibility, good for teams that already have a Ruby toolchain; requires the Chef Workstation + Server + Agent trio.

### 4.3 SaltStack (Python, high concurrency)

```yaml
nginx:
  pkg.installed: []
  service.running: {enable: True, require: [{pkg: nginx}]}
```

Master/Minion architecture with a ZeroMQ channel; fan-out speed at the level of `salt '*' test.ping` is its signature. State syntax is YAML, so the concepts port across from Ansible.

### 4.4 How to Choose (decision chain)

When choosing, ask about scale first, then the team's current state, and only then look at feature lists -- Salt's concurrency and Puppet's auditing both look tempting in the tool list, but maintenance cost grows quadratically with host count, and the first decision rule alone usually rules out 80% of options:

1. Team scale < 100 hosts, no agent infrastructure -> **Ansible**.
2. Continuous reconciliation required, strict change auditing, existing Ruby/Puppet assets -> stay with **Puppet/Chef**.
3. Thousands to tens of thousands of hosts, second-level parallel execution required -> evaluate **Salt**, or Ansible + AWX/Tower scheduling.
4. Only "solidify this host's configuration", no multi-host need yet -> section 1's sysctl/Netplan/text files + Git is enough; **do not adopt a tool for the sake of a tool**.

Whichever you pick, the acceptance bar is the same: can a new machine go from bare OS to business-ready with **one reproducible command**, can a change be `--check`/dry-run tested in a test environment, and can a failure roll back to the last known-good state. If you cannot meet all three, switching tools will not save the process.

## 5. Hands-On Case: Converging a Web Server

String install, directories, pages, site config, and auto-start into a repeatable flow. Compared with the minimal example in section 3.5, this adds three production details: **the document root is ensured with `file`**, **site config is rendered with `template` and `validate`d**, and **only config changes trigger a `notify` restart**. Always include `name:` when writing a playbook -- an error log with no task name is blind guessing:

```yaml
# site-webserver.yml (key excerpt)
- hosts: webservers
  become: true
  vars:
    doc_root: /var/www/html
  tasks:
    - ansible.builtin.package: { name: [nginx, curl], state: present }

    - ansible.builtin.file:
        path: "{{ doc_root }}"
        state: directory
        owner: www-data     # switch www-data/nginx via a variable per distro
        mode: "0755"

    - ansible.builtin.copy:
        src: files/index.html
        dest: "{{ doc_root }}/index.html"
        mode: "0644"
      notify: Restart nginx

    - ansible.builtin.template:
        src: templates/site.conf.j2
        dest: /etc/nginx/conf.d/site.conf
        mode: "0644"
        validate: nginx -t -c %s   # rejects the write if the syntax check fails
      notify: Restart nginx

    - ansible.builtin.systemd: { name: nginx, state: started, enabled: true }

  handlers:
    - name: Restart nginx
      ansible.builtin.systemd: { name: nginx, state: restarted }
```

Two details worth stealing: `validate` keeps bad configuration **out of production** (far cheaper than a failed restart and a rollback afterwards); the handler guarantees a restart only when the config actually changed. Distro differences (the `www-data` vs `nginx` user, different site conf directories) are branched with the `ansible_os_family` variable rather than maintaining two playbooks -- that is exactly the core payoff of "text + declarative" over hand-ssh.

Before release, always walk this once: `ansible-playbook --check --diff` in the test environment -> a canary host with `--limit` for a real run -> watch `systemctl status` and application logs -> then roll out to all. If any step surfaces a problem, rollback is "edit the inventory and run the previous Git version", not logging into ten machines to hand-edit files.

For bulk user provisioning, use the `user` module with a loop (`loop`), and **never put plaintext passwords in the inventory** (password hashes via the `password_hash` filter); push SSH public keys with `authorized_key`, which is safer than distributing private keys. Full user management concepts are in [User Management](../../basic/users.md).

## 6. Common Gotchas

Automation amplifies "one hand mistake" into "a hundred hand mistakes"; the nine below are ordered by how often they show up. Every one of them is a real incident pattern -- self-check against them first, then go live:

1. **Editing a file is not the same as it taking effect**. Netplan needs `apply`/`try`, networkd needs a restart, nmcli needs down/up, sysctl needs `--system`/`-p`, and services need reload/restart. Configuration management must write "apply" as an explicit step.
2. **sysctl written into `/etc/sysctl.conf` is lost after reboot**. Write `/etc/sysctl.d/99-*.conf` uniformly across the three families, and verify the merged result with `sysctl --system`.
3. **Hard-coding `apt` in a playbook**. It fails on Rocky/Arch; use the `package` module or branch on `ansible_os_family`, folding `pacman`/`dnf` differences into variables.
4. **Never running `--check --diff`**. Automation widens the blast radius; rehearse before going live, same philosophy as `netplan try`.
5. **Two network managers coexisting**. NetworkManager + systemd-networkd both enabled, DHCP overwriting each other; confirm with `systemctl is-active` that only one manages a given NIC.
6. **SSH host key not accepted**, so ad-hoc commands all fail with `Host key verification failed`. Put target host keys into `known_hosts` ahead of time, or set `host_key_checking=False` in a controlled environment (man-in-the-middle risk; evaluate).
7. **No Python on the managed side**. Common on Alpine/minimal containers; install python3 or set `ansible_python_interpreter=/usr/bin/python3`.
8. **Secrets in Git**. Use `ansible-vault`, or an external secret management system; `--diff` output can also leak file contents, so be careful printing it in CI.
9. **Over-engineering the tool choice**. Puppet for a single host and two VMs costs more to run than it is worth; start with text + Git, and only add Ansible once scale appears.

The general order for fixing a pitfall: reproduce it in a test environment -> verify with a rollback-capable approach such as `--check --diff` or `netplan try` -> fix the inventory/config files -> then roll out to all. Never "edit and test" on production -- automation's blast radius is proportional to host count.

## References

- Ansible official documentation -- [docs.ansible.com](https://docs.ansible.com/)
- Ansible playbook common modules -- [docs.ansible.com/ansible/latest/collections/ansible/builtin/](https://docs.ansible.com/ansible/latest/modules/list_of_all_modules.html)
- Puppet documentation -- [puppet.com/docs](https://puppet.com/docs/)
- Chef documentation -- [docs.chef.io](https://docs.chef.io/)
- SaltProject documentation -- [docs.saltproject.io](https://docs.saltproject.io/)
- Arch Wiki - Sysctl -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Sysctl)
- Arch Wiki - pacman (when the control node is Arch) -- [wiki.archlinux.org](https://wiki.archlinux.org/title/Pacman)
- System Configuration Tools (network/time/hostname in depth) -- [basic/services/configuration_tools.md](../../basic/services/configuration_tools.md)
- System Service Management -- [basic/services/system_services.md](../../basic/services/system_services.md)
- `man sysctl`, `man ansible-playbook`

<!-- BACKLINKS-AUTO -->
## Related Pages

- [README](/commands/README.md)
- [system](/commands/system.md)
- [system_info](system_info.md)
- [automation](/system-management/automation.md)
