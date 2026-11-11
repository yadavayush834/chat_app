import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, KeyRound } from 'lucide-react';
import { restoreWallet } from '../utils/crypto';
import { authenticate } from '../lib/api';
import AuthLayout from '../components/AuthLayout';
export default function LoginPage() {
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  async function submit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      let wallet;
      try {
        wallet = restoreWallet(phrase.toLowerCase().trim().replace(/\s+/g, ' '));
      } catch {
        throw new Error('That recovery phrase isn’t valid. Check each word and try again.');
      }
      await authenticate(wallet, 'login');
      setPhrase('');
      navigate('/chat');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <AuthLayout>
      <section className="auth-form">
        <div className="section-kicker">PICK UP WHERE YOU LEFT OFF</div>
        <h2>Hey, welcome back.</h2>
        <p className="auth-description">Your conversations are right where you left them.</p>
        <div className="auth-tabs">
          <Link to="/">Create account</Link>
          <span className="selected">
            Sign in <ArrowRight size={14} />
          </span>
        </div>
        <form onSubmit={submit}>
          <label htmlFor="phrase">Your recovery phrase</label>
          <textarea
            className="phrase-input"
            id="phrase"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder="Enter your 12-word recovery phrase"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            required
            rows={4}
          />
          <small className="field-hint">The words you saved when creating your account.</small>
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button auth-submit" disabled={loading}>
            {loading ? 'Opening your conversations…' : 'Back to your conversations'}
            <ArrowRight size={18} />
          </button>
        </form>
        <div className="auth-note">
          <KeyRound size={17} />
          <p>Your phrase stays in your browser. We verify your signature to open your account.</p>
        </div>
        <p className="honest-note">
          Lost your phrase? We can’t recover it. You can <Link to="/">create a new account</Link>.
        </p>
      </section>
    </AuthLayout>
  );
}
