import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
function fixture({wrongId=false,duplicates=false,missingControl=false,existing=false}={}) {
  const doc={},draft={id:'draft',jobId:'demo_job',company:'虚构公司',title:'示例岗位',recruiter:'示例招聘人'},location={origin:'https://www.zhipin.com',pathname:'/web/geek/chat',href:'https://www.zhipin.com/web/geek/chat'};
  class Node {
    constructor(text='',tagName='SPAN'){this.textContent=text;this.tagName=tagName;this.isConnected=true;this.ownerDocument=doc;this.children=[];this.classList={contains:()=>false};}
    getBoundingClientRect(){return {width:100,height:30};}getAttribute(name){return name==='data-job-id' ? this.jobId || null : null;}contains(){return false;}
    querySelectorAll(selector){return selector==='span,a,p,h2,h3,h4,div' ? this.identities || [] : selector.startsWith('a[href') ? this.jobNodes || [] : selector.includes('#chat-input') ? missingControl ? [] : [this.editor] : selector.includes('.btn-send') ? [this.send] : selector.includes('.chat-record') ? [this.receipt] : [];}
    click(){this.clicks=(this.clicks || 0)+1;selected=true;}
  }
  const root=new Node('', 'DIV');root.identities=[new Node(draft.company),new Node(draft.title),new Node(draft.recruiter)];const id=new Node();id.jobId=wrongId ? 'another_job' : draft.jobId;root.jobNodes=[id];root.editor=new Node('','TEXTAREA');root.send=new Node('发送','BUTTON');root.receipt=new Node('','DIV');
  let selected=!existing;const row=new Node();row.identities=root.identities;row.jobNodes=root.jobNodes;
  doc.querySelectorAll=selector=>selector.includes('.chat-conversation') ? selected ? duplicates ? [root,Object.assign(new Node('', 'DIV'),root)] : [root] : [] : selector.includes('.friend-content') ? [row] : [];
  doc.addEventListener=()=>{};
  const sandbox={document:doc,location,getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),addEventListener:()=>{},setTimeout:callback=>{queueMicrotask(callback);return 0;}};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(new URL('../extension/chat-adapter.js',import.meta.url),'utf8').replace('export async function','async function'),sandbox);
  return {run:(allowSelect=true)=>sandbox.prepareChatInPage({draft,allowSelect}),sandbox,row,root};
}
test('automatic adapter binds exact unique current conversation without marking',async()=>{const env=fixture(),result=await env.run();assert.equal(result.ok,true);assert.equal(result.jobIdVerified,true);assert.equal(result.marks.send.status,'marked');assert.equal(env.row.clicks,undefined);assert.equal(env.sandbox.__bossGreetingAssistant120.marks.company.node.textContent,'虚构公司');});
test('automatic adapter selects only a unique matching existing conversation',async()=>{const env=fixture({existing:true}),result=await env.run();assert.equal(result.ok,true);assert.equal(env.row.clicks,1);});
test('conflicting job ID blocks sending even when company title and name match',async()=>{const env=fixture({wrongId:true});assert.equal((await env.run()).ok,false);assert.equal(env.row.clicks,undefined);});
test('ambiguous conversation or missing input never becomes ready',async()=>{assert.equal((await fixture({duplicates:true}).run()).errorCode,'CHAT_IDENTITY_AMBIGUOUS');assert.equal((await fixture({missingControl:true}).run()).errorCode,'AUTO_CONTROLS_AMBIGUOUS');});


test('read only auto inspection does not switch conversations',async()=>{const env=fixture({existing:true});assert.equal((await env.run(false)).errorCode,'AUTO_CHAT_NOT_MATCHED');assert.equal(env.row.clicks,undefined);});
