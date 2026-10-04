/*
 * app.js — json4matter 浏览器版的界面与交互。
 * 复刻 WPF 版的核心能力：粘贴即解析、树形着色、数组折叠标数、展开/折叠、
 * 搜索（键/值）、复制、两种压缩、隐藏空值、三主题、状态栏，以及最关键的
 * 「整段转义 JSON 自动解包」。
 */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  const input = $('#input');
  const treeEl = $('#tree');
  const emptyHint = $('#emptyHint');
  const statusText = $('#statusText');
  const sizeText = $('#sizeText');
  const treeMeta = $('#treeMeta');
  const toastEl = $('#toast');
  const searchBox = $('#searchBox');
  const themeSelect = $('#themeSelect');
  const fontSizeRange = $('#fontSize');
  const hideEmptyBox = $('#hideEmpty');

  const isPanel = new URLSearchParams(location.search).has('panel');

  // 在扩展环境用 chrome.storage；直接用浏览器打开 index.html 时退回 localStorage，
  // 这样一个页面既能当插件弹窗，也能当独立网页预览/调试。
  const storage = (function () {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return chrome.storage.local;
    }
    return {
      get(keys, cb) {
        const res = {};
        const arr = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
        for (const k of arr) {
          const v = localStorage.getItem('j4m:' + k);
          if (v != null) { try { res[k] = JSON.parse(v); } catch (e) { res[k] = v; } }
        }
        if (cb) cb(res);
      },
      set(obj, cb) {
        for (const k in obj) localStorage.setItem('j4m:' + k, JSON.stringify(obj[k]));
        if (cb) cb();
      },
      remove(keys, cb) {
        const arr = Array.isArray(keys) ? keys : [keys];
        for (const k of arr) localStorage.removeItem('j4m:' + k);
        if (cb) cb();
      },
    };
  })();

  const SAMPLE = `{
  "code": 200,
  "message": "查询成功",
  "success": true,
  "data": {
    "schoolName": "阳光实验中学",
    "schoolCode": "YGSY-2026-001",
    "address": "海淀区学院路88号",
    "totalTeachers": 126,
    "totalStudents": 1860,
    "hasBoarding": true,
    "remark": null,
    "tags": [],
    "gradeList": [
      {
        "gradeId": 7,
        "gradeName": "初一年级",
        "headTeacher": "王建国",
        "studentCount": 620,
        "classList": [
          {"classId": "C0701", "className": "初一（1）班", "teacher": "李小红", "studentCount": 45, "subjects": ["语文", "数学", "英语", "生物"]},
          {"classId": "C0702", "className": "初一（2）班", "teacher": "赵强", "studentCount": 44, "subjects": ["语文", "数学", "英语"]}
        ]
      },
      {
        "gradeId": 8,
        "gradeName": "初二年级",
        "headTeacher": "刘芳",
        "studentCount": 640,
        "classList": []
      }
    ]
  }
}`;

  /** @type {{rawRoot:object|null, rootVM:object|null, hideEmpty:boolean, selectedVM:object|null, searchByKey:boolean}} */
  const state = {
    rawRoot: null,
    rootVM: null,
    hideEmpty: false,
    selectedVM: null,
    searchByKey: true,
  };

  let debounceTimer = null;
  let toastTimer = null;

  // ---------- 状态栏 / Toast ----------

  function setStatus(kind, msg) {
    statusText.className = 'status-text status-' + kind;
    statusText.textContent = msg;
  }

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 900);
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }

  // ---------- 解析 ----------

  function scheduleParse(delay) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runParse, delay == null ? 280 : delay);
  }

  function runParse() {
    const text = input.value;
    if (!text.trim()) {
      clearAll();
      setStatus('neutral', '就绪 — 在左侧粘贴 JSON 后自动解析');
      return;
    }

    setStatus('neutral', '解析中…');
    const t0 = performance.now();
    let parsed;
    try {
      parsed = JsonParser.parseRobust(text);
    } catch (err) {
      // 解析失败：保留上一次的树，仅提示错误，方便修改后重试
      const line = err && err.line ? err.line : '?';
      setStatus('err', '✖ JSON 语法错误（第 ' + line + ' 行）：' + err.message);
      return;
    }
    const ms = Math.max(0, Math.round(performance.now() - t0));

    state.rawRoot = parsed.root;
    const nodeCount = countNodes(parsed.root);
    state.rootVM = buildVM(parsed.root, 'JSON', true, state.hideEmpty);
    const limit = nodeCount > 6000 ? 1 : nodeCount > 1500 ? 3 : 12;
    applyExpand(state.rootVM, 0, limit);
    state.selectedVM = null;

    emptyHint.style.display = 'none';
    treeEl.style.display = '';
    renderTree();

    const bytes = new Blob([text]).size;
    sizeText.textContent = text.length.toLocaleString() + ' 字符 · ' + formatSize(bytes);
    treeMeta.textContent = nodeCount.toLocaleString() + ' 节点';

    let msg = '✔ 解析成功 · ' + nodeCount.toLocaleString() + ' 个节点 · ' + ms + ' ms';
    if (parsed.layers > 0) msg += '（已解包 ' + parsed.layers + ' 层转义字符串）';
    setStatus('ok', msg);

    persistInput(text);
  }

  function clearAll() {
    state.rawRoot = null;
    state.rootVM = null;
    state.selectedVM = null;
    treeEl.innerHTML = '';
    treeEl.style.display = 'none';
    emptyHint.style.display = '';
    treeMeta.textContent = '';
    sizeText.textContent = '';
  }

  function countNodes(node) {
    if (node.type === 'object') {
      let c = 1;
      for (const ch of node.children) c += countNodes(ch.value);
      return c;
    }
    if (node.type === 'array') {
      let c = 1;
      for (const ch of node.children) c += countNodes(ch);
      return c;
    }
    return 1;
  }

  // ---------- 视图模型 ----------

  function buildVM(node, key, isRoot, hideEmpty) {
    const vm = {
      key: key,
      isRoot: !!isRoot,
      node: node,
      kind: node.type,
      children: [],
      isArray: node.type === 'array',
      isObject: node.type === 'object',
      isScalar: node.type !== 'object' && node.type !== 'array',
      isArrayItem: false,
      virtual: false,
      isExpanded: false,
      searchHitKey: false,
      searchHitValue: false,
      parent: null,
    };

    if (node.type === 'object' || node.type === 'array') {
      for (const ch of node.children) {
        const childKey = node.type === 'array' ? '[' + ch.index + ']' : ch.key;
        const childNode = node.type === 'array' ? ch : ch.value;
        const child = buildVM(childNode, childKey, false, hideEmpty);
        child.isArrayItem = node.type === 'array';
        child.parent = vm;
        if (hideEmpty && !hasContent(child)) continue;
        vm.children.push(child);
      }
    } else {
      vm.scalarRaw = node.raw;
      vm.scalarValue = node.value;
      // 字段值本身就是 JSON 字符串（转义 JSON）→ 生成可展开的虚拟子树
      if (node.type === 'string' && typeof node.value === 'string') {
        const t = node.value.replace(/^\s+/, '');
        if (t[0] === '{' || t[0] === '[') {
          try {
            const inner = JsonParser.parse(node.value);
            if (inner.type === 'object' || inner.type === 'array') {
              const vchild = buildVM(inner, '', false, hideEmpty);
              vm.children = vchild.children;
              vm.isObject = inner.type === 'object';
              vm.isArray = inner.type === 'array';
              vm.virtual = true;
            }
          } catch (e) { /* 非合法 JSON，按普通字符串处理 */ }
        }
      }
    }
    return vm;
  }

  function hasContent(vm) {
    if (vm.children.length > 0) return true;
    if (vm.isScalar) {
      const raw = vm.scalarRaw;
      return !(raw === 'null' || raw === '""');
    }
    return false; // 空对象 / 空数组
  }

  function applyExpand(vm, depth, limit) {
    vm.isExpanded = depth < limit && (!vm.isArray || depth === 0);
    for (const c of vm.children) applyExpand(c, depth + 1, limit);
  }

  function setAllExpanded(vm, expanded) {
    vm.isExpanded = expanded;
    for (const c of vm.children) setAllExpanded(c, expanded);
  }

  // ---------- 渲染 ----------

  function renderTree() {
    const st = treeEl.scrollTop;
    treeEl.innerHTML = '';
    if (state.rootVM) {
      const frag = document.createDocumentFragment();
      renderNode(state.rootVM, 0, frag);
      treeEl.appendChild(frag);
    }
    treeEl.scrollTop = st;
    applySelection();
  }

  function renderNode(vm, depth, parent) {
    const hasChildren = vm.children.length > 0;

    const row = document.createElement('div');
    row.className = 'node-row';
    row.__vm = vm;

    if (depth > 0) {
      const indent = document.createElement('span');
      indent.className = 'indent';
      indent.style.width = (depth * 16) + 'px';
      row.appendChild(indent);
    }

    const caret = document.createElement('span');
    caret.className = 'toggle-caret' + (hasChildren ? ' has-children' : ' leaf') + (vm.isExpanded ? ' expanded' : '');
    caret.textContent = '▸';
    if (hasChildren) {
      caret.addEventListener('click', (e) => {
        e.stopPropagation();
        vm.isExpanded = !vm.isExpanded;
        selectNode(vm);
        renderTree();
      });
    }
    row.appendChild(caret);

    // key
    const keyEl = document.createElement('span');
    if (vm.isRoot) {
      keyEl.className = 'key key-root';
      keyEl.textContent = 'JSON';
    } else {
      keyEl.className = 'key' + (vm.isArrayItem ? ' key-index' : '');
      keyEl.textContent = vm.key;
      if (vm.searchHitKey) keyEl.classList.add('search-hit');
    }
    row.appendChild(keyEl);

    if (!vm.isRoot) {
      const colon = document.createElement('span');
      colon.className = 'colon';
      colon.textContent = ': ';
      row.appendChild(colon);
    }

    // value / summary
    const valueEl = document.createElement('span');
    if (vm.virtual) {
      // 字符串字段本身是 JSON：显示转义文本，同时可展开下钻
      valueEl.className = 'val val-string';
      const full = escapeStr(vm.scalarValue == null ? '' : vm.scalarValue);
      valueEl.textContent = full.length > 300 ? full.slice(0, 296) + '…' : full;
      if (full.length > 300) valueEl.title = full.slice(0, 5000);
    } else if (vm.isArray) {
      valueEl.className = 'count';
      valueEl.textContent = '[' + vm.children.length + ']';
    } else if (vm.isObject) {
      valueEl.className = 'summary empty-obj';
      valueEl.textContent = vm.children.length ? '{…}' : '{}';
    } else {
      valueEl.className = 'val val-' + (vm.kind === 'boolean' ? 'bool' : vm.kind);
      const text = displayScalar(vm);
      valueEl.textContent = text.length > 300 ? text.slice(0, 296) + '…' : text;
      if (text.length > 300) valueEl.title = text.slice(0, 5000);
      if (vm.searchHitValue) valueEl.classList.add('search-hit');
    }
    row.appendChild(valueEl);

    row.addEventListener('click', () => {
      selectNode(vm);
      renderTree();
    });
    row.addEventListener('dblclick', () => {
      if (hasChildren) {
        vm.isExpanded = !vm.isExpanded;
        selectNode(vm);
        renderTree();
      }
    });

    parent.appendChild(row);

    if (hasChildren && vm.isExpanded) {
      for (const c of vm.children) renderNode(c, depth + 1, parent);
    }
  }

  function displayScalar(vm) {
    switch (vm.kind) {
      case 'string': return escapeStr(vm.scalarValue == null ? '' : vm.scalarValue);
      case 'null': return 'null';
      default: return vm.scalarRaw;
    }
  }

  function escapeStr(s) {
    let out = '"';
    for (const ch of s) {
      switch (ch) {
        case '"': out += '\\"'; break;
        case '\\': out += '\\\\'; break;
        case '\n': out += '\\n'; break;
        case '\r': out += '\\r'; break;
        case '\t': out += '\\t'; break;
        case '\b': out += '\\b'; break;
        case '\f': out += '\\f'; break;
        default: {
          const code = ch.codePointAt(0);
          if (code < 0x20) out += '\\u' + code.toString(16).padStart(4, '0');
          else out += ch;
        }
      }
    }
    return out + '"';
  }

  // ---------- 选中 / 子树高亮 ----------

  function selectNode(vm) {
    state.selectedVM = vm;
    const path = describePath(vm);
    setStatus('ok', '已选：' + (path || 'JSON'));
  }

  function describePath(vm) {
    const parts = [];
    let cur = vm;
    while (cur && !cur.isRoot) {
      parts.unshift(cur.key);
      cur = cur.parent;
    }
    return parts.join(' › ');
  }

  function applySelection() {
    const sel = state.selectedVM;
    const set = new Set();
    if (sel) collectSubtree(sel, set);
    const rows = treeEl.querySelectorAll('.node-row');
    for (const row of rows) {
      const vm = row.__vm;
      row.classList.remove('selected', 'subtree');
      if (!sel) continue;
      if (vm === sel) row.classList.add('selected');
      else if (set.has(vm)) row.classList.add('subtree');
    }
  }

  function collectSubtree(vm, set) {
    set.add(vm);
    for (const c of vm.children) collectSubtree(c, set);
    return set;
  }

  // ---------- 搜索 ----------

  function runSearch(byKey) {
    state.searchByKey = byKey;
    const q = searchBox.value.trim();
    if (!state.rootVM) { setStatus('neutral', '无内容可搜索'); return; }
    if (!q) { clearSearch(); return; }

    const lower = q.toLowerCase();
    let hits = 0;
    (function walk(vm) {
      let hit = false;
      if (byKey) {
        hit = !!vm.key && vm.key.toLowerCase().indexOf(lower) >= 0;
        vm.searchHitKey = hit;
      } else {
        hit = vm.isScalar && displayScalar(vm).toLowerCase().indexOf(lower) >= 0;
        vm.searchHitValue = hit;
      }
      if (hit) hits++;
      let childHit = false;
      for (const c of vm.children) {
        if (walk(c)) childHit = true;
      }
      if (childHit) vm.isExpanded = true; // 展开命中节点的祖先链
      return hit || childHit;
    })(state.rootVM);

    renderTree();
    const first = treeEl.querySelector('.search-hit');
    if (first) first.scrollIntoView({ block: 'center' });

    setStatus(hits > 0 ? 'ok' : 'err',
      (byKey ? '键' : '值') + '搜索「' + q + '」：' + (hits > 0 ? hits + ' 个匹配' : '无匹配'));
  }

  function clearSearch() {
    if (state.rootVM) {
      (function clear(vm) {
        vm.searchHitKey = false;
        vm.searchHitValue = false;
        for (const c of vm.children) clear(c);
      })(state.rootVM);
      renderTree();
    }
    setStatus('neutral', '已清除搜索高亮');
  }

  // ---------- 序列化（保真，尽量用原始文本） ----------

  function serializePretty(node, level) {
    level = level || 0;
    const ind = '  ';
    if (node.type === 'object') {
      if (!node.children.length) return '{}';
      const lines = node.children.map((ch) =>
        ind.repeat(level + 1) + ch.keyRaw + ': ' + serializePretty(ch.value, level + 1));
      return '{\n' + lines.join('\n') + '\n' + ind.repeat(level) + '}';
    }
    if (node.type === 'array') {
      if (!node.children.length) return '[]';
      const lines = node.children.map((ch) => ind.repeat(level + 1) + serializePretty(ch, level + 1));
      return '[\n' + lines.join('\n') + '\n' + ind.repeat(level) + ']';
    }
    return node.raw;
  }

  function serializeCompact(node) {
    if (node.type === 'object') {
      if (!node.children.length) return '{}';
      return '{' + node.children.map((ch) => ch.keyRaw + ':' + serializeCompact(ch.value)).join(',') + '}';
    }
    if (node.type === 'array') {
      if (!node.children.length) return '[]';
      return '[' + node.children.map((ch) => serializeCompact(ch)).join(',') + ']';
    }
    return node.raw;
  }

  function toJS(node) {
    if (node.type === 'object') {
      const o = {};
      for (const ch of node.children) o[ch.key] = toJS(ch.value);
      return o;
    }
    if (node.type === 'array') return node.children.map((c) => toJS(c));
    if (node.type === 'string') return node.value;
    if (node.type === 'number') return node.value;
    if (node.type === 'boolean') return node.value;
    return null;
  }

  function escapeNonAscii(s) {
    return s.replace(/[^\x00-\x7F]/g, (c) => {
      return '\\u' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
    });
  }

  // ---------- 工具栏动作 ----------

  function onFormat() {
    if (state.rawRoot) {
      input.value = serializePretty(state.rawRoot, 0);
      runParse();
      setStatus('ok', '已格式化源码');
    } else {
      runParse();
    }
  }

  function onMinify() {
    if (!state.rawRoot) { setStatus('neutral', '无可压缩内容'); return; }
    input.value = escapeNonAscii(JSON.stringify(toJS(state.rawRoot)));
    runParse();
    setStatus('ok', '已压缩（中文转 Unicode）');
  }

  function onMinifyRaw() {
    if (!state.rawRoot) { setStatus('neutral', '无可压缩内容'); return; }
    input.value = serializeCompact(state.rawRoot);
    runParse();
    setStatus('ok', '已压缩（保留中文原文）');
  }

  function onCopy() {
    const text = state.rawRoot ? serializePretty(state.rawRoot, 0) : input.value;
    if (!text) return;
    const done = () => { showToast('✔ 复制成功'); setStatus('ok', '已复制到剪贴板'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { setStatus('err', '复制失败'); }
    document.body.removeChild(ta);
  }

  function onExpandAll() {
    if (!state.rootVM) return;
    setAllExpanded(state.rootVM, true);
    renderTree();
    setStatus('ok', '已展开全部');
  }

  function onCollapseAll() {
    if (!state.rootVM) return;
    setAllExpanded(state.rootVM, false);
    state.rootVM.isExpanded = true; // 保留根节点展开
    renderTree();
    setStatus('ok', '已折叠全部');
  }

  function onSample() {
    input.value = SAMPLE;
    runParse();
  }

  function onClear() {
    input.value = '';
    clearAll();
    setStatus('neutral', '已清空');
    input.focus();
    persistInput('');
  }

  function onHideEmpty() {
    state.hideEmpty = hideEmptyBox.checked;
    storage.set({ hideEmpty: state.hideEmpty });
    if (!state.rawRoot) return;
    state.rootVM = buildVM(state.rawRoot, 'JSON', true, state.hideEmpty);
    const limit = countNodes(state.rawRoot) > 6000 ? 1 : countNodes(state.rawRoot) > 1500 ? 3 : 12;
    applyExpand(state.rootVM, 0, limit);
    state.selectedVM = null;
    renderTree();
    setStatus('ok', state.hideEmpty ? '已隐藏 null 值和空容器' : '已显示全部字段');
  }

  // ---------- 设置（主题 / 字号 / 输入缓存） ----------

  function persistInput(text) {
    // 仅缓存合适大小的输入，避免 storage 膨胀
    if (text.length > 400000) return;
    storage.set({ lastInput: text });
  }

  function applyTheme(id) {
    document.documentElement.setAttribute('data-theme', id);
  }

  function applyFontSize(px) {
    document.documentElement.style.setProperty('--font-size', px + 'px');
  }

  function loadSettings() {
    storage.get(['theme', 'fontSize', 'hideEmpty', 'lastInput', 'pendingText'], (res) => {
      const theme = res.theme || 'green';
      applyTheme(theme);
      themeSelect.value = theme;

      const fs = res.fontSize || 13;
      applyFontSize(fs);
      fontSizeRange.value = fs;

      state.hideEmpty = !!res.hideEmpty;
      hideEmptyBox.checked = state.hideEmpty;

      // 右键菜单送来的选中文本优先
      if (res.pendingText && res.pendingText.trim()) {
        input.value = res.pendingText;
        storage.remove('pendingText');
        runParse();
      } else if (res.lastInput) {
        input.value = res.lastInput;
        runParse();
      } else {
        input.focus();
      }
    });
  }

  // ---------- 事件绑定 ----------

  input.addEventListener('input', () => scheduleParse(280));

  $('#btnFormat').addEventListener('click', onFormat);
  $('#btnMinify').addEventListener('click', onMinify);
  $('#btnMinifyRaw').addEventListener('click', onMinifyRaw);
  $('#btnCopy').addEventListener('click', onCopy);
  $('#btnExpand').addEventListener('click', onExpandAll);
  $('#btnCollapse').addEventListener('click', onCollapseAll);
  $('#btnSample').addEventListener('click', onSample);
  $('#btnClear').addEventListener('click', onClear);
  hideEmptyBox.addEventListener('change', onHideEmpty);

  $('#btnSearchKey').addEventListener('click', () => runSearch(true));
  $('#btnSearchValue').addEventListener('click', () => runSearch(false));
  searchBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { runSearch(state.searchByKey); e.preventDefault(); }
    else if (e.key === 'Escape') { searchBox.value = ''; clearSearch(); e.preventDefault(); }
  });
  searchBox.addEventListener('input', () => {
    if (searchBox.value.length === 0) clearSearch();
  });

  themeSelect.addEventListener('change', () => {
    applyTheme(themeSelect.value);
    storage.set({ theme: themeSelect.value });
  });
  fontSizeRange.addEventListener('input', () => {
    const fs = parseInt(fontSizeRange.value, 10);
    applyFontSize(fs);
    storage.set({ fontSize: fs });
  });

  if (isPanel) document.documentElement.classList.add('panel-mode');

  // 启动
  loadSettings();
})();
