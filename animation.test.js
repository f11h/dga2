import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, EVENTS, TRAIN_FIELDS } from './game.js';
import { moveRoute, location, snapshot, changes, TRACK, GOALS, TRAIN_TRACK, TRAIN_Z, trainCrossing } from './animation.js';

test('Hops include every cell, home entry and the complete goal lane', () => {
  assert.deepEqual(moveRoute(-1, 0), [0]);
  assert.deepEqual(moveRoute(3, 9), [4,5,6,7,8,9]);
  assert.deepEqual(moveRoute(38, 43), [39,40,41,42,43]);
  assert.deepEqual(moveRoute(0, 20), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.deepEqual(moveRoute(43, 43), []);
});

test('Locations respect rotated starts, distinct homes and each goal lane', () => {
  for (let player = 0; player < 4; player++) {
    assert.deepEqual(location(player, 0, 0), TRACK[player * 10].map(value => value - 5));
    for (let progress = 40; progress <= 43; progress++) {
      assert.deepEqual(location(player, 0, progress), GOALS[player][progress - 40].map(value => value - 5));
    }
    assert.notDeepEqual(location(player, 0, -1), location(player, 1, -1));
  }
});

test('Snapshots remain independent during moves, captures and elimination', () => {
  const game = new Game({ mode: 'classic', random: () => 0 });
  game.players[0].pieces[0] = 0;
  game.players[1].pieces[0] = 31;
  const before = snapshot(game);
  game.roll(); game.move(0);
  const after = snapshot(game);
  assert.equal(before.players[0].pieces[0], 0);
  assert.equal(before.players[1].pieces[0], 31);
  assert.deepEqual(changes(before, after).map(({ player, from, to }) => ({ player, from, to })),
    [{ player: 0, from: 0, to: 1 }, { player: 1, from: 31, to: -1 }]);
  game.players[2].eliminated = true;
  assert.equal(changes(after, snapshot(game)).filter(change => change.eliminated).length, 4);
  assert.equal(after.players[2].eliminated, false);
});

test('Path snapshots are independent and chosen animation paths include branch hops', () => {
  const game = new Game();
  game.paths = [{ from: 3, delta: 4, kind: 'shortcut' }];
  const before = snapshot(game);
  game.paths[0].from = 6;
  assert.equal(before.paths[0].from, 3);
  game.paths = before.paths;
  game.players[0].pieces[0] = 2;
  game.phase = 'move';
  game.rollData = { total: 3, canEnter: false, again: false };
  const option = game.move(0, [3, 7, 8]);
  assert.deepEqual(option.path.map(progress => location(0, 0, progress)),
    [3, 7, 8].map(index => TRACK[index].map(value => value - 5)));
});

test('Extra-piece snapshots expose the new pawn and preserve original goal locations', () => {
  const game = new Game();
  game.players[0].pieces = [40, 42, 43, -1];
  const before = snapshot(game);
  game.queue = [{ ...EVENTS.find(event => event.id === 'extra-piece'), actor: 0 }];
  game.phase = 'events'; game.resume = 'move';
  game.rollData = { total: 1, canEnter: false, again: false };
  game.resolveEvent();
  const after = snapshot(game);
  const added = changes(before, after).find(change => change.added);
  assert.deepEqual(added, { player: 0, piece: 4, from: -1, to: -1, eliminated: false, added: true });
  for (let piece = 0; piece < 3; piece++) {
    assert.deepEqual(location(0, piece, before.players[0].pieces[piece], 4),
      location(0, piece, after.players[0].pieces[piece], 5));
  }
});

test('Dynamic homes and goals have distinct finite positions and match physical train collisions', () => {
  assert.deepEqual(TRAIN_TRACK, TRAIN_FIELDS);
  for (let count = 4; count <= 40; count++) {
    for (let player = 0; player < 4; player++) {
      const homes = Array.from({ length: count }, (_, piece) => location(player, piece, -1, count));
      const goals = Array.from({ length: count }, (_, slot) => location(player, 0, 40 + slot, count));
      for (const positions of [homes, goals]) {
        assert.ok(positions.every(point => point.every(Number.isFinite)));
        assert.equal(new Set(positions.map(point => point.join(','))).size, count);
      }
      for (let slot = 0; slot < 4; slot++) {
        assert.deepEqual(goals[count - 4 + slot], GOALS[player][slot].map(value => value - 5));
      }
      for (let progress = -1; progress < 40 + count; progress++) {
        const crossing = trainCrossing(player, 0, progress, count);
        const expected = progress >= 0 && progress < 40
          ? TRAIN_FIELDS.includes((player * 10 + progress) % 40)
          : player === 2 && progress === 42 + count - 4;
        assert.equal(crossing, expected);
        if (crossing) assert.equal(location(player, 0, progress, count)[1], TRAIN_Z);
      }
    }
  }
});
