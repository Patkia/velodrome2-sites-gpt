# Velodrome Position Monitor — Sites POC

A static, mock-only dashboard inspired by the read-only monitor view in the separate `velodrome2` project.

## Safety boundaries

- No production source is imported or copied.
- No API, RPC, Telegram, Upstash, wallet, transaction, cron, authentication, or write operation exists.
- Mock data lives in `data/mock-positions.js` so a future read-only API adapter can replace it without changing the UI structure.

## Local run

Run the checks (Node.js 18+):

```powershell
npm run check
npm test
```

Serve the directory with any static file server, for example:

```powershell
npx --yes serve .
```

Then open the local URL printed by the server. This command only serves static local files; the POC itself makes no network requests.

## ChatGPT Sites readiness

This is a stateless static website with no durable storage or secrets, which matches the simplest Sites shape. It has not been deployed.
