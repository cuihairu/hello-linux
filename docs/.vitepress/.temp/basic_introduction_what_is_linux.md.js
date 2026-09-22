import { ssrRenderAttrs, ssrRenderStyle } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"什么是 Linux","description":"","frontmatter":{},"headers":[],"relativePath":"basic/introduction/what_is_linux.md","filePath":"basic/introduction/what_is_linux.md","lastUpdated":1789972691000}');
const _sfc_main = { name: "basic/introduction/what_is_linux.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="什么是-linux" tabindex="-1">什么是 Linux <a class="header-anchor" href="#什么是-linux" aria-label="Permalink to &quot;什么是 Linux&quot;">​</a></h1><p>&quot;Linux&quot; 这个词在不同语境下有不同含义：严格来说它只是内核，但在日常使用中通常指代完整的操作系统。本章厘清这些概念。</p><blockquote><p>内容参考自 GNU 项目文档和 Linux 内核文档，见文末参考资料。</p></blockquote><h2 id="学习目标" tabindex="-1">学习目标 <a class="header-anchor" href="#学习目标" aria-label="Permalink to &quot;学习目标&quot;">​</a></h2><ul><li>理解内核与操作系统的区别</li><li>了解 GNU 项目与 Linux 的关系</li><li>掌握发行版的组成结构</li></ul><h2 id="_1-内核-vs-操作系统" tabindex="-1">1. 内核 vs 操作系统 <a class="header-anchor" href="#_1-内核-vs-操作系统" aria-label="Permalink to &quot;1. 内核 vs 操作系统&quot;">​</a></h2><h3 id="_1-1-内核-kernel" tabindex="-1">1.1 内核（Kernel） <a class="header-anchor" href="#_1-1-内核-kernel" aria-label="Permalink to &quot;1.1 内核（Kernel）&quot;">​</a></h3><p>内核是操作系统的核心程序，负责管理硬件资源和提供基础服务。</p><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>┌──────────────────────────────────────┐</span></span>
<span class="line"><span>│           用户空间 (User Space)        │</span></span>
<span class="line"><span>│  ┌────────┐ ┌────────┐ ┌────────┐   │</span></span>
<span class="line"><span>│  │  Bash  │ │  Vim   │ │  Nginx │   │</span></span>
<span class="line"><span>│  └───┬────┘ └───┬────┘ └───┬────┘   │</span></span>
<span class="line"><span>├──────┼──────────┼──────────┼─────────┤</span></span>
<span class="line"><span>│      │     系统调用接口      │         │</span></span>
<span class="line"><span>│  ┌───┴──────────────────────┴────┐   │</span></span>
<span class="line"><span>│  │          内核空间              │   │</span></span>
<span class="line"><span>│  │  ┌──────┐ ┌──────┐ ┌──────┐  │   │</span></span>
<span class="line"><span>│  │  │进程  │ │内存  │ │文件  │  │   │</span></span>
<span class="line"><span>│  │  │调度  │ │管理  │ │系统  │  │   │</span></span>
<span class="line"><span>│  │  ├──────┤ ├──────┤ ├──────┤  │   │</span></span>
<span class="line"><span>│  │  │网络  │ │设备  │ │安全  │  │   │</span></span>
<span class="line"><span>│  │  │协议栈│ │驱动  │ │模块  │  │   │</span></span>
<span class="line"><span>│  │  └──────┘ └──────┘ └──────┘  │   │</span></span>
<span class="line"><span>│  └───────────────────────────────┘   │</span></span>
<span class="line"><span>└──────────────────────────────────────┘</span></span></code></pre></div><p>Linux 内核的职责：</p><table tabindex="0"><thead><tr><th>子系统</th><th>功能</th></tr></thead><tbody><tr><td>进程调度</td><td>进程创建、调度、终止</td></tr><tr><td>内存管理</td><td>虚拟内存、页面交换、内存分配</td></tr><tr><td>文件系统</td><td>VFS 抽象层、具体文件系统实现</td></tr><tr><td>网络协议栈</td><td>TCP/IP 协议实现</td></tr><tr><td>设备驱动</td><td>硬件设备的软件接口</td></tr><tr><td>安全模块</td><td>SELinux、AppArmor、capabilities</td></tr></tbody></table><div class="language-bash vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">bash</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 查看内核版本</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">uname</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> -r</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 查看内核详细信息</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">cat</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> /proc/version</span></span></code></pre></div><h3 id="_1-2-操作系统" tabindex="-1">1.2 操作系统 <a class="header-anchor" href="#_1-2-操作系统" aria-label="Permalink to &quot;1.2 操作系统&quot;">​</a></h3><p>操作系统 = 内核 + 用户空间工具 + 系统库 + 包管理系统 + 配置框架</p><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>┌─────────────────────────────────────────┐</span></span>
<span class="line"><span>│              操作系统                     │</span></span>
<span class="line"><span>│  ┌────────────────────────────────────┐ │</span></span>
<span class="line"><span>│  │         用户空间工具                │ │</span></span>
<span class="line"><span>│  │  coreutils, util-linux, procps... │ │</span></span>
<span class="line"><span>│  ├────────────────────────────────────┤ │</span></span>
<span class="line"><span>│  │         系统库                      │ │</span></span>
<span class="line"><span>│  │  glibc, libstdc++, openssl...      │ │</span></span>
<span class="line"><span>│  ├────────────────────────────────────┤ │</span></span>
<span class="line"><span>│  │         内核                        │ │</span></span>
<span class="line"><span>│  │  Linux Kernel                      │ │</span></span>
<span class="line"><span>│  └────────────────────────────────────┘ │</span></span>
<span class="line"><span>└─────────────────────────────────────────┘</span></span></code></pre></div><h2 id="_2-gnu-与-linux" tabindex="-1">2. GNU 与 Linux <a class="header-anchor" href="#_2-gnu-与-linux" aria-label="Permalink to &quot;2. GNU 与 Linux&quot;">​</a></h2><h3 id="_2-1-gnu-项目" tabindex="-1">2.1 GNU 项目 <a class="header-anchor" href="#_2-1-gnu-项目" aria-label="Permalink to &quot;2.1 GNU 项目&quot;">​</a></h3><p>1983 年，Richard Stallman 发起 GNU（GNU&#39;s Not Unix）项目，目标是创建一个完全自由的类 Unix 操作系统。</p><p>到 1991 年，GNU 已完成大部分组件：</p><table tabindex="0"><thead><tr><th>组件</th><th>说明</th><th>状态</th></tr></thead><tbody><tr><td>GCC</td><td>GNU 编译器套件</td><td>已完成</td></tr><tr><td>glibc</td><td>C 标准库</td><td>已完成</td></tr><tr><td>coreutils</td><td>基本命令（ls, cp, mv...）</td><td>已完成</td></tr><tr><td>Bash</td><td>Shell</td><td>已完成</td></tr><tr><td>Emacs</td><td>文本编辑器</td><td>已完成</td></tr><tr><td><strong>内核</strong></td><td>Hurd</td><td><strong>未完成</strong></td></tr></tbody></table><h3 id="_2-2-linux-的加入" tabindex="-1">2.2 Linux 的加入 <a class="header-anchor" href="#_2-2-linux-的加入" aria-label="Permalink to &quot;2.2 Linux 的加入&quot;">​</a></h3><p>1991 年，Linus Torvalds 发布了 Linux 内核，填补了 GNU 项目缺失的最后一块拼图。</p><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>GNU 项目（用户空间工具） + Linux 内核 = GNU/Linux 操作系统</span></span></code></pre></div><h3 id="_2-3-命名争议" tabindex="-1">2.3 命名争议 <a class="header-anchor" href="#_2-3-命名争议" aria-label="Permalink to &quot;2.3 命名争议&quot;">​</a></h3><ul><li><strong>GNU/Linux</strong>：强调 GNU 项目的贡献（自由软件基金会立场）</li><li><strong>Linux</strong>：更简洁，被大多数人使用</li></ul><div class="language-bash vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">bash</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 查看 GNU 工具版本</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">ls</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> --version</span><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">        # GNU coreutils</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">gcc</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> --version</span><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">       # GNU Compiler Collection</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">bash</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> --version</span><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">      # GNU Bash</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 查看内核版本</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">uname</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> -r</span></span></code></pre></div><h2 id="_3-发行版的组成" tabindex="-1">3. 发行版的组成 <a class="header-anchor" href="#_3-发行版的组成" aria-label="Permalink to &quot;3. 发行版的组成&quot;">​</a></h2><p>一个完整的 Linux 发行版包含以下层次：</p><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>┌─────────────────────────────────────────┐</span></span>
<span class="line"><span>│              发行版                       │</span></span>
<span class="line"><span>│  ┌────────────────────────────────────┐ │</span></span>
<span class="line"><span>│  │         应用层                      │ │</span></span>
<span class="line"><span>│  │  浏览器、编辑器、服务器软件...       │ │</span></span>
<span class="line"><span>│  ├────────────────────────────────────┤ │</span></span>
<span class="line"><span>│  │         桌面环境（可选）             │ │</span></span>
<span class="line"><span>│  │  GNOME, KDE, XFCE...              │ │</span></span>
<span class="line"><span>│  ├────────────────────────────────────┤ │</span></span>
<span class="line"><span>│  │         包管理系统                   │ │</span></span>
<span class="line"><span>│  │  APT (deb) / YUM/DNF (rpm)        │ │</span></span>
<span class="line"><span>│  ├────────────────────────────────────┤ │</span></span>
<span class="line"><span>│  │         系统库                      │ │</span></span>
<span class="line"><span>│  │  glibc, openssl, zlib...          │ │</span></span>
<span class="line"><span>│  ├────────────────────────────────────┤ │</span></span>
<span class="line"><span>│  │         GNU 工具                    │ │</span></span>
<span class="line"><span>│  │  coreutils, bash, gcc...          │ │</span></span>
<span class="line"><span>│  ├────────────────────────────────────┤ │</span></span>
<span class="line"><span>│  │         内核                        │ │</span></span>
<span class="line"><span>│  │  Linux Kernel                     │ │</span></span>
<span class="line"><span>│  └────────────────────────────────────┘ │</span></span>
<span class="line"><span>└─────────────────────────────────────────┘</span></span></code></pre></div><table tabindex="0"><thead><tr><th>层次</th><th>说明</th><th>示例</th></tr></thead><tbody><tr><td>内核</td><td>硬件抽象和资源管理</td><td>Linux 6.8</td></tr><tr><td>GNU 工具</td><td>基本命令和编译工具</td><td>coreutils, bash</td></tr><tr><td>系统库</td><td>程序运行的基础库</td><td>glibc</td></tr><tr><td>包管理</td><td>软件安装和更新</td><td>APT / YUM</td></tr><tr><td>桌面环境</td><td>图形用户界面（可选）</td><td>GNOME / KDE</td></tr><tr><td>应用软件</td><td>用户使用的程序</td><td>Firefox, Nginx</td></tr></tbody></table><h2 id="_4-一切皆文件" tabindex="-1">4. &quot;一切皆文件&quot; <a class="header-anchor" href="#_4-一切皆文件" aria-label="Permalink to &quot;4. &quot;一切皆文件&quot;&quot;">​</a></h2><p>Linux 遵循 Unix 的设计哲学，将大多数资源抽象为文件接口：</p><div class="language-bash vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">bash</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 普通文件</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">cat</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> /etc/passwd</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 目录</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">ls</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> /home/</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 设备文件</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">ls</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> -la</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> /dev/sda</span><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">        # 块设备</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">ls</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> -la</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> /dev/tty</span><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">        # 字符设备</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">ls</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> -la</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> /dev/null</span><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">       # 空设备</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 进程信息</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">cat</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> /proc/1/status</span><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">     # PID 1 的状态</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">cat</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> /proc/cpuinfo</span><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">      # CPU 信息</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">cat</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> /proc/meminfo</span><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">      # 内存信息</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 网络</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">cat</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> /proc/net/tcp</span><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">      # TCP 连接</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 管道</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}">echo</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> &quot;hello&quot;</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}"> |</span><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}"> cat</span><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">     # 管道是特殊的文件</span></span></code></pre></div><h2 id="_5-查看系统信息" tabindex="-1">5. 查看系统信息 <a class="header-anchor" href="#_5-查看系统信息" aria-label="Permalink to &quot;5. 查看系统信息&quot;">​</a></h2><div class="language-bash vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">bash</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 内核版本</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">uname</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> -r</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 发行版信息</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">cat</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> /etc/os-release</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># GNU 工具版本</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">ls</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> --version</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}"> |</span><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}"> head</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> -1</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 系统架构</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">uname</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> -m</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 主机名</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">hostname</span></span></code></pre></div><h2 id="参考资料" tabindex="-1">参考资料 <a class="header-anchor" href="#参考资料" aria-label="Permalink to &quot;参考资料&quot;">​</a></h2><ul><li>GNU Project — <a href="https://www.gnu.org/gnu/linux-and-gnu.html" target="_blank" rel="noreferrer">gnu.org</a></li><li>The Linux Kernel Archives — <a href="https://www.kernel.org/" target="_blank" rel="noreferrer">kernel.org</a></li><li>Linus Torvalds 原始公告 — <a href="https://groups.google.com/g/comp.os.minix/c/dlNtH7RRrGA" target="_blank" rel="noreferrer">groups.google.com</a></li><li>Arch Wiki - Linux — <a href="https://wiki.archlinux.org/title/Linux" target="_blank" rel="noreferrer">wiki.archlinux.org</a></li><li>Wikipedia: GNU/Linux naming controversy — <a href="https://en.wikipedia.org/wiki/GNU/Linux_naming_controversy" target="_blank" rel="noreferrer">wikipedia.org</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("basic/introduction/what_is_linux.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const what_is_linux = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  what_is_linux as default
};
