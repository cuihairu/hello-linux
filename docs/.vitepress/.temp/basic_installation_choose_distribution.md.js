import { ssrRenderAttrs, ssrRenderStyle } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"选择合适的发行版","description":"","frontmatter":{},"headers":[],"relativePath":"basic/installation/choose_distribution.md","filePath":"basic/installation/choose_distribution.md","lastUpdated":1789972691000}');
const _sfc_main = { name: "basic/installation/choose_distribution.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="选择合适的发行版" tabindex="-1">选择合适的发行版 <a class="header-anchor" href="#选择合适的发行版" aria-label="Permalink to &quot;选择合适的发行版&quot;">​</a></h1><p>安装前先确定用哪个发行版。本节给出快速决策建议。</p><h2 id="快速决策" tabindex="-1">快速决策 <a class="header-anchor" href="#快速决策" aria-label="Permalink to &quot;快速决策&quot;">​</a></h2><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>你是谁？→ 选什么？</span></span>
<span class="line"><span>─────────────────────────────────────</span></span>
<span class="line"><span>学生/新手        → Ubuntu Desktop</span></span>
<span class="line"><span>开发者           → Ubuntu / Fedora</span></span>
<span class="line"><span>企业服务器       → Rocky Linux / Debian</span></span>
<span class="line"><span>安全测试         → Kali Linux</span></span>
<span class="line"><span>老电脑           → Xubuntu / Debian</span></span></code></pre></div><h2 id="桌面用户" tabindex="-1">桌面用户 <a class="header-anchor" href="#桌面用户" aria-label="Permalink to &quot;桌面用户&quot;">​</a></h2><table tabindex="0"><thead><tr><th>需求</th><th>推荐</th><th>理由</th></tr></thead><tbody><tr><td>刚接触 Linux</td><td>Ubuntu LTS</td><td>资料最多，社区最活跃</td></tr><tr><td>电脑配置较低</td><td>Xubuntu / Lubuntu</td><td>轻量桌面环境</td></tr><tr><td>喜欢折腾</td><td>Fedora</td><td>软件最新</td></tr><tr><td>追求极简</td><td>Arch Linux</td><td>从零构建，学习最深</td></tr></tbody></table><h2 id="服务器用户" tabindex="-1">服务器用户 <a class="header-anchor" href="#服务器用户" aria-label="Permalink to &quot;服务器用户&quot;">​</a></h2><table tabindex="0"><thead><tr><th>需求</th><th>推荐</th><th>理由</th></tr></thead><tbody><tr><td>企业生产</td><td>Rocky Linux / AlmaLinux</td><td>RHEL 兼容，长期支持</td></tr><tr><td>个人项目</td><td>Ubuntu Server / Debian</td><td>软件丰富，文档多</td></tr><tr><td>容器/云</td><td>Ubuntu Server</td><td>Docker/K8s 支持好</td></tr></tbody></table><h2 id="下载" tabindex="-1">下载 <a class="header-anchor" href="#下载" aria-label="Permalink to &quot;下载&quot;">​</a></h2><p>发行版官网下载 ISO 镜像，建议使用国内镜像加速：</p><table tabindex="0"><thead><tr><th>发行版</th><th>国内镜像</th></tr></thead><tbody><tr><td>Ubuntu</td><td><a href="https://mirrors.tuna.tsinghua.edu.cn/ubuntu-releases/" target="_blank" rel="noreferrer">https://mirrors.tuna.tsinghua.edu.cn/ubuntu-releases/</a></td></tr><tr><td>Debian</td><td><a href="https://mirrors.tuna.tsinghua.edu.cn/debian-cd/" target="_blank" rel="noreferrer">https://mirrors.tuna.tsinghua.edu.cn/debian-cd/</a></td></tr><tr><td>Rocky</td><td><a href="https://mirrors.tuna.tsinghua.edu.cn/rocky/" target="_blank" rel="noreferrer">https://mirrors.tuna.tsinghua.edu.cn/rocky/</a></td></tr></tbody></table><p>下载后校验完整性：</p><div class="language-bash vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">bash</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">sha256sum</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> ubuntu-24.04-desktop-amd64.iso</span></span></code></pre></div><h2 id="参考资料" tabindex="-1">参考资料 <a class="header-anchor" href="#参考资料" aria-label="Permalink to &quot;参考资料&quot;">​</a></h2><ul><li><a href="https://ubuntu.com/download" target="_blank" rel="noreferrer">Ubuntu 下载</a></li><li><a href="https://www.debian.org/distrib/" target="_blank" rel="noreferrer">Debian 下载</a></li><li><a href="https://rockylinux.org/download" target="_blank" rel="noreferrer">Rocky Linux 下载</a></li><li><a href="https://distrowatch.com/" target="_blank" rel="noreferrer">DistroWatch</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("basic/installation/choose_distribution.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const choose_distribution = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  choose_distribution as default
};
