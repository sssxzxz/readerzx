const DEBUG_URL = process.env.EREADER_DEBUG_URL || 'http://127.0.0.1:9333';

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
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
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
  const page =
    targets.find((target) => target.type === 'page' && target.url.includes('index.html')) ||
    targets.find((target) => target.type === 'page');
  if (!page) throw new Error('No Electron page target found.');

  const client = await connect(page.webSocketDebuggerUrl);
  await client.send('Runtime.enable');

  const evaluate = async (expression) => {
    const result = await client.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed.');
    }
    return result.result.value;
  };

  const metricExpression = `
    (() => {
      const container = document.querySelector('.pdf-reader-container');
      const pages = [...document.querySelectorAll('.pdfViewer .page')];
      const center = container ? container.scrollTop + container.clientHeight / 2 : 0;
      let best = null;
      let distance = Infinity;
      for (const page of pages) {
        const candidateDistance = Math.abs((page.offsetTop + page.offsetHeight / 2) - center);
        if (candidateDistance < distance) {
          distance = candidateDistance;
          best = page;
        }
      }
      return {
        scrollTop: container?.scrollTop ?? -1,
        clientHeight: container?.clientHeight ?? -1,
        pages: pages.length,
        currentPage: best ? Number(best.dataset.pageNumber) : null,
        viewerHeight: document.querySelector('.pdfViewer')?.scrollHeight ?? null,
      };
    })()
  `;

  await delay(1000);
  const initial = await evaluate(metricExpression);
  console.log('initial', initial);

  for (let i = 0; i < 24; i += 1) {
    await evaluate(`
      (() => {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'PageDown',
          code: 'PageDown',
          bubbles: true,
          cancelable: true
        }));
        return true;
      })()
    `);
    await delay(80);
  }

  await delay(1400);
  const beforeResize = await evaluate(metricExpression);
  console.log('beforeResize', beforeResize);

  let resizedWithBrowserDomain = false;
  try {
    const windowInfo = await client.send('Browser.getWindowForTarget', {});
    await client.send('Browser.setWindowBounds', {
      windowId: windowInfo.windowId,
      bounds: { width: 1100, height: 720 },
    });
    resizedWithBrowserDomain = true;
  } catch (error) {
    console.log('browserResizeFailed', error.message);
    await evaluate('window.resizeTo(1100, 720)');
  }

  await delay(1600);
  const afterResize = await evaluate(metricExpression);
  console.log('afterResize', { ...afterResize, resizedWithBrowserDomain });
  client.close();

  if (beforeResize.currentPage === 1) {
    throw new Error('Verification did not scroll away from page 1.');
  }
  if (afterResize.currentPage === 1) {
    throw new Error('Resize returned the PDF to page 1.');
  }
  if (Math.abs(afterResize.currentPage - beforeResize.currentPage) > 2) {
    throw new Error(
      `Resize moved too far: page ${beforeResize.currentPage} -> ${afterResize.currentPage}.`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
