const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { ethers } = require('ethers');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const connectDB = require('./db');
const User = require('./models/User');
const Message = require('./models/Message');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*', // For dev
        methods: ['GET', 'POST']
    }
});

// Configure Multer for File Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB Limit
});

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Connect to DB
connectDB();

// --- HTTP Routes ---

// 1. Register User Mapping
app.post('/api/users/register', async (req, res) => {
    try {
        const { username, address, signature } = req.body;
        
        if (!username || !address || !signature) {
            return res.status(400).json({ error: 'Missing parameters' });
        }

        const expectedMessage = `Registering username: ${username}`;
        try {
            const recoveredAddress = ethers.verifyMessage(expectedMessage, signature);
            if (recoveredAddress !== address) {
                return res.status(401).json({ error: 'Signature verification failed' });
            }
        } catch (e) {
            return res.status(401).json({ error: 'Invalid signature format' });
        }

        const cleanUsername = username.toLowerCase().trim();

        const existingUsername = await User.findOne({ username: cleanUsername });
        if (existingUsername) {
            return res.status(409).json({ error: 'Username already taken' });
        }

        const newUser = new User({
            username: cleanUsername,
            address,
            friends: []
        });

        await newUser.save();
        res.json({ success: true, username: cleanUsername, address });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ error: 'Address already registered' });
        }
        res.status(500).json({ error: 'Failed to register' });
    }
});

// 2. Fetch User & Verify
app.post('/api/users/me', async (req, res) => {
    const { address } = req.body;
    if (!address) {
        return res.status(400).json({ error: 'Address is required' });
    }

    try {
        const user = await User.findOne({ address });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Populate friends list with usernames and online status
        const friendsDetails = await User.find(
            { address: { $in: user.friends } }, 
            'username address isOnline lastSeen'
        );

        res.json({ 
            username: user.username, 
            address: user.address, 
            friends: friendsDetails 
        });
    } catch (error) {
        res.status(500).json({ error: 'Fetch failed' });
    }
});

// 3. Add Friend via Username
app.post('/api/users/friend', async (req, res) => {
    const { myAddress, friendUsername, signature } = req.body;
    
    if (!myAddress || !friendUsername || !signature) {
        return res.status(400).json({ error: 'Missing parameters' });
    }

    const cleanFriendUsername = friendUsername.toLowerCase().trim();

    try {
        const expectedMessage = `Add friend: ${cleanFriendUsername}`;
        const recoveredAddress = ethers.verifyMessage(expectedMessage, signature);
        if (recoveredAddress !== myAddress) {
            return res.status(401).json({ error: 'Signature verification failed' });
        }

        const user = await User.findOne({ address: myAddress });
        if (!user) return res.status(404).json({ error: 'You are not registered' });

        if (user.username === cleanFriendUsername) return res.status(400).json({ error: 'Cannot add yourself' });

        const friend = await User.findOne({ username: cleanFriendUsername });
        if (!friend) return res.status(404).json({ error: 'Friend username not found' });

        if (user.friends.includes(friend.address)) return res.status(400).json({ error: 'Already friends' });

        user.friends.push(friend.address);
        await user.save();

        if (!friend.friends.includes(user.address)) {
            friend.friends.push(user.address);
            await friend.save();
        }

        const friendsDetails = await User.find({ address: { $in: user.friends } }, 'username address isOnline lastSeen');
        res.json({ success: true, friends: friendsDetails });
    } catch (error) {
        res.status(500).json({ error: 'Failed to add friend' });
    }
});

// 4. Get History
app.get('/api/messages/:address/:friendAddress', async (req, res) => {
    try {
        const { address, friendAddress } = req.params;
        const messages = await Message.find({
            $or: [
                { sender: address, receiver: friendAddress },
                { sender: friendAddress, receiver: address }
            ]
        }).sort({ createdAt: 1 });
        res.json({ messages });
    } catch (err) {
         res.status(500).json({ error: 'Failed to fetch history' });
    }
});

// 5. Upload File
app.post('/api/upload', upload.single('file'), async (req, res) => {
     try {
         const { address, receiver, signature, timestamp } = req.body;
         
         // Verify Upload Signature to prevent anonymous spam
         if (Math.abs(Date.now() - parseInt(timestamp)) > 300000) {
              fs.unlinkSync(req.file.path);
              return res.status(401).json({ error: 'Upload request expired' });
         }

         const expectedMessage = `Upload:${receiver}:${timestamp}`;
         const recovered = ethers.verifyMessage(expectedMessage, signature);
         if (recovered !== address) {
              fs.unlinkSync(req.file.path);
              return res.status(401).json({ error: 'Invalid upload signature' });
         }

         const mediaUrl = `http://localhost:5000/uploads/${req.file.filename}`;
         const isImage = req.file.mimetype.startsWith('image/');
         
         res.json({ mediaUrl, mediaType: isImage ? 'image' : 'file' });
     } catch(err) {
         if (req.file && req.file.path) fs.unlinkSync(req.file.path);
         res.status(500).json({ error: 'Upload failed' });
     }
});

// --- Socket.io ---

// Store user sockets
const userSockets = new Map(); // address -> Set(socketId)

const broadcastPresence = async (address, isOnline) => {
    try {
        const user = await User.findOneAndUpdate(
            { address }, 
            { isOnline, lastSeen: Date.now() },
            { new: true }
        );
        
        if (!user) return;
        
        // Notify all online friends
        user.friends.forEach(friendAddress => {
            const socketIds = userSockets.get(friendAddress);
            if (socketIds) {
                socketIds.forEach(sid => {
                    io.to(sid).emit('presence_update', {
                        address,
                        isOnline,
                        lastSeen: user.lastSeen
                    });
                });
            }
        });
    } catch(err) {
        console.error('Presence error:', err);
    }
};

io.on('connection', (socket) => {
    let currentUserAddress = null;

    // Secure authentication
    socket.on('authenticate', async (data) => {
        const { address, timestamp, signature } = data;
        
        try {
            if (Math.abs(Date.now() - timestamp) > 300000) {
                 return socket.emit('error', 'Auth timestamp expired');
            }

            const expectedMessage = `Auth:${timestamp}`;
            const recovered = ethers.verifyMessage(expectedMessage, signature);
            
            if (recovered === address) {
                if (!userSockets.has(address)) userSockets.set(address, new Set());
                userSockets.get(address).add(socket.id);
                currentUserAddress = address;

                // Broadcast online status
                await broadcastPresence(address, true);

            } else {
                 socket.emit('error', 'Invalid signature');
            }
        } catch (e) {
            socket.emit('error', 'Signature check crashed');
        }
    });

    // Handle Typing
    socket.on('typing', (data) => {
         const { receiver } = data;
         const receiverSockets = userSockets.get(receiver);
         if (receiverSockets) {
             receiverSockets.forEach(sid => io.to(sid).emit('typing', { sender: currentUserAddress }));
         }
    });

    socket.on('stop_typing', (data) => {
         const { receiver } = data;
         const receiverSockets = userSockets.get(receiver);
         if (receiverSockets) {
             receiverSockets.forEach(sid => io.to(sid).emit('stop_typing', { sender: currentUserAddress }));
         }
    });

    // Handle Read Receipts
    socket.on('update_message_status', async (data) => {
        const { messageIds, status, senderAddress } = data; // status is 'delivered' or 'seen'
        if (!messageIds || messageIds.length === 0) return;

        try {
            // Update DB
            await Message.updateMany(
                { _id: { $in: messageIds }, status: { $ne: 'seen' } },
                { $set: { status } }
            );

            // Notify the original sender
            const senderSockets = userSockets.get(senderAddress);
            if (senderSockets) {
                senderSockets.forEach(sid => {
                    io.to(sid).emit('message_status_updated', {
                        messageIds,
                        status
                    });
                });
            }
        } catch(err) {
            console.error('Update status err', err);
        }
    });

    // Send message securely
    socket.on('send_message', async (data) => {
        const { sender, receiver, content, mediaUrl, mediaType, signature } = data;
        
        try {
            // Verify message signature
            const payloadContent = content || mediaUrl || '';
            const expectedMessage = `Msg:${receiver}:${payloadContent}`;
            const recovered = ethers.verifyMessage(expectedMessage, signature);

            if (recovered !== sender) {
                 socket.emit('error', 'Message signature was invalid');
                 return;
            }

            const receiverSockets = userSockets.get(receiver);
            const isReceiverOnline = receiverSockets && receiverSockets.size > 0;
            
            // If online natively map delivered immediately, otherwise sent
            const initialStatus = isReceiverOnline ? 'delivered' : 'sent';

            // Valid signature, proceed
            const message = new Message({ 
                 sender, 
                 receiver, 
                 content: content || null,
                 mediaUrl: mediaUrl || null,
                 mediaType: mediaType || null,
                 status: initialStatus
            });
            await message.save();

            // Emit to receiver if online
            if (isReceiverOnline) {
                receiverSockets.forEach(sid => {
                    io.to(sid).emit('receive_message', message);
                });
            }
            
            // Emit back to sender to confirm
            socket.emit('message_sent', message);

        } catch (error) {
            console.error('Error saving signed message:', error);
        }
    });

    socket.on('disconnect', async () => {
        if (currentUserAddress && userSockets.has(currentUserAddress)) {
            const set = userSockets.get(currentUserAddress);
            set.delete(socket.id);
            if (set.size === 0) {
                userSockets.delete(currentUserAddress);
                // Broadcast offline status
                await broadcastPresence(currentUserAddress, false);
            }
        }
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Secure Server running on port ${PORT}`);
});
