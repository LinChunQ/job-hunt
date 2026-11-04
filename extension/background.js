import {prepareChatInPage} from './chat-adapter.js';
import {chatDraftInPage} from './chat-draft.js';
import {sendGreetingInPage} from './chat-send.js';
import {createDraftController} from './draft-controller.js';
import {fetchJobsInPage} from './page-search.js';
import {fetchDetailCandidatesInPage} from './page-detail-candidates.js';
import {fetchObservedDetailInPage} from './page-detail.js';
import {buildDiagnosticReport} from './diagnostics.js';
// 配对码仅允许扩展可信上下文读取，目标网页的内容脚本没有访问权限。
chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'});
// 工具栏点击直接打开原生侧边栏，网页点选时面板保持可见。
if (chrome.sidePanel?.setPanelBehavior) {
  void chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(()=>{
    void chrome.storage.local.set({status:'侧边栏打开失败，请检查浏览器扩展设置'});
  });
}
const BASE = 'http://127.0.0.1:18674';
let polling = false;
let authorizationEpoch = 0;
async function bridge(path, body, key) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(BASE + path, {
      method: 'POST', headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key},
      body: JSON.stringify(body), signal: controller.signal, credentials: 'omit', redirect: 'error',
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error('本地服务请求被拒绝');
      error.code = response.status === 401 ? 'PAIRING_REJECTED' : response.status === 403 ? 'ORIGIN_REJECTED' : 'LOCAL_HTTP_' + response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (typeof error.code === 'string' && /^(PAIRING_REJECTED|ORIGIN_REJECTED|LOCAL_HTTP_[0-9]+)$/.test(error.code)) throw error;
    // DOMException.code 为只读数值，必须新建错误对象再附加诊断码。
    const failure = new Error('本地服务连接失败');
    failure.code = error.name === 'AbortError' ? 'LOCAL_TIMEOUT' : 'LOCAL_UNREACHABLE';
    throw failure;
  } finally {clearTimeout(timeout);}
}

async function diagnose() {
  const config = await chrome.storage.local.get(['key','tabId','enabled','lastHeartbeat','lastHeartbeatTabId','lastErrorCode']);
  const checks = {};
  const tab = Number.isInteger(config.tabId) ? await chrome.tabs.get(config.tabId).catch(() => null) : null;
  checks.targetTab = tab?.url?.startsWith('https://www.zhipin.com/') === true;
  // 自检仅与内容脚本通信和查询本地状态，绝不执行岗位请求或领取任务。
  if (checks.targetTab) {
    try {
      const response = await chrome.tabs.sendMessage(config.tabId, {type: 'diagnostic-ping'});
      checks.pageChannel = response?.ok === true;
      checks.readyState = response?.readyState;
    } catch (_) {checks.pageChannel = false;}
  }
  if (/^[a-f0-9]{64}$/.test(config.key || '')) {
    try {
      const state = await bridge('/extension/status', {}, config.key);
      checks.localService = true;
      checks.bridgeConnected = state.connected;
      checks.bridgeBlocked = state.blocked;
      checks.taskStatus = state.task?.status;
    } catch (error) {checks.localError = error.code;}
  } else {checks.localError = 'NOT_PAIRED';}
  return buildDiagnosticReport(config, checks, chrome.runtime.getManifest().version);
}

async function configuration(expectedEpoch = authorizationEpoch) {
  const value = await chrome.storage.local.get(['key','tabId','enabled']);
  if (!value.enabled || !value.key || !Number.isInteger(value.tabId)) return null;
  const tab = await chrome.tabs.get(value.tabId).catch(() => null);
  if (!tab?.url?.startsWith('https://www.zhipin.com/') || expectedEpoch !== authorizationEpoch) return null;
  return {...value, epoch:expectedEpoch};
}
async function fetchBoundedDetails(task, config) {
  const [injection] = await chrome.scripting.executeScript({target:{tabId:config.tabId},world:'MAIN',
    func:fetchDetailCandidatesInPage,args:[{form:task.form,limit:task.detail_limit,offset:task.detail_offset,jobIds:task.job_ids}]});
  const candidates = injection?.result;
  if (!candidates?.ok) return {ok:false,error:'新鲜列表关联失败',errorCode:candidates?.errorCode || 'DETAIL_LIST_FAILED',code:candidates?.code ?? null};
  if (!Array.isArray(candidates.jobs) || !Array.isArray(candidates.contexts) || candidates.jobs.length !== candidates.contexts.length || candidates.jobs.length < 1 || candidates.jobs.length > task.detail_limit) return {ok:false,error:'详情候选结构不正确',errorCode:'INVALID_CANDIDATES'};
  const jobs = [];
  // 详情前等待十秒并重新确认授权；断开后不会继续派发下一个请求。
  for (let index = 0; index < candidates.jobs.length; index++) {
    await new Promise(resolve => setTimeout(resolve,10000));
    const current = await configuration(config.epoch);
    if (!current || current.tabId !== config.tabId) return {ok:false,error:'授权标签页已断开',errorCode:'DETAIL_TAB_DISCONNECTED'};
    const context = candidates.contexts[index];
    const job = candidates.jobs[index];
    if (typeof context?.securityId !== 'string' || !context.securityId || typeof context.lid !== 'string' || !context.lid) return {ok:false,error:'缺少新鲜详情关联参数',errorCode:'MISSING_DETAIL_CONTEXT'};
    if (context.jobId !== job.encryptJobId) return {ok:false,error:'岗位关联不匹配',errorCode:'DETAIL_CONTEXT_MISMATCH'};
    const url = new URL('https://www.zhipin.com/wapi/zpgeek/job/detail.json');
    url.search = new URLSearchParams({securityId:context.securityId,lid:context.lid,_:String(Date.now())}).toString();
    const [detailInjection] = await chrome.scripting.executeScript({target:{tabId:config.tabId},world:'MAIN',func:fetchObservedDetailInPage,args:[url.href]});
    const response = detailInjection?.result;
    if (!response?.ok) return {ok:false,error:'岗位详情请求失败，已停止',errorCode:response?.errorCode || 'DETAIL_REQUEST_FAILED',code:response?.code ?? null};
    if (response.detail?.jobId !== job.encryptJobId) return {ok:false,error:'详情返回的岗位 ID 不匹配',errorCode:'DETAIL_ID_MISMATCH'};
    // 详情有公开称呼时整组采用详情联系人，避免把不同招聘人的姓名和职务拼接。
    const recruiter = response.detail.recruiterName ? response.detail : job;
    const contact = {recruiterName:recruiter.recruiterName || '',recruiterTitle:recruiter.recruiterTitle || ''};
    jobs.push({...job,...contact,detail:{...contact,jobId:response.detail.jobId,jobName:response.detail.jobName,
      brandName:response.detail.brandName,salaryDesc:response.detail.salaryDesc,
      description:response.detail.description,capturedAt:response.detail.capturedAt,source:'job-detail-api',identityVerified:true}});
  }
  // 只上报经过 ID 核对的正文，contexts 不离开扩展内存。
  return {ok:true,pages:[{ok:true,jobs,hasMore:candidates.hasMore,totalCount:candidates.totalCount}]};
}
async function poll() {
  if (polling) return;
  polling = true;
  let config;
  let task;
  try {
    config = await configuration();
    if (!config) return;
    const bound=await chrome.tabs.get(config.tabId).catch(()=>null);
    const ui=await bridge('/extension/ui/next',{capability:1,tabId:config.tabId,chat:bound?.url?.startsWith('https://www.zhipin.com/web/geek/chat')===true},config.key);
    if (ui.command) {
      const command=ui.command;let result={ok:false,touched:false,phase:'preflight',errorCode:'AUTHORIZATION_REVOKED'};
      if (await configuration(config.epoch)) {
        if (command.type==='mark') {
          await chrome.tabs.update(config.tabId,{active:true});
          if (bound?.windowId) await chrome.windows.update(bound.windowId,{focused:true});
        }
        if (await configuration(config.epoch)) {
          const func=command.type==='send' ? sendGreetingInPage : command.type==='inspect' ? prepareChatInPage : chatDraftInPage;
          const args=command.type==='send' ? {commandId:command.id,draft:command.draft,deadline:command.deadline} : command.type==='inspect' ? {draft:command.draft,allowSelect:false} : {action:command.type,field:command.field};
          try {
            let ready=true;
            if(command.type==='send') {
              const [prepared]=await chrome.scripting.executeScript({target:{tabId:config.tabId,frameIds:[0]},world:'ISOLATED',func:prepareChatInPage,args:[{draft:command.draft}]});
              if(!prepared?.result?.ok){ready=false;result=prepared?.result || {ok:false,touched:false,phase:'preflight',errorCode:'AUTO_CHAT_NOT_MATCHED'};}
              if(!await configuration(config.epoch)){ready=false;result={ok:false,touched:false,phase:'preflight',errorCode:'AUTHORIZATION_REVOKED'};}
            }
            if(ready){const [entry]=await chrome.scripting.executeScript({target:{tabId:config.tabId,frameIds:[0]},world:'ISOLATED',func,args:[args]});result=entry?.result || {ok:false,errorCode:'CHAT_CHANNEL_UNCERTAIN'};}
          } catch {result={ok:false,errorCode:'CHAT_CHANNEL_UNCERTAIN'};}
        }
      }
      await bridge('/extension/ui/result',{id:command.id,result},config.key);
      return;
    }
    const reply = await bridge('/extension/next', {}, config.key);
    task = reply.task;
    if (!task || !await configuration(config.epoch)) return;
    // 新版在网页请求前再次限额，旧服务下发的多页或多岗任务也不能直接执行。
    if (task.max_pages !== 1 || (task.kind === 'details' && task.detail_limit !== 1)) {
      await bridge('/extension/result',{task_id:task.id,ok:false,errorCode:'LOCAL_TASK_LIMIT'},config.key);
      await chrome.storage.local.set({status:'任务超出本版限制：一次一页或一个详情',lastErrorCode:'LOCAL_TASK_LIMIT'});
      return;
    }
    if (task.kind === 'details') {
      const result = await fetchBoundedDetails(task,config);
      if (config.epoch !== authorizationEpoch) return;
      await bridge('/extension/result',{task_id:task.id,...result},config.key);
      if (config.epoch !== authorizationEpoch) return;
      await chrome.storage.local.set({status:result.ok ? '岗位详情已交给本地脚本' : '详情任务已停止，请反馈错误码',lastErrorCode:result.ok ? null : result.errorCode});
      return;
    }
    const pages = [];
    // 每个任务最多三页；失败立即停止，不重试、不切换账号或网络。
    // 1.0.2 已在上方收紧为单页，上述历史上限不再作为可执行范围。
    for (let page = 1; page <= task.max_pages; page++) {
      if (page > 1) await new Promise(resolve => setTimeout(resolve, 10000));
      const current = await configuration(config.epoch);
      if (!current || current.tabId !== config.tabId) throw new Error('授权标签页已断开');
      const [injection] = await chrome.scripting.executeScript({
        target: {tabId: config.tabId}, world: 'MAIN', func: fetchJobsInPage,
        args: [{...task.form, page: String(Number(task.form.page || 1)+page-1)}],
      });
      const result = injection?.result;
      if (!result?.ok) {
        if (config.epoch !== authorizationEpoch) return;
        await bridge('/extension/result', {task_id: task.id, ok: false,
          error: result?.error || '页面未返回有效结果', code: result?.code ?? null}, config.key);
        await chrome.storage.local.set({status: '已停止：请在网站人工检查登录或验证', lastErrorCode: Number.isInteger(result?.code) ? 'SITE_' + result.code : 'SITE_REQUEST_FAILED'});
        return;
      }
      pages.push(result);
      if (!result.hasMore) break;
    }
    if (config.epoch !== authorizationEpoch) return;
    await bridge('/extension/result', {task_id: task.id, ok: true, pages}, config.key);
    if (config.epoch !== authorizationEpoch) return;
    await chrome.storage.local.set({status: '查询完成，结果已交给本地脚本', lastErrorCode: null});
  } catch (error) {
    const latest = await chrome.storage.local.get(['enabled']);
    if (!latest.enabled || (config && config.epoch !== authorizationEpoch)) return;
    if (task && config) {
      await bridge('/extension/result', {task_id: task.id, ok: false, error: '请求执行或本地连接中断'}, config.key).catch(() => {});
    }
    await chrome.storage.local.set({status: '连接中断或任务停止；请检查本地服务和标签页', lastErrorCode: error.code || 'TASK_EXECUTION_FAILED'});
  } finally {polling = false;}
}
const draftController=createDraftController({chrome,bridge,configuration});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'heartbeat' && sender.tab?.url?.startsWith('https://www.zhipin.com/')) {
    chrome.storage.local.get(['tabId','enabled','lastHeartbeat']).then(async config => {
      if (config.enabled && config.tabId === sender.tab.id) {
        if (!config.lastHeartbeat || Date.now() - config.lastHeartbeat > 15000) {
          await chrome.storage.local.set({lastHeartbeat: Date.now(), lastHeartbeatTabId: sender.tab.id});
        }
        void poll();
      }
    });
    return false;
  }
  if (sender.tab || sender.url !== chrome.runtime.getURL('popup.html')) return false;
  if (['draft-list','draft-update','draft-mark','draft-mark-status','draft-reset','draft-inspect','draft-fill','draft-report-sent'].includes(message?.type)) {
    draftController(message).then(sendResponse).catch(()=>sendResponse({ok:false,errorCode:'DRAFT_ACTION_FAILED'}));
    return true;
  }
  if (message?.type==='open-dashboard') {
    (async()=>{const saved=await chrome.storage.local.get(['key']);const launch=await bridge('/extension/ui/launch',{},saved.key);await chrome.tabs.create({url:launch.url});return {ok:true};})().then(sendResponse).catch(()=>{chrome.tabs.create({url:BASE});sendResponse({ok:true});});
    return true;
  }
  if (message?.type === 'diagnose') {
    diagnose().then(report => sendResponse({ok: true, report})).catch(() => sendResponse({ok: false, error: '自检失败，请重新打开扩展'}));
    return true;
  }
  if (message?.type === 'disconnect') {
    authorizationEpoch++;
    (async () => {
      const saved = await chrome.storage.local.get(['key']);
      await chrome.storage.local.set({enabled:false,status:'已断开当前标签页',lastErrorCode:null});
      await chrome.alarms.clear('bridge-poll');
      let localNotified = false;
      if (saved.key) {
        try {await bridge('/extension/disconnect',{},saved.key); localNotified = true;} catch (_) {}
      }
      sendResponse({ok:true,localNotified});
    })().catch(() => sendResponse({ok:false,error:'断开未完成，请重试'}));
    return true;
  }
  if (message?.type !== 'connect') return false;
  const currentEpoch = ++authorizationEpoch;
  (async () => {
    if (!/^[a-f0-9]{64}$/.test(message.key || '') || !Number.isInteger(message.tabId)) throw new Error('配对码不正确');
    const tab = await chrome.tabs.get(message.tabId);
    if (!tab.url?.startsWith('https://www.zhipin.com/')) throw new Error('请先手动打开目标标签页');
    await bridge('/extension/hello', {resume: true,extensionVersion:chrome.runtime.getManifest?.().version || 'unknown'}, message.key);
    if (currentEpoch !== authorizationEpoch) throw new Error('授权操作已取消');
    await chrome.storage.local.set({key: message.key, tabId: tab.id, enabled: true, status: '已连接当前标签页', lastErrorCode: null, lastHeartbeat: null, lastHeartbeatTabId: null});
    await chrome.alarms.create('bridge-poll', {periodInMinutes: 0.5});
    sendResponse({ok: true});
    void poll();
  })().catch(async error => {
    if (currentEpoch !== authorizationEpoch) {sendResponse({ok:false,error:'连接已取消'}); return;}
    const code = error.code || 'INVALID_PAIRING_OR_TAB';
    await chrome.storage.local.set({lastErrorCode: code, status: '连接失败：' + code});
    sendResponse({ok: false, error: '连接失败：' + code + '；请运行连接自检'});
  });
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => {if (alarm.name === 'bridge-poll') void poll();});

// 重启浏览器或更新扩展后，必须由用户重新选择并授权当前标签页。
chrome.runtime.onStartup.addListener(() => {
  void chrome.storage.local.set({enabled: false, status: '请在当前标签页重新连接'});
});
chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.set({enabled: false, status: '请手动连接当前标签页'});
});
