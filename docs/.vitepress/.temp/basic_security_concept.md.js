import { ssrRenderAttrs, ssrRenderStyle } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"SELinux 概念","description":"","frontmatter":{},"headers":[],"relativePath":"basic/security/concept.md","filePath":"basic/security/concept.md","lastUpdated":1789972691000}');
const _sfc_main = { name: "basic/security/concept.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="selinux-概念" tabindex="-1">SELinux 概念 <a class="header-anchor" href="#selinux-概念" aria-label="Permalink to &quot;SELinux 概念&quot;">​</a></h1><p>SELinux（Security-Enhanced Linux）是 Linux 的强制访问控制（MAC）安全机制。</p><blockquote><p>内容参考自 Red Hat SELinux 文档和 Arch Wiki，见文末参考资料。</p></blockquote><h2 id="_1-dac-vs-mac" tabindex="-1">1. DAC vs MAC <a class="header-anchor" href="#_1-dac-vs-mac" aria-label="Permalink to &quot;1. DAC vs MAC&quot;">​</a></h2><table tabindex="0"><thead><tr><th>模型</th><th>说明</th><th>特点</th></tr></thead><tbody><tr><td>DAC</td><td>自主访问控制</td><td>传统权限，基于用户/组</td></tr><tr><td>MAC</td><td>强制访问控制</td><td>SELinux，基于安全策略</td></tr></tbody></table><h2 id="_2-安全上下文" tabindex="-1">2. 安全上下文 <a class="header-anchor" href="#_2-安全上下文" aria-label="Permalink to &quot;2. 安全上下文&quot;">​</a></h2><p>SELinux 为每个对象分配安全标签：</p><div class="language-bash vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">bash</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 查看文件上下文</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">ls</span><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}"> -Z</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> file.txt</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># system_u:object_r:httpd_sys_content_t:s0</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 查看进程上下文</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">ps</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> auxZ</span><span style="${ssrRenderStyle({ "--shiki-light": "#D73A49", "--shiki-dark": "#F97583" })}"> |</span><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}"> grep</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> httpd</span></span></code></pre></div><p>格式：<code>user:role:type:level</code></p><h2 id="_3-类型强制" tabindex="-1">3. 类型强制 <a class="header-anchor" href="#_3-类型强制" aria-label="Permalink to &quot;3. 类型强制&quot;">​</a></h2><p>SELinux 通过类型（Type）控制访问：</p><div class="language-bash vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">bash</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 进程类型</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">httpd_t</span><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">    # Apache</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">sshd_t</span><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">     # SSH</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 文件类型</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">httpd_sys_content_t</span><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">    # Web 内容</span></span></code></pre></div><h2 id="_4-工作流程" tabindex="-1">4. 工作流程 <a class="header-anchor" href="#_4-工作流程" aria-label="Permalink to &quot;4. 工作流程&quot;">​</a></h2><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>进程请求访问 → 检查 DAC → 检查 SELinux 策略 → 允许/拒绝</span></span></code></pre></div><h2 id="参考资料" tabindex="-1">参考资料 <a class="header-anchor" href="#参考资料" aria-label="Permalink to &quot;参考资料&quot;">​</a></h2><ul><li>Red Hat SELinux 文档 — <a href="https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/using_selinux/index" target="_blank" rel="noreferrer">docs.redhat.com</a></li><li>Arch Wiki - SELinux — <a href="https://wiki.archlinux.org/title/SELinux" target="_blank" rel="noreferrer">wiki.archlinux.org</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("basic/security/concept.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const concept = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  concept as default
};
