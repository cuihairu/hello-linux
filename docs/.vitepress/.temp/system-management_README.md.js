import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"系统管理篇","description":"","frontmatter":{},"headers":[],"relativePath":"system-management/README.md","filePath":"system-management/README.md","lastUpdated":1790050890000}');
const _sfc_main = { name: "system-management/README.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="系统管理篇" tabindex="-1">系统管理篇 <a class="header-anchor" href="#系统管理篇" aria-label="Permalink to &quot;系统管理篇&quot;">​</a></h1><p>Linux 系统管理知识，涵盖用户管理、服务管理、安全管理、性能优化、备份恢复、自动化运维等。</p><h2 id="内容" tabindex="-1">内容 <a class="header-anchor" href="#内容" aria-label="Permalink to &quot;内容&quot;">​</a></h2><ul><li><a href="./performance.html">性能优化</a></li><li><a href="./backup-and-recovery.html">备份与恢复</a></li><li><a href="./automation.html">自动化运维</a></li></ul><h2 id="参考资料" tabindex="-1">参考资料 <a class="header-anchor" href="#参考资料" aria-label="Permalink to &quot;参考资料&quot;">​</a></h2><ul><li><a href="https://linux.vbird.org/linux_basic/centos7/" target="_blank" rel="noreferrer">鸟哥的私房菜 - 系统管理</a></li><li><a href="https://wiki.archlinux.org/title/System_maintenance" target="_blank" rel="noreferrer">Arch Wiki - System maintenance</a></li><li><a href="https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/" target="_blank" rel="noreferrer">RHEL 系统管理文档</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("system-management/README.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const README = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  README as default
};
