import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"系统服务","description":"","frontmatter":{},"headers":[],"relativePath":"basic/services.md","filePath":"basic/services.md","lastUpdated":1789960591000}');
const _sfc_main = { name: "basic/services.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="系统服务" tabindex="-1">系统服务 <a class="header-anchor" href="#系统服务" aria-label="Permalink to &quot;系统服务&quot;">​</a></h1><p>Linux 系统服务管理、日志管理和配置工具。</p><h2 id="内容" tabindex="-1">内容 <a class="header-anchor" href="#内容" aria-label="Permalink to &quot;内容&quot;">​</a></h2><ul><li><a href="./services/system_services.html">系统服务管理</a></li><li><a href="./services/log_management.html">日志管理</a></li><li><a href="./services/configuration_tools.html">系统配置工具</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("basic/services.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const services = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  services as default
};
