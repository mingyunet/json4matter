/*
 * background.js — MV3 service worker。
 * 职责：
 *  1) 安装时注册右键菜单：选中文本 → 用 json4matter 格式化；以及「打开侧边栏」。
 *  2) 把选中文本暂存到 storage，并打开侧边栏（大屏查看更舒服）。
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'fmt-selection',
      title: '用 json4matter 格式化选中内容',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'fmt-panel',
      title: '打开 json4matter 侧边栏',
      contexts: ['all'],
    });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'fmt-selection') {
    const text = (info.selectionText || '').trim();
    chrome.storage.local.set({ pendingText: text });
    if (tab && tab.windowId != null) {
      chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    }
  } else if (info.menuItemId === 'fmt-panel') {
    if (tab && tab.windowId != null) {
      chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    }
  }
});
