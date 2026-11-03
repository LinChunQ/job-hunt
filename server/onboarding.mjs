import path from 'node:path';

export function onboardingReport({profile,status,root}) {
  const hasItems=value=>Array.isArray(value) && value.some(x=>typeof x==='string' && x.trim());
  // 只返回资料是否齐全，不把简历事实、姓名、偏好或密钥放进初始化诊断。
  const checks={service:true,extensionConnected:status.connected===true,servicePaused:status.blocked===true,unresolvedTask:!!status.task,resumeFactsAvailable:hasItems(profile?.facts),keywordsConfigured:hasItems(profile?.preferences?.keywords),citiesConfigured:hasItems(profile?.preferences?.cities)};
  const nextActions=[];
  if (!checks.extensionConnected) nextActions.push('LOAD_EXTENSION_AND_PAIR');
  if (checks.unresolvedTask) nextActions.push('CHECK_EXISTING_TASK');
  if (checks.servicePaused) nextActions.push('MANUALLY_CHECK_SITE_AND_RESUME');
  if (!checks.resumeFactsAvailable) nextActions.push('PROVIDE_RESUME_OR_FACTS');
  if (!checks.keywordsConfigured || !checks.citiesConfigured) nextActions.push('CONFIRM_SEARCH_PREFERENCES');
  const ready=checks.extensionConnected && !checks.servicePaused && !checks.unresolvedTask && checks.resumeFactsAvailable && checks.keywordsConfigured && checks.citiesConfigured;
  return {ok:true,checks,nextActions,readyForConfiguredSearch:ready,loginVerified:false,siteRequestPerformed:false,scheduleCreated:false,extensionDirectory:path.join(root,'extension'),pairingCodeIncluded:false};
}
