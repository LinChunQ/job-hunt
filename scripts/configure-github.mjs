#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const START='<!-- job-hunt:hero:start -->',END='<!-- job-hunt:hero:end -->';
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function repositoryName(value) {
  if (typeof value!=='string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9_.-]{1,100}$/.test(value) || ['.','..'].includes(value.split('/')[1])) throw new Error('INVALID_GITHUB_REPOSITORY');
  return value;
}
export function renderHero(release) {
  const repository=release.githubRepository ? repositoryName(release.githubRepository) : null;
  if (!/^\d+\.\d+\.\d+$/.test(release.version) || !['preview','stable'].includes(release.channel)) throw new Error('INVALID_README_RELEASE');
  const url=repository ? 'https://github.com/'+repository : null;
  const image=(source,label,link)=>{const tag='<img alt="'+escape(label)+'" src="'+escape(source)+'">';return '  '+(link ? '<a href="'+escape(link)+'">'+tag+'</a>' : tag);};
  const badge=(label,message,color,logo)=>{const params=new URLSearchParams({label,message,color,style:'flat',...(logo ? {logo} : {})});return 'https://img.shields.io/static/v1?'+params;};
  // 未托管时使用明确的静态状态，不引用其他项目，也不展示虚构的 Stars 或 Issue 数字。
  const rows=[
    image(repository ? 'https://img.shields.io/github/stars/'+repository+'?style=flat&logo=github' : badge('Stars','not published','lightgrey','github'),'GitHub Stars',url && url+'/stargazers'),
    image(repository ? 'https://img.shields.io/github/downloads/'+repository+'/total?style=flat&label=release%20downloads' : badge('release downloads','not published','lightgrey'),'Release 附件累计下载次数',url && url+'/releases'),
    image(badge('users','not tracked','lightgrey'),'实际使用人数未统计','#下载与使用统计'),
    image(badge('version','v'+release.version+(release.channel==='preview' ? '-preview' : ''),'orange'),'当前源码版本',url && url+'/releases'),
    image(badge('Node.js','22.20+ (22.x) | 24+','339933','nodedotjs'),'Node.js 22.20+ 的 22.x 或 24+'),
    image(badge('storage','SQLite','003B57','sqlite'),'SQLite 本地存储'),
    image(repository ? 'https://img.shields.io/github/issues/'+repository+'?style=flat' : badge('issues','not published','lightgrey'),'GitHub Issues',url && url+'/issues'),
    image(repository ? 'https://img.shields.io/github/last-commit/'+repository+'?style=flat' : badge('last commit','local only','lightgrey'),'最近提交',url && url+'/commits'),
    image(repository ? 'https://img.shields.io/github/actions/workflow/status/'+repository+'/ci.yml?branch=main&label=checks' : badge('checks','local only','lightgrey'),'自动化检查',url && url+'/actions/workflows/ci.yml'),
  ];
  return [START,'<h1 align="center">job-hunt v'+release.version+'</h1>','', '<p align="center">本地求职助手：岗位采集、AI 匹配评分、个性化打招呼草稿与人工审阅。</p>','', '<p align="center">',...rows,'</p>','', '<p align="center"><a href="#快速开始">快速开始</a> · <a href="#功能与状态">功能与状态</a> · <a href="references/commands.md">命令文档</a> · <a href="#隐私与数据">隐私与数据</a></p>',END].join('\n');
}
export function updatedReadme(text,release) {
  const start=text.indexOf(START),end=text.indexOf(END);
  if (start<0 || end<start || start!==text.lastIndexOf(START) || end!==text.lastIndexOf(END)) throw new Error('README_MARKERS_INVALID');
  // 只重建有标记的标题徽章区，保留维护者手写的正文。
  return text.slice(0,start)+renderHero(release)+text.slice(end+END.length);
}
export function configure({root=ROOT,repository,check=false}={}) {
  const file=path.join(root,'release.json'),readmeFile=path.join(root,'README.md');
  const release=JSON.parse(fs.readFileSync(file,'utf8'));
  if (repository!==undefined) release.githubRepository=repositoryName(repository);
  const original=fs.readFileSync(readmeFile,'utf8'),text=updatedReadme(original,release);
  if (check) {if (repository!==undefined) throw new Error('CHECK_CANNOT_CONFIGURE');if (original!==text) throw new Error('README_BADGES_OUT_OF_DATE');}
  else {
    if (repository!==undefined) fs.writeFileSync(file,JSON.stringify(release,null,2)+'\n','utf8');
    if (original!==text) fs.writeFileSync(readmeFile,text,'utf8');
  }
  return {ok:true,configured:!!release.githubRepository,readmeSynchronized:true,networkRequestPerformed:false,gitRemoteChanged:false};
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args=process.argv.slice(2);let repository,check=false;
    for (let i=0;i<args.length;i++) {
      if (args[i]==='--repository' && repository===undefined && args[i+1]) repository=args[++i];
      else if (args[i]==='--check' && !check) check=true;
      else throw new Error('INVALID_CONFIGURATION_ARGUMENT');
    }
    console.log(JSON.stringify(configure({repository,check}),null,2));
  } catch(error) {console.error(JSON.stringify({ok:false,errorCode:/^[A-Z_]+$/.test(error.message || '') ? error.message : 'GITHUB_CONFIGURATION_FAILED'}));process.exitCode=1;}
}
