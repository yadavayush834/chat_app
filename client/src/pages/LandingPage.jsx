import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { generateWallet, signPayload } from '../utils/crypto';

export default function LandingPage() {
    const [username, setUsername] = useState('');
    const [walletData, setWalletData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const handleRegister = async (e) => {
        e.preventDefault();
        setError('');
        
        if (!username.trim() || username.length < 3) {
            setError('Username must be at least 3 characters');
            return;
        }

        setLoading(true);
        try {
            const newWallet = generateWallet();
            
            // Sign a registration payload to prove ownership of the address
            const expectedMessage = `Registering username: ${username.trim().toLowerCase()}`;
            const signature = await signPayload(newWallet.wallet, expectedMessage);

            const res = await fetch('http://localhost:5000/api/users/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: username.trim(),
                    address: newWallet.address,
                    signature
                })
            });
            const data = await res.json();
            
            if (res.ok) {
                setWalletData(newWallet);
            } else {
                setError(data.error || 'Failed to register');
            }
        } catch (err) {
            setError('Connection error or generation failed');
        } finally {
            setLoading(false);
        }
    };

    const handleConfirmBackup = () => {
        if (!walletData) return;
        localStorage.setItem('privateKey', walletData.privateKey);
        localStorage.setItem('address', walletData.address);
        localStorage.setItem('username', username.trim().toLowerCase());
        navigate('/chat');
    };

    return (
        <div className="app-container">
            <div className="glass-panel" style={{ textAlign: 'center', maxWidth: '600px', width: '100%' }}>
                <h1>SecureChat</h1>
                <p>Welcome to the next generation of decentralized communication. Claim a username and generate your secure keys entirely in the browser.</p>
                
                {error && <div style={{color: '#ff4c4c', marginBottom: '1rem', background: 'rgba(255,0,0,0.1)', padding: '0.5rem', borderRadius: '4px'}}>{error}</div>}

                {!walletData ? (
                    <form onSubmit={handleRegister} style={{ marginTop: '2rem' }}>
                        <input 
                            type="text" 
                            className="input-field" 
                            placeholder="Choose a Username" 
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                        />
                        <button 
                            type="submit"
                            className="btn btn-primary" 
                            disabled={loading}
                            style={{ fontSize: '1.2rem', width: '100%'}}
                        >
                            {loading ? 'Registering...' : 'Register Alias'}
                        </button>
                        
                        <div style={{ marginTop: '1.5rem' }}>
                            <button type="button" className="btn" style={{border: 'none'}} onClick={() => navigate('/login')}>
                                I Already Have a Mnemonic Phrase
                            </button>
                        </div>
                    </form>
                ) : (
                    <div style={{ marginTop: '2rem', textAlign: 'left' }}>
                        <h2 style={{color: 'var(--primary)', marginTop: 0}}>Backup Your Recovery Phrase!</h2>
                        <p style={{color: '#ffaaaa'}}><b>WARNING:</b> This 12-word phrase is your ONLY way to log into your account. Write it down and keep it safe!</p>
                        
                        <div className="key-box" style={{fontSize: '1.2rem', lineHeight: '1.8', textAlign: 'center', background: 'rgba(255, 255, 255, 0.05)'}}>
                            {walletData.mnemonic}
                        </div>
                        
                        <div style={{marginTop: '1rem', color: 'var(--text-secondary)'}}>
                            <strong>Address / Public Key:</strong>
                            <div style={{fontFamily: 'monospace', fontSize: '0.8rem'}}>{walletData.address}</div>
                        </div>

                        <button 
                            className="btn btn-primary"
                            style={{width: '100%', marginTop: '2rem'}}
                            onClick={handleConfirmBackup}
                        >
                            I have saved my phrase -{'>'} Enter Chat
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
