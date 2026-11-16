const assert=require('node:assert/strict');const {spawn}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');const readline=require('node:readline');
const root=path.resolve('work/narration-ui-'+Date.now());fs.mkdirSync(root,{recursive:true});
const fixture=path.join(root,'朗读测试.txt');
const sentences=['春天的风很轻。','窗外阳光正好。','今天继续读书。','路上鸟儿鸣叫。','我们慢慢向前走。'];fs.writeFileSync(fixture,sentences.join('\n'));
const port=Number(process.env.NARRATION_TEST_PORT??19552);const delay=ms=>new Promise(r=>setTimeout(r,ms));let child,ws,id=0;const pending=new Map(),errors=[];
async function launch(){
 const env={...process.env,EREADER_REMOTE_DEBUGGING_PORT:String(port),EREADER_USER_DATA:path.join(root,'profile')};delete env.ELECTRON_RUN_AS_NODE;delete env.ELECTRON_RENDERER_URL;
 child=spawn(process.env.NARRATION_TEST_APP??path.resolve('node_modules/electron/dist/electron.exe'),process.env.NARRATION_TEST_APP?['--disable-gpu']:[path.resolve('.'),'--disable-gpu'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>fs.appendFileSync(path.join(root,'electron.log'),b));child.stderr.on('data',b=>fs.appendFileSync(path.join(root,'electron.log'),b));
 let target;for(let n=0;n<100;n++){try{target=(await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json())).find(t=>t.type==='page');if(target)break;}catch{}await delay(100);}assert.ok(target,'app starts');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??JSON.stringify(m.params));const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}};
 await send('Runtime.enable');await waitFor(`document.body?.innerText.includes('书架')`);
}
function send(method,params={}){return new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(new Error(method+' timed out'));},120000);pending.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}));});}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function waitFor(expression,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){if(await evaluate(`Promise.resolve(${expression}).then(Boolean)`))return;await delay(100);}throw new Error('Timed out '+expression);}
async function clickText(text){return evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing button ${text}');b.click();})()`);}
async function openFile(file){await evaluate(`(()=>{const event=new Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:{files:[{path:${JSON.stringify(file)}}]}});window.dispatchEvent(event);})()`);await waitFor(`document.querySelector('.reader-content')&&document.querySelector('[data-reader-toolbar]')`);}
async function measure(sentence,probe=true){
 await evaluate(`window.__starts=[];window.addEventListener('narration-playback-start',e=>window.__starts.push(e.detail),{once:true})`);
 const point=await evaluate(`(()=>{const root=document.querySelector('.reader-content'),w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){const i=n.textContent.indexOf(${JSON.stringify(sentence)});if(i>=0){const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+1);const b=r.getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2}}}throw Error('No text point')})()`);
 let processProbe,resultPromise;
 if(probe){
  processProbe=spawn(require('./narration-test-config.cjs').python(),['-X','utf8',path.resolve('scripts/audio/probe_once.py')],{windowsHide:true,stdio:['pipe','pipe','ignore']});
  let resolveReady,rejectReady;const ready=new Promise((r,j)=>{resolveReady=r;rejectReady=j;});
  resultPromise=new Promise((resolve,reject)=>{readline.createInterface({input:processProbe.stdout}).on('line',line=>{const r=JSON.parse(line);r.ready?resolveReady(r):resolve(r)});processProbe.once('error',e=>{rejectReady(e);reject(e);});processProbe.once('exit',code=>{if(code)reject(new Error('Audio detector exited '+code));});});
  const baseline=await ready;assert.equal(baseline.baseline,0,'quiet output before timing');
 }
 await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:point.x,y:point.y});await send('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
 const timestamp=Date.now()/1000;if(processProbe)processProbe.stdin.end(JSON.stringify({timestamp})+'\n');
 await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
 await waitFor('window.__starts.length>0');const started=await evaluate('window.__starts[0]');
 const result=probe?await resultPromise:{};
 await clickText('停止');await delay(350);
 return {sentence,...started,...result};
}
async function main(){
 await launch();
 const sample=require('./narration-test-config.cjs').reference();const voice=await evaluate(`window.api.narration.importReference('测试音色',${JSON.stringify(sample.text)},${JSON.stringify(sample.audio)})`);
 await evaluate(`window.api.loadSettings().then(s=>window.api.saveSettings({...s,narrationVoiceId:${JSON.stringify(voice.id)},narrationClickToRead:true,fontSize:36,clickPaging:true}))`);
 await evaluate('location.reload()').catch(()=>{});await delay(600);await waitFor(`document.body?.innerText.includes('书架')`);
 await openFile(fixture);await waitFor(`document.querySelector('.reader-content')?.innerText.includes('春天')`);
 await clickText('声音与听书');await clickText('生成整本书');
 await waitFor(`window.api.narration.state().then(s=>s.jobs.some(j=>j.ready>=1))`,120000);
 let state=await evaluate('window.api.narration.state()');const jobId=state.jobs[0].id;
 await evaluate(`window.api.narration.control(${JSON.stringify(jobId)},'pause')`);
 await waitFor(`window.api.narration.state().then(s=>!s.busy)`,120000);
 state=await evaluate('window.api.narration.state()');assert.ok(state.jobs[0].ready<state.jobs[0].total,'partially generated');
 await clickText('关闭');await delay(200);
 const latency=[];latency.push(await measure(sentences[0]));assert.equal(latency[0].segment,0);
 // A click on the final pending sentence should generate that sentence first.
 latency.push(await measure(sentences[4],false));assert.equal(latency[1].segment,4,'pending click targets correct segment');
 await evaluate(`window.api.narration.control(${JSON.stringify(jobId)},'resume')`);
 await waitFor(`window.api.narration.state().then(s=>s.jobs.find(j=>j.id===${JSON.stringify(jobId)}).status==='complete')`,120000);
 for(const index of [2,0,3]){const r=await measure(sentences[index]);assert.equal(r.segment,index);latency.push(r);}
 const picture=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,'reader.png'),Buffer.from(picture.data,'base64'));
 await clickText('声音与听书');const panel=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,'panel.png'),Buffer.from(panel.data,'base64'));await clickText('关闭');
 // Cached playback must work after process restart with the synthesis runtime unavailable.
 await evaluate(`window.api.narration.configure({pythonPath:'C:\\missing-python-for-offline-test.exe'})`);
 await evaluate('window.close()').catch(()=>{});await delay(600);ws.close();await launch();
 await openFile(fixture);await waitFor(`document.querySelector('.reader-content')?.innerText.includes('春天')`);await delay(300);
 const offline=await measure(sentences[1]);assert.equal(offline.segment,1);latency.push({...offline,offline:true});
 assert.equal((await evaluate('window.api.narration.state()')).ready,false,'model unavailable during cached playback');
 assert.equal(errors.length,0,errors.join('\n'));
 const report={ok:true,root,voiceId:voice.id,jobId,latency,errors};fs.writeFileSync(path.join(root,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
async function shutdown(){try{await Promise.race([evaluate('window.close()'),delay(1000)])}catch{}ws?.close();child?.kill();for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error('Test window closed'));}pending.clear();}
async function minimize(){const {execFile}=require('node:child_process');await new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-Command',`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class NarrationTestWindow { [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int n); }'; $p = Get-Process -Id ${child.pid}; [NarrationTestWindow]::ShowWindowAsync($p.MainWindowHandle, 6)`],{windowsHide:true},e=>e?reject(e):resolve()));}
module.exports={root,launch,evaluate,clickText,openFile,measure,waitFor,send,shutdown,minimize};
if(require.main===module)main().catch(e=>{console.error(e);fs.writeFileSync(path.join(root,'failure.txt'),e.stack+'\n'+errors.join('\n'));process.exitCode=1;}).finally(shutdown);
