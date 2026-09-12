// 静态一致性检查：
//   · 引用资源是否存在、内联脚本语法、id 引用
//   · 公开页面与本地管理系统是否真的隔离
//   · 路径前缀（admin/ 子目录里的 ../ 是否都写对）
//   · 嵌入式文章数据是否与 JSON 真源同步
// 用法: node tools/test-assets.mjs
import { readFile, stat } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PUBLIC_PAGES = ['index.html', 'articles.html', 'article.html'];
const ADMIN_PAGES = ['admin/index.html', 'admin/editor.html', 'admin/selftest.html'];
const ALL_PAGES = [...PUBLIC_PAGES, ...ADMIN_PAGES];

let pass = 0, fail = 0, warn = 0;
const failures = [];
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; failures.push(name); console.log('  FAIL ' + name + (extra ? '\n         ' + extra : '')); }
}
function w(name, extra) { warn++; console.log('  warn ' + name + (extra ? '\n         ' + extra : '')); }

const read = (p) => readFile(resolve(ROOT, p), 'utf8');

console.log('\n== 1. 引用资源是否存在 ==');
const missing = [];
for (const page of ALL_PAGES) {
  const html = await read(page);
  const refs = [
    ...[...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<link[^>]*\shref="([^"]+)"/g)].map((m) => m[1])
  ].filter((u) => !/^(https?:|data:|mailto:|#)/.test(u));

  for (const ref of new Set(refs)) {
    // 相对路径按页面所在目录解析
    const p = resolve(ROOT, dirname(page), ref);
    if (!(await stat(p).then(() => true, () => false))) missing.push(page + ' → ' + ref);
  }
}
t('页面引用的本地资源全部存在', missing.length === 0, missing.join('\n'));

console.log('\n== 2. 内联脚本语法 ==');
for (const page of ALL_PAGES) {
  const html = await read(page);
  // 只取"没有 src 属性"的 script
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  let bad = null;
  scripts.forEach((code, i) => {
    try { new Function(code); } catch (e) { bad = '第 ' + (i + 1) + ' 段: ' + e.message; }
  });
  t(page + ' 内联脚本语法正确（' + scripts.length + ' 段）', bad === null, bad);
}

console.log('\n== 3. 页面引用的 id 是否定义 ==');
for (const page of ALL_PAGES) {
  const html = await read(page);
  const defined = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const used = new Set([
    ...[...html.matchAll(/getElementById\(\s*'([^']+)'/g)].map((m) => m[1]),
    ...[...html.matchAll(/querySelector\(\s*'#([A-Za-z0-9_-]+)'/g)].map((m) => m[1])
  ]);
  // 编辑器/站点脚本里动态生成的 id 不属于本页
  const dynamicOk = /^(ed-|readingProgress|toast|toc|fnref-|fn-)/;
  const undef = [...used].filter((id) => !defined.has(id) && !dynamicOk.test(id));
  t(page + ' 无未定义的 id 引用', undef.length === 0, '未定义: ' + undef.join(', '));
}

console.log('\n== 4. 前后端隔离 ==');
for (const page of PUBLIC_PAGES) {
  const html = await read(page);
  const links = [...html.matchAll(/(?:href|src)\s*=\s*["'][^"']*(?:admin\/|editor\.html|selftest\.html)[^"']*["']/gi)].map((m) => m[0]);
  t(page + ' 不含指向本地管理系统的链接', links.length === 0, '发现: ' + links.join(', '));
}
for (const page of PUBLIC_PAGES) {
  const html = await read(page);
  t(page + ' 未引用 admin.css', !/admin\.css/.test(html));
}
// 公开页面的脚本里也不应跳转到编辑器（file:// 下也不允许出现写文章入口）
for (const page of PUBLIC_PAGES) {
  const html = await read(page);
  t(page + ' 脚本中无编辑器跳转', !/location\.href\s*=\s*['"][^'"]*editor\.html/.test(html));
}
for (const page of ADMIN_PAGES) {
  const html = await read(page);
  t(page + ' 标记为不索引', /name="robots"[^>]*noindex/.test(html), '缺少 noindex');
  t(page + ' 无外部 CDN 依赖', !/https?:\/\/(cdn|unpkg|fonts\.googleapis)/.test(html));
}

console.log('\n== 5. admin/ 子目录路径前缀 ==');
for (const page of ADMIN_PAGES) {
  const html = await read(page);
  // 站内资源必须带 ../ 前缀；数据脚本必须带 asset base
  const localScripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => !/^https?:/.test(u));
  // 站点公共资源走 ../；后台自身的模块放在 admin/js/ 下（同样不会部署到线上）
  const badScripts = localScripts.filter((u) => u.indexOf('../') !== 0 && u.indexOf('js/') !== 0);
  t(page + ' 脚本路径前缀正确', badScripts.length === 0, '异常: ' + badScripts.join(', '));

  const localLinks = [...html.matchAll(/<link[^>]*\shref="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((u) => !/^(https?:|data:)/.test(u));
  const badLinks = localLinks.filter((u) => u.indexOf('../') !== 0 && u.indexOf('admin.css') !== 0);
  t(page + ' 样式路径正确', badLinks.length === 0, '异常: ' + badLinks.join(', '));

  t(page + ' 设置了 data-wj-asset-base="../"', /data-wj-asset-base="\.\.\/"/.test(html),
    'KaTeX 会因此解析到 admin/vendor/ 而加载失败');
  t(page + ' 引入 ../articles-data.js', /src="\.\.\/articles-data\.js"/.test(html));
}

console.log('\n== 6. 资源大小 ==');
const vendorFiles = readdirSync(join(ROOT, 'vendor/katex'), { recursive: true })
  .map(String).filter((f) => /\.(js|css|woff2)$/.test(f));
let total = 0;
for (const f of vendorFiles) total += (await stat(join(ROOT, 'vendor/katex', f))).size;
t('KaTeX 自托管资源完整', vendorFiles.length >= 10, '文件数: ' + vendorFiles.length);
console.log('       vendor/katex 体积: ' + (total / 1048576).toFixed(2) + ' MiB（' + vendorFiles.length + ' 个文件，含字体）');

const jsFiles = ['store', 'blog', 'markdown', 'math', 'convert', 'ui', 'site', 'editor', 'export-pdf'].map((n) => 'assets/js/' + n + '.js');
let jsTotal = 0;
for (const f of jsFiles) {
  const s = await stat(resolve(ROOT, f));
  jsTotal += s.size;
  console.log('       ' + f.padEnd(28) + (s.size / 1024).toFixed(1) + ' KB');
}
console.log('       合计 ' + (jsTotal / 1024).toFixed(1) + ' KB（无构建、无第三方依赖）');

console.log('\n== 7. 遗留调试代码 ==');
let dirty = 0;
for (const f of [...jsFiles, ...ALL_PAGES]) {
  const src = await read(f);
  const hits = [];
  if (/^\s*console\.log\(/m.test(src)) hits.push('console.log');
  if (/^\s*debugger\s*;?\s*$/m.test(src)) hits.push('debugger');
  if (/\/\/\s*(TODO|FIXME|XXX)/.test(src)) hits.push('TODO/FIXME');
  if (hits.length) { dirty++; w(f + ' 含 ' + hits.join('/'), ''); }
}
if (!dirty) console.log('  ok   未发现遗留调试代码');

console.log('\n== 8. 关键功能痕迹 ==');
const store = await read('assets/js/store.js');
t('store 使用 IndexedDB', /indexedDB\.open/.test(store));
t('store 支持 img:// 本地图片引用', /img:\/\//.test(store));
t('store 提供导入导出', /exportArticleFile/.test(store) && /importJSON/.test(store));
t('store 支持嵌入式数据（file:// 可用）', /WJ_ARTICLES/.test(store) && /isFileProtocol/.test(store));
t('store 能从脚本位置推导资源前缀', /assets\\\/js\\\/store\.js|assets\/js\/store\.js/.test(store) && /basePrefix/.test(store));
t('store 支持删除标记（不区分线上线下）',
  /var META_DELETED/.test(store) && /function markDeleted/.test(store) && /function unmarkDeleted/.test(store));
t('store 列表会剔除已打删除标记的文章', /listDeleted\(\)\]/.test(store) && /deleted: deleted/.test(store));

const publishJs = await read('admin/js/publish.js');
t('发布包携带删除标记', /deletions: deletions/.test(publishJs));

const publishMjs = await read('tools/publish.mjs');
t('落地脚本会执行删除标记', /packDeletions/.test(publishMjs) && /--delete=/.test(publishMjs));
t('store 仓库索引/正文请求都套用资源前缀',
  /fetchJSON\(assetURL\(ARTICLES_DIR \+ 'index\.json'\)\)/.test(store) && /fetchJSON\(assetURL\(file\)\)/.test(store),
  'admin/ 子目录下否则会 404');
const md = await read('assets/js/markdown.js');
t('渲染器支持块级公式', /math-block/.test(md));
t('渲染器转义 HTML（防 XSS）', /function esc\(/.test(md));
const ed = await read('assets/js/editor.js');
t('编辑器支持图片上传', /type="file"|insertImageFiles/.test(ed));
t('编辑器支持富文本与源码双模式', /switchMode/.test(ed) && /md-source/.test(ed));
t('编辑器自动保存', /scheduleSave/.test(ed));
const math = await read('assets/js/math.js');
t('公式引擎指向本地 vendor/（无 CDN）', /vendor\\?\/katex/.test(math) && !/https?:\/\/(cdn|unpkg)/.test(math));
t('公式引擎资源路径可配置前缀', /assetBase/.test(math) && /data-wj-asset-base/.test(math));
const pdf = await read('assets/js/export-pdf.js');
t('导出 PDF 复用浏览器打印（不引第三方库）',
  /global\.print\(\)/.test(pdf) && !/\.min\.js|cdnjs|unpkg|jsdelivr|createElement\('script'\)/.test(pdf));
t('导出 PDF 用打印专用容器承载正文', /wj-print-root/.test(pdf) && /wj-printing/.test(pdf));
t('导出 PDF 固定亮色主题（避免深色反相）', /data-theme/.test(pdf) && /'light'/.test(pdf));
t('导出 PDF 解析 img:// 与相对图片路径', /img:\\\/\\\//.test(pdf) && /assetURL/.test(pdf));
const css = await read('assets/css/articles.css');
t('样式表提供打印排版', /@media print/.test(css) && /\.wj-print-root/.test(css));
// 后台的导出逻辑已抽到 admin/js/ 模块，因此 WJExportPDF 的接线在「页面 + 后台模块」里一起校验
const adminJs = (await Promise.all(['shell', 'ai', 'dashboard', 'articles', 'images', 'publish', 'settings', 'editor-page']
  .map((n) => read('admin/js/' + n + '.js').catch(() => '')))).join('\n');
const entryPages = [await read('article.html'), await read('admin/editor.html'), await read('admin/index.html')];
t('阅读页 / 编辑器 / 管理系统都挂了导出 PDF 入口',
  entryPages.every((html) => /export-pdf\.js/.test(html)) &&
  entryPages.every((html) => /WJExportPDF/.test(html) || /WJExportPDF/.test(adminJs)));

console.log('\n== 9. 发布与部署工具 ==');
for (const f of ['tools/publish.mjs', 'tools/deploy.mjs', 'tools/build-articles.mjs', 'tools/fetch-katex.mjs']) {
  t(f + ' 存在', await stat(resolve(ROOT, f)).then(() => true, () => false));
}
const deploy = await read('tools/deploy.mjs');
t('deploy 使用白名单而非黑名单', /PUBLIC_FILES/.test(deploy) && /PUBLIC_DIRS/.test(deploy));
t('deploy 校验禁止目录', /FORBIDDEN/.test(deploy) && /admin/.test(deploy) && /tools/.test(deploy));
t('deploy 不拷贝 admin/ 与 tools/',
  !/PUBLIC_DIRS[\s\S]*?\]/.test(deploy) ? false : (function () {
    // 直接解析白名单数组，确认里面没有 admin / tools
    var m = /const PUBLIC_DIRS = \[([\s\S]*?)\]/.exec(deploy);
    var list = m ? m[1] : '';
    return list.indexOf('admin') === -1 && list.indexOf('tools') === -1;
  })(),
  'PUBLIC_DIRS 里不应出现 admin 或 tools');
const publish = await read('tools/publish.mjs');
t('publish 支持发布包格式', /wuji-blog-publish/.test(publish));
t('publish 会重建 articles-data.js', /build-articles\.mjs/.test(publish));
t('publish 默认跳过草稿', /include-drafts/.test(publish) && /status !== 'published'/.test(publish));
t('robots.txt 声明禁止抓取本地目录', /Disallow: \/admin\//.test(await read('robots.txt')));

console.log('\n== 10. 嵌入式文章数据 ==');
const dataJs = await read('articles-data.js');
t('articles-data.js 已生成', dataJs.length > 200);
t('articles-data.js 定义 WJ_ARTICLES', /window\.WJ_ARTICLES\s*=/.test(dataJs));
t('articles-data.js 定义 WJ_ARTICLES_BY_ID', /window\.WJ_ARTICLES_BY_ID\s*=/.test(dataJs));
// 后台页面用 store.js（IndexedDB 本地库），公开页面用 blog.js（纯静态阅读层），
// 两者都不再共用同一个数据层——这正是"展示与后台解耦"的落点。
for (const page of ADMIN_PAGES) {
  const html = await read(page);
  const dataIdx = html.indexOf('articles-data.js');
  const storeIdx = html.indexOf('js/store.js');
  t('  ' + page + ' 数据脚本在 store.js 之前', dataIdx !== -1 && storeIdx !== -1 && dataIdx < storeIdx,
    'dataIdx=' + dataIdx + ' storeIdx=' + storeIdx);
}
for (const page of PUBLIC_PAGES) {
  const html = await read(page);
  const dataIdx = html.indexOf('articles-data.js');
  const blogIdx = html.indexOf('js/blog.js');
  t('  ' + page + ' 数据脚本在 blog.js 之前', dataIdx !== -1 && blogIdx !== -1 && dataIdx < blogIdx,
    'dataIdx=' + dataIdx + ' blogIdx=' + blogIdx);
  t('  ' + page + ' 不加载后台数据层 store.js', !/js\/store\.js/.test(html));
}

console.log('\n== 11. 资源前缀运行时解析（admin/ 子目录） ==');
{
  const vm = await import('node:vm');
  const code = await read('assets/js/math.js');
  const tag = (src) => ({ getAttribute: (n) => (n === 'src' ? src : null) });
  const inline = { getAttribute: () => null };
  function runMath(currentScript, tags) {
    const sb = {
      document: {
        currentScript,
        querySelectorAll: () => tags,
        querySelector: () => null,
        createElement: () => ({ setAttribute() {} }),
        head: { appendChild() {} }
      },
      console
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(code, sb, { filename: 'assets/js/math.js' });
    return sb.WJMath.cssHref();
  }
  t('admin 内联触发时前缀由脚本 src 推导',
    runMath(inline, [tag('../assets/js/math.js')]) === '../vendor/katex/katex.min.css',
    runMath(inline, [tag('../assets/js/math.js')]));
  t('根目录页面前缀为空',
    runMath(tag('assets/js/math.js'), [tag('assets/js/math.js')]) === 'vendor/katex/katex.min.css',
    runMath(tag('assets/js/math.js'), [tag('assets/js/math.js')]));
  t('显式 data-wj-asset-base 优先',
    runMath({ getAttribute: (n) => (n === 'data-wj-asset-base' ? '../' : null) }, []) === '../vendor/katex/katex.min.css');
}

console.log('\n== 12. AI 生成只留在后台 ==');
{
  const ai = await read('admin/js/ai.js');
  const adminShell = await read('admin/index.html');
  t('AI 模块存在于 admin/js/', ai.length > 500);
  t('默认模型是 DeepSeek V4.1（deepseek-flash）', /DEFAULTS[\s\S]{0,120}deepseek-flash/.test(ai));
  t('默认走 DeepSeek 官方接口', /https:\/\/api\.deepseek\.com/.test(ai));
  t('Key 存放位置写明是本机 localStorage', /localStorage/.test(ai) && new RegExp('wj-ai-config').test(ai));
  t('代码里没有硬编码的 Key', !/[Aa]piKey\s*[:=]\s*['"]sk-/.test(ai));
  t('AI 请求用 JSON 输出而非流式拼接', /json_object/.test(ai) && /stream: false/.test(ai));
  const aiIdx = adminShell.indexOf('js/ai.js');
  t('管理外壳加载 AI 模块', aiIdx !== -1);
  t('AI 模块先于用到它的视图模块加载',
    aiIdx !== -1 && aiIdx < adminShell.indexOf('js/images.js') && aiIdx < adminShell.indexOf('js/settings.js'));
  for (const page of PUBLIC_PAGES) {
    t('  ' + page + ' 不引用 AI 模块', (await read(page)).indexOf('ai.js') === -1);
  }
  const imagesJs = await read('admin/js/images.js');
  t('images 视图保留「一键转文章」入口', /一键转文章/.test(imagesJs));
  t('图片库上传只入库、不自动生成',
    /AI\.saveImageFile\(f\)/.test(imagesJs) && /需要写稿就点它的「一键转文章」/.test(imagesJs),
    '上传入口不应顺手调用 start()，生成必须由用户手动点按');
  const editorHtml = await read('admin/editor.html');
  t('编辑器提供手动「AI 写稿」按钮', /id="aiBtn"/.test(editorHtml) && /AI 写稿/.test(editorHtml));
  t('编辑器页加载 AI 模块（否则按钮点了没反应）', /js\/ai\.js/.test(editorHtml));
  const editorPage = await read('admin/js/editor-page.js');
  t('AI 写稿是手动触发，覆盖前先确认',
    /getElementById\('aiBtn'\)/.test(editorPage) && /AI 写稿会覆盖当前内容/.test(editorPage));
  t('AI 写稿把结果回填进当前编辑器', /editor\.load\(out\.article\)/.test(editorPage));
  const selftest = await read('admin/selftest.html');
  t('自测页加载了 AI 模块（否则那一节会静默跳过）', /<script src="js\/ai\.js">/.test(selftest));
  t('自测页的 AI 用例不发真实请求', /testAI[\s\S]*?未配置 Key 时拒绝调用/.test(selftest));
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败, ${warn} 警告`);
if (failures.length) console.log('失败项: ' + failures.join(' | '));
console.log('');
process.exit(fail ? 1 : 0);
