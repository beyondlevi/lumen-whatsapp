/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    // The Lumen host runs the app in GeckoView (Firefox 156) or in the Android
    // system WebView (Chromium 95), so syntax and CSS are lowered for Chromium 95.
    target: ['chrome95', 'firefox115'],
    cssTarget: ['chrome95', 'firefox115'],
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
