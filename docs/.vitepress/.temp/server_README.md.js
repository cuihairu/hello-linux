import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"服务器篇","description":"","frontmatter":{},"headers":[],"relativePath":"server/README.md","filePath":"server/README.md","lastUpdated":1790050890000}');
const _sfc_main = { name: "server/README.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="服务器篇" tabindex="-1">服务器篇 <a class="header-anchor" href="#服务器篇" aria-label="Permalink to &quot;服务器篇&quot;">​</a></h1><p>Linux 服务器搭建和运维，涵盖 Web、数据库、容器、监控、DNS、邮件等核心服务。</p><blockquote><p>内容参考自鸟哥的私房菜、Arch Wiki 和各服务官方文档，见各章节参考资料。</p></blockquote><h2 id="内容" tabindex="-1">内容 <a class="header-anchor" href="#内容" aria-label="Permalink to &quot;内容&quot;">​</a></h2><table tabindex="0"><thead><tr><th>章节</th><th>内容</th></tr></thead><tbody><tr><td><a href="./web/nginx.html">Web 服务器</a></td><td>Nginx、Apache 安装配置、反向代理、HTTPS</td></tr><tr><td><a href="./web/apache.html">Apache</a></td><td>Apache HTTP Server 详细配置</td></tr><tr><td><a href="./database/mysql.html">数据库</a></td><td>MySQL 安装配置、备份恢复</td></tr><tr><td><a href="./redis.html">Redis</a></td><td>Redis 安装配置、数据结构、持久化、集群</td></tr><tr><td><a href="./ftp.html">FTP</a></td><td>vsftpd 安装配置、用户管理、安全设置</td></tr><tr><td><a href="./container/docker.html">容器</a></td><td>Docker 安装、镜像管理、Compose、K8s 入门</td></tr><tr><td><a href="./monitoring/prometheus.html">监控</a></td><td>Prometheus + Grafana 监控方案</td></tr><tr><td><a href="./dns/bind.html">DNS</a></td><td>BIND DNS 服务器配置</td></tr><tr><td><a href="./mail/postfix.html">邮件</a></td><td>Postfix 邮件服务器配置</td></tr></tbody></table><h2 id="行业推荐方案" tabindex="-1">行业推荐方案 <a class="header-anchor" href="#行业推荐方案" aria-label="Permalink to &quot;行业推荐方案&quot;">​</a></h2><table tabindex="0"><thead><tr><th>场景</th><th>推荐方案</th></tr></thead><tbody><tr><td>个人博客</td><td>Nginx + MySQL + WordPress</td></tr><tr><td>企业官网</td><td>Nginx + MariaDB + Docker</td></tr><tr><td>电商系统</td><td>Nginx + MySQL 主从 + Redis + Docker</td></tr><tr><td>缓存加速</td><td>Redis + Memcached</td></tr><tr><td>文件存储</td><td>FTP + NFS + 对象存储</td></tr><tr><td>开发测试</td><td>Docker Compose 一键部署</td></tr><tr><td>微服务</td><td>Kubernetes + Prometheus + Grafana</td></tr></tbody></table><h2 id="参考资料" tabindex="-1">参考资料 <a class="header-anchor" href="#参考资料" aria-label="Permalink to &quot;参考资料&quot;">​</a></h2><ul><li><a href="https://linux.vbird.org/linux_server/" target="_blank" rel="noreferrer">鸟哥的私房菜 - 服务器篇</a></li><li><a href="https://nginx.org/en/docs/" target="_blank" rel="noreferrer">Nginx 官方文档</a></li><li><a href="https://dev.mysql.com/doc/" target="_blank" rel="noreferrer">MySQL 官方文档</a></li><li><a href="https://docs.docker.com/" target="_blank" rel="noreferrer">Docker 官方文档</a></li><li><a href="https://prometheus.io/docs/" target="_blank" rel="noreferrer">Prometheus 官方文档</a></li></ul></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("server/README.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const README = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  README as default
};
