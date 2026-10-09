import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Hello Linux',
  description: '从零开始学习 Linux',
  base: '/hello-linux/',
  lang: 'zh-CN',
  cleanUrls: false,
  lastUpdated: true,
  sitemap: {
    hostname: 'https://cuihairu.github.io',
    // sub-path 站点：new URL 的基准语义会丢弃 hostname 中的路径，
    // base 必须拼在每条 item.url 上（item.url 无前导斜杠，首页为 ''）
    transformItems: (items) =>
      items.map((item) => ({ ...item, url: '/hello-linux/' + item.url })),
  },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/hello-linux/favicon.svg' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&family=Noto+Sans+JP:wght@400;500;700&family=Noto+Sans+KR:wght@400;500;700&display=swap' }],
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
      { text: '源码篇', link: '/source/README' },
      { text: '研究篇', link: '/research/README' },
      { text: '知识点', link: '/knowledge' },
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
                },
                {
                  text: 'Pacman 包管理',
                  link: '/basic/packages/pacman'
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
              text: '桌面图形栈',
              link: '/hardware/desktop-stack'
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
              text: 'LVM 逻辑卷管理',
              link: '/system-management/lvm'
            },
            {
              text: '自动化运维',
              link: '/system-management/automation'
            },
            {
              text: '例行性工作排程',
              link: '/system-management/scheduled-tasks'
            },
            {
              text: 'systemd 服务与程序管理',
              link: '/system-management/services-systemd'
            },
            {
              text: '日志系统管理',
              link: '/system-management/logging'
            },
            {
              text: '开机流程与引导排错',
              link: '/system-management/boot-process'
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
              text: '网络参数配置',
              link: '/server/network-parameters'
            },
            {
              text: '路由与 NAT',
              link: '/server/routing-nat'
            },
            {
              text: 'SSH 远程登录',
              link: '/server/ssh'
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
              text: 'KVM 虚拟化',
              link: '/server/virtualization/kvm'
            },
            {
              text: 'LDAP 统一账号管理',
              link: '/server/ldap'
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
            },
            {
              text: 'DHCP 服务器',
              link: '/server/dhcp'
            },
            {
              text: 'Samba 文件共享',
              link: '/server/samba'
            },
            {
              text: 'NFS 服务器',
              link: '/server/nfs'
            },
            {
              text: 'NTP 时间服务',
              link: '/server/ntp'
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
            },
            {
              text: 'PAM 与 sudo',
              link: '/security/pam-sudo'
            },
            {
              text: 'SELinux 实战',
              link: '/security/selinux'
            },
            {
              text: 'AppArmor 实战',
              link: '/security/apparmor'
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
            },
            {
              text: 'TCP/IP 要点',
              link: '/network/tcpip-essentials'
            },
            {
              text: '网络命令实战',
              link: '/network/commands-practice'
            }
          ]
        }
      ],
      '/source/': [
        {
          text: '源码篇',
          items: [
            {
              text: '源码篇',
              link: '/source/README'
            },
            {
              text: '源码获取与目录导读',
              link: '/source/source-tree'
            },
            {
              text: '内核编译与模块开发',
              link: '/source/build-and-modules'
            },
            {
              text: '交叉编译与嵌入式',
              link: '/source/cross-compile'
            },
            {
              text: '跟踪工具',
              link: '/source/tracing-tools'
            },
            {
              text: '系统调用路径',
              link: '/source/syscall-path'
            },
            {
              text: '进程管理与调度',
              link: '/source/process-scheduling'
            },
            {
              text: '内存管理',
              link: '/source/memory-management'
            },
            {
              text: 'VFS 与 ext4',
              link: '/source/vfs-ext4'
            },
            {
              text: '网络栈',
              link: '/source/network-stack'
            },
            {
              text: '中断与时钟',
              link: '/source/interrupt-timers'
            },
            {
              text: '设备驱动框架',
              link: '/source/driver-framework'
            },
            {
              text: 'IPC',
              link: '/source/ipc'
            },
            {
              text: '用户态源码选读',
              link: '/source/userland'
            }
          ]
        }
      ],
      '/research/': [
        {
          text: '研究篇',
          items: [
            {
              text: '研究篇',
              link: '/research/README'
            },
            {
              text: '权威书籍调研',
              link: '/research/authoritative-books'
            },
            {
              text: '官方文档调研',
              link: '/research/official-docs'
            },
            {
              text: '应用场景调研',
              link: '/research/application-scenarios'
            },
            {
              text: '覆盖核对与差异表',
              link: '/research/coverage-matrix'
            },
            {
              text: '缺口补全与核对修订',
              link: '/research/gap-fill'
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
