import {createHash} from 'node:crypto';
import {checkedTask,browserTask,cleanPages} from './platforms.mjs';
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const codes=value=>/^[A-Z][A-Z0-9_]{0,63}$/.test(value || '') ? value : 'SITE_OR_NETWORK_ERROR';
const terminal=new Set(['done','failed','deferred','skipped']);
export class Engine {
  status() {
    this.expire();
    const active=this.store.runs().find(run=>['pending','running','uncertain'].includes(run.status));
    return {running:true,appVersion:this.version,protocolVersion:2,storageSchemaVersion:1,storageBackend:'sqlite',blocked:this.store.getMeta('blocked',false),connected:!this.disconnected && this.now()-this.lastPoll<100000,cooldownRemainingSeconds:Math.max(0,Math.ceil((this.store.getMeta('nextAllowedAt',0)-this.now())/1000)),policy:{maxSearchPages:1,maxDetails:1,taskCooldownSeconds:this.cooldown/1000,siteAcceptanceGuaranteed:false},task:active ? {id:active.id,status:active.status} : null};
  }
  resume() {
    if (this.store.runs().some(run=>['pending','running','uncertain'].includes(run.status))) throw new Error('UNRESOLVED_TASK');
    this.disconnected=false;this.store.setMeta('blocked',false);return {ok:true};
  }
  heartbeat() {if (!this.disconnected) this.lastPoll=this.now();}
  disconnect() {
    this.disconnected=true;this.lastPoll=-Infinity;
    for (const run of this.store.runs()) {
      if (run.status==='pending') this._finish(run,'failed','USER_DISCONNECTED');
      else if (run.status==='running') this._finish(run,'uncertain','USER_DISCONNECTED_AFTER_DISPATCH');
    }
    return {disconnected:true};
  }
  enqueue(value) {
    const request=checkedTask(value);
    if (!/^[A-Za-z0-9_.:-]{1,150}$/.test(value.requestId || '')) throw new Error('INVALID_REQUEST_ID');
    return this.store.transaction(()=>{
      const prior=this.store.run(value.requestId);
      if (prior) {
        if (prior.fingerprint!==fingerprint(request)) throw new Error('REQUEST_ID_CONFLICT');
        return {ok:prior.status==='done' || prior.status==='skipped',replayed:true,task:prior,siteRequestPerformed:false};
      }
      const state=this.status();
      const run={id:value.requestId,request,fingerprint:fingerprint(request),status:'pending',createdAt:this.now(),deadline:this.now()+120000,siteRequestPerformed:false};
      if (request.action==='details') {
        const existing=this.store.job('boss:'+request.jobId);
        if (!existing) throw new Error('DETAIL_JOB_NOT_IN_CATALOG');
        if (existing.jd && existing.detailVerified && !existing.needsDetail) {run.status='skipped';run.reason='EXISTING_VERIFIED_DETAIL';}
        else if (existing.query?.query!==request.query || existing.query?.city!==request.city || existing.listPage!==request.page) throw new Error('DETAIL_CONTEXT_MISMATCH');
      }
      if (run.status==='pending') {
        const reason=(this.store.getMeta('deliveryBusy',false) || ['pending','dispatched'].includes(this.store.getMeta('browserAction')?.status)) ? 'DELIVERY_QUEUE_ACTIVE' : state.task ? 'UNRESOLVED_TASK' : state.blocked ? 'SERVICE_PAUSED' : !state.connected ? 'EXTENSION_NOT_CONNECTED' : state.cooldownRemainingSeconds ? 'TASK_COOLDOWN' : null;
        if (reason) {run.status='deferred';run.errorCode=reason;}
        else this._cooldown();
      }
      this.store.putRun(run);return {ok:['pending','skipped'].includes(run.status),task:run,siteRequestPerformed:false};
    });
  }
  cancelPending(id) {const run=this.store.run(id);if (run?.status==='pending') this._finish(run,'failed','COLLECTION_PAUSED_BEFORE_CLAIM');return {cancelled:run?.status==='failed'};}
  claim() {
    this.expire();
    if (this.disconnected) return {task:null,blocked:this.store.getMeta('blocked',false)};
    this.lastPoll=this.now();
    if (this.store.getMeta('blocked',false)) return {task:null,blocked:true};
    if (this.store.getMeta('deliveryBusy',false) || ['pending','dispatched'].includes(this.store.getMeta('browserAction')?.status)) return {task:null};
    const run=this.store.runs().find(row=>row.status==='pending');
    if (!run) return {task:null};
    // 先记录已派发，再交给浏览器；崩溃后不能把这个动作重新排队。
    run.status='running';run.siteRequestPerformed=true;this.store.putRun(run);
    return {task:browserTask(run.request,run.id)};
  }
  complete(input) {
    this.expire();
    const run=this.store.run(input.task_id);
    if (!run || run.status!=='running') throw new Error('TASK_EXPIRED_OR_DUPLICATE');
    if (input.ok!==true) {
      const code=codes(input.errorCode);
      if (code!=='TARGET_NOT_IN_FRESH_PAGE') this.store.setMeta('blocked',true);
      this._finish(run,'failed',code);return {accepted:true,blocked:this.store.getMeta('blocked',false)};
    }
    try {
      const jobs=cleanPages(input.pages,run.request);
      const result={...this.store.mergeJobs(jobs),sourceKeys:jobs.map(x=>x.sourceKey),hasMore:input.pages[0].hasMore===true,pageFingerprint:fingerprint(jobs.map(x=>x.sourceKey).sort())};
      Object.assign(run,{status:'done',result,finishedAt:this.now()});this.store.putRun(run);this._cooldown();
      return {accepted:true,blocked:false};
    } catch(error) {
      this.store.setMeta('blocked',true);this._finish(run,'uncertain','RESULT_NOT_COMMITTED');throw error;
    }
  }
  expire() {
    for (const run of this.store.runs()) {
      if (['pending','running'].includes(run.status) && this.now()>run.deadline) {
        if (run.status==='running') this.store.setMeta('blocked',true);
        this._finish(run,run.status==='pending' ? 'failed' : 'uncertain',run.status==='pending' ? 'TASK_NOT_CLAIMED' : 'TASK_RESULT_UNCERTAIN');
      }
    }
  }
  resolve(input) {
    const run=this.store.run(input.requestId);
    if (!run || run.status!=='uncertain' || input.confirmedByUser!==true) throw new Error('USER_CONFIRMATION_REQUIRED');
    // 人工结案只改变本地执行记录，不清除暂停，不补发浏览器请求。
    this._finish(run,'failed','MANUALLY_RESOLVED_WITHOUT_REPLAY');return {ok:true};
  }
  putSchedule(input) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(input.id || '') || typeof input.enabled!=='boolean' || !Number.isInteger(input.intervalMinutes) || input.intervalMinutes<5 || input.intervalMinutes>10080) throw new Error('INVALID_SCHEDULE');
    const task=checkedTask(input.task);
    const previous=this.store.schedules().find(x=>x.id===input.id);
    const value={id:input.id,enabled:input.enabled,intervalMinutes:input.intervalMinutes,task,nextAt:previous?.nextAt || this.now()+input.intervalMinutes*60000};
    this.store.putSchedule(value);return {ok:true,schedule:value};
  }
  tick() {
    this.expire();
    const due=this.store.schedules().filter(x=>x.enabled && x.nextAt<=this.now());
    for (const schedule of due.slice(0,1)) {
      const requestId='schedule:'+schedule.id+':'+schedule.nextAt;
      // 先推进下次时间，休眠或重启后合并错过的周期，不集中补跑。
      schedule.nextAt=this.now()+schedule.intervalMinutes*60000;this.store.putSchedule(schedule);
      try {this.enqueue({...schedule.task,requestId});}
      catch {this.store.putRun({id:requestId,request:schedule.task,status:'failed',errorCode:'SCHEDULE_LOCAL_FAILURE',createdAt:this.now(),siteRequestPerformed:false});}
    }
  }
  constructor(store,{version='0.1.0',now=()=>Date.now(),cooldown=180000}={}) {
    this.store=store;this.version=version;this.now=now;this.cooldown=cooldown;this.lastPoll=-Infinity;this.disconnected=true;
    for (const run of store.runs()) {
      if (run.status==='pending') this._finish(run,'failed','SERVICE_RESTARTED_BEFORE_CLAIM');
      else if (run.status==='running') {this._finish(run,'uncertain','SERVICE_RESTARTED_AFTER_DISPATCH');store.setMeta('blocked',true);}
    }
  }
  _cooldown() {this.store.setMeta('nextAllowedAt',Math.max(this.store.getMeta('nextAllowedAt',0),this.now()+this.cooldown));}
  _finish(run,status,errorCode) {Object.assign(run,{status,errorCode,finishedAt:this.now()});this.store.putRun(run);this._cooldown();}
}
