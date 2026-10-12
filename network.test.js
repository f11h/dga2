import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from './game.js';
import { RoomConnection, SESSION_KEYS, readSession, clearSession, joinURL, canAct, restoreEngine, wirePhase } from './network.js';

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
function fixture() {
  const sockets = [];
  const storage = memoryStorage();
  const connection = new RoomConnection('player', { storage, location: { href: 'https://example.test/controller/?room=ABCDE', protocol: 'https:' },
    socketFactory: url => {
      const socket = { url, readyState: 0, sent: [], send(value) { this.sent.push(JSON.parse(value)); }, close() { this.readyState = 3; this.onclose?.(); } };
      sockets.push(socket); return socket;
    } });
  return { sockets, storage, connection };
}

test('join URLs expose only the room code, and preserve project subpaths', () => {
  assert.equal(joinURL('ABCDE', 'https://example.test/project/?token=secret'), 'https://example.test/project/controller/?room=ABCDE');
});

test('session credentials are role-separated, validated and removable', () => {
  const storage = memoryStorage();
  storage.setItem(SESSION_KEYS.host, JSON.stringify({ code: 'ABCDE', token: 'secret', role: 'host' }));
  assert.equal(readSession('host', storage).token, 'secret');
  assert.equal(readSession('player', storage), null);
  storage.setItem(SESSION_KEYS.player, JSON.stringify({ code: 'ABCDE', token: 'secret', role: 'host' }));
  assert.equal(readSession('player', storage), null);
  clearSession('host', storage);
  assert.equal(readSession('host', storage), null);
});

test('phone actions require connection, stable state, all humans and the actual actor', () => {
  const room = { status: 'playing', busy: false, hostConnected: true,
    seats: [{ kind: 'human', connected: true }, { kind: 'computer', connected: false }],
    state: { phase: 'roll', current: 0 } };
  assert.equal(canAct(room, 0, true), true);
  assert.equal(canAct(room, 1, true), false);
  assert.equal(canAct(room, 0, false), false);
  assert.equal(canAct({ ...room, busy: true }, 0, true), false);
  assert.equal(canAct({ ...room, hostConnected: false }, 0, true), false);
  assert.equal(canAct({ ...room, seats: [{ kind: 'human', connected: false }] }, 0, true), false);
  assert.equal(canAct({ ...room, state: { phase: 'roll', current: 0, pendingTrain: true } }, 0, true), false);
  const finalEvent = { ...room, status: 'finished', state: { phase: 'over', current: 1, eventOpen: true, eventActor: 0 } };
  assert.equal(canAct(finalEvent, 0, true), true);
  assert.equal(canAct(finalEvent, 1, true), false);
});

test('wire phase stays event until result confirmation even when the engine already advanced', () => {
  assert.equal(wirePhase('events', false), 'event');
  assert.equal(wirePhase('events', true), 'event');
  assert.equal(wirePhase('roll', true), 'event');
  assert.equal(wirePhase('move', true), 'event');
  assert.equal(wirePhase('over', true), 'over');
  assert.equal(wirePhase('roll', false), 'roll');
  assert.equal(wirePhase('move', false), 'move');
});

test('engine restoration preserves pending events, paths, dice effects, train and empty seats without overwriting methods', () => {
  const original = new Game({ controllers: ['human', 'computer', 'empty', 'empty'] });
  original.paths = [{ from: 3, delta: 4, kind: 'shortcut' }];
  original.pendingTrain = true;
  original.nextTrainRound = 8;
  original.queue = [{ id: 'again', actor: 0, source: 'test' }];
  original.phase = 'events';
  original.resume = 'move';
  original.rollData = { total: 6, values: [6], again: true, canEnter: true };
  const state = { engine: JSON.parse(JSON.stringify(original)), sides: 6, legalMoves: [] };
  const restored = restoreEngine(Game, state);
  assert.equal(typeof restored.sides, 'function');
  assert.equal(typeof restored.legalMoves, 'function');
  assert.equal(typeof restored.random, 'function');
  assert.deepEqual(JSON.parse(JSON.stringify(restored)), state.engine);
  assert.equal(restored.players[2].absent, true);
  assert.equal(restored.pendingTrain, true);
  assert.throws(() => restoreEngine(Game, {}), /unvollständig/);
});

test('connection locks sending until welcome, uses WSS, persists secret only locally and resumes without replaying actions', () => {
  const { connection, sockets, storage } = fixture();
  connection.connect({ type: 'join', code: 'ABCDE', name: 'Ada' });
  const first = sockets[0];
  assert.equal(first.url, 'wss://example.test/ws');
  assert.equal(connection.send({ type: 'action', action: 'roll' }), false);
  first.readyState = 1; first.onopen();
  assert.deepEqual(first.sent[0], { type: 'join', code: 'ABCDE', name: 'Ada' });
  first.onmessage({ data: JSON.stringify({ type: 'welcome', role: 'player', code: 'ABCDE', token: 'secret', seat: 0, room: {} }) });
  assert.equal(connection.ready, true);
  assert.equal(readSession('player', storage).token, 'secret');
  assert.equal(connection.send({ type: 'action', action: 'roll', revision: 1 }), true);
  first.close();
  assert.equal(connection.ready, false);
  clearTimeout(connection.retry);
  connection.open();
  const second = sockets[1]; second.readyState = 1; second.onopen();
  assert.deepEqual(second.sent, [{ type: 'resume', code: 'ABCDE', token: 'secret' }]);
  connection.close();
});

test('wrong-role welcome never enables actions and server errors remain observable', () => {
  const { connection, sockets } = fixture();
  const errors = [];
  connection.addEventListener('error', event => errors.push(event.detail.message));
  connection.connect({ type: 'join', code: 'ABCDE', name: 'Ada' });
  const socket = sockets[0]; socket.readyState = 1; socket.onopen();
  socket.onmessage({ data: JSON.stringify({ type: 'error', code: 'ROOM_NOT_FOUND', message: 'Raum nicht gefunden.' }) });
  assert.equal(errors[0], 'Raum nicht gefunden.');
  socket.onmessage({ data: JSON.stringify({ type: 'welcome', role: 'host', code: 'ABCDE', token: 'secret', seat: null }) });
  assert.equal(connection.ready, false);
  assert.equal(connection.stopped, true);
});

test('replacement error is terminal without deleting shared credentials for the winning tab', () => {
  const { connection, sockets, storage } = fixture();
  connection.connect({ type: 'join', code: 'ABCDE', name: 'Ada' });
  const socket = sockets[0]; socket.readyState = 1; socket.onopen();
  socket.onmessage({ data: JSON.stringify({ type: 'welcome', role: 'player', code: 'ABCDE', token: 'shared', seat: 0, room: {} }) });
  socket.onmessage({ data: JSON.stringify({ type: 'error', code: 'SESSION_REPLACED', message: 'Sitzung in anderem Tab fortgesetzt.' }) });
  assert.equal(connection.stopped, true);
  assert.equal(connection.ready, false);
  assert.equal(connection.retry, undefined);
  assert.equal(readSession('player', storage).token, 'shared');
  connection.open();
  assert.equal(sockets.length, 1);
});

test('replacement close code terminates reconnect even without an error frame', () => {
  const { connection, sockets } = fixture();
  const errors = [];
  connection.addEventListener('error', event => errors.push(event.detail.code));
  connection.connect({ type: 'join', code: 'ABCDE', name: 'Ada' });
  const socket = sockets[0]; socket.readyState = 1; socket.onopen();
  socket.onclose({ code: 4001 });
  assert.equal(connection.stopped, true);
  assert.equal(connection.ready, false);
  assert.equal(connection.retry, undefined);
  assert.deepEqual(errors, ['SESSION_REPLACED']);
  connection.open();
  assert.equal(sockets.length, 1);
});

test('a revoked lobby-seat token stops automatic resume and surfaces the server error', () => {
  const { connection, sockets } = fixture();
  const errors = [];
  connection.addEventListener('error', event => errors.push(event.detail));
  connection.connect({ type: 'resume', code: 'ABCDE', token: 'revoked' });
  const socket = sockets[0]; socket.readyState = 1; socket.onopen();
  socket.onmessage({ data: JSON.stringify({ type: 'error', code: 'INVALID_TOKEN', message: 'Der Sitzungsschlüssel ist nicht mehr gültig.' }) });
  assert.equal(connection.stopped, true);
  assert.equal(connection.ready, false);
  assert.equal(connection.terminalMessage, 'Der Sitzungsschlüssel ist nicht mehr gültig.');
  assert.equal(errors[0].code, 'INVALID_TOKEN');
  connection.open();
  assert.equal(sockets.length, 1);
});

for (const code of ['ROOM_EXPIRED', 'ROOM_NOT_FOUND']) {
  test(`${code} stops retrying a nonexistent room and keeps the error visible`, () => {
    const { connection, sockets } = fixture();
    const errors = [];
    connection.addEventListener('error', event => errors.push(event.detail));
    connection.connect({ type: 'resume', code: 'ABCDE', token: 'old-room-token' });
    const socket = sockets[0]; socket.readyState = 1; socket.onopen();
    socket.onmessage({ data: JSON.stringify({ type: 'error', code, message: 'Bitte einen neuen Raum erstellen.' }) });
    assert.equal(connection.stopped, true);
    assert.equal(connection.ready, false);
    assert.equal(connection.terminalMessage, 'Bitte einen neuen Raum erstellen.');
    assert.equal(errors[0].code, code);
    connection.open();
    assert.equal(sockets.length, 1);
  });
}
