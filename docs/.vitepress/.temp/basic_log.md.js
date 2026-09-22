import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"日志系统","description":"","frontmatter":{},"headers":[],"relativePath":"basic/log.md","filePath":"basic/log.md","lastUpdated":1789960591000}');
const _sfc_main = { name: "basic/log.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="日志系统" tabindex="-1">日志系统 <a class="header-anchor" href="#日志系统" aria-label="Permalink to &quot;日志系统&quot;">​</a></h1><p>Linux 日志系统，包括系统日志和日志轮转。</p><h2 id="内容" tabindex="-1">内容 <a class="header-anchor" href="#内容" aria-label="Permalink to &quot;内容&quot;">​</a></h2><ul><li><a href="./log/syslog.html">系统日志</a></li><li><a href="./log/rotation.html">日志轮转</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("basic/log.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const log = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  log as default
};
