const $=id=>document.getElementById(id);
const state={key:'',profile:null,jobs:[],drafts:[],delivery:null,status:null,dirtyProfile:false,profileEditRevision:0,edits:new Map(),selected:new Set(),loaded:false,busy:false,browserPending:null,batchPreview:[],reviewId:null,pool:null,poolPage:1,poolRequest:0,poolSelected:new Map(),collections:[],collectionRequestId:null};
const names={overview:'求职概览',preferences:'求职配置',jobs:'岗位库',drafts:'话术审阅',delivery:'发送队列'};
const states={draft:'待审阅',skipped:'已跳过',send_queued:'等待发送',send_dispatching:'正在执行',sent_observed:'页面已出现',send_uncertain:'结果待核实',send_not_retried:'已结案 · 不重发',fill_pending:'待核实填入',filled_unconfirmed:'已填入待确认',user_reported_sent:'用户报告已发送',queued:'等待核对',dispatching:'正在发送',uncertain:'结果不确定',cancelled:'已取消',running:'执行中',waiting:'等待匹配的聊天',paused:'已暂停',done:'已完成',not_retried:'已结案 · 不重发'};
const errors={JOB_CHANGED:'岗位已被其他操作更新，请刷新后重新选择。',JOB_PROTECTED:'所选岗位已有发送或待核实记录，不能回退或移入回收站。',JOB_NOT_ACTIVE:'岗位已过滤、跳过或归档，请先恢复并重新审阅。',VERIFIED_CITY_CODE_REQUIRED:'请为每个城市提供经过核实的 9 位城市编码。',COLLECTION_ALREADY_ACTIVE:'已有采集计划，请先暂停续采或取消后续动作。',COLLECTION_BUDGET_TOO_SMALL:'请求预算少于搜索组合页数，请减少页数或调整预算。',AUTO_CHAT_NOT_MATCHED:'没有找到唯一匹配的当前或已有聊天。请在 BOSS 打开对应岗位聊天后，点击核对并继续；无需逐项标记。',AUTO_CONTROLS_AMBIGUOUS:'页面输入框或发送区域定位不唯一，已暂停。请反馈页面结构以更新适配。',CHAT_IDENTITY_AMBIGUOUS:'存在多个相似聊天，已暂停。请打开准确的岗位聊天。',PAIRING_REJECTED:'配对码不正确，请重新连接。',PROFILE_CHANGED:'配置已被 WorkBuddy 或另一页面修改。请先复制未保存内容，再刷新页面重新编辑。',DRAFT_CHANGED:'话术版本已改变，请刷新并重新审阅。',UNSAVED_DRAFT:'有未保存的修改，请先保存。',SERVICE_PAUSED:'服务已暂停，请先人工检查网站并在插件恢复连接。',BROWSER_BUSY:'当前有未完成的采集或发送队列，请先处理。',EXTENSION_UPGRADE_OR_CONNECT_REQUIRED:'请重载新版插件，在已登录的 BOSS 标签页重新连接。',CHAT_IDENTITY_MISMATCH:'当前聊天与本条公司、岗位或招聘人不一致，请打开正确的岗位聊天后核对并继续。',MARKS_INCOMPLETE:'当前聊天的元素识别不完整，已暂停，需检查页面适配。',SEND_MARKS_REQUIRED:'发送按钮或消息记录区域尚未有效标记。',EDITOR_NOT_EMPTY:'消息输入框已有内容，请先手动核实，不会覆盖已有消息。',CHAT_PAGE_REQUIRED:'请在正常打开的 BOSS 聊天标签页连接插件。',JOB_CONTEXT_CHANGED:'岗位或联系人已经变化，请让 WorkBuddy 重新审阅。',SEND_RECEIPT_UNCERTAIN:'点击发送后未能准确确认新增消息，请人工核实。不会自动重发。',UNRESOLVED_DELIVERY:'请先核实不确定条目并结案。',BROWSER_ACTION_BUSY:'上一个浏览器动作尚未完成。',UI_LAUNCH_EXPIRED:'自动连接链接已失效，请使用配对码连接，或让 WorkBuddy 再次打开工作台。'};
function notice(message,error=false){$('notice').textContent=message;$('notice').className=error ? 'error' : '';$('notice').hidden=false;}
function element(tag,text,className){const node=document.createElement(tag);if(text!=null)node.textContent=text;if(className)node.className=className;return node;}
function button(text,action,className='secondary'){const node=element('button',text,className);node.type='button';node.addEventListener('click',()=>perform(action));return node;}
function badge(status){return element('span',states[status] || status || '未处理','badge '+(['done','sent_observed'].includes(status) ? 'done' : ['uncertain','send_uncertain','waiting'].includes(status) ? 'wait' : ''));}
async function api(route,body={}){
  const response=await fetch(route,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+state.key},body:JSON.stringify(body),signal:AbortSignal.timeout(10000),redirect:'error',credentials:'omit'});
  const data=await response.json();if(!response.ok || data.ok===false)throw new Error(data.errorCode || 'LOCAL_OPERATION_FAILED');return data;
}
async function perform(action){try{await action();}catch(error){notice(errors[error.message] || '操作未完成：'+error.message,true);}}
function view(name){if(!names[name])return;document.querySelectorAll('.view').forEach(node=>node.hidden=node.id!=='view-'+name);document.querySelectorAll('.nav').forEach(node=>node.classList.toggle('active',node.dataset.view===name));$('page-title').textContent=names[name];history.replaceState(null,'','#'+name);}
document.querySelectorAll('[data-view],[data-go]').forEach(node=>node.addEventListener('click',()=>view(node.dataset.view || node.dataset.go)));
document.querySelectorAll('[data-close]').forEach(node=>node.addEventListener('click',()=>$(node.dataset.close).close()));
function summaryRow(parent,label,value){const row=element('div',null,'summary-row');row.append(element('span',label),element('span',value || '尚未设定'));parent.append(row);}
function renderSummary(){
  const activeJobs=state.jobs.filter(x=>!x.archivedAt),p=state.profile?.preferences || {},counts=[['岗位总数',state.poolCounts?.active ?? activeJobs.length,'已按平台与岗位 ID 去重'],['待补详情',state.poolCounts?.detail ?? activeJobs.filter(x=>!x.detailVerified || x.needsDetail).length,'补齐正文后由 AI 审阅'],['待审阅话术',state.drafts.filter(x=>x.status==='draft').length,'每条正文均可编辑'],['页面已出现',state.drafts.filter(x=>x.status==='sent_observed').length,'仅为页面观察，非送达凭证']];
  $('stats').replaceChildren(...counts.map(([title,note,desc])=>{const node=element('div',null,'stat');node.append(element('p',title,'stat-label'),element('strong',String(note)),element('small',desc));return node;}));
  const profile=$('profile-summary');profile.replaceChildren();summaryRow(profile,'目标岗位',(p.keywords || []).join(' / '));summaryRow(profile,'求职城市',(p.cities || []).join(' / '));summaryRow(profile,'期望月薪',p.salaryMin!=null || p.salaryMax!=null ? (p.salaryMin ?? '不限')+'–'+(p.salaryMax ?? '不限')+' K' : '');summaryRow(profile,'简历事实',state.profile?.facts?.length ? state.profile.facts.length+' 条已保存' : '请在 WorkBuddy 上传简历');
  const service=$('service-summary');service.replaceChildren();summaryRow(service,'浏览器插件',state.status.connected ? '已连接' : '等待连接');summaryRow(service,'服务状态',state.status.blocked ? '已暂停 · 需人工检查网站' : '正常运行');summaryRow(service,'当前采集',state.status.task ? '有未完成任务' : '空闲');summaryRow(service,'发送能力',state.delivery.browser?.capable ? '新版插件就绪' : '请连接本版插件');
  $('recent-jobs').replaceChildren(...activeJobs.slice(0,4).map(job=>{const row=element('div',null,'recent-row'),info=element('div'),pay=element('div');info.append(element('strong',job.title),element('p',job.company));pay.append(element('span',job.salary || '薪资待了解','salary'),element('p',job.city || ''));row.append(info,pay,button(job.score!=null ? job.score+' 分' : '查看',()=>openJob(job),'text'));return row;}));
  if(!activeJobs.length)$('recent-jobs').append(element('div','还没有岗位。配置好条件后，让 WorkBuddy 开始第一轮搜索。','empty'));
}
function populateProfile(){if(state.dirtyProfile)return;const p=state.profile || {},v=p.preferences || {},form=$('profile-form');state.profileEditRevision=p.revision || 0;for(const name of ['displayName','facts','keywords','cities','salaryMin','salaryMax','experience','degree','workMode','notes']){const value=name==='displayName' ? p.displayName : name==='facts' ? (p.facts || []).join('\n') : ['keywords','cities'].includes(name) ? (v[name] || []).join('、') : v[name];form.elements[name].value=value ?? '';}$('profile-save-state').textContent='已与本机数据同步';}
$('profile-form').addEventListener('input',()=>{state.dirtyProfile=true;$('profile-save-state').textContent='有未保存的修改';});
$('profile-form').addEventListener('submit',event=>{event.preventDefault();perform(async()=>{const form=$('profile-form'),value=name=>form.elements[name].value.trim(),list=name=>value(name).split(/[,，、\n]+/).map(x=>x.trim()).filter(Boolean);const profile={displayName:value('displayName'),facts:value('facts').split(/\r?\n/).map(x=>x.trim()).filter(Boolean),revision:state.profileEditRevision,preferences:{keywords:list('keywords'),cities:list('cities'),salaryMin:value('salaryMin')==='' ? null : Number(value('salaryMin')),salaryMax:value('salaryMax')==='' ? null : Number(value('salaryMax')),experience:value('experience'),degree:value('degree'),workMode:value('workMode'),notes:value('notes')}};await api('/cli/profile/put',profile);state.dirtyProfile=false;notice('求职配置已保存到本机。没有发起岗位搜索。');await refresh();});});
const poolLabels={detail:'待补详情',review:'待 AI 审阅',ready:'待确认话术',queued:'发送队列中',sent:'页面已出现',uncertain:'待核实',filtered:'已过滤',skipped:'已跳过',archived:'回收站'};
const reasonLabels={BLOCKED_COMPANY:'命中屏蔽公司',TITLE_EXCLUDED:'岗位名命中排除词',JD_EXCLUDED:'JD 命中排除词',INTERNSHIP_EXCLUDED:'实习 / 管培排除',SALARY_UNKNOWN:'月薪无法解析',SALARY_OUT_OF_RANGE:'月薪区间不符',REPEATED_SEARCH_PAGE:'翻页结果重复，已停止该组合',EMPTY_SEARCH_PAGE:'空列表，当前组合未完整采集',DETAIL_LIMIT_REACHED:'达到本轮详情上限，剩余候选留待后续',REQUEST_BUDGET_REACHED:'达到本轮请求预算',LIST_ONLY_COMPLETED:'本轮列表采集已完成，未请求详情',COLLECTION_FINISHED:'本轮条件已处理',SERVICE_RESTARTED:'服务重启，请检查后续采',USER_PAUSED:'用户暂停',USER_CANCELLED:'用户取消',EXTENSION_DISCONNECTED:'插件连接断开',SITE_OR_SERVICE_PAUSED:'网站或服务暂停',TASK_RESULT_UNCERTAIN:'浏览器执行结果不确定，需先人工核实',TARGET_NOT_IN_FRESH_PAGE:'原岗位已不在新鲜列表，请核实后续采'};
const collectionLabels={running:'采集中',paused:'已暂停',cancelling:'正在停止后续动作',cancelled:'已取消',completed:'已完成',completed_with_shortage:'部分完成'};
function jobQuery(){const number=id=>$(id).value==='' ? null : Number($(id).value);return {query:$('job-search').value.trim(),city:$('job-city').value,platform:$('job-platform').value,stage:$('job-filter').value,sort:$('job-sort').value || 'newest',minScore:number('job-min-score'),salaryMin:number('job-salary-min'),salaryMax:number('job-salary-max'),page:state.poolPage,pageSize:15};}
async function loadPool(){
  const sequence=++state.poolRequest,query=jobQuery(),pool=await api('/cli/jobs/search',query);
  // 旧请求晚到时丢弃，避免输入筛选后被上一页响应覆盖。
  if(sequence!==state.poolRequest)return;
  state.pool=pool;state.poolPage=pool.page;renderJobs();
}
function jobSelection(){
  $('job-selected').textContent='已选 '+state.poolSelected.size+' 条';
  const archived=$('job-filter').value==='archived';
  for(const id of ['job-skip','job-reconsider','job-archive']){$(id).disabled=!state.poolSelected.size;$(id).hidden=archived;}
  $('job-restore').disabled=!state.poolSelected.size;$('job-restore').hidden=!archived;
}
function jobLocked(job){return ['queued','sent','uncertain'].includes(job.poolStage);}
function renderJobs(){
  const pool=state.pool;if(!pool)return;
  $('job-count').textContent=pool.total+' 条匹配岗位';$('jobs-empty').hidden=pool.jobs.length>0;
  $('job-tabs').replaceChildren(...[['','全部活跃'],['detail','待详情'],['review','待评分'],['ready','待确认'],['queued','发送中'],['sent','已沟通'],['uncertain','待核实'],['filtered','已过滤'],['skipped','已跳过'],['archived','回收站']].map(([value,label])=>{const node=button(label+' '+(pool.counts[value || 'active'] || 0),()=>{state.poolSelected.clear();$('job-filter').value=value;state.poolPage=1;return loadPool();},'pool-tab'+($('job-filter').value===value ? ' active' : ''));node.setAttribute('aria-pressed',String($('job-filter').value===value));return node;}));
  const previous=$('job-city').value;$('job-city').replaceChildren(element('option','全部城市'));$('job-city').firstChild.value='';for(const city of pool.cities){const option=element('option',city);option.value=city;$('job-city').append(option);}$('job-city').value=previous;
  $('job-rows').replaceChildren(...pool.jobs.map(job=>{
    const row=element('tr'),select=element('td'),check=element('input'),title=element('td'),pay=element('td'),experience=element('td'),score=element('td'),stage=element('td'),source=element('td'),action=element('td');
    check.type='checkbox';check.checked=state.poolSelected.has(job.sourceKey);check.disabled=jobLocked(job);check.setAttribute('aria-label','选择 '+job.title+' '+job.company);
    check.addEventListener('change',()=>{if(check.checked)state.poolSelected.set(job.sourceKey,{sourceKey:job.sourceKey,revision:job.poolRevision});else state.poolSelected.delete(job.sourceKey);jobSelection();});select.append(check);
    title.append(button(job.title || '岗位名称缺失',()=>openJob(job),'text job-link'),element('small',job.company));
    pay.append(element('span',job.salary || '月薪待了解','salary'),element('small',[job.city,job.district].filter(Boolean).join(' · ')));
    experience.append(element('span',job.exp || '经验待了解'),element('small',job.degree || '学历待了解'));
    score.append(element('span',job.score==null ? '待评分' : job.score+' 分',job.score==null ? 'muted' : 'score'));
    stage.append(element('span',poolLabels[job.poolStage] || job.poolStage,'badge'));if(job.filterReason)stage.append(element('small',reasonLabels[job.filterReason] || job.filterReason));
    source.append(element('span',job.platform==='boss' ? 'BOSS 直聘' : job.platform),element('small',job.query?.query || ''),element('small',job.firstSeenAt ? new Date(job.firstSeenAt).toLocaleDateString('zh-CN') : '历史岗位'));
    action.append(button('详情 →',()=>openJob(job),'text'));row.append(select,title,pay,experience,score,stage,source,action);return row;
  }));
  $('job-page').textContent='第 '+pool.page+' / '+pool.pages+' 页';$('job-prev').disabled=pool.page<=1;$('job-next').disabled=pool.page>=pool.pages;
  $('job-select-page').checked=pool.jobs.some(x=>!jobLocked(x)) && pool.jobs.filter(x=>!jobLocked(x)).every(x=>state.poolSelected.has(x.sourceKey));jobSelection();
}
async function openJob(job){
  state.activeJob=job.sourceKey;
  const requestedKey=job.sourceKey;const current=await api('/cli/jobs/get',{sourceKey:requestedKey});if(state.activeJob!==requestedKey)return;job=current.job;
  $('job-dialog-title').textContent=job.title || '岗位详情';const body=$('job-detail');body.replaceChildren();
  const columns=element('div',null,'detail-grid'),main=element('div'),aside=element('aside',null,'detail-aside');
  const tags=element('div',null,'detail-tags');for(const value of [job.salary,job.city,job.exp,job.degree,job.industry,job.companySize].filter(Boolean))tags.append(element('span',value,'detail-tag'));main.append(tags);
  const section=(title,text)=>{const node=element('section',null,'detail-section');node.append(element('h3',title),element('div',text,'jd-text'));main.append(node);};
  section('职责与要求',job.jd || '尚无验证正文。采集管线会对通过预筛的候选补充详情，AI 审阅需等待正文验证。');
  if(job.matchReason)section('匹配依据',job.matchReason);if(job.caution)section('需要留意',job.caution);if(job.greeting)section('已保存的打招呼语',job.greeting);
  summaryRow(aside,'公司',job.company);summaryRow(aside,'招聘人',[job.recruiter,job.recruiterTitle].filter(Boolean).join(' · '));summaryRow(aside,'状态',poolLabels[job.poolStage] || '待处理');summaryRow(aside,'来源关键词',job.query?.query);summaryRow(aside,'原始页码',String(job.listPage || 1));summaryRow(aside,'正文验证',job.detailVerified ? '已核对岗位 ID' : '尚未完成');
  if(job.filterReason)summaryRow(aside,'过滤原因',reasonLabels[job.filterReason] || job.filterReason);
  if(job.platform==='boss' && /^[A-Za-z0-9_-]{1,200}$/.test(job.jobId || '')){const link=element('a','在 BOSS 查看原岗位','source-link');link.href='https://www.zhipin.com/job_detail/'+job.jobId+'.html';link.target='_blank';link.rel='noopener noreferrer';aside.append(link);}
  const history=element('div');history.append(element('h3','处理记录'));columns.append(main,aside);body.append(columns,history);if(!$('job-dialog').open)$('job-dialog').showModal();
  const data=await api('/cli/jobs/history',{sourceKey:job.sourceKey});if(state.activeJob!==job.sourceKey)return;
  const labels={collected:'采集入库',detail_verified:'详情已验证',reviewed:'AI 审阅完成',archive:'移入回收站',restore:'恢复岗位',skip:'手动跳过',reconsider:'重新进入审阅',filtered:'条件预筛过滤'};
  const list=element('ul',null,'job-history');for(const event of data.events)list.append(element('li',(labels[event.action] || event.action)+' · '+new Date(event.at).toLocaleString('zh-CN')+(event.reason ? ' · '+(reasonLabels[event.reason] || event.reason) : '')));history.append(list);
}
for(const id of ['job-search','job-city','job-filter','job-platform','job-min-score','job-salary-min','job-salary-max','job-sort'])$(id).addEventListener('input',()=>perform(async()=>{state.poolPage=1;state.poolSelected.clear();await loadPool();}));
$('job-prev').addEventListener('click',()=>perform(async()=>{state.poolPage=Math.max(1,state.poolPage-1);await loadPool();}));$('job-next').addEventListener('click',()=>perform(async()=>{state.poolPage++;await loadPool();}));
$('job-reset').addEventListener('click',()=>perform(async()=>{for(const id of ['job-search','job-city','job-filter','job-platform','job-min-score','job-salary-min','job-salary-max'])$(id).value='';$('job-sort').value='newest';state.poolPage=1;state.poolSelected.clear();await loadPool();}));
$('job-select-page').addEventListener('change',()=>{for(const job of state.pool?.jobs || [])if(!jobLocked(job)){if($('job-select-page').checked)state.poolSelected.set(job.sourceKey,{sourceKey:job.sourceKey,revision:job.poolRevision});else state.poolSelected.delete(job.sourceKey);}renderJobs();});
for(const [id,action] of [['job-skip','skip'],['job-reconsider','reconsider'],['job-archive','archive'],['job-restore','restore']])$(id).addEventListener('click',()=>perform(async()=>{if(!state.poolSelected.size)return;if(action==='archive' && !window.confirm('将所选岗位移入回收站？历史记录与去重身份会保留，之后可以恢复。'))return;await api('/cli/jobs/action',{action,items:[...state.poolSelected.values()],...(action==='archive' ? {confirmedByUser:true} : {})});state.poolSelected.clear();notice('岗位状态已更新。');await refresh();}));
function collectionCard(run,compact=false){
  const card=element('div',null,compact ? 'collection-history-item' : ''),head=element('div',null,'section-head'),info=element('div'),actions=element('div',null,'inline');
  info.append(element('strong',(collectionLabels[run.status] || run.status)+' · '+run.options.cities.map(x=>x.name).join(' / ')),element('p',run.options.keywords.join('、')+' · '+new Date(run.createdAt).toLocaleString('zh-CN'),'muted'));
  for(const [action,label] of run.status==='running' ? [['pause','暂停'],['cancel','取消后续']] : run.status==='paused' ? [['resume','从断点续采'],['cancel','取消后续']] : [])actions.append(button(label,async()=>{await api('/cli/collections/control',{id:run.id,action});await refresh();}));head.append(info,actions);card.append(head);
  const metrics=element('div',null,'collection-metrics');for(const [key,label] of [['new','新增'],['duplicates','重复'],['filtered','过滤'],['details','详情补齐'],['detailReused','详情复用'],['requestsReserved','请求预算已用']]){const item=element('div',null,'collection-metric');item.append(element('span',label),element('strong',String(run.counts[key] || 0)));metrics.append(item);}card.append(metrics);
  const count=run.options.cities.length*run.options.keywords.length,progress=element('p','阶段：'+(run.phase==='search' ? '列表采集' : '补充详情')+' · 已完成组合 '+Math.min(run.comboIndex,count)+' / '+count+' · 已扫描 '+run.counts.pages+' 页 · 待补详情 '+run.detailQueue.length+' 条','collection-checkpoint');card.append(progress);
  if(run.reason)card.append(element('p',reasonLabels[run.reason] || errors[run.reason] || run.reason,'callout'));
  if(run.status==='running' && state.status?.cooldownRemainingSeconds)card.append(element('p','冷却剩余 '+state.status.cooldownRemainingSeconds+' 秒，之后继续下一个动作。','muted'));
  if(run.filterRecords.length){const details=element('details');details.append(element('summary','查看过滤明细（'+run.filterRecords.length+'）'));for(const row of run.filterRecords)details.append(element('p',row.title+' · '+row.company+' — '+(reasonLabels[row.reason] || row.reason),'filter-record'));card.append(details);}return card;
}
function renderCollections(){const runs=state.collections;$('collection-current').replaceChildren(runs.length ? collectionCard(runs[0]) : element('p','还没有采集记录。设定关键词与经过核实的城市编码，开始第一轮采集。','empty'));$('collection-history').replaceChildren(...runs.slice(1).map(run=>collectionCard(run,true)));$('collect-open').disabled=runs.some(x=>!['completed','completed_with_shortage','cancelled'].includes(x.status));}
$('collect-refresh').addEventListener('click',()=>perform(()=>refresh()));
$('collect-open').addEventListener('click',()=>{const form=$('collect-form'),p=state.profile?.preferences || {},last=state.collections[0]?.options;form.elements.keywords.value=(p.keywords || []).join('、');form.elements.cities.value=(p.cities || []).map(name=>{const known=last?.cities.find(x=>x.name===name);return name+':'+(known?.code || '');}).join('\n');for(const key of ['salaryMin','salaryMax'])form.elements[key].value=p[key] ?? '';state.collectionRequestId=crypto.randomUUID();$('collect-dialog').showModal();});
$('collect-form').addEventListener('submit',event=>{event.preventDefault();perform(async()=>{const form=$('collect-form'),value=name=>form.elements[name].value.trim(),lines=name=>value(name).split(/[,，、\n]+/).map(x=>x.trim()).filter(Boolean),number=name=>value(name)==='' ? null : Number(value(name));const cities=value('cities').split(/\n/).filter(x=>x.trim()).map(line=>{const parts=line.trim().split(/[:：]/);if(parts.length!==2 || !/^\d{9}$/.test(parts[1].trim()))throw new Error('VERIFIED_CITY_CODE_REQUIRED');return {name:parts[0].trim(),code:parts[1].trim()};});await api('/cli/collections/create',{requestId:state.collectionRequestId,platform:'boss',keywords:lines('keywords'),cities,maxPages:number('maxPages'),detailLimit:number('detailLimit'),requestBudget:number('requestBudget'),filters:{salaryMin:number('salaryMin'),salaryMax:number('salaryMax'),blockedCompanies:lines('blockedCompanies'),titleExcludes:lines('titleExcludes'),jdExcludes:lines('jdExcludes'),excludeInternships:form.elements.excludeInternships.checked,filterUnknownSalary:form.elements.filterUnknownSalary.checked}});$('collect-dialog').close();notice('采集计划已保存。只会采集与预筛，不会自动发送。');await refresh();});});
function selectedCount(){for(const id of [...state.selected])if(!state.drafts.some(x=>x.id===id && x.status==='draft'))state.selected.delete(id);$('selected-count').textContent='已选 '+state.selected.size+' 条';$('batch-create').disabled=!state.selected.size;$('select-all').checked=state.drafts.filter(x=>x.status==='draft' && x.recruiter).length>0 && state.drafts.filter(x=>x.status==='draft' && x.recruiter).every(x=>state.selected.has(x.id));}
function renderDrafts(){
  selectedCount();const filter=$('draft-filter').value;
  const drafts=state.drafts.filter(x=>!filter || (filter==='draft' ? x.status==='draft' : filter==='queued' ? ['send_queued','send_dispatching'].includes(x.status) : !['draft','send_queued','send_dispatching'].includes(x.status)));
  $('draft-list').replaceChildren(...drafts.map(draft=>{
    const card=element('article',null,'draft-card'+(state.selected.has(draft.id) ? ' selected' : '')),head=element('div',null,'draft-head'),check=document.createElement('input'),info=element('div');check.type='checkbox';check.checked=state.selected.has(draft.id);check.disabled=draft.status!=='draft' || !draft.recruiter;check.setAttribute('aria-label','选择 '+draft.title+' '+draft.company);check.addEventListener('change',()=>{if(check.checked)state.selected.add(draft.id);else state.selected.delete(draft.id);card.classList.toggle('selected',check.checked);selectedCount();});info.append(element('h3',draft.title),element('p',draft.company+' · '+(draft.recruiter || '招聘人缺失，暂不可自动发送')));head.append(check,info,badge(draft.status));
    const textarea=element('textarea',null,'draft-text');textarea.maxLength=500;textarea.setAttribute('aria-label',draft.company+' 的打招呼正文');textarea.value=state.edits.get(draft.id)?.text ?? draft.text;textarea.disabled=!['draft','skipped'].includes(draft.status);
    const meta=element('div',null,'draft-meta'),count=element('span',textarea.value.length+' / 500'),saved=element('span',state.edits.has(draft.id) ? '有未保存的修改' : '已同步');meta.append(count,saved);
    const editRevision=state.edits.get(draft.id)?.revision ?? draft.revision;
    textarea.addEventListener('input',()=>{state.edits.set(draft.id,{text:textarea.value,revision:editRevision});count.textContent=textarea.value.length+' / 500';saved.textContent='有未保存的修改';});
    const actions=element('div',null,'draft-actions');if(['draft','skipped'].includes(draft.status)){actions.append(button('保存修改',async()=>{const edit=state.edits.get(draft.id);await api('/cli/drafts/update',{id:draft.id,revision:edit?.revision ?? draft.revision,action:'save',text:textarea.value});state.edits.delete(draft.id);notice('话术已保存。');await refresh();}));actions.append(button('跳过',async()=>{await api('/cli/drafts/update',{id:draft.id,revision:draft.revision,action:'skip'});state.edits.delete(draft.id);state.selected.delete(draft.id);await refresh();}));}
    actions.append(button('复制正文',async()=>{await navigator.clipboard.writeText(textarea.value);notice('已复制正文。');}));card.append(head,textarea,meta,actions);if(draft.lastErrorCode)card.append(element('p',errors[draft.lastErrorCode] || draft.lastErrorCode,'error'));return card;
  }));if(!drafts.length)$('draft-list').append(element('div','暂无话术。请让 WorkBuddy 根据简历事实和已验证的岗位正文生成。','panel empty'));
}
$('draft-filter').addEventListener('change',renderDrafts);
$('select-all').addEventListener('change',()=>{state.selected.clear();if($('select-all').checked)state.drafts.filter(x=>x.status==='draft' && x.recruiter).forEach(x=>state.selected.add(x.id));renderDrafts();});
$('batch-create').addEventListener('click',()=>perform(async()=>{
  const items=state.drafts.filter(x=>state.selected.has(x.id));if(items.some(x=>state.edits.has(x.id)))throw new Error('UNSAVED_DRAFT');if(items.length>30)throw new Error('单批最多 30 条，请减少选择');
  state.batchPreview=items.map(x=>({id:x.id,revision:x.revision,text:x.text}));state.reviewId=crypto.randomUUID();
  $('batch-preview').replaceChildren(...items.map(item=>{const node=element('article',null,'preview-item');node.append(element('h3',item.company+' · '+item.title),element('p','收件人：'+item.recruiter),element('p',item.text));return node;}));$('batch-confirm').checked=false;$('batch-submit').disabled=true;$('batch-dialog').showModal();
}));
$('batch-confirm').addEventListener('change',()=>$('batch-submit').disabled=!$('batch-confirm').checked);
$('batch-submit').addEventListener('click',()=>perform(async()=>{if(!$('batch-confirm').checked)return;$('batch-submit').disabled=true;try{await api('/cli/delivery/create',{requestId:state.reviewId,confirmedByUser:true,items:state.batchPreview});state.selected.clear();$('batch-dialog').close();view('delivery');notice('已保存本批发送授权。插件将自动识别并核对当前或已有聊天；匹配通过后逐条执行。');await refresh();}finally{$('batch-submit').disabled=!$('batch-confirm').checked;}}));
const markNames={company:'公司',title:'岗位',recruiter:'招聘人',editor:'输入框',send:'发送按钮',receipt:'消息记录区域'};
for(const [field,label] of Object.entries(markNames)){const row=element('div',null,'mark-row'),status=element('span','未标记');status.id='mark-'+field;row.append(button('标记'+label,()=>browserAction('mark',field),'text'),status);$('mark-buttons').append(row);}
async function browserAction(action,field){const reply=await api('/cli/browser/action',{action,field});state.browserPending={id:reply.action.id,type:action};$('browser-state').textContent='动作已交给插件，等待当前授权标签页响应…';await refresh(false);}
$('auto-inspect').addEventListener('click',()=>perform(async()=>{const batch=state.delivery?.batches.find(x=>x.items.some(i=>i.status==='queued')),id=batch?.items.find(x=>x.status==='queued')?.id || state.selected.values().next().value || state.drafts.find(x=>x.status==='draft')?.id;const draft=state.drafts.find(x=>x.id===id);if(!draft){notice('请先生成一条话术，再检查对应聊天的自动识别。');return;}const reply=await api('/cli/browser/action',{action:'inspect',id:draft.id,revision:draft.revision});state.browserPending={id:reply.action.id,type:'inspect'};$('browser-state').textContent='正在检查 '+draft.company+' · '+draft.title+' 的当前聊天…';}));
$('mark-status').addEventListener('click',()=>perform(()=>browserAction('status')));$('mark-reset').addEventListener('click',()=>perform(()=>browserAction('reset')));
function renderDelivery(){
  const data=state.delivery;if(!data)return;const action=data.action;
  if(state.browserPending && action?.id===state.browserPending.id && ['done','failed'].includes(action.status)){
    $('browser-state').textContent=action.result?.ok ? action.result.picking ? '请到 BOSS 页点选'+markNames[action.result.picking]+'，然后回到工作台查看状态。' : '当前标记状态已更新。' : errors[action.result?.errorCode] || '页面动作未完成：'+action.result?.errorCode;
    if(action.result?.marks)for(const [field,label] of Object.entries(markNames)){const marked=action.result.marks[field]?.status==='marked';$('mark-'+field).textContent=marked ? '已标记' : '未标记';$('mark-'+field).classList.toggle('ready',marked);}
    const wasMark=state.browserPending.type==='mark';state.browserPending=null;if(wasMark)state.waitingForMark=true;
  }
  if(!data.browser?.capable)$('browser-state').textContent='等待新版插件连接（更新后请重载并重新授权聊天标签页）';
  $('batch-list').replaceChildren(...data.batches.map(batch=>{const card=element('article',null,'panel'),head=element('div',null,'batch-head'),info=element('div'),actions=element('div',null,'inline');info.append(element('h2','批次 · '+batch.items.length+' 条'),element('p',new Date(batch.createdAt).toLocaleString('zh-CN')+' · '+(states[batch.status] || batch.status)));
    const control=async(action,extra={})=>{await api('/cli/delivery/control',{id:batch.id,action,...extra});await refresh();};
    if(['paused','waiting'].includes(batch.status))actions.append(button('核对并继续',()=>control('continue')));
    if(batch.status==='running')actions.append(button('暂停',()=>control('pause')));
    if(batch.items.some(x=>x.status==='queued'))actions.append(button('取消未发送',()=>control('cancel')));
    head.append(info,actions);card.append(head);
    for(const item of batch.items){const row=element('div',null,'queue-item'),target=element('div'),result=element('div');target.append(element('strong',item.company+' · '+item.title),element('small','招聘人：'+item.recruiter));result.append(badge(item.status));if(item.errorCode)result.append(element('p',errors[item.errorCode] || item.errorCode,'error'));if(item.status==='uncertain')result.append(button('已人工核实，结案不重发',async()=>{if(window.confirm('请先在网站核实本条消息。结案后仍不会自动重发；确认已核实？'))await control('resolve',{itemId:item.id,confirmedByUser:true});}));row.append(target,result);card.append(row);}return card;}));
  if(!data.batches.length)$('batch-list').append(element('div','暂无发送队列。在“话术审阅”中保存并勾选草稿，审阅后批量确认。','panel empty'));
}
async function refresh(render=true){if(!state.key || state.busy)return;state.busy=true;try{
  const [status,profile,jobs,drafts,delivery,collections]=await Promise.all([api('/cli/status'),api('/cli/profile/get'),api('/cli/jobs/summary'),api('/cli/drafts/list'),api('/cli/delivery/status'),api('/cli/collections/list')]);
  const changed=JSON.stringify(state.drafts)!==JSON.stringify(drafts.drafts);state.status=status;state.profile=profile.profile;state.jobs=jobs.recent;state.poolCounts=jobs.counts;state.drafts=drafts.drafts;state.delivery=delivery;state.collections=collections.runs;
  $('login').hidden=true;$('workspace').hidden=false;$('lock').hidden=false;$('connection').textContent=status.blocked ? '服务已暂停' : status.connected ? '插件已连接' : '工作台已连接 · 插件离线';$('connection').className='pill '+(status.blocked || !status.connected ? 'warn' : 'good');
  renderSummary();populateProfile();await loadPool();if(render || changed || !state.loaded)renderDrafts();renderDelivery();renderCollections();state.loaded=true;
}finally{state.busy=false;}}
$('login-form').addEventListener('submit',event=>{event.preventDefault();perform(async()=>{state.key=$('key').value.trim();$('key').value='';await refresh();notice('工作台已连接，个人数据仅在本机读取。');});});
$('refresh').addEventListener('click',()=>perform(()=>refresh(true)));
$('lock').addEventListener('click',()=>{if((state.dirtyProfile || state.edits.size) && !window.confirm('有未保存的修改。确认锁定并关闭当前工作台？'))return;state.key='';location.replace(location.pathname);});
window.addEventListener('beforeunload',event=>{if(state.dirtyProfile || state.edits.size){event.preventDefault();event.returnValue='';}});
const launch=new URLSearchParams(location.hash.slice(1)).get('launch');
view(names[location.hash.slice(1)] ? location.hash.slice(1) : 'overview');
// 一次性启动凭证从片段交换，立即移除；长期配对码不出现在 URL 或浏览器存储中。
if(launch){history.replaceState(null,'',location.pathname);perform(async()=>{const response=await fetch('/ui/exchange',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:launch}),credentials:'omit',redirect:'error'});const data=await response.json();if(!response.ok)throw new Error(data.errorCode);state.key=data.key;await refresh();});}
setInterval(()=>{if(!state.key || document.hidden)return;perform(async()=>{await refresh(false);if(state.waitingForMark && !state.browserPending && !['pending','dispatched'].includes(state.delivery?.action?.status)){state.waitingForMark=false;await browserAction('status');}});},3000);
window.addEventListener('focus',()=>{if(state.key)perform(async()=>{await refresh(false);if(state.delivery?.browser?.chat && !state.browserPending)await browserAction('status');});});
