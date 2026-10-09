import test from 'node:test';
import assert from 'node:assert/strict';
import { SoundEffects } from './sound.js';

function audioEnvironment() {
  const param = () => ({
    value: 0, cancelScheduledValues() {}, setValueAtTime(value) { this.value = value; },
    linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}
  });
  class Context {
    constructor() { this.state = 'suspended'; this.currentTime = 1; this.sampleRate = 100; this.sources = 0; }
    createGain() { return { gain: param(), connect() {}, disconnect() {} }; }
    createBuffer() { return { getChannelData: () => new Float32Array(100) }; }
    createBiquadFilter() { return { frequency: param(), connect() {}, disconnect() {} }; }
    source() {
      this.sources++;
      return { frequency: param(), connect() {}, disconnect() {}, start() {}, stop() { this.onended?.(); } };
    }
    createOscillator() { return this.source(); }
    createBufferSource() { return this.source(); }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
  }
  globalThis.window = { AudioContext: Context };
  globalThis.document = { hidden: false };
}

test('Audio is lazy, resumes after interaction and covers all gameplay and ambient effects', async () => {
  audioEnvironment();
  const sound = new SoundEffects();
  sound.play('start');
  assert.equal(sound.context, null);
  await sound.unlock();
  assert.equal(sound.context.state, 'running');
  for (const name of [
    'click', 'start', 'roll', 'result', 'step', 'capture', 'goal', 'turn', 'event',
    'wheel', 'rocket', 'explosion', 'home', 'swap', 'portal', 'bonus', 'lose',
    'paths', 'winner', 'bird', 'animal', 'surprise', 'rain', 'wind', 'train'
  ]) sound.play(name);
  assert.ok(sound.context.sources > 24);
  assert.throws(() => sound.play('invalid'), /Unbekannter Soundeffekt/);
  sound.dispose();
  assert.equal(sound.context.state, 'closed');
});

test('Muting silences queued sounds and prevents new effects; hidden tabs remain quiet', async () => {
  audioEnvironment();
  const sound = new SoundEffects();
  sound.setEnabled(false);
  await sound.unlock();
  assert.equal(sound.context, null);
  sound.setEnabled(true);
  await sound.unlock();
  sound.play('winner');
  const before = sound.context.sources;
  sound.setEnabled(false);
  assert.equal(sound.master.gain.value, 0);
  sound.play('roll');
  assert.equal(sound.context.sources, before);
  sound.setEnabled(true);
  assert.equal(sound.master.gain.value, .18);
  document.hidden = true;
  sound.play('rain');
  assert.equal(sound.context.sources, before);
  document.hidden = false;
  sound.play('step');
  assert.ok(sound.context.sources > before);
  sound.dispose();
});

test('Unsupported browsers do not create audio contexts', async () => {
  globalThis.window = {};
  const sound = new SoundEffects();
  assert.equal(sound.supported, false);
  await sound.unlock();
  assert.equal(sound.context, null);
});
