import {RELEASE} from './runtime.mjs';
export async function checkUpdate({fetcher=fetch,release=RELEASE}={}) {
  if (!release.githubRepository) return {ok:true,configured:false,currentVersion:release.version,automaticInstall:false,reason:'GITHUB_REPOSITORY_NOT_CONFIGURED'};
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(release.githubRepository)) throw new Error('INVALID_UPDATE_REPOSITORY');
  // 更新检查只发送版本查询，不发送配置、简历、岗位、配对码或数据库。
  const response=await fetcher('https://api.github.com/repos/'+release.githubRepository+'/releases/latest',{headers:{accept:'application/vnd.github+json','user-agent':'job-hunt-update'},signal:AbortSignal.timeout(10000),redirect:'error'});
  if (!response.ok) throw new Error('UPDATE_CHECK_FAILED');
  const text=await response.text();if (text.length>200000) throw new Error('UPDATE_RESPONSE_TOO_LARGE');
  const data=JSON.parse(text), version=String(data.tag_name || '').replace(/^v/,'');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('INVALID_RELEASE_VERSION');
  const compare=(a,b)=>{const left=a.split('.').map(Number),right=b.split('.').map(Number);for(let i=0;i<3;i++)if(left[i]!==right[i])return left[i]-right[i];return 0;};
  return {ok:true,configured:true,currentVersion:release.version,latestVersion:version,updateAvailable:compare(version,release.version)>0,automaticInstall:false,reason:'SIGNED_INSTALLER_NOT_IMPLEMENTED'};
}
