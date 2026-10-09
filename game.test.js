import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, EVENTS, EVENT_FIELDS, STARTS, TRAIN_FIELDS, selectEvent, eventProbability } from './game.js';

function fixedRoll(game, values) {
  const sides = game.sides();
  const draws = values.map(value => (value - .5) / sides);
  game.random = () => draws.length ? draws.shift() : .1;
  return game.roll();
}

function trigger(game, id, { actor = game.current, random = () => .25, resume = 'afterMove' } = {}) {
  game.random = random;
  game.queue = [{ ...EVENTS.find(event => event.id === id), actor, source: 'Test' }];
  game.current = actor;
  game.phase = 'events';
  game.resume = resume;
  game.rollData ||= { values: [1], total: 1, sides: 6, canEnter: false, again: false };
  return game.resolveEvent();
}

function assertBoard(game) {
  const positions = game.boardPieces({ trackOnly: true }).map(piece => piece.position);
  assert.equal(new Set(positions).size, positions.length, 'No shared track fields');
  for (const player of game.players) {
    const deployed = player.pieces.filter(progress => progress !== -1);
    assert.equal(new Set(deployed).size, deployed.length, 'No duplicate progress');
    assert.ok(player.pieces.every(progress => Number.isInteger(progress) && progress >= -1 && progress <= game.goalEnd(player.id)));
    assert.ok(player.score >= 0 && player.score < 32);
  }
}

test('Four players, sixteen pieces and exactly twelve unique event fields', () => {
  const game = new Game();
  assert.equal(game.players.length, 4);
  assert.equal(game.players.flatMap(player => player.pieces).length, 16);
  assert.equal(EVENT_FIELDS.length, 12);
  assert.equal(new Set(EVENT_FIELDS).size, 12);
  assert.ok(EVENT_FIELDS.every(position => position >= 0 && position < 40 && !STARTS.includes(position)));
});

test('Player slots default to humans and accept any human/computer combination', () => {
  assert.deepEqual(new Game().players.map(player => player.controller), Array(4).fill('human'));
  for (let mask = 0; mask < 16; mask++) {
    const controllers = Array.from({ length: 4 }, (_, index) => mask & (1 << index) ? 'computer' : 'human');
    const game = new Game({ controllers });
    assert.deepEqual(game.players.map(player => player.controller), controllers);
    assert.equal(game.players.length, 4);
  }
  assert.throws(() => new Game({ controllers: ['invalid'] }), /Spielersteuerung/);
});

test('Computer chooses mandatory deployment without changing game state or drawing randomness', () => {
  const game = new Game({ controllers: ['computer'], mode: 'classic' });
  fixedRoll(game, [6]);
  game.random = () => assert.fail('Move selection must not draw future dice results');
  const before = JSON.stringify(game);
  const piece = game.chooseComputerMove();
  assert.ok(game.legalMoves().some(move => move.piece === piece));
  assert.equal(JSON.stringify(game), before);
  game.move(piece);
  assert.equal(game.players[0].pieces[piece], 0);
});

test('Computer prefers an exact goal move over a capture', () => {
  const game = new Game({ controllers: ['computer'], mode: 'classic' });
  game.players[0].pieces = [39, 8, 20, 30];
  game.players[1].pieces[0] = 0;
  fixedRoll(game, [2]);
  assert.equal(game.chooseComputerMove(), 0);
});

test('Computer prefers capturing an opponent over ordinary advancement', () => {
  const game = new Game({ controllers: ['computer'], mode: 'classic' });
  game.players[0].pieces = [8, 20, 24, 30];
  game.players[1].pieces[0] = 0;
  fixedRoll(game, [2]);
  assert.equal(game.chooseComputerMove(), 0);
  const option = game.chooseComputerOption();
  game.move(option.piece, option.path);
  assert.equal(game.players[1].pieces[0], -1);
});

test('Computer considers nearby opponents when choosing between ordinary moves', () => {
  const game = new Game({ controllers: ['computer'], mode: 'classic' });
  game.players[0].pieces = [5, 15, 18, 20];
  game.players[1].pieces = [7, -1, -1, -1];
  fixedRoll(game, [1]);
  assert.equal(game.chooseComputerMove(), 1);
});

test('Computer obeys forced start clearing, goal blocking and two-dice rules', () => {
  const game = new Game({ controllers: ['computer'], mode: 'classic' });
  game.players[0].pieces = [0, 5, -1, -1];
  game.players[0].doubleTurns = 2;
  fixedRoll(game, [6, 2]);
  assert.equal(game.chooseComputerMove(), 0);
  game.move(game.chooseComputerMove());
  fixedRoll(game, [6, 6]);
  assert.equal(game.chooseComputerMove(), 2);

  const blocked = new Game({ mode: 'classic', controllers: ['computer'] });
  blocked.players[0].pieces = [39, 41, 5, 20];
  fixedRoll(blocked, [3]);
  assert.ok([2, 3].includes(blocked.chooseComputerMove()));
});

test('Computer reports a wrong phase rather than attempting an invalid move', () => {
  assert.throws(() => new Game().chooseComputerMove(), /gültigen Zug/);
});

test('A six enters a piece and grants a bonus roll', () => {
  const game = new Game({ mode: 'classic' });
  fixedRoll(game, [6]);
  assert.equal(game.legalMoves().length, 4);
  game.move(0);
  assert.equal(game.players[0].pieces[0], 0);
  assert.equal(game.current, 0);
  assert.equal(game.phase, 'roll');
});

test('No deployment on ordinary numbers; three attempts before changing player', () => {
  const game = new Game({ mode: 'classic' });
  fixedRoll(game, [2]);
  assert.equal(game.attempts, 1);
  assert.equal(game.current, 0);
  fixedRoll(game, [3]);
  assert.equal(game.attempts, 2);
  fixedRoll(game, [1]);
  assert.equal(game.current, 1);
  assert.equal(game.attempts, 0);
});

test('Home pieces must enter before deployed pieces move on a six', () => {
  const game = new Game({ mode: 'classic' });
  game.players[0].pieces[0] = 4;
  fixedRoll(game, [6]);
  assert.deepEqual(game.legalMoves().map(move => move.piece), [1, 2, 3]);
});

test('An occupied own starting square must be cleared', () => {
  const game = new Game({ mode: 'classic' });
  game.players[0].pieces = [0, 5, -1, -1];
  fixedRoll(game, [2]);
  assert.deepEqual(game.legalMoves(), [{ piece: 0, destination: 2 }]);
});

test('Landing on an opponent captures it; passing does not', () => {
  const game = new Game({ mode: 'classic' });
  game.players[0].pieces[0] = 8;
  game.players[1].pieces[0] = 0;
  fixedRoll(game, [2]);
  game.move(0);
  assert.equal(game.players[1].pieces[0], -1);

  const passing = new Game({ mode: 'classic' });
  passing.players[0].pieces[0] = 8;
  passing.players[1].pieces[0] = 0;
  fixedRoll(passing, [3]);
  passing.move(0);
  assert.equal(passing.players[1].pieces[0], 0);
});

test('Own occupied fields are not legal destinations', () => {
  const game = new Game({ mode: 'classic' });
  game.players[0].pieces = [1, 3, 10, 20];
  fixedRoll(game, [2]);
  assert.ok(!game.legalMoves().some(move => move.piece === 0));
});

test('Goal entry needs an exact count and cannot jump goal pieces', () => {
  const game = new Game({ mode: 'classic' });
  game.players[0].pieces = [39, 41, -1, -1];
  fixedRoll(game, [3]);
  assert.ok(!game.legalMoves().some(move => move.piece === 0));
  assert.ok(!game.legalMoves().some(move => move.piece === 1));

  const exact = new Game({ mode: 'classic' });
  exact.players[0].pieces[0] = 39;
  fixedRoll(exact, [4]);
  exact.move(0);
  assert.equal(exact.players[0].pieces[0], 43);
  assert.ok(exact.secured(0, 0));
});

test('Goal safety requires the backmost slot or an unbroken filled tail', () => {
  const game = new Game();
  game.players[0].pieces = [40, 42, 43, -1];
  assert.equal(game.secured(0, 0), false);
  assert.equal(game.secured(0, 1), true);
  assert.equal(game.secured(0, 2), true);
  game.players[0].pieces[3] = 41;
  assert.ok(game.players[0].pieces.every((_, index) => game.secured(0, index)));
});

test('Four goal pieces win the game', () => {
  const game = new Game({ mode: 'classic' });
  game.players[0].pieces = [39, 41, 42, 43];
  fixedRoll(game, [1]);
  game.move(0);
  assert.equal(game.winner, 0);
  assert.equal(game.phase, 'over');
});

test('Classic mode neither counts eyes nor triggers events', () => {
  const game = new Game({ mode: 'classic' });
  game.players[0].pieces[0] = 1;
  game.players[0].score = 31;
  fixedRoll(game, [1]);
  game.move(0);
  assert.equal(game.queue.length, 0);
  assert.equal(game.players[0].score, 31);
});

test('Counter event at or above 32 resets to zero and precedes movement', () => {
  const game = new Game();
  game.players[0].pieces[0] = 1;
  game.players[0].score = 30;
  fixedRoll(game, [4]);
  assert.equal(game.players[0].score, 0);
  assert.equal(game.phase, 'events');
  assert.match(game.queue[0].source, /32/);
  assert.equal(game.players[0].pieces[0], 1);
  game.resolveEvent();
  assert.notEqual(game.phase, 'events');
});

test('Each of the twelve event fields triggers on landing', () => {
  for (const field of EVENT_FIELDS) {
    const game = new Game();
    game.players[0].pieces = [field - 1, -1, -1, -1];
    fixedRoll(game, [1]);
    game.move(0);
    assert.equal(game.phase, 'events');
    assert.equal(game.queue.length, 1);
  }
});

test('Two dice add for movement; only a six-six enters the house', () => {
  const game = new Game({ mode: 'classic' });
  game.players[0].doubleTurns = 2;
  game.players[0].pieces[0] = 5;
  const roll = fixedRoll(game, [6, 2]);
  assert.equal(roll.total, 8);
  assert.equal(roll.canEnter, false);
  assert.equal(roll.again, true);
  assert.deepEqual(game.legalMoves(), [{ piece: 0, destination: 13 }]);
  game.move(0);
  assert.equal(game.players[0].doubleTurns, 2, 'Bonus rolls do not consume a turn');

  fixedRoll(game, [6, 6]);
  assert.equal(game.rollData.canEnter, true);
  assert.deepEqual(game.legalMoves().map(move => move.piece), [1, 2, 3]);
  game.move(1);
  assert.equal(game.players[0].pieces[1], 0);
});

test('Leaders return home, but secured goal pieces survive', () => {
  const game = new Game();
  game.players[0].pieces = [40, 43, 5, -1];
  game.players[1].pieces = [10, 20, -1, -1];
  trigger(game, 'leaders-home');
  assert.deepEqual(game.players[0].pieces, [-1, 43, 5, -1]);
  assert.deepEqual(game.players[1].pieces, [10, -1, -1, -1]);
});

test('All-home includes unprotected goal pieces but preserves secured tails', () => {
  const game = new Game();
  game.players[0].pieces = [40, 42, 43, -1];
  game.players[1].pieces = [1, 2, -1, -1];
  trigger(game, 'all-home');
  assert.deepEqual(game.players[0].pieces, [-1, 42, 43, -1]);
  assert.deepEqual(game.players[1].pieces, [-1, -1, -1, -1]);
});

test('Redistribution is unique, includes all track pieces, leaves goal and home untouched', () => {
  const game = new Game();
  game.players[0].pieces = [2, 40, 43, -1];
  game.players[1].pieces = [1, 5, -1, -1];
  trigger(game, 'redistribute');
  assert.equal(game.players[0].pieces[1], 40);
  assert.equal(game.players[0].pieces[2], 43);
  assert.equal(game.players[0].pieces[3], -1);
  assert.equal(game.boardPieces({ trackOnly: true }).length, 3);
  assertBoard(game);
  assert.equal(game.queue.length, 0, 'Redistribution never recursively triggers events');
});

test('Swapping preserves the occupied set and does not create overlaps', () => {
  const game = new Game();
  game.players[0].pieces = [2, 7, -1, -1];
  game.players[1].pieces = [2, 8, -1, -1];
  const before = game.boardPieces({ trackOnly: true }).map(piece => piece.position).sort((a, b) => a - b);
  trigger(game, 'swap');
  const after = game.boardPieces({ trackOnly: true }).map(piece => piece.position).sort((a, b) => a - b);
  assert.deepEqual(after, before);
  assertBoard(game);
});

test('Rocket chooses an eligible target and sends it home, not out of the game', () => {
  const game = new Game();
  game.players[0].pieces = [43, 40, -1, -1];
  game.players[1].pieces[0] = 3;
  const result = trigger(game, 'rocket', { random: () => 0 });
  assert.equal(result.target.piece, 1);
  assert.equal(game.players[0].pieces[1], -1);
  assert.equal(game.players[0].pieces[0], 43);
  assert.equal(game.players[0].eliminated, false);
});

test('Rocket with no available target explicitly reports no hit', () => {
  const game = new Game();
  const result = trigger(game, 'rocket');
  assert.equal(result.target, null);
  assert.match(result.detail, /ins Leere/);
});

test('An additional roll is granted even when no piece can move', () => {
  const game = new Game();
  trigger(game, 'again');
  assert.equal(game.current, 0);
  assert.equal(game.phase, 'roll');
});

test('Instant goal secures the leading piece, with a home-piece fallback', () => {
  const game = new Game();
  game.players[0].pieces = [1, 40, 43, -1];
  trigger(game, 'instant-goal');
  assert.deepEqual(game.players[0].pieces, [1, 42, 43, -1]);
  assert.equal(game.secured(0, 1), true);
  const homeGame = new Game();
  trigger(homeGame, 'instant-goal');
  assert.equal(homeGame.players[0].pieces[0], 43);
});

test('Instant goal can produce an immediate victory', () => {
  const game = new Game();
  game.players[0].pieces = [41, 42, 43, -1];
  trigger(game, 'instant-goal');
  assert.equal(game.phase, 'over');
  assert.equal(game.winner, 0);
});

for (const [id, expected] of [['double-one', 1], ['double-two', 2]]) {
  test(`${id} applies for exactly ${expected} subsequent own turns`, () => {
    const game = new Game();
    trigger(game, id);
    assert.equal(game.players[0].doubleTurns, expected);
    game.current = 0;
    game.endTurn();
    assert.equal(game.players[0].doubleTurns, expected - 1);
    if (expected === 2) {
      game.current = 0;
      game.endTurn();
      assert.equal(game.players[0].doubleTurns, 0);
    }
  });
}

test('A double bonus awarded mid-turn does not consume the current turn', () => {
  const game = new Game();
  game.players[0].pieces[0] = 1;
  game.rollData = { total: 2, values: [2], sides: 6, canEnter: false, again: false };
  trigger(game, 'double-two', { resume: 'move' });
  assert.equal(game.players[0].pendingDouble, 2);
  assert.equal(game.players[0].doubleTurns, 0);
  game.move(0);
  // Progress 3 is not an event field.
  assert.equal(game.players[0].doubleTurns, 2);
  assert.equal(game.players[0].pendingDouble, 0);
});

test('Elimination removes pieces, skips the player and can determine the winner', () => {
  const game = new Game();
  game.players[0].pieces[0] = 4;
  trigger(game, 'lose');
  assert.ok(game.players[0].eliminated);
  assert.deepEqual(game.players[0].pieces, [-1, -1, -1, -1]);
  assert.equal(game.current, 1);
  game.current = 3;
  game.endTurn();
  assert.equal(game.current, 1);

  game.players[2].eliminated = true;
  trigger(game, 'lose', { actor: 3 });
  assert.equal(game.winner, 1);
  assert.equal(game.phase, 'over');
});

for (const [id, sides] of [['ten', 10], ['four', 4]]) {
  test(`${id} lasts two full subsequent turns of every active player`, () => {
    const game = new Game();
    trigger(game, id);
    assert.equal(game.sides(), sides);
    assert.deepEqual(game.diceEffect.remaining, [2, 2, 2, 2]);
    for (let i = 0; i < 7; i++) {
      game.endTurn();
      assert.equal(game.sides(), sides);
    }
    game.endTurn();
    assert.equal(game.sides(), 6);
  });
}

test('Four-sided dice cannot deploy pieces and the maximum roll is four', () => {
  const game = new Game();
  trigger(game, 'four');
  const roll = fixedRoll(game, [4]);
  assert.equal(roll.values[0], 4);
  assert.equal(roll.canEnter, false);
  assert.equal(game.players[1].pieces.filter(progress => progress >= 0).length, 0);
});

test('Ten-sided dice can roll ten and still use six for entry', () => {
  const game = new Game();
  trigger(game, 'ten');
  assert.equal(fixedRoll(game, [10]).total, 10);
  assert.equal(fixedRoll(game, [6]).canEnter, true);
});

test('A new dice-side event replaces the old effect', () => {
  const game = new Game();
  trigger(game, 'ten');
  trigger(game, 'four', { actor: 1 });
  assert.equal(game.sides(), 4);
  assert.deepEqual(game.diceEffect.remaining, [2, 2, 2, 2]);
});

test('Wrong-phase rolling and illegal moves report errors', () => {
  const game = new Game({ mode: 'classic' });
  fixedRoll(game, [6]);
  assert.throws(() => game.roll(), /nicht gewürfelt/);
  assert.throws(() => game.move(9), /nicht ziehen/);
});

test('Elimination and leaders-home each have one percent probability; twelve others are equal', () => {
  const counts = new Map(EVENTS.map(event => [event.id, 0]));
  for (let i = 0; i < 120000; i++) {
    const event = selectEvent(() => (i + .5) / 120000);
    counts.set(event.id, counts.get(event.id) + 1);
  }
  assert.equal(counts.get('lose'), 1200);
  assert.equal(counts.get('leaders-home'), 1200);
  for (const event of EVENTS.filter(event => !['lose', 'leaders-home'].includes(event.id))) {
    assert.equal(counts.get(event.id), 9800);
  }
  for (const event of EVENTS) assert.ok(Math.abs(counts.get(event.id) / 120000 - eventProbability(event)) < 1e-12);
  assert.ok(Math.abs(EVENTS.reduce((sum, event) => sum + eventProbability(event), 0) - 1) < 1e-12);
  assert.equal(selectEvent(() => .009999).id, 'lose');
  assert.equal(selectEvent(() => .01).id, 'leaders-home');
  assert.equal(selectEvent(() => .019999).id, 'leaders-home');
  assert.ok(!['lose', 'leaders-home'].includes(selectEvent(() => .02).id));
});

test('Additional pieces extend both houses and preserve existing secured goal pieces', () => {
  const game = new Game();
  game.players[0].pieces = [40, 42, 43, -1];
  trigger(game, 'extra-piece', { resume: 'move' });
  assert.deepEqual(game.players[0].pieces, [41, 43, 44, -1, -1]);
  assert.equal(game.goalEnd(0), 44);
  assert.equal(game.secured(0, 1), true);
  assert.equal(game.secured(0, 2), true);
  assert.equal(game.secured(0, 0), false);
  for (let i = 0; i < 6; i++) trigger(game, 'extra-piece', { resume: 'move' });
  assert.equal(game.players[0].pieces.length, 11);
  assert.equal(game.goalEnd(0), 50);
  assertBoard(game);
});

test('Extended goal lanes require exact rolls, respect blocking and all pieces must finish', () => {
  const game = new Game({ mode: 'classic' });
  game.players[0].pieces = [39, 41, 42, 43, 44];
  fixedRoll(game, [1]);
  game.move(0);
  assert.equal(game.winner, 0);
  const blocked = new Game({ mode: 'classic' });
  blocked.players[0].pieces = [39, 41, -1, -1, -1];
  fixedRoll(blocked, [2]);
  assert.ok(!blocked.legalMoves().some(move => move.piece === 0));
  const exact = new Game({ mode: 'classic' });
  exact.players[0].pieces = [43, -1, -1, -1, -1];
  fixedRoll(exact, [2]);
  assert.equal(exact.players[0].pieces[0], 43);
  assert.notEqual(exact.phase, 'move');
  exact.current = 0; exact.phase = 'roll';
  fixedRoll(exact, [1]);
  exact.move(0);
  assert.equal(exact.players[0].pieces[0], 44);
  assert.equal(exact.secured(0, 0), true);
});

test('Instant goal uses the deepest available slot in an extended house', () => {
  const game = new Game();
  trigger(game, 'extra-piece');
  trigger(game, 'instant-goal', { actor: 0 });
  assert.equal(game.players[0].pieces[0], 44);
  assert.ok(game.secured(0, 0));
});

test('Extra pieces obey entry, clearing and branching rules and participate in all events', () => {
  const game = new Game({ mode: 'classic' });
  game.players[0].pieces = [3, 10, 20, 30, -1];
  fixedRoll(game, [6]);
  assert.deepEqual(game.legalMoves(), [{ piece: 4, destination: 0 }]);
  game.move(4);
  fixedRoll(game, [2]);
  assert.ok(game.legalMoves().some(move => move.piece === 4 && move.destination === 2));
  game.paths = [{ from: 1, delta: 4, kind: 'shortcut' }];
  assert.deepEqual(game.legalMoves().filter(move => move.piece === 4).map(move => move.path), [[1, 2], [1, 5]]);
  game.move(4, [1, 5]);
  game.current = 0;
  trigger(game, 'all-home');
  assert.deepEqual(game.players[0].pieces, [-1, -1, -1, -1, -1]);
  trigger(game, 'lose', { actor: 0 });
  assert.equal(game.players[0].pieces.length, 5);
  assert.ok(game.players[0].eliminated);
});

test('Train intervals remain between two and five rounds and do not count bonus rolls', () => {
  for (const draw of [0, .99999]) {
    const game = new Game({ mode: 'classic', random: () => draw });
    game.nextTrainRound = 2;
    game.current = 3;
    game.endTurn();
    assert.ok(game.pendingTrain);
    assert.equal(game.nextTrainRound - game.round, draw === 0 ? 2 : 5);
    game.resolveTrain();
    game.random = () => .99999;
    game.roll();
    game.move(0);
    assert.equal(game.round, 2);
    assert.equal(game.pendingTrain, false);
  }
});

test('Train scheduling counts table rounds, blocks dice and returns crossing figures home', () => {
  const game = new Game({ random: () => 0 });
  game.endTurn();
  assert.equal(game.nextTrainRound, 3);
  for (let i = 0; i < 6; i++) game.endTurn();
  assert.equal(game.pendingTrain, false);
  game.endTurn();
  assert.equal(game.round, 3);
  assert.equal(game.pendingTrain, true);
  game.players[0].pieces = [TRAIN_FIELDS[0], 43, -1, -1];
  game.players[1].pieces[0] = (TRAIN_FIELDS[1] - STARTS[1] + 40) % 40;
  game.players[2].pieces = [42, -1, -1, -1];
  assert.throws(() => game.roll(), /nicht gewürfelt/);
  const result = game.resolveTrain();
  assert.equal(result.targets.length, 3);
  assert.deepEqual(game.players[0].pieces, [-1, 43, -1, -1]);
  assert.equal(game.players[1].pieces[0], -1);
  assert.equal(game.players[2].pieces[0], -1);
  assert.equal(game.pendingTrain, false);
  assert.equal(game.nextTrainRound, 5);
  assert.throws(() => game.resolveTrain(), /keine Zugdurchfahrt/);
});

test('Train preserves secure goals, extended homes, off-track pieces and eliminated players', () => {
  const game = new Game();
  game.players[2].pieces = [43, 44, -1, -1, -1]; // Original mint slot 42 now has progress 43.
  game.players[0].pieces = [3, -1, -1, -1, -1];
  game.players[1].eliminated = true;
  game.players[1].pieces[0] = 5;
  game.pendingTrain = true;
  const result = game.resolveTrain();
  assert.deepEqual(result.targets, []);
  assert.deepEqual(game.players[2].pieces, [43, 44, -1, -1, -1]);
  game.players[2].pieces[1] = -1;
  game.pendingTrain = true;
  assert.equal(game.resolveTrain().targets[0].progress, 43);
});

test('Path event adds two directed choices, replaces old paths and never moves pieces', () => {
  const game = new Game();
  assert.equal(EVENTS.length, 14);
  game.players[0].pieces = [3, 40, 43, -1];
  const before = game.players.map(player => [...player.pieces]);
  trigger(game, 'paths', { resume: 'move', random: () => 0 });
  assert.deepEqual(game.players.map(player => player.pieces), before);
  assert.deepEqual(game.paths.map(link => [link.kind, link.delta]), [['shortcut', 4], ['detour', -3]]);
  assert.notEqual(game.paths[0].from, game.paths[1].from);
  const old = game.paths;
  trigger(game, 'paths', { resume: 'move', random: () => .9 });
  assert.notDeepEqual(game.paths, old);
  assert.equal(game.paths.length, 2);
  assert.equal(game.queue.length, 0);
  assert.deepEqual(new Game().paths, []);
});

test('Players can choose normal, shortcut and detour routes with the exact dice count', () => {
  const game = new Game({ mode: 'classic' });
  game.paths = [{ from: 3, delta: 4, kind: 'shortcut' }, { from: 6, delta: -3, kind: 'detour' }];
  game.players[0].pieces[0] = 2;
  fixedRoll(game, [3]);
  const options = game.legalMoves().filter(move => move.piece === 0);
  assert.deepEqual(options.map(move => move.path), [[3, 4, 5], [3, 7, 8]]);
  game.move(0, options[1].path);
  assert.equal(game.players[0].pieces[0], 8);

  game.current = 0;
  game.phase = 'roll';
  game.players[0].pieces[0] = 6;
  fixedRoll(game, [2]);
  assert.deepEqual(game.legalMoves().map(move => move.path), [[7, 8], [3, 4], [3, 7]]);
  game.move(0, [3, 4]);
  assert.equal(game.players[0].pieces[0], 4);
});

test('Routes cannot bypass rotated goal entrances, go behind starts or jump occupied goals', () => {
  for (let player = 0; player < 4; player++) {
    const game = new Game({ mode: 'classic' });
    game.current = player;
    game.paths = [
      { from: (STARTS[player] + 38) % 40, delta: 4, kind: 'shortcut' },
      { from: (STARTS[player] + 1) % 40, delta: -3, kind: 'detour' }
    ];
    game.players[player].pieces = [38, 1, 41, -1];
    fixedRoll(game, [2]);
    assert.deepEqual(game.legalMoves().find(move => move.piece === 0).path, [39, 40]);
    assert.deepEqual(game.legalMoves().filter(move => move.piece === 1).map(move => move.path), [[2, 3]]);
    game.phase = 'roll';
    fixedRoll(game, [3]);
    assert.ok(!game.legalMoves().some(move => move.piece === 0));
  }
});

test('Branch routes preserve captures, landing-only events and own destination blocking', () => {
  const game = new Game();
  game.paths = [{ from: 3, delta: 4, kind: 'shortcut' }];
  game.players[0].pieces[0] = 2;
  game.players[1].pieces[0] = 38; // Physical field 8.
  fixedRoll(game, [3]);
  game.move(0, [3, 7, 8]);
  assert.equal(game.players[1].pieces[0], -1);
  assert.equal(game.phase, 'events');
  assert.equal(game.queue.length, 1);
  assertBoard(game);

  const passing = new Game();
  passing.paths = game.paths;
  passing.players[0].pieces[0] = 2;
  fixedRoll(passing, [2]);
  passing.move(0, [3, 7]);
  assert.equal(passing.queue.length, 0);

  const blocked = new Game({ mode: 'classic' });
  blocked.paths = game.paths;
  blocked.players[0].pieces = [2, 8, -1, -1];
  fixedRoll(blocked, [3]);
  assert.ok(!blocked.legalMoves().some(move => move.piece === 0 && move.destination === 8));
  assert.throws(() => blocked.move(0, [3, 7, 8]), /nicht ziehen/);
});

test('New paths preserve mandatory deployment and each branch is used at most once per move', () => {
  const game = new Game({ mode: 'classic' });
  game.paths = [{ from: 3, delta: 4, kind: 'shortcut' }, { from: 7, delta: -3, kind: 'detour' }];
  game.players[0].pieces[0] = 2;
  fixedRoll(game, [6]);
  assert.deepEqual(game.legalMoves().map(move => move.piece), [1, 2, 3]);
  const routes = game.routes(0, 2, 20);
  assert.ok(routes.some(route => route.branches.length === 2));
  assert.ok(routes.every(route => route.path.length === 20 && route.branches.length <= 2));
  assert.ok(routes.every(route => new Set(route.branches).size === route.branches.length));
});

test('Computer chooses a concrete shortcut option without drawing randomness', () => {
  const game = new Game({ mode: 'classic', controllers: ['computer'] });
  game.paths = [{ from: 3, delta: 4, kind: 'shortcut' }];
  game.players[0].pieces = [2, 10, 15, 20];
  game.players[1].pieces[0] = 38;
  fixedRoll(game, [3]);
  game.random = () => assert.fail('No future random draws');
  const option = game.chooseComputerOption();
  assert.deepEqual(option.path, [3, 7, 8]);
  game.random = () => .5;
  game.move(option.piece, option.path);
  assert.equal(game.players[1].pieces[0], -1);
});

test('Long deterministic games preserve invariants and eventually terminate', () => {
  for (const mode of ['classic', 'events']) {
    for (let seed = 1; seed <= 12; seed++) {
      let state = seed;
      const random = () => {
        state = (Math.imul(1664525, state) + 1013904223) >>> 0;
        return state / 4294967296;
      };
      const game = new Game({ mode, random });
      let steps = 0;
      while (game.phase !== 'over' && steps++ < 30000) {
        if (game.pendingTrain) game.resolveTrain();
        else if (game.phase === 'roll') game.roll();
        else if (game.phase === 'events') game.resolveEvent();
        else if (game.phase === 'move') {
          const moves = game.legalMoves();
          assert.ok(moves.length > 0);
          game.move(moves[Math.floor(random() * moves.length)].piece);
        } else assert.fail('Unsettled phase: ' + game.phase);
        assertBoard(game);
      }
      assert.equal(game.phase, 'over', `${mode}, seed ${seed} stalled after ${steps} steps`);
    }
  }
});

test('Computer strategies finish full games under the same rules in both modes', () => {
  for (const mode of ['classic', 'events']) {
    for (let seed = 1; seed <= 12; seed++) {
      let state = seed;
      const random = () => {
        state = (Math.imul(1664525, state) + 1013904223) >>> 0;
        return state / 4294967296;
      };
      const game = new Game({ mode, random, controllers: Array(4).fill('computer') });
      let steps = 0;
      while (game.phase !== 'over' && steps++ < 30000) {
        if (game.pendingTrain) game.resolveTrain();
        else if (game.phase === 'roll') game.roll();
        else if (game.phase === 'events') game.resolveEvent();
        else if (game.phase === 'move') {
          const piece = game.chooseComputerMove();
          assert.ok(game.legalMoves().some(move => move.piece === piece));
          game.move(piece);
        } else assert.fail('Unsettled computer phase: ' + game.phase);
        assertBoard(game);
      }
      assert.equal(game.phase, 'over', `${mode}, seed ${seed} stalled after ${steps} steps`);
    }
  }
});
