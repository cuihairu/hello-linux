import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"安装 Linux","description":"","frontmatter":{},"headers":[],"relativePath":"basic/installation.md","filePath":"basic/installation.md","lastUpdated":1789960591000}');
const _sfc_main = { name: "basic/installation.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="安装-linux" tabindex="-1">安装 Linux <a class="header-anchor" href="#安装-linux" aria-label="Permalink to &quot;安装 Linux&quot;">​</a></h1><p>安装 Linux 的准备工作和安装过程。</p><h2 id="内容" tabindex="-1">内容 <a class="header-anchor" href="#内容" aria-label="Permalink to &quot;内容&quot;">​</a></h2><ul><li><a href="./installation/choose_distribution.html">选择合适的发行版</a></li><li><a href="./installation/preparation.html">安装前的准备</a></li><li><a href="./installation/process.html">安装过程</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("basic/installation.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const installation = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  installation as default
};
