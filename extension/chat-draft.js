// 只在用户已打开的聊天页读取其手动标记的元素；不联网、不导航、不点击发送。
// 自动发送由独立的 chat-send.js 执行；本函数继续只提供诊断标记和旧版填入。
export async function chatDraftInPage(request) {
  const fail = (errorCode, touched = false) => ({ok:false,errorCode,touched,sent:false});
  if (location.origin !== 'https://www.zhipin.com' || !/^\/web\/geek\/chat(?:\/|$)/.test(location.pathname)) return fail('CHAT_PAGE_REQUIRED');
  const slot = '__bossGreetingAssistant120';
  const state = globalThis[slot] ||= {marks:{},check:null,lastFill:null,revision:0};
  if (!state.navigationGuard) {
    // 用户在页面继续操作或浏览器历史切换后撤销标记，要求重新确认当前聊天。
    const invalidate = event => {if (event.isTrusted && !state.cancelPick) {state.marks={};state.check=null;state.revision++;}};
    document.addEventListener('pointerdown',invalidate,true);
    document.addEventListener('keydown',invalidate,true);
    globalThis.addEventListener('popstate',()=>{state.marks={};state.check=null;state.revision++;});
    state.navigationGuard=true;
  }
  const norm = text => String(text || '').replace(/\s+/g,' ').trim();
  const visible = el => {
    if (!el?.isConnected || el.ownerDocument !== document) return false;
    const rect=el.getBoundingClientRect(), style=getComputedStyle(el);
    return rect.width>0 && rect.height>0 && style.display!=='none' && style.visibility!=='hidden' && style.opacity!=='0';
  };
  const editable = el => el?.tagName==='TEXTAREA' || (el?.tagName==='INPUT' && ['text','search',''].includes(el.type)) || el?.getAttribute?.('contenteditable')==='true';
  const readEditor = el => ['TEXTAREA','INPUT'].includes(el.tagName) ? el.value : el.textContent;
  const readMark = field => {
    const mark=state.marks[field];
    if (!mark || !visible(mark.node) || mark.url!==location.href || Date.now()-mark.at>600000) return null;
    if (field==='send') return !mark.node.disabled && /^(发送|发送消息|send)$/i.test(norm(mark.node.textContent)) ? mark.node : null;
    if (field==='receipt') return mark.node;
    if (field==='editor') return editable(mark.node) && !mark.node.disabled && !mark.node.readOnly ? mark.node : null;
    const text=norm(mark.node.textContent);
    return text && text.length<=200 && text===mark.text ? text : null;
  };
  const summarize = () => ({company:readMark('company'),title:readMark('title'),recruiter:readMark('recruiter'),editorMarked:!!readMark('editor')});
  // 状态查询只读取已标记节点，不猜选择器、不改输入框，也不访问网站接口。
  if (request?.action==='status') {
    const observed=summarize();
    const marks={};
    for (const field of ['company','title','recruiter','editor','send','receipt']) {
      const mark=state.marks[field];
      let reason='NOT_MARKED';
      if (mark) {
        if (!mark.node?.isConnected) reason='NODE_REMOVED';
        else if (mark.url!==location.href) reason='PAGE_CHANGED';
        else if (Date.now()-mark.at>600000) reason='MARK_EXPIRED';
        else if (!visible(mark.node)) reason='NODE_HIDDEN';
        else if (!readMark(field)) reason=field==='editor' ? 'EDITOR_UNAVAILABLE' : 'TEXT_CHANGED';
        else reason=null;
      }
      marks[field]={status:reason ? mark ? 'stale' : 'unmarked' : 'marked',reason};
    }
    return {ok:true,observed,marks,picking:state.picking || null,revision:state.revision,sent:false};
  }
  const validate = draft => {
    if (!draft || !['company','title','recruiter','text'].every(key=>typeof draft[key]==='string') || !draft.recruiter.trim() || !draft.text.trim() || draft.text.length>500) return fail('INVALID_DRAFT');
    const observed=summarize();
    if (!observed.company || !observed.title || !observed.recruiter || !observed.editorMarked) return fail('MARKS_INCOMPLETE');
    if (!['company','title','recruiter'].every(key=>norm(draft[key])===observed[key])) return fail('CHAT_IDENTITY_MISMATCH');
    return {ok:true,observed,editor:readMark('editor')};
  };
  if (request?.action==='reset') {
    state.cancelPick?.();state.marks={};state.check=null;state.revision++;
    return {ok:true,sent:false};
  }
  if (request?.action==='mark') {
    const field=request.field;
    if (!['company','title','recruiter','editor','send','receipt'].includes(field)) return fail('INVALID_MARK_FIELD');
    state.cancelPick?.();state.check=null;state.picking=field;
    const hint=document.createElement('div');
    hint.textContent='岗位助手：请点击'+({company:'当前聊天的公司名称',title:'当前聊天的岗位名称',recruiter:'当前聊天的招聘人称呼',editor:'消息输入框',send:'发送按钮（此步只标记）',receipt:'当前对话的消息记录区域'}[field])+'；按 Esc 取消。不会点击发送。';
    Object.assign(hint.style,{position:'fixed',top:'12px',left:'12px',right:'12px',zIndex:'2147483647',background:'#143b4b',color:'white',padding:'12px',pointerEvents:'none',fontSize:'15px'});
    document.documentElement.appendChild(hint);
    let timeout;
    const stop = () => {
      document.removeEventListener('click',pick,true);document.removeEventListener('keydown',escape,true);
      document.removeEventListener('pointerdown',block,true);hint.remove();clearTimeout(timeout);state.cancelPick=null;state.picking=null;
    };
    const block = event => {if (event.isTrusted) {event.preventDefault();event.stopImmediatePropagation();}};
    const escape = event => {if (event.isTrusted && event.key==='Escape') {event.preventDefault();stop();}};
    const pick = event => {
      if (!event.isTrusted) return;
      event.preventDefault();event.stopImmediatePropagation();
      let node=event.composedPath()[0];
      if (field==='editor') node=node.closest?.('textarea,input,[contenteditable="true"]');
      if (field==='send') node=node.closest?.('button,[role="button"],input[type="submit"]');
      const control=['editor','send','receipt'].includes(field);
      const text=control ? '' : norm(node?.textContent);
      if (!visible(node) || ['BODY','HTML'].includes(node.tagName) || (field==='editor' ? !editable(node) : field==='send' ? !/^(发送|发送消息|send)$/i.test(norm(node.textContent)) : field==='receipt' ? editable(node) : !text || text.length>200)) {
        hint.textContent='无法采用该元素，请点具体文字或真正的消息输入框；Esc 取消。';return;
      }
      // 保留真实 DOM 引用，刷新、切换聊天或节点重建后必须重新标记，避免套用旧选择器。
      state.marks[field]={node,text,url:location.href,at:Date.now()};state.check=null;state.revision++;stop();
    };
    state.cancelPick=stop;
    document.addEventListener('click',pick,true);document.addEventListener('keydown',escape,true);document.addEventListener('pointerdown',block,true);
    timeout=setTimeout(stop,60000);
    return {ok:true,picking:field,sent:false};
  }
  if (request?.action==='inspect') {
    state.check=null;
    const match=validate(request.draft);
    if (!match.ok) return {...match,observed:summarize()};
    if (norm(readEditor(match.editor))) return fail('EDITOR_NOT_EMPTY');
    const token=Array.from(crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16)).join('-');
    state.check={token,id:request.draft.id,revision:request.draft.revision,text:request.draft.text,url:location.href,at:Date.now()};
    return {ok:true,token,observed:match.observed,identityMethod:'user-marked-exact-text',jobIdVerified:false,sent:false};
  }
  if (request?.action!=='fill') return fail('INVALID_CHAT_ACTION');
  const check=state.check;state.check=null;
  if (!check || request.token!==check.token || check.id!==request.draft?.id || check.revision!==request.draft?.revision || check.text!==request.draft?.text || check.url!==location.href || Date.now()-check.at>60000) return fail('CHAT_CHECK_EXPIRED');
  const match=validate(request.draft);
  if (!match.ok) return match;
  const editor=match.editor;
  if (norm(readEditor(editor))) return fail('EDITOR_NOT_EMPTY');
  if (state.lastFill===request.draft.id) return fail('DUPLICATE_FILL');
  let touched=false;
  try {
    // 不触发 Enter 或发送按钮，只调用原生值设置并通知页面文本发生变化。
    touched=true;state.lastFill=request.draft.id;
    if (['TEXTAREA','INPUT'].includes(editor.tagName)) {
      const prototype=editor.tagName==='TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype,'value').set.call(editor,request.draft.text);
    } else editor.textContent=request.draft.text;
    editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:request.draft.text}));
    await new Promise(resolve=>setTimeout(resolve,150));
    const after=validate(request.draft);
    if (!after.ok || after.editor!==editor || readEditor(editor)!==request.draft.text) return fail('FILL_READBACK_UNCERTAIN',true);
    return {ok:true,touched:true,filled:true,sent:false,deliveryVerified:false};
  } catch (_) {return fail('FILL_UNCERTAIN',touched);}
}
