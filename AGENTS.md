# SecureChat

Existing React/Vite + Express/Socket.IO messenger. Keep the wallet/recovery-phrase identity model and the charcoal/peach design.

- Root npm workspaces own the single package-lock.json. Run commands from the repository root.
- `backend/server.js` exports an isolated server factory; never listen or create production data when importing it in tests.
- `backend/db.js` uses Node SQLite (Node >=22.13). All SQL values use bound parameters. Runtime data and uploads belong under ignored `backend/data/`.
- HTTP-only sessions authenticate HTTP and Socket.IO. Verify participant access to every history/file request and recipient ownership for receipts. Never restore the prototype's public history or static upload endpoints.
- Authentication challenges are single-use with finite expiry. Message signatures bind all fields through the identical `messagePayload` function in client and server. Preserve sender/clientId idempotency and monotonic receipt states.
- Signing keys are tab-scoped in sessionStorage; never log or commit recovery phrases, keys, session cookies, runtime data, or personal messages. Do not claim end-to-end encryption.
- `client/src/pages/ChatPage.jsx` owns messaging lifecycle and drafts. Clean up sockets/timers on unmount; preserve drafts when offline and guard stale history/upload responses when switching conversations.
- Shared components and tokens live in `client/src/components/` and `client/src/index.css`. Keep keyboard navigation, visible focus, reduced motion support, and a functional 390px phone layout. Fonts are local with licenses.
- Required checks: `npm test`, `npm run lint`, `npm run build`, and `npm run test:e2e` for changes to the main user flows. Browser tests use a temporary server/database and independent account contexts; never use the user's account as test data.
- Keep README concise. Update screenshots when visibly changing the app. GitHub commits must exclude build artifacts and runtime data.
