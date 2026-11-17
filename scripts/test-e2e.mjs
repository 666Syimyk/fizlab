import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if(!fs.existsSync('dist/client/index.html')) throw new Error('Run npm run build before npm run test:e2e.');
const tempRoot=fs.realpathSync(os.tmpdir());
const temp=fs.mkdtempSync(path.join(tempRoot,'fizlab-e2e-'));
const server=spawn(process.execPath,['scripts/serve-site.mjs'],{env:{...process.env,PORT:'0',FIZLAB_DB_PATH:path.join(temp,'test.sqlite'),FIZLAB_SERVER_ENV_FILE:'',AUTH_EMAIL_ENABLED:'0',RESEND_API_KEY:'',REVENUECAT_SECRET_API_KEY:''},stdio:['ignore','pipe','inherit']});
try {
  const base=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Test server did not start')),15000);
    server.once('error',error=>{clearTimeout(timeout);reject(error);});
    server.once('exit',code=>{clearTimeout(timeout);reject(new Error(`Test server exited: ${code}`));});
    server.stdout.on('data',chunk=>{const match=String(chunk).match(/SITE (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});
  });
  for(const script of ['scripts/smoke.mjs','scripts/test-ui-failures.mjs','scripts/test-ui-account.mjs','scripts/test-auth-flows.mjs']) {
    const code=await new Promise((resolve,reject)=>{
      const child=spawn(process.execPath,[script],{env:{...process.env,SMOKE_URL:base},stdio:'inherit'});
      child.once('error',reject);child.once('exit',resolve);
    });
    if(code!==0) throw new Error(`${script} exited with ${code}`);
  }
} finally {
  if(server.exitCode===null && server.signalCode===null) {
    const exited=new Promise(resolve=>server.once('exit',resolve));
    server.kill();
    await exited;
  }
  // Only the OS-created, task-owned temporary directory is removed.
  const resolved=fs.realpathSync(temp);
  if(path.dirname(resolved)===tempRoot && path.basename(resolved).startsWith('fizlab-e2e-')) {
    fs.rmSync(resolved,{recursive:true,force:true});
  } else {
    console.error('Skipped cleanup: test directory resolved outside its temporary parent.');
    process.exitCode=1;
  }
}
