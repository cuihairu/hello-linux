import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"基础篇","description":"","frontmatter":{},"headers":[],"relativePath":"basic/README.md","filePath":"basic/README.md","lastUpdated":1790050890000}');
const _sfc_main = { name: "basic/README.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="基础篇" tabindex="-1">基础篇 <a class="header-anchor" href="#基础篇" aria-label="Permalink to &quot;基础篇&quot;">​</a></h1><p>Linux 基础知识，涵盖概念、安装、文件系统、用户管理、服务管理、日志和安全等内容。</p><blockquote><p>本篇同时介绍 Debian/Ubuntu 和 RHEL/CentOS/Fedora 两系的差异。</p></blockquote><h2 id="参考资料" tabindex="-1">参考资料 <a class="header-anchor" href="#参考资料" aria-label="Permalink to &quot;参考资料&quot;">​</a></h2><ul><li><a href="https://linux.vbird.org/linux_basic/centos7/" target="_blank" rel="noreferrer">鸟哥的私房菜</a></li><li><a href="https://wiki.archlinux.org/" target="_blank" rel="noreferrer">Arch Wiki</a></li><li><a href="https://www.debian.org/doc/manuals/debian-handbook/" target="_blank" rel="noreferrer">Debian 手册</a></li><li><a href="https://docs.redhat.com/" target="_blank" rel="noreferrer">RHEL 文档</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("basic/README.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const README = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  README as default
};
