# Dojo Pass DNA trait service

Living ERC-721 metadata + SVG for Dojo Pass holders. Point `DojoPassDNA.setBaseURI` at
`https://<host>/api/dojo-pass/<chain>/` (chains: `base`, `monad`, `base-sepolia`, `monad-testnet`).

- `GET /api/dojo-pass/:chain/:id[/metadata]` — `id` is a holder address or DojoPassDNA tokenId (uint160(holder))
- `GET /api/dojo-pass/:chain/:id/image.svg`
- `GET /health`

Env: `PUBLIC_BASE_URL`, `DOJO_PASS_BASE_SEPOLIA`, `DOJO_PASS_MONAD_TESTNET`, optional `RPC_<CHAIN>`.

`npm ci && npm test && npm run build && npm start`. Deploy: Render Blueprint (`render.yaml`).

## Contracts (Bushido Dojo Pass DNA)

`contracts/src` holds DojoPassDNA (the Bushido living, soulbound Dojo Pass) and the TestDojoPass registry stand-in, copied from
Bushido-future `roadmap/contracts` at the same paths. The `solidity-verify` skill
(`.claude/skills/solidity-verify/SKILL.md`) rebuilds them with solc-js, compares them with the deployed bytecode,
checks the registry and HONOR selectors this service reads, and submits Etherscan V2 verification.
Run `cd contracts && npm ci && cd .. && npm run contracts:build`.
