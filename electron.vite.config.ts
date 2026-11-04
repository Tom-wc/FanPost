import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
const runtimeDeps = /^(cheerio|iconv-lite|jszip|mammoth|marked|xlsx|pdfjs-dist|@napi-rs\/canvas)(\/|$)/;
export default defineConfig({
  main:{build:{outDir:'dist-electron/main',rollupOptions:{external:[runtimeDeps]}}},
  preload:{build:{outDir:'dist-electron/preload',rollupOptions:{output:{format:'cjs',entryFileNames:'[name].cjs'}}}},
  renderer:{root:'src/renderer',base:'./',build:{outDir:'dist'},plugins:[react()]}
});
