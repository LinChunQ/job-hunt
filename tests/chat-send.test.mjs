import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {chatDraftInPage} from '../extension/chat-draft.js';
// 只用内存中的虚构 DOM 验证点击次数；不启动浏览器，不访问招聘网站。
function environment({match=true,receipt=true,mutate=false}={}) {
  const document={},location={origin:'https://www.zhipin.com',pathname:'/web/geek/chat',href:'https://www.zhipin.com/web/geek/chat'};
  class Node {constructor(tag,text=''){this.tagName=tag;this.textContent=text;this.isConnected=true;this.ownerDocument=document;this.disabled=false;this.readOnly=false;this.children=[];}getBoundingClientRect(){return {width:100,height:30};}getAttribute(){return null;}contains(node){return this.children.includes(node);}querySelectorAll(){return this.children;}click(){this.clicks=(this.clicks || 0)+1;if(receipt){editor.value='';messages.children.push(new Node('SPAN',draft.text));}}dispatchEvent(){if(mutate)company.textContent='另一家虚构公司';}}
  class Textarea extends Node {constructor(){super('TEXTAREA');this._value='';}get value(){return this._value;}set value(value){this._value=value;}}
  const draft={id:'demo',revision:1,title:'虚构岗位',company:'虚构公司',recruiter:'示例招聘人',text:'您好，这是纯虚构测试。'},company=new Node('SPAN',match ? draft.company : '不匹配的虚构公司'),title=new Node('SPAN',draft.title),recruiter=new Node('SPAN',draft.recruiter),editor=new Textarea(),button=new Node('BUTTON','发送'),messages=new Node('DIV');
  const marks=Object.fromEntries(Object.entries({company,title,recruiter,editor,send:button,receipt:messages}).map(([field,node])=>[field,{node,text:node.textContent,url:location.href,at:Date.now()}]));
  const state={marks,revision:1},sandbox={document,location,__bossGreetingAssistant120:state,HTMLTextAreaElement:Textarea,InputEvent:class {},getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),setTimeout:callback=>{queueMicrotask(callback);return 0;}};
  vm.createContext(sandbox);const source=fs.readFileSync(new URL('../extension/chat-send.js',import.meta.url),'utf8').replace('export async function','async function');vm.runInContext(source,sandbox);const run=()=>sandbox.sendGreetingInPage({draft,commandId:'action',deadline:Date.now()+30000});return {run,button,editor,sandbox,draft,state};
}
test('send clicks only once after exact identity and observes a newly appended same text message',async()=>{const {run,button}=environment();const result=await run();assert.equal(result.sent,true);assert.equal(result.uiObserved,true);assert.equal(result.deliveryVerified,false);assert.equal(button.clicks,1);assert.equal((await run()).errorCode,'DUPLICATE_SEND');assert.equal(button.clicks,1);});
test('wrong recipient does not fill or click',async()=>{const {run,button,editor}=environment({match:false});const result=await run();assert.equal(result.touched,false);assert.equal(result.phase,'preflight');assert.equal(button.clicks,undefined);assert.equal(editor.value,'');});
test('recipient changes during fill prevent clicking and keep uncertain state',async()=>{const {run,button}=environment({mutate:true});const result=await run();assert.equal(result.touched,true);assert.equal(result.errorCode,'SEND_CONTEXT_CHANGED');assert.equal(button.clicks,undefined);});
test('missing receipt never claims delivered and never clicks twice',async()=>{const {run,button}=environment({receipt:false});const result=await run();assert.equal(result.ok,false);assert.equal(result.touched,true);assert.equal(result.sent,false);assert.equal(button.clicks,1);await run();assert.equal(button.clicks,1);});
test('send marking status accepts send and receipt controls',async()=>{const env=environment();env.state.navigationGuard=true;env.sandbox.request={action:'status'};env.sandbox.globalThis=env.sandbox;const result=await vm.runInContext('('+chatDraftInPage.toString()+')(request)',env.sandbox);assert.equal(result.marks.send.status,'marked');assert.equal(result.marks.receipt.status,'marked');});
