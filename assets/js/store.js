/* ==========================================================================
   无极博客 · 数据层
   --------------------------------------------------------------------------
   设计要点：
   · 双来源（source）：'repo' = 仓库 articles/*.json 里、所有访客都能看到的文章；
                       'local' = 仅存在本浏览器 IndexedDB 里的本地文章。
   · 本地优先：本地同名/同 id 的记录覆盖仓库记录（覆盖时保留 repo 快照以便还原）。
   · 图片：二进制存 IndexedDB（images 表），正文里只用 img://<id> 引用；
           渲染时解析为 blob: URL，导出发布时再落盘为真实文件。
   · 无任何构建步骤、无第三方依赖，直接以 <script> 引入浏览器。
   ========================================================================== */
(function (global) {
    'use strict';

    var DB_NAME = 'wuji-blog';
    var DB_VERSION = 1;
    var STORE_ARTICLES = 'articles';
    var STORE_IMAGES = 'images';
    var STORE_META = 'meta';

    var META_SEEDED = 'seededAt';
    var META_PUBLISHED = 'publishedAt';
    var META_DELETED = 'deletedIDs';

    var _db = null;

    /* ---------------------------------------------------------------- 工具 */

    /**
     * 资源基路径。
     * 公开页面位于站点根目录；本地管理系统位于 admin/ 子目录，链接公开页面时
     * 需要 "../" 前缀。这里通过"本脚本自己的 src"反推，无需各页面手工传参。
     */
    var _basePrefix = null;
    function basePrefix() {
        if (typeof global.WJ_ASSET_BASE === 'string') return global.WJ_ASSET_BASE;
        if (_basePrefix !== null) return _basePrefix;
        _basePrefix = '';
        try {
            var list = document.querySelectorAll('script[src*="assets/js/store.js"]');
            var el = list[list.length - 1];
            var src = el ? el.getAttribute('src') : '';
            var m = src && src.match(/^(.*?)assets\/js\/store\.js/);
            if (m) _basePrefix = m[1];
            global.WJ_ASSET_BASE = _basePrefix;
        } catch (e) { void e; }
        return _basePrefix;
    }

    /** 把站点根目录相对路径转成当前页面可用的 URL */
    function assetURL(path) { return basePrefix() + String(path || '').replace(/^\.?\//, ''); }

    function nowISO() { return new Date().toISOString(); }

    /** 生成本地唯一 id：时间戳(36 进制) + 随机串，可读且几乎不会碰撞 */
    function genId(prefix) {
        var t = Date.now().toString(36);
        var r = '';
        var chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        for (var i = 0; i < 6; i++) r += chars[Math.floor(Math.random() * chars.length)];
        return (prefix || 'a') + '-' + t + '-' + r;
    }

    /** 中文排版友好字数统计：CJK 逐字计，拉丁按词计 */
    function countWords(text) {
        if (!text) return 0;
        var s = String(text).replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
        var cjk = (s.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
        var words = (s.replace(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, ' ')
            .match(/[A-Za-z0-9_$@#][A-Za-z0-9_$@#.\-]*/g) || []).length;
        return cjk + words;
    }

    /** 粗略估计阅读时长（分钟），中文按 350 字/分 */
    function readingMinutes(text) {
        var n = countWords(text);
        return Math.max(1, Math.round(n / 350));
    }

    /** 从正文提取纯文本（供摘要/搜索），去掉常见标记 */
    function plainText(body) {
        if (!body) return '';
        return String(body)
            .replace(/```[\s\S]*?```/g, ' ')
            .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
            .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/<[^>]+>/g, ' ')
            .replace(/[#>*_~`$\\]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /** 生成 URL 友好的 slug；中文保留（便于阅读），仅去除不安全字符 */
    function slugify(title, fallback) {
        var s = String(title || '')
            .trim()
            .toLowerCase()
            .replace(/[\s\u3000]+/g, '-')
            .replace(/[^\w\u3400-\u9fff\u3040-\u30ff-]+/g, '')
            .replace(/-{2,}/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60);
        return s || fallback || genId('post');
    }

    function fmtDate(iso, withTime) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        var p = function (n) { return n < 10 ? '0' + n : String(n); };
        var s = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
        if (withTime) s += ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
        return s;
    }

    function fmtRelative(iso) {
        if (!iso) return '';
        var d = new Date(iso).getTime();
        if (isNaN(d)) return '';
        var diff = Date.now() - d;
        if (diff < 0) diff = 0;
        var min = Math.floor(diff / 60000);
        if (min < 1) return '刚刚';
        if (min < 60) return min + ' 分钟前';
        var hr = Math.floor(min / 60);
        if (hr < 24) return hr + ' 小时前';
        var day = Math.floor(hr / 24);
        if (day < 30) return day + ' 天前';
        return fmtDate(iso);
    }

    /** 规范化一篇文章：补齐字段、统一类型，避免散落的 undefined 判断 */
    function normalize(raw) {
        var a = raw || {};
        var title = String(a.title || '').trim() || '未命名文章';
        var created = a.createdAt || nowISO();
        var id = a.id || genId('a');
        return {
            id: id,
            source: a.source === 'repo' ? 'repo' : 'local',
            title: title,
            slug: a.slug || slugify(title, id),
            summary: String(a.summary || ''),
            tags: Array.isArray(a.tags) ? a.tags.filter(Boolean).map(String) : [],
            cover: String(a.cover || ''),
            body: String(a.body == null ? '' : a.body),
            format: a.format === 'html' ? 'html' : 'markdown',
            status: a.status === 'published' ? 'published' : 'draft',
            pinned: !!a.pinned,
            createdAt: created,
            updatedAt: a.updatedAt || created,
            repoSnapshot: a.repoSnapshot || null,
            localOnly: a.localOnly != null ? !!a.localOnly : (a.source !== 'repo')
        };
    }

    /* ------------------------------------------------------------ IndexedDB */

    function openDB() {
        if (_db) return Promise.resolve(_db);
        return new Promise(function (resolve, reject) {
            if (!global.indexedDB) return reject(new Error('当前浏览器不支持 IndexedDB'));
            var req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function (e) {
                var db = req.result;
                if (!db.objectStoreNames.contains(STORE_ARTICLES)) {
                    var as = db.createObjectStore(STORE_ARTICLES, { keyPath: 'id' });
                    as.createIndex('updatedAt', 'updatedAt');
                    as.createIndex('source', 'source');
                    as.createIndex('status', 'status');
                }
                if (!db.objectStoreNames.contains(STORE_IMAGES)) {
                    db.createObjectStore(STORE_IMAGES, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(STORE_META)) {
                    db.createObjectStore(STORE_META, { keyPath: 'key' });
                }
                void e;
            };
            req.onsuccess = function () {
                _db = req.result;
                _db.onversionchange = function () { try { _db.close(); } catch (err) { void err; } _db = null; };
                resolve(_db);
            };
            req.onerror = function () { reject(req.error || new Error('IndexedDB 打开失败')); };
        });
    }

    function tx(store, mode, fn) {
        return openDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var t = db.transaction(store, mode);
                var s = t.objectStore(store);
                var out;
                try { out = fn(s); } catch (err) { try { t.abort(); } catch (e2) { void e2; } reject(err); return; }
                t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
                t.onerror = function () { reject(t.error || new Error('IndexedDB 事务失败')); };
                t.onabort = function () { reject(t.error || new Error('IndexedDB 事务被中止')); };
            });
        });
    }

    function reqPromise(request) {
        return new Promise(function (resolve, reject) {
            request.onsuccess = function () { resolve(request.result); };
            request.onerror = function () { reject(request.error); };
        });
    }

    function all(store) { return tx(store, 'readonly', function (s) { return reqPromise(s.getAll()); }); }
    function getOne(store, key) { return tx(store, 'readonly', function (s) { return reqPromise(s.get(key)); }); }
    function putOne(store, value) { return tx(store, 'readwrite', function (s) { return reqPromise(s.put(value)); }).then(function () { return value; }); }
    function delOne(store, key) { return tx(store, 'readwrite', function (s) { return reqPromise(s.delete(key)); }); }
    function clearStore(store) { return tx(store, 'readwrite', function (s) { return reqPromise(s.clear()); }); }

    /* -------------------------------------------------------- 图片 Blob 层 */

    var _urlCache = {};   // imageId -> blob: URL（同一会话内复用，避免泄漏）

    function addImage(file, opts) {
        opts = opts || {};
        var id = opts.id || genId('img');
        var rec = {
            id: id,
            name: opts.name || (file && file.name) || (id + '.png'),
            type: (file && file.type) || opts.type || 'image/png',
            size: (file && file.size) || 0,
            width: opts.width || 0,
            height: opts.height || 0,
            createdAt: nowISO(),
            blob: file || opts.blob
        };
        return putOne(STORE_IMAGES, rec).then(function () { return rec; });
    }

    function getImage(id) { return getOne(STORE_IMAGES, id); }

    function listImages() { return all(STORE_IMAGES); }

    function deleteImage(id) {
        if (_urlCache[id]) { try { URL.revokeObjectURL(_urlCache[id]); } catch (e) { void e; } delete _urlCache[id]; }
        return delOne(STORE_IMAGES, id);
    }

    /** 把 img://<id> 解析为可直接放进 src 的 blob: URL */
    function imageURL(id) {
        if (!id) return Promise.resolve('');
        if (_urlCache[id]) return Promise.resolve(_urlCache[id]);
        return getImage(id).then(function (rec) {
            if (!rec || !rec.blob) return '';
            var u = URL.createObjectURL(rec.blob);
            _urlCache[id] = u;
            return u;
        });
    }

    /** 立即返回缓存中的 URL（同步），没有则空串 —— 供首帧渲染用 */
    function imageURLCached(id) { return _urlCache[id] || ''; }

    /* ------------------------------------------------------ 仓库文章加载 */

    var ARTICLES_DIR = 'articles/';
    var _repoCache = null;

    /**
     * 嵌入式数据（articles-data.js 提供的 window.WJ_ARTICLES）。
     * 用 <script> 而不是 fetch 载入，因此 **file:// 直接打开也能读到文章**，
     * 不需要启动本地服务器。用 node tools/build-articles.mjs 生成/更新。
     */
    function embeddedList() {
        var raw = global.WJ_ARTICLES;
        if (!raw) return null;
        var list = Array.isArray(raw) ? raw : (Array.isArray(raw.articles) ? raw.articles : null);
        return list && list.length ? list : null;
    }

    function embeddedById() {
        var e = global.WJ_ARTICLES_BY_ID;
        return (e && typeof e === 'object') ? e : null;
    }

    /** file:// 协议：fetch 会被浏览器拦截，直接走嵌入数据，省掉一次必然失败的请求 */
    function isFileProtocol() {
        return global.location && global.location.protocol === 'file:';
    }

    function fetchJSON(url) {
        return fetch(url, { cache: 'no-cache' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
            return r.json();
        });
    }

    /** 读取 articles/index.json —— 仓库文章清单（优先 fetch，失败回退到嵌入数据） */
    function loadRepoIndex() {
        if (_repoCache) return Promise.resolve(_repoCache);
        var embedded = embeddedList();
        if (isFileProtocol() && embedded) { _repoCache = embedded; return Promise.resolve(_repoCache); }
        return fetchJSON(assetURL(ARTICLES_DIR + 'index.json'))
            .then(function (j) {
                var list = Array.isArray(j) ? j : (j && Array.isArray(j.articles) ? j.articles : []);
                _repoCache = list;
                return _repoCache;
            })
            .catch(function () {
                _repoCache = embedded || [];
                return _repoCache;
            });
    }

    /**
     * 拉取仓库文章正文。清单里的条目可能只带元信息 + file 字段，
     * 此时按需加载对应 json；也支持清单内直接内联正文。
     * file:// 或 fetch 失败时回退到嵌入数据。
     */
    function loadRepoArticle(entry) {
        if (entry && entry.body != null) return Promise.resolve(normalize(Object.assign({}, entry, { source: 'repo' })));
        var embedded = embeddedById();
        if (embedded && entry && embedded[entry.id]) {
            return Promise.resolve(normalize(Object.assign({}, entry, embedded[entry.id], { source: 'repo' })));
        }
        if (isFileProtocol()) return Promise.resolve(null);
        // 清单里的 file 通常相对 articles/ 目录：先补全目录，再套用资源前缀（与 blog.js 的 entryFileURL 保持一致）
        var file = (entry && (entry.file || entry.path)) || (entry && entry.id ? entry.id + '.json' : '');
        if (!file) return Promise.resolve(null);
        if (file.indexOf('/') === -1) file = ARTICLES_DIR + file;
        return fetchJSON(assetURL(file)).then(function (full) {
            return normalize(Object.assign({}, entry, full, { source: 'repo' }));
        });
    }

    /** 加载全部仓库文章（清单 + 正文），失败项静默跳过 */
    function loadRepoArticles() {
        return loadRepoIndex().then(function (list) {
            return Promise.all(list.map(function (e) {
                return loadRepoArticle(e).catch(function () { return null; });
            }));
        }).then(function (arr) { return arr.filter(Boolean); });
    }

    function clearRepoCache() { _repoCache = null; }

    /* -------------------------------------------------------- 文章读写 API */

    function listLocalArticles() { return all(STORE_ARTICLES); }
    function getLocalArticle(id) { return getOne(STORE_ARTICLES, id).then(function (r) { return r ? normalize(r) : null; }); }

    function saveArticle(raw) {
        var a = normalize(raw);
        a.updatedAt = nowISO();
        if (!raw || !raw.createdAt) a.createdAt = a.createdAt || a.updatedAt;
        a.localOnly = a.source !== 'repo' || !!a.repoSnapshot;
        // 仓库文章被本地改过 → 保留 repo 快照，供「还原」使用
        var write = (a.source === 'repo' && !a.repoSnapshot)
            ? getLocalArticle(a.id).then(function (prev) {
                a.repoSnapshot = (prev && prev.repoSnapshot) || a.repoSnapshot || {};
                return putOne(STORE_ARTICLES, a);
            })
            : putOne(STORE_ARTICLES, a);
        // 保存即「撤销删除」：同一 id 的删除标记一并清掉
        return write.then(function (saved) {
            return unmarkDeleted(a.id).then(function () { return saved; });
        });
    }

    /**
     * 删除文章（不区分线上 / 本地）。
     * 本地记录直接移除，同时把 id 记成「删除标记」：如果仓库里也存在同名文章，
     * 下一次「打包发布 → 本地落地」会把它从 articles/ 一并移除，不必手工改文件。
     */
    function deleteArticle(id) {
        return delOne(STORE_ARTICLES, id).then(function () { return markDeleted(id); });
    }

    /* ---------------------------------------------------------- 删除标记 */

    /**
     * 删除标记（tombstone）只记 id，不区分文章来源：
     * 记下之后文章立刻从后台列表消失，真正的仓库删除交给 tools/publish.mjs。
     * 仓库里已经不存在的 id 会在 listAll 里自动清理，标记不会无限堆积。
     */
    function listDeleted() {
        return getMeta(META_DELETED).then(function (v) {
            return Array.isArray(v) ? v.map(String) : [];
        });
    }

    function markDeleted(id) {
        if (!id) return Promise.resolve([]);
        return listDeleted().then(function (list) {
            if (list.indexOf(id) === -1) list.push(id);
            return setMeta(META_DELETED, list).then(function () { return list; });
        });
    }

    /** 撤销删除标记：仓库文章重新出现（本地文章需要重新导入） */
    function unmarkDeleted(id) {
        return listDeleted().then(function (list) {
            var next = list.filter(function (x) { return x !== id; });
            if (next.length === list.length) return list;
            return setMeta(META_DELETED, next).then(function () { return next; });
        });
    }

    function clearDeleted() { return setMeta(META_DELETED, []).then(function () { return []; }); }

    /**
     * 合并列表：本地记录优先，仓库文章填充其余，删除标记最后剔除。
     * 返回 { articles, repoCount, localCount, overrides, deleted }
     * 顺带自愈：仓库里已不存在的删除标记会在这里被清掉。
     */
    function listAll() {
        return Promise.all([loadRepoArticles(), listLocalArticles(), listDeleted()]).then(function (res) {
            var repo = res[0], local = res[1].map(normalize), marked = res[2];
            var repoIds = {};
            repo.forEach(function (a) { repoIds[a.id] = true; });
            // 只有仓库里还存在的 id 才需要"删除标记"：落地并部署之后标记自动失效
            var deleted = marked.filter(function (id) { return repoIds[id]; });
            if (deleted.length !== marked.length) setMeta(META_DELETED, deleted).catch(function () { /* 自愈失败不影响本次结果 */ });
            var gone = {};
            deleted.forEach(function (id) { gone[id] = true; });

            var byId = {};
            var overrides = 0;
            repo.forEach(function (a) { if (!gone[a.id]) byId[a.id] = a; });
            local.forEach(function (a) {
                if (gone[a.id]) return;
                if (byId[a.id]) { overrides++; a.repoSnapshot = a.repoSnapshot || byId[a.id]; }
                byId[a.id] = a;
            });
            var articles = Object.keys(byId).map(function (k) { return byId[k]; });
            articles.sort(function (x, y) {
                if (!!y.pinned !== !!x.pinned) return (y.pinned ? 1 : 0) - (x.pinned ? 1 : 0);
                return String(y.updatedAt).localeCompare(String(x.updatedAt));
            });
            return {
                articles: articles,
                repoCount: repo.length,
                localCount: local.length,
                overrides: overrides,
                deleted: deleted
            };
        });
    }

    /** 取单篇（本地优先 → 仓库兜底；已打删除标记的 id 视为不存在） */
    function getArticle(id) {
        if (!id) return Promise.resolve(null);
        return listDeleted().then(function (deleted) {
            if (deleted.indexOf(id) !== -1) return null;
            return getLocalArticle(id).then(function (local) {
                if (local) return local;
                return loadRepoIndex().then(function (list) {
                    var entry = list.filter(function (e) { return e.id === id || e.slug === id; })[0];
                    if (!entry) return null;
                    return loadRepoArticle(entry).catch(function () { return null; });
                });
            });
        });
    }

    /* ------------------------------------------------------------ 元信息 */

    function getMeta(key) { return getOne(STORE_META, key).then(function (r) { return r ? r.value : null; }); }
    function setMeta(key, value) { return putOne(STORE_META, { key: key, value: value }); }

    /* -------------------------------------------------------- 导入 / 导出 */

    /** 导出单篇为纯数据对象（不含二进制），供下载 .json */
    function toExportObject(a) {
        return {
            id: a.id,
            title: a.title,
            slug: a.slug,
            summary: a.summary,
            tags: a.tags,
            cover: a.cover,
            body: a.body,
            format: a.format,
            status: a.status,
            pinned: a.pinned,
            createdAt: a.createdAt,
            updatedAt: a.updatedAt
        };
    }

    function download(filename, content, mime) {
        var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'application/json;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }

    /** 导出单篇 .json 文件 */
    function exportArticleFile(a) {
        var obj = toExportObject(a);
        download(slugify(obj.slug || obj.title, obj.id) + '.json', JSON.stringify(obj, null, 2));
        return obj;
    }

    /**
     * 导出仓库清单 index.json：把当前所有「本地或已发布」文章汇总成清单。
     * 每篇都内联完整正文（单文件即可用），同时给出 file 字段便于拆分。
     */
    function buildRepoIndex(articles, inlineBody) {
        var list = articles.map(function (a) {
            var base = {
                id: a.id,
                title: a.title,
                slug: a.slug,
                summary: a.summary,
                tags: a.tags,
                cover: a.cover,
                status: a.status,
                pinned: !!a.pinned,
                createdAt: a.createdAt,
                updatedAt: a.updatedAt,
                format: a.format,
                file: a.id + '.json'
            };
            if (inlineBody) base.body = a.body;
            return base;
        });
        return { version: 1, updatedAt: nowISO(), articles: list };
    }

    /** 导出所有图片为真实文件（逐个下载），返回 id → 文件名 映射 */
    function exportImages(prefix) {
        return listImages().then(function (imgs) {
            var map = {};
            imgs.forEach(function (rec) {
                var ext = (rec.name && rec.name.match(/\.([a-z0-9]+)$/i)) ? rec.name.match(/\.([a-z0-9]+)$/i)[1].toLowerCase() : 'png';
                var name = (prefix ? prefix + '/' : '') + rec.id + '.' + ext;
                map[rec.id] = name;
                download(rec.id + '.' + ext, rec.blob, rec.type);
            });
            return map;
        });
    }

    /** 导入 .json（单篇或清单），返回导入的文章数组 */
    function importJSON(data) {
        var items = [];
        if (Array.isArray(data)) items = data;
        else if (data && Array.isArray(data.articles)) items = data.articles;
        else if (data && (data.id || data.title)) items = [data];
        var out = [];
        return items.reduce(function (p, item) {
            return p.then(function () {
                var a = normalize(Object.assign({}, item, { source: 'local' }));
                a.id = item.id || a.id;
                a.localOnly = true;
                return saveArticle(a).then(function (saved) { out.push(saved); });
            });
        }, Promise.resolve()).then(function () { return out; });
    }

    /** 清空本地数据（文章 + 图片 + 元信息） */
    function wipe() {
        Object.keys(_urlCache).forEach(function (k) {
            try { URL.revokeObjectURL(_urlCache[k]); } catch (e) { void e; }
        });
        _urlCache = {};
        return Promise.all([clearStore(STORE_ARTICLES), clearStore(STORE_IMAGES), clearStore(STORE_META)]);
    }

    /** 统计数据（本地库概览） */
    function stats() {
        return Promise.all([listLocalArticles(), listImages()]).then(function (r) {
            var arts = r[0].map(normalize);
            var bytes = r[1].reduce(function (a, i) { return a + (i.size || 0); }, 0);
            return {
                articles: arts.length,
                published: arts.filter(function (a) { return a.status === 'published'; }).length,
                drafts: arts.filter(function (a) { return a.status !== 'published'; }).length,
                images: r[1].length,
                imageBytes: bytes,
                lastUpdated: arts.reduce(function (m, a) { return a.updatedAt > m ? a.updatedAt : m; }, ''),
                lastPublished: ''
            };
        });
    }

    /* -------------------------------------------------------------- 导出 */

    global.WJStore = {
        // 常量
        ARTICLES_DIR: ARTICLES_DIR,
        // 工具
        genId: genId, slugify: slugify, normalize: normalize,
        basePrefix: basePrefix, assetURL: assetURL,
        countWords: countWords, readingMinutes: readingMinutes, plainText: plainText,
        fmtDate: fmtDate, fmtRelative: fmtRelative, nowISO: nowISO,
        // 文章
        listAll: listAll, getArticle: getArticle, getLocalArticle: getLocalArticle,
        listLocalArticles: listLocalArticles, saveArticle: saveArticle, deleteArticle: deleteArticle,
        loadRepoArticles: loadRepoArticles, loadRepoIndex: loadRepoIndex,
        clearRepoCache: clearRepoCache,
        // 删除标记（tombstone）：删除不区分线上线下，仓库落地由发布包携带
        listDeleted: listDeleted, markDeleted: markDeleted,
        unmarkDeleted: unmarkDeleted, clearDeleted: clearDeleted,
        embeddedList: embeddedList, isFileProtocol: isFileProtocol,
        // 图片
        addImage: addImage, getImage: getImage, listImages: listImages,
        deleteImage: deleteImage, imageURL: imageURL, imageURLCached: imageURLCached,
        // 元信息
        getMeta: getMeta, setMeta: setMeta,
        // 导入导出
        download: download, exportArticleFile: exportArticleFile, exportImages: exportImages,
        buildRepoIndex: buildRepoIndex, toExportObject: toExportObject, importJSON: importJSON,
        // 维护
        wipe: wipe, stats: stats
    };
})(window);
