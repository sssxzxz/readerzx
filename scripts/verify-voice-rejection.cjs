// Offline acoustic regression: synthetic speech and generated noise, no microphone.
const { buildSync } = require('esbuild');
const { mkdirSync, writeFileSync, readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawn } = require('node:child_process');
buildSync({ entryPoints: ['electron/voiceScript.ts', 'shared/voice.ts'], bundle: true, platform: 'node', format: 'cjs',
  outdir: 'out/rejection-tests', outbase: '.', outExtension: { '.js': '.cjs' } });
const { voiceScript } = require('../out/rejection-tests/electron/voiceScript.cjs');
const { VOICE_COMMANDS } = require('../out/rejection-tests/shared/voice.cjs');
const directory = resolve('out/voice-rejection');
mkdirSync(directory, { recursive: true });
const baseline = process.argv.includes('--baseline');
if (baseline && !existsSync(resolve(directory, 'baseline-script.txt'))) writeFileSync(resolve(directory, 'baseline-script.txt'), voiceScript);
const cases = [];
for (const text of ['今天天气很好', '我正在看书', '我们等一下再出门', '这个方法不错', '房子很大', '饭好了', '学校', '方法', '不要放大', '不要缩小', '我没有说放大', '请不要改变字号', '刚才没有说话', '退出', '全凭你的判断', '退钱', '现在返回首页', '开始朗读']) {
  cases.push({ text, rate: 0, command: null });
}
let seed = 98765;
const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
for (const type of ['silence', 'noise', 'hum', 'clicks', 'success-tone']) {
  const hz = 22050, count = hz * 2, wav = Buffer.alloc(44 + count * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(hz, 24); wav.writeUInt32LE(hz * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) {
    const t = i / hz;
    const value = type === 'noise' ? (random() * 2 - 1) * 0.12 : type === 'hum' ? Math.sin(2 * Math.PI * 120 * t) * .12 :
      type === 'clicks' ? (i % 5000 < 100 ? (random() * 2 - 1) * .4 : 0) :
      type === 'success-tone' && t < .16 ? Math.sin(2 * Math.PI * (t < .06 ? 880 : 1175) * t) * .07 * (1 - t / .16) : 0;
    wav.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
  }
  const file = resolve(directory, `${type}.wav`); writeFileSync(file, wav);
  cases.push({ text: type, file, command: null });
}
if (!process.argv.includes('--negative-only')) {
  for (const [text, command] of Object.entries(VOICE_COMMANDS)) cases.push({ text, rate: 0, command });
  for (const rate of [-2, 2]) for (const text of ['放大', '缩小', '全屏', '退全']) {
    if (VOICE_COMMANDS[text]) cases.push({ text, rate, command: VOICE_COMMANDS[text] });
  }
  const phrases = ['这个方法不错', '放大', '不要缩小', '缩小', '全屏', '我正在看书', '退全', '下一页', '上一页', '上翻', '下翻', '放大', '缩小', '全屏', '退全'];
  cases.push({ text: '连续语音', rate: 0, phrases, commands: phrases.filter(text => VOICE_COMMANDS[text]).map(text => VOICE_COMMANDS[text]) });
}
writeFileSync(resolve(directory, 'cases.json'), JSON.stringify(cases));
const source = baseline ? readFileSync(resolve(directory, 'baseline-script.txt'), 'utf8') : voiceScript;
const script = source
  .replace("$ErrorActionPreference = 'Stop'", "$ErrorActionPreference = 'Stop'\n$ProgressPreference = 'SilentlyContinue'")
  .replace('engine.SpeechRecognized += (sender, e) => {', '$& Console.WriteLine("diagnostic:" + Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(e.Result.Text)) + ":" + e.Result.Confidence.ToString(System.Globalization.CultureInfo.InvariantCulture));')
  .replace('engine.SetInputToDefaultAudioDevice()', 'engine.SetInputToWaveFile(Environment.GetEnvironmentVariable("EREADER_TEST_WAV"))')
  .replace('engine.RecognizeCompleted +=', 'var testDone = new System.Threading.AutoResetEvent(false); engine.RecognizeCompleted +=')
  .replace('if (e.Error != null) Console.WriteLine("error:recognition");', 'if (e.Error != null) Console.WriteLine("error:recognition"); testDone.Set();')
  .replace('Console.ReadLine();', 'if (!testDone.WaitOne(30000)) throw new Exception("test timeout");')
  .replace('[ReaderVoice]::Run()', `
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    try {
      $synth.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::NotSet, [System.Speech.Synthesis.VoiceAge]::NotSet, 0, [System.Globalization.CultureInfo]::GetCultureInfo('zh-CN'))
      $index = 0
      foreach ($item in (Get-Content -LiteralPath (Join-Path $env:EREADER_TEST_DIR 'cases.json') -Raw -Encoding UTF8 | ConvertFrom-Json)) {
        [Console]::WriteLine('case:' + $index)
        if ($item.file) { $env:EREADER_TEST_WAV = $item.file }
        else {
          $env:EREADER_TEST_WAV = Join-Path $env:EREADER_TEST_DIR ('sample-' + $index + '.wav')
          $synth.Rate = $item.rate
          $synth.SetOutputToWaveFile($env:EREADER_TEST_WAV)
          if ($item.phrases) {
            $prompt = New-Object System.Speech.Synthesis.PromptBuilder([System.Globalization.CultureInfo]::GetCultureInfo('zh-CN'))
            foreach ($phrase in $item.phrases) {
              $prompt.AppendText($phrase)
              $prompt.AppendBreak([TimeSpan]::FromMilliseconds(800))
            }
            $synth.Speak($prompt)
          } else { $synth.Speak($item.text) }
          $synth.SetOutputToNull()
        }
        [ReaderVoice]::Run()
        $index++
      }
    } finally { $synth.Dispose() }
  `);
const child = spawn(resolve(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
  ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
  { windowsHide: true, env: { ...process.env, EREADER_TEST_DIR: directory } });
let output = '', stderr = '';
child.stdout.on('data', chunk => { output += chunk.toString(); });
child.stderr.on('data', chunk => { stderr += chunk.toString(); });
const timer = setTimeout(() => child.kill(), 240000);
child.on('exit', code => {
  clearTimeout(timer);
  const results = cases.map(c => ({ ...c, actual: [], ready: false, recognized: [] }));
  let index = -1;
  for (const line of output.trim().split(/\r?\n/)) {
    if (line.startsWith('case:')) index = Number(line.slice(5));
    else if (index >= 0 && line === 'ready') results[index].ready = true;
    else if (index >= 0 && line.startsWith('command:')) results[index].actual.push(line.split(':')[1]);
    else if (index >= 0 && line.startsWith('diagnostic:')) {
      const [, text, confidence] = line.split(':');
      results[index].recognized.push({ text: Buffer.from(text, 'base64').toString('utf8'), confidence: Number(confidence) });
    }
  }
  const failures = results.filter(c => !c.ready || JSON.stringify(c.actual) !== JSON.stringify(c.commands || (c.command ? [c.command] : [])));
  writeFileSync(resolve(directory, baseline ? 'baseline-results.json' : 'results.json'), JSON.stringify({ code, results, failures, stderr }, null, 2));
  console.log(JSON.stringify({ cases: cases.length, positives: cases.filter(c => c.command).length, negatives: cases.filter(c => !c.command && !c.commands).length, sequences: cases.filter(c => c.commands).length, failures }, null, 2));
  if (code !== 0 || stderr) console.error(stderr || `Helper exit: ${code}`);
  if (!baseline && (code !== 0 || failures.length)) process.exitCode = 1;
});
