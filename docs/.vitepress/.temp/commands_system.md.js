import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"系统管理","description":"","frontmatter":{},"headers":[],"relativePath":"commands/system.md","filePath":"commands/system.md","lastUpdated":1790050890000}');
const _sfc_main = { name: "commands/system.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="系统管理" tabindex="-1">系统管理 <a class="header-anchor" href="#系统管理" aria-label="Permalink to &quot;系统管理&quot;">​</a></h1><p>Linux 系统管理命令，包括系统信息查看、进程管理、内存管理和监控。</p><h2 id="内容" tabindex="-1">内容 <a class="header-anchor" href="#内容" aria-label="Permalink to &quot;内容&quot;">​</a></h2><ul><li><a href="./system/system_info.html">系统信息查看</a></li><li><a href="./system/process.html">进程管理</a></li><li><a href="./system/memory.html">内存管理</a></li><li><a href="./system/configuration-management.html">配置管理工具</a></li><li><a href="./system/monitoring.html">系统监控工具</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("commands/system.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const system = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  system as default
};
