import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
const runtimeDeps = /^(cheerio|iconv-lite|jszip|mammoth|marked|xlsx|pdfjs-dist|@napi-rs\/canvas)(\/|$)/;
const DEV_NONCE = 'fanpost-dev';
const cspOf = (dev: boolean) => [
  "default-src 'self'",
  dev ? "script-src 'self' 'nonce-" + DEV_NONCE + "'" : "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https: http: fpimg: fpdoc:",
  "media-src 'self' data: blob: fpimg: fpdoc:",
  "font-src 'self' data:",
  dev ? "connect-src 'self' ws: fpimg: fpdoc:" : "connect-src 'self' fpimg: fpdoc:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
const cspPlugin: Plugin = {
  name: 'fanpost-csp',
  transformIndexHtml: {
    order: 'post',
    handler: (html: string, ctx) =>
      html.replace('<meta charset="UTF-8"/>', '<meta charset="UTF-8"/><meta http-equiv="Content-Security-Policy" content="' + cspOf(Boolean(ctx.server)) + '"/>'),
  },
};
export default defineConfig({
  main:{build:{outDir:'dist-electron/main',rollupOptions:{external:[runtimeDeps]}}},
  preload:{build:{outDir:'dist-electron/preload',rollupOptions:{output:{format:'cjs',entryFileNames:'[name].cjs'}}}},
  renderer:{root:'src/renderer',base:'./',build:{outDir:'dist'},html:{cspNonce:DEV_NONCE},plugins:[react(),cspPlugin]}
});
