(() => {
  const $=id=>document.getElementById(id);
  const select=$('draft-select'), text=$('draft-text'), output=$('draft-status');
  const loadStatus=$('draft-load-status'), refreshButton=$('draft-refresh');
  const labels={draft:'待审阅',skipped:'已跳过',fill_pending:'填入结果待人工核对',filled_unconfirmed:'已填入或结果待核对；尚未确认发送',user_reported_sent:'用户报告已发送（系统未核实）'};
  let rows=[], inspected=false, busy=false, generation=0;
  let lastDraftPoll=Date.now(), draftPolling=false;
  let inspectedUntil=0;
  let marksReady=false, markSignature=null, autoChecked=null, monitoring=false, channelError=null;
  const current=()=>rows.find(row=>row.id===select.value);
  const isEditable=()=>['draft','skipped'].includes(current()?.status);
  function invalidate() {inspected=false;inspectedUntil=0;$('draft-confirm').checked=false;$('draft-observed').hidden=true;update();}
  function update() {
    const row=current();
    const dirty=!!row && text.value!==row.text;
    // 原生下拉框展开时不重复赋值 disabled，避免状态轮询干扰用户选择。
    const selectorDisabled=busy || !rows.length;
    if (select.disabled!==selectorDisabled) select.disabled=selectorDisabled;
    text.disabled=busy; text.readOnly=!isEditable();
    $('draft-save').disabled=busy || !isEditable();$('draft-skip').disabled=busy || !isEditable();
    $('draft-copy').disabled=busy || !row;
    $('draft-inspect').disabled=busy || !marksReady || row?.status!=='draft' || dirty;
    $('draft-fill').disabled=busy || !marksReady || !inspected || !$('draft-confirm').checked || dirty || row?.status!=='draft';
    $('draft-report-sent').disabled=busy || !['fill_pending','filled_unconfirmed'].includes(row?.status) || !$('draft-sent-confirm').checked;
    $('draft-length').textContent='正文 '+Array.from(text.value).length+' 字；上限 500 字';
    $('draft-state').textContent=row ? labels[row.status] || row.status : '没有草稿';
  }
  function render(row) {
    text.value=row?.text || '';
    $('draft-target').textContent=row ? row.company+' / '+row.title+' / '+(row.recruiter || '招聘人未获取：仅可复制后人工核对')+(row.recruiterTitle ? ' · '+row.recruiterTitle : '') : '';
    $('draft-sent-confirm').checked=false;autoChecked=null;invalidate();
  }
  function applyRows(nextRows, preferred) {
    const old=current();
    rows=nextRows;select.replaceChildren();
    if (!rows.length) {
      const option=document.createElement('option');option.value='';option.textContent='暂无草稿，请让 WorkBuddy 保存本轮话术';select.appendChild(option);
    }
    for (const row of rows) {
      const option=document.createElement('option');option.value=row.id;
      option.textContent=row.company+' · '+row.title+' ['+(labels[row.status] || row.status)+']';select.appendChild(option);
    }
    select.value=rows.some(row=>row.id===preferred) ? preferred : rows[0]?.id || '';
    const selected=current();
    if (!old || old.id!==selected?.id || old.revision!==selected?.revision || old.text!==selected?.text || old.status!==selected?.status) render(selected);
    else update();
  }
  async function load(preferred) {
    refreshButton.disabled=true;refreshButton.textContent='正在读取草稿…';
    loadStatus.textContent='正在从本机服务读取草稿…';
    try {
      const reply=await chrome.runtime.sendMessage({type:'draft-list'});
      if (!reply?.ok || !Array.isArray(reply.drafts)) throw new Error(reply?.errorCode || 'DRAFT_READ_FAILED');
      applyRows(reply.drafts,preferred);
      lastDraftPoll=Date.now();
      loadStatus.textContent=rows.length ? '已读取 '+rows.length+' 条草稿，请在下方选择岗位。' : '本机暂无草稿，请让 WorkBuddy 保存本轮话术。';
      return rows.length;
    } catch (error) {
      loadStatus.textContent='草稿读取失败：'+(error.message || 'DRAFT_READ_FAILED')+'。请检查本地服务后点击重读。';
      throw error;
    } finally {refreshButton.disabled=false;refreshButton.textContent='重新读取草稿';}
  }
  async function refreshDrafts() {
    if (document.hidden || busy || draftPolling || Date.now()-lastDraftPoll<3000) return;
    lastDraftPoll=Date.now();draftPolling=true;const token=generation;
    try {
      const reply=await chrome.runtime.sendMessage({type:'draft-list'});
      if (busy || token!==generation) return;
      if (!reply?.ok || !Array.isArray(reply.drafts)) throw new Error(reply?.errorCode || 'DRAFT_READ_FAILED');
      if (JSON.stringify(reply.drafts)===JSON.stringify(rows)) return;
      // 新数据只更新空闲面板；有未保存编辑或正在展开下拉框时保留用户当前输入。
      const row=current();
      if ((row && text.value!==row.text) || document.activeElement===select) {
        invalidate();loadStatus.textContent='数据库有更新；已保留当前编辑，请先复制未保存正文，再点击重新读取草稿。';return;
      }
      applyRows(reply.drafts,select.value);
      loadStatus.textContent='已自动同步本机数据库，共 '+rows.length+' 条草稿。';
    } catch (error) {
      if (busy || token!==generation) return;
      // 数据失联撤销填入确认，但不删除正文、不请求网站，也不自动保存或发送。
      invalidate();loadStatus.textContent='自动同步不可用：'+error.message+'。当前正文已保留，可手动重读。';
    } finally {draftPolling=false;}
  }
  async function action(operation) {
    if (busy) return;
    busy=true;update();const token=++generation;
    try {await operation(token);} catch (error) {if (token===generation) output.textContent='操作停止：'+error.message+'。未自动重试，未点击发送。';}
    finally {busy=false;update();void refreshMarks();}
  }
  function identity() {const row=current();if (!row) throw new Error('NO_DRAFT');return {id:row.id,revision:row.revision};}
  async function send(message) {
    const result=await chrome.runtime.sendMessage(message);
    if (!result?.ok) {
      if (result?.observed) {$('draft-observed').textContent=JSON.stringify(result.observed,null,2);$('draft-observed').hidden=false;}
      throw new Error(result?.errorCode || 'DRAFT_ACTION_FAILED');
    }
    return result;
  }
  select.addEventListener('change',()=>{
    const row=current();render(row);
    output.textContent=row ? '已选择：'+row.company+' · '+row.title+'。正文已显示，请核对后标记当前聊天。' : '请选择岗位。';
    void chrome.storage.local.set({greetingSelectedDraft:select.value}).catch(()=>{loadStatus.textContent='当前选择有效，但未能保存选择，下次打开需重选。';});
    void refreshMarks();
  });
  text.addEventListener('input',invalidate);
  $('draft-confirm').addEventListener('change',update);$('draft-sent-confirm').addEventListener('change',update);
  $('draft-refresh').addEventListener('click',()=>action(async()=>{const count=await load(select.value);output.textContent='已读取 '+count+' 条草稿；没有请求岗位或聊天接口。';}));
  for (const [id,kind] of [['draft-save','save'],['draft-skip','skip']]) {
    $(id).addEventListener('click',()=>action(async()=>{const key=identity();await send({type:'draft-update',...key,action:kind,text:text.value});await load(key.id);output.textContent=kind==='save' ? '草稿已保存，请重新核对聊天。' : '草稿已跳过，可编辑保存后恢复。';}));
  }
  $('draft-copy').addEventListener('click',()=>action(async()=>{
    try {await navigator.clipboard.writeText(text.value);output.textContent='正文已复制，请在网页核对对象后手动粘贴。';}
    catch (_) {text.disabled=false;text.readOnly=!isEditable();text.focus();text.select();output.textContent='请按 Ctrl+C 复制选中的正文。';}
  }));
  for (const field of ['company','title','recruiter','editor']) {
    $('mark-'+field).addEventListener('click',()=>action(async()=>{invalidate();marksReady=false;await send({type:'draft-mark',field});output.textContent='侧边栏保持打开，请在网页当前聊天区域点选对应元素；成功后右侧会显示结果。';}));
  }
  $('draft-reset').addEventListener('click',()=>action(async()=>{invalidate();await send({type:'draft-reset'});output.textContent='本页标记已清除。';}));
  async function inspectCurrent(automatic=false) {
    invalidate();
    const result=await send({type:'draft-inspect',...identity()});
    inspected=true;inspectedUntil=Date.now()+60000;$('draft-observed').textContent=JSON.stringify(result.observed,null,2);$('draft-observed').hidden=false;
    output.textContent=(automatic ? '四项已标记，自动核对通过。' : '核对通过。')+'手动标记文字与草稿完全匹配（未验证网站内部聊天 ID）。请肉眼确认对象，再勾选并填入；一分钟后需重新核对。';
  }
  $('draft-inspect').addEventListener('click',()=>action(()=>inspectCurrent()));

  const markFields=['company','title','recruiter','editor'];
  const reasonLabels={NOT_MARKED:'未标记',NODE_REMOVED:'节点已更新，请重标',PAGE_CHANGED:'页面已切换，请重标',MARK_EXPIRED:'标记已过期，请重标',NODE_HIDDEN:'元素已隐藏，请重标',EDITOR_UNAVAILABLE:'输入框不可用，请重标',TEXT_CHANGED:'文字已变化，请重标'};
  async function refreshMarks() {
    if (monitoring || busy || document.hidden) return;
    monitoring=true;const currentGeneration=generation;
    let shouldInspect=false;
    try {
      const result=await chrome.runtime.sendMessage({type:'draft-mark-status'});
      if (currentGeneration!==generation || busy) return;
      if (!result?.ok) {
        if (result?.errorCode==='DRAFT_ACTION_BUSY') return;
        throw new Error(result?.errorCode || 'MARK_STATUS_UNAVAILABLE');
      }
      channelError=null;
      if (inspected && Date.now()>=inspectedUntil) {invalidate();output.textContent="核对已过一分钟，请点击核对当前聊天，再确认填入。";}
      const observed=result.observed || {},marks=result.marks || {};
      const signature=JSON.stringify([result.context,result.revision,observed,marks,result.picking || null]);
      if (signature!==markSignature) {invalidate();markSignature=signature;autoChecked=null;}
      marksReady=!result.picking && markFields.every(field=>marks[field]?.status==='marked');
      let count=0;
      for (const field of markFields) {
        const node=$('mark-'+field+'-status'),mark=marks[field];
        const state=result.picking===field ? 'picking' : mark?.status || 'unmarked';
        node.dataset.state=state;
        if (state==='marked') {
          count++;node.textContent=field==='editor' ? '✓ 已标记输入框' : '✓ '+observed[field];
        } else node.textContent=state==='picking' ? '等待你在网页点选…' : reasonLabels[mark?.reason] || '未标记';
      }
      $('mark-progress').textContent='有效标记 '+count+'/4'+(result.picking ? ' · 点选时保持侧边栏打开' : '');
      const row=current();
      const attempt=JSON.stringify([signature,row?.id,row?.revision]);
      // 每组有效标记与草稿只自动核对一次；失败展示原因，不循环试探或自动填入。
      if (marksReady && row?.status==='draft' && text.value===row.text && !inspected && autoChecked!==attempt) {
        autoChecked=attempt;shouldInspect=true;
      }
      update();
    } catch (error) {
      if (currentGeneration!==generation) return;
      marksReady=false;markSignature=null;autoChecked=null;invalidate();
      $('mark-progress').textContent='标记状态不可用：'+error.message;
      for (const field of markFields) {const node=$('mark-'+field+'-status');node.dataset.state='unavailable';node.textContent='状态不可用';}
      // 聊天通道状态只显示在标记区，不覆盖草稿读取、选择或编辑结果。
      channelError=error.message;
    } finally {monitoring=false;}
    if (shouldInspect) await action(()=>inspectCurrent(true));
  }
  // 仅在面板可见且空闲时读取本地通道和已标记 DOM；不请求岗位或聊天接口。
  const markTimer=setInterval(()=>{void refreshMarks();void refreshDrafts();},800);
  globalThis.addEventListener?.('pagehide',()=>clearInterval(markTimer),{once:true});
  document.addEventListener?.('visibilitychange',()=>{if (!document.hidden) {void refreshMarks();void refreshDrafts();}});
  $('draft-fill').addEventListener('click',()=>action(async()=>{
    if (!inspected || !$('draft-confirm').checked) throw new Error('USER_CONFIRMATION_REQUIRED');
    const key=identity();invalidate();
    try {await send({type:'draft-fill',...key,confirmedByUser:true});await load(key.id);output.textContent='正文已填入且读回一致，尚未发送。请到网页确认对象、正文后手动发送。';}
    catch (error) {await load(key.id).catch(()=>{});throw error;}
  }));
  $('draft-report-sent').addEventListener('click',()=>action(async()=>{
    if (!$('draft-sent-confirm').checked) throw new Error('USER_CONFIRMATION_REQUIRED');
    const key=identity();await send({type:'draft-report-sent',...key,confirmedByUser:true});await load(key.id);
    output.textContent='已记录你的发送报告；系统没有独立验证投递，不会自动补发。';
  }));
  chrome.storage.local.get(['greetingSelectedDraft']).then(saved=>action(async()=>{
    const count=await load(saved.greetingSelectedDraft);output.textContent=count ? '草稿已加载。先核对正文，再标记当前聊天。' : '尚无草稿，请让 WorkBuddy 将已审阅话术保存到主库。';
  })).catch(()=>{output.textContent='草稿读取失败，请启动新版服务后重读。';});
})();
