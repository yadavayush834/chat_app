const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    sender: {
        type: String, // address of the sender
        required: true
    },
    receiver: {
        type: String, // address of the receiver
        required: true
    },
    content: {
        type: String,
        required: false // Optional if mediaUrl is provided
    },
    status: {
        type: String,
        enum: ['sent', 'delivered', 'seen'],
        default: 'sent'
    },
    mediaUrl: {
        type: String,
        required: false
    },
    mediaType: {
        type: String, // 'image' or 'file'
        required: false
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Message', messageSchema);
