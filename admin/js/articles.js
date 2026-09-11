/* ==========================================================================
   无极博客 · 后台视图：文章管理（admin/js/articles.js）
   —— 搜索 / 筛选 / 排序 / 批量操作 / 行内操作
   ========================================================================== */
(function (global) {
    'use strict';

    var A = global.WJAdmin;
    var Store = A.Store;
    var UI = A.UI;
    var esc = A.esc;

    // 视图偏好跨刷新保留（模块闭包在 SPA 生命周期内一直存在）
    var prefs = { q: '', status: 'all', source: 'all', sort: 'updated' };
    var selected = {};

    function selectedList() {
        return A.state.articles.filter(function (a) { return selected[a.id]; });
    }

    function filtered() {
        var q = prefs.q.trim().toLowerCase();
        var list = A.state.articles.filter(function (a) {
            if (prefs.status === 'draft' && a.status === 'published') return false;
            if (prefs.status === 'published' && a.status !== 'published') return false;
            if (prefs.source === 'local' && a.source !== 'local') return false;
            if (prefs.source === 'repo' && a.source !== 'repo') return false;
            if (prefs.source === 'override' && !(a.source === 'repo' && a.localOnly)) return false;
            if (!q) return true;
            return A.haystack(a).indexOf(q) !== -1;
        });
        list.sort(function (x, y) {
            if (!!y.pinned !== !!x.pinned) return (y.pinned ? 1 : 0) - (x.pinned ? 1 : 0);
            if (prefs.sort === 'title') return x.title.localeCompare(y.title, 'zh-Hans-CN');
            if (prefs.sort === 'created') return String(y.createdAt).localeCompare(String(x.createdAt));
            if (prefs.sort === 'words') return A.wordsOf(y) - A.wordsOf(x);
            return String(y.updatedAt).localeCompare(String(x.updatedAt));
        });
        return list;
    }

    function rowHTML(a) {
        return '<tr data-id="' + esc(a.id) + '">' +
            '<td class="col-check"><input type="checkbox" data-role="pick" aria-label="选择 ' + esc(a.title) + '"' +
            (selected[a.id] ? ' checked' : '') + ' /></td>' +
            '<td class="col-title"><div class="title-cell">' +
            '<span class="t">' + esc(a.title) + (a.pinned ? ' <span class="post-pin">置顶</span>' : '') + '</span>' +
            '<span class="id">' + esc(a.slug || a.id) + '</span>' +
            '</div></td>' +
            '<td data-label="状态">' + A.badge(a) + '</td>' +
            '<td data-label="来源">' + A.sourceBadge(a) + '</td>' +
            '<td class="num" data-label="字数">' + A.wordsOf(a) + '</td>' +
            '<td class="num" data-label="更新">' + esc(Store.fmtRelative(a.updatedAt)) + '</td>' +
            '<td><div class="row-actions">' +
            '<a class="btn btn-ghost" href="editor.html?id=' + encodeURIComponent(a.id) + '">编辑</a>' +
            '<button class="btn btn-ghost" data-act="pin">' + (a.pinned ? '取消置顶' : '置顶') + '</button>' +
            '<button class="btn btn-ghost" data-act="status">' + (a.status === 'published' ? '转草稿' : '发布') + '</button>' +
            '<button class="btn btn-ghost" data-act="dup">复制</button>' +
            '<button class="btn btn-ghost" data-act="json">导出</button>' +
            '<button class="btn btn-ghost" data-act="pdf">PDF</button>' +
            '<button class="btn btn-danger" data-act="del">删除</button>' +
            '</div></td>' +
            '</tr>';
    }

    A.register('articles', {
        title: '文章',
        sub: '搜索、筛选、批量发布与本地维护',
        mount: function (root, ctx) {
            var st = ctx.state;
            if (!st.loaded) {
                root.innerHTML = '<div class="admin-loading">正在读取本地数据…</div>';
                return;
            }

            root.innerHTML =
                '<section class="admin-section">' +
                '<header>' +
                '<div><h2>文章</h2><div class="sub">编辑与删除不用区分线上线下：删除会记入发布包，落地后仓库里的同名文章一并移除。</div></div>' +
                '<div class="admin-actions"><a class="btn btn-primary btn-sm" href="editor.html">写新文章</a></div>' +
                '</header>' +

                '<div class="admin-toolbar">' +
                '<div class="search-box">' +
                '<input class="input" data-role="search" type="search" placeholder="搜索标题、标签或正文…" aria-label="搜索文章" value="' + esc(prefs.q) + '" />' +
                '</div>' +
                '<select class="select" data-role="status" aria-label="状态筛选">' +
                opt('all', '全部状态', prefs.status) + opt('published', '已发布', prefs.status) + opt('draft', '草稿', prefs.status) +
                '</select>' +
                '<select class="select" data-role="source" aria-label="来源筛选">' +
                opt('all', '全部来源', prefs.source) + opt('local', '仅本地', prefs.source) +
                opt('repo', '仅线上', prefs.source) + opt('override', '线上被覆盖', prefs.source) +
                '</select>' +
                '<select class="select" data-role="sort" aria-label="排序">' +
                opt('updated', '最近更新', prefs.sort) + opt('created', '创建时间', prefs.sort) +
                opt('title', '标题', prefs.sort) + opt('words', '字数', prefs.sort) +
                '</select>' +
                '<span class="admin-count" data-role="count"></span>' +
                '</div>' +

                '<div class="bulk-bar" data-role="bulk" hidden>' +
                '<span class="n" data-role="bulkCount">0</span><span class="d">篇已选</span>' +
                '<div class="grow"></div>' +
                '<button class="btn btn-primary btn-sm" data-bulk="publish" type="button">批量发布</button>' +
                '<button class="btn btn-ghost btn-sm" data-bulk="draft" type="button">转为草稿</button>' +
                '<button class="btn btn-ghost btn-sm" data-bulk="pin" type="button">置顶</button>' +
                '<button class="btn btn-ghost btn-sm" data-bulk="unpin" type="button">取消置顶</button>' +
                '<button class="btn btn-ghost btn-sm" data-bulk="export" type="button">导出</button>' +
                '<button class="btn btn-danger btn-sm" data-bulk="del" type="button">删除</button>' +
                '<button class="btn btn-ghost btn-sm" data-bulk="clear" type="button">取消选择</button>' +
                '</div>' +

                '<div class="admin-scroll">' +
                '<table class="admin-table">' +
                '<thead><tr>' +
                '<th class="col-check"><input type="checkbox" data-role="all" aria-label="全选" /></th>' +
                '<th class="col-title">标题</th><th>状态</th><th>来源</th>' +
                '<th class="num">字数</th><th class="num">更新</th><th class="th-actions">操作</th>' +
                '</tr></thead>' +
                '<tbody data-role="body"></tbody>' +
                '</table>' +
                '</div>' +
                '<div class="empty" data-role="empty" hidden><p data-role="emptyText"></p></div>' +
                '</section>';

            var els = {
                body: root.querySelector('[data-role="body"]'),
                empty: root.querySelector('[data-role="empty"]'),
                emptyText: root.querySelector('[data-role="emptyText"]'),
                count: root.querySelector('[data-role="count"]'),
                bulk: root.querySelector('[data-role="bulk"]'),
                bulkCount: root.querySelector('[data-role="bulkCount"]'),
                all: root.querySelector('[data-role="all"]'),
                search: root.querySelector('[data-role="search"]'),
                status: root.querySelector('[data-role="status"]'),
                source: root.querySelector('[data-role="source"]'),
                sort: root.querySelector('[data-role="sort"]')
            };

            function render() {
                var list = filtered();
                els.body.innerHTML = list.map(rowHTML).join('');
                els.empty.hidden = list.length > 0;
                els.emptyText.textContent = A.state.articles.length
                    ? '没有匹配的文章，换个关键词或筛选条件试试。'
                    : '本地还没有文章。点右上角「写新文章」开始。';
                els.count.textContent = '共 ' + A.state.articles.length + ' 篇，当前 ' + list.length + ' 篇';
                syncBulk();
            }

            function syncBulk() {
                var n = Object.keys(selected).length;
                els.bulk.hidden = n === 0;
                els.bulkCount.textContent = n;
                var list = filtered();
                var picked = list.filter(function (a) { return selected[a.id]; }).length;
                els.all.checked = list.length > 0 && picked === list.length;
                els.all.indeterminate = picked > 0 && picked < list.length;
            }

            function setStatus(list, status, label) {
                if (!list.length) return;
                Promise.all(list.map(function (a) {
                    return Store.saveArticle(Object.assign({}, a, { status: status }));
                })).then(function () {
                    UI.toast(label + '（' + list.length + ' 篇）', 'ok');
                    return ctx.refresh();
                });
            }

            function setPin(list, pinned, label) {
                if (!list.length) return;
                Promise.all(list.map(function (a) {
                    return Store.saveArticle(Object.assign({}, a, { pinned: pinned }));
                })).then(function () {
                    UI.toast(label + '（' + list.length + ' 篇）', 'ok');
                    return ctx.refresh();
                });
            }

            function remove(list) {
                if (!list.length) return Promise.resolve();
                var online = list.filter(function (a) { return a.source === 'repo'; }).length;
                return UI.confirm('删除 ' + list.length + ' 篇文章',
                    '文章会立刻从列表里消失。' +
                    (online ? '其中 ' + online + ' 篇在公开站点上也有：浏览器改不了仓库文件，' +
                        '要在「发布」视图执行一次落地命令并提交，线上才会消失。' : '') +
                    '删除后可在「发布」视图撤销。', '确认删除')
                    .then(function (yes) {
                        if (!yes) return;
                        return list.reduce(function (p, a) {
                            return p.then(function () { return Store.deleteArticle(a.id); });
                        }, Promise.resolve()).then(function () {
                            UI.toast('已删除 ' + list.length + ' 篇：' +
                                (online ? '去「发布」视图复制落地命令' : '可在「发布」视图撤销'), 'ok', 4200);
                            return ctx.refresh();
                        });
                    });
            }

            /* ---------------------------------------------------- 工具栏 */

            var timer = 0;
            els.search.addEventListener('input', function () {
                clearTimeout(timer);
                timer = setTimeout(function () { prefs.q = els.search.value; render(); }, 120);
            });
            els.status.addEventListener('change', function () { prefs.status = els.status.value; render(); });
            els.source.addEventListener('change', function () { prefs.source = els.source.value; render(); });
            els.sort.addEventListener('change', function () { prefs.sort = els.sort.value; render(); });

            els.all.addEventListener('change', function () {
                var on = els.all.checked;
                filtered().forEach(function (a) { if (on) selected[a.id] = true; else delete selected[a.id]; });
                render();
            });

            /* ------------------------------------------------ 批量操作 */

            root.querySelector('[data-role="bulk"]').addEventListener('click', function (e) {
                var btn = e.target.closest('[data-bulk]');
                if (!btn) return;
                var act = btn.getAttribute('data-bulk');
                var list = selectedList();
                if (act === 'clear') { selected = {}; render(); return; }
                if (act === 'publish') return setStatus(list, 'published', '已发布');
                if (act === 'draft') return setStatus(list, 'draft', '已转为草稿');
                if (act === 'pin') return setPin(list, true, '已置顶');
                if (act === 'unpin') return setPin(list, false, '已取消置顶');
                if (act === 'export') {
                    var data = list.map(Store.toExportObject);
                    Store.download('articles-selected.json', JSON.stringify(data, null, 2));
                    UI.toast('已导出 ' + list.length + ' 篇', 'ok');
                    return;
                }
                if (act === 'del') remove(list);
            });

            /* ------------------------------------------------ 行内操作 */

            els.body.addEventListener('click', function (e) {
                var btn = e.target.closest('[data-act]');
                if (!btn) return;
                var tr = e.target.closest('tr');
                var a = tr && A.findByID(tr.getAttribute('data-id'));
                if (!a) return;
                var act = btn.getAttribute('data-act');

                if (act === 'json') {
                    Store.exportArticleFile(a);
                    UI.toast('已导出 ' + (a.slug || a.id) + '.json', 'ok');
                    return;
                }
                if (act === 'pdf') { A.exportPDF(a); return; }
                if (act === 'pin') { setPin([a], !a.pinned, a.pinned ? '已取消置顶' : '已置顶'); return; }
                if (act === 'status') { setStatus([a], a.status === 'published' ? 'draft' : 'published', '状态已更新'); return; }
                if (act === 'del') { remove([a]); return; }
                if (act === 'dup') {
                    var copy = Store.normalize(Object.assign({}, a, {
                        id: Store.genId('a'),
                        slug: '',
                        title: a.title + '（副本）',
                        source: 'local',
                        localOnly: true,
                        status: 'draft',
                        pinned: false,
                        createdAt: Store.nowISO(),
                        updatedAt: Store.nowISO(),
                        repoSnapshot: null
                    }));
                    copy.slug = Store.slugify(copy.title, copy.id);
                    Store.saveArticle(copy).then(function () {
                        UI.toast('已创建副本', 'ok');
                        return ctx.refresh();
                    });
                }
            });

            els.body.addEventListener('change', function (e) {
                var box = e.target.closest('[data-role="pick"]');
                if (!box) return;
                var tr = e.target.closest('tr');
                var id = tr && tr.getAttribute('data-id');
                if (!id) return;
                if (box.checked) selected[id] = true; else delete selected[id];
                syncBulk();
            });

            // 视图切换时清理选中，避免跨视图残留
            if (ctx.signal) ctx.signal.addEventListener('abort', function () { selected = {}; });

            render();
        }
    });

    function opt(value, label, cur) {
        return '<option value="' + value + '"' + (value === cur ? ' selected' : '') + '>' + label + '</option>';
    }
})(window);
