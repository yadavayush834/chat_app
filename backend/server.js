const express = require('express');
const http = require('node:http');
const { Server } = require('socket.io');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');
const { ethers } = require('ethers');
const multer = require('multer');
const path = require('node:path');
const fs = require('node:fs');
const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { openDatabase } = require('./db');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

const SESSION_AGE = 7 * 86400 * 1000;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const addressOf = (value) => {
  try {
    return ethers.getAddress(value);
  } catch {
    throw fail(400, 'Invalid account address.');
  }
};
const fail = (status, message) => Object.assign(new Error(message), { status });
const usernameOf = (value) => {
  if (typeof value !== 'string' || !/^[a-z0-9_]{3,24}$/.test(value.trim().toLowerCase()))
    throw fail(400, 'Use 3–24 letters, numbers, or underscores for your username.');
  return value.trim().toLowerCase();
};
function messagePayload({ clientId, receiver, content = '', attachmentId = null }) {
  return JSON.stringify({
    app: 'SecureChat',
    action: 'message',
    clientId,
    receiver,
    content,
    attachmentId,
  });
}

function createChatServer(options = {}) {
  const directory = options.directory || path.resolve(__dirname, process.env.DATA_DIR || 'data');
  const uploadDir = path.join(directory, 'uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const db = openDatabase(directory);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const app = express();
  const server = http.createServer(app);
  const origins = (
    options.origins ||
    process.env.CLIENT_ORIGIN ||
    'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5000,http://127.0.0.1:5000'
  )
    .split(',')
    .map((s) => s.trim());
  const allowedOrigin = (origin) => !origin || origins.includes(origin);
  const io = new Server(server, {
    cors: { origin: origins, credentials: true },
    maxHttpBufferSize: 64 * 1024,
    allowRequest: (req, callback) => callback(null, allowedOrigin(req.headers.origin)),
  });
  const challenges = new Map();
  const online = new Map();
  const cookieOptions = {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.SECURE_COOKIE === 'true',
    path: '/',
    maxAge: SESSION_AGE,
  };
  const sessionFrom = (headers) => {
    const token = (headers.cookie || '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('securechat_session='))
      ?.slice(19);
    if (!token) return null;
    return get(
      'SELECT address, token, expires FROM sessions WHERE token=? AND expires>?',
      hash(token),
      Date.now(),
    );
  };
  const userView = (user) => ({
    address: user.address,
    username: user.username,
    lastSeen: user.lastSeen,
    isOnline: (online.get(user.address)?.size || 0) > 0,
  });
  const friendsOf = (address) =>
    all(
      'SELECT u.* FROM users u JOIN friends f ON f.friend=u.address WHERE f.owner=? ORDER BY u.username',
      address,
    ).map((friend) => {
      const last = get(
        'SELECT * FROM messages WHERE (sender=? AND receiver=?) OR (sender=? AND receiver=?) ORDER BY createdAt DESC, rowid DESC LIMIT 1',
        address,
        friend.address,
        friend.address,
        address,
      );
      const unread = get(
        "SELECT COUNT(*) AS n FROM messages WHERE sender=? AND receiver=? AND status!='seen'",
        friend.address,
        address,
      ).n;
      return { ...userView(friend), lastMessage: last ? serialize(last) : null, unread };
    });
  const profile = (address) => ({
    ...userView(get('SELECT * FROM users WHERE address=?', address)),
    friends: friendsOf(address),
  });
  const friendship = (a, b) => !!get('SELECT 1 FROM friends WHERE owner=? AND friend=?', a, b);
  const serialize = (row) => ({
    ...row,
    attachment: row.attachmentId
      ? (() => {
          const file = get(
            'SELECT id,name,mime,size FROM attachments WHERE id=?',
            row.attachmentId,
          );
          return file ? { ...file, url: `/api/files/${file.id}` } : null;
        })()
      : null,
  });
  const requireAuth = (req, res, next) => {
    const session = sessionFrom(req.headers);
    if (!session)
      return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    req.session = session;
    next();
  };
  const notifyFriends = (address) => {
    const user = get('SELECT * FROM users WHERE address=?', address);
    if (!user) return;
    for (const friend of all('SELECT friend FROM friends WHERE owner=?', address))
      io.to(friend.friend).emit('presence', userView(user));
  };
  const receipt = (address, friend, status) => {
    if (!['delivered', 'seen'].includes(status) || !friendship(address, friend))
      throw fail(403, 'Conversation not available.');
    const rows = all(
      `SELECT id FROM messages WHERE receiver=? AND sender=? AND ${status === 'seen' ? "status!='seen'" : "status='sent'"}`,
      address,
      friend,
    );
    run(
      `UPDATE messages SET status=? WHERE receiver=? AND sender=? AND ${status === 'seen' ? "status!='seen'" : "status='sent'"}`,
      status,
      address,
      friend,
    );
    if (rows.length)
      io.to(friend)
        .to(address)
        .emit('receipt', { ids: rows.map((r) => r.id), status });
  };

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    );
    if (!allowedOrigin(req.headers.origin))
      return res.status(403).json({ error: 'Origin not allowed.' });
    next();
  });
  app.use(cors({ origin: origins, credentials: true }));
  app.use(express.json({ limit: '32kb' }));
  app.use(
    '/api',
    rateLimit({
      windowMs: 60000,
      limit: options.test ? 10000 : 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests. Try again in a minute.' },
    }),
  );
  const authLimit = rateLimit({
    windowMs: 60000,
    limit: options.test ? 10000 : 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Try again in a minute.' },
  });
  app.get('/api/health', (req, res) => res.json({ ok: true, storage: 'sqlite' }));
  app.post('/api/auth/challenge', authLimit, (req, res) => {
    const address = addressOf(req.body.address);
    const purpose = req.body.purpose;
    if (!['login', 'register'].includes(purpose)) throw fail(400, 'Invalid sign-in action.');
    const username = purpose === 'register' ? usernameOf(req.body.username) : null;
    if (purpose === 'login' && !get('SELECT 1 FROM users WHERE address=?', address))
      throw fail(404, 'No account matches that recovery phrase.');
    if (
      purpose === 'register' &&
      get('SELECT 1 FROM users WHERE username=? OR address=?', username, address)
    )
      throw fail(409, 'This username or account is already registered.');
    const id = randomUUID();
    const message = `SecureChat sign-in\nAction: ${purpose}\nAccount: ${address}\nUsername: ${username || ''}\nNonce: ${randomBytes(24).toString('hex')}`;
    challenges.set(id, { address, username, purpose, message, expires: Date.now() + 120000 });
    res.json({ id, message });
  });
  app.post('/api/auth/verify', authLimit, (req, res) => {
    const challenge = challenges.get(req.body.id);
    challenges.delete(req.body.id);
    if (!challenge || challenge.expires < Date.now())
      throw fail(401, 'Sign-in request expired. Please try again.');
    let recovered;
    try {
      recovered = ethers.verifyMessage(challenge.message, req.body.signature);
    } catch {
      throw fail(401, 'Invalid account signature.');
    }
    if (recovered !== challenge.address) throw fail(401, 'Account verification failed.');
    if (challenge.purpose === 'register') {
      try {
        run(
          'INSERT INTO users VALUES(?,?,?,?)',
          challenge.address,
          challenge.username,
          Date.now(),
          Date.now(),
        );
      } catch {
        throw fail(409, 'That username or account is already registered.');
      }
    }
    const token = randomBytes(32).toString('hex');
    run(
      'INSERT INTO sessions VALUES(?,?,?)',
      hash(token),
      challenge.address,
      Date.now() + SESSION_AGE,
    );
    res
      .cookie('securechat_session', token, cookieOptions)
      .json({ user: profile(challenge.address) });
  });
  app.get('/api/me', requireAuth, (req, res) => res.json({ user: profile(req.session.address) }));
  app.post('/api/auth/logout', requireAuth, (req, res) => {
    run('DELETE FROM sessions WHERE token=?', req.session.token);
    for (const socket of io.sockets.sockets.values())
      if (socket.data.sessionToken === req.session.token) socket.disconnect(true);
    res
      .clearCookie('securechat_session', { ...cookieOptions, maxAge: undefined })
      .json({ ok: true });
  });
  app.post('/api/friends', requireAuth, (req, res) => {
    const username = usernameOf(req.body.username);
    const user = get('SELECT * FROM users WHERE username=?', username);
    const address = req.session.address;
    if (!user) throw fail(404, 'No account with that username. Check the spelling and try again.');
    if (user.address === address) throw fail(400, 'You cannot add yourself.');
    db.exec('BEGIN');
    try {
      run('INSERT OR IGNORE INTO friends VALUES(?,?)', address, user.address);
      run('INSERT OR IGNORE INTO friends VALUES(?,?)', user.address, address);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    io.to(user.address).to(address).emit('friends_changed');
    res.json({ friend: userView(user), friends: friendsOf(address) });
  });
  app.get('/api/messages/:friend', requireAuth, (req, res) => {
    const friend = addressOf(req.params.friend),
      address = req.session.address;
    if (!friendship(address, friend)) throw fail(403, 'Conversation not available.');
    let before = Number(req.query.before || Number.MAX_SAFE_INTEGER);
    if (!Number.isFinite(before) || before < 0) throw fail(400, 'Invalid history cursor.');
    const messages = all(
      'SELECT * FROM messages WHERE ((sender=? AND receiver=?) OR (sender=? AND receiver=?)) AND createdAt<? ORDER BY createdAt DESC, rowid DESC LIMIT 51',
      address,
      friend,
      friend,
      address,
      before,
    );
    const hasMore = messages.length > 50;
    res.json({ messages: messages.slice(0, 50).reverse().map(serialize), hasMore });
  });
  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadDir,
      filename: (req, file, cb) => cb(null, randomUUID()),
    }),
    limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  });
  app.post(
    '/api/files/:friend',
    requireAuth,
    (req, res, next) => {
      try {
        const friend = addressOf(req.params.friend);
        if (!friendship(req.session.address, friend))
          throw fail(403, 'Add this person before sharing files.');
        req.friend = friend;
        next();
      } catch (error) {
        next(error);
      }
    },
    upload.single('file'),
    (req, res) => {
      if (!req.file) throw fail(400, 'Choose a file to attach.');
      const id = randomUUID();
      const safeImages = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
      const mime = safeImages.includes(req.file.mimetype)
        ? req.file.mimetype
        : 'application/octet-stream';
      const name = path.basename(req.file.originalname).slice(0, 180);
      try {
        run(
          'INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?)',
          id,
          req.session.address,
          req.friend,
          name,
          mime,
          req.file.size,
          req.file.filename,
          Date.now(),
        );
      } catch (error) {
        fs.unlinkSync(req.file.path);
        throw error;
      }
      res.json({ attachment: { id, name, mime, size: req.file.size, url: `/api/files/${id}` } });
    },
  );
  app.get('/api/files/:id', requireAuth, (req, res) => {
    const file = get('SELECT * FROM attachments WHERE id=?', req.params.id);
    if (!file || ![file.sender, file.receiver].includes(req.session.address))
      throw fail(404, 'Attachment not found.');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.type(file.mime);
    const disposition =
      file.mime.startsWith('image/') && !req.query.download ? 'inline' : 'attachment';
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    res.sendFile(path.join(uploadDir, file.diskName));
  });

  io.use((socket, next) => {
    const session = sessionFrom(socket.request.headers);
    if (!session) return next(new Error('Please sign in again.'));
    socket.data.address = session.address;
    socket.data.sessionToken = session.token;
    next();
  });
  io.on('connection', (socket) => {
    const address = socket.data.address;
    if (!online.has(address)) online.set(address, new Set());
    online.get(address).add(socket.id);
    socket.join(address);
    notifyFriends(address);
    for (const row of all(
      "SELECT DISTINCT sender FROM messages WHERE receiver=? AND status='sent'",
      address,
    ))
      receipt(address, row.sender, 'delivered');
    let eventCount = 0,
      eventWindow = Date.now();
    socket.use((packet, next) => {
      if (
        !get(
          'SELECT 1 FROM sessions WHERE token=? AND expires>?',
          socket.data.sessionToken,
          Date.now(),
        )
      )
        return socket.disconnect(true);
      if (Date.now() - eventWindow > 10000) {
        eventWindow = Date.now();
        eventCount = 0;
      }
      if (++eventCount > 80) return next(new Error('Slow down and try again.'));
      next();
    });
    socket.on('message', (data, ack = () => {}) => {
      try {
        if (!data || typeof data !== 'object') throw fail(400, 'Invalid message.');
        const receiver = addressOf(data.receiver);
        if (!friendship(address, receiver)) throw fail(403, 'Add this person before messaging.');
        const content = typeof data.content === 'string' ? data.content : '';
        const attachmentId = data.attachmentId || null;
        if (
          (!content.trim() && !attachmentId) ||
          content.length > 4000 ||
          !/^[\w-]{16,80}$/.test(data.clientId || '')
        )
          throw fail(400, 'Messages need text or a file and can contain up to 4,000 characters.');
        const payload = { receiver, clientId: data.clientId, content, attachmentId };
        let recovered;
        try {
          recovered = ethers.verifyMessage(messagePayload(payload), data.signature);
        } catch {
          throw fail(401, 'Invalid message signature.');
        }
        if (recovered !== address)
          throw fail(401, 'Message signature does not match your account.');
        if (
          attachmentId &&
          !get(
            'SELECT 1 FROM attachments WHERE id=? AND sender=? AND receiver=?',
            attachmentId,
            address,
            receiver,
          )
        )
          throw fail(400, 'Attachment does not belong to this conversation.');
        const existing = get(
          'SELECT * FROM messages WHERE sender=? AND clientId=?',
          address,
          data.clientId,
        );
        if (existing) {
          if (
            existing.receiver !== receiver ||
            existing.content !== content ||
            existing.attachmentId !== attachmentId
          )
            throw fail(409, 'Message ID already used.');
          return ack({ message: serialize(existing) });
        }
        const id = randomUUID();
        // Keep pagination cursors unique even for messages created in the same millisecond.
        const createdAt = Math.max(
          Date.now(),
          (get('SELECT MAX(createdAt) AS t FROM messages').t || 0) + 1,
        );
        const status = online.has(receiver) ? 'delivered' : 'sent';
        run(
          'INSERT INTO messages VALUES(?,?,?,?,?,?,?,?)',
          id,
          data.clientId,
          address,
          receiver,
          content,
          attachmentId,
          status,
          createdAt,
        );
        const message = serialize(get('SELECT * FROM messages WHERE id=?', id));
        io.to(address).to(receiver).emit('message', message);
        ack({ message });
      } catch (error) {
        if (typeof ack === 'function')
          ack({ error: error.status ? error.message : 'Message could not be saved. Try again.' });
      }
    });
    socket.on('typing', (data = {}) => {
      if (typeof data.receiver === 'string' && friendship(address, data.receiver))
        socket.to(data.receiver).emit('typing', { sender: address, active: data.active === true });
    });
    socket.on('read', (data = {}, ack = () => {}) => {
      try {
        receipt(address, addressOf(data.friend), 'seen');
        if (typeof ack === 'function') ack({ ok: true });
      } catch (error) {
        if (typeof ack === 'function') ack({ error: error.message });
      }
    });
    socket.on('disconnect', () => {
      online.get(address)?.delete(socket.id);
      if (online.get(address)?.size === 0) {
        online.delete(address);
        run('UPDATE users SET lastSeen=? WHERE address=?', Date.now(), address);
        notifyFriends(address);
      }
    });
  });
  const maintenance = setInterval(() => {
    const now = Date.now();
    for (const [id, c] of challenges) if (c.expires < now) challenges.delete(id);
    run('DELETE FROM sessions WHERE expires<?', now);
    for (const socket of io.sockets.sockets.values())
      if (!get('SELECT 1 FROM sessions WHERE token=?', socket.data.sessionToken))
        socket.disconnect(true);
    // Remove abandoned uploads, never files referenced by a message.
    for (const file of all(
      'SELECT * FROM attachments WHERE createdAt<? AND id NOT IN (SELECT attachmentId FROM messages WHERE attachmentId IS NOT NULL)',
      now - 86400000,
    )) {
      fs.rmSync(path.join(uploadDir, file.diskName), { force: true });
      run('DELETE FROM attachments WHERE id=?', file.id);
    }
  }, 60000);
  maintenance.unref();
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  const clientBuild = path.resolve(__dirname, '../client/dist');
  if (fs.existsSync(clientBuild)) {
    app.use(express.static(clientBuild));
    app.get('/{*path}', (req, res) => res.sendFile(path.join(clientBuild, 'index.html')));
  }
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status =
      error.code === 'LIMIT_FILE_SIZE'
        ? 413
        : error instanceof multer.MulterError
          ? 400
          : error.status || 500;
    if (status >= 500 && !options.test) console.error(error);
    res.status(status).json({
      error:
        error.code === 'LIMIT_FILE_SIZE'
          ? 'Files must be 5 MB or smaller.'
          : status >= 500
            ? 'Something went wrong. Please try again.'
            : error.message,
    });
  });
  async function close() {
    clearInterval(maintenance);
    await new Promise((resolve) => io.close(resolve));
    db.close();
  }
  return { app, server, io, db, close };
}
if (require.main === module) {
  const chat = createChatServer();
  chat.server.listen(process.env.PORT || 5000, process.env.HOST || '127.0.0.1', () =>
    console.log(`SecureChat → http://localhost:${process.env.PORT || 5000}`),
  );
  const shutdown = () => chat.close().then(() => process.exit(0));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
module.exports = { createChatServer, messagePayload };
