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
    "summary": "这是图片转文章的测试",
    "tags": [
      "测试"
    ],
    "cover": "articles/img/img-mtxzpwz7-4ds0lu.jpg",
    "format": "markdown",
    "status": "published",
    "pinned": false,
    "createdAt": "2026-09-12T06:37:27.909Z",
    "updatedAt": "2026-09-12T12:01:37.296Z",
    "body": "![黑底白字显示一条数学公式及三个系数](articles/img/img-mtxzpwz7-4ds0lu.jpg)\n\n$$\n\\frac{1}{\\pi} = 12\\sum_{n=0}^{\\infty}(-1)^{n}\\frac{(6n)!}{(n!)^{3}(3n)!}\\frac{A+Bn}{C^{3n+3/2}}\n$$\n\n$$\nA = 1657145277365 + 212175710912\\sqrt{61}\n$$\n\n$$\nB = 107578229802750 + 13773980892672\\sqrt{61}\n$$\n\n$$\nC = 5280\\left(236674 + 30303\\sqrt{61}\\right)\n$$\n"
  },
  {
    "id": "a-mtyc12fl-4nnqew",
    "slug": "集合子集性质的证明",
    "title": "集合子集性质的证明",
    "summary": "依次证明空集是任意集合的子集、子集关系的自反性与传递性，以及双向包含推出集合相等。",
    "tags": [
      "集合论",
      "子集",
      "数学证明",
      "空集",
      "传递性"
    ],
    "cover": "articles/img/img-mtyc0vm6-qewrv5.jpg",
    "format": "markdown",
    "status": "published",
    "pinned": false,
    "createdAt": "2026-09-12T11:59:13.041Z",
    "updatedAt": "2026-09-12T12:01:37.296Z",
    "body": "# 子集的性质证明\n\n## ① 证明空集是任意集合的子集。\n\n证明：∀x ∈ ∅ 都有 x ∈ A。\n\n∵ ∀x ∈ ∅ 不成立。∴ 此命题为真命题。证毕。\n\n## ② 证明 A ⊆ A（自反性）。\n\n∀x ∈ A 都有 x ∈ A 显然得证。\n\n## ③ 证明 A ⊆ B，B ⊆ C ⇒ A ⊆ C（传递性）。\n\n由 A ⊆ B ⇒ ∀x ∈ A 都有 x ∈ B。\n\n由 B ⊆ C ⇒ ∀x ∈ B 都有 x ∈ C。\n\n∴ ∀x ∈ A 都有 x ∈ C，∴ A ⊆ C 得证。\n\n## ④ 若 A ⊆ B，B ⊆ A，证明 A = B。\n\nA ⊆ B ⇒ ∀x ∈ A 都有 x ∈ B。\n\nB ⊆ A ⇒ ∀x ∈ B 都有 x ∈ A。\n\nA中任意元素都在B中\n\nB中任意元素都在B中\n\n∴ A = B 得证。\n"
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
    "body": "# 测试\n\n$$\ne^{i\\pi}+1=0\n$$\n"
  }
];
window.WJ_ARTICLES_BY_ID = {};
window.WJ_ARTICLES.forEach(function (a) { window.WJ_ARTICLES_BY_ID[a.id] = a; });
