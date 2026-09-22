import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"硬件篇","description":"","frontmatter":{},"headers":[],"relativePath":"hardware/README.md","filePath":"hardware/README.md","lastUpdated":1790050890000}');
const _sfc_main = { name: "hardware/README.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="硬件篇" tabindex="-1">硬件篇 <a class="header-anchor" href="#硬件篇" aria-label="Permalink to &quot;硬件篇&quot;">​</a></h1><p>本篇介绍计算机硬件的工作原理和 Linux 下的管理方法，涵盖从体系结构到具体设备的完整知识。</p><h2 id="内容" tabindex="-1">内容 <a class="header-anchor" href="#内容" aria-label="Permalink to &quot;内容&quot;">​</a></h2><table tabindex="0"><thead><tr><th>章节</th><th>内容</th></tr></thead><tbody><tr><td><a href="./architecture.html">计算机体系结构</a></td><td>冯·诺依曼体系、指令执行、总线、寄存器、中断、存储层次</td></tr><tr><td><a href="./cpu.html">CPU</a></td><td>核心/线程、缓存、指令集、频率管理、NUMA</td></tr><tr><td><a href="./memory.html">内存</a></td><td>DRAM 原理、DDR 代际、ECC、Swap、大页内存</td></tr><tr><td><a href="./storage.html">存储设备</a></td><td>HDD/SSD/NVMe、RAID、分区、文件系统选型</td></tr><tr><td><a href="./network.html">网络设备</a></td><td>网卡、驱动、性能调优、无线网络</td></tr></tbody></table><h2 id="学习建议" tabindex="-1">学习建议 <a class="header-anchor" href="#学习建议" aria-label="Permalink to &quot;学习建议&quot;">​</a></h2><ol><li>先读<strong>体系结构</strong>，建立整体认知</li><li>按需学习具体设备章节</li><li>每章都配有实战命令，建议动手练习</li></ol><h2 id="参考资料" tabindex="-1">参考资料 <a class="header-anchor" href="#参考资料" aria-label="Permalink to &quot;参考资料&quot;">​</a></h2><ul><li>Patterson &amp; Hennessy《计算机组成与设计》</li><li>Bryant &amp; O&#39;Hallaron《深入理解计算机系统》(CSAPP)</li><li><a href="https://wiki.archlinux.org/title/Category:Hardware" target="_blank" rel="noreferrer">Arch Wiki - Hardware</a></li><li><a href="https://linux-hardware.org/" target="_blank" rel="noreferrer">Linux Hardware Database</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("hardware/README.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const README = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  README as default
};
