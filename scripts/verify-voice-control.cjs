// Run: node scripts/verify-voice-control.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const { buildSync } = require('esbuild');

buildSync({ entryPoints: ['electron/voiceController.ts', 'electron/voiceScript.ts'], bundle: true,
  platform: 'node', format: 'cjs', outdir: 'out/voice-tests', outExtension: { '.js': '.cjs' } });
const { VoiceController } = require('../out/voice-tests/voiceController.cjs');
const { voiceScript } = require('../out/voice-tests/voiceScript.cjs');
const commandLine = (command, text) => `command:${command}:${Buffer.from(text).toString('base64')}\n`;
const next = commandLine('next', '下一页');
const prev = commandLine('prev', '上一页');

function fixture(timeout = 20000) {
  const children = [], events = [];
  const controller = new VoiceController(() => {
    const child = new EventEmitter();
    Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(),
      exitCode: null, kill() { this.exitCode = 0; this.emit('exit', 0); } });
    children.push(child);
    return child;
  }, 'win32', timeout);
  return { controller, children, events, start(id = 1) { controller.start(id, e => events.push(e)); } };
}

test('waits for ready, handles split lines, emits one direction and throttles duplicate results', () => {
  const f = fixture();
  try {
    f.start();
    f.children[0].stdout.write(next + 'rea');
    assert.equal(f.events.length, 1);
    f.children[0].stdout.write('dy\r\n' + next + next);
    assert.equal(f.events[1].state, 'listening');
    assert.deepEqual(f.events.filter(e => e.direction).map(e => e.direction), ['next']);
  } finally { f.controller.stop(); }
});

test('previous direction, unknown output ignored', () => {
  const f = fixture();
  try {
    f.start(); f.children[0].stdout.write('ready\nunknown\n' + prev);
    assert.deepEqual(f.events.filter(e => e.direction).map(e => e.direction), ['prev']);
  } finally { f.controller.stop(); }
});

test('stop releases input and late process results cannot turn pages', () => {
  const f = fixture();
  f.start(); f.controller.stop();
  assert.equal(f.children[0].stdin.writableEnded, true);
  f.children[0].stdout.write('ready\n' + next);
  assert.equal(f.events.at(-1).state, 'idle');
  assert.equal(f.events.some(e => e.direction), false);
});

test('restart ignores previous process errors and stale commands', () => {
  const f = fixture();
  try {
    f.start(1); f.start(2);
    const count = f.events.length;
    f.children[0].stdout.write('ready\n' + next);
    f.children[0].emit('error', new Error('old error'));
    assert.equal(f.events.length, count);
    f.children[1].stdout.write('ready\n' + prev);
    assert.equal(f.events.at(-1).sessionId, 2);
    assert.equal(f.events.at(-1).direction, 'prev');
  } finally { f.controller.stop(); }
});

for (const code of ['no-recognizer', 'microphone', 'recognition']) {
  test(`native ${code} failure stops listening with useful error`, () => {
    const f = fixture(); f.start();
    f.children[0].stdout.write(`error:${code}\n`);
    assert.equal(f.events.at(-1).state, 'error');
    assert.ok(f.events.at(-1).message.length > 15);
    assert.equal(f.children[0].stdin.writableEnded, true);
    f.children[0].emit('exit', 0);
    assert.equal(f.events.at(-1).state, 'error');
  });
}

test('unexpected exit and failed spawn are visible', () => {
  const f = fixture(); f.start(); f.children[0].emit('exit', 1);
  assert.equal(f.events.at(-1).state, 'error');
  const events = [];
  new VoiceController(() => { throw new Error('spawn failed'); }, 'win32').start(1, e => events.push(e));
  assert.equal(events.at(-1).state, 'error');
});

test('startup timeout releases microphone process', async () => {
  const f = fixture(15); f.start();
  await new Promise(r => setTimeout(r, 40));
  assert.equal(f.events.at(-1).state, 'error');
  assert.equal(f.children[0].stdin.writableEnded, true);
});

test('unsupported platform never spawns', () => {
  let state;
  new VoiceController(() => assert.fail('must not spawn'), 'linux').start(1, e => { state = e.state; });
  assert.equal(state, 'error');
});

test('actual Windows helper maps all commands and rejects unapproved speech commands', { skip: process.platform !== 'win32' }, () => {
  const script = voiceScript.replace('[ReaderVoice]::Run()', `
    foreach ($text in @('下一页', '下翻', '上一页', '上翻', '字大一号', '字小一号', '放大', '缩小', '开始自动翻页', '停止自动翻页', '进入全屏', '退出全屏', '关闭语音控制', '全屏模式', '打开全屏', '全屏', '普通模式', '关闭全屏', '退全', '开始朗读', '请下一页', '其他', '退出', '不要放大')) {
      $direction = [ReaderVoice]::Direction($text)
      if ($null -eq $direction) { [Console]::WriteLine('ignored') }
      else { [Console]::WriteLine($direction) }
    }
  `);
  const result = spawnSync(resolve(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), ['next', 'next', 'prev', 'prev', 'zoom-in', 'zoom-out', 'zoom-in', 'zoom-out', 'auto-start', 'auto-stop', 'fullscreen-enter', 'fullscreen-exit', 'voice-stop', 'fullscreen-enter', 'fullscreen-enter', 'fullscreen-enter', 'fullscreen-exit', 'fullscreen-exit', 'fullscreen-exit', 'ignored', 'ignored', 'ignored', 'ignored', 'ignored']);
});

test('fullscreen aliases pass the native protocol, while standalone exit and negated commands do not', () => {
  for (const text of ['进入全屏', '全屏模式', '打开全屏', '全屏', '退出全屏', '普通模式', '关闭全屏', '退全']) {
    const f = fixture(); f.start();
    const command = ['进入全屏', '全屏模式', '打开全屏', '全屏'].includes(text) ? 'fullscreen-enter' : 'fullscreen-exit';
    try {
      f.children[0].stdout.write('ready\n' + commandLine('fullscreen-exit', '退出') + commandLine('zoom-in', '不要放大'));
      assert.equal(f.events.some(e => e.command), false);
      f.children[0].stdout.write(commandLine(command, text));
      assert.equal(f.events.at(-1).command, command);
      assert.equal(f.events.at(-1).transcript, text);
    } finally { f.controller.stop(); }
  }
});

test('recognition status is not a command; unknown or mismatched tokens cannot execute', () => {
  const f = fixture(); f.start();
  try {
    f.children[0].stdout.write('ready\nstatus:hearing\nstatus:unrecognized\n' + commandLine('zoom-in', '上一页') + commandLine('tts-start', '开始朗读'));
    assert.equal(f.events.at(-1).message, '未识别到有效口令，请再说一次');
    assert.equal(f.events.some(e => e.command), false);
    f.children[0].stdout.write(commandLine('zoom-in', '字大一号'));
    assert.equal(f.events.at(-1).command, 'zoom-in');
    assert.equal(f.events.at(-1).transcript, '字大一号');
  } finally { f.controller.stop(); }
});
