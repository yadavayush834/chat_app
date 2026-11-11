import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Copy, KeyRound, Download } from 'lucide-react';
import { generateWallet } from '../utils/crypto';
import { authenticate } from '../lib/api';
import AuthLayout from '../components/AuthLayout';

export default function LandingPage() {
  const [username, setUsername] = useState('');
  const [wallet, setWallet] = useState(null);
  const [backedUp, setBackedUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();
  async function submit(event) {
    event.preventDefault();
    setError('');
    if (!wallet) {
      setWallet(generateWallet().wallet);
      return;
    }
    setLoading(true);
    try {
      await authenticate(wallet, 'register', username.trim().toLowerCase());
      navigate('/chat');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(wallet.mnemonic.phrase);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Clipboard unavailable. Write down the phrase or download a backup.');
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob(
        [
          `SecureChat recovery phrase\nUsername: ${username.trim().toLowerCase()}\n\n${wallet.mnemonic.phrase}\n\nKeep this file private. Anyone with this phrase can access your account.\n`,
        ],
        { type: 'text/plain' },
      ),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'securechat-recovery.txt';
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <AuthLayout>
      <section className="auth-form">
        <div className="section-kicker">YOUR NEXT CONVERSATION STARTS HERE</div>
        <h2>{wallet ? 'A key that’s only yours.' : 'Make yourself at home.'}</h2>
        <p className="auth-description">
          {wallet
            ? 'Save these 12 words somewhere private. They’re how you’ll sign in on another device.'
            : 'Choose a name, find your people, and get talking.'}
        </p>
        <div className="auth-tabs">
          <span className="selected">Create account</span>
          <Link to="/login">
            Sign in <ArrowRight size={14} />
          </Link>
        </div>
        <form onSubmit={submit}>
          <label htmlFor="username">Your username</label>
          <div className="input-wrap">
            <span>@</span>
            <input
              id="username"
              placeholder="e.g. ayush"
              autoComplete="username"
              minLength={3}
              maxLength={24}
              pattern="[a-zA-Z0-9_]{3,24}"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
            />
          </div>
          <small className="field-hint">
            3–24 letters, numbers, or underscores. Make it yours.
          </small>
          {wallet && (
            <>
              <div className="recovery-heading">
                <span>
                  <KeyRound size={16} />
                  Your recovery phrase
                </span>
                <button type="button" className="text-button" onClick={copy}>
                  {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <ol className="phrase-grid">
                {wallet.mnemonic.phrase.split(' ').map((word, i) => (
                  <li key={i}>
                    <span>{i + 1}</span>
                    {word}
                  </li>
                ))}
              </ol>
              <button type="button" className="text-button backup-download" onClick={download}>
                <Download size={15} /> Download a backup
              </button>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={backedUp}
                  onChange={(e) => setBackedUp(e.target.checked)}
                  required
                />
                I saved my phrase somewhere safe.
              </label>
            </>
          )}
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
          <button
            className="primary-button auth-submit"
            type="submit"
            disabled={loading || (!!wallet && !backedUp)}
          >
            {loading
              ? 'Creating your space…'
              : wallet
                ? 'Create account & start chatting'
                : 'Create your account'}
            <ArrowRight size={18} />
          </button>
        </form>
        <div className="auth-note">
          <KeyRound size={17} />
          <p>No email. No password. Your account is protected by a recovery phrase you control.</p>
        </div>
        <p className="honest-note">
          Messages are stored on this server. SecureChat does not offer end-to-end encryption.
        </p>
      </section>
    </AuthLayout>
  );
}
