// Pump.fun Bot Sprint entrypoint (agent-fun/replay/v2).
//
// Wires the early-flow sniper strategy (strategy.ts) to the kit's SDK
// line loop (vendor/makefun-bot.ts). Node 22 standard library only; no
// network, no clock, no randomness — the bot answers the harness from
// stdin and speaks only in replies on stdout.

import { runBot } from './vendor/makefun-bot.ts';
import { createStrategy } from './strategy.ts';

await runBot(createStrategy());
