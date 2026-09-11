/* ==========================================================================
   无极博客 · Markdown 渲染器
   --------------------------------------------------------------------------
   从零实现的轻量渲染器，覆盖博客常用语法：
     标题 / 段落 / 强调 / 行内代码 / 围栏代码(带轻量高亮) / 引用 / 有序无序列表
     / 任务列表 / 表格 / 分割线 / 链接 / 图片 / 脚注 / 行内与块级公式
   · 以字符串扫描实现（非正则整体替换），嵌套与转义行为可预测
   · 默认转义全部 HTML，链接做协议白名单，防止 XSS
   · 公式不在此处排版：渲染成 <span class="math-tex" data-tex="..."> 占位，
     由 katex-host.js 统一用 KaTeX 排版（保证降级时不至于看到乱码源码）
   ========================================================================== */
(function (global) {
    'use strict';

    var MATH_INLINE_CLASS = 'math-inline';
    var MATH_BLOCK_CLASS = 'math-block';

    /* -------------------------------------------------------------- 转义 */

    function esc(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escAttr(s) { return esc(s); }

    /** 只保留安全协议；img:// 是本站本地图片引用 */
    function safeUrl(url, opts) {
        var u = String(url || '').trim();
        if (!u) return '';
        opts = opts || {};
        if (u.indexOf('img://') === 0) return u;
        if (/^(https?:|mailto:|tel:|\/|\.\/|\.\.\/|#)/i.test(u)) return u;
        if (opts.allowData && /^data:image\//i.test(u)) return u;
        if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return '';   // 其它协议一律丢弃（javascript: 等）
        return u;                                        // 相对路径
    }

    /* ------------------------------------------------------- 行内扫描器 */

    var RE_AUTOLINK = /^<((?:https?:\/\/|mailto:)[^\s>]+)>/;
    var RE_CODE = /^`+/;
    var RE_IMG_REF = /^!\[([^\]]*)\]\[([^\]]*)\]/;
    var RE_LINK_REF = /^\[([^\]]*)\]\[([^\]]*)\]/;
    var RE_FOOTNOTE_REF = /^\[\^([^\]]+)\]/;
    var RE_IMG = /^!\[([^\]]*)\]\(([^)\s]*(?:\s+"[^"]*")?)\)/;
    var RE_LINK = /^\[([^\]]*)\]\(([^)\s]*(?:\s+"[^"]*")?)\)/;
    var RE_STRONG = /^(\*\*|__)(?=\S)([\s\S]*?\S)\1/;
    var RE_EM = /^(\*|_)(?=\S)([\s\S]*?\S)\1/;
    var RE_DEL = /^~~(?=\S)([\s\S]*?\S)~~/;
    var RE_ESCAPE = /^\\([\\`*_{}\[\]()#+\-.!>~|$])/;

    function findNext(text, patterns) {
        var best = -1, kind = null;
        for (var i = 0; i < patterns.length; i++) {
            var idx = text.indexOf(patterns[i][0]);
            while (idx !== -1) {
                // '$' 需要额外校验：两侧不能是数字（避免 $5 与 5$ 被当成公式）
                if (patterns[i][0] === '$' && !validDollar(text, idx)) {
                    idx = text.indexOf('$', idx + 1);
                    continue;
                }
                if (best === -1 || idx < best) { best = idx; kind = patterns[i][1]; }
                break;
            }
        }
        return { index: best, kind: kind };
    }

    /** 判断 $ 或 $$ 是否为合法的公式定界符 */
    function validDollar(text, i) {
        var isDouble = text.charAt(i + 1) === '$';
        var after = text.charAt(i + (isDouble ? 2 : 1));
        if (!after || /\s/.test(after)) return false;                 // 后面不能紧跟空白
        var before = i > 0 ? text.charAt(i - 1) : '';
        if (before && /\d/.test(before)) return false;               // 前面是数字 → 货币
        return true;
    }

    /**
     * 行内渲染。
     * ctx: { footnotes: {label: index}, footnoteOrder: [] }
     */
    function renderInline(text, ctx) {
        ctx = ctx || {};
        var out = '';
        var s = String(text == null ? '' : text);
        var guard = 0;

        while (s.length && guard++ < 20000) {
            // 注意顺序：'**' 必须先于 '*'，否则粗体只会被识别成斜体；'$' 覆盖 '$$'
            var hit = findNext(s, [['`', 'code'], ['![', 'img'], ['[', 'link'], ['$', 'math'],
                ['**', 'strong'], ['__', 'strong'], ['*', 'em'], ['_', 'em'],
                ['~~', 'del'], ['\\', 'esc'], ['<', 'auto']]);
            if (hit.index === -1) { out += esc(s); break; }
            if (hit.index > 0) { out += esc(s.slice(0, hit.index)); s = s.slice(hit.index); }

            var m, rest = s;

            // --- 行内代码 ---
            if (hit.kind === 'code') {
                m = RE_CODE.exec(s);
                var fence = m[0], close = s.indexOf(fence, fence.length);
                if (close === -1) { out += esc(fence); s = s.slice(fence.length); continue; }
                var raw = s.slice(fence.length, close);
                // 首尾各一个空格是 Markdown 的转义约定
                if (/^ .* $/.test(raw) && raw.trim()) raw = raw.slice(1, -1);
                out += '<code>' + esc(raw) + '</code>';
                s = s.slice(close + fence.length);
                continue;
            }

            // --- 公式 ---
            if (hit.kind === 'math') {
                var isDouble = s.charAt(1) === '$';
                var delim = isDouble ? '$$' : '$';
                var end = -1;
                for (var q = delim.length; q < s.length; q++) {
                    if (s.charAt(q) === '\\') { q++; continue; }
                    if (s.startsWith(delim, q) && !/\s/.test(s.charAt(q - 1))) { end = q; break; }
                }
                if (end === -1) { out += esc(delim); s = s.slice(delim.length); continue; }
                var tex = s.slice(delim.length, end);
                var cls = isDouble ? MATH_BLOCK_CLASS : MATH_INLINE_CLASS;
                // contenteditable="false"：公式是原子节点，编辑器里只能整块选中或点开弹窗编辑。
                // 少了它，光标能进到公式内部改字，而回读 Markdown 只认 data-tex，
                // 用户敲进去的字符会在保存时被静默丢弃（块级公式一直带这个标记，行内漏了）。
                out += '<span class="math-tex ' + cls + '" data-tex="' + escAttr(tex) + '" contenteditable="false">' +
                    esc(delim + tex + delim) + '</span>';
                s = s.slice(end + delim.length);
                continue;
            }

            // --- 图片 ---
            if (hit.kind === 'img') {
                m = RE_IMG.exec(s) || null;
                var label = '', url = '', title = '';
                if (m) { label = m[1]; url = stripTitle(m[2]).url; title = stripTitle(m[2]).title; }
                else {
                    var ri = RE_IMG_REF.exec(s);
                    if (ri && ctx.refs) {
                        var r = ctx.refs[(ri[2] || ri[1]).toLowerCase()];
                        if (r) { label = ri[1]; url = r.url; title = r.title; m = ri; }
                    }
                }
                if (!m) { out += esc('!'); s = s.slice(1); continue; }
                var su = safeUrl(url, { allowData: true });
                out += '<img src="' + escAttr(su || url) + '" alt="' + escAttr(label) + '"' +
                    (title ? ' title="' + escAttr(title) + '"' : '') + ' loading="lazy" decoding="async">';
                s = s.slice(m[0].length);
                continue;
            }

            // --- 链接 / 脚注 ---
            if (hit.kind === 'link') {
                if (RE_FOOTNOTE_REF.test(s)) {
                    var fn = RE_FOOTNOTE_REF.exec(s);
                    var key = fn[1];
                    if (!ctx.footnotes) { ctx.footnotes = {}; ctx.footnoteOrder = []; }
                    if (ctx.footnotes[key] == null) { ctx.footnoteOrder.push(key); ctx.footnotes[key] = ctx.footnoteOrder.length; }
                    var num = ctx.footnotes[key];
                    out += '<sup class="fn-ref" id="fnref-' + escAttr(key) + '"><a href="#fn-' + escAttr(key) + '">[' + num + ']</a></sup>';
                    s = s.slice(fn[0].length);
                    continue;
                }
                m = RE_LINK.exec(s) || null;
                var ltext = '', lurl = '', ltitle = '';
                if (m) { ltext = m[1]; var pt = stripTitle(m[2]); lurl = pt.url; ltitle = pt.title; }
                else {
                    var rl = RE_LINK_REF.exec(s);
                    if (rl && ctx.refs) {
                        var r2 = ctx.refs[(rl[2] || rl[1]).toLowerCase()];
                        if (r2) { ltext = rl[1]; lurl = r2.url; ltitle = r2.title; m = rl; }
                    }
                }
                if (!m) { out += esc('['); s = s.slice(1); continue; }
                var sl = safeUrl(lurl);
                if (!sl) { out += renderInline(ltext, ctx); s = s.slice(m[0].length); continue; }
                out += '<a href="' + escAttr(sl) + '"' + (ltitle ? ' title="' + escAttr(ltitle) + '"' : '') +
                    (/^https?:/i.test(sl) ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' +
                    renderInline(ltext, ctx) + '</a>';
                s = s.slice(m[0].length);
                continue;
            }

            // --- 强调 ---
            if (hit.kind === 'strong') {
                m = RE_STRONG.exec(s);
                if (!m) { out += esc(s.slice(0, 2)); s = s.slice(2); continue; }
                out += '<strong>' + renderInline(m[2], ctx) + '</strong>';
                s = s.slice(m[0].length);
                continue;
            }
            if (hit.kind === 'em') {
                m = RE_EM.exec(s);
                if (!m) { out += esc(s.charAt(0)); s = s.slice(1); continue; }
                out += '<em>' + renderInline(m[2], ctx) + '</em>';
                s = s.slice(m[0].length);
                continue;
            }
            if (hit.kind === 'del') {
                m = RE_DEL.exec(s);
                if (!m) { out += esc(s.slice(0, 2)); s = s.slice(2); continue; }
                out += '<del>' + renderInline(m[1], ctx) + '</del>';
                s = s.slice(m[0].length);
                continue;
            }

            // --- 转义 ---
            if (hit.kind === 'esc') {
                m = RE_ESCAPE.exec(s);
                if (!m) { out += esc(s.charAt(0)); s = s.slice(1); continue; }
                out += esc(m[1]);
                s = s.slice(m[0].length);
                continue;
            }

            // --- 自动链接 ---
            if (hit.kind === 'auto') {
                m = RE_AUTOLINK.exec(s);
                if (!m) { out += esc('<'); s = s.slice(1); continue; }
                var au = m[1];
                out += '<a href="' + escAttr(au) + '" target="_blank" rel="noopener noreferrer">' + esc(au) + '</a>';
                s = s.slice(m[0].length);
                continue;
            }

            out += esc(rest.charAt(0));
            s = rest.slice(1);
        }
        return out;
    }

    function stripTitle(s) {
        var m = /^(\S*)(?:\s+"([^"]*)")?$/.exec(String(s).trim());
        if (!m) return { url: String(s).trim(), title: '' };
        return { url: m[1], title: m[2] || '' };
    }

    /* ------------------------------------------------------------ 代码高亮 */

    var KEYWORDS = ('break case catch class const continue default delete do else export extends finally for function if import in instanceof let new of return ' +
        'static super switch this throw try typeof var void while with yield async await def elif except from global lambda nonlocal pass raise ' +
        'and or not is None True False as assert del with int float str bool list dict set tuple ' +
        'public private protected interface implements package struct enum fn mut impl pub use match enum ' +
        'select insert update delete where join group order by limit create table from null undefined true false ' +
        'echo cd ls grep sed awk printf read local then fi done esac').split(/\s+/);
    var KW_SET = {};
    KEYWORDS.forEach(function (k) { if (k) KW_SET[k] = 1; });

    // 只对确有把握的语言做高亮；其它语言（含未知/自定义）一律按纯文本输出，
    // 避免用 JS 的词法去"高亮"一门不认识的语法而把代码改得面目全非。
    var KNOWN = {};
    ('js javascript jsx mjs cjs ts typescript mts cts json jsonc ' +
     'py python pyw bash sh shell zsh console ' +
     'c cpp c++ cc h hpp cs java kt kotlin swift go rs rust ' +
     'html htm xml svg vue css scss less sql yaml yml toml ini conf r rb ruby perl php lua dart gradle makefile dockerfile diff patch').split(/\s+/)
        .forEach(function (k) { if (k) KNOWN[k] = 1; });

    /** 语言归一化：别名 → 词法家族；未知返回 '' */
    function langFamily(raw) {
        var l = String(raw || '').toLowerCase().trim();
        if (!l) return '';
        if (!KNOWN[l]) return '';
        if (/^(py|python|pyw)$/.test(l)) return 'hash';
        if (/^(bash|sh|shell|zsh|console|r|rb|ruby|perl|yaml|yml|toml|ini|conf|makefile|dockerfile)$/.test(l)) return 'hash';
        if (/^(html|htm|xml|svg|vue)$/.test(l)) return 'markup';
        if (/^css$/.test(l) || /^scss$/.test(l) || /^less$/.test(l)) return 'css';
        return 'c';   // 大括号家族 + 关键字
    }

    /**
     * 极简词法高亮：字符串 / 注释 / 数字（不做完整语法分析）。
     * 未知语言也能安全降级为纯文本，不会破坏代码可读性。
     */
    function highlight(code, lang) {
        var family = langFamily(lang);
        if (!family) return esc(code);
        var hashes = family === 'hash';
        var html = family === 'markup';
        var out = '';
        var i = 0, n = code.length;

        while (i < n) {
            var c = code.charAt(i), d = code.substr(i, 2);

            // 注释
            if (hashes && c === '#') {
                var he = code.indexOf('\n', i);
                if (he === -1) he = n;
                out += '<span class="tok-com">' + esc(code.slice(i, he)) + '</span>';
                i = he; continue;
            }
            if (d === '//') {
                var se = code.indexOf('\n', i);
                if (se === -1) se = n;
                out += '<span class="tok-com">' + esc(code.slice(i, se)) + '</span>';
                i = se; continue;
            }
            if (d === '/*') {
                var be = code.indexOf('*/', i + 2);
                be = be === -1 ? n : be + 2;
                out += '<span class="tok-com">' + esc(code.slice(i, be)) + '</span>';
                i = be; continue;
            }
            if (html && c === '<') {
                var ge = code.indexOf('>', i);
                ge = ge === -1 ? n : ge + 1;
                out += '<span class="tok-tag">' + esc(code.slice(i, ge)) + '</span>';
                i = ge; continue;
            }

            // 字符串
            if (c === '"' || c === "'" || c === '`') {
                var j = i + 1;
                while (j < n) {
                    if (code.charAt(j) === '\\') { j += 2; continue; }
                    if (code.charAt(j) === c) { j++; break; }
                    if (c !== '`' && code.charAt(j) === '\n') break;
                    j++;
                }
                if (j > n) j = n;
                out += '<span class="tok-str">' + esc(code.slice(i, j)) + '</span>';
                i = j; continue;
            }

            // 数字
            if (/[0-9]/.test(c) && !/[A-Za-z0-9_$]/.test(i > 0 ? code.charAt(i - 1) : '')) {
                var k = i;
                while (k < n && /[0-9a-fA-FxX._eE+\-]/.test(code.charAt(k))) {
                    // 避免把 1-2 里的减号吞进来
                    if (/[+\-]/.test(code.charAt(k)) && !/[eE]/.test(code.charAt(k - 1))) break;
                    k++;
                }
                out += '<span class="tok-num">' + esc(code.slice(i, k)) + '</span>';
                i = k; continue;
            }

            // 标识符 / 关键字
            if (/[A-Za-z_$]/.test(c)) {
                var w = i;
                while (w < n && /[A-Za-z0-9_$]/.test(code.charAt(w))) w++;
                var word = code.slice(i, w);
                if (KW_SET[word] && !/^[A-Z]/.test(word)) {
                    out += '<span class="tok-kw">' + esc(word) + '</span>';
                } else if (code.charAt(w) === '(') {
                    out += '<span class="tok-fn">' + esc(word) + '</span>';
                } else {
                    out += esc(word);
                }
                i = w; continue;
            }

            out += esc(c);
            i++;
        }
        return out;
    }

    /* -------------------------------------------------------------- 块解析 */

    var RE_HEADING = /^(#{1,6})\s+(.*?)(?:\s+#+)?$/;
    var RE_FENCE = /^(\s{0,3})(`{3,}|~{3,})\s*([^\s`]*)\s*$/;
    var RE_HR = /^\s{0,3}(?:([-*_])\s*){3,}$/;
    var RE_UL = /^(\s*)([-*+])\s+(.*)$/;
    var RE_OL = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
    var RE_QUOTE = /^\s{0,3}>\s?/;
    var RE_REF = /^\s{0,3}\[([^\]]+)\]:\s*(\S+)(?:\s+"([^"]*)")?\s*$/;
    var RE_FOOTNOTE_DEF = /^\s{0,3}\[\^([^\]]+)\]:\s*(.*)$/;
    var RE_TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

    function slugBase(text) {
        var s = plain(text).toLowerCase().replace(/[\s\u3000]+/g, '-')
            .replace(/[^\w\u3400-\u9fff\u3040-\u30ff-]+/g, '').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
        return s || 'section';
    }

    function plain(md) {
        return String(md).replace(/[`*_~$\\\[\]()!]/g, '').replace(/<[^>]*>/g, '').trim();
    }

    function render(md, options) {
        options = options || {};
        var lines = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n');
        var ctx = { refs: {}, footnotes: {}, footnoteOrder: [] };

        // 预扫描：链接引用定义与脚注定义（它们不产生可见块）
        var footDefs = {};
        var bodyLines = [];
        for (var i = 0; i < lines.length; i++) {
            var rm = RE_REF.exec(lines[i]);
            if (rm) { ctx.refs[rm[1].toLowerCase()] = { url: rm[2], title: rm[3] || '' }; continue; }
            var fm = RE_FOOTNOTE_DEF.exec(lines[i]);
            if (fm) { footDefs[fm[1]] = fm[2]; continue; }
            bodyLines.push(lines[i]);
        }

        var html = '';
        var usedSlugs = {};
        var toc = [];
        var i2 = 0;

        function uniqueSlug(t) {
            var base = slugBase(t), s = base, k = 2;
            while (usedSlugs[s]) { s = base + '-' + k; k++; }
            usedSlugs[s] = 1;
            return s;
        }

        while (i2 < bodyLines.length) {
            var line = bodyLines[i2];

            // 空行
            if (!line.trim()) { i2++; continue; }

            // 围栏代码
            var fence = RE_FENCE.exec(line);
            if (fence) {
                var marker = fence[2].charAt(0);
                var want = fence[2].length;
                var lang = fence[3] || '';
                var buf = [];
                i2++;
                while (i2 < bodyLines.length) {
                    var closeRe = new RegExp('^\\s{0,3}' + (marker === '`' ? '`' : '~') + '{' + want + ',}\\s*$');
                    if (closeRe.test(bodyLines[i2])) { i2++; break; }
                    buf.push(bodyLines[i2]); i2++;
                }
                var codeText = buf.join('\n');
                html += '<div class="code-block"' + (lang ? ' data-lang="' + escAttr(lang) + '"' : '') + '>' +
                    '<div class="code-head"><span class="code-lang">' + esc(lang || 'text') + '</span>' +
                    '<button type="button" class="code-copy" data-copy>复制</button></div>' +
                    '<pre><code class="lang-' + escAttr(lang || 'text') + '">' + highlight(codeText, lang) + '</code></pre></div>';
                continue;
            }

            // 分割线
            if (RE_HR.test(line) && line.replace(/\s/g, '').length >= 3) {
                html += '<hr>'; i2++; continue;
            }

            // 标题
            var hm = RE_HEADING.exec(line);
            if (hm) {
                var level = hm[1].length;
                var htext = hm[2].trim();
                var hid = uniqueSlug(htext);
                toc.push({ level: level, text: plain(htext), id: hid });
                html += '<h' + level + ' id="' + escAttr(hid) + '">' +
                    renderInline(htext, ctx) +
                    '<a class="h-anchor" href="#' + escAttr(hid) + '" aria-label="锚点">#</a>' +
                    '</h' + level + '>';
                i2++; continue;
            }

            // 引用
            if (RE_QUOTE.test(line)) {
                var qbuf = [];
                while (i2 < bodyLines.length && (RE_QUOTE.test(bodyLines[i2]) || (qbuf.length && bodyLines[i2].trim()))) {
                    qbuf.push(bodyLines[i2].replace(RE_QUOTE, ''));
                    i2++;
                }
                // render() 返回 {html, toc}，这里只要 html —— 漏取 .html 会把对象拼成 "[object Object]"
                html += '<blockquote>' + render(qbuf.join('\n'), options).html + '</blockquote>';
                continue;
            }

            // 表格
            if (line.indexOf('|') !== -1 && i2 + 1 < bodyLines.length && RE_TABLE_SEP.test(bodyLines[i2 + 1]) && bodyLines[i2 + 1].indexOf('-') !== -1) {
                var headCells = splitRow(line);
                var aligns = splitRow(bodyLines[i2 + 1]).map(function (c) {
                    var t = c.trim();
                    if (/^:-+:$/.test(t)) return 'center';
                    if (/^-+:$/.test(t)) return 'right';
                    return 'left';
                });
                i2 += 2;
                var rows = [];
                while (i2 < bodyLines.length && bodyLines[i2].trim() && bodyLines[i2].indexOf('|') !== -1) {
                    rows.push(splitRow(bodyLines[i2])); i2++;
                }
                var th = '<thead><tr>' + headCells.map(function (c, ci) {
                    return '<th style="text-align:' + (aligns[ci] || 'left') + '">' + renderInline(c.trim(), ctx) + '</th>';
                }).join('') + '</tr></thead>';
                var tb = '<tbody>' + rows.map(function (r) {
                    return '<tr>' + headCells.map(function (_, ci) {
                        return '<td style="text-align:' + (aligns[ci] || 'left') + '">' + renderInline((r[ci] || '').trim(), ctx) + '</td>';
                    }).join('') + '</tr>';
                }).join('') + '</tbody>';
                html += '<div class="table-wrap"><table>' + th + tb + '</table></div>';
                continue;
            }

            // 列表（含嵌套与任务列表）
            if (RE_UL.test(line) || RE_OL.test(line)) {
                var res = renderList(bodyLines, i2, ctx);
                html += res.html; i2 = res.next; continue;
            }

            // 块级公式（独占一行或多行 $$ ... $$）
            if (/^\s*\$\$/.test(line)) {
                var first = line.replace(/^\s*\$\$/, '');
                var closeIdx = first.indexOf('$$');
                var texLines = [];
                if (closeIdx !== -1) {
                    texLines.push(first.slice(0, closeIdx));
                    i2++;
                } else {
                    if (first.trim()) texLines.push(first);
                    i2++;
                    while (i2 < bodyLines.length) {
                        var cl = bodyLines[i2].indexOf('$$');
                        if (cl !== -1) { texLines.push(bodyLines[i2].slice(0, cl)); i2++; break; }
                        texLines.push(bodyLines[i2]); i2++;
                    }
                }
                var tex = texLines.join('\n').trim();
                // 原始源码放在子 span 里（CSS 隐藏）：不能直接写在元素文本里，
                // 否则 contenteditable 序列化时换行会丢失，回读 Markdown 时公式就散了。
                html += '<div class="math-tex ' + MATH_BLOCK_CLASS + '" data-tex="' + escAttr(tex) + '" contenteditable="false">' +
                    '<span class="math-raw">' + esc(tex) + '</span></div>';
                continue;
            }

            // 段落（连续非空行，遇到其它块起始则停止）
            var pbuf = [line];
            i2++;
            while (i2 < bodyLines.length) {
                var nl = bodyLines[i2];
                if (!nl.trim()) break;
                if (RE_HEADING.test(nl) || RE_FENCE.test(nl) || RE_QUOTE.test(nl) || RE_HR.test(nl) ||
                    RE_UL.test(nl) || RE_OL.test(nl) || /^\s*\$\$/.test(nl) || RE_REF.test(nl) || RE_FOOTNOTE_DEF.test(nl)) break;
                if (nl.indexOf('|') !== -1 && i2 + 1 < bodyLines.length && RE_TABLE_SEP.test(bodyLines[i2 + 1])) break;
                pbuf.push(nl); i2++;
            }
            var ptext = pbuf.join('\n');
            var phtml = renderInline(ptext, ctx);
            // 段内换行 → <br>（Markdown 软换行在博客正文里按换行显示更符合直觉）
            phtml = phtml.replace(/\n/g, '<br>');
            html += '<p>' + phtml + '</p>';
        }

        // 脚注区
        if (ctx.footnoteOrder.length) {
            html += '<section class="footnotes"><h4>脚注</h4><ol>';
            ctx.footnoteOrder.forEach(function (key) {
                var body = footDefs[key] != null ? footDefs[key] : '';
                html += '<li id="fn-' + escAttr(key) + '">' + renderInline(body, ctx) +
                    ' <a class="fn-back" href="#fnref-' + escAttr(key) + '" aria-label="回到正文">↩</a></li>';
            });
            html += '</ol></section>';
        }

        return { html: html, toc: toc };
    }

    /** 拆表格行：先保护 \| 转义，再按 | 切分，最后还原成字面竖线 */
    function splitRow(line) {
        var PIPE = '\u0001';
        var s = line.trim().replace(/\\\|/g, PIPE).replace(/^\|/, '').replace(/\|$/, '');
        return s.split('|').map(function (c) {
            // 还原此前被转义保护的 \| 字面竖线
            return c.replace(new RegExp(PIPE, 'g'), '|');
        });
    }

    /** 列表解析：支持 - / * / + 、有序、任务项 [ ] / [x]、缩进嵌套 */
    function renderList(lines, start, ctx) {
        var first = RE_UL.exec(lines[start]) || RE_OL.exec(lines[start]);
        var ordered = !RE_UL.test(lines[start]);
        var baseIndent = first[1].length;
        var items = [];
        var i = start;
        var startNum = ordered ? parseInt(first[2], 10) : 1;

        while (i < lines.length) {
            var line = lines[i];
            if (!line.trim()) {
                // 空行后若仍是同层列表项则继续，否则结束
                var nxt = lines[i + 1];
                if (nxt && (RE_UL.test(nxt) || RE_OL.test(nxt)) && (RE_UL.exec(nxt) || RE_OL.exec(nxt))[1].length === baseIndent) { i++; continue; }
                break;
            }
            var m = RE_UL.exec(line) || RE_OL.exec(line);
            if (!m) {
                // 续行（惰性延续）：接到上一项
                if (items.length && /^\s{2,}/.test(line)) { items[items.length - 1].raw.push(line.trim()); i++; continue; }
                break;
            }
            var indent = m[1].length;
            if (indent < baseIndent) break;
            if (indent > baseIndent) {
                // 嵌套：交给上层递归处理，这里把原始行交给当前项
                var sub = [];
                while (i < lines.length) {
                    var sm = RE_UL.exec(lines[i]) || RE_OL.exec(lines[i]);
                    if (!sm) break;
                    if (sm[1].length <= baseIndent) break;
                    sub.push(lines[i]); i++;
                }
                if (items.length) items[items.length - 1].sub = sub;
                continue;
            }
            var content = m[3];
            items.push({ raw: [content], sub: null });
            i++;
        }

        var isTask = false;
        var out = '<' + (ordered ? 'ol' : 'ul') + (ordered && startNum !== 1 ? ' start="' + startNum + '"' : '') + '>';
        items.forEach(function (it) {
            var text = it.raw.join('\n');
            var tm = /^\[([ xX])\]\s+(.*)$/.exec(text);
            var cls = '';
            if (tm) {
                isTask = true;
                cls = ' class="task' + (tm[1].toLowerCase() === 'x' ? ' done' : '') + '"';
                text = '<span class="task-box" aria-hidden="true">' + (tm[1].toLowerCase() === 'x' ? '✓' : '') + '</span>' + renderInline(tm[2], ctx);
            } else {
                text = renderInline(text, ctx).replace(/\n/g, '<br>\n');
            }
            var sub = it.sub ? renderList(it.sub, 0, ctx).html : '';
            out += '<li' + cls + '>' + text + sub + '</li>';
        });
        out += '</' + (ordered ? 'ol' : 'ul') + '>';
        if (isTask) out = '<div class="task-list">' + out + '</div>';
        return { html: out, next: i };
    }

    /** 从 Markdown 提取目录（不渲染，供阅读页侧栏用） */
    function extractTOC(md) {
        return render(md).toc;
    }

    global.WJMarkdown = {
        render: function (md, options) { return render(md, options).html; },
        renderFull: render,
        renderInline: function (t) { return renderInline(t); },
        extractTOC: extractTOC,
        highlight: highlight,
        escapeHtml: esc
    };
})(window);
