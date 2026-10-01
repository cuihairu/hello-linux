import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Hello Linux',
  description: '从零开始学习 Linux',
  base: '/hello-linux/',
  lang: 'zh-CN',
  cleanUrls: false,
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/hello-linux/favicon.svg' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&family=Noto+Sans+JP:wght@400;500;700&family=Noto+Sans+KR:wght@400;500;700&display=swap' }],
    // Chinese typography & brand styles
    ['style', `
      :root {
        --vp-doc-font-family: 'Noto Sans SC', 'Noto Sans JP', 'Noto Sans KR', system-ui, sans-serif;
      }
      .vp-doc > p:first-of-type { text-indent: 2em; }
      .vp-doc > p { text-indent: 2em; line-height: 1.75; margin: 1em 0; }
      .vp-doc > p:first-child { text-indent: 0; }
      .vp-doc table { border-collapse: separate; border-spacing: 0; width: 100%; margin: 1.5em 0; border-radius: 8px; overflow: hidden; }
      .vp-doc th { background: #f8fafc; color: #1e293b; font-weight: 600; padding: 0.75em 1em; border-bottom: 2px solid #e2e8f0; text-align: left; }
      .vp-doc td { padding: 0.6em 1em; border-bottom: 1px solid #e2e8f0; }
      .vp-doc tbody tr:nth-child(even) td { background: #fafbfc; }
      .vp-doc tbody tr:hover td { background: #f1f5f9; }
      .vp-doc code { background: #f1f5f9; padding: 0.2em 0.4em; border-radius: 4px; font-size: 0.9em; }
      .vp-doc :not(pre) > code { background: #f1f5f9; }
      .vp-doc blockquote { margin: 1.5em 0; padding: 0.75em 1.25em; color: #475569; border-left: 4px solid #3b82f6; background: #eff6ff; border-radius: 0 8px 8px 0; }
      .vp-doc blockquote p { margin: 0.5em 0; text-indent: 0; }
      .vp-doc h1, .vp-doc h2, .vp-doc h3, .vp-doc h4, .vp-doc h5, .vp-doc h6 { margin-top: 1.8em; margin-bottom: 0.6em; font-weight: 600; line-height: 1.35; color: #1e293b; }
      .vp-doc h1 { font-size: 2rem; padding-bottom: 0.4em; border-bottom: 1px solid #e2e8f0; }
      .vp-doc h2 { font-size: 1.6rem; margin-top: 2em; }
      .vp-doc h3 { font-size: 1.3rem; }
      .VPHero { padding: 3.5em 1.5em; }
      .VPHero h1 { font-size: 2.75rem; line-height: 1.15; }
      .VPHero p { font-size: 1.3rem; color: #64748b; margin: 1.2em 0; }
      .VPNavBarMenuLink { color: #2d3748; transition: color 0.15s; }
      .VPNavBarMenuLink:hover { color: #3b82f6; }
      .VPSidebar { width: 260px; }
      .VPSidebar .nav a { color: #334155; margin: 0.15em 0; font-size: 0.92rem; }
      .VPSidebar .nav a.active { color: #3b82f6; font-weight: 550; }
      .VPSidebar .nav .group > .item { font-weight: 600; color: #1e293b; }
      .VPFooter { margin-top: 4em; padding-top: 2em; border-top: 1px solid #e2e8f0; color: #64748b; }
      .DocSearch-Button-Container { background: #f1f5f9; border-radius: 6px; }
      .VPNavBarMenuLink:focus-visible, .VPSwitch:focus-visible { outline: 2px solid #3b82f6; outline-offset: 2px; }
      .vp-doc pre { border-radius: 8px; overflow: auto; }
      .vp-doc ul, .vp-doc ol { margin: 1em 0; padding-left: 1.5em; }
      .vp-doc li { margin: 0.4em 0; line-height: 1.7; }
      .vp-doc li > p { text-indent: 0; margin: 0.2em 0; }
      .vp-doc img { border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
      .vp-doc hr { border: none; border-top: 1px solid #e2e8f0; margin: 2.5em 0; }
    `]
  ],
  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Hello Linux',
    nav: [
      { text: '首页', link: '/' },
      { text: '基础篇', link: '/basic/overview' },
      { text: '命令篇', link: '/commands/basic' },
      { text: '硬件篇', link: '/hardware/architecture' },
      { text: '服务器篇', link: '/server/web/nginx' },
      { text: '系统管理', link: '/system-management/performance' },
      { text: '脚本篇', link: '/script/bash-basics' },
      { text: '安全篇', link: '/security/firewall' },
      { text: '网络篇', link: '/network/basics' },
      { text: '目录', link: '/SUMMARY' }
    ],
    sidebar: [...Object.values({
      '/basic/': [
        {
          text: '基础篇',
          items: [
            {
              text: '基础篇',
              link: '/basic/README'
            },
            {
              text: '技术概论',
              link: '/basic/overview'
            },
            {
              text: 'Linux 简介',
              link: '/basic/introduction',
              collapsed: false,
              items: [
                {
                  text: '什么是 Linux',
                  link: '/basic/introduction/what_is_linux'
                },
                {
                  text: 'Linux 的历史',
                  link: '/basic/introduction/history'
                },
                {
                  text: 'Linux 发行版简介',
                  link: '/basic/introduction/distributions'
                }
              ]
            },
            {
              text: '安装 Linux',
              link: '/basic/installation',
              collapsed: false,
              items: [
                {
                  text: '选择合适的发行版',
                  link: '/basic/installation/choose_distribution'
                },
                {
                  text: '安装前的准备',
                  link: '/basic/installation/preparation'
                },
                {
                  text: '安装过程',
                  link: '/basic/installation/process'
                }
              ]
            },
            {
              text: '文件系统',
              link: '/basic/filesystem',
              collapsed: false,
              items: [
                {
                  text: '文件系统概念',
                  link: '/basic/filesystem/concept'
                },
                {
                  text: '目录层次结构',
                  link: '/basic/filesystem/hierarchy'
                },
                {
                  text: '文件权限',
                  link: '/basic/filesystem/permissions'
                }
              ]
            },
            {
              text: '开机流程',
              link: '/basic/boot',
              collapsed: false,
              items: [
                {
                  text: 'BIOS 与 UEFI',
                  link: '/basic/boot/bios_uefi'
                },
                {
                  text: 'GRUB 引导程序',
                  link: '/basic/boot/grub'
                }
              ]
            },
            {
              text: '软件安装',
              link: '/basic/packages',
              collapsed: false,
              items: [
                {
                  text: 'APT 包管理',
                  link: '/basic/packages/apt'
                },
                {
                  text: 'YUM/DNF 包管理',
                  link: '/basic/packages/yum'
                }
              ]
            },
            {
              text: '用户管理',
              link: '/basic/users',
              collapsed: false,
              items: [
                {
                  text: '账号管理',
                  link: '/basic/users/account_management'
                },
                {
                  text: 'ACL 权限控制',
                  link: '/basic/users/acl_permissions'
                },
                {
                  text: '磁盘配额',
                  link: '/basic/users/disk_quotas'
                }
              ]
            },
            {
              text: '系统服务',
              link: '/basic/services',
              collapsed: false,
              items: [
                {
                  text: '系统服务管理',
                  link: '/basic/services/system_services'
                },
                {
                  text: '日志管理',
                  link: '/basic/services/log_management'
                },
                {
                  text: '系统配置工具',
                  link: '/basic/services/configuration_tools'
                }
              ]
            },
            {
              text: '安全基础',
              link: '/basic/security',
              collapsed: false,
              items: [
                {
                  text: 'SELinux 概念',
                  link: '/basic/security/concept'
                },
                {
                  text: 'SELinux 模式',
                  link: '/basic/security/modes'
                },
                {
                  text: 'SELinux 基本命令',
                  link: '/basic/security/commands'
                },
                {
                  text: 'SELinux 策略配置',
                  link: '/basic/security/policy_configuration'
                }
              ]
            },
            {
              text: '日志系统',
              link: '/basic/log',
              collapsed: false,
              items: [
                {
                  text: '系统日志',
                  link: '/basic/log/syslog'
                },
                {
                  text: '日志轮转',
                  link: '/basic/log/rotation'
                }
              ]
            }
          ]
        }
      ],
      '/commands/': [
        {
          text: '命令篇',
          items: [
            {
              text: '命令篇',
              link: '/commands/README'
            },
            {
              text: '基本命令',
              link: '/commands/basic',
              collapsed: false,
              items: [
                {
                  text: '文件操作',
                  link: '/commands/basic/file'
                },
                {
                  text: '目录操作',
                  link: '/commands/basic/directory'
                }
              ]
            },
            {
              text: '文本处理',
              link: '/commands/text',
              collapsed: false,
              items: [
                {
                  text: '文本处理命令',
                  link: '/commands/text/text_processing'
                },
                {
                  text: '文本编辑和查看工具',
                  link: '/commands/text/editors'
                }
              ]
            },
            {
              text: '查找与定位',
              link: '/commands/find-and-locate'
            },
            {
              text: '压缩与归档',
              link: '/commands/compression'
            },
            {
              text: '系统管理',
              link: '/commands/system',
              collapsed: false,
              items: [
                {
                  text: '系统信息查看',
                  link: '/commands/system/system_info'
                },
                {
                  text: '进程管理',
                  link: '/commands/system/process'
                },
                {
                  text: '内存管理',
                  link: '/commands/system/memory'
                },
                {
                  text: '配置管理工具',
                  link: '/commands/system/configuration-management'
                },
                {
                  text: '系统监控工具',
                  link: '/commands/system/monitoring'
                }
              ]
            },
            {
              text: '网络管理',
              link: '/commands/network',
              collapsed: false,
              items: [
                {
                  text: '网络管理命令',
                  link: '/commands/network/network'
                },
                {
                  text: '网络工具',
                  link: '/commands/network/network-tools'
                }
              ]
            },
            {
              text: '包管理',
              link: '/commands/package',
              collapsed: false,
              items: [
                {
                  text: '包管理命令',
                  link: '/commands/package/package'
                }
              ]
            }
          ]
        }
      ],
      '/hardware/': [
        {
          text: '硬件篇',
          items: [
            {
              text: '硬件篇',
              link: '/hardware/README'
            },
            {
              text: '计算机体系结构',
              link: '/hardware/architecture'
            },
            {
              text: 'CPU',
              link: '/hardware/cpu'
            },
            {
              text: '内存',
              link: '/hardware/memory'
            },
            {
              text: '存储设备',
              link: '/hardware/storage'
            },
            {
              text: '网络设备',
              link: '/hardware/network'
            }
          ]
        }
      ],
      '/system-management/': [
        {
          text: '系统管理篇',
          items: [
            {
              text: '系统管理篇',
              link: '/system-management/README'
            },
            {
              text: '性能优化',
              link: '/system-management/performance'
            },
            {
              text: '备份与恢复',
              link: '/system-management/backup-and-recovery'
            },
            {
              text: '自动化运维',
              link: '/system-management/automation'
            }
          ]
        }
      ],
      '/server/': [
        {
          text: '服务器篇',
          items: [
            {
              text: '服务器篇',
              link: '/server/README'
            },
            {
              text: 'Web 服务器',
              link: '/server/web/nginx'
            },
            {
              text: 'Apache',
              link: '/server/web/apache'
            },
            {
              text: '数据库',
              link: '/server/database/mysql'
            },
            {
              text: 'Redis',
              link: '/server/redis'
            },
            {
              text: 'FTP',
              link: '/server/ftp'
            },
            {
              text: '容器',
              link: '/server/container/docker'
            },
            {
              text: '监控',
              link: '/server/monitoring/prometheus'
            },
            {
              text: 'DNS',
              link: '/server/dns/bind'
            },
            {
              text: '邮件',
              link: '/server/mail/postfix'
            }
          ]
        }
      ],
      '/script/': [
        {
          text: '脚本篇',
          items: [
            {
              text: '脚本篇',
              link: '/script/README'
            },
            {
              text: 'Bash 基础',
              link: '/script/bash-basics'
            },
            {
              text: '变量与数据类型',
              link: '/script/variables'
            },
            {
              text: '条件判断',
              link: '/script/conditionals'
            },
            {
              text: '循环结构',
              link: '/script/loops'
            },
            {
              text: '函数',
              link: '/script/functions'
            },
            {
              text: '文本处理',
              link: '/script/text-processing'
            },
            {
              text: '正则表达式',
              link: '/script/regex'
            },
            {
              text: '脚本调试',
              link: '/script/debugging'
            },
            {
              text: '实战案例',
              link: '/script/examples'
            }
          ]
        }
      ],
      '/security/': [
        {
          text: '安全篇',
          items: [
            {
              text: '安全篇',
              link: '/security/README'
            },
            {
              text: '防火墙',
              link: '/security/firewall'
            },
            {
              text: '入侵检测',
              link: '/security/intrusion-detection'
            },
            {
              text: '加密技术',
              link: '/security/encryption'
            },
            {
              text: '安全加固',
              link: '/security/hardening'
            }
          ]
        }
      ],
      '/network/': [
        {
          text: '网络篇',
          items: [
            {
              text: '网络篇',
              link: '/network/README'
            },
            {
              text: '网络基础',
              link: '/network/basics'
            },
            {
              text: '防火墙',
              link: '/network/firewall'
            },
            {
              text: 'VPN',
              link: '/network/vpn'
            },
            {
              text: '负载均衡',
              link: '/network/load-balancing'
            },
            {
              text: '网络监控',
              link: '/network/network-monitoring'
            },
            {
              text: '网络配置基础',
              link: '/network/network-configuration'
            },
            {
              text: '网络故障排除',
              link: '/network/troubleshooting'
            }
          ]
        }
      ]
      }).flat()
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/cuihairu/hello-linux' }
    ],
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
    },
    editLink: {
      pattern: 'https://github.com/cuihairu/hello-linux/edit/main/docs/:path',
      text: '在 GitHub 上编辑此页面'
    },
    footer: {
      message: '基于 Apache License 2.0 许可发布',
      copyright: '© 2024-2026 Hello Linux'
    }
  }
})
