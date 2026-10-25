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

  await delay(1200);
  const initial = await evaluate(`(() => {
    const page = document.querySelector('.pdfViewer .page');
    return { pages: document.querySelectorAll('.pdfViewer .page').length, width: page?.offsetWidth };
  })()`);
  if (!initial.pages) throw new Error('PDF pages were not rendered.');

  await evaluate(`(() => {
    if (!document.querySelector('button[title="所有设置恢复默认"]')) {
      document.querySelector('button[title="设置 (F10)"]')?.click();
    }
  })()`);
  await delay(100);
  await evaluate(`(() => {
    [...document.querySelectorAll('button')]
      .find((item) => item.textContent.trim() === '显示')?.click();
  })()`);
  await delay(200);
  const initialPreference = await evaluate(`(() => {
    const toolbarText = [...document.querySelectorAll('button')]
      .map((item) => item.textContent.trim())
      .find((text) => text === '适宽' || text === '整页' || /^\\d+%$/.test(text));
    const sizeLabel = [...document.querySelectorAll('label')]
      .find((item) => item.textContent.includes('PDF 页面大小'));
    const marginLabel = [...document.querySelectorAll('label')]
      .find((item) => item.textContent.includes('PDF 页面间距'));
    return {
      mode: toolbarText === '整页' ? 'page' : /^\\d+%$/.test(toolbarText || '') ? 'custom' : 'width',
      scale: Number(sizeLabel?.parentElement?.querySelector('input[type="range"]')?.value || 100),
      margin: Number(marginLabel?.parentElement?.querySelector('input[type="range"]')?.value || 0),
    };
  })()`);
  const testScale = initialPreference.scale === 150 ? 165 : 150;
  const panelState = await evaluate(`(() => {
    const text = document.body.innerText;
    return {
      hasPdfSize: text.includes('PDF 页面大小'),
      hasFontSize: text.includes('字体大小（无上限）'),
      hasLineHeight: text.includes('行间距'),
    };
  })()`);

  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find((item) => item.textContent.trim() === '适合整页');
    button?.click();
  })()`);
  await delay(500);
  const fitPage = await evaluate(`(() => {
    const page = document.querySelector('.pdfViewer .page');
    return { width: page?.offsetWidth, toolbar: [...document.querySelectorAll('button')]
      .some((item) => item.textContent.trim() === '整页') };
  })()`);

  await evaluate(`(() => {
    const label = [...document.querySelectorAll('label')]
      .find((item) => item.textContent.includes('PDF 页面大小'));
    const slider = label?.parentElement?.querySelector('input[type="range"]');
    if (!slider) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '${testScale}');
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await delay(500);
  const custom = await evaluate(`(() => ({
    toolbar: [...document.querySelectorAll('button')]
      .some((item) => item.textContent.trim() === '${testScale}%'),
    width: document.querySelector('.pdfViewer .page')?.offsetWidth,
  }))()`);

  await evaluate(`(() => {
    const label = [...document.querySelectorAll('label')]
      .find((item) => item.textContent.includes('PDF 页面间距'));
    const slider = label?.parentElement?.querySelector('input[type="range"]');
    if (!slider) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, '60');
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await delay(300);
  const margin = await evaluate(`getComputedStyle(document.querySelector('.pdfViewer .page')).marginBottom`);

  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')]
      .find((item) => item.textContent.trim() === '翻页');
    button?.click();
  })()`);
  await delay(150);
  const hasPdfHighlightNote = await evaluate(
    `document.body.innerText.includes('当前不支持把拖动选择保存为书内高亮')`,
  );

  const restorePreference = {
    mode: process.env.EREADER_RESTORE_PDF_MODE || initialPreference.mode,
    scale: Number(process.env.EREADER_RESTORE_PDF_SCALE || initialPreference.scale),
    margin: Number(process.env.EREADER_RESTORE_PDF_MARGIN || initialPreference.margin),
  };
  await evaluate(`(() => {
    const setRange = (slider, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, String(value));
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    };
    [...document.querySelectorAll('button')]
      .find((item) => item.textContent.trim() === '显示')?.click();
    return true;
  })()`);
  await delay(100);
  await evaluate(`(() => {
    const setRange = (slider, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, String(value));
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const mode = ${JSON.stringify(restorePreference.mode)};
    const modeLabel = mode === 'page' ? '适合整页' : mode === 'custom' ? '自定义' : '适合宽度';
    [...document.querySelectorAll('button')]
      .find((item) => item.textContent.trim() === modeLabel)?.click();
    if (mode === 'custom') {
      const sizeLabel = [...document.querySelectorAll('label')]
        .find((item) => item.textContent.includes('PDF 页面大小'));
      const slider = sizeLabel?.parentElement?.querySelector('input[type="range"]');
      if (slider) setRange(slider, ${JSON.stringify(restorePreference.scale)});
    }
    const marginLabel = [...document.querySelectorAll('label')]
      .find((item) => item.textContent.includes('PDF 页面间距'));
    const marginSlider = marginLabel?.parentElement?.querySelector('input[type="range"]');
    if (marginSlider) setRange(marginSlider, ${JSON.stringify(restorePreference.margin)});
    return true;
  })()`);
  await delay(400);
  await evaluate(`(() => {
    if (document.querySelector('button[title="所有设置恢复默认"]')) {
      document.querySelector('button[title="设置 (F10)"]')?.click();
    }
  })()`);
  client.close();

  console.log({ initial, panelState, fitPage, custom, margin, hasPdfHighlightNote });
  if (!panelState.hasPdfSize || panelState.hasFontSize || panelState.hasLineHeight) {
    throw new Error('PDF settings panel still exposes ineffective text layout controls.');
  }
  if (!hasPdfHighlightNote) throw new Error('PDF highlight limitation is not explained.');
  if (!fitPage.toolbar || fitPage.width >= initial.width) {
    throw new Error('Fit-page mode did not resize the PDF page.');
  }
  if (!custom.toolbar || custom.width === fitPage.width) {
    throw new Error('Custom PDF zoom did not update the page and toolbar together.');
  }
  if (margin !== '60px') throw new Error(`PDF page spacing did not apply: ${margin}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
