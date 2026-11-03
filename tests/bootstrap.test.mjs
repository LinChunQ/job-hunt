import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import net from 'node:net';
import {ROOT,readBridge} from '../server/runtime.mjs';
import {waitForProcessExit,terminateTestService} from './process-helper.mjs';
const exec=promisify(execFile);
const windows=process.platform==='win32';
const options={skip:!windows,timeout:90000};
const shell=process.env.JOB_HUNT_TEST_POWERSHELL || 'powershell.exe';
async function powershell(script,args=[],env=process.env) {return exec(shell,['-NoProfile','-ExecutionPolicy','Bypass','-File',script,...args],{cwd:ROOT,env,windowsHide:true,timeout:45000,maxBuffer:2*1024*1024});}

test('Windows runtime selection, offline fallback, checksum and cleanup invariants',options,async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'job-hunt-bootstrap-'));
  try {
    for (const shortPath of [false,true]) {
      const temporary=path.join(dir,shortPath ? 'short path fixture' : 'long path fixture');fs.mkdirSync(temporary);
      const {stdout}=await powershell(path.join(ROOT,'tests/runtime-bootstrap.test.ps1'),['-NodePath',process.execPath,'-TemporaryRoot',temporary,...(shortPath ? ['-UseShortTemporaryRoot'] : [])]);
      const report=JSON.parse(stdout);assert.equal(report.ok,true);assert.equal(report.checks.length,8);assert.equal(report.officialDownloadPerformed,false);assert.equal(report.shortPathRequested,shortPath);
    }
  } finally {fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

test('Windows wrapper forwards private input paths and preserves status without touching PATH',options,async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'job-hunt-wrapper-'));
  const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));
  const env={...process.env,JOB_HUNT_RUNTIME_DIR:path.join(dir,'runtime'),NODE_OPTIONS:'--invalid-job-hunt-test-option'};
  const original=process.env.PATH;let pid;
  const run=async(...args)=>JSON.parse((await powershell(path.join(ROOT,'scripts/job-hunt.ps1'),['--no-runtime-download',...args],env)).stdout);
  try {
    const info=await run('--runtime-info');assert.equal(info.sqlite,true);assert.equal(info.systemPathChanged,false);
    const doctor=await run('doctor','--state-dir',dir);assert.equal(doctor.sqlite,true);assert.equal(doctor.localService,null);
    let result=await run('service','start','--state-dir',dir,'--port',String(port));assert.equal(result.running,true);pid=readBridge(dir).pid;
    const input=path.join(dir,'资料 with spaces.json');fs.writeFileSync(input,JSON.stringify({displayName:'示例候选人',facts:['虚构事实']}));
    result=await run('profile','put','--input',input,'--state-dir',dir);assert.equal(result.saved,true);
    result=await run('profile','get','--state-dir',dir);assert.deepEqual(result.profile.facts,['虚构事实']);
    const rejected=await powershell(path.join(ROOT,'scripts/job-hunt.ps1'),['--no-runtime-download','unknown-command','--state-dir',dir],env).then(()=>null,error=>error);
    assert.equal(rejected.code,2);assert.equal(JSON.parse(rejected.stdout).errorCode,'UNKNOWN_COMMAND');
    await run('service','stop','--state-dir',dir);
    await waitForProcessExit(pid);
    assert.equal(process.env.PATH,original);
  } finally {await terminateTestService(pid);fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
