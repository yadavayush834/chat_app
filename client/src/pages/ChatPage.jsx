import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { getWalletFromPrivateKey, signPayload } from '../utils/crypto';

export default function ChatPage() {
    const navigate = useNavigate();
    const [socket, setSocket] = useState(null);
    const [username, setUsername] = useState('');
    const [address, setAddress] = useState('');
    const [wallet, setWallet] = useState(null);
    
    // UI State
    const [friends, setFriends] = useState([]);
    const [activeFriend, setActiveFriend] = useState(null);
    const [newFriendUsername, setNewFriendUsername] = useState('');
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [uploading, setUploading] = useState(false);
    
    // Typing state
    const [typingUsers, setTypingUsers] = useState({});
    const typingTimeoutRef = useRef(null);

    const messagesEndRef = useRef(null);
    const fileInputRef = useRef(null);

    // Initial load and authentication
    useEffect(() => {
        const storedPriv = localStorage.getItem('privateKey');
        const storedAddr = localStorage.getItem('address');
        const storedUser = localStorage.getItem('username');
        
        if (!storedPriv || !storedAddr || !storedUser) {
            navigate('/login');
            return;
        }
        
        const localWallet = getWalletFromPrivateKey(storedPriv);
        setWallet(localWallet);
        setAddress(storedAddr);
        setUsername(storedUser);

        // Fetch initial user data to get full friends list details
        fetch('http://localhost:5000/api/users/me', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: storedAddr })
        })
        .then(res => res.json())
        .then(data => {
            if (data.error) throw new Error(data.error);
            setFriends(data.friends || []);
        })
        .catch(err => {
            console.error(err);
            navigate('/login');
        });

        // Initialize Socket
        const newSocket = io('http://localhost:5000');
        setSocket(newSocket);

        newSocket.on('connect', async () => {
            try {
                const timestamp = Date.now();
                const expectedMessage = `Auth:${timestamp}`;
                const signature = await signPayload(localWallet, expectedMessage);
                
                newSocket.emit('authenticate', {
                    address: storedAddr,
                    timestamp,
                    signature
                });
            } catch (e) {
                console.error('Failed to sign auth payload', e);
            }
        });

        return () => newSocket.close();
    }, [navigate]);

    // Handle incoming socket events
    useEffect(() => {
        if (!socket) return;

        const handleReceive = (msg) => {
            setMessages(prev => [...prev, msg]);
            // If the message is from our active view, mark it as seen immediately
            socket.emit('update_message_status', {
                messageIds: [msg._id],
                status: 'seen',
                senderAddress: msg.sender
            });
        };

        const handleSent = (msg) => {
             setMessages(prev => [...prev, msg]);
        };

        const handleStatusUpdated = ({ messageIds, status }) => {
            setMessages(prev => prev.map(m => {
                if (messageIds.includes(m._id)) return { ...m, status };
                return m;
            }));
        };

        const handlePresenceUpdate = ({ address: peerAddress, isOnline, lastSeen }) => {
            setFriends(prev => prev.map(f => {
                if (f.address === peerAddress) {
                    return { ...f, isOnline, lastSeen };
                }
                return f;
            }));
        };

        const handleTyping = ({ sender }) => {
            setTypingUsers(prev => ({ ...prev, [sender]: true }));
        };

        const handleStopTyping = ({ sender }) => {
            setTypingUsers(prev => ({ ...prev, [sender]: false }));
        };

        socket.on('receive_message', handleReceive);
        socket.on('message_sent', handleSent);
        socket.on('message_status_updated', handleStatusUpdated);
        socket.on('presence_update', handlePresenceUpdate);
        socket.on('typing', handleTyping);
        socket.on('stop_typing', handleStopTyping);

        return () => {
            socket.off('receive_message', handleReceive);
            socket.off('message_sent', handleSent);
            socket.off('message_status_updated', handleStatusUpdated);
            socket.off('presence_update', handlePresenceUpdate);
            socket.off('typing', handleTyping);
            socket.off('stop_typing', handleStopTyping);
        };
    }, [socket]);

    // Scroll to bottom when messages change
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Fetch message history when active friend changes
    useEffect(() => {
        if (!activeFriend || !address || !socket) return;
        
        fetch(`http://localhost:5000/api/messages/${address}/${activeFriend}`)
            .then(res => res.json())
            .then(data => {
                if (data.messages) {
                    setMessages(data.messages);
                    
                    // Mark historically unseen messages as seen
                    const unseenIds = data.messages
                        .filter(m => m.sender === activeFriend && m.status !== 'seen')
                        .map(m => m._id);
                        
                    if (unseenIds.length > 0) {
                        socket.emit('update_message_status', {
                            messageIds: unseenIds,
                            status: 'seen',
                            senderAddress: activeFriend
                        });
                        
                        // Optimistically update locally
                        setMessages(prev => prev.map(m => unseenIds.includes(m._id) ? {...m, status: 'seen'} : m));
                    }
                }
            })
            .catch(err => console.error(err));
            
    }, [activeFriend, address, socket]);

    const handleAddFriend = async (e) => {
        e.preventDefault();
        const cleanedUsername = newFriendUsername.trim().toLowerCase();
        if (!cleanedUsername) return;

        try {
            const expectedMessage = `Add friend: ${cleanedUsername}`;
            const signature = await signPayload(wallet, expectedMessage);

            const res = await fetch('http://localhost:5000/api/users/friend', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    myAddress: address,
                    friendUsername: cleanedUsername,
                    signature
                })
            });
            const data = await res.json();
            if (res.ok) {
                setFriends(data.friends);
                setNewFriendUsername('');
            } else {
                alert(data.error || 'Failed to add friend');
            }
        } catch (error) {
            console.error(error);
        }
    };

    const handleSendMessage = async (e, forcedMediaUrl = null, forcedMediaType = null) => {
        if (e) e.preventDefault();
        if (!activeFriend || !socket || !wallet) return;
        
        const contentStr = newMessage.trim();
        if (!contentStr && !forcedMediaUrl) return;

        try {
            const payloadContent = contentStr || forcedMediaUrl;
            const expectedMessage = `Msg:${activeFriend}:${payloadContent}`;
            const signature = await signPayload(wallet, expectedMessage);

            const payload = {
                sender: address,
                receiver: activeFriend,
                content: contentStr,
                mediaUrl: forcedMediaUrl,
                mediaType: forcedMediaType,
                signature
            };
            
            socket.emit('send_message', payload);
            setNewMessage('');
            
            // Immediately stop typing
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            socket.emit('stop_typing', { receiver: activeFriend });

        } catch(err) {
            console.error('Failed to sign message', err);
        }
    };

    const handleTyping = (e) => {
        setNewMessage(e.target.value);
        if (!socket || !activeFriend) return;

        // Emit typing
        socket.emit('typing', { receiver: activeFriend });

        // Auto-stop after 2 seconds
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => {
             socket.emit('stop_typing', { receiver: activeFriend });
        }, 2000);
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
            alert('File must be smaller than 5MB');
            return;
        }

        setUploading(true);
        try {
            // Sign the upload request
            const timestamp = Date.now().toString();
            const expectedMessage = `Upload:${activeFriend}:${timestamp}`;
            const signature = await signPayload(wallet, expectedMessage);

            const formData = new FormData();
            formData.append('file', file);
            formData.append('address', address);
            formData.append('receiver', activeFriend);
            formData.append('signature', signature);
            formData.append('timestamp', timestamp);

            const res = await fetch('http://localhost:5000/api/upload', {
                method: 'POST',
                body: formData
            });

            const data = await res.json();
            if (res.ok) {
                 handleSendMessage(null, data.mediaUrl, data.mediaType);
            } else {
                 alert(data.error || 'Upload failed');
            }
        } catch(err) {
            console.error(err);
            alert('Error making upload request');
        } finally {
            setUploading(false);
            if(fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleLogout = () => {
        localStorage.clear();
        navigate('/');
    };

    const getFriendData = (friendAddr) => {
         return friends.find(fr => fr.address === friendAddr);
    };

    const formatLastSeen = (dateString) => {
        const date = new Date(dateString);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="chat-layout">
            <div className="glass-panel sidebar">
                <h2 style={{marginTop: 0, fontSize: '1.5rem', color: 'var(--primary)'}}>SecureChat</h2>
                
                <div style={{marginBottom: '1rem'}}>
                    <p style={{fontSize: '1rem', margin: '0 0 0.5rem 0'}}><b>{username}</b></p>
                    <div className="key-box" style={{fontSize: '0.6rem', padding: '0.4rem', margin: 0, background: 'rgba(0,0,0,0.3)', cursor: 'pointer', overflow: 'hidden'}} 
                         onClick={() => navigator.clipboard.writeText(address)}
                         title="Click to copy Address">
                        {address}
                    </div>
                </div>

                <form onSubmit={handleAddFriend} style={{display: 'flex', gap: '0.5rem', marginBottom: '1rem'}}>
                    <input 
                        type="text" 
                        value={newFriendUsername}
                        onChange={e => setNewFriendUsername(e.target.value)}
                        placeholder="Add Friend (Username)"
                        className="input-field"
                        style={{margin: 0, padding: '0.5rem'}}
                    />
                    <button type="submit" className="btn btn-primary" style={{padding: '0.5rem', borderRadius: '8px'}}>+</button>
                </form>

                <div className="friends-list">
                    <h3 style={{fontSize: '1rem', color: 'var(--text-secondary)'}}>Connections</h3>
                    {friends.length === 0 && <p style={{fontSize: '0.9rem'}}>No connections. Add someone by their username!</p>}
                    {friends.map(friend => (
                        <div 
                            key={friend.address} 
                            className={`friend-item ${activeFriend === friend.address ? 'active' : ''}`}
                            onClick={() => setActiveFriend(friend.address)}
                            style={{fontWeight: 'bold', fontSize: '1rem', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}
                        >
                            <span>@{friend.username}</span>
                            <span 
                                title={friend.isOnline ? 'Online' : 'Offline'}
                                style={{
                                    display: 'inline-block',
                                    width: '10px',
                                    height: '10px',
                                    borderRadius: '50%',
                                    backgroundColor: friend.isOnline ? '#4caf50' : '#888'
                                }}
                            />
                        </div>
                    ))}
                </div>

                <button className="btn" onClick={handleLogout} style={{marginTop: '1rem', width: '100%'}}>
                    Logout
                </button>
            </div>

            <div className="glass-panel chat-box">
                {activeFriend ? (
                    <>
                        {(() => {
                            const friendData = getFriendData(activeFriend);
                            return (
                                <div style={{borderBottom: '1px solid var(--panel-border)', paddingBottom: '1rem', marginBottom: '1rem'}}>
                                    <h3 style={{margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                                        Chatting with: <span style={{color: 'var(--primary)'}}>@{friendData?.username}</span>
                                        {friendData?.isOnline ? (
                                            <span style={{fontSize: '0.8rem', color: '#4caf50', fontWeight: 'normal'}}>Online</span>
                                        ) : (
                                            <span style={{fontSize: '0.8rem', color: '#888', fontWeight: 'normal'}}>Last seen: {friendData?.lastSeen ? formatLastSeen(friendData.lastSeen) : 'N/A'}</span>
                                        )}
                                    </h3>
                                </div>
                            );
                        })()}

                        <div className="messages-area">
                            {messages.filter(m => m.sender === activeFriend || m.receiver === activeFriend).map((msg, idx) => {
                                const isMine = msg.sender === address;
                                return (
                                    <div key={idx} className={`message-bubble ${isMine ? 'message-sent' : 'message-received'}`}>
                                        {msg.mediaUrl && (
                                            <div style={{marginBottom: '0.5rem'}}>
                                                {msg.mediaType === 'image' ? (
                                                    <img src={msg.mediaUrl} alt="attachment" style={{maxWidth: '100%', maxHeight: '200px', borderRadius: '8px'}} />
                                                ) : (
                                                    <a href={msg.mediaUrl} target="_blank" rel="noopener noreferrer" style={{color: 'var(--primary)', textDecoration: 'underline'}}>
                                                        📎 Download Attachment
                                                    </a>
                                                )}
                                            </div>
                                        )}
                                        {msg.content && <p style={{margin: 0, color: 'inherit'}}>{msg.content}</p>}
                                        
                                        {isMine && (
                                            <div style={{fontSize: '0.7rem', textAlign: 'right', marginTop: '0.2rem', opacity: 0.8, color: msg.status === 'seen' ? '#4caf50' : 'inherit'}}>
                                                {msg.status === 'sent' && '✓'}
                                                {msg.status === 'delivered' && '✓✓'}
                                                {msg.status === 'seen' && '✓✓'}
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                            
                            {typingUsers[activeFriend] && (
                                <div className="message-bubble message-received" style={{fontStyle: 'italic', opacity: 0.7}}>
                                    Typing...
                                </div>
                            )}

                            <div ref={messagesEndRef} />
                        </div>

                        <form className="message-input-area" onSubmit={handleSendMessage} style={{alignItems: 'center'}}>
                            <input 
                                type="file" 
                                style={{display: 'none'}} 
                                ref={fileInputRef}
                                onChange={handleFileUpload}
                            />
                            <button 
                                type="button" 
                                className="btn" 
                                style={{padding: '0.5rem 1rem', borderRadius: '50%'}}
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploading}
                                title="Upload File"
                            >
                                📎
                            </button>
                            <input 
                                type="text" 
                                className="input-field" 
                                placeholder={uploading ? "Uploading..." : "Type a secure message..."}
                                value={newMessage}
                                onChange={handleTyping}
                                style={{margin: 0, flexGrow: 1}}
                                disabled={uploading}
                            />
                            <button type="submit" className="btn btn-primary" style={{borderRadius: '8px'}} disabled={uploading}>Send</button>
                        </form>
                    </>
                ) : (
                    <div style={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-secondary)'}}>
                        Select a connection to start chatting
                    </div>
                )}
            </div>
        </div>
    );
}
