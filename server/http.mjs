import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {Store} from './storage.mjs';
import {Engine} from './engine.mjs';
import {ROOT,RELEASE,writePrivate} from './runtime.mjs';
import {platforms} from './platforms.mjs';
const code=error=>/^[A-Z][A-Z0-9_]{0,79}$/.test(error?.message || '') ? error.message : 'LOCAL_OPERATION_FAILED';
export async function createService({dir,port=18674,now,cooldown}={}) {
  const store=new Store(dir), engine=new Engine(store,{version:RELEASE.version,now,cooldown});
  const file=path.join(dir,'bridge.json');
  let previous;try {previous=JSON.parse(fs.readFileSync(file,'utf8'));} catch {}
  const key=/^[a-f0-9]{64}$/.test(previous?.key || '') ? previous.key : randomBytes(32).toString('hex');
  let actualPort,timer;
  const server=http.createServer(async(req,res)=>{
    const reply=(status,value,type='application/json')=>{
      const payload=type==='application/json' ? JSON.stringify(value) : value;
      res.writeHead(status,{'content-type':type+'; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'",'referrer-policy':'no-referrer'});res.end(payload);
    };
    if (req.headers.host!=='127.0.0.1:'+actualPort || !['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return reply(403,{ok:false,errorCode:'HOST_REJECTED'});
    const route=req.url;
    if (req.method==='GET' && ['/', '/app.js','/app.css'].includes(route)) {
      const name=route==='/' ? 'index.html' : route.slice(1);
      return reply(200,fs.readFileSync(path.join(ROOT,'web',name),'utf8'),name.endsWith('.html') ? 'text/html' : name.endsWith('.css') ? 'text/css' : 'text/javascript');
    };
    if (req.method!=='POST') return reply(405,{ok:false,errorCode:'POST_REQUIRED'});
    const origin=req.headers.origin;
    const extension=typeof origin==='string' && /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
    // Origin 与本机密钥双重检查；不允许招聘网页调用本机管理接口。
    if ((route.startsWith('/extension/') && !extension) || (route.startsWith('/cli/') && origin && origin!=='http://127.0.0.1:'+actualPort) || (origin && !extension && origin!=='http://127.0.0.1:'+actualPort)) return reply(403,{ok:false,errorCode:'ORIGIN_REJECTED'});
    const supplied=Buffer.from(req.headers.authorization || ''),expected=Buffer.from('Bearer '+key);
    if (supplied.length!==expected.length || !timingSafeEqual(supplied,expected)) return reply(401,{ok:false,errorCode:'PAIRING_REJECTED'});
    if (!(req.headers['content-type'] || '').startsWith('application/json')) return reply(415,{ok:false,errorCode:'JSON_REQUIRED'});
    try {
      const chunks=[];let length=0;
      for await (const chunk of req) {length+=chunk.length;if (length>1000000) throw new Error('REQUEST_TOO_LARGE');chunks.push(chunk);}
      let body;try {body=JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {throw new Error('INVALID_JSON');}
      if (!body || typeof body!=='object' || Array.isArray(body)) throw new Error('OBJECT_REQUIRED');
      let value;
      if (['/cli/status','/extension/status'].includes(route)) value=engine.status();
      else if (route==='/extension/hello') {if (body.resume!==true) throw new Error('EXPLICIT_RESUME_REQUIRED');value=engine.resume();}
      else if (route==='/extension/disconnect') value=engine.disconnect();
      else if (route==='/extension/next') value=engine.claim();
      else if (route==='/extension/result') value=engine.complete(body);
      else if (route==='/cli/profile/get') value={ok:true,profile:store.profile()};
      else if (route==='/cli/profile/put') value=store.profile(body);
      else if (route==='/cli/platforms') value={ok:true,platforms};
      else if (route==='/cli/tasks/enqueue') value=engine.enqueue(body);
      else if (route==='/cli/tasks/resolve') value=engine.resolve(body);
      else if (route==='/cli/runs') value={ok:true,runs:store.runs().slice(0,100)};
      else if (route==='/cli/jobs') value={ok:true,jobs:store.jobs()};
      else if (route==='/cli/pending') value={ok:true,jobs:store.pending(),siteRequestPerformed:false};
      else if (route==='/cli/reviews/apply') value=store.reviews(body);
      else if (route==='/cli/schedules/list') value={ok:true,schedules:store.schedules()};
      else if (route==='/cli/schedules/put') value=engine.putSchedule(body);
      else if (['/cli/drafts/list','/extension/drafts/list'].includes(route)) value=store.listDrafts();
      else if (route==='/cli/drafts/update') value=store.draftAction('update',body);
      else if (route.startsWith('/extension/drafts/') && ['update','reserve','result','report-sent'].includes(route.split('/').at(-1))) {
        const action=route.split('/').at(-1);
        if (action==='reserve' && (engine.status().blocked || engine.status().task)) throw new Error('SERVICE_PAUSED_OR_BUSY');
        value=store.draftAction(action,body);
      } else if (route==='/cli/stop') {reply(200,{ok:true,stopping:true});setImmediate(()=>server.close());return;}
      else return reply(404,{ok:false,errorCode:'ROUTE_NOT_FOUND'});
      reply(200,value);
    } catch(error) {reply(400,{ok:false,errorCode:code(error)});}
  });
  server.requestTimeout=20000;server.headersTimeout=10000;
  try {await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}
  catch(error) {store.close();throw error;}
  actualPort=server.address().port;writePrivate(file,{key,port:actualPort,pid:process.pid,version:RELEASE.version});
  timer=setInterval(()=>{try {engine.tick();} catch {store.setMeta('blocked',true);}},1000);
  server.on('close',()=>{clearInterval(timer);store.close();});
  return {server,store,engine,key,port:actualPort,close:()=>new Promise(resolve=>server.close(resolve))};
}
