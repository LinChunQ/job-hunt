import {setTimeout as delay} from 'node:timers/promises';

export async function waitForProcessExit(pid,timeout=10000) {
  if (!pid) return;
  const deadline=Date.now()+timeout;
  // Windows 终止进程是异步的，必须等句柄和工作目录释放后才能删除临时安装包。
  while (true) {
    try {process.kill(pid,0);} catch(error) {if (error.code==='ESRCH') return;throw error;}
    if (Date.now()>=deadline) throw new Error('TEST_SERVICE_EXIT_TIMEOUT');
    await delay(100);
  }
}

export async function terminateTestService(pid) {
  if (!pid) return;
  try {process.kill(pid);} catch(error) {if (error.code==='ESRCH') return;throw error;}
  await waitForProcessExit(pid);
}
