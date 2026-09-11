/* ==========================================================================
   无极博客 · 后台视图：图片库（admin/js/images.js）
   —— 预览 / 引用统计 / 复制引用 / 下载 / 删除
   ========================================================================== */
(function (global) {
    'use strict';

    var A = global.WJAdmin;
    var Store = A.Store;
    var UI = A.UI;
    var esc = A.esc;

    var prefs = { q: '', filter: 'all', sort: 'date' };

    /** 扫描全部正文，得出 图片 id → 引用它的文章列表 */
    function buildUsage() {
        var map = {};
        A.state.articles.forEach(function (a) {
            var seen = {};
            var re = /img:\/\/([A-Za-z0-9_-]+)/g;
            var m;
            while ((m = re.exec(a.body || ''))) {
                var id = m[1];
                if (seen[id]) continue;
                seen[id] = true;
                (map[id] = map[id] || []).push({ id: a.id, title: a.title });
            }
        });
        return map;
    }

    function cardHTML(rec, usage) {
        var refs = usage[rec.id] || [];
        var dim = (rec.width && rec.height) ? rec.width + '×' + rec.height : '未知尺寸';
        return '<figure class="thumb-card" data-id="' + esc(rec.id) + '">' +
            '<button class="thumb-media" data-act="view" type="button" aria-label="预览 ' + esc(rec.name) + '">' +
            '<img data-img="' + esc(rec.id) + '" alt="' + esc(rec.name) + '" loading="lazy" />' +
            '</button>' +
            '<figcaption class="thumb-meta">' +
            '<div class="t" title="' + esc(rec.name) + '">' + esc(rec.name) + '</div>' +
            '<div class="d">' + esc(rec.type || 'image') + ' · ' + UI.fmtBytes(rec.size) + ' · ' + esc(dim) + '</div>' +
            '<div class="d">' + (refs.length
                ? '被 ' + refs.length + ' 篇文章引用'
                : '<span class="badge badge-draft">未引用</span>') + '</div>' +
            '<div class="row-actions">' +
            '<button class="btn btn-ghost btn-xs" data-act="ref" type="button">复制引用</button>' +
            '<button class="btn btn-ghost btn-xs" data-act="down" type="button">下载</button>' +
            '<button class="btn btn-danger btn-xs" data-act="del" type="button">删除</button>' +
            '</div>' +
            '</figcaption>' +
            '</figure>';
    }

    function hydrate(rootEl) {
        Array.prototype.forEach.call(rootEl.querySelectorAll('img[data-img]'), function (img) {
            var id = img.getAttribute('data-img');
            var cached = Store.imageURLCached(id);
            if (cached) { img.src = cached; return; }
            Store.imageURL(id).then(function (u) { if (u) img.src = u; });
        });
    }

    A.register('images', {
        title: '图片库',
        sub: '本地图片的引用与体积',
        mount: function (root, ctx) {
            var st = ctx.state;
            if (!st.loaded) {
                root.innerHTML = '<div class="admin-loading">正在读取本地数据…</div>';
                return;
            }

            var usage = buildUsage();
            var used = st.images.filter(function (r) { return (usage[r.id] || []).length > 0; }).length;
            var orphan = st.images.length - used;

            root.innerHTML =
                '<section class="admin-section">' +
                '<header>' +
                '<div><h2>图片库</h2><div class="sub">正文里用 <code>img://&lt;id&gt;</code> 引用，发布时会被替换为真实文件。</div></div>' +
                '<div class="admin-actions"><a class="btn btn-primary btn-sm" href="editor.html">去编辑器上传</a></div>' +
                '</header>' +

                '<div class="admin-toolbar">' +
                '<div class="search-box">' +
                '<input class="input" data-role="search" type="search" placeholder="按文件名搜索…" aria-label="搜索图片" value="' + esc(prefs.q) + '" />' +
                '</div>' +
                '<select class="select" data-role="filter" aria-label="引用筛选">' +
                opt('all', '全部图片', prefs.filter) + opt('used', '已被引用', prefs.filter) + opt('orphan', '未引用', prefs.filter) +
                '</select>' +
                '<select class="select" data-role="sort" aria-label="排序">' +
                opt('date', '最近添加', prefs.sort) + opt('size', '体积从大到小', prefs.sort) + opt('name', '文件名', prefs.sort) +
                '</select>' +
                '<span class="admin-count" data-role="count"></span>' +
                '</div>' +

                '<div class="body">' +
                '<div class="notice" style="margin-bottom:16px">' +
                '<div>共 <b>' + st.images.length + '</b> 张 · 占用 <b>' + UI.fmtBytes(st.imageBytes) + '</b> · ' +
                '已引用 <b>' + used + '</b> 张' + (orphan ? ' · 未引用 <b>' + orphan + '</b> 张（可在图库中清理）' : '') + '。</div>' +
                '</div>' +
                '<div class="thumb-grid" data-role="grid"></div>' +
                '<div class="empty" data-role="empty" hidden><p data-role="emptyText"></p></div>' +
                '</div>' +
                '</section>';

            var els = {
                grid: root.querySelector('[data-role="grid"]'),
                empty: root.querySelector('[data-role="empty"]'),
                emptyText: root.querySelector('[data-role="emptyText"]'),
                count: root.querySelector('[data-role="count"]'),
                search: root.querySelector('[data-role="search"]'),
                filter: root.querySelector('[data-role="filter"]'),
                sort: root.querySelector('[data-role="sort"]')
            };

            function current() {
                var q = prefs.q.trim().toLowerCase();
                var list = st.images.filter(function (r) {
                    var n = (usage[r.id] || []).length;
                    if (prefs.filter === 'used' && n === 0) return false;
                    if (prefs.filter === 'orphan' && n > 0) return false;
                    if (q && String(r.name || '').toLowerCase().indexOf(q) === -1) return false;
                    return true;
                });
                list.sort(function (x, y) {
                    if (prefs.sort === 'size') return (y.size || 0) - (x.size || 0);
                    if (prefs.sort === 'name') return String(x.name).localeCompare(String(y.name), 'zh-Hans-CN');
                    return String(y.createdAt).localeCompare(String(x.createdAt));
                });
                return list;
            }

            function render() {
                var list = current();
                els.grid.innerHTML = list.map(function (r) { return cardHTML(r, usage); }).join('');
                els.empty.hidden = list.length > 0;
                els.emptyText.textContent = st.images.length
                    ? '没有匹配的图片，换个条件试试。'
                    : '还没有本地图片，去编辑器里上传第一张吧。';
                els.count.textContent = '共 ' + st.images.length + ' 张，当前 ' + list.length + ' 张';
                hydrate(els.grid);
            }

            var timer = 0;
            els.search.addEventListener('input', function () {
                clearTimeout(timer);
                timer = setTimeout(function () { prefs.q = els.search.value; render(); }, 120);
            });
            els.filter.addEventListener('change', function () { prefs.filter = els.filter.value; render(); });
            els.sort.addEventListener('change', function () { prefs.sort = els.sort.value; render(); });

            els.grid.addEventListener('click', function (e) {
                var btn = e.target.closest('[data-act]');
                if (!btn) return;
                var card = e.target.closest('.thumb-card');
                var id = card && card.getAttribute('data-id');
                var rec = st.images.filter(function (r) { return r.id === id; })[0];
                if (!rec) return;
                var act = btn.getAttribute('data-act');

                if (act === 'ref') { A.copyText('img://' + rec.id, '已复制 img://' + rec.id); return; }
                if (act === 'down') { Store.download(rec.name || (rec.id + '.png'), rec.blob, rec.type); return; }
                if (act === 'view') {
                    var url = Store.imageURLCached(rec.id) || '';
                    var img = document.createElement('img');
                    img.className = 'thumb-preview';
                    img.alt = rec.name || '';
                    if (url) img.src = url;
                    else Store.imageURL(rec.id).then(function (u) { if (u) img.src = u; });
                    UI.dialog({
                        title: rec.name || rec.id,
                        body: img,
                        width: '720px',
                        actions: [{ label: '关闭', value: true, primary: true }]
                    });
                    return;
                }
                if (act === 'del') {
                    var refs = usage[rec.id] || [];
                    UI.confirm('删除图片', '「' + rec.name + '」将从本地库删除，无法撤销。' +
                        (refs.length ? '注意：仍有 ' + refs.length + ' 篇文章引用它，删除后正文里会显示为缺失图片。' : ''),
                        '确认删除').then(function (yes) {
                        if (!yes) return;
                        Store.deleteImage(rec.id).then(function () {
                            UI.toast('已删除图片', 'ok');
                            return ctx.refresh();
                        });
                    });
                }
            });

            render();
        }
    });

    function opt(value, label, cur) {
        return '<option value="' + value + '"' + (value === cur ? ' selected' : '') + '>' + label + '</option>';
    }
})(window);
