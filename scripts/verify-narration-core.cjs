const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const path=require('node:path');const crypto=require('node:crypto');
const root=path.resolve('work/narration-core-'+Date.now());
require('esbuild').buildSync({entryPoints:['electron/narrationService.ts'],bundle:true,platform:'node',format:'cjs',outfile:path.join(root,'service.cjs')});
const {NarrationService}=require(path.join(root,'service.cjs'));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn)=>{for(let n=0;n<200;n++){if(await fn())return;await delay(20);}throw new Error('Timed out');};
function wav(seconds=2.5){const b=Buffer.alloc(44+Math.round(16000*seconds)*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);for(let i=44;i<b.length;i+=2)b.writeInt16LE(Math.round(Math.sin(i/20)*1000),i);return b;}
class Engine {
 calls=[];held=true;pending=null;fail=false;failure=null;
 async synthesize(voice,text,output){this.calls.push(text);if(this.held)await new Promise((resolve,reject)=>{this.pending={resolve,reject};});this.pending=null;if(this.failure){const e=this.failure;this.failure=null;throw e;}if(this.fail){this.fail=false;throw new Error('Injected model error');}await fs.writeFile(output,wav(.3));}
 release(){this.pending?.resolve();}
 close(){this.pending?.reject(new Error('Cancelled'));this.pending=null;}
}
async function main(){
 const model=path.join(root,'models');const folder=path.join(model,'sherpa-onnx-zipvoice-distill-int8-zh-en-emilia');await fs.mkdir(folder,{recursive:true});
 for(const f of ['encoder.int8.onnx','decoder.int8.onnx','tokens.txt','lexicon.txt'])await fs.writeFile(path.join(folder,f),'test-model-'+f);
 await fs.writeFile(path.join(model,'vocos_24khz.onnx'),'vocoder');
 const recording=path.join(root,'reference.wav');await fs.writeFile(recording,wav());const original=await fs.readFile(recording);
 const engine=new Engine();let service=new NarrationService(path.join(root,'profile'),process.cwd(),()=>{},engine);await service.ready;
 await service.configure({modelRoot:model});
 const voice=await service.importReference('测试音色','这是测试录音。',recording);
 assert.deepEqual(await fs.readFile(recording),original,'original reference untouched');
 const book={bookId:'stable-reading-id',bookName:'测试书',format:'txt',contentHash:'a'.repeat(64),sections:[{section:0,location:'0',text:'第一句。第二句。第三句。第四句。第五句。'}],warnings:[]};
 const job=await service.createJob(book,voice.id);assert.equal(job.segments.length,5);
 await service.renameVoice(voice.id,'新名字');assert.equal((await service.createJob(book,voice.id)).id,job.id,'rename preserves cached edition');
 const other=await service.createJob({...book,contentHash:'b'.repeat(64)},voice.id);assert.notEqual(other.id,job.id,'same reading ID changed bytes has isolated cache');
 const secondVoice=await service.importReference('另一个音色','这是测试录音。',recording);
 const secondVoiceJob=await service.createJob(book,secondVoice.id);assert.notEqual(secondVoiceJob.id,job.id,'separately saved voices have isolated tasks even with identical recording');
 await service.control(secondVoiceJob.id,'delete');await service.deleteVoice(secondVoice.id);
 await service.control(job.id,'resume');await until(()=>engine.calls.length===1);assert.equal(engine.calls[0],'第一句。');
 await service.prioritize(job.id,3);engine.release();await until(()=>engine.calls.length===2);assert.equal(engine.calls[1],'第四句。','clicked sentence preempts background');
 await service.control(job.id,'pause');engine.release();await until(async()=>!(await service.state()).busy);
 let saved=await service.job(job.id);assert.equal(saved.status,'paused');assert.equal(saved.segments.filter(s=>s.state==='ready').length,2);
 assert.ok((await service.audio(job.id,3)).length>44,'partial output playable');
 await service.close();
 const restoredEngine=new Engine();restoredEngine.held=false;service=new NarrationService(path.join(root,'profile'),process.cwd(),()=>{},restoredEngine);await service.ready;
 saved=await service.job(job.id);assert.equal(saved.segments[3].state,'ready');assert.equal(saved.status,'paused','restart does not silently consume CPU');
 restoredEngine.fail=true;await service.control(job.id,'resume');await until(async()=>(await service.job(job.id)).status==='error');
 await service.control(job.id,'retry');await until(async()=>(await service.job(job.id)).status==='complete');
 assert.equal(restoredEngine.calls.filter(t=>t==='第一句。'||t==='第四句。').length,0,'resume does not regenerate completed clips');
 const audioFile=path.join(root,'profile','jobs',job.id,'2.wav');await fs.writeFile(audioFile,'broken');
 await assert.rejects(()=>service.audio(job.id,2),/缺失或损坏/);assert.equal((await service.job(job.id)).segments[2].state,'pending');
 await service.control(job.id,'resume');await until(async()=>(await service.job(job.id)).status==='complete');
 const diskJob=await service.createJob({...book,contentHash:'c'.repeat(64)},voice.id);
 restoredEngine.failure=Object.assign(new Error('No space left on device'),{code:'ENOSPC'});
 await service.control(diskJob.id,'resume');await until(async()=>!(await service.state()).busy);
 assert.equal((await service.job(diskJob.id)).status,'paused','disk errors pause generation');
 assert.equal((await service.job(diskJob.id)).segments[0].state,'pending','disk failure stays retryable');
 assert.ok((await service.audio(job.id,0)).length>44,'disk failure leaves existing audio usable');
 await service.control(diskJob.id,'resume');await until(async()=>(await service.job(diskJob.id)).status==='complete');await service.control(diskJob.id,'delete');
 await fs.writeFile(path.join(model,'vocos_24khz.onnx'),'changed-vocoder');
 await assert.rejects(()=>service.control(other.id,'resume'),/模型文件已变更/);
 const newVersion=await service.createJob(book,voice.id);assert.notEqual(newVersion.id,job.id,'new model creates an isolated audio edition');
 assert.ok((await service.audio(job.id,0)).length>44,'old edition stays playable after model change');
 await service.control(newVersion.id,'delete');
 const before=await service.audio(job.id,0);await service.deleteVoice(voice.id);assert.deepEqual(await service.audio(job.id,0),before,'deleting voice keeps cached playback');
 await assert.rejects(()=>fs.stat(voice.referenceFile),{code:'ENOENT'},'deleting voice removes only managed reference copy');assert.deepEqual(await fs.readFile(recording),original,'deletion preserves original recording');
 await assert.rejects(()=>service.control(other.id,'resume'),/音色不存在/);
 await service.control(other.id,'delete');assert.equal((await service.state()).jobs.length,1);
 await service.close();
 const report={ok:true,checks:['source unchanged','content isolation','voice task isolation','rename reuses audio','priority switch','pause retains partial audio','restart persistence','error retry','completed segments reused','corruption recovery','disk error pause and recovery','model version isolation','deleted voice retains audio','task cleanup'],root};
 await fs.writeFile(path.join(root,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
