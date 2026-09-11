// 发布链路端到端测试：造一个发布包 → 调用 publish() 落地 → 校验产物 → 完整还原。
// 直接 import 函数而不是 spawn 子进程（沙箱下 child_process 可能被禁止，
// 而且函数级调用本来就更适合做断言）。
// 用法: node tools/test-publish.mjs
import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { publish, cleanArticle } from './publish.mjs';
import { build } from './build-articles.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARTICLES = resolve(ROOT, 'articles');
const DATA_JS = resolve(ROOT, 'articles-data.js');

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '\n         ' + extra : '')); }
}
const readJSON = async (p) => JSON.parse(await readFile(p, 'utf8'));
const exists = (p) => readFile(p).then(() => true, () => false);

/** 收集日志，同时静音真实输出（保持测试结果清晰） */
function makeLog() {
  const lines = [];
  return { lines, fn: (...a) => lines.push(a.join(' ')), text: () => lines.join('\n') };
}

/** 断言 publish 抛错，并检查消息 */
async function expectError(name, opts, re) {
  const log = makeLog();
  try {
    await publish(Object.assign({ log: log.fn }, opts));
    t(name, false, '没有抛错');
  } catch (e) {
    t(name, re.test(e.message), '错误信息不符：' + e.message);
  }
}

const scratch = join(tmpdir(), 'wj-publish-test-' + Date.now());

async function main() {
  const backup = join(scratch, 'backup');
  await mkdir(backup, { recursive: true });
  await cp(ARTICLES, join(backup, 'articles'), { recursive: true });
  await cp(DATA_JS, join(backup, 'articles-data.js'));

  let restored = false;
  async function restore() {
    if (restored) return;
    restored = true;
    await rm(ARTICLES, { recursive: true, force: true });
    await cp(join(backup, 'articles'), ARTICLES, { recursive: true });
    await cp(join(backup, 'articles-data.js'), DATA_JS);
  }

  try {
    const before = await readJSON(join(ARTICLES, 'index.json'));
    const beforeIds = before.articles.map((a) => a.id);
    console.log('\n== 前置状态 ==');
    console.log('  现有文章: ' + beforeIds.join(', '));

    /* ---------------------------------------------------- 字段清洗 */

    console.log('\n== 1. 导出字段清洗 ==');
    const dirty = cleanArticle({
      id: 'x', title: 'T', body: 'B', tags: 'not-an-array',
      localOnly: true, source: 'local', repoSnapshot: { junk: 1 }, status: 'published'
    });
    t('去掉 localOnly', dirty.localOnly === undefined);
    t('去掉 source', dirty.source === undefined);
    t('去掉 repoSnapshot', dirty.repoSnapshot === undefined);
    t('tags 归一化为数组', Array.isArray(dirty.tags), JSON.stringify(dirty.tags));
    t('字段顺序稳定（id 在前）', Object.keys(dirty)[0] === 'id', Object.keys(dirty).join(','));
    let threw = false;
    try { cleanArticle({ title: '没有 id' }); } catch (e) { threw = /缺少 id/.test(e.message); }
    t('缺少 id 时报错', threw);

    /* ---------------------------------------------------- 构造发布包 */

    console.log('\n== 2. 构造发布包（模拟管理系统导出） ==');
    const pack = {
      format: 'wuji-blog-publish',
      version: 1,
      generatedAt: new Date().toISOString(),
      site: 'file://',
      counts: { articles: 2, published: 1, drafts: 1, images: 1 },
      articles: [
        {
          id: 'zz-test-published',
          slug: 'zz-test-published',
          title: '测试：已发布文章',
          summary: '由 test-publish 生成',
          tags: ['自测', '临时'],
          cover: '',
          format: 'markdown',
          status: 'published',
          pinned: false,
          createdAt: '2026-02-01T00:00:00.000Z',
          updatedAt: '2026-02-01T00:00:00.000Z',
          body: '# 已发布\n\n行内公式 $a^2+b^2=c^2$ 与代码：\n\n```js\nconst x = 1;\n```\n',
          localOnly: true,
          source: 'local',
          repoSnapshot: { junk: true }
        },
        {
          id: 'zz-test-draft',
          slug: 'zz-test-draft',
          title: '测试：草稿',
          format: 'markdown',
          status: 'draft',
          createdAt: '2026-02-01T00:00:00.000Z',
          updatedAt: '2026-02-01T00:00:00.000Z',
          body: '草稿正文，不应被发布。\n'
        }
      ],
      images: [{ id: 'img-test-1', name: 'img-test-1.png', type: 'image/png', size: 68 }]
    };
    const packPath = join(scratch, 'articles-publish.json');
    await writeFile(packPath, JSON.stringify(pack, null, 2), 'utf8');
    t('发布包已生成', await exists(packPath));

    /* ---------------------------------------------------- dry-run */

    console.log('\n== 3. dry-run 不改动任何文件 ==');
    const dryLog = makeLog();
    const dry = await publish({ packPath, dryRun: true, log: dryLog.fn });
    t('dry-run 标记生效', dry.dryRun === true && dry.written.length === 0);
    t('dry-run 报告跳过草稿', /跳过 1 篇草稿/.test(dryLog.text()), dryLog.text().slice(0, 300));
    t('dry-run 报告图片提示', /放置 1 张图片/.test(dryLog.text()), dryLog.text().slice(0, 300));
    t('dry-run 后单篇文件未创建', !(await exists(join(ARTICLES, 'zz-test-published.json'))));
    t('dry-run 后清单未变', (await readJSON(join(ARTICLES, 'index.json'))).articles.length === beforeIds.length);

    /* ---------------------------------------------------- 正式落地 */

    console.log('\n== 4. 正式落地（默认只发布 published） ==');
    const log = makeLog();
    const res = await publish({ packPath, log: log.fn });
    t('返回写入 1 篇', res.written.length === 1, JSON.stringify(res.written));
    t('返回跳过 1 篇草稿', res.skippedDrafts === 1, String(res.skippedDrafts));
    t('报告写入 1 个文件', /写入单篇: 1 个文件/.test(log.text()), log.text().slice(-400));
    t('报告清单条数', new RegExp('清单条数: ' + (beforeIds.length + 1)).test(log.text()), log.text().slice(-400));

    t('已发布文章落了单篇文件', await exists(join(ARTICLES, 'zz-test-published.json')));
    t('草稿没有落盘', !(await exists(join(ARTICLES, 'zz-test-draft.json'))));

    const single = await readJSON(join(ARTICLES, 'zz-test-published.json'));
    t('单篇文件标题正确', single.title === '测试：已发布文章', single.title);
    t('单篇文件保留正文', /a\^2\+b\^2/.test(single.body || ''), (single.body || '').slice(0, 80));
    t('单篇文件不含 localOnly', single.localOnly === undefined);
    t('单篇文件不含 repoSnapshot', single.repoSnapshot === undefined);
    t('单篇文件不含 source', single.source === undefined);

    /* ---------------------------------------------------- 清单与嵌入数据 */

    console.log('\n== 5. 清单与嵌入式数据已同步 ==');
    const after = await readJSON(join(ARTICLES, 'index.json'));
    const ids = after.articles.map((a) => a.id);
    t('清单含新文章', ids.indexOf('zz-test-published') !== -1, ids.join(', '));
    t('清单不含草稿', ids.indexOf('zz-test-draft') === -1);
    t('原有文章仍在清单里', beforeIds.every((id) => ids.indexOf(id) !== -1), ids.join(', '));
    t('清单条目保持轻量（不内联正文）', after.articles.every((a) => a.body === undefined),
      '有条目内联了正文，会让 index.json 变臃肿');
    t('清单条目带 file 指针', after.articles.every((a) => typeof a.file === 'string'));

    const dataJs = await readFile(DATA_JS, 'utf8');
    t('articles-data.js 含新文章', /zz-test-published/.test(dataJs));
    t('articles-data.js 不含草稿', !/zz-test-draft/.test(dataJs));
    t('articles-data.js 内联正文', /a\^2\+b\^2/.test(dataJs));

    const rebuild = await build({ log: () => {} });
    t('生成器可独立调用', rebuild.published === after.articles.length,
      'published=' + rebuild.published + ' 清单=' + after.articles.length);

    /* ---------------------------------------------------- 单篇 JSON */

    console.log('\n== 6. 单篇 JSON（非发布包）也能落地 ==');
    const single2Path = join(scratch, 'zz-test-single.json');
    await writeFile(single2Path, JSON.stringify({
      id: 'zz-test-single',
      slug: 'zz-test-single',
      title: '测试：单篇导入',
      format: 'markdown',
      status: 'published',
      createdAt: '2026-02-02T00:00:00.000Z',
      updatedAt: '2026-02-02T00:00:00.000Z',
      body: '单篇 JSON 的正文。\n'
    }, null, 2), 'utf8');
    const log2 = makeLog();
    const res2 = await publish({ packPath: single2Path, log: log2.fn });
    t('单篇 JSON 落地成功', res2.written.length === 1 && (await exists(join(ARTICLES, 'zz-test-single.json'))),
      log2.text().slice(-300));

    /* ---------------------------------------------------- 草稿强制包含 */

    console.log('\n== 7. --include-drafts 才会带上草稿 ==');
    const log3 = makeLog();
    const res3 = await publish({ packPath, includeDrafts: true, log: log3.fn });
    t('写入 2 篇', res3.written.length === 2, JSON.stringify(res3.written));
    t('草稿此时已落盘', await exists(join(ARTICLES, 'zz-test-draft.json')));
    t('include-drafts 后不再提示"跳过 N 篇草稿"', !/跳过\s*\d+\s*篇草稿/.test(log3.text()), log3.text().slice(-300));

    /* ---------------------------------------------------- 删除标记 */

    console.log('\n== 8. 删除标记（不分线上线下） ==');

    // 8.1 只删不增：包里没有 articles，只有 deletions
    const delPackPath = join(scratch, 'delete-only.json');
    await writeFile(delPackPath, JSON.stringify({
      format: 'wuji-blog-publish',
      version: 1,
      counts: { articles: 0, published: 0, drafts: 0, deletions: 1, images: 0 },
      articles: [],
      deletions: ['zz-test-single'],
      images: []
    }, null, 2), 'utf8');
    const delLog = makeLog();
    const delRes = await publish({ packPath: delPackPath, log: delLog.fn });
    t('只删不增的发布包不报错', delRes.written.length === 0, delLog.text().slice(-300));
    t('返回被删的 id', delRes.removed.indexOf('zz-test-single') !== -1, JSON.stringify(delRes.removed));
    t('单篇文件已删除', !(await exists(join(ARTICLES, 'zz-test-single.json'))));
    const afterDel = await readJSON(join(ARTICLES, 'index.json'));
    const afterDelIds = afterDel.articles.map((a) => a.id);
    t('清单已剔除被删文章', afterDelIds.indexOf('zz-test-single') === -1, afterDelIds.join(', '));
    t('清单里其他文章不受影响', afterDelIds.indexOf('zz-test-published') !== -1, afterDelIds.join(', '));
    t('嵌入式数据同步移除', !/zz-test-single/.test(await readFile(DATA_JS, 'utf8')));
    t('报告删除文件数', /删除单篇: 1 个文件/.test(delLog.text()), delLog.text().slice(-400));

    // 8.2 命令行 --delete 等价路径（不需要发布包）
    const cliRes = await publish({ deleteIds: ['zz-test-draft'], log: () => {} });
    t('--delete 无需发布包', cliRes.removed.indexOf('zz-test-draft') !== -1, JSON.stringify(cliRes.removed));
    t('草稿文件已删除', !(await exists(join(ARTICLES, 'zz-test-draft.json'))));

    // 8.3 同一 id 同时出现在 articles 与 deletions：发布优先
    const conflictPath = join(scratch, 'conflict.json');
    await writeFile(conflictPath, JSON.stringify({
      format: 'wuji-blog-publish',
      version: 1,
      articles: [{
        id: 'zz-test-published', slug: 'zz-test-published', title: '测试：已发布文章',
        format: 'markdown', status: 'published',
        createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-03T00:00:00.000Z',
        body: '仍然要发布的正文\n'
      }],
      deletions: ['zz-test-published'],
      images: []
    }, null, 2), 'utf8');
    const conflictRes = await publish({ packPath: conflictPath, log: () => {} });
    t('发布优先于删除', conflictRes.written.length === 1 && conflictRes.removed.length === 0,
      JSON.stringify({ written: conflictRes.written, removed: conflictRes.removed }));
    t('冲突时文件仍在', await exists(join(ARTICLES, 'zz-test-published.json')));

    // 8.4 删除清单里没有的 id：静默跳过，不报错
    const ghostRes = await publish({ deleteIds: ['zz-not-exist-999'], log: () => {} });
    t('删除不存在的 id 静默跳过', ghostRes.removed.length === 0, JSON.stringify(ghostRes.removed));

    // 8.5 dry-run 不真的删
    const dryDelLog = makeLog();
    const dryDel = await publish({ deleteIds: ['zz-test-published'], dryRun: true, log: dryDelLog.fn });
    t('dry-run 报告待删除',
      dryDel.removed.length === 1 && /删除 articles\/zz-test-published\.json/.test(dryDelLog.text()),
      dryDelLog.text().slice(-400));
    t('dry-run 未真的删除', await exists(join(ARTICLES, 'zz-test-published.json')));

    /* ---------------------------------------------------- 错误处理 */

    console.log('\n== 9. 错误处理 ==');
    await expectError('缺少参数时报错', {}, /请提供发布包路径/);
    await expectError('文件不存在时报错', { packPath: join(scratch, 'nope.json') }, /无法读取发布包/);

    const emptyPath = join(scratch, 'empty.json');
    await writeFile(emptyPath, JSON.stringify({ format: 'wuji-blog-publish', articles: [] }), 'utf8');
    await expectError('空发布包报错', { packPath: emptyPath }, /没有文章/);

    const onlyDraft = join(scratch, 'draft.json');
    await writeFile(onlyDraft, JSON.stringify({ articles: [{ id: 'zz-only-draft', title: 'D', status: 'draft', body: 'x' }] }), 'utf8');
    await expectError('只有草稿时提示 --include-drafts', { packPath: onlyDraft }, /include-drafts/);

    const badJson = join(scratch, 'bad.json');
    await writeFile(badJson, '{ not json', 'utf8');
    await expectError('非法 JSON 报错', { packPath: badJson }, /无法读取发布包/);
  } finally {
    /* ---------------------------------------------------- 还原 */

    console.log('\n== 10. 还原并复验 ==');
    await restore();
    const backIndex = await readJSON(join(ARTICLES, 'index.json'));
    const backIds = backIndex.articles.map((a) => a.id);
    t('articles/ 已还原', backIds.every((id) => id.indexOf('zz-test') === -1), backIds.join(', '));
    t('还原条数一致', backIds.length === (await readJSON(join(ARTICLES, 'index.json'))).articles.length);
    const backData = await readFile(DATA_JS, 'utf8');
    t('articles-data.js 已还原', !/zz-test/.test(backData));
    t('测试产生的文件已清理',
      !(await exists(join(ARTICLES, 'zz-test-published.json'))) &&
      !(await exists(join(ARTICLES, 'zz-test-single.json'))) &&
      !(await exists(join(ARTICLES, 'zz-test-draft.json'))));
    await rm(scratch, { recursive: true, force: true });
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('测试本身出错：' + (e.stack || e.message)); process.exit(1); });
