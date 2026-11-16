const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const assert=require('node:assert/strict');
const t=require('./verify-narration-ui.cjs');const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const source=path.resolve(process.argv[2]);const previous=JSON.parse(fs.readFileSync(path.join(source,'results.json'),'utf8'));
 const original=JSON.parse(fs.readFileSync(path.join(source,'profile/narration/jobs',previous.jobId,'job.json'),'utf8'));
 const requestedSeconds=Number(process.env.NARRATION_CONTINUITY_SECONDS??1800);
 const rounds=Math.ceil(requestedSeconds/original.segments.reduce((n,s)=>n+s.duration,0));
 const lines=Array.from({length:rounds},()=>original.segments.map(s=>s.text)).flat();const text=lines.join('\n');
 const file=path.join(t.root,'连续播放测试.txt');fs.writeFileSync(file,text);
 const bookId=crypto.createHash('sha1').update(file+':'+Buffer.byteLength(text)).digest('hex');
 const contentHash=crypto.createHash('sha256').update(text).digest('hex');const id=crypto.createHash('sha256').update('continuity-'+Date.now()).digest('hex');
 const dir=path.join(t.root,'profile/narration/jobs',id);fs.mkdirSync(dir,{recursive:true});
 let offset=0;const segments=lines.map((line,i)=>{const s=original.segments[i%original.segments.length];fs.copyFileSync(path.join(source,'profile/narration/jobs',previous.jobId,s.id+'.wav'),path.join(dir,i+'.wav'));const result={...s,id:i,section:0,offset,end:offset+line.length,location:String(offset),text:line,state:'ready'};offset+=line.length+1;return result;});
 const job={...original,id,bookHash:contentHash,bookId,bookName:'连续播放测试',segments,status:'complete',priority:[]};fs.writeFileSync(path.join(dir,'job.json'),JSON.stringify(job));
 const store=JSON.parse(fs.readFileSync(path.join(source,'profile/ereader.json'),'utf8'));store.settings={...store.settings,narrationVoiceId:original.voice.id,narrationVoices:{},narrationClickToRead:true,ttsRate:1};store.recent=[];store.progress={};store.notes={};
 fs.writeFileSync(path.join(t.root,'profile/ereader.json'),JSON.stringify(store));
 const config=JSON.parse(fs.readFileSync(path.join(source,'profile/narration/settings.json'),'utf8'));config.runtime.pythonPath='C:\\missing-runtime.exe';fs.writeFileSync(path.join(t.root,'profile/narration/settings.json'),JSON.stringify(config));
 await t.launch();
 await t.evaluate(`(()=>{const connect=AudioBufferSourceNode.prototype.connect;const gains=new WeakMap();AudioBufferSourceNode.prototype.connect=function(target,...args){if(target instanceof AudioDestinationNode){let gain=gains.get(this.context);if(!gain){gain=this.context.createGain();gain.gain.value=0;gain.connect(target);gains.set(this.context,gain)}return connect.call(this,gain,...args)}return connect.call(this,target,...args)};window.__continuity=[];window.addEventListener('narration-playback-start',e=>window.__continuity.push({...e.detail,at:performance.now()}));})()`);
 await t.openFile(file);await t.waitFor(`document.querySelector('.reader-content')?.innerText.includes('春天')`);await delay(500);
 await t.clickText('朗读');
 if(process.env.NARRATION_BACKGROUND==='1'){await t.waitFor('window.__continuity.length>0');await t.minimize();}
 const start=Date.now();let last=-1;
 let completed=false;
 while(Date.now()-start<(requestedSeconds*1.5+60)*1000){
  await delay(5000);const progress=await t.evaluate(`({count:window.__continuity.length,text:document.querySelector('[data-narration-status]')?.textContent})`);
  if(progress.count!==last){last=progress.count;fs.writeFileSync(path.join(t.root,'continuity-progress.json'),JSON.stringify({elapsedSeconds:(Date.now()-start)/1000,total:segments.length,...progress}));}
  if(progress.text?.includes('本书已朗读完')){completed=true;break;}
  if(progress.text&&/失败|损坏|暂停/.test(progress.text))throw new Error(progress.text);
 }
 const rows=await t.evaluate('window.__continuity');assert.equal(rows.length,segments.length,'all segments played');
 const gaps=[];rows.forEach((r,i)=>{assert.equal(r.segment,i,'no repeats or missing segments');if(i)gaps.push(r.at-rows[i-1].at-rows[i-1].audioSeconds*1000);});
 const report={ok:completed&&Math.max(...gaps)<200,completed,mode:'real-time silent output; dispatch continuity, not acoustic quality',audioSeconds:segments.reduce((n,s)=>n+s.duration,0),elapsedSeconds:(Date.now()-start)/1000,segments:rows.length,maxGapMs:Math.max(...gaps),p95GapMs:gaps.slice().sort((a,b)=>a-b)[Math.floor(gaps.length*.95)],root:t.root};
 fs.writeFileSync(path.join(t.root,'continuity-results.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(t.root,'continuity-rows.json'),JSON.stringify(rows));console.log(report);
 assert.ok(completed,'completion state reached');assert.ok(report.maxGapMs<200,'no long artificial boundary gap');
}
main().catch(e=>{console.error(e);fs.writeFileSync(path.join(t.root,'continuity-failure.txt'),e.stack);process.exitCode=1;}).finally(t.shutdown);
