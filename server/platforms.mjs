export const platforms=Object.freeze([
  {id:'boss',label:'BOSS直聘',state:'available',search:true,details:true,chatFill:true,send:true},
  {id:'liepin',label:'猎聘',state:'planned',search:false,details:false,chatFill:false,send:false},
  {id:'51job',label:'前程无忧',state:'planned',search:false,details:false,chatFill:false,send:false},
]);
export function checkedTask(input) {
  if (!input || input.platform!=='boss') throw new Error('PLATFORM_NOT_IMPLEMENTED');
  if (!['search','details'].includes(input.action) || typeof input.query!=='string' || !input.query.trim() || input.query.length>80 || !/^[0-9]{9}$/.test(input.city || '')) throw new Error('INVALID_SEARCH');
  if (!Number.isInteger(input.page ?? 1) || (input.page ?? 1)<1 || (input.page ?? 1)>3) throw new Error('INVALID_SEARCH_PAGE');
  const result={platform:'boss',action:input.action,query:input.query.trim(),city:input.city,page:input.page ?? 1};
  if (input.action==='details') {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(input.jobId || '') || !Number.isInteger(input.page ?? 1) || (input.page ?? 1)<1 || (input.page ?? 1)>3) throw new Error('INVALID_DETAIL_TARGET');
    Object.assign(result,{jobId:input.jobId,page:input.page ?? 1});
  }
  return result;
}
export function browserTask(input,id) {
  const form={page:String(input.page || 1),pageSize:'15',city:input.city,query:input.query,expectInfo:'',multiSubway:'',multiBusinessDistrict:'',scene:'1',encryptExpectId:''};
  for (const field of ['position','jobType','salary','experience','degree','industry','scale','stage']) form[field]='';
  return {id,kind:input.action,form,max_pages:1,...(input.action==='details' ? {detail_limit:1,detail_offset:0,job_ids:[input.jobId]} : {})};
}
export function cleanPages(pages,request) {
  if (!Array.isArray(pages) || pages.length!==1 || pages[0]?.ok!==true || !Array.isArray(pages[0].jobs) || pages[0].jobs.length>15) throw new Error('INVALID_PAGE_RESULT');
  const jobs=pages[0].jobs.map(item=>{
    if (!item || !/^[A-Za-z0-9_-]{1,200}$/.test(item.encryptJobId || '') || typeof item.jobName!=='string' || !item.jobName.trim()) throw new Error('INVALID_JOB');
    // 只取公开岗位字段，关联令牌、认证头和原始响应不能进入 SQLite。
    const job={platform:'boss',sourceKey:'boss:'+item.encryptJobId,jobId:item.encryptJobId,query:{query:request.query,city:request.city},listPage:request.page || 1};
    const fields={title:'jobName',company:'brandName',city:'cityName',salary:'salaryDesc',exp:'jobExperience',degree:'jobDegree',recruiter:'recruiterName',recruiterTitle:'recruiterTitle'};
    for (const [key,source] of Object.entries(fields)) job[key]=typeof item[source]==='string' ? item[source].trim().slice(0,key.startsWith('recruiter') ? 200 : 2000) : '';
    job.url='https://www.zhipin.com/job_detail/'+job.jobId+'.html';
    for (const [key,source] of Object.entries({industry:'brandIndustry',companySize:'brandScaleName',district:'areaDistrict'})) job[key]=typeof item[source]==='string' ? item[source].trim().slice(0,200) : '';
    job.skills=Array.isArray(item.skills) ? item.skills.filter(x=>typeof x==='string').slice(0,30).map(x=>x.slice(0,100)) : [];
    job.observedAt=new Date().toISOString();
    if (item.detail) {
      if (item.detail.jobId!==job.jobId || item.detail.identityVerified!==true || typeof item.detail.description!=='string' || !item.detail.description.trim() || item.detail.description.length>30000) throw new Error('DETAIL_ID_OR_BODY_MISMATCH');
      for (const [key,source] of Object.entries({title:'jobName',company:'brandName',salary:'salaryDesc'})) if (typeof item.detail[source]==='string' && item.detail[source].trim()) job[key]=item.detail[source].trim().slice(0,2000);
      job.jd=item.detail.description;job.detailVerified=true;job.needsDetail=false;job.detailCapturedAt=job.observedAt;
    }
    return job;
  });
  if (new Set(jobs.map(x=>x.sourceKey)).size!==jobs.length) throw new Error('DUPLICATE_JOB_IDS');
  if (request.action==='details' && (jobs.length!==1 || jobs[0].jobId!==request.jobId || !jobs[0].detailVerified)) throw new Error('DETAIL_TARGET_MISMATCH');
  return jobs;
}
