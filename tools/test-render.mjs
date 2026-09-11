// 渲染器自测：node tools/test-render.mjs
// 用最小 DOM/global 垫片在 Node 里跑 assets/js/markdown.js，检查关键输出。
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const code = await readFile(resolve(ROOT, 'assets/js/markdown.js'), 'utf8');
const sandbox = { window: {}, console };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'markdown.js' });
const md = sandbox.window.WJMarkdown;

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '\n         ' + String(extra).slice(0, 300) : '')); }
}
function has(name, out, needle) { t(name, out.includes(needle), 'got: ' + out); }
function notHas(name, out, needle) { t(name, !out.includes(needle), 'got: ' + out); }
const R = (s) => md.render(s);
const TOC = (s) => md.extractTOC(s);

console.log('\n== 块级结构 ==');
has('标题 h2 + 锚点', R('## 你好 世界'), '<h2 id="你好-世界">');
has('标题锚点链接', R('# A'), 'class="h-anchor"');
has('分割线', R('---'), '<hr>');
has('引用', R('> 引用内容'), '<blockquote>');
has('嵌套引用', R('> 外\n> > 内'), '<blockquote>');
has('无序列表', R('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
has('有序列表', R('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
has('有序列表起始值', R('3. a\n4. b'), '<ol start="3">');
has('任务列表未完成', R('- [ ] todo'), 'class="task"');
has('任务列表已完成', R('- [x] done'), 'class="task done"');
has('任务勾选框', R('- [x] done'), 'task-box');
has('多段段落', R('a\n\nb'), '<p>a</p><p>b</p>');
has('段内软换行 → br', R('a\nb'), '<p>a<br>b</p>');
has('围栏代码', R('```js\nlet a = 1;\n```'), '<pre><code class="lang-js">');
has('代码块语言标签', R('```python\nx=1\n```'), 'data-lang="python"');
has('代码块复制按钮', R('```\nx\n```'), 'data-copy');
has('未闭合围栏不吞内容', R('```js\nlet a=1'), 'let');
has('表格', R('| a | b |\n|---|---|\n| 1 | 2 |'), '<th style="text-align:left">a</th>');
has('表格对齐 right', R('| a |\n|--:|\n| 1 |'), 'text-align:right');
has('表格对齐 center', R('| a |\n|:-:|\n| 1 |'), 'text-align:center');
has('表格包裹容器', R('| a |\n|---|\n| 1 |'), '<div class="table-wrap">');

console.log('\n== 行内 ==');
has('粗体', R('**b**'), '<strong>b</strong>');
has('斜体', R('*i*'), '<em>i</em>');
has('斜体下划线', R('_i_'), '<em>i</em>');
has('删除线', R('~~d~~'), '<del>d</del>');
has('行内代码', R('`c`'), '<code>c</code>');
has('行内代码含星号', R('`a*b*c`'), '<code>a*b*c</code>');
has('链接', R('[t](https://a.com)'), 'href="https://a.com"');
has('外链加 noopener', R('[t](https://a.com)'), 'rel="noopener noreferrer"');
has('内链不加 target', R('[t](#x)'), '<a href="#x">t</a>');
has('链接标题', R('[t](https://a.com "T")'), 'title="T"');
has('自动链接', R('<https://a.com>'), 'href="https://a.com"');
has('图片', R('![alt](articles/img/a.png)'), '<img src="articles/img/a.png" alt="alt"');
has('图片惰性加载', R('![a](x.png)'), 'loading="lazy"');
has('本地图片 scheme 保留', R('![a](img://img-1)'), 'src="img://img-1"');
has('引用式链接', R('[t][k]\n\n[k]: https://a.com'), 'href="https://a.com"');
has('转义星号', R('\\*not em\\*'), '*not em*');
notHas('转义不产生 em', R('\\*a\\*'), '<em>');
has('脚注引用', R('a[^1]\n\n[^1]: note'), 'class="fn-ref"');
has('脚注定义区', R('a[^1]\n\n[^1]: note'), '<section class="footnotes">');
has('脚注回链', R('a[^1]\n\n[^1]: note'), 'class="fn-back"');

console.log('\n== 公式 ==');
has('行内公式 $', R('$a^2$'), 'data-tex="a^2"');
has('行内公式 class', R('$a$'), 'math-tex math-inline');
has('块级公式独占行', R('$$\nE=mc^2\n$$'), 'math-tex math-block');
has('块级公式 data-tex', R('$$\nE=mc^2\n$$'), 'data-tex="E=mc^2"');
has('块级公式单行', R('$$x=1$$'), 'data-tex="x=1"');
has('公式内换行保留', R('$$\na \\\\ b\n$$'), 'data-tex="a \\\\ b"');
has('公式内含美元不被截断', R('$a$ and $b$'), 'data-tex="a"');
t('两个行内公式都渲染', (R('$a$ and $b$').match(/math-inline/g) || []).length === 2, R('$a$ and $b$'));
notHas('货币 $5 不当公式', R('cost $5 today'), 'math-inline');
notHas('货币 5$ 不当公式', R('5$ and 6'), 'math-inline');
has('公式降级保留源码', R('$a^2$'), '$a^2$');
has('块级公式原始源码在子 span 中', R('$$\nE=mc^2\n$$'), '<span class="math-raw">E=mc^2</span>');
t('块级公式文本不含换行（保护 contenteditable）', !/<div class="math-tex math-block"[^>]*>[^<]*\n/.test(R('$$\na \\\\ b\n$$')), R('$$\na \\\\ b\n$$'));
has('公式与强调共存', R('**$x$**'), '<strong><span class="math-tex');

console.log('\n== 安全 ==');
notHas('script 标签被转义', R('<script>alert(1)</script>'), '<script>');
has('script 转义为实体', R('<script>'), '&lt;script&gt;');
notHas('javascript: 链接被丢弃', R('[x](javascript:alert(1))'), 'javascript:');
notHas('javascript: 保留文字', R('[x](javascript:alert(1))'), 'href=');
notHas('onerror 被转义', R('![a](x.png" onerror="alert(1))'), 'onerror="alert(1)"');
has('data:image 允许', R('![a](data:image/png;base64,AAA)'), 'data:image/png');
notHas('vbscript 丢弃', R('[x](vbscript:msgbox)', ''), 'vbscript:');
notHas('HTML 属性注入标题', R('<img src=x onerror=alert(1)>'), '<img src=x');

console.log('\n== 高亮 ==');
const hl = (c, l) => md.highlight(c, l);
has('js 字符串高亮', hl('let a = "hi";', 'js'), 'tok-str');
has('js 关键字高亮', hl('const x = 1', 'js'), 'tok-kw');
has('js 注释高亮', hl('// note\nlet a', 'js'), 'tok-com');
has('js 数字高亮', hl('let a = 42', 'js'), 'tok-num');
has('py 井号注释', hl('# note\nx = 1', 'python'), 'tok-com');
has('py 关键字', hl('def f():', 'python'), 'tok-kw');
has('html 标签高亮', hl('<div class="a">', 'html'), 'tok-tag');
has('未知语言降级为纯文本', hl('let a = 1', 'zzz'), 'let a = 1');
notHas('高亮转义 HTML', hl('<b>', 'js'), '<b>');
has('高亮负号不吞', hl('a-1', 'js'), 'a');
t('高亮不抛异常', (() => { try { hl('a-1 "x" /* y */ 12.5e-3 #z', 'js'); return true; } catch (e) { return false; } })());

console.log('\n== 目录 ==');
const toc = TOC('# A\n\n## B\n\n### C\n\n## B');
t('目录条数', toc.length === 4, JSON.stringify(toc));
t('目录层级', toc[0].level === 1 && toc[1].level === 2 && toc[2].level === 3);
t('目录重名去重', toc[1].id !== toc[3].id, JSON.stringify(toc.map(x => x.id)));
has('去重 id 出现在 HTML', R('# A\n\n## B\n\n## B'), 'id="b-2"');

console.log('\n== 边界 ==');
t('空输入', R('') === '');
t('null 输入', R(null) === '');
t('纯空白', R('   \n\n  ') === '');
t('未闭合强调不崩', R('**abc') .includes('abc'));
t('未闭合链接不崩', R('[abc') .includes('abc'));
t('未闭合公式不崩', R('$abc').includes('abc'));
t('孤立美元符号', R('a $ b').includes('a'));
t('深层嵌套列表', R('- a\n  - b\n    - c').includes('<li>c</li>'), R('- a\n  - b\n    - c'));
t('嵌套列表不重复输出', (R('- a\n  - b').match(/<ul>/g) || []).length === 2, R('- a\n  - b'));
t('大文档性能', (() => { const big = Array.from({ length: 400 }, (_, i) => `## H${i}\n\n段落 **粗** 与 $x_${i}$ 与 \`code\`\n\n- 项 ${i}\n`).join('\n'); const s = Date.now(); R(big); return Date.now() - s < 4000; })());

console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
