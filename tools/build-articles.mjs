// 从 articles/*.json 生成 articles-data.js（内联全部正文的 <script> 数据）。
//
// 为什么需要它：
//   fetch('articles/index.json') 在 file:// 下会被浏览器拦截，于是"直接双击打开
//   HTML"就看不到文章。用一个普通 <script> 提供同一份数据，就能彻底摆脱本地
//   服务器 —— 公开页面与本地编辑器都能在 file:// 下正常工作。
//
// 用法: node tools/build-articles.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'articles-data.js');

const readJSON = async (p) => JSON.parse(await readFile(p, 'utf8'));

/**
 * 生成 articles-data.js。
 * @param {{log?:Function, quiet?:boolean}} opts
 * @returns {Promise<{published:number, drafts:number, bytes:number, missing:string[]}>}
 */
async function build(opts = {}) {
  const log = opts.log || (() => {});
  let index;
  try {
    index = await readJSON(resolve(ROOT, 'articles/index.json'));
  } catch (e) {
    const err = new Error('读取 articles/index.json 失败：' + e.message);
    if (opts.log) { log(err.message); return { published: 0, drafts: 0, bytes: 0, missing: [], error: err.message }; }
    throw err;
  }

  const entries = Array.isArray(index) ? index : (index.articles || []);
  const inline = [];
  const missing = [];

  for (const entry of entries) {
    let full = entry;
    if (entry.body == null) {
      const file = entry.file || (entry.id + '.json');
      try {
        full = Object.assign({}, entry, await readJSON(resolve(ROOT, 'articles', file)));
      } catch (e) {
        missing.push(file + '（' + e.message + '）');
        continue;
      }
    }
    if (full.body == null) { missing.push((entry.id || '?') + '：缺少正文'); continue; }
    const item = Object.assign({}, full);
    delete item.repoSnapshot;
    inline.push(item);
  }

  // 只发布状态为 published 的文章；草稿保留在 JSON 文件里但不进公开数据
  const published = inline.filter((a) => a.status !== 'draft');
  const draftCount = inline.length - published.length;

  const header = [
    '/* 由 tools/build-articles.mjs 自动生成，请勿手工编辑。',
    ' * 数据来源：articles/index.json + articles/<id>.json',
    ' * 用途：让 index.html / articles.html / article.html',
    ' *       以及 admin/ 下的本地管理系统在 file:// 协议下（不启动服务器）也能读取文章。',
    ' * 变更文章后请重新运行：node tools/build-articles.mjs',
    ' */'
  ].join('\n');

  // BY_ID 在运行时按同一批对象建索引，而不是把数据再序列化一遍：
  // 这样 BY_ID[id] 与列表里那篇是同一个引用（调用方可直接用 === 比较），
  // 且索引严格与列表一一对应（草稿本来就不该进这份公开数据），文件体积也减半。
  const out = header + '\n' +
    'window.WJ_ARTICLES = ' + JSON.stringify(published, null, 2) + ';\n' +
    'window.WJ_ARTICLES_BY_ID = {};\n' +
    'window.WJ_ARTICLES.forEach(function (a) { window.WJ_ARTICLES_BY_ID[a.id] = a; });\n';

  await writeFile(OUT, out, 'utf8');

  const bytes = Buffer.byteLength(out, 'utf8');
  log('已生成 articles-data.js');
  log('  发布文章: ' + published.length + ' 篇');
  if (draftCount) log('  跳过草稿: ' + draftCount + ' 篇');
  if (missing.length) {
    log('  未能内联（已在清单中但读取失败）:');
    missing.forEach((m) => log('    - ' + m));
  }
  log('  体积: ' + (bytes / 1024).toFixed(1) + ' KB');
  published.forEach((a) => {
    log('    · ' + a.id + '  ' + a.title + '  (' + (a.body ? Buffer.byteLength(a.body, 'utf8') : 0) + ' B 正文)');
  });

  return { published: published.length, drafts: draftCount, bytes, missing };
}

export { build };

/* --------------------------------------------------------------- CLI */

const invokedDirectly = process.argv[1] &&
  resolve(process.argv[1]).toLowerCase() === resolve(fileURLToPath(import.meta.url)).toLowerCase();

if (invokedDirectly) {
  build({ log: (...a) => console.log(...a) })
    .then((r) => { process.exitCode = r.missing && r.missing.length ? 1 : 0; })
    .catch((e) => { console.error('生成失败：' + (e.stack || e.message)); process.exit(1); });
}

