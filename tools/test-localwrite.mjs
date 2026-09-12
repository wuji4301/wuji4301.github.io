// 「一键写入本地项目文件夹」（admin/js/localwrite.js）在 Node 里的真实跑测：
//   · 纯函数层直接断言，并与 tools/publish.mjs 的 cleanArticle 逐字节比对（唯一真源）；
//   · 文件夹层用内存版 FileSystemDirectoryHandle 垫片，把 writeToFolder 整条链路真跑一遍，
//     断言落盘的文件名、正文里的图片路径、删除的条目、以及给你的那条 git 命令。
// 全程不联网、不碰真磁盘、不弹目录选择器。
// 用法: node tools/test-localwrite.mjs
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '\n         ' + extra : '')); }
}

/* ============================================== 内存版文件系统（只实现用到的那一小撮） */

const NOT_FOUND = () => {
  const e = new Error('NotFoundError');
  e.name = 'NotFoundError';
  return e;
};

class MemFile {
  constructor(name) { this.kind = 'file'; this.name = name; this.data = ''; }
  async createWritable() {
    const self = this;
    return { async write(chunk) { self.data = chunk; }, async close() { /* 已即时落盘 */ } };
  }
  async getFile() {
    const self = this;
    return { async text() { return String(self.data); } };
  }
}

class MemDir {
  constructor(name) {
    this.kind = 'directory'; this.name = name;
    this.dirs = new Map(); this.files = new Map();
    this.permission = 'granted';       // 测试里可以手动改成 'prompt' 造出权限过期
  }
  async getDirectoryHandle(name, opts) {
    if (this.dirs.has(name)) return this.dirs.get(name);
    if (!opts || !opts.create) throw NOT_FOUND();
    const d = new MemDir(name); this.dirs.set(name, d); return d;
  }
  async getFileHandle(name, opts) {
    if (this.files.has(name)) return this.files.get(name);
    if (!opts || !opts.create) throw NOT_FOUND();
    const f = new MemFile(name); this.files.set(name, f); return f;
  }
  async removeEntry(name) {
    if (this.files.delete(name)) return;
    if (this.dirs.delete(name)) return;
    throw NOT_FOUND();
  }
  async queryPermission() { return this.permission; }
  // 模拟用户在弹窗里点了「允许」
  async requestPermission() { this.permission = 'granted'; return 'granted'; }
}

/** 用 { 'a/b.txt': '内容' } 造出一棵目录树，模拟用户选中的项目根目录 */
function buildFS(entries) {
  const root = new MemDir('wuji4301.github.io');
  Object.keys(entries || {}).forEach((p) => {
    const parts = p.split('/');
    const name = parts.pop();
    let d = root;
    parts.forEach((seg) => {
      if (!d.dirs.has(seg)) d.dirs.set(seg, new MemDir(seg));
      d = d.dirs.get(seg);
    });
    const f = new MemFile(name); f.data = entries[p]; d.files.set(name, f);
  });
  return root;
}

/** 读回磁盘上的内容；不存在返回 null（等价于 getFile 抛 NotFoundError） */
async function readFS(root, path) {
  const parts = path.split('/');
  const name = parts.pop();
  let d = root;
  for (const seg of parts) {
    if (!d.dirs.has(seg)) return null;
    d = d.dirs.get(seg);
  }
  return d.files.has(name) ? String(d.files.get(name).data) : null;
}

/* ============================================================ 载入真实脚本 */

const src = await readFile(resolve(ROOT, 'admin/js/localwrite.js'), 'utf8');

globalThis.window = globalThis;
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k)
};

vm.runInThisContext(src, { filename: 'admin/js/localwrite.js' });
const LW = globalThis.WJLocalWrite;

const published = (id, extra) => Object.assign({
  id, slug: id, title: '标题 ' + id, status: 'published',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-0' + (id.length % 9 + 1) + 'T00:00:00.000Z',
  body: '正文 ' + id
}, extra || {});

/* ============================================================ 0. 前置 */

console.log('\n== 0. 前置 ==');
t('模块已载入', !!LW, 'admin/js/localwrite.js 未加载？');
t('文章目录固定为 articles/', LW.ARTICLES_DIR === 'articles');
t('图片目录在 articles/img', LW.IMG_DIR === 'articles/img');
t('嵌入数据文件名固定', LW.DATA_FILE === 'articles-data.js');
t('配置键固定', LW.STORAGE_KEY === 'wj-localwrite-config');
t('句柄库独立于站点数据库', LW.FOLDER_DB === 'wuji-blog-folder' && LW.FOLDER_DB !== 'wuji-blog');
t('不再直连任何远端仓库', !/api\.github\.com|github_pat_|\bfetch\s*\(/.test(src), '源码里还有网络调用？');

// 头部注释必须与本地生成器逐字一致，否则浏览器与命令行会写出两份不一样的 articles-data.js。
// 直接解析 build-articles.mjs 的 header 数组（而不是比已生成的产物，产物可能是旧的）。
const buildSrc = await readFile(resolve(ROOT, 'tools/build-articles.mjs'), 'utf8');
const headerSrc = /const header = \[([\s\S]*?)\]\.join\('\\n'\);/.exec(buildSrc);
const genHeader = headerSrc
  ? headerSrc[1].match(/'((?:[^'\\]|\\.)*)'/g).map((s) => s.slice(1, -1).replace(/\\'/g, "'")).join('\n')
  : '';
t('DATA_HEADER 与 tools/build-articles.mjs 逐字一致', genHeader === LW.DATA_HEADER,
  JSON.stringify(genHeader) + ' vs ' + JSON.stringify(LW.DATA_HEADER));

console.log('\n== 1. 配置层 ==');
t('默认站点地址为空', LW.readConfig().siteUrl === '');
LW.writeConfig({ siteUrl: 'https://me.github.io/' });
t('写入时去掉结尾斜杠', LW.readConfig().siteUrl === 'https://me.github.io');
t('siteURL 读的就是它', LW.siteURL() === 'https://me.github.io');
LW.writeConfig({ siteUrl: '  ' });
t('空白被收成空串', LW.readConfig().siteUrl === '');
LW.writeConfig({ siteUrl: 'https://me.github.io/blog/' });
t('带子路径也归一化', LW.readConfig().siteUrl === 'https://me.github.io/blog');
t('坏 JSON 不会炸，回落默认值', (() => {
  globalThis.localStorage.setItem(LW.STORAGE_KEY, '{oops');
  const ok = LW.readConfig().siteUrl === '';
  LW.clearConfig();
  return ok;
})());
t('清除后回到默认值', (() => { LW.clearConfig(); return LW.readConfig().siteUrl === ''; })());
t('写坏 patch 不会清掉已存的值', (() => {
  LW.writeConfig({ siteUrl: 'https://a.example' });
  LW.writeConfig(null);
  const v = LW.readConfig().siteUrl;
  LW.clearConfig();
  return v === 'https://a.example';
})());

console.log('\n== 2. cleanArticle 与 tools/publish.mjs 逐字一致 ==');
const { cleanArticle: cliClean } = await import(pathToFileURL(resolve(ROOT, 'tools/publish.mjs')).href);
const messy = {
  id: 'a1', title: 'T', status: 'published', tags: ['x', 3], pinned: 1,
  extra: 'keep', repoSnapshot: { z: 1 }, localOnly: true, source: 'repo',
  body: 'b', updatedAt: 'u', createdAt: 'c'
};
t('两处 cleanArticle 输出逐字节相同', JSON.stringify(LW.cleanArticle(messy)) === JSON.stringify(cliClean(messy)),
  JSON.stringify(LW.cleanArticle(messy)) + ' vs ' + JSON.stringify(cliClean(messy)));
t('剥掉 repoSnapshot / localOnly / source', !('repoSnapshot' in LW.cleanArticle(messy)) && !('localOnly' in LW.cleanArticle(messy)) && !('source' in LW.cleanArticle(messy)));
t('tags 归成字符串数组', JSON.stringify(LW.cleanArticle(messy).tags) === '["x","3"]');
t('pinned 归成布尔', LW.cleanArticle(messy).pinned === true);
t('缺 id 直接报错', (() => { try { LW.cleanArticle({ title: 'x' }); return false; } catch (e) { return /id/.test(e.message); } })());
t('缺 title 补占位', LW.cleanArticle({ id: 'z' }).title === '未命名文章');
t('缺 status 落到 draft', LW.cleanArticle({ id: 'z' }).status === 'draft');

console.log('\n== 3. 图片与文本纯函数 ==');
t('扩展名优先看文件名', LW.extOf({ name: 'p.webp', type: 'image/png' }) === 'webp');
t('没有文件名时看 MIME', LW.extOf({ name: 'noext', type: 'image/jpeg' }) === 'jpg');
t('都不认识就落 png', LW.extOf({ name: 'noext', type: '' }) === 'png');
t('收集 img:// 引用', LW.collectImageIds([{ body: 'a img://p1 b img://p2' }]).join(',') === 'p1,p2');
t('同一张图只算一次', LW.collectImageIds([{ body: 'img://p1' }, { body: 'img://p1' }]).join(',') === 'p1');
t('img:// 换成本地路径', LW.applyImages('x img://a', { a: 'articles/img/a.png' }) === 'x articles/img/a.png');
t('找不到的图片保留原样', LW.applyImages('x img://b', {}) === 'x img://b');
t('applyImages 对空正文安全', LW.applyImages(null, {}) === '');
t('articleJSON 末尾有换行', LW.articleJSON({ id: 'k' }).endsWith('\n'));

// 封面是第二个 img:// 入口：只处理正文的话，封面会带着 img:// 上线，在公开站点变成裂图
t('封面里的图片也会被收集', LW.collectImageIds([{ body: '', cover: 'img://c1' }]).join(',') === 'c1');
t('只有封面引用时也认得出来', LW.collectImageIds([{ cover: 'img://c1' }]).join(',') === 'c1');
t('正文与封面的图片合并去重', LW.collectImageIds([{ body: 'img://p1', cover: 'img://p1' }]).join(',') === 'p1');
t('先正文后封面，顺序稳定', LW.collectImageIds([{ body: 'img://b1', cover: 'img://c1' }]).join(',') === 'b1,c1');
t('cover 是空串也不炸', LW.collectImageIds([{ body: 'img://p1', cover: '' }]).join(',') === 'p1');
t('applyImagesToArticle 同时换正文与封面', (() => {
  const a = LW.applyImagesToArticle(
    { id: 'k', title: 'K', cover: 'img://c1', body: '图 img://b1' },
    { b1: 'articles/img/b1.png', c1: 'articles/img/c1.jpg' }
  );
  return a.body === '图 articles/img/b1.png' && a.cover === 'articles/img/c1.jpg';
})());
t('applyImagesToArticle 保留空封面', LW.applyImagesToArticle({ id: 'k', title: 'K', cover: '', body: 'x' }, {}).cover === '');
t('applyImagesToArticle 没有封面就不造一个', !('cover' in LW.applyImagesToArticle({ id: 'k', title: 'K', body: 'x' }, {})));
t('resolveEntryImages 换掉清单条目的封面', (() => {
  const e = LW.resolveEntryImages([{ id: 'k', cover: 'img://c1' }], { c1: 'articles/img/c1.jpg' })[0];
  return e.cover === 'articles/img/c1.jpg';
})());
t('resolveEntryImages 不动没有封面的条目', (() => {
  const src = [{ id: 'k', title: 'K' }];
  return LW.resolveEntryImages(src, {})[0] === src[0];
})());

const idxText = LW.indexJSON([{ id: 'k', title: 'K', body: 'B' }], '2026-01-01T00:00:00.000Z');
const idxObj = JSON.parse(idxText);
t('清单里不含正文', !('body' in idxObj.articles[0]));
t('清单带 file 指针', idxObj.articles[0].file === 'k.json');
t('清单带 version 与 updatedAt', idxObj.version === 1 && idxObj.updatedAt === '2026-01-01T00:00:00.000Z');

console.log('\n== 4. buildPlan ==');
const existing = [
  { id: 'old', title: 'O', status: 'published', updatedAt: '2026-01-01T00:00:00.000Z', file: 'old.json' },
  { id: 'older', title: 'OO', status: 'published', updatedAt: '2025-12-01T00:00:00.000Z', file: 'older.json' }
];
let plan = LW.buildPlan({
  articles: [published('k'), Object.assign(published('d'), { status: 'draft' })],
  deletions: [],
  existing
});
t('草稿不进写入清单', plan.publishable.length === 1 && plan.publishable[0].id === 'k');
t('草稿被计数', plan.drafts === 1);
t('没动过的文章保留在清单里', plan.indexEntries.length === 3);
t('清单按 updatedAt 倒序', plan.indexEntries.map((a) => a.id).join(',') === 'k,old,older');
t('磁盘上旧文章要回读正文', plan.needBodies.join(',') === 'old,older');
t('本次要写的文章不用回读', plan.needBodies.indexOf('k') === -1);

t('includeDrafts 会把草稿一起写', LW.buildPlan({
  articles: [published('k'), Object.assign(published('d'), { status: 'draft' })],
  deletions: [], existing: [], includeDrafts: true
}).publishable.length === 2);

let del = LW.buildPlan({ articles: [], deletions: ['old'], existing });
t('删除标记摘下清单', del.indexEntries.map((a) => a.id).join(',') === 'older');
t('删除项带文件名', del.removed.length === 1 && del.removed[0].file === 'old.json');
t('被删的 id 不再需要回读正文', del.needBodies.indexOf('old') === -1);

del = LW.buildPlan({ articles: [], deletions: ['nope'], existing });
t('磁盘上没有的 id 不会被删', del.removed.length === 0 && del.indexEntries.length === 2);

del = LW.buildPlan({ articles: [published('old')], deletions: ['old'], existing });
t('同一轮「又发又删」以发布为准', del.removed.length === 0 && del.indexEntries.some((a) => a.id === 'old'));

del = LW.buildPlan({ articles: [], deletions: ['  old  ', '', null], existing });
t('删除 id 会去掉空白与空值', del.removed.length === 1 && del.removed[0].id === 'old');

t('同一 id 重复出现只留一份', LW.buildPlan({
  articles: [published('k', { updatedAt: '2026-02-01T00:00:00.000Z' }), published('k', { updatedAt: '2026-01-01T00:00:00.000Z' })],
  deletions: [], existing: []
}).indexEntries.length === 1);
t('空输入得到空计划', (() => {
  const p = LW.buildPlan({ articles: [], deletions: [], existing: [] });
  return !p.publishable.length && !p.removed.length && !p.indexEntries.length;
})());

console.log('\n== 5. fileTexts ==');
const texts = LW.fileTexts({
  publishable: [published('k', { body: '看图 img://p1', cover: 'img://p1' })],
  removed: [],
  indexEntries: [{ id: 'k', title: '标题 k', status: 'published', cover: 'img://p1', body: '看图 img://p1' }]
}, { p1: 'articles/img/p1.png' }, '2026-01-01T00:00:00.000Z');
const byPath = {};
texts.forEach((f) => { byPath[f.path] = f.text; });
t('写出单篇文件', !!byPath['articles/k.json']);
t('写出清单', !!byPath['articles/index.json']);
t('单篇正文里的图片已换路径', byPath['articles/k.json'].includes('articles/img/p1.png'));
t('单篇正文不再有 img://', !byPath['articles/k.json'].includes('img://'));
t('单篇封面已换成本地路径', byPath['articles/k.json'].includes('"cover": "articles/img/p1.png"'));
t('清单封面也已换成本地路径', byPath['articles/index.json'].includes('"cover": "articles/img/p1.png"'));
t('清单里不再有 img://', !byPath['articles/index.json'].includes('img://'));
t('清单里不含正文', !byPath['articles/index.json'].includes('看图'));
t('清单指向单篇文件', byPath['articles/index.json'].includes('"file": "k.json"'));

console.log('\n== 6. embeddedSource ==');
const emb = LW.embeddedSource([
  published('k', { body: 'bb' }),
  Object.assign(published('d'), { status: 'draft', body: 'dd' })
]);
t('草稿不进嵌入式数据', !emb.includes('dd'));
t('头部注释在第一行', emb.indexOf(LW.DATA_HEADER) === 0);
t('写出 window.WJ_ARTICLES', emb.includes('window.WJ_ARTICLES = ['));
t('建立 id 索引', emb.includes('WJ_ARTICLES_BY_ID'));
t('没有正文的条目被跳过', LW.embeddedSource([{ id: 'x', title: 'X', status: 'published' }]).includes('"x"') === false);

console.log('\n== 7. 提交信息与 git 命令 ==');
plan = LW.buildPlan({ articles: [published('k')], deletions: ['old'], existing });
t('提交信息带上标题', LW.commitMessage(plan).includes('《标题 k》'));
t('提交信息提到删除', LW.commitMessage(plan).includes('删除'));
t('git 命令包含 add / commit / push', /^git add .+ && git commit -m ".+" && git push$/.test(LW.gitCommand(plan)));
t('git 命令不引号套引号', !LW.gitCommand(LW.buildPlan({
  articles: [published('q', { title: '带"引号"的标题' })], deletions: [], existing: []
})).includes('""'));
t('没有改动时提交信息有兜底', LW.commitMessage({ publishable: [], removed: [] }) === '更新文章');

console.log('\n== 8. 文件夹层（内存文件系统） ==');
t('Node 里没有 showDirectoryPicker → 判定为不支持', LW.isSupported() === false);
t('不支持时 pickDirectory 给出可照做的提示', await LW.pickDirectory().then(() => false, (e) => e.message.includes('Chrome')));
t('folderState 在不支持时也不炸', (await LW.folderState()).supported === false);
t('没选目录时 writeToFolder 直接报错', await LW.writeToFolder({ articles: [published('k')] })
  .then(() => false, (e) => e.message.includes('还没有选择项目文件夹')));

t('checkRoot 认得出项目根目录', await LW.checkRoot(buildFS({ 'index.html': '<html>' })) === true);
t('只有 articles/ 也认', await LW.checkRoot(buildFS({ 'articles/index.json': '[]' })) === true);
t('别的文件夹会被挡下并说明该选哪层', await LW.checkRoot(buildFS({ 'random/readme.md': 'x' }))
  .then(() => false, (e) => e.message.includes('项目根目录') && e.message.includes('admin/')));

console.log('\n== 9. 端到端写入 ==');
const fsRoot = buildFS({
  'index.html': '<html></html>',
  'articles/index.json': JSON.stringify({ version: 1, articles: existing }),
  'articles/old.json': JSON.stringify(published('old')),
  'articles/older.json': JSON.stringify(published('older'))
});
const imgRecord = { id: 'p1', name: 'p1.png', type: 'image/png', blob: { size: 3, tag: 'blob-p1' } };
const imgCover = { id: 'p2', name: 'p2.jpg', type: 'image/jpeg', blob: { size: 5, tag: 'blob-p2' } };
// 封面故意引一张正文里没出现的图（p2）：只扫正文的实现既不会写出这张图、
// 也换不掉封面引用，正好能卡住那个 bug。
const out = await LW.writeToFolder({
  dir: fsRoot,
  articles: [published('k', { body: '看图 img://p1', cover: 'img://p2' })],
  deletions: ['old'],
  getImage: (id) => (id === 'p1' ? imgRecord : (id === 'p2' ? imgCover : null)),
  updatedAt: '2026-01-01T00:00:00.000Z'
});

t('返回被写入的文件夹名', out.folder === 'wuji4301.github.io', out.folder);
t('报告写入篇数', out.published === 1);
t('报告删除篇数', out.removed.join(',') === 'old');
t('报告图片张数（正文一张 + 封面一张）', out.images === 2);
t('报告清单总数', out.indexCount === 2);
t('没有缺失图片', out.missingImages.length === 0);

const kFile = await readFS(fsRoot, 'articles/k.json');
const idxFile = await readFS(fsRoot, 'articles/index.json');
t('单篇文章真的落盘了', kFile !== null);
t('落盘的正文已换成本地图片路径', kFile.includes('articles/img/p1.png'));
t('落盘的封面已换成本地图片路径', JSON.parse(kFile).cover === 'articles/img/p2.jpg');
t('封面引用的图片也写进了 articles/img/', (await readFS(fsRoot, 'articles/img/p2.jpg')) === String(imgCover.blob));
t('单篇文件里一个 img:// 都不剩', !kFile.includes('img://'));
t('清单里的封面也换好了', JSON.parse(idxFile).articles.find((a) => a.id === 'k').cover === 'articles/img/p2.jpg');
t('清单里一个 img:// 都不剩', !idxFile.includes('img://'));
t('图片二进制写进 articles/img/', (await readFS(fsRoot, 'articles/img/p1.png')) === String(imgRecord.blob));
t('清单已重建', (await readFS(fsRoot, 'articles/index.json')).includes('"k.json"'));
t('articles-data.js 已重建', (await readFS(fsRoot, 'articles-data.js')).includes('window.WJ_ARTICLES = ['));
t('被删的单篇文件已消失', (await readFS(fsRoot, 'articles/old.json')) === null);
t('被删的 id 不在新清单里', !(await readFS(fsRoot, 'articles/index.json')).includes('"old.json"'));
t('没动过的文章仍在清单里', (await readFS(fsRoot, 'articles/index.json')).includes('"older.json"'));
t('没动过的文章原文件没被改写', (await readFS(fsRoot, 'articles/older.json')).includes('标题 older'));
const embOut = await readFS(fsRoot, 'articles-data.js');
t('嵌入数据带上新写的正文', embOut.includes('articles/img/p1.png'));
t('嵌入数据里的封面也是本地路径', embOut.includes('"cover": "articles/img/p2.jpg"'));
t('嵌入数据里没有 img://', !embOut.includes('img://'));
t('嵌入数据带上从磁盘回读的旧文章', embOut.includes('标题 older'));
t('嵌入数据不含被删的文章', !embOut.includes('标题 old"'));
t('给了可直接跑的 git 命令', out.command.startsWith('git add articles articles-data.js && git commit -m "'));
t('命令里带你填的提交信息', out.command.includes('标题 k'));

console.log('\n== 10. 边界 ==');
const emptyFs = buildFS({ 'index.html': '<html>' });
t('没有任何改动时拒绝写入', await LW.writeToFolder({ dir: emptyFs, articles: [Object.assign(published('d'), { status: 'draft' })], deletions: [] })
  .then(() => false, (e) => e.message.includes('没有可写入的改动')));
t('目录不存在时会自己建出来', await LW.writeToFolder({ dir: emptyFs, articles: [published('k')], deletions: [] })
  .then((o) => o.published === 1 && readFS(emptyFs, 'articles/k.json').then((v) => v !== null))
  .then((v) => v === true, () => false));

const badFs = buildFS({ 'index.html': '<html>', 'articles/index.json': '{坏掉的 json' });
t('本机清单坏掉时给出可照做的提示', await LW.writeToFolder({ dir: badFs, articles: [published('k')], deletions: [] })
  .then(() => false, (e) => e.message.includes('index.json')));

const plainFs = buildFS({ 'index.html': '<html>' });
t('清单是裸数组也认', await LW.writeToFolder({
  dir: plainFs, articles: [published('k')], deletions: [],
  updatedAt: '2026-01-01T00:00:00.000Z'
}).then((o) => o.indexCount === 1, () => false));

const promptFs = buildFS({ 'index.html': '<html>' });
promptFs.permission = 'prompt';
t('权限过期时非交互调用会被拦下', await LW.writeToFolder({ dir: promptFs, articles: [published('k')], interactive: false })
  .then(() => false, (e) => e.message.includes('权限')));
t('权限过期时交互调用会重新申请', await LW.writeToFolder({ dir: promptFs, articles: [published('k')], interactive: true })
  .then((o) => o.published === 1, () => false));

const goneFs = buildFS({ 'index.html': '<html>' });
t('删除一个已经不存在的文件不会失败', await LW.writeToFolder({
  dir: goneFs, articles: [], deletions: ['ghost'],
  getImage: () => null
}).then(() => false, (e) => e.message.includes('没有可写入的改动')));

const missFs = buildFS({ 'index.html': '<html>' });
const missOut = await LW.writeToFolder({
  dir: missFs, articles: [published('k', { body: 'img://nope' })], deletions: [],
  getImage: () => null, updatedAt: '2026-01-01T00:00:00.000Z'
});
t('本地找不到的图片会被报告', missOut.missingImages.join(',') === 'nope');
t('缺失图片时不写空文件', (await readFS(missFs, 'articles/img/nope.png')) === null);

const missCovFs = buildFS({ 'index.html': '<html>' });
const missCovOut = await LW.writeToFolder({
  dir: missCovFs, articles: [published('k', { body: '这里没有图', cover: 'img://nope2' })], deletions: [],
  getImage: () => null, updatedAt: '2026-01-01T00:00:00.000Z'
});
t('封面找不到的图片同样会被报告', missCovOut.missingImages.join(',') === 'nope2');
t('封面缺图时保留 img:// 原样，交给人工处理', (await readFS(missCovFs, 'articles/k.json')).includes('img://nope2'));

console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
