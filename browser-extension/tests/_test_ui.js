/* 临时 UI 冒烟测试（jsdom）。NODE_PATH 指向已装 jsdom 的工作区。
   node _test_ui.js  */
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra !== undefined ? '  >> ' + JSON.stringify(extra) : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace(/<link[^>]*>/g, '')
  .replace(/<script[^>]*src=[^>]*><\/script>/g, '');

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
});

const { window } = dom;
const doc = window.document;
window.HTMLElement.prototype.scrollIntoView = function () {};

// 手动注入脚本（避免 jsdom 去网络拉取）
for (const f of ['js/parser.js', 'js/app.js']) {
  const s = doc.createElement('script');
  s.textContent = fs.readFileSync(path.join(root, f), 'utf8');
  doc.body.appendChild(s);
}

Promise.resolve().then(() => {
  const input = doc.querySelector('#input');
  const statusText = doc.querySelector('#statusText');

  function type(text) {
    input.value = text;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  }
  const keys = () => Array.from(doc.querySelectorAll('.node-row')).map((r) => {
    const k = r.querySelector('.key');
    return k ? k.textContent : '';
  });
  const rowByKey = (key) => Array.from(doc.querySelectorAll('.node-row'))
    .find((r) => { const k = r.querySelector('.key'); return k && k.textContent === key; });

  async function run() {
    await sleep(250);

    // 1) 普通对象
    type('{"code":200,"msg":"成功","list":[1,2,3],"nested":{"a":true,"b":null}}');
    await sleep(400);
    ok('status ok', /\u2714 解析成功/.test(statusText.textContent), statusText.textContent);
    const codeRow = rowByKey('code');
    ok('code row exists', !!codeRow);
    ok('code value number-colored', !!(codeRow && codeRow.querySelector('.val-number')), codeRow && codeRow.innerHTML);
    ok('code value text 200', !!(codeRow && codeRow.querySelector('.val-number').textContent === '200'));
    const msgRow = rowByKey('msg');
    ok('msg string-colored', !!(msgRow && msgRow.querySelector('.val-string')));
    ok('msg escaped quotes', !!(msgRow && msgRow.querySelector('.val-string').textContent === '"成功"'));
    const listRow = rowByKey('list');
    ok('array count badge [3]', !!(listRow && listRow.querySelector('.count') && listRow.querySelector('.count').textContent === '[3]'));
    ok('array collapsed by default (no [0] child row)', !keys().includes('[0]'));
    const bRow = rowByKey('b');
    ok('null value italic class', !!(bRow && bRow.querySelector('.val-null')));
    const aRow = rowByKey('a');
    ok('bool colored', !!(aRow && aRow.querySelector('.val-bool')));

    // 2) 转义 JSON 字符串自动解包（接口日志场景）
    type(JSON.stringify('{"code":200,"data":{"id":9}}'));
    await sleep(400);
    ok('unwrap status text', /\u5df2\u89e3\u5305 1 \u5c42/.test(statusText.textContent), statusText.textContent);
    ok('unwrapped has code row', !!rowByKey('code'));

    // 3) 字段值内嵌转义 JSON → 虚拟子树
    type('{"payload":"{\\"inner\\":123}"}');
    await sleep(400);
    ok('embedded json virtual child', !!rowByKey('inner'));

    // 4) 隐藏空值
    const hide = doc.querySelector('#hideEmpty');
    hide.checked = true;
    hide.dispatchEvent(new window.Event('change', { bubbles: true }));
    type('{"a":1,"b":null,"c":"","d":[],"e":{}}');
    await sleep(400);
    const kk = keys();
    ok('hideEmpty keeps a only', kk.length === 2 && kk.includes('a'), kk);

    // 5) 压缩（转 Unicode）
    hide.checked = false;
    hide.dispatchEvent(new window.Event('change', { bubbles: true }));
    type('{"cn":"中文","n":1}');
    await sleep(400);
    doc.querySelector('#btnMinify').click();
    await sleep(400);
    ok('minify to unicode', input.value.indexOf('\\u4E2D\\u6587') >= 0, input.value);
    ok('minify compact no spaces', input.value.indexOf(' ') < 0, input.value);

    // 6) 压缩原文（保留中文）
    type('{"cn":"中文","n":1}');
    await sleep(400);
    doc.querySelector('#btnMinifyRaw').click();
    await sleep(400);
    ok('minify raw keeps chinese', input.value.indexOf('中文') >= 0, input.value);

    // 7) 搜索（键）
    type('{"userName":"alice","orderId":7}');
    await sleep(400);
    const sb = doc.querySelector('#searchBox');
    sb.value = 'name';
    doc.querySelector('#btnSearchKey').click();
    await sleep(100);
    ok('search hit exists', !!doc.querySelector('.search-hit'));
    ok('search status 1 match', /1 \u4e2a\u5339\u914d/.test(statusText.textContent), statusText.textContent);

    // 8) 展开全部 / 折叠全部
    type('{"a":{"b":{"c":1}}}');
    await sleep(400);
    doc.querySelector('#btnExpand').click();
    await sleep(100);
    const expandedCount = doc.querySelectorAll('.node-row').length;
    doc.querySelector('#btnCollapse').click();
    await sleep(100);
    const collapsedCount = doc.querySelectorAll('.node-row').length;
    ok('expand > collapse rows', expandedCount > collapsedCount, { expandedCount, collapsedCount });

    // 9) 主题切换
    const ts = doc.querySelector('#themeSelect');
    ts.value = 'paper';
    ts.dispatchEvent(new window.Event('change', { bubbles: true }));
    await sleep(50);
    ok('theme applied', doc.documentElement.getAttribute('data-theme') === 'paper');

    console.log('\nUI tests: ' + pass + ' passed, ' + fail + ' failed');
    process.exitCode = fail ? 1 : 0;
    dom.window.close();
  }

  setTimeout(run, 50);
}).catch((e) => { console.error('jsdom error', e); process.exitCode = 2; });
