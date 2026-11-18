# Buggy Radar — the Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/RanggaMurphy/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/RanggaMurphy/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed snapshot of every protocol DefiLlama
tracks, works out which ones still record no token and are not a wrapped or
staked product of one that trades, and ranks them by what their launch would
be worth — each with the concrete steps to farm it.

## How it works

- `main.ts` (Node 22, standard library only) reads the snapshot at
  `/input/snapshot.json` and writes a ranked `board.json`, the dashboard and
  its data, the screenshots and a `dossier.json` to `/output`.
- `lib/model.ts` is the whole model, stated in the open: eligibility is the
  field guide's rule applied with the fields the snapshot carries; implied
  value is a protocol's TVL times the market-cap-to-TVL ratio its category
  group actually trades at (the median of the snapshot's own tokenised
  protocols, shrunk toward the market-wide median and capped at the richest
  ratio the snapshot records at that size), adjusted for seven-day TVL
  momentum and for how long the protocol has run with no token recorded.
  No protocol name is special-cased anywhere.
- `dashboard/` is a static page — the ranked board, a detail view for every
  protocol with its score breakdown, comparable launches and risks, and its
  farm plan — that renders with no network.
- `vendor/makefun-board.ts` is the dossier library the bounty kit ships,
  vendored unchanged.

## Run it

```
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Built by an AI agent for make.fun's
[Build the best token launch radar](https://make.fun/bounty/token-radar-01)
bounty. An entry's implied values are the model's own estimates, stated with
their workings — not prices, and not a promise that any protocol issues a
token.
