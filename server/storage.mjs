import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const protectedStates=new Set(['fill_pending','filled_unconfirmed','user_reported_sent','send_queued','send_dispatching','send_uncertain','sent_observed','send_not_retried']);
const context=job=>hash([job.sourceKey,job.title,job.company,job.recruiter,job.recruiterTitle,job.jd]);
const stamp=()=>new Date().toISOString();
const checkedText=(value,max,required=false)=>{
  if (typeof value!=='string' || value.length>max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value) || (required && !value.trim())) throw new Error('INVALID_TEXT');
  return value.trim();
};
export class Store {
  transaction(operation) {
    this.db.exec('BEGIN IMMEDIATE');
    try {const result=operation();this.db.exec('COMMIT');return result;}
    catch(error) {this.db.exec('ROLLBACK');throw error;}
  }
  getMeta(key,fallback=null) {
    const row=this.db.prepare('SELECT value FROM app_metadata WHERE key=?').get(key);
    return row ? JSON.parse(row.value) : fallback;
  }
  setMeta(key,value) {this.db.prepare('INSERT INTO app_metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));}
  profile(input) {
    if (input===undefined) return this.getMeta('profile',null);
    // 求职资料只接收白名单字段，不能借配置接口保存认证信息或任意响应。
    const facts=Array.isArray(input.facts) ? input.facts : [];
    if (facts.length>100) throw new Error('PROFILE_TOO_LARGE');
    const preferences=input.preferences || {};
    const list=value=>{if (!Array.isArray(value) || value.length>30) throw new Error('INVALID_PROFILE');return value.map(x=>checkedText(x,100,true));};
    const current=this.profile();
    if (input.revision!==undefined && input.revision!==(current?.revision || 0)) throw new Error('PROFILE_CHANGED');
    const salary=value=>{if (value==null || value==='') return null;if (!Number.isFinite(value) || value<0 || value>1000) throw new Error('INVALID_SALARY');return value;};
    const salaryMin=salary(preferences.salaryMin),salaryMax=salary(preferences.salaryMax);
    if (salaryMin!==null && salaryMax!==null && salaryMin>salaryMax) throw new Error('INVALID_SALARY_RANGE');
    const choice=(value,allowed)=>{if (!allowed.includes(value || '')) throw new Error('INVALID_PROFILE');return value || '';};
    const profile={displayName:checkedText(input.displayName || '',100),facts:facts.map(x=>checkedText(x,2000,true)),revision:(current?.revision || 0)+1,preferences:{keywords:list(preferences.keywords || []),cities:list(preferences.cities || []),salaryMin,salaryMax,experience:choice(preferences.experience,['','应届','不限','1年以内','1-3年','3-5年','5-10年','10年以上']),degree:choice(preferences.degree,['','不限','大专','本科','硕士','博士']),workMode:choice(preferences.workMode,['','不限','现场','远程','混合']),notes:checkedText(preferences.notes || '',2000)}};
    this.setMeta('profile',profile);this._bump();return {ok:true,saved:true,revision:profile.revision};
  }
  deliveryDraft(id) {const row=this.db.prepare('SELECT data FROM greeting_drafts WHERE id=?').get(id);return row ? JSON.parse(row.data) : null;}
  queueDraft(input) {
    const draft=this.deliveryDraft(input.id),job=draft && this.job(draft.sourceKey);
    if (!draft || draft.revision!==input.revision || draft.status!=='draft') throw new Error('DRAFT_CHANGED');
    if (!draft.recruiter || !job?.detailVerified || !job.jd || draft.contextFingerprint!==context(job)) throw new Error('DRAFT_NOT_READY');
    if (input.text!==draft.text) throw new Error('UNSAVED_DRAFT');
    return draft;
  }
  deliveryTransition(id,expected,status,errorCode=null) {
    const draft=this.deliveryDraft(id);
    if (!draft || !expected.includes(draft.status)) throw new Error('DELIVERY_STATE_CHANGED');
    draft.status=status;draft.revision++;draft.updatedAt=stamp();draft.lastErrorCode=errorCode;
    draft.deliveryVerified=false;this._putDraft(draft);this._bump();return this._public(draft);
  }
  deliveryContextValid(draft) {const job=this.job(draft.sourceKey);return !!job?.detailVerified && !!job.jd && draft.contextFingerprint===context(job);}
  jobs() {return this.db.prepare('SELECT data FROM catalog_jobs ORDER BY rowid').all().map(row=>JSON.parse(row.data));}
  job(sourceKey) {const row=this.db.prepare('SELECT data FROM catalog_jobs WHERE source_key=?').get(sourceKey);return row ? JSON.parse(row.data) : null;}
  mergeJobs(jobs) {
    return this.transaction(()=>{
      let added=0;
      for (const incoming of jobs) {
        const old=this.job(incoming.sourceKey);
        const job={...old,...incoming};
        if (!old) added++;
        const changed=old && context(old)!==context(job);
        if (changed) {
          delete job.greeting;delete job.score;job.needsScoring=true;
          const row=this.db.prepare('SELECT id,data FROM greeting_drafts WHERE source_key=?').get(job.sourceKey);
          if (row) {
            const draft=JSON.parse(row.data);
            // JD 或联系人变化时旧草稿不可继续填入；已发生外部动作的状态保留。
            if (!protectedStates.has(draft.status)) this._putDraft({...draft,status:'skipped',contextFingerprint:null,revision:draft.revision+1,updatedAt:stamp(),lastErrorCode:'JOB_CONTEXT_CHANGED'});
          }
        }
        this.db.prepare('INSERT INTO catalog_jobs VALUES (?,?) ON CONFLICT(source_key) DO UPDATE SET data=excluded.data').run(job.sourceKey,JSON.stringify(job));
      }
      this._bump();return {newCount:added,catalogCount:this.jobs().length};
    });
  }
  reviews(input) {
    if (!input || !Array.isArray(input.reviews) || !input.reviews.length || input.reviews.length>100) throw new Error('INVALID_REVIEW_BATCH');
    return this.transaction(()=>{
      for (const item of input.reviews) {
        const job=this.job(item.sourceKey);
        if (!job || !job.detailVerified || !job.jd || job.needsDetail) throw new Error('VERIFIED_DETAIL_REQUIRED');
        // 审阅输入携带正文版本指纹，避免 AI 使用已过时的 JD 覆盖新数据。
        if (item.contextFingerprint!==context(job)) throw new Error('STALE_REVIEW_CONTEXT');
        const current=this.db.prepare('SELECT data FROM greeting_drafts WHERE source_key=?').get(job.sourceKey);
        const old=current ? JSON.parse(current.data) : null;
        if (old && protectedStates.has(old.status)) throw new Error('DRAFT_ALREADY_PROCESSED');
        const greeting=checkedText(item.greeting,500,true);
        if (!Number.isFinite(item.score) || item.score<0 || item.score>100) throw new Error('INVALID_SCORE');
        const hits=Array.isArray(item.hits) ? item.hits.slice(0,30).map(x=>checkedText(x,100,true)) : [];
        Object.assign(job,{greeting,score:item.score,hits,matchReason:checkedText(item.reason || '',2000),caution:checkedText(item.caution || '',2000),needsScoring:false});
        this.db.prepare('UPDATE catalog_jobs SET data=? WHERE source_key=?').run(JSON.stringify(job),job.sourceKey);
        this._putDraft({id:hash(job.sourceKey).slice(0,32),platform:job.platform,sourceKey:job.sourceKey,jobId:job.jobId,company:job.company,title:job.title,recruiter:job.recruiter || '',recruiterTitle:job.recruiterTitle || '',text:greeting,contextFingerprint:context(job),status:'draft',revision:(old?.revision || 0)+1,updatedAt:stamp(),lastErrorCode:null,deliveryVerified:false});
      }
      this._bump();return {ok:true,saved:input.reviews.length};
    });
  }
  listDrafts(platform='boss') {
    return {drafts:this.db.prepare('SELECT data FROM greeting_drafts WHERE platform=? ORDER BY rowid').all(platform).map(row=>this._public(JSON.parse(row.data))),revision:this.getMeta('revision',0),sendingSupported:true};
  }
  draftAction(action,input) {
    return this.transaction(()=>{
      const stored=this.db.prepare('SELECT data FROM greeting_drafts WHERE id=?').get(input.id);
      const draft=stored ? JSON.parse(stored.data) : null;
      if (!draft || draft.revision!==input.revision || draft.platform!=='boss') throw new Error('DRAFT_CHANGED');
      let ticket;
      if (action==='update') {
        if (!['draft','skipped'].includes(draft.status) || !['save','skip'].includes(input.action)) throw new Error('DRAFT_NOT_EDITABLE');
        if (input.action==='save') {
          const job=this.job(draft.sourceKey);
          if (!job || !job.jd || !job.detailVerified || draft.contextFingerprint!==context(job)) throw new Error('JOB_CONTEXT_CHANGED');
          draft.text=checkedText(input.text,500,true);job.greeting=draft.text;
          this.db.prepare('UPDATE catalog_jobs SET data=? WHERE source_key=?').run(JSON.stringify(job),job.sourceKey);
        }
        draft.status=input.action==='skip' ? 'skipped' : 'draft';
      } else if (action==='reserve') {
        const job=this.job(draft.sourceKey);
        if (draft.status!=='draft' || !draft.recruiter || !job || draft.contextFingerprint!==context(job) || !job.detailVerified) throw new Error('DRAFT_NOT_READY');
        ticket=randomUUID();draft.ticket=ticket;draft.status='fill_pending';
      } else if (action==='result') {
        if (draft.status!=='fill_pending' || draft.ticket!==input.ticket || !['filled','rejected','uncertain'].includes(input.outcome)) throw new Error('FILL_TICKET_REJECTED');
        draft.status=input.outcome==='rejected' ? 'draft' : 'filled_unconfirmed';draft.fillOutcome=input.outcome;
        draft.lastErrorCode=/^[A-Z][A-Z0-9_]{0,63}$/.test(input.errorCode || '') ? input.errorCode : null;delete draft.ticket;
      } else if (action==='report-sent') {
        if (input.confirmedByUser!==true || !['fill_pending','filled_unconfirmed'].includes(draft.status)) throw new Error('USER_CONFIRMATION_REQUIRED');
        draft.status='user_reported_sent';delete draft.ticket;
      } else throw new Error('INVALID_DRAFT_ACTION');
      draft.revision++;draft.updatedAt=stamp();this._putDraft(draft);this._bump();
      return {draft:this._public(draft),...(ticket ? {ticket} : {}),deliveryVerified:false};
    });
  }
  pending() {
    return this.jobs().map(job=>({...job,contextFingerprint:context(job)})).filter(job=>!job.greeting || job.needsScoring);
  }
  runs() {return this.db.prepare('SELECT data FROM workflow_runs ORDER BY rowid DESC').all().map(row=>JSON.parse(row.data));}
  run(id) {const row=this.db.prepare('SELECT data FROM workflow_runs WHERE request_id=?').get(id);return row ? JSON.parse(row.data) : null;}
  putRun(run) {this.db.prepare('INSERT INTO workflow_runs VALUES (?,?) ON CONFLICT(request_id) DO UPDATE SET data=excluded.data').run(run.id,JSON.stringify(run));}
  schedules() {return this.db.prepare('SELECT data FROM schedules ORDER BY rowid').all().map(row=>JSON.parse(row.data));}
  putSchedule(schedule) {this.db.prepare('INSERT INTO schedules VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(schedule.id,JSON.stringify(schedule));}
  close() {this.db.close();}
  constructor(dir) {
    this.db=new DatabaseSync(path.join(dir,'history.sqlite3'));
    // 在任何建表或迁移前校验归属，拒绝把旧版或其他程序数据库当作新库。
    const tables=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND instr(name,'sqlite_')<>1").all();
    if (tables.length) {
      const names=new Set(tables.map(row=>row.name));
      const required=['app_metadata','catalog_jobs','greeting_drafts','workflow_runs','schedules'];
      if (required.some(name=>!names.has(name))) {this.db.close();throw new Error('FOREIGN_DATABASE_REJECTED');}
      const row=this.db.prepare("SELECT value FROM app_metadata WHERE key='schemaVersion'").get();
      if (!row || row.value!=='1') {this.db.close();throw new Error('INCOMPATIBLE_DATABASE_SCHEMA');}
    }
    this.db.exec('PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS app_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS catalog_jobs(source_key TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS greeting_drafts(id TEXT PRIMARY KEY,source_key TEXT NOT NULL UNIQUE,platform TEXT NOT NULL,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS workflow_runs(request_id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS schedules(id TEXT PRIMARY KEY,data TEXT NOT NULL);');
    const schema=this.getMeta('schemaVersion');
    if (schema!==null && schema!==1) {this.db.close();throw new Error('INCOMPATIBLE_DATABASE_SCHEMA');}
    this.setMeta('schemaVersion',1);
  }
  _bump() {this.setMeta('revision',this.getMeta('revision',0)+1);}
  _putDraft(draft) {this.db.prepare('INSERT INTO greeting_drafts VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(draft.id,draft.sourceKey,draft.platform,JSON.stringify(draft));}
  _public(draft) {const {ticket,contextFingerprint,...result}=draft;return result;}
}
