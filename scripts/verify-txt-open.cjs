const DEBUG_URL = process.env.EREADER_DEBUG_URL || 'http://127.0.0.1:9333';
const BOOK_TITLE = '谁让他修仙的！ 作者：最白的乌鸦';
const BOOK_ID = '4362a98f95a11de1fd7f0c27a2e927be1f859f4c';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  };
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const messageId = ++id;
        pending.set(messageId, { resolve, reject });
        ws.send(JSON.stringify({ id: messageId, method, params }));
      });
    },
    close() {
      ws.close();
    },
  };
}

async function main() {
  const targets = await fetch(`${DEBUG_URL}/json/list`).then((response) => response.json());
  const page = targets.find((target) => target.type === 'page' && target.url.includes('index.html'));
  if (!page) throw new Error('No Electron page target found.');
  const client = await connect(page.webSocketDebuggerUrl);
  await client.send('Runtime.enable');

  const evaluate = async (expression) => {
    const result = await client.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };

  const waitFor = async (expression, timeoutMs) => {
    const started = performance.now();
    while (performance.now() - started < timeoutMs) {
      if (await evaluate(expression)) return performance.now() - started;
      await delay(20);
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  };

  await waitFor(`document.body.innerText.includes('书架')`, 5000);
  const original = await evaluate(`Promise.all([
    window.api.loadProgress(${JSON.stringify(BOOK_ID)}),
    window.api.loadRecent(),
  ]).then(([progress, recent]) => ({
    progress,
    recent: recent.find((book) => book.id === ${JSON.stringify(BOOK_ID)}) || null,
  }))`);

  const openOnce = async (doubleClickAttempt) => {
    const started = performance.now();
    const clicked = await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')]
        .find((item) => item.title === ${JSON.stringify(BOOK_TITLE)});
      if (!button) return false;
      button.click();
      ${doubleClickAttempt ? 'button.click();' : ''}
      return true;
    })()`);
    if (!clicked) throw new Error('Could not find the target TXT on the shelf.');

    await delay(10);
    const loadingVisible = await evaluate(
      `document.body.innerText.includes('正在打开书籍…')`,
    );
    await waitFor(
      `!!document.querySelector('button[title="返回首页"]') &&
       Number(document.querySelector('.reader-content [data-start]')?.dataset.start || 0) > 2000000`,
      15000,
    );
    return { elapsedMs: Math.round(performance.now() - started), loadingVisible };
  };

  const first = await openOnce(true);
  await evaluate(`document.querySelector('button[title="返回首页"]')?.click()`);
  await waitFor(`document.body.innerText.includes('书架')`, 3000);
  const second = await openOnce(false);

  const beforePrev = await evaluate(
    `document.querySelector('.reader-content')?.innerText.slice(0, 120) || ''`,
  );
  const prevStarted = performance.now();
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'ArrowLeft',
    code: 'ArrowLeft',
    bubbles: true,
    cancelable: true,
  }))`);
  await waitFor(
    `(document.querySelector('.reader-content')?.innerText.slice(0, 120) || '') !== ${JSON.stringify(beforePrev)}`,
    3000,
  );
  const previousPageMs = Math.round(performance.now() - prevStarted);

  const state = await evaluate(`(() => ({
    title: document.body.innerText.includes(${JSON.stringify(BOOK_TITLE)}),
    hasReaderText: (document.querySelector('.reader-content')?.innerText.length || 0) > 0,
    error: document.body.innerText.includes('无法打开书籍'),
  }))()`);

  const restoredProgress = {
    ...(original.progress || {}),
    bookId: BOOK_ID,
    location: process.env.EREADER_RESTORE_TXT_LOCATION || original.progress?.location,
    percent: Number(process.env.EREADER_RESTORE_TXT_PERCENT || original.progress?.percent || 0),
    lastOpenedAt: Number(
      process.env.EREADER_RESTORE_TXT_PROGRESS_TIME || original.progress?.lastOpenedAt || Date.now(),
    ),
  };
  const restoredRecent = original.recent
    ? {
        ...original.recent,
        percent: restoredProgress.percent,
        lastOpenedAt: Number(
          process.env.EREADER_RESTORE_TXT_RECENT_TIME || original.recent.lastOpenedAt,
        ),
      }
    : null;
  // Let the reader's debounced progress write finish before restoring the
  // pre-test position, otherwise that pending write can win afterward.
  await delay(700);
  await evaluate(`(async () => {
    await window.api.saveProgress(${JSON.stringify(restoredProgress)});
    ${restoredRecent ? `await window.api.addRecent(${JSON.stringify(restoredRecent)});` : ''}
    return true;
  })()`);
  client.close();
  console.log({ first, second, previousPageMs, state });

  if (!state.title || !state.hasReaderText || state.error) {
    throw new Error('TXT did not reach a usable reading view.');
  }
  if (first.elapsedMs > 5000 || second.elapsedMs > 3000) {
    throw new Error(`TXT open is still too slow: ${first.elapsedMs}ms / ${second.elapsedMs}ms`);
  }
  if (previousPageMs > 1500) {
    throw new Error(`First previous-page action is too slow: ${previousPageMs}ms`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
