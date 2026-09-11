// 下载 KaTeX 静态资源到 vendor/katex/（自托管，无第三方运行时请求）
// 用法: node tools/fetch-katex.mjs [version]
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const VERSION = process.argv[2] || '0.16.11';
const BASE = `https://cdn.jsdelivr.net/npm/katex@${VERSION}/dist`;
const ROOT = resolve(process.cwd(), 'vendor', 'katex');

const JS_FILES = [
  'katex.min.js',
  'contrib/auto-render.min.js',
  'contrib/copy-tex.min.js',
  'contrib/mhchem.min.js',
];

async function get(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function save(rel, buf) {
  const dest = join(ROOT, rel);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return { rel, bytes: buf.length };
}

async function main() {
  const results = [];
  for (const rel of JS_FILES) {
    results.push(await save(rel, await get(`${BASE}/${rel}`)));
  }

  const css = await get(`${BASE}/katex.min.css`);
  results.push(await save('katex.min.css', css));

  // 从 CSS 中解析字体引用，全部一并自托管（woff2 优先，woff/ttf 兜底）
  const cssText = css.toString('utf8');
  const fonts = [...new Set([...cssText.matchAll(/url\(([^)]+)\)/g)]
    .map((m) => m[1].replace(/["']/g, '').trim())
    .filter((u) => !u.startsWith('data:')))];
  if (fonts.length === 0) throw new Error('CSS 中未解析到字体引用');
  for (const f of fonts) {
    const rel = f.replace(/^\.\//, '');
    results.push(await save(rel, await get(`${BASE}/${rel}`)));
  }

  // 完整性校验：签名 + 体积，避免半截文件被当作成功
  const checks = [];
  for (const r of results) {
    const p = join(ROOT, r.rel);
    const s = await stat(p);
    const head = (await readFile(p)).subarray(0, 4);
    let sig = 'ok';
    if (/\.js$/.test(r.rel)) {
      const txt = await readFile(p, 'utf8');
      if (!/katex/i.test(txt)) sig = 'MISSING-MARKER';
    } else if (/\.css$/.test(r.rel)) {
      if (!/\.katex/.test(await readFile(p, 'utf8'))) sig = 'MISSING-MARKER';
    } else if (/\.woff2$/.test(r.rel)) {
      if (head.toString('latin1') !== 'wOF2') sig = 'BAD-SIGNATURE';
    } else if (/\.woff$/.test(r.rel)) {
      if (head.toString('latin1') !== 'wOFF') sig = 'BAD-SIGNATURE';
    } else if (/\.ttf$/.test(r.rel)) {
      if (head[0] !== 0x00 || head[1] !== 0x01) sig = 'BAD-SIGNATURE';
    }
    checks.push(`${sig === 'ok' ? '  ok ' : ' FAIL'} ${r.rel.padEnd(38)} ${String(s.size).padStart(8)} B  ${sig}`);
    if (sig !== 'ok') process.exitCode = 1;
  }

  console.log(`KaTeX ${VERSION} -> vendor/katex/`);
  console.log(checks.join('\n'));
  const total = results.reduce((a, r) => a + r.bytes, 0);
  console.log(`files=${results.length} total=${total} B (${(total / 1048576).toFixed(2)} MiB)`);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
