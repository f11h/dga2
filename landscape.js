import * as THREE from './node_modules/three/build/three.module.js';

const TAU = Math.PI * 2;
const random = (min, max) => min + Math.random() * (max - min);
const WEATHER = ['Sonnig · kleine Landpartie', 'Regen · frische Wiesen', 'Windig · die Bäume tanzen'];

export class Landscape {
  constructor(board, onSound = () => {}) {
    this.board = board;
    this.onSound = onSound;
    this.root = new THREE.Group();
    this.root.name = 'Landscape';
    board.scene.add(this.root);
    this.disposed = false;
    this.time = 0;
    this.weather = 0;
    this.weatherTimer = random(25, 45);
    this.eventTimer = random(15, 30);
    this.voiceTimer = random(12, 22);
    this.activeEvent = null;
    this.reduced = false;
    this.trees = [];
    this.animals = [];
    this.clouds = [];
    this.birds = [];

    this.geometry = {
      ball: board.keep(new THREE.IcosahedronGeometry(1, 0)),
      soft: board.keep(new THREE.IcosahedronGeometry(1, 1)),
      box: board.keep(new THREE.BoxGeometry(1, 1, 1)),
      trunk: board.keep(new THREE.CylinderGeometry(.7, 1, 1, 6)),
      cone: board.keep(new THREE.ConeGeometry(1, 1, 7)),
      disk: board.keep(new THREE.CylinderGeometry(1, 1, 1, 16))
    };
    const colors = {
      grass: '#79b965', meadow: '#98c875', hill: '#659c55',
      leaf: '#47895b', lightLeaf: '#72aa59', pine: '#366e53',
      wood: '#906448', stone: '#a8adb0', water: '#68c5d6',
      white: '#fff5dd', wool: '#e8e4d6', dark: '#343841',
      pink: '#e5a5a5', rabbit: '#c6a78d', orange: '#f29c3f',
      yellow: '#ffd873', purple: '#b890cf', cloud: '#f5f4ef',
      hat: '#77537e', ribbon: '#efb963'
    };
    this.materials = {};
    for (const [name, color] of Object.entries(colors)) {
      const material = board.material(color);
      material.roughness = 1;
      material.metalness = 0;
      this.materials[name] = material;
    }
    this.buildGround();
    this.buildTrees();
    this.buildAnimals();
    this.buildSky();
    this.buildRain();
    this.placeAnimals(0);
  }

  get status() {
    return WEATHER[this.weather];
  }

  group(parent = this.root, x = 0, y = 0, z = 0) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    parent.add(group);
    return group;
  }

  part(shape, color, parent, x, y, z, sx, sy, sz, shadow = false) {
    const mesh = this.board.mesh(this.geometry[shape], this.materials[color], parent);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = shadow;
    mesh.receiveShadow = shadow;
    return mesh;
  }

  buildGround() {
    const ground = this.part('disk', 'grass', this.root, 0, -.66, 0, 18, .32, 18);
    ground.receiveShadow = true;
    for (let i = 0; i < 13; i++) {
      const angle = i / 13 * TAU;
      const radius = random(15.3, 16.7);
      this.part('soft', i % 2 ? 'hill' : 'meadow', this.root,
        Math.cos(angle) * radius, -.55, Math.sin(angle) * radius,
        random(2, 3.2), random(.8, 2), random(1.7, 2.7));
    }
    const pond = this.group(this.root, 10.8, -.43, -3.7);
    this.part('disk', 'stone', pond, 0, -.05, 0, 2.05, .1, 1.4);
    this.part('disk', 'water', pond, 0, .01, 0, 1.85, .08, 1.22);
    for (let i = 0; i < 4; i++) {
      this.part('disk', 'leaf', pond, -.8 + i * .5, .065, .3 + Math.sin(i) * .4,
        .18, .025, .14);
    }
    for (let i = 0; i < 48; i++) {
      const angle = random(0, TAU);
      const radius = random(11.8, 16);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (Math.abs(x - 10.8) < 2.4 && Math.abs(z + 3.7) < 1.8) continue;
      if (i % 4 === 0) {
        const stone = this.part('ball', 'stone', this.root, x, -.29, z,
          random(.2, .45), random(.15, .32), random(.2, .4));
        stone.rotation.y = angle;
      } else {
        const flower = this.group(this.root, x, -.5, z);
        this.part('trunk', 'leaf', flower, 0, .19, 0, .025, .38, .025);
        this.part('ball', i % 3 === 0 ? 'purple' : 'pink', flower,
          0, .42, 0, .17, .1, .17);
        this.part('ball', 'yellow', flower, 0, .47, 0, .065, .045, .065);
      }
    }
    for (let i = 0; i < 14; i++) {
      const angle = i / 14 * TAU + .12;
      const radius = random(8.3, 9.1);
      // Tufts stay outside the square even at its corners.
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (Math.max(Math.abs(x), Math.abs(z)) < 6.6) continue;
      const tuft = this.group(this.root, x, -.5, z);
      for (let j = 0; j < 3; j++) {
        const blade = this.part('cone', 'meadow', tuft, (j - 1) * .1, .18, 0,
          .055, .36 + j * .035, .055);
        blade.rotation.z = (j - 1) * .25;
      }
    }
  }

  buildTrees() {
    for (let i = 0; i < 19; i++) {
      const angle = i / 19 * TAU + random(-.08, .08);
      const radius = random(13.2, 15.6);
      const tree = this.group(this.root, Math.cos(angle) * radius, -.5,
        Math.sin(angle) * radius);
      const size = random(.8, 1.2);
      tree.scale.setScalar(size);
      this.part('trunk', 'wood', tree, 0, 1, 0, .18, 2, .18, true);
      if (i % 3 === 0) {
        for (let layer = 0; layer < 3; layer++) {
          this.part('cone', 'pine', tree, 0, 1.5 + layer * .6, 0,
            1.04 - layer * .23, 1.45, 1.04 - layer * .23, true);
        }
      } else {
        this.part('soft', i % 2 ? 'leaf' : 'lightLeaf', tree,
          0, 2.45, 0, 1.05, 1.2, .95, true);
        this.part('ball', 'lightLeaf', tree, -.6, 2, .12, .65, .7, .7);
      }
      this.trees.push({ group: tree, phase: random(0, TAU) });
    }
  }

  face(head, front, eyeY, eyeX, color = 'dark') {
    for (const side of [-1, 1]) {
      this.part('ball', color, head, side * eyeX, eyeY, front, .045, .055, .035);
      if (color === 'white') {
        this.part('ball', 'dark', head, side * eyeX, eyeY, front + .027,
          .025, .033, .015);
      }
      this.part('ball', 'white', head, side * eyeX - .012, eyeY + .018,
        front + .041, .014, .016, .012);
    }
  }

  animal(kind, angle, speed, radius = 10.5) {
    const group = this.group();
    const body = this.group(group);
    const animal = {
      kind, group, body, angle, speed, radius, legs: [], ears: [],
      phase: random(0, TAU), accessory: null, caption: null
    };
    this.animals.push(animal);
    return animal;
  }

  leg(animal, color, x, z, length, width) {
    const pivot = this.group(animal.body, x, length, z);
    this.part('trunk', color, pivot, 0, -length / 2, 0,
      width, length, width);
    animal.legs.push(pivot);
  }

  caption(animal, text) {
    const label = this.board.label(text, '#fffce7', 3);
    label.position.set(0, 2.5, 0);
    label.visible = false;
    animal.group.add(label);
    animal.caption = label;
  }

  buildAnimals() {
    for (let i = 0; i < 3; i++) {
      const sheep = this.animal('sheep', .5 + i * 2, .035 + i * .008);
      for (const x of [-.29, .29]) {
        for (const z of [-.36, .36]) this.leg(sheep, 'dark', x, z, .38, .07);
      }
      this.part('soft', 'wool', sheep.body, 0, .66, 0, .5, .43, .67, true);
      for (let tuft = 0; tuft < 5; tuft++) {
        this.part('ball', 'white', sheep.body, Math.sin(tuft * 2) * .32,
          .8 + (tuft % 2) * .12, Math.cos(tuft * 2) * .35, .27, .24, .28);
      }
      const head = this.group(sheep.body, 0, .8, .58);
      this.part('soft', 'dark', head, 0, 0, 0, .26, .28, .31, true);
      this.part('ball', 'wool', head, 0, .21, -.04, .27, .16, .22);
      this.face(head, .27, .04, .13, 'white');
      for (const side of [-1, 1]) {
        this.part('ball', 'dark', head, side * .32, .06, 0, .19, .08, .1);
      }
      this.part('ball', 'pink', head, 0, -.09, .31, .08, .045, .035);
      this.part('ball', 'wool', sheep.body, 0, .73, -.67, .14, .16, .15);
      this.caption(sheep, 'Mähgisch!');
    }
    for (let i = 0; i < 2; i++) {
      const rabbit = this.animal('rabbit', 1.7 + i * 3, -.065 - i * .009, 10.65);
      for (const side of [-1, 1]) {
        this.leg(rabbit, 'rabbit', side * .2, .23, .22, .065);
        this.leg(rabbit, 'rabbit', side * .25, -.23, .25, .11);
      }
      this.part('soft', 'rabbit', rabbit.body, 0, .45, -.05, .35, .4, .46, true);
      this.part('ball', 'white', rabbit.body, 0, .43, -.5, .15, .15, .15);
      const head = this.group(rabbit.body, 0, .68, .32);
      this.part('soft', 'rabbit', head, 0, 0, 0, .26, .27, .26, true);
      this.face(head, .225, .05, .12);
      for (const side of [-1, 1]) {
        const ear = this.group(head, side * .14, .19, -.035);
        this.part('soft', 'rabbit', ear, 0, .28, 0, .095, .36, .095);
        this.part('ball', 'pink', ear, 0, .29, .07, .045, .24, .025);
        ear.rotation.z = side * -.15;
        rabbit.ears.push(ear);
        this.part('ball', 'white', head, side * .07, -.07, .22, .085, .07, .05);
      }
      this.part('ball', 'pink', head, 0, -.02, .29, .045, .035, .035);
      const carrot = this.group(rabbit.body, 0, .6, .86);
      const vegetable = this.part('cone', 'orange', carrot, 0, 0, 0, .12, .48, .12);
      vegetable.rotation.z = Math.PI;
      for (let leaf = 0; leaf < 3; leaf++) {
        const sprig = this.part('cone', 'leaf', carrot,
          (leaf - 1) * .06, .31, 0, .055, .23, .055);
        sprig.rotation.z = (leaf - 1) * .45;
      }
      carrot.visible = false;
      rabbit.accessory = carrot;
      this.caption(rabbit, 'Möhrchen!');
    }
    const duck = this.animal('duck', -.3, .045, 10.45);
    for (const side of [-1, 1]) {
      this.leg(duck, 'orange', side * .17, 0, .2, .045);
      this.part('ball', 'orange', duck.legs[duck.legs.length - 1],
        0, -.18, .08, .11, .04, .16);
    }
    this.part('soft', 'white', duck.body, 0, .44, -.05, .38, .32, .55, true);
    for (const side of [-1, 1]) {
      this.part('ball', 'wool', duck.body, side * .32, .48, -.1, .13, .2, .34);
    }
    const head = this.group(duck.body, 0, .87, .3);
    this.part('soft', 'leaf', head, 0, 0, 0, .25, .27, .25, true);
    this.face(head, .21, .05, .13);
    this.part('box', 'orange', head, 0, -.06, .32, .24, .09, .25);
    const tail = this.part('cone', 'white', duck.body, 0, .48, -.58, .17, .4, .17);
    tail.rotation.x = -Math.PI / 2;
    const hat = this.group(head, 0, .3, 0);
    this.part('disk', 'hat', hat, 0, 0, 0, .37, .06, .37);
    this.part('trunk', 'hat', hat, 0, .18, 0, .23, .34, .23);
    this.part('disk', 'ribbon', hat, 0, .055, 0, .245, .08, .245);
    hat.visible = false;
    duck.accessory = hat;
    this.caption(duck, 'Hut ab!');
  }

  buildSky() {
    this.sun = this.group(this.root, -13, 7, -10);
    this.part('ball', 'yellow', this.sun, 0, 0, 0, .85, .85, .85);
    for (let i = 0; i < 8; i++) {
      const angle = i / 8 * TAU;
      const ray = this.part('cone', 'yellow', this.sun,
        Math.sin(angle) * 1.22, Math.cos(angle) * 1.22, 0, .13, .43, .13);
      ray.rotation.z = -angle;
    }
    for (let i = 0; i < 6; i++) {
      const angle = i / 6 * TAU;
      const cloud = this.group(this.root, Math.cos(angle) * 14,
        5.2 + i % 3 * .6, Math.sin(angle) * 14);
      for (let puff = 0; puff < 3; puff++) {
        this.part('soft', 'cloud', cloud, (puff - 1) * .7, puff % 2 * .2, 0,
          .9, .5 + puff % 2 * .2, .6);
      }
      this.clouds.push({ group: cloud, angle, height: cloud.position.y });
    }
    for (let i = 0; i < 2; i++) {
      const bird = this.group();
      this.part('ball', 'dark', bird, 0, 0, 0, .08, .08, .2);
      const wings = [];
      for (const side of [-1, 1]) {
        const wing = this.group(bird, side * .055, 0, 0);
        this.part('ball', 'dark', wing, side * .17, 0, 0, .22, .035, .1);
        wings.push(wing);
      }
      const phase = i * 1.8;
      bird.position.set(Math.cos(phase) * 14, 5.5 + Math.sin(phase * 2) * .25,
        Math.sin(phase) * 14);
      bird.rotation.y = -phase;
      this.birds.push({ group: bird, wings, phase });
    }
  }

  buildRain() {
    const count = 220;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = random(0, TAU);
      const radius = random(10.6, 16.5);
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = random(-.4, 6);
      positions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    const geometry = this.board.keep(new THREE.BufferGeometry());
    this.rainPositions = new THREE.BufferAttribute(positions, 3);
    this.rainPositions.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.rainPositions);
    geometry.computeBoundingSphere();
    const material = this.board.keep(new THREE.PointsMaterial({
      color: '#c4e9ff', size: .075, transparent: true, opacity: .65,
      depthWrite: false
    }));
    this.rain = new THREE.Points(geometry, material);
    this.rain.visible = false;
    this.rain.frustumCulled = false;
    this.root.add(this.rain);
  }

  sound(kind) {
    if (typeof this.onSound === 'function') this.onSound(kind);
  }

  finishEvent() {
    if (!this.activeEvent) return;
    const animal = this.activeEvent.animal;
    animal.caption.visible = false;
    if (animal.accessory) {
      animal.accessory.visible = false;
      animal.accessory.rotation.set(0, 0, 0);
      if (animal.kind === 'duck') animal.accessory.position.y = .3;
    }
    animal.body.position.y = 0;
    animal.body.rotation.set(0, 0, 0);
    this.activeEvent = null;
  }

  startEvent() {
    const animal = this.animals[Math.floor(Math.random() * this.animals.length)];
    this.activeEvent = { animal, age: 0, duration: 6 };
    animal.caption.visible = true;
    if (animal.accessory) animal.accessory.visible = true;
    this.sound('surprise');
  }

  placeAnimals(dt) {
    for (const animal of this.animals) {
      const performing = this.activeEvent && this.activeEvent.animal === animal;
      if (!performing) animal.angle += animal.speed * dt;
      const angle = animal.angle;
      // Radius / sqrt(2) exceeds the board edge plus the entire animal footprint.
      animal.group.position.set(Math.cos(angle) * animal.radius, -.48,
        Math.sin(angle) * animal.radius);
      animal.group.rotation.y = -angle + (animal.speed > 0 ? 0 : Math.PI);
      const stride = this.time * (animal.kind === 'rabbit' ? 7 : 5) + animal.phase;
      const walking = dt > 0 && !performing;
      animal.body.position.y = walking
        ? Math.abs(Math.sin(stride)) * (animal.kind === 'rabbit' ? .16 : .035) : 0;
      animal.body.rotation.z = walking && animal.kind === 'duck' ? Math.sin(stride) * .08 : 0;
      for (let i = 0; i < animal.legs.length; i++) {
        animal.legs[i].rotation.x = walking ? Math.sin(stride + (i % 2) * Math.PI) * .28 : 0;
      }
      for (let i = 0; i < animal.ears.length; i++) {
        animal.ears[i].rotation.x = walking ? Math.sin(stride) * .1 : 0;
      }
    }
  }

  update(dt, elapsed, reducedMotion = false) {
    if (this.disposed) return;
    if (reducedMotion) {
      this.rain.visible = false;
      if (!this.reduced) {
        this.finishEvent();
        this.placeAnimals(0);
        for (const tree of this.trees) tree.group.rotation.set(0, 0, 0);
        for (const bird of this.birds) {
          for (const wing of bird.wings) wing.rotation.z = 0;
        }
      }
      this.reduced = true;
      return;
    }
    this.reduced = false;
    // Elapsed is deliberately ignored: hidden-tab time must never advance this world.
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    this.time += dt;
    this.weatherTimer -= dt;
    this.eventTimer -= dt;
    this.voiceTimer -= dt;
    if (this.weatherTimer <= 0) {
      this.weather = (this.weather + 1 + Math.floor(Math.random() * 2)) % 3;
      this.weatherTimer = random(25, 45);
      this.sun.visible = this.weather !== 1;
      this.materials.cloud.color.set(this.weather === 1 ? '#a6b5c1' : '#f5f4ef');
      this.sound(this.weather === 1 ? 'rain' : this.weather === 2 ? 'wind' : 'bird');
      this.voiceTimer = random(12, 22);
    }
    this.rain.visible = this.weather === 1;
    if (this.eventTimer <= 0 && !this.activeEvent) {
      this.startEvent();
      this.eventTimer = random(15, 30);
      this.voiceTimer = random(12, 22);
    } else if (this.voiceTimer <= 0) {
      this.sound(Math.random() < .5 ? 'bird' : 'animal');
      this.voiceTimer = random(14, 24);
    }
    const wind = this.weather === 2 ? .09 : this.weather === 1 ? .035 : .018;
    for (const tree of this.trees) {
      tree.group.rotation.z = Math.sin(this.time * 1.3 + tree.phase) * wind;
      tree.group.rotation.x = Math.cos(this.time * .9 + tree.phase) * wind * .5;
    }
    for (const cloud of this.clouds) {
      cloud.angle += dt * (this.weather === 2 ? .017 : .005);
      cloud.group.position.x = Math.cos(cloud.angle) * 14;
      cloud.group.position.z = Math.sin(cloud.angle) * 14;
    }
    for (const bird of this.birds) {
      const angle = this.time * .09 + bird.phase;
      bird.group.position.set(Math.cos(angle) * 14, 5.5 + Math.sin(angle * 2) * .25,
        Math.sin(angle) * 14);
      bird.group.rotation.y = -angle;
      for (let i = 0; i < bird.wings.length; i++) {
        bird.wings[i].rotation.z = Math.sin(this.time * 8 + bird.phase) * .5 * (i ? 1 : -1);
      }
    }
    this.placeAnimals(dt);
    if (this.activeEvent) {
      const event = this.activeEvent;
      event.age += dt;
      const animal = event.animal;
      const envelope = Math.sin(Math.min(1, event.age / event.duration) * Math.PI);
      if (animal.kind === 'sheep') {
        animal.body.position.y = Math.abs(Math.sin(event.age * 3)) * .85 * envelope;
        animal.body.rotation.x = Math.sin(event.age * 3) * .15 * envelope;
      } else if (animal.kind === 'rabbit') {
        animal.accessory.rotation.z = event.age * 3;
        animal.accessory.rotation.y = event.age * 1.5;
        animal.body.rotation.z = Math.sin(event.age * 3) * .08 * envelope;
      } else {
        animal.accessory.rotation.z = Math.sin(event.age * 4) * .25 * envelope;
        animal.accessory.position.y = .3 + Math.abs(Math.sin(event.age * 2)) * .22 * envelope;
        animal.body.rotation.y = Math.sin(event.age * 2) * .3 * envelope;
      }
      if (event.age >= event.duration) this.finishEvent();
    }
    if (this.rain.visible) {
      const positions = this.rainPositions.array;
      for (let i = 1; i < positions.length; i += 3) {
        positions[i] = -.4 + ((positions[i] + .4 - dt * 5) % 6.4 + 6.4) % 6.4;
      }
      this.rainPositions.needsUpdate = true;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
  }
}
