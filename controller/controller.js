import { RoomConnection, readSession, clearSession, canAct } from '../network.js';

const $ = id => document.getElementById(id);
const colors = ['#f16463', '#f5c451', '#56c7a5', '#6c9ff8'];
const colorNames = ['Koralle', 'Gold', 'Mint', 'Blau'];
let connection = null;
let room = null;
let seat = null;
let pending = false;
let pendingRevision = null;
let lobbyPending = null;
let lobbyFeedback = '';
let motionEnabled = false;
let lastAcceleration = null;
let shakeAt = 0;
let shakePeakAt = 0;

function node(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}
function error(message) { $('error').hidden = false; $('error').textContent = message; }
function connected() { return !!connection?.ready && navigator.onLine; }
function eligible() { return !pending && !document.hidden && canAct(room, seat, connected()); }
function messageStatus() {
  $('connection').textContent = !navigator.onLine ? 'Offline. Internetverbindung herstellen; Eingaben sind gesperrt.'
    : connection?.terminalMessage ? connection.terminalMessage
    : !connection?.ready ? 'Nicht verbunden. Die Partie wartet auf die Verbindung.'
    : !room?.hostConnected ? 'Der Spieltisch ist getrennt. Die Partie ist pausiert.'
    : room.seats.some(s => s.kind === 'human' && !s.connected) ? 'Ein Handy ist getrennt. Die Partie ist pausiert.'
    : lobbyPending ? lobbyPending.type === 'configure' ? 'Einstellungen werden gespeichert …' : 'Partie wird gestartet …'
    : pending ? 'Aktion gesendet. Warte auf den Spieltisch …'
    : room.busy ? 'Animation am Spieltisch läuft …' : 'Verbunden · Alle Eingaben auf deinem Handy.';
}
function renderLobby() {
  const manager = room.managerSeat === seat;
  $('manager-controls').hidden = !manager;
  $('manager-note').textContent = manager ? 'Du verwaltest die Lobby. Freie Farben: KI oder unbenutzt. Getrennte Handy-Plätze kannst du freigeben; verbundene Menschen bleiben geschützt. Mindestens zwei aktive Farben zum Start.'
    : 'Das zuerst beigetretene Handy verwaltet Modus, freie Farben und den Spielstart.';
  $('mode').value = lobbyPending?.mode || room.mode;
  $('seats').replaceChildren();
  room.seats.forEach(s => {
    const row = node('div', undefined, 'seat');
    row.style.setProperty('--seat', colors[s.id]);
    row.append(node('strong', `${colorNames[s.id]} · ${s.name}${s.id === seat ? ' (du)' : ''}`));
    if (s.kind === 'human' && s.connected) row.append(node('p', 'Handy verbunden'));
    else if (manager) {
      const label = node('label', s.kind === 'human' ? 'Handy getrennt – Platz freigeben' : 'Freier Platz');
      const select = node('select');
      select.dataset.seat = s.id;
      if (s.kind === 'human') {
        const reserved = node('option', 'Getrennt – Platz reserviert lassen');
        reserved.value = 'human';
        select.append(reserved);
      }
      for (const [kind, title] of [['empty', 'Unbenutzt'], ['computer', 'KI']]) {
        const option = node('option', title);
        option.value = kind;
        select.append(option);
      }
      select.value = lobbyPending?.seats?.find(setting => setting.id === s.id)?.kind || s.kind;
      select.disabled = !connected() || !!lobbyPending || room.busy;
      label.append(select); row.append(label);
    } else row.append(node('p', s.kind === 'human' ? 'Handy getrennt' : s.kind === 'computer' ? 'KI' : 'Unbenutzt'));
    $('seats').append(row);
  });
  const active = room.seats.filter(s => s.kind !== 'empty').length;
  const ready = connected() && room.hostConnected && room.seats.every(s => s.kind !== 'human' || s.connected);
  $('start').disabled = !ready || active < 2 || room.busy || !!lobbyPending;
  $('configure').disabled = !connected() || room.busy || !!lobbyPending;
  $('mode').disabled = !connected() || room.busy || !!lobbyPending;
  $('configure-status').textContent = lobbyFeedback;
  $('start-hint').textContent = lobbyPending ? 'Bitte die Serverbestätigung abwarten.'
    : active < 2 ? 'Mindestens zwei aktive Farben nötig. KI auswählen oder weitere Handys beitreten lassen.'
    : !ready ? 'Spieltisch und alle Handys müssen verbunden sein. Getrennte Handy-Plätze kannst du in der Lobby stattdessen auf KI oder unbenutzt setzen.'
      : 'Einstellungen zuerst speichern. Danach können alle loslegen.';
}
function stat(value, title) {
  const cell = node('div', undefined, 'stat');
  cell.append(node('strong', String(value)), node('span', title));
  return cell;
}
function renderGame() {
  const state = room.state;
  if (!state) { $('hint').textContent = 'Der Spieltisch bereitet das Brett vor …'; $('roll').disabled = true; return; }
  const me = state.players[seat];
  const mine = eligible();
  const actor = state.players[state.eventOpen ? state.eventActor : state.current];
  document.documentElement.style.setProperty('--color', colors[seat]);
  $('my-name').textContent = me.name;
  $('round').textContent = `RUNDE ${state.round}`;
  const stats = state.statistics?.[seat] || {};
  $('stats').replaceChildren(
    stat(me.pieces.filter(p => p >= 40).length + '/' + me.pieces.length, 'Figuren im Ziel'),
    stat(me.pieces.filter(p => p === -1).length, 'Im Haus'),
    stat(me.score, 'Ereignis-Counter / 32'),
    stat(stats.eyes || 0, 'Geworfene Augen'),
    stat(stats.rolls || 0, 'Würfe'),
    stat(stats.captures || 0, 'Geschlagen'),
    stat(stats.moves || 0, 'Gezogen'),
    stat(stats.turns || 0, 'Beendete Züge'),
    stat(stats.sentHome || 0, 'Zurück ins Haus'));
  $('turn').textContent = state.phase === 'over' ? `${state.players[state.winner]?.name || 'Die Runde'} gewinnt!`
    : mine ? 'Du bist dran!' : `${actor?.name || 'Spieltisch'} ist dran`;
  $('hint').textContent = me.eliminated ? 'Du bist ausgeschieden. Du kannst weiter zuschauen und noch offene Ereignisse bestätigen.'
    : !connected() || !room.hostConnected ? 'Verbindung fehlt. Eingaben sind gesperrt.'
    : state.eventOpen ? mine ? 'Bestätige jeden Ereignisschritt unten.' : 'Ein Ereignis wird am Spieltisch ausgespielt.'
    : pending || room.busy ? 'Bitte auf die Animation warten.'
    : mine ? state.phase === 'move' ? 'Wähle eine Figur und ihren Weg.' : 'Würfle per Button oder aktiviertem Schütteln.'
    : 'Dein persönliches Dashboard bleibt sichtbar, bis du dran bist.';
  const roll = state.lastRoll || state.rollData;
  $('dice').textContent = roll ? `${roll.values.join(' + ')}${roll.values.length > 1 ? ' = ' + roll.total : ' Augen'}` : 'Bereit?';
  $('effects').textContent = `D${state.sides || 6} · ${me.doubleTurns ? 'Zwei Würfel' : 'Ein Würfel'}${state.paths?.length ? ' · Sonderwege aktiv' : ''}`;
  $('roll').hidden = state.eventOpen || state.phase === 'over';
  $('roll').disabled = !mine || state.phase !== 'roll' || state.eventOpen;
  $('moves').replaceChildren();
  if (state.phase === 'move' && !state.eventOpen && state.current === seat) (state.legalMoves || []).forEach(move => {
    const path = move.branches?.length ? move.branches.map(b => b === 'shortcut' ? 'Abkürzung' : 'Umleitung').join(' + ') : 'Normaler Weg';
    const destination = move.destination >= 40 ? `Ziel ${move.destination - 39}` : `Feld ${(seat * 10 + move.destination) % 40 + 1}`;
    const button = node('button', `Figur ${move.piece + 1} · ${path} → ${destination}`);
    button.disabled = !mine;
    button.addEventListener('click', () => action('move', { piece: move.piece, destination: move.destination, ...(move.path ? { path: move.path } : {}) }));
    $('moves').append(button);
  });
  $('event').hidden = !state.eventOpen;
  $('event-title').textContent = state.eventTitle || 'Ereignis';
  $('event-description').textContent = state.eventDescription || '';
  $('event-result').textContent = state.eventResult || '';
  $('event-action').textContent = state.eventButton || 'Ereignis bestätigen';
  $('event-action').disabled = !mine;
  $('event-targets').replaceChildren(...(state.wheelCandidates || []).map((c, i) => node('p', `${i + 1}: ${state.players[c.player].name}, Figur ${c.piece + 1}`)));
  $('pieces').replaceChildren(...me.pieces.map((progress, i) => {
    const row = node('div', undefined, 'piece');
    row.append(node('strong', `Figur ${i + 1}`), node('span', me.eliminated ? 'Ausgeschieden' : progress === -1 ? 'Im Haus'
      : progress >= 40 ? `Ziel ${progress - 39}` : `Feld ${(seat * 10 + progress) % 40 + 1}`));
    return row;
  }));
  $('activity').replaceChildren(...(state.log || []).slice(0, 8).map(text => node('li', text)));
}
function render() {
  messageStatus();
  if (!room) return;
  $('join-form').hidden = true;
  $('room-label').textContent = `Raum ${room.code}`;
  $('lobby').hidden = room.status !== 'lobby';
  $('dashboard').hidden = room.status === 'lobby';
  if (room.status === 'lobby') renderLobby(); else renderGame();
}
function acceptRoom(next) {
  room = next;
  if (lobbyPending && (lobbyPending.type === 'start' ? room.status !== 'lobby'
    : room.mode === lobbyPending.mode && lobbyPending.seats.every(setting => room.seats.some(s => s.id === setting.id && s.kind === setting.kind)))) {
    lobbyFeedback = lobbyPending.type === 'configure' ? 'Einstellungen gespeichert.' : 'Partie gestartet.';
    lobbyPending = null;
  }
  // Never replay a command. Only a new stable server revision releases its local lock.
  if (pending && !room.busy && room.revision > pendingRevision) { pending = false; pendingRevision = null; }
  render();
}
function connect(request) {
  connection?.close();
  room = null; seat = null; pending = false; lobbyPending = null; lobbyFeedback = '';
  $('error').hidden = true;
  connection = new RoomConnection('player');
  connection.addEventListener('welcome', ({ detail }) => {
    seat = detail.seat;
    pending = false;
    $('error').hidden = true;
    acceptRoom(detail.room);
  });
  connection.addEventListener('room', ({ detail }) => acceptRoom(detail.room));
  connection.addEventListener('connection', ({ detail }) => {
    if (!detail.ready) {
      pending = false;
      if (lobbyPending) lobbyFeedback = 'Verbindung unterbrochen. Einstellungen oder Start werden nicht automatisch wiederholt.';
      lobbyPending = null;
    }
    render();
    $('connection').textContent = detail.message;
  });
  connection.addEventListener('error', ({ detail }) => {
    pending = false;
    if (lobbyPending) lobbyFeedback = detail.message;
    lobbyPending = null;
    error(`${detail.message} (${detail.code || 'Fehler'})`);
    render();
  });
  connection.connect(request);
}
function action(kind, fields = {}) {
  if (!eligible()) return;
  const state = room.state;
  if (kind === 'roll' && (state.phase !== 'roll' || state.eventOpen)) return;
  if (kind === 'event' && !state.eventOpen) return;
  pending = true;
  pendingRevision = room.revision;
  if (!connection.send({ type: 'action', action: kind, revision: room.revision, ...fields })) pending = false;
  render();
}
$('join-form').addEventListener('submit', event => {
  event.preventDefault();
  clearSession('player');
  connect({ type: 'join', code: $('code').value.trim().toUpperCase(), name: $('name').value.trim() });
});
$('configure').addEventListener('click', () => {
  if (!connected() || lobbyPending || room?.managerSeat !== seat || room.status !== 'lobby') return;
  const command = { type: 'configure', mode: $('mode').value,
    seats: [...document.querySelectorAll('[data-seat]')].filter(select => select.value !== 'human')
      .map(select => ({ id: Number(select.dataset.seat), kind: select.value })) };
  lobbyPending = command;
  lobbyFeedback = 'Einstellungen werden gespeichert …';
  if (!connection.send(command)) { lobbyPending = null; lobbyFeedback = 'Nicht verbunden. Einstellungen wurden nicht gesendet.'; }
  render();
});
$('start').addEventListener('click', () => {
  if (connected() && !lobbyPending && room?.managerSeat === seat && !$('start').disabled) {
    lobbyPending = { type: 'start' };
    lobbyFeedback = 'Partie wird gestartet …';
    if (!connection.send(lobbyPending)) { lobbyPending = null; lobbyFeedback = 'Nicht verbunden. Start wurde nicht gesendet.'; }
    render();
  }
});
$('roll').addEventListener('click', () => action('roll'));
$('event-action').addEventListener('click', () => action('event'));
$('rejoin').addEventListener('click', () => {
  connection?.close(); clearSession('player'); room = null; seat = null; pending = false; lobbyPending = null; lobbyFeedback = '';
  $('join-form').hidden = false; $('lobby').hidden = true; $('dashboard').hidden = true;
  $('room-label').textContent = 'Handy-Steuerung'; $('error').hidden = true;
  $('connection').textContent = 'Raumcode und Name eingeben. Alte Sitzung wurde gelöscht.';
});
function disableMotion() {
  motionEnabled = false; lastAcceleration = null; shakePeakAt = 0;
  window.removeEventListener('devicemotion', onMotion);
  $('shake').checked = false;
}
function onMotion(event) {
  if (!motionEnabled || !eligible() || room.state.phase !== 'roll' || room.state.eventOpen) { lastAcceleration = null; return; }
  const a = event.accelerationIncludingGravity;
  if (!a || ![a.x, a.y, a.z].every(Number.isFinite)) return;
  const now = Date.now();
  if (lastAcceleration) {
    const delta = Math.hypot(a.x - lastAcceleration.x, a.y - lastAcceleration.y, a.z - lastAcceleration.z);
    if (delta > 15 && now - shakeAt > 2500) {
      if (shakePeakAt && now - shakePeakAt < 700) { shakeAt = now; shakePeakAt = 0; action('roll'); }
      else shakePeakAt = now;
    }
  }
  lastAcceleration = { x: a.x, y: a.y, z: a.z };
}
$('shake').addEventListener('change', async () => {
  if (!$('shake').checked) { disableMotion(); $('motion-status').textContent = 'Schütteln deaktiviert. Würfelbutton bleibt verfügbar.'; return; }
  disableMotion();
  if (!isSecureContext) { $('motion-status').textContent = 'Schütteln benötigt HTTPS (oder localhost). Nutze den Würfelbutton.'; return; }
  if (!window.DeviceMotionEvent) { $('motion-status').textContent = 'Dieser Browser unterstützt keine Bewegungssensoren. Nutze den Würfelbutton.'; return; }
  try {
    if (typeof DeviceMotionEvent.requestPermission === 'function' && await DeviceMotionEvent.requestPermission() !== 'granted') {
      $('motion-status').textContent = 'Sensorberechtigung abgelehnt. Der Würfelbutton funktioniert weiterhin.'; return;
    }
    motionEnabled = true;
    $('shake').checked = true;
    window.addEventListener('devicemotion', onMotion);
    $('motion-status').textContent = 'Schütteln aktiv: zweimal kurz schütteln, nur bei deinem freigegebenen Würfelzug.';
  } catch { $('motion-status').textContent = 'Sensorzugriff nicht möglich. Nutze den Würfelbutton.'; }
});
window.addEventListener('offline', render);
window.addEventListener('online', render);
document.addEventListener('visibilitychange', () => { lastAcceleration = null; shakePeakAt = 0; render(); });
window.addEventListener('pagehide', () => { disableMotion(); });
if ('serviceWorker' in navigator && isSecureContext) {
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => error('App-Installation ist hier nicht verfügbar. Spielen im Browser bleibt möglich.'));
}
const queryCode = new URLSearchParams(location.search).get('room')?.toUpperCase();
if (queryCode) $('code').value = queryCode;
const session = readSession('player');
if (session && (!queryCode || queryCode === session.code)) connect({ type: 'resume', code: session.code, token: session.token });
