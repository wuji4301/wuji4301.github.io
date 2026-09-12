// 把管理系统的发布包落地到公开数据目录。
//
// 命令行:
//   node tools/publish.mjs <articles-publish.json> [--include-drafts] [--dry-run]
//   node tools/publish.mjs --delete <id>[,<id>...] [--dry-run]
//
// 也可以作为模块使用（tools/test-publish.mjs 就是这么测的）：
//   import { publish } from './tools/publish.mjs';
//   await publish({ packPath, deleteIds, includeDrafts, dryRun, log });
//
// 做四件事：
//   1) articles/<id>.json   —— 每篇一个文件（方便 git diff）
//   2) articles/index.json  —— 清单（公开站点通过 HTTP 读取，保持轻量：不内联正文）
//   3) articles-data.js     —— 嵌入式数据（file:// 直接打开也能读到）
//   4) 打印后续步骤（git add / commit / push）
//
// 删除：发布包里的 deletions（或命令行 --delete）是"删除标记"，只记 id、不看线上线下。
// 命中的 id 会从清单剔除、单篇文件删除；同一 id 同时又出现在 articles 里时以发布为准。
//
// 发布包里的 images 只记录元信息（id/name/type/size）——图片二进制在浏览器 IndexedDB 里，
// 需要从管理系统的「下载图片」按钮导出后手工放进 articles/img/。
// 正文与封面里的 img://<id> 也都要手工换成相对路径；漏掉的话会在日志里被逐条点名。
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARTICLES_DIR = resolve(ROOT, 'articles');

/** 只保留可公开的字段，且字段顺序稳定（便于 diff） */
export function cleanArticle(a) {
  const out = {};
  const order = ['id', 'slug', 'title', 'summary', 'tags', 'cover', 'format',
    'status', 'pinned', 'createdAt', 'updatedAt', 'body'];
  for (const k of order) {
    if (a[k] === undefined) continue;
    out[k] = k === 'tags'
      ? (Array.isArray(a[k]) ? a[k].map(String) : [])
      : (k === 'pinned' ? !!a[k] : a[k]);
  }
  for (const k of Object.keys(a)) {
    if (order.indexOf(k) === -1 && a[k] !== undefined) out[k] = a[k];
  }
  if (!out.id) throw new Error('文章缺少 id：' + JSON.stringify(a).slice(0, 120));
  if (!out.title) out.title = '未命名文章';
  if (!out.format) out.format = 'markdown';
  if (!out.status) out.status = 'draft';
  delete out.repoSnapshot;
  delete out.localOnly;
  delete out.source;
  return out;
}

/**
 * 找出仍带 img:// 引用的文章，正文与封面分别报。
 * 命令行拿不到图片二进制，替换只能靠人 —— 但至少要点名，否则封面里的
 * img:// 会静默上线，在公开站点上变成一个裂图（公开层没有 IndexedDB）。
 */
export function unresolvedRefs(list) {
  const hit = [];
  for (const a of list || []) {
    const fields = [];
    if (/img:\/\//.test(String(a && a.body || ''))) fields.push('正文');
    if (/img:\/\//.test(String(a && a.cover || ''))) fields.push('封面');
    if (fields.length) hit.push({ id: a.id, title: a.title || a.id, fields });
  }
  return hit;
}

function logUnresolved(leftovers, log) {
  if (!leftovers.length) return;
  log('\n注意：下面这些文章里还留着 img:// 引用（命令行走不了浏览器图库，无法自动替换）：');
  leftovers.slice(0, 10).forEach((h) => log('  · 《' + h.title + '》 ' + h.id + ' —— ' + h.fields.join(' / ')));
  if (leftovers.length > 10) log('  · … 其余 ' + (leftovers.length - 10) + ' 篇');
  log('  封面里的 img:// 一定要改：公开站点没有图库，读到它就是一个裂图。');
  log('  想免掉这一步：后台「发布中心 → 一键写入项目文件夹」会连图片一起写、并自动换好引用。');
}

function extOf(im) {
  const m = /\.([a-z0-9]+)$/i.exec(im.name || '');
  if (m) return m[1].toLowerCase();
  const t = String(im.type || '');
  if (/png/.test(t)) return 'png';
  if (/jpe?g/.test(t)) return 'jpg';
  if (/gif/.test(t)) return 'gif';
  if (/webp/.test(t)) return 'webp';
  if (/svg/.test(t)) return 'svg';
  return 'png';
}

/**
 * @returns {Promise<{written:string[], indexCount:number, skippedDrafts:number, images:object[], unresolved:object[]}>}
 *   `unresolved` 列出仍带 img:// 的文章（{id,title,fields}），命令行只能提示、不能替换。
 * @throws {Error} 参数/数据有问题时抛出（中文消息，直接可展示）
 */
export async function publish(opts = {}) {
  const log = opts.log || (() => {});
  const includeDrafts = !!opts.includeDrafts;
  const dryRun = !!opts.dryRun;
  const buildData = opts.buildData !== false;   // 默认重建 articles-data.js

  if (!opts.packPath && !(opts.deleteIds && opts.deleteIds.length)) {
    throw new Error('请提供发布包路径。\n' +
      '用法: node tools/publish.mjs "C:\\Users\\Administrator\\Downloads\\articles-publish.json" ' +
      '[--include-drafts] [--dry-run]\n' +
      '或:   node tools/publish.mjs --delete <id>[,<id>...] [--dry-run]');
  }

  let pack = null;
  if (opts.packPath) {
    const packAbs = resolve(process.cwd(), opts.packPath);
    try {
      pack = JSON.parse(await readFile(packAbs, 'utf8'));
    } catch (e) {
      throw new Error('无法读取发布包：' + e.message + '\n路径: ' + packAbs);
    }
  }

  const isPack = pack && pack.format === 'wuji-blog-publish';
  // 支持三种输入：发布包 / {articles:[...]} 清单 / 单篇文章对象
  let incoming;
  if (isPack) incoming = pack.articles || [];
  else if (Array.isArray(pack)) incoming = pack;
  else if (pack && Array.isArray(pack.articles)) incoming = pack.articles;
  else if (pack && typeof pack === 'object' && (pack.id || pack.title)) incoming = [pack];
  else incoming = [];

  // 删除标记：只记 id，不看线上线下。允许"只删不增"的发布包，也允许命令行直接指定。
  const packDeletions = (pack && !Array.isArray(pack) && Array.isArray(pack.deletions)) ? pack.deletions : [];
  const deletions = Array.from(new Set(
    packDeletions.concat(opts.deleteIds || [])
      .map((x) => String(x == null ? '' : x).trim())
      .filter(Boolean)
  ));

  if (!incoming.length && !deletions.length) {
    throw new Error(isPack ? '发布包里既没有文章，也没有删除标记'
      : '文件里没有文章（既不是发布包，也不是文章清单/单篇）');
  }

  incoming = incoming.map(cleanArticle);
  const drafts = incoming.filter((a) => a.status !== 'published');
  const publishable = includeDrafts ? incoming : incoming.filter((a) => a.status === 'published');

  if (opts.packPath) {
    log('发布包: ' + opts.packPath + (isPack && pack.generatedAt ? '（' + pack.generatedAt + '）' : ''));
  }
  if (isPack && pack.counts) {
    const delCount = pack.counts.deletions != null ? pack.counts.deletions : deletions.length;
    log('  包内统计: 共 ' + pack.counts.articles + ' 篇 / 已发布 ' + pack.counts.published +
        ' / 草稿 ' + pack.counts.drafts + ' / 删除 ' + delCount + ' / 图片 ' + pack.counts.images);
  }
  log('  本次写入: ' + publishable.length + ' 篇' +
      (drafts.length && !includeDrafts ? '（跳过 ' + drafts.length + ' 篇草稿，加 --include-drafts 可强制包含）' : ''));
  if (deletions.length) log('  本次删除: ' + deletions.length + ' 篇');

  if (!publishable.length && !deletions.length) {
    throw new Error('没有状态为 published 的文章。若确实要发布草稿，请加 --include-drafts');
  }

  // 读取现有清单并合并，保留未出现在发布包里的线上文章
  let existing = { articles: [] };
  try { existing = JSON.parse(await readFile(join(ARTICLES_DIR, 'index.json'), 'utf8')); } catch (e) { void e; }
  const existingList = Array.isArray(existing) ? existing : (existing.articles || []);
  const byId = new Map();
  for (const e of existingList) byId.set(e.id, e);
  for (const a of publishable) byId.set(a.id, a);

  // 删除：从清单里剔除，并记下要删的单篇文件。同一 id 又被发布时，以发布为准。
  const publishingIds = new Set(publishable.map((a) => a.id));
  const removed = [];
  for (const id of deletions) {
    if (publishingIds.has(id)) continue;
    const entry = byId.get(id);
    if (!entry) continue;
    byId.delete(id);
    removed.push({ id: id, file: entry.file || (id + '.json') });
  }
  if (deletions.length && !removed.length) {
    log('  删除: 清单里没有对应文章（可能已经删过），跳过');
  }

  const merged = [...byId.values()].sort(
    (x, y) => String(y.updatedAt || '').localeCompare(String(x.updatedAt || ''))
  );

  const images = isPack && Array.isArray(pack.images) ? pack.images : [];
  const leftovers = unresolvedRefs(publishable);

  if (dryRun) {
    log('\n--dry-run：以下操作不会真的执行');
    publishable.forEach((a) => log('  写入 articles/' + a.id + '.json   《' + a.title + '》  ' +
      (a.body ? Buffer.byteLength(a.body, 'utf8') : 0) + ' B'));
    removed.forEach((r) => log('  删除 articles/' + r.file));
    log('  更新 articles/index.json（共 ' + merged.length + ' 条）');
    log('  重建 articles-data.js');
    if (images.length) log('  提示放置 ' + images.length + ' 张图片到 articles/img/');
    logUnresolved(leftovers, log);
    return {
      written: [], removed: removed.map((r) => r.id),
      indexCount: merged.length, skippedDrafts: includeDrafts ? 0 : drafts.length, images,
      unresolved: leftovers, dryRun: true
    };
  }

  await mkdir(ARTICLES_DIR, { recursive: true });

  // 1) 单篇文件
  const written = [];
  for (const a of publishable) {
    const file = join(ARTICLES_DIR, a.id + '.json');
    await writeFile(file, JSON.stringify(a, null, 2) + '\n', 'utf8');
    written.push(a.id + '.json');
  }

  // 2) 删除标记：单篇文件一并移除（清单条目上面已经从 byId 里剔除，不会写回去）
  const removedIds = [];
  for (const r of removed) {
    await rm(join(ARTICLES_DIR, r.file), { force: true });
    removedIds.push(r.id);
  }

  // 2) 清单：元信息 + file 指针，正文留在单篇文件里（清单保持轻量，避免 diff 噪音）
  const index = {
    version: 1,
    updatedAt: new Date().toISOString(),
    articles: merged.map((a) => {
      const meta = Object.assign({}, a);
      delete meta.body;
      return Object.assign(meta, { file: a.id + '.json' });
    })
  };
  await writeFile(join(ARTICLES_DIR, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');

  // 3) 嵌入式数据（直接调用生成器，不额外起进程）
  let dataResult = null;
  if (buildData) {
    try {
      const mod = await import('./build-articles.mjs');
      if (typeof mod.build === 'function') dataResult = await mod.build({ log });
    } catch (e) {
      log('（提示）重建 articles-data.js 失败：' + e.message + '\n  请手动运行 node tools/build-articles.mjs');
    }
  }

  log('\n完成：');
  log('  写入单篇: ' + written.length + ' 个文件');
  if (removedIds.length) log('  删除单篇: ' + removedIds.length + ' 个文件');
  log('  清单条数: ' + index.articles.length);
  log('  嵌入式数据: ' + (dataResult ? 'articles-data.js 已重建' : '未重建（见上方提示）'));

  if (images.length) {
    log('\n图片（' + images.length + ' 张）需要手工放置：');
    log('  1) 在管理系统点「下载图片」，或用之前下载的文件');
    log('  2) 放进 articles/img/');
    log('  3) 把正文与封面里的 img://<id> 换成 articles/img/<id>.<ext>');
    log('  参考文件名：');
    images.slice(0, 8).forEach((im) => log('    ' + im.id + '.' + extOf(im)));
    if (images.length > 8) log('    … 其余 ' + (images.length - 8) + ' 张');
  }

  logUnresolved(leftovers, log);

  log('\n下一步：');
  log('  git add articles/ articles-data.js && git commit -m "更新文章" && git push');

  return {
    written, removed: removedIds,
    indexCount: index.articles.length, skippedDrafts: includeDrafts ? 0 : drafts.length, images,
    unresolved: leftovers
  };
}

/* --------------------------------------------------------------- CLI */

const invokedDirectly = process.argv[1] &&
  resolve(process.argv[1]).toLowerCase() === resolve(fileURLToPath(import.meta.url)).toLowerCase();

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));

  // 位置参数（发布包路径）与 --delete 的取值要分开：--delete 后面那个词是 id，不是路径
  const rest = [];
  const deleteIds = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--delete=')) {
      deleteIds.push(...a.slice('--delete='.length).split(','));
    } else if (a === '--delete') {
      if (args[i + 1] && !args[i + 1].startsWith('--')) deleteIds.push(...args[++i].split(','));
    } else if (!a.startsWith('--')) {
      rest.push(a);
    }
  }
  const packPath = rest[0];
  const cleanIds = deleteIds.map((s) => s.trim()).filter(Boolean);

  publish({
    packPath,
    deleteIds: cleanIds,
    includeDrafts: flags.has('--include-drafts'),
    dryRun: flags.has('--dry-run'),
    log: (...a) => console.log(...a)
  }).catch((e) => {
    console.error('错误：' + (e.message || e));
    process.exit(1);
  });
}
