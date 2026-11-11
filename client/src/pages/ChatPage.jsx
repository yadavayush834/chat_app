import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronDown,
  Copy,
  FileText,
  Info,
  LoaderCircle,
  LogOut,
  MessageCircle,
  Paperclip,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Smile,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import { Wallet } from 'ethers';
import { api, post, readAccount, clearAccount, messagePayload } from '../lib/api';
import Avatar from '../components/Avatar';
import Brand from '../components/Brand';

const EMPTY_MESSAGES = [];
const fileSize = (size) =>
  size < 1024
    ? `${size} B`
    : size < 1048576
      ? `${(size / 1024).toFixed(1)} KB`
      : `${(size / 1048576).toFixed(1)} MB`;
const statusOrder = { pending: 0, failed: 0, sent: 1, delivered: 2, seen: 3 };
function mergeMessages(old = [], incoming = []) {
  const next = [...old];
  for (const message of incoming) {
    const index = next.findIndex((m) => m.id === message.id || m.clientId === message.clientId);
    if (index < 0) next.push(message);
    else
      next[index] = {
        ...next[index],
        ...message,
        status:
          (statusOrder[next[index].status] || 0) > (statusOrder[message.status] || 0)
            ? next[index].status
            : message.status,
      };
  }
  return next.sort((a, b) => a.createdAt - b.createdAt);
}
const timeOf = (date) =>
  new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const shortDate = (date) =>
  new Date(date).toLocaleDateString([], { month: 'short', day: 'numeric' });
const preview = (message) =>
  message
    ? message.content ||
      (message.attachment?.mime?.startsWith('image/')
        ? 'Photo'
        : message.attachment?.name || 'Attachment')
    : 'Say hello. Start something good.';
function lastSeen(friend) {
  if (friend?.isOnline) return 'Online now';
  if (!friend?.lastSeen) return 'Offline';
  const diff = Date.now() - friend.lastSeen;
  return diff < 60000
    ? 'Last seen just now'
    : diff < 3600000
      ? `Last seen ${Math.floor(diff / 60000)}m ago`
      : `Last seen ${shortDate(friend.lastSeen)}`;
}
function Attachment({ attachment }) {
  if (!attachment) return null;
  return (
    <div className="message-attachment">
      {attachment.mime.startsWith('image/') && (
        <a href={attachment.url} target="_blank" rel="noreferrer">
          <img src={attachment.url} alt={attachment.name} loading="lazy" />
        </a>
      )}
      <a className="file-link" href={`${attachment.url}?download=1`}>
        <FileText size={19} />
        <span>
          <strong>{attachment.name}</strong>
          <small>{fileSize(attachment.size)}</small>
        </span>
        <ArrowDownToLine size={16} />
      </a>
    </div>
  );
}
function Modal({ title, close, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="modal-top">
        <h2>{title}</h2>
        <button className="icon-button" onClick={close} aria-label="Close dialog">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export default function ChatPage() {
  const navigate = useNavigate();
  const [account] = useState(readAccount);
  const wallet = useMemo(() => {
    try {
      return account ? new Wallet(account.privateKey) : null;
    } catch {
      return null;
    }
  }, [account]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [friends, setFriends] = useState([]);
  const [active, setActive] = useState(null);
  const [conversations, setConversations] = useState({});
  const [historyLoading, setHistoryLoading] = useState(false);
  const [hasMore, setHasMore] = useState({});
  const [query, setQuery] = useState('');
  const [messageQuery, setMessageQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [typing, setTyping] = useState({});
  const [dialog, setDialog] = useState(null);
  const [friendName, setFriendName] = useState('');
  const [friendError, setFriendError] = useState('');
  const [adding, setAdding] = useState(false);
  const [attachment, setAttachment] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const socketRef = useRef(null);
  const activeRef = useRef(null);
  const typingTimer = useRef(null);
  const lastTypingAt = useRef(0);
  const typingExpiry = useRef({});
  const uploadController = useRef(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const shouldScroll = useRef(true);
  const friend = friends.find((f) => f.address === active);
  const messages = conversations[active] || EMPTY_MESSAGES;
  const draft = drafts[active] || '';
  const refresh = useCallback(async () => {
    const { user: me } = await api('/me');
    setUser(me);
    setFriends(me.friends);
    return me;
  }, []);
  const loadHistory = useCallback(async (address, signal) => {
    const data = await api(`/messages/${address}`, { signal });
    setConversations((old) => ({ ...old, [address]: mergeMessages(old[address], data.messages) }));
    setHasMore((old) => ({ ...old, [address]: data.hasMore }));
    if (activeRef.current === address && !document.hidden)
      socketRef.current?.emit('read', { friend: address });
  }, []);
  useEffect(() => {
    if (!wallet) {
      navigate('/login', { replace: true });
      return;
    }
    let disposed = false;
    const controller = new AbortController();
    let socket;
    api('/me', { signal: controller.signal })
      .then(({ user: me }) => {
        if (disposed) return;
        if (me.address !== wallet.address) {
          clearAccount();
          navigate('/login', { replace: true });
          return;
        }
        setUser(me);
        setFriends(me.friends);
        setLoading(false);
        socket = io({ withCredentials: true });
        socketRef.current = socket;
        socket.on('connect', () => {
          setConnected(true);
          setError((current) => (current.startsWith('Connection interrupted.') ? '' : current));
          refresh().catch((err) => setError(err.message));
          if (activeRef.current)
            loadHistory(activeRef.current).catch((err) => setError(err.message));
        });
        socket.on('disconnect', () => setConnected(false));
        socket.on('connect_error', (err) => {
          setConnected(false);
          setError(
            err.message === 'Please sign in again.'
              ? 'Your session expired. Sign out and sign back in.'
              : 'Connection interrupted. Reconnecting automatically…',
          );
        });
        socket.on('friends_changed', () => refresh().catch((err) => setError(err.message)));
        socket.on('presence', (update) =>
          setFriends((old) =>
            old.map((f) => (f.address === update.address ? { ...f, ...update } : f)),
          ),
        );
        socket.on('message', (message) => {
          const other = message.sender === wallet.address ? message.receiver : message.sender;
          setConversations((old) => ({ ...old, [other]: mergeMessages(old[other], [message]) }));
          const reading = activeRef.current === other && !document.hidden;
          setFriends((old) =>
            old.map((f) =>
              f.address === other
                ? {
                    ...f,
                    lastMessage: message,
                    unread:
                      message.sender !== wallet.address ? (reading ? 0 : f.unread + 1) : f.unread,
                  }
                : f,
            ),
          );
          if (message.sender !== wallet.address && reading) socket.emit('read', { friend: other });
          setTyping((old) => ({ ...old, [other]: false }));
        });
        socket.on('receipt', ({ ids, status }) => {
          setConversations((old) =>
            Object.fromEntries(
              Object.entries(old).map(([address, list]) => [
                address,
                list.map((m) =>
                  ids.includes(m.id) && statusOrder[status] > statusOrder[m.status]
                    ? { ...m, status }
                    : m,
                ),
              ]),
            ),
          );
          setFriends((old) =>
            old.map((f) =>
              f.lastMessage &&
              ids.includes(f.lastMessage.id) &&
              statusOrder[status] > statusOrder[f.lastMessage.status]
                ? {
                    ...f,
                    lastMessage: { ...f.lastMessage, status },
                    unread: status === 'seen' && f.address === activeRef.current ? 0 : f.unread,
                  }
                : f,
            ),
          );
        });
        socket.on('typing', ({ sender, active: isTyping }) => {
          setTyping((old) => ({ ...old, [sender]: isTyping }));
          clearTimeout(typingExpiry.current[sender]);
          typingExpiry.current[sender] = setTimeout(
            () => setTyping((old) => ({ ...old, [sender]: false })),
            3000,
          );
        });
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        if (err.status === 401) {
          clearAccount();
          navigate('/login', { replace: true });
        } else {
          setError(err.message);
          setLoading(false);
        }
      });
    const expiryTimers = typingExpiry.current;
    const visibility = () => {
      if (!document.hidden && activeRef.current) {
        socket?.emit('read', { friend: activeRef.current });
        setFriends((old) =>
          old.map((f) => (f.address === activeRef.current ? { ...f, unread: 0 } : f)),
        );
      }
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      disposed = true;
      controller.abort();
      socket?.disconnect();
      socketRef.current = null;
      clearTimeout(typingTimer.current);
      Object.values(expiryTimers).forEach(clearTimeout);
      uploadController.current?.abort();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [wallet, navigate, refresh, loadHistory]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    api(`/messages/${active}`, { signal: controller.signal })
      .then((data) => {
        setConversations((old) => ({
          ...old,
          [active]: mergeMessages(old[active], data.messages),
        }));
        setHasMore((old) => ({ ...old, [active]: data.hasMore }));
        if (activeRef.current === active && !document.hidden)
          socketRef.current?.emit('read', { friend: active });
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [active, loadHistory]);
  useEffect(() => {
    if (shouldScroll.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, active, typing, historyLoading]);
  function selectFriend(address) {
    if (address === activeRef.current) return;
    if (activeRef.current)
      socketRef.current?.emit('typing', { receiver: activeRef.current, active: false });
    uploadController.current?.abort();
    setUploading(false);
    setAttachment(null);
    activeRef.current = address;
    setActive(address);
    setHistoryLoading(!!address);
    setMessageQuery('');
    setShowSearch(false);
    setEmojiOpen(false);
    shouldScroll.current = true;
    lastTypingAt.current = 0;
    setFriends((old) => old.map((f) => (f.address === address ? { ...f, unread: 0 } : f)));
  }
  async function addFriend(event) {
    event.preventDefault();
    setFriendError('');
    setAdding(true);
    try {
      const data = await post('/friends', { username: friendName.replace(/^@/, '').trim() });
      setFriends(data.friends);
      selectFriend(data.friend.address);
      setDialog(null);
      setFriendName('');
    } catch (err) {
      setFriendError(err.message);
    } finally {
      setAdding(false);
    }
  }
  function updateDraft(value) {
    setDrafts((old) => ({ ...old, [active]: value }));
    const now = performance.now();
    if (!value.trim() || now - lastTypingAt.current > 1000 || lastTypingAt.current === 0) {
      socketRef.current?.emit('typing', { receiver: active, active: !!value.trim() });
      lastTypingAt.current = now;
    }
    clearTimeout(typingTimer.current);
    const receiver = active;
    typingTimer.current = setTimeout(
      () => socketRef.current?.emit('typing', { receiver, active: false }),
      1500,
    );
  }
  async function transmit(message) {
    const other = message.receiver;
    try {
      const signature = await wallet.signMessage(messagePayload(message));
      if (!socketRef.current?.connected)
        throw new Error('You’re offline. Reconnect, then retry your message.');
      const response = await socketRef.current.timeout(8000).emitWithAck('message', {
        clientId: message.clientId,
        receiver: other,
        content: message.content,
        attachmentId: message.attachmentId,
        signature,
      });
      if (response.error) throw new Error(response.error);
      setConversations((old) => ({
        ...old,
        [other]: mergeMessages(old[other], [response.message]),
      }));
    } catch (err) {
      setConversations((old) => ({
        ...old,
        [other]: (old[other] || []).map((m) =>
          m.clientId === message.clientId && ['pending', 'failed'].includes(m.status)
            ? { ...m, status: 'failed' }
            : m,
        ),
      }));
      setError(err.message || 'Message timed out. Retry to check delivery.');
    }
  }
  function handleSend(event) {
    event?.preventDefault();
    if (!active || (!draft.trim() && !attachment) || uploading || !connected) return;
    const clientId = crypto.randomUUID();
    const message = {
      id: clientId,
      clientId,
      sender: wallet.address,
      receiver: active,
      content: draft.trim(),
      attachmentId: attachment?.id || null,
      attachment,
      createdAt: Math.round(performance.timeOrigin + event.timeStamp),
      status: 'pending',
    };
    setConversations((old) => ({ ...old, [active]: mergeMessages(old[active], [message]) }));
    setDrafts((old) => ({ ...old, [active]: '' }));
    setAttachment(null);
    setEmojiOpen(false);
    shouldScroll.current = true;
    socketRef.current?.emit('typing', { receiver: active, active: false });
    transmit(message);
    inputRef.current?.focus();
  }
  async function uploadFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !active) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('Files must be 5 MB or smaller.');
      return;
    }
    const receiver = active;
    const controller = new AbortController();
    uploadController.current = controller;
    setUploading(true);
    setError('');
    try {
      const body = new FormData();
      body.append('file', file);
      const data = await api(`/files/${receiver}`, {
        method: 'POST',
        body,
        signal: controller.signal,
      });
      if (activeRef.current === receiver) setAttachment(data.attachment);
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      if (uploadController.current === controller) setUploading(false);
    }
  }
  async function older() {
    if (!active || !messages.length || historyLoading) return;
    const address = active;
    const box = scrollRef.current;
    const height = box.scrollHeight;
    setHistoryLoading(true);
    shouldScroll.current = false;
    try {
      const data = await api(`/messages/${address}?before=${messages[0].createdAt}`);
      setConversations((old) => ({
        ...old,
        [address]: mergeMessages(old[address], data.messages),
      }));
      setHasMore((old) => ({ ...old, [address]: data.hasMore }));
      requestAnimationFrame(() => {
        if (box && activeRef.current === address) box.scrollTop += box.scrollHeight - height;
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setHistoryLoading(false);
    }
  }
  async function logout() {
    try {
      await post('/auth/logout', {});
      clearAccount();
      navigate('/login');
    } catch (err) {
      if (err.status === 401) {
        clearAccount();
        navigate('/login');
      } else setError('Could not sign out. Check your connection and try again.');
    }
  }
  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(user.address);
      setCopied(true);
    } catch {
      setError('Clipboard unavailable. You can select and copy the address.');
    }
  }
  const sortedFriends = [...friends]
    .filter((f) => f.username.includes(query.trim().toLowerCase().replace(/^@/, '')))
    .sort((a, b) => (b.lastMessage?.createdAt || 0) - (a.lastMessage?.createdAt || 0));
  const shownMessages = messages.filter(
    (m) =>
      !messageQuery ||
      `${m.content} ${m.attachment?.name || ''}`.toLowerCase().includes(messageQuery.toLowerCase()),
  );
  if (loading)
    return (
      <main className="loading-screen">
        <Brand />
        <LoaderCircle className="spin" />
        <p>Opening your conversations…</p>
      </main>
    );
  if (!user)
    return (
      <main className="loading-screen">
        <Brand />
        <p role="alert">{error || 'Could not open your account.'}</p>
        <button className="primary-button" onClick={() => location.reload()}>
          Try again
        </button>
        <Link to="/login">Back to sign in</Link>
      </main>
    );
  return (
    <div className={`messenger ${active ? 'conversation-open' : ''}`}>
      <nav className="app-rail" aria-label="App navigation">
        <Brand compact />
        <div className="rail-actions">
          <button
            className="rail-button selected"
            aria-label="Messages"
            onClick={() => selectFriend(null)}
          >
            <MessageCircle size={22} />
            <span className="rail-indicator" />
          </button>
          <button
            className="rail-button"
            aria-label="Add a connection"
            onClick={() => setDialog('friend')}
          >
            <Users size={22} />
          </button>
        </div>
        <div className="rail-bottom">
          <button
            className="rail-button"
            aria-label="Account settings"
            onClick={() => setDialog('account')}
          >
            <Settings2 size={21} />
          </button>
          <button
            className="avatar-button"
            aria-label="Your account"
            onClick={() => setDialog('account')}
          >
            <Avatar name={user.username} size="small" />
          </button>
        </div>
      </nav>
      <aside className="conversation-sidebar">
        <header className="sidebar-heading">
          <div>
            <span className="section-kicker">YOUR LITTLE CORNER</span>
            <h1>
              Messages<span>.</span>
            </h1>
          </div>
          <button
            className="new-chat-button"
            aria-label="New conversation"
            onClick={() => setDialog('friend')}
          >
            <Plus size={21} />
          </button>
        </header>
        <div className="sidebar-search">
          <Search size={17} />
          <input
            aria-label="Search conversations"
            placeholder="Find a conversation"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span>⌕</span>
        </div>
        <div className="conversation-section">
          <span>ALL CONVERSATIONS</span>
          <span>{friends.length.toString().padStart(2, '0')}</span>
        </div>
        <div className="conversation-list">
          {!sortedFriends.length ? (
            <div className="sidebar-empty">
              <MessageCircle size={29} />
              <h3>{query ? 'No conversations found' : 'Your people belong here.'}</h3>
              <p>
                {query
                  ? 'Try another username.'
                  : 'Add someone by their username to start your first conversation.'}
              </p>
              {!query && (
                <button className="text-button" onClick={() => setDialog('friend')}>
                  Find a friend <ArrowRight size={15} />
                </button>
              )}
            </div>
          ) : (
            sortedFriends.map((f) => (
              <button
                key={f.address}
                className={`conversation-item ${active === f.address ? 'active' : ''}`}
                onClick={() => selectFriend(f.address)}
              >
                <Avatar name={f.username} online={f.isOnline} />
                <span className="conversation-meta">
                  <span>
                    <strong>{f.username}</strong>
                    <time>{f.lastMessage ? timeOf(f.lastMessage.createdAt) : ''}</time>
                  </span>
                  <span>
                    <small className={typing[f.address] ? 'typing-text' : ''}>
                      {typing[f.address]
                        ? 'typing…'
                        : `${f.lastMessage?.sender === user.address ? 'You: ' : ''}${preview(f.lastMessage)}`}
                    </small>
                    {f.unread > 0 && (
                      <b className="unread-badge">{f.unread > 99 ? '99+' : f.unread}</b>
                    )}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
        <div className="sidebar-invite">
          <span className="invite-icon">
            <Users size={19} />
          </span>
          <div>
            <strong>Better with your people.</strong>
            <p>Make room for a new conversation.</p>
          </div>
          <button
            className="icon-button"
            aria-label="Invite a friend"
            onClick={() => setDialog('friend')}
          >
            <Plus size={17} />
          </button>
        </div>
        <button className="sidebar-profile" onClick={() => setDialog('account')}>
          <Avatar name={user.username} online={connected} size="small" />
          <span>
            <strong>{user.username}</strong>
            <small>{connected ? 'Connected & ready' : 'Reconnecting…'}</small>
          </span>
          <ChevronDown size={17} />
        </button>
      </aside>
      <main className="chat-main">
        {error && (
          <div className="error-banner global-error" role="alert">
            <span>{error}</span>
            <button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}>
              <X size={16} />
            </button>
          </div>
        )}
        {!connected && (
          <div className="connection-banner" role="status">
            <WifiOff size={15} /> Connection lost. Reconnecting automatically… Your drafts are safe.
          </div>
        )}
        {friend ? (
          <>
            <header className="chat-header">
              <button
                className="icon-button mobile-back"
                aria-label="Back to conversations"
                onClick={() => selectFriend(null)}
              >
                <ArrowLeft size={20} />
              </button>
              <Avatar name={friend.username} online={friend.isOnline} />
              <div className="chat-person">
                <h2>
                  {friend.username}
                  <span>DIRECT MESSAGE</span>
                </h2>
                <p className={typing[active] ? 'typing-text' : ''}>
                  {typing[active] ? 'typing a little something…' : lastSeen(friend)}
                </p>
              </div>
              <div className="chat-header-actions">
                <button
                  className={`icon-button ${showSearch ? 'highlight' : ''}`}
                  aria-label="Search this conversation"
                  onClick={() => setShowSearch(!showSearch)}
                >
                  <Search size={20} />
                </button>
                <span className="header-divider" />
                <button
                  className="icon-button"
                  aria-label="Conversation details"
                  onClick={() => setDialog('info')}
                >
                  <Info size={20} />
                </button>
              </div>
            </header>
            {showSearch && (
              <div className="message-search">
                <Search size={17} />
                <input
                  autoFocus
                  aria-label="Search messages"
                  placeholder="Search messages in this conversation"
                  value={messageQuery}
                  onChange={(e) => setMessageQuery(e.target.value)}
                />
                <span>{messageQuery ? `${shownMessages.length} found` : ''}</span>
                <button
                  className="icon-button"
                  aria-label="Close message search"
                  onClick={() => {
                    setShowSearch(false);
                    setMessageQuery('');
                  }}
                >
                  <X size={17} />
                </button>
              </div>
            )}
            <div
              className="messages-area"
              ref={scrollRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                shouldScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
              }}
              aria-label={`Conversation with ${friend.username}`}
            >
              {hasMore[active] && !messageQuery && (
                <button className="load-older" disabled={historyLoading} onClick={older}>
                  {historyLoading ? 'Loading…' : 'Load earlier messages'}
                </button>
              )}
              {!messages.length && !historyLoading && (
                <div className="conversation-intro">
                  <Avatar name={friend.username} size="large" />
                  <h2>This is the start of something.</h2>
                  <p>
                    Your conversation with <strong>@{friend.username}</strong> starts here.
                    <br />A simple hello goes a long way.
                  </p>
                  <span>
                    <MessageCircle size={14} />
                    Just you two, one conversation.
                  </span>
                </div>
              )}
              {historyLoading && !messages.length && (
                <div className="history-loading" role="status">
                  <LoaderCircle className="spin" size={20} />
                  Loading messages…
                </div>
              )}
              {!!messages.length && (
                <div className="conversation-start">
                  <ShieldCheck size={13} /> A space for your everyday conversations.
                </div>
              )}
              {shownMessages.map((m, i) => {
                const mine = m.sender === user.address;
                const date = new Date(m.createdAt).toDateString();
                const showDate =
                  !i || new Date(shownMessages[i - 1].createdAt).toDateString() !== date;
                const grouped = !showDate && shownMessages[i - 1]?.sender === m.sender;
                return (
                  <div key={m.clientId || m.id}>
                    {showDate && (
                      <div className="date-divider">
                        <span>
                          {date === new Date().toDateString() ? 'Today' : shortDate(m.createdAt)}
                        </span>
                      </div>
                    )}
                    <div
                      className={`message-row ${mine ? 'mine' : 'theirs'} ${grouped ? 'grouped' : ''}`}
                    >
                      {!mine && (
                        <Avatar
                          name={friend.username}
                          size="tiny"
                          className={grouped ? 'invisible' : ''}
                        />
                      )}
                      <div className="message-column">
                        {!grouped && (
                          <span className="sender-label">{mine ? 'You' : friend.username}</span>
                        )}
                        <div className={`message-bubble ${m.status === 'failed' ? 'failed' : ''}`}>
                          <Attachment attachment={m.attachment} />
                          {m.content && <p>{m.content}</p>}
                          <div className="message-meta">
                            <time>{timeOf(m.createdAt)}</time>
                            {mine && (
                              <span
                                title={m.status}
                                aria-label={m.status}
                                className={m.status === 'seen' ? 'seen' : ''}
                              >
                                {m.status === 'pending' ? (
                                  <LoaderCircle className="spin" size={13} />
                                ) : m.status === 'failed' ? (
                                  <button
                                    className="retry-button"
                                    onClick={() => {
                                      setConversations((old) => ({
                                        ...old,
                                        [active]: old[active].map((item) =>
                                          item.clientId === m.clientId
                                            ? { ...item, status: 'pending' }
                                            : item,
                                        ),
                                      }));
                                      transmit(m);
                                    }}
                                  >
                                    Retry
                                  </button>
                                ) : m.status === 'sent' ? (
                                  <Check size={14} />
                                ) : (
                                  <CheckCheck size={15} />
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {messageQuery && !shownMessages.length && (
                <div className="sidebar-empty">
                  <Search size={25} />
                  <h3>No matching messages</h3>
                  <p>Try a different word or filename.</p>
                </div>
              )}
              {typing[active] && (
                <div className="typing-indicator" role="status">
                  <Avatar name={friend.username} size="tiny" />
                  <span>
                    <i />
                    <i />
                    <i />
                  </span>
                  <small>{friend.username} is typing</small>
                </div>
              )}
            </div>
            <div className="composer-section">
              {attachment && (
                <div className="attachment-preview">
                  <Paperclip size={18} />
                  <span>
                    {attachment.name}
                    <small>{fileSize(attachment.size)} · ready to send</small>
                  </span>
                  <button
                    className="icon-button"
                    aria-label="Remove attachment"
                    onClick={() => setAttachment(null)}
                  >
                    <X size={18} />
                  </button>
                </div>
              )}
              {emojiOpen && (
                <div className="emoji-picker" aria-label="Choose an emoji">
                  {['😊', '❤️', '😂', '🙌', '👍', '✨', '☕', '🔥', '🎉', '👋', '💯', '🤝'].map(
                    (emoji) => (
                      <button
                        key={emoji}
                        aria-label={`Insert ${emoji}`}
                        onClick={() => {
                          updateDraft(draft + emoji);
                          inputRef.current?.focus();
                        }}
                      >
                        {emoji}
                      </button>
                    ),
                  )}
                </div>
              )}
              <form className="composer" onSubmit={handleSend}>
                <textarea
                  ref={inputRef}
                  aria-label="Message"
                  placeholder={`Message ${friend.username}…`}
                  value={draft}
                  maxLength={4000}
                  rows={1}
                  onChange={(e) => updateDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      handleSend(e);
                    }
                  }}
                />
                <div className="composer-toolbar">
                  <div>
                    <input type="file" ref={fileRef} hidden onChange={uploadFile} />
                    <button
                      className="icon-button"
                      type="button"
                      aria-label="Attach a file"
                      disabled={uploading || !connected}
                      onClick={() => fileRef.current.click()}
                    >
                      {uploading ? (
                        <LoaderCircle className="spin" size={19} />
                      ) : (
                        <Paperclip size={20} />
                      )}
                    </button>
                    <button
                      className={`icon-button ${emojiOpen ? 'highlight' : ''}`}
                      type="button"
                      aria-label="Add emoji"
                      onClick={() => setEmojiOpen(!emojiOpen)}
                    >
                      <Smile size={20} />
                    </button>
                    <span className="composer-file-hint">
                      {uploading ? 'Uploading…' : 'A photo, a file, a little hello.'}
                    </span>
                  </div>
                  <button
                    className="send-button"
                    type="submit"
                    disabled={(!draft.trim() && !attachment) || uploading || !connected}
                  >
                    Send message <Send size={16} />
                  </button>
                </div>
              </form>
              <div className="composer-footer">
                <span>
                  <span className="tiny-dot" />
                  Built for your everyday conversations
                </span>
                <span>
                  Enter to send <span className="keycap">↵</span>
                  <b>·</b> Shift + Enter for a new line
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="welcome-state">
            <span className="welcome-orbit">
              <MessageCircle size={43} />
              <i />
              <i />
            </span>
            <span className="section-kicker">LESS NOISE. MORE CONNECTION.</span>
            <h2>
              A little space
              <br />
              for your <em>people.</em>
            </h2>
            <p>
              Pick a conversation on the left, or find a friend
              <br />
              and make their day with a hello.
            </p>
            <button className="primary-button" onClick={() => setDialog('friend')}>
              <Plus size={18} />
              Start a conversation
              <ArrowRight size={17} />
            </button>
            <div className="welcome-footer">
              <span>
                <ShieldCheck size={16} />
                Signed messages
              </span>
              <span>
                <Users size={16} />
                Just your people
              </span>
            </div>
          </div>
        )}
      </main>
      {dialog === 'friend' && (
        <Modal
          title="Find your people."
          close={() => {
            setDialog(null);
            setFriendError('');
          }}
        >
          <p className="modal-description">
            Know their username? That’s all you need to start a conversation.
          </p>
          <form onSubmit={addFriend}>
            <label htmlFor="friend-name">Their username</label>
            <div className="input-wrap">
              <span>@</span>
              <input
                id="friend-name"
                autoFocus
                placeholder="e.g. maya"
                value={friendName}
                onChange={(e) => setFriendName(e.target.value)}
                required
                maxLength={25}
              />
            </div>
            {friendError && (
              <p className="error-banner" role="alert">
                {friendError}
              </p>
            )}
            <button className="primary-button modal-submit" disabled={adding}>
              {adding ? 'Finding your friend…' : 'Start a conversation'}
              <ArrowRight size={17} />
            </button>
          </form>
          <p className="honest-note">
            They’ll need a SecureChat account on this server. Connecting adds the conversation for
            both of you.
          </p>
        </Modal>
      )}
      {dialog === 'account' && (
        <Modal title="Your little corner." close={() => setDialog(null)}>
          <div className="account-profile">
            <Avatar name={user.username} size="large" />
            <div>
              <h3>{user.username}</h3>
              <p>@{user.username}</p>
            </div>
          </div>
          <div className="detail-row">
            <span>Account address</span>
            <code>{user.address}</code>
            <button className="text-button" onClick={copyAddress}>
              {copied ? <Check size={15} /> : <Copy size={15} />}{' '}
              {copied ? 'Copied' : 'Copy address'}
            </button>
          </div>
          <div className="account-info">
            <KeyRoundIcon />
            <p>
              Your signing key is kept in this browser tab. Save your recovery phrase to sign in
              after closing it or on another device.
            </p>
          </div>
          <p className="honest-note">
            Messages and attachments are stored on this server. They are not end-to-end encrypted.
          </p>
          <button className="logout-button" onClick={logout}>
            <LogOut size={17} />
            Sign out of this session
          </button>
        </Modal>
      )}
      {dialog === 'info' && friend && (
        <Modal title="Just you two." close={() => setDialog(null)}>
          <div className="account-profile">
            <Avatar name={friend.username} size="large" online={friend.isOnline} />
            <div>
              <h3>{friend.username}</h3>
              <p>{lastSeen(friend)}</p>
            </div>
          </div>
          <div className="detail-row">
            <span>Username</span>
            <strong>@{friend.username}</strong>
          </div>
          <div className="detail-row">
            <span>Account address</span>
            <code>{friend.address}</code>
          </div>
          <p className="honest-note">
            Only participants can access this conversation and its files through the app. Messages
            are stored on this server and are not end-to-end encrypted.
          </p>
        </Modal>
      )}
    </div>
  );
}
function KeyRoundIcon() {
  return <ShieldCheck size={23} />;
}
