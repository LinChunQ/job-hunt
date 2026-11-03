// 自动适配仅在已授权的普通聊天页运行；定位不唯一时返回原因，不猜联系人。
export async function prepareChatInPage({draft,allowSelect=true}={}) {
  const fail=errorCode=>({ok:false,errorCode,touched:false,phase:'preflight',sent:false});
  if (location.origin!=='https://www.zhipin.com' || !/^\/web\/geek\/chat(?:\/|$)/.test(location.pathname)) return fail('CHAT_PAGE_REQUIRED');
  if (!draft || !['id','jobId','company','title','recruiter'].every(k=>typeof draft[k]==='string' && draft[k].trim())) return fail('RECIPIENT_IDENTITY_REQUIRED');
  const norm=text=>String(text || '').replace(/\s+/g,' ').trim();
  const visible=node=>{if(!node?.isConnected || node.ownerDocument!==document)return false;const r=node.getBoundingClientRect(),s=getComputedStyle(node);return r.width>0 && r.height>0 && s.display!=='none' && s.visibility!=='hidden' && s.opacity!=='0';};
  const unique=nodes=>[...new Set(nodes)].filter(visible);
  const nodes=(root,selector)=>unique(Array.from(root.querySelectorAll(selector)));
  const leafText=(root,text)=>nodes(root,'span,a,p,h2,h3,h4,div').filter(node=>norm(node.textContent)===norm(text) && !Array.from(node.children).some(child=>norm(child.textContent)===norm(text)));
  const jobIds=root=>{
    const values=[];
    for(const node of root.querySelectorAll('a[href*="/job_detail/"],[data-jobid],[data-job-id],[data-encrypt-job-id]')) {
      if(!visible(node))continue;
      for(const name of ['data-jobid','data-job-id','data-encrypt-job-id']){const value=node.getAttribute(name);if(value)values.push(value);}
      const match=(node.getAttribute('href') || '').match(/\/job_detail\/([A-Za-z0-9_-]+)\.html/);if(match)values.push(match[1]);
    }
    return [...new Set(values)];
  };
  const matches=root=>['company','title','recruiter'].every(field=>leafText(root,draft[field]).length===1) && (jobIds(root).length===0 || (jobIds(root).length===1 && jobIds(root)[0]===draft.jobId));
  const roots=()=>nodes(document,'.chat-conversation,[data-chat-conversation],.conversation-content');
  let candidates=roots().filter(matches);
  if(candidates.length===0 && allowSelect) {
    // 只选择已存在且精确匹配的会话行；不发起新沟通，不按公司名称模糊匹配。
    const rows=nodes(document,'.friend-content,li[role="listitem"],[data-conversation-id]').filter(matches);
    if(rows.length===1 && !rows[0].classList?.contains('selected')) {
      rows[0].click();
      for(let i=0;i<12;i++){await new Promise(resolve=>setTimeout(resolve,150));candidates=roots().filter(matches);if(candidates.length===1)break;}
    }
  }
  if(candidates.length!==1)return fail(candidates.length>1 ? 'CHAT_IDENTITY_AMBIGUOUS' : 'AUTO_CHAT_NOT_MATCHED');
  const root=candidates[0];
  const editors=nodes(root,'#chat-input,textarea.chat-input,.chat-input textarea,[contenteditable="true"][role="textbox"],.chat-input[contenteditable="true"]');
  const buttons=nodes(root,'.btn-send,.send-btn,button,[role="button"]').filter(node=>/^(发送|发送消息|send)$/i.test(norm(node.textContent)));
  const receipts=nodes(root,'.chat-record,[data-chat-messages],[role="log"]');
  if(editors.length!==1 || buttons.length!==1 || receipts.length!==1)return fail('AUTO_CONTROLS_AMBIGUOUS');
  if(receipts[0].contains(editors[0]) || receipts[0].contains(buttons[0]))return fail('MESSAGE_REGION_TOO_BROAD');
  const state=globalThis.__bossGreetingAssistant120 ||= {marks:{},check:null,lastFill:null,revision:0};
  const fields={company:leafText(root,draft.company)[0],title:leafText(root,draft.title)[0],recruiter:leafText(root,draft.recruiter)[0],editor:editors[0],send:buttons[0],receipt:receipts[0]};
  // 每次发送都重新绑定当前真实节点，不能复用前一个聊天的选择器结果。
  state.marks=Object.fromEntries(Object.entries(fields).map(([field,node])=>[field,{node,text:['company','title','recruiter'].includes(field) ? norm(node.textContent) : '',url:location.href,at:Date.now()}]));
  state.autoIdentity={root,jobId:draft.jobId};state.check=null;state.revision++;state.identityMethod='automatic-exact-current-conversation';
  if(!state.navigationGuard){
    const invalidate=event=>{if(event.isTrusted && !state.cancelPick){state.marks={};state.check=null;state.revision++;}};
    document.addEventListener('pointerdown',invalidate,true);document.addEventListener('keydown',invalidate,true);
    globalThis.addEventListener('popstate',()=>{state.marks={};state.check=null;state.revision++;});state.navigationGuard=true;
  }
  return {ok:true,identityMethod:state.identityMethod,jobIdVerified:jobIds(root).includes(draft.jobId),marks:Object.fromEntries(Object.keys(fields).map(field=>[field,{status:'marked'}])),sent:false};
}
