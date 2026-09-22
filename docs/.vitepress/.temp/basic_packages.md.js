import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"软件安装","description":"","frontmatter":{},"headers":[],"relativePath":"basic/packages.md","filePath":"basic/packages.md","lastUpdated":1789960591000}');
const _sfc_main = { name: "basic/packages.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="软件安装" tabindex="-1">软件安装 <a class="header-anchor" href="#软件安装" aria-label="Permalink to &quot;软件安装&quot;">​</a></h1><p>Linux 软件包管理，包括 APT 和 YUM/DNF。</p><h2 id="内容" tabindex="-1">内容 <a class="header-anchor" href="#内容" aria-label="Permalink to &quot;内容&quot;">​</a></h2><ul><li><a href="./packages/apt.html">APT 包管理</a></li><li><a href="./packages/yum.html">YUM/DNF 包管理</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("basic/packages.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const packages = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  packages as default
};
