const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const t=require('./verify-narration-ui.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const source=path.resolve(process.argv[2]);
async function selectVoice(value){await t.evaluate(`(()=>{const s=document.querySelector('#narration-voice');s.value=${JSON.stringify(value)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);await delay(150);}
async function setRate(value){await t.evaluate(`(()=>{const s=document.querySelector('[aria-label="播放速度"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(s,'${value}');s.dispatchEvent(new Event('input',{bubbles:true}));s.dispatchEvent(new Event('change',{bubbles:true}));})()`);await delay(100);}
async function main(){
 const previous=JSON.parse(fs.readFileSync(path.join(source,'results.json'),'utf8'));
 const profile=path.join(t.root,'profile');fs.mkdirSync(profile,{recursive:true});
 fs.cpSync(path.join(source,'profile/narration'),path.join(profile,'narration'),{recursive:true});
 const settingsFile=path.join(profile,'narration/settings.json');
 const config=JSON.parse(fs.readFileSync(settingsFile,'utf8'));
 const second={...config.voices[0],id:crypto.randomUUID(),name:'第二个测试音色'};config.voices.push(second);
 fs.writeFileSync(settingsFile,JSON.stringify(config));
 const originalDir=path.join(profile,'narration/jobs',previous.jobId);
 const fixture=path.join(t.root,'朗读测试.txt');
 const bookId=crypto.createHash('sha1').update(fixture+':'+fs.statSync(fixture).size).digest('hex');
 const original=JSON.parse(fs.readFileSync(path.join(originalDir,'job.json'),'utf8'));original.bookId=bookId;fs.writeFileSync(path.join(originalDir,'job.json'),JSON.stringify(original));
 const secondJob=crypto.createHash('sha256').update('second-voice-controls').digest('hex');
 const secondDir=path.join(profile,'narration/jobs',secondJob);fs.cpSync(originalDir,secondDir,{recursive:true});
 const j=JSON.parse(fs.readFileSync(path.join(secondDir,'job.json'),'utf8'));j.id=secondJob;j.voice=second;fs.writeFileSync(path.join(secondDir,'job.json'),JSON.stringify(j));
 const store=JSON.parse(fs.readFileSync(path.join(source,'profile/ereader.json'),'utf8'));
 store.settings={...store.settings,narrationVoiceId:previous.voiceId,narrationVoices:{},ttsRate:1.5,narrationClickToRead:true};store.progress={};store.bookSettings={};
 fs.writeFileSync(path.join(profile,'ereader.json'),JSON.stringify(store));
 await t.launch();
 await t.evaluate(`window.__starts=[];window.__media=null;window.__errors=[];window.addEventListener('error',e=>window.__errors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason)));window.addEventListener('narration-playback-start',e=>window.__starts.push(e.detail));const nativePlay=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(...args){window.__media=this;return nativePlay.apply(this,args)};`);
 await t.openFile(fixture);await t.waitFor(`document.querySelector('.reader-content')?.innerText.includes('春天')`);
 await t.clickText('朗读');await t.waitFor('window.__starts.length>0');
 assert.deepEqual(await t.evaluate('({rate:window.__media.playbackRate,pitch:window.__media.preservesPitch})'),{rate:1.5,pitch:true});
 await t.clickText('⏸ 朗读');const pausedAt=await t.evaluate('window.__media.currentTime');await delay(550);
 assert.equal(await t.evaluate('window.__media.paused'),true);assert.ok(Math.abs(await t.evaluate('window.__media.currentTime')-pausedAt)<.04,'pause holds position');
 await t.clickText('▶ 继续');await t.waitFor('window.__starts.length>=2');assert.equal((await t.evaluate('window.__starts[1]')).segment,1,'resume continues to next sentence');await t.clickText('停止');
 await t.clickText('声音与听书');await setRate(1);await t.clickText('关闭');
 await t.waitFor(`window.api.loadSettings().then(s=>s.ttsRate===1)`);
 const cached=await t.measure('春天的风很轻。');assert.equal(cached.segment,0);
 // Selecting another task must switch voices and wait for React's reset before playing it.
 await t.clickText('声音与听书');await t.evaluate('window.__starts=[]');
 await t.evaluate(`document.querySelector('[data-narration-job="${secondJob}"]').querySelectorAll('button').forEach(b=>{if(b.textContent==='播放已生成')b.click()})`);
 await t.waitFor('window.__starts.length>0');assert.equal((await t.evaluate('window.__starts[0]')).jobId,secondJob);
 assert.equal(await t.evaluate(`document.querySelector('#narration-voice').value`),second.id);
 await t.clickText('停止朗读');
 await selectVoice('');await t.clickText('关闭');const count=await t.evaluate('window.__starts.length');await delay(500);assert.equal(await t.evaluate('window.__starts.length'),count,'switching voice leaves old playback stopped');
 await t.clickText('声音与听书');await selectVoice(previous.voiceId);await setRate(.8);await t.clickText('关闭');
 await t.clickText('朗读');await t.waitFor('window.__media&&!window.__media.paused&&window.__media.playbackRate===.8');
 assert.equal(await t.evaluate('window.__media.preservesPitch'),true);await t.clickText('停止');
 // Same path and byte size retain the reader ID, but must not permit stale saved audio.
 fs.writeFileSync(fixture,fs.readFileSync(fixture,'utf8').replace('春天','秋天'));
 await t.openFile(fixture);await t.waitFor(`document.querySelector('.reader-content')?.innerText.includes('秋天')`);
 await t.clickText('声音与听书');await t.evaluate('window.__starts=[]');
 await t.evaluate(`document.querySelector('[data-narration-job="${previous.jobId}"]').querySelectorAll('button').forEach(b=>{if(b.textContent==='播放已生成')b.click()})`);
 await t.waitFor(`document.querySelector('[data-narration-panel]')?.innerText.includes('旧版本')`);assert.equal(await t.evaluate('window.__starts.length'),0,'old audio cannot play against edited book');
 await t.clickText('关闭');fs.writeFileSync(fixture,fs.readFileSync(fixture,'utf8').replace('秋天','春天'));await t.openFile(fixture);await t.waitFor(`document.querySelector('.reader-content')?.innerText.includes('春天')`);
 await t.evaluate(`window.api.narration.deleteVoice(${JSON.stringify(previous.voiceId)})`);await delay(200);
 await t.clickText('声音与听书');assert.equal(await t.evaluate('document.querySelector("[data-generate-book]").disabled'),true,'removed voice cannot start generation');
 assert.ok(await t.evaluate(`document.querySelector('#narration-voice').selectedOptions[0].textContent.includes('已保存音频')`),'removed voice remains selectable for cached book');
 await t.clickText('关闭');assert.equal((await t.measure('春天的风很轻。',false)).segment,0,'deleted voice cache still plays');
 await t.clickText('← 首页');await t.clickText('声音与听书');assert.equal(await t.evaluate(`document.querySelector('#narration-voice').value`),'','deleted default falls back to system voice');
 const errors=await t.evaluate('window.__errors');assert.deepEqual(errors,[]);
 const report={ok:true,checks:['1.5x preserves pitch','pause retains position','resume continues','1x cached click measured','cross-voice cached task selection','voice switch stops playback','.8x preserves pitch','same-size book edit rejects stale saved audio','deleted voice retains cached playback','deleted default falls back to system voice','no renderer errors'],cached,root:t.root};
 fs.writeFileSync(path.join(t.root,'controls-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e);fs.writeFileSync(path.join(t.root,'controls-failure.txt'),e.stack);process.exitCode=1;}).finally(t.shutdown);
