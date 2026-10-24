import { defineConfig } from 'vitepress'
import type { NavItem, SidebarItem } from 'vitepress'

// Navigation data is declared once with [English, 简体中文] labels and the
// root-locale (English) route. project() derives both locale trees from it:
// the zh tree is the same routes under /zh/, so the two languages cannot
// drift apart. Edit labels/routes here, never in the locales below.

type NavNode = {
  text: [string, string]
  link?: string
  collapsed?: boolean
  items?: NavNode[]
}

function project(nodes: NavNode[], zh: boolean): SidebarItem[] {
  return nodes.map((node) => {
    const item: SidebarItem = node.link
      ? { text: node.text[zh ? 1 : 0], link: (zh ? '/zh' : '') + node.link }
      : { text: node.text[zh ? 1 : 0], items: project(node.items ?? [], zh) }
    if (node.collapsed !== undefined && 'items' in item) item.collapsed = node.collapsed
    return item
  })
}

const NAV: NavNode[] = [
  { text: ['Home', '首页'], link: '/' },
  { text: ['Basics', '基础篇'], link: '/basic/overview' },
  { text: ['Commands', '命令篇'], link: '/commands/basic' },
  { text: ['Hardware', '硬件篇'], link: '/hardware/architecture' },
  { text: ['Servers', '服务器篇'], link: '/server/web/nginx' },
  { text: ['System Admin', '系统管理'], link: '/system-management/performance' },
  { text: ['Scripting', '脚本篇'], link: '/script/bash-basics' },
  { text: ['Security', '安全篇'], link: '/security/firewall' },
  { text: ['Networking', '网络篇'], link: '/network/basics' },
  { text: ['Kernel Source', '源码篇'], link: '/source/README' },
  { text: ['Research', '研究篇'], link: '/research/README' },
  { text: ['Knowledge', '知识点'], link: '/knowledge' },
  { text: ['Contents', '目录'], link: '/SUMMARY' }
]

const SIDEBAR: NavNode[] = [
  {
    text: ['Basics', '基础篇'],
    items: [
      { text: ['Basics', '基础篇'], link: '/basic/README' },
      { text: ['Technology Overview', '技术概论'], link: '/basic/overview' },
      {
        text: ['Introduction to Linux', 'Linux 简介'],
        link: '/basic/introduction',
        collapsed: false,
        items: [
          { text: ['What Is Linux', '什么是 Linux'], link: '/basic/introduction/what_is_linux' },
          { text: ['History of Linux', 'Linux 的历史'], link: '/basic/introduction/history' },
          { text: ['Linux Distributions', 'Linux 发行版简介'], link: '/basic/introduction/distributions' }
        ]
      },
      {
        text: ['Installing Linux', '安装 Linux'],
        link: '/basic/installation',
        collapsed: false,
        items: [
          { text: ['Choosing a Distribution', '选择合适的发行版'], link: '/basic/installation/choose_distribution' },
          { text: ['Pre-installation Preparation', '安装前的准备'], link: '/basic/installation/preparation' },
          { text: ['Installation Process', '安装过程'], link: '/basic/installation/process' }
        ]
      },
      {
        text: ['Filesystems', '文件系统'],
        link: '/basic/filesystem',
        collapsed: false,
        items: [
          { text: ['Filesystem Concepts', '文件系统概念'], link: '/basic/filesystem/concept' },
          { text: ['Directory Hierarchy', '目录层次结构'], link: '/basic/filesystem/hierarchy' },
          { text: ['File Permissions', '文件权限'], link: '/basic/filesystem/permissions' }
        ]
      },
      {
        text: ['The Boot Process', '开机流程'],
        link: '/basic/boot',
        collapsed: false,
        items: [
          { text: ['BIOS and UEFI', 'BIOS 与 UEFI'], link: '/basic/boot/bios_uefi' },
          { text: ['The GRUB Bootloader', 'GRUB 引导程序'], link: '/basic/boot/grub' }
        ]
      },
      {
        text: ['Installing Software', '软件安装'],
        link: '/basic/packages',
        collapsed: false,
        items: [
          { text: ['APT Package Management', 'APT 包管理'], link: '/basic/packages/apt' },
          { text: ['YUM/DNF Package Management', 'YUM/DNF 包管理'], link: '/basic/packages/yum' },
          { text: ['Pacman Package Management', 'Pacman 包管理'], link: '/basic/packages/pacman' },
          { text: ['Building from Source and Tarballs', '源码编译与 Tarball 安装'], link: '/basic/packages/tarball' }
        ]
      },
      {
        text: ['User Management', '用户管理'],
        link: '/basic/users',
        collapsed: false,
        items: [
          { text: ['Account Management', '账号管理'], link: '/basic/users/account_management' },
          { text: ['ACL Permission Control', 'ACL 权限控制'], link: '/basic/users/acl_permissions' },
          { text: ['Disk Quotas', '磁盘配额'], link: '/basic/users/disk_quotas' }
        ]
      },
      {
        text: ['System Services', '系统服务'],
        link: '/basic/services',
        collapsed: false,
        items: [
          { text: ['Managing System Services', '系统服务管理'], link: '/basic/services/system_services' },
          { text: ['Log Management', '日志管理'], link: '/basic/services/log_management' },
          { text: ['Configuration Tools', '系统配置工具'], link: '/basic/services/configuration_tools' }
        ]
      },
      {
        text: ['Security Basics', '安全基础'],
        link: '/basic/security',
        collapsed: false,
        items: [
          { text: ['SELinux Concepts', 'SELinux 概念'], link: '/basic/security/concept' },
          { text: ['SELinux Modes', 'SELinux 模式'], link: '/basic/security/modes' },
          { text: ['Basic SELinux Commands', 'SELinux 基本命令'], link: '/basic/security/commands' },
          { text: ['SELinux Policy Configuration', 'SELinux 策略配置'], link: '/basic/security/policy_configuration' }
        ]
      },
      {
        text: ['Logging', '日志系统'],
        link: '/basic/log',
        collapsed: false,
        items: [
          { text: ['System Logs', '系统日志'], link: '/basic/log/syslog' },
          { text: ['Log Rotation', '日志轮转'], link: '/basic/log/rotation' }
        ]
      }
    ]
  },
  {
    text: ['Commands', '命令篇'],
    items: [
      { text: ['Commands', '命令篇'], link: '/commands/README' },
      {
        text: ['Basic Commands', '基本命令'],
        link: '/commands/basic',
        collapsed: false,
        items: [
          { text: ['File Operations', '文件操作'], link: '/commands/basic/file' },
          { text: ['Directory Operations', '目录操作'], link: '/commands/basic/directory' }
        ]
      },
      {
        text: ['Text Processing', '文本处理'],
        link: '/commands/text',
        collapsed: false,
        items: [
          { text: ['Text Processing Commands', '文本处理命令'], link: '/commands/text/text_processing' },
          { text: ['Editors and Viewers', '文本编辑和查看工具'], link: '/commands/text/editors' }
        ]
      },
      { text: ['Finding and Locating Files', '查找与定位'], link: '/commands/find-and-locate' },
      { text: ['Compression and Archiving', '压缩与归档'], link: '/commands/compression' },
      {
        text: ['System Administration', '系统管理'],
        link: '/commands/system',
        collapsed: false,
        items: [
          { text: ['Viewing System Information', '系统信息查看'], link: '/commands/system/system_info' },
          { text: ['Process Management', '进程管理'], link: '/commands/system/process' },
          { text: ['Memory Management', '内存管理'], link: '/commands/system/memory' },
          { text: ['Configuration Management Tools', '配置管理工具'], link: '/commands/system/configuration-management' },
          { text: ['System Monitoring Tools', '系统监控工具'], link: '/commands/system/monitoring' }
        ]
      },
      {
        text: ['Network Management', '网络管理'],
        link: '/commands/network',
        collapsed: false,
        items: [
          { text: ['Network Management Commands', '网络管理命令'], link: '/commands/network/network' },
          { text: ['Network Tools', '网络工具'], link: '/commands/network/network-tools' }
        ]
      },
      {
        text: ['Package Management', '包管理'],
        link: '/commands/package',
        collapsed: false,
        items: [
          { text: ['Package Management Commands', '包管理命令'], link: '/commands/package/package' }
        ]
      }
    ]
  },
  {
    text: ['Hardware', '硬件篇'],
    items: [
      { text: ['Hardware', '硬件篇'], link: '/hardware/README' },
      { text: ['Computer Architecture', '计算机体系结构'], link: '/hardware/architecture' },
      { text: ['CPU', 'CPU'], link: '/hardware/cpu' },
      { text: ['Memory', '内存'], link: '/hardware/memory' },
      { text: ['Storage Devices', '存储设备'], link: '/hardware/storage' },
      { text: ['The Desktop Graphics Stack', '桌面图形栈'], link: '/hardware/desktop-stack' },
      { text: ['Network Devices', '网络设备'], link: '/hardware/network' }
    ]
  },
  {
    text: ['System Administration', '系统管理篇'],
    items: [
      { text: ['System Administration', '系统管理篇'], link: '/system-management/README' },
      { text: ['Performance Tuning', '性能优化'], link: '/system-management/performance' },
      { text: ['Backup and Recovery', '备份与恢复'], link: '/system-management/backup-and-recovery' },
      { text: ['LVM Logical Volume Management', 'LVM 逻辑卷管理'], link: '/system-management/lvm' },
      { text: ['Operations Automation', '自动化运维'], link: '/system-management/automation' },
      { text: ['Scheduled Tasks', '例行性工作排程'], link: '/system-management/scheduled-tasks' },
      { text: ['Managing Services with systemd', 'systemd 服务与程序管理'], link: '/system-management/services-systemd' },
      { text: ['Log Administration', '日志系统管理'], link: '/system-management/logging' },
      { text: ['The Boot Process and Boot Repair', '开机流程与引导排错'], link: '/system-management/boot-process' }
    ]
  },
  {
    text: ['Servers', '服务器篇'],
    items: [
      { text: ['Servers', '服务器篇'], link: '/server/README' },
      { text: ['Network Parameter Tuning', '网络参数配置'], link: '/server/network-parameters' },
      { text: ['Routing and NAT', '路由与 NAT'], link: '/server/routing-nat' },
      { text: ['SSH Remote Login', 'SSH 远程登录'], link: '/server/ssh' },
      { text: ['Nginx', 'Web 服务器'], link: '/server/web/nginx' },
      { text: ['Apache', 'Apache'], link: '/server/web/apache' },
      { text: ['MySQL', '数据库'], link: '/server/database/mysql' },
      { text: ['Redis', 'Redis'], link: '/server/redis' },
      { text: ['FTP', 'FTP'], link: '/server/ftp' },
      { text: ['Containers', '容器'], link: '/server/container/docker' },
      { text: ['KVM Virtualization', 'KVM 虚拟化'], link: '/server/virtualization/kvm' },
      { text: ['Cloud Computing and cloud-init', '云计算与 cloud-init'], link: '/server/cloud-computing' },
      { text: ['CI/CD and Continuous Delivery', 'CI/CD 与持续交付'], link: '/server/ci-cd' },
      { text: ['LDAP Unified Accounts', 'LDAP 统一账号管理'], link: '/server/ldap' },
      { text: ['Monitoring', '监控'], link: '/server/monitoring/prometheus' },
      { text: ['DNS', 'DNS'], link: '/server/dns/bind' },
      { text: ['Mail', '邮件'], link: '/server/mail/postfix' },
      { text: ['DHCP Server', 'DHCP 服务器'], link: '/server/dhcp' },
      { text: ['Samba File Sharing', 'Samba 文件共享'], link: '/server/samba' },
      { text: ['NFS Server', 'NFS 服务器'], link: '/server/nfs' },
      { text: ['NTP Time Service', 'NTP 时间服务'], link: '/server/ntp' }
    ]
  },
  {
    text: ['Scripting', '脚本篇'],
    items: [
      { text: ['Scripting', '脚本篇'], link: '/script/README' },
      { text: ['Bash Basics', 'Bash 基础'], link: '/script/bash-basics' },
      { text: ['Variables and Data Types', '变量与数据类型'], link: '/script/variables' },
      { text: ['Conditionals', '条件判断'], link: '/script/conditionals' },
      { text: ['Loops', '循环结构'], link: '/script/loops' },
      { text: ['Functions', '函数'], link: '/script/functions' },
      { text: ['Text Processing', '文本处理'], link: '/script/text-processing' },
      { text: ['Regular Expressions', '正则表达式'], link: '/script/regex' },
      { text: ['Script Debugging', '脚本调试'], link: '/script/debugging' },
      { text: ['Practical Examples', '实战案例'], link: '/script/examples' }
    ]
  },
  {
    text: ['Security', '安全篇'],
    items: [
      { text: ['Security', '安全篇'], link: '/security/README' },
      { text: ['Firewalls (Policy Design)', '防火墙（策略设计）'], link: '/security/firewall' },
      { text: ['Intrusion Detection', '入侵检测'], link: '/security/intrusion-detection' },
      { text: ['Cryptography', '加密技术'], link: '/security/encryption' },
      { text: ['Hardening', '安全加固'], link: '/security/hardening' },
      { text: ['PAM and sudo', 'PAM 与 sudo'], link: '/security/pam-sudo' },
      { text: ['SELinux in Practice', 'SELinux 实战'], link: '/security/selinux' },
      { text: ['AppArmor in Practice', 'AppArmor 实战'], link: '/security/apparmor' }
    ]
  },
  {
    text: ['Networking', '网络篇'],
    items: [
      { text: ['Networking', '网络篇'], link: '/network/README' },
      { text: ['Networking Basics', '网络基础'], link: '/network/basics' },
      { text: ['Firewalls (Connectivity Debugging)', '防火墙（连通排障）'], link: '/network/firewall' },
      { text: ['VPN', 'VPN'], link: '/network/vpn' },
      { text: ['Load Balancing', '负载均衡'], link: '/network/load-balancing' },
      { text: ['Network Monitoring', '网络监控'], link: '/network/network-monitoring' },
      { text: ['Network Configuration Basics', '网络配置基础'], link: '/network/network-configuration' },
      { text: ['Network Troubleshooting', '网络故障排除'], link: '/network/troubleshooting' },
      { text: ['TCP/IP Essentials', 'TCP/IP 要点'], link: '/network/tcpip-essentials' },
      { text: ['Network Commands in Practice', '网络命令实战'], link: '/network/commands-practice' }
    ]
  },
  {
    text: ['Kernel Source', '源码篇'],
    items: [
      { text: ['Kernel Source', '源码篇'], link: '/source/README' },
      { text: ['Getting the Source and Reading the Tree', '源码获取与目录导读'], link: '/source/source-tree' },
      { text: ['Building the Kernel and Writing Modules', '内核编译与模块开发'], link: '/source/build-and-modules' },
      { text: ['Cross-compiling and Embedded Systems', '交叉编译与嵌入式'], link: '/source/cross-compile' },
      { text: ['Tracing Tools', '跟踪工具'], link: '/source/tracing-tools' },
      { text: ['The System Call Path', '系统调用路径'], link: '/source/syscall-path' },
      { text: ['Processes and Scheduling', '进程管理与调度'], link: '/source/process-scheduling' },
      { text: ['Memory Management', '内存管理'], link: '/source/memory-management' },
      { text: ['VFS and ext4', 'VFS 与 ext4'], link: '/source/vfs-ext4' },
      { text: ['The Network Stack', '网络栈'], link: '/source/network-stack' },
      { text: ['Interrupts and Timers', '中断与时钟'], link: '/source/interrupt-timers' },
      { text: ['The Device Driver Framework', '设备驱动框架'], link: '/source/driver-framework' },
      { text: ['IPC', 'IPC'], link: '/source/ipc' },
      { text: ['Reading Userspace Source', '用户态源码选读'], link: '/source/userland' }
    ]
  },
  {
    text: ['Research', '研究篇'],
    items: [
      { text: ['Research', '研究篇'], link: '/research/README' },
      { text: ['Authoritative Books', '权威书籍调研'], link: '/research/authoritative-books' },
      { text: ['Official Documentation', '官方文档调研'], link: '/research/official-docs' },
      { text: ['Application Scenarios', '应用场景调研'], link: '/research/application-scenarios' },
      { text: ['Coverage Matrix and Deltas', '覆盖核对与差异表'], link: '/research/coverage-matrix' },
      { text: ['Gap Filling and Revision', '缺口补全与核对修订'], link: '/research/gap-fill' }
    ]
  },
  {
    text: ['Knowledge Base', '知识点整理'],
    items: [{ text: ['Knowledge Base', '知识点整理'], link: '/knowledge' }]
  },
  {
    text: ['Audits', '结构审计'],
    items: [
      { text: ['Structure Audit (2026-10-19)', '文档结构审计（2026-10-19）'], link: '/review/structure-audit-2026-10-19' },
      { text: ['Content Review (2026-10-19)', '内容复核（2026-10-19）'], link: '/review/content-review-2026-10-19' }
    ]
  },
  {
    text: ['Glossary', '术语表'],
    items: [{ text: ['Glossary', '术语表'], link: '/glossary' }]
  }
]

// The locale layer is merged over the site config as a whole, so each locale
// below carries a COMPLETE themeConfig (shared bits come from sharedTheme).

const sharedTheme = {
  logo: '/logo.svg',
  siteTitle: 'Hello Linux',
  socialLinks: [{ icon: 'github', link: 'https://github.com/cuihairu/hello-linux' }]
}

function themeFor(zh: boolean) {
  if (zh) {
    return {
      ...sharedTheme,
      nav: project(NAV, true) as NavItem[],
      sidebar: project(SIDEBAR, true),
      outline: { level: [2, 3], label: '页面导航' },
      lastUpdated: { text: '最后更新' },
      docFooter: { prev: '上一篇', next: '下一篇' },
      editLink: {
        pattern: 'https://github.com/cuihairu/hello-linux/edit/main/docs/:path',
        text: '在 GitHub 上编辑此页面'
      },
      footer: {
        message: '基于 Apache License 2.0 许可发布',
        copyright: '© 2024-2026 Hello Linux'
      },
      search: {
        provider: 'local',
        options: {
          translations: {
            button: { buttonText: '搜索文档' },
            modal: {
              noResultsText: '没有找到结果',
              resetButtonTitle: '清除查询',
              footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' }
            }
          }
        }
      }
    }
  }
  return {
    ...sharedTheme,
    nav: project(NAV, false) as NavItem[],
    sidebar: project(SIDEBAR, false),
    outline: { level: [2, 3], label: 'On this page' },
    lastUpdated: { text: 'Last updated' },
    docFooter: { prev: 'Previous page', next: 'Next page' },
    editLink: {
      pattern: 'https://github.com/cuihairu/hello-linux/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    },
    footer: {
      message: 'Released under the Apache License 2.0.',
      copyright: '© 2024-2026 Hello Linux'
    },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: 'Search docs' },
          modal: {
            noResultsText: 'No results found',
            resetButtonTitle: 'Clear query',
            footer: { selectText: 'Select', navigateText: 'Navigate', closeText: 'Close' }
          }
        }
      }
    }
  }
}

export default defineConfig({
  title: 'Hello Linux',
  description: 'Linux practice notes and war stories from a game developer',
  base: '/hello-linux/',
  lang: 'en-US',
  cleanUrls: false,
  lastUpdated: true,
  // English pages are being ported chapter by chapter from /zh/. Keep this
  // until every zh page has an English counterpart, then remove it so the
  // build fails on any dead link again.
  ignoreDeadLinks: true,
  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
      themeConfig: themeFor(false)
    },
    zh: {
      label: '简体中文',
      lang: 'zh-CN',
      link: '/zh/',
      themeConfig: themeFor(true)
    }
  },
  themeConfig: sharedTheme,
  sitemap: {
    hostname: 'https://cuihairu.github.io',
    // sub-path 站点：new URL 的基准语义会丢弃 hostname 中的路径，
    // base 必须拼在每条 item.url 上（item.url 无前导斜杠，首页为 ''）
    transformItems: (items) =>
      items.map((item) => ({ ...item, url: '/hello-linux/' + item.url }))
  },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/hello-linux/favicon.svg' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&family=Noto+Sans+JP:wght@400;500;700&family=Noto+Sans+KR:wght@400;500;700&display=swap' }]
  ]
})
