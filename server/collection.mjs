import {createHash} from 'node:crypto';
import {checkedFilters,prefilter,lockedDraftStates} from './job-pool.mjs';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const terminal=new Set(['completed','completed_with_shortage','cancelled']);
export function collectionOptions(input) {
  if (!input || input.platform!=='boss') throw new Error('PLATFORM_NOT_IMPLEMENTED');
  if (!Array.isArray(input.keywords) || !input.keywords.length || input.keywords.length>10 || input.keywords.some(x=>typeof x!=='string' || !x.trim() || x.length>80 || /[\x00-\x1f]/.test(x))) throw new Error('INVALID_COLLECTION_KEYWORDS');
  if (!Array.isArray(input.cities) || !input.cities.length || input.cities.length>10 || input.cities.some(x=>!x || typeof x.name!=='string' || !x.name.trim() || x.name.length>40 || typeof x.code!=='string' || !/^\d{9}$/.test(x.code))) throw new Error('VERIFIED_CITY_CODE_REQUIRED');
  const maxPages=input.maxPages ?? 1,detailLimit=input.detailLimit ?? 5,requestBudget=input.requestBudget ?? 20;
  if (!Number.isInteger(maxPages) || maxPages<1 || maxPages>3 || !Number.isInteger(detailLimit) || detailLimit<0 || detailLimit>30 || !Number.isInteger(requestBudget) || requestBudget<1 || requestBudget>100) throw new Error('INVALID_COLLECTION_LIMIT');
  const keywords=[...new Set(input.keywords.map(x=>x.trim()))],cities=[...new Map(input.cities.map(x=>[x.code,{name:x.name.trim(),code:x.code}])).values()];
  if (keywords.length*cities.length*maxPages>requestBudget) throw new Error('COLLECTION_BUDGET_TOO_SMALL');
  return {platform:'boss',keywords,cities,maxPages,detailLimit,requestBudget,filters:checkedFilters(input.filters)};
}
export class Collection {
  list() {
    return {ok:true,runs:this._runs(),policy:{onePagePerTask:true,detailsReuseVerified:true,cooldownSeconds:this.engine.cooldown/1000,requestBudgetCountsDetailsAsTwo:true,automaticScoring:false,siteAcceptanceGuaranteed:false}};
  }
  create(input) {
    const options=collectionOptions(input);
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.requestId || '')) throw new Error('INVALID_REQUEST_ID');
    const runs=this._runs(),prior=runs.find(x=>x.id===input.requestId);
    if (prior) {if (prior.fingerprint!==digest(options)) throw new Error('REQUEST_ID_CONFLICT');return {ok:true,replayed:true,run:prior};}
    if (runs.some(x=>!terminal.has(x.status))) throw new Error('COLLECTION_ALREADY_ACTIVE');
    if (this.store.getMeta('deliveryBusy',false) || this.engine.status().task || ['pending','dispatched'].includes(this.store.getMeta('browserAction')?.status)) throw new Error('BROWSER_BUSY');
    const run={id:input.requestId,options,fingerprint:digest(options),status:'running',phase:'search',createdAt:this.now(),updatedAt:this.now(),comboIndex:0,page:1,sequence:0,pages:[],detailQueue:[],seenKeys:[],counts:{seen:0,new:0,duplicates:0,filtered:0,details:0,detailReused:0,requestsReserved:0,pages:0},filterRecords:[],reason:null,activeTask:null};
    this._save([run,...runs].slice(0,50));return {ok:true,run};
  }
  control(input) {
    this.tick(false);
    const runs=this._runs(),run=runs.find(x=>x.id===input.id);
    if (!run || terminal.has(run.status) || !['pause','resume','cancel'].includes(input.action)) throw new Error('INVALID_COLLECTION_ACTION');
    if (input.action==='resume') {
      if (run.status!=='paused' || run.activeTask) throw new Error('UNRESOLVED_TASK');
      const state=this.engine.status();
      if (!state.connected || state.blocked || state.task) throw new Error('SERVICE_PAUSED');
      run.status='running';run.reason=null;
    } else {
      if (run.activeTask && this.store.run(run.activeTask)?.status==='pending') {this.engine.cancelPending(run.activeTask);run.activeTask=null;}
      run.status=input.action==='cancel' ? 'cancelling' : 'paused';run.reason=input.action==='cancel' ? 'USER_CANCELLED' : 'USER_PAUSED';
      if (run.status==='cancelling' && !run.activeTask) run.status='cancelled';
    }
    run.updatedAt=this.now();this._save(runs);return {ok:true,run};
  }
  tick(dispatch=true) {
    const runs=this._runs(),run=runs.find(x=>!terminal.has(x.status));
    if (!run) return;
    // 已派发的只读取原任务结果；暂停和重启都不会重发未确定的请求。
    if (run.activeTask) {
      const task=this.store.run(run.activeTask);
      if (!task || ['pending','running','uncertain'].includes(task.status)) {
        if (task?.status==='uncertain') {run.status='paused';run.reason='TASK_RESULT_UNCERTAIN';this._save(runs);}
        return;
      }
      this.store.transaction(()=>{
      run.activeTask=null;
      if (['done','skipped'].includes(task.status)) this._consume(run,task);
      else if (task.status==='deferred') run.reason=task.errorCode;
      else {run.status=run.status==='cancelling' ? 'cancelled' : 'paused';run.reason=task.errorCode || 'COLLECTION_TASK_FAILED';}
      run.updatedAt=this.now();
        this._save(runs);
      });
    }
    if (run.status==='cancelling') run.status='cancelled';
    if (!dispatch || run.status!=='running') {this._save(runs);return;}
    const state=this.engine.status();
    if (state.blocked || !state.connected) {run.status='paused';run.reason=state.blocked ? 'SITE_OR_SERVICE_PAUSED' : 'EXTENSION_DISCONNECTED';this._save(runs);return;}
    if (state.task || state.cooldownRemainingSeconds || this.store.getMeta('deliveryBusy',false) || ['pending','dispatched'].includes(this.store.getMeta('browserAction')?.status)) {this._save(runs);return;}
    const task=this._next(run);
    if (!task) {this._save(runs);return;}
    const cost=task.action==='details' ? 2 : 1;
    if (run.counts.requestsReserved+cost>run.options.requestBudget) {run.status='completed_with_shortage';run.reason='REQUEST_BUDGET_REACHED';this._save(runs);return;}
    const requestId='collection:'+run.id+':'+(++run.sequence);
    this.store.transaction(()=>{
    const response=this.engine.enqueue({...task,requestId});
    if (response.task.status==='pending') {run.activeTask=requestId;run.counts.requestsReserved+=cost;run.reason=null;}
    else if (response.task.status==='skipped') {this._consume(run,response.task);}
    else run.reason=response.task.errorCode;
    run.updatedAt=this.now();this._save(runs);
    });
  }
  ownsBrowser() {return this._runs().some(x=>['running','cancelling'].includes(x.status) || x.activeTask);}
  constructor(store,engine,{now=()=>Date.now()}={}) {
    this.store=store;this.engine=engine;this.now=now;
    const runs=this._runs();for (const run of runs) if (['running','cancelling'].includes(run.status)) {run.status='paused';run.reason='SERVICE_RESTARTED';}
    this._save(runs);
  }
  _runs() {return this.store.getMeta('collectionRuns',[]);}
  _save(runs) {this.store.setMeta('collectionRuns',runs);this.store.setMeta('collectionBusy',runs.some(x=>['running','cancelling'].includes(x.status) || x.activeTask));}
  _combos(run) {return run.options.cities.flatMap(city=>run.options.keywords.map(query=>({city:city.code,query})));}
  _next(run) {
    const combos=this._combos(run);
    if (run.phase==='search' && run.comboIndex>=combos.length) run.phase='details';
    if (run.phase==='search') return {platform:'boss',action:'search',...combos[run.comboIndex],page:run.page};
    // 详情前再核对池状态、原始搜索上下文和已验证正文，去重并不丢弃待补齐的旧候选。
    while (run.detailQueue.length && run.counts.details<run.options.detailLimit) {
      const sourceKey=run.detailQueue[0],job=this.store.job(sourceKey),draft=this.store.listDrafts().drafts.find(x=>x.sourceKey===sourceKey);
      if (!job || job.archivedAt || ['filtered','skipped'].includes(job.poolStatus) || (draft && lockedDraftStates.has(draft.status))) {run.detailQueue.shift();continue;}
      if (job.detailVerified && job.jd && !job.needsDetail) {run.counts.detailReused++;run.detailQueue.shift();continue;}
      return {platform:'boss',action:'details',...job.query,page:job.listPage || 1,jobId:job.jobId};
    }
    if (run.options.detailLimit===0 && !run.shortage) {run.status='completed';run.reason='LIST_ONLY_COMPLETED';return null;}
    run.status=run.detailQueue.length || run.shortage ? 'completed_with_shortage' : 'completed';run.reason=run.detailQueue.length ? 'DETAIL_LIMIT_REACHED' : run.lastWarning || 'COLLECTION_FINISHED';return null;
  }
  _consume(run,task) {
    if (task.request.action==='details') {
      const key='boss:'+task.request.jobId;
      run.detailQueue=run.detailQueue.filter(x=>x!==key);
      if (task.status==='skipped') run.counts.detailReused++;
      else {run.counts.details++;this._inspect(run,[key],true);}
      return;
    }
    const result=task.result,keys=result?.sourceKeys;
    if (!Array.isArray(keys)) {run.status='paused';run.reason='INVALID_COLLECTION_RESULT';return;}
    const combo=this._combos(run)[run.comboIndex],comboKey=combo.city+'::'+combo.query;
    // 页面 ID 集合重复即停止当前组合；不把重复页当成新的扫描量或断点。
    const repeated=run.pages.some(x=>x.combo===comboKey && x.fingerprint===result.pageFingerprint);
    if (repeated) {run.shortage=true;run.lastWarning='REPEATED_SEARCH_PAGE';run.comboIndex++;run.page=1;return;}
    if (!keys.length) {run.shortage=true;run.lastWarning='EMPTY_SEARCH_PAGE';run.comboIndex++;run.page=1;return;}
    run.pages.push({combo:comboKey,page:task.request.page,fingerprint:result.pageFingerprint});
    run.counts.pages++;run.counts.seen+=keys.length;run.counts.new+=result.newCount;run.counts.duplicates+=keys.length-result.newCount;
    this._inspect(run,keys,false);
    if (result.hasMore && run.page<run.options.maxPages) run.page++;
    else {run.comboIndex++;run.page=1;}
    if (run.comboIndex>=this._combos(run).length) run.phase='details';
  }
  _inspect(run,keys,detail) {
    for (const key of keys) {
      const job=this.store.job(key);if (!job) continue;
      if (!detail && run.seenKeys.includes(key)) continue;
      if (!detail) run.seenKeys.push(key);
      const draft=this.store.listDrafts().drafts.find(x=>x.sourceKey===key);
      if (job.archivedAt || ['filtered','skipped'].includes(job.poolStatus) || (draft && lockedDraftStates.has(draft.status))) continue;
      const reason=prefilter(job,run.options.filters,{detail:detail || job.detailVerified===true});
      if (reason) {
        if (this.store.filterJob(key,reason,run.id)) {run.counts.filtered++;run.filterRecords.push({sourceKey:key,title:job.title,company:job.company,reason});run.filterRecords=run.filterRecords.slice(-200);}
      } else if (!detail) {
        if (job.detailVerified && job.jd && !job.needsDetail) run.counts.detailReused++;
        else if (!run.detailQueue.includes(key)) run.detailQueue.push(key);
      }
    }
  }
}
