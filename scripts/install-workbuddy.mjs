import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {inspectFile} from './privacy-check.mjs';

export function installForWorkBuddy({root,skillsRoot}) {
  if (!skillsRoot || !path.isAbsolute(skillsRoot)) throw new Error('ABSOLUTE_SKILLS_ROOT_REQUIRED');
  const source=fs.realpathSync(root);
  if (!fs.existsSync(skillsRoot) || !fs.statSync(skillsRoot).isDirectory()) throw new Error('VERIFIED_SKILLS_ROOT_REQUIRED');
  const parent=fs.realpathSync(skillsRoot),target=path.join(parent,'job-hunt');
  if (target===source) return {ok:true,alreadyInstalled:true,installationDirectory:target,serviceStarted:false};
  const related=(a,b)=>{const rel=path.relative(a,b);return !rel || (!rel.startsWith('..'+path.sep) && rel!=='..' && !path.isAbsolute(rel));};
  if (related(source,parent) || related(target,source)) throw new Error('INSTALL_PATH_OVERLAP');
  if (fs.existsSync(target)) throw new Error('EXISTING_INSTALLATION_NOT_OVERWRITTEN');
  const pkg=JSON.parse(fs.readFileSync(path.join(source,'package.json'),'utf8'));
  const release=JSON.parse(fs.readFileSync(path.join(source,'release.json'),'utf8'));
  if (pkg.name!=='job-hunt' || release.name!=='job-hunt' || pkg.version!==release.version || !Array.isArray(pkg.files)) throw new Error('INVALID_PACKAGE');
  // 只收集公开发布清单，逐文件脱敏检查；不复制 Git 历史、数据库或下载目录。
  const files=[];
  const collect=name=>{
    if (!name || name.includes(String.fromCharCode(92)) || name.includes(':') || path.isAbsolute(name) || name.split(/[\/]/).some(x=>x==='..' || x==='')) throw new Error('INVALID_PACKAGE_PATH');
    const full=path.join(source,name),stat=fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error('PACKAGE_LINK_REJECTED');
    if (stat.isDirectory()) {for (const child of fs.readdirSync(full)) collect(name+'/'+child);return;}
    if (!stat.isFile() || stat.size>2000000 || inspectFile(name,fs.readFileSync(full,'utf8')).length) throw new Error('PACKAGE_PRIVACY_CHECK_FAILED');
    files.push(name);
  };
  const allowed=new Set(['SKILL.md','README.md','release.json','scripts/','server/','extension/','web/','references/','examples/']);
  if (pkg.files.some(name=>typeof name!=='string' || !allowed.has(name))) throw new Error('INVALID_PACKAGE_MANIFEST');
  for (const name of ['package.json',...pkg.files]) collect((name.endsWith('/') ? name.slice(0,-1) : name));
  const unique=[...new Set(files)];
  for (const name of ['SKILL.md','scripts/job-hunt.ps1','scripts/job-hunt.mjs','server/main.mjs','extension/manifest.json']) if (!unique.includes(name)) throw new Error('PACKAGE_CONTENT_MISSING');
  const lock=path.join(parent,'.job-hunt-install.lock'),stage=path.join(parent,'.job-hunt-install-'+randomUUID());
  let descriptor,created=false;
  try {
    try {descriptor=fs.openSync(lock,'wx',0o600);} catch {throw new Error('INSTALLATION_LOCKED');}
    fs.mkdirSync(stage);created=true;
    // 安装完成前不暴露 SKILL.md；已有安装始终保留，升级走独立流程。
    unique.sort((a,b)=>Number(a==='SKILL.md')-Number(b==='SKILL.md'));
    for (const name of unique) {const dest=path.join(stage,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(source,name),dest,fs.constants.COPYFILE_EXCL);}
    if (fs.existsSync(target)) throw new Error('EXISTING_INSTALLATION_NOT_OVERWRITTEN');
    fs.renameSync(stage,target);created=false;
    return {ok:true,installed:true,installationDirectory:target,files:unique.length,serviceStarted:false,nextCommand:'setup'};
  } finally {
    if (created) fs.rmSync(stage,{recursive:true,force:true});
    if (descriptor!==undefined) {fs.closeSync(descriptor);fs.unlinkSync(lock);}
  }
}
