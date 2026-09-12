/* 由 tools/build-articles.mjs 或后台「一键发布」自动生成，请勿手工编辑。
 * 数据来源：articles/index.json + articles/<id>.json
 * 用途：让 index.html / articles.html / article.html
 *       以及 admin/ 下的本地管理系统在 file:// 协议下（不启动服务器）也能读取文章。
 * 变更文章后请重新运行：node tools/build-articles.mjs（或在后台「发布」里点一键发布）
 */
window.WJ_ARTICLES = [
  {
    "id": "a-mty0jahx-r9y44e",
    "slug": "图片转文章测试",
    "title": "图片转文章测试",
    "summary": "这是一篇测试文章",
    "tags": [
      "测试"
    ],
    "cover": "articles/img/img-mtxzpwz7-4ds0lu.jpg",
    "format": "markdown",
    "status": "published",
    "pinned": false,
    "createdAt": "2026-09-12T06:37:27.909Z",
    "updatedAt": "2026-09-12T07:18:12.094Z",
    "file": "a-mty0jahx-r9y44e.json",
    "body": "![黑底白字显示一条数学公式及三个系数](articles/img/img-mtxzpwz7-4ds0lu.jpg)\n\n$$\n\\frac{1}{\\pi} = 12\\sum_{n=0}^{\\infty}(-1)^{n}\\frac{(6n)!}{(n!)^{3}(3n)!}\\frac{A+Bn}{C^{3n+3/2}}\n$$\n\n$$\nA = 1657145277365 + 212175710912\\sqrt{61}\n$$\n\n$$\nB = 107578229802750 + 13773980892672\\sqrt{61}\n$$\n\n$$\nC = 5280\\left(236674 + 30303\\sqrt{61}\\right)\n$$\n"
  },
  {
    "id": "a-mtx68wqc-szh7gt",
    "slug": "测试",
    "title": "测试",
    "summary": "这是测试文章",
    "tags": [
      "测试"
    ],
    "cover": "",
    "format": "markdown",
    "status": "published",
    "pinned": false,
    "createdAt": "2026-09-11T16:29:35.028Z",
    "updatedAt": "2026-09-11T16:32:34.966Z",
    "file": "a-mtx68wqc-szh7gt.json",
    "body": "# 测试\n\n$$\ne^{i\\pi}+1=0\n$$\n"
  }
];
window.WJ_ARTICLES_BY_ID = {};
window.WJ_ARTICLES.forEach(function (a) { window.WJ_ARTICLES_BY_ID[a.id] = a; });
