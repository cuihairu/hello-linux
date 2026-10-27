# Contents

> This page is a full link index derived from the sidebar in `docs/.vitepress/config.mts`; the sidebar is the source of truth for site navigation, and editing this page alone does not change navigation. When you add, remove, or move pages, update the sidebar first, then mirror the entry here, and run `npm run docs:check` to reconcile the two. Never change only one of them.

The English edition is being ported chapter by chapter from the Chinese edition; entries appear below as each chapter lands.

## Basics

- [Basics](./basic/README.md)
- [Technology Overview](./basic/overview.md)
- [Introduction to Linux](./basic/introduction.md)
  - [What Is Linux](./basic/introduction/what_is_linux.md)
  - [History of Linux](./basic/introduction/history.md)
  - [Linux Distributions](./basic/introduction/distributions.md)
- [Installing Linux](./basic/installation.md)
  - [Choosing a Distribution](./basic/installation/choose_distribution.md)
  - [Pre-installation Preparation](./basic/installation/preparation.md)
  - [Installation Process](./basic/installation/process.md)
- [Filesystems](./basic/filesystem.md)
  - [Filesystem Concepts](./basic/filesystem/concept.md)
  - [Directory Hierarchy](./basic/filesystem/hierarchy.md)
  - [File Permissions](./basic/filesystem/permissions.md)
- [The Boot Process](./basic/boot.md)
  - [BIOS and UEFI](./basic/boot/bios_uefi.md)
  - [The GRUB Bootloader](./basic/boot/grub.md)
- [Installing Software](./basic/packages.md)
  - [APT Package Management](./basic/packages/apt.md)
  - [YUM/DNF Package Management](./basic/packages/yum.md)
  - [Pacman Package Management](./basic/packages/pacman.md)
  - [Building from Source and Tarballs](./basic/packages/tarball.md)
- [User Management](./basic/users.md)
  - [Account Management](./basic/users/account_management.md)
  - [ACL Permission Control](./basic/users/acl_permissions.md)
  - [Disk Quotas](./basic/users/disk_quotas.md)
- [System Services](./basic/services.md)
  - [Managing System Services](./basic/services/system_services.md)
  - [Log Management](./basic/services/log_management.md)
  - [Configuration Tools](./basic/services/configuration_tools.md)
- [Security Basics](./basic/security.md)
  - [SELinux Concepts](./basic/security/concept.md)
  - [SELinux Modes](./basic/security/modes.md)
  - [Basic SELinux Commands](./basic/security/commands.md)
  - [SELinux Policy Configuration](./basic/security/policy_configuration.md)
- [Logging](./basic/log.md)
  - [System Logs](./basic/log/syslog.md)
  - [Log Rotation](./basic/log/rotation.md)

## Commands

- [Commands](./commands/README.md)
- [Basic Commands](./commands/basic.md)
  - [File Operations](./commands/basic/file.md)
  - [Directory Operations](./commands/basic/directory.md)
- [Text Processing](./commands/text.md)
  - [Text Processing Commands](./commands/text/text_processing.md)
  - [Editors and Viewers](./commands/text/editors.md)
- [Finding and Locating Files](./commands/find-and-locate.md)
- [Compression and Archiving](./commands/compression.md)
- [System Administration](./commands/system.md)
  - [Viewing System Information](./commands/system/system_info.md)
  - [Process Management](./commands/system/process.md)
  - [Memory Management](./commands/system/memory.md)
  - [Configuration Management Tools](./commands/system/configuration-management.md)
  - [System Monitoring Tools](./commands/system/monitoring.md)
- [Network Management](./commands/network.md)
  - [Network Management Commands](./commands/network/network.md)
  - [Network Tools](./commands/network/network-tools.md)
- [Package Management](./commands/package.md)
  - [Package Management Commands](./commands/package/package.md)

## Hardware

- [Hardware](./hardware/README.md)
- [Computer Architecture](./hardware/architecture.md)
- [CPU](./hardware/cpu.md)
- [Memory](./hardware/memory.md)
- [Storage Devices](./hardware/storage.md)
- [The Desktop Graphics Stack](./hardware/desktop-stack.md)
- [Network Devices](./hardware/network.md)

## System Administration

- [System Administration](./system-management/README.md)
- [Performance Tuning](./system-management/performance.md)
- [Backup and Recovery](./system-management/backup-and-recovery.md)
- [LVM Logical Volume Management](./system-management/lvm.md)
- [Operations Automation](./system-management/automation.md)
- [Scheduled Tasks](./system-management/scheduled-tasks.md)
- [Managing Services with systemd](./system-management/services-systemd.md)
- [Log Administration](./system-management/logging.md)
- [The Boot Process and Boot Repair](./system-management/boot-process.md)


## Servers

- [The Servers Section](./server/README.md)
- [Server Network Parameter Configuration](./server/network-parameters.md)
- [Routers and NAT](./server/routing-nat.md)
- [SSH Remote Login](./server/ssh.md)
- [Nginx](./server/web/nginx.md)
- [Apache](./server/web/apache.md)
- [MySQL](./server/database/mysql.md)
- [Redis](./server/redis.md)
- [FTP Server](./server/ftp.md)
- [Docker](./server/container/docker.md)
- [KVM Virtualization](./server/virtualization/kvm.md)
- [Cloud Computing and cloud-init](./server/cloud-computing.md)
- [CI/CD and Continuous Delivery](./server/ci-cd.md)
- [LDAP Unified Account Management](./server/ldap.md)
- [Prometheus + Grafana](./server/monitoring/prometheus.md)
- [DNS Server (BIND)](./server/dns/bind.md)
- [Mail Server (Postfix)](./server/mail/postfix.md)
- [DHCP Server (dhcpd / Kea)](./server/dhcp.md)
- [File Sharing Server (Samba)](./server/samba.md)
- [NFS Server](./server/nfs.md)
- [NTP Time Service (chrony)](./server/ntp.md)
## Scripting

- [Scripting](./script/README.md)
- [Bash Basics](./script/bash-basics.md)
- [Variables and Data Types](./script/variables.md)
- [Conditionals](./script/conditionals.md)
- [Loops](./script/loops.md)
- [Functions](./script/functions.md)
- [Text Processing](./script/text-processing.md)
- [Regular Expressions](./script/regex.md)
- [Script Debugging](./script/debugging.md)
- [Practical Examples](./script/examples.md)

## Security

- [Security](./security/README.md)
- [Firewall](./security/firewall.md)
- [Intrusion Detection](./security/intrusion-detection.md)
- [Encryption](./security/encryption.md)
- [Hardening](./security/hardening.md)
- [Advanced Account Privileges: PAM and sudo](./security/pam-sudo.md)
- [SELinux in Practice](./security/selinux.md)
- [AppArmor in Practice](./security/apparmor.md)

## Networking

- [The Network Chapter](./network/README.md)
- [Network Basics](./network/basics.md)
- [Firewall](./network/firewall.md)
- [VPN](./network/vpn.md)
- [Load Balancing](./network/load-balancing.md)
- [Network Monitoring](./network/network-monitoring.md)
- [Network Configuration Basics](./network/network-configuration.md)
- [Network Troubleshooting](./network/troubleshooting.md)
- [TCP/IP Essentials: Connections and Packets](./network/tcpip-essentials.md)
- [Hands-On Practice with Everyday Network Commands](./network/commands-practice.md)

## Kernel Source

- [Kernel Source](./source/README.md)
- [Getting the Source and Reading the Directory Layout](./source/source-tree.md)
- [Kernel Build and Module Development](./source/build-and-modules.md)
- [Cross-Compilation and Embedded](./source/cross-compile.md)
- [Kernel Tracing Toolbox](./source/tracing-tools.md)
- [System Calls: The Full Journey of One write()](./source/syscall-path.md)
- [Process Management and Scheduling (Source Part)](./source/process-scheduling.md)
- [Memory Management](./source/memory-management.md)
- [VFS and ext4: A Source Tour](./source/vfs-ext4.md)
- [Network Stack](./source/network-stack.md)
- [Interrupts and Timers](./source/interrupt-timers.md)
- [Device Driver Framework](./source/driver-framework.md)
- [Inter-Process Communication (IPC)](./source/ipc.md)
- [Selected Readings in User-Space Source](./source/userland.md)

## Research

- [Research Overview](./research/README.md)
- [Authoritative Books Survey](./research/authoritative-books.md)
- [Official Documentation Survey](./research/official-docs.md)
- [Application Scenarios Survey](./research/application-scenarios.md)
- [Coverage Matrix and Gap Table](./research/coverage-matrix.md)
- [Gap Fill and Revision Log](./research/gap-fill.md)

## Knowledge

- [Knowledge Base](./knowledge.md)
- [Glossary](./glossary.md)

## Structure Audit

- [hello-linux Documentation Structure Audit (2026-10-19)](./review/structure-audit-2026-10-19.md)
- [Content Review (2026-10-19)](./review/content-review-2026-10-19.md)
