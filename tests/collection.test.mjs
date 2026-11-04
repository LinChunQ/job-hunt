import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../server/storage.mjs';
import {Engine} from '../server/engine.mjs';
import {Collection,collectionOptions} from '../server/collection.mjs';
import {checkedTask,browserTask,cleanPages} from '../server/platforms.mjs';
import {checkedFilters,prefilter,salaryRange} from '../server/job-pool.mjs';
import {createService} from '../server/http.mjs';
const options={requestId:'test',platform:'boss',keywords:['示例岗位'],cities:[{name:'示例城市',code:'000000001'}],maxPages:2,detailLimit:2,requestBudget:10};
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'job-hunt-pipeline-')),store=new Store(dir);let now=1000000;
  const engine=new Engine(store,{now:()=>now,cooldown:100}),collection=new Collection(store,engine,{now:()=>now});
  engine.resume();engine.claim();
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {dir,store,engine,collection,advance:()=>{now+=200;engine.heartbeat();}};
}
const row=(id,extra={})=>({encryptJobId:id,jobName:'示例工程师',brandName:'虚构公司',salaryDesc:'15-25K·13薪',cityName:'示例城市',recruiterName:'示例招聘人',...extra});
const page=(rows,hasMore=false)=>[{ok:true,jobs:rows,hasMore}];
function complete(env,rows,hasMore=false){const claim=env.engine.claim();assert.ok(claim.task);env.engine.complete({task_id:claim.task.id,ok:true,pages:page(rows,hasMore)});env.advance();env.collection.tick();return claim.task;}
const current=env=>env.collection.list().runs[0];

test('collection inputs are bounded and page two stays page two in browser form',()=>{
  const task=checkedTask({platform:'boss',action:'search',query:'示例',city:'000000001',page:2});assert.equal(browserTask(task,'id').form.page,'2');
  assert.throws(()=>checkedTask({...task,page:4}),/SEARCH_PAGE/);assert.throws(()=>collectionOptions({...options,cities:[{name:'示例',code:'猜测'}]}),/CITY_CODE/);
  assert.throws(()=>collectionOptions({...options,maxPages:10}),/LIMIT/);assert.throws(()=>collectionOptions({...options,requestBudget:1}),/BUDGET/);
});

test('monthly salary parser never guesses private-font, daily or annual values',()=>{
  assert.deepEqual(salaryRange('15-25K·13薪'),{min:15,max:25});assert.deepEqual(salaryRange('1.5-2.5万'),{min:15,max:25});
  for(const value of ['200-300元/天','30-50万/年','面议','\uE031\uE032K'])assert.equal(salaryRange(value),null);
  const filters=checkedFilters({salaryMin:20,blockedCompanies:['外包'],titleExcludes:['销售'],jdExcludes:['驻场']});
  assert.equal(prefilter({company:'示例外包',title:'工程师'},filters),'BLOCKED_COMPANY');assert.equal(prefilter({salary:'10-15K'},filters),'SALARY_OUT_OF_RANGE');assert.equal(prefilter({salary:'面议'},filters),null);
  assert.equal(prefilter({jd:'需要长期驻场'},filters,{detail:true}),'JD_EXCLUDED');
});

test('prefilter saves details, reuses known JD and pages stay sequential',t=>{
  const env=fixture(t);env.store.mergeJobs(cleanPages(page([row('known',{detail:{jobId:'known',identityVerified:true,description:'虚构验证正文'}})]),{...options,action:'search',query:'示例岗位',city:'000000001'}));
  env.collection.create({...options,filters:{titleExcludes:['销售']}});env.collection.tick();
  assert.equal(complete(env,[row('new'),row('excluded',{jobName:'销售专员'}),row('known')],true).form.page,'1');
  const second=complete(env,[row('other')]);assert.equal(second.form.page,'2');
  const detail=complete(env,[row('new',{detail:{jobId:'new',identityVerified:true,description:'虚构岗位正文'}})]);assert.equal(detail.kind,'details');
  complete(env,[row('other',{detail:{jobId:'other',identityVerified:true,description:'另一份虚构正文'}})]);
  const run=current(env);assert.equal(run.status,'completed');assert.equal(run.counts.new,3);assert.equal(run.counts.duplicates,1);assert.equal(run.counts.filtered,1);assert.equal(run.counts.details,2);assert.equal(run.counts.detailReused,1);assert.equal(run.counts.requestsReserved,6);assert.equal(env.store.job('boss:excluded').filterReason,'TITLE_EXCLUDED');
});

test('repeated page stops combo without counting duplicate page as a checkpoint',t=>{
  const env=fixture(t);env.collection.create({...options,detailLimit:0});env.collection.tick();complete(env,[row('same')],true);complete(env,[row('same')],true);
  assert.equal(current(env).status,'completed_with_shortage');assert.equal(current(env).lastWarning,'REPEATED_SEARCH_PAGE');assert.equal(current(env).pages.length,1);assert.equal(current(env).counts.seen,1);
});

test('pause cancels unclaimed request, resume starts at last completed page',t=>{
  const env=fixture(t);env.collection.create(options);env.collection.tick();complete(env,[row('first')],true);
  const oldTask=current(env).activeTask;assert.equal(env.store.run(oldTask).request.page,2);env.collection.control({id:'test',action:'pause'});assert.equal(env.store.run(oldTask).status,'failed');assert.equal(env.engine.claim().task,null);
  env.advance();env.collection.control({id:'test',action:'resume'});env.collection.tick();assert.equal(env.engine.claim().task.form.page,'2');assert.notEqual(current(env).activeTask,oldTask);
});

test('pause during in-flight result checkpoints once and never dispatches next page',t=>{
  const env=fixture(t);env.collection.create(options);env.collection.tick();const task=env.engine.claim().task;env.collection.control({id:'test',action:'pause'});
  env.engine.complete({task_id:task.id,ok:true,pages:page([row('first')],true)});env.advance();env.collection.tick();assert.equal(current(env).status,'paused');assert.equal(current(env).page,2);assert.equal(current(env).activeTask,null);assert.equal(env.engine.claim().task,null);
});

test('restarts persist uncertainty and require manual engine resolution before resume',t=>{
  const env=fixture(t);env.collection.create(options);env.collection.tick();const task=env.engine.claim().task;
  const engine=new Engine(env.store,{cooldown:0}),collection=new Collection(env.store,engine);
  collection.tick();assert.equal(collection.list().runs[0].status,'paused');assert.equal(env.store.run(task.id).status,'uncertain');assert.equal(engine.claim().task,null);
  assert.throws(()=>collection.control({id:'test',action:'resume'}),/UNRESOLVED/);engine.resolve({requestId:task.id,confirmedByUser:true});engine.resume();engine.claim();collection.control({id:'test',action:'resume'});assert.equal(collection.list().runs[0].page,1);
});

test('budget stops before a two-request detail and never silently extends the plan',t=>{
  const env=fixture(t);env.collection.create({...options,maxPages:1,requestBudget:2});env.collection.tick();complete(env,[row('first')]);assert.equal(current(env).status,'completed_with_shortage');assert.equal(current(env).reason,'REQUEST_BUDGET_REACHED');assert.equal(env.engine.claim().task,null);
});

test('JD exclusion is evaluated only after verified details',t=>{
  const env=fixture(t);env.collection.create({...options,maxPages:1,filters:{jdExcludes:['驻场']}});env.collection.tick();complete(env,[row('first')]);complete(env,[row('first',{detail:{jobId:'first',identityVerified:true,description:'虚构职责：长期驻场'}})]);assert.equal(env.store.job('boss:first').filterReason,'JD_EXCLUDED');assert.equal(env.store.pending().length,0);
});

test('pool actions are atomic, revision checked, soft deleted and still deduplicated',t=>{
  const env=fixture(t);env.store.mergeJobs(cleanPages(page([row('first'),row('other')]),{action:'search',query:'示例',city:'000000001'}));
  const item=key=>({sourceKey:'boss:'+key,revision:env.store.job('boss:'+key).poolRevision});
  assert.throws(()=>env.store.jobActions({action:'archive',confirmedByUser:true,items:[item('first'),{...item('other'),revision:99}]}),/CHANGED/);assert.equal(env.store.job('boss:first').archivedAt,undefined);
  env.store.jobActions({action:'archive',confirmedByUser:true,items:[item('first')]});assert.equal(env.store.searchJobs().total,1);assert.equal(env.store.searchJobs({stage:'archived'}).total,1);
  assert.equal(env.store.mergeJobs(cleanPages(page([row('first')]),{action:'search',query:'示例',city:'000000001'})).newCount,0);assert.equal(env.store.searchJobs({stage:'archived'}).total,1);
  env.store.jobActions({action:'restore',items:[item('first')]});assert.equal(env.store.searchJobs().total,2);assert.ok(env.store.jobHistory('boss:first').some(x=>x.action==='restore'));
});

test('processed draft is protected and substring search treats wildcards literally',t=>{
  const env=fixture(t);env.store.mergeJobs(cleanPages(page([row('first',{jobName:'示例%工程师',detail:{jobId:'first',identityVerified:true,description:'虚构正文'}})]),{action:'search',query:'示例',city:'000000001'}));const job=env.store.pending()[0];env.store.reviews({reviews:[{sourceKey:job.sourceKey,contextFingerprint:job.contextFingerprint,score:90,greeting:'虚构话术'}]});const draft=env.store.listDrafts().drafts[0];env.store.draftAction('reserve',draft);
  assert.throws(()=>env.store.jobActions({action:'skip',items:[{sourceKey:job.sourceKey,revision:job.poolRevision}]}),/PROTECTED/);assert.equal(env.store.searchJobs({query:'%'}).total,1);assert.equal(env.store.searchJobs({query:'_'}).total,0);assert.equal(env.store.searchJobs({stage:'uncertain'}).total,1);assert.equal(env.store.pending().length,0);
});

test('HTTP collection and pool routes require local auth and collection owns browser until pause',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'job-hunt-collection-http-')),service=await createService({dir,port:0,cooldown:0});t.after(async()=>{await service.close();fs.rmSync(dir,{recursive:true,force:true});});
  const post=(route,body={},extra={})=>fetch('http://127.0.0.1:'+service.port+route,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+service.key,...extra},body:JSON.stringify(body)});
  assert.equal((await post('/cli/collections/list',{}, {origin:'https://www.zhipin.com'})).status,403);
  service.engine.resume();service.engine.claim();assert.equal((await post('/cli/collections/create',options)).status,200);
  const rejected=await (await post('/cli/tasks/enqueue',{requestId:'other',platform:'boss',action:'search',query:'示例',city:'000000001'})).json();assert.equal(rejected.errorCode,'COLLECTION_ALREADY_ACTIVE');
  assert.equal((await post('/cli/collections/control',{id:'test',action:'pause'})).status,200);assert.equal((await post('/cli/jobs/search',{})).status,200);
});


test('nested filter and checkpoint writes roll back together on failure',t=>{
  const env=fixture(t);env.store.mergeJobs(cleanPages(page([row('atomic')]),{action:'search',query:'示例',city:'000000001'}));
  assert.throws(()=>env.store.transaction(()=>{env.store.filterJob('boss:atomic','TITLE_EXCLUDED','atomic');env.store.setMeta('testCheckpoint',1);throw new Error('SIMULATED_FAILURE');}),/SIMULATED/);
  assert.equal(env.store.job('boss:atomic').poolStatus,undefined);assert.equal(env.store.getMeta('testCheckpoint'),null);assert.equal(env.store.jobHistory('boss:atomic').some(x=>x.action==='filtered'),false);
});

test('server pool paginates and sorts without treating unscored or unknown salaries as high values',t=>{
  const env=fixture(t);env.store.mergeJobs(cleanPages(page(Array.from({length:15},(_,i)=>row('pool_'+i,{salaryDesc:i%2 ? '面议' : '15-20K'}))),{action:'search',query:'示例',city:'000000001'}));
  const first=env.store.searchJobs({page:1,pageSize:5,sort:'salary'}),last=env.store.searchJobs({page:99,pageSize:5,sort:'salary'});assert.equal(first.pages,3);assert.equal(first.jobs.length,5);assert.equal(first.jobs[0].salary,'15-20K');assert.equal(last.page,3);assert.equal(env.store.searchJobs({minScore:1}).total,0);
  assert.throws(()=>env.store.searchJobs({sort:'unknown'}),/INVALID/);
});

test('zero-detail collection completes as list only and never claims a detail action',t=>{
  const env=fixture(t);env.collection.create({...options,maxPages:1,detailLimit:0});env.collection.tick();complete(env,[row('list_only')]);assert.equal(current(env).status,'completed');assert.equal(current(env).reason,'LIST_ONLY_COMPLETED');assert.equal(env.engine.claim().task,null);assert.equal(env.store.pending().length,1);
});


test('dashboard summary does not return every job body and details are fetched on demand',t=>{
  const env=fixture(t);env.store.mergeJobs(cleanPages(page([row('summary',{detail:{jobId:'summary',identityVerified:true,description:'虚构长正文'}})]),{action:'search',query:'示例',city:'000000001'}));const summary=env.store.jobSummary();assert.equal(summary.counts.active,1);assert.equal(summary.recent[0].jd,undefined);assert.equal(summary.recent[0].greeting,undefined);assert.equal(env.store.jobDetail('boss:summary').jd,'虚构长正文');
});
