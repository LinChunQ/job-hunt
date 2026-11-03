const status = document.getElementById('status');
const phase = document.getElementById('phase');
const keyInput = document.getElementById('key');
const connectButton = document.getElementById('connect');
const diagnoseButton = document.getElementById('diagnose');
const copyButton = document.getElementById('copy-report');
const reportBox = document.getElementById('report');
let generation = 0;
document.getElementById('version').textContent = chrome.runtime.getManifest().version;
function showConnection(enabled) {
  phase.textContent = enabled ? '已授权当前标签页' : '未连接';
  phase.dataset.connected = String(enabled === true);
}
function busy(value) {connectButton.disabled = value; diagnoseButton.disabled = value;}
function clearReport() {reportBox.value = ''; reportBox.hidden = true; copyButton.disabled = true;}
chrome.storage.local.get(['key','status','enabled']).then(config => {
  keyInput.value = config.key || '';
  showConnection(config.enabled === true);
  status.textContent = config.status || '先启动本地服务，再在已登录标签页中连接';
}).catch(() => {status.textContent = '本机配置读取失败，请重新打开扩展';});
chrome.storage.onChanged?.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.enabled) showConnection(changes.enabled.newValue === true);
  if (changes.status) status.textContent = changes.status.newValue || '请检查连接';
});
document.getElementById('connection-form').addEventListener('submit', async event => {
  event.preventDefault();
  const current = ++generation;
  busy(true); clearReport();
  status.textContent = '正在连接当前标签页…';
  try {
    const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
    const reply = await chrome.runtime.sendMessage({type:'connect',key:keyInput.value.trim(),tabId:tab?.id});
    if (current !== generation) return;
    showConnection(reply?.ok === true);
    status.textContent = reply?.ok ? '已连接，可在 WorkBuddy 查询岗位和详情' : reply?.error || '连接失败，请检查本地服务';
  } catch (_) {if (current === generation) status.textContent = '连接失败，请确认服务已启动并手动登录 BOSS';}
  finally {if (current === generation) busy(false);}
});
document.getElementById('disconnect').addEventListener('click', async () => {
  const current = ++generation;
  busy(false); clearReport();
  status.textContent = '正在断开…';
  try {
    const reply = await chrome.runtime.sendMessage({type:'disconnect'});
    if (current !== generation) return;
    if (!reply?.ok) throw new Error('断开失败');
    showConnection(false);
    status.textContent = reply.localNotified ? '已断开，未完成任务已停止' : '浏览器授权已断开；本地服务不可达，请检查服务';
  } catch (_) {if (current === generation) status.textContent = '断开未完成，请重试';}
});
diagnoseButton.addEventListener('click', async () => {
  const current = ++generation;
  busy(true); clearReport();
  status.textContent = '正在检查本机连接…';
  try {
    const reply = await chrome.runtime.sendMessage({type:'diagnose'});
    if (current !== generation) return;
    if (!reply?.ok) throw new Error('自检失败');
    reportBox.value = JSON.stringify(reply.report,null,2);
    reportBox.hidden = false; copyButton.disabled = false;
    const report = reply.report;
    const ready = report.enabled && report.targetTab && report.pageChannel && report.localService && report.bridgeConnected && !report.bridgeBlocked;
    status.textContent = ready ? '连接检查通过；网站登录和请求结果需在查询时确认' : '连接尚未就绪，请复制诊断反馈';
  } catch (_) {if (current === generation) status.textContent = '连接检查失败，请重新打开扩展';}
  finally {if (current === generation) busy(false);}
});
copyButton.addEventListener('click', async () => {
  try {await navigator.clipboard.writeText(reportBox.value); status.textContent = '已复制不含配对码的诊断报告';}
  catch (_) {reportBox.focus(); reportBox.select(); status.textContent = '请按 Ctrl+C 复制已选中的诊断报告';}
});

document.getElementById('open-dashboard').addEventListener('click',async()=>{
  const reply=await chrome.runtime.sendMessage({type:'open-dashboard'});
  if (!reply?.ok) status.textContent='请确认本机服务已启动';
});
