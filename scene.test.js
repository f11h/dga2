import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './node_modules/three/build/three.module.js';

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
