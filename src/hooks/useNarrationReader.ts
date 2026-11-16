import { useCallback,useEffect,useRef,useState } from 'react';
import type { RefObject } from 'react';
import type { OpenedBook,ReaderSettings } from '@shared/types';
import type { NarrationBookInput,NarrationJob,NarrationState,SpeechPosition } from '@shared/narration';
import { findSpeechSegment } from '@shared/narration';
import type { RendererHandle } from '@/renderers/FoliateRenderer';
import type { TtsStatus } from './useSpeechReader';
import { NarrationPlayer } from '@/lib/narrationPlayer';

const api=()=>window.api.narration;
const messageOf=(e:unknown)=>e instanceof Error?e.message:String(e);
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));

export function useNarrationReader({book,settings,rendererRef}:{book:OpenedBook|null;settings:ReaderSettings;rendererRef:RefObject<RendererHandle>}) {
  const requestedVoiceId=(book?settings.narrationVoices?.[book.id]:undefined)??settings.narrationVoiceId??'';
  const [state,setState]=useState<NarrationState|null>(null);
  const voiceId=state&&!state.voices.some(v=>v.id===requestedVoiceId)&&!state.jobs.some(j=>j.bookId===book?.id&&j.voice.id===requestedVoiceId)?'':requestedVoiceId;
  const [job,setJob]=useState<NarrationJob|null>(null);
  const [status,setStatus]=useState<TtsStatus>('idle');
  const [message,setMessage]=useState<string|null>(null);
  const [preparing,setPreparing]=useState(false);
  const jobRef=useRef(job);jobRef.current=job;
  const player=useRef<NarrationPlayer>();if(!player.current)player.current=new NarrationPlayer();
  const sequence=useRef(0),statusRef=useRef(status);statusRef.current=status;
  const live=useRef({book,voiceId,settings});live.current={book,voiceId,settings};
  const input=useRef<{data:ArrayBuffer;promise:Promise<NarrationBookInput>}|null>(null);
  const ensurePromise=useRef<{key:string;promise:Promise<NarrationJob>}|null>(null);
  const selectedSegment=useRef(0);
  const identity=useRef(0);
  const refresh=useCallback(async()=>{
    const s=await api().state();setState(s);
    const active=jobRef.current;
    if(active){try{const fresh=await api().job(active.id);if(jobRef.current?.id===fresh.id){jobRef.current=fresh;setJob(fresh);}}catch{if(jobRef.current?.id===active.id){jobRef.current=null;setJob(null);}}}
  },[]);
  useEffect(()=>{let timer:ReturnType<typeof setTimeout>|undefined;void refresh().catch(e=>setMessage(messageOf(e)));const off=api().onChange(()=>{clearTimeout(timer);timer=setTimeout(()=>void refresh().catch(e=>setMessage(messageOf(e))),40);});return()=>{off();clearTimeout(timer);};},[refresh]);
  const stop=useCallback(()=>{sequence.current++;player.current!.stop();setStatus('idle');setMessage(null);},[]);
  useEffect(()=>{identity.current++;stop();player.current!.clear();jobRef.current=null;setJob(null);ensurePromise.current=null;setPreparing(false);selectedSegment.current=0;},[book?.data,voiceId,stop]);
  useEffect(()=>()=>player.current!.close(),[]);
  useEffect(()=>{api().setPlaybackActive(status==='speaking');return()=>api().setPlaybackActive(false);},[status]);
  useEffect(()=>{player.current!.setRate(settings.ttsRate??1);},[settings.ttsRate]);

  const getInput=useCallback(async()=>{
    const b=live.current.book;if(!b)throw new Error('请先打开一本书');
    if(input.current?.data===b.data)return input.current.promise;
    const promise=(async()=>{
      const source=await rendererRef.current?.getNarrationText?.();
      if(!source)throw new Error('此页面暂时不能提取全文，请等待书籍加载完成');
      const digest=await crypto.subtle.digest('SHA-256',b.data);
      return {...source,bookId:b.id,bookName:b.name,format:b.format,contentHash:Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')};
    })();
    input.current={data:b.data,promise};void promise.catch(()=>{if(input.current?.promise===promise)input.current=null;});return promise;
  },[rendererRef]);
  const ensureJob=useCallback(async()=>{
    if(jobRef.current)return jobRef.current;
    const {book:b,voiceId:v}=live.current;if(!b||!v)throw new Error('请先选择一个保存的音色');
    const current=identity.current,key=b.id+':'+v;
    if(ensurePromise.current?.key===key)return ensurePromise.current.promise;
    setPreparing(true);
    const promise=(async()=>{
      const indexed=await getInput();
      if(identity.current!==current)throw new Error('书籍或音色已切换');
      const all=await api().state();
      const found=all.jobs.filter(j=>j.bookHash===indexed.contentHash&&j.voice.id===v&&j.format===b.format).sort((a,b)=>b.createdAt-a.createdAt)[0];
      const j=found?await api().job(found.id):await api().createJob(indexed,v);
      if(identity.current!==current)throw new Error('书籍或音色已切换');
      jobRef.current=j;setJob(j);return j;
    })();
    ensurePromise.current={key,promise};
    try{return await promise;}finally{if(ensurePromise.current?.promise===promise){ensurePromise.current=null;setPreparing(false);}}
  },[getInput]);

  // Index on explicit use, but reattach saved audio by byte identity on reopen.
  useEffect(()=>{
    if(!book||!voiceId)return;const current=identity.current;let cancelled=false;
    void (async()=>{
      const digest=await crypto.subtle.digest('SHA-256',book.data),h=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
      const s=await api().state();if(cancelled||identity.current!==current)return;setState(s);
      const found=s.jobs.filter(j=>j.bookHash===h&&j.voice.id===voiceId&&j.format===book.format).sort((a,b)=>b.createdAt-a.createdAt)[0];
      if(found){const j=await api().job(found.id);if(!cancelled&&identity.current===current){jobRef.current=j;setJob(j);}}
    })().catch(e=>{if(!cancelled)setMessage(messageOf(e));});
    return()=>{cancelled=true;};
  },[book?.data,voiceId]);
  const prefetch=useCallback((j:NarrationJob,at:number)=>{
    for(const s of j.segments.slice(at,at+4))if(s.state==='ready')void player.current!.load(`${j.id}:${s.id}`,()=>api().audio(j.id,s.id)).catch(()=>{});
  },[]);
  useEffect(()=>{if(job)prefetch(job,selectedSegment.current);},[job,prefetch]);

  const start=useCallback(async(position?:SpeechPosition,explicitJob?:NarrationJob)=>{
    const seq=++sequence.current;player.current!.stop();void player.current!.warm();setStatus('loading');setMessage('正在准备朗读…');
    try {
      let j=explicitJob??await ensureJob();if(seq!==sequence.current)return;
      const at=position??await rendererRef.current?.getSpeechPosition?.();
      let index=at?findSpeechSegment(j.segments,at):0;
      while(seq===sequence.current&&index<j.segments.length) {
        selectedSegment.current=index;
        let s=j.segments[index];
        if(s.state!=='ready') {
          setStatus('loading');setMessage('这句话正在优先生成，完成后自动朗读…');
          await api().prioritize(j.id,index);
          while(seq===sequence.current) {
            j=await api().job(j.id);s=j.segments[index];
            if(s.state==='ready')break;
            if(s.state==='failed'||j.status==='error')throw new Error(s.error??j.error??'生成失败，请重试');
            if(j.status==='paused'&&!j.priority.includes(index)&&j.activeSegment!==index)throw new Error('生成已暂停，可点击继续生成');
            await delay(200);
          }
        }
        if(seq!==sequence.current)return;
        jobRef.current=j;setJob(j);prefetch(j,index);
        // Queue the next missing sentence while this one plays.
        if(j.segments.slice(index+1,index+3).some(x=>x.state!=='ready'))void api().prioritize(j.id,index+1).catch(()=>{});
        const clickStarted=performance.now();
        const played=await player.current!.play(`${j.id}:${index}`,()=>api().audio(j.id,index),live.current.settings.ttsRate??1,()=>{
          if(seq!==sequence.current)return;
          setStatus('speaking');setMessage(`正在朗读 ${index+1} / ${j.segments.length}`);
          window.dispatchEvent(new CustomEvent('narration-playback-start',{detail:{jobId:j.id,segment:index,audioSeconds:s.duration,rate:live.current.settings.ttsRate??1,bufferStartDelayMs:performance.now()-clickStarted}}));
          rendererRef.current?.showSpeechPosition?.(s);
        });
        if(!played||seq!==sequence.current)return;
        index++;j=jobRef.current?.id===j.id?jobRef.current:j;
      }
      if(seq===sequence.current){setStatus('idle');setMessage('本书已朗读完');}
    } catch(e){if(seq===sequence.current){setStatus('idle');setMessage(messageOf(e));}}
  },[ensureJob,prefetch,rendererRef]);
  const toggle=useCallback(()=>{
    if(statusRef.current==='speaking'){player.current!.pause();setStatus('paused');}
    else if(statusRef.current==='paused'){player.current!.resume();setStatus('speaking');}
    else if(statusRef.current==='loading')stop();
    else void start();
  },[start,stop]);
  const generate=useCallback(async()=>{
    const current=identity.current,v=live.current.voiceId;setPreparing(true);
    try {
      const indexed=await getInput();if(current!==identity.current)return;
      // The backend reuses the current edition, or creates a separate edition after a model change.
      const j=await api().createJob(indexed,v);if(current!==identity.current)return;
      jobRef.current=j;setJob(j);await api().control(j.id,'resume');await refresh();
      if(current===identity.current)setMessage('已开始后台生成，已完成的内容可立即点读');
    }catch(e){if(current===identity.current)setMessage(messageOf(e));}finally{if(current===identity.current)setPreparing(false);}
  },[getInput,refresh]);
  return {enabled:!!voiceId,voiceId,state,job,status,message,preparing,stop,toggle,start,generate,refresh,
    playSaved:async(id:string)=>{
      stop();const seq=sequence.current,current=identity.current,b=live.current.book;if(!b)return;
      const [j,digest]=await Promise.all([api().job(id),crypto.subtle.digest('SHA-256',b.data)]);
      if(seq!==sequence.current||current!==identity.current||j.voice.id!==live.current.voiceId)return;
      const contentHash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
      if(j.bookHash!==contentHash)throw new Error('这份音频属于本书的旧版本，请为当前内容重新生成');
      jobRef.current=j;setJob(j);await start(undefined,j);
    },
    reportError:(e:unknown)=>setMessage(messageOf(e))};
}
export type NarrationControls=ReturnType<typeof useNarrationReader>;
