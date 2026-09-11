// HTML ⇄ Markdown 转换层自测：node tools/test-convert.mjs
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { install, Element } from './dom-shim.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { console };
const win = {};
sandbox.window = win;
win.window = win;
win.console = console;
install(win);
sandbox.document = win.document;   // 模块里直接引用裸 document
vm.createContext(sandbox);

for (const f of ['assets/js/markdown.js', 'assets/js/convert.js']) {
  const code = await readFile(resolve(ROOT, f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
}
const { WJMarkdown: MD, WJConvert: CV } = win;

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '\n         ' + String(extra).slice(0, 400) : '')); }
}
function box() { return new Element('div'); }

/** Markdown → 编辑器 HTML → Markdown，返回结果 */
function rt(md, opts) {
  const b = box();
  b.innerHTML = CV.mdToEditorHtml(md);
  return CV.htmlToMd(b, opts || {});
}
function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }

console.log('\n== Markdown → 编辑器 HTML ==');
const ed = (md) => CV.mdToEditorHtml(md);
t('标题保留', /<h2[^>]*>标题<\/h2>/.test(ed('## 标题')), ed('## 标题'));
t('锚点已移除', !ed('# A').includes('h-anchor'), ed('# A'));
t('复制按钮已移除', !ed('```js\nlet a=1\n```').includes('code-copy'), ed('```js\nlet a=1\n```'));
t('代码块容器已展平', !ed('```js\nlet a=1\n```').includes('code-block'), ed('```js\nlet a=1\n```'));
// 语言信息在编辑器 DOM 里由 <code class="lang-js"> 承载：data-lang 在外层 .code-block 上，
// 而外层外壳在清洗时会被展平，所以必须靠 code 自己的 class 才能往返保留语言
t('代码块保留语言', /class="lang-js"/.test(ed('```js\nlet a=1\n```')), ed('```js\nlet a=1\n```'));
t('列表保留', ed('- a\n- b').includes('<li>a</li>'));
t('表格已展平', !ed('| a |\n|---|\n| 1 |').includes('table-wrap'), ed('| a |\n|---|\n| 1 |'));
t('公式保留 data-tex', /data-tex="a\^2"/.test(ed('$a^2$')), ed('$a^2$'));
t('图片保留', ed('![x](articles/img/a.png)').includes('src="articles/img/a.png"'));
t('脚注区不发进编辑器', !ed('a[^1]\n\n[^1]: n').includes('footnotes'), ed('a[^1]\n\n[^1]: n'));
t('任务框保留可编辑文本', ed('- [x] done').includes('done'));

console.log('\n== 清洗（粘贴内容） ==');
t('script 被移除', !CV.cleanForEditor('<p>a<script>alert(1)<\/script></p>').includes('script'));
t('onclick 被移除', !CV.cleanForEditor('<p onclick="x()">a</p>').includes('onclick'));
t('javascript: 链接属性被移除', !CV.cleanForEditor('<a href="javascript:x()">a</a>').includes('javascript:'));
t('iframe 被移除', !CV.cleanForEditor('<iframe src="x"></iframe>').includes('iframe'));
t('文本内容保留', CV.cleanForEditor('<p>hello <b>world</b></p>').includes('hello'));

console.log('\n== HTML → Markdown（手工构造） ==');
function h2m(html, opts) { const b = box(); b.innerHTML = html; return CV.htmlToMd(b, opts); }
t('p → 段落', norm(h2m('<p>hello</p>')) === 'hello', h2m('<p>hello</p>'));
t('两个 p → 空行分隔', h2m('<p>a</p><p>b</p>').includes('a\n\nb'), JSON.stringify(h2m('<p>a</p><p>b</p>')));
t('strong', h2m('<p><strong>b</strong></p>').includes('**b**'), h2m('<p><strong>b</strong></p>'));
t('b 标签也识别', h2m('<p><b>b</b></p>').includes('**b**'));
t('em', h2m('<p><em>i</em></p>').includes('*i*'));
t('del', h2m('<p><del>d</del></p>').includes('~~d~~'));
t('code', h2m('<p><code>c</code></p>').replace(/\s+/g, '').includes('`c`'), h2m('<p><code>c</code></p>'));
t('br → 两空格换行', h2m('<p>a<br>b</p>').includes('a  \nb'), JSON.stringify(h2m('<p>a<br>b</p>')));
t('链接', h2m('<p><a href="https://a.com">t</a></p>').includes('[t](https://a.com)'));
t('图片', h2m('<p><img src="x.png" alt="a"></p>').includes('![a](x.png)'));
t('blob 图片映射为 img://', h2m('<p><img src="blob:http://x/1" alt="a"></p>', { blobMap: { 'blob:http://x/1': 'img://i1' } }).includes('![a](img://i1)'));
t('未映射 blob 不写入正文', !h2m('<p><img src="blob:http://x/2" alt="a"></p>').includes('blob:'));
t('h3', h2m('<h3>T</h3>').includes('### T'));
t('hr', h2m('<hr>').includes('---'));
t('行首 # 被转义', h2m('<p># not heading</p>').includes('\\#'), h2m('<p># not heading</p>'));
t('列表项内的 * 原样保留（不产生语法歧义）', h2m('<ul><li>a * b</li></ul>').includes('- a * b'), h2m('<ul><li>a * b</li></ul>'));
t('行首有序列表标记转义分隔符', h2m('<p>1. not a list</p>').includes('1\\. not a list'), h2m('<p>1. not a list</p>'));
t('行首 2) 标记同样转义分隔符', h2m('<p>2) not a list</p>').includes('2\\) not a list'), h2m('<p>2) not a list</p>'));
t('转义后的行首标记渲染不残留反斜杠', !MD.render(h2m('<p>1. not a list</p>')).includes('\\'), MD.render(h2m('<p>1. not a list</p>')));

console.log('\n== HTML → Markdown（列表） ==');
const ul = h2m('<ul><li>a</li><li>b</li></ul>');
t('无序列表', ul.includes('- a') && ul.includes('- b'), JSON.stringify(ul));
const ol = h2m('<ol><li>a</li><li>b</li></ol>');
t('有序列表', ol.includes('1. a') && ol.includes('2. b'), JSON.stringify(ol));
const ol5 = h2m('<ol start="5"><li>a</li></ol>');
t('有序列表 start', ol5.includes('5. a'), JSON.stringify(ol5));
const nest = h2m('<ul><li>a<ul><li>b</li></ul></li></ul>');
t('嵌套列表缩进', nest.includes('- a') && nest.includes('  - b'), JSON.stringify(nest));
const task = h2m('<ul><li class="done"><span class="task-box">✓</span>done</li></ul>');
t('任务项完成', task.includes('- [x] done'), JSON.stringify(task));
const task2 = h2m('<ul><li><span class="task-box"></span>todo</li></ul>');
t('任务项未完成', task2.includes('- [ ] todo'), JSON.stringify(task2));

console.log('\n== HTML → Markdown（代码 / 表格 / 引用） ==');
const code = h2m('<pre><code class="lang-py">x = 1</code></pre>');
t('代码块围栏 + 语言', code.includes('```py') && code.includes('x = 1'), JSON.stringify(code));
const code2 = h2m('<pre><code>a```b</code></pre>');
t('代码内含围栏时加长', code2.includes('````'), JSON.stringify(code2));
const bq = h2m('<blockquote><p>line1</p><p>line2</p></blockquote>');
t('引用每行加 >', /^> line1$/m.test(bq) && /^> line2$/m.test(bq), JSON.stringify(bq));
const tbl = h2m('<table><thead><tr><th style="text-align:right">a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
t('表格输出对齐行', /\|\s*a\s*\|\s*b\s*\|/.test(tbl), JSON.stringify(tbl));
t('表格右对齐', tbl.includes('---:'), JSON.stringify(tbl));
t('表格数据行', /\|\s*1\s*\|\s*2\s*\|/.test(tbl), JSON.stringify(tbl));

console.log('\n== 往返一致性（Markdown → HTML → Markdown） ==');
const cases = [
  ['段落', '这是一段普通文字。'],
  ['粗斜体', '这是 **粗体** 与 *斜体* 与 ~~删除~~ 文字。'],
  ['行内代码', '使用 `npm install` 安装。'],
  ['标题层级', '# 一级\n\n## 二级\n\n### 三级'],
  ['无序列表', '- 甲\n- 乙\n- 丙'],
  ['有序列表', '1. 甲\n2. 乙'],
  ['嵌套列表', '- 甲\n  - 甲一\n  - 甲二\n- 乙'],
  ['引用', '> 引用第一行\n> 引用第二行'],
  ['代码块', '```js\nconst a = 1;\nconsole.log(a);\n```'],
  ['分割线', '上\n\n---\n\n下'],
  ['链接', '见 [官网](https://example.com) 。'],
  ['图片', '![示意](articles/img/demo.png)'],
  ['行内公式', '质能方程 $E = mc^2$ 很有名。'],
  ['块级公式', '$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n$$'],
  ['表格', '| 名称 | 值 |\n| --- | ---: |\n| a | 1 |\n| b | 2 |'],
  ['任务列表', '- [x] 已完成\n- [ ] 待办'],
  ['行首有序列表标记', '1\\. 这不是列表\n\n2\\) 也不是'],
  ['混合结构', '# 标题\n\n引言段落。\n\n- 要点一\n- 要点二\n\n> 一段引用\n\n```python\nprint("hi")\n```\n\n结尾段落。']
];
for (const [name, md] of cases) {
  const out = rt(md);
  const once = norm(out);
  const twice = norm(rt(out));
  t(name + ' 幂等', once === twice, '一次: ' + JSON.stringify(once) + '\n         二次: ' + JSON.stringify(twice));
}

console.log('\n== 往返保真（关键内容不丢） ==');
t('粗体保留', rt('**关键**').includes('**关键**'), rt('**关键**'));
t('公式保留', rt('$a^2+b^2$').includes('$a^2+b^2$'), rt('$a^2+b^2$'));
t('块级公式保留', /^\$\$$/m.test(rt('$$\nE=mc^2\n$$')) && rt('$$\nE=mc^2\n$$').includes('E=mc^2'), rt('$$\nE=mc^2\n$$'));
t('图片保留', rt('![图](articles/img/x.png)').includes('articles/img/x.png'));
t('代码语言保留', rt('```python\nx=1\n```').includes('python'), rt('```python\nx=1\n```'));
t('代码内容保留', rt('```\nline1\nline2\n```').includes('line1\nline2'), rt('```\nline1\nline2\n```'));
t('有序列表编号保留', rt('1. a\n2. b\n3. c').includes('3. c'), rt('1. a\n2. b\n3. c'));
t('任务状态保留', rt('- [x] a').includes('[x] a'), rt('- [x] a'));
t('表格结构保留', rt('| a | b |\n| --- | --- |\n| 1 | 2 |').includes('| 1 | 2 |'), rt('| a | b |\n| --- | --- |\n| 1 | 2 |'));
t('引用保留', rt('> q').includes('> q'));
t('标题不丢字', rt('## 中文标题').includes('中文标题'));
t('代码块内容含反引号可往返', rt('````\na```b\n````').includes('a```b'), rt('````\na```b\n````'));
t('表格单元格含竖线可往返', rt('| a\\|b | c |\n| --- | --- |\n| 1 | 2 |').includes('1'), rt('| a\\|b | c |\n| --- | --- |\n| 1 | 2 |'));

console.log('\n== 边界 ==');
t('空 HTML', CV.htmlToMd(box()) === '');
t('只有空白的 HTML', CV.htmlToMd(box()) === '');
t('未知标签保留文字', h2m('<p><mark>高亮</mark></p>').includes('高亮'));
t('div 容器下钻', norm(h2m('<div><p>a</p><p>b</p></div>')) === 'a b', JSON.stringify(h2m('<div><p>a</p><p>b</p></div>')));
t('nbsp 归一化', !h2m('<p>a&nbsp;b</p>').includes('\u00a0'));
t('无内容不产生空段落', !h2m('<p></p><p></p>').trim().replace(/\s/g, '').length);

console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
