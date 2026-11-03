// 仅复用用户正常点击时已观察到的 GET 地址，不读取 Cookie 或生成关联参数。
export async function fetchObservedDetailInPage(observedUrl) {
  const failed = (errorCode, code = null, schema = null) => ({ok: false, errorCode, code, schema});
  let url;
  try {url = new URL(observedUrl);} catch (_) {return failed('INVALID_DETAIL_URL');}
  if (location.origin !== 'https://www.zhipin.com' || url.origin !== location.origin || url.pathname !== '/wapi/zpgeek/job/detail.json') return failed('WRONG_DETAIL_ORIGIN');
  if (!url.searchParams.get('securityId') || !url.searchParams.get('lid') || [...url.searchParams.keys()].some(key => !['_','lid','securityId'].includes(key))) return failed('UNEXPECTED_DETAIL_PARAMETERS');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(url.href, {method: 'GET', credentials: 'same-origin', redirect: 'error',
      headers: {'Accept': 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest'}, signal: controller.signal});
    if (!response.ok) return failed('DETAIL_HTTP_' + response.status);
    if (!(response.headers.get('content-type') || '').includes('application/json')) return failed('DETAIL_NOT_JSON');
    const data = await response.json();
    if (data?.code !== 0) return failed('DETAIL_BUSINESS_ERROR', Number.isInteger(data?.code) ? data.code : null);
    const body = data.zpData;
    const info = body?.jobInfo;
    // 字段名用于诊断响应结构；绝不回传招聘者信息、原始响应或 securityId。
    // 1.0.1 仅新增公开称呼和职务的白名单字段，其他招聘者资料仍按原限制排除。
    const keys = value => value && typeof value === 'object' && !Array.isArray(value)
      ? Object.keys(value).filter(key => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)).slice(0,100) : [];
    const schema = {zpDataKeys: keys(body), jobInfoKeys: keys(info)};
    if (typeof info?.postDescription !== 'string' || !info.postDescription.trim()) return failed('DETAIL_SCHEMA_UNCONFIRMED', null, schema);
    if (info.postDescription.length > 30000) return failed('DETAIL_TOO_LONG', null, schema);
    const jobId = typeof info.encryptJobId === 'string' ? info.encryptJobId : typeof info.encryptId === 'string' ? info.encryptId : null;
    return {ok: true, detail: {schemaVersion: 1, source: 'observed-detail-get',
      capturedAt: new Date().toISOString(), jobId: jobId?.slice(0,200) || null,
      jobName: typeof info.jobName === 'string' ? info.jobName.slice(0,200) : null,
      brandName: typeof body.brandComInfo?.brandName === 'string' ? body.brandComInfo.brandName.slice(0,2000) : '',
      salaryDesc: typeof info.salaryDesc === 'string' ? info.salaryDesc.slice(0,2000) : '',
      recruiterName: typeof body.bossInfo?.name === 'string' ? body.bossInfo.name.trim().slice(0,200) : '',
      recruiterTitle: typeof body.bossInfo?.title === 'string' ? body.bossInfo.title.trim().slice(0,200) : '',
      description: info.postDescription, characterCount: info.postDescription.length,
      descriptionField: 'zpData.jobInfo.postDescription', listAssociationVerified: false,
      completenessVerified: false, siteRequestPerformed: true}, schema};
  } catch (error) {return failed(error?.name === 'AbortError' ? 'DETAIL_TIMEOUT' : 'DETAIL_NETWORK_ERROR');}
  finally {clearTimeout(timeout);}
}
