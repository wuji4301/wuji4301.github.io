/* ==========================================================================
   无极博客 · 后台视图：设置（admin/js/settings.js）
   —— 外观 / 存储概览 / 运行环境 / 数据维护
   ========================================================================== */
(function (global) {
    'use strict';

    var A = global.WJAdmin;
    var Store = A.Store;
    var UI = A.UI;
    var esc = A.esc;

    function savedTheme() {
        try { return localStorage.getItem('wj-theme') || 'system'; } catch (e) { return 'system'; }
    }

    function applyTheme(mode) {
        try {
            if (mode === 'system') localStorage.removeItem('wj-theme');
            else localStorage.setItem('wj-theme', mode);
        } catch (e) { void e; }
        var dark = mode === 'system'
            ? global.matchMedia('(prefers-color-scheme: dark)').matches
            : mode === 'dark';
        var t = dark ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', t);
        var btn = document.getElementById('themeToggle');
        if (btn) btn.textContent = t === 'dark' ? '\u263E' : '\u2600\uFE0E';
    }

    function row(k, v) {
        return '<li class="health-item"><span class="t">' + esc(k) + '</span><span class="v">' + v + '</span></li>';
    }

    A.register('settings', {
        title: '设置',
        sub: '外观、存储与数据维护',
        mount: function (root, ctx) {
            var st = ctx.state;
            var mode = savedTheme();
            var embedded = (global.WJ_ARTICLES && (Array.isArray(global.WJ_ARTICLES)
                ? global.WJ_ARTICLES.length
                : (global.WJ_ARTICLES.articles || []).length)) || 0;

            function themeBtn(value, label) {
                return '<button class="seg-btn' + (mode === value ? ' active' : '') + '" data-theme-mode="' + value + '" type="button">' +
                    esc(label) + '</button>';
            }

            root.innerHTML =
                '<div class="admin-split">' +
                '<section class="admin-section">' +
                '<header><div><h2>外观</h2><div class="sub">主题与显示偏好，保存在本机浏览器。</div></div></header>' +
                '<div class="body">' +
                '<div class="field"><label>主题</label>' +
                '<div class="seg" data-role="theme">' +
                themeBtn('system', '跟随系统') + themeBtn('light', '浅色') + themeBtn('dark', '深色') +
                '</div></div>' +
                '<p class="admin-hint">选择「跟随系统」后，系统切换深浅色时页面会自动同步。</p>' +
                '</div>' +
                '</section>' +

                '<section class="admin-section">' +
                '<header><div><h2>存储概览</h2><div class="sub">当前浏览器 IndexedDB 里的本地数据。</div></div>' +
                '<div class="admin-actions"><button class="btn btn-ghost btn-sm" data-role="refresh" type="button">刷新数据</button></div></header>' +
                '<div class="body"><ul class="health-list">' +
                row('本地文章', st.local.length + ' 篇') +
                row('已发布 / 草稿', st.local.filter(function (a) { return a.status === 'published'; }).length +
                    ' / ' + st.local.filter(function (a) { return a.status !== 'published'; }).length) +
                row('本地图片', st.images.length + ' 张') +
                row('图片占用', UI.fmtBytes(st.imageBytes)) +
                row('线上文章', st.repoCount + ' 篇') +
                row('本地覆盖线上', st.overrides + ' 篇') +
                row('待同步删除', (st.deleted || []).length + ' 篇') +
                '</ul></div>' +
                '</section>' +
                '</div>' +

                '<section class="admin-section">' +
                '<header><div><h2>运行环境</h2><div class="sub">用于排查「为什么读不到文章」之类的问题。</div></div></header>' +
                '<div class="body"><ul class="health-list">' +
                row('打开方式', Store.isFileProtocol() ? '<code>file://</code>（读取嵌入式数据）' : '<code>' + esc(location.protocol) + '</code>（优先 fetch）') +
                row('资源基路径', '<code>' + esc(Store.basePrefix() || './') + '</code>') +
                row('嵌入式文章', embedded + ' 篇（articles-data.js）') +
                row('IndexedDB', global.indexedDB ? '可用' : '不可用（浏览器不支持）') +
                '</ul></div>' +
                '</section>' +

                '<section class="admin-section">' +
                '<header><div><h2>数据维护</h2><div class="sub">危险操作，请谨慎执行。</div></div></header>' +
                '<div class="body">' +
                '<div class="danger-zone">' +
                '<div class="grow"><div class="t">清空本地数据</div>' +
                '<div class="d">删除本浏览器里保存的全部本地文章、图片与元信息，无法撤销。待同步的删除标记也会一并清掉（被删的线上文章会重新出现）；已经落地到仓库的改动不受影响。</div></div>' +
                '<button class="btn btn-danger" data-role="wipe" type="button">清空</button>' +
                '</div>' +
                '</div>' +
                '</section>' +

                '<div class="notice"><div>' +
                '隔离说明：<code>admin/</code> 与 <code>tools/</code> 不在任何公开页面的导航里，' +
                '部署工具只拷贝白名单文件；线上并不存在这两个目录，因此无需把它当成安全措施。' +
                '</div></div>';

            var themeWrap = root.querySelector('[data-role="theme"]');
            themeWrap.addEventListener('click', function (e) {
                var btn = e.target.closest('[data-theme-mode]');
                if (!btn) return;
                mode = btn.getAttribute('data-theme-mode');
                applyTheme(mode);
                Array.prototype.forEach.call(themeWrap.querySelectorAll('.seg-btn'), function (b) {
                    b.classList.toggle('active', b === btn);
                });
                UI.toast('已切换主题', 'ok');
            });

            root.querySelector('[data-role="refresh"]').addEventListener('click', function () {
                ctx.refresh({ toast: '数据已刷新' });
            });

            root.querySelector('[data-role="wipe"]').addEventListener('click', function () {
                UI.confirm('清空本地数据', '会删除本浏览器里保存的全部本地文章与图片，无法撤销。仓库里的文章不受影响。', '确认清空')
                    .then(function (yes) {
                        if (!yes) return;
                        return Store.wipe().then(function () { return ctx.refresh(); }).then(function () {
                            UI.toast('本地数据已清空', 'ok');
                        });
                    });
            });
        }
    });
})(window);
