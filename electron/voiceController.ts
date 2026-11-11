import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { voiceScript } from './voiceScript';
import { isVoiceCommand, VOICE_COMMANDS, type VoiceEvent } from '../shared/voice';

const ERRORS: Record<string, string> = {
  'no-recognizer': '未检测到简体中文语音识别引擎。请在 Windows 设置 → 时间和语言 → 语言和区域 → 中文（简体）的语言选项中安装“语音识别”，然后重试。',
  microphone: '无法使用麦克风。请连接默认麦克风，并在 Windows 隐私设置中允许桌面应用访问麦克风。',
  recognition: '语音识别启动失败或已中断，请检查 Windows 中文语音组件和麦克风后重试。',
};

type Launch = () => ChildProcessWithoutNullStreams;
export function launchVoiceProcess(): ChildProcessWithoutNullStreams {
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(voiceScript, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'pipe' });
}

/** Owns exactly one microphone process, with stale output and startup timeout guards. */
export class VoiceController {
  private child: ChildProcessWithoutNullStreams | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private sessionId = 0;
  private notify: (event: VoiceEvent) => void = () => {};

  constructor(private launch: Launch = launchVoiceProcess, private platform = process.platform,
    private startupTimeout = 20000) {}

  start(sessionId: number, notify: (event: VoiceEvent) => void) {
    this.stop();
    this.sessionId = sessionId;
    this.notify = notify;
    if (this.platform !== 'win32') {
      this.emit('error', '语音控制目前仅支持 Windows。');
      return;
    }
    this.emit('starting', '正在启动麦克风…');
    let child: ChildProcessWithoutNullStreams;
    try { child = this.launch(); }
    catch { this.emit('error', ERRORS.recognition); return; }
    this.child = child;
    let pending = '';
    let ready = false;
    let lastCommandAt = 0;
    const fail = (message: string) => {
      if (this.child !== child) return;
      this.release();
      this.emit('error', message);
    };
    this.timer = setTimeout(() => fail('语音识别启动超时，请检查中文语音组件后重试。'), this.startupTimeout);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (this.child !== child) return;
      pending += chunk;
      if (pending.length > 8192) { fail(ERRORS.recognition); return; }
      let newline: number;
      while ((newline = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        if (this.child !== child) return;
        if (line === 'ready') {
          clearTimeout(this.timer);
          ready = true;
          this.emit('listening', '正在监听');
        } else if (line.startsWith('error:')) {
          fail(ERRORS[line.slice(6)] || ERRORS.recognition);
        } else if (ready && line.startsWith('status:')) {
          if (line === 'status:hearing') this.emit('listening', '正在识别…');
          if (line === 'status:unrecognized') this.emit('listening', '未识别到有效口令，请再说一次');
        } else if (ready && line.startsWith('command:')) {
          const [, command, encoded] = line.split(':');
          if (!isVoiceCommand(command) || !encoded) continue;
          const transcript = Buffer.from(encoded, 'base64').toString('utf8');
          if (VOICE_COMMANDS[transcript as keyof typeof VOICE_COMMANDS] !== command) continue;
          const now = Date.now();
          if (now - lastCommandAt < 600) continue;
          lastCommandAt = now;
          this.notify({ sessionId, state: 'listening', message: `已识别：${transcript}`, command, transcript,
            ...(command === 'next' || command === 'prev' ? { direction: command } : {}) });
        }
      }
    });
    child.stderr.resume();
    child.stdin.on('error', () => fail(ERRORS.recognition));
    child.on('error', () => fail(ERRORS.recognition));
    child.on('exit', () => fail('语音识别已停止，请重新开启。'));
  }

  stop() {
    this.release();
    this.emit('idle', '语音控制已关闭');
  }

  private emit(state: VoiceEvent['state'], message: string) {
    this.notify({ sessionId: this.sessionId, state, message });
  }

  private release() {
    clearTimeout(this.timer);
    const child = this.child;
    this.child = null;
    if (!child) return;
    child.stdin.end();
    const killTimer = setTimeout(() => { if (child.exitCode === null) child.kill(); }, 1000);
    killTimer.unref();
    child.once('exit', () => clearTimeout(killTimer));
  }
}
