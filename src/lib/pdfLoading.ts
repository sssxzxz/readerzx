export interface PdfLoadAttempt<T> {
  promise: Promise<T>;
  destroy: () => void;
  onProgress?: (progress: { loaded?: number; total?: number }) => void;
}

class PdfTimeoutError extends Error {
  name = 'PdfTimeoutError';
}

function waitForAttempt<T>(promise: Promise<T>, timeout: number, signal: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  let abort: () => void;
  const interrupted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new DOMException('PDF 打开已取消', 'AbortError'));
    timer = setTimeout(() => reject(new PdfTimeoutError(`PDF 解析超过 ${timeout / 1000} 秒`)), timeout);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  return Promise.race([promise, interrupted]).finally(() => {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  });
}

/** A timed-out attempt is destroyed before retrying with fresh data and a fresh worker. */
export async function loadPdfWithRetry<T>(
  data: Uint8Array,
  createAttempt: (data: Uint8Array, directWorker: boolean) => PdfLoadAttempt<T>,
  options: {
    signal: AbortSignal;
    onTask: (task: PdfLoadAttempt<T>) => void;
    onProgress: (progress: { loaded?: number; total?: number }, retry: boolean) => void;
    onRetry: () => void;
    initialTimeout?: number;
    retryTimeout?: number;
  },
): Promise<T> {
  for (const retry of [false, true]) {
    options.signal.throwIfAborted();
    const task = createAttempt(data.slice(), retry);
    options.onTask(task);
    task.onProgress = progress => options.onProgress(progress, retry);
    try {
      return await waitForAttempt(task.promise, retry ? options.retryTimeout ?? 45000 : options.initialTimeout ?? 6000, options.signal);
    } catch (error) {
      task.destroy();
      options.signal.throwIfAborted();
      if (retry || !(error instanceof PdfTimeoutError)) throw error;
      options.onRetry();
    }
  }
  throw new Error('PDF 加载失败');
}
