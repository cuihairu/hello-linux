import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Hello Linux',
  description: 'Linux 学习笔记',
  base: '/hello-linux/',
  lang: 'zh-CN',
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '基础篇', link: '/basic/' },
      { text: '命令篇', link: '/commands/' },
      { text: '硬件篇', link: '/hardware/' },
      { text: '系统管理', link: '/system-management/' },
      { text: '网络篇', link: '/network/' }
    ],
    sidebar: {
      '/basic/': [
        {
          text: '基础篇',
          items: [
            { text: '概述', link: '/basic/' },
            { text: '技术概论', link: '/basic/overview' },
            {
              text: 'Linux 简介',
              collapsed: false,
              items: [
                { text: '什么是 Linux', link: '/basic/introduction/what_is_linux' },
                { text: 'Linux 的历史', link: '/basic/introduction/history' },
                { text: '发行版简介', link: '/basic/introduction/distributions' }
              ]
            },
            {
              text: '安装 Linux',
              collapsed: false,
              items: [
                { text: '选择发行版', link: '/basic/installation/choose_distribution' },
                { text: '安装前准备', link: '/basic/installation/preparation' },
                { text: '安装过程', link: '/basic/installation/process' }
              ]
            },
            {
              text: '文件系统',
              collapsed: false,
              items: [
                { text: '文件系统概念', link: '/basic/filesystem/concept' },
                { text: '目录层次结构', link: '/basic/filesystem/hierarchy' },
                { text: '文件权限', link: '/basic/filesystem/permissions' }
              ]
            },
            {
              text: '开机流程',
              collapsed: false,
              items: [
                { text: 'BIOS 与 UEFI', link: '/basic/boot/bios_uefi' },
                { text: 'GRUB 引导程序', link: '/basic/boot/grub' }
              ]
            },
            {
              text: '软件安装',
              collapsed: false,
              items: [
                { text: 'APT 包管理', link: '/basic/packages/apt' },
                { text: 'YUM/DNF 包管理', link: '/basic/packages/yum' }
              ]
            },
            {
              text: '用户管理',
              collapsed: false,
              items: [
                { text: '账号管理', link: '/basic/users/account_management' },
                { text: 'ACL 权限控制', link: '/basic/users/acl_permissions' },
                { text: '磁盘配额', link: '/basic/users/disk_quotas' }
              ]
            },
            {
              text: '系统服务',
              collapsed: false,
              items: [
                { text: '系统服务管理', link: '/basic/services/system_services' },
                { text: '日志管理', link: '/basic/services/log_management' },
                { text: '系统配置工具', link: '/basic/services/configuration_tools' }
              ]
            },
            {
              text: '安全基础',
              collapsed: false,
              items: [
                { text: 'SELinux 概念', link: '/basic/security/concept' },
                { text: 'SELinux 模式', link: '/basic/security/modes' },
                { text: 'SELinux 命令', link: '/basic/security/commands' },
                { text: 'SELinux 策略', link: '/basic/security/policy_configuration' }
              ]
            },
            {
              text: '日志系统',
              collapsed: false,
              items: [
                { text: '系统日志', link: '/basic/log/syslog' },
                { text: '日志轮转', link: '/basic/log/rotation' }
              ]
            }
          ]
        }
      ],
      '/commands/': [
        {
          text: '命令篇',
          items: [
            { text: '概述', link: '/commands/' },
            {
              text: '基本命令',
              collapsed: false,
              items: [
                { text: '文件操作', link: '/commands/basic/file' },
                { text: '目录操作', link: '/commands/basic/directory' }
              ]
            },
            {
              text: '文本处理',
              collapsed: false,
              items: [
                { text: '文本处理命令', link: '/commands/text/text_processing' }
              ]
            },
            {
              text: '系统管理',
              collapsed: false,
              items: [
                { text: '系统信息查看', link: '/commands/system/system_info' },
                { text: '进程管理', link: '/commands/system/process' },
                { text: '内存管理', link: '/commands/system/memory' }
              ]
            },
            {
              text: '网络管理',
              collapsed: false,
              items: [
                { text: '网络命令', link: '/commands/network/network' }
              ]
            },
            {
              text: '包管理',
              collapsed: false,
              items: [
                { text: '包管理命令', link: '/commands/package/package' }
              ]
            }
          ]
        }
      ],
      '/hardware/': [
        {
          text: '硬件篇',
          items: [
            { text: '概述', link: '/hardware/' },
            { text: '计算机体系结构', link: '/hardware/architecture' },
            { text: 'CPU', link: '/hardware/cpu' },
            { text: '内存', link: '/hardware/memory' },
            { text: '存储设备', link: '/hardware/storage' },
            { text: '网络设备', link: '/hardware/network' }
          ]
        }
      ],
      '/system-management/': [
        {
          text: '系统管理篇',
          items: [
            { text: '概述', link: '/system-management/' },
            { text: '性能优化', link: '/system-management/performance' }
          ]
        }
      ],
      '/network/': [
        {
          text: '网络篇',
          items: [
            { text: '概述', link: '/network/' },
            { text: '网络基础', link: '/network/basics' },
            { text: '防火墙', link: '/network/firewall' }
          ]
        }
      ]
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/cuihairu/hello-linux' }
    ],
    search: {
      provider: 'local'
    },
    outline: {
      level: [2, 3],
      label: '页面导航'
    },
    lastUpdated: {
      text: '最后更新'
    },
    docFooter: {
      prev: '上一篇',
      next: '下一篇'
    }
  }
})
