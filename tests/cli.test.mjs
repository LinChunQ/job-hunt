import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {ROOT,readBridge} from '../server/runtime.mjs';
import {waitForProcessExit,terminateTestService} from './process-helper.mjs';
function command(args,root=ROOT) {return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,'scripts/job-hunt.mjs'),...args],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='',error='';child.stdout.on('data',value=>output+=value);child.stderr.on('data',value=>error+=value);const timer=setTimeout(()=>{child.kill();reject(new Error('CLI_TEST_TIMEOUT'));},15000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);try {resolve({code,data:JSON.parse(output),error});} catch {reject(new Error('CLI_JSON_EXPECTED'));}});});}
async function freePort() {const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}

test('CLI starts isolated service, persists profile and plan, pairs without logging secrets and stops',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'job-hunt-cli-')),port=await freePort();let pid;
  const run=(...args)=>command([...args,'--state-dir',dir]);
  try {
    let result=await run('doctor');assert.equal(result.code,0);assert.equal(result.data.pythonRequired,false);assert.equal(result.data.localService,null);
    result=await run('setup','--no-open','--port',String(port));assert.equal(result.code,0);assert.equal(result.data.checks.service,true);assert.equal(result.data.siteRequestPerformed,false);assert.ok(result.data.nextActions.includes('PROVIDE_RESUME_OR_FACTS'));pid=readBridge(dir).pid;
    result=await run('service','start');assert.equal(result.code,0);assert.equal(readBridge(dir).pid,pid);
    result=await run('pair');assert.equal(result.code,0);const key=result.data.pairing_code;assert.match(key,/^[a-f0-9]{64}$/);
    const log=fs.readFileSync(path.join(dir,'service.log'),'utf8');assert.equal(log.includes(key),false);
    const input=path.join(dir,'input.json');fs.writeFileSync(input,JSON.stringify({displayName:'示例候选人',facts:['虚构项目经验'],preferences:{keywords:['示例岗位']}}));
    result=await run('profile','put','--input',input);assert.equal(result.code,0);assert.equal(result.data.saved,true);
    result=await run('profile','get');assert.deepEqual(result.data.profile.facts,['虚构项目经验']);
    result=await run('setup','--no-open');assert.equal(result.code,0);assert.equal(readBridge(dir).pid,pid);assert.equal(result.data.checks.resumeFactsAvailable,true);assert.equal(result.data.checks.keywordsConfigured,true);assert.equal(result.data.checks.citiesConfigured,false);assert.equal(result.data.pairingCodeIncluded,false);
    result=await run('runs');assert.deepEqual(result.data.runs,[]);
    result=await run('onboarding');assert.equal(result.data.checks.resumeFactsAvailable,true);assert.equal(JSON.stringify(result.data).includes('虚构项目经验'),false);
    fs.writeFileSync(input,JSON.stringify({id:'example-plan',enabled:false,intervalMinutes:30,task:{platform:'boss',action:'search',query:'示例岗位',city:'101010100'}}));
    result=await run('schedule','put','--input',input);assert.equal(result.data.schedule.enabled,false);
    result=await run('task','--input',path.join(ROOT,'examples/search.example.json'));assert.equal(result.code,2);assert.equal(result.data.errorCode,'INPUT_FILE_MUST_BE_OUTSIDE_PACKAGE');
    result=await run('update','apply');assert.equal(result.data.errorCode,'UPDATE_ACTION_NOT_IMPLEMENTED');
    result=await run('ui','--no-open');assert.equal(result.data.url,'http://127.0.0.1:'+port);assert.equal(JSON.stringify(result.data).includes(key),false);
    result=await run('service','stop');assert.equal(result.code,0);
    await waitForProcessExit(pid);
  } finally {await terminateTestService(pid);fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});


test('installed package can initialize without developer files or creating site actions',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'job-hunt-installed-cli-')),port=await freePort();
  const skillsRoot=path.join(dir,'skills'),state=path.join(dir,'state');fs.mkdirSync(skillsRoot);let pid;
  try {
    const result=await command(['install','--skills-dir',skillsRoot]);
    assert.equal(result.code,0);const installed=result.data.installationDirectory;
    assert.equal(fs.existsSync(path.join(installed,'.git')),false);
    assert.equal(fs.existsSync(path.join(installed,'tests')),false);
    let report=await command(['setup','--no-open','--state-dir',state,'--port',String(port)],installed);
    assert.equal(report.code,0);pid=readBridge(state).pid;
    assert.equal(report.data.siteRequestPerformed,false);assert.equal(report.data.scheduleCreated,false);
    assert.deepEqual((await command(['schedule','list','--state-dir',state],installed)).data.schedules,[]);
    assert.deepEqual((await command(['runs','--state-dir',state],installed)).data.runs,[]);
    report=await command(['onboarding','--state-dir',state],installed);
    assert.equal(report.data.checks.resumeFactsAvailable,false);
    assert.equal((await command(['service','stop','--state-dir',state],installed)).code,0);
    await waitForProcessExit(pid);
  } finally {await terminateTestService(pid);fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
