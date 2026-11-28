---
name: solidity-verify
description: Reproduce, check and explorer-verify the Dojo Pass DNA contracts (Zerion DNA 1.0 template) and the live contracts this trait service reads. Use when compiling DojoPassDNA or TestDojoPass, checking that a deployed address runs our code, confirming the Dojo Pass registry / HONOR selectors in src/chains.ts against mainnet bytecode, or submitting source verification to Basescan / Monadscan (Etherscan V2 API). Node only, no Foundry needed.
---

# Solidity verify

Node scripts (solc-js 0.8.24, no Foundry) that rebuild the Dojo Pass DNA contracts byte for byte, compare them
with what is on chain, and submit verification to the Etherscan V2 API. The sources in `contracts/src` are a copy of
`Tgood91/Bushido-future` `roadmap/contracts/src`, at the same paths so the metadata hash can match. That
repo is the source of truth, so change the contracts there and copy them here.

## Setup

```bash
cd contracts && npm ci && cd ..      # solc 0.8.24 + OpenZeppelin 4.9.6, npm audit = 0
```

Scripts live in `.claude/skills/solidity-verify/scripts/` and run from the repo root. Chains are `base`,
`base-sepolia`, `monad` and `monad-testnet`. `RPC_<CHAIN>` overrides the public RPC, same as the server.

## Workflow

1. **Build and compare with the reference.** Run `npm run contracts:build`. It writes
   `contracts/out/<Name>.standard-input.json` and `<Name>.json`, then compares against `contracts/reference.json`.
   That file holds the bytecode the burner page deploys, taken from Bushido-future `roadmap/testnet/contracts.json`.
   - `EXACT` means the creation code and metadata hash both match.
   - `CODE match, metadata hash differs` means the executable code is identical but the CBOR metadata
     (source paths, remappings, settings) is not. Sourcify accepts this as a partial match. Etherscan needs the exact
     input, so verify with the standard-JSON that Foundry emitted for that build (`forge verify-contract
     --show-standard-json-input`) or rebuild with Foundry.
   - `MISMATCH` means different code, so stop: the sources or settings have drifted from the deployed build.
2. **Check a deployment.** Run `node .../onchain.mjs <chain> <address> src/dna/DojoPassDNA.sol:DojoPassDNA`.
   It masks immutables (`dojoPass`, the registry) and prints them, so you can confirm the DNA points at the right
   registry. Exit code 0 means the code matches.
3. **Check the selectors of a contract we only read.** Run `node .../selectors.mjs <chain> <address> "sig(types)" ...`.
   This is how the registry and HONOR ABIs in `src/chains.ts` are confirmed:
   ```bash
   S=.claude/skills/solidity-verify/scripts
   node $S/selectors.mjs base  0x6B6A971a0aaab34E70659E0723AD0dCe129f7D9c "hasDojoPass(address)" "passPurchasedAt(address)" "isPractitioner(address)"
   node $S/selectors.mjs monad 0x2647faf3aaA708D0B9a110744790E1f637FCca53 "hasDojoPass(address)" "passPurchasedAt(address)" "isPractitioner(address)"
   node $S/selectors.mjs monad 0x46D5F4924F833Cd4054A36eAEfa3bEca6cD92A7e "tradeCount(address)" "honorScores(address)" "getVirtueScores(address)"
   ```
   A runtime under about 200 bytes is a proxy, so check its implementation instead.
4. **Verify on the explorer.** Run `ETHERSCAN_API_KEY=... node .../verify.mjs <chain> <address> <path.sol:Contract> --args 0x<words>`.
   For `DojoPassDNA(registry)` the args are the registry address left-padded to 32 bytes (the immutable printed in
   step 2). For `TestDojoPass(owner, fee, firstHolder)` they are three words. Run step 2 first: only submit code that
   already matches.

## Rules

- Settings are pinned to Bushido-future `foundry.toml`: solc 0.8.24, optimizer 200 runs, evm `cancun` (shanghai
  gives the same code). Override with `EVM_VERSION` only to investigate, never to make a check pass.
- Never put a private key or API key in args or files. `ETHERSCAN_API_KEY` comes from the environment only.
- An address with code `0xef0100…` is an EIP-7702 delegation, not a contract. `onchain.mjs` refuses it.
- DojoPassDNA stays soulbound with plain `_mint` (burners carry 7702 delegates), and tokenId = uint160(holder).
  `src/routes.ts` depends on that: `tokenURI = baseURI + decimal tokenId`.
- If a check fails, make one fix attempt. If it still fails, stop and report the output.
