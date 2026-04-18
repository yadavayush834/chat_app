<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=white" />
  <img src="https://img.shields.io/badge/Node.js-Express-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" />
  <img src="https://img.shields.io/badge/Socket.IO-4-010101?style=for-the-badge&logo=socketdotio&logoColor=white" />
  <img src="https://img.shields.io/badge/MongoDB-Mongoose-47A248?style=for-the-badge&logo=mongodb&logoColor=white" />
  <img src="https://img.shields.io/badge/Ethers.js-ECC_Crypto-3C3C3D?style=for-the-badge&logo=ethereum&logoColor=white" />
</p>

#  SecureChat

> A real-time, cryptographically secured chat application with client-side key generation, digital signature verification, and zero-trust architecture.

---

##  Features

| Feature | Description |
|---|---|
| ** Client-Side Key Generation** | BIP39 mnemonic phrase generates an ECC keypair entirely in the browser — no secrets ever leave your device |
| ** Digital Signature Verification** | Every action (register, add friend, send message, upload file) is signed client-side and verified server-side using `ethers.js` |
| ** Real-Time Messaging** | Instant message delivery via Socket.IO with WebSocket transport |
| ** Presence System** | Live online/offline indicators and "last seen" timestamps for all connections |
| ** Read Receipts** | Triple-state delivery tracking: `sent` → `delivered` → `seen` |
| ** Typing Indicators** | Real-time "typing…" status with auto-timeout |
| ** File & Image Sharing** | Upload and share images/files (up to 5 MB) with cryptographic upload authorization |
| ** Username System** | Human-readable usernames mapped to cryptographic addresses |
| ** Zero-Trust Backend** | The server never stores private keys and verifies every request via signature recovery |

---

##  Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT (React + Vite)                │
│                                                             │
│  ┌──────────┐  ┌───────────┐  ┌───────────┐  ┌──────────┐  │
│  │ Landing  │  │   Login   │  │   Chat    │  │  Crypto  │  │
│  │  Page    │  │   Page    │  │   Page    │  │  Utils   │  │
│  └──────────┘  └───────────┘  └───────────┘  └──────────┘  │
│       │              │              │              │         │
│       └──────────────┴──────────────┴──────────────┘         │
│                          │                                   │
│                   ethers.js Wallet                           │
│              (BIP39 · ECC · Signatures)                     │
└──────────────────────────┬──────────────────────────────────┘
                           │  HTTP REST + WebSocket (Socket.IO)
┌──────────────────────────┴──────────────────────────────────┐
│                     SERVER (Node.js + Express)              │
│                                                             │
│  ┌─────────────┐  ┌───────────────┐  ┌──────────────────┐  │
│  │  REST API   │  │  Socket.IO    │  │  Multer Upload   │  │
│  │  Routes     │  │  Events       │  │  Pipeline        │  │
│  └──────┬──────┘  └───────┬───────┘  └────────┬─────────┘  │
│         │                 │                    │             │
│         └─────────────────┴────────────────────┘             │
│                           │                                  │
│                  ethers.verifyMessage()                      │
│              (Signature Recovery on ALL ops)                 │
└──────────────────────────┬──────────────────────────────────┘
                           │
                    ┌──────┴──────┐
                    │   MongoDB   │
                    │   Atlas     │
                    └─────────────┘
```

---

##  Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **npm** ≥ 9
- A **MongoDB** instance (local or [MongoDB Atlas](https://www.mongodb.com/atlas))

### 1. Clone the Repository

```bash
git clone https://github.com/yadavayush834/chat_app.git
cd chat_app
```

### 2. Setup the Backend

```bash
cd backend
npm install
```

Create a `.env` file in the **`backend/`** directory:

```env
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/<dbname>
PORT=5000
```

Start the server:

```bash
node server.js
```

### 3. Setup the Client

```bash
cd ../client
npm install
npm run dev
```

The client will start on `http://localhost:5173` by default.

---

##  Project Structure

```
chat_app/
├── backend/
│   ├── models/
│   │   ├── User.js          # User schema (username, address, friends, presence)
│   │   └── Message.js        # Message schema (sender, receiver, content, media, status)
│   ├── uploads/              # Multer file storage directory
│   ├── db.js                 # MongoDB connection handler
│   ├── server.js             # Express server, REST API, Socket.IO events
│   ├── package.json
│   └── .env                  # Environment variables (MONGO_URI)
│
├── client/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── LandingPage.jsx   # Registration + wallet generation
│   │   │   ├── LoginPage.jsx     # Mnemonic-based login
│   │   │   └── ChatPage.jsx      # Main chat interface
│   │   ├── utils/
│   │   │   └── crypto.js         # Wallet generation, restoration, signing
│   │   ├── App.jsx               # React Router setup
│   │   ├── App.css               # Component styles
│   │   ├── index.css             # Global styles & design system
│   │   └── main.jsx              # Entry point
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
│
├── .gitignore
└── README.md
```

---

##  Security Model

### How It Works

1. **Registration** — User picks a username. A BIP39 mnemonic phrase and ECC keypair are generated **client-side**. The registration request is signed and the server verifies ownership via `ethers.verifyMessage()`.

2. **Login** — User enters their 12-word mnemonic phrase. The wallet is reconstructed in-browser and the derived address is checked against the database.

3. **Messaging** — Every outgoing message is signed with the sender's private key. The server recovers the signer's address and rejects any message where the recovered address doesn't match the claimed sender.

4. **Friend Requests** — Adding a friend requires a signed payload to prevent impersonation.

5. **File Uploads** — Each upload includes a timestamped signature. Expired or invalid signatures cause the uploaded file to be immediately deleted.

6. **Socket Authentication** — WebSocket connections are authenticated with a timestamped signature (5-minute expiry window) to prevent replay attacks.

### What the Server Never Sees

| Data | Stored? |
|---|---|
| Private keys | ❌ Never |
| Mnemonic phrases | ❌ Never |
| Raw passwords | ❌ N/A (passwordless) |
| Public addresses | ✅ As user identifier |
| Message content | ✅ Stored in DB |

---

## 📡 API Reference

### REST Endpoints

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `POST` | `/api/users/register` | Register a new username + address | Signature |
| `POST` | `/api/users/me` | Fetch user profile & friends list | Address |
| `POST` | `/api/users/friend` | Add a friend by username | Signature |
| `GET` | `/api/messages/:addr/:friendAddr` | Get message history between two users | — |
| `POST` | `/api/upload` | Upload a file attachment | Signature + Timestamp |

### Socket.IO Events

| Event | Direction | Description |
|---|---|---|
| `authenticate` | Client → Server | Authenticate socket connection with signed timestamp |
| `send_message` | Client → Server | Send a signed message |
| `receive_message` | Server → Client | Deliver incoming message |
| `message_sent` | Server → Client | Confirm message was saved |
| `typing` / `stop_typing` | Bidirectional | Typing indicator events |
| `update_message_status` | Client → Server | Mark messages as delivered/seen |
| `message_status_updated` | Server → Client | Notify sender of read receipts |
| `presence_update` | Server → Client | Online/offline status changes |

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, Vite 8, React Router 7 |
| **Backend** | Node.js, Express 5 |
| **Real-Time** | Socket.IO 4 |
| **Database** | MongoDB (Mongoose 9) |
| **Cryptography** | ethers.js 6 (ECC / BIP39 / ECDSA) |
| **File Uploads** | Multer 2 |

---

##  Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the [ISC License](https://opensource.org/licenses/ISC).

---

<p align="center">
  Built with ❤️ using React, Node.js, and ethers.js
</p>
