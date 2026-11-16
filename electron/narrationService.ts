import { promises as fs, createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { NarrationBookInput, NarrationJob, NarrationJobSummary, NarrationRuntime, NarrationState, PreviewResult, VoiceProfile } from '../shared/narration';
import { sentenceSlices } from '../shared/narration';
import { detectNarrationRuntime, NarrationEngine, runtimeReady, runCommand, SYNTHESIS_VERSION, wavInfo, type SpeechEngine } from './narrationEngine';

const hash = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex');
const copy = <T>(value:T):T => JSON.parse(JSON.stringify(value));
const errorText = (e:unknown) => e instanceof Error ? e.message : String(e);
interface PreviewTask { voice:VoiceProfile; text:string; resolve:(r:PreviewResult)=>void; reject:(e:Error)=>void }

export class NarrationService {
  readonly ready: Promise<void>;
  private runtime!:NarrationRuntime;
  private voices:VoiceProfile[]=[];
  private jobs=new Map<string,NarrationJob>();
  private previews:PreviewTask[]=[];
  private working=false;
  private closed=false;
  private message='';
  private writes:Promise<void>=Promise.resolve();
  private engine:SpeechEngine;
  constructor(private root:string, base:string, private notify:()=>void=()=>{}, engine?:SpeechEngine) {
    this.engine=engine??new NarrationEngine(()=>this.runtime);
    this.ready=this.initialize(base);
  }
  private async initialize(base:string) {
    await fs.mkdir(path.join(this.root,'jobs'),{recursive:true});
    await fs.mkdir(path.join(this.root,'voices'),{recursive:true});
    this.runtime=await detectNarrationRuntime(base);
    try {
      const saved=JSON.parse(await fs.readFile(path.join(this.root,'settings.json'),'utf8'));
      this.runtime={...this.runtime,...saved.runtime};
      this.voices=Array.isArray(saved.voices)?saved.voices.filter((v:VoiceProfile)=>v.engine==='zipvoice'&&typeof v.id==='string'&&typeof v.referenceFile==='string'):[];
    } catch(e:any) { if(e.code!=='ENOENT')this.message='声音设置无法读取，已保留原文件；请重新选择音色。'; }
    for(const id of await fs.readdir(path.join(this.root,'jobs'))) {
      if(!/^[a-f0-9]{64}$/.test(id))continue;
      try {
        const j:NarrationJob=JSON.parse(await fs.readFile(this.jobPath(id),'utf8'));
        if(j.id!==id||!Array.isArray(j.segments)||!j.voice)continue;
        if(j.segments.some((s,i)=>s.id!==i||typeof s.text!=='string'))continue;
        j.priority=[];delete j.activeSegment;
        if(j.status==='generating'||j.status==='queued')j.status='paused';
        for(const s of j.segments)if(s.state==='ready') {
          const stat=await fs.stat(this.audioPath(j.id,s.id)).catch(()=>null);
          if(!stat||stat.size<44||(s.bytes&&stat.size!==s.bytes)) { s.state='pending';delete s.duration;delete s.bytes;j.status='paused'; }
        }
        this.jobs.set(id,j);
      } catch { this.message='有一份朗读任务记录损坏，已保留文件，其他任务可继续使用。'; }
    }
  }
  private jobPath(id:string) { return path.join(this.root,'jobs',id,'job.json'); }
  private audioPath(id:string,segment:number) { return path.join(this.root,'jobs',id,`${segment}.wav`); }
  private atomic(file:string,value:unknown):Promise<void> {
    const bytes=JSON.stringify(value);
    const write=async()=>{await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+crypto.randomUUID()+'.tmp';try {await fs.writeFile(temp,bytes);await fs.rename(temp,file);} finally {await fs.unlink(temp).catch(()=>{});} };
    const next=this.writes.then(write,write);this.writes=next.catch(()=>{});return next;
  }
  private persistJob(j:NarrationJob) { return this.atomic(this.jobPath(j.id),j); }
  private persistSettings() { return this.atomic(path.join(this.root,'settings.json'),{runtime:this.runtime,voices:this.voices}); }
  private changed(){this.notify();}
  private getJob(id:string) { const j=this.jobs.get(id);if(!j)throw new Error('朗读任务不存在');return j; }
  private getVoice(id:string) {const v=this.voices.find(v=>v.id===id);if(!v)throw new Error('音色不存在或已删除');return v;}
  private summary(j:NarrationJob):NarrationJobSummary {
    const {segments,priority,...rest}=j;
    return {...rest,total:segments.length,ready:segments.filter(s=>s.state==='ready').length,failed:segments.filter(s=>s.state==='failed').length,audioSeconds:segments.reduce((a,s)=>a+(s.duration??0),0),bytes:segments.reduce((a,s)=>a+(s.bytes??0),0)};
  }
  async state():Promise<NarrationState> {await this.ready;return copy({voices:this.voices,jobs:[...this.jobs.values()].map(j=>this.summary(j)),runtime:this.runtime,ready:runtimeReady(this.runtime),busy:this.working,message:this.message});}
  async configure(patch:Partial<NarrationRuntime>) {
    await this.ready;if(this.working)throw new Error('请先暂停生成并等当前句子完成，再修改环境');
    const allowed=['pythonPath','dependencyPath','modelRoot','ffmpegPath'] as const;
    for(const key of allowed)if(typeof patch[key]==='string')this.runtime[key]=patch[key]!;
    this.engine.close();await this.persistSettings();this.changed();return this.state();
  }
  async importReference(name:string,text:string,input:string):Promise<VoiceProfile> {
    await this.ready;name=name.trim();text=text.trim();
    if(!name||name.length>80||!text||text.length>3000)throw new Error('请填写音色名称和录音对应的文字');
    if(!path.isAbsolute(input)||!(await fs.stat(input)).isFile())throw new Error('请选择本地录音文件');
    if(!this.runtime.ffmpegPath)throw new Error('音频转换工具尚未配置');
    const id=crypto.randomUUID(), dest=path.join(this.root,'voices',id+'.wav');
    try {
      await runCommand(this.runtime.ffmpegPath,['-nostdin','-v','error','-protocol_whitelist','file','-i',input,'-vn','-ac','1','-ar','24000','-t','61','-c:a','pcm_s16le',dest]);
      const bytes=await fs.readFile(dest), info=wavInfo(bytes);
      if(info.duration<2||info.duration>60)throw new Error('请使用 2～60 秒的单人录音，建议 5～20 秒');
      const v:VoiceProfile={id,name,engine:'zipvoice',model:SYNTHESIS_VERSION,referenceFile:dest,referenceText:text,fingerprint:hash(Buffer.concat([bytes,Buffer.from(text)])),createdAt:Date.now()};
      this.voices.push(v);await this.persistSettings();this.changed();return copy(v);
    } catch(e) {await fs.unlink(dest).catch(()=>{});throw e;}
  }
  async renameVoice(id:string,name:string){await this.ready;name=name.trim();if(!name||name.length>80)throw new Error('名称应为 1～80 个字符');this.getVoice(id).name=name;for(const j of this.jobs.values())if(j.voice.id===id){j.voice.name=name;await this.persistJob(j);}await this.persistSettings();this.changed();}
  async deleteVoice(id:string) {
    await this.ready;const voice=this.getVoice(id);this.voices=this.voices.filter(v=>v.id!==id);
    for(const j of this.jobs.values())if(j.voice.id===id&&j.status!=='complete'){j.status='paused';j.priority=[];await this.persistJob(j);}
    // Cached book audio is independent of the reference recording. Never delete an external source.
    await this.persistSettings();
    const file=path.resolve(this.root,'voices',id+'.wav');
    try {if(path.dirname(file)===path.resolve(this.root,'voices')&&path.resolve(voice.referenceFile)===file)await fs.unlink(file);}
    catch(e:any){if(e.code!=='ENOENT'){this.message='音色已移除，但其本地录音副本未能清理';}}
    this.changed();
  }
  async referenceAudio(id:string){await this.ready;return new Uint8Array(await fs.readFile(this.getVoice(id).referenceFile));}
  async preview(id:string,text:string):Promise<PreviewResult> {
    await this.ready;text=text.trim();if(!text||text.length>400)throw new Error('试听文字应为 1～400 个字符');
    const voice=copy(this.getVoice(id));
    return new Promise((resolve,reject)=>{this.previews.push({voice,text,resolve,reject});void this.pump();});
  }
  private async modelHash():Promise<string> {
    const h=crypto.createHash('sha256').update(SYNTHESIS_VERSION);
    const files=['vocos_24khz.onnx',...['encoder.int8.onnx','decoder.int8.onnx','tokens.txt','lexicon.txt'].map(f=>'sherpa-onnx-zipvoice-distill-int8-zh-en-emilia/'+f)];
    if(existsSync(path.join(this.runtime.modelRoot,'lexicon-en-us.txt')))files.push('lexicon-en-us.txt');
    for(const file of files) {
      h.update(file);
      for await(const chunk of createReadStream(path.join(this.runtime.modelRoot,file)))h.update(chunk as Buffer);
    }
    return h.digest('hex');
  }
  async createJob(book:NarrationBookInput,voiceId:string):Promise<NarrationJob> {
    await this.ready;const voice=copy(this.getVoice(voiceId));
    if(!/^[a-f0-9]{64}$/i.test(book.contentHash)||!Array.isArray(book.sections)||!book.sections.length)throw new Error('没有可朗读的文字');
    const synthesisKey=await this.modelHash();
    const id=hash(JSON.stringify([book.contentHash,book.format,book.sections,voice.id,voice.fingerprint,synthesisKey,'index-v3']));
    const existing=this.jobs.get(id);if(existing)return copy(existing);
    const segments:NarrationJob['segments']=[];
    for(const section of book.sections) {
      if(!Number.isInteger(section.section)||section.section<0||typeof section.text!=='string')throw new Error('章节索引无效');
      for(const s of sentenceSlices(section.text))segments.push({id:segments.length,section:section.section,offset:s.start,end:s.end,text:s.text,location:book.format==='txt'?String(s.start):section.location,state:'pending'});
    }
    if(!segments.length)throw new Error('书中没有可提取的文字，扫描图片需要先转成文字');
    const j:NarrationJob={id,synthesisKey,bookHash:book.contentHash,bookId:book.bookId,bookName:book.bookName,format:book.format,voice,createdAt:Date.now(),status:'paused',segments,warnings:book.warnings??[],priority:[],elapsedMs:0};
    await this.persistJob(j);this.jobs.set(id,j);this.changed();return copy(j);
  }
  async job(id:string){await this.ready;return copy(this.getJob(id));}
  async control(id:string,action:'resume'|'pause'|'retry'|'delete') {
    await this.ready;const j=this.getJob(id);
    if(action==='delete') {
      this.jobs.delete(id);if(j.activeSegment!==undefined)this.engine.close();await this.writes;
      const target=path.resolve(this.root,'jobs',id), parent=path.resolve(this.root,'jobs');
      if(!/^[a-f0-9]{64}$/.test(id)||path.dirname(target)!==parent)throw new Error('任务路径无效');
      try {await fs.rm(target,{recursive:true,force:true,maxRetries:4,retryDelay:100});}
      catch(e){j.status='paused';j.error='清理失败，请稍后重试';this.jobs.set(id,j);this.changed();throw e;}
      this.changed();return;
    }
    if(action==='pause'){j.status='paused';j.priority=[];}
    else {
      this.getVoice(j.voice.id);
      if(j.segments.some(s=>s.state!=='ready')&&j.synthesisKey!==await this.modelHash())throw new Error('模型文件已变更，请重新创建该音色的生成任务，原音频仍可播放');
      if(action==='retry')for(const s of j.segments)if(s.state==='failed'){s.state='pending';delete s.error;}
      delete j.error;j.status=j.segments.every(s=>s.state==='ready')?'complete':'queued';
    }
    await this.persistJob(j);this.changed();void this.pump();
  }
  async prioritize(id:string,segment:number) {
    await this.ready;const j=this.getJob(id);if(!Number.isInteger(segment)||!j.segments[segment])throw new Error('句子位置无效');
    for(const job of this.jobs.values())job.priority=[];
    // A new click replaces old queued priority work; the in-flight sentence may finish.
    j.priority=[segment,segment+1,segment+2].filter(i=>j.segments[i]&&j.segments[i].state!=='ready');
    if(j.priority.length){this.getVoice(j.voice.id);if(j.synthesisKey!==await this.modelHash()){j.priority=[];throw new Error('模型文件已变更，请重新生成新的音频版本');}for(const i of j.priority){j.segments[i].state='pending';delete j.segments[i].error;}}
    await this.persistJob(j);this.changed();void this.pump();
  }
  async audio(id:string,segment:number):Promise<Uint8Array> {
    await this.ready;const j=this.getJob(id),s=j.segments[segment];
    if(!Number.isInteger(segment)||!s||s.state!=='ready')throw new Error('这句话尚未生成');
    try {const b=await fs.readFile(this.audioPath(id,segment));wavInfo(b);return new Uint8Array(b);}
    catch(e){if(this.jobs.get(id)!==j)throw new Error('朗读任务已清理');s.state='pending';delete s.bytes;delete s.duration;j.status='paused';j.error='有一段音频缺失或损坏，请继续生成以修复';await this.persistJob(j);this.changed();throw new Error(j.error);}
  }
  private async pump() {
    await this.ready;if(this.working||this.closed)return;this.working=true;this.changed();
    try {
      while(!this.closed) {
        const preview=this.previews.shift();
        if(preview) {
          const file=path.join(this.root,'preview-'+crypto.randomUUID()+'.wav'), start=Date.now();
          try {this.message='正在生成试听…';this.changed();await this.engine.synthesize(preview.voice,preview.text,file);const b=await fs.readFile(file);preview.resolve({audio:new Uint8Array(b),duration:wavInfo(b).duration,elapsedMs:Date.now()-start,voiceId:preview.voice.id,text:preview.text});}
          catch(e){preview.reject(new Error(errorText(e)));}finally{await fs.unlink(file).catch(()=>{});}continue;
        }
        let job=[...this.jobs.values()].find(j=>j.priority.some(i=>j.segments[i]?.state==='pending'));
        if(!job)job=[...this.jobs.values()].find(j=>['queued','generating'].includes(j.status)&&j.segments.some(s=>s.state==='pending'));
        if(!job)break;
        const segment=job.priority.map(i=>job!.segments[i]).find(s=>s?.state==='pending')??job.segments.find(s=>s.state==='pending')!;
        const running=job.status!=='paused';if(running)job.status='generating';
        job.activeSegment=segment.id;this.message=`正在生成《${job.bookName}》第 ${segment.id+1} 句`;this.changed();
        const file=this.audioPath(job.id,segment.id), temp=file+'.tmp', start=Date.now();
        try {
          this.getVoice(job.voice.id);
          await fs.mkdir(path.dirname(file),{recursive:true});
          await this.engine.synthesize(job.voice,segment.text,temp);
          if(this.closed||this.jobs.get(job.id)!==job){await fs.unlink(temp).catch(()=>{});continue;}
          const b=await fs.readFile(temp),info=wavInfo(b);
          await fs.rename(temp,file);segment.state='ready';segment.duration=info.duration;segment.bytes=b.length;delete segment.error;
          job.elapsedMs+=Date.now()-start;job.priority=job.priority.filter(i=>i!==segment.id);
          if(job.segments.every(s=>s.state==='ready'))job.status='complete';
          else if(!job.segments.some(s=>s.state==='pending')&&job.segments.some(s=>s.state==='failed'))job.status='error';
        } catch(e) {
          if(this.jobs.get(job.id)!==job)continue;
          const disk=['ENOSPC','EACCES','EPERM'].includes((e as NodeJS.ErrnoException).code??'');
          segment.state=disk||this.closed?'pending':'failed';segment.error=errorText(e);job.error=segment.error;
          job.status=disk||this.closed?'paused':'error';job.priority=[];
        } finally {
          await fs.unlink(temp).catch(()=>{});delete job.activeSegment;
          if(this.jobs.get(job.id)===job)await this.persistJob(job);
          this.changed();
        }
      }
    } catch(e) {this.message=`保存朗读进度失败：${errorText(e)}`;for(const j of this.jobs.values())if(j.status==='generating')j.status='paused';}
    finally {this.working=false;if(!this.message.startsWith('保存朗读'))this.message='';this.changed();}
  }
  async close() {
    this.closed=true;this.engine.close();
    for(const p of this.previews.splice(0))p.reject(new Error('应用正在退出'));
    await this.ready;
    for(const j of this.jobs.values()){if(j.status==='queued'||j.status==='generating')j.status='paused';j.priority=[];await this.persistJob(j);}
    await this.writes;
  }
}
