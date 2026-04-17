import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { restoreWallet } from '../utils/crypto';

export default function LoginPage() {
    const [mnemonic, setMnemonic] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        
        if (!mnemonic.trim() || mnemonic.trim().split(' ').length < 12) {
            setError('Please enter a valid 12-to-24 word recovery phrase');
            return;
        }

        setLoading(true);
        try {
            // Restore wallet implicitly checks if mnemonic is valid
            const wallet = restoreWallet(mnemonic);
            
            // Check via backend if user exists using their address
            const res = await fetch('http://localhost:5000/api/users/me', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address: wallet.address })
            });
            const data = await res.json();
            
            if (res.ok) {
                // Save session minimally (store private key so we can recreate wallet without prompting again)
                localStorage.setItem('privateKey', wallet.privateKey);
                localStorage.setItem('address', data.address);
                localStorage.setItem('username', data.username);
                navigate('/chat');
            } else {
                setError(data.error || 'Account not found for this phrase');
            }
        } catch (err) {
            setError('Invalid phrase format or connection error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="app-container">
            <div className="glass-panel auth-box">
                <h1 style={{fontSize: '2.5rem', marginBottom: '2rem'}}>Access Account</h1>
                
                {error && <div style={{color: '#ff4c4c', marginBottom: '1rem', background: 'rgba(255,0,0,0.1)', padding: '0.5rem', borderRadius: '4px'}}>{error}</div>}
                
                <form onSubmit={handleLogin}>
                    <textarea 
                        className="input-field" 
                        placeholder="Enter your 12-word recovery phrase..." 
                        value={mnemonic}
                        onChange={(e) => setMnemonic(e.target.value)}
                        style={{minHeight: '100px', resize: 'vertical'}}
                    />
                    
                    <button 
                        type="submit" 
                        className="btn btn-primary" 
                        style={{width: '100%', marginTop: '1rem'}}
                        disabled={loading}
                    >
                        {loading ? 'Authenticating...' : 'Enter Chat'}
                    </button>
                    
                    <button 
                        type="button" 
                        className="btn" 
                        style={{width: '100%', marginTop: '1rem', border: 'none'}}
                        onClick={() => navigate('/')}
                    >
                        Back to Register
                    </button>
                </form>
            </div>
        </div>
    );
}
