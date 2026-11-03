import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {configure,renderHero,updatedReadme,repositoryName,ROOT} from '../scripts/configure-github.mjs';
const release={name:'job-hunt',version:'0.1.0',channel:'preview',githubRepository:null,automaticUpdateEnabled:false};

test('unconfigured hero shows honest placeholders, correct runtime and no foreign repository',()=>{
  const html=renderHero(release);
  assert.match(html,/<h1 align="center">job-hunt v0\.1\.0<\/h1>/);
  assert.equal((html.match(/<img /g) || []).length,9);
  assert.match(html,/message=v0\.1\.0-preview/);
  assert.match(html,/not\+published/);
  assert.match(html,/SQLite/);
  assert.equal(html.includes('https://github.com/'),false);
  assert.equal(html.includes('img.shields.io/github/'),false);
  assert.equal(html.includes('Python'),false);
  assert.equal(html.includes('passing'),false);
});

test('configured hero derives every repository badge and link from one public identifier',()=>{
  const html=renderHero({...release,githubRepository:'example/job-hunt'});
  for (const metric of ['stars','issues','last-commit']) assert.ok(html.includes('https://img.shields.io/github/'+metric+'/example/job-hunt'));
  assert.ok(html.includes('/github/actions/workflow/status/example/job-hunt/ci.yml?branch=main&amp;label=checks'));
  assert.ok(html.includes('https://github.com/example/job-hunt/actions/workflows/ci.yml'));
  assert.ok(html.includes('https://img.shields.io/github/downloads/example/job-hunt/total?style=flat&amp;label=release%20downloads'));
  assert.ok(html.includes('label=users&amp;message=not+tracked'));
  assert.equal(html.includes('not+published'),false);
});

test('configuration updates release and hero together, preserves prose and is idempotent',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'job-hunt-docs-'));
  try {
    fs.writeFileSync(path.join(dir,'release.json'),JSON.stringify(release));
    const body='\n\n## 正文\n\n维护者内容不变。\n';
    fs.writeFileSync(path.join(dir,'README.md'),renderHero(release)+body);
    const result=configure({root:dir,repository:'example/job-hunt'});
    assert.equal(result.networkRequestPerformed,false);
    assert.equal(result.gitRemoteChanged,false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'release.json'),'utf8')).githubRepository,'example/job-hunt');
    const first=fs.readFileSync(path.join(dir,'README.md'),'utf8');assert.ok(first.endsWith(body));
    configure({root:dir});assert.equal(fs.readFileSync(path.join(dir,'README.md'),'utf8'),first);
    assert.equal(configure({root:dir,check:true}).ok,true);
    const changed={...release,version:'0.2.0',channel:'stable',githubRepository:'example/job-hunt'};
    fs.writeFileSync(path.join(dir,'release.json'),JSON.stringify(changed));
    assert.throws(()=>configure({root:dir,check:true}),/OUT_OF_DATE/);
    configure({root:dir});const next=fs.readFileSync(path.join(dir,'README.md'),'utf8');
    assert.match(next,/job-hunt v0\.2\.0/);assert.equal(next.includes('v0.1.0'),false);assert.equal(next.includes('preview'),false);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('invalid repository input and malformed markers fail before changing files',()=>{
  for (const input of ['https://github.com/example/job-hunt','example/job-hunt?token=bad','../secret','example/..','example/job-hunt" onclick="bad','example/job-hunt\n']) assert.throws(()=>repositoryName(input),/INVALID/);
  assert.throws(()=>updatedReadme('# no marker',release),/MARKERS/);
  assert.throws(()=>updatedReadme(renderHero(release)+renderHero(release),release),/MARKERS/);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'job-hunt-docs-invalid-'));
  try {
    const file=path.join(dir,'release.json');fs.writeFileSync(file,JSON.stringify(release));
    fs.writeFileSync(path.join(dir,'README.md'),'# no marker');const before=fs.readFileSync(file,'utf8');
    assert.throws(()=>configure({root:dir,repository:'example/job-hunt'}),/MARKERS/);
    assert.equal(fs.readFileSync(file,'utf8'),before);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('README generated header and local documentation links remain valid',()=>{
  // 本地验证不抓取真实 GitHub 仓库，不联网测试统计数字。
  const text=fs.readFileSync(path.join(ROOT,'README.md'),'utf8');
  const config=JSON.parse(fs.readFileSync(path.join(ROOT,'release.json'),'utf8'));
  assert.equal(updatedReadme(text,config),text);
  const relativeLinks=[...text.matchAll(/\]\((references\/[^)]+)\)/g)].map(match=>match[1]);
  const htmlLinks=[...text.matchAll(/href="(references\/[^"#]+)"/g)].map(match=>match[1]);
  assert.ok(relativeLinks.length+htmlLinks.length>=5);
  for (const target of [...relativeLinks,...htmlLinks]) assert.equal(fs.existsSync(path.join(ROOT,target)),true,target);
  assert.equal(text.includes('C:'+String.fromCharCode(92)+'Users'),false);
});
