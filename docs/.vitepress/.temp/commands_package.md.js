import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"包管理","description":"","frontmatter":{},"headers":[],"relativePath":"commands/package.md","filePath":"commands/package.md","lastUpdated":1789960591000}');
const _sfc_main = { name: "commands/package.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="包管理" tabindex="-1">包管理 <a class="header-anchor" href="#包管理" aria-label="Permalink to &quot;包管理&quot;">​</a></h1><p>Linux 包管理命令。</p><h2 id="内容" tabindex="-1">内容 <a class="header-anchor" href="#内容" aria-label="Permalink to &quot;内容&quot;">​</a></h2><ul><li><a href="./package/package.html">包管理命令</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("commands/package.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const _package = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  _package as default
};
