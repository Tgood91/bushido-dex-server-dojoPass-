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
    chain: 'monad', holder: HOLDER, practitioner: true, passPurchasedAt: NOW, passAgeDays: 19, epochsHeld: 2, weightKg: 14, weightClass: 'Paper', tenureBonus: 0, honorStanding: 0, recordedTrades: 0,
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

test('weight: epochs are whole weeks, weight steps 7 kg per epoch', async () => {
  const { epochsHeldFromDays, weightClassFromEpochs, tenureBonusFromEpochs, EPOCH_DAYS, KG_PER_EPOCH } = await import('../src/aggregator.js');
  assert.equal(EPOCH_DAYS, 7);
  assert.equal(KG_PER_EPOCH, 7);
  assert.equal(epochsHeldFromDays(6), 0); // a partial week does not count
  assert.equal(epochsHeldFromDays(7), 1);
  assert.equal(epochsHeldFromDays(13), 1);
  assert.equal(epochsHeldFromDays(14), 2);
  assert.equal(epochsHeldFromDays(365), 52);
});

test('weight classes: Paper 0-3, Wood 4-12, Stone 13-25, Iron 26-51, Mountain 52+', async () => {
  const { weightClassFromEpochs: c } = await import('../src/aggregator.js');
  assert.equal(c(0), 'Paper');
  assert.equal(c(3), 'Paper');
  assert.equal(c(4), 'Wood');
  assert.equal(c(12), 'Wood');
  assert.equal(c(13), 'Stone');
  assert.equal(c(25), 'Stone');
  assert.equal(c(26), 'Iron');
  assert.equal(c(51), 'Iron');
  assert.equal(c(52), 'Mountain');
});

test('tenure bonus: +1 per 5 epochs, capped at +10 from 50 epochs', async () => {
  const { tenureBonusFromEpochs: t } = await import('../src/aggregator.js');
  assert.equal(t(4), 0);
  assert.equal(t(5), 1);
  assert.equal(t(49), 9);
  assert.equal(t(50), 10);
  assert.equal(t(500), 10);
});

test('aggregator: tenure bonus adds to standing, rank uses the bonus, capped at 100', async () => {
  const NOW = 1_800_000_000;
  const heldFor = (days: number, r: PassReader): PassReader => ({
    ...r,
    async pass(cfg, h) { return { ...(await r.pass(cfg, h)), purchasedAt: NOW - days * 86400 }; },
  });
  // 260 days held = 37 epochs -> bonus 7; honor 70 -> standing 77 -> Bushido Master
  const a = await getPassAttributes('base', HOLDER, heldFor(260, stubReader({ honor: 70 })), NOW);
  assert.equal(a.passAgeDays, 260);
  assert.equal(a.epochsHeld, 37);
  assert.equal(a.weightKg, 259);
  assert.equal(a.weightClass, 'Iron');
  assert.equal(a.tenureBonus, 7);
  assert.equal(a.honorStanding, 70);
  assert.equal(a.standing, 77);
  assert.equal(a.rank, 'Bushido Master');
  // Cap: honor 95 + bonus 10 must not exceed 100
  const b = await getPassAttributes('base', HOLDER, heldFor(700, stubReader({ honor: 95 })), NOW);
  assert.equal(b.tenureBonus, 10);
  assert.equal(b.standing, 100);
  assert.equal(b.rank, 'Shogun');
});

test('metadata: weight attributes are number traits except Weight Class', async () => {
  const NOW = 1_800_000_000;
  const a = await getPassAttributes('base', HOLDER, stubReader({ honor: 40 }), NOW);
  const meta = buildMetadata(a, 'https://x.test');
  const byName = Object.fromEntries(meta.attributes.map((t: any) => [t.trait_type, t]));
  assert.equal(byName['Epochs Held'].display_type, 'number');
  assert.equal(byName['Weight Carried (kg)'].display_type, 'number');
  assert.equal(byName['Weight Class'].display_type, undefined);
  assert.equal(byName['Tenure Bonus'], undefined);
  // 37 epochs = 259 kg; per-day figure is weight / 365, rounded to 3 dp
  const a37 = await getPassAttributes('base', HOLDER, { ...stubReader({ honor: 40 }), async pass(c: any, h: any) { return { has: true, purchasedAt: NOW - 260 * 86400, practitioner: true }; } } as any, NOW);
  const per = Object.fromEntries(buildMetadata(a37, 'https://x.test').attributes.map((x: any) => [x.trait_type, x.value]));
  assert.equal(per['Weight Carried (kg)'], 259);
  assert.equal(per['Weight per Day (kg)'], 0.71);
});
