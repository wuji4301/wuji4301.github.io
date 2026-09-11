// 数据层（assets/js/store.js）在 Node 里的真实跑测：自带极简 IndexedDB 垫片，
// 所以「删除 → 刷新页面 → 仍然看不到」这条链路是真的执行出来的，而不是靠读代码推断。
// 仓库侧数据用文件内固定样本注入，不读 articles/：文章是内容，增删不应让数据层测试变红。
// 用法: node tools/test-store.mjs
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

/* ============================================================ IndexedDB 垫片 */

/**
 * 只实现 store.js 用到的那一小撮：open / createObjectStore / transaction /
 * get / put / delete / getAll / clear，外加 onsuccess / oncomplete 的触发时序。
 */
function makeIndexedDB() {
  const dbs = new Map();

  function makeDB(rec) {
    return {
      objectStoreNames: { contains: (n) => rec.stores.has(n) },
      createObjectStore(name) {
        rec.stores.set(name, new Map());
        return { createIndex() { /* store.js 建的索引这里用不到 */ } };
      },
      transaction(storeName) {
        const data = rec.stores.get(storeName);
        const t = { oncomplete: null, onerror: null, onabort: null, error: null };
        const queue = [];
        const req = (fn) => { const r = { onsuccess: null, onerror: null, result: undefined }; queue.push(() => { fn(r); if (r.onsuccess) r.onsuccess(); }); return r; };
        const keyOf = (v) => (v && v.id !== undefined ? v.id : v && v.key);

        t.objectStore = () => ({
          get: (key) => req((r) => { r.result = data ? data.get(key) : undefined; }),
          put: (value) => req((r) => { if (data) data.set(keyOf(value), value); r.result = keyOf(value); }),
          delete: (key) => req((r) => { if (data) data.delete(key); }),
          getAll: () => req((r) => { r.result = data ? Array.from(data.values()) : []; }),
          clear: () => req((r) => { if (data) data.clear(); })
        });

        // 事务里的请求都是同步登记的，统一在这一拍跑完再触发 oncomplete
        setTimeout(() => {
          while (queue.length) queue.shift()();
          if (t.oncomplete) t.oncomplete();
        }, 0);
        return t;
      }
    };
  }

  return {
    open(name, version) {
      const r = { onsuccess: null, onerror: null, onupgradeneeded: null, result: null, error: null };
      setTimeout(() => {
        let rec = dbs.get(name);
        const fresh = !rec;
        if (!rec) { rec = { version: version || 1, stores: new Map() }; dbs.set(name, rec); }
        r.result = makeDB(rec);
        if (fresh) { if (version) rec.version = version; if (r.onupgradeneeded) r.onupgradeneeded({ target: r }); }
        if (r.onsuccess) r.onsuccess({ target: r });
      }, 0);
      return r;
    }
  };
}

/* ============================================================ 仓库侧固定样本 */

// 等价于 file:// 下读到的仓库数据（store.js 走 window.WJ_ARTICLES 这条路），
// 但内容是写死的：仓库里有没有文章、有几篇，都不影响这份测试的结论。
const FIXTURE = [
  {
    id: 'fx-one', slug: 'fx-one', title: '样本一', status: 'published',
    createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-02T00:00:00.000Z', body: '# 样本一\n\n正文。'
  },
  {
    id: 'fx-two', slug: 'fx-two', title: '样本二', status: 'published',
    createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', body: '# 样本二\n\n正文。'
  }
];
const repoIds = FIXTURE.map((a) => String(a.id));

/* ============================================================ 载入真实脚本 */

const storeSrc = await readFile(resolve(ROOT, 'assets/js/store.js'), 'utf8');

globalThis.window = globalThis;
globalThis.indexedDB = makeIndexedDB();
Object.defineProperty(globalThis, 'location', { value: { protocol: 'file:' }, configurable: true });
globalThis.WJ_ARTICLES = FIXTURE;
globalThis.WJ_ARTICLES_BY_ID = FIXTURE.reduce((m, a) => { m[a.id] = a; return m; }, {});

/** 重新执行 store.js —— 等价于用户刷新了一次页面（模块级缓存全部重置，IndexedDB 保留） */
function bootPage() {
  vm.runInThisContext(storeSrc, { filename: 'store.js' });
  return globalThis.WJStore;
}

/* ============================================================ 开始断言 */

console.log('\n== 0. 前置 ==');
t('仓库侧样本已注入（2 篇）', repoIds.length === 2, JSON.stringify(repoIds));
const target = repoIds[0];
const other = repoIds[repoIds.length - 1];

let Store = bootPage();

console.log('\n== 1. 初始状态 ==');
let all = await Store.listAll();
t('合并列表含仓库文章', all.articles.map((a) => a.id).indexOf(target) !== -1);
t('初始没有删除标记', all.deleted.length === 0, JSON.stringify(all.deleted));

console.log('\n== 2. 删除仓库文章 ==');
await Store.deleteArticle(target);
all = await Store.listAll();
t('删除后列表立刻不含它', all.articles.map((a) => a.id).indexOf(target) === -1, all.articles.map((a) => a.id).join(', '));
t('删除标记已写入', (await Store.listDeleted()).indexOf(target) !== -1, JSON.stringify(await Store.listDeleted()));
t('getArticle 返回 null', (await Store.getArticle(target)) === null);
t('其他文章不受影响', all.articles.map((a) => a.id).indexOf(other) !== -1);

console.log('\n== 3. 刷新页面后仍然看不到（持久化） ==');
Store = bootPage();
all = await Store.listAll();
t('刷新后列表仍不含它', all.articles.map((a) => a.id).indexOf(target) === -1, all.articles.map((a) => a.id).join(', '));
t('刷新后删除标记还在', all.deleted.indexOf(target) !== -1, JSON.stringify(all.deleted));
t('刷新后 getArticle 仍为 null', (await Store.getArticle(target)) === null);

console.log('\n== 4. 删除「仓库里没有」的本地文章 ==');
const localRec = Store.normalize({
  id: 'zz-local-only', title: '仅本地的文章', status: 'published',
  createdAt: Store.nowISO(), updatedAt: Store.nowISO(), body: 'x'
});
await Store.saveArticle(localRec);
await Store.deleteArticle('zz-local-only');
all = await Store.listAll();
t('本地文章删除后消失', all.articles.map((a) => a.id).indexOf('zz-local-only') === -1);
t('仓库里没有的 id 不会留标记（自愈）', (await Store.listDeleted()).indexOf('zz-local-only') === -1,
  JSON.stringify(await Store.listDeleted()));

console.log('\n== 5. 保存即撤销删除 ==');
const revived = Store.normalize(Object.assign({}, await Store.getArticle(other) || {}, {
  id: target, title: '重新发布的文章', slug: 'revived', source: 'repo',
  status: 'published', body: '回来了'
}));
await Store.saveArticle(revived);
t('保存同 id 会清掉删除标记', (await Store.listDeleted()).indexOf(target) === -1,
  JSON.stringify(await Store.listDeleted()));
all = await Store.listAll();
t('文章重新出现在列表里', all.articles.map((a) => a.id).indexOf(target) !== -1);

console.log('\n== 6. 撤销删除 ==');
await Store.markDeleted(target);
t('打标后看不到', (await Store.listAll()).articles.map((a) => a.id).indexOf(target) === -1);
await Store.unmarkDeleted(target);
all = await Store.listAll();
t('撤销后又能看到', all.articles.map((a) => a.id).indexOf(target) !== -1);
t('标记已清空', all.deleted.length === 0, JSON.stringify(all.deleted));

console.log('\n== 7. 发布包里的 deletions 与实际标记一致 ==');
await Store.markDeleted(target);
const packed = await Store.listDeleted();
t('listDeleted 可直接放进发布包', packed.indexOf(target) !== -1, JSON.stringify(packed));
t('落地的 id 在清单里找得到（会被 publish.mjs 移除）', repoIds.indexOf(packed[0]) !== -1);

console.log('\n== 8. 清空本地数据 ==');
await Store.wipe();
all = await Store.listAll();
t('清空后删除标记没了', all.deleted.length === 0, JSON.stringify(all.deleted));
t('仓库文章重新可见', all.articles.map((a) => a.id).indexOf(target) !== -1);

console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
