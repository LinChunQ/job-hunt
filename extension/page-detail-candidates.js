// 新鲜列表关联参数只交给扩展内存，不回传本地服务或写入存储。
export async function fetchDetailCandidatesInPage(options) {
  if (location.origin !== 'https://www.zhipin.com') return {ok:false,errorCode:'WRONG_SITE'};
  if (!options || !Number.isInteger(options.limit) || options.limit < 1 || options.limit !== 1 || !Number.isInteger(options.offset) || options.offset < 0 || options.offset + options.limit > 15) return {ok:false,errorCode:'INVALID_DETAIL_LIMIT'};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(),18000);
  try {
    const response = await fetch('/wapi/zpgeek/search/joblist.json?_=' + Date.now(), {
      method:'POST',credentials:'same-origin',redirect:'error',
      headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json, text/plain, */*','X-Requested-With':'XMLHttpRequest'},
      body:new URLSearchParams(options.form).toString(),signal:controller.signal});
    if (!response.ok) return {ok:false,errorCode:'LIST_HTTP_' + response.status};
    if (!(response.headers.get('content-type') || '').includes('application/json')) return {ok:false,errorCode:'LIST_NOT_JSON'};
    const data = await response.json();
    if (data?.code !== 0 || !Array.isArray(data.zpData?.jobList)) return {ok:false,errorCode:'LIST_BUSINESS_ERROR',code:Number.isInteger(data?.code) ? data.code : null};
    const requested = options.jobIds || [];
    if (!Array.isArray(requested) || requested.length > options.limit || requested.some(id => typeof id !== 'string' || !id || id.length > 200)) return {ok:false,errorCode:'INVALID_JOB_IDS'};
    let selected;
    if (requested.length) {
      selected = requested.map(id => data.zpData.jobList.find(job => job.encryptJobId === id));
      if (selected.some(job => !job)) return {ok:false,errorCode:'TARGET_NOT_IN_FRESH_PAGE'};
    } else selected = data.zpData.jobList.slice(options.offset,options.offset + options.limit);
    if (!selected.length) return {ok:false,errorCode:'NO_JOBS_FOR_DETAILS'};
    const jobs = [], contexts = [];
    for (const item of selected) {
      const lid = item.lid || data.zpData.lid;
      if (typeof item.encryptJobId !== 'string' || !item.encryptJobId || typeof item.securityId !== 'string' || !item.securityId || item.securityId.length > 8192 || typeof lid !== 'string' || !lid || lid.length > 2048) return {ok:false,errorCode:'MISSING_DETAIL_CONTEXT'};
      const job = {};
      for (const key of ['encryptJobId','jobName','brandName','salaryDesc','cityName','areaDistrict','businessDistrict','jobExperience','jobDegree','brandIndustry','brandScaleName','brandStageName']) job[key] = typeof item[key] === 'string' ? item[key].slice(0,2000) : '';
      // 1.0.1 补充公开展示的招聘称呼和职务；账号标识、头像及在线状态仍不导出。
      job.recruiterName = typeof item.bossName === 'string' ? item.bossName.trim().slice(0,200) : '';
      job.recruiterTitle = typeof item.bossTitle === 'string' ? item.bossTitle.trim().slice(0,200) : '';
      for (const key of ['skills','welfareList']) job[key] = Array.isArray(item[key]) ? item[key].filter(text => typeof text === 'string').slice(0,50).map(text => text.slice(0,300)) : [];
      jobs.push(job);
      contexts.push({jobId:item.encryptJobId,securityId:item.securityId,lid});
    }
    if (new Set(jobs.map(job => job.encryptJobId)).size !== jobs.length || selected.some(job => data.zpData.jobList.filter(item => item.encryptJobId === job.encryptJobId).length !== 1)) return {ok:false,errorCode:'DUPLICATE_JOB_IDS'};
    return {ok:true,jobs,contexts,hasMore:data.zpData.hasMore === true,totalCount:Number.isInteger(data.zpData.totalCount) ? data.zpData.totalCount : null};
  } catch (error) {return {ok:false,errorCode:error?.name === 'AbortError' ? 'LIST_TIMEOUT' : 'LIST_NETWORK_ERROR'};}
  finally {clearTimeout(timeout);}
}
