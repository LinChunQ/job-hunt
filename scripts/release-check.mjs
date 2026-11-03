#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {scanRepository,inspectFile} from './privacy-check.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
try {
  const check=scanRepository(root,{staged:true,history:true});
  if (!check.ok) throw new Error('PRIVACY_CHECK_FAILED');
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const release=JSON.parse(fs.readFileSync(path.join(root,'release.json'),'utf8'));
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'extension/manifest.json'),'utf8'));
  if ([pkg,release].some(x=>x.name!=='job-hunt') || pkg.version!==release.version || manifest.version!==release.version) throw new Error('RELEASE_VERSION_MISMATCH');
  const names=execFileSync('git',['-C',root,'ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
  // 发布清单仅来自受审计的 Git 文件，下载目录、运行目录和未跟踪文件都不进入包。
  const included=names.filter(name=>name==='package.json' || pkg.files.some(item=>item.endsWith('/') ? name.startsWith(item) : name===item));
  for (const name of included) {if (inspectFile(name,fs.readFileSync(path.join(root,name),'utf8')).length) throw new Error('WORKTREE_PRIVACY_CHECK_FAILED');}
  if (!included.includes('SKILL.md') || !included.includes('scripts/job-hunt.mjs') || !included.includes('extension/manifest.json')) throw new Error('RELEASE_CONTENT_MISSING');
  console.log(JSON.stringify({ok:true,version:release.version,files:included.length,automaticInstall:false,uploadPerformed:false},null,2));
} catch(error) {console.error(JSON.stringify({ok:false,errorCode:/^[A-Z_]+$/.test(error.message) ? error.message : 'RELEASE_CHECK_FAILED'}));process.exitCode=1;}
