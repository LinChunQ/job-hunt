import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {inflateRawSync} from 'node:zlib';
import {buildRelease} from '../scripts/build-release.mjs';
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'job-hunt-release-')),root=path.join(dir,'source');fs.mkdirSync(root);
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  const files={'package.json':JSON.stringify({name:'job-hunt',version:'0.1.1',files:['SKILL.md','README.md','release.json','scripts/','server/','extension/']}),'release.json':JSON.stringify({name:'job-hunt',version:'0.1.1'}),'SKILL.md':'示例技能','README.md':'示例说明','scripts/job-hunt.ps1':'# 示例入口','scripts/job-hunt.mjs':'// 示例入口','server/main.mjs':'// 示例服务','extension/manifest.json':JSON.stringify({version:'0.1.1'})};
  for(const [name,content] of Object.entries(files)) {fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),content);}
  const git=args=>execFileSync('git',['-C',root,...args],{stdio:['ignore','pipe','pipe']});git(['init','-b','main']);git(['add','.']);
  return {dir,root,files};
}
function unzip(buffer) {
  const entries=new Map();let offset=0;
  while(buffer.readUInt32LE(offset)===0x04034b50) {
    assert.equal(buffer.readUInt16LE(offset+8),8);const length=buffer.readUInt32LE(offset+18),size=buffer.readUInt32LE(offset+22),nameLength=buffer.readUInt16LE(offset+26),extraLength=buffer.readUInt16LE(offset+28);
    const name=buffer.subarray(offset+30,offset+30+nameLength).toString('utf8'),start=offset+30+nameLength+extraLength,data=inflateRawSync(buffer.subarray(start,start+length));
    assert.equal(data.length,size);entries.set(name,data.toString('utf8'));offset=start+length;
  }
  assert.equal(buffer.readUInt32LE(offset),0x02014b50);assert.equal(buffer.readUInt32LE(buffer.length-22),0x06054b50);assert.equal(buffer.readUInt16LE(buffer.length-12),entries.size);
  return entries;
}
test('release archive is deterministic, complete and excludes untracked private state',t=>{
  const {dir,root,files}=fixture(t);fs.mkdirSync(path.join(root,'data'));fs.writeFileSync(path.join(root,'data','resume.json'),'private fixture');
  const first=buildRelease({packageRoot:root,outputDirectory:path.join(dir,'first')}),second=buildRelease({packageRoot:root,outputDirectory:path.join(dir,'second')});
  const archive=fs.readFileSync(first.archive);assert.deepEqual(archive,fs.readFileSync(second.archive));
  const entries=unzip(archive);assert.equal(entries.size,Object.keys(files).length);
  for(const [name,content] of Object.entries(files)) assert.equal(entries.get('job-hunt/'+name),content);
  assert.equal([...entries.keys()].some(name=>name.includes('.git') || name.includes('data/')),false);
  assert.throws(()=>buildRelease({packageRoot:root,outputDirectory:path.join(dir,'first')}),/EEXIST/);
});
test('release rejects version mismatch and private contents before writing an archive',t=>{
  const {dir,root}=fixture(t),outputDirectory=path.join(dir,'output');
  fs.writeFileSync(path.join(root,'release.json'),JSON.stringify({name:'job-hunt',version:'0.1.2'}));
  assert.throws(()=>buildRelease({packageRoot:root,outputDirectory}),/VERSION_MISMATCH/);
  fs.writeFileSync(path.join(root,'release.json'),JSON.stringify({name:'job-hunt',version:'0.1.1'}));
  fs.writeFileSync(path.join(root,'README.md'),JSON.stringify({cookie:'synthetic'.repeat(5)}));
  assert.throws(()=>buildRelease({packageRoot:root,outputDirectory}),/PRIVACY_CHECK_FAILED/);
  assert.equal(fs.existsSync(path.join(outputDirectory,'job-hunt.zip')),false);
});
