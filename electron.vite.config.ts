import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Foliate-js's pdf.js uses `new URL('vendor/pdfjs/${path}', import.meta.url)`
 * which Vite mistakenly treats as a glob and rejects. We use pdfjs-dist directly
 * for PDFs (PdfRenderer), so foliate's pdf.js is never executed at runtime.
 * This plugin replaces its source with a stub before Vite tries to parse it.
 */
function foliatePdfStubPlugin(): Plugin {
  return {
    name: 'foliate-pdf-stub',
    enforce: 'pre',
    load(id) {
      if (/foliate-js[\\/]pdf\.js$/.test(id)) {
        return `export const makePDF = async () => { throw new Error('PDF handled by PdfRenderer'); };`;
      }
      return null;
    },
  };
}

// A native fullscreen resize can reach Foliate's View while its iframe is
// navigating and has no body yet. Its load handler renders again when ready.
// Keep this compatibility guard in source rather than editing node_modules.
function foliateLoadingResizeGuard(): Plugin {
  return {
    name: 'foliate-loading-resize-guard',
    enforce: 'pre',
    transform(code, id) {
      if (!/foliate-js[\\/]paginator\.js$/.test(id)) return null;
      const guards: Array<[RegExp, string]> = [
        [/render\(layout\) \{\s*if \(!layout\) return/,
          'render(layout) {\n        if (!layout || !this.document?.documentElement || !this.document?.body) return'],
        [/render\(\) \{\s*if \(!this\.#view\) return/,
          'render() {\n        if (!this.#view?.document?.body) return'],
        [/#afterScroll\(reason\) \{/,
          '#afterScroll(reason) {\n        if (!this.#view?.document?.body) return'],
      ];
      for (const [target, replacement] of guards) {
        if (!target.test(code)) this.error('Foliate paginator changed: review the iframe readiness guards.');
        code = code.replace(target, replacement);
      }
      return code;
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: resolve(__dirname, 'electron/main.ts'),
        output: {
          format: 'cjs',
          entryFileNames: 'index.cjs',
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: resolve(__dirname, 'electron/preload.ts'),
        output: {
          format: 'cjs',
          entryFileNames: 'preload.cjs',
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    publicDir: resolve(__dirname, 'public'),
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@shared': resolve(__dirname, 'shared'),
      },
    },
    plugins: [foliatePdfStubPlugin(), foliateLoadingResizeGuard(), react()],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      rollupOptions: {
        input: resolve(__dirname, 'src/index.html'),
      },
    },
    server: {
      port: 5173,
      fs: {
        // 允许访问 foliate-js 等仓库根之外的文件（开发期）
        allow: [resolve(__dirname, '..'), resolve(__dirname)],
      },
    },
    optimizeDeps: {
      exclude: ['foliate-js'],
    },
  },
});
