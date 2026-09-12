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
    var LW = global.WJLocalWrite;

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
        sub: '写入本地文件夹、打包与部署校验',
        mount: function (root, ctx) {
            var st = ctx.state;
            if (!st.loaded) {
                root.innerHTML = '<div class="admin-loading">正在读取本地数据…</div>';
                return;
            }

            var local = st.local;
            var published = local.filter(function (a) { return a.status === 'published'; }).length;
            var deleted = st.deleted || [];
            var canWrite = !!(LW && LW.isSupported());

            root.innerHTML =
                '<section class="admin-section">' +
                '<header><div><h2>写入本地项目文件夹</h2>' +
                '<div class="sub">一次点击把文章、清单与嵌入式数据写进你自己 clone 的目录，提交仍然由你来做。</div></div>' +
                '<div class="admin-actions">' +
                '<span class="badge ' + (canWrite ? 'badge-repo' : 'badge-draft') + '" data-role="lwBadge">' +
                (canWrite ? '检测中' : '不可用') + '</span></div></header>' +
                '<div class="body">' +
                '<div class="notice" data-role="lwState"></div>' +
                '<div class="admin-actions" style="margin:16px 0">' +
                '<button class="btn btn-primary" data-role="lwGo" type="button">一键写入项目文件夹</button>' +
                '<button class="btn btn-ghost" data-role="lwPreview" type="button">预览改动</button>' +
                '<button class="btn btn-ghost" data-role="lwPick" type="button">选择 / 更换文件夹</button>' +
                '</div>' +
                '<div class="cmd-list" data-role="lwLog" hidden></div>' +
                '<div class="notice" style="margin-top:16px"><div>' +
                '第一次点「选择 / 更换文件夹」授权项目根目录（含 <code>admin/</code>、<code>articles/</code>、<code>index.html</code> 的那一层），' +
                '之后只要点一下就会写 <code>articles/&lt;id&gt;.json</code>、<code>articles/index.json</code> 与 <code>articles-data.js</code>；' +
                '正文和封面里的 <code>img://&lt;id&gt;</code> 会自动换成 <code>articles/img/…</code>，图片一并写入。' +
                '写完之后给你一条 <code>git</code> 命令，推不推、什么时候推都由你决定。' +
                '草稿不会落盘，没动过的文章原样保留。' +
                '</div></div>' +
                '</div>' +
                '</section>' +

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
                        '点上面的「一键写入项目文件夹」会把这些 id 一起清掉；不想从浏览器动手也可以用这条命令：',
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

            /* -------------------------------------------- 写入本地文件夹 */

            var lwLog = q('[data-role="lwLog"]');
            var lwState = q('[data-role="lwState"]');
            var lwBadge = q('[data-role="lwBadge"]');
            var lwBtn = q('[data-role="lwGo"]');
            var folder = null;   // WJLocalWrite.folderState() 的快照

            function logLine(text) {
                lwLog.hidden = false;
                var line = document.createElement('div');
                line.className = 'cmd';
                line.innerHTML = '<div class="grow"><div class="d">' + esc(text) + '</div></div>';
                lwLog.appendChild(line);
            }

            // 预览与写入都用同一份纯函数计划，避免「预览说一套、落盘做另一套」
            function currentPlan() {
                return LW.buildPlan({
                    articles: A.state.local,
                    deletions: (A.state.deleted || []).slice(),
                    existing: A.state.articles || []
                });
            }

            function paintFolder() {
                if (!LW) {
                    lwBadge.className = 'badge badge-draft';
                    lwBadge.textContent = '不可用';
                    lwState.innerHTML = '<div>本地写入模块未加载。</div>';
                    return Promise.resolve();
                }
                return LW.folderState().then(function (info) {
                    folder = info;
                    if (!info.supported) {
                        lwBadge.className = 'badge badge-draft';
                        lwBadge.textContent = '不可用';
                        lwState.innerHTML = '<div>' + esc(LW.UNSUPPORTED) + '</div>';
                        return;
                    }
                    lwBadge.className = 'badge ' + (info.granted ? 'badge-repo' : 'badge-draft');
                    lwBadge.textContent = info.granted ? '已授权' : (info.saved ? '待重新授权' : '未选文件夹');
                    lwState.innerHTML = '<div>' + (info.saved
                        ? '项目文件夹：<code>' + esc(info.name) + '</code>' +
                          (info.granted ? '' : '；浏览器重启后写入权限会过期，点「一键写入」时会再问一次')
                        : '还没有选择项目文件夹：点「选择 / 更换文件夹」授权一次，之后就固定用它。') +
                        (deleted.length ? '；待同步删除 <b>' + deleted.length + '</b> 篇' : '') + '</div>';
                }).catch(function (err) {
                    lwState.innerHTML = '<div>读取文件夹授权状态失败：' + esc(err.message) + '</div>';
                });
            }

            function pickFolder() {
                return LW.pickDirectory().then(function (h) {
                    UI.toast('已授权文件夹：' + ((h && h.name) || ''), 'ok', 3600);
                    return paintFolder();
                }).catch(function (err) {
                    if (err && err.name === 'AbortError') return null;   // 用户自己取消，不是错误
                    UI.toast(err.message, 'err', 6000);
                });
            }

            q('[data-role="lwPick"]').addEventListener('click', function () {
                if (!LW || !LW.isSupported()) { UI.toast(LW ? LW.UNSUPPORTED : '本地写入模块未加载', 'err', 6000); return; }
                pickFolder();
            });

            q('[data-role="lwPreview"]').addEventListener('click', function () {
                if (!LW) { UI.toast('本地写入模块未加载', 'err'); return; }
                var plan = currentPlan();
                var files = plan.publishable.map(function (a) { return 'articles/' + a.id + '.json'; })
                    .concat(['articles/index.json', 'articles-data.js']);
                var body = '<div class="export-grid">' +
                    '<ul class="health-list">' +
                    '<li class="health-item"><span class="t">写入 / 更新</span><span class="v">' + plan.publishable.length + ' 篇</span></li>' +
                    '<li class="health-item"><span class="t">从清单移除（删除）</span><span class="v">' + plan.removed.length + ' 篇</span></li>' +
                    '<li class="health-item"><span class="t">跳过草稿</span><span class="v">' + plan.drafts + ' 篇</span></li>' +
                    '<li class="health-item"><span class="t">写入后的清单</span><span class="v">' + plan.indexEntries.length + ' 篇</span></li>' +
                    '</ul>' +
                    '<div class="notice"><div>本次会写入：<br /><code>' + esc(files.join('</code> <code>')) + '</code>' +
                    (plan.removed.length ? '<br />会删除：<code>' +
                        esc(plan.removed.map(function (r) { return 'articles/' + r.file; }).join('</code> <code>')) + '</code>' : '') +
                    '</div></div>' +
                    (plan.drafts ? '<div class="notice"><div>草稿不会进入清单，也不会进 <code>articles-data.js</code>：' +
                        '先回「文章」视图把它们标记为「已发布」。' + '</div></div>' : '') +
                    '<div class="notice"><div>写入只改磁盘上的文件，不会提交也不会推送——' +
                        '你可以在项目里用 <code>git diff</code> 先看一眼再决定要不要提交。</div></div>' +
                    '</div>';
                UI.dialog({
                    title: '将写入的内容',
                    body: body,
                    width: '640px',
                    actions: [{ label: '知道了', value: true, primary: true }]
                });
            });

            function afterWrite(out) {
                var url = (out.siteUrl || '') + '/articles.html';
                UI.dialog({
                    title: '已写入项目文件夹',
                    body: '<div class="export-grid">' +
                        '<div class="notice"><div>已写入 <code>' + esc(out.folder) + '</code>：文章 ' + out.published +
                        ' 篇，清单共 ' + out.indexCount + ' 篇' +
                        (out.removed.length ? '，删除 ' + out.removed.length + ' 篇' : '') +
                        (out.images ? '，图片 ' + out.images + ' 张' : '') + '。' +
                        '改动还在你的工作区里，没有提交。</div></div>' +
                        (out.missingImages.length ? '<div class="notice"><div>有 ' + out.missingImages.length +
                            ' 张图片在本地找不到（<code>' + esc(out.missingImages.join(', ')) + '</code>），' +
                            '正文或封面里保留了 <code>img://</code>，需要重新上传图片后再写一次。</div></div>' : '') +
                        '<div class="cmd"><div class="grow"><div class="t">下一步：看过改动后提交</div>' +
                        '<div class="d">先在项目里 <code>git status</code> / <code>git diff</code> 确认，再执行：</div>' +
                        '<code>' + esc(out.command) + '</code></div></div>' +
                        (url && out.siteUrl ? '<div class="cmd"><div class="grow"><div class="t">线上文章列表</div>' +
                            '<div class="d"><a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) +
                            '</a>（推送后 GitHub Pages 重建，稍候刷新）</div></div></div>' : '') +
                        '</div>',
                    width: '660px',
                    actions: [{ label: '知道了', value: true, primary: true }]
                }).then(function () {
                    return Store.clearDeleted();
                }).then(function () { return ctx.refresh(); });
            }

            function runWrite() {
                lwLog.innerHTML = '';
                lwLog.hidden = false;
                lwBtn.disabled = true;
                var t0 = Date.now();
                logLine('开始写入项目文件夹…');
                LW.writeToFolder({
                    articles: A.state.local,
                    deletions: (A.state.deleted || []).slice(),
                    interactive: true,
                    onProgress: logLine
                }).then(function (out) {
                    logLine('完成，用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒');
                    afterWrite(out);
                }).catch(function (err) {
                    logLine('失败：' + err.message);
                    UI.toast(err.message, 'err', 7000);
                }).then(function () {
                    lwBtn.disabled = false;
                    return paintFolder();
                });
            }

            function askThenWrite() {
                var drafts = currentPlan().drafts;
                if (!drafts) { runWrite(); return; }
                UI.confirm('有 ' + drafts + ' 篇草稿不会写入',
                    '写入只落「已发布」的文章：清单与 articles-data.js 都会跳过草稿，站点上不会出现它们。' +
                    '要现在继续写入其余文章吗？',
                    '继续写入').then(function (yes) { if (yes) runWrite(); });
            }

            lwBtn.addEventListener('click', function () {
                if (!LW) { UI.toast('本地写入模块未加载', 'err'); return; }
                if (!LW.isSupported()) { UI.toast(LW.UNSUPPORTED, 'err', 6500); return; }
                if (folder) {
                    if (folder.saved) { askThenWrite(); return; }
                    UI.toast('第一次用：请选中项目根目录（含 admin/、articles/、index.html 的那一层）', 'ok', 5000);
                    pickFolder().then(function () { if (folder && folder.saved) askThenWrite(); });
                    return;
                }
                // 状态还没读出来（极少见）：先读完再决定，仍在同一次点击的激活窗口内
                paintFolder().then(function () {
                    if (folder && folder.saved) askThenWrite();
                    else if (folder && folder.supported) {
                        UI.toast('第一次用：请选中项目根目录（含 admin/、articles/、index.html 的那一层）', 'ok', 5000);
                        pickFolder().then(function () { if (folder && folder.saved) askThenWrite(); });
                    }
                });
            });

            paintFolder();

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
                        '并在正文和封面里把 <code>img://&lt;id&gt;</code> 换成 <code>articles/img/&lt;id&gt;.&lt;ext&gt;</code>。</div>' : '');
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
