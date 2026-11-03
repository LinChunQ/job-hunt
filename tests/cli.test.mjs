import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {ROOT,readBridge} from '../server/runtime.mjs';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function command(args) {return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(ROOT,'scripts/job-hunt.mjs'),...args],{cwd:ROOT,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',error='';child.stdout.on('data',value=>output+=value);child.stderr.on('data',value=>error+=value);const timer=setTimeout(()=>{child.kill();reject(new Error('CLI_TEST_TIMEOUT'));},15000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);try {resolve({code,data:JSON.parse(output),error});} catch {reject(new Error('CLI_JSON_EXPECTED'));}});});}
async function freePort() {const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}

test('CLI starts isolated service, persists profile and plan, pairs without logging secrets and stops',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'job-hunt-cli-')),port=await freePort();let pid;
  const run=(...args)=>command([...args,'--state-dir',dir]);
  try {
    let result=await run('doctor');assert.equal(result.code,0);assert.equal(result.data.pythonRequired,false);assert.equal(result.data.localService,null);
    result=await run('service','start','--port',String(port));assert.equal(result.code,0);assert.equal(result.data.storageBackend,'sqlite');pid=readBridge(dir).pid;
    result=await run('service','start');assert.equal(result.code,0);assert.equal(readBridge(dir).pid,pid);
    result=await run('pair');assert.equal(result.code,0);const key=result.data.pairing_code;assert.match(key,/^[a-f0-9]{64}$/);
    const log=fs.readFileSync(path.join(dir,'service.log'),'utf8');assert.equal(log.includes(key),false);
    const input=path.join(dir,'input.json');fs.writeFileSync(input,JSON.stringify({displayName:'示例候选人',facts:['虚构项目经验'],preferences:{keywords:['示例岗位']}}));
    result=await run('profile','put','--input',input);assert.equal(result.code,0);assert.equal(result.data.saved,true);
    result=await run('profile','get');assert.deepEqual(result.data.profile.facts,['虚构项目经验']);
    fs.writeFileSync(input,JSON.stringify({id:'example-plan',enabled:false,intervalMinutes:30,task:{platform:'boss',action:'search',query:'示例岗位',city:'101010100'}}));
    result=await run('schedule','put','--input',input);assert.equal(result.data.schedule.enabled,false);
    result=await run('task','--input',path.join(ROOT,'examples/search.example.json'));assert.equal(result.code,2);assert.equal(result.data.errorCode,'INPUT_FILE_MUST_BE_OUTSIDE_PACKAGE');
    result=await run('update','apply');assert.equal(result.data.errorCode,'UPDATE_ACTION_NOT_IMPLEMENTED');
    result=await run('ui');assert.equal(result.data.url,'http://127.0.0.1:'+port);assert.equal(JSON.stringify(result.data).includes(key),false);
    result=await run('service','stop');assert.equal(result.code,0);
    let stopped=false;for(let i=0;i<30;i++) {await delay(100);try {process.kill(pid,0);} catch {stopped=true;break;}}assert.equal(stopped,true);
  } finally {if(pid) {try {process.kill(pid);} catch {}}fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
