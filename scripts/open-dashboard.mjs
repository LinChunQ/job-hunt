import {spawn} from 'node:child_process';
export async function openDashboard(url,{platform=process.platform,launcher=spawn}={}) {
  // 仅交给系统默认浏览器打开本机工作台，不创建自动化浏览器、不附加调试参数。
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/#launch=[a-f0-9]{64}$/.test(url)) throw new Error('INVALID_DASHBOARD_URL');
  const command=platform==='win32' ? 'powershell.exe' : platform==='darwin' ? 'open' : 'xdg-open';
  const args=platform==='win32' ? ['-NoProfile','-NonInteractive','-Command',"Start-Process -FilePath '"+url+"'"] : [url];
  return new Promise(resolve=>{
    const child=launcher(command,args,{windowsHide:true,stdio:'ignore'});
    const timeout=setTimeout(()=>{child.kill();resolve(false);},10000);
    child.once('error',()=>{clearTimeout(timeout);resolve(false);});
    child.once('exit',exit=>{clearTimeout(timeout);resolve(exit===0);});
  });
}
