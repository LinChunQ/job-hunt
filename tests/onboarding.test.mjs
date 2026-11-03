import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ROOT} from '../server/runtime.mjs';
import {onboardingReport} from '../server/onboarding.mjs';
import {installForWorkBuddy} from '../scripts/install-workbuddy.mjs';

function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'job-hunt-install-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  const skillsRoot=path.join(dir,'skills'),source=path.join(dir,'source');
  fs.mkdirSync(skillsRoot);fs.mkdirSync(source);
  const files=['SKILL.md','README.md','release.json','scripts/','server/','extension/'];
  const content={'package.json':JSON.stringify({name:'job-hunt',version:'0.1.0',files}),'release.json':JSON.stringify({name:'job-hunt',version:'0.1.0'}),'SKILL.md':'公开示例 skill','README.md':'公开示例说明','scripts/job-hunt.ps1':'# 示例入口','scripts/job-hunt.mjs':'// 示例入口','server/main.mjs':'// 示例服务','extension/manifest.json':JSON.stringify({manifest_version:3,name:'示例插件',version:'0.1.0'})};
  for(const [name,text] of Object.entries(content)) {fs.mkdirSync(path.dirname(path.join(source,name)),{recursive:true});fs.writeFileSync(path.join(source,name),text);}
  return {dir,skillsRoot,source};
}

test('installation copies the current public package without Git, tests or private runtime',t=>{
  const {skillsRoot}=fixture(t),result=installForWorkBuddy({root:ROOT,skillsRoot});
  assert.equal(result.installed,true);assert.equal(result.serviceStarted,false);
  const target=result.installationDirectory;
  for(const name of ['SKILL.md','scripts/job-hunt.ps1','scripts/install-workbuddy.mjs','server/onboarding.mjs','extension/manifest.json']) assert.equal(fs.existsSync(path.join(target,name)),true,name);
  for(const name of ['.git','tests','data','runtime','bridge.json']) assert.equal(fs.existsSync(path.join(target,name)),false,name);
  assert.equal(installForWorkBuddy({root:target,skillsRoot}).alreadyInstalled,true);
  assert.throws(()=>installForWorkBuddy({root:ROOT,skillsRoot}),/EXISTING_INSTALLATION/);
  assert.equal(fs.readdirSync(skillsRoot).some(x=>x.startsWith('.job-hunt-install')),false);
});

test('installation never copies unlisted personal files and refuses secrets before destination writes',t=>{
  const {skillsRoot,source}=fixture(t);
  fs.mkdirSync(path.join(source,'data'));fs.writeFileSync(path.join(source,'data','resume.json'),'private fixture');
  fs.writeFileSync(path.join(source,'resume.json'),'private fixture');
  const target=installForWorkBuddy({root:source,skillsRoot}).installationDirectory;
  assert.equal(fs.existsSync(path.join(target,'data')),false);assert.equal(fs.existsSync(path.join(target,'resume.json')),false);
  const other=path.join(skillsRoot,'other');fs.mkdirSync(other);
  fs.writeFileSync(path.join(source,'scripts','private.mjs'),JSON.stringify({cookie:'synthetic'.repeat(5)}));
  assert.throws(()=>installForWorkBuddy({root:source,skillsRoot:other}),/PRIVACY/);
  assert.deepEqual(fs.readdirSync(other),[]);
});

test('installation rejects invalid manifest, missing host directory and nested source destination',t=>{
  const {source,skillsRoot}=fixture(t);
  assert.throws(()=>installForWorkBuddy({root:source,skillsRoot:path.join(skillsRoot,'missing')}),/VERIFIED_SKILLS/);
  assert.throws(()=>installForWorkBuddy({root:source,skillsRoot:source}),/OVERLAP/);
  const pkg=JSON.parse(fs.readFileSync(path.join(source,'package.json'),'utf8'));pkg.files.push('../escape');
  fs.writeFileSync(path.join(source,'package.json'),JSON.stringify(pkg));
  assert.throws(()=>installForWorkBuddy({root:source,skillsRoot}),/INVALID_PACKAGE_MANIFEST/);
  assert.deepEqual(fs.readdirSync(skillsRoot),[]);
});

test('onboarding returns missing steps without exposing profile content or treating connection as login',()=>{
  let result=onboardingReport({root:ROOT,status:{connected:false,blocked:false},profile:null});
  assert.deepEqual(result.nextActions,['LOAD_EXTENSION_AND_PAIR','PROVIDE_RESUME_OR_FACTS','CONFIRM_SEARCH_PREFERENCES']);
  assert.equal(result.readyForConfiguredSearch,false);assert.equal(result.siteRequestPerformed,false);
  const profile={displayName:'不可出现在诊断中的示例称呼',facts:['不可出现在诊断中的示例经历'],preferences:{keywords:['示例岗位'],cities:['示例城市']}};
  result=onboardingReport({root:ROOT,status:{connected:true,blocked:false},profile});
  assert.equal(result.readyForConfiguredSearch,true);assert.deepEqual(result.nextActions,[]);assert.equal(result.loginVerified,false);
  for(const text of [profile.displayName,...profile.facts,...profile.preferences.keywords,...profile.preferences.cities]) assert.equal(JSON.stringify(result).includes(text),false);
  result=onboardingReport({root:ROOT,status:{connected:true,blocked:true,task:{id:'existing',status:'uncertain'}},profile});
  assert.equal(result.readyForConfiguredSearch,false);assert.deepEqual(result.nextActions,['CHECK_EXISTING_TASK','MANUALLY_CHECK_SITE_AND_RESUME']);
});
