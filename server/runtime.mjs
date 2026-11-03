import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const RELEASE=JSON.parse(fs.readFileSync(path.join(ROOT,'release.json'),'utf8'));
export const DEFAULT_PORT=18674;
export function runtimeDir(explicit) {
  const base=process.env.LOCALAPPDATA || path.join(os.homedir(),'.local','share');
  const selected=path.resolve(explicit || process.env.JOB_HUNT_STATE_DIR || path.join(base,'job-hunt'));
  // 运行数据与可更新代码分离，避免发布时夹带简历、数据库或配对码。
  const lexical=path.relative(ROOT,selected);
  if (!lexical || (!lexical.startsWith('..'+path.sep) && lexical!=='..' && !path.isAbsolute(lexical))) throw new Error('STATE_DIRECTORY_MUST_BE_OUTSIDE_PACKAGE');
  fs.mkdirSync(selected,{recursive:true,mode:0o700});
  const relative=path.relative(fs.realpathSync(ROOT),fs.realpathSync(selected));
  if (!relative || (!relative.startsWith('..'+path.sep) && relative!=='..' && !path.isAbsolute(relative))) throw new Error('STATE_DIRECTORY_MUST_BE_OUTSIDE_PACKAGE');
  return selected;
}
export function writePrivate(file,value) {
  const temporary=file+'.'+process.pid+'.tmp';
  fs.writeFileSync(temporary,JSON.stringify(value,null,2)+String.fromCharCode(10),{mode:0o600});
  fs.renameSync(temporary,file);
}
export function readBridge(dir) {
  const result=JSON.parse(fs.readFileSync(path.join(dir,'bridge.json'),'utf8'));
  if (!/^[a-f0-9]{64}$/.test(result.key || '') || !Number.isInteger(result.port) || result.port<1024 || result.port>65535) throw new Error('INVALID_LOCAL_STATE');
  return result;
}
export async function localRequest(dir,route,body={}) {
  const state=readBridge(dir);
  const response=await fetch('http://127.0.0.1:'+state.port+route,{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+state.key},body:JSON.stringify(body),signal:AbortSignal.timeout(8000),redirect:'error'});
  const result=await response.json();
  if (!response.ok) throw new Error(result.errorCode || 'LOCAL_REQUEST_REJECTED');
  return result;
}
