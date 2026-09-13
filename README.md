# Velodrome Position Monitor — Sites Worker POC

An owner-only ChatGPT Sites proof of concept using the supported Vinext and Cloudflare Workers runtime.

- The dashboard loads data from the same-origin `GET /api/positions` route.
- The route returns deterministic fixture data only.
- There are no blockchain, RPC, DeFiLlama, Blockscout, storage, transaction, notification, or background-job integrations.

## Commands

```powershell
npm run check
npm test
npm run lint
npm run build
npm start
```

The build must emit `dist/server/index.js` and client assets. Runtime values are not required in this fixture-only phase.
