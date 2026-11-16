/** Bounded decoded cache. Pause/rate changes act on playback, never re-synthesize. */
export class NarrationPlayer {
  private context:AudioContext|null=null;
  private cache=new Map<string,Promise<AudioBuffer>>();
  private source:AudioBufferSourceNode|null=null;
  private media:HTMLAudioElement|null=null;
  private mediaUrl:string|null=null;
  private finish:((completed:boolean)=>void)|null=null;
  private active:AudioBuffer|null=null;
  private at=0;
  private started=0;
  private rate=1;
  private paused=false;
  private generation=0;
  private onStarted:(()=>void)|undefined;
  private ctx(){return this.context??(this.context=new AudioContext({latencyHint:'interactive'}));}
  warm(){return this.ctx().resume();}
  load(key:string,read:()=>Promise<Uint8Array>):Promise<AudioBuffer> {
    const found=this.cache.get(key);if(found){this.cache.delete(key);this.cache.set(key,found);return found;}
    const pending=read().then(bytes=>this.ctx().decodeAudioData(new Uint8Array(bytes).buffer));
    this.cache.set(key,pending);void pending.catch(()=>{if(this.cache.get(key)===pending)this.cache.delete(key);});
    while(this.cache.size>16)this.cache.delete(this.cache.keys().next().value!);
    return pending;
  }
  async play(key:string,read:()=>Promise<Uint8Array>,rate:number,onStart?:()=>void):Promise<boolean> {
    this.stop();const generation=this.generation;
    const buffer=await this.load(key,read);if(generation!==this.generation)return false;
    await this.warm();if(generation!==this.generation)return false;
    this.active=buffer;this.at=0;this.rate=Math.max(.5,Math.min(2,rate));this.paused=false;
    this.onStarted=onStart;
    return new Promise((resolve,reject)=>{this.finish=resolve;Promise.resolve(this.startSource()).catch(e=>{if(generation===this.generation&&e?.name!=='AbortError'){this.finish=null;this.stop();reject(e);}});});
  }
  private startSource(){
    // Chromium's media path preserves pitch when the user changes reading speed.
    if(this.rate!==1) {
      const audio=new Audio();this.media=audio;audio.preservesPitch=true;
      this.mediaUrl=URL.createObjectURL(pcmWave(this.active!));audio.src=this.mediaUrl;audio.defaultPlaybackRate=this.rate;audio.playbackRate=this.rate;audio.currentTime=this.at;
      audio.onended=()=>{if(this.media!==audio)return;this.detach();this.active=null;const f=this.finish;this.finish=null;f?.(true);};
      return audio.play().then(()=>{if(this.media===audio){const fn=this.onStarted;this.onStarted=undefined;fn?.();}});
    }
    const ctx=this.ctx(),source=ctx.createBufferSource();source.buffer=this.active;source.playbackRate.value=this.rate;
    source.connect(ctx.destination);this.source=source;this.started=ctx.currentTime;
    source.onended=()=>{if(this.source!==source)return;this.source=null;source.disconnect();this.active=null;const f=this.finish;this.finish=null;f?.(true);};
    source.start(0,this.at);
    const fn=this.onStarted;this.onStarted=undefined;fn?.();
  }
  pause(){if(!this.active)return;if(this.media){this.media.pause();this.at=this.media.currentTime;this.paused=true;return;}if(!this.source)return;this.at=Math.min(this.active.duration,this.at+(this.ctx().currentTime-this.started)*this.rate);this.paused=true;this.detach();}
  resume(){if(!this.active||!this.paused)return;this.paused=false;if(this.at>=this.active.duration){this.detach();const f=this.finish;this.finish=null;this.active=null;f?.(true);return;}void this.warm();this.settlePlayback(this.media?this.media.play():this.startSource());}
  setRate(rate:number){
    rate=Math.max(.5,Math.min(2,rate));if(rate===this.rate)return;
    if(this.media){this.rate=rate;this.media.playbackRate=rate;return;}
    if(this.source){this.at+=(this.ctx().currentTime-this.started)*this.rate;this.detach();this.rate=rate;this.settlePlayback(this.startSource());}
    else this.rate=rate;
  }
  private settlePlayback(pending:Promise<void>|void){const generation=this.generation,media=this.media,source=this.source;void Promise.resolve(pending).catch(e=>{if(e?.name!=='AbortError'&&generation===this.generation&&media===this.media&&source===this.source)this.stop();});}
  private detach(){const source=this.source;this.source=null;if(source){source.onended=null;try{source.stop();}catch{}source.disconnect();}if(this.media){this.media.onended=null;this.media.pause();this.media.removeAttribute('src');this.media.load();this.media=null;}if(this.mediaUrl){URL.revokeObjectURL(this.mediaUrl);this.mediaUrl=null;}}
  stop(){this.generation++;this.detach();this.active=null;this.onStarted=undefined;this.paused=false;this.at=0;const f=this.finish;this.finish=null;f?.(false);}
  clear(){this.stop();this.cache.clear();}
  close(){this.clear();void this.context?.close();this.context=null;}
}

function pcmWave(buffer:AudioBuffer):Blob {
  const channels=buffer.numberOfChannels, count=buffer.length, data=new ArrayBuffer(44+count*channels*2), view=new DataView(data);
  const ascii=(at:number,s:string)=>{for(let i=0;i<s.length;i++)view.setUint8(at+i,s.charCodeAt(i));};
  ascii(0,'RIFF');view.setUint32(4,data.byteLength-8,true);ascii(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);view.setUint32(24,buffer.sampleRate,true);view.setUint32(28,buffer.sampleRate*channels*2,true);view.setUint16(32,channels*2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,data.byteLength-44,true);
  for(let ch=0;ch<channels;ch++){const samples=buffer.getChannelData(ch);for(let i=0;i<count;i++)view.setInt16(44+(i*channels+ch)*2,Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),true);}
  return new Blob([data],{type:'audio/wav'});
}
