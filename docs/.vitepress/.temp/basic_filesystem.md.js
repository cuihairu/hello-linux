import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"文件系统","description":"","frontmatter":{},"headers":[],"relativePath":"basic/filesystem.md","filePath":"basic/filesystem.md","lastUpdated":1789960591000}');
const _sfc_main = { name: "basic/filesystem.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="文件系统" tabindex="-1">文件系统 <a class="header-anchor" href="#文件系统" aria-label="Permalink to &quot;文件系统&quot;">​</a></h1><p>Linux 文件系统的概念、目录结构和权限管理。</p><h2 id="内容" tabindex="-1">内容 <a class="header-anchor" href="#内容" aria-label="Permalink to &quot;内容&quot;">​</a></h2><ul><li><a href="./filesystem/concept.html">文件系统概念</a></li><li><a href="./filesystem/hierarchy.html">目录层次结构</a></li><li><a href="./filesystem/permissions.html">文件权限</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("basic/filesystem.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const filesystem = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  filesystem as default
};
