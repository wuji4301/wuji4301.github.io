// 嵌入式数据（articles-data.js）校验：确认公开页面在 file:// 下真的能取到文章。
// 用法: node tools/test-data.mjs
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '\n         ' + extra : '')); }
}

// 1) 加载生成的脚本（模拟浏览器里 <script> 的执行环境：只有 window/global）
const src = await readFile(resolve(ROOT, 'articles-data.js'), 'utf8');
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'articles-data.js' });

console.log('\n== articles-data.js ==');
t('定义了 window.WJ_ARTICLES', Array.isArray(sandbox.WJ_ARTICLES));
t('定义了 window.WJ_ARTICLES_BY_ID', sandbox.WJ_ARTICLES_BY_ID && typeof sandbox.WJ_ARTICLES_BY_ID === 'object');

const list = sandbox.WJ_ARTICLES;
const byId = sandbox.WJ_ARTICLES_BY_ID;

// 条数由仓库内容决定（可以是 0），所以这里校验的是"索引与列表严格对应"，
// 而不是"必须非空"——后者会让清空博客变成一件要改测试的事。
// 两个索引在生成的脚本里是分别 JSON 序列化再解析出来的，对象引用不可能相等；
// 原先写成 byId[a.id] === a，只有在仓库为空（list 为空）时才恰好成立。
t('BY_ID 索引与列表一一对应',
  Object.keys(byId).length === list.length &&
  list.every((a) => JSON.stringify(byId[a.id]) === JSON.stringify(a)),
  '列表 ' + list.length + ' / 索引 ' + Object.keys(byId).length);

console.log('\n== 数据完整性 ==');
for (const a of list) {
  t('  ' + a.id + ' 有正文', typeof a.body === 'string' && a.body.trim().length > 0, '正文长度 ' + (a.body || '').length);
  t('  ' + a.id + ' 有 id/slug/title', !!(a.id && a.slug && a.title));
  t('  ' + a.id + ' 在 BY_ID 索引中', !!byId[a.id]);
  t('  ' + a.id + ' 状态为 published', a.status === 'published');
  t('  ' + a.id + ' 不含本地快照字段', a.repoSnapshot === undefined);
}

console.log('\n== 与文章清单一致 ==');
const indexJson = JSON.parse(await readFile(resolve(ROOT, 'articles/index.json'), 'utf8'));
const entries = Array.isArray(indexJson) ? indexJson : indexJson.articles;
t('清单条数与嵌入数据一致', entries.length === list.length, entries.length + ' vs ' + list.length);
for (const e of entries) {
  const a = byId[e.id];
  t('  ' + e.id + ' 标题一致', a && a.title === e.title, a ? a.title + ' vs ' + e.title : '缺失');
}

// 2) 单篇 JSON 与嵌入数据必须同源（避免改了 JSON 忘了重新生成）
console.log('\n== 单篇 JSON 与嵌入数据同源 ==');
for (const e of entries) {
  const file = e.file || (e.id + '.json');
  const single = JSON.parse(await readFile(resolve(ROOT, 'articles', file), 'utf8'));
  const embedded = byId[e.id];
  t('  ' + e.id + ' 正文一致（无需重新生成）', single.body === embedded.body,
    '文件 ' + (single.body || '').length + ' 字符 / 嵌入 ' + (embedded.body || '').length + ' 字符');
  t('  ' + e.id + ' 标题一致', single.title === embedded.title);
  t('  ' + e.id + ' updatedAt 一致', single.updatedAt === embedded.updatedAt);
}

// 3) 渲染器能吃掉嵌入的正文（与页面同一条解析路径）
console.log('\n== 嵌入正文可渲染 ==');
const mdSandbox = { console, window: {} };
mdSandbox.window.window = mdSandbox.window;
vm.createContext(mdSandbox);
vm.runInContext(await readFile(resolve(ROOT, 'assets/js/markdown.js'), 'utf8'), mdSandbox, { filename: 'markdown.js' });
const MD = mdSandbox.window.WJMarkdown;

// 仓库空的时候用一份内置样本接着跑：这几项验的是"渲染路径还能用"，
// 不该因为博客被清空就变成空转。
const SAMPLE_BODY = [
  '# 样本标题', '',
  '一段普通正文，包含 `行内代码`、**加粗**、*斜体* 与行内公式 $a^2 + b^2 = c^2$，',
  '以及一个链接 [示例](https://example.com)，用来覆盖常见的行内语法。', '',
  '## 第一节', '',
  '- 列表项一', '- 列表项二', '',
  '> 引用一段话。', '',
  '```js', 'const answer = 42;', '```', '',
  '## 第二节', '',
  '$$\n\\int_{0}^{1} x^{2} \\,\\mathrm{d}x = \\frac{1}{3}\n$$', '',
  '结尾段落，再补一句话让渲染结果足够长，便于断言输出确实成形了。'
].join('\n');

// 仓库文章的篇幅与结构由作者决定（可能只是一篇很短的测试稿），所以"结构渲染能力"
// 一律用内置样本断言；仓库里的文章只断言「嵌入的正文真的能渲染出非空 HTML」。
for (const a of list) {
  const html = MD.render(a.body);
  t('  ' + a.id + ' 渲染出非空 HTML', html.length > 0, '长度 ' + html.length);
}
console.log('  --   结构完整性用内置样本断言（不受仓库内容影响）');
const sampleHTML = MD.render(SAMPLE_BODY);
t('  内置样本 渲染出内容', sampleHTML.length > 500, '长度 ' + sampleHTML.length);
t('  内置样本 渲染出章节标题', /<h2[^>]*>/.test(sampleHTML), '没有 h2');
const sampleTOC = MD.extractTOC(SAMPLE_BODY);
t('  内置样本 可提取目录', sampleTOC.length >= 2, '目录 ' + sampleTOC.length + ' 条');

// 4) 公开页面走 blog.js 阅读层，后台页面走 store.js 本地库；数据脚本都必须先于数据层引入
console.log('\n== 页面接线 ==');
for (const page of ['index.html', 'articles.html', 'article.html']) {
  const html = await readFile(resolve(ROOT, page), 'utf8');
  const dataIdx = html.indexOf('articles-data.js');
  const blogIdx = html.indexOf('js/blog.js');
  t('  ' + page + ' 引入数据脚本且在 blog.js 之前', dataIdx !== -1 && blogIdx !== -1 && dataIdx < blogIdx,
    'dataIdx=' + dataIdx + ' blogIdx=' + blogIdx);
}
for (const page of ['admin/index.html', 'admin/editor.html', 'admin/selftest.html']) {
  const html = await readFile(resolve(ROOT, page), 'utf8');
  // admin/ 子目录里的路径带 ../ 前缀，这里用宽松匹配
  const dataIdx = html.indexOf('articles-data.js');
  const storeIdx = html.indexOf('js/store.js');
  t('  ' + page + ' 引入数据脚本且在 store.js 之前', dataIdx !== -1 && storeIdx !== -1 && dataIdx < storeIdx,
    'dataIdx=' + dataIdx + ' storeIdx=' + storeIdx);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
