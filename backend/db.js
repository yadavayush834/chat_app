const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const path = require('node:path');

function openDatabase(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(directory, 'securechat.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS users (address TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, createdAt INTEGER NOT NULL, lastSeen INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS friends (owner TEXT REFERENCES users(address), friend TEXT REFERENCES users(address), PRIMARY KEY(owner, friend));
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, address TEXT REFERENCES users(address), expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, sender TEXT REFERENCES users(address), receiver TEXT REFERENCES users(address), name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, diskName TEXT NOT NULL, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, clientId TEXT NOT NULL, sender TEXT REFERENCES users(address), receiver TEXT REFERENCES users(address), content TEXT NOT NULL DEFAULT '', attachmentId TEXT REFERENCES attachments(id), status TEXT NOT NULL DEFAULT 'sent', createdAt INTEGER NOT NULL, UNIQUE(sender,clientId));
      CREATE INDEX IF NOT EXISTS conversation ON messages(sender,receiver,createdAt);
      CREATE INDEX IF NOT EXISTS message_time ON messages(createdAt);
      CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires);`);
  return db;
}
module.exports = { openDatabase };
