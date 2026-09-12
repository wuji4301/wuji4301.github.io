/* ==========================================================================
   无极博客 · 文章阅读层（public reading layer）
   --------------------------------------------------------------------------
   这一层只负责「读」：
     · 把 articles/index.json + articles/<file>（或 file:// 下的嵌入数据）
       读成统一的文章对象；
     · 提供日期、字数、摘要等展示工具；
     · 提供卡片 / 标签 / 元信息等渲染片段，供列表页、详情页、首页共用。

   设计原则：与后台管理系统（admin/ 本地编辑器、IndexedDB 本地库）完全解耦。
   这里不碰 IndexedDB，也没有任何导出 / 导入 / 清空之类的写操作 —— 公开站点
   只把仓库里的数据展示出来，写作归写作、展示归展示。
   ========================================================================== */
(function (global) {
    'use strict';

    var ARTICLES_DIR = 'articles/';

    /* ------------------------------------------------------ 资源前缀 / 请求 */

    var _basePrefix = null;

    /** 站点根前缀：从自身 <script> 的 src 推断，兼容部署在子路径的情况 */
    function basePrefix() {
        if (typeof global.WJ_ASSET_BASE === 'string') return global.WJ_ASSET_BASE;
        if (_basePrefix !== null) return _basePrefix;
        _basePrefix = '';
        try {
            var list = document.querySelectorAll('script[src*="assets/js/blog.js"]');
            var el = list[list.length - 1];
            var src = el ? (el.getAttribute('src') || '') : '';
            var m = src.match(/^(.*?)assets\/js\/blog\.js/);
            if (m) _basePrefix = m[1];
        } catch (e) { void e; }
        return _basePrefix;
    }

    /** 站点根相对路径 → 当前页面可用 URL */
    function assetURL(path) { return basePrefix() + String(path || '').replace(/^\.?\//, ''); }

    /** file:// 直接打开时 fetch 会被拦截，需要走嵌入数据 */
    function isFileProtocol() {
        return !!(global.location && global.location.protocol === 'file:');
    }

    function fetchJSON(url) {
        return fetch(url, { cache: 'no-cache' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
            return r.json();
        });
    }

    /* -------------------------------------------------------------- 工具 */

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
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

    /** 中文排版友好字数统计：CJK 逐字计，拉丁按词计（去掉代码块噪声） */
    function countWords(text) {
        if (!text) return 0;
        var s = String(text).replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
        var cjk = (s.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
        var words = (s.replace(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, ' ')
            .match(/[A-Za-z0-9_$@#][A-Za-z0-9_$@#.\-]*/g) || []).length;
        return cjk + words;
    }

    /** 粗略阅读时长（分钟），中文按 350 字/分 */
    function readingMinutes(text) {
        return Math.max(1, Math.round(countWords(text) / 350));
    }

    /** 从 Markdown/HTML 正文提取纯文本，供摘要与搜索 */
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

    /* ------------------------------------------------- 单篇文章的轻量索引 */

    // 正文转纯文本 / 字数统计最贵，而列表每次筛选、搜索每敲一下都会重算。
    // 把结果挂回文章对象缓存，同一篇对象只算一次（重新加载后对象重建，缓存自然失效）。
    function contentText(a) {
        if (a._plain === undefined) a._plain = plainText(a.body);
        return a._plain;
    }
    function wordCount(a) {
        if (a._words === undefined) a._words = countWords(a.body);
        return a._words;
    }
    function readMinutes(a) { return Math.max(1, Math.round(wordCount(a) / 350)); }

    function summaryOf(a, max) {
        if (a.summary) return a.summary;
        var t = contentText(a);
        var n = max || 150;
        return t.length > n ? t.slice(0, n) + '…' : t;
    }

    function haystack(a) {
        if (a._hay === undefined) {
            a._hay = (a.title + ' ' + (a.summary || '') + ' ' +
                (a.tags || []).join(' ') + ' ' + contentText(a)).toLowerCase();
        }
        return a._hay;
    }

    /* -------------------------------------------------------------- 规范化 */

    function normalize(raw) {
        var a = raw || {};
        var title = String(a.title || '').trim() || '未命名文章';
        var created = a.createdAt || a.updatedAt || new Date().toISOString();
        return {
            id: String(a.id || a.slug || title),
            title: title,
            slug: String(a.slug || ''),
            summary: String(a.summary || ''),
            tags: Array.isArray(a.tags) ? a.tags.filter(Boolean).map(String) : [],
            cover: String(a.cover || ''),
            body: String(a.body == null ? '' : a.body),
            format: a.format === 'html' ? 'html' : 'markdown',
            status: a.status === 'draft' ? 'draft' : 'published',
            pinned: !!a.pinned,
            createdAt: created,
            updatedAt: a.updatedAt || created
        };
    }

    function isPublished(a) { return a.status === 'published'; }

    /** 排序：置顶优先，其次最近更新，最后按创建时间兜底 */
    function sortPosts(list) {
        return list.sort(function (x, y) {
            if (!!y.pinned !== !!x.pinned) return (y.pinned ? 1 : 0) - (x.pinned ? 1 : 0);
            var u = String(y.updatedAt).localeCompare(String(x.updatedAt));
            if (u) return u;
            return String(y.createdAt).localeCompare(String(x.createdAt));
        });
    }

    /* ---------------------------------------------------------- 数据加载 */

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

    /** 解析清单条目的正文文件路径：清单里的 file 通常相对 articles/ 目录 */
    function entryFileURL(entry) {
        var f = (entry && (entry.file || entry.path)) || (entry && entry.id ? entry.id + '.json' : '');
        if (!f) return '';
        if (!/\//.test(f)) f = ARTICLES_DIR + f;
        return assetURL(f);
    }

    var _indexCache = null;

    /** 读取文章清单：优先 fetch articles/index.json，失败回退嵌入数据 */
    function loadIndex() {
        if (_indexCache) return Promise.resolve(_indexCache);
        var embedded = embeddedList();
        if (isFileProtocol() && embedded) {
            _indexCache = embedded;
            return Promise.resolve(_indexCache);
        }
        return fetchJSON(assetURL(ARTICLES_DIR + 'index.json'))
            .then(function (j) {
                var list = Array.isArray(j) ? j : (j && Array.isArray(j.articles) ? j.articles : []);
                _indexCache = list;
                return _indexCache;
            })
            .catch(function () {
                _indexCache = embedded || [];
                return _indexCache;
            });
    }

    /** 读取单篇正文：清单内联 / 嵌入数据 / 按 file 拉取，逐级回退 */
    function loadEntry(entry) {
        if (entry && entry.body != null) return Promise.resolve(normalize(entry));
        var embedded = embeddedById();
        if (embedded && entry && embedded[entry.id]) {
            return Promise.resolve(normalize(Object.assign({}, entry, embedded[entry.id])));
        }
        if (isFileProtocol()) return Promise.resolve(null);
        var url = entryFileURL(entry);
        if (!url) return Promise.resolve(null);
        return fetchJSON(url).then(function (full) {
            return normalize(Object.assign({}, entry, full));
        });
    }

    var _listCache = null;

    /**
     * 全部已发布文章（含正文），置顶 + 最近更新排序。
     * 结果缓存在内存里；force 为真时重新拉取。
     */
    function list(options) {
        var force = !!(options && options.force);
        if (_listCache && !force) return _listCache;
        _listCache = loadIndex()
            .then(function (entries) {
                var published = entries.filter(function (e) { return !e || e.status !== 'draft'; });
                return Promise.all(published.map(function (e) {
                    return loadEntry(e).catch(function () { return null; });
                }));
            })
            .then(function (arr) {
                return sortPosts(arr.filter(Boolean).map(normalize));
            });
        return _listCache;
    }

    /** 在清单里按 id / slug / 文件名找条目（这一步不展开正文） */
    function findEntry(entries, k) {
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            if (!e) continue;
            if (String(e.id || '') === k) return e;
            if (e.slug && String(e.slug) === k) return e;
            if (e.file && String(e.file).replace(/\.json$/i, '') === k) return e;
        }
        return null;
    }

    /**
     * 按 id 或 slug 取单篇已发布文章，取不到返回 null。
     * 只读清单 + 目标那一篇正文：早先这里走的是 list()，等于打开一篇文章
     * 就要把全站文章的 JSON 全拉一遍再挑一篇，白等好几轮请求。
     */
    function get(key) {
        if (!key) return Promise.resolve(null);
        var k = String(key);
        return loadIndex().then(function (entries) {
            var entry = findEntry(entries, k);
            if (!entry || entry.status === 'draft') return null;
            return loadEntry(entry)
                .then(function (a) { return a || null; })
                .catch(function () { return null; });
        });
    }

    /** 清空内存缓存（发布新文章后调用可强制刷新） */
    function clearCache() { _indexCache = null; _listCache = null; }

    /* ---------------------------------------------------------- 链接生成 */

    function articleURL(a) {
        var key = (a && (a.id || a.slug)) || '';
        return assetURL('article.html') + '?id=' + encodeURIComponent(key);
    }

    function tagURL(tag) {
        return assetURL('articles.html') + '?tag=' + encodeURIComponent(tag);
    }

    /* ---------------------------------------------------------- 渲染片段 */

    /** 标签小圆片（纯文字，不带链接），最多 n 个 */
    function tagChipsHTML(tags, n) {
        return (tags || []).slice(0, n || 4).map(function (t) {
            return '<span class="tag">' + esc(t) + '</span>';
        }).join('');
    }

    /** 文章卡片，列表页与首页共用；opts: { animate, quick, delay, eager } */
    function cardHTML(a, opts) {
        opts = opts || {};
        var tags = tagChipsHTML(a.tags, 4);
        var cover = a.cover
            ? '<img class="post-cover" src="' + esc(a.cover) + '" alt="" ' +
              (opts.eager ? '' : 'loading="lazy" ') + 'decoding="async" onerror="this.remove()">'
            : '';
        var cls = 'post-card' + (opts.animate ? ' card-in' : '') +
            (opts.animate && opts.quick ? ' card-in-quick' : '');
        var style = (opts.animate && opts.delay)
            ? ' style="animation-delay:' + opts.delay + 'ms"' : '';
        return '<a class="' + cls + '" href="' + articleURL(a) + '"' + style + '>' +
            (a.pinned ? '<span class="post-pin">置顶</span>' : '') +
            cover +
            '<div class="post-title">' + esc(a.title) + '</div>' +
            '<div class="post-summary">' + esc(summaryOf(a)) + '</div>' +
            (tags ? '<div class="post-tags">' + tags + '</div>' : '') +
            '<div class="post-meta">' +
            '<span>' + esc(fmtDate(a.updatedAt)) + '</span>' +
            '<span class="dot">·</span><span>' + wordCount(a) + ' 字</span>' +
            '<span class="dot">·</span><span>约 ' + readMinutes(a) + ' 分钟</span>' +
            '</div></a>';
    }

    global.WJBlog = {
        // 数据
        list: list,
        get: get,
        clearCache: clearCache,
        // 工具
        esc: esc,
        fmtDate: fmtDate,
        fmtRelative: fmtRelative,
        countWords: countWords,
        readingMinutes: readingMinutes,
        plainText: plainText,
        contentText: contentText,
        wordCount: wordCount,
        readMinutes: readMinutes,
        summaryOf: summaryOf,
        haystack: haystack,
        // 链接与渲染
        assetURL: assetURL,
        articleURL: articleURL,
        tagURL: tagURL,
        cardHTML: cardHTML,
        tagChipsHTML: tagChipsHTML
    };
})(window);
