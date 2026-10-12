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

test('Cats, giraffes and cows have distinct four-legged models and walk around the board', () => {
  const { landscape, resources } = world();
  try {
    landscape.eventTimer = Infinity;
    for (const kind of ['cat', 'giraffe', 'cow']) {
      const animals = landscape.animals.filter(animal => animal.kind === kind);
      assert.equal(animals.length, 2);
      for (const animal of animals) {
        assert.equal(animal.legs.length, 4);
        assert.equal(animal.ears.length, 2);
        assert.ok(animal.caption);
        animal.phase = .5;
        const position = animal.group.position.clone();
        const angle = animal.angle;
        landscape.update(.5, landscape.time + .5);
        assert.notEqual(animal.angle, angle);
        assert.ok(animal.group.position.distanceTo(position) > 0);
        assert.ok(animal.legs.some(leg => Math.abs(leg.rotation.x) > .01));
        animal.body.updateWorldMatrix(true, true);
        const bounds = new THREE.Box3().setFromObject(animal.body);
        if (kind === 'giraffe') assert.ok(bounds.max.y - bounds.min.y > 3);
        if (kind === 'cow') assert.ok(bounds.max.z - bounds.min.z > 1);
      }
    }
    const bounds = new THREE.Box3();
    for (let step = 0; step < 64; step++) {
      for (const animal of landscape.animals.filter(animal => ['cat', 'giraffe', 'cow'].includes(animal.kind))) {
        animal.angle = step / 64 * Math.PI * 2;
        landscape.placeAnimals(.05);
        animal.body.updateWorldMatrix(true, true);
        bounds.setFromObject(animal.body);
        assert.ok(bounds.min.x > 6.1 || bounds.max.x < -6.1 || bounds.min.z > 6.1 || bounds.max.z < -6.1,
          `${animal.kind} stays clear of the entire board at angle ${animal.angle}`);
      }
    }
  } finally {
    landscape.dispose();
    resources.forEach(resource => resource.dispose());
  }
});

test('Every animal can perform and finish a background scene without requiring an accessory', () => {
  const { landscape, resources } = world();
  try {
    landscape.eventTimer = Infinity;
    const resourceCount = resources.size;
    for (const animal of landscape.animals) {
      landscape.activeEvent = { animal, age: 0, duration: 6 };
      animal.caption.visible = true;
      if (animal.accessory) animal.accessory.visible = true;
      for (let frame = 0; frame < 61; frame++) landscape.update(.1, landscape.time + .1);
      assert.equal(landscape.activeEvent, null);
      assert.equal(animal.caption.visible, false);
      if (animal.accessory) assert.equal(animal.accessory.visible, false);
      assert.equal(animal.body.rotation.y, 0);
    }
    assert.equal(resources.size, resourceCount);
    for (const animal of landscape.animals.filter(animal => ['cat', 'giraffe', 'cow'].includes(animal.kind))) {
      landscape.activeEvent = { animal, age: 1, duration: 6 };
      animal.caption.visible = true;
      landscape.update(.1, landscape.time + .1);
      const position = animal.group.position.clone();
      landscape.update(10, landscape.time + 10, true);
      assert.equal(landscape.activeEvent, null);
      assert.equal(animal.caption.visible, false);
      assert.ok(animal.group.position.equals(position));
      assert.ok(animal.legs.every(leg => leg.rotation.x === 0));
    }
  } finally {
    landscape.dispose();
    resources.forEach(resource => resource.dispose());
  }
});

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
