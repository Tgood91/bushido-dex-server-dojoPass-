# Dojo Pass DNA trait service

Living ERC-721 metadata + SVG for Dojo Pass holders. Point `DojoPassDNA.setBaseURI` at
`https://<host>/api/dojo-pass/<chain>/` (chains: `base`, `monad`, `base-sepolia`, `monad-testnet`).

- `GET /api/dojo-pass/:chain/:id[/metadata]` — `id` is a holder address or DojoPassDNA tokenId (uint160(holder))
- `GET /api/dojo-pass/:chain/:id/image.svg`
- `GET /health`

Env: `PUBLIC_BASE_URL`, `DOJO_PASS_BASE_SEPOLIA`, `DOJO_PASS_MONAD_TESTNET`, optional `RPC_<CHAIN>`.

`npm ci && npm test && npm run build && npm start`. Deploy: Render Blueprint (`render.yaml`).
