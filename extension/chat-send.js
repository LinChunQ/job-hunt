// 此模块仅执行工作台已确认的一条发送，不寻找联系人、不导航、不重试。
export async function sendGreetingInPage(request) {
  const fail=(errorCode,touched=false)=>({ok:false,errorCode,touched,phase:touched ? 'after-dispatch' : 'preflight',sent:false});
  if (location.origin!=='https://www.zhipin.com' || !/^\/web\/geek\/chat(?:\/|$)/.test(location.pathname)) return fail('CHAT_PAGE_REQUIRED');
  if (!Number.isFinite(request?.deadline) || Date.now()>request.deadline) return fail('ACTION_EXPIRED');
  const state=globalThis.__bossGreetingAssistant120,draft=request?.draft;
  if (!state || !draft || !draft.id || !request.commandId || typeof draft.text!=='string' || !draft.text.trim() || draft.text.length>500) return fail('MARKS_INCOMPLETE');
  const norm=text=>String(text || '').replace(/\s+/g,' ').trim();
  const visible=node=>{if (!node?.isConnected || node.ownerDocument!==document) return false;const r=node.getBoundingClientRect(),s=getComputedStyle(node);return r.width>0 && r.height>0 && s.display!=='none' && s.visibility!=='hidden' && s.opacity!=='0';};
  const read=field=>{const mark=state.marks[field];return mark && visible(mark.node) && mark.url===location.href && Date.now()-mark.at<600000 ? mark.node : null;};
  const value=editor=>['TEXTAREA','INPUT'].includes(editor?.tagName) ? editor.value : editor?.textContent;
  const editor=read('editor'),button=read('send'),receipt=read('receipt'),revision=state.revision,url=location.href;
  const jobIdentity=()=>{
    const auto=state.autoIdentity;if(!auto)return true;
    if(!visible(auto.root) || auto.jobId!==draft.jobId)return false;
    const ids=new Set();
    for(const node of auto.root.querySelectorAll('a[href*="/job_detail/"],[data-jobid],[data-job-id],[data-encrypt-job-id]')){
      if(!visible(node))continue;
      for(const key of ['data-jobid','data-job-id','data-encrypt-job-id']){const value=node.getAttribute(key);if(value)ids.add(value);}
      const match=(node.getAttribute('href') || '').match(/\/job_detail\/([A-Za-z0-9_-]+)\.html/);if(match)ids.add(match[1]);
    }
    return ids.size===0 || (ids.size===1 && ids.has(draft.jobId));
  };
  const identity=()=>jobIdentity() && ['company','title','recruiter'].every(field=>{const node=read(field);return node && norm(node.textContent)===norm(draft[field]) && norm(draft[field]);});
  if (!identity()) return fail('CHAT_IDENTITY_MISMATCH');
  if (!editor || !button || !receipt || button.disabled || editor.disabled || editor.readOnly || !/^(发送|发送消息|send)$/i.test(norm(button.textContent))) return fail('SEND_MARKS_REQUIRED');
  if (!(['TEXTAREA','INPUT'].includes(editor.tagName) || editor.getAttribute('contenteditable')==='true')) return fail('EDITOR_UNAVAILABLE');
  if (receipt.contains(editor) || receipt.contains(button) || ['BODY','HTML'].includes(receipt.tagName)) return fail('MESSAGE_REGION_TOO_BROAD');
  if (norm(value(editor))) return fail('EDITOR_NOT_EMPTY');
  state.sendCommands ||= new Set();
  if (state.sendCommands.has(request.commandId) || state.lastSendDraft===draft.id || state.lastFill===draft.id) return fail('DUPLICATE_SEND');
  // 只观察用户标记的消息区域新增的精确正文节点，不读取或上报历史聊天内容。
  const matches=()=>Array.from(receipt.querySelectorAll('*')).filter(node=>visible(node) && norm(node.textContent)===norm(draft.text) && !Array.from(node.children).some(child=>norm(child.textContent)===norm(draft.text)));
  const before=new Set(matches());
  let touched=false,clicked=false;
  try {
    state.sendCommands.add(request.commandId);state.lastSendDraft=draft.id;touched=true;
    if (['TEXTAREA','INPUT'].includes(editor.tagName)) {
      const prototype=editor.tagName==='TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype,'value').set.call(editor,draft.text);
    } else editor.textContent=draft.text;
    editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:draft.text}));
    await new Promise(resolve=>setTimeout(resolve,180));
    // 填入后再次核对真实节点、联系人和正文；用户切换聊天就立即中止。
    if (Date.now()>request.deadline || state.revision!==revision || location.href!==url || !identity() || read('editor')!==editor || read('send')!==button || read('receipt')!==receipt || value(editor)!==draft.text || button.disabled) return fail('SEND_CONTEXT_CHANGED',true);
    clicked=true;button.click();
    for (let i=0;i<20;i++) {
      await new Promise(resolve=>setTimeout(resolve,200));
      if (state.revision!==revision || location.href!==url || !identity() || read('receipt')!==receipt) return fail('SEND_CONTEXT_CHANGED',true);
      if (!norm(value(editor)) && matches().some(node=>!before.has(node))) return {ok:true,touched:true,sent:true,uiObserved:true,deliveryVerified:false};
    }
    return fail('SEND_RECEIPT_UNCERTAIN',true);
  } catch {return fail(clicked ? 'SEND_RESULT_UNCERTAIN' : 'SEND_FILL_UNCERTAIN',touched);}
}
