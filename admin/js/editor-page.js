/* ==========================================================================
   无极博客 · 编辑器页面逻辑（admin/js/editor-page.js）
   —— 由 admin/editor.html 内联脚本抽出，便于单独维护与复用
   ========================================================================== */
(function (global) {
    'use strict';

    var Store = global.WJStore;
    var UI = global.WJUI;
    var MD = global.WJMarkdown;

    global.WJSite.initCommon();

    var host = document.getElementById('editorHost');
    var deleteBtn = document.getElementById('deleteBtn');
    var originNotice = document.getElementById('originNotice');
    var titleEl = document.getElementById('editorTitle');
    var statusEl = document.getElementById('editorStatus');
    var editor = null;
    var fromRepo = false;

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function setTitle(title) {
        if (titleEl) titleEl.textContent = title || '新文章';
        document.title = (title || '新文章') + ' · 编辑器 · 无极博客';
    }

    function setStatus(text) {
        if (statusEl) statusEl.textContent = text;
    }

    function mount(article, isRepo) {
        fromRepo = !!isRepo;
        if (editor) editor.destroy();
        editor = new global.WJEditor(host, {
            article: article,
            onSave: function (saved) {
                // 标题跟随文章，便于在多个标签页之间区分
                setTitle(saved.title);
                setStatus('已保存 · ' + Store.fmtRelative(saved.updatedAt));
                deleteBtn.hidden = false;
                originNotice.hidden = !fromRepo;
                try {
                    history.replaceState(null, '', 'editor.html?id=' + encodeURIComponent(saved.id));
                } catch (e) { void e; }
            }
        });
        setTitle(article && article.id ? article.title : '新文章');
        setStatus(article && article.id ? '本地保存 · 不上传' : '新建 · 尚未保存');
        deleteBtn.hidden = !(article && article.id);
        originNotice.hidden = !fromRepo;
    }

    /* --------------------------------------------------------- 顶部操作 */

    document.getElementById('saveTopBtn').addEventListener('click', function () {
        editor.save().then(function () {
            UI.toast('已保存到本地', 'ok');
        }).catch(function () {
            /* 失败原因已在编辑器内提示 */
        });
    });

    document.getElementById('newBtn').addEventListener('click', function () {
        var go = function () {
            mount(Store.normalize({}), false);
            try { history.replaceState(null, '', 'editor.html'); } catch (e) { void e; }
            UI.toast('已新建空白文章', 'ok');
        };
        if (editor && editor.dirty) {
            UI.confirm('放弃未保存的修改？', '当前修改尚未保存，新建会丢失这些内容。', '放弃并新建')
                .then(function (yes) { if (yes) go(); });
        } else go();
    });

    function leaveTo(url) {
        if (editor && editor.dirty) {
            editor.save().catch(function () { /* 忽略保存失败，仍然离开 */ })
                .then(function () { location.href = url; });
        } else {
            location.href = url;
        }
    }

    document.getElementById('listBtn').addEventListener('click', function () { leaveTo('index.html'); });
    document.getElementById('selftestBtn').addEventListener('click', function () { leaveTo('selftest.html'); });

    document.getElementById('deleteBtn').addEventListener('click', function () {
        var id = editor.article.id;
        if (!id) return;
        UI.confirm('删除文章', '删除后无法恢复；仓库里的同名文章会在下一次「打包发布 → 本地落地」时一并移除。', '确认删除').then(function (yes) {
            if (!yes) return;
            Store.deleteArticle(id).then(function () {
                UI.toast('已删除', 'ok');
                editor.destroy();
                location.href = 'index.html';
            });
        });
    });

    /* ------------------------------------------------------------- 预览 */

    document.getElementById('previewBtn').addEventListener('click', function () {
        var md = editor.getMarkdown();
        var wrap = document.createElement('div');
        wrap.className = 'prose preview-body';
        wrap.style.maxHeight = '62vh';
        wrap.style.overflowY = 'auto';
        wrap.innerHTML = MD.render(md);
        global.WJSite.initCodeCopy(wrap);
        global.WJMath.renderIn(wrap);
        UI.dialog({
            title: '预览（与发布后一致）',
            body: wrap,
            width: '820px',
            actions: [
                { label: '关闭', value: false },
                { label: '保存', primary: true, onClick: function () { editor.save(); return true; } }
            ]
        });
    });

    /* ------------------------------------------------------------- 导出 */

    document.getElementById('exportBtn').addEventListener('click', function () {
        editor.save().then(function (a) {
            var wrap = document.createElement('div');
            wrap.className = 'export-grid';
            wrap.innerHTML =
                '<div class="notice">推荐回到<a href="index.html">管理系统</a>点「打包发布」：' +
                '它会把所有本地文章与图片汇总成一个发布包，再用 ' +
                '<code>node tools/publish.mjs &lt;发布包&gt;</code> 一次性落地。' +
                '下面是单篇导出的备用方式。</div>' +
                '<div class="export-row"><div class="grow"><div class="t">' + esc(a.title) + '</div>' +
                '<div class="d">id <code>' + esc(a.id) + '</code> · 更新 ' + Store.fmtDate(a.updatedAt, true) + '</div></div>' +
                '<button class="btn btn-primary btn-sm" id="dlOne" type="button">下载 .json</button></div>' +
                '<div class="export-row"><div class="grow"><div class="t">导出 PDF</div>' +
                '<div class="d">调起浏览器打印，把「目标」选成<strong>另存为 PDF</strong>；公式、代码、表格都是矢量文字，可选中可检索。</div></div>' +
                '<button class="btn btn-ghost btn-sm" id="dlPdf" type="button">导出 PDF</button></div>' +
                '<div class="export-row"><div class="grow"><div class="t">下载全部文章数据</div>' +
                '<div class="d">生成 <code>articles.json</code>（内联全部正文），放到仓库 <code>articles/</code> 目录。</div></div>' +
                '<button class="btn btn-ghost btn-sm" id="dlIndex" type="button">下载 articles.json</button></div>' +
                '<div class="export-row"><div class="grow"><div class="t">下载本地图片</div>' +
                '<div class="d">把文件放进 <code>articles/img/</code>，并把正文里的 <code>img://id</code> 改成对应相对路径。</div></div>' +
                '<button class="btn btn-ghost btn-sm" id="dlImgs" type="button">下载图片</button></div>';
            UI.dialog({ title: '导出', body: wrap, width: '660px', actions: [{ label: '关闭', value: false }] });

            wrap.querySelector('#dlOne').addEventListener('click', function () {
                Store.exportArticleFile(a);
                UI.toast('已下载 ' + (a.slug || a.id) + '.json', 'ok');
            });

            wrap.querySelector('#dlPdf').addEventListener('click', function () {
                if (!global.WJExportPDF) { UI.toast('PDF 组件未加载', 'err'); return; }
                global.WJExportPDF.print({
                    site: '无极',
                    title: a.title,
                    summary: a.summary,
                    cover: a.cover,
                    tags: a.tags,
                    meta: [Store.fmtDate(a.updatedAt, true), Store.countWords(a.body) + ' 字'],
                    bodyHTML: a.format === 'html' ? a.body : MD.render(a.body || ''),
                    assetURL: Store.assetURL,
                    imageResolver: Store.imageURL,
                    docTitle: a.title
                }).then(function (ok) {
                    if (!ok) UI.toast('当前浏览器不支持打印，请用 Ctrl/⌘ + P 手动导出', 'err', 3200);
                });
            });

            wrap.querySelector('#dlIndex').addEventListener('click', function () {
                Store.listAll().then(function (res) {
                    var mine = res.articles.filter(function (x) { return x.source === 'local'; });
                    var list = mine.length ? mine : res.articles;
                    Store.download('articles.json', JSON.stringify(Store.buildRepoIndex(list, true), null, 2));
                    UI.toast('已下载 articles.json（' + list.length + ' 篇）', 'ok', 3000);
                });
            });

            wrap.querySelector('#dlImgs').addEventListener('click', function () {
                Store.listImages().then(function (imgs) {
                    if (!imgs.length) { UI.toast('本地还没有图片', 'err'); return; }
                    Store.exportImages();
                    UI.toast('开始下载 ' + imgs.length + ' 张图片', 'ok');
                });
            });
        });
    });

    /* ------------------------------------------------------------- 启动 */

    var m = /[?&]id=([^&]+)/.exec(location.search);
    var id = m ? decodeURIComponent(m[1]) : '';

    if (id) {
        Store.getArticle(id).then(function (a) {
            if (!a) {
                UI.toast('没有找到 id 为 ' + id + ' 的文章，已新建空白文章', 'err', 3600);
                mount(Store.normalize({}), false);
                return;
            }
            mount(a, a.source === 'repo');
        }).catch(function (err) {
            UI.toast('加载失败：' + err.message, 'err', 3600);
            mount(Store.normalize({}), false);
        });
    } else {
        mount(Store.normalize({}), false);
    }

    // 预加载 KaTeX，让公式弹窗立即有预览
    global.WJMath.load().catch(function () { /* 离线时降级为源码显示 */ });
})(window);
