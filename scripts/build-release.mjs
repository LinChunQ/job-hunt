import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {deflateRawSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {scanRepository,inspectFile} from './privacy-check.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function checksum(data) {
  let value=0xffffffff;
  for(const byte of data) {value^=byte;for(let bit=0;bit<8;bit++) value=(value>>>1)^((value&1) ? 0xedb88320 : 0);}
  return (value^0xffffffff)>>>0;
}
export function buildRelease({outputDirectory,packageRoot=root}={}) {
  if (!outputDirectory || !path.isAbsolute(outputDirectory)) throw new Error('ABSOLUTE_OUTPUT_REQUIRED');
  fs.mkdirSync(outputDirectory,{recursive:true});
  const source=fs.realpathSync(packageRoot),out=fs.realpathSync(outputDirectory),relative=path.relative(source,out);
  if (!relative || (!relative.startsWith('..'+path.sep) && relative!=='..' && !path.isAbsolute(relative))) throw new Error('OUTPUT_MUST_BE_OUTSIDE_PACKAGE');
  const check=scanRepository(source,{staged:true,history:true});
  if (!check.ok) throw new Error('PRIVACY_CHECK_FAILED');
  const pkg=JSON.parse(fs.readFileSync(path.join(source,'package.json'),'utf8'));
  const release=JSON.parse(fs.readFileSync(path.join(source,'release.json'),'utf8'));
  const manifest=JSON.parse(fs.readFileSync(path.join(source,'extension/manifest.json'),'utf8'));
  if (pkg.name!=='job-hunt' || release.name!=='job-hunt' || pkg.version!==release.version || manifest.version!==release.version) throw new Error('RELEASE_VERSION_MISMATCH');
  const names=execFileSync('git',['-C',source,'ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean).filter(name=>name==='package.json' || pkg.files.some(item=>item.endsWith('/') ? name.startsWith(item) : name===item)).sort();
  for(const required of ['SKILL.md','README.md','scripts/job-hunt.ps1','scripts/job-hunt.mjs','extension/manifest.json']) if (!names.includes(required)) throw new Error('RELEASE_CONTENT_MISSING');
  const chunks=[],directory=[];let offset=0,total=0;
  // 只打包白名单文本文件；固定 ZIP 时间和 UTF-8 文件名，避免引入工作目录或用户状态。
  for(const name of names) {
    if (path.isAbsolute(name) || name.includes('..') || name.includes(String.fromCharCode(92))) throw new Error('INVALID_ARCHIVE_PATH');
    const full=path.join(source,name),stat=fs.lstatSync(full);
    if (!stat.isFile() || stat.size>2000000) throw new Error('RELEASE_FILE_REJECTED');
    const raw=fs.readFileSync(full);total+=raw.length;
    if (total>20000000 || inspectFile(name,raw.toString('utf8')).length) throw new Error('WORKTREE_PRIVACY_CHECK_FAILED');
    const data=deflateRawSync(raw),file=Buffer.from('job-hunt/'+name,'utf8'),crc=checksum(raw);
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(file.length,26);
    chunks.push(local,file,data);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(8,10);central.writeUInt16LE(33,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(file.length,28);central.writeUInt32LE(offset,42);
    directory.push(central,file);offset+=local.length+file.length+data.length;
  }
  const central=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(names.length,8);end.writeUInt16LE(names.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(offset,16);
  const archive=Buffer.concat([...chunks,central,end]),target=path.join(out,'job-hunt.zip');
  fs.writeFileSync(target,archive,{flag:'wx'});
  return {ok:true,version:release.version,files:names.length,bytes:archive.length,archive:target,uploadPerformed:false};
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {if (process.argv.length!==4 || process.argv[2]!=='--output-dir') throw new Error('OUTPUT_DIRECTORY_REQUIRED');console.log(JSON.stringify(buildRelease({outputDirectory:process.argv[3]}),null,2));}
  catch(error) {console.error(JSON.stringify({ok:false,errorCode:/^[A-Z_]+$/.test(error.message || '') ? error.message : 'RELEASE_BUILD_FAILED'}));process.exitCode=1;}
}
