const melodies = {
  click: [620], start: [330, 440, 660], roll: [180, 240, 160, 300, 210, 360],
  result: [520, 780], step: [260], capture: [440, 220, 110],
  goal: [523, 659, 784], turn: [392, 523], event: [294, 370, 440, 587],
  wheel: [700, 620, 540, 460, 380, 300], rocket: [900, 650, 380, 120],
  explosion: [90, 60], home: [440, 330, 220], swap: [330, 660, 440, 880],
  portal: [262, 392, 523, 784, 1047], bonus: [440, 554, 659],
  lose: [392, 330, 262, 196], paths: [220, 330, 440, 330, 660],
  winner: [523, 659, 784, 1047, 784, 1047], bird: [1500, 2000, 1700],
  animal: [280, 230, 250], surprise: [330, 660, 420, 840],
  rain: [160, 180, 140], wind: [110, 140, 100], train: [196, 196, 294, 294, 196, 130]
};

export class SoundEffects {
  constructor() {
    this.enabled = true;
    this.supported = !!(window.AudioContext || window.webkitAudioContext);
    this.context = null;
  }

  async unlock() {
    if (!this.supported || !this.enabled) return;
    if (!this.context) {
      this.context = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.context.createGain();
      this.master.gain.value = .18;
      this.master.connect(this.context.destination);
      const buffer = this.context.createBuffer(1, this.context.sampleRate, this.context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noise = buffer;
    }
    if (this.context.state === 'suspended') await this.context.resume();
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (this.master) {
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.setValueAtTime(enabled ? .18 : 0, this.context.currentTime);
    }
  }

  play(name) {
    if (!this.enabled || document.hidden || this.context?.state !== 'running') return;
    const notes = melodies[name];
    if (!notes) throw new Error('Unbekannter Soundeffekt: ' + name);
    const ambient = ['bird', 'animal', 'rain', 'wind'].includes(name);
    const spacing = name === 'roll' ? .15 : name === 'winner' ? .16 : .075;
    const duration = ambient ? .18 : name === 'step' ? .065 : .13;
    const now = this.context.currentTime;
    notes.forEach((frequency, i) => {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const time = now + i * spacing;
      oscillator.type = ['capture', 'lose', 'paths'].includes(name) ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, time);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, frequency * .8), time + duration);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(ambient ? .12 : .4, time + .008);
      gain.gain.exponentialRampToValueAtTime(.001, time + duration);
      oscillator.connect(gain); gain.connect(this.master);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(time); oscillator.stop(time + duration);
    });
    if (['roll', 'rocket', 'explosion', 'rain', 'wind', 'paths', 'train'].includes(name)) {
      const source = this.context.createBufferSource();
      source.buffer = this.noise;
      const filter = this.context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = name === 'explosion' ? 650 : 1800;
      const gain = this.context.createGain();
      const length = name === 'roll' ? .9 : .5;
      gain.gain.setValueAtTime(ambient ? .08 : .3, now);
      gain.gain.exponentialRampToValueAtTime(.001, now + length);
      source.connect(filter); filter.connect(gain); gain.connect(this.master);
      source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
      source.start(now); source.stop(now + length);
    }
  }

  dispose() {
    if (this.context && this.context.state !== 'closed') {
      void this.context.close().catch(error => console.warn('Audio konnte nicht beendet werden:', error));
    }
  }
}
