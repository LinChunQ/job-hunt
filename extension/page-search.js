// 在用户已有标签页的 MAIN 环境运行，复用正常会话，不读取 Cookie 或伪造校验参数。
export async function fetchJobsInPage(form) {
  if (location.origin !== 'https://www.zhipin.com') return {ok: false, error: '标签页已离开目标站点'};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch('/wapi/zpgeek/search/joblist.json?_=' + Date.now(), {
      method: 'POST', credentials: 'same-origin', redirect: 'error',
      headers: {'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest'},
      body: new URLSearchParams(form).toString(), signal: controller.signal,
    });
    if (!response.ok) return {ok: false, error: 'HTTP ' + response.status};
    if (!(response.headers.get('content-type') || '').includes('application/json')) {
      return {ok: false, error: '响应不是 JSON，可能需要人工登录或验证'};
    }
    const data = await response.json();
    if (data.code !== 0 || !Array.isArray(data.zpData?.jobList)) {
      return {ok: false, error: '业务校验失败，请回到网站人工检查',
              code: Number.isInteger(data.code) ? data.code : null};
    }
    // 只返回岗位信息，排除招聘者身份、精确坐标和 securityId。
    const stringFields = ['encryptJobId','jobName','brandName','salaryDesc','cityName',
      'areaDistrict','businessDistrict','jobExperience','jobDegree','brandIndustry',
      'brandScaleName','brandStageName'];
    const jobs = data.zpData.jobList.map(item => {
      const job = {};
      for (const key of stringFields) job[key] = typeof item[key] === 'string' ? item[key].slice(0, 2000) : '';
      // 1.0.1 补充公开展示的招聘称呼和职务；账号标识、头像及在线状态仍不导出。
      job.recruiterName = typeof item.bossName === 'string' ? item.bossName.trim().slice(0,200) : '';
      job.recruiterTitle = typeof item.bossTitle === 'string' ? item.bossTitle.trim().slice(0,200) : '';
      for (const key of ['skills','welfareList']) job[key] = Array.isArray(item[key])
        ? item[key].filter(value => typeof value === 'string').slice(0,50).map(value => value.slice(0,300)) : [];
      return job;
    });
    return {ok: true, jobs, hasMore: data.zpData.hasMore === true,
            totalCount: Number.isInteger(data.zpData.totalCount) ? data.zpData.totalCount : null};
  } catch (error) {
    return {ok: false, error: error?.name === 'AbortError' ? '网站请求超时，已停止' : '网站请求失败，已停止'};
  } finally {clearTimeout(timeout);}
}
