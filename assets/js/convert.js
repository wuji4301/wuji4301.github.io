/* ==========================================================================
   无极博客 · HTML ⇄ Markdown 双向转换
   --------------------------------------------------------------------------
   富文本编辑器用 contenteditable（得到 HTML），但文章的存储与导出统一用
   Markdown：可读、可 diff、可手改、不绑定编辑器实现。本模块负责两侧互转。

   受支持的词汇表（编辑器的"可控语义"）：
     块级：p / h1-h6 / ul / ol(含任务项) / blockquote / pre>code / hr / table
     行内：strong / em / del / code / a / br / img / span.math-tex
   其余标签在转换时被"提升"（保留子节点、丢弃自身），保证不丢文字。
   ========================================================================== */
(function (global) {
    'use strict';

    /* ------------------------------------------------------- 文本级工具 */

    /**
     * 行内文本转义。
     * 这里刻意"什么都不转义"，因为这是唯一能同时保住两个方向的方案：
     *   · 公式 $a^2$ 与 TeX 命令 \int 里的 \ $ 一旦加反斜杠就会被解析器读坏；
     *   · 行内代码 `x` 里的反引号同理。
     * 代价是：读者从别的编辑器粘贴来的字面量 * 或 $（如 "cost $5"）在导出后
     * 会被当成语法。对博客写作场景，这个取舍明显更划算——具体的行首歧义
     * （# 标题、- 列表、$$ 公式）由 escLineStart() 在块级兜底。
     */
    function escInline(s) {
        return String(s == null ? '' : s);
    }

    // 硬换行占位符：先写入不可见字符，最后再换成 Markdown 的"两空格 + 换行"，
    // 避免被收尾的空白清理步骤吃掉尾随空格。
    var HARDBREAK = '\u0000';

    /** 行首若会触发块级语法，加反斜杠转义，避免普通文本被解析成标题/列表/公式 */
    function escLineStart(s) {
        return String(s).replace(
            /^(\s*)(#{1,6}(?=\s)|>|[-*+](?=\s)|_{2,}(?=\s)|(\d{1,9})([.)])(?=\s)|\$\$|\(\d+\)(?=\s))/,
            function (_, ws, sym, num, delim) {
                // 有序列表标记要转义分隔符本身（形如 1\. ），否则补上的反斜杠会被当成普通字符显示出来
                return num != null ? ws + num + '\\' + delim : ws + '\\' + sym;
            }
        );
    }

    var BLOCK = {
        P: 1, DIV: 1, SECTION: 1, ARTICLE: 1, HEADER: 1, FOOTER: 1, MAIN: 1, ASIDE: 1,
        H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1,
        UL: 1, OL: 1, LI: 1, BLOCKQUOTE: 1, PRE: 1, HR: 1, TABLE: 1,
        FIGURE: 1, FIGCAPTION: 1, DL: 1, DT: 1, DD: 1
    };

    function isBlockEl(el) {
        return !!(el && el.nodeType === 1 && (BLOCK[el.tagName] || isDisplayBlock(el)));
    }

    function isDisplayBlock(el) {
        try {
            var d = global.getComputedStyle ? global.getComputedStyle(el).display : '';
            return d === 'block' || d === 'list-item' || d === 'flex' || d === 'grid' || d === 'table';
        } catch (e) { return false; }
    }

    /* ==================================================================
       一、HTML → Markdown
       ================================================================== */

    /**
     * @param {Node} root        编辑器根节点（contenteditable 容器）
     * @param {Object} opts
     *   blobMap: { blobUrl: 'img://id' }  把编辑器里显示用的 blob: URL 还原成稳定引用
     */
    function htmlToMd(root, opts) {
        opts = opts || {};
        var blobMap = opts.blobMap || {};
        var out = '';
        var lastWasBlank = true;

        function push(text) { out += text; lastWasBlank = false; }
        function blockSep() {
            // 段落之间最多一个空行，避免连续编辑产生大片空白
            if (!lastWasBlank && out) { out += (/\n\n$/.test(out) ? '' : (/\n$/.test(out) ? '\n' : '\n\n')); }
            lastWasBlank = true;
        }
        function ensureNewline() { if (out && !/\n$/.test(out)) out += '\n'; }

        function inlineOf(node) {
            var s = '';
            Array.prototype.forEach.call(node.childNodes, function (c) { s += inlineNode(c); });
            return s;
        }

        function inlineNode(n) {
            if (n.nodeType === 3) {
                var t = n.nodeValue || '';
                t = t.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
                return escInline(t);
            }
            if (n.nodeType !== 1) return '';

            var tag = n.tagName;
            var inner = inlineOf(n);

            switch (tag) {
                case 'BR': return HARDBREAK;
                case 'STRONG': case 'B': return inner.trim() ? '**' + inner + '**' : inner;
                case 'EM': case 'I': return inner.trim() ? '*' + inner + '*' : inner;
                case 'DEL': case 'S': case 'STRIKE': return inner.trim() ? '~~' + inner + '~~' : inner;
                case 'U': return inner;   // Markdown 无下划线语义，降级为普通文本
                case 'MARK': return inner;
                case 'CODE': case 'KBD': case 'SAMP': case 'TT': {
                    var code = (n.textContent || '').replace(/\n/g, ' ');
                    var fence = '`';
                    while (code.indexOf(fence) !== -1) fence += '`';
                    return fence + (code.trim() ? ' ' + code + ' ' : code) + fence;
                }
                case 'A': {
                    var href = n.getAttribute('href') || '';
                    var text = inner || escInline(n.textContent || '');
                    if (!href || href === '#' || href.charAt(0) === '#') return text;
                    return '[' + text + '](' + href.replace(/[)\s]/g, function (m) { return encodeURIComponent(m); }) + ')';
                }
                case 'IMG': {
                    var src = n.getAttribute('src') || '';
                    if (blobMap[src]) src = blobMap[src];
                    if (/^blob:/.test(src)) src = '';       // 未能映射的临时地址：宁可留空也不要写坏数据
                    var alt = (n.getAttribute('alt') || '').replace(/[\[\]]/g, '');
                    return '![' + alt + '](' + src + ')';
                }
                case 'SPAN': {
                    if (n.classList && n.classList.contains('math-tex')) {
                        var tex = n.getAttribute('data-tex');
                        if (tex == null) tex = n.textContent || '';
                        var display = n.classList.contains('math-block');
                        return display ? '\n\n$$' + tex + '$$\n\n' : '$' + tex + '$';
                    }
                    if (n.classList && n.classList.contains('task-box')) return '';
                    return inner;
                }
                case 'SUP': case 'SUB': return inner;
                default:
                    if (isBlockEl(n)) return '\n' + inlineOf(n) + '\n';
                    return inner;
            }
        }

        function listToMd(listEl, indent) {
            var ordered = listEl.tagName === 'OL';
            var startAttr = parseInt(listEl.getAttribute('start') || '1', 10);
            if (isNaN(startAttr) || startAttr < 1) startAttr = 1;
            var idx = startAttr;
            var pad = new Array(indent + 1).join('  ');
            var lines = [];

            Array.prototype.forEach.call(listEl.children, function (li) {
                if (li.tagName !== 'LI') return;
                var marker = ordered ? (idx++) + '. ' : '- ';
                var task = null;
                var first = li.firstElementChild;
                if (first && first.classList && first.classList.contains('task-box')) {
                    task = li.classList.contains('done') ? 'x' : ' ';
                    // 去掉勾选框，保留其后文字
                    var clone = li.cloneNode(true);
                    var cb = clone.querySelector('.task-box');
                    if (cb && cb.parentNode) cb.parentNode.removeChild(cb);
                    var sub = subListsOf(clone);
                    var text = escLineStart(inlineOf(clone).replace(/\n+/g, ' ').trim());
                    lines.push(pad + '- [' + task + '] ' + text);
                    if (sub) lines.push(sub);
                    return;
                }
                var subMd = subListsOf(li);
                var text2 = escLineStart(inlineOf(li).replace(/\n{2,}/g, '\n').trim());
                lines.push(pad + marker + text2);
                if (subMd) lines.push(subMd);
            });
            return lines.join('\n');
        }

        /** 取出 li 内部的嵌套列表（转成缩进 Markdown），并从 inline 文本中剔除 */
        function subListsOf(li) {
            var parts = [];
            // 不用 :scope：部分环境/SVG 选择器不支持，直接遍历直接子元素更可靠
            Array.prototype.slice.call(li.childNodes).forEach(function (c) {
                if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) {
                    parts.push(listToMd(c, 1));
                    li.removeChild(c);
                }
            });
            return parts.join('\n');
        }

        function codeBlockOf(pre) {
            var codeEl = pre.querySelector('code') || pre;
            // 用子节点直接拼接，避免依赖 textContent 在编辑器异常 DOM 下的行为
            var text = '';
            Array.prototype.forEach.call(codeEl.childNodes, function (c) { text += c.textContent; });
            if (!text) text = codeEl.textContent || '';
            var lang = codeEl.getAttribute('data-lang') || pre.getAttribute('data-lang') || '';
            if (!lang) {
                var cls = codeEl.className || '';
                var m = /lang-([a-z0-9+#]+)/i.exec(cls);
                if (m) lang = m[1];
            }
            if (!lang) {
                var host = pre.closest ? pre.closest('[data-lang]') : null;
                if (host) lang = host.getAttribute('data-lang') || '';
            }
            text = text.replace(/\n+$/, '');
            // 围栏必须比正文里最长的反引号串更长，否则会提前闭合
            var fence = '```';
            while (text.indexOf(fence) !== -1) fence += '`';
            return fence + lang + '\n' + text + '\n' + fence;
        }

        function tableToMd(table) {
            var rows = [];
            Array.prototype.forEach.call(table.querySelectorAll('tr'), function (tr) {
                var cells = [];
                Array.prototype.forEach.call(tr.children, function (td) {
                    cells.push(inlineOf(td).replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim());
                });
                if (cells.length) rows.push(cells);
            });
            if (!rows.length) return '';
            var width = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
            var norm = rows.map(function (r) {
                var c = r.slice();
                while (c.length < width) c.push('');
                return c;
            });
            var aligns = [];
            var headerRow = table.querySelector('tr');
            if (headerRow) {
                Array.prototype.forEach.call(headerRow.children, function (th) {
                    var a = (th.style && th.style.textAlign) || '';
                    aligns.push(a === 'center' ? ':---:' : (a === 'right' ? '---:' : '---'));
                });
            }
            while (aligns.length < width) aligns.push('---');
            var lines = ['| ' + norm[0].join(' | ') + ' |', '| ' + aligns.join(' | ') + ' |'];
            for (var i = 1; i < norm.length; i++) lines.push('| ' + norm[i].join(' | ') + ' |');
            return lines.join('\n');
        }

        /**
         * 把一个块级元素转成 Markdown。
         * @returns {string|null} null 表示"不是块级元素或不产生独立块"
         */
        function blockToMd(n) {
            var tag = n.tagName;

            // 块级公式（renderer 输出的是 <div class="math-tex math-block" data-tex=...>）
            if (tag === 'DIV' && n.classList && n.classList.contains('math-block') && n.classList.contains('math-tex')) {
                return '$$\n' + (n.getAttribute('data-tex') || '') + '\n$$';
            }

            if (/^H[1-6]$/.test(tag)) {
                var htext = inlineOf(n).replace(/\n+/g, ' ').trim();
                return new Array(parseInt(tag[1], 10) + 1).join('#') + ' ' + htext;
            }
            if (tag === 'HR') return '---';
            if (tag === 'PRE') return codeBlockOf(n);

            if (tag === 'BLOCKQUOTE') {
                var inner = htmlToMd(n, opts).trim();
                return inner.split('\n').map(function (l) { return '> ' + l; }).join('\n');
            }
            if (tag === 'UL' || tag === 'OL') return listToMd(n, 0);
            if (tag === 'TABLE') return tableToMd(n);

            if (tag === 'FIGURE') {
                // 图片 + 题注：图片保留，题注转成斜体说明另起一段
                var parts = [];
                var img = n.querySelector('img');
                if (img) parts.push(inlineNode(img));
                var cap = n.querySelector('figcaption');
                if (cap) parts.push('*' + inlineOf(cap).replace(/\n+/g, ' ').trim() + '*');
                return parts.join('\n\n');
            }

            if (tag === 'LI' || tag === 'DL' || tag === 'DT' || tag === 'DD' || tag === 'FIGCAPTION') {
                return null;   // 由父级列表/定义列表统一处理
            }

            if (tag === 'DIV' || tag === 'P' || tag === 'SECTION' || tag === 'ARTICLE' ||
                tag === 'MAIN' || tag === 'HEADER' || tag === 'FOOTER' || tag === 'ASIDE') {
                var hasBlockChild = Array.prototype.some.call(n.children || [], function (c) {
                    return isBlockEl(c) && c.tagName !== 'BR';
                });
                if (hasBlockChild) return null;    // 容器：下钻到子节点逐个处理
                var t = inlineOf(n).replace(/\n{2,}/g, '\n').trim();
                if (!t) return null;
                return escLineStart(t.split('\n').join(HARDBREAK));
            }

            // 未知块级元素（display:block）：按段落语义处理，保证不丢文字
            if (isBlockEl(n)) {
                var t2 = inlineOf(n).replace(/\n{2,}/g, '\n').trim();
                return t2 ? escLineStart(t2) : null;
            }
            return null;
        }

        function walk(node) {
            Array.prototype.forEach.call(node.childNodes, function (n) {
                if (n.nodeType === 3) {
                    var t = (n.nodeValue || '').replace(/\u00a0/g, ' ');
                    if (/^\s*$/.test(t)) return;       // 纯空白文本节点忽略
                    push(t.replace(/\s+/g, ' '));
                    return;
                }
                if (n.nodeType !== 1) return;

                var md = blockToMd(n);
                if (md !== null) {
                    blockSep();
                    if (md) push(md);
                    blockSep();
                    return;
                }
                if (isBlockEl(n)) { walk(n); return; }   // 容器：递归
                push(inlineNode(n));                     // 行内
            });
        }

        walk(root);
        var result = out
            .replace(/\u00a0/g, ' ')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/^\n+/, '')
            .replace(/\s+$/, '');
        if (!result.replace(new RegExp(HARDBREAK, 'g'), '').trim()) result = '';
        // 占位符 → Markdown 硬换行（行尾两空格 + 换行）
        return result.split(HARDBREAK).join('  \n') + (result ? '\n' : '');
    }

    /* ==================================================================
       二、Markdown → 编辑器 HTML
       ================================================================== */

    /** 纯展示性外壳：删除元素本身，但把子节点提升到原位置（不能连内容一起删） */
    var UNWRAP_SELECTORS = ['.table-wrap', '.code-block'];

    /** 完全不进入编辑器的东西 */
    var STRIP_SELECTORS = [
        'a.h-anchor', '.code-copy', '.code-head', '.code-lang',
        '.fn-ref', '.fn-back', 'section.footnotes', '[data-copy]'
        // 注意：.task-box 与 .task-list 必须保留 —— 前者是任务勾选状态的唯一载体，
        // 后者是任务列表的识别标记
    ];

    /**
     * 把 Markdown 渲染成适合放进 contenteditable 的干净 HTML。
     * 与阅读页共用同一个渲染器，保证"编辑所见 = 发布所得"。
     */
    function mdToEditorHtml(md) {
        var html = global.WJMarkdown ? global.WJMarkdown.render(md || '') : '';
        return cleanForEditor(html);
    }

    /** 编辑器需要的 class 白名单（可能是空格分隔的多个 class，其余一律清除） */
    var KEEP_CLASS = /^(math-tex|math-inline|math-block|task|done|task-list|task-box|code-block|lang-[a-z0-9+#.]+)$/;

    function keepClassAttr(value) {
        var parts = String(value || '').trim().split(/\s+/).filter(Boolean);
        return parts.length > 0 && parts.every(function (c) { return KEEP_CLASS.test(c); });
    }

    /** 对任意 HTML 做白名单清洗（粘贴内容也走这里，避免带进脚本/样式污染） */
    function cleanForEditor(html) {
        var box = document.createElement('div');
        box.innerHTML = html;

        // 1) 展示性外壳：拆掉外壳保留内容（不能连内容一起删）
        UNWRAP_SELECTORS.forEach(function (sel) {
            Array.prototype.forEach.call(box.querySelectorAll(sel), function (el) {
                while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
                el.remove();
            });
        });

        // 2) 彻底删除危险/无意义节点
        STRIP_SELECTORS.forEach(function (sel) {
            Array.prototype.forEach.call(box.querySelectorAll(sel), function (el) { el.remove(); });
        });
        Array.prototype.forEach.call(
            box.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,button,select,textarea,svg,canvas,video,audio,noscript'),
            function (el) { el.remove(); }
        );

        // 3) 代码块：去掉行内高亮产生的 <span class="tok-*">，让代码区只含纯文本
        //    （否则 :not(pre) > code 之类的样式与编辑器光标定位都会出问题）
        Array.prototype.forEach.call(box.querySelectorAll('pre code, pre'), function (codeEl) {
            Array.prototype.forEach.call(codeEl.querySelectorAll('span'), function (sp) {
                sp.parentNode.replaceChild(document.createTextNode(sp.textContent), sp);
            });
        });

        // 4) 属性白名单：去掉事件属性、外部样式、非白名单 class、危险 URL
        Array.prototype.forEach.call(box.querySelectorAll('*'), function (el) {
            Array.prototype.slice.call(el.attributes).forEach(function (attr) {
                var n = attr.name.toLowerCase();
                var keep = true;
                if (n.indexOf('on') === 0) keep = false;
                else if (n === 'class') keep = keepClassAttr(attr.value);
                else if (n === 'style') keep = /^\s*text-align\s*:\s*(left|right|center)\s*;?\s*$/.test(attr.value);
                else if (n === 'href' || n === 'src') keep = !/^\s*javascript:/i.test(attr.value);
                else if (n === 'id') keep = false;
                // contenteditable="false" 必须保留：它是公式等原子节点的标记
                else if (n === 'contenteditable') keep = attr.value === 'false';
                if (!keep) el.removeAttribute(attr.name);
            });
        });
        return box.innerHTML;
    }

    /** 从 HTML 中提取纯文本（用于摘要、字数统计） */
    function htmlToText(html) {
        var box = document.createElement('div');
        box.innerHTML = html || '';
        Array.prototype.forEach.call(box.querySelectorAll('span.math-tex'), function (el) {
            el.textContent = el.getAttribute('data-tex') || '';
        });
        return (box.textContent || '').replace(/\s+/g, ' ').trim();
    }

    global.WJConvert = {
        htmlToMd: htmlToMd,
        mdToEditorHtml: mdToEditorHtml,
        cleanForEditor: cleanForEditor,
        htmlToText: htmlToText,
        escInline: escInline,
        escLineStart: escLineStart
    };
})(window);
