import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"文本处理","description":"","frontmatter":{},"headers":[],"relativePath":"commands/text.md","filePath":"commands/text.md","lastUpdated":1790045732000}');
const _sfc_main = { name: "commands/text.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="文本处理" tabindex="-1">文本处理 <a class="header-anchor" href="#文本处理" aria-label="Permalink to &quot;文本处理&quot;">​</a></h1><p>Linux 文本处理命令。</p><h2 id="内容" tabindex="-1">内容 <a class="header-anchor" href="#内容" aria-label="Permalink to &quot;内容&quot;">​</a></h2><ul><li><a href="./text/text_processing.html">文本处理命令</a></li><li><a href="./text/editors.html">文本编辑和查看工具</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("commands/text.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const text = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  text as default
};
