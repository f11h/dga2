import { STARTS } from './game.js';

export const TRACK = [
  [4,10],[4,9],[4,8],[4,7],[4,6],[3,6],[2,6],[1,6],[0,6],[0,5],
  [0,4],[1,4],[2,4],[3,4],[4,4],[4,3],[4,2],[4,1],[4,0],[5,0],
  [6,0],[6,1],[6,2],[6,3],[6,4],[7,4],[8,4],[9,4],[10,4],[10,5],
  [10,6],[9,6],[8,6],[7,6],[6,6],[6,7],[6,8],[6,9],[6,10],[5,10]
];
export const GOALS = [
  [[5,9],[5,8],[5,7],[5,6]], [[1,5],[2,5],[3,5],[4,5]],
  [[5,1],[5,2],[5,3],[5,4]], [[9,5],[8,5],[7,5],[6,5]]
];
const HOMES = [[-3.4,3.4],[-3.4,-3.4],[3.4,-3.4],[3.4,3.4]];
const OFFSETS = [[-.55,-.55],[.55,-.55],[-.55,.55],[.55,.55]];
// Free area per quadrant for larger homes: [centerX, centerZ, halfX, halfZ]; the southern homes avoid the railway.
const HOME_AREAS = [[-3.4,3.4,1.5,1.5],[-3.4,-4.15,1.5,1.2],[3.4,-4.15,1.5,1.2],[3.4,3.4,1.5,1.5]];
// Extra goal slots leave the board behind the goal entry and bend towards the side away from the railway.
const GOAL_SIDES = [[-1,0],[0,1],[1,0],[0,1]];
const SPACING = 1.1;

export const TRAIN_Z = -2;
export const TRAIN_X = [-18, 18];
/** Track indices crossed by the railway (cells with world z === TRAIN_Z): [15, 23]. */
export const TRAIN_TRACK = TRACK.flatMap((cell, index) => cell[1] - 5 === TRAIN_Z ? [index] : []);
/** Half width of the portal around x = 0 that hides the train when it passes a secured Mint piece on [5,3]. */
export const TRAIN_PORTAL = .52;

/**
 * Physical train crossing, mirroring Game.resolveTrain: main track cells 15 and 23 plus Mint's original
 * third goal slot [5,3] (progress 42 + count - 4, world [0,-2]). Security (protection of secured goal pieces) is left to the rules.
 */
export function trainCrossing(player, piece, progress, count = 4) {
  if (progress >= 0 && progress < 40) return TRAIN_TRACK.includes((STARTS[player] + progress) % 40);
  return progress >= 40 && location(player, piece, progress, count)[1] === TRAIN_Z;
}

export function homeLayout(player, count = 4) {
  if (count <= 4) return { x: HOMES[player][0], z: HOMES[player][1], cols: 2, rows: 2, spacing: SPACING, scale: 1, width: 2.7, depth: 2.7 };
  const [x, z, hx, hz] = HOME_AREAS[player];
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const spacing = Math.min(SPACING, 2 * hx / (cols - 1), rows > 1 ? 2 * hz / (rows - 1) : SPACING);
  const scale = spacing / SPACING;
  return {
    x, z, cols, rows, spacing, scale,
    width: Math.max(2.7, (cols - 1) * spacing + 1.5 * scale),
    depth: Math.max(2.7, Math.min(2 * hz + .1, (rows - 1) * spacing + 1.5 * scale))
  };
}

export function extraGoalCell(player, slot) {
  const entry = TRACK[(STARTS[player] + 39) % 40];
  const inner = GOALS[player][0];
  const out = [entry[0] - inner[0], entry[1] - inner[1]];
  const side = GOAL_SIDES[player];
  const row = Math.floor(slot / 3);
  const lateral = row % 2 ? 2 - slot % 3 : slot % 3;
  return [0, 1].map(axis => entry[axis] - 5 + out[axis] * (1.05 + row * .95) + side[axis] * lateral * .95);
}

export function location(player, piece, progress, count = 4) {
  count = Math.max(count, piece + 1, progress - 39);
  if (progress < 0) {
    const layout = homeLayout(player, count);
    if (count <= 4) return [layout.x + OFFSETS[piece][0], layout.z + OFFSETS[piece][1]];
    const row = Math.floor(piece / layout.cols);
    const inRow = row === layout.rows - 1 ? count - row * layout.cols : layout.cols;
    return [
      layout.x + (piece % layout.cols - (inRow - 1) / 2) * layout.spacing,
      layout.z + (row - (layout.rows - 1) / 2) * layout.spacing
    ];
  }
  if (progress < 40) return TRACK[(STARTS[player] + progress) % 40].map(value => value - 5);
  const extra = Math.max(0, count - 4);
  const index = progress - 40;
  return index < extra ? extraGoalCell(player, index) : GOALS[player][index - extra].map(value => value - 5);
}

export function moveRoute(before, destination) {
  return before < 0 ? [0] : Array.from({ length: Math.max(0, destination - before) }, (_, i) => before + i + 1);
}

export function snapshot(game) {
  return {
    current: game.current, mode: game.mode,
    paths: game.paths.map(path => ({ ...path })),
    players: game.players.map(player => ({ ...player, pieces: [...player.pieces] }))
  };
}

export function changes(before, after) {
  return before.players.flatMap(player => {
    const next = after.players[player.id];
    const length = Math.max(player.pieces.length, next.pieces.length);
    return Array.from({ length }, (_, piece) => {
      const added = piece >= player.pieces.length;
      const from = added ? -1 : player.pieces[piece];
      const to = piece < next.pieces.length ? next.pieces[piece] : -1;
      if (!added && from === to && player.eliminated === next.eliminated && piece < next.pieces.length) return null;
      return { player: player.id, piece, from, to, eliminated: next.eliminated,
        ...(added ? { added: true } : {}), ...(piece >= next.pieces.length ? { removed: true } : {}) };
    }).filter(Boolean);
  });
}
