# Coverage Matrix and Gap Table

This page is step ③ of the four: mapping the source topics surveyed in the previous three pages onto this repository's pages item by item, and judging each as "covered / partially covered / gap / not covered". The criterion is whether the page contains substantive content on the topic, not whether the title looks similar.

Four verdicts:

| Verdict | Meaning |
|------|------|
| Covered | The repository has a dedicated page or a dedicated in-chapter section that thoroughly covers operation and mechanism |
| Partially covered | The topic is mentioned elsewhere but has no dedicated landing point; readers must assemble it themselves |
| Gap | Authoritative sources treat it as mandatory; the repository lacks it |
| Not covered | A conscious decision not to write: it belongs to device adaptation, application software catalogs, or other projects, at odds with this repository's "learn Linux itself" positioning |

## 1. Checked Against Bird's Basics Part (25 Chapters)

Source TOC in [Authoritative Books Survey](./authoritative-books.md) §1.1.

| Bird's chapter | Topic | Landing point in this repository | Verdict |
|---------|------|---------|------|
| Ch. 0 | Computer overview | [Technology Overview](../basic/overview.md) | Covered |
| Ch. 1 | What Linux is and how to learn it | [Introduction to Linux](../basic/introduction.md) | Covered |
| Ch. 2 | Host planning and disk partitioning | [Pre-Installation Preparation](../basic/installation/preparation.md), [Storage Devices](../hardware/storage.md) | Covered |
| Ch. 3 | Installing CentOS 7.x | [Installation Process](../basic/installation/process.md) | Covered (written for all three families) |
| Ch. 4 | First login and online help | [Basic Commands](../commands/basic.md) | Covered |
| Ch. 5 | File permissions and directory configuration | [File Permissions](../basic/filesystem/permissions.md) | Covered |
| Ch. 6 | Files and directories management | [File Operations](../commands/basic/file.md), [Directory Operations](../commands/basic/directory.md) | Covered |
| Ch. 7 | Disks and filesystem management | [Filesystems](../basic/filesystem.md), [Storage Devices](../hardware/storage.md), new page [LVM Logical Volume Management](../system-management/lvm.md) | Covered (hands-on LVM added this round) |
| Ch. 8 | Compression, archiving, and backup | [Compression and Archiving](../commands/compression.md), [Backup and Recovery](../system-management/backup-and-recovery.md) | Covered |
| Ch. 9 | The vim editor | [Text Editing and Viewing Tools](../commands/text/editors.md) | Covered |
| Ch. 10 | Getting to know and use BASH | [Bash Basics](../script/bash-basics.md) | Covered |
| Ch. 11 | Regular expressions and document formatting | [Regular Expressions](../script/regex.md) | Covered (formatting not listed separately) |
| Ch. 12 | Learning Shell Scripts | The whole [Scripting part](../script/README.md) | Covered |
| Ch. 13 | Account management and ACL permissions | [Account Management](../basic/users/account_management.md), [ACL Permissions](../basic/users/acl_permissions.md) | Covered |
| Ch. 14 | Disk quotas and advanced filesystems | [Disk Quotas](../basic/users/disk_quotas.md) | Covered |
| Ch. 15 | Scheduled tasks (crontab) | [Scheduled Tasks](../system-management/scheduled-tasks.md) | Covered |
| Ch. 16 | Process management and an introduction to SELinux | [Process Management](../commands/system/process.md), [SELinux Concepts](../basic/security/concept.md) | Covered |
| Ch. 17 | Understanding system services (daemons) | [System Service Management](../basic/services/system_services.md), [systemd Services and Program Management](../system-management/services-systemd.md) | Covered |
| Ch. 18 | Understanding and analyzing logs | [System Logging](../basic/log/syslog.md), [Logging System Management](../system-management/logging.md) | Covered |
| Ch. 19 | Boot process, module management, and the loader | [Boot Process](../basic/boot.md), [Boot Process and Boot Troubleshooting](../system-management/boot-process.md) | Covered |
| Ch. 20 | Basic system settings and backup strategy | [System Configuration Tools](../basic/services/configuration_tools.md), [Backup and Recovery](../system-management/backup-and-recovery.md) | Covered |
| Ch. 21 | Software installation: source code and tarballs | New page [Source Builds and Tarball Installation](../basic/packages/tarball.md) (2026-10-10) | Partially covered → page added |
| Ch. 22 | Software installation with RPM, SRPM, and YUM | [APT Package Management](../basic/packages/apt.md), [YUM/DNF Package Management](../basic/packages/yum.md), new page [Pacman Package Management](../basic/packages/pacman.md) | Covered (all three families; the Arch family added this round) |
| Ch. 23 | X Window setup | New page [Desktop Graphics Stack](../hardware/desktop-stack.md) | Gap → page added this round |
| Ch. 24 | Kernel compilation and management | [Source part](../source/README.md), [Kernel Build and Module Development](../source/build-and-modules.md) | Covered |

## 2. Checked Against Bird's Server Setup Part (12 Chapters)

Source TOC in [Authoritative Books Survey](./authoritative-books.md) §1.2.

| Bird's chapter | Topic | Landing point in this repository | Verdict |
|---------|------|---------|------|
| Ch. 0 | Applications and learning server skills | [Server part](../server/README.md) | Covered |
| Ch. 1 | Host hardening workflow | [Security Hardening](../security/hardening.md), [Firewall](../security/firewall.md) | Covered |
| Ch. 2 | Installing and tuning virtual machines | New page [KVM Virtualization](../server/virtualization/kvm.md) | Gap → page added this round |
| Ch. 3 | An introduction to SELinux | [SELinux in Practice](../security/selinux.md), [SELinux Concepts](../basic/security/concept.md) | Covered |
| Ch. 4 | Networking basics | [Networking Basics](../network/basics.md) | Covered |
| Ch. 5 | Establishing and checking network connections | [Network Configuration Basics](../network/network-configuration.md), [Network Management Commands](../commands/network/network.md) | Covered |
| Ch. 6 | Planning the whole LAN environment | [Network Parameter Configuration](../server/network-parameters.md), [Routing and NAT](../server/routing-nat.md) | Covered |
| Ch. 7 | Linux firewall setup | [Firewall](../network/firewall.md), [Firewall (security part)](../security/firewall.md) | Covered |
| Ch. 8 | Domain name server DNS | [DNS](../server/dns/bind.md) | Covered |
| Ch. 9 | DHCP and NTP | [DHCP Server](../server/dhcp.md), [NTP Time Service](../server/ntp.md) | Covered |
| Ch. 10 | Remote connection servers SSH / X / VNC | New page [SSH Remote Login](../server/ssh.md) (2026-10-10); client usage in [Network Tools](../commands/network/network-tools.md) | Gap → page added |
| Ch. 11 | Unified account management with LDAP | New page [LDAP Unified Account Management](../server/ldap.md) | Gap → page added |

## 3. Checked Against ArchWiki's Eight Top-Level Categories

Category structure and entry counts in [Official Documentation Survey](./official-docs.md) §2. This table lists only the categories relevant to this repository's positioning.

| ArchWiki category | Landing point in this repository | Verdict |
|--------------|---------|------|
| 1.3 Installation | [Installing Linux](../basic/installation.md) | Covered |
| 4.2 CPU / 4.16 Storage | [CPU](../hardware/cpu.md), [Storage Devices](../hardware/storage.md) | Covered |
| 4.6 Graphics / 4.15 Sound | New page [Desktop Graphics Stack](../hardware/desktop-stack.md) | Gap → page added this round (sound not listed separately) |
| 6.4 Firewall / 6.7 Network configuration / 6.8 Network monitoring | [Firewall](../network/firewall.md), [Network Configuration Basics](../network/network-configuration.md), [Network Monitoring](../network/network-monitoring.md) | Covered |
| 6.12 Servers / 6.3.2 Mail server | [Server part](../server/README.md) (21 pages), [Mail](../server/mail/postfix.md) | Covered |
| 8.8 File systems | [Filesystems](../basic/filesystem.md), new page [LVM Logical Volume Management](../system-management/lvm.md) | Covered |
| 8.12 Kernel | [Source part](../source/README.md), 14 pages | Covered |
| 8.18 Package management | [Software Installation](../basic/packages.md), new page [Pacman Package Management](../basic/packages/pacman.md), [Package Management Commands](../commands/package/package.md) | Covered |
| 8.20 Security | [Security part](../security/README.md), [SELinux Concepts](../basic/security/concept.md), new page [AppArmor in Practice](../security/apparmor.md) | Covered (both MAC systems complete) |
| 8.23 Virtualization | [Containers](../server/container/docker.md), new page [KVM Virtualization](../server/virtualization/kvm.md) | Covered |
| 8.6 Generalities of desktop / 8.10 Graphical user interfaces / 8.14 Localization | New page [Desktop Graphics Stack](../hardware/desktop-stack.md) | Gap → page added this round |
| 8.1 Backup / 8.2 Boot process / 8.15 Logging / 8.16 Monitoring | [Backup and Recovery](../system-management/backup-and-recovery.md), [Boot Process and Boot Troubleshooting](../system-management/boot-process.md), [Logging System Management](../system-management/logging.md), [System Monitoring Tools](../commands/system/monitoring.md) | Covered |

Categories explicitly not followed: 4.9 Laptops (33 vendor subcategories), the 2.x development toolchains, 6.10 Peer-to-peer and 6.13 Streaming, and 6.15 VoIP -- these are device adaptation and application software catalogs, judged **not covered** rather than as gaps.

## 4. Checked Against USAH 5e (31 Chapters)

Source TOC in [Authoritative Books Survey](./authoritative-books.md) §2.1 (admin.com's official sample TOC, Tier A). USAH targets professional operations; chapter-by-chapter verdicts:

| USAH chapter | Topic | Landing point in this repository | Verdict |
|----------|------|---------|------|
| 1 | Where to Start | [Technology Overview](../basic/overview.md), [Introduction to Linux](../basic/introduction.md) | Covered |
| 2 | Booting and System Management Daemons | [Boot Process](../basic/boot.md), [Boot Process and Boot Troubleshooting](../system-management/boot-process.md), [systemd Services and Program Management](../system-management/services-systemd.md) | Covered |
| 3 | Access Control and Rootly Powers | [PAM and sudo](../security/pam-sudo.md), [Account Management](../basic/users/account_management.md) | Covered |
| 4 | Process Control | [Process Management](../commands/system/process.md) | Covered |
| 5 | The Filesystem | [Filesystems](../basic/filesystem.md), [File Permissions](../basic/filesystem/permissions.md) | Covered |
| 6 | Software Installation and Management | The [Software Installation](../basic/packages.md) chapter (four pages: APT, YUM/DNF, Pacman, Tarball) | Covered |
| 7 | Scripting and the Shell | [Scripting part](../script/README.md) | Covered |
| 8 | User Management | [Account Management](../basic/users/account_management.md), [ACL Permissions](../basic/users/acl_permissions.md), [Disk Quotas](../basic/users/disk_quotas.md) | Covered |
| 9 | Cloud Computing | New page [Cloud Computing and cloud-init](../server/cloud-computing.md) (2026-10-10) | Gap → page added |
| 10 | Logging | [System Logging](../basic/log/syslog.md), [Logging System Management](../system-management/logging.md) | Covered |
| 11 | Drivers and the Kernel | [Device Driver Framework](../source/driver-framework.md), [Kernel Build and Module Development](../source/build-and-modules.md) | Covered |
| 12 | Printing | Printing is a desktop/office peripheral, weakly related to the server-operations main line; CUPS appears only as a unit example in [systemd Services and Program Management](../system-management/services-systemd.md) | Not covered (logged) |
| 13 | TCP/IP Networking | [Networking Basics](../network/basics.md), [TCP/IP Essentials](../network/tcpip-essentials.md) | Covered |
| 14 | Physical Networking | [Network Devices](../hardware/network.md) | Covered |
| 15 | IP Routing | [Routing and NAT](../server/routing-nat.md) | Covered |
| 16 | DNS | [DNS](../server/dns/bind.md) | Covered |
| 17 | Single Sign-On | [LDAP Unified Account Management](../server/ldap.md) connects the Kerberos and FreeIPA concepts; a full SSO deployment needs a KDC and a domain environment, beyond the single-machine learning positioning | Partially covered → logged as not-to-be-filled |
| 18 | Electronic Mail | [Mail Server Postfix](../server/mail/postfix.md) | Covered |
| 19 | Web Hosting | [Nginx](../server/web/nginx.md), [Apache](../server/web/apache.md) | Covered |
| 20 | Storage | [Storage Devices](../hardware/storage.md), [LVM Logical Volume Management](../system-management/lvm.md) | Covered |
| 21 | The Network File System | [NFS](../server/nfs.md) | Covered |
| 22 | SMB | [Samba](../server/samba.md) | Covered |
| 23 | Configuration Management | [Automation](../system-management/automation.md) (scripting vs Ansible selection plus hands-on playbooks) | Covered |
| 24 | Virtualization | [KVM Virtualization](../server/virtualization/kvm.md) | Covered |
| 25 | Containers | [Containers](../server/container/docker.md) | Covered |
| 26 | Continuous Integration and Delivery | New page [CI/CD and Continuous Delivery](../server/ci-cd.md) (2026-10-10) | Gap → page added |
| 27 | Security | [Security part](../security/README.md) (hardening, plus SELinux and AppArmor for both MAC systems) | Covered |
| 28 | Monitoring | [Prometheus Monitoring](../server/monitoring/prometheus.md), [System Monitoring Tools](../commands/system/monitoring.md) | Covered |
| 29 | Performance Analysis | [Performance Tuning](../system-management/performance.md) | Covered |
| 30 | Data Center Basics | Data center facilities and out-of-band management belong to data center operations, beyond the "learn Linux itself" positioning | Not covered |
| 31 | Methodology, Policy, and Politics | Organizational processes and soft skills, not systems-technical | Not covered |

Subtotal for the 31 chapters: 25 covered, 2 gaps → page added (cloud computing, CI/CD), 1 partially covered → logged as not-to-be-filled (SSO), 3 not covered (printing, data center, organizational processes).

## 5. Checked Against TLCL (36 Chapters)

Source TOC in [Authoritative Books Survey](./authoritative-books.md) §2.1 (the official TLCL-25.12A PDF TOC, Tier A). TLCL is the depth baseline for the command line and script writing; the 4-part 36-chapter verdicts:

| TLCL chapter | Topic | Landing point in this repository | Verdict |
|----------|------|---------|------|
| 1 | What Is the Shell? | [Bash Basics](../script/bash-basics.md) | Covered |
| 2 | Navigation | [Directory Operations](../commands/basic/directory.md) | Covered |
| 3 | Exploring the System | [File Operations](../commands/basic/file.md), [Directory Hierarchy](../basic/filesystem/hierarchy.md) | Covered |
| 4 | Manipulating Files and Directories | [File Operations](../commands/basic/file.md), [Directory Operations](../commands/basic/directory.md) | Covered |
| 5 | Working with Commands | [Basic Commands](../commands/basic.md) (type, alias, and man help) | Covered |
| 6 | Redirection | [Bash Basics](../script/bash-basics.md) (redirection), [File Operations](../commands/basic/file.md) | Covered |
| 7 | Seeing the World as the Shell Sees It | [Bash Basics](../script/bash-basics.md) (expansion and quoting), [Variables and Data Types](../script/variables.md) | Covered |
| 8 | Advanced Keyboard Tricks | Job control is in [Process Management](../commands/system/process.md) (jobs/fg/bg); readline key bindings and history extensions are terminal-usage habits, not listed separately | Partially covered → logged as not-to-be-filled |
| 9 | Permissions | [File Permissions](../basic/filesystem/permissions.md) | Covered |
| 10 | Processes | [Process Management](../commands/system/process.md) | Covered |
| 11 | The Environment | [Variables and Data Types](../script/variables.md) (environment variables and startup files), [Bash Basics](../script/bash-basics.md) | Covered |
| 12 | A Gentle Introduction to vi(m) | [Text Editing and Viewing Tools](../commands/text/editors.md) | Covered |
| 13 | Customizing the Prompt | PS1 prompt customization has zero landing points repo-wide; it is personal terminal configuration, not affecting the system administration main line | Not covered (logged) |
| 14 | Package Management | [APT Package Management](../basic/packages/apt.md), [YUM/DNF Package Management](../basic/packages/yum.md), [Pacman Package Management](../basic/packages/pacman.md) | Covered |
| 15 | Storage Media | [Filesystems](../basic/filesystem.md) (mounting and unmounting), [Storage Devices](../hardware/storage.md) | Covered |
| 16 | Networking | [Network Management Commands](../commands/network/network.md) | Covered |
| 17 | Searching for Files | [Find and Locate](../commands/find-and-locate.md) | Covered |
| 18 | Archiving and Backup | [Compression and Archiving](../commands/compression.md), [Backup and Recovery](../system-management/backup-and-recovery.md) | Covered |
| 19 | Regular Expressions | [Regular Expressions](../script/regex.md) | Covered |
| 20 | Text Processing | [Text Processing](../commands/text/text_processing.md) | Covered |
| 21 | Formatting Output | printf and fmt are in [Text Processing](../commands/text/text_processing.md); typesetting utilities like nl, fold, pr are not listed separately | Partially covered → logged as not-to-be-filled |
| 22 | Printing | Same verdict as USAH ch. 12 | Not covered (logged) |
| 23 | Compiling Programs | [Source Builds and Tarball Installation](../basic/packages/tarball.md), [Kernel Build and Module Development](../source/build-and-modules.md) | Covered |
| 24 | Writing Your First Script | [Bash Basics](../script/bash-basics.md) | Covered |
| 25 | Starting a Project | [Scripting part](../script/README.md), [Practical Examples](../script/examples.md) | Covered |
| 26 | Top-Down Design | [Functions](../script/functions.md) | Covered |
| 27 | Flow Control: Branching with if | [Conditionals](../script/conditionals.md) | Covered |
| 28 | Reading Keyboard Input | [Conditionals](../script/conditionals.md), [Loops](../script/loops.md) (read for interactive input) | Covered |
| 29 | Flow Control: Looping with while and until | [Loops](../script/loops.md) | Covered |
| 30 | Troubleshooting | [Script Debugging](../script/debugging.md) | Covered |
| 31 | Flow Control: Branching with case | [Conditionals](../script/conditionals.md) | Covered |
| 32 | Positional Parameters | [Functions](../script/functions.md), [Script Debugging](../script/debugging.md) (positional parameters) | Covered |
| 33 | Flow Control: Looping with for | [Loops](../script/loops.md) | Covered |
| 34 | Strings and Numbers | [Variables and Data Types](../script/variables.md) (arithmetic expansion), [Regular Expressions](../script/regex.md) | Covered |
| 35 | Arrays | [Variables and Data Types](../script/variables.md), [Practical Examples](../script/examples.md) (arrays) | Covered |
| 36 | Exotica | Heredocs and process substitution are scattered across [Loops](../script/loops.md) and [Practical Examples](../script/examples.md); the remaining misc tricks are not systematized separately | Partially covered → logged as not-to-be-filled |

Subtotal for the 36 chapters: 31 covered, 3 partially covered → logged as not-to-be-filled (readline/history, typesetting output, shell miscellany), 2 not covered (prompt customization, printing).

## 6. Checked Against The Debian Handbook (16 Chapters)

Source TOC in [Authoritative Books Survey](./authoritative-books.md) §2.1 (debian-handbook.info's official online TOC, Tier A, Bullseye edition). This book is the Debian family's systematic reference main line; chapter-by-chapter verdicts:

| Debian Handbook chapter | Topic | Landing point in this repository | Verdict |
|----------------------|------|---------|------|
| 1 | The Debian Project | [Choosing a Distribution](../basic/installation/choose_distribution.md), [Introduction to Linux](../basic/introduction.md) | Covered |
| 2 | Presenting the Case Study | The book's continuous narrative vehicle (the fictional host rolala's installation and evolution), not an independent technical topic | Not covered |
| 3 | Analyzing the Existing Setup and Migrating | [Pre-Installation Preparation](../basic/installation/preparation.md) (hardware inventory and backup), [Backup and Recovery](../system-management/backup-and-recovery.md); the legacy-migration perspective is in [Application Scenarios Survey](./application-scenarios.md) §1.1 | Covered |
| 4 | Installation | [Installing Linux](../basic/installation.md) (three pages, written for all three families) | Covered |
| 5 | Packaging System: Tools and Fundamental Principles | [Software Installation](../basic/packages.md), [Package Management Commands](../commands/package/package.md) (underlying tools: dpkg/rpm/pacman compared) | Covered |
| 6 | Maintenance and Updates: The APT Tools | [APT Package Management](../basic/packages/apt.md) | Covered |
| 7 | Solving Problems and Finding Relevant Information | [Basic Commands](../commands/basic.md) (man help), [Network Troubleshooting](../network/troubleshooting.md), and each part's troubleshooting sections | Covered |
| 8 | Basic Configuration: Network, Accounts, Printing... | [Network Configuration Basics](../network/network-configuration.md), [Account Management](../basic/users/account_management.md); the printing part follows the USAH ch. 12 verdict | Covered (printing registered as not covered) |
| 9 | Unix Services | [System Service Management](../basic/services/system_services.md), [systemd Services and Program Management](../system-management/services-systemd.md) | Covered |
| 10 | Network Infrastructure | [DNS](../server/dns/bind.md), [DHCP Server](../server/dhcp.md), [NTP Time Service](../server/ntp.md), [Routing and NAT](../server/routing-nat.md) | Covered |
| 11 | Network Services: Postfix, Apache, NFS, Samba, Squid, LDAP, SIP, XMPP, TURN | Postfix, Apache, NFS, Samba, and LDAP all have dedicated pages; the Squid proxy and the SIP/XMPP/TURN real-time communication protocols have no landing points | Partially covered → logged as not-to-be-filled |
| 12 | Advanced Administration | [LVM Logical Volume Management](../system-management/lvm.md), [Backup and Recovery](../system-management/backup-and-recovery.md), [Performance Tuning](../system-management/performance.md) | Covered |
| 13 | Workstation | [Desktop Graphics Stack](../hardware/desktop-stack.md) | Covered |
| 14 | Security | [Security part](../security/README.md) (hardening, firewall, both MAC systems, encryption) | Covered |
| 15 | Creating a Debian Package | The Debian packaging workflow (`dpkg-buildpackage`, debhelper) has zero landing points repo-wide; source builds are covered by [Source Builds and Tarball Installation](../basic/packages/tarball.md) | Partially covered → logged as not-to-be-filled |
| 16 | Conclusion: Debian's Future | A community outlook, not a systems-technical topic | Not covered |

Subtotal for the 16 chapters: 12 covered, 2 partially covered → logged as not-to-be-filled (real-time communication and proxy services, the Debian packaging workflow), 2 not covered (the case-study narrative chapter, the community outlook chapter).

## 7. Checked Against How Linux Works 3e (17 Chapters)

Source TOC in [Authoritative Books Survey](./authoritative-books.md) §2.1 (nostarch.com's official product page + detailed TOC PDF, Tier A, fetched 2026-10-10). This book covers the "how/why" of the kernel and system mechanisms; chapter-by-chapter verdicts:

| How Linux Works chapter | Topic | Landing point in this repository | Verdict |
|----------------------|------|---------|------|
| 1 | The Big Picture | [Technology Overview](../basic/overview.md), [Introduction to Linux](../basic/introduction.md) | Covered |
| 2 | Basic Commands and Directory Hierarchy | [Basic Commands](../commands/basic.md), [Directory Hierarchy](../basic/filesystem/hierarchy.md) | Covered |
| 3 | Devices | Device files get one line in [Directory Hierarchy](../basic/filesystem/hierarchy.md); sysfs semantics are scattered across the source part and [Storage Devices](../hardware/storage.md); user-space device files, udev rules, and sysfs queries have no dedicated landing point | Partially covered → logged as not-to-be-filled |
| 4 | Disks and Filesystems | [Filesystems](../basic/filesystem.md), [Storage Devices](../hardware/storage.md), [LVM Logical Volume Management](../system-management/lvm.md) | Covered |
| 5 | How the Linux Kernel Boots | [Boot Process](../basic/boot.md), [Boot Process and Boot Troubleshooting](../system-management/boot-process.md) | Covered |
| 6 | How User Space Starts | [Boot Process and Boot Troubleshooting](../system-management/boot-process.md), [systemd Services and Program Management](../system-management/services-systemd.md) | Covered |
| 7 | System Configuration: Logging, System Time, Batch Jobs, and Users | [Logging System Management](../system-management/logging.md), [Scheduled Tasks](../system-management/scheduled-tasks.md), [NTP Time Service](../server/ntp.md), [Account Management](../basic/users/account_management.md), [PAM and sudo](../security/pam-sudo.md) | Covered |
| 8 | A Closer Look at Processes and Resource Utilization | [Process Management](../commands/system/process.md), [System Monitoring Tools](../commands/system/monitoring.md), [Performance Tuning](../system-management/performance.md); cgroups appear in the container and KVM pages | Covered |
| 9 | Understanding Your Network and Its Configuration | [Network Configuration Basics](../network/network-configuration.md), [TCP/IP Essentials](../network/tcpip-essentials.md), [Routing and NAT](../server/routing-nat.md), [Firewall](../network/firewall.md) | Covered |
| 10 | Network Applications and Services | [SSH Remote Login](../server/ssh.md) (fail2ban connects to [Intrusion Detection](../security/intrusion-detection.md)), [Network Tools](../commands/network/network-tools.md) | Covered |
| 11 | Introduction to Shell Scripts | The whole [Scripting part](../script/README.md) | Covered |
| 12 | Network File Transfer and Sharing | rsync is in [Backup and Recovery](../system-management/backup-and-recovery.md), plus [NFS](../server/nfs.md) and [Samba](../server/samba.md); SSHFS is not listed separately | Covered (SSHFS not listed separately) |
| 13 | User Environments | [Variables and Data Types](../script/variables.md) (environment variables and startup files); the prompt part follows the TLCL ch. 13 registration | Covered |
| 14 | A Brief Survey of the Linux Desktop and Printing | [Desktop Graphics Stack](../hardware/desktop-stack.md); the printing part follows the USAH ch. 12 verdict | Covered (printing registered as not covered) |
| 15 | Development Tools | The gcc/make/lex/yacc development toolchain follows the ArchWiki round's "2.x development toolchains not covered" verdict | Not covered (logged) |
| 16 | Introduction to Compiling Software from C Source Code | [Source Builds and Tarball Installation](../basic/packages/tarball.md) | Covered |
| 17 | Virtualization | [KVM Virtualization](../server/virtualization/kvm.md), [Containers](../server/container/docker.md); the chapter's Kubernetes section follows the Linux Bible ch. 31 verdict | Covered |

Subtotal for the 17 chapters: 15 covered, 1 partially covered → logged as not-to-be-filled (device files and udev), 1 not covered (the development toolchain, following the existing verdict).

## 8. Checked Against The Linux Bible 11e (31 Chapters)

Source TOC in [Authoritative Books Survey](./authoritative-books.md) §2.1 (Wiley's official product page + TOC PDF, Tier A, fetched 2026-10-10). This book targets beginner-to-intermediate hands-on distribution work; chapter-by-chapter verdicts:

| Linux Bible chapter | Topic | Landing point in this repository | Verdict |
|------------------|------|---------|------|
| 1 | Starting with Linux | [Introduction to Linux](../basic/introduction.md), [Technology Overview](../basic/overview.md), [Choosing a Distribution](../basic/installation/choose_distribution.md) | Covered |
| 2 | Creating the Perfect Linux Desktop | [Desktop Graphics Stack](../hardware/desktop-stack.md) | Covered |
| 3 | Using the Shell | [Bash Basics](../script/bash-basics.md), [Basic Commands](../commands/basic.md) | Covered |
| 4 | Moving Around the Filesystem | [Directory Operations](../commands/basic/directory.md), [File Operations](../commands/basic/file.md) | Covered |
| 5 | Working with Text Files | [Text Editing and Viewing Tools](../commands/text/editors.md), [Text Processing](../commands/text/text_processing.md) | Covered |
| 6 | Managing Running Processes | [Process Management](../commands/system/process.md) | Covered |
| 7 | Writing Simple Shell Scripts | [Bash Basics](../script/bash-basics.md), [Scripting part](../script/README.md) | Covered |
| 8 | Learning System Administration | The whole [system-management part](../system-management/README.md) | Covered |
| 9 | Installing Linux | [Installing Linux](../basic/installation.md) (written for all three families) | Covered |
| 10 | Getting and Managing Software | The four pages of [Software Installation](../basic/packages.md), [Package Management Commands](../commands/package/package.md) | Covered |
| 11 | Managing User Accounts | [Account Management](../basic/users/account_management.md) | Covered |
| 12 | Managing Disks and Filesystems | [Filesystems](../basic/filesystem.md), [Storage Devices](../hardware/storage.md), [LVM Logical Volume Management](../system-management/lvm.md) | Covered |
| 13 | Understanding Server Administration | [Server part](../server/README.md), [SSH Remote Login](../server/ssh.md), [System Monitoring Tools](../commands/system/monitoring.md) | Covered |
| 14 | Administering Networking | [Network Configuration Basics](../network/network-configuration.md), [Network Management Commands](../commands/network/network.md) | Covered |
| 15 | Starting and Stopping Services | [systemd Services and Program Management](../system-management/services-systemd.md) | Covered |
| 16 | Configuring a Print Server | Same verdict as USAH ch. 12 | Not covered (logged) |
| 17 | Configuring a Web Server | [Nginx](../server/web/nginx.md), [Apache](../server/web/apache.md) | Covered |
| 18 | Configuring an FTP Server | [FTP Server](../server/ftp.md) | Covered |
| 19 | Configuring a Windows File Sharing (Samba) Server | [Samba](../server/samba.md) | Covered |
| 20 | Configuring an NFS File Server | [NFS](../server/nfs.md) | Covered |
| 21 | Troubleshooting Linux | [Network Troubleshooting](../network/troubleshooting.md), [Script Debugging](../script/debugging.md), [Boot Process and Boot Troubleshooting](../system-management/boot-process.md) | Covered |
| 22 | Configuring an Artificial Intelligence Chatbot | Local LLM deployment and application configuration belong to application software, at odds with the "learn Linux itself" positioning | Not covered |
| 23 | Understanding Basic Linux Security | [Security Hardening](../security/hardening.md), [Firewall](../security/firewall.md) | Covered |
| 24 | Understanding Advanced Linux Security | [Encryption and Certificates](../security/encryption.md), [PAM and sudo](../security/pam-sudo.md) | Covered |
| 25 | Enhancing Linux Security with SELinux | [SELinux in Practice](../security/selinux.md), [SELinux Concepts](../basic/security/concept.md) | Covered |
| 26 | Securing Linux on a Network | [Firewall](../network/firewall.md), [SSH Remote Login](../server/ssh.md) (hardening section) | Covered |
| 27 | Shifting to Clouds and Containers | [Cloud Computing and cloud-init](../server/cloud-computing.md), [Containers](../server/container/docker.md) | Covered |
| 28 | Using Linux for Cloud Computing | [Cloud Computing and cloud-init](../server/cloud-computing.md) (the IaaS model, instances and images, security groups and VPC) | Covered |
| 29 | Deploying Linux to the Cloud | Cloud vendor (AWS etc.) consoles and platform-specific work, beyond the single-machine learning positioning; this repository's cloud computing page goes only as far as concepts and cross-cloud general mechanisms | Partially covered → logged as not-to-be-filled |
| 30 | Automating Apps and Infrastructure with Ansible | [Automation](../system-management/automation.md) | Covered |
| 31 | Deploying Applications as Containers with Kubernetes | Multi-node orchestration has no dedicated landing point; the [Containers](../server/container/docker.md) page's Compose section already states the boundary judgment "revisit Kubernetes once the scope exceeds a single machine" | Partially covered → logged as not-to-be-filled |

Subtotal for the 31 chapters: 27 covered, 2 partially covered → logged as not-to-be-filled (cloud vendor console deployment, Kubernetes orchestration), 2 not covered (the print server, the AI chatbot).

## 9. Checked by Application Scenario

Scenario requirements in [Application Scenarios Survey](./application-scenarios.md) §2.

| Scenario | Key requirement | This repository's state | Verdict |
|------|---------|---------|------|
| Server and cloud | Side-by-side commands for the three distro families, a legacy-system migration perspective, multiple architectures | 21 server pages + 9 system-management pages, with three-family comparisons throughout | Covered |
| Edge and embedded | Cross-compilation, device trees, boot chain, no graphical interface | Previously device trees were only mentioned in [Device Driver Framework](../source/driver-framework.md) | Gap → page added: [Cross-Compilation and Embedded](../source/cross-compile.md) |
| Desktop and development | Xorg/Wayland, display managers, desktop environments, input methods and fonts | Scattered mentions | Gap → page added this round |
| Operations automation | Scheduling, orchestration, monitoring, backup, account consistency | The automation, monitoring, backup, and scheduling main lines existed; account consistency added | Gap → page added: [LDAP Unified Account Management](../server/ldap.md) |
| Security and compliance | MAC/mandatory access control differences across the two distro families | SELinux spans a system; AppArmor previously got one comparison-table row | Gap → page added this round |
| Virtualization | KVM/libvirt machine and network setup, and the division of labor with containers | The hardware part gave install commands; the server part previously had only a container page | Gap → page added: [KVM Virtualization](../server/virtualization/kvm.md) |

## 10. Gap Summary

| Type | Count | Details |
|------|------|------|
| Gap → page added | 11 | Arch package management (Pacman), hands-on LVM, the desktop graphics stack, KVM virtualization, AppArmor, the application scenarios page; later increments completed: cross-compilation & embedded and LDAP unified accounts (2026-10-09), SSH remote login, cloud computing & cloud-init, and CI/CD & continuous delivery (USAH, 2026-10-10) |
| Gap → logged then filled | 2 | The embedded cross-compilation topic and LDAP unified accounts (logged in the first round, filled in the second; folded into the row above) |
| Partially covered → revised/added this round | 4 | The storage part's LVM pointer landing, the basics software installation chapter's TOC completing the third family, the systemd official documentation citation links (the services-systemd and boot-process pages); the source-build/tarball page (2026-10-10) |
| Not covered (intentional) | 4 classes | Laptop adaptation, development toolchains, peer-to-peer/streaming, VoIP |
| Registered by the USAH/TLCL chapter-by-chapter round (2026-10-10) | 6 classes not filled | Printing/CUPS (USAH ch. 12 / TLCL ch. 22, a desktop/office peripheral), full SSO deployment (USAH ch. 17, needs a KDC and a domain environment), readline key bindings and history extensions (TLCL ch. 8), typesetting utilities (TLCL ch. 21), prompt customization (TLCL ch. 13), shell miscellany (TLCL ch. 36); additionally USAH ch. 30 (data center facilities) and ch. 31 (organizational processes) judged not covered |
| Registered by the Debian Handbook chapter-by-chapter round (2026-10-10) | 2 classes not filled | Real-time communication and proxy services (ch. 11's Squid and SIP/XMPP/TURN -- enterprise-specific protocol stacks, weakly related to the single-machine main line; Postfix/Apache/NFS/Samba/LDAP already have dedicated pages), the Debian packaging workflow (ch. 15 -- `dpkg-buildpackage` is a distribution packager skill, not the system administration main line; source builds are covered by the tarball page); additionally ch. 2 (case-study narrative) and ch. 16 (community outlook) judged not covered |
| Registered by the How Linux Works / Linux Bible chapter-by-chunk round (2026-10-10, second round) | 4 classes not filled | Device files and udev (HLW ch. 3 -- the mechanisms are scattered across storage, systemd, and the source part; the rule details are device adaptation), cloud vendor console deployment (Linux Bible ch. 29, platform-specific work), Kubernetes orchestration (Linux Bible ch. 31 and HLW's section -- the container page already carries the single-machine/multi-node boundary judgment), AI chatbot deployment (Linux Bible ch. 22, application software); additionally HLW ch. 15 (development toolchains) follows the existing not-covered verdict and Linux Bible ch. 16 (print server) follows the printing registration |

Execution records of this round's page additions and revisions are in [Gap Fill and Revision Log](./gap-fill.md).

<!-- BACKLINKS-AUTO -->
## Related Pages

- [knowledge](/knowledge.md)
- [README](README.md)
- [application-scenarios](application-scenarios.md)
- [authoritative-books](authoritative-books.md)
- [gap-fill](gap-fill.md)
- [official-docs](official-docs.md)
