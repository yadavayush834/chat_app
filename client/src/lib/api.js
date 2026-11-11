export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    ...options,
    headers:
      options.body instanceof FormData
        ? options.headers
        : { 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await response
    .json()
    .catch(() => ({ error: 'The server returned an unexpected response.' }));
  if (!response.ok)
    throw Object.assign(new Error(data.error || 'Request failed. Please try again.'), {
      status: response.status,
    });
  return data;
}
export const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
export function saveAccount(wallet, username) {
  // Remove permanent signing-key storage left by the original client.
  for (const key of ['privateKey', 'address', 'username']) localStorage.removeItem(key);
  // Signing keys are tab-scoped, never permanently stored in localStorage.
  sessionStorage.setItem(
    'securechat_account',
    JSON.stringify({ privateKey: wallet.privateKey, address: wallet.address, username }),
  );
}
export function readAccount() {
  try {
    return JSON.parse(sessionStorage.getItem('securechat_account'));
  } catch {
    return null;
  }
}
export function clearAccount() {
  sessionStorage.removeItem('securechat_account');
  for (const key of ['privateKey', 'address', 'username']) localStorage.removeItem(key);
}
export function messagePayload({ clientId, receiver, content = '', attachmentId = null }) {
  return JSON.stringify({
    app: 'SecureChat',
    action: 'message',
    clientId,
    receiver,
    content,
    attachmentId,
  });
}
export async function authenticate(wallet, purpose, username) {
  const challenge = await post('/auth/challenge', { address: wallet.address, purpose, username });
  const { user } = await post('/auth/verify', {
    id: challenge.id,
    signature: await wallet.signMessage(challenge.message),
  });
  saveAccount(wallet, user.username);
  return user;
}
