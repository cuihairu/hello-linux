import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"网络篇","description":"","frontmatter":{},"headers":[],"relativePath":"network/README.md","filePath":"network/README.md","lastUpdated":1790050890000}');
const _sfc_main = { name: "network/README.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="网络篇" tabindex="-1">网络篇 <a class="header-anchor" href="#网络篇" aria-label="Permalink to &quot;网络篇&quot;">​</a></h1><p>Linux 网络知识，涵盖网络基础、防火墙、网络服务、故障排除等。</p><h2 id="内容" tabindex="-1">内容 <a class="header-anchor" href="#内容" aria-label="Permalink to &quot;内容&quot;">​</a></h2><ul><li><a href="./basics.html">网络基础</a></li><li><a href="./firewall.html">防火墙</a></li><li><a href="./vpn.html">VPN</a></li><li><a href="./load-balancing.html">负载均衡</a></li><li><a href="./network-monitoring.html">网络监控</a></li><li><a href="./network-configuration.html">网络配置基础</a></li><li><a href="./troubleshooting.html">网络故障排除</a></li></ul><h2 id="参考资料" tabindex="-1">参考资料 <a class="header-anchor" href="#参考资料" aria-label="Permalink to &quot;参考资料&quot;">​</a></h2><ul><li><a href="https://linux.vbird.org/linux_server/0110networkbasic.php" target="_blank" rel="noreferrer">鸟哥的私房菜 - 网络基础</a></li><li><a href="https://wiki.archlinux.org/title/Networking" target="_blank" rel="noreferrer">Arch Wiki - Networking</a></li><li><a href="https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_and_managing_networking/index" target="_blank" rel="noreferrer">RHEL 网络文档</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("network/README.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const README = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  README as default
};
