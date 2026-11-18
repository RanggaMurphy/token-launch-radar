// The token launch radar's program: read the sealed snapshot, score every protocol that still
// records no token, rank the board, and hand the scorer a self-contained /output — board.json,
// the dashboard and its data, the screenshots, and a dossier.json that matches the scorer's own
// rebuild of the folder.
//
// The runtime runs this twice on a fresh snapshot, with no network, and the two /output trees
// must come out byte-identical, so nothing here reads a clock, a random source or the
// filesystem outside /input, the repository and /output: the snapshot's own as_of is the only
// date the model ever sees.
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>

import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repo = dirname(fileURLToPath(import.meta.url));

/** The board's own limits, restated for the dossier's caps: the scorer holds the dossier to them. */
const CAPS = {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 512 * 1024 },
  dashboard: { max_files: 400, max_bytes: 4 * 1024 * 1024 },
} as const;

function inputPath(argv: string[]): string {
  const at = argv.indexOf('--input');
  if (at !== -1 && typeof argv[at + 1] === 'string') return argv[at + 1]!;
  const positional = argv.slice(2).find((a) => !a.startsWith('-'));
  return positional ?? '/input/snapshot.json';
}

function main(): void {
  const output = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  const snapshot = parseSnapshot(readFileSync(inputPath(process.argv), 'utf8'));
  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue !== null) throw new Error(`board refused: ${issue}`);
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, 'board.json'), `${JSON.stringify(board, null, 2)}\n`);
  writeFileSync(join(output, 'data.js'), dataScript(radar));
  cpSync(join(repo, 'dashboard'), join(output, 'dashboard'), { recursive: true });
  cpSync(join(repo, 'screenshots'), join(output, 'screenshots'), { recursive: true });
  // buildDossier returns the dossier's exact bytes; the gate compares dossier.json against a
  // fresh build byte for byte, so they are written as returned, never re-serialised.
  writeFileSync(join(output, 'dossier.json'), buildDossier(output, CAPS));
  process.stdout.write(`board: ${board.length} pre-token protocols ranked, watchlist ${snapshot.watchlist.length}/${snapshot.watchlist.length} covered\n`);
}

main();
