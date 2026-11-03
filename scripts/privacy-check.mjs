#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ignored=new Set(['.git','node_modules','coverage','dist','data','state','runtime','exports','backups','private']);
const publicRoots=new Set(['.gitattributes','.gitignore','.githooks','.github','package.json','package-lock.json','release.json','README.md','SKILL.md','scripts','server','extension','web','references','examples','tests','LICENSE','NOTICE']);
const binaryExtensions=/\.(?:sqlite3?(?:-.*)?|db(?:-.*)?|har|log|pem|key|pfx|crx|zip|bak.*|orig.*|tmp|png|jpe?g|pdf|docx|xlsx)$/i;
export function inspectFile(name,content) {
  const issues=[],normalized=name.replaceAll('\\','/'),parts=normalized.split('/');
  // 无论是否被强制加入索引，业务数据和凭据文件一律不属于公开包。
  if (!publicRoots.has(parts[0]) || parts.some(x=>ignored.has(x)) || binaryExtensions.test(name) || /(^|\/)(?:\.env(?:\..*)?|bridge\.json|resume\.json|config\.local\.json|greeting-drafts\.json)$/i.test(normalized)) issues.push('PRIVATE_OR_UNEXPECTED_FILE');
  if (content.includes('\0')) issues.push('BINARY_FILE');
  if (/(?:[a-z]:[\\/](?:users|documents and settings)[\\/]|\/(?:Users|home)\/[^\s/]+\/)/i.test(content)) issues.push('PERSONAL_ABSOLUTE_PATH');
  const emails=content.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  if (emails.some(x=>!/@(?:example\.(?:com|org|net)|[^@]+\.invalid)$/i.test(x))) issues.push('EMAIL_ADDRESS');
  if (/(?:^|[^\d])1[3-9]\d{9}(?!\d)/m.test(content)) issues.push('MOBILE_NUMBER');
  if (/(?:^|[^\d])\d{17}[\dX](?!\d)/m.test(content)) issues.push('IDENTITY_NUMBER');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) issues.push('PRIVATE_KEY');
  // 匹配实际字面量，允许程序正常处理名为 key/token/cookie 的变量。
  if (/\b(?:authorization|cookie|password|api[_-]?key|access[_-]?token|zp_token|zp_at|wt2|__zp_stoken__)\b['"]?\s*[:=]\s*['"][^'"\r\n]{16,}['"]/i.test(content)) issues.push('HARDCODED_CREDENTIAL');
  if (/(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{15,})/.test(content)) issues.push('TOKEN_LITERAL');
  if (/['"][a-f0-9]{64}['"]/i.test(content)) issues.push('PAIRING_OR_SECRET_LITERAL');
  if (/securityId=[A-Za-z0-9_%~-]{16,}/.test(content)) issues.push('CAPTURED_SITE_REQUEST');
  return [...new Set(issues)];
}
function git(cwd,args) {return execFileSync('git',['-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:32*1024*1024});}
export function scanRepository(root=ROOT,{staged=false,history=false}={}) {
  const issues=[];let scanned=0;
  const inspect=(name,content,scope)=>{scanned++;for (const category of inspectFile(name,content)) issues.push({file:name,category,scope});};
  if (staged) {
    // 检查整个索引中的实际内容，避免工作区已脱敏但暂存区仍残留旧内容。
    const entries=git(root,['ls-files','--stage','-z']).split('\0').filter(Boolean);
    for (const entry of entries) {
      const tab=entry.indexOf('\t'),meta=entry.slice(0,tab).split(' '),name=entry.slice(tab+1);
      if (meta[0]!=='100644' && meta[0]!=='100755') {issues.push({file:name,category:'UNSUPPORTED_GIT_ENTRY',scope:'index'});continue;}
      inspect(name,git(root,['show',':'+name]),'index');
    }
  } else {
    const walk=(directory,prefix='')=>{for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
      if (ignored.has(entry.name)) continue;
      const name=prefix+entry.name,full=path.join(directory,entry.name);
      if (entry.isSymbolicLink()) issues.push({file:name,category:'SYMLINK_REJECTED',scope:'working'});
      else if (entry.isDirectory()) walk(full,name+'/');
      else if (entry.isFile()) inspect(name,fs.readFileSync(full,'utf8'),'working');
    }};walk(root);
  }
  if (history) {
    // 发布前审计本地历史；删除当前文件不能清除已经提交过的敏感内容。
    const objects=git(root,['rev-list','--objects','--all']).trim().split('\n').filter(Boolean);
    for (const line of objects) {const separator=line.indexOf(' ');if (separator<0) continue;const oid=line.slice(0,separator),name=line.slice(separator+1);
      if (git(root,['cat-file','-t',oid]).trim()==='blob') inspect(name,git(root,['cat-file','blob',oid]),'history');
    }
  }
  return {ok:issues.length===0,scanned,issues};
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const result=scanRepository(ROOT,{staged:process.argv.includes('--staged'),history:process.argv.includes('--history')});console.log(JSON.stringify(result,null,2));if (!result.ok) process.exitCode=1;}
  catch {console.error(JSON.stringify({ok:false,errorCode:'PRIVACY_SCAN_FAILED'}));process.exitCode=1;}
}
