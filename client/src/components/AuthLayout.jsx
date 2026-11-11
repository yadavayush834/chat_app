import { ArrowUpRight, Fingerprint, KeyRound, MessageSquare, Sparkles } from 'lucide-react';
import Brand from './Brand';
import Avatar from './Avatar';
export default function AuthLayout({ children }) {
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <Brand />
        <div className="story-content">
          <span className="eyebrow">
            <span className="tiny-dot" /> A little closer, wherever you are
          </span>
          <h1>
            Good conversations
            <br />
            start with <em>you.</em>
          </h1>
          <p>
            Your people. Your space. A quieter corner of the internet for the conversations that
            matter.
          </p>
          <div className="preview-card" aria-hidden="true">
            <div className="preview-top">
              <Avatar name="Maya" online />
              <div>
                <strong>Maya</strong>
                <small>Online now</small>
              </div>
              <span className="preview-label">JUST BETWEEN US</span>
            </div>
            <div className="preview-message">
              Hey! Same coffee spot tomorrow? <span>10:42</span>
            </div>
            <div className="preview-message outgoing">
              Wouldn't miss it ☕{' '}
              <span>
                10:43 <span>✓✓</span>
              </span>
            </div>
            <div className="preview-typing">
              <i />
              <i />
              <i />
            </div>
            <div className="preview-bottom">
              <span>A conversation worth keeping.</span>
              <Sparkles size={16} />
            </div>
          </div>
          <div className="story-features">
            <span>
              <Fingerprint size={17} />
              Your own identity
            </span>
            <span>
              <MessageSquare size={17} />
              Instant connection
            </span>
            <span>
              <KeyRound size={17} />
              No passwords
            </span>
          </div>
        </div>
        <footer>
          <span>Less noise. More connection.</span>
          <ArrowUpRight size={17} />
        </footer>
      </section>
      <main className="auth-main">
        <div className="mobile-brand">
          <Brand />
        </div>
        {children}
        <div className="auth-footnote">Made for real conversations. Built to feel simple.</div>
      </main>
    </div>
  );
}
