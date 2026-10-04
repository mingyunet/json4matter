/*
 * parser.js — 复刻 WPF json4matter 的解析核心（纯前端、无依赖、可离线）。
 *
 * 1) 容错解析：容忍 // 与 /* *\/ 注释、尾随逗号（与 .NET JsonDocumentOptions 对齐）。
 * 2) 保留每个节点的原始文本（raw），序列化时保真（数字精度、字符串原文不被重排）。
 * 3) 自动解包转义 JSON 字符串：当整段是 "\"{\"code\":200}\"" 这种被序列化的字符串时，
 *    逐层剥开（最多 5 层），与 WPF JsonDocument.Parse 的 unwrap 行为一致。
 *    同时兼容「无外层引号、但本身是转义形式」的日志场景（如 {\"code\":200}）。
 */
(function (global) {
  'use strict';

  // 解析一段 JSON 文本，返回节点树。节点结构：
  //   { type:'object',  children:[{key, keyRaw, value}] }
  //   { type:'array',   children:[node], (每个 child 带 index) }
  //   { type:'string',  raw, value }      // raw 含引号，value 为解码后的字符串
  //   { type:'number',  raw, value }
  //   { type:'boolean', raw, value }
  //   { type:'null',    raw }
  function parse(text, options) {
    options = options || {};
    const allowComments = options.allowComments !== false;
    const allowTrailing = options.allowTrailing !== false;
    let i = 0;
    const n = text.length;

    function makeError(msg) {
      const line = text.slice(0, i).split('\n').length;
      const e = new Error(msg);
      e.line = line;
      return e;
    }

    function skipWs() {
      while (i < n) {
        const c = text[i];
        if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '\f' || c === '\v') {
          i++;
          continue;
        }
        if (allowComments && c === '/') {
          if (text[i + 1] === '/') {
            while (i < n && text[i] !== '\n') i++;
            continue;
          }
          if (text[i + 1] === '*') {
            i += 2;
            while (i + 1 < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
            i = Math.min(i + 2, n);
            continue;
          }
        }
        break;
      }
    }

    function parseValue() {
      skipWs();
      if (i >= n) throw makeError('输入不完整');
      const c = text[i];
      if (c === '{') return parseObject();
      if (c === '[') return parseArray();
      if (c === '"') return parseString();
      if (c === '-' || (c >= '0' && c <= '9')) return parseNumber();
      if (text.startsWith('true', i)) {
        const raw = 'true';
        i += raw.length;
        return { type: 'boolean', raw, value: true };
      }
      if (text.startsWith('false', i)) {
        const raw = 'false';
        i += raw.length;
        return { type: 'boolean', raw, value: false };
      }
      if (text.startsWith('null', i)) {
        const raw = 'null';
        i += raw.length;
        return { type: 'null', raw };
      }
      throw makeError("意外的符号 '" + c + "'");
    }

    function parseString() {
      const start = i;
      i++; // 起始引号
      let out = '';
      while (i < n) {
        const c = text[i];
        if (c === '\\') {
          i++;
          const e = text[i];
          switch (e) {
            case '"': out += '"'; break;
            case '\\': out += '\\'; break;
            case '/': out += '/'; break;
            case 'b': out += '\b'; break;
            case 'f': out += '\f'; break;
            case 'n': out += '\n'; break;
            case 'r': out += '\r'; break;
            case 't': out += '\t'; break;
            case 'u': {
              const hex = text.substr(i + 1, 4);
              if (/^[0-9a-fA-F]{4}$/.test(hex)) {
                out += String.fromCharCode(parseInt(hex, 16));
                i += 4;
              } else {
                out += 'u';
              }
              break;
            }
            default: out += e; break;
          }
          i++;
        } else if (c === '"') {
          i++; // 结束引号
          return { type: 'string', raw: text.slice(start, i), value: out };
        } else {
          out += c;
          i++;
        }
      }
      throw makeError('字符串未闭合');
    }

    function parseNumber() {
      const start = i;
      if (text[i] === '-') i++;
      while (i < n && text[i] >= '0' && text[i] <= '9') i++;
      if (text[i] === '.') {
        i++;
        while (i < n && text[i] >= '0' && text[i] <= '9') i++;
      }
      if (text[i] === 'e' || text[i] === 'E') {
        i++;
        if (text[i] === '+' || text[i] === '-') i++;
        while (i < n && text[i] >= '0' && text[i] <= '9') i++;
      }
      const raw = text.slice(start, i);
      const value = Number(raw);
      return { type: 'number', raw, value };
    }

    function parseObject() {
      const start = i;
      const node = { type: 'object', children: [] };
      i++; // {
      skipWs();
      if (text[i] === '}') {
        i++;
        node.raw = text.slice(start, i);
        return node;
      }
      while (true) {
        skipWs();
        if (text[i] !== '"') throw makeError('对象键必须是字符串');
        const keyNode = parseString();
        skipWs();
        if (text[i] !== ':') throw makeError("缺少 ':'");
        i++;
        const valNode = parseValue();
        node.children.push({ key: keyNode.value, keyRaw: keyNode.raw, value: valNode });
        skipWs();
        if (text[i] === ',') {
          i++;
          if (allowTrailing) {
            skipWs();
            if (text[i] === '}') { i++; break; }
          }
          continue;
        }
        if (text[i] === '}') { i++; break; }
        throw makeError("缺少 ',' 或 '}'");
      }
      node.raw = text.slice(start, i);
      return node;
    }

    function parseArray() {
      const start = i;
      const node = { type: 'array', children: [] };
      i++; // [
      skipWs();
      if (text[i] === ']') {
        i++;
        node.raw = text.slice(start, i);
        return node;
      }
      let idx = 0;
      while (true) {
        const valNode = parseValue();
        valNode.index = idx++;
        node.children.push(valNode);
        skipWs();
        if (text[i] === ',') {
          i++;
          if (allowTrailing) {
            skipWs();
            if (text[i] === ']') { i++; break; }
          }
          continue;
        }
        if (text[i] === ']') { i++; break; }
        throw makeError("缺少 ',' 或 ']'");
      }
      node.raw = text.slice(start, i);
      return node;
    }

    const root = parseValue();
    skipWs();
    if (i < n) throw makeError('存在多余字符');
    return root;
  }

  // 若根节点是字符串，尝试逐层解包其中的 JSON（最多 5 层）。
  // 返回 { node: 解包出的容器节点或 null, layers: 解包层数 }。
  // 逐层剥离：内部可能是对象/数组，也可能是又一层被转义的字符串（"\"{...}\""）。
  function unwrapStringLayers(str) {
    let layers = 0;
    let cur = str;
    while (layers < 5 && typeof cur === 'string') {
      const trimmed = cur.replace(/^\s+/, '');
      if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[' && trimmed[0] !== '"')) break;
      let node;
      try {
        node = parse(cur);
      } catch (e) {
        break;
      }
      if (node.type === 'string') {
        if (node.value === cur) break; // 无进展，防死循环
        cur = node.value;
        layers++;
        continue;
      }
      if (node.type === 'object' || node.type === 'array') {
        return { node: node, layers: layers + 1 };
      }
      break;
    }
    return { node: null, layers: layers };
  }

  // 统一入口：处理「合法 JSON」「被引号包裹的转义 JSON」「无外层引号的转义 JSON」三种情况。
  // 返回 { root, layers }，出错时抛带 .line 的错误。
  function parseRobust(text) {
    let root;
    let viaWrap = false;
    try {
      root = parse(text);
    } catch (e) {
      // 日志里常见：本身是转义形式、没有最外层引号 —— 当作 JSON 字符串字面量再解析一次。
      try {
        const asStr = JSON.parse('"' + text + '"');
        root = parse(asStr);
        viaWrap = true;
      } catch (e2) {
        throw e; // 抛出最初的错误，提示更准确
      }
    }

    let layers = 0;
    if (root.type === 'string') {
      const r = unwrapStringLayers(root.value);
      if (r.node) {
        root = r.node;
        layers = r.layers;
      }
    }
    if (viaWrap && layers === 0) layers = 1; // 仅靠外层包裹还原，也算解包一层
    return { root, layers };
  }

  global.JsonParser = {
    parse: parse,
    unwrapStringLayers: unwrapStringLayers,
    parseRobust: parseRobust,
  };
})(typeof window !== 'undefined' ? window : globalThis);
