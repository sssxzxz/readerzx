import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import type { NarrationRuntime, VoiceProfile } from '../shared/narration';

// The worker and model stay resident; book audio never depends on a running worker.
const WORKER = String.raw`import sys,json,wave,os
sys.stdin.reconfigure(encoding='utf-8');sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0,sys.argv[1])
import numpy as np
import sherpa_onnx as so
root=sys.argv[2]; folder=os.path.join(root,'sherpa-onnx-zipvoice-distill-int8-zh-en-emilia')
lexicon=os.path.join(folder,'lexicon.txt')
if os.path.isfile(os.path.join(root,'lexicon-en-us.txt')):lexicon+=','+os.path.join(root,'lexicon-en-us.txt')
cfg=so.OfflineTtsConfig(model=so.OfflineTtsModelConfig(zipvoice=so.OfflineTtsZipvoiceModelConfig(
 tokens=os.path.join(folder,'tokens.txt'),encoder=os.path.join(folder,'encoder.int8.onnx'),decoder=os.path.join(folder,'decoder.int8.onnx'),
 vocoder=os.path.join(root,'vocos_24khz.onnx'),lexicon=lexicon,guidance_scale=1.0),num_threads=6,provider='cpu',debug=False))
if not cfg.validate(): raise RuntimeError('Invalid model configuration')
tts=so.OfflineTts(cfg)
refs={}
for line in sys.stdin:
 try:
  r=json.loads(line)
  if r['reference'] not in refs:
   with wave.open(r['reference']) as w:
    rate=w.getframerate(); data=np.frombuffer(w.readframes(w.getnframes()),dtype='<i2').astype(np.float32)/32768
   refs[r['reference']]=(data,rate)
   if len(refs)>8: refs.pop(next(iter(refs)))
  data,rate=refs[r['reference']]
  g=so.GenerationConfig();g.reference_audio=data;g.reference_sample_rate=rate;g.reference_text=r['referenceText'];g.num_steps=4
  g.extra={'min_words_in_sentence':'40','max_words_in_sentence':'60'}
  audio=tts.generate(r['text'],g)
  a=np.asarray(audio.samples,dtype=np.float32)
  if not len(a) or not np.all(np.isfinite(a)): raise RuntimeError('Empty or invalid audio')
  peak=float(np.max(np.abs(a)))
  if peak>0.98:a=a*(0.98/peak)
  with wave.open(r['output'],'wb') as w:
   w.setnchannels(1);w.setsampwidth(2);w.setframerate(audio.sample_rate);w.writeframes((a*32767).astype('<i2').tobytes())
  print(json.dumps({'ok':True}),flush=True)
 except Exception as e:print(json.dumps({'ok':False,'error':str(e),'errno':getattr(e,'errno',None)}),flush=True)
`;

export const SYNTHESIS_VERSION = 'zipvoice-distill-int8-sherpa2.0.1-cpu6-steps4-guidance1-chunks40-60-peak98-v1';

export async function detectNarrationRuntime(base: string): Promise<NarrationRuntime> {
  let aixora = '';
  const projects = path.join(os.homedir(), 'CursorProjects');
  for (const name of await fs.readdir(projects).catch(() => [])) {
    const candidate = path.join(projects, name, 'Aixora-Studio');
    if (name.startsWith('audio.') && existsSync(path.join(candidate, 'venv', 'python.exe'))) { aixora = candidate; break; }
  }
  const roots = [base, process.cwd()];
  const local = roots.map(r => path.join(r, '.local')).find(r => existsSync(path.join(r, 'zipvoice-onnx'))) ?? path.join(base, '.local');
  return { pythonPath: aixora ? path.join(aixora, 'venv', 'python.exe') : '', dependencyPath: path.join(local, 'benchmark-deps'), modelRoot: path.join(local, 'zipvoice-onnx'), ffmpegPath: aixora ? path.join(aixora, 'webui', 'ffmpeg.exe') : '' };
}

export function runtimeReady(r: NarrationRuntime): boolean {
  return [r.pythonPath, r.ffmpegPath, path.join(r.dependencyPath, 'sherpa_onnx', '__init__.py'),
    path.join(r.modelRoot, 'vocos_24khz.onnx'), ...['encoder.int8.onnx','decoder.int8.onnx','tokens.txt','lexicon.txt'].map(n => path.join(r.modelRoot,'sherpa-onnx-zipvoice-distill-int8-zh-en-emilia',n))].every(p => !!p && existsSync(p));
}

export function runCommand(exe: string, args: string[], timeout = 120000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let tail = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('音频处理超时')); }, timeout);
    child.stderr.on('data', b => { tail = (tail + b.toString()).slice(-1200); });
    child.once('error', e => { clearTimeout(timer); reject(e); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(tail || `音频处理失败 (${code})`)); });
  });
}

export interface SpeechEngine {
  synthesize(voice: VoiceProfile, text: string, output: string): Promise<void>;
  close(): void;
}
export class NarrationEngine implements SpeechEngine {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending: { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private tail = '';
  constructor(private config: () => NarrationRuntime) {}
  async synthesize(voice: VoiceProfile, text: string, output: string): Promise<void> {
    if (this.pending) throw new Error('合成队列忙碌');
    if (!runtimeReady(this.config())) throw new Error('本地声音环境不完整，请检查声音设置中的路径');
    if (!this.child) {
      const cfg = this.config();
      const child = spawn(cfg.pythonPath, ['-u', '-c', WORKER, cfg.dependencyPath, cfg.modelRoot], { windowsHide: true, stdio: ['pipe','pipe','pipe'], env: {...process.env, PYTHONUTF8:'1'} });
      this.child = child; this.tail = '';
      child.stderr.on('data', b => { this.tail = (this.tail + b.toString()).slice(-1500); });
      readline.createInterface({ input: child.stdout }).on('line', line => {
        let data: { ok: boolean; error?: string; errno?: number };
        try { data = JSON.parse(line); } catch { return; }
        if (typeof data.ok !== 'boolean' || this.child !== child || !this.pending) return;
        const pending = this.pending; this.pending = null; clearTimeout(pending.timer);
        if(data.ok)pending.resolve();
        else {const error=new Error(data.error||'声音生成失败') as NodeJS.ErrnoException;error.code=({28:'ENOSPC',13:'EACCES',1:'EPERM'} as Record<number,string>)[data.errno??0];pending.reject(error);}
      });
      const failed = (e: Error) => {
        if (this.child !== child) return;
        this.child = null;
        if (this.pending) { const p = this.pending; this.pending = null; clearTimeout(p.timer); p.reject(e); }
      };
      child.once('error', failed);
      child.once('exit', () => failed(new Error(`本地声音引擎退出：${this.tail}`)));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(), 300000);
      this.pending = { resolve, reject, timer };
      this.child!.stdin.write(JSON.stringify({ reference:voice.referenceFile, referenceText:voice.referenceText, text, output })+'\n', error => { if (error) this.close(); });
    });
  }
  close() {
    const child = this.child; this.child = null;
    if (this.pending) { const p = this.pending; this.pending = null; clearTimeout(p.timer); p.reject(new Error('声音生成已停止或超时')); }
    child?.kill();
  }
}

export function wavInfo(bytes: Buffer): { duration: number; sampleRate: number; channels: number } {
  if (bytes.length < 44 || bytes.toString('ascii',0,4)!=='RIFF' || bytes.toString('ascii',8,12)!=='WAVE') throw new Error('WAV 音频已损坏');
  let rate=0, byteRate=0, channels=0, length=0;
  for (let p=12;p+8<=bytes.length;) {
    const name=bytes.toString('ascii',p,p+4), size=bytes.readUInt32LE(p+4);
    if (p+8+size>bytes.length) throw new Error('WAV 音频不完整');
    if(name==='fmt ' && size>=16) { channels=bytes.readUInt16LE(p+10);rate=bytes.readUInt32LE(p+12);byteRate=bytes.readUInt32LE(p+16); }
    if(name==='data')length+=size;
    p+=8+size+(size%2);
  }
  if(!rate||!byteRate||!length||!channels)throw new Error('WAV 音频为空');
  return { duration:length/byteRate,sampleRate:rate,channels };
}
