const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const DEBUG_URL = process.env.EREADER_DEBUG_URL || 'http://127.0.0.1:9333';
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

async function connect(webSocketDebuggerUrl) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    ws.onopen = resolveOpen;
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
      return new Promise((resolveSend, reject) => {
        const messageId = ++id;
        pending.set(messageId, { resolve: resolveSend, reject });
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
  await client.send('Page.enable');

  const evaluate = async (expression) => {
    const result = await client.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };

  await delay(800);
  const wasOpen = await evaluate(
    `!!document.querySelector('button[title="所有设置恢复默认"]')`,
  );
  if (!wasOpen) {
    await evaluate(`document.querySelector('button[title="设置 (F10)"]')?.click()`);
    await delay(150);
  }

  const originalValue = await evaluate(
    `document.querySelector('input[aria-label="设置窗口透明度"]')?.value || '100'`,
  );
  await evaluate(`(() => {
    const slider = document.querySelector('input[aria-label="设置窗口透明度"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '50');
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await delay(250);

  const metrics = await evaluate(`(() => {
    const slider = document.querySelector('input[aria-label="设置窗口透明度"]');
    const label = slider.closest('label');
    const header = label.parentElement;
    const title = header.querySelector('h3');
    const reset = header.querySelector('button[title="所有设置恢复默认"]');
    const panel = header.parentElement;
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      return { left: value.left, right: value.right, top: value.top, bottom: value.bottom };
    };
    const style = getComputedStyle(panel);
    return {
      value: slider.value,
      title: rect(title),
      label: rect(label),
      reset: rect(reset),
      backgroundColor: style.backgroundColor,
      backdropFilter: style.backdropFilter,
    };
  })()`);

  const screenshot = await client.send('Page.captureScreenshot', { format: 'png' });
  const outputDir = resolve('artifacts');
  mkdirSync(outputDir, { recursive: true });
  const outputPath = resolve(outputDir, 'settings-opacity-50.png');
  writeFileSync(outputPath, Buffer.from(screenshot.data, 'base64'));

  await evaluate(`(() => {
    const slider = document.querySelector('input[aria-label="设置窗口透明度"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '${originalValue}');
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await delay(150);
  if (!wasOpen) {
    await evaluate(`document.querySelector('button[title="设置 (F10)"]')?.click()`);
  }
  client.close();

  console.log({ metrics, outputPath });
  if (metrics.value !== '50') throw new Error('Opacity slider did not update.');
  if (metrics.title.right > metrics.label.left || metrics.label.right > metrics.reset.left) {
    throw new Error('Opacity controls overlap the settings header.');
  }
  if (!metrics.backgroundColor.includes('0.5')) {
    throw new Error(`Panel background is not 50% transparent: ${metrics.backgroundColor}`);
  }
  if (metrics.backdropFilter === 'none') throw new Error('Transparent panel has no backdrop blur.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
