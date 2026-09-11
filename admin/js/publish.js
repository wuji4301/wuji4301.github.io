/* ==========================================================================
   无极博客 · 后台视图：发布中心（admin/js/publish.js）
   —— 打包发布 / 导入导出 / 清空 / 落地与部署命令
   ========================================================================== */
(function (global) {
    'use strict';

    var A = global.WJAdmin;
    var Store = A.Store;
    var UI = A.UI;
    var esc = A.esc;

    function step(title, desc, cmd) {
        return '<div class="cmd">' +
            '<div class="grow">' +
            '<div class="t">' + esc(title) + '</div>' +
            '<div class="d">' + desc + '</div>' +
            (cmd ? '<code data-copy>' + esc(cmd) + '</code>' : '') +
            '</div>' +
            (cmd ? '<button class="btn btn-ghost btn-xs copy-cmd" type="button">复制</button>' : '') +
            '</div>';
    }

    A.register('publish', {
        title: '发布',
        sub: '打包、落地与部署校验',
        mount: function (root, ctx) {
            var st = ctx.state;
            if (!st.loaded) {
                root.innerHTML = '<div class="admin-loading">正在读取本地数据…</div>';
                return;
            }

            var local = st.local;
            var published = local.filter(function (a) { return a.status === 'published'; }).length;
            var deleted = st.deleted || [];

            root.innerHTML =
                '<section class="admin-section">' +
                '<header>' +
                '<div><h2>打包发布</h2><div class="sub">把本地文章导出成发布包，再用本地 Node 工具落地到 <code>articles/</code>。</div></div>' +
                '</header>' +
                '<div class="body">' +
                '<div class="admin-actions" style="margin-bottom:16px">' +
                '<button class="btn btn-primary" data-role="publish" type="button">打包发布（下载发布包）</button>' +
                '<button class="btn btn-ghost" data-role="export" type="button">导出 articles.json</button>' +
                '<button class="btn btn-ghost" data-role="import" type="button">导入 JSON</button>' +
                '<input type="file" data-role="importFile" accept=".json,application/json" multiple hidden />' +
                '<button class="btn btn-ghost" data-role="images" type="button">导出全部图片</button>' +
                '<button class="btn btn-danger" data-role="wipe" type="button">清空本地数据</button>' +
                '</div>' +

                '<div class="notice" style="margin-bottom:16px"><div>' +
                '当前本地共 <b>' + local.length + '</b> 篇文章（已发布 <b>' + published + '</b> / 草稿 <b>' + (local.length - published) + '</b>），' +
                '本地图片 <b>' + st.images.length + '</b> 张，占用 <b>' + UI.fmtBytes(st.imageBytes) + '</b>' +
                (deleted.length ? '，待同步删除 <b>' + deleted.length + '</b> 篇' : '') + '。' +
                '</div></div>' +

                '<div class="cmd-list">' +
                step('① 打包发布', '下载一个发布包（含全部本地文章、待同步删除的 id 列表，以及公开站点需要的字段）。') +
                step('② 在项目根目录落地', '把下面的路径换成实际的下载位置后执行：',
                    'node tools/publish.mjs "C:\\Users\\Administrator\\Downloads\\articles-publish.json"') +
                step('③ 提交发布', '公开站点读取 <code>articles/</code> 与 <code>articles-data.js</code>，上一步会同时更新两者。',
                    'git add -A && git commit -m "更新文章" && git push') +
                '</div>' +

                '<div class="notice" style="margin-top:16px"><div>' +
                '想确认线上会看到什么？执行下方命令会生成 <code>deploy/</code> 目录，' +
                '只拷贝公开文件并校验其中不含 <code>admin/</code> 与 <code>tools/</code>；直接双击 <code>deploy/index.html</code> 即可预览。' +
                '</div></div>' +
                '</div>' +
                '</section>' +

                '<section class="admin-section" data-role="pending" hidden>' +
                '<header><div><h2>待同步删除</h2><div class="sub">已从后台移除，但还没有落到仓库里。</div></div>' +
                '<div class="admin-actions"><button class="btn btn-ghost btn-sm" data-role="restoreAll" type="button">全部恢复</button></div></header>' +
                '<div class="body">' +
                '<div class="cmd-list" style="margin-bottom:12px"><div data-role="pendingCmd"></div></div>' +
                '<ul class="health-list" data-role="pendingList"></ul>' +
                '</div>' +
                '</section>' +

                '<section class="admin-section">' +
                '<header><div><h2>部署与自检</h2><div class="sub">本地开发与校验命令。</div></div></header>' +
                '<div class="body"><div class="cmd-list">' +
                step('生成部署目录（校验隔离）', '把公开文件拷进 <code>deploy/</code> 并检查隔离规则。', 'node tools/deploy.mjs') +
                step('浏览器全链路自测', '在真实 DOM + KaTeX + IndexedDB 环境里验证渲染、存储、编辑器保存回读。详见 <a href="selftest.html">admin/selftest.html</a>。') +
                step('Node 单元测试', '渲染器、转换层、公式、资源一致性、嵌入式数据同源。',
                    'node tools/test-render.mjs && node tools/test-convert.mjs && node tools/test-katex.mjs') +
                step('重建嵌入式文章数据', '从 <code>articles/*.json</code> 重新生成 <code>articles-data.js</code>（让 file:// 也能读到文章）。',
                    'node tools/build-articles.mjs') +
                step('升级 KaTeX', '重新自托管公式引擎到 <code>vendor/katex/</code>，带签名与体积校验。',
                    'node tools/fetch-katex.mjs 0.16.11') +
                '</div></div>' +
                '</section>' +

                '<div class="notice"><div>' +
                '隔离方式：<code>admin/</code> 与 <code>tools/</code> 不在任何公开页面的导航里，部署工具只拷贝白名单文件。' +
                '静态托管无法阻止别人直接输入 URL，但因为这两个目录根本不部署，线上并不存在——所以这里不需要把「藏起来」当成安全措施。' +
                '</div></div>';

            var q = function (sel) { return root.querySelector(sel); };
            var importFile = q('[data-role="importFile"]');

            /* ------------------------------------------------ 待同步删除 */

            var pendingSection = q('[data-role="pending"]');
            var pendingList = q('[data-role="pendingList"]');

            function renderPending() {
                var ids = (A.state.deleted || []).slice();
                var cmdBox = q('[data-role="pendingCmd"]');
                if (!ids.length) {
                    pendingSection.hidden = true;
                    pendingList.innerHTML = '';
                    if (cmdBox) cmdBox.innerHTML = '';
                    return;
                }
                pendingSection.hidden = false;
                // 浏览器改不了仓库文件：把「让删除生效」的确切命令摆在眼前，不用去下载发布包
                if (cmdBox) {
                    cmdBox.innerHTML = step('让删除生效',
                        '删除只记在本地，公开站点读的是仓库文件，所以<b>落地并推送之前线上仍然看得到</b>。' +
                        '这条命令不需要发布包，直接把下面的 id 从 <code>articles/</code> 移除：',
                        'node tools/publish.mjs --delete ' + ids.join(','));
                }
                // 标题要回仓库清单里查：这些文章已经不在合并列表里了
                Store.loadRepoIndex().then(function (list) {
                    var meta = {};
                    (list || []).forEach(function (e) { meta[e.id] = e; });
                    pendingList.innerHTML = ids.map(function (id) {
                        var m = meta[id] || {};
                        return '<li class="health-item"><span class="t">' + esc(m.title || '（仓库里已不存在）') +
                            '<br /><code>' + esc(id) + '</code></span>' +
                            '<span class="v"><button class="btn btn-ghost btn-xs" data-restore="' + esc(id) +
                            '" type="button">撤销删除</button></span></li>';
                    }).join('');
                });
            }

            root.addEventListener('click', function (e) {
                var btn = e.target.closest('[data-restore]');
                if (!btn) return;
                Store.unmarkDeleted(btn.getAttribute('data-restore')).then(function () {
                    return ctx.refresh();
                }).then(function () { UI.toast('已撤销删除', 'ok'); });
            });

            q('[data-role="restoreAll"]').addEventListener('click', function () {
                Store.clearDeleted().then(function () { return ctx.refresh(); }).then(function () {
                    UI.toast('已撤销全部删除标记', 'ok');
                });
            });

            renderPending();

            /* -------------------------------------------------- 打包发布 */

            // 草稿不会进公开站点（articles-data.js 与阅读层都会把它过滤掉），
            // 所以"打包了却看不到文章"必须先在点击时就说清楚。
            function buildPack() {
                var locals = A.state.local;
                var deletions = (A.state.deleted || []).slice();
                var imgs = A.state.images;
                var pack = {
                    format: 'wuji-blog-publish',
                    version: 1,
                    generatedAt: Store.nowISO(),
                    site: location.origin === 'null' ? 'file://' : location.origin,
                    counts: {
                        articles: locals.length,
                        published: locals.filter(function (a) { return a.status === 'published'; }).length,
                        drafts: locals.filter(function (a) { return a.status !== 'published'; }).length,
                        deletions: deletions.length,
                        images: imgs.length
                    },
                    articles: locals.map(Store.toExportObject),
                    // 删除标记随包落地：publish.mjs 会把它们从 articles/ 移除
                    deletions: deletions,
                    images: imgs.map(function (im) { return { id: im.id, name: im.name, type: im.type, size: im.size }; })
                };
                Store.download('articles-publish.json', JSON.stringify(pack, null, 2));
                if (imgs.length) Store.exportImages();

                var wrap = document.createElement('div');
                wrap.className = 'export-grid';
                wrap.innerHTML =
                    '<div class="notice">已下载发布包：<b>' + locals.length + ' 篇</b>' +
                    '（已发布 ' + pack.counts.published + ' / 草稿 ' + pack.counts.drafts + '）' +
                    (deletions.length ? '，待删除 <b>' + deletions.length + '</b> 篇' : '') +
                    (imgs.length ? '，并开始下载 <b>' + imgs.length + '</b> 张图片' : '，无本地图片') + '。</div>' +
                    '<div class="cmd"><div class="grow"><div class="t">下一步：在项目根目录执行</div>' +
                    '<code>node tools/publish.mjs "下载目录/articles-publish.json"</code></div></div>' +
                    (imgs.length ? '<div class="notice">图片文件请放进 <code>articles/img/</code>，' +
                        '并在正文里把 <code>img://&lt;id&gt;</code> 换成 <code>articles/img/&lt;id&gt;.&lt;ext&gt;</code>。</div>' : '');
                UI.dialog({
                    title: '打包完成',
                    body: wrap,
                    width: '660px',
                    actions: [{ label: '知道了', value: true, primary: true }]
                });
            }

            q('[data-role="publish"]').addEventListener('click', function () {
                var locals = A.state.local;
                var deletions = (A.state.deleted || []).slice();
                if (!locals.length && !deletions.length) {
                    UI.toast('本地既没有文章，也没有待同步的删除', 'err', 3000);
                    return;
                }
                var drafts = locals.filter(function (a) { return a.status !== 'published'; }).length;
                if (drafts) {
                    UI.confirm('有 ' + drafts + ' 篇草稿不会上线',
                        '公开站点只展示「已发布」的文章。当前已发布 ' + (locals.length - drafts) +
                        ' 篇、草稿 ' + drafts + ' 篇；草稿会被打进发布包，但落地时跳过，站点上看不到。' +
                        '建议先回「文章」视图把要公开的文章标记为「已发布」，再回来打包。',
                        '仍要打包').then(function (yes) { if (yes) buildPack(); });
                    return;
                }
                buildPack();
            });

            q('[data-role="export"]').addEventListener('click', function () {
                var locals = A.state.local;
                var list = locals.length ? locals : A.state.articles;
                Store.download('articles.json', JSON.stringify(Store.buildRepoIndex(list, true), null, 2));
                UI.toast('已导出 articles.json（' + list.length + ' 篇）', 'ok', 3000);
            });

            q('[data-role="images"]').addEventListener('click', function () {
                var n = A.state.images.length;
                if (!n) { UI.toast('还没有本地图片', 'err'); return; }
                Store.exportImages().then(function () {
                    UI.toast('已开始下载 ' + n + ' 张图片', 'ok', 3000);
                });
            });

            /* ------------------------------------------------------ 导入 */

            q('[data-role="import"]').addEventListener('click', function () { importFile.click(); });
            importFile.addEventListener('change', function () {
                var files = Array.prototype.slice.call(importFile.files || []);
                importFile.value = '';
                if (!files.length) return;
                var ok = 0, bad = 0;
                files.reduce(function (p, f) {
                    return p.then(function () {
                        return f.text().then(function (txt) {
                            var data = JSON.parse(txt);
                            var items = data && data.format === 'wuji-blog-publish' ? (data.articles || []) : data;
                            return Store.importJSON(items).then(function (l) { ok += l.length; });
                        }).catch(function () { bad++; });
                    });
                }, Promise.resolve()).then(function () {
                    return ctx.refresh();
                }).then(function () {
                    UI.toast('导入完成：' + ok + ' 篇' + (bad ? '，' + bad + ' 个文件解析失败' : ''), bad ? 'err' : 'ok', 3200);
                });
            });

            /* ------------------------------------------------------ 清空 */

            q('[data-role="wipe"]').addEventListener('click', function () {
                UI.confirm('清空本地数据', '会删除本浏览器里保存的全部本地文章与图片，无法撤销。仓库里的文章不受影响。', '确认清空')
                    .then(function (yes) {
                        if (!yes) return;
                        return Store.wipe().then(function () { return ctx.refresh(); }).then(function () {
                            UI.toast('本地数据已清空', 'ok');
                        });
                    });
            });

            /* -------------------------------------------------- 命令复制 */

            root.addEventListener('click', function (e) {
                var btn = e.target.closest('.copy-cmd');
                if (!btn) return;
                var cmd = btn.parentNode.querySelector('code[data-copy]');
                if (!cmd) return;
                A.copyText(cmd.textContent, '已复制命令');
            });
        }
    });
})(window);
