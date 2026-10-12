export const SESSION_KEYS = { host: 'bitte-aergern.host', player: 'bitte-aergern.player' };

function defaultStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

export function readSession(role, storage = defaultStorage()) {
  try {
    const value = JSON.parse(storage.getItem(SESSION_KEYS[role]));
    return value?.role === role && /^[A-Z0-9]{4,10}$/.test(value.code) && typeof value.token === 'string' ? value : null;
  } catch { return null; }
}

export function clearSession(role, storage = defaultStorage()) {
  try { storage.removeItem(SESSION_KEYS[role]); } catch { /* Private browsing may disable storage. */ }
}

export function joinURL(code, base = globalThis.location.href) {
  const url = new URL('controller/', base);
  url.searchParams.set('room', code);
  return url.href;
}

export function canAct(room, seat, connected) {
  if (!connected || !room || room.busy || !room.hostConnected || room.seats.some(s => s.kind === 'human' && !s.connected)) return false;
  const state = room.state;
  if (!state) return false;
  if (state.eventOpen) return state.eventActor === seat;
  return room.status === 'playing' && state.current === seat && !state.pendingTrain && ['roll', 'move'].includes(state.phase);
}

export function wirePhase(enginePhase, eventOpen) {
  return enginePhase === 'over' ? 'over' : eventOpen || enginePhase === 'events' ? 'event' : enginePhase;
}

export function restoreEngine(Game, state) {
  if (!state?.engine || !Array.isArray(state.engine.players) || state.engine.players.length !== 4) throw new Error('Der gespeicherte Spielstand ist unvollständig.');
  const game = Object.create(Game.prototype);
  Object.assign(game, JSON.parse(JSON.stringify(state.engine)));
  game.random = Math.random;
  return game;
}

export class RoomConnection extends EventTarget {
  constructor(role, { storage = defaultStorage(), socketFactory = url => new WebSocket(url), location = globalThis.location } = {}) {
    super();
    this.role = role;
    this.storage = storage;
    this.socketFactory = socketFactory;
    this.location = location;
    this.session = readSession(role, storage);
    this.ready = false;
    this.stopped = true;
    this.terminalMessage = null;
    this.attempt = 0;
    this.onlineListener = () => { if (!this.stopped && !this.socket) this.open(); };
    globalThis.addEventListener?.('online', this.onlineListener);
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  connect(request) {
    this.close();
    this.stopped = false;
    this.terminalMessage = null;
    this.initialRequest = request;
    this.session = request.type === 'resume' ? { ...request, role: this.role } : null;
    this.attempt = 0;
    this.open();
  }

  open() {
    if (this.stopped || this.socket) return;
    const url = new URL('ws', this.location.href);
    url.pathname = '/ws';
    url.search = '';
    url.hash = '';
    url.protocol = this.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.emit('connection', { ready: false, message: this.attempt ? 'Verbindung unterbrochen. Verbinde erneut …' : 'Verbinde mit dem Spieltisch …' });
    const socket = this.socketFactory(url.href);
    this.socket = socket;
    socket.onopen = () => {
      this.lastMessage = Date.now();
      socket.send(JSON.stringify(this.session ? { type: 'resume', code: this.session.code, token: this.session.token } : this.initialRequest));
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastMessage > 65000) socket.close();
        else if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'ping' }));
      }, 20000);
    };
    socket.onmessage = event => {
      this.lastMessage = Date.now();
      let message;
      try { message = JSON.parse(event.data); } catch { this.emit('error', { code: 'PROTOCOL', message: 'Ungültige Serverantwort.' }); return; }
      if (message.type === 'welcome') {
        if (message.role !== this.role) { this.emit('error', { message: 'Die Sitzung hat eine falsche Rolle.' }); this.close(); return; }
        this.session = { code: message.code, token: message.token, role: message.role, seat: message.seat };
        try { this.storage.setItem(SESSION_KEYS[this.role], JSON.stringify(this.session)); } catch { /* Reconnect still works within this tab. */ }
        this.ready = true;
        this.attempt = 0;
        this.emit('connection', { ready: true, message: 'Verbunden' });
      }
      if (message.type === 'error') {
        if (['SESSION_REPLACED', 'INVALID_TOKEN', 'ROOM_EXPIRED', 'ROOM_NOT_FOUND'].includes(message.code)) {
          this.close();
          this.terminalMessage = message.message;
          this.emit('connection', { ready: false, terminal: true, message: message.message });
        }
        this.emit('error', message);
      }
      else this.emit(message.type, message);
    };
    socket.onerror = () => this.emit('error', { code: 'CONNECTION', message: 'Server nicht erreichbar. Internetspiel benötigt den Spring-Server mit /ws; npm start bietet nur den lokalen Modus.' });
    socket.onclose = event => {
      if (this.socket !== socket) return;
      clearInterval(this.heartbeat);
      this.socket = null;
      this.ready = false;
      if (event?.code === 4001 || event?.reason === 'SESSION_REPLACED') {
        this.stopped = true;
        clearTimeout(this.retry);
        const message = 'Die Sitzung wurde in einem anderen Tab oder Gerät fortgesetzt. Dieser Tab verbindet nicht automatisch erneut.';
        this.terminalMessage = message;
        this.emit('error', { code: 'SESSION_REPLACED', message });
        this.emit('connection', { ready: false, terminal: true, message });
        return;
      }
      this.emit('connection', { ready: false, message: 'Verbindung getrennt. Das Spiel ist pausiert.' });
      if (!this.stopped) {
        const delay = Math.min(10000, 500 * 2 ** Math.min(this.attempt++, 5));
        this.retry = setTimeout(() => this.open(), delay);
      }
    };
  }

  send(message) {
    if (!this.ready || this.socket?.readyState !== 1) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  close() {
    this.stopped = true;
    this.ready = false;
    clearTimeout(this.retry);
    clearInterval(this.heartbeat);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }
}
