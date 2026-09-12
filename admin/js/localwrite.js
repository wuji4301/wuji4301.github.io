/* ==========================================================================
   无极博客 · 后台：一键写入本地项目文件夹（admin/js/localwrite.js）
   —— 用 File System Access API 把文章写进你自己 clone 的仓库目录，
      提交仍然由你来做（git add / commit / push）

   为什么不需要后端：
     后台本身以 file:// 打开、不引入服务端；写文件这条链路上也就没有凭据可泄露。
     浏览器能做的是「写磁盘」，所以第一次点一次「选择项目文件夹」授权项目根目录，
     之后每次只要点一下，articles/<id>.json、articles/index.json、articles-data.js
     与图片就都落盘；要不要 push、什么时候 push，由你决定。

   一次点击做什么：
     1) 读 <项目根>/articles/index.json（磁盘上现有的清单），与本地文章合并；
     2) 写 articles/<id>.json、articles/index.json、articles-data.js；
     3) 待删除的 id 从清单剔除、单篇文件一并删除；
     4) 正文与封面里的 img://<id> 换成 articles/img/…，图片写进 articles/img/。

   产物与 node tools/publish.mjs 逐字节一致：生成文本的纯函数与本地脚本同源
   （tools/test-localwrite.mjs 会直接导入 publish.mjs 比对两处输出）。

   目录句柄存在 IndexedDB（wuji-blog-folder），只在本机、只属于这个浏览器。
   ========================================================================== */
(function (global) {
    'use strict';

    var STORAGE_KEY = 'wj-localwrite-config';
    var ARTICLES_DIR = 'articles';
    var IMG_DIR = ARTICLES_DIR + '/img';
    var INDEX_FILE = 'index.json';
    var DATA_FILE = 'articles-data.js';

    /* 目录句柄的落脚点：单独开一个小库，避免动到站点数据的 schema */
    var FOLDER_DB = 'wuji-blog-folder';
    var FOLDER_STORE = 'handles';
    var ROOT_KEY = 'root';

    var DEFAULTS = { siteUrl: '' };

    var UNSUPPORTED = '当前浏览器不支持直接写入文件夹（File System Access API，需要 Chrome / Edge）。' +
        '可以改用「打包发布 + node tools/publish.mjs」这条路径。';

    /* 必须与 tools/build-articles.mjs 的 header 逐字一致：test-localwrite.mjs 会直接
       比对两处，避免浏览器与本地脚本生成出两份不一样的 articles-data.js。 */
    var DATA_HEADER = [
        '/* 由 tools/build-articles.mjs 或后台「一键发布」自动生成，请勿手工编辑。',
        ' * 数据来源：articles/index.json + articles/<id>.json',
        ' * 用途：让 index.html / articles.html / article.html',
        ' *       以及 admin/ 下的本地管理系统在 file:// 协议下（不启动服务器）也能读取文章。',
        ' * 变更文章后请重新运行：node tools/build-articles.mjs（或在后台「发布」里点一键发布）',
        ' */'
    ].join('\n');

    /* ================================================================ 配置层 */

    function normalizeConfig(raw) {
        var c = raw || {};
        return { siteUrl: String(c.siteUrl == null ? '' : c.siteUrl).trim().replace(/\/+$/, '') };
    }

    function readConfig() {
        var raw = null;
        try { raw = global.localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
        var saved = {};
        if (raw) {
            try { saved = JSON.parse(raw) || {}; } catch (e) { saved = {}; }
        }
        return normalizeConfig(saved);
    }

    function writeConfig(patch) {
        var next = readConfig();
        if (patch && patch.siteUrl != null) next.siteUrl = String(patch.siteUrl).trim().replace(/\/+$/, '');
        try { global.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (e) { void e; }
        return next;
    }

    function clearConfig() {
        try { global.localStorage.removeItem(STORAGE_KEY); } catch (e) { void e; }
    }

    /** 站点地址只用来在写完后给一个能点开的链接；没填就返回空串 */
    function siteURL(cfg) {
        return normalizeConfig(cfg || readConfig()).siteUrl;
    }

    /* ============================================================== 纯函数层 */

    /** 只保留可公开的字段，且字段顺序稳定（与 tools/publish.mjs 的 cleanArticle 同源） */
    function cleanArticle(a) {
        var out = {};
        var order = ['id', 'slug', 'title', 'summary', 'tags', 'cover', 'format',
            'status', 'pinned', 'createdAt', 'updatedAt', 'body'];
        for (var i = 0; i < order.length; i++) {
            var k = order[i];
            if (a[k] === undefined) continue;
            out[k] = k === 'tags'
                ? (Array.isArray(a[k]) ? a[k].map(String) : [])
                : (k === 'pinned' ? !!a[k] : a[k]);
        }
        for (var key in a) {
            if (!Object.prototype.hasOwnProperty.call(a, key)) continue;
            if (order.indexOf(key) === -1 && a[key] !== undefined) out[key] = a[key];
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

    /** 图片扩展名：优先文件名，其次 MIME（与 publish.mjs 的 extOf 一致） */
    function extOf(im) {
        var m = /\.([a-z0-9]+)$/i.exec((im && im.name) || '');
        if (m) return m[1].toLowerCase();
        var t = String((im && im.type) || '');
        if (/png/.test(t)) return 'png';
        if (/jpe?g/.test(t)) return 'jpg';
        if (/gif/.test(t)) return 'gif';
        if (/webp/.test(t)) return 'webp';
        if (/svg/.test(t)) return 'svg';
        return 'png';
    }

    /**
     * 收集正文与封面里引用到的本地图片 id（去重，保持出现顺序）。
     * 封面必须是同一个 img:// 协议：它和正文一样要落成本地文件，
     * 只扫正文的话封面引用的图既不会被写进 articles/img/，也换不掉引用。
     */
    function collectImageIds(list) {
        var seen = {};
        var out = [];
        function scan(text) {
            var re = /img:\/\/([A-Za-z0-9_-]+)/g;
            var s = String(text == null ? '' : text);
            var m;
            while ((m = re.exec(s))) {
                if (seen[m[1]]) continue;
                seen[m[1]] = 1;
                out.push(m[1]);
            }
        }
        (list || []).forEach(function (a) {
            if (!a) return;
            scan(a.body);
            scan(a.cover);
        });
        return out;
    }

    /** 把一段文本里的 img://<id> 换成本地相对路径；映射里没有的 id 原样保留（宁可留着提示） */
    function applyImages(body, urlById) {
        return String(body == null ? '' : body).replace(/img:\/\/([A-Za-z0-9_-]+)/g, function (all, id) {
            return (urlById && urlById[id]) || all;
        });
    }

    /**
     * 换掉一篇文章里所有本地图片引用：正文与封面都要换。
     * 公开站点没有 IndexedDB，读到 img:// 只会是一个裂图 —— 封面尤其显眼，
     * 因为它是卡片第一眼看到的东西。
     */
    function applyImagesToArticle(a, urlById) {
        var out = cleanArticle(a);
        out.body = applyImages(out.body, urlById);
        if (out.cover) out.cover = applyImages(out.cover, urlById);
        return out;
    }

    /** 清单条目没有正文，但同样带 cover，也要一起换 */
    function resolveEntryImages(entries, urlById) {
        return (entries || []).map(function (e) {
            if (!e || !e.cover) return e;
            var out = Object.assign({}, e);
            out.cover = applyImages(out.cover, urlById);
            return out;
        });
    }

    function articleJSON(a) { return JSON.stringify(a, null, 2) + '\n'; }

    /** 清单条目：元信息 + file 指针，正文留在单篇文件里（与 publish.mjs 一致） */
    function indexJSON(entries, updatedAt) {
        return JSON.stringify({
            version: 1,
            updatedAt: updatedAt || new Date().toISOString(),
            articles: (entries || []).map(function (a) {
                var meta = Object.assign({}, a);
                delete meta.body;
                return Object.assign(meta, { file: a.id + '.json' });
            })
        }, null, 2) + '\n';
    }

    /**
     * 算出这次要写什么（纯函数，便于单测）。
     * @param {{articles:Array, deletions:Array, existing:Array, includeDrafts:boolean}} input
     * @returns {{publishable:Array, drafts:number, removed:Array, indexEntries:Array, needBodies:Array}}
     */
    function buildPlan(input) {
        var src = (input && input.articles) || [];
        var incoming = src.map(cleanArticle);
        var drafts = incoming.filter(function (a) { return a.status !== 'published'; });
        var publishable = input && input.includeDrafts
            ? incoming
            : incoming.filter(function (a) { return a.status === 'published'; });

        var order = [];
        var byId = {};
        ((input && input.existing) || []).forEach(function (e) {
            if (!e || !e.id || byId[e.id]) return;
            byId[e.id] = e;
            order.push(e.id);
        });
        publishable.forEach(function (a) {
            if (!byId[a.id]) order.push(a.id);
            byId[a.id] = a;
        });

        // 删除：从清单剔除。同一 id 又被发布时以发布为准（不会误删刚发布的文章）
        var publishingIds = {};
        publishable.forEach(function (a) { publishingIds[a.id] = 1; });
        var removed = [];
        ((input && input.deletions) || []).forEach(function (id) {
            var key = String(id == null ? '' : id).trim();
            if (!key || publishingIds[key] || !byId[key]) return;
            removed.push({ id: key, file: byId[key].file || (key + '.json') });
            delete byId[key];
        });

        var indexEntries = order
            .filter(function (id) { return !!byId[id]; })
            .map(function (id) { return byId[id]; })
            .sort(function (x, y) {
                return String(y.updatedAt || '').localeCompare(String(x.updatedAt || ''));
            });

        // 清单里已有、但本次没重发的已发布文章要从磁盘补正文，才能重建 articles-data.js
        var needBodies = indexEntries.filter(function (e) {
            return e.status !== 'draft' && e.body == null && !publishingIds[e.id];
        }).map(function (e) { return e.id; });

        return {
            publishable: publishable,
            drafts: drafts.length,
            removed: removed,
            indexEntries: indexEntries,
            needBodies: needBodies
        };
    }

    /** 单篇 + 清单的文本内容（纯函数：正文与封面都换成本地路径） */
    function fileTexts(plan, urlById, updatedAt) {
        var map = urlById || {};
        var files = plan.publishable.map(function (a) {
            var out = applyImagesToArticle(a, map);
            return { path: ARTICLES_DIR + '/' + out.id + '.json', text: articleJSON(out) };
        });
        files.push({
            path: ARTICLES_DIR + '/' + INDEX_FILE,
            text: indexJSON(resolveEntryImages(plan.indexEntries, map), updatedAt)
        });
        return files;
    }

    /** 生成 articles-data.js（与 tools/build-articles.mjs 的输出逐字一致） */
    function embeddedSource(list) {
        var published = (list || []).filter(function (a) {
            return a && a.body != null && a.status !== 'draft';
        }).map(function (a) {
            var item = Object.assign({}, a);
            delete item.repoSnapshot;
            return item;
        });
        return DATA_HEADER + '\n' +
            'window.WJ_ARTICLES = ' + JSON.stringify(published, null, 2) + ';\n' +
            'window.WJ_ARTICLES_BY_ID = {};\n' +
            'window.WJ_ARTICLES.forEach(function (a) { window.WJ_ARTICLES_BY_ID[a.id] = a; });\n';
    }

    /** 提交信息：一眼能看出这次改了什么（写完后直接当 git commit -m 用） */
    function commitMessage(plan) {
        var parts = [];
        if (plan.publishable.length) parts.push('更新文章 ' + plan.publishable.length + ' 篇');
        if (plan.removed.length) parts.push('删除 ' + plan.removed.length + ' 篇');
        var titles = plan.publishable.slice(0, 3).map(function (a) { return '《' + a.title + '》'; }).join('、');
        return (parts.join('，') || '更新文章') +
            (titles ? '：' + titles + (plan.publishable.length > 3 ? ' 等' : '') : '');
    }

    /** 写完之后你只需要跑这一条命令；引号等会破坏命令行的字符先剔掉 */
    function gitCommand(plan) {
        var msg = commitMessage(plan).replace(/["`$\\]/g, '').slice(0, 72);
        return 'git add ' + ARTICLES_DIR + ' ' + DATA_FILE + ' && git commit -m "' + msg + '" && git push';
    }

    /* ======================================================== 目录句柄存储 */

    var dbPromise = null;

    function openFolderDB() {
        if (dbPromise) return dbPromise;
        if (!global.indexedDB) {
            return Promise.reject(new Error('当前浏览器不支持 IndexedDB，无法记住项目文件夹。'));
        }
        dbPromise = new Promise(function (resolve, reject) {
            var req = global.indexedDB.open(FOLDER_DB, 1);
            req.onupgradeneeded = function () {
                var db = req.result;
                if (!db.objectStoreNames.contains(FOLDER_STORE)) db.createObjectStore(FOLDER_STORE);
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error || new Error('打开本地数据库失败')); };
        });
        return dbPromise;
    }

    function idb(mode, run) {
        return openFolderDB().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(FOLDER_STORE, mode);
                var req = run(tx.objectStore(FOLDER_STORE));
                tx.oncomplete = function () { resolve(req ? req.result : undefined); };
                tx.onerror = function () { reject(tx.error || new Error('本地数据库读写失败')); };
                tx.onabort = function () { reject(tx.error || new Error('本地数据库读写被中断')); };
            });
        });
    }

    function savedDirectory() {
        return idb('readonly', function (s) { return s.get(ROOT_KEY); })
            .catch(function () { return null; })
            .then(function (h) { return h || null; });
    }

    function storeDirectory(handle) {
        return idb('readwrite', function (s) { return s.put(handle, ROOT_KEY); });
    }

    function forgetDirectory() {
        return idb('readwrite', function (s) { return s.delete(ROOT_KEY); });
    }

    /* ============================================================== 文件夹层 */

    function isSupported() {
        return typeof global.showDirectoryPicker === 'function';
    }

    /**
     * 权限是按次生效的：浏览器重启后句柄还在，但授权可能回到 prompt，
     * 这时必须在一次真实点击里重新申请，所以 interactive 只在点击链路里为 true。
     */
    function ensurePermission(handle, interactive) {
        if (!handle) return Promise.reject(new Error('还没有选中项目文件夹。'));
        if (typeof handle.queryPermission !== 'function') return Promise.resolve(handle);
        var opts = { mode: 'readwrite' };
        return Promise.resolve(handle.queryPermission(opts)).then(function (state) {
            if (state === 'granted') return handle;
            if (!interactive) {
                throw new Error('还没拿到这个文件夹的写入权限：回「发布」视图点一次「一键写入项目文件夹」重新授权。');
            }
            return Promise.resolve(handle.requestPermission(opts)).then(function (next) {
                if (next === 'granted') return handle;
                throw new Error('没有获得文件夹的写入权限，操作已取消。');
            });
        });
    }

    /** 认一下选的是不是项目根目录：认不出就直说该选哪一层 */
    function checkRoot(dir) {
        var probe = function (fn) {
            return Promise.resolve().then(fn).then(function () { return true; }, function () { return false; });
        };
        return probe(function () { return dir.getFileHandle('index.html'); }).then(function (hasIndex) {
            if (hasIndex) return true;
            return probe(function () { return dir.getDirectoryHandle(ARTICLES_DIR); }).then(function (hasArticles) {
                if (hasArticles) return true;
                throw new Error('这个文件夹看起来不是项目根目录：里面找不到 index.html 或 articles/。' +
                    '请选中包含 admin/、articles/、index.html 的那一层（也就是 git 仓库根目录）。');
            });
        });
    }

    /** 弹一次目录选择器并记住它；之后就不必再选 */
    function pickDirectory() {
        if (!isSupported()) return Promise.reject(new Error(UNSUPPORTED));
        return global.showDirectoryPicker({ id: 'wuji-blog-root', mode: 'readwrite', startIn: 'documents' })
            .then(function (handle) {
                return ensurePermission(handle, true).then(function () {
                    return checkRoot(handle).then(function () { return storeDirectory(handle); });
                });
            });
    }

    /** 界面用：不触发授权，只报告「有没有、叫什么、还能不能写」 */
    function folderState() {
        if (!isSupported()) {
            return Promise.resolve({ supported: false, saved: false, name: '', granted: false, permission: 'unsupported' });
        }
        return savedDirectory().then(function (handle) {
            if (!handle) return { supported: true, saved: false, name: '', granted: false, permission: 'none' };
            var q = typeof handle.queryPermission === 'function'
                ? Promise.resolve(handle.queryPermission({ mode: 'readwrite' })).catch(function () { return 'prompt'; })
                : Promise.resolve('granted');
            return q.then(function (state) {
                return {
                    supported: true,
                    saved: true,
                    name: handle.name || '（已授权文件夹）',
                    granted: state === 'granted',
                    permission: state
                };
            });
        });
    }

    /* ---------------------------------------------------------- 虚拟路径读写 */

    function splitPath(path) {
        var parts = String(path).split('/').filter(function (s) { return s !== ''; });
        var name = parts.pop();
        return { dirs: parts, name: name };
    }

    function dirAt(root, parts, create) {
        return (parts || []).reduce(function (p, name) {
            return p.then(function (d) { return d.getDirectoryHandle(name, { create: !!create }); });
        }, Promise.resolve(root));
    }

    function withFile(root, path, create, run) {
        var s = splitPath(path);
        return dirAt(root, s.dirs, create)
            .then(function (d) { return d.getFileHandle(s.name, { create: !!create }); })
            .then(run);
    }

    function writeAt(root, path, chunk) {
        return withFile(root, path, true, function (fh) {
            return fh.createWritable().then(function (w) {
                return Promise.resolve(w.write(chunk)).then(function () { return w.close(); });
            });
        });
    }

    function writeTextAt(root, path, text) { return writeAt(root, path, String(text)); }
    function writeBlobAt(root, path, blob) { return writeAt(root, path, blob); }

    /** 读文本；文件或目录不存在都当作「没有」（首次写入时 articles/ 可能还不存在） */
    function readTextAt(root, path) {
        return withFile(root, path, false, function (fh) {
            return fh.getFile().then(function (f) { return f.text(); });
        }).catch(function () { return null; });
    }

    function removeAt(root, path) {
        var s = splitPath(path);
        return dirAt(root, s.dirs, false)
            .then(function (d) { return d.removeEntry(s.name); })
            .catch(function () { return null; });
    }

    /* ------------------------------------------------------------ 图片读取 */

    /** 逐个读本地图片（顺序执行，避免同时打开太多 IndexedDB 事务） */
    function loadImages(getImage, ids) {
        var records = [];
        var missing = [];
        return (ids || []).reduce(function (p, id) {
            return p.then(function () {
                return Promise.resolve(getImage(id)).then(function (rec) {
                    if (rec && rec.blob) records.push(rec);
                    else missing.push(id);
                }, function () { missing.push(id); });
            });
        }, Promise.resolve()).then(function () {
            return { records: records, missing: missing };
        });
    }

    function defaultGetImage(id) {
        return global.WJStore.getImage(id);
    }

    /* ------------------------------------------------------------ 一键写入 */

    /**
     * 把本地文章写进已授权的项目文件夹（产物与 publish.mjs 一致）。
     * @param {{articles:Array, deletions:Array, includeDrafts:boolean, dir:FileSystemDirectoryHandle,
     *          interactive:boolean, getImage:Function, onProgress:Function, message:string,
     *          updatedAt:string}} opts
     */
    function writeToFolder(opts) {
        opts = opts || {};
        var onProgress = opts.onProgress || function () {};
        var getImage = opts.getImage || defaultGetImage;
        var bags = {};

        return Promise.resolve(opts.dir || savedDirectory()).then(function (dir) {
            if (!dir) {
                throw new Error('还没有选择项目文件夹：到「设置 → 写入本地文件夹」或「发布」视图点一次「选择项目文件夹」。');
            }
            bags.dir = dir;
            return ensurePermission(dir, !!opts.interactive);
        }).then(function (dir) {
            onProgress('读取本机 ' + ARTICLES_DIR + '/' + INDEX_FILE + ' …');
            return readTextAt(dir, ARTICLES_DIR + '/' + INDEX_FILE).then(function (text) {
                var existing = [];
                if (text) {
                    var parsed = null;
                    try { parsed = JSON.parse(text); } catch (e) {
                        throw new Error('本机 articles/index.json 不是合法 JSON，先手工修好再写入：' + e.message);
                    }
                    existing = Array.isArray(parsed) ? parsed : ((parsed && parsed.articles) || []);
                }
                var plan = buildPlan({
                    articles: opts.articles || [],
                    deletions: opts.deletions || [],
                    existing: existing,
                    includeDrafts: !!opts.includeDrafts
                });
                if (!plan.publishable.length && !plan.removed.length) {
                    throw new Error('没有可写入的改动：本地没有「已发布」的文章，也没有待同步的删除标记。');
                }
                bags.plan = plan;
                return dir;
            });
        }).then(function (dir) {
            var ids = collectImageIds(bags.plan.publishable);
            if (!ids.length) {
                bags.urlById = {}; bags.imageFiles = []; bags.missingImages = [];
                return dir;
            }
            onProgress('读取本地图片（' + ids.length + ' 张）…');
            return loadImages(getImage, ids).then(function (res) {
                bags.urlById = {};
                bags.imageFiles = [];
                res.records.forEach(function (rec) {
                    var path = IMG_DIR + '/' + rec.id + '.' + extOf(rec);
                    bags.urlById[rec.id] = path;
                    bags.imageFiles.push({ path: path, blob: rec.blob });
                });
                bags.missingImages = res.missing;
                return dir;
            });
        }).then(function (dir) {
            var need = bags.plan.needBodies;
            bags.fetched = [];
            if (!need.length) return dir;
            onProgress('读取本机其它文章正文（' + need.length + ' 篇）…');
            return need.reduce(function (p, id) {
                return p.then(function () {
                    return readTextAt(dir, ARTICLES_DIR + '/' + id + '.json').then(function (text) {
                        if (!text) return;
                        try { bags.fetched.push(JSON.parse(text)); } catch (e) { void e; }
                    });
                });
            }, Promise.resolve()).then(function () { return dir; });
        }).then(function (dir) {
            var plan = bags.plan;
            var fullById = {};
            plan.publishable.forEach(function (a) {
                // 正文与封面都必须与写进 articles/<id>.json 的完全一致（img:// 已换成相对路径），
                // 否则 file:// 下读嵌入式数据的人会看到裂图，而磁盘上的文章却是好的
                fullById[a.id] = applyImagesToArticle(a, bags.urlById);
            });
            bags.fetched.forEach(function (a) { if (a && a.id) fullById[a.id] = a; });

            // 嵌入数据要带上全部已发布文章的正文：本次写的用本地，其余用刚从磁盘读到的
            var inline = plan.indexEntries
                .map(function (e) { return fullById[e.id] || e; })
                .filter(function (a) { return a.body != null; });

            bags.files = fileTexts(plan, bags.urlById, opts.updatedAt);
            bags.files.push({ path: DATA_FILE, text: embeddedSource(inline) });
            bags.message = opts.message || commitMessage(plan);
            return dir;
        }).then(function (dir) {
            var total = bags.files.length + bags.imageFiles.length;
            var done = 0;
            onProgress('写入 ' + bags.files.length + ' 个文本文件…');
            return bags.files.reduce(function (p, f) {
                return p.then(function () {
                    return writeTextAt(dir, f.path, f.text).then(function () {
                        done += 1;
                        onProgress('已写入 ' + done + '/' + total + '：' + f.path);
                    });
                });
            }, Promise.resolve()).then(function () { return dir; });
        }).then(function (dir) {
            if (!bags.imageFiles.length) return dir;
            onProgress('写入图片…');
            return bags.imageFiles.reduce(function (p, img) {
                return p.then(function () {
                    return writeBlobAt(dir, img.path, img.blob).then(function () {
                        onProgress('已写入图片：' + img.path);
                    });
                });
            }, Promise.resolve()).then(function () { return dir; });
        }).then(function (dir) {
            if (!bags.plan.removed.length) return dir;
            onProgress('删除 ' + bags.plan.removed.length + ' 个单篇文件…');
            return bags.plan.removed.reduce(function (p, r) {
                return p.then(function () { return removeAt(dir, ARTICLES_DIR + '/' + r.file); });
            }, Promise.resolve()).then(function () { return dir; });
        }).then(function () {
            return {
                folder: bags.dir.name || '',
                written: bags.files.map(function (f) { return f.path; }),
                removed: bags.plan.removed.map(function (r) { return r.id; }),
                published: bags.plan.publishable.length,
                skippedDrafts: bags.plan.drafts,
                indexCount: bags.plan.indexEntries.length,
                images: bags.imageFiles.length,
                missingImages: bags.missingImages,
                message: bags.message,
                command: gitCommand(bags.plan),
                siteUrl: siteURL()
            };
        });
    }

    /* ================================================================ 导出 */

    global.WJLocalWrite = {
        STORAGE_KEY: STORAGE_KEY,
        DEFAULTS: DEFAULTS,
        ARTICLES_DIR: ARTICLES_DIR,
        IMG_DIR: IMG_DIR,
        INDEX_FILE: INDEX_FILE,
        DATA_FILE: DATA_FILE,
        DATA_HEADER: DATA_HEADER,
        FOLDER_DB: FOLDER_DB,
        UNSUPPORTED: UNSUPPORTED,

        // 配置
        readConfig: readConfig,
        writeConfig: writeConfig,
        clearConfig: clearConfig,
        siteURL: siteURL,

        // 纯函数（单测直接打这些）
        cleanArticle: cleanArticle,
        extOf: extOf,
        collectImageIds: collectImageIds,
        applyImages: applyImages,
        applyImagesToArticle: applyImagesToArticle,
        resolveEntryImages: resolveEntryImages,
        articleJSON: articleJSON,
        indexJSON: indexJSON,
        buildPlan: buildPlan,
        fileTexts: fileTexts,
        embeddedSource: embeddedSource,
        commitMessage: commitMessage,
        gitCommand: gitCommand,

        // 文件夹
        isSupported: isSupported,
        pickDirectory: pickDirectory,
        savedDirectory: savedDirectory,
        folderState: folderState,
        ensurePermission: ensurePermission,
        checkRoot: checkRoot,
        forgetDirectory: forgetDirectory,

        // 主流程
        writeToFolder: writeToFolder
    };
})(window);
