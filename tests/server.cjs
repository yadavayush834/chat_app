const { createChatServer } = require('../backend/server');
const { mkdtempSync, rmSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const directory = mkdtempSync(path.join(os.tmpdir(), 'securechat-browser-'));
const chat = createChatServer({ directory, test: true, origins: 'http://127.0.0.1:5088' });
chat.server.listen(5088, '127.0.0.1');
const close = () =>
  chat.close().then(() => {
    rmSync(directory, { recursive: true, force: true });
    process.exit();
  });
process.on('SIGTERM', close);
process.on('SIGINT', close);
