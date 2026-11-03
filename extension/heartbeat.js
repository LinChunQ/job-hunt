// 心跳只唤醒本地任务队列，不调用网站接口，也不接受网页命令。
function tick() {chrome.runtime.sendMessage({type: 'heartbeat'}).catch(() => {});}
tick();
setInterval(tick, 3000);

// 只向本扩展回答页面就绪状态，不读取登录凭据或网页内容。
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'diagnostic-ping') return false;
  sendResponse({ok: true, readyState: document.readyState});
  return false;
});
