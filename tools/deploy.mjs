// 生成"只会被公开"的部署目录，并校验本地管理系统没有混进去。
//
// 用法:
//   node tools/deploy.mjs [--out deploy] [--clean]
//
// 设计：白名单而不是黑名单 —— 只拷贝下面 PUBLIC 里列出的东西，其余一律不进部署目录。
// 拷贝完还会做一次"反向扫描"，确认 deploy/ 里没有 admin/、tools/ 的痕迹，以及没有
// 指向它们的链接。这样即使以后新增了别的本地文件，也不会被误发到服务器。
import { readdir, mkdir, copyFile, stat, rm, readFile } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
function flagValue(name, dflt) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
}
const OUT_NAME = flagValue('--out', 'deploy');
const OUT = resolve(ROOT, OUT_NAME);
const CLEAN = args.includes('--clean');

/* 公开内容白名单：相对仓库根目录 */
const PUBLIC_FILES = [
  'index.html',
  'articles.html',
  'article.html',
  'articles-data.js',
  'robots.txt',
  'sitemap.xml',
  '.nojekyll'
];
const PUBLIC_DIRS = [
  'assets/css',
  'assets/js',
  'articles',
  'vendor/katex'
];

/* 绝不允许出现在部署目录里的东西（用于反向校验） */
const FORBIDDEN = ['admin', 'tools'];

let copied = 0, bytes = 0;
const problems = [];

async function exists(p) { return stat(p).then(() => true, () => false); }

async function copyFileTracked(src, dest) {
  const s = await stat(src);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
  copied++;
  bytes += s.size;
}

async function copyDir(srcDir, destDir) {
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const e of entries) {
    const src = join(srcDir, e.name);
    const dest = join(destDir, e.name);
    if (e.isDirectory()) await copyDir(src, dest);
    else if (e.isFile()) await copyFileTracked(src, dest);
  }
}

async function main() {
  console.log('部署目录: ' + relative(ROOT, OUT) + (CLEAN ? '（先清空）' : ''));
  if (!(await exists(OUT))) await mkdir(OUT, { recursive: true });
  else if (CLEAN) { await rm(OUT, { recursive: true, force: true }); await mkdir(OUT, { recursive: true }); }

  console.log('\n== 拷贝公开文件（白名单） ==');
  for (const f of PUBLIC_FILES) {
    const src = join(ROOT, f);
    if (!(await exists(src))) { console.log('  --   ' + f + '（不存在，跳过）'); continue; }
    await copyFileTracked(src, join(OUT, f));
    console.log('  ok   ' + f);
  }
  for (const d of PUBLIC_DIRS) {
    const src = join(ROOT, d);
    if (!(await exists(src))) { console.log('  --   ' + d + '/（不存在，跳过）'); continue; }
    await copyDir(src, join(OUT, d));
    console.log('  ok   ' + d + '/');
  }

  console.log('\n== 隔离校验 ==');
  // 1) 禁止目录不得存在
  for (const f of FORBIDDEN) {
    const p = join(OUT, f);
    if (await exists(p)) problems.push('部署目录里出现了 ' + f + '/');
  }
  if (!problems.length) console.log('  ok   不含 ' + FORBIDDEN.map((f) => f + '/').join('、'));

  // 2) 部署目录里不得有指向本地系统的链接
  const LINK_RE = /(?:href|src)\s*=\s*["'](\.\.\/)?(admin|tools)\//i;
  const SELF_TEST_RE = /selftest\.html|editor\.html/i;
  async function scan(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { await scan(p); continue; }
      if (!/\.(html|js|css|json)$/.test(e.name)) continue;
      const txt = await readFile(p, 'utf8');
      if (LINK_RE.test(txt)) problems.push(relative(ROOT, p) + ' 里含指向 admin/ 或 tools/ 的链接');
      if (e.name.endsWith('.html') && SELF_TEST_RE.test(txt)) {
        // 仅警告：文章正文里偶尔会提到这些名字，不算部署问题
        console.log('  note ' + relative(ROOT, p) + ' 提到 editor/selftest 字样（若是可见链接请检查）');
      }
    }
  }
  await scan(OUT);
  if (!problems.length) console.log('  ok   部署文件里没有指向本地系统的链接');

  // 3) 公开页面必须能自我运行（存在 index.html）
  if (!(await exists(join(OUT, 'index.html')))) problems.push('部署目录缺少 index.html');

  console.log('\n== 结果 ==');
  console.log('  文件: ' + copied + ' 个，共 ' + (bytes / 1048576).toFixed(2) + ' MiB');
  if (problems.length) {
    console.log('\n发现问题：');
    problems.forEach((p) => console.log('  ✗ ' + p));
    process.exitCode = 1;
  } else {
    console.log('  ✅ 隔离校验通过：部署目录只含公开内容');
    console.log('\n预览：直接双击 ' + relative(ROOT, join(OUT, 'index.html')));
    console.log('发布：把该目录内容推送到 GitHub Pages（或用它做 CI 的产物目录）');
  }
}

main().catch((e) => { console.error('失败：' + (e.stack || e.message)); process.exit(1); });
