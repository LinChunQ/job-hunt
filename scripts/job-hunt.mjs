#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {ROOT,RELEASE,DEFAULT_PORT,runtimeDir,readBridge,localRequest} from '../server/runtime.mjs';
import {platforms} from '../server/platforms.mjs';
import {checkUpdate} from '../server/update.mjs';
const args=process.argv.slice(2);
function take(name) {const i=args.indexOf(name);if (i<0) return undefined;const value=args[i+1];if (!value || value.startsWith('--')) throw new Error('OPTION_VALUE_REQUIRED');args.splice(i,2);return value;}
function inputFile(file) {
  if (!file || fs.statSync(file).size>1000000) throw new Error('INPUT_FILE_REQUIRED_OR_TOO_LARGE');
  // 输入临时文件与代码分离，避免 WorkBuddy 把真实审阅结果写入可提交目录。
  const relative=path.relative(fs.realpathSync(ROOT),fs.realpathSync(file));
  if (!relative || (!relative.startsWith('..'+path.sep) && relative!=='..' && !path.isAbsolute(relative))) throw new Error('INPUT_FILE_MUST_BE_OUTSIDE_PACKAGE');
  return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
}
async function run() {
  const explicit=take('--state-dir'), port=Number(take('--port') || DEFAULT_PORT);
  const [command='help',action]=args;
  if (command==='version') return {name:'job-hunt',...RELEASE};
  if (command==='platforms') return {ok:true,platforms};
  if (command==='update') {if (action!=='check') throw new Error('UPDATE_ACTION_NOT_IMPLEMENTED');return checkUpdate();}
  if (command==='help') return {ok:true,commands:['doctor','profile get|put --input FILE','service start|stop','pair','status','platforms','jobs','pending','runs','task --input FILE','reviews --input FILE','schedule list|put --input FILE','resolve --input FILE','update check','ui']};
  const dir=runtimeDir(explicit);
  if (command==='doctor') {
    let service=null;try {service=await localRequest(dir,'/cli/status');} catch {}
    const sqlite=await import('node:sqlite');
    return {ok:true,name:'job-hunt',version:RELEASE.version,node:process.version,sqlite:!!sqlite.DatabaseSync,runtimeDirectory:dir,extensionDirectory:path.join(ROOT,'extension'),localService:service,pythonRequired:false};
  }
  if (command==='service' && action==='start') {
    if (!Number.isInteger(port) || port<1024 || port>65535) throw new Error('INVALID_PORT');
    try {return await localRequest(dir,'/cli/status');} catch {}
    const lock=path.join(dir,'start.lock');let descriptor;
    try {descriptor=fs.openSync(lock,'wx',0o600);} catch {throw new Error('SERVICE_START_LOCKED');}
    try {
      const log=fs.openSync(path.join(dir,'service.log'),'a',0o600);
      const child=spawn(process.execPath,[path.join(ROOT,'server/main.mjs'),'--state-dir',dir,'--port',String(port)],{cwd:ROOT,detached:true,windowsHide:true,stdio:['ignore',log,log]});
      fs.closeSync(log);child.on('error',()=>{});child.unref();
      for (let attempt=0;attempt<30;attempt++) {await new Promise(resolve=>setTimeout(resolve,100));try {return await localRequest(dir,'/cli/status');} catch {}}
      throw new Error('SERVICE_START_FAILED');
    } finally {fs.closeSync(descriptor);fs.unlinkSync(lock);}
  }
  if (command==='pair') return {ok:true,pairing_code:readBridge(dir).key,instruction:'仅由 WorkBuddy 展示给当前用户，粘贴到本机扩展；不得写入报告、提交或推送'};
  if (command==='ui') return {ok:true,url:'http://127.0.0.1:'+readBridge(dir).port,instruction:'手动打开本机页面并输入配对码，不自动操作浏览器'};
  const routes={status:'/cli/status',jobs:'/cli/jobs',pending:'/cli/pending',runs:'/cli/runs',task:'/cli/tasks/enqueue',reviews:'/cli/reviews/apply',resolve:'/cli/tasks/resolve'};
  if (command==='service' && action==='stop') return localRequest(dir,'/cli/stop');
  if (command==='profile') {
    if (action==='get') return localRequest(dir,'/cli/profile/get');
    if (action==='put') return localRequest(dir,'/cli/profile/put',inputFile(take('--input')));
  }
  if (command==='schedule') {
    if (action==='list') return localRequest(dir,'/cli/schedules/list');
    if (action==='put') return localRequest(dir,'/cli/schedules/put',inputFile(take('--input')));
  }
  if (routes[command]) return localRequest(dir,routes[command],['task','reviews','resolve'].includes(command) ? inputFile(take('--input')) : {});
  throw new Error('UNKNOWN_COMMAND');
}
try {const result=await run();console.log(JSON.stringify(result,null,2));if (result.ok===false) process.exitCode=2;}
catch(error) {const errorCode=/^[A-Z][A-Z0-9_]{0,79}$/.test(error.message || '') ? error.message : 'LOCAL_COMMAND_FAILED';console.log(JSON.stringify({ok:false,errorCode}));process.exitCode=2;}
