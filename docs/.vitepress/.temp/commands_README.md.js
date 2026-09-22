import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"命令篇","description":"","frontmatter":{},"headers":[],"relativePath":"commands/README.md","filePath":"commands/README.md","lastUpdated":1790050890000}');
const _sfc_main = { name: "commands/README.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="命令篇" tabindex="-1">命令篇 <a class="header-anchor" href="#命令篇" aria-label="Permalink to &quot;命令篇&quot;">​</a></h1><p>Linux 命令参考手册，按功能分类整理，供其他章节交叉引用。</p><h2 id="使用说明" tabindex="-1">使用说明 <a class="header-anchor" href="#使用说明" aria-label="Permalink to &quot;使用说明&quot;">​</a></h2><p>本篇提供常用命令的详细说明和示例，读者可以在学习其他章节时快速查阅相关命令。</p><h2 id="章节组织" tabindex="-1">章节组织 <a class="header-anchor" href="#章节组织" aria-label="Permalink to &quot;章节组织&quot;">​</a></h2><ul><li><strong>基本命令</strong>：文件和目录的基本操作</li><li><strong>文本处理</strong>：文本编辑、搜索和处理</li><li><strong>查找与定位</strong>：文件查找、内容搜索</li><li><strong>压缩与归档</strong>：文件压缩、打包管理</li><li><strong>系统管理</strong>：系统监控、进程管理</li><li><strong>网络管理</strong>：网络配置和诊断</li><li><strong>包管理</strong>：软件安装和管理</li></ul><h2 id="命令格式约定" tabindex="-1">命令格式约定 <a class="header-anchor" href="#命令格式约定" aria-label="Permalink to &quot;命令格式约定&quot;">​</a></h2><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>命令 [选项] [参数]</span></span></code></pre></div><ul><li><code>命令</code>：要执行的命令</li><li><code>[选项]</code>：可选的命令选项</li><li><code>[参数]</code>：命令的操作对象</li></ul><h2 id="常见选项约定" tabindex="-1">常见选项约定 <a class="header-anchor" href="#常见选项约定" aria-label="Permalink to &quot;常见选项约定&quot;">​</a></h2><ul><li><code>-a</code>：显示所有信息</li><li><code>-l</code>：长格式显示</li><li><code>-r</code>：递归操作</li><li><code>-v</code>：详细输出</li><li><code>-f</code>：强制执行</li><li><code>-i</code>：交互式操作</li></ul><h2 id="参考资料" tabindex="-1">参考资料 <a class="header-anchor" href="#参考资料" aria-label="Permalink to &quot;参考资料&quot;">​</a></h2><ul><li><a href="https://linux.vbird.org/linux_basic/centos7/0340bash.php" target="_blank" rel="noreferrer">鸟哥的私房菜 - 命令行与 Shell</a></li><li><a href="https://wiki.archlinux.org/title/Core_utilities" target="_blank" rel="noreferrer">Arch Wiki - Core utilities</a></li><li><a href="https://man7.org/linux/man-pages/" target="_blank" rel="noreferrer">Linux man pages</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("commands/README.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const README = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  README as default
};
