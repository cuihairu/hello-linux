import { ssrRenderAttrs, ssrRenderStyle } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"脚本篇","description":"","frontmatter":{},"headers":[],"relativePath":"script/README.md","filePath":"script/README.md","lastUpdated":1790045732000}');
const _sfc_main = { name: "script/README.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="脚本篇" tabindex="-1">脚本篇 <a class="header-anchor" href="#脚本篇" aria-label="Permalink to &quot;脚本篇&quot;">​</a></h1><p>Shell 脚本编程是 Linux 系统管理和自动化的基础技能。</p><blockquote><p>内容参考自 Bash 手册、Advanced Bash-Scripting Guide 和实际运维经验，见各章节参考资料。</p></blockquote><h2 id="学习目标" tabindex="-1">学习目标 <a class="header-anchor" href="#学习目标" aria-label="Permalink to &quot;学习目标&quot;">​</a></h2><ul><li>掌握 Bash 脚本基础语法和调试技巧</li><li>学会使用变量、数组、条件判断和循环</li><li>掌握函数定义和文本处理工具</li><li>了解正则表达式和 sed/awk 高级用法</li><li>能够编写实用的自动化脚本</li></ul><h2 id="内容" tabindex="-1">内容 <a class="header-anchor" href="#内容" aria-label="Permalink to &quot;内容&quot;">​</a></h2><table tabindex="0"><thead><tr><th>章节</th><th>内容</th></tr></thead><tbody><tr><td><a href="./bash-basics.html">Bash 基础</a></td><td>脚本结构、执行方式、引号规则、特殊字符</td></tr><tr><td><a href="./variables.html">变量与数据类型</a></td><td>变量定义、环境变量、数组、算术运算</td></tr><tr><td><a href="./conditionals.html">条件判断</a></td><td>if/else、case、逻辑运算符、文件测试</td></tr><tr><td><a href="./loops.html">循环结构</a></td><td>for、while、until、循环控制</td></tr><tr><td><a href="./functions.html">函数</a></td><td>函数定义、参数、返回值、局部变量</td></tr><tr><td><a href="./text-processing.html">文本处理</a></td><td>grep、sed、awk 实战</td></tr><tr><td><a href="./regex.html">正则表达式</a></td><td>基础正则、扩展正则、PCRE</td></tr><tr><td><a href="./debugging.html">脚本调试</a></td><td>调试技巧、错误处理、日志记录</td></tr><tr><td><a href="./examples.html">实战案例</a></td><td>系统监控、自动备份、日志分析等</td></tr></tbody></table><h2 id="快速入门" tabindex="-1">快速入门 <a class="header-anchor" href="#快速入门" aria-label="Permalink to &quot;快速入门&quot;">​</a></h2><div class="language-bash vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang">bash</span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}">#!/bin/bash</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#6A737D", "--shiki-dark": "#6A737D" })}"># 第一个脚本</span></span>
<span class="line"></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}">echo</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> &quot;Hello, World!&quot;</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}">echo</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> &quot;当前时间: $(</span><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">date</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}">)&quot;</span></span>
<span class="line"><span style="${ssrRenderStyle({ "--shiki-light": "#005CC5", "--shiki-dark": "#79B8FF" })}">echo</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}"> &quot;当前用户: $(</span><span style="${ssrRenderStyle({ "--shiki-light": "#6F42C1", "--shiki-dark": "#B392F0" })}">whoami</span><span style="${ssrRenderStyle({ "--shiki-light": "#032F62", "--shiki-dark": "#9ECBFF" })}">)&quot;</span></span></code></pre></div><h2 id="参考资料" tabindex="-1">参考资料 <a class="header-anchor" href="#参考资料" aria-label="Permalink to &quot;参考资料&quot;">​</a></h2><ul><li><a href="https://www.gnu.org/software/bash/manual/" target="_blank" rel="noreferrer">Bash 手册</a></li><li><a href="https://tldp.org/LDP/abs/html/" target="_blank" rel="noreferrer">Advanced Bash-Scripting Guide</a></li><li><a href="https://www.shellcheck.net/" target="_blank" rel="noreferrer">ShellCheck</a> - 脚本静态分析工具</li><li><a href="https://google.github.io/styleguide/shellguide.html" target="_blank" rel="noreferrer">Google Shell Style Guide</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("script/README.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const README = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  README as default
};
