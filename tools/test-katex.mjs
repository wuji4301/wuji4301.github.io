// KaTeX 端到端校验：直接加载 vendor/katex/katex.min.js，把仓库文章里的每一条公式
// 都真排一遍，确保内容不会在页面上显示成红色的语法错误；另有一份内置样本，
// 保证「Markdown 取公式 → KaTeX 排版」这条闭环在空仓库下也被覆盖。
// 用法: node tools/test-katex.mjs
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const sandbox = {
  console,
  window: {},
  document: { compatMode: 'CSS1Compat', createElement: () => ({ style: {} }), querySelector: () => null }
};
sandbox.window.katex = undefined;
sandbox.self = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(await readFile(resolve(ROOT, 'vendor/katex/katex.min.js'), 'utf8'), sandbox, { filename: 'katex.min.js' });
const katex = sandbox.katex || sandbox.window.katex;
if (!katex) { console.error('无法从 katex.min.js 获取 katex 对象'); process.exit(1); }

// 用渲染器提取公式（与页面完全一致的解析路径）
const mdSandbox = { console, window: {} };
mdSandbox.window.window = mdSandbox.window;
vm.createContext(mdSandbox);
vm.runInContext(await readFile(resolve(ROOT, 'assets/js/markdown.js'), 'utf8'), mdSandbox, { filename: 'markdown.js' });
const MD = mdSandbox.window.WJMarkdown;

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '\n         ' + extra : '')); }
}

function tryRender(tex, display) {
  try {
    katex.renderToString(tex, { displayMode: !!display, throwOnError: true, strict: false });
    return null;
  } catch (e) { return e.message; }
}

// 1) 渲染器常见语法
console.log('\n== 渲染器支持的公式语法 ==');
const syntax = [
  ['E = mc^2', false], ['a^2+b^2=c^2', false], ['\\frac{a}{b}', false],
  ['\\sqrt{\\pi}', false], ['x_{i}', false], ['\\sum_{i=1}^{n} i', true],
  ['\\int_{-\\infty}^{+\\infty} e^{-x^{2}}\\,\\mathrm{d}x', true],
  ['\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', true],
  ['f(x) = \\begin{cases} x^2, & x \\ge 0 \\\\ -x, & x < 0 \\end{cases}', true],
  ['\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1', true],
  ['\\nabla \\cdot \\mathbf{F}', false], ['\\alpha\\beta\\gamma\\theta\\lambda\\pi\\sigma\\phi\\omega', false],
  ['P(A\\mid B) = \\frac{P(B\\mid A)\\,P(A)}{P(B)}', true]
];
syntax.forEach(([tex, d]) => {
  const err = tryRender(tex, d);
  t('可排版: ' + tex.slice(0, 46), err === null, err);
});

// 2) 自定义宏（与 assets/js/math.js 中 DEFAULTS.macros 保持一致）
console.log('\n== 自定义宏 ==');
const macros = {
  '\\RR': '\\mathbb{R}', '\\NN': '\\mathbb{N}', '\\ZZ': '\\mathbb{Z}',
  '\\QQ': '\\mathbb{Q}', '\\CC': '\\mathbb{C}', '\\dd': '\\mathrm{d}',
  '\\ee': '\\mathrm{e}', '\\ii': '\\mathrm{i}',
  '\\abs': '\\left|#1\\right|', '\\norm': '\\left\\|#1\\right\\|'
};
function tryRenderMacro(tex, d) {
  try { katex.renderToString(tex, { displayMode: !!d, throwOnError: true, strict: false, macros }); return null; }
  catch (e) { return e.message; }
}
['\\RR^n', '\\ZZ', '\\abs{x}', '\\norm{v}', '\\dd x', '\\ee^{i\\pi}'].forEach((tex) => {
  const err = tryRenderMacro(tex, false);
  t('宏可用: ' + tex, err === null, err);
});
// 页面实际使用的宏集合必须与 math.js 一致
const mathSrc = await readFile(resolve(ROOT, 'assets/js/math.js'), 'utf8');
const declared = [...mathSrc.matchAll(/'(\\\\[A-Za-z]+)':/g)].map((m) => m[1]);
t('math.js 声明的宏都能排版', declared.every((m) => {
  const err = tryRenderMacro(m + (m === '\\abs' || m === '\\norm' ? '{x}' : ''), false);
  return err === null;
}), declared.join(' '));

// 3) 示例文章里的真实公式
console.log('\n== 示例文章公式 ==');

/** 从 Markdown 正文里提取出渲染器交给 KaTeX 的原始 tex（与页面同一条路径） */
function extractMath(body) {
  const html = MD.render(body || '');
  const spans = [...html.matchAll(/<span class="math-tex math-inline" data-tex="([^"]*)"/g)].map((m) => [m[1], false]);
  const blocks = [...html.matchAll(/<div class="math-tex math-block" data-tex="([^"]*)"[^>]*>/g)].map((m) => [m[1], true]);
  return spans.concat(blocks);
}

function checkMath(all) {
  all.forEach(([raw, disp]) => {
    const tex = raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
    const err = tryRender(tex, disp);
    t('  ' + (disp ? '[块级] ' : '[行内] ') + tex.replace(/\s+/g, ' ').slice(0, 52), err === null, err);
  });
}

const index = JSON.parse(await readFile(resolve(ROOT, 'articles/index.json'), 'utf8'));
for (const entry of (index.articles || [])) {
  const art = JSON.parse(await readFile(resolve(ROOT, 'articles', entry.file), 'utf8'));
  const all = extractMath(art.body);
  if (!all.length) {
    console.log(`  --   《${art.title.slice(0, 16)}…》正文不含公式（该项不适用）`);
  } else {
    t(`《${art.title.slice(0, 16)}…》解析出公式`, true, '数量 ' + all.length);
  }
  checkMath(all);
}

// 3b) 内置样本：仓库文章随时可能增删，这一段保证「Markdown 取公式 → KaTeX 排版」
// 这条闭环永远被测到，不会因为博客被清空而静默失去覆盖。
console.log('\n== 内置样本（解析 → 排版闭环） ==');
const SAMPLE = [
  '# 公式样本', '',
  '行内：$E = mc^{2}$ 与 $\\frac{a}{b}$。', '',
  '块级：', '',
  '$$', '\\int_{-\\infty}^{+\\infty} e^{-x^{2}} \\,\\mathrm{d}x = \\sqrt{\\pi}', '$$', '',
  '矩阵：', '',
  '$$', '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', '$$'
].join('\n');
const sampleAll = extractMath(SAMPLE);
t('样本解析出行内公式 2 条', sampleAll.filter((x) => !x[1]).length === 2, JSON.stringify(sampleAll.map((x) => x[1])));
t('样本解析出块级公式 2 条', sampleAll.filter((x) => x[1]).length === 2, JSON.stringify(sampleAll.map((x) => x[1])));
checkMath(sampleAll);

// 4) 错误公式必须被检出（保证测试本身有效）
console.log('\n== 反向验证（确保测试能发现问题） ==');
t('错误公式会被检出', tryRender('\\frac{1}{', false) !== null);
t('未知命令会被检出', tryRender('\\notacommand{x}', false) !== null);

console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
