import { ssrRenderAttrs, ssrRenderStyle } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"目录层次结构","description":"","frontmatter":{},"headers":[],"relativePath":"basic/filesystem/hierarchy.md","filePath":"basic/filesystem/hierarchy.md","lastUpdated":1790050890000}');
const _sfc_main = { name: "basic/filesystem/hierarchy.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="目录层次结构" tabindex="-1">目录层次结构 <a class="header-anchor" href="#目录层次结构" aria-label="Permalink to &quot;目录层次结构&quot;">​</a></h1><p>Linux 遵循 FHS（Filesystem Hierarchy Standard）标准，定义了目录结构和各目录的用途。</p><blockquote><p>内容参考自 FHS 标准和 Arch Wiki，见文末参考资料。</p></blockquote><h2 id="学习目标" tabindex="-1">学习目标 <a class="header-anchor" href="#学习目标" aria-label="Permalink to &quot;学习目标&quot;">​</a></h2><ul><li>掌握 Linux 目录结构</li><li>了解各主要目录的用途</li></ul><h2 id="_1-目录结构" tabindex="-1">1. 目录结构 <a class="header-anchor" href="#_1-目录结构" aria-label="Permalink to &quot;1. 目录结构&quot;">​</a></h2><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>/</span></span>
<span class="line"><span>├── bin -&gt; usr/bin        # 基本命令</span></span>
<span class="line"><span>├── sbin -&gt; usr/sbin      # 系统管理命令</span></span>
<span class="line"><span>├── lib -&gt; usr/lib        # 共享库</span></span>
<span class="line"><span>├── boot                  # 启动文件（内核、GRUB）</span></span>
<span class="line"><span>├── dev                   # 设备文件</span></span>
<span class="line"><span>├── etc                   # 配置文件</span></span>
<span class="line"><span>├── home                  # 用户主目录</span></span>
<span class="line"><span>├── media                 # 可移动设备挂载点</span></span>
<span class="line"><span>├── mnt                   # 临时挂载点</span></span>
<span class="line"><span>├── opt                   # 第三方软件</span></span>
<span class="line"><span>├── proc                  # 进程信息（虚拟文件系统）</span></span>
<span class="line"><span>├── root                  # root 用户主目录</span></span>
<span class="line"><span>├── run                   # 运行时数据</span></span>
<span class="line"><span>├── srv                   # 服务数据</span></span>
<span class="line"><span>├── sys                   # 系统信息（虚拟文件系统）</span></span>
<span class="line"><span>├── tmp                   # 临时文件</span></span>
<span class="line"><span>├── usr                   # 用户程序和数据</span></span>
<span class="line"><span>└── var                   # 可变数据（日志、缓存）</span></span></code></pre></div><h2 id="_2-重点目录说明" tabindex="-1">2. 重点目录说明 <a class="header-anchor" href="#_2-重点目录说明" aria-label="Permalink to &quot;2. 重点目录说明&quot;">​</a></h2><table tabindex="0"><thead><tr><th>目录</th><th>用途</th><th>示例</th></tr></thead><tbody><tr><td><code>/etc</code></td><td>系统配置文件</td><td><code>/etc/passwd</code>、<code>/etc/ssh/sshd_config</code></td></tr><tr><td><code>/home</code></td><td>用户主目录</td><td><code>/home/user/</code></td></tr><tr><td><code>/var</code></td><td>可变数据</td><td><code>/var/log/</code>、<code>/var/cache/</code></td></tr><tr><td><code>/tmp</code></td><td>临时文件</td><td>重启后可能清空</td></tr><tr><td><code>/usr</code></td><td>用户程序</td><td><code>/usr/bin/</code>、<code>/usr/lib/</code></td></tr><tr><td><code>/proc</code></td><td>进程和系统信息</td><td><code>/proc/cpuinfo</code>、<code>/proc/meminfo</code></td></tr><tr><td><code>/dev</code></td><td>设备文件</td><td><code>/dev/sda</code>、<code>/dev/tty</code></td></tr></tbody></table><h2 id="_3-etc-配置文件" tabindex="-1">3. /etc 配置文件 <a class="header-anchor" href="#_3-etc-配置文件" aria-label="Permalink to &quot;3. /etc 配置文件&quot;">​</a></h2><div class="language-bash vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">bash</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 用户信息</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">cat</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> /etc/passwd</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 用户密码（需 root）</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">sudo</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> cat</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> /etc/shadow</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 组信息</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">cat</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> /etc/group</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 主机名</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">cat</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> /etc/hostname</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># DNS 配置</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">cat</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> /etc/resolv.conf</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 系统版本</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">cat</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> /etc/os-release</span></span></code></pre></div><h2 id="_4-var-可变数据" tabindex="-1">4. /var 可变数据 <a class="header-anchor" href="#_4-var-可变数据" aria-label="Permalink to &quot;4. /var 可变数据&quot;">​</a></h2><div class="language-bash vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">bash</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 系统日志</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">ls</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> /var/log/</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 包管理缓存</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">ls</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> /var/cache/apt/</span><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">      # Debian/Ubuntu</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">ls</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> /var/cache/dnf/</span><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">      # RHEL/CentOS</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 邮件</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">ls</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> /var/mail/</span></span></code></pre></div><h2 id="_5-proc-和-sys-虚拟文件系统" tabindex="-1">5. /proc 和 /sys（虚拟文件系统） <a class="header-anchor" href="#_5-proc-和-sys-虚拟文件系统" aria-label="Permalink to &quot;5. /proc 和 /sys（虚拟文件系统）&quot;">​</a></h2><p>这两个目录不占用磁盘空间，是内核信息的接口：</p><div class="language-bash vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">bash</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># CPU 信息</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">cat</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> /proc/cpuinfo</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 内存信息</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">cat</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> /proc/meminfo</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 内核版本</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">cat</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> /proc/version</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 网络连接</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">cat</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> /proc/net/tcp</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 块设备</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">ls</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> /sys/block/</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 网络接口</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">ls</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> /sys/class/net/</span></span></code></pre></div><h2 id="_6-两系差异" tabindex="-1">6. 两系差异 <a class="header-anchor" href="#_6-两系差异" aria-label="Permalink to &quot;6. 两系差异&quot;">​</a></h2><table tabindex="0"><thead><tr><th>目录</th><th>Debian/Ubuntu</th><th>RHEL/CentOS</th></tr></thead><tbody><tr><td>Apache 配置</td><td><code>/etc/apache2/</code></td><td><code>/etc/httpd/</code></td></tr><tr><td>网络配置</td><td><code>/etc/netplan/</code></td><td>NetworkManager（RHEL 9 起 network-scripts 已移除）</td></tr><tr><td>日志</td><td><code>/var/log/syslog</code></td><td><code>/var/log/messages</code></td></tr></tbody></table><h2 id="参考资料" tabindex="-1">参考资料 <a class="header-anchor" href="#参考资料" aria-label="Permalink to &quot;参考资料&quot;">​</a></h2><ul><li>FHS 3.0 — <a href="https://refspecs.linuxfoundation.org/FHS_3.0/fhs/index.html" target="_blank" rel="noreferrer">refspecs.linuxfoundation.org</a></li><li>Arch Wiki - File system hierarchy — <a href="https://wiki.archlinux.org/title/File_system" target="_blank" rel="noreferrer">wiki.archlinux.org</a></li><li><code>man hier</code> — Linux 手册页</li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("basic/filesystem/hierarchy.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const hierarchy = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  hierarchy as default
};
