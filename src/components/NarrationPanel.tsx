import { useEffect,useRef,useState } from 'react';
import { useReaderStore } from '@/store/useReaderStore';
import type { NarrationControls } from '@/hooks/useNarrationReader';
import type { NarrationRuntime } from '@shared/narration';

const labels={paused:'已暂停',queued:'等待生成',generating:'正在生成',complete:'已全部生成',error:'生成遇到问题'};
const duration=(s:number)=>s<60?`${Math.round(s)} 秒`:`${Math.floor(s/60)} 分 ${Math.round(s%60)} 秒`;
const button='px-3 py-1.5 rounded border border-muted/30 hover:bg-muted/15 disabled:opacity-40';
export default function NarrationPanel({open,onClose,narration,onBeforePlay}:{open:boolean;onClose:()=>void;narration:NarrationControls;onBeforePlay:()=>void}) {
  const {book,settings,setSettings}=useReaderStore();
  const [name,setName]=useState('新音色'),[transcript,setTranscript]=useState('');
  const [previewText,setPreviewText]=useState('今天我们用同一段文字，比较不同声音的朗读效果和生成速度。');
  const [busy,setBusy]=useState(false),[localMessage,setLocalMessage]=useState(''),[previewUrl,setPreviewUrl]=useState('');
  const [runtime,setRuntime]=useState<Partial<NarrationRuntime>>({});
  const [rename,setRename]=useState('');
  const preview=useRef<HTMLAudioElement>(null);
  const selectedVoice=useRef(narration.voiceId);selectedVoice.current=narration.voiceId;
  const [savedPlayback,setSavedPlayback]=useState<{id:string;voice:string;data:ArrayBuffer}|null>(null);
  const state=narration.state;
  const voices=[...(state?.voices??[])];
  for(const j of state?.jobs??[])if(j.bookId===book?.id&&!voices.some(v=>v.id===j.voice.id))voices.push({...j.voice,name:j.voice.name+'（已保存音频）'});
  const selectVoice=(id:string)=>{
    setSavedPlayback(null);
    narration.stop();preview.current?.pause();
    if(book)setSettings({narrationVoices:{...settings.narrationVoices,[book.id]:id}});
    else setSettings({narrationVoiceId:id||undefined});
  };
  useEffect(()=>{setRename(voices.find(v=>v.id===narration.voiceId)?.name??'');},[narration.voiceId,state?.voices]);
  useEffect(()=>{setPreviewUrl('');},[narration.voiceId]);
  useEffect(()=>()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);},[previewUrl]);
  useEffect(()=>{if(!open)preview.current?.pause();},[open]);
  useEffect(()=>{
    if(!savedPlayback)return;
    if(savedPlayback.data!==book?.data){setSavedPlayback(null);return;}
    if(savedPlayback.voice!==narration.voiceId)return;
    // Wait for the parent reader's voice-change cleanup in this effect flush.
    let cancelled=false;queueMicrotask(()=>{if(cancelled)return;setSavedPlayback(null);void narration.playSaved(savedPlayback.id).catch(narration.reportError);});
    return()=>{cancelled=true;};
  },[savedPlayback,book?.data,narration.voiceId]);
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setLocalMessage('');try{await fn();await narration.refresh();}catch(e){setLocalMessage(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
  if(!open)return null;
  const jobs=state?.jobs??[];
  const current=jobs.filter(j=>j.bookId===book?.id);
  const other=jobs.filter(j=>j.bookId!==book?.id);
  return <div className="absolute inset-0 z-50 bg-black/40" onClick={onClose} data-narration-panel>
    <section className="absolute inset-y-3 right-3 w-[min(520px,calc(100%-24px))] rounded-xl shadow-2xl bg-panel text-fg flex flex-col" onClick={e=>e.stopPropagation()} aria-label="声音与听书">
      <header className="flex items-center justify-between p-4 border-b border-muted/20"><h2 className="font-bold text-lg">声音与听书</h2><button className={button} onClick={onClose}>关闭</button></header>
      <div className="overflow-y-auto flex-1 p-4 space-y-5 text-sm">
        <section className="space-y-2"><label htmlFor="narration-voice" className="font-semibold">{book?'这本书使用的声音':'默认朗读声音'}</label>
          <select id="narration-voice" className="block w-full bg-bg rounded p-2 border border-muted/30" value={narration.voiceId} onChange={e=>selectVoice(e.target.value)}>
            <option value="">Windows 系统声音</option>{voices.map(v=><option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <p className="text-xs text-muted">音色保存在本机。先试听，再生成整本书；已生成内容可以离线反复播放。</p>
          <label className="flex items-center gap-2"><input type="checkbox" checked={!!settings.narrationClickToRead} disabled={!narration.voiceId} onChange={e=>setSettings({narrationClickToRead:e.target.checked})}/>点读模式：点击正文，从该句连续朗读</label>
          <p className="text-xs text-muted">开启点读时，正文左键点击用于朗读；关闭后恢复原来的点击翻页。</p>
          <label className="flex items-center gap-3">播放速度 <input aria-label="播放速度" type="range" min="0.5" max="2" step="0.1" value={settings.ttsRate} onChange={e=>setSettings({ttsRate:Number(e.target.value)})}/>{settings.ttsRate.toFixed(1)}×</label>
          <div className="flex gap-2 flex-wrap"><button data-generate-book className={button} disabled={!book||!state?.voices.some(v=>v.id===narration.voiceId)||narration.preparing||busy} onClick={()=>void narration.generate()}>{narration.preparing?'正在提取全文…':'生成整本书'}</button><button className={button} disabled={!book||!narration.voiceId} onClick={()=>{onBeforePlay();narration.toggle();}}>{narration.status==='speaking'?'暂停朗读':narration.status==='paused'?'继续朗读':'从当前位置朗读'}</button><button className={button} onClick={narration.stop}>停止朗读</button></div>
        </section>
        {narration.voiceId&&<section className="space-y-2"><h3 className="font-semibold">生成前试听</h3><textarea aria-label="试听文字" className="w-full rounded border border-muted/30 bg-bg p-2 h-20" maxLength={400} value={previewText} onChange={e=>setPreviewText(e.target.value)}/><button className={button} disabled={busy||!state?.voices.some(v=>v.id===narration.voiceId)} onClick={()=>void run(async()=>{
          onBeforePlay();narration.stop();preview.current?.pause();setLocalMessage('正在生成试听…');
          const voiceId=narration.voiceId,result=await window.api.narration.preview(voiceId,previewText);
          if(selectedVoice.current!==voiceId)return;
          setPreviewUrl(URL.createObjectURL(new Blob([new Uint8Array(result.audio)],{type:'audio/wav'})));
          setLocalMessage(`试听已生成：${duration(result.duration)}，耗时 ${(result.elapsedMs/1000).toFixed(1)} 秒。`);
        })}>{busy?'处理中…':'生成试听'}</button>{previewUrl&&<audio ref={preview} className="w-full" controls src={previewUrl} onPlay={()=>{onBeforePlay();narration.stop();}}/>}</section>}
        <section className="space-y-2"><h3 className="font-semibold">生成任务</h3>{!jobs.length&&<p className="text-muted">还没有生成任务。</p>}
          {[...current,...other].map(j=>{
            const estimate=j.ready?j.elapsedMs/j.ready*(j.total-j.ready)/1000:0;
            return <article key={j.id} className="border border-muted/25 rounded-lg p-3 space-y-2" data-narration-job={j.id}>
              <p className="font-medium truncate" title={j.bookName}>{j.bookName} · {j.voice.name}</p>
              <progress className="w-full accent-[rgb(var(--reader-accent))]" value={j.ready} max={j.total}/>
              <p>{labels[j.status]} · {j.ready} / {j.total} 句{j.failed?` · ${j.failed} 句失败`:''}</p>
              <p className="text-xs text-muted">已生成 {duration(j.audioSeconds)} · {(j.bytes/1024/1024).toFixed(1)} MB{estimate>0&&j.status!=='complete'?` · 预计还需 ${duration(estimate)}`:''}</p>
              {j.activeSegment!==undefined&&j.status==='paused'&&<p className="text-xs text-muted">当前句子完成后暂停。</p>}
              {j.error&&<p role="alert" className="text-red-500 break-words">{j.error}</p>}
              {!state?.voices.some(v=>v.id===j.voice.id)&&<p className="text-xs text-muted">音色已从音色库删除，已生成的音频仍可播放。</p>}
              {!!j.warnings.length&&<details><summary>{j.warnings.length} 条文字提取提示</summary>{j.warnings.map((w,i)=><p key={i}>{w}</p>)}</details>}
              <div className="flex gap-2 flex-wrap">
                {j.status!=='complete'&&<button className={button} disabled={busy||!state?.voices.some(v=>v.id===j.voice.id)} onClick={()=>void run(()=>window.api.narration.control(j.id,['generating','queued'].includes(j.status)?'pause':'resume'))}>{['generating','queued'].includes(j.status)?'暂停生成':'继续生成'}</button>}
                {!!j.failed&&<button className={button} disabled={busy||!state?.voices.some(v=>v.id===j.voice.id)} onClick={()=>void run(()=>window.api.narration.control(j.id,'retry'))}>重试失败句子</button>}
                {j.bookId===book?.id&&j.ready>0&&<button className={button} onClick={()=>{onBeforePlay();selectVoice(j.voice.id);setSavedPlayback({id:j.id,voice:j.voice.id,data:book!.data});}}>播放已生成</button>}
                <button className={button} onClick={()=>{if(window.confirm('清理这份任务及已生成音频？原书和保存的音色会保留。'))void run(async()=>{if(narration.job?.id===j.id)narration.stop();await window.api.narration.control(j.id,'delete');});}}>清理音频</button>
              </div>
            </article>;
          })}
        </section>
        <details className="space-y-2"><summary className="font-semibold cursor-pointer">保存新的音色</summary><p className="text-xs text-muted">填写名称和录音里实际说出的文字，再选择录音。建议 5～20 秒。</p><input aria-label="音色名称" className="w-full bg-bg p-2 border border-muted/30 rounded" value={name} onChange={e=>setName(e.target.value)} maxLength={80}/><textarea aria-label="录音对应文字" className="w-full bg-bg p-2 border border-muted/30 rounded h-24" value={transcript} onChange={e=>setTranscript(e.target.value)} placeholder="录音对应的完整文字"/><button className={button} disabled={busy||!name.trim()||!transcript.trim()} onClick={()=>void run(async()=>{const v=await window.api.narration.importReference(name,transcript);if(v){selectVoice(v.id);setLocalMessage('音色已保存，可以先试听。');}})}>选择录音并保存音色</button></details>
        {!!narration.voiceId&&state?.voices.some(v=>v.id===narration.voiceId)&&<details className="space-y-2"><summary className="font-semibold cursor-pointer">管理当前音色</summary><input aria-label="修改音色名称" className="w-full bg-bg p-2 border border-muted/30 rounded" value={rename} onChange={e=>setRename(e.target.value)}/><div className="flex gap-2"><button className={button} disabled={busy} onClick={()=>void run(()=>window.api.narration.renameVoice(narration.voiceId,rename))}>保存名称</button><button className={button} onClick={()=>{if(window.confirm('删除音色并停止相关生成？已生成的书籍音频仍会保留。'))void run(()=>window.api.narration.deleteVoice(narration.voiceId));}}>删除音色</button></div><p className="text-xs text-muted">更换录音时保存为新音色，原来的音频版本仍可保留。</p></details>}
        <details className="space-y-2"><summary className="text-muted cursor-pointer">本地环境设置{state&&!state.ready?'（需要配置）':''}</summary>{(['pythonPath','dependencyPath','modelRoot','ffmpegPath'] as const).map((key,i)=><label key={key} className="block text-xs">{['Python 程序','声音运行库目录','模型目录','音频转换程序'][i]}<input className="w-full bg-bg p-2 border border-muted/30 rounded" value={runtime[key]??state?.runtime[key]??''} onChange={e=>setRuntime({...runtime,[key]:e.target.value})}/></label>)}<button className={button} disabled={busy||state?.busy} onClick={()=>void run(async()=>{await window.api.narration.configure(runtime);setLocalMessage('环境设置已保存');})}>保存环境设置</button></details>
      </div>
      {(localMessage||narration.message||state?.message)&&<p role="status" className="border-t border-muted/20 p-3 text-sm break-words">{localMessage||narration.message||state?.message}</p>}
    </section>
  </div>;
}
