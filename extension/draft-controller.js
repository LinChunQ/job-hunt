import {chatDraftInPage} from './chat-draft.js';

export function createDraftController({chrome,bridge,configuration}) {
  const checks=new Map();
  let working=false;
  const failure=code=>({ok:false,errorCode:code,sent:false});
  async function currentChat(config) {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if (!config || tab?.id!==config.tabId || !tab.url?.startsWith('https://www.zhipin.com/web/geek/chat')) throw new Error('AUTHORIZED_CHAT_REQUIRED');
    const state=await bridge('/extension/status',{},config.key);
    if (state.blocked) throw new Error('SERVICE_PAUSED');
    if (['pending','running'].includes(state.task?.status)) throw new Error('SEARCH_TASK_RUNNING');
    return tab;
  }
  async function inject(tabId,args) {
    // 隔离环境保存标记和短时核对票据，网页脚本无法读取插件的内部状态。
    const [entry]=await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},world:'ISOLATED',func:chatDraftInPage,args:[args]});
    return entry?.result || failure('CHAT_CHANNEL_FAILED');
  }
  async function find(message,key) {
    const value=await bridge('/extension/drafts/list',{},key);
    const draft=value.drafts?.find(row=>row.id===message.id);
    if (!draft || draft.revision!==message.revision) throw new Error('DRAFT_CHANGED');
    return draft;
  }
  return async function handle(message) {
    // 只读状态刷新不占用业务操作锁，用户点选时不会被后台轮询误挡。
    const readOnly=['draft-mark-status','draft-list'].includes(message.type);
    if (working && !readOnly) return failure('DRAFT_ACTION_BUSY');
    if (!readOnly) working=true;
    let reservation, config;
    try {
      const saved=await chrome.storage.local.get(['key']);
      if (!/^[a-f0-9]{64}$/.test(saved.key || '')) return failure('NOT_PAIRED');
      const identity={id:message.id,revision:message.revision};
      if (message.type==='draft-list') return {ok:true,...await bridge('/extension/drafts/list',{},saved.key)};
      if (message.type==='draft-update') {
        checks.delete(message.id);
        return {ok:true,...await bridge('/extension/drafts/update',{...identity,action:message.action,text:message.text},saved.key)};
      }
      if (message.type==='draft-report-sent') {
        checks.delete(message.id);
        return {ok:true,...await bridge('/extension/drafts/report-sent',{...identity,confirmedByUser:message.confirmedByUser===true},saved.key)};
      }
      config=await configuration();
      const tab=await currentChat(config);
      if (message.type==='draft-mark-status') {
        const result=await inject(tab.id,{action:'status'});
        return {...result,context:{tabId:tab.id,url:tab.url,epoch:config.epoch}};
      }
      if (message.type==='draft-mark' || message.type==='draft-reset') {
        checks.clear();
        return await inject(tab.id,{action:message.type==='draft-mark' ? 'mark' : 'reset',field:message.field});
      }
      const draft=await find(message,config.key);
      if (draft.status!=='draft') return failure('DRAFT_NOT_READY');
      if (message.type==='draft-inspect') {
        checks.delete(draft.id);
        const result=await inject(tab.id,{action:'inspect',draft});
        if (result.ok) checks.set(draft.id,{token:result.token,revision:draft.revision,tabId:tab.id,url:tab.url,epoch:config.epoch,at:Date.now()});
        const {token,...publicResult}=result;
        return publicResult;
      }
      if (message.type!=='draft-fill' || message.confirmedByUser!==true) return failure('USER_CONFIRMATION_REQUIRED');
      const check=checks.get(draft.id);checks.delete(draft.id);
      if (!check || check.revision!==draft.revision || check.tabId!==tab.id || check.url!==tab.url || check.epoch!==config.epoch || Date.now()-check.at>60000) return failure('CHAT_CHECK_EXPIRED');
      // 先落盘保留一次性填入状态；扩展重启或页面失联时也不自动重复派发。
      reservation=await bridge('/extension/drafts/reserve',identity,config.key);
      const current=await configuration(config.epoch);
      let result;
      if (!current || current.tabId!==tab.id) result=failure('AUTHORIZATION_REVOKED');
      else {
        const active=await currentChat(current);
        result=active.id===tab.id ? await inject(tab.id,{action:'fill',draft,token:check.token}) : failure('AUTHORIZED_CHAT_REQUIRED');
      }
      const outcome=result.ok ? 'filled' : result.touched ? 'uncertain' : 'rejected';
      const recorded=await bridge('/extension/drafts/result',{id:draft.id,revision:reservation.draft.revision,ticket:reservation.ticket,outcome,errorCode:result.errorCode || null},config.key);
      reservation=null;
      return {...result,draft:recorded.draft,deliveryVerified:false,sent:false};
    } catch (error) {
      if (reservation && config) {
        // 一旦已经派发或无法确认派发状态，保留“待人工确认”，绝不自动重填。
        await bridge('/extension/drafts/result',{id:reservation.draft.id,revision:reservation.draft.revision,ticket:reservation.ticket,outcome:'uncertain',errorCode:'FILL_CHANNEL_UNCERTAIN'},config.key).catch(()=>{});
      }
      const code=/^[A-Z][A-Z0-9_]{0,63}$/.test(error.message || '') ? error.message : error.code || 'DRAFT_ACTION_FAILED';
      return failure(code);
    } finally {if (!readOnly) working=false;}
  };
}
