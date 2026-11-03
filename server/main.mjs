import {createService} from './http.mjs';
import {runtimeDir,DEFAULT_PORT} from './runtime.mjs';
const args=process.argv.slice(2);
const option=name=>args.includes(name) ? args[args.indexOf(name)+1] : undefined;
try {
  const service=await createService({dir:runtimeDir(option('--state-dir')),port:Number(option('--port') || DEFAULT_PORT)});
  // 日志只记录启动状态，不打印配对码、请求正文、简历或网页响应。
  console.log(JSON.stringify({running:true,port:service.port}));
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>void service.close());
} catch {console.error(JSON.stringify({ok:false,errorCode:'SERVICE_START_FAILED'}));process.exitCode=1;}
