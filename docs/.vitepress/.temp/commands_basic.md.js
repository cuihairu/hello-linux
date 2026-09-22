import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"基本命令","description":"","frontmatter":{},"headers":[],"relativePath":"commands/basic.md","filePath":"commands/basic.md","lastUpdated":1789960591000}');
const _sfc_main = { name: "commands/basic.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="基本命令" tabindex="-1">基本命令 <a class="header-anchor" href="#基本命令" aria-label="Permalink to &quot;基本命令&quot;">​</a></h1><p>Linux 基本命令，包括文件和目录操作。</p><h2 id="内容" tabindex="-1">内容 <a class="header-anchor" href="#内容" aria-label="Permalink to &quot;内容&quot;">​</a></h2><ul><li><a href="./basic/file.html">文件操作</a></li><li><a href="./basic/directory.html">目录操作</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("commands/basic.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const basic = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  basic as default
};
