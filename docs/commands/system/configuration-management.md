# 配置管理工具

配置管理工具用于自动化服务器配置、部署和管理。

> 内容参考自 Ansible、Puppet、Chef、SaltStack 官方文档和实际运维经验，见文末参考资料。

## 学习目标

- 理解配置管理工具的作用和优势
- 掌握 Ansible 的基本使用
- 了解 Puppet、Chef、SaltStack 的特点
- 学会使用配置管理工具自动化运维

## 1. 配置管理概述

### 1.1 什么是配置管理

```bash
# 配置管理是自动化管理服务器配置的过程
# 包括：软件安装、配置文件管理、服务管理、用户管理等

# 优势：
# 1. 一致性：确保所有服务器配置一致
# 2. 可重复性：可以重复执行相同的配置
# 3. 版本控制：配置可以版本化管理
# 4. 自动化：减少手动操作，提高效率
```

### 1.2 常用配置管理工具

| 工具 | 语言 | 架构 | 特点 |
|------|------|------|------|
| Ansible | Python | 无代理 | 简单易用，SSH 连接 |
| Puppet | Ruby | C/S 架构 | 功能强大，学习曲线陡峭 |
| Chef | Ruby | C/S 架构 | 灵活性高，需要编程基础 |
| SaltStack | Python | C/S 架构 | 性能好，支持大规模部署 |

## 2. Ansible

### 2.1 安装

```bash
# Debian/Ubuntu
sudo apt update
sudo apt install ansible

# RHEL/CentOS
sudo dnf install ansible

# 使用 pip 安装
pip install ansible
```

### 2.2 基本概念

```bash
# 控制节点：运行 Ansible 的机器
# 被管理节点：被 Ansible 管理的服务器
# 清单（Inventory）：定义被管理节点的文件
# 模块（Module）：执行具体任务的单元
# 剧本（Playbook）：定义任务序列的 YAML 文件
```

### 2.3 清单文件

```bash
# /etc/ansible/hosts 或自定义文件
# 简单清单
192.168.1.100
192.168.1.101

# 分组清单
[webservers]
192.168.1.100
192.168.1.101

[dbservers]
192.168.1.200

# 带变量的清单
[webservers]
192.168.1.100 ansible_user=root ansible_port=22
192.168.1.101 ansible_user=admin

# 范围表示
[webservers]
192.168.1.[100:110]
```

### 2.4 基本命令

```bash
# 测试连接
ansible all -m ping

# 执行命令
ansible all -m shell -a "uptime"

# 指定主机组
ansible webservers -m shell -a "df -h"

# 使用 sudo
ansible all -m shell -a "apt update" --become

# 复制文件
ansible all -m copy -a "src=/local/file dest=/remote/file"

# 安装软件
ansible all -m apt -a "name=nginx state=present"
```

### 2.5 Playbook

```yaml
# playbook.yml
---
- hosts: webservers
  become: yes
  tasks:
    - name: Install Nginx
      apt:
        name: nginx
        state: present
    
    - name: Start Nginx
      service:
        name: nginx
        state: started
        enabled: yes
    
    - name: Copy configuration
      copy:
        src: nginx.conf
        dest: /etc/nginx/nginx.conf
        owner: root
        group: root
        mode: '0644'
      notify: Restart Nginx
  
  handlers:
    - name: Restart Nginx
      service:
        name: nginx
        state: restarted
```

### 2.6 常用模块

```bash
# 文件模块
copy         # 复制文件
file         # 文件属性管理
template     # 模板文件
lineinfile   # 修改文件行

# 包管理模块
apt          # Debian/Ubuntu 包管理
yum          # RHEL/CentOS 包管理
pip          # Python 包管理

# 服务模块
service      # 服务管理
systemd      # systemd 服务管理

# 用户模块
user         # 用户管理
group        # 组管理

# 命令模块
shell        # 执行 shell 命令
command      # 执行命令
script       # 执行脚本
```

### 2.7 角色（Role）

```bash
# 角色目录结构
roles/
  nginx/
    tasks/
      main.yml
    handlers/
      main.yml
    templates/
      nginx.conf.j2
    files/
      index.html
    vars/
      main.yml
    defaults/
      main.yml

# 使用角色
---
- hosts: webservers
  roles:
    - nginx
    - php
```

## 3. Puppet

### 3.1 安装

```bash
# Debian/Ubuntu
sudo apt install puppet-agent

# RHEL/CentOS
sudo dnf install puppet-agent
```

### 3.2 基本概念

```bash
# Puppet 使用声明式语言定义配置
# 资源（Resource）：配置的基本单元
# 类（Class）：资源的集合
# 模块（Module）：类的集合
# 清单（Manifest）：定义配置的文件
```

### 3.3 资源示例

```puppet
# 安装软件包
package { 'nginx':
  ensure => installed,
}

# 管理服务
service { 'nginx':
  ensure => running,
  enable => true,
}

# 管理文件
file { '/etc/nginx/nginx.conf':
  ensure  => file,
  owner   => 'root',
  group   => 'root',
  mode    => '0644',
  content => template('nginx/nginx.conf.erb'),
}
```

## 4. Chef

### 4.1 安装

```bash
# 下载安装包
wget https://packages.chef.io/files/stable/chef-workstation/23.7.1042/ubuntu/22.04/chef-workstation_23.7.1042-1_amd64.deb
sudo dpkg -i chef-workstation_23.7.1042-1_amd64.deb
```

### 4.2 基本概念

```bash
# Chef 使用 Ruby 语言定义配置
# 食谱（Recipe）：定义配置的文件
# 烹饪书（Cookbook）：食谱的集合
# 节点（Node）：被管理的服务器
# 运行列表（Run List）：定义节点执行的食谱
```

### 4.3 食谱示例

```ruby
# 安装软件包
package 'nginx'

# 管理服务
service 'nginx' do
  action [:enable, :start]
end

# 管理文件
template '/etc/nginx/nginx.conf' do
  source 'nginx.conf.erb'
  owner 'root'
  group 'root'
  mode '0644'
  notifies :restart, 'service[nginx]'
end
```

## 5. SaltStack

### 5.1 安装

```bash
# Debian/Ubuntu
sudo apt install salt-master salt-minion

# RHEL/CentOS
sudo dnf install salt-master salt-minion
```

### 5.2 基本概念

```bash
# SaltStack 使用 Python 语言定义配置
# 主控端（Master）：控制节点
# 被控端（Minion）：被管理节点
# 状态（State）：定义配置的文件
# 粒子（Grain）：系统信息
```

### 5.3 状态示例

```yaml
# /srv/salt/nginx.sls
nginx:
  pkg.installed:
    - name: nginx
  service.running:
    - enable: True
    - require:
      - pkg: nginx

/etc/nginx/nginx.conf:
  file.managed:
    - source: salt://nginx/nginx.conf
    - user: root
    - group: root
    - mode: 644
    - watch_in:
      - service: nginx
```

## 6. 实战案例

### 6.1 使用 Ansible 部署 Web 服务器

```yaml
# deploy-webserver.yml
---
- hosts: webservers
  become: yes
  vars:
    nginx_port: 80
    document_root: /var/www/html
  
  tasks:
    - name: Install Nginx
      apt:
        name: nginx
        state: present
        update_cache: yes
    
    - name: Create document root
      file:
        path: "{{ document_root }}"
        state: directory
        owner: www-data
        group: www-data
        mode: '0755'
    
    - name: Copy index.html
      copy:
        src: index.html
        dest: "{{ document_root }}/index.html"
        owner: www-data
        group: www-data
        mode: '0644'
    
    - name: Configure Nginx
      template:
        src: nginx.conf.j2
        dest: /etc/nginx/sites-available/default
        owner: root
        group: root
        mode: '0644'
      notify: Restart Nginx
    
    - name: Enable site
      file:
        src: /etc/nginx/sites-available/default
        dest: /etc/nginx/sites-enabled/default
        state: link
      notify: Restart Nginx
    
    - name: Start Nginx
      service:
        name: nginx
        state: started
        enabled: yes
  
  handlers:
    - name: Restart Nginx
      service:
        name: nginx
        state: restarted
```

### 6.2 使用 Ansible 管理用户

```yaml
# manage-users.yml
---
- hosts: all
  become: yes
  vars:
    users:
      - name: admin
        groups: sudo
        shell: /bin/bash
        password: '$6$rounds=4096$...'
      - name: developer
        groups: www-data
        shell: /bin/bash
  
  tasks:
    - name: Create groups
      group:
        name: "{{ item.groups }}"
        state: present
      loop: "{{ users }}"
    
    - name: Create users
      user:
        name: "{{ item.name }}"
        groups: "{{ item.groups }}"
        shell: "{{ item.shell }}"
        password: "{{ item.password | default('!') }}"
        state: present
      loop: "{{ users }}"
```

## 参考资料

- [Ansible 文档](https://docs.ansible.com/)
- [Puppet 文档](https://puppet.com/docs/)
- [Chef 文档](https://docs.chef.io/)
- [SaltStack 文档](https://docs.saltproject.io/)