import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from './node_modules/three/build/three.module.js';
import { Landscape } from './landscape.js';

function world() {
  const resources = new Set();
  const scene = new THREE.Scene();
  const board = {
    scene, keep(resource) { resources.add(resource); return resource; },
    material(color) { return this.keep(new THREE.MeshStandardMaterial({ color })); },
    mesh(geometry, material, parent = scene) {
      const mesh = new THREE.Mesh(this.keep(geometry), material);
      parent.add(mesh);
      return mesh;
    },
    label() {
      return new THREE.Sprite(this.keep(new THREE.SpriteMaterial()));
    }
  };
  const sounds = [];
  return { landscape: new Landscape(board, name => sounds.push(name)), resources, scene, sounds };
}

test('Landscape simulates weather and funny scenes without animals entering the board', () => {
  const { landscape, resources, sounds } = world();
  try {
    const resourceCount = resources.size;
    const weather = new Set();
    for (let i = 0; i < 7200; i++) {
      landscape.update(.05, i * .05, false);
      weather.add(landscape.status);
      for (const animal of landscape.animals) {
        const { x, z } = animal.group.position;
        assert.ok(Math.max(Math.abs(x), Math.abs(z)) > 6.6);
      }
    }
    assert.ok(weather.size >= 2);
    assert.ok(sounds.includes('surprise'));
    assert.ok(sounds.some(sound => sound === 'wind' || sound === 'rain'));
    assert.equal(resources.size, resourceCount, 'Animation does not allocate GPU resources');
  } finally {
    landscape.dispose();
    resources.forEach(resource => resource.dispose());
  }
});

test('Hidden time and reduced motion pause the landscape, with resources owned by the board', () => {
  const { landscape, resources, scene, sounds } = world();
  try {
    landscape.update(1, 1, false);
    const time = landscape.time;
    const timer = landscape.weatherTimer;
    const angle = landscape.animals[0].angle;
    const soundCount = sounds.length;
    landscape.update(0, 900, false);
    landscape.update(10, 910, true);
    assert.equal(landscape.time, time);
    assert.equal(landscape.weatherTimer, timer);
    assert.equal(landscape.animals[0].angle, angle);
    assert.equal(sounds.length, soundCount);
    assert.equal(landscape.rain.visible, false);
    assert.ok(landscape.trees.every(tree => tree.group.rotation.z === 0));
    landscape.update(.1, 910.1, false);
    assert.equal(landscape.time, time + .1);
    const size = resources.size;
    landscape.dispose();
    landscape.dispose();
    assert.equal(scene.children.length, 0);
    assert.equal(resources.size, size);
  } finally {
    landscape.dispose();
    resources.forEach(resource => resource.dispose());
  }
});
