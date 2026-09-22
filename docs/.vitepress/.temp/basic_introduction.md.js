import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"Linux 简介","description":"","frontmatter":{},"headers":[],"relativePath":"basic/introduction.md","filePath":"basic/introduction.md","lastUpdated":1789960591000}');
const _sfc_main = { name: "basic/introduction.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="linux-简介" tabindex="-1">Linux 简介 <a class="header-anchor" href="#linux-简介" aria-label="Permalink to &quot;Linux 简介&quot;">​</a></h1><p>Linux 简介章节，介绍 Linux 的基本概念、历史和发行版。</p><h2 id="内容" tabindex="-1">内容 <a class="header-anchor" href="#内容" aria-label="Permalink to &quot;内容&quot;">​</a></h2><ul><li><a href="./introduction/what_is_linux.html">什么是 Linux</a></li><li><a href="./introduction/history.html">Linux 的历史</a></li><li><a href="./introduction/distributions.html">Linux 发行版简介</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("basic/introduction.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const introduction = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  introduction as default
};
