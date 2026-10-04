/* 临时测试：验证 parser 的容错解析与转义解包。node _test_parser.js */
require('../js/parser.js');
const JP = globalThis.JsonParser;

function assert(name, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '  >> ' + JSON.stringify(extra)));
  if (!cond) process.exitCode = 1;
}

// 1) 普通 JSON
let r = JP.parseRobust('{"code":200,"msg":"成功","ok":true,"list":[1,2,3],"x":null}');
assert('plain object', r.root.type === 'object' && r.layers === 0, r);

// 2) 被引号包裹的转义 JSON 字符串（接口日志典型）
let escaped = JSON.stringify('{"code":200,"msg":"查询成功","data":{"id":123}}');
r = JP.parseRobust(escaped);
assert('quoted escaped -> object', r.root.type === 'object' && r.layers === 1, { layers: r.layers, type: r.root.type });

// 3) 多层转义
let layer2 = JSON.stringify(JSON.stringify('{"a":1}'));
r = JP.parseRobust(layer2);
assert('double escaped -> object', r.root.type === 'object' && r.layers >= 1, { layers: r.layers, type: r.root.type });

// 4) 无外层引号、本身是转义形式
r = JP.parseRobust('{\\"code\\":200,\\"msg\\":\\"ok\\"}');
assert('raw-escaped no quotes', r.root.type === 'object' && r.layers >= 1, { layers: r.layers, type: r.root.type });

// 5) 容错：尾随逗号 + 注释
r = JP.parseRobust('{\n // comment\n "a": 1,\n "b": [1,2,],\n}');
assert('tolerant trailing+comments', r.root.type === 'object' && r.root.children.length === 2, r);

// 6) 数字精度保真 + 字符串原文保留
r = JP.parseRobust('{"big":12345678901234567890,"cn":"中文"}');
const bigRaw = r.root.children[0].value.raw;
const cnRaw = r.root.children[1].value.raw;
assert('big int raw preserved', bigRaw === '12345678901234567890', bigRaw);
assert('cn string raw preserved', cnRaw === '"中文"', cnRaw);

// 7) 非法 JSON 抛错带行号
let threw = false;
try { JP.parseRobust('{"a": }'); } catch (e) { threw = true; assert('error has line', typeof e.line === 'number', e); }
assert('invalid throws', threw);

// 8) 顶层数组
r = JP.parseRobust('[{"id":1},{"id":2}]');
assert('top-level array', r.root.type === 'array' && r.root.children.length === 2, r);

// 9) 顶层标量
r = JP.parseRobust('123');
assert('top-level number', r.root.type === 'number' && r.root.value === 123, r);

// 10) 转义字符串但不是 JSON（不应解包）
r = JP.parseRobust(JSON.stringify('hello world'));
assert('non-json string stays string', r.root.type === 'string' && r.layers === 0, r);

console.log('\ndone');
