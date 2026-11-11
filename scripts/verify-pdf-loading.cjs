const { buildSync } = require('esbuild');
const assert = require('node:assert/strict');
const { test } = require('node:test');
buildSync({ entryPoints: ['src/lib/pdfLoading.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: 'out/pdf-tests/loading.cjs' });
const { loadPdfWithRetry } = require('../out/pdf-tests/loading.cjs');
const pending = () => new Promise(() => {});
function options(signal = new AbortController().signal) {
  return { signal, onTask() {}, onProgress() {}, onRetry() {}, initialTimeout: 10, retryTimeout: 20 };
}
test('successful initial load does not retry or destroy active document', async () => {
  let calls = 0;
  assert.equal(await loadPdfWithRetry(new Uint8Array([1]), () => {
    calls++; return { promise: Promise.resolve('doc'), destroy: () => assert.fail() };
  }, options()), 'doc');
  assert.equal(calls, 1);
});
test('timeout destroys old attempt before retry and keeps an undetached data copy', async () => {
  const source = new Uint8Array([1, 2, 3]);
  let destroyed = false;
  const attempts = [];
  const result = await loadPdfWithRetry(source, (data, retry) => {
    attempts.push(retry);
    assert.deepEqual([...data], [1, 2, 3]);
    if (retry) assert.equal(destroyed, true);
    structuredClone(data, { transfer: [data.buffer] });
    return { promise: retry ? Promise.resolve('recovered') : pending(), destroy: () => { destroyed = true; } };
  }, options());
  assert.equal(result, 'recovered');
  assert.deepEqual(attempts, [false, true]);
  assert.deepEqual([...source], [1, 2, 3]);
});
test('final timeout destroys both attempts and stops', async () => {
  let destroyed = 0;
  await assert.rejects(loadPdfWithRetry(new Uint8Array(), () => ({ promise: pending(), destroy() { destroyed++; } }), options()), { name: 'PdfTimeoutError' });
  assert.equal(destroyed, 2);
});
test('invalid PDF fails immediately without retry', async () => {
  let count = 0;
  await assert.rejects(loadPdfWithRetry(new Uint8Array(), () => {
    count++; return { promise: Promise.reject(new Error('invalid PDF')), destroy() {} };
  }, options()), /invalid PDF/);
  assert.equal(count, 1);
});
test('cancel during loading destroys attempt and prevents delayed retry', async () => {
  const controller = new AbortController();
  let destroyed = 0, calls = 0;
  const result = loadPdfWithRetry(new Uint8Array(), () => {
    calls++; return { promise: pending(), destroy() { destroyed++; } };
  }, options(controller.signal));
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
  await new Promise(r => setTimeout(r, 30));
  assert.equal(calls, 1);
  assert.equal(destroyed, 1);
});
test('cancel before load creates no worker', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(loadPdfWithRetry(new Uint8Array(), () => assert.fail(), options(controller.signal)), { name: 'AbortError' });
});
