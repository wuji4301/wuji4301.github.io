/* ==========================================================================
   无极博客 · 后台外壳（admin/js/shell.js）
   --------------------------------------------------------------------------
   职责：
   · 统一承载「数据加载 / 视图注册 / 路由切换 / 顶栏与侧边栏交互」；
   · 对外暴露 window.WJAdmin，各视图模块（dashboard / articles / …）通过
     WJAdmin.register(name, view) 挂载自己，互不依赖，便于单独维护；
   · 视图约定：{ title, sub, mount(root, ctx) }，ctx 提供 { signal, state,
     refresh, go, openEditor }，其中 signal 用于在切换视图时释放事件监听。
   设计约束：无构建步骤、无第三方依赖，file:// 直接打开即可运行。
   ========================================================================== */
(function (global) {
    'use strict';

    var Store = global.WJStore;
    var UI = global.WJUI;

    var DEFAULT_VIEW = 'overview';

    /* ------------------------------------------------------------ 视图注册 */

    var views = {};
    var current = '';
    var abort = null;
    var rootEl = null;
    var crumbTitleEl = null;
    var crumbSubEl = null;
    var booted = false;

    /** 全局共享状态：一次读取，各视图复用，避免重复打 IndexedDB */
    var state = {
        loaded: false,
        error: '',
        articles: [],
        local: [],
        repoCount: 0,
        localCount: 0,
        overrides: 0,
        deleted: [],
        images: [],
        imageBytes: 0
    };

    function register(name, view) {
        if (!name || !view || typeof view.mount !== 'function') return;
        views[name] = view;
        if (booted && current === name) mountView();
    }

    /* -------------------------------------------------------------- 工具 */

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function badge(a) {
        if (a.status === 'published') return '<span class="badge badge-repo">已发布</span>';
        if (a.status === 'draft') return '<span class="badge badge-draft">草稿</span>';
        return '<span class="badge badge-draft">' + esc(a.status) + '</span>';
    }

    function sourceBadge(a) {
        if (a.source === 'local') return '<span class="badge badge-local">本地</span>';
        if (a.localOnly) return '<span class="badge badge-repo" title="线上文章被本地改动覆盖">线上 · 已覆盖</span>';
        return '<span class="badge badge-repo" title="提交在仓库里的文章">线上</span>';
    }

    // 正文转换与字数统计是列表渲染里最贵的一步，结果按文章对象缓存，
    // 同一篇只算一次（每次重新加载数据后对象会重建，缓存自然失效）。
    function plain(a) {
        if (a._plain === undefined) a._plain = Store.plainText(a.body);
        return a._plain;
    }
    function wordsOf(a) {
        if (a._words === undefined) a._words = Store.countWords(a.body);
        return a._words;
    }
    function haystack(a) {
        if (a._hay === undefined) {
            a._hay = (a.title + ' ' + (a.summary || '') + ' ' +
                (a.tags || []).join(' ') + ' ' + plain(a)).toLowerCase();
        }
        return a._hay;
    }

    function findByID(id) {
        return state.articles.filter(function (a) { return a.id === id; })[0] || null;
    }

    /** 文章在公开站点上的地址（未发布的本地文章没有公开链接） */
    function publicURL(a) {
        if (a.source === 'local') return '';
        try {
            return new URL(Store.assetURL('article.html') + '?id=' + encodeURIComponent(a.id), location.href).href;
        } catch (err) {
            return '';
        }
    }

    /** 导出单篇为 PDF：正文交给打印层，在打印对话框里选「另存为 PDF」 */
    function exportPDF(a) {
        if (!global.WJExportPDF) {
            UI.toast('PDF 组件未加载，请刷新页面重试', 'err', 3200);
            return;
        }
        global.WJExportPDF.print({
            site: '无极',
            title: a.title,
            summary: a.summary,
            cover: a.cover,
            tags: a.tags,
            meta: [Store.fmtDate(a.updatedAt, true), wordsOf(a) + ' 字'],
            bodyHTML: a.format === 'html' ? a.body : global.WJMarkdown.render(a.body || ''),
            url: publicURL(a),
            assetURL: Store.assetURL,
            imageResolver: Store.imageURL,
            docTitle: a.title
        }).then(function (ok) {
            if (!ok) UI.toast('当前浏览器不支持打印，请用 Ctrl/⌘ + P 手动导出', 'err', 3200);
        });
    }

    function copyText(text, okMsg) {
        return UI.copy(text).then(function (ok) {
            UI.toast(ok ? (okMsg || '已复制') : '复制失败，请手动选择', ok ? 'ok' : 'err');
            return ok;
        });
    }

    function openEditor(id) {
        location.href = 'editor.html' + (id ? '?id=' + encodeURIComponent(id) : '');
    }

    /* ---------------------------------------------------------- 数据加载 */

    function loadData() {
        return Promise.all([Store.listAll(), Store.listImages()]).then(function (res) {
            var listRes = res[0];
            var imgs = res[1];
            state.articles = listRes.articles;
            state.repoCount = listRes.repoCount;
            state.localCount = listRes.localCount;
            state.overrides = listRes.overrides;
            state.local = listRes.articles.filter(function (a) { return a.source === 'local'; });
            state.deleted = listRes.deleted || [];
            state.images = imgs;
            state.imageBytes = imgs.reduce(function (n, i) { return n + (i.size || 0); }, 0);
            state.loaded = true;
            state.error = '';
            return state;
        }).catch(function (err) {
            state.loaded = true;
            state.error = err && err.message ? err.message : String(err);
            throw err;
        });
    }

    /** 重新从 IndexedDB / 仓库读取数据，并重绘当前视图 */
    function refresh(opts) {
        opts = opts || {};
        Store.clearRepoCache();
        return loadData().then(function () {
            mountView();
            if (opts.toast) UI.toast(opts.toast, 'ok');
        });
    }

    /* ---------------------------------------------------------- 路由渲染 */

    function routeName() {
        var h = String(location.hash || '').replace(/^#\/?/, '').split('?')[0];
        return views[h] ? h : DEFAULT_VIEW;
    }

    function setActiveNav(name) {
        var links = document.querySelectorAll('.admin-nav-link[data-view]');
        Array.prototype.forEach.call(links, function (l) {
            var on = l.getAttribute('data-view') === name;
            l.classList.toggle('active', on);
            if (on) l.setAttribute('aria-current', 'page');
            else l.removeAttribute('aria-current');
        });
    }

    function setCrumb(view) {
        if (crumbTitleEl) crumbTitleEl.textContent = view.title || '后台';
        if (crumbSubEl) crumbSubEl.textContent = view.sub || '';
    }

    function mountView() {
        if (!rootEl) return;
        if (abort) { try { abort.abort(); } catch (e) { void e; } abort = null; }
        var view = views[current] || views[DEFAULT_VIEW];
        if (!view) {
            rootEl.innerHTML = '<div class="notice">视图模块尚未加载。</div>';
            return;
        }
        rootEl.innerHTML = '';
        setActiveNav(current);
        setCrumb(view);
        document.title = (view.title || '后台') + ' · 管理系统 · 无极博客';

        var controller = global.AbortController ? new global.AbortController() : null;
        abort = controller;
        var ctx = {
            signal: controller ? controller.signal : undefined,
            state: state,
            refresh: refresh,
            go: go,
            openEditor: openEditor
        };
        try {
            view.mount(rootEl, ctx);
        } catch (err) {
            rootEl.innerHTML = '<div class="notice">视图渲染失败：' + esc(err.message) + '</div>';
        }
    }

    function onRoute() {
        var name = routeName();
        if (name === current) { mountView(); return; }
        current = name;
        mountView();
        closeDrawer();
    }

    function go(name) {
        if (location.hash === '#/' + name) { onRoute(); return; }
        location.hash = '#/' + name;
    }

    /* ------------------------------------------------------ 侧边栏 / 顶栏 */

    function closeDrawer() {
        document.body.classList.remove('admin-drawer-open');
    }

    function initChrome() {
        var menuBtn = document.getElementById('adminMenuBtn');
        var scrim = document.getElementById('adminScrim');
        if (menuBtn) {
            menuBtn.addEventListener('click', function () {
                document.body.classList.toggle('admin-drawer-open');
                var open = document.body.classList.contains('admin-drawer-open');
                menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
            });
        }
        if (scrim) scrim.addEventListener('click', closeDrawer);

        var refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function () {
                refresh({ toast: '已刷新' });
            });
        }

        var sideToggle = document.getElementById('sideThemeToggle');
        if (sideToggle) {
            sideToggle.addEventListener('click', function () { sideToggle.blur(); });
        }

        global.addEventListener('hashchange', onRoute);
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closeDrawer();
        });
    }

    /* -------------------------------------------------------------- 启动 */

    function boot() {
        if (booted) return;
        booted = true;
        rootEl = document.getElementById('viewRoot');
        crumbTitleEl = document.getElementById('crumbTitle');
        crumbSubEl = document.getElementById('crumbSub');

        try { if (global.WJSite && global.WJSite.initCommon) global.WJSite.initCommon(); } catch (e) { void e; }
        initChrome();

        current = routeName();
        if (!location.hash) {
            try { history.replaceState(null, '', '#/' + current); } catch (e) { void e; }
        }

        rootEl.innerHTML = '<div class="admin-loading">正在读取本地数据…</div>';
        loadData().then(function () {
            mountView();
        }).catch(function (err) {
            rootEl.innerHTML = '<div class="empty"><p>加载失败：' + esc(err.message) + '</p>' +
                '<p class="admin-hint">若是首次打开，请确认浏览器允许本站使用 IndexedDB。</p></div>';
        });
    }

    /* -------------------------------------------------------------- 导出 */

    global.WJAdmin = {
        Store: Store,
        UI: UI,
        state: state,
        register: register,
        refresh: refresh,
        go: go,
        // 渲染助手
        esc: esc,
        badge: badge,
        sourceBadge: sourceBadge,
        plain: plain,
        wordsOf: wordsOf,
        haystack: haystack,
        findByID: findByID,
        publicURL: publicURL,
        exportPDF: exportPDF,
        copyText: copyText,
        openEditor: openEditor
    };

    // body 末尾的同步脚本全部执行完后才触发 DOMContentLoaded，
    // 因此这里能保证各视图模块已完成 register。
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})(window);
