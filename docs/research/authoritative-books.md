# Authoritative Books Survey

Survey goal: figure out which topics peer books treat as mandatory, then check those topics against this repository's table of contents item by item. The two Bird's Private Recipes tables of contents and the chapter structures of the five English books (*The Linux Command Line*, USAH, *The Debian Handbook*, *How Linux Works*, *The Linux Bible*) given on this page were all actually fetched (Tier A), with no chapter details taken from anywhere unfetched.

## 1. Bird's Private Recipes (Tier A, Fetched 2026-10-08)

The official site `linux.vbird.org` was unreachable this round; the TOCs were taken from the mirror `vbird.org.cn`'s master TOC page, with chapter titles transcribed verbatim. The mirror and the official site may have version lag; entries follow the mirror.

### 1.1 Basics Part (CentOS 7 edition, 25 chapters)

Source: [vbird.org.cn/linux_basic/centos7/ master TOC](https://vbird.org.cn/linux_basic/centos7/)

| Section | Chapters |
|------|------|
| Planning and installation | Chapter 0 Computer Overview; Chapter 1 What Is Linux and How to Learn It; Chapter 2 Host Planning and Disk Partitioning; Chapter 3 Installing CentOS 7.x; Chapter 4 First Login and Online Help |
| Files, directories, and disk formats | Chapter 5 File Permissions and Directory Configuration; Chapter 6 Files and Directories Management; Chapter 7 Disks and Filesystem Management; Chapter 8 Compression, Archiving, and Backup |
| Shell and scripting | Chapter 9 The vim Editor; Chapter 10 Getting to Know and Using BASH; Chapter 11 Regular Expressions and Document Formatting; Chapter 12 Learning Shell Scripts |
| User management | Chapter 13 Account Management and ACL Permissions; Chapter 14 Disk Quotas and Advanced Filesystem Management |
| System administration | Chapter 15 Scheduled Tasks (crontab); Chapter 16 Process Management and an Introduction to SELinux; Chapter 17 Understanding System Services (daemons); Chapter 18 Understanding and Analyzing Logs; Chapter 19 Boot Process, Module Management, and the Loader; Chapter 20 Basic System Settings and Backup Strategy |
| Other | Chapter 21 Software Installation: Source Code and Tarballs; Chapter 22 Software Installation with RPM, SRPM, and YUM; Chapter 23 X Window Setup; Chapter 24 Kernel Compilation and Management |

The mirror's version index shows that this part also has four historical versions (CentOS 5, Fedora Core 4, Mandrake 9, Red Hat 6.1), plus a separate "basics training materials" series (CentOS 8.x, CentOS 7.x).

> 2026-10-09 retest: the official site `linux.vbird.org` became reachable again; the Basics part's 24 chapter titles match the mirror item by item (the Server Setup part's 12 chapters likewise), and both TOCs in this section were upgraded to a direct official fetch. Retest records in [Gap Fill and Revision Log](./gap-fill.md).

### 1.2 Server Setup Part (RockyLinux 9 edition, 12 chapters)

Source: [vbird.org.cn/linux_server/rocky9/ master TOC](https://vbird.org.cn/linux_server/rocky9/)

| Section | Chapters |
|------|------|
| Virtualization, networking, and firewall | Chapter 0 A Lighthearted Talk on Linux Applications and Learning Server Skills; Chapter 1 Small-Scale Cloud Systems and a Host Hardening Workflow; Chapter 2 Installing and Tuning Your First Virtual Machine; Chapter 3 An Introduction to SELinux; Chapter 4 Networking Basics; Chapter 5 Establishing and Checking Network Connections; Chapter 6 Planning the Whole LAN Environment; Chapter 7 Linux Firewall Setup |
| Common LAN services | Chapter 8 Domain Name Server DNS; Chapter 9 LAN Parameter Providers DHCP and NTP; Chapter 10 Remote Connection Servers SSH / X / VNC; Chapter 11 Unified Account Management with LDAP |

The Server part's version index also has older editions (CentOS 6/5/4, Red Hat 9, Red Hat 6.1) plus a "server training materials" entry. The new edition puts its weight on virtual machines, hardening, firewalls, and directory services, while the traditional web/mail/file services live in the older editions' chapters -- this repository's server part covers that stretch more completely.

### 1.3 What the Two TOCs Require of This Repository

- Of the Basics part's 25 chapters, Chapter 21 (source code and tarballs) now has a landing point in [Source Builds and Tarball Installation](../basic/packages/tarball.md) (2026-10-10); Chapter 23 (X Window) in [Desktop Graphics Stack](../hardware/desktop-stack.md); disk partitioning, backup, kernel compilation, and similar topics land in the hardware, system-management, and source parts respectively.
- Of the Server part's 12 chapters, Chapters 1-2 (virtual machines) now have [KVM Virtualization](../server/virtualization/kvm.md), Chapter 11 (LDAP) has [LDAP Unified Account Management](../server/ldap.md), and Chapter 10's SSH has [SSH Remote Login](../server/ssh.md) (2026-10-10).
- Item-by-item comparisons are in [Coverage Matrix](./coverage-matrix.md).

## 2. English Authoritative Books (All Five Tier A)

The four most widely circulated English system administration books plus the Debian Handbook are registered here. The first round saw the overseas link down and registered bibliographic data only; after the egress recovered on 2026-10-09 the C→A upgrades proceeded as registered: the official TOC texts of *The Linux Command Line* and USAH were actually fetched, upgraded to Tier A together with the Debian Handbook's official online TOC; the 2026-10-10 second round upgraded the remaining two as well (see §2.3) -- all five now have fetched TOCs, with no Tier C books remaining.

### 2.1 TOCs Actually Fetched (Tier A)

| Title | Author / Publisher | Fetch source and conclusion |
|------|--------------|---------------|
| The Linux Command Line | William Shotts (print edition No Starch Press) | Self-published by the author, CC BY-NC-ND. The [bibliographic page](https://linuxcommand.org/tlcl.php) and the official free PDF `TLCL-25.12A` ([official SourceForge project](https://sourceforge.net/projects/linuxcommand/)) fetched (2026-10-09): 7th web edition (PDF copyright page © 2026, 533 pages), 4 parts, 36 chapters |
| UNIX and Linux System Administration Handbook | Evi Nemeth, Garth Snyder, Trent R. Hein, Ben Whaley, James Ma, Addison-Wesley | The [official site admin.com](https://www.admin.com/) states the 5th edition; the [sample TOC PDF](https://www.admin.com/samples/TOC.pdf) fetched (2026-10-09): 4 sections, 31 chapters |
| The Debian Handbook | Raphaël Hertzog, Roland Mas | The [official online TOC page](https://debian-handbook.info/browse/stable/) fetched (2026-10-09): stable is the Debian 11 Bullseye edition, 16 chapters |
| How Linux Works, 3rd Edition | Brian Ward, No Starch Press | [Official product page](https://nostarch.com/howlinuxworks3) (fetched 2026-10-10, its Table of contents block) cross-checked with the [official detailed TOC PDF](https://nostarch.com/download/samples/HLW3rd_DTOC.pdf): Introduction + 17 chapters; the product page's chapter list mislabels chapter 15 as "The Big Picture" while the detailed TOC PDF says "Development Tools" -- the PDF wins |
| The Linux Bible, 11th Edition | Christopher Negus, Wiley | [Wiley official product page](https://www.wiley.com/en-us/linux-bible-11th-edition-p-9781394317462) (fetched 2026-10-10: ISBN 978-1-394-31746-2, 2025-12, 896 pages) plus the on-page official [Table of Contents PDF](https://media.wiley.com/product_data/excerpt/68/13943174/1394317468-12.pdf) fetched: 6 parts, 31 chapters. The originally registered ISBN `9781119909792` corresponds to nothing on the publisher's page or in public search and could not be reproduced; this round corrected it with the ISBN fetched from the official page |

**The Linux Command Line** (4 parts, 36 chapters; chapter titles transcribed from the PDF TOC):

| Part | Chapters |
|----|----|
| Part 1: Learning the Shell (ch. 1-10) | What Is the Shell?; Navigation; Exploring the System; Manipulating Files and Directories; Working with Commands; Redirection; Seeing the World as the Shell Sees It; Advanced Keyboard Tricks; Permissions; Processes |
| Part 2: Configuration and the Environment (ch. 11-13) | The Environment; A Gentle Introduction to vi(m); Customizing the Prompt |
| Part 3: Common Tasks and Essential Tools (ch. 14-23) | Package Management; Storage Media; Networking; Searching for Files; Archiving and Backup; Regular Expressions; Text Processing; Formatting Output; Printing; Compiling Programs |
| Part 4: Writing Shell Scripts (ch. 24-36) | Writing Your First Script; Starting a Project; Top-Down Design; Flow Control: Branching with if; Reading Keyboard Input; Flow Control: Looping with while/until; Troubleshooting; Flow Control: Branching with case; Positional Parameters; Flow Control: Looping with for; Strings and Numbers; Arrays; Exotica |

**UNIX and Linux System Administration Handbook** (4 sections, 31 chapters; chapter titles transcribed from the official sample TOC):

| Section | Chapters |
|----|----|
| Section One: Basic Administration (ch. 1-12) | Where to Start; Booting and System Management Daemons; Access Control and Rootly Powers; Process Control; The Filesystem; Software Installation and Management; Scripting and the Shell; User Management; Cloud Computing; Logging; Drivers and the Kernel; Printing |
| Section Two: Networking (ch. 13-19) | TCP/IP Networking; Physical Networking; IP Routing; DNS: The Domain Name System; Single Sign-On; Electronic Mail; Web Hosting |
| Section Three: Storage (ch. 20-22) | Storage; The Network File System; SMB |
| Section Four: Operations (ch. 23-31) | Configuration Management; Virtualization; Containers; Continuous Integration and Delivery; Security; Monitoring; Performance Analysis; Data Center Basics; Methodology, Policy, and Politics |

**The Debian Handbook** (16 chapters; titles transcribed from the official online TOC): The Debian Project; Presenting the Case Study; Analyzing the Existing Setup and Migrating; Installation; Packaging System: Tools and Fundamental Principles; Maintenance and Updates: The APT Tools; Solving Problems and Finding Relevant Information; Basic Configuration: Network, Accounts, Printing...; Unix Services; Network Infrastructure; Network Services: Postfix, Apache, NFS, Samba, Squid, LDAP, SIP, XMPP, TURN; Advanced Administration; Workstation; Security; Creating a Debian Package; Conclusion: Debian's Future

**How Linux Works, 3rd Edition** (Introduction + 17 chapters; titles transcribed from the official detailed TOC PDF):

| Chapter | Title |
|----|----|
| 1 | The Big Picture |
| 2 | Basic Commands and Directory Hierarchy |
| 3 | Devices |
| 4 | Disks and Filesystems |
| 5 | How the Linux Kernel Boots |
| 6 | How User Space Starts |
| 7 | System Configuration: Logging, System Time, Batch Jobs, and Users |
| 8 | A Closer Look at Processes and Resource Utilization |
| 9 | Understanding Your Network and Its Configuration |
| 10 | Network Applications and Services |
| 11 | Introduction to Shell Scripts |
| 12 | Network File Transfer and Sharing |
| 13 | User Environments |
| 14 | A Brief Survey of the Linux Desktop and Printing |
| 15 | Development Tools |
| 16 | Introduction to Compiling Software from C Source Code |
| 17 | Virtualization |

**The Linux Bible, 11th Edition** (6 parts, 31 chapters; titles transcribed from the official TOC PDF):

| Part | Chapters |
|----|----|
| Part I: Getting Started (ch. 1-2) | Starting with Linux; Creating the Perfect Linux Desktop |
| Part II: Becoming a Linux Power User (ch. 3-7) | Using the Shell; Moving Around the Filesystem; Working with Text Files; Managing Running Processes; Writing Simple Shell Scripts |
| Part III: Becoming a Linux System Administrator (ch. 8-12) | Learning System Administration; Installing Linux; Getting and Managing Software; Managing User Accounts; Managing Disks and Filesystems |
| Part IV: Becoming a Linux Server Administrator (ch. 13-22) | Understanding Server Administration; Administering Networking; Starting and Stopping Services; Configuring a Print Server; Configuring a Web Server; Configuring an FTP Server; Configuring a Windows File Sharing (Samba) Server; Configuring an NFS File Server; Troubleshooting Linux; Configuring an Artificial Intelligence Chatbot |
| Part V: Learning Linux Security Techniques (ch. 23-26) | Understanding Basic Linux Security; Understanding Advanced Linux Security; Enhancing Linux Security with SELinux; Securing Linux on a Network |
| Part VI: Engaging with Cloud Computing (ch. 27-31) | Shifting to Clouds and Containers; Using Linux for Cloud Computing; Deploying Linux to the Cloud; Automating Apps and Infrastructure with Ansible; Deploying Applications as Containers with Kubernetes |

What the comparison means: TLCL Chapter 14 (Package Management), Chapters 19-20 (Regular Expressions, Text Processing), and similar map item by item to the commands and scripting parts; all chapters of the five Tier A books have been checked item by item into [Coverage Matrix](./coverage-matrix.md) (USAH in §4, TLCL in §5, Debian Handbook in §6, How Linux Works in §7, Linux Bible in §8), and Cloud Computing and Continuous Integration and Delivery got their landing pages on 2026-10-10.

### 2.2 C→A Upgrade Log (Two Rounds)

| Round | Book | Result |
|------|----|------|
| 2026-10-09 (first round) | TLCL, USAH, Debian Handbook | Official TOC texts fetched, upgraded to A; details in [Gap Fill and Revision Log](./gap-fill.md) §4.2 |
| 2026-10-10 (second round) | How Linux Works, The Linux Bible | The first round's verdict of "the official pages have no fetchable TOC" turned out to be an artifact of the old product-page layout. The second round located the No Starch new-edition product page (with a Contents block and detailed TOC PDF) and the Wiley 11th-edition product page (with a TOC PDF link); both TOCs were fetched first-hand from the publisher and upgraded to A; details in gap-fill §4.3 |

Citation discipline: all five may have their chapter structures (parts and chapter titles) cited in the body; details beyond the TOC are still not cited. After the two upgrade rounds no Tier C books remain.

## 3. The Division of Labor with Bird's

The two Bird's parts are the references this repository's README names explicitly (Tier B -- `linux.vbird.org` passed the repository's existing external-link verification round; 102 citations across 96 pages, the second source after ArchWiki). The skeleton it provides is "basic concepts → command by command → service setup → troubleshooting"; this repository does two things on that same skeleton: puts the three distro families (Debian/Ubuntu, Arch, RHEL-family) side by side, and updates each service's landing point from the CentOS 7 era to the systemd era. The remaining gaps are mainly the three places listed in the previous section, already filled per [Gap Fill and Revision Log](./gap-fill.md).

<!-- BACKLINKS-AUTO -->
## Related Pages

- [knowledge](/knowledge.md)
- [README](README.md)
- [coverage-matrix](coverage-matrix.md)
- [gap-fill](gap-fill.md)
- [official-docs](official-docs.md)
