import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('extension honors server page instead of resetting each bounded search to page one',async()=>{
  const tab={id:1,url:'https://www.zhipin.com/web/geek/jobs'},config={enabled:true,key:'a'.repeat(64),tabId:1},posted=[],injections=[];
  const event={addListener(){}},chrome={storage:{local:{setAccessLevel(){},get:async()=>config,set:async()=>{}}},tabs:{get:async()=>tab},runtime:{onMessage:event,onStartup:event,onInstalled:event},alarms:{onAlarm:event},scripting:{executeScript:async options=>{injections.push(options);return [{result:{ok:true,jobs:[],hasMore:false}}];}}};
  const fetcher=async(url,options)=>{const body=JSON.parse(options.body);posted.push({url,body});const data=url.endsWith('/extension/ui/next') ? {command:null} : url.endsWith('/extension/next') ? {task:{id:'second-page',kind:'search',max_pages:1,form:{page:'2',pageSize:'15',query:'示例',city:'000000001'}}} : {ok:true};return {ok:true,json:async()=>data};};
  const noop=()=>{},sandbox={chrome,fetch:fetcher,AbortController,setTimeout,clearTimeout,console,prepareChatInPage:noop,chatDraftInPage:noop,sendGreetingInPage:noop,createDraftController:noop,fetchJobsInPage:noop,fetchDetailCandidatesInPage:noop,fetchObservedDetailInPage:noop,buildDiagnosticReport:noop};vm.createContext(sandbox);
  const source=fs.readFileSync(new URL('../extension/background.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');vm.runInContext(source,sandbox);await vm.runInContext('poll()',sandbox);
  assert.equal(injections.length,1);assert.equal(injections[0].args[0].page,'2');assert.equal(posted.at(-1).body.task_id,'second-page');assert.equal(posted.at(-1).body.ok,true);
});
