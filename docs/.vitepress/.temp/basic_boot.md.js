import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"开机流程","description":"","frontmatter":{},"headers":[],"relativePath":"basic/boot.md","filePath":"basic/boot.md","lastUpdated":1789960591000}');
const _sfc_main = { name: "basic/boot.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="开机流程" tabindex="-1">开机流程 <a class="header-anchor" href="#开机流程" aria-label="Permalink to &quot;开机流程&quot;">​</a></h1><p>Linux 开机流程，包括 BIOS/UEFI 和 GRUB 引导程序。</p><h2 id="内容" tabindex="-1">内容 <a class="header-anchor" href="#内容" aria-label="Permalink to &quot;内容&quot;">​</a></h2><ul><li><a href="./boot/bios_uefi.html">BIOS 与 UEFI</a></li><li><a href="./boot/grub.html">GRUB 引导程序</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("basic/boot.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const boot = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  boot as default
};
