// Builds must already exist. Uses an isolated profile and a generated TXT book.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const delay = ms => new Promise(r => setTimeout(r, ms));
const port = 19447;
const output = resolve('out/voice-ui-check');
mkdirSync(output, { recursive: true });
const fixturePath = resolve(output, 'voice-test.txt');
writeFileSync(fixturePath, Array.from({ length: 300 }, (_, i) => `第${i + 1}段：这是语音翻页测试内容，用于检查阅读器界面。`).join('\n'));
const pdfPath = resolve(output, 'retry-test.pdf');
const stream = 'BT /F1 24 Tf 50 700 Td (PDF retry test) Tj ET';
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
];
let pdf = '%PDF-1.4\n';
const offsets = [0];
objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
writeFileSync(pdfPath, pdf);
const fb2Path = resolve(output, 'cursor-test.fb2');
writeFileSync(fb2Path, `<?xml version="1.0" encoding="utf-8"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><genre>prose</genre><author><first-name>Test</first-name><last-name>Reader</last-name></author><book-title>Cursor Test</book-title><lang>zh</lang></title-info></description><body><section><title><p>光标测试</p></title>${'<p>这是用于测试全屏自动隐藏鼠标和电子书内页交互的文字。</p>'.repeat(100)}</section></body></FictionBook>`);
const env = { ...process.env, EREADER_REMOTE_DEBUGGING_PORT: String(port) };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const child = spawn(resolve('node_modules/electron/dist/electron.exe'),
  [resolve('.'), `--user-data-dir=${resolve(output, 'profile-' + Date.now())}`, '--disable-gpu', '--inspect=127.0.0.1:19448'],
  { env, windowsHide: true, stdio: 'ignore' });
let ws;
let mainWs;
const errors = [];

async function main() {
  let target;
  for (let n = 0; n < 80; n++) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
      target = targets.find(t => t.type === 'page' && t.url.includes('index.html'));
      if (target) break;
    } catch {}
    await delay(100);
  }
  assert.ok(target, 'Electron renderer started');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = e => {
    const message = JSON.parse(e.data);
    if (message.method === 'Runtime.exceptionThrown') {
      const description = message.params.exceptionDetails.exception?.description || JSON.stringify(message.params.exceptionDetails);
      errors.push(description); console.error('Renderer exception:', description);
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(new Error(`Timed out: ${method}`)); }, 10000);
    pending.set(key, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: key, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async (expression, timeout = 10000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`Timed out: ${expression}`);
  };
  const clickText = text => evaluate(`(() => {
    const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)});
    if (!b) throw new Error('Missing button'); b.click();
  })()`);
  await send('Runtime.enable');
  const openFile = file => evaluate(`(() => {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files: [{ path: ${JSON.stringify(file)} }] } });
    window.dispatchEvent(event);
  })()`);
  await waitFor(`document.body?.innerText.includes('书架')`);
  // Test-only inspector connection: inject native recognition events through
  // the actual preload bridge, without adding any production test IPC endpoint.
  const mainTargets = await fetch('http://127.0.0.1:19448/json/list').then(r => r.json());
  mainWs = new WebSocket(mainTargets[0].webSocketDebuggerUrl);
  await new Promise((r, j) => { mainWs.onopen = r; mainWs.onerror = j; });
  let mainId = 0;
  const mainPending = new Map();
  mainWs.onmessage = e => {
    const msg = JSON.parse(e.data);
    const request = mainPending.get(msg.id);
    if (!request) return;
    mainPending.delete(msg.id);
    clearTimeout(request.timer);
    if (msg.error || msg.result?.exceptionDetails) request.reject(new Error(JSON.stringify(msg)));
    else request.resolve(msg.result?.result?.value);
  };
  const mainEvaluate = expression => new Promise((resolve, reject) => {
    const id = ++mainId;
    const timer = setTimeout(() => { mainPending.delete(id); reject(new Error('Main inspector timeout')); }, 10000);
    mainPending.set(id, { resolve, reject, timer });
    mainWs.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  });
  await mainEvaluate(`globalThis.testElectron = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron');
    globalThis.testVoiceHandler = testElectron.ipcMain._invokeHandlers.get('voice:start');
    testElectron.ipcMain._invokeHandlers.set('voice:start', (e, id) => {
      globalThis.testVoiceSession = id; return testVoiceHandler(e, id);
    });`);
  const emitVoice = (command, transcript) => mainEvaluate(`testElectron.BrowserWindow.getAllWindows()[0].webContents.send('voice:event', {
    sessionId: testVoiceSession, state: 'listening', message: '测试识别', command: ${JSON.stringify(command)}, transcript: ${JSON.stringify(transcript)}
  })`);
  await evaluate(`window.testToneCount = 0; window.TestOriginalAudio = window.AudioContext;
    window.AudioContext = class extends window.TestOriginalAudio {
      createOscillator() { const o = super.createOscillator(); const start = o.start.bind(o); o.start = (...a) => { window.testToneCount++; return start(...a); }; return o; }
      createGain() { const g = super.createGain(); const connect = g.connect.bind(g); g.connect = (target, ...a) => target === this.destination ? target : connect(target, ...a); return g; }
    };`);
  await evaluate(`(() => {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files: [{ path: ${JSON.stringify(fixturePath)} }] } });
    window.dispatchEvent(event);
  })()`);
  await waitFor(`!!document.querySelector('button[title="返回首页"]') && document.body.innerText.includes('第1段')`);
  assert.equal(await evaluate(`document.querySelector('button[aria-pressed]')?.getAttribute('aria-pressed')`), 'false');
  const voiceButton = `document.querySelector('button[data-voice-state]')`;
  const toolbarHeight = await evaluate(`document.querySelector('[data-reader-toolbar]').offsetHeight`);
  await evaluate(`${voiceButton}.click()`);
  await waitFor(`${voiceButton}?.dataset.voiceState === 'starting'`);
  // Exercise cancel during startup; late worker output must not reactivate the UI.
  await evaluate(`${voiceButton}.click()`);
  await delay(1600);
  assert.equal(await evaluate(`${voiceButton}.dataset.voiceState`), 'idle');
  await evaluate(`${voiceButton}.click()`);
  await waitFor(`['error', 'listening'].includes(${voiceButton}?.dataset.voiceState)`, 25000);
  const status = await evaluate(`document.querySelector('[role="status"]').textContent`);
  console.log('Native status:', status);
  assert.equal(await evaluate(`!!document.querySelector('[data-voice-feedback]')`), true);
  await emitVoice('prev', '上一页');
  await waitFor(`document.querySelector('[data-voice-feedback]')?.textContent.includes('未执行')`);
  assert.equal(await evaluate('window.testToneCount'), 0, 'no sound on page boundary failure');
  await emitVoice('next', '下一页');
  await waitFor(`document.querySelector('[data-voice-feedback]')?.textContent.includes('已执行：下一页')`);
  await waitFor('window.testToneCount === 1');
  await emitVoice('prev', '上翻');
  await waitFor(`document.querySelector('[data-voice-feedback]')?.textContent.includes('已执行：上翻')`);
  await emitVoice('zoom-in', '字大一号');
  await waitFor(`document.querySelector('[data-voice-feedback]')?.textContent.includes('字号 24')`);
  await emitVoice('zoom-out', '字小一号');
  await waitFor(`document.querySelector('[data-voice-feedback]')?.textContent.includes('字号 22')`);
  await emitVoice('auto-start', '开始自动翻页');
  await waitFor(`document.body.innerText.includes('自动翻页中')`);
  await emitVoice('auto-stop', '停止自动翻页');
  await waitFor(`!document.body.innerText.includes('自动翻页中')`);
  await clickText('设置'); await clickText('语音控制');
  const soundToggle = `[...document.querySelectorAll('label')].find(e => e.textContent.includes('成功执行时播放音效')).querySelector('input')`;
  const feedbackToggle = `[...document.querySelectorAll('label')].find(e => e.textContent.includes('显示语音识别情况')).querySelector('input')`;
  assert.equal(await evaluate(`${soundToggle}.checked && ${feedbackToggle}.checked`), true, 'new settings default on');
  await evaluate(`${soundToggle}.click()`); await evaluate(`${feedbackToggle}.click()`);
  await waitFor(`!document.querySelector('[data-voice-feedback]')`);
  await evaluate(`document.querySelector('button[title="设置 (F10)"]').click()`);
  const toneCount = await evaluate('window.testToneCount');
  await emitVoice('zoom-in', '放大'); await delay(200);
  assert.equal(await evaluate('window.testToneCount'), toneCount, 'sound switch suppresses successful command audio');
  await delay(500);
  assert.deepEqual(await evaluate(`window.api.loadSettings().then(s => [s.voiceSoundEnabled, s.voiceShowRecognition])`), [false, false], 'settings saved');
  await clickText('设置'); await clickText('语音控制');
  await evaluate(`${soundToggle}.click()`); await evaluate(`${feedbackToggle}.click()`);
  const pagingToggle = `[...document.querySelectorAll('label')].find(e => e.textContent.includes('仅语音翻页')).querySelector('input')`;
  assert.equal(await evaluate(`${pagingToggle}.checked`), false, 'paging-only defaults off');
  await evaluate(`${pagingToggle}.click()`);
  await evaluate(`document.querySelector('button[title="设置 (F10)"]').click()`);
  const pagingToneCount = await evaluate('window.testToneCount');
  const fontBeforePagingOnly = await evaluate(`getComputedStyle(document.querySelector('.reader-content [data-start]')).fontSize`);
  for (const [command, transcript] of [['zoom-in', '放大'], ['zoom-out', '缩小'], ['auto-start', '开始自动翻页'], ['auto-stop', '停止自动翻页'], ['fullscreen-enter', '全屏'], ['fullscreen-exit', '退全'], ['voice-stop', '关闭语音控制']]) {
    await emitVoice(command, transcript);
    await waitFor(`document.querySelector('[data-voice-feedback]')?.textContent.includes('已忽略此口令')`);
  }
  await delay(300);
  assert.equal(await evaluate('window.testToneCount'), pagingToneCount, 'ignored commands do not play success sounds');
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.reader-content [data-start]')).fontSize`), fontBeforePagingOnly);
  assert.equal(await evaluate(`document.body.innerText.includes('自动翻页中')`), false);
  assert.equal(await evaluate('window.api.isFullscreen()'), false);
  assert.equal(await evaluate(`${voiceButton}.dataset.voiceState`), 'listening', 'voice-stop is blocked');
  await waitFor(`window.api.loadSettings().then(s => s.voicePagingOnly === true)`);
  assert.ok(await evaluate(`${voiceButton}.title.includes('仅语音翻页')`));
  for (const [command, transcript] of [['next', '下一页'], ['prev', '上一页'], ['next', '下翻'], ['prev', '上翻']]) {
    await emitVoice(command, transcript);
    await waitFor(`document.querySelector('[data-voice-feedback]')?.textContent.includes(${JSON.stringify('已执行：')} + ${JSON.stringify(transcript)})`);
  }
  await evaluate(`${voiceButton}.click()`);
  await waitFor(`${voiceButton}.dataset.voiceState === 'idle'`);
  await evaluate(`${voiceButton}.click()`);
  await waitFor(`${voiceButton}.dataset.voiceState === 'listening'`, 25000);
  await clickText('全屏');
  await waitFor(`!document.querySelector('[data-reader-toolbar]')`);
  await emitVoice('fullscreen-exit', '退全');
  await waitFor(`document.querySelector('[data-voice-feedback]')?.textContent.includes('已忽略此口令')`);
  assert.equal(await evaluate('window.api.isFullscreen()'), true, 'paging-only blocks exiting fullscreen by voice too');
  await evaluate(`${voiceButton}.click()`);
  await waitFor(`!${voiceButton}`);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }))`);
  await waitFor(`!!document.querySelector('[data-reader-toolbar]')`);
  await clickText('设置'); await clickText('语音控制');
  await evaluate(`${pagingToggle}.click()`);
  await evaluate(`document.querySelector('button[title="设置 (F10)"]').click()`);
  await evaluate(`${voiceButton}.click()`);
  await waitFor(`${voiceButton}.dataset.voiceState === 'listening'`, 25000);
  console.log('PASS: paging-only defaults off, persists, blocks other actions without sound, allows four paging phrases, and preserves both microphone buttons.');
  await emitVoice('fullscreen-enter', '全屏');
  await waitFor(`!document.querySelector('[data-reader-toolbar]')`);
  assert.equal(await evaluate('window.api.isFullscreen()'), true);
  await evaluate(`window.dispatchEvent(new MouseEvent('mousemove', { clientX: 120, clientY: 100 }))`);
  assert.equal(await evaluate(`document.body.classList.contains('cursor-hidden')`), false);
  await waitFor(`document.body.classList.contains('cursor-hidden')`, 5000);
  await evaluate(`window.dispatchEvent(new MouseEvent('mousemove', { clientX: 121, clientY: 100 }))`);
  await waitFor(`!document.body.classList.contains('cursor-hidden')`);
  await emitVoice('fullscreen-exit', '退全');
  await waitFor(`!!document.querySelector('[data-reader-toolbar]')`);
  assert.equal(await evaluate('window.api.isFullscreen()'), false);
  console.log('PASS: command actions, success-only audio, both saved switches, native fullscreen and idle cursor.');
  await send('Emulation.setDeviceMetricsOverride', { width: 720, height: 600, deviceScaleFactor: 1, mobile: false });
  await delay(200);
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), true, 'no horizontal overflow at 720px');
  assert.equal(await evaluate(`document.querySelector('[data-reader-toolbar]').offsetHeight`), toolbarHeight, 'voice and narrow window add no toolbar rows');
  assert.equal(toolbarHeight, 48);
  const screenshot = await send('Page.captureScreenshot');
  writeFileSync(resolve(output, 'voice-control.png'), Buffer.from(screenshot.data, 'base64'));
  if (await evaluate(`${voiceButton}.dataset.voiceState === 'listening'`)) {
    await clickText('全屏');
    await waitFor(`!document.querySelector('[data-reader-toolbar]')`);
    assert.equal(await evaluate(`getComputedStyle(${voiceButton}.parentElement).position`), 'absolute', 'immersive control does not consume reading height');
    await evaluate(`${voiceButton}.click()`);
    await waitFor(`!${voiceButton}`);
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }))`);
    await waitFor(`!!document.querySelector('[data-reader-toolbar]')`);
  }
  await evaluate(`document.querySelector('button[title="返回首页"]').click()`);
  await waitFor(`document.body.innerText.includes('书架')`);
  assert.equal(await evaluate(`!!document.querySelector('[role="status"]')`), false);
  await openFile(pdfPath);
  await waitFor(`!!document.querySelector('.pdfViewer .page canvas')`, 15000);
  await evaluate(`${voiceButton}.click()`);
  await waitFor(`${voiceButton}?.dataset.voiceState === 'listening'`, 25000);
  const pdfBefore = await evaluate(`document.querySelector('.pdfViewer .page').getBoundingClientRect().width`);
  await emitVoice('zoom-in', '字大一号');
  await waitFor(`document.querySelector('[data-voice-feedback]')?.textContent.includes('已执行：字大一号')`);
  assert.ok(await evaluate(`document.querySelector('.pdfViewer .page').getBoundingClientRect().width`) > pdfBefore);
  await emitVoice('voice-stop', '关闭语音控制');
  await waitFor(`${voiceButton}?.dataset.voiceState === 'idle'`);
  console.log('PASS: normal PDF renders.');
  await evaluate(`document.querySelector('button[title="返回首页"]').click()`);
  await waitFor(`document.body.innerText.includes('书架')`);
  // Stall only the first worker handshake; the real retry must create a fresh
  // worker and render this same PDF without any production test-only switches.
  await evaluate(`window.originalWorker = window.Worker; window.pdfWorkerCount = 0;
    window.Worker = class extends window.originalWorker {
      constructor(...args) { super(...args); this.stall = ++window.pdfWorkerCount === 1; }
      postMessage(...args) { if (!this.stall) super.postMessage(...args); }
    };`);
  await openFile(pdfPath);
  await waitFor(`window.pdfWorkerCount >= 2`, 15000);
  await waitFor(`!!document.querySelector('.pdfViewer .page canvas')`, 15000);
  console.log('PASS: deliberately stalled PDF worker recovers via a fresh worker.');
  await evaluate(`document.querySelector('button[title="返回首页"]').click()`);
  await waitFor(`document.body.innerText.includes('书架')`);
  await evaluate(`window.pdfWorkerCount = 0`);
  await openFile(pdfPath);
  await waitFor(`window.pdfWorkerCount === 1`);
  await waitFor(`!document.body.innerText.includes('正在加载...')`);
  await openFile(fixturePath);
  await waitFor(`!!document.querySelector('.reader-content [data-start]')`);
  await delay(6500);
  assert.equal(await evaluate(`window.pdfWorkerCount`), 1, 'cancelled PDF must not start a retry');
  assert.equal(await evaluate(`document.body.innerText.includes('无法打开 PDF')`), false);
  await evaluate(`window.Worker = window.originalWorker`);
  console.log('PASS: switching books cancels stalled PDF load without delayed errors.');
  await openFile(fb2Path);
  await waitFor(`document.querySelector('foliate-view')?.renderer?.getContents?.().some(c => c.doc?.body?.textContent.includes('光标测试'))`, 20000);
  // Deterministically reproduce a resize while the iframe has no body. A skipped
  // inner render must also skip its caller's visible-range/scroll calculation.
  await evaluate(`(() => {
    const renderer = document.querySelector('foliate-view').renderer;
    const doc = renderer.getContents()[0].doc;
    const body = doc.body;
    body.remove();
    try { renderer.render(); } finally { doc.documentElement.append(body); }
    renderer.render();
  })()`);
  await clickText('全屏');
  await waitFor(`!document.querySelector('[data-reader-toolbar]')`);
  await evaluate(`window.dispatchEvent(new MouseEvent('mousemove'))`);
  await waitFor(`document.body.classList.contains('cursor-hidden')`, 5000);
  const iframeCursor = `(() => { const d = document.querySelector('foliate-view').renderer.getContents()[0].doc; return d.defaultView.getComputedStyle(d.body).cursor; })()`;
  await waitFor(`${iframeCursor} === 'none'`);
  await evaluate(`(() => { const d = document.querySelector('foliate-view').renderer.getContents()[0].doc; d.dispatchEvent(new d.defaultView.MouseEvent('mousemove', { clientX: 20, clientY: 20 })); })()`);
  await waitFor(`!document.body.classList.contains('cursor-hidden') && ${iframeCursor} !== 'none'`);
  await evaluate(`(() => { const d = document.querySelector('foliate-view').renderer.getContents()[0].doc; d.dispatchEvent(new d.defaultView.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); })()`);
  await waitFor(`!!document.querySelector('[data-reader-toolbar]')`);
  assert.equal(await evaluate('window.api.isFullscreen()'), false);
  console.log('PASS: ebook iframe idle cursor, mouse reveal and Escape exit.');
  await evaluate(`(() => { const d = document.querySelector('foliate-view').renderer.getContents()[0].doc; d.dispatchEvent(new d.defaultView.KeyboardEvent('keydown', { key: 'F8', code: 'F8', bubbles: true })); })()`);
  await waitFor(`!document.querySelector('[data-reader-toolbar]')`);
  await clickText('退出全屏');
  await waitFor(`!!document.querySelector('[data-reader-toolbar]')`);
  console.log('PASS: merged F8 shortcut works while ebook content has focus.');
  await clickText('设置'); await clickText('语音控制');
  await evaluate(`${pagingToggle}.click()`);
  await waitFor(`window.api.loadSettings().then(s => s.voicePagingOnly === true)`);
  await send('Page.reload');
  await waitFor(`document.body?.innerText.includes('书架')`);
  await openFile(fixturePath);
  await waitFor(`!!document.querySelector('[data-reader-toolbar]')`);
  await clickText('设置'); await clickText('语音控制');
  assert.equal(await evaluate(`${pagingToggle}.checked`), true, 'paging-only restored after renderer reload');
  assert.equal(await evaluate(`${voiceButton}.dataset.voiceState`), 'idle', 'restoring preference does not activate microphone');
  console.log('PASS: paging-only preference survives reload and reopening a book.');
  assert.deepEqual(errors, []);
  console.log('PASS: default off, startup cancel, native status, narrow layout, return-home cleanup, no renderer exceptions.');
}

main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => {
  ws?.close();
  mainWs?.close();
  child.kill();
});
