import {randomUUID,createHash} from 'node:crypto';
const stamp=()=>new Date().toISOString();
const code=value=>/^[A-Z][A-Z0-9_]{0,63}$/.test(value || '') ? value : 'BROWSER_ACTION_FAILED';
const fingerprint=items=>createHash('sha256').update(JSON.stringify(items)).digest('hex');
export class Delivery {
  status() {
    this.expire();
    return {ok:true,batches:this.store.getMeta('deliveryBatches',[]),action:this.store.getMeta('browserAction',null),browser:this.browser,capability:'confirmed-sequential-send',deliveryVerified:false};
  }
  create(input) {
    if (input.confirmedByUser!==true || !/^[A-Za-z0-9_-]{1,100}$/.test(input.requestId || '') || !Array.isArray(input.items) || !input.items.length || input.items.length>30 || new Set(input.items.map(x=>x.id)).size!==input.items.length) throw new Error('BATCH_CONFIRMATION_REQUIRED');
    const items=input.items.map(x=>({id:x.id,revision:x.revision,text:x.text}));
    const batches=this.store.getMeta('deliveryBatches',[]),prior=batches.find(x=>x.id===input.requestId);
    if (prior) {if (prior.fingerprint!==fingerprint(items)) throw new Error('BATCH_ID_CONFLICT');return {ok:true,replayed:true,batch:prior};}
    if (this.busy() || this.engine.status().task || ['pending','dispatched'].includes(this.store.getMeta('browserAction')?.status)) throw new Error('BROWSER_BUSY');
    if (!this.engine.status().connected || this.engine.status().blocked || (!this.browser?.capable || this.now()-this.browser.checkedAt>100000)) throw new Error('EXTENSION_UPGRADE_OR_CONNECT_REQUIRED');
    // 一次事务锁定已审阅的正文与版本，提交后不能再被编辑或 AI 覆盖。
    return this.store.transaction(()=>{
      const drafts=items.map(item=>this.store.queueDraft(item));
      const batch={id:input.requestId,fingerprint:fingerprint(items),status:'running',createdAt:stamp(),items:drafts.map(draft=>({id:draft.id,company:draft.company,title:draft.title,recruiter:draft.recruiter,status:'queued'}))};
      for (const draft of drafts) this.store.deliveryTransition(draft.id,['draft'],'send_queued');
      this.store.setMeta('deliveryBatches',[batch,...batches].slice(0,50));this.store.setMeta('deliveryBusy',true);
      return {ok:true,batch};
    });
  }
  control(input) {return this.store.transaction(()=>this._control(input));}
  _control(input) {
    const batches=this.store.getMeta('deliveryBatches',[]),batch=batches.find(x=>x.id===input.id);
    if (!batch || !['pause','continue','cancel','resolve'].includes(input.action)) throw new Error('INVALID_BATCH_ACTION');
    if (input.action==='continue') {
      if (this.engine.status().task) throw new Error('BROWSER_BUSY');
      if (batch.items.some(x=>x.status==='uncertain') || !['paused','waiting'].includes(batch.status)) throw new Error('UNRESOLVED_DELIVERY');
      if (this.engine.status().blocked || !this.engine.status().connected) throw new Error('SERVICE_PAUSED');
      if (batch.cancelRequested) throw new Error('BATCH_CANCELLED');
      batch.status='running';
    } else if (input.action==='resolve') {
      if (input.confirmedByUser!==true || !batch.items.some(x=>x.id===input.itemId && x.status==='uncertain')) throw new Error('USER_CONFIRMATION_REQUIRED');
      const item=batch.items.find(x=>x.id===input.itemId);item.status='not_retried';
      this.store.deliveryTransition(item.id,['send_uncertain'],'send_not_retried','MANUALLY_RESOLVED_WITHOUT_REPLAY');batch.status='paused';
    } else if (input.action==='cancel') {
      batch.cancelRequested=true;
      for (const item of batch.items.filter(x=>x.status==='queued')) {this.store.deliveryTransition(item.id,['send_queued'],'draft');item.status='cancelled';}
      batch.status=batch.items.some(x=>['dispatching','uncertain'].includes(x.status)) ? 'paused' : 'cancelled';
    } else if (!['done','cancelled'].includes(batch.status)) batch.status='paused';
    this._save(batches);return {ok:true,batch};
  }
  request(input) {
    if (!['status','mark','reset','inspect'].includes(input.action) || (input.action==='mark' && !['company','title','recruiter','editor','send','receipt'].includes(input.field))) throw new Error('INVALID_BROWSER_ACTION');
    if (this.engine.status().task) throw new Error('BROWSER_BUSY');
    this.expire();const old=this.store.getMeta('browserAction');
    if (old && ['pending','dispatched'].includes(old.status)) throw new Error('BROWSER_ACTION_BUSY');
    const draft=input.action==='inspect' ? this.store.deliveryDraft(input.id) : null;
    if (input.action==='inspect' && (!draft || draft.revision!==input.revision)) throw new Error('DRAFT_CHANGED');
    const action={id:randomUUID(),type:input.action,field:input.field,...(draft ? {draftId:draft.id} : {}),status:'pending',deadline:this.now()+20000};
    this.store.setMeta('browserAction',action);return {ok:true,action};
  }
  next(input) {
    this.engine.heartbeat();this.expire();
    this.browser={capable:input.capability===1,tabId:Number.isInteger(input.tabId) ? input.tabId : null,chat:input.chat===true,checkedAt:this.now()};
    if (!this.browser.capable || !this.engine.status().connected || this.engine.status().blocked || this.engine.status().task) return {command:null};
    const existing=this.store.getMeta('browserAction');
    if (existing && existing.status==='dispatched') return {command:null};
    if (existing?.status==='pending') {existing.status='dispatched';this.store.setMeta('browserAction',existing);return {command:{...existing,...(existing.type==='inspect' ? {draft:this.store.listDrafts().drafts.find(x=>x.id===existing.draftId)} : {})}};}
    const batches=this.store.getMeta('deliveryBatches',[]),batch=batches.find(x=>x.status==='running');
    if (!batch || !this.browser.chat) return {command:null};
    if (batch.items.some(x=>x.status==='dispatching')) return {command:null};
    const item=batch.items.find(x=>x.status==='queued');
    if (!item) {batch.status='done';this._save(batches);return {command:null};}
    const draft=this.store.deliveryDraft(item.id);
    if (!draft || draft.status!=='send_queued' || !this.store.deliveryContextValid(draft)) {batch.status='waiting';item.errorCode='JOB_CONTEXT_CHANGED';this._save(batches);return {command:null};}
    if (this.now()<this.store.getMeta('nextSendAt',0)) return {command:null};
    // 先记已派发；断线、超时或进程重启都不会重新发出此条消息。
    const action={id:randomUUID(),type:'send',batchId:batch.id,draftId:item.id,status:'dispatched',deadline:this.now()+30000};
    this.store.transaction(()=>{this.store.deliveryTransition(item.id,['send_queued'],'send_dispatching');item.status='dispatching';batch.status='running';this._save(batches);this.store.setMeta('browserAction',action);});
    return {command:{...action,draft:{...draft,ticket:undefined,contextFingerprint:undefined}}};
  }
  result(input) {this.expire();return this.store.transaction(()=>this._result(input));}
  _result(input) {
    const action=this.store.getMeta('browserAction');
    if (!action || action.id!==input.id || action.status!=='dispatched') throw new Error('ACTION_EXPIRED_OR_DUPLICATE');
    const outcome=input.result || {};
    if (action.type==='send') {
      const batches=this.store.getMeta('deliveryBatches',[]),batch=batches.find(x=>x.id===action.batchId),item=batch?.items.find(x=>x.id===action.draftId);
      if (!item || item.status!=='dispatching') throw new Error('DELIVERY_STATE_CHANGED');
      // 只有浏览器明确报告在触碰输入框前未执行，才允许稍后核对同一条。
      const waiting=outcome.ok===false && outcome.phase==='preflight' && outcome.touched===false;
      const observed=outcome.ok===true && outcome.sent===true && outcome.uiObserved===true;
      const cancelled=waiting && batch.cancelRequested;
      item.status=cancelled ? 'cancelled' : waiting ? 'queued' : observed ? 'sent_observed' : 'uncertain';
      item.errorCode=observed ? null : code(outcome.errorCode);item.finishedAt=stamp();
      this.store.deliveryTransition(item.id,['send_dispatching'],cancelled ? 'draft' : waiting ? 'send_queued' : observed ? 'sent_observed' : 'send_uncertain',item.errorCode);
      if (cancelled) batch.status='cancelled';
      else if (!observed) batch.status=waiting ? 'waiting' : 'paused';
      else if (!batch.items.some(x=>x.status==='queued')) batch.status='done';
      this.store.setMeta('nextSendAt',this.now()+30000);this._save(batches);
    }
    const marks={};
    for (const field of ['company','title','recruiter','editor','send','receipt']) if (outcome.marks?.[field]) marks[field]={status:['marked','stale','unmarked'].includes(outcome.marks[field].status) ? outcome.marks[field].status : 'unmarked'};
    action.status='done';action.result={ok:outcome.ok===true,errorCode:outcome.errorCode ? code(outcome.errorCode) : null,marks,picking:typeof outcome.picking==='string' ? outcome.picking : null};delete action.deadline;
    this.store.setMeta('browserAction',action);return {ok:true};
  }
  disconnect() {this._interrupt('BROWSER_DISCONNECTED');this.browser=null;}
  busy() {return this.store.getMeta('deliveryBatches',[]).some(x=>x.items.some(i=>['queued','dispatching','uncertain'].includes(i.status)));}
  expire() {const action=this.store.getMeta('browserAction');if (action && ['pending','dispatched'].includes(action.status) && this.now()>action.deadline) this._interrupt('BROWSER_ACTION_TIMEOUT');}
  constructor(store,engine,{now=()=>Date.now()}={}) {this.store=store;this.engine=engine;this.now=now;this.browser=null;this._interrupt('SERVICE_RESTARTED');}
  _interrupt(reason) {return this.store.transaction(()=>this._interrupted(reason));}
  _interrupted(reason) {
    const batches=this.store.getMeta('deliveryBatches',[]);
    for (const batch of batches) {
      for (const item of batch.items) if (item.status==='dispatching') {item.status='uncertain';item.errorCode=reason;this.store.deliveryTransition(item.id,['send_dispatching'],'send_uncertain',reason);}
      if (['running','waiting'].includes(batch.status)) batch.status='paused';
    }
    this._save(batches);const action=this.store.getMeta('browserAction');
    if (action && ['pending','dispatched'].includes(action.status)) this.store.setMeta('browserAction',{...action,status:'failed',result:{ok:false,errorCode:reason}});
  }
  _save(batches) {this.store.setMeta('deliveryBatches',batches);this.store.setMeta('deliveryBusy',batches.some(x=>x.items.some(i=>['queued','dispatching','uncertain'].includes(i.status))));}
}
