import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ChainNotConfiguredError, NOT_RECORDED, NoPassError, VIRTUES, getPassAttributes, rankFromStanding, virtueLevel,
  type PassAttributes, type PassReader,
} from '../src/aggregator.js';
import { buildMetadata } from '../src/metadata.js';
import { renderPassSvg } from '../src/render.js';
import { loadChains } from '../src/chains.js';

const HOLDER = '0xBA397fAae1D5Fe10C0356f2e585bef34577ab111' as const; // EIP-55 checksum
const NOW = 1_800_000_000;

type Stub = { base: boolean; monad: boolean; 'base-sepolia': boolean; 'monad-testnet': boolean; trades: number; honor: number; scores: number[] };
function stubReader(over: Partial<Stub> = {}): PassReader {
  const o: Stub = { base: true, monad: true, 'base-sepolia': true, 'monad-testnet': true, trades: 0, honor: 0, scores: [0, 0, 0, 0, 0], ...over };
  return {
    async pass(cfg) {
      const has = o[cfg.key];
      return { has, purchasedAt: has ? (cfg.family === 'base' ? NOW - 10 * 86400 : NOW - 20 * 86400) : 0, practitioner: has };
    },
    async honor(cfg) {
      return cfg.honor ? { tradeCount: o.trades, honorScore: o.honor, virtueScores: o.scores } : null;
    },
  };
}

test('rank bands match canon edges', () => {
  assert.equal(rankFromStanding(0), 'Tsurano');
  assert.equal(rankFromStanding(59), 'Tsurano');
  assert.equal(rankFromStanding(60), 'Samurai');
  assert.equal(rankFromStanding(74), 'Samurai');
  assert.equal(rankFromStanding(75), 'Bushido Master');
  assert.equal(rankFromStanding(89), 'Bushido Master');
  assert.equal(rankFromStanding(90), 'Shogun');
  assert.equal(rankFromStanding(100), 'Shogun');
});

test('virtue score 0-10 maps to tier 0-4', () => {
  assert.deepEqual([0, 1, 2.5, 3, 5, 6, 7.5, 8, 10, 99].map(virtueLevel), [0, 1, 1, 2, 2, 3, 3, 4, 4, 4]);
});

test('aggregator: real on-chain fields, honest gaps', async () => {
  const a = await getPassAttributes('base', HOLDER, stubReader({ honor: 77, trades: 3, scores: [10, 5, 2, 0, 8] }), NOW);
  assert.equal(a.passAgeDays, 10);
  assert.equal(a.recordedTrades, 3);
  assert.equal(a.rank, 'Bushido Master');
  assert.equal(a.homeChain, 'monad'); // trades recorded on HONOR (Monad)
  assert.deepEqual(VIRTUES.map((v) => a.virtues[v].level), [4, 2, 1, 0, 4, 0, 0, 0]);
  assert.deepEqual(VIRTUES.map((v) => a.virtues[v].recorded), [true, true, true, true, true, false, false, false]);
  assert.equal(a.checkInStreak, NOT_RECORDED);
  assert.equal(a.disciplineVolumeUsd, NOT_RECORDED);
});

test('aggregator: home chain falls back to earliest pass, standing clamps', async () => {
  const a = await getPassAttributes('base', HOLDER, stubReader({ monad: false, honor: 500 }), NOW);
  assert.equal(a.homeChain, 'base');
  assert.equal(a.standing, 100);
  assert.equal(a.rank, 'Shogun');
});

test('aggregator: NoPassError when holder has no pass on that chain', async () => {
  await assert.rejects(getPassAttributes('base', HOLDER, stubReader({ base: false }), NOW), NoPassError);
});

function sample(over: Partial<PassAttributes> = {}): PassAttributes {
  const virtues = Object.fromEntries(VIRTUES.map((v, i) => [v, { level: i % 5, recorded: i < 5 }])) as PassAttributes['virtues'];
  return {
    chain: 'monad', holder: HOLDER, practitioner: true, passPurchasedAt: NOW, passAgeDays: 19, recordedTrades: 0,
    disciplineVolumeUsd: NOT_RECORDED, checkInStreak: NOT_RECORDED, totalCheckIns: NOT_RECORDED,
    homeChain: 'monad', standing: 0, rank: 'Tsurano', virtues, ...over,
  };
}

test('renderer is deterministic and draws every layer', () => {
  const a = sample();
  const svg = renderPassSvg(a);
  assert.equal(svg, renderPassSvg(structuredClone(a)));
  for (const layer of ['background', 'frame', 'armour', 'figure']) assert.match(svg, new RegExp(`data-layer="${layer}"`));
  for (const v of VIRTUES) assert.match(svg, new RegExp(`data-virtue="${v}"`));
  assert.doesNotMatch(svg, /data-layer="flame"/); // streak not recorded -> no flame
});

test('renderer: frame per rank, flame at 7/30/90, chain colours', () => {
  const ranks = ['Tsurano', 'Samurai', 'Bushido Master', 'Shogun'] as const;
  const frames = new Set(ranks.map((rank) => renderPassSvg(sample({ rank }))));
  assert.equal(frames.size, 4);
  assert.doesNotMatch(renderPassSvg(sample({ checkInStreak: 6 })), /data-layer="flame"/);
  assert.match(renderPassSvg(sample({ checkInStreak: 7 })), /scale\(1\)/);
  assert.match(renderPassSvg(sample({ checkInStreak: 30 })), /scale\(1\.25\)/);
  assert.match(renderPassSvg(sample({ checkInStreak: 90 })), /scale\(1\.6\)/);
  assert.match(renderPassSvg(sample({ homeChain: 'base' })), /#0052FF/);
  assert.match(renderPassSvg(sample({ homeChain: 'monad' })), /#6E54FF/);
});

test('metadata: ERC-721 shape, numeric traits, string gaps', () => {
  const m = buildMetadata(sample(), 'https://example.test/');
  assert.equal(m.image, `https://example.test/api/dojo-pass/monad/${HOLDER}/image.svg`);
  const byType = Object.fromEntries(m.attributes.map((x) => [x.trait_type, x]));
  assert.deepEqual(byType['Rank'], { trait_type: 'Rank', value: 'Tsurano' });
  assert.deepEqual(byType['Virtue — Gi'], { trait_type: 'Virtue — Gi', value: 0, display_type: 'number', max_value: 4 });
  assert.deepEqual(byType['Virtue — Jisei'], { trait_type: 'Virtue — Jisei', value: NOT_RECORDED });
  assert.deepEqual(byType['Check-in Streak (days)'], { trait_type: 'Check-in Streak (days)', value: NOT_RECORDED });
  assert.match(m.description, /Not yet recorded on-chain: swap volume; check-ins; virtues Meiyo, Chugi, Jisei\./);
});

test('route param: address or DojoPassDNA tokenId (uint160(holder))', async () => {
  const { holderFromParam } = await import('../src/routes.js');
  const id = BigInt(HOLDER).toString(10);
  assert.equal(holderFromParam(id), HOLDER);
  assert.equal(holderFromParam(HOLDER.toLowerCase()), HOLDER);
  assert.equal(holderFromParam('0'), null);
  assert.equal(holderFromParam((1n << 160n).toString()), null);
  assert.equal(holderFromParam('12abc'), null);
});

const TEST_REGISTRY = '0x1111111111111111111111111111111111111111';

test('testnet: registry from env, no HONOR feed -> trades and virtues not recorded', async () => {
  const chains = loadChains({ DOJO_PASS_BASE_SEPOLIA: TEST_REGISTRY });
  const a = await getPassAttributes('base-sepolia', HOLDER, stubReader(), NOW, chains);
  assert.equal(a.passAgeDays, 10);
  assert.equal(a.recordedTrades, NOT_RECORDED);
  assert.equal(a.homeChain, 'base-sepolia'); // only configured testnet; mainnet chains never compete
  assert.equal(a.rank, 'Tsurano');
  assert.ok(VIRTUES.every((v) => !a.virtues[v].recorded));
  const m = buildMetadata(a, 'https://x.test');
  const t = Object.fromEntries(m.attributes.map((x) => [x.trait_type, x.value]));
  assert.equal(t['Recorded Trades'], NOT_RECORDED);
  assert.equal(t['Home Chain'], 'Base Sepolia');
  assert.match(m.description, /Not yet recorded on-chain: trades; swap volume; check-ins; virtues Gi, Yu, Jin, Rei, Makoto, Meiyo, Chugi, Jisei\./);
  assert.match(renderPassSvg(a), /#0052FF/); // Base family colours
});

test('testnet: unconfigured registry is a ChainNotConfiguredError', async () => {
  const chains = loadChains({});
  await assert.rejects(getPassAttributes('monad-testnet', HOLDER, stubReader(), NOW, chains), ChainNotConfiguredError);
});

test('testnet: home chain is the earliest pass among configured testnets', async () => {
  const chains = loadChains({ DOJO_PASS_BASE_SEPOLIA: TEST_REGISTRY, DOJO_PASS_MONAD_TESTNET: TEST_REGISTRY });
  const a = await getPassAttributes('base-sepolia', HOLDER, stubReader(), NOW, chains);
  assert.equal(a.homeChain, 'monad-testnet'); // monad pass is older in the stub
  assert.match(renderPassSvg(a), /#6E54FF/);
});

test('loadChains rejects a malformed registry address', () => {
  assert.throws(() => loadChains({ DOJO_PASS_MONAD_TESTNET: '0x123' }), /not an address/);
});
