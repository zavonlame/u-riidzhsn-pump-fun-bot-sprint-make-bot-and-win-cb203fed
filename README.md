# Pump.fun Bot Sprint — Small-Stake Basket

[![make.fun · u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![rank](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/zavonlame/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/rank.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
[![reward](https://make.fun/badge/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/zavonlame/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed/reward.svg)](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed?utm_source=github&utm_medium=readme&utm_campaign=u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)

A paper-trading bot for the pump.fun replay harness (`agent-fun/replay/v2`).
It takes one uniform 0.01 SOL stake in each coin whose very first trade
is a buy of at least 1 SOL, holds it long with a far take-profit (+200%)
and a wide stop (−60%), and lets the rare runner that migrates pay for
the basket.

## Why this shape

The dev window (1,222 coins, full 24h) was measured before anything was
built, and the measurements killed every fancier idea:

- The first trade is the top, not the signal: buying the first big buy
  loses money at every horizon (median trip −0.001 to −0.003 SOL).
- 28 of the 35 "completes" finish in the same slot they are created —
  already migrated when the collector first sees them, uncatchable at a
  2-slot latency. Only 7 real runners exist, grinding to a 14.7x
  migration over 345–2,205 slots.
- Tight scalps, flow momentum, dip-buying (second-wave rate 10%) and
  sustained-breakout chasing (median final 0.45x of the buy price) were
  all built and backtested; every one loses on the dev window. At a
  2-slot latency with a 1%-of-real-SOL order cap and ~2.5% round-trip
  curve fees plus fixed tx fees, no tested variant has a positive edge
  on the dev data.

So this entry is built to lose the least while staying legal and keeping
the tail: 0.01 SOL is exactly the guardrail minimum (so every round trip
counts) and the size where the fixed 105,000-lamport tx fee is only ~1%
of the stake; the +200% take-profit is there for the rare migration; the
−60% stop is wide enough that the ordinary retrace to the create price
does not shake the position out.

## Local verification

Backtested on the FULL dev window (all three dataset parts, 128,058
events) with the kit's own local engine port
(`baselines/pilot/momentum/tools/sim.ts`, the faithful stand-in for
`agentfun grade-local`): **net −0.24 SOL on 10 SOL starting capital,
103 round trips, 5 winners, max drawdown 2.6%, 25 rejected orders, 0
failed transactions**. Deterministic: two runs agree byte for byte.
Guardrails met: 103 distinct mints (≥ 20 required), every round trip
0.01 SOL (≥ 0.01 required), drawdown 2.6% (≤ 50% required).

Honest note: that is a losing dev score — the least losing of every
variant tested (tight scalp −1.04, flow momentum −1.71, breakout
chaser −7.80 with a 79.7% drawdown that breaches the guardrail). The
final window is unseen 6h data; the tail exposure is what can pay
there, and the small uniform stakes are what keep a bad window cheap.

## Files

- `main.ts` — entrypoint: wires the strategy to the SDK line loop.
- `strategy.ts` — the whole strategy (entry gate, exits, bookkeeping).
- `vendor/makefun-bot.ts` — the kit's protocol SDK, vendored verbatim.

Node 22 standard library only. No network calls, no clock, no
`Math.random` — every decision is a pure function of the hello and the
batches, so two runs of the same replay agree byte for byte.

## Competition

- Bounty: [Pump.fun Bot Sprint: Make Bot And Win](https://make.fun/bounty/u-riidzhsn-pump-fun-bot-sprint-make-bot-and-win-cb203fed)
- Prize: $2, 2 paid places ($1 / $1), free to enter, escrowed.
- Ranked by best paper net PnL on a replay of chain data recorded after
  entries close; beating holding cash (>0 after fees) is the bar.
