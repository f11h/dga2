import * as THREE from './node_modules/three/build/three.module.js';
import { COLORS, EVENT_FIELDS, STARTS } from './game.js';
import { TRACK, GOALS, TRAIN_Z, TRAIN_X, TRAIN_PORTAL, location, homeLayout, extraGoalCell, moveRoute, changes } from './animation.js';
import { Landscape } from './landscape.js';

const motion = matchMedia('(prefers-reduced-motion: reduce)');
const vec = (position, height = .28) => new THREE.Vector3(position[0], height, position[1]);
const ease = t => t * t * (3 - 2 * t);
const pop = t => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const countOf = (state, player) => state.players[player].pieces.length;
const pawnScale = (player, progress, count) => progress < 0 ? homeLayout(player, count).scale : 1;
const TINY = new THREE.Vector3(1e-4, 1e-4, 1e-4);
const RAIL_TOP = .27;
const WHEEL = .17;
const TRAIN_SCALE = .7;
const GAUGE = .33 * TRAIN_SCALE;

export class BoardScene {
  constructor(canvas, onSelect, onSound = () => {}) {
    this.canvas = canvas;
    this.sound = onSound;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor('#151f30');
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // The train is clipped inside the portal over the Mint goal lane.
    this.renderer.localClippingEnabled = true;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, .1, 100);
    this.camera.position.set(12, 19, 19);
    this.look = new THREE.Vector3();
    this.focus = new THREE.Vector3();
    this.cameraGoal = new THREE.Vector3(12, 19, 19);
    this.scene.add(new THREE.HemisphereLight('#d9eaff', '#394356', 2.4));
    const sun = new THREE.DirectionalLight('#fff2d7', 3);
    sun.position.set(-5, 12, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 });
    sun.shadow.bias = -.001;
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight('#8eaaff', 1.6);
    rim.position.set(6, 4, -6);
    this.scene.add(rim);
    this.resources = new Set();
    this.pawns = [[], [], [], []];
    this.sockets = [[], [], [], []];
    this.goalExtras = [[], [], [], []];
    this.homes = [];
    this.tiles = [];
    this.available = [];
    this.elapsed = 0;
    this.overview = false;
    this.active = null;
    this.disposed = false;
    this.build();
    this.landscape = new Landscape(this, onSound);
    this.pathGroup = new THREE.Group();
    this.scene.add(this.pathGroup);
    this.pathResources = [];
    this.pathKey = '';
    this.waiting = true;
    this.raycaster = new THREE.Raycaster();
    this.click = event => {
      const rect = canvas.getBoundingClientRect();
      this.raycaster.setFromCamera(new THREE.Vector2(
        (event.clientX - rect.left) / rect.width * 2 - 1,
        -(event.clientY - rect.top) / rect.height * 2 + 1), this.camera);
      const hit = this.raycaster.intersectObjects(this.available, true)[0];
      if (hit) {
        let node = hit.object;
        while (node && node.userData.piece === undefined) node = node.parent;
        if (node) onSelect(node.userData.piece);
      }
    };
    canvas.addEventListener('pointerup', this.click);
    this.contextLost = event => {
      event.preventDefault();
      document.getElementById('webgl-error').hidden = false;
      document.getElementById('webgl-error').textContent = 'Die 3D-Grafikverbindung wurde unterbrochen. Bitte die Seite neu laden.';
      this.dispose();
    };
    canvas.addEventListener('webglcontextlost', this.contextLost);
    this.resize = new ResizeObserver(() => this.fitCanvas());
    this.resize.observe(canvas);
    this.frame = this.frame.bind(this);
    this.raf = requestAnimationFrame(this.frame);
  }

  keep(resource) { this.resources.add(resource); return resource; }
  fitCanvas() {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    const dpi = Math.min(devicePixelRatio, 1.7);
    if (!width || !height || (this.width === width && this.height === height && this.dpi === dpi)) return;
    this.width = width; this.height = height; this.dpi = dpi;
    this.renderer.setPixelRatio(dpi);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.waiting || this.overview) this.idle();
  }
  material(color, glow = false) {
    return this.keep(new THREE.MeshStandardMaterial({
      color, roughness: .36, metalness: .22,
      ...(glow ? { emissive: color, emissiveIntensity: .7 } : {})
    }));
  }
  mesh(geometry, material, parent = this.scene) {
    const mesh = new THREE.Mesh(this.keep(geometry), material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  label(text, color, width = 1.6) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.font = 'bold 32px system-ui';
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    ctx.fillText(text, 128, 43);
    const texture = this.keep(new THREE.CanvasTexture(canvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(this.keep(new THREE.SpriteMaterial({ map: texture, depthWrite: false })));
    sprite.scale.set(width, width / 4, 1);
    return sprite;
  }
  build() {
    this.slabMaterial = this.material('#24344b');
    const slab = this.mesh(new THREE.BoxGeometry(12, .45, 12), this.slabMaterial);
    slab.position.y = -.17;
    const trim = this.mesh(new THREE.BoxGeometry(12.18, .16, 12.18), this.material('#53677c'));
    trim.position.y = -.39;
    this.geo = {
      tile: this.keep(new THREE.CylinderGeometry(.38, .41, .16, 24)),
      plate: this.keep(new THREE.BoxGeometry(2.7, .15, 2.7)),
      pier: this.keep(new THREE.BoxGeometry(1, .45, 1)),
      pawnBase: this.keep(new THREE.CylinderGeometry(.24, .32, .15, 20)),
      pawnBody: this.keep(new THREE.CylinderGeometry(.12, .23, .44, 20)),
      pawnHead: this.keep(new THREE.SphereGeometry(.22, 20, 12)),
      pawnRing: this.keep(new THREE.TorusGeometry(.38, .045, 8, 28))
    };
    const tileGeometry = this.geo.tile;
    this.neutral = this.material('#43556e');
    this.eventMaterial = this.material('#aacd64', true);
    const eventMaterial = this.eventMaterial;
    this.colors = COLORS.map(color => this.material(color));
    const colors = this.colors;
    TRACK.forEach((cell, index) => {
      const start = STARTS.indexOf(index);
      const event = EVENT_FIELDS.includes(index);
      const tile = this.mesh(tileGeometry, start >= 0 ? colors[start] : this.neutral);
      tile.position.copy(vec(cell.map(v => v - 5), .12));
      if (event) {
        const star = this.mesh(new THREE.OctahedronGeometry(.16), eventMaterial);
        star.position.copy(tile.position).y = .43;
        const ring = this.mesh(new THREE.TorusGeometry(.31, .025, 6, 24), eventMaterial);
        ring.rotation.x = Math.PI / 2;
        ring.position.copy(tile.position).y = .23;
        this.tiles.push({ star, ring });
      }
    });
    GOALS.forEach((lane, player) => lane.forEach((cell, index) => {
      const tile = this.mesh(tileGeometry, colors[player]);
      tile.position.copy(vec(cell.map(v => v - 5), .12));
      const label = this.label(String(index + 1), '#ffffff', .55);
      label.position.copy(tile.position).y = .33;
      this.scene.add(label);
    }));
    const center = this.mesh(new THREE.CylinderGeometry(.62, .72, .32, 6), eventMaterial);
    center.position.y = .18;
    const logo = this.label('b!', '#e8ffc0', 1.5);
    logo.position.y = .8; this.scene.add(logo);
    for (let player = 0; player < 4; player++) {
      const plate = this.mesh(this.geo.plate, colors[player]);
      this.homes.push({ plate, position: new THREE.Vector3(), label: null, name: null });
      this.ensurePlayer(player, 4);
      this.placeHome(player, 4);
      this.placeGoals(player, 4);
      this.pawns[player].forEach((pawn, piece) => {
        pawn.position.copy(vec(location(player, piece, -1, 4)));
        pawn.visible = true;
      });
    }
    this.buildRailway();
  }
  buildRailway() {
    const gravel = this.material('#8a8173');
    gravel.roughness = 1; gravel.metalness = 0;
    const steel = this.material('#c9d1db');
    steel.metalness = .8; steel.roughness = .3;
    const wood = this.material('#6e5038');
    wood.roughness = .9; wood.metalness = 0;
    const [west, east] = TRAIN_X;
    // Embankments carry the rails from the landscape (-.5) up to board height; the board itself gets a thin ballast bed.
    const damLength = Math.abs(west) - 6.09;
    const dam = this.keep(new THREE.BoxGeometry(damLength, .8, 1));
    const bed = this.keep(new THREE.BoxGeometry(4.5, .12, .9));
    for (const sign of [-1, 1]) {
      const embankment = this.mesh(dam, gravel);
      embankment.position.set(sign * (6.09 + damLength / 2), -.23, TRAIN_Z);
      const ballast = this.mesh(bed, gravel);
      ballast.position.set(sign * 3.75, .11, TRAIN_Z);
    }
    // Rails stop at the portal so the protected Mint goal slot between them stays free.
    const rail = this.keep(new THREE.BoxGeometry(east - TRAIN_PORTAL, .05, .06));
    for (const sign of [-1, 1]) for (const offset of [-GAUGE, GAUGE]) {
      const mesh = this.mesh(rail, steel);
      mesh.position.set(sign * (east + TRAIN_PORTAL) / 2, RAIL_TOP - .025, TRAIN_Z + offset);
    }
    this.buildPortal();
    const positions = [];
    for (let x = west + .3; x < east; x += .6) if (Math.abs(x) > 1.5) positions.push(x);
    const sleepers = new THREE.InstancedMesh(this.keep(new THREE.BoxGeometry(.16, .05, .95)), wood, positions.length);
    const matrix = new THREE.Matrix4();
    positions.forEach((x, i) => sleepers.setMatrixAt(i, matrix.makeTranslation(x, RAIL_TOP - .075, TRAIN_Z)));
    sleepers.receiveShadow = true;
    this.keep(sleepers);
    this.scene.add(sleepers);
  }
  /** Two portal gates swallow the train before the Mint goal lane; a dome shields the goal slot under the line. */
  buildPortal() {
    const material = this.keep(new THREE.MeshBasicMaterial({ color: '#9ff3ff', transparent: true, opacity: .35, depthWrite: false }));
    const shieldMaterial = this.keep(new THREE.MeshBasicMaterial({ color: '#9ff3ff', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    const gateGeometry = this.keep(new THREE.TorusGeometry(.5, .05, 8, 32, Math.PI));
    const discGeometry = this.keep(new THREE.CircleGeometry(.5, 32, 0, Math.PI));
    const gates = [-1, 1].map(sign => {
      const gate = new THREE.Group();
      gate.position.set(sign * TRAIN_PORTAL, RAIL_TOP - .03, TRAIN_Z);
      gate.rotation.y = Math.PI / 2;
      gate.add(new THREE.Mesh(gateGeometry, material));
      const disc = new THREE.Mesh(discGeometry, shieldMaterial);
      gate.add(disc);
      this.scene.add(gate);
      return gate;
    });
    const shield = new THREE.Mesh(this.keep(new THREE.SphereGeometry(.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)), shieldMaterial);
    shield.position.set(0, .2, TRAIN_Z);
    this.scene.add(shield);
    this.portal = { gates, shield, material, shieldMaterial };
  }
  portalGlow(level) {
    if (!this.portal) return;
    this.portal.material.opacity = .35 + .6 * level;
    this.portal.shieldMaterial.opacity = .3 * level;
    this.portal.gates.forEach(gate => gate.scale.setScalar(1 + .12 * level));
  }
  makePawn(player, piece) {
    const color = this.colors[player];
    const pawn = new THREE.Group();
    pawn.userData = { player, piece };
    const base = this.mesh(this.geo.pawnBase, color, pawn);
    base.position.y = .075;
    const body = this.mesh(this.geo.pawnBody, color, pawn);
    body.position.y = .34;
    const head = this.mesh(this.geo.pawnHead, color, pawn);
    head.position.y = .68;
    const label = this.label(String(piece + 1), '#ffffff', .55);
    label.position.set(0, 1.02, 0); pawn.add(label);
    const safe = this.label('✓', '#ffffff', .55);
    safe.position.set(.28, 1.17, 0); safe.visible = false;
    pawn.add(safe); pawn.userData.safe = safe;
    const ring = this.mesh(this.geo.pawnRing, this.eventMaterial, pawn);
    ring.rotation.x = Math.PI / 2; ring.position.y = .03; ring.visible = false;
    pawn.userData.ring = ring;
    pawn.visible = false;
    this.scene.add(pawn);
    return pawn;
  }
  makeGoalExtra(player, slot) {
    const group = new THREE.Group();
    group.position.copy(vec(extraGoalCell(player, slot), 0));
    const pier = this.mesh(this.geo.pier, this.slabMaterial, group);
    pier.position.y = -.17;
    const tile = this.mesh(this.geo.tile, this.colors[player], group);
    tile.position.y = .12;
    const label = this.label(`+${slot + 1}`, '#ffffff', .55);
    label.position.y = .33;
    group.add(label);
    group.visible = false;
    this.scene.add(group);
    return group;
  }
  /** Builds missing pawns, home sockets and extra goal slots; never shrinks so objects are reused. */
  ensurePlayer(player, count) {
    while (this.sockets[player].length < count) {
      const socket = this.mesh(this.geo.tile, this.neutral);
      socket.visible = false;
      this.sockets[player].push(socket);
    }
    while (this.pawns[player].length < count) this.pawns[player].push(this.makePawn(player, this.pawns[player].length));
    while (this.goalExtras[player].length < count - 4) this.goalExtras[player].push(this.makeGoalExtra(player, this.goalExtras[player].length));
  }
  ensure(state) {
    if (!state || this.disposed) return;
    state.players.forEach(player => this.ensurePlayer(player.id, player.pieces.length));
  }
  placeHome(player, count) {
    const layout = homeLayout(player, count);
    const home = this.homes[player];
    home.plate.position.set(layout.x, .09, layout.z);
    home.plate.scale.set(layout.width / 2.7, 1, layout.depth / 2.7);
    this.sockets[player].forEach((socket, piece) => {
      socket.visible = piece < count;
      if (!socket.visible) return;
      socket.position.copy(vec(location(player, piece, -1, count), .21));
      socket.scale.setScalar(layout.scale);
    });
    // Southern homes put their name on the far side, away from the railway.
    home.position.set(layout.x, .42, layout.z + Math.sign(layout.z) * (layout.depth / 2 - .3));
    if (home.label) home.label.position.copy(home.position);
  }
  placeGoals(player, count) {
    this.goalExtras[player].forEach((group, slot) => {
      group.visible = slot < count - 4;
      group.scale.setScalar(1);
    });
  }
  pawn(player, piece) { return this.pawns[player]?.[piece]; }
  syncPaths(paths = []) {
    const key = JSON.stringify(paths);
    if (key === this.pathKey) return;
    this.pathKey = key;
    this.pathGroup.clear();
    this.pathResources.forEach(resource => { resource.dispose(); this.resources.delete(resource); });
    const existing = new Set(this.resources);
    for (const link of paths) {
      const from = vec(TRACK[link.from].map(value => value - 5), .27);
      const to = vec(TRACK[(link.from + link.delta + 40) % 40].map(value => value - 5), .27);
      const mid = from.clone().lerp(to, .5);
      mid.y = .65;
      const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
      const color = link.kind === 'shortcut' ? '#86efac' : '#ffae58';
      const material = this.material(color, true);
      this.mesh(new THREE.TubeGeometry(curve, 20, .045, 6, false), material, this.pathGroup);
      const arrow = this.mesh(new THREE.ConeGeometry(.16, .38, 8), material, this.pathGroup);
      arrow.position.copy(curve.getPoint(.78));
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangent(.78).normalize());
      const marker = this.mesh(new THREE.TorusGeometry(.46, .04, 6, 24), material, this.pathGroup);
      marker.rotation.x = -Math.PI / 2; marker.position.copy(from);
      const label = this.label(link.kind === 'shortcut' ? '+4' : '-3', color, .75);
      label.position.copy(mid); label.position.y = .9;
      this.pathGroup.add(label);
    }
    this.pathResources = [...this.resources].filter(resource => !existing.has(resource));
  }
  sync(state, moves = []) {
    if (this.disposed) return;
    this.ensure(state);
    this.syncPaths(state.paths);
    this.available = [];
    state.players.forEach(player => {
      const home = this.homes[player.id];
      const count = player.pieces.length;
      if (home.name !== player.name) {
        if (home.label) {
          this.scene.remove(home.label);
          this.resources.delete(home.label.material.map);
          this.resources.delete(home.label.material);
          home.label.material.map.dispose(); home.label.material.dispose();
        }
        home.label = this.label(player.name, '#ffffff', 2.3);
        this.scene.add(home.label);
        home.name = player.name;
      }
      this.placeHome(player.id, count);
      this.placeGoals(player.id, count);
      home.label.visible = !player.eliminated;
      const goalEnd = 39 + count;
      this.pawns[player.id].forEach((pawn, piece) => {
        pawn.rotation.set(0, 0, 0);
        if (piece >= count) {
          pawn.visible = false;
          pawn.userData.ring.visible = pawn.userData.safe.visible = false;
          return;
        }
        const progress = player.pieces[piece];
        pawn.position.copy(vec(location(player.id, piece, progress, count)));
        pawn.visible = !player.eliminated;
        pawn.scale.setScalar(pawnScale(player.id, progress, count));
        const available = player.id === state.current && moves.includes(piece);
        pawn.userData.ring.visible = available;
        pawn.userData.safe.visible = progress >= 40 &&
          Array.from({ length: goalEnd - progress }, (_, i) => progress + i + 1).every(value => player.pieces.includes(value));
        if (available) this.available.push(pawn);
      });
    });
    this.canvas.style.cursor = this.available.length ? 'pointer' : 'default';
    this.tiles.forEach(({ star, ring }) => { star.visible = ring.visible = state.mode === 'events'; });
  }
  follow(position, close = true) {
    this.waiting = false;
    if (this.overview || motion.matches) return;
    this.focus.copy(position); this.focus.y = .3;
    this.cameraGoal.copy(this.focus).add(new THREE.Vector3(close ? 6 : 10, close ? 10 : 15, close ? 9 : 15));
  }
  reset() {
    this.overview = !this.overview;
    this.idle();
    this.caption();
    return this.overview;
  }
  caption() {
    document.getElementById('scene-caption').textContent = motion.matches ? '3D · Bewegungen reduziert'
      : this.overview || this.waiting ? `3D · Gesamtes Brett im Blick · ${this.landscape?.status || 'Sonnig'}`
      : '3D · Kamera folgt dem Spiel';
  }
  idle() {
    this.waiting = true;
    this.focus.set(0, 0, 0);
    const scale = Math.max(1, 1 / this.camera.aspect);
    this.cameraGoal.set(12 * scale, 19 * scale, 19 * scale);
    this.caption();
  }
  newGame() {
    // Dynamic pieces and slots from extra-piece events are hidden again; objects are kept for reuse.
    for (let player = 0; player < 4; player++) {
      this.placeHome(player, 4);
      this.placeGoals(player, 4);
      this.pawns[player].forEach((pawn, piece) => {
        pawn.rotation.set(0, 0, 0);
        pawn.scale.setScalar(1);
        pawn.userData.ring.visible = pawn.userData.safe.visible = false;
        pawn.visible = piece < 4;
        if (piece < 4) pawn.position.copy(vec(location(player, piece, -1, 4)));
      });
    }
    this.idle();
  }
  frame(time) {
    if (this.disposed) return;
    this.fitCanvas();
    const dt = document.hidden ? 0 : Math.min((time - (this.lastTime ?? time)) / 1000, .05);
    this.lastTime = time;
    this.elapsed += dt;
    this.landscape.update(dt, this.elapsed, motion.matches);
    if (this.waiting && this.weatherCaption !== this.landscape.status) {
      this.weatherCaption = this.landscape.status;
      this.caption();
    }
    if (this.active) {
      this.active.time += dt;
      const t = Math.min(1, this.active.time / this.active.duration);
      this.active.update(t);
      if (t === 1) { const resolve = this.active.resolve; this.active = null; resolve(); }
    }
    if (!motion.matches) this.tiles.forEach(({ star, ring }, i) => {
      star.rotation.y = this.elapsed * .9 + i;
      star.position.y = .43 + Math.sin(this.elapsed * 2 + i) * .06;
      ring.scale.setScalar(1 + Math.sin(this.elapsed * 2 + i) * .08);
    });
    this.camera.position.lerp(this.cameraGoal, motion.matches ? 1 : 1 - Math.exp(-dt * 5));
    this.look.lerp(this.focus, motion.matches ? 1 : 1 - Math.exp(-dt * 6));
    this.camera.lookAt(this.look);
    if (!document.hidden) this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  }
  tween(duration, update) {
    if (this.disposed) return Promise.resolve();
    if (this.active) throw new Error('Eine 3D-Animation läuft bereits.');
    if (motion.matches) {
      update(1);
      return Promise.resolve();
    }
    return new Promise(resolve => {
      this.active = { duration, update, resolve, time: 0 };
    });
  }
  async travel(change, height = 2, duration = .85, count = 4) {
    const pawn = this.pawn(change.player, change.piece);
    const from = pawn.position.clone();
    const to = vec(location(change.player, change.piece, change.to, count));
    const fromScale = pawn.scale.x;
    const toScale = pawnScale(change.player, change.to, count);
    await this.tween(duration, t => {
      pawn.position.lerpVectors(from, to, ease(t));
      pawn.position.y += Math.sin(t * Math.PI) * (motion.matches ? 0 : height);
      pawn.scale.setScalar(fromScale + (toScale - fromScale) * ease(t));
      this.follow(pawn.position);
    });
  }
  async move(before, after, player, piece, path = null) {
    if (this.disposed) return;
    this.ensure(after);
    this.sync(before);
    this.available = [];
    const pawn = this.pawn(player, piece);
    pawn.userData.ring.visible = true;
    const count = countOf(before, player);
    for (const progress of path || moveRoute(before.players[player].pieces[piece], after.players[player].pieces[piece])) {
      await this.travel({ player, piece, to: progress }, .65, .19, count);
      this.sound('step');
    }
    const captured = changes(before, after).filter(change => change.player !== player);
    for (const change of captured) {
      this.sound('capture');
      await this.travel(change, 1.5, .65, countOf(after, change.player));
    }
    if (after.players[player].pieces[piece] >= 40) this.sound('goal');
    pawn.userData.ring.visible = false;
    this.sync(after);
  }
  burst(position, color, count = 44) {
    const group = new THREE.Group();
    const geometry = new THREE.IcosahedronGeometry(.08, 0);
    const material = new THREE.MeshBasicMaterial({ color, transparent: true });
    const directions = [];
    for (let i = 0; i < count; i++) {
      const node = new THREE.Mesh(geometry, material);
      group.add(node);
      const angle = i * 2.39996;
      directions.push(new THREE.Vector3(Math.cos(angle), .3 + (i % 7) / 5, Math.sin(angle)).multiplyScalar(1 + (i % 5) * .3));
    }
    group.position.copy(position);
    this.scene.add(group);
    return {
      update: t => {
        group.children.forEach((node, i) => {
          node.position.copy(directions[i]).multiplyScalar(t * 2);
          node.position.y -= t * t * 1.5;
          node.rotation.set(t * 6, t * 4, 0);
          node.scale.setScalar(1 - t * .8);
        });
        material.opacity = 1 - t;
      },
      dispose: () => { this.scene.remove(group); geometry.dispose(); material.dispose(); }
    };
  }
  /** Animates home plates, sockets and extra goal slots between the layouts of two snapshots. */
  fixtureTransition(before, after) {
    const entries = [];
    after.players.forEach(next => {
      const from = countOf(before, next.id);
      const to = next.pieces.length;
      if (from === to) return;
      const home = this.homes[next.id];
      const objects = [home.plate, ...this.sockets[next.id], ...this.goalExtras[next.id], home.label].filter(Boolean);
      const capture = () => objects.map(object => ({ visible: object.visible, position: object.position.clone(), scale: object.scale.clone() }));
      this.placeHome(next.id, to); this.placeGoals(next.id, to);
      const end = capture();
      this.placeHome(next.id, from); this.placeGoals(next.id, from);
      const start = capture();
      objects.forEach((object, i) => entries.push({ object, start: start[i], end: end[i] }));
    });
    return t => entries.forEach(({ object, start, end }) => {
      object.visible = start.visible || end.visible;
      object.position.lerpVectors(start.position, end.position, ease(t));
      if (!start.visible) object.scale.lerpVectors(TINY, end.scale, Math.max(1e-4, pop(t)));
      else object.scale.lerpVectors(start.scale, end.visible ? end.scale : TINY, ease(t));
    });
  }
  async rocket(target) {
    this.sound('rocket');
    const destination = target ? this.pawn(target.player, target.piece).position.clone() : new THREE.Vector3(0, .3, 0);
    this.follow(destination);
    const rocket = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: '#edf3ff', metalness: .7, roughness: .2 });
    const fire = new THREE.MeshBasicMaterial({ color: '#ff943e' });
    const bodyGeometry = new THREE.CylinderGeometry(.12, .12, .8, 12);
    const tipGeometry = new THREE.ConeGeometry(.16, .35, 12);
    const flameGeometry = new THREE.ConeGeometry(.13, .65, 12);
    const body = new THREE.Mesh(bodyGeometry, metal);
    const tip = new THREE.Mesh(tipGeometry, metal); tip.position.y = .57;
    const flame = new THREE.Mesh(flameGeometry, fire); flame.position.y = -.7; flame.rotation.z = Math.PI;
    rocket.add(body, tip, flame); this.scene.add(rocket);
    try {
      await this.tween(1.2, t => {
        rocket.position.copy(destination).add(new THREE.Vector3(-5 * (1 - t), 8 * (1 - t), -3 * (1 - t)));
        rocket.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(5, -8, 3).normalize());
        flame.scale.setScalar(1 + Math.sin(t * 80) * .25);
      });
    } finally {
      this.scene.remove(rocket);
      [bodyGeometry, tipGeometry, flameGeometry, metal, fire].forEach(resource => resource.dispose());
    }
    const explosion = this.burst(destination, '#ffa24a', 64);
    this.sound('explosion');
    try { await this.tween(.65, t => explosion.update(t)); } finally { explosion.dispose(); }
  }
  async event(before, after, result) {
    if (this.disposed) return;
    this.ensure(before);
    this.ensure(after);
    this.sync(before);
    const changed = changes(before, after);
    const id = result.event.id;
    const eventSound = {
      'all-home': 'home', 'leaders-home': 'home', swap: 'swap', redistribute: 'swap',
      'instant-goal': 'portal', 'double-one': 'bonus', 'double-two': 'bonus',
      four: 'bonus', ten: 'bonus', again: 'bonus', lose: 'lose', paths: 'paths', 'extra-piece': 'bonus'
    }[id];
    if (eventSound) this.sound(eventSound);
    const actor = result.event.actor;
    const ends = changed.map(change => vec(location(change.player, change.piece, change.to, countOf(after, change.player))));
    const endScales = changed.map(change => pawnScale(change.player, change.to, countOf(after, change.player)));
    const focusIndex = Math.max(0, changed.findIndex(change => change.added));
    const anchor = !changed.length ? vec(location(actor, 0, -1, countOf(before, actor)), .5)
      : changed[focusIndex].added ? ends[focusIndex].clone()
      : this.pawn(changed[focusIndex].player, changed[focusIndex].piece).position.clone();
    document.getElementById('scene-caption').textContent = result.event.title;
    if (id === 'rocket') await this.rocket(result.target);
    const global = ['all-home', 'leaders-home', 'lose', 'swap', 'redistribute', 'four', 'ten', 'paths'].includes(id);
    if (id === 'paths') this.syncPaths(after.paths);
    this.follow(global ? new THREE.Vector3() : anchor, !global);
    const color = id === 'lose' ? '#f16463' : id === 'instant-goal' ? '#f5c451'
      : ['four', 'ten', 'double-one', 'double-two'].includes(id) ? '#6c9ff8'
      : id === 'extra-piece' ? COLORS[actor] ?? '#c6ef83' : '#c6ef83';
    const burst = this.burst(global ? new THREE.Vector3(0, 1, 0) : anchor, color);
    const ringGeometry = new THREE.TorusGeometry(.5, .04, 8, 48);
    const ringMaterial = new THREE.MeshBasicMaterial({ color, transparent: true });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(global ? new THREE.Vector3(0, .4, 0) : anchor);
    this.scene.add(ring);
    const origins = changed.map((change, i) => change.added ? ends[i].clone() : this.pawn(change.player, change.piece).position.clone());
    const originScales = changed.map(change => this.pawn(change.player, change.piece).scale.x);
    // Pieces that keep their progress but whose home slot moves because the home layout changes.
    const relayout = [];
    after.players.forEach(next => {
      const count = next.pieces.length;
      if (count === countOf(before, next.id)) return;
      next.pieces.forEach((progress, piece) => {
        if (changed.some(change => change.player === next.id && change.piece === piece)) return;
        const pawn = this.pawn(next.id, piece);
        relayout.push({ pawn, from: pawn.position.clone(), to: vec(location(next.id, piece, progress, count)),
          fromScale: pawn.scale.x, toScale: pawnScale(next.id, progress, count) });
      });
    });
    const fixtures = this.fixtureTransition(before, after);
    fixtures(0);
    const beams = [];
    const beamGeometry = new THREE.CylinderGeometry(.45, .45, 3.2, 24, 1, true);
    const beamMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    changed.forEach((change, i) => {
      if (!change.added) return;
      const count = countOf(after, change.player);
      const spots = [ends[i], ...(count > 4 ? [vec(extraGoalCell(change.player, count - 5))] : [])];
      for (const spot of spots) {
        const beam = new THREE.Mesh(beamGeometry, beamMaterial);
        beam.position.copy(spot); beam.position.y = 1.7;
        this.scene.add(beam); beams.push(beam);
      }
    });
    const dice = [];
    const diceGeometry = new THREE.BoxGeometry(.65, .65, .65);
    const diceMaterial = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .3 });
    if (['four', 'ten', 'double-one', 'double-two'].includes(id)) {
      for (let i = 0; i < (global ? 4 : 2); i++) {
        const die = new THREE.Mesh(diceGeometry, diceMaterial);
        const label = this.label(id === 'four' ? '4' : id === 'ten' ? '10' : '6', '#ffffff', .8);
        die.add(label); label.position.z = .4;
        dice.push(die); this.scene.add(die);
      }
    }
    try {
      await this.tween(id === 'rocket' ? .75 : id === 'extra-piece' ? 2 : 1.65, t => {
        if (id === 'paths') this.pathGroup.scale.setScalar(.05 + .95 * ease(t));
        burst.update(t);
        ring.scale.setScalar(1 + t * (global ? 14 : 5));
        ringMaterial.opacity = 1 - t;
        ring.rotation.z = t * Math.PI * 2;
        fixtures(t);
        beamMaterial.opacity = Math.sin(t * Math.PI) * .45;
        beams.forEach(beam => { beam.scale.set(1 - t * .5, 1, 1 - t * .5); beam.rotation.y = t * 4; });
        relayout.forEach(({ pawn, from, to, fromScale, toScale }) => {
          pawn.position.lerpVectors(from, to, ease(t));
          pawn.position.y += from.distanceTo(to) > 1e-3 && !motion.matches ? Math.sin(t * Math.PI) * .5 : 0;
          pawn.scale.setScalar(fromScale + (toScale - fromScale) * ease(t));
        });
        dice.forEach((die, i) => {
          const angle = i * Math.PI / 2 + t * Math.PI * 2;
          die.position.set(Math.cos(angle) * 2, 1 + Math.sin(t * Math.PI) * 2, Math.sin(angle) * 2);
          die.rotation.set(t * 6, t * 8, t * 3);
          die.scale.setScalar(Math.sin(t * Math.PI));
        });
        changed.forEach((change, i) => {
          const pawn = this.pawn(change.player, change.piece);
          const end = ends[i];
          if (change.added) {
            // The new piece materializes inside the light beam and settles into its home slot.
            const grow = clamp((t - .15) / .7, 0, 1);
            pawn.visible = !change.eliminated && grow > 0;
            pawn.position.copy(end);
            pawn.position.y += (1 - ease(grow)) * 1.6;
            pawn.scale.setScalar(Math.max(1e-4, endScales[i] * pop(grow)));
            pawn.rotation.y = (1 - grow) * Math.PI * 4;
            pawn.userData.ring.visible = grow > 0 && grow < 1;
          } else if (id === 'lose') {
            pawn.position.y = origins[i].y + t * 3;
            pawn.rotation.y = t * 10; pawn.scale.setScalar(originScales[i] * (1 - t));
          } else if (id === 'instant-goal') {
            // Lift into a portal, then materialize above the goal lane.
            pawn.position.copy(t < .5 ? origins[i] : end);
            pawn.position.y += Math.sin(t * Math.PI) * 3;
            pawn.scale.setScalar(Math.abs(2 * t - 1));
            this.follow(pawn.position);
          } else if (origins[i].distanceTo(end) < 1e-3) {
            // Secured goal pieces keep their visual slot when the lane grows at its entry.
            pawn.position.copy(end);
          } else {
            pawn.position.lerpVectors(origins[i], end, ease(t));
            const arc = motion.matches ? 0 : Math.sin(t * Math.PI);
            if (id === 'swap') {
              const dx = end.x - origins[i].x, dz = end.z - origins[i].z;
              pawn.position.x += -dz * arc * .3;
              pawn.position.z += dx * arc * .3;
            } else if (id === 'redistribute') {
              pawn.position.x += Math.cos(t * Math.PI * 4 + i) * arc;
              pawn.position.z += Math.sin(t * Math.PI * 4 + i) * arc;
            }
            pawn.position.y += arc * (id === 'redistribute' ? 3 : id === 'swap' ? 2 : 1.4);
            pawn.rotation.y = t * Math.PI * 2;
            pawn.scale.setScalar(originScales[i] + (endScales[i] - originScales[i]) * ease(t));
          }
        });
      });
    } finally {
      this.pathGroup.scale.setScalar(1);
      burst.dispose(); this.scene.remove(ring);
      ringGeometry.dispose(); ringMaterial.dispose();
      beams.forEach(beam => this.scene.remove(beam));
      beamGeometry.dispose(); beamMaterial.dispose();
      dice.forEach(die => {
        this.scene.remove(die);
        die.children.forEach(label => { this.resources.delete(label.material.map); this.resources.delete(label.material); label.material.map.dispose(); label.material.dispose(); });
      });
      diceGeometry.dispose(); diceMaterial.dispose();
    }
    this.sync(after);
    this.caption();
  }
  /** Builds the reusable train once: locomotive plus two wagons, animated wheels and a steam puff pool. */
  trainRig() {
    if (this.rig) return this.rig;
    const group = new THREE.Group();
    group.position.set(TRAIN_X[0], 0, TRAIN_Z);
    group.visible = false;
    this.scene.add(group);
    const m = {
      loco: this.material('#2f3b4f'), red: this.material('#d0453b'), brass: this.material('#f5c451'),
      dark: this.material('#1b2230'), blue: this.material('#4c8bd6'), orange: this.material('#e9a03b'),
      cargo: this.material('#9a6b45'), lamp: this.material('#fff3b0', true)
    };
    const g = {
      wheel: this.keep(new THREE.CylinderGeometry(WHEEL, WHEEL, .07, 18)),
      spoke: this.keep(new THREE.BoxGeometry(WHEEL * 1.8, .04, .09)),
      chassis: this.keep(new THREE.BoxGeometry(1, .14, .62)),
      boiler: this.keep(new THREE.CylinderGeometry(.27, .27, 1.1, 20)),
      chimney: this.keep(new THREE.CylinderGeometry(.1, .07, .4, 12)),
      dome: this.keep(new THREE.SphereGeometry(.13, 14, 10)),
      cab: this.keep(new THREE.BoxGeometry(.7, .72, .66)),
      roof: this.keep(new THREE.BoxGeometry(.86, .06, .78)),
      buffer: this.keep(new THREE.BoxGeometry(.08, .16, .7)),
      lamp: this.keep(new THREE.SphereGeometry(.08, 10, 8)),
      wagon: this.keep(new THREE.BoxGeometry(1.5, .5, .64)),
      crate: this.keep(new THREE.BoxGeometry(.4, .3, .4)),
      coupling: this.keep(new THREE.BoxGeometry(.3, .05, .05)),
      puff: this.keep(new THREE.IcosahedronGeometry(1, 1))
    };
    const wheelY = RAIL_TOP + WHEEL;
    const wheels = [];
    const part = (geometry, material, x, y, z = 0) => {
      const mesh = this.mesh(geometry, material, group);
      mesh.position.set(x, y, z);
      return mesh;
    };
    const axle = x => {
      for (const z of [-GAUGE / TRAIN_SCALE, GAUGE / TRAIN_SCALE]) {
        const wheel = new THREE.Group();
        wheel.position.set(x, wheelY, z);
        const disc = this.mesh(g.wheel, m.dark, wheel);
        disc.rotation.x = Math.PI / 2;
        const spoke = this.mesh(g.spoke, m.red, wheel);
        spoke.position.z = Math.sign(z) * .01;
        group.add(wheel); wheels.push(wheel);
      }
    };
    const chassis = (x, length) => { part(g.chassis, m.dark, x, wheelY + .14).scale.x = length; };
    // Locomotive: front at local x = 0, the train extends towards negative x.
    chassis(-.95, 1.9);
    part(g.boiler, m.loco, -.65, .88).rotation.z = Math.PI / 2;
    part(g.chimney, m.dark, -.3, 1.28);
    part(g.dome, m.brass, -.78, 1.14);
    part(g.cab, m.red, -1.55, 1.0);
    part(g.roof, m.dark, -1.55, 1.39);
    part(g.buffer, m.red, -.02, wheelY + .14);
    part(g.lamp, m.lamp, .02, .9);
    [-.35, -.85, -1.45].forEach(axle);
    for (const [front, material] of [[-2.15, m.blue], [-3.9, m.orange]]) {
      part(g.coupling, m.dark, front + .1, wheelY + .12);
      chassis(front - .75, 1.5);
      part(g.wagon, material, front - .75, wheelY + .46);
      part(g.crate, m.cargo, front - .45, wheelY + .86);
      part(g.crate, m.cargo, front - 1.05, wheelY + .86);
      [front - .35, front - 1.15].forEach(axle);
    }
    const puffs = Array.from({ length: 14 }, () => {
      const material = this.keep(new THREE.MeshStandardMaterial({ color: '#f4f6fa', roughness: 1, metalness: 0, transparent: true, depthWrite: false }));
      const puff = new THREE.Mesh(g.puff, material);
      puff.visible = false;
      this.scene.add(puff);
      return puff;
    });
    group.scale.setScalar(TRAIN_SCALE);
    // Hidden between the portal gates: clip everything with |x| < TRAIN_PORTAL.
    const clipping = [new THREE.Plane(new THREE.Vector3(-1, 0, 0), -TRAIN_PORTAL), new THREE.Plane(new THREE.Vector3(1, 0, 0), -TRAIN_PORTAL)];
    [...Object.values(m), ...puffs.map(puff => puff.material)].forEach(material => {
      material.clippingPlanes = clipping;
      material.clipIntersection = true;
    });
    this.rig = { group, wheels, puffs, clipping, length: 5.4 * TRAIN_SCALE, chimney: new THREE.Vector3(-.3, 1.5, 0).multiplyScalar(TRAIN_SCALE) };
    return this.rig;
  }
  async train(before, after, result = {}) {
    if (this.disposed) return;
    this.ensure(before);
    this.ensure(after);
    this.sync(before);
    this.available = [];
    this.canvas.style.cursor = 'default';
    const rig = this.trainRig();
    const [west, east] = TRAIN_X;
    // The locomotive enters at the western end; the run ends when the last wagon reaches the eastern end.
    const from = west, to = east + rig.length;
    const targetList = result?.targets ?? [];
    // The portal only shields a secured Mint piece on the original goal slot under the line; unsecured ones are hit visibly.
    const mint = after.players[2];
    const slot = mint ? 42 + Math.max(0, mint.pieces.length - 4) : -1;
    const guarded = !!mint && !mint.eliminated && mint.pieces.includes(slot) &&
      !targetList.some(target => target.player === 2 && target.progress === slot);
    rig.clipping.forEach(plane => { plane.constant = guarded ? -TRAIN_PORTAL : 0; });
    const targets = targetList.flatMap(target => {
      const pawn = this.pawn(target.player, target.piece);
      if (!pawn) return [];
      const count = countOf(after, target.player);
      const start = pawn.position.clone();
      return [{ pawn, start, end: vec(location(target.player, target.piece, -1, count)),
        fromScale: pawn.scale.x, toScale: pawnScale(target.player, -1, count),
        // Hop off just before the locomotive reaches the piece, so they never intersect.
        hit: clamp((start.x - .45 - from) / (to - from), 0, 1), struck: false }];
    });
    document.getElementById('scene-caption').textContent = 'Der Zug fährt durch!';
    this.sound('train');
    rig.group.visible = true;
    const hop = .14;
    try {
      await this.tween(5.4, t => {
        const front = from + (to - from) * t;
        // Lift so the scaled wheels still touch the rails.
        rig.group.position.set(front, RAIL_TOP * (1 - TRAIN_SCALE) + (motion.matches ? 0 : Math.abs(Math.sin(t * 90)) * .01), TRAIN_Z);
        const angle = -(front - from) / (WHEEL * TRAIN_SCALE);
        const tail = front - rig.length;
        this.portalGlow(!guarded ? 0 : front > -TRAIN_PORTAL - 1.5 && tail < TRAIN_PORTAL + 1.5 ? 1
          : clamp(1 - Math.min(Math.abs(front + TRAIN_PORTAL), Math.abs(tail - TRAIN_PORTAL)) / 3, 0, 1));
        rig.wheels.forEach(wheel => { wheel.rotation.z = angle; });
        const chimney = rig.chimney.clone().add(rig.group.position);
        rig.puffs.forEach((puff, i) => {
          const phase = (this.elapsed * 1.7 + i / rig.puffs.length) % 1;
          puff.visible = t < 1 && !motion.matches;
          puff.position.set(chimney.x - phase * 1.7, chimney.y + phase * 1.1, TRAIN_Z + Math.sin(i * 1.7) * phase * .25);
          puff.scale.setScalar((.1 + phase * .45) * TRAIN_SCALE);
          puff.material.opacity = .75 * (1 - phase);
        });
        let struck = false;
        targets.forEach(target => {
          const local = clamp((t - target.hit) / hop, 0, 1);
          if (local === 0) return;
          if (!target.struck) { target.struck = true; struck = true; }
          const { pawn, start, end } = target;
          pawn.position.lerpVectors(start, end, ease(local));
          pawn.position.y += motion.matches ? 0 : Math.sin(local * Math.PI) * 2.4;
          pawn.rotation.y = local * Math.PI * 3;
          pawn.scale.setScalar(target.fromScale + (target.toScale - target.fromScale) * ease(local));
        });
        if (struck) this.sound('capture');
        this.follow(new THREE.Vector3(clamp(front - rig.length / 2, -6, 6), .3, TRAIN_Z), false);
      });
    } finally {
      rig.group.visible = false;
      rig.puffs.forEach(puff => { puff.visible = false; });
      rig.clipping.forEach(plane => { plane.constant = 0; });
      this.portalGlow(0);
    }
    this.sync(after);
    this.caption();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resize.disconnect();
    this.canvas.removeEventListener('pointerup', this.click);
    this.canvas.removeEventListener('webglcontextlost', this.contextLost);
    if (this.active) { this.active.resolve(); this.active = null; }
    this.resources.forEach(resource => resource.dispose());
    this.landscape.dispose();
    this.resources.clear();
    this.renderer.dispose();
  }
}
