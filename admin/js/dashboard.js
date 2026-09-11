/* ==========================================================================
   无极博客 · 后台视图：概览（admin/js/dashboard.js）
   ========================================================================== */
(function (global) {
    'use strict';

    var A = global.WJAdmin;
    var Store = A.Store;
    var UI = A.UI;
    var esc = A.esc;

    function statCard(k, v, sub, tone) {
        return '<div class="stat-card' + (tone ? ' ' + tone : '') + '">' +
            '<div class="k">' + esc(k) + '</div>' +
            '<div class="v">' + esc(v) + '</div>' +
            '<div class="s">' + esc(sub) + '</div>' +
            '</div>';
    }

    function quickCard(href, symbol, title, desc) {
        return '<a class="quick-card" href="' + href + '">' +
            '<span class="i" aria-hidden="true">' + symbol + '</span>' +
            '<b>' + esc(title) + '</b>' +
            '<span class="d">' + esc(desc) + '</span>' +
            '</a>';
    }

    function healthItem(label, value, ok) {
        return '<li class="health-item">' +
            '<span class="health-dot' + (ok ? ' ok' : '') + '" aria-hidden="true"></span>' +
            '<span class="t">' + esc(label) + '</span>' +
            '<span class="v">' + esc(value) + '</span>' +
            '</li>';
    }

    function recentItem(a) {
        return '<a class="recent-item" href="editor.html?id=' + encodeURIComponent(a.id) + '">' +
            '<span class="t">' + esc(a.title) + (a.pinned ? ' <span class="post-pin">置顶</span>' : '') + '</span>' +
            '<span class="m">' + A.badge(a) + A.sourceBadge(a) +
            '<span class="time">' + esc(Store.fmtRelative(a.updatedAt)) + '</span></span>' +
            '</a>';
    }

    A.register('overview', {
        title: '概览',
        sub: '本地数据一览与快捷入口',
        mount: function (root, ctx) {
            var st = ctx.state;
            if (!st.loaded) {
                root.innerHTML = '<div class="admin-loading">正在读取本地数据…</div>';
                return;
            }

            var local = st.local;
            var published = local.filter(function (a) { return a.status === 'published'; });
            var drafts = local.filter(function (a) { return a.status !== 'published'; });
            var lastUpdated = local.reduce(function (m, a) { return a.updatedAt > m ? a.updatedAt : m; }, '');
            var recent = st.articles.slice()
                .sort(function (x, y) { return String(y.updatedAt).localeCompare(String(x.updatedAt)); })
                .slice(0, 6);

            var embedded = (global.WJ_ARTICLES && (Array.isArray(global.WJ_ARTICLES)
                ? global.WJ_ARTICLES.length
                : (global.WJ_ARTICLES.articles || []).length)) || 0;
            var fileMode = Store.isFileProtocol();

            root.innerHTML =
                '<div class="admin-banner">' +
                '<span class="badge badge-local">仅本机</span>' +
                '<div class="grow">' +
                '<div class="t">本地管理系统 · 不部署到服务器</div>' +
                '<div class="d">本页与编辑器都在 <code>admin/</code> 目录，<code>tools/deploy.mjs</code> 部署时不会拷贝；' +
                '文章与图片保存在你浏览器的 IndexedDB 里，改动后需要 <b>打包发布 → 本地落地</b> 两步才会出现在公开站点。</div>' +
                '</div>' +
                '<a class="btn btn-ghost btn-sm" href="../index.html">查看公开站点</a>' +
                '</div>' +

                '<div class="stat-cards">' +
                statCard('本地文章', local.length, local.length ? '最近更新 ' + Store.fmtRelative(lastUpdated) : '还没有本地文章') +
                statCard('已发布', published.length, '本地标记，落地后才上线', 'tone-ok') +
                statCard('草稿', drafts.length, '仅本地保存') +
                statCard('本地图片', st.images.length, st.images.length ? UI.fmtBytes(st.imageBytes) : '还没有图片') +
                statCard('线上文章', st.repoCount, st.repoCount ? '来自 articles/' : '未读到 articles/index.json') +
                '</div>' +

                '<div class="admin-split">' +
                '<section class="admin-section">' +
                '<header><div><h2>快捷操作</h2><div class="sub">常用入口，一步直达。</div></div></header>' +
                '<div class="body"><div class="quick-grid">' +
                quickCard('editor.html', '＋', '写新文章', '新建一篇 Markdown 文章') +
                quickCard('#/articles', '¶', '管理文章', '搜索、筛选、批量发布') +
                quickCard('#/images', '▣', '图片库', '查看引用与体积') +
                quickCard('#/publish', '↑', '打包发布', '导出并落地到 articles/') +
                quickCard('selftest.html', '✓', '浏览器自测', '真实 DOM + KaTeX 全链路') +
                quickCard('#/settings', '⚙', '设置', '主题、存储与危险操作') +
                '</div></div>' +
                '</section>' +

                '<section class="admin-section">' +
                '<header><div><h2>数据健康</h2><div class="sub">打开方式与数据来源自检。</div></div></header>' +
                '<div class="body"><ul class="health-list">' +
                healthItem('打开方式', fileMode ? 'file://（读取嵌入式数据）' : location.protocol + '（优先 fetch）', true) +
                healthItem('嵌入式文章', embedded + ' 篇', embedded > 0) +
                healthItem('本地覆盖线上', st.overrides + ' 篇', st.overrides === 0) +
                healthItem('未发布草稿', drafts.length + ' 篇', drafts.length === 0) +
                healthItem('图片占用', UI.fmtBytes(st.imageBytes), true) +
                '</ul></div>' +
                '</section>' +
                '</div>' +

                '<section class="admin-section">' +
                '<header><div><h2>最近更新</h2><div class="sub">点任意一条即可继续编辑。</div></div>' +
                '<div class="admin-actions"><a class="btn btn-ghost btn-sm" href="#/articles">全部文章</a></div></header>' +
                '<div class="body">' +
                (recent.length
                    ? '<div class="recent-list">' + recent.map(recentItem).join('') + '</div>'
                    : '<div class="empty"><p>还没有文章，点右上角「写新文章」开始。</p></div>') +
                '</div>' +
                '</section>';
        }
    });
})(window);
