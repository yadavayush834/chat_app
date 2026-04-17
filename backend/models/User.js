const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true
    },
    address: {
        type: String, // Public Key identifier (Ethereum format address string)
        required: true,
        unique: true
    },
    friends: [{
        type: String // We will store the addresses of friends here
    }],
    isOnline: {
        type: Boolean,
        default: false
    },
    lastSeen: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('User', userSchema);
