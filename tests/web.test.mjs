import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
// 最小 DOM 仅测试事件与数据流；视觉布局仍须普通浏览器人工验收。
async function fixture() {
  class Node {
    constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.listeners={};this.dataset={};this.value='';this.className='';this.hidden=false;this.disabled=false;this.checked=false;this.textContent='';this.classList={toggle:(name,on)=>{const set=new Set(this.className.split(' ').filter(Boolean));if(on)set.add(name);else set.delete(name);this.className=[...set].join(' ');}};}
    get value(){return this._value || '';}set value(value){this._value=String(value); }
    append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=[...nodes];}setAttribute(name,value){this[name]=value;}addEventListener(name,handler){(this.listeners[name] ||= []).push(handler);}showModal(){this.open=true;}close(){this.open=false;}get firstChild(){return this.children[0];}
    async fire(name){for(const handler of this.listeners[name] || [])await handler({preventDefault(){},target:this});await settle();}
  }
  const html=fs.readFileSync(new URL('../web/index.html',import.meta.url),'utf8'),nodes=new Map();
  for(const match of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"[^>]*>/g)){const node=new Node(match[1]);node.id=match[2];nodes.set(node.id,node);}
  const nav=Object.keys({overview:1,preferences:1,jobs:1,drafts:1,delivery:1}).map(name=>{const node=new Node('button');node.dataset.view=name;node.className='nav';return node;});
  const form=nodes.get('profile-form');form.elements=Object.fromEntries(['displayName','facts','keywords','cities','salaryMin','salaryMax','experience','degree','workMode','notes'].map(name=>[name,new Node('input')]));
  const document={hidden:false,getElementById:id=>nodes.get(id),createElement:tag=>new Node(tag),querySelectorAll:selector=>selector==='.view' ? [...nodes.values()].filter(x=>x.id.startsWith('view-')) : selector==='.nav' || selector==='[data-view],[data-go]' ? nav : []};
  let profile={revision:1,displayName:'示例',facts:['虚构事实'],preferences:{keywords:['示例岗位'],cities:['示例城市'],salaryMin:15,salaryMax:25}},drafts=[{id:'draft',revision:1,status:'draft',company:'虚构公司',title:'虚构岗位',recruiter:'示例招聘人',text:'您好，虚构测试话术。'}],jobs=[{sourceKey:'boss:demo',title:'虚构岗位',company:'虚构公司',city:'示例城市',jd:'虚构正文',detailVerified:true,greeting:drafts[0].text,score:80}];
  const calls=[],intervals=[],events={},location={pathname:'/',hash:'#launch='+('a'.repeat(64)),replace(){}};
  const history={replaceState(_a,_b,url){location.hash=url.includes('#') ? url.slice(url.indexOf('#')) : '';}};
  const fetcher=async(route,options)=>{const body=JSON.parse(options.body);calls.push({route,body});let data={ok:true};if(route==='/ui/exchange')data.key='b'.repeat(64);else if(route==='/cli/status')data={connected:true,blocked:false,task:null};else if(route==='/cli/profile/get')data.profile=profile;else if(route==='/cli/profile/put'){if(body.revision!==profile.revision)return {ok:false,json:async()=>({errorCode:'PROFILE_CHANGED'})};profile={...body,revision:profile.revision+1};}else if(route==='/cli/jobs')data.jobs=jobs;else if(route==='/cli/drafts/list')data.drafts=drafts;else if(route==='/cli/delivery/status')data={batches:[],browser:{capable:true,chat:false},action:null};else if(route==='/cli/drafts/update'){drafts=[{...drafts[0],text:body.text,revision:drafts[0].revision+1}];}return {ok:true,json:async()=>data};};
  const sandbox={document,location,history,fetch:fetcher,AbortSignal,crypto:{randomUUID},navigator:{clipboard:{writeText:async()=>{}}},setInterval:handler=>intervals.push(handler),console,URLSearchParams,window:{confirm:()=>true,addEventListener:(name,handler)=>events[name]=handler}};vm.createContext(sandbox);
  async function settle(){for(let i=0;i<30;i++)await Promise.resolve();}
  vm.runInContext(fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8'),sandbox);await settle();
  const read=expression=>vm.runInContext(expression,sandbox);return {nodes,calls,form,read,nav,events,settle,profile:()=>profile,setProfile:value=>profile=value,setDrafts:value=>drafts=value,intervals};
}

test('dashboard exchanges launch before hiding token and shows all configured fields',async()=>{const env=await fixture();assert.equal(env.calls[0].route,'/ui/exchange');assert.equal(env.read('location.hash'),'');assert.equal(env.nodes.get('workspace').hidden,false);assert.equal(env.form.elements.salaryMin.value,'15');assert.equal(env.form.elements.cities.value,'示例城市');assert.equal(env.nodes.get('job-rows').children.length,1);});

test('profile dirty edit survives polling and cannot overwrite another actor revision',async()=>{const env=await fixture();env.form.elements.salaryMin.value='18';await env.form.fire('input');env.setProfile({...env.profile(),revision:2});await env.read('refresh(false)');assert.equal(env.form.elements.salaryMin.value,'18');await env.form.fire('submit');assert.equal(env.calls.find(x=>x.route==='/cli/profile/put').body.revision,1);assert.match(env.nodes.get('notice').textContent,/已被/);assert.equal(env.profile().preferences.salaryMin,15);});

test('draft edits survive polling and original revision stays fixed until saved',async()=>{const env=await fixture();const card=env.nodes.get('draft-list').children[0],textarea=card.children[1];textarea.value='新的虚构话术';await textarea.fire('input');env.setDrafts([{id:'draft',revision:2,status:'draft',company:'虚构公司',title:'虚构岗位',recruiter:'示例招聘人',text:'另一页面修改'}]);await env.read('refresh(false)');const refreshed=env.nodes.get('draft-list').children[0],edited=refreshed.children[1];assert.equal(edited.value,'新的虚构话术');edited.value='继续修改';await edited.fire('input');assert.equal(env.read('state.edits.get("draft").revision'),1);});

test('batch confirmation shows exact recipient and text and requires final check',async()=>{const env=await fixture();const card=env.nodes.get('draft-list').children[0],check=card.children[0].children[0];check.checked=true;await check.fire('change');await env.nodes.get('batch-create').fire('click');assert.equal(env.nodes.get('batch-dialog').open,true);assert.equal(env.calls.some(x=>x.route==='/cli/delivery/create'),false);env.nodes.get('batch-confirm').checked=true;await env.nodes.get('batch-confirm').fire('change');await env.nodes.get('batch-submit').fire('click');const sent=env.calls.find(x=>x.route==='/cli/delivery/create');assert.equal(sent.body.confirmedByUser,true);assert.equal(sent.body.items[0].text,'您好，虚构测试话术。');assert.equal(sent.body.items[0].revision,1);});
