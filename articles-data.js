/* 由 tools/build-articles.mjs 自动生成，请勿手工编辑。
 * 数据来源：articles/index.json + articles/<id>.json
 * 用途：让 index.html / articles.html / article.html
 *       以及 admin/ 下的本地管理系统在 file:// 协议下（不启动服务器）也能读取文章。
 * 变更文章后请重新运行：node tools/build-articles.mjs
 */
window.WJ_ARTICLES = [];
window.WJ_ARTICLES_BY_ID = {};
