// 岗位池状态由本地处理结果与草稿状态共同推导，不把生成话术视为已批准发送。
export const lockedDraftStates = new Set(['fill_pending','filled_unconfirmed','user_reported_sent','send_queued','send_dispatching','send_uncertain','sent_observed','send_not_retried']);
export function poolStage(job, draft) {
  if (job.archivedAt) return 'archived';
  if (['sent_observed','user_reported_sent'].includes(draft?.status)) return 'sent';
  if (['send_uncertain','fill_pending','filled_unconfirmed','send_not_retried'].includes(draft?.status)) return 'uncertain';
  if (['send_queued','send_dispatching'].includes(draft?.status)) return 'queued';
  if (job.poolStatus==='filtered') return 'filtered';
  if (job.poolStatus==='skipped' || (draft?.status==='skipped' && job.needsScoring!==true)) return 'skipped';
  if (!job.detailVerified || !job.jd || job.needsDetail) return 'detail';
  if (!job.greeting || job.needsScoring) return 'review';
  return 'ready';
}
export function salaryRange(text) {
  const value=String(text || '').replace(/\s/g,'');
  // 仅解析明确标注的月薪；日薪、年薪、面议及字体私用区字符都留作未知。
  if (/[\uE000-\uF8FF]/.test(value) || /[日天年]/.test(value)) return null;
  const match=value.match(/^(\d+(?:\.\d+)?)(?:[-–~](\d+(?:\.\d+)?))?([kK千]|万)(?:[·・]\d+薪|\/月|元\/月)?$/);
  if (!match) return null;
  const scale=match[3]==='万' ? 10 : 1, min=Number(match[1])*scale, max=Number(match[2] || match[1])*scale;
  return min<=max ? {min,max} : null;
}
export function checkedFilters(input={}) {
  if (!input || typeof input!=='object' || Array.isArray(input)) throw new Error('INVALID_COLLECTION_FILTERS');
  const words=value=>{
    if (value===undefined) return [];
    if (!Array.isArray(value) || value.length>50 || value.some(x=>typeof x!=='string' || !x.trim() || x.length>100 || /[\x00-\x1f]/.test(x))) throw new Error('INVALID_COLLECTION_FILTERS');
    return [...new Set(value.map(x=>x.trim()))];
  };
  const number=value=>{if (value==null || value==='') return null;if (!Number.isFinite(value) || value<0 || value>1000) throw new Error('INVALID_SALARY');return value;};
  const result={blockedCompanies:words(input.blockedCompanies),titleExcludes:words(input.titleExcludes),jdExcludes:words(input.jdExcludes),salaryMin:number(input.salaryMin),salaryMax:number(input.salaryMax),excludeInternships:input.excludeInternships===true,filterUnknownSalary:input.filterUnknownSalary===true};
  if (result.salaryMin!==null && result.salaryMax!==null && result.salaryMin>result.salaryMax) throw new Error('INVALID_SALARY_RANGE');
  return result;
}
export function prefilter(job,filters,{detail=false}={}) {
  const includes=(value,words)=>words.some(word=>String(value || '').toLocaleLowerCase().includes(word.toLocaleLowerCase()));
  if (includes(job.company,filters.blockedCompanies)) return 'BLOCKED_COMPANY';
  if (includes(job.title,filters.titleExcludes)) return 'TITLE_EXCLUDED';
  if (filters.excludeInternships && /实习|管培/.test(job.title+' '+(detail ? job.jd : ''))) return 'INTERNSHIP_EXCLUDED';
  if (detail && includes(job.jd,filters.jdExcludes)) return 'JD_EXCLUDED';
  const salary=salaryRange(job.salary);
  if (!salary && filters.filterUnknownSalary) return 'SALARY_UNKNOWN';
  if (salary && ((filters.salaryMin!==null && salary.max<filters.salaryMin) || (filters.salaryMax!==null && salary.min>filters.salaryMax))) return 'SALARY_OUT_OF_RANGE';
  return null;
}
export function searchPool(jobs,drafts,input={}) {
  const text=value=>{if (value==null) return '';if (typeof value!=='string' || value.length>200) throw new Error('INVALID_POOL_QUERY');return value.trim();};
  const query=text(input.query).toLocaleLowerCase(), city=text(input.city),platform=text(input.platform),stage=text(input.stage),sort=text(input.sort) || 'newest';
  const stages=['detail','review','ready','queued','sent','uncertain','filtered','skipped','archived'];
  if ((stage && !stages.includes(stage)) || !['newest','score','salary'].includes(sort)) throw new Error('INVALID_POOL_QUERY');
  const page=input.page ?? 1,pageSize=input.pageSize ?? 15;
  if (!Number.isInteger(page) || page<1 || !Number.isInteger(pageSize) || pageSize<1 || pageSize>100) throw new Error('INVALID_POOL_QUERY');
  const minScore=input.minScore==null || input.minScore==='' ? null : input.minScore;
  if (minScore!==null && (!Number.isFinite(minScore) || minScore<0 || minScore>100)) throw new Error('INVALID_SCORE');
  const salary=checkedFilters({salaryMin:input.salaryMin,salaryMax:input.salaryMax});
  const byKey=new Map(drafts.map(x=>[x.sourceKey,x]));
  let rows=jobs.map(job=>({...job,poolRevision:job.poolRevision || 1,poolStage:poolStage(job,byKey.get(job.sourceKey))}));
  const counts=Object.fromEntries(stages.map(s=>[s,rows.filter(x=>x.poolStage===s).length]));counts.active=rows.filter(x=>x.poolStage!=='archived').length;
  rows=rows.filter(job=>(stage ? job.poolStage===stage : job.poolStage!=='archived') && (!query || [job.title,job.company,job.query?.query].some(x=>String(x || '').toLocaleLowerCase().includes(query))) && (!city || job.city===city) && (!platform || job.platform===platform) && (minScore===null || (job.score!=null && job.score>=minScore)) && !prefilter(job,salary));
  const time=job=>Date.parse(job.firstSeenAt || job.observedAt || '') || 0;
  rows.sort((a,b)=>sort==='score' ? (b.score ?? -1)-(a.score ?? -1) || time(b)-time(a) : sort==='salary' ? (salaryRange(b.salary)?.max ?? -1)-(salaryRange(a.salary)?.max ?? -1) || time(b)-time(a) : time(b)-time(a) || a.sourceKey.localeCompare(b.sourceKey));
  const total=rows.length,pages=Math.max(1,Math.ceil(total/pageSize)),current=Math.min(page,pages);
  return {ok:true,jobs:rows.slice((current-1)*pageSize,current*pageSize),total,page:current,pageSize,pages,counts,cities:[...new Set(jobs.filter(x=>!x.archivedAt).map(x=>x.city).filter(Boolean))].sort()};
}
