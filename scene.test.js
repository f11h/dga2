import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './node_modules/three/build/three.module.js';
import { Game } from './game.js';
import { snapshot } from './animation.js';

const motion = { matches: false };
globalThis.matchMedia = () => motion;
const caption = { textContent: '' };
globalThis.document = { getElementById: () => caption };
const { BoardScene } = await import('./scene.js');

function cameraScene() {
  return Object.assign(Object.create(BoardScene.prototype), {
    camera: { aspect: 1 }, cameraGoal: new THREE.Vector3(),
    focus: new THREE.Vector3(), waiting: true, overview: false,
    landscape: { status: 'Sonnig' }
  });
}

test('Waiting always restores the full-board camera without disabling action following', () => {
  const scene = cameraScene();
  scene.follow(new THREE.Vector3(3, 1, 4));
  assert.equal(scene.waiting, false);
  assert.equal(scene.focus.x, 3);
  scene.idle();
  assert.deepEqual(scene.focus.toArray(), [0, 0, 0]);
  assert.deepEqual(scene.cameraGoal.toArray(), [12, 19, 19]);
  assert.equal(scene.overview, false);
  assert.match(caption.textContent, /Gesamtes Brett/);
  scene.follow(new THREE.Vector3(-3, 1, -4));
  assert.equal(scene.focus.x, -3);
});

test('Manual overview blocks following, toggling back waits in overview until the next action', () => {
  const scene = cameraScene();
  assert.equal(scene.reset(), true);
  scene.follow(new THREE.Vector3(3, 1, 4));
  assert.deepEqual(scene.focus.toArray(), [0, 0, 0]);
  assert.equal(scene.reset(), false);
  assert.equal(scene.waiting, true);
  scene.follow(new THREE.Vector3(3, 1, 4));
  assert.equal(scene.focus.x, 3);
});

test('Portrait framing and reduced motion preserve full-board coverage', () => {
  const scene = cameraScene();
  scene.camera.aspect = .75;
  scene.idle();
  assert.deepEqual(scene.cameraGoal.toArray(), [16, 19 / .75, 19 / .75]);
  motion.matches = true;
  try {
    scene.follow(new THREE.Vector3(3, 1, 4));
    assert.deepEqual(scene.focus.toArray(), [0, 0, 0]);
    scene.caption();
    assert.match(caption.textContent, /reduziert/);
  } finally { motion.matches = false; }
});

function boardScene(count = 4) {
  return Object.assign(cameraScene(), {
    disposed: false,
    ensure: () => {},
    syncPaths: () => {},
    placeHome: () => {},
    placeGoals: () => {},
    homes: Array.from({ length: 4 }, (_, id) => ({
      name: new Game().players[id].name, plate: { visible: true }, label: { visible: true }
    })),
    sockets: Array.from({ length: 4 }, () => [{ visible: true }]),
    goalExtras: Array.from({ length: 4 }, () => []),
    pawns: Array.from({ length: 4 }, () => Array.from({ length: count }, () => {
      const pawn = new THREE.Group();
      pawn.userData = {
        ring: { visible: false }, safe: { visible: false },
        label: { visible: true }, moveNumber: new THREE.Sprite()
      };
      pawn.userData.moveNumber.visible = false;
      return pawn;
    })),
    camera: new THREE.PerspectiveCamera(42, 1920 / 1080, .1, 100),
    canvas: { style: {}, clientWidth: 1920, clientHeight: 1080 },
    tiles: []
  });
}

test('Unoccupied player homes and pawns are hidden and return for a new full game', () => {
  const scene = boardScene();
  scene.sync(snapshot(new Game({ controllers: ['human', 'empty', 'computer', 'empty'] })));
  for (const id of [1, 3]) {
    assert.equal(scene.homes[id].plate.visible, false);
    assert.equal(scene.homes[id].label.visible, false);
    assert.equal(scene.sockets[id][0].visible, false);
    assert.ok(scene.pawns[id].every(pawn => !pawn.visible));
  }
  assert.ok(scene.pawns[0].every(pawn => pawn.visible));
  scene.sync(snapshot(new Game()));
  assert.ok(scene.homes.every(home => home.plate.visible && home.label.visible));
  assert.ok(scene.pawns.flat().every(pawn => pawn.visible));
});

test('Multiplayer move numbers highlight only legal current-player pieces without enabling TV input', () => {
  const scene = boardScene();
  const state = snapshot(new Game());
  scene.sync(state, [0, 2, 2], { numberedMoves: true, interactive: false });
  for (const [piece, pawn] of scene.pawns[0].entries()) {
    assert.equal(pawn.userData.moveNumber.visible, piece === 0 || piece === 2);
    assert.equal(pawn.userData.label.visible, piece !== 0 && piece !== 2);
    assert.equal(pawn.userData.ring.visible, piece === 0 || piece === 2);
  }
  assert.ok(scene.pawns.slice(1).flat().every(pawn => !pawn.userData.moveNumber.visible));
  assert.equal(scene.available.length, 0);
  assert.equal(scene.canvas.style.cursor, 'default');
  scene.sync(state);
  assert.ok(scene.pawns.flat().every(pawn => !pawn.userData.moveNumber.visible && pawn.userData.label.visible));
});

test('Local move selection retains click targets and does not show multiplayer badges', () => {
  const scene = boardScene();
  scene.sync(snapshot(new Game()), [1, 3]);
  assert.deepEqual(scene.available, [scene.pawns[0][1], scene.pawns[0][3]]);
  assert.equal(scene.canvas.style.cursor, 'pointer');
  assert.ok(scene.pawns.flat().every(pawn => !pawn.userData.moveNumber.visible));
});

test('Move numbers handle reinforcements, hidden pieces, elimination and new games', () => {
  const scene = boardScene(6);
  const game = new Game();
  game.players[0].pieces.push(-1, -1);
  scene.sync(snapshot(game), [5], { numberedMoves: true, interactive: false });
  assert.equal(scene.pawns[0][5].userData.moveNumber.visible, true);
  game.players[0].eliminated = true;
  scene.sync(snapshot(game), [5], { numberedMoves: true, interactive: false });
  assert.ok(scene.pawns.flat().every(pawn => !pawn.userData.moveNumber.visible));
  game.players[0].eliminated = false;
  scene.sync(snapshot(game), [5], { numberedMoves: true, interactive: false });
  scene.newGame();
  assert.ok(scene.pawns.flat().every(pawn => !pawn.userData.moveNumber.visible));
  scene.sync(snapshot(new Game()), [5], { numberedMoves: true, interactive: false });
  assert.equal(scene.pawns[0][5].visible, false);
  assert.equal(scene.pawns[0][5].userData.moveNumber.visible, false);
});

test('Move numbers follow the pawn and keep a readable screen size across viewport and camera changes', () => {
  const scene = boardScene();
  scene.sync(snapshot(new Game()), [0], { numberedMoves: true, interactive: false });
  const pawn = scene.pawns[0][0];
  const badge = pawn.userData.moveNumber;
  pawn.position.set(3, .28, -2);
  pawn.scale.setScalar(.6);
  scene.updateMoveNumbers();
  assert.ok(badge.position.distanceTo(new THREE.Vector3(3, .91, -2)) < 1e-12);
  const screenPixels = () => badge.scale.y * scene.camera.projectionMatrix.elements[5] * scene.canvas.clientHeight / 2;
  assert.ok(Math.abs(screenPixels() - 48) < 1e-12);
  scene.canvas.clientWidth = 390;
  scene.canvas.clientHeight = 844;
  scene.camera.aspect = 390 / 844;
  scene.camera.fov = 55;
  scene.camera.updateProjectionMatrix();
  scene.updateMoveNumbers();
  assert.ok(Math.abs(screenPixels() - 32) < 1e-12);
});

test('Move-number badges render high-contrast numbers above the scene geometry', () => {
  const calls = [];
  const context = {
    beginPath() {}, arc() {}, fill() {}, stroke() {},
    fillText(...args) { calls.push(args); }
  };
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  const scene = Object.assign(Object.create(BoardScene.prototype), { scene: new THREE.Scene(), resources: new Set() });
  try {
    const badge = scene.moveNumber(12, '#f16463');
    assert.deepEqual(calls, [['12', 64, 66]]);
    assert.equal(context.fillStyle, '#ffffff');
    assert.equal(context.strokeStyle, '#f16463');
    assert.equal(badge.material.depthTest, false);
    assert.equal(badge.material.depthWrite, false);
    assert.equal(badge.material.sizeAttenuation, false);
    assert.equal(badge.renderOrder, 100);
    assert.deepEqual(badge.center.toArray(), [.5, 0]);
    assert.equal(badge.visible, false);
    assert.equal(badge.parent, scene.scene);
  } finally {
    globalThis.document = previous;
    scene.resources.forEach(resource => resource.dispose());
  }
});
