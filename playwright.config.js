const { defineConfig } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const browserRoot = path.join(require('node:os').homedir(), '.cache/ms-playwright');
const localBrowser = fs.existsSync(browserRoot)
  ? fs
      .readdirSync(browserRoot)
      .filter((p) => /^chromium-\d+$/.test(p))
      .sort()
      .reverse()
      .map((p) => path.join(browserRoot, p, 'chrome-linux64/chrome'))
      .find((p) => fs.existsSync(p))
  : undefined;
module.exports = defineConfig({
  testDir: './tests',
  testMatch: '*.spec.js',
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5088',
    viewport: { width: 1440, height: 960 },
    launchOptions: localBrowser ? { executablePath: localBrowser } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node tests/server.cjs',
    url: 'http://127.0.0.1:5088/api/health',
    reuseExistingServer: false,
    timeout: 15000,
  },
});
