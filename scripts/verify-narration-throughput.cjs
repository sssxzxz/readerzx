// End-to-end reader generation timing; only creates its isolated work profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const fixture = {
  name: 'Chinese reader comparison v1',
  short: '今天我们用同一段文字，比较不同声音的朗读效果和生成速度。',
  long: '清晨，我推开窗户，看见阳光落在对面的屋顶上。街道还很安静，只有几只小鸟在树枝间跳动。我给自己倒了一杯温水，坐到桌前，准备读完昨天没有读完的那一章。\n书里讲的是一个普通人的旅行。他带着一张地图，沿着河岸慢慢向前走。遇到不熟悉的路口，他会停下来问路，也会认真听别人讲述这里的故事。\n上午九点，窗外渐渐热闹起来。我合上书，记下三个问题：我们为什么出发，途中遇到了什么，最后又学会了什么？答案也许并不复杂。每天留出十分钟，读一点书，想一想自己的生活，就已经是一个不错的开始。等到明天，再带着新的发现继续往前走。',
};
// An ASCII transport keeps the shared fixture intact in Windows PowerShell 5.
if (process.argv.includes('--fixture-base64')) { console.log(Buffer.from(JSON.stringify(fixture), 'utf8').toString('base64')); process.exit(0); }
const root = path.resolve('work/narration-throughput-' + Date.now());
fs.mkdirSync(root, { recursive: true });
require('esbuild').buildSync({
  stdin: { contents: "export { NarrationService } from './electron/narrationService'; export { NarrationEngine, detectNarrationRuntime, runtimeReady, wavInfo } from './electron/narrationEngine';", resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', outfile: path.join(root, 'service.cjs'),
});
const { NarrationService, NarrationEngine, detectNarrationRuntime, runtimeReady, wavInfo } = require(path.join(root, 'service.cjs'));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const {audio:recording,text:transcript}=require('./narration-test-config.cjs').reference();
let service, engine;

async function main() {
  const referenceBefore = sha256(await fsp.readFile(recording));
  const text = fixture.long;
  const priorSummary = path.resolve('work/tts-benchmark/benchmark-summary.json');
  const summary = fs.existsSync(priorSummary) ? JSON.parse(await fsp.readFile(priorSummary, 'utf8')) : null;
  const baseline = summary?.reports.find(report => report.backend === 'Windows SAPI CPU')?.results.find(result => result.name === 'long-1' && result.text === text);
  const runtime = await detectNarrationRuntime(process.cwd());
  assert.equal(runtimeReady(runtime), true, 'current reader runtime is ready');
  engine = new NarrationEngine(() => runtime);
  const perSegments = [];
  const measuredEngine = {
    async synthesize(voice, sentence, output) {
      const start = performance.now();
      await engine.synthesize(voice, sentence, output);
      const elapsedMs = performance.now() - start;
      const bytes = await fsp.readFile(output), info = wavInfo(bytes);
      perSegments.push({ index: perSegments.length, text: sentence, elapsedMs, audioSeconds: info.duration, bytes: bytes.length });
    },
    close() { engine.close(); },
  };
  service = new NarrationService(path.join(root, 'profile'), process.cwd(), () => {}, measuredEngine);
  await service.ready;
  const voice = await service.importReference('我的声音：阅读器生成测速', transcript, recording);
  const indexedAt = performance.now();
  const job = await service.createJob({
    bookId: 'reader-throughput-long-1', bookName: '约一分钟中文朗读测速', format: 'txt',
    contentHash: sha256(text), sections: [{ section: 0, text, location: '0' }], warnings: [],
  }, voice.id);
  const indexingMs = performance.now() - indexedAt;
  const started = performance.now();
  await service.control(job.id, 'resume');
  let current, firstReadyWallMs = null, lastPrinted = 0;
  while (performance.now() - started < 600000) {
    current = await service.job(job.id);
    const ready = current.segments.filter(segment => segment.state === 'ready').length;
    if (ready && firstReadyWallMs === null) firstReadyWallMs = performance.now() - started;
    if (current.status === 'error') throw new Error(current.error || 'Reader generation failed');
    if (current.status === 'complete') break;
    if (performance.now() - lastPrinted >= 5000) {
      lastPrinted = performance.now();
      const progress = { root, ready, total: current.segments.length, elapsedSeconds: (performance.now() - started) / 1000 };
      await fsp.writeFile(path.join(root, 'progress.json'), JSON.stringify(progress));
      console.log(JSON.stringify(progress));
    }
    await delay(200);
  }
  const elapsedWallMs = performance.now() - started;
  assert.equal(current.status, 'complete', 'all reader sentences finished before timeout');
  assert.equal(perSegments.length, current.segments.length);
  const audioSeconds = current.segments.reduce((sum, segment) => sum + segment.duration, 0);
  const referenceAfter = sha256(await fsp.readFile(recording));
  assert.equal(referenceAfter, referenceBefore, 'original reference recording remains unchanged');
  const report = {
    ok: true, root, jobId: job.id, measuredAt: new Date().toISOString(),
    mode: 'Real reader service, CPU6, one sentence per audio file; cold worker startup included; concurrent cached-reading continuity test may also be running',
    sourceBenchmark: fixture.name, text, textSha256: sha256(text), indexingMs, elapsedWallMs,
    jobElapsedMs: current.elapsedMs, firstReadyWallMs, firstReadyPollingResolutionMs: 200,
    audioSeconds, realtimeFactor: elapsedWallMs / 1000 / audioSeconds,
    generationSecondsPerAudioMinute: elapsedWallMs / 1000 / audioSeconds * 60,
    engineSecondsPerAudioMinute: current.elapsedMs / 1000 / audioSeconds * 60,
    windowsPriorResult: baseline ? { synthesisSeconds: baseline.synthesis_s, audioSeconds: baseline.audio_s, generationSecondsPerAudioMinute: baseline.generation_seconds_per_audio_minute } : null,
    originalReferenceUnchanged: true, perSegments,
  };
  await fsp.writeFile(path.join(root, 'results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(async error => {
  console.error(error);
  await fsp.writeFile(path.join(root, 'failure.txt'), error.stack || String(error));
  process.exitCode = 1;
}).finally(async () => { if (service) await service.close(); else engine?.close(); });
