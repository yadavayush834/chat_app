import { MessageCircle } from 'lucide-react';
export default function Brand({ compact = false }) {
  return (
    <a className="brand" href="/" aria-label="SecureChat home">
      <span className="brand-mark">
        <MessageCircle size={21} strokeWidth={2.4} />
      </span>
      {!compact && (
        <span>
          secure<span className="brand-light">chat</span>
          <span className="brand-dot">.</span>
        </span>
      )}
    </a>
  );
}
