const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Wallet } = require('ethers');
const { io } = require('socket.io-client');
const { createChatServer, messagePayload } = require('../server');
let chat, base, directory, alice, bob, eve;
const sockets = [];
async function request(route, { cookie, body, method = body ? 'POST' : 'GET' } = {}) {
  const response = await fetch(`${base}/api${route}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get('set-cookie')?.split(';')[0],
  };
}
async function register(username) {
  const wallet = Wallet.createRandom();
  const challenge = await request('/auth/challenge', {
    body: { address: wallet.address, purpose: 'register', username },
  });
  assert.equal(challenge.status, 200);
  const auth = await request('/auth/verify', {
    body: { id: challenge.data.id, signature: await wallet.signMessage(challenge.data.message) },
  });
  assert.equal(auth.status, 200);
  return { wallet, cookie: auth.cookie, address: wallet.address, username };
}
function connect(account) {
  const socket = io(base, {
    extraHeaders: { Cookie: account.cookie },
    forceNew: true,
    reconnection: false,
  });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}
async function send(socket, account, receiver, content, extra = {}) {
  const data = {
    clientId: randomUUID(),
    receiver: receiver.address,
    content,
    attachmentId: null,
    ...extra,
  };
  data.signature = await account.wallet.signMessage(messagePayload(data));
  return { data, response: await socket.timeout(3000).emitWithAck('message', data) };
}
function once(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${event}`)), 3000);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}
before(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'securechat-test-'));
  chat = createChatServer({ directory, test: true });
  await new Promise((resolve) => chat.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${chat.server.address().port}`;
  alice = await register('alice');
  bob = await register('bob');
  eve = await register('eve');
});
after(async () => {
  sockets.forEach((s) => s.disconnect());
  await chat.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('registration normalizes username and requires an authenticated session', async () => {
  const { cookie, wallet } = await register('Mixed_CASE');
  const me = await request('/me', { cookie });
  assert.equal(me.data.user.username, 'mixed_case');
  assert.equal(me.data.user.address, wallet.address);
  assert.equal((await request('/me')).status, 401);
});
test('invalid signatures, missing challenges, and reused challenges are rejected', async () => {
  const c = await request('/auth/challenge', {
    body: { address: alice.address, purpose: 'login' },
  });
  const signature = await alice.wallet.signMessage(c.data.message);
  assert.equal((await request('/auth/verify', { body: { id: c.data.id, signature } })).status, 200);
  assert.equal((await request('/auth/verify', { body: { id: c.data.id, signature } })).status, 401);
  const c2 = await request('/auth/challenge', {
    body: { address: alice.address, purpose: 'login' },
  });
  assert.equal(
    (
      await request('/auth/verify', {
        body: { id: c2.data.id, signature: await eve.wallet.signMessage(c2.data.message) },
      })
    ).status,
    401,
  );
  assert.equal(
    (await request('/auth/verify', { body: { id: randomUUID(), signature } })).status,
    401,
  );
});
test('registration rejects duplicate names and validates input', async () => {
  assert.equal(
    (
      await request('/auth/challenge', {
        body: { address: Wallet.createRandom().address, purpose: 'register', username: 'alice' },
      })
    ).status,
    409,
  );
  assert.equal(
    (await request('/auth/challenge', { body: { address: 'broken', purpose: 'login' } })).status,
    400,
  );
  assert.equal(
    (
      await request('/auth/challenge', {
        body: { address: Wallet.createRandom().address, purpose: 'register', username: '$bad' },
      })
    ).status,
    400,
  );
});
test('adding friends is mutual, idempotent, and blocks self/unknown usernames', async () => {
  assert.equal(
    (await request('/friends', { cookie: alice.cookie, body: { username: 'nobody' } })).status,
    404,
  );
  assert.equal(
    (await request('/friends', { cookie: alice.cookie, body: { username: 'alice' } })).status,
    400,
  );
  assert.equal(
    (await request('/friends', { cookie: alice.cookie, body: { username: 'bob' } })).status,
    200,
  );
  assert.equal(
    (await request('/friends', { cookie: alice.cookie, body: { username: 'bob' } })).data.friends
      .length,
    1,
  );
  assert.equal(
    (await request('/me', { cookie: bob.cookie })).data.user.friends[0].address,
    alice.address,
  );
});
test('history is private to a participant and requires a session', async () => {
  assert.equal((await request(`/messages/${bob.address}`)).status, 401);
  assert.equal((await request(`/messages/${bob.address}`, { cookie: eve.cookie })).status, 403);
  assert.equal(
    (await request(`/messages/${bob.address}?before=NaN`, { cookie: alice.cookie })).status,
    400,
  );
});
test('unauthenticated sockets cannot connect', async () => {
  const socket = io(base, { forceNew: true, reconnection: false });
  sockets.push(socket);
  const error = await once(socket, 'connect_error');
  assert.match(error.message, /sign in/);
});
test('offline sends persist, retries deduplicate, signatures cover every message field', async () => {
  const a = await connect(alice);
  const { data, response } = await send(a, alice, bob, 'Saved while you were away');
  assert.equal(response.message.status, 'sent');
  const retry = await a.timeout(3000).emitWithAck('message', data);
  assert.equal(retry.message.id, response.message.id);
  const tampered = await a.timeout(3000).emitWithAck('message', { ...data, content: 'tampered' });
  assert.match(tampered.error, /signature/);
  assert.equal(
    (await request(`/messages/${bob.address}`, { cookie: alice.cookie })).data.messages.length,
    1,
  );
  const stranger = await send(a, alice, eve, 'Not connected');
  assert.match(stranger.response.error, /Add this person/);
  a.disconnect();
});
test('live messaging, delivered/seen receipts and typing reach the right participant', async () => {
  const a = await connect(alice),
    b = await connect(bob);
  const inbound = once(b, 'message');
  const result = await send(a, alice, bob, 'Hello live');
  assert.equal(result.response.message.status, 'delivered');
  assert.equal((await inbound).content, 'Hello live');
  const typing = once(b, 'typing');
  a.emit('typing', { receiver: bob.address, active: true });
  assert.equal((await typing).sender, alice.address);
  const status = once(a, 'receipt');
  assert.equal((await b.timeout(3000).emitWithAck('read', { friend: alice.address })).ok, true);
  assert.equal((await status).status, 'seen');
  const e = await connect(eve);
  assert.match(
    (await e.timeout(3000).emitWithAck('read', { friend: alice.address })).error,
    /available/,
  );
  const history = (await request(`/messages/${bob.address}`, { cookie: alice.cookie })).data
    .messages;
  assert.equal(history.at(-1).status, 'seen');
  a.disconnect();
  b.disconnect();
  e.disconnect();
});
test('presence stays online with multiple tabs and offline messages deliver on reconnect', async () => {
  const b1 = await connect(bob),
    b2 = await connect(bob);
  b1.disconnect();
  const me = await request('/me', { cookie: alice.cookie });
  assert.equal(me.data.user.friends[0].isOnline, true);
  b2.disconnect();
  // An HTTP round trip lets disconnect delivery complete before checking persistence.
  await request('/health');
  const a = await connect(alice);
  await send(a, alice, bob, 'Reconnect me');
  const b3 = await connect(bob);
  const history = await request(`/messages/${alice.address}`, { cookie: bob.cookie });
  assert.ok(history.data.messages.every((m) => ['seen', 'delivered'].includes(m.status)));
  a.disconnect();
  b3.disconnect();
});
test('files require a participant session, retain names, and attach to signed messages', async () => {
  const form = new FormData();
  form.append('file', new Blob(['hello file']), 'hello.txt');
  const response = await fetch(`${base}/api/files/${bob.address}`, {
    method: 'POST',
    headers: { Cookie: alice.cookie },
    body: form,
  });
  assert.equal(response.status, 200);
  const { attachment } = await response.json();
  assert.equal(attachment.name, 'hello.txt');
  assert.equal((await fetch(`${base}${attachment.url}`)).status, 401);
  assert.equal(
    (await fetch(`${base}${attachment.url}`, { headers: { Cookie: eve.cookie } })).status,
    404,
  );
  const download = await fetch(`${base}${attachment.url}`, { headers: { Cookie: bob.cookie } });
  assert.equal(await download.text(), 'hello file');
  assert.match(download.headers.get('content-disposition'), /attachment/);
  const a = await connect(alice);
  const result = await send(a, alice, bob, '', { attachmentId: attachment.id });
  assert.equal(result.response.message.attachment.name, 'hello.txt');
  a.disconnect();
});
test('uploads reject missing/oversized files and unconnected recipients', async () => {
  const missing = await fetch(`${base}/api/files/${bob.address}`, {
    method: 'POST',
    headers: { Cookie: alice.cookie },
    body: new FormData(),
  });
  assert.equal(missing.status, 400);
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(5 * 1024 * 1024 + 1)]), 'large.bin');
  const tooLarge = await fetch(`${base}/api/files/${bob.address}`, {
    method: 'POST',
    headers: { Cookie: alice.cookie },
    body: form,
  });
  assert.equal(tooLarge.status, 413);
  assert.equal(
    (
      await fetch(`${base}/api/files/${eve.address}`, {
        method: 'POST',
        headers: { Cookie: alice.cookie },
        body: new FormData(),
      })
    ).status,
    403,
  );
});
test('history pagination is complete and ordered without cursor duplicates', async () => {
  const a = await connect(alice);
  for (let i = 0; i < 55; ++i)
    assert.ok((await send(a, alice, bob, `Page test ${i}`)).response.message);
  const recent = (await request(`/messages/${bob.address}`, { cookie: alice.cookie })).data;
  assert.equal(recent.messages.length, 50);
  assert.equal(recent.hasMore, true);
  const older = (
    await request(`/messages/${bob.address}?before=${recent.messages[0].createdAt}`, {
      cookie: alice.cookie,
    })
  ).data;
  assert.equal(older.hasMore, false);
  const ids = [...older.messages, ...recent.messages].map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(
    [...older.messages, ...recent.messages].filter((m) => m.content.startsWith('Page test')).length,
    55,
  );
  a.disconnect();
});
test('logout revokes both HTTP and live socket access', async () => {
  const account = await register('logout_test');
  const socket = await connect(account);
  const disconnected = once(socket, 'disconnect');
  assert.equal((await request('/auth/logout', { cookie: account.cookie, body: {} })).status, 200);
  await disconnected;
  assert.equal((await request('/me', { cookie: account.cookie })).status, 401);
});
test('unexpected browser origins are rejected', async () => {
  const response = await fetch(`${base}/api/me`, {
    headers: { Cookie: alice.cookie, Origin: 'https://unrelated.example' },
  });
  assert.equal(response.status, 403);
});
test('database persists through a complete server restart', async () => {
  sockets.forEach((s) => s.disconnect());
  await chat.close();
  chat = createChatServer({ directory, test: true });
  await new Promise((resolve) => chat.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${chat.server.address().port}`;
  assert.equal((await request('/me', { cookie: alice.cookie })).data.user.username, 'alice');
  assert.ok(
    (await request(`/messages/${bob.address}`, { cookie: alice.cookie })).data.messages.length >=
      50,
  );
});
