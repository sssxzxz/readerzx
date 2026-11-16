// Browser lifecycle regression checks: no model, file cache, or sound device needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { transformSync } = require('esbuild');

const code = transformSync(fs.readFileSync('src/lib/narrationPlayer.ts', 'utf8'), {
  loader: 'ts', format: 'cjs', target: 'es2022',
}).code;
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const abort = () => Object.assign(new Error('The play request was interrupted by pause'), { name: 'AbortError' });

function browser() {
  const contexts = [], media = [], urls = new Set();
  class Context {
    currentTime = 0;
    destination = {};
    sources = [];
    constructor() { contexts.push(this); }
    resume() { return Promise.resolve(); }
    close() { this.closed = true; return Promise.resolve(); }
    decodeAudioData() { return Promise.resolve({ duration: 2, length: 8, sampleRate: 24000, numberOfChannels: 1, getChannelData: () => new Float32Array(8) }); }
    createBufferSource() {
      const source = {
        playbackRate: {}, connected: false, stopped: false, startOffset: null, onended: null,
        connect() { this.connected = true; }, disconnect() { this.connected = false; },
        start(_when, offset) { this.startOffset = offset; }, stop() { this.stopped = true; },
        end() { assert.equal(this.stopped, false); this.onended?.(); },
      };
      this.sources.push(source); return source;
    }
  }
  class Media {
    currentTime = 0;
    paused = true;
    pending = null;
    onended = null;
    playbackRate = 1;
    defaultPlaybackRate = 1;
    resourceSelectionPending = false;
    constructor() { media.push(this); }
    set src(value) {
      this.sourceUrl = value;
      // Loading a new source resets the playback rate to its default. Resource
      // selection may complete after the caller's synchronous property writes.
      this.playbackRate = this.defaultPlaybackRate;
      this.resourceSelectionPending = true;
    }
    play() {
      if (this.resourceSelectionPending) { this.playbackRate = this.defaultPlaybackRate; this.resourceSelectionPending = false; }
      assert.equal(this.pending, null, 'previous play request settled'); this.pending = deferred(); return this.pending.promise;
    }
    settlePlay() { assert.ok(this.pending, 'a play request is pending'); const request = this.pending; this.pending = null; this.paused = false; request.resolve(); }
    pause() { this.paused = true; if (this.pending) { const request = this.pending; this.pending = null; request.reject(abort()); } }
    removeAttribute() {}
    load() { this.pause(); }
    end() { assert.equal(this.paused, false, 'media is playing'); this.onended?.(); }
  }
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, AudioContext: Context, Audio: Media,
    Blob, ArrayBuffer, Uint8Array, DataView, Promise,
    URL: { createObjectURL() { const id = 'audio:' + (urls.size + 1); urls.add(id); return id; }, revokeObjectURL(id) { urls.delete(id); } },
  });
  return { player: new module.exports.NarrationPlayer(), contexts, media, urls };
}
const audio = () => Promise.resolve(new Uint8Array([1, 2]));

async function normalPauseResume() {
  const { player, contexts } = browser(); let starts = 0;
  const playing = player.play('first', audio, 1, () => starts++); await tick();
  const context = contexts[0], source = context.sources[0];
  assert.equal(source.startOffset, 0); context.currentTime = 0.45; player.pause();
  assert.equal(source.stopped, true); assert.equal(source.connected, false);
  context.currentTime = 9; player.resume(); await tick();
  const resumed = context.sources[1]; assert.equal(resumed.startOffset, 0.45, 'resume starts at paused sample position');
  assert.equal(starts, 1, 'resume does not report a new sentence');
  resumed.end(); assert.equal(await playing, true); player.close();
}

async function pendingReadStop() {
  const { player, contexts } = browser(), read = deferred();
  const playing = player.play('slow-read', () => read.promise, 1);
  player.stop(); read.resolve(new Uint8Array([1]));
  assert.equal(await playing, false); assert.equal(contexts.flatMap(c => c.sources).length, 0, 'cancelled load never starts audio'); player.close();
}

async function rateThenPause() {
  const { player, media, urls } = browser(); let completion = 'pending';
  const playing = player.play('first', audio, 1).then(value => { completion = value; return value; }); await tick();
  player.setRate(1.5); const switched = media[0];
  assert.equal(switched.preservesPitch, true); assert.equal(switched.playbackRate, 1.5); assert.equal(switched.defaultPlaybackRate, 1.5);
  player.pause(); await tick();
  assert.equal(completion, 'pending', 'pausing pending media startup keeps sentence resumable');
  player.resume(); assert.ok(switched.pending, 'resume issues a fresh media play request');
  switched.settlePlay(); await tick(); switched.end(); assert.equal(await playing, true);
  assert.equal(urls.size, 0, 'completed media revokes its object URL'); player.close();
}

async function initialMediaRateSurvivesLoad() {
  const { player, media } = browser(); let starts = 0;
  const playing = player.play('first', audio, 1.5, () => starts++); await tick();
  const current = media[0]; assert.equal(current.playbackRate, 1.5, 'source loading preserves requested playback rate');
  assert.equal(current.defaultPlaybackRate, 1.5); assert.equal(current.preservesPitch, true);
  assert.equal(starts, 0, 'start is reported after media begins'); current.settlePlay(); await tick();
  assert.equal(starts, 1); player.setRate(0.8); assert.equal(current.playbackRate, 0.8);
  current.end(); assert.equal(await playing, true); player.close();
}

async function obsoletePauseRejection() {
  const { player, media } = browser(); let completion = 'pending';
  const playing = player.play('first', audio, 1).then(value => { completion = value; return value; }); await tick();
  player.setRate(1.5); const switched = media[0];
  // Browser rejects the interrupted request in a microtask, after resume is invoked.
  player.pause(); player.resume(); switched.settlePlay(); await tick();
  assert.equal(completion, 'pending', 'obsolete interruption does not cancel resumed media');
  assert.equal(switched.paused, false); switched.end(); assert.equal(await playing, true); player.close();
}

async function replacementDuringMediaStartup() {
  const { player, media, contexts, urls } = browser();
  const first = player.play('first', audio, 1); await tick(); player.setRate(1.5);
  assert.equal(media.length, 1); const replacement = player.play('replacement', audio, 1); await tick();
  assert.equal(await first, false); const active = contexts[0].sources.at(-1);
  assert.equal(active.stopped, false, 'late old play rejection does not stop replacement');
  assert.equal(urls.size, 0, 'replacement revokes obsolete media URL'); active.end(); assert.equal(await replacement, true); player.close();
}

async function cacheBoundAndReuse() {
  const { player } = browser(); const reads = new Map();
  const load = key => player.load(key, () => { reads.set(key, (reads.get(key) ?? 0) + 1); return audio(); });
  for (let i = 0; i < 16; i++) await load(String(i));
  await load('0'); await load('16'); await load('0');
  assert.equal(reads.get('0'), 1, 'recently used audio stays decoded');
  await load('1'); assert.equal(reads.get('1'), 2, 'oldest audio is evicted at 16 entries');
  await load('16'); assert.equal(reads.get('16'), 1, 'other recent audio is reused'); player.close();
}

(async () => {
  const checks = [];
  for (const check of [normalPauseResume, pendingReadStop, rateThenPause, initialMediaRateSurvivesLoad, obsoletePauseRejection, replacementDuringMediaStartup, cacheBoundAndReuse]) {
    await check(); checks.push(check.name);
  }
  console.log(JSON.stringify({ ok: true, checks }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
