// FB2 coverage using an isolated profile and a small generated fixture.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
process.env.NARRATION_TEST_PORT ??= '19555';
const t = require('./verify-narration-ui.cjs');
const source = path.resolve(process.argv[2]);
const lines = ['春天的风很轻。', '窗外阳光正好。', '今天继续读书。', '路上鸟儿鸣叫。', '我们慢慢向前走。'];
const fixture = path.join(t.root, '两章点读测试.fb2');
fs.writeFileSync(fixture, `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><genre>prose</genre><author><first-name>朗读测试</first-name><last-name>作者</last-name></author><book-title>两章点读测试</book-title><lang>zh</lang></title-info><document-info><author><nickname>test</nickname></author><date>2026-11-16</date><id>reader-fb2-test</id><version>1.0</version></document-info></description>
<body><section id="first"><p>${lines[0]}</p><p>${lines[1]}</p></section><section id="second"><p>${lines[2]}</p><p>${lines[3]}</p><p>${lines[4]}</p></section></body>
<body name="notes"><section id="note1"><p>这是附注内容。</p></section></body>
</FictionBook>`);

async function clickDocumentText(text) {
  const point = await t.evaluate(`(()=>{
    const f=[...document.querySelector('foliate-view').renderer.getContents()].find(c=>c.doc.body.innerText.includes(${JSON.stringify(text)}));
    if(!f)throw Error('Text is not visible');const w=f.doc.createTreeWalker(f.doc.body,NodeFilter.SHOW_TEXT);let n;
    while(n=w.nextNode()){const i=n.textContent.indexOf(${JSON.stringify(text)});if(i>=0){const r=f.doc.createRange();r.setStart(n,i);r.setEnd(n,i+1);const b=r.getBoundingClientRect(),frame=f.doc.defaultView.frameElement.getBoundingClientRect();return {x:frame.left+b.left+b.width/2,y:frame.top+b.top+b.height/2}}}
    throw Error('Text node missing');
  })()`);
  await t.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await t.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await t.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
}

async function main() {
  const profile = path.join(t.root, 'profile'), narrationDir = path.join(profile, 'narration');
  fs.mkdirSync(path.join(narrationDir, 'voices'), { recursive: true });
  const config = JSON.parse(fs.readFileSync(path.join(source, 'profile/narration/settings.json'), 'utf8'));
  const voice = config.voices[0], reference = path.join(narrationDir, 'voices', voice.id + '.wav');
  fs.copyFileSync(voice.referenceFile, reference); voice.referenceFile = reference; config.voices = [voice];
  config.runtime.pythonPath = require('./narration-test-config.cjs').python();
  fs.writeFileSync(path.join(narrationDir, 'settings.json'), JSON.stringify(config));
  const store = JSON.parse(fs.readFileSync(path.join(source, 'profile/ereader.json'), 'utf8'));
  store.settings = { ...store.settings, narrationVoiceId: voice.id, narrationVoices: {}, narrationClickToRead: true, ttsRate: 1, fontSize: 36 };
  store.recent = []; store.progress = {}; store.bookSettings = {}; store.notes = {};
  fs.writeFileSync(path.join(profile, 'ereader.json'), JSON.stringify(store));
  await t.launch();
  await t.evaluate(`(()=>{
    window.__starts=[];window.__errors=[];
    window.addEventListener('error',e=>window.__errors.push(e.message));
    window.addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason)));
    window.addEventListener('narration-playback-start',e=>window.__starts.push(e.detail));
    const original=AudioBufferSourceNode.prototype.connect,gains=new WeakMap();
    AudioBufferSourceNode.prototype.connect=function(target,...args){if(target instanceof AudioDestinationNode){let gain=gains.get(this.context);if(!gain){gain=this.context.createGain();gain.gain.value=0;gain.connect(target);gains.set(this.context,gain)}return original.call(this,gain,...args)}return original.call(this,target,...args)};
  })()`);
  await t.openFile(fixture);
  await t.waitFor(`document.querySelector('foliate-view')?.renderer?.getContents?.().some(c=>c.doc.body?.innerText.includes('春天'))`);
  await t.clickText('声音与听书'); await t.clickText('生成整本书');
  await t.waitFor(`window.api.narration.state().then(s=>s.jobs.some(j=>j.format==='fb2'&&j.status==='complete'))`, 120000);
  const state = await t.evaluate('window.api.narration.state()');
  const job = await t.evaluate(`window.api.narration.job(${JSON.stringify(state.jobs.find(j => j.format === 'fb2').id)})`);
  assert.deepEqual(job.segments.map(segment => segment.text), lines, 'all main-body chapters extracted, supplemental note body excluded');
  assert.equal(new Set(job.segments.map(segment => segment.section)).size, 2, 'both unvisited FB2 sections indexed');
  assert.deepEqual(job.warnings, []);
  assert.ok(job.segments.every(segment => segment.state === 'ready' && segment.duration > 0 && segment.bytes > 44));
  await t.clickText('关闭'); await clickDocumentText('窗外');
  await t.waitFor('window.__starts.length>0');
  assert.equal((await t.evaluate('window.__starts[0]')).segment, 1, 'native text click starts the requested sentence');
  await t.waitFor('window.__starts.some(s=>s.segment===2)', 15000);
  await t.waitFor(`document.querySelector('foliate-view')?.renderer?.getContents?.().some(c=>c.doc.body?.innerText.includes('今天继续'))`);
  await t.clickText('停止');
  const observedErrors = await t.evaluate('window.__errors');
  const browserWarnings = observedErrors.filter(message => message === 'ResizeObserver loop completed with undelivered notifications.');
  const errors = observedErrors.filter(message => !browserWarnings.includes(message)); assert.deepEqual(errors, []);
  const screenshot = await t.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(t.root, 'fb2-reader.png'), Buffer.from(screenshot.data, 'base64'));
  const report = {
    ok: true, root: t.root, format: 'fb2', fixture, voiceId: voice.id, jobId: job.id,
    segments: job.segments.length, sections: 2, audioSeconds: job.segments.reduce((sum, segment) => sum + segment.duration, 0),
    clickedSegment: 1, continuedIntoNextSection: true, supplementalNotesExcluded: true, errors, browserWarnings,
    outputMode: 'Real generated WAVs; playback routing muted only in test; native click and navigation verified, not acoustic quality',
    unverifiedFormats: [{ format: 'mobi', reason: 'No local Calibre converter found; no fixture available' }, { format: 'azw3', reason: 'No local Calibre converter found; no fixture available' }],
  };
  fs.writeFileSync(path.join(t.root, 'extra-formats-results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); fs.writeFileSync(path.join(t.root, 'extra-formats-failure.txt'), error.stack); process.exitCode = 1; }).finally(t.shutdown);
