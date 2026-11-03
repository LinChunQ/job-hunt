let key='';
const $=id=>document.getElementById(id);
const status=$('status');
async function api(route,body={}) {
  const response=await fetch('/cli/'+route,{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+key},body:JSON.stringify(body)});
  const data=await response.json();if (!response.ok) throw new Error(data.errorCode || 'LOCAL_REQUEST_REJECTED');return data;
}
function element(tag,text,className) {const node=document.createElement(tag);node.textContent=text;if (className) node.className=className;return node;}
async function refresh() {
  const [service,jobs,drafts]=await Promise.all([api('status'),api('jobs'),api('drafts/list')]);
  status.textContent='服务运行中 · 插件'+(service.connected?'已连接':'未连接')+' · '+(service.blocked?'已暂停':'未暂停')+' · 岗位 '+jobs.jobs.length+' 条';
  $('jobs').replaceChildren();
  for (const job of jobs.jobs) {
    const card=element('article','','card');card.append(element('h3',job.title || '未命名岗位'),element('p',[job.company,job.city,job.salary].filter(Boolean).join(' · '),'meta'));
    if (job.jd) {const details=document.createElement('details');details.append(element('summary','查看岗位正文'),element('pre',job.jd));card.append(details);}
    $('jobs').append(card);
  }
  $('drafts').replaceChildren();
  for (const draft of drafts.drafts) {
    const card=element('article','','card');card.append(element('h3',draft.company+' · '+draft.title),element('p','状态：'+draft.status+' · 对象：'+(draft.recruiter || '未获取'),'meta'));
    const area=document.createElement('textarea');area.value=draft.text;area.readOnly=!['draft','skipped'].includes(draft.status);card.append(area);
    if (!area.readOnly) {
      const button=element('button','保存修改');button.type='button';button.addEventListener('click',async()=>{
        button.disabled=true;
        try {await api('drafts/update',{id:draft.id,revision:draft.revision,action:'save',text:area.value});await refresh();}
        catch(error) {status.textContent='保存失败：'+error.message+'；请先复制未保存的正文。';button.disabled=false;}
      });card.append(button);
    }
    $('drafts').append(card);
  }
}
$('connect').addEventListener('submit',async event=>{
  event.preventDefault();key=$('key').value.trim();$('key').value='';
  try {await refresh();status.textContent+=' · 已解锁本页';}
  catch(error) {key='';status.textContent='连接失败：'+error.message;}
});
