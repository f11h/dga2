import { Game, COLORS, COLOR_NAMES, EVENTS, eventProbability } from './game.js';
import { BoardScene } from './scene.js';
import { snapshot } from './animation.js';
import { SoundEffects } from './sound.js';
import qrcode from './node_modules/qrcode-generator/dist/qrcode.mjs';
import { RoomConnection, readSession, clearSession, joinURL, restoreEngine, wirePhase } from './network.js';

const $ = id => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const pipPositions = {
  1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8]
};
let game = new Game();
let started = false;
let busy = false;
let lastRoll = null;
let winnerShown = false;
let eventResolved = false;
let wheelCandidates = [];
let wheelRotation = 0;
let computerTimer = null;
let eventComputer = false;
let eventStage = 'select';
let scene = null;
let graphicsFailed = false;
let selectedPiece = null;
const sounds = new SoundEffects();
const diceHome = $('dice-stage').parentElement;
const diceAnchor = $('dice-stage').nextElementSibling;
let announcedTurn = null;
const fullscreenButton = $('fullscreen-toggle');
let fullscreenBusy = false;
let online = false;
let room = null;
let network = null;
let eventActor = null;
let statistics = emptyStatistics();
let published = '';
function emptyStatistics() {
  return COLORS.map(() => ({ rolls: 0, eyes: 0, moves: 0, captures: 0, turns: 0, sentHome: 0 }));
}
function onlineAvailable() {
  return !online || (network?.ready && room?.hostConnected && room.seats.every(seat => seat.kind !== 'human' || seat.connected));
}
function publishState() {
  if (!online || !started || !network?.ready) return;
  const engine = JSON.parse(JSON.stringify(game));
  const state = { ...engine, phase: wirePhase(game.phase, $('event-dialog').open),
    engine, sides: game.sides(), legalMoves: game.legalMoves(), lastRoll, statistics,
    eventActor, eventOpen: $('event-dialog').open, eventStage, eventResolved, wheelCandidates,
    eventTitle: $('event-title').textContent, eventDescription: $('event-description').textContent,
    eventResult: $('event-result').textContent, eventButton: $('event-confirm').textContent,
    eventSymbol: $('event-symbol').textContent, eventSource: $('event-source').textContent };
  const message = { type: 'state', state, busy: busy || graphicsFailed || !onlineAvailable() };
  const serialized = JSON.stringify(message);
  if (serialized !== published && network.send(message)) published = serialized;
}
function recordTransition(before, actor, { capture = false } = {}) {
  if (before.current !== game.current || (before.phase !== 'over' && game.phase === 'over')) statistics[actor].turns++;
  before.players.forEach(player => player.pieces.forEach((progress, piece) => {
    if (progress >= 0 && game.players[player.id].pieces[piece] === -1) {
      statistics[player.id].sentHome++;
      if (capture && player.id !== actor) statistics[actor].captures++;
    }
  }));
}
function eventShow() { if (online) $('event-dialog').show(); else $('event-dialog').showModal(); }
function updateConnectionBanner() {
  const disconnected = online && (!network?.ready || (started && !onlineAvailable()));
  $('connection-banner').hidden = !disconnected;
  $('connection-banner').textContent = network?.terminalMessage || (!network?.ready ? 'Verbindung zum Server unterbrochen. Partie pausiert; erneute Verbindung läuft.'
    : !room?.hostConnected ? 'Spieltisch nicht verbunden. Partie pausiert.' : 'Ein Handy ist getrennt. Partie pausiert, bis alle wieder verbunden sind.');
}
function restoreOnlineState(state) {
  game = restoreEngine(Game, state);
  lastRoll = state.lastRoll;
  statistics = state.statistics || emptyStatistics();
  eventActor = state.eventActor;
  eventStage = state.eventStage || 'select';
  eventResolved = !!state.eventResolved;
  wheelCandidates = state.wheelCandidates || [];
  eventComputer = game.players[eventActor ?? game.current].controller === 'computer';
  busy = false;
  started = true;
  winnerShown = false;
  scene?.newGame();
  if (state.eventOpen) {
    for (const [id, value] of Object.entries({ 'event-title': state.eventTitle, 'event-description': state.eventDescription,
      'event-result': state.eventResult, 'event-confirm': state.eventButton, 'event-symbol': state.eventSymbol, 'event-source': state.eventSource })) {
      $(id).textContent = value || '';
    }
    $('wheel-container').hidden = false;
    if (eventStage === 'select' || !wheelCandidates.length) setupEventWheel(); else setupWheel(wheelCandidates);
    $('event-confirm').disabled = true;
    eventShow();
  }
}
function receiveRoom(next) {
  room = next;
  $('room-code').textContent = room.code;
  $('room-seats').replaceChildren(...room.seats.map(seat => html('li', '', `${COLOR_NAMES[seat.id]}: ${seat.name} · ${seat.kind === 'human' ? seat.connected ? 'verbunden' : 'getrennt' : seat.kind === 'computer' ? 'KI' : 'unbenutzt'}`)));
  document.body.classList.toggle('online-playing', room.status === 'playing' || (room.status === 'finished' && room.state?.eventOpen));
  $('room-lobby').hidden = room.status !== 'lobby';
  $('create-room').hidden = room.status !== 'finished' || room.state?.eventOpen;
  $('create-room').textContent = room.status === 'finished' ? 'Neue Internet-Lobby erstellen' : 'Internet-Lobby erstellen';
  $('network-status').textContent = room.status === 'lobby' ? 'Lobby bereit. Das erste Handy verwaltet die Partie.' : `Raum ${room.code} · Eingaben ausschließlich auf den Handys`;
  $('network-status').hidden = false;
  updateConnectionBanner();
  if (room.status !== 'lobby' && !started) {
    if (room.state) {
      try { restoreOnlineState(room.state); }
      catch (error) {
        $('network-error').hidden = false;
        $('network-error').textContent = `Wiederaufnahme nicht möglich: ${error.message} Bitte eine neue Lobby erstellen.`;
        network.close();
        $('create-room').hidden = false;
        document.body.classList.remove('online-playing');
        updateConnectionBanner();
        return;
      }
    }
    else {
      game = new Game({ names: room.seats.map(s => s.name), controllers: room.seats.map(s => s.kind), mode: room.mode });
      started = true;
      statistics = emptyStatistics();
      lastRoll = null;
      scene?.newGame();
      sounds.play('start');
    }
    render();
    showPending();
  } else if (started && !busy) {
    publishState();
    showPending();
  }
}
function startConnection(request) {
  cancelComputerAction();
  network?.close();
  online = true;
  started = false;
  busy = false;
  room = null;
  published = '';
  winnerShown = false;
  eventActor = null;
  eventResolved = false;
  eventStage = 'select';
  wheelCandidates = [];
  announcedTurn = null;
  selectedPiece = null;
  lastRoll = null;
  document.body.classList.add('online-host');
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  network = new RoomConnection('host');
  network.addEventListener('connection', ({ detail }) => {
    $('network-status').hidden = false;
    $('network-status').textContent = detail.message;
    updateConnectionBanner();
    if (!detail.ready) cancelComputerAction();
  });
  network.addEventListener('error', ({ detail }) => {
    $('network-error').hidden = false;
    $('network-error').textContent = `${detail.message} (${detail.code || 'Fehler'})`;
    if (network.terminalMessage) {
      document.body.classList.remove('online-playing');
      $('create-room').hidden = false;
      $('create-room').disabled = busy || graphicsFailed;
    }
  });
  network.addEventListener('welcome', ({ detail }) => {
    $('network-error').hidden = true;
    published = '';
    const url = joinURL(detail.code);
    $('room-link').href = url;
    $('room-link').textContent = url;
    const localOrigin = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    $('room-origin-warning').hidden = !localOrigin;
    $('room-origin-warning').textContent = 'Dieser Link verwendet localhost und ist auf anderen Handys nicht erreichbar. Öffne den Spieltisch über seine LAN-Adresse oder öffentliche HTTPS-Adresse und erstelle dort die Lobby.';
    const qr = qrcode(0, 'M');
    qr.addData(url); qr.make();
    $('room-qr').innerHTML = qr.createSvgTag({ scalable: true, margin: 4 });
    receiveRoom(detail.room);
  });
  network.addEventListener('room', ({ detail }) => receiveRoom(detail.room));
  network.addEventListener('action', async ({ detail }) => {
    if (!onlineAvailable() || busy || graphicsFailed || !started || detail.revision !== room.revision) {
      published = ''; publishState(); return;
    }
    const actor = $('event-dialog').open ? eventActor : game.current;
    if (actor !== detail.seat || game.players[actor].controller !== 'human') { published = ''; publishState(); return; }
    try {
      if (detail.action === 'event' && $('event-dialog').open) await confirmEvent(false, true);
      else if (detail.action === 'roll' && game.phase === 'roll') await rollDice(false, true);
      else if (detail.action === 'move' && game.phase === 'move') {
        const option = game.legalMoves().find(move => move.piece === detail.piece && move.destination === detail.destination &&
          (!detail.path || (move.path?.length === detail.path.length && move.path.every((step, i) => step === detail.path[i]))));
        if (option) await movePiece(option.piece, false, option.path ?? null, true);
      }
    } catch (error) {
      $('network-error').hidden = false;
      $('network-error').textContent = `Spielaktion fehlgeschlagen: ${error.message}`;
    } finally { published = ''; publishState(); }
  });
  network.connect(request);
}
$('create-room').addEventListener('click', () => {
  if (graphicsFailed || busy) return;
  clearSession('host');
  startConnection({ type: 'create' });
});
$('local-mode').addEventListener('click', () => {
  if (busy) return;
  network?.close();
  clearSession('host');
  online = false; room = null; started = false; busy = false;
  game = new Game();
  lastRoll = null;
  statistics = emptyStatistics();
  winnerShown = false;
  document.body.classList.remove('online-host', 'online-playing');
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  $('create-room').hidden = false;
  $('room-lobby').hidden = true;
  $('network-status').hidden = true;
  $('network-error').hidden = true;
  $('connection-banner').hidden = true;
  render();
  openSetup();
});
$('copy-room').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('room-link').href); $('copy-room').textContent = 'Link kopiert'; }
  catch { $('copy-room').textContent = 'Bitte den angezeigten Link manuell kopieren'; }
});
function updateFullscreen() {
  const active = document.fullscreenElement === document.documentElement;
  fullscreenButton.textContent = active ? 'Vollbild verlassen' : 'Vollbild';
  fullscreenButton.setAttribute('aria-pressed', String(active));
  fullscreenButton.disabled = fullscreenBusy || !document.fullscreenEnabled;
  fullscreenButton.title = document.fullscreenEnabled ? 'Vollbild umschalten; Esc zum Verlassen'
    : 'Dieser Browser unterstützt den Vollbildmodus hier nicht.';
}
fullscreenButton.addEventListener('click', async () => {
  if (fullscreenBusy || !document.fullscreenEnabled) return;
  fullscreenBusy = true;
  $('fullscreen-error').hidden = true;
  updateFullscreen();
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (error) {
    $('fullscreen-error').textContent = 'Vollbild konnte nicht umgeschaltet werden. Bitte die Vollbild-Berechtigung des Browsers prüfen.';
    $('fullscreen-error').hidden = false;
    console.warn('Vollbild konnte nicht umgeschaltet werden:', error);
  } finally {
    fullscreenBusy = false;
    updateFullscreen();
  }
});
document.addEventListener('fullscreenchange', updateFullscreen);
updateFullscreen();
const unlockSound = () => {
  void sounds.unlock().catch(error => {
    sounds.setEnabled(false);
    $('sound-toggle').textContent = 'Ton nicht verfügbar';
    $('sound-toggle').disabled = true;
    console.warn('Audio konnte nicht aktiviert werden:', error);
  });
};
document.addEventListener('pointerdown', unlockSound);
document.addEventListener('keydown', unlockSound);
document.addEventListener('click', event => {
  if (event.target.closest('button') && !event.target.closest('#sound-toggle')) sounds.play('click');
});
$('sound-toggle').disabled = !sounds.supported;
if (!sounds.supported) $('sound-toggle').textContent = 'Ton nicht unterstützt';
$('sound-toggle').addEventListener('click', () => {
  sounds.setEnabled(!sounds.enabled);
  $('sound-toggle').setAttribute('aria-pressed', String(sounds.enabled));
  $('sound-toggle').textContent = sounds.enabled ? 'Ton an' : 'Ton aus';
  if (sounds.enabled) { unlockSound(); sounds.play('click'); }
});

try {
  scene = new BoardScene($('board'), piece => movePiece(piece), name => sounds.play(name));
} catch (error) {
  graphicsFailed = true;
  $('webgl-error').hidden = false;
  $('webgl-error').textContent = 'Die 3D-Spielansicht benötigt WebGL. Bitte Hardwarebeschleunigung aktivieren oder einen aktuellen Browser verwenden. Das Spiel kann hier nicht gestartet werden.';
  $('board').hidden = true;
  $('scene-caption').hidden = true;
  $('camera-reset').disabled = true;
  $('setup-form').querySelector('[type="submit"]').disabled = true;
  console.warn('3D-Spielansicht nicht verfügbar:', error);
}
$('board').addEventListener('webglcontextlost', () => {
  graphicsFailed = true;
  cancelComputerAction();
  $('board').hidden = true;
  $('webgl-error').hidden = false;
  $('webgl-error').textContent = 'Die 3D-Grafikverbindung wurde unterbrochen. Bitte die Seite neu laden. Eine Internetpartie wird aus ihrem letzten Server-Spielstand wiederaufgenommen.';
  $('scene-caption').hidden = true;
  $('camera-reset').disabled = true;
  $('setup-form').querySelector('[type="submit"]').disabled = true;
  render();
});
$('camera-reset').addEventListener('click', () => {
  const overview = scene?.reset();
  $('camera-reset').setAttribute('aria-pressed', String(!!overview));
  $('camera-reset').textContent = overview ? '↗ Kamera folgen' : '⊙ Übersicht';
});
window.addEventListener('pagehide', event => {
  cancelComputerAction();
  if (!event.persisted) { scene?.dispose(); sounds.dispose(); }
});
window.addEventListener('pageshow', event => { if (event.persisted) showPending(); });

function isComputerTurn() {
  return game.players[game.current].controller === 'computer';
}

function cancelComputerAction() {
  clearTimeout(computerTimer);
  computerTimer = null;
}

function scheduleComputerAction() {
  cancelComputerAction();
  if (!started || busy || graphicsFailed || !onlineAvailable()) return;
  let action;
  let delay = 650;
  // Event ownership stays with its actor, even after elimination or a turn change.
  if ($('event-dialog').open) {
    if (!eventComputer) return;
    action = () => confirmEvent(true);
    delay = eventResolved ? 1500 : 1100;
  } else {
    if (anyDialogOpen() || game.pendingTrain || game.phase === 'over' || !isComputerTurn()) return;
    if (game.phase === 'roll') action = () => rollDice(true);
    else if (game.phase === 'move') action = () => {
      const option = game.chooseComputerOption();
      return movePiece(option.piece, true, option.path);
    };
    else return;
  }
  const scheduledGame = game;
  computerTimer = setTimeout(() => {
    computerTimer = null;
    if (game !== scheduledGame || busy || !onlineAvailable()) return;
    action();
  }, reducedMotion.matches ? 80 : delay);
}

function html(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderBoard() {
  const movable = !busy && !isComputerTurn() && onlineAvailable() ? game.legalMoves().map(move => move.piece) : [];
  scene?.sync(snapshot(game), graphicsFailed ? [] : movable, { numberedMoves: online, interactive: !online });
  if (!busy) scene?.idle();
}

function faceContent(face, value, numeric) {
  face.replaceChildren();
  if (numeric) {
    face.textContent = value;
    return;
  }
  const grid = html('span', 'pip-grid');
  for (let i = 0; i < 9; i++) {
    const pip = html('i', pipPositions[value].includes(i) ? 'pip' : '');
    grid.append(pip);
  }
  face.append(grid);
}

function renderDice(values, sides, rolling = false) {
  $('dice-stage').replaceChildren();
  values.forEach((value, index) => {
    const shell = html('div', 'die-shell');
    shell.style.transform = `rotate(${index ? 9 : -8}deg)`;
    const die = html('div', 'die' + (rolling ? ' rolling' : ''));
    die.setAttribute('aria-hidden', 'true');
    ['front', 'back', 'right', 'left', 'top', 'bottom'].forEach((direction, faceIndex) => {
      const face = html('div', 'die-face ' + direction);
      const faceValue = faceIndex === 0 ? value : sides === 6 ? [value, 7 - value, 3, 4, 2, 5][faceIndex] : 1 + (value + faceIndex) % sides;
      faceContent(face, faceValue, sides !== 6);
      die.append(face);
    });
    shell.append(die, html('span', 'die-type', `D${sides}`));
    $('dice-stage').append(shell);
  });
  $('dice-stage').setAttribute('aria-label', rolling ? 'Die Würfel rollen.' : `Würfelergebnis: ${values.join(' und ')}. ${sides} Seiten.`);
}

function renderPlayers() {
  $('players').replaceChildren();
  game.players.forEach(player => {
    const highlighted = game.phase === 'over' ? game.winner : game.current;
    const card = html('div', `player-card${player.id === highlighted ? ' active' : ''}${player.eliminated ? ' eliminated' : ''}${player.absent ? ' absent' : ''}`);
    card.style.setProperty('--card-color', player.color);
    const row = html('div', 'player-row');
    const goalsCount = player.pieces.filter(progress => progress >= 40).length;
    const miniature = html('span', 'mini-pieces');
    if (!player.absent) {
      for (let i = 0; i < player.pieces.length; i++) miniature.append(html('i', i < goalsCount ? 'finished' : ''));
      miniature.setAttribute('aria-label', `${goalsCount} von ${player.pieces.length} Figuren im Ziel`);
    }
    const status = player.absent ? 'Nicht dabei' : player.eliminated ? 'Ausgeschieden' : player.doubleTurns || player.pendingDouble ? `2 Würfel · ${Math.max(player.doubleTurns, player.pendingDouble)} Züge` : `${goalsCount}/${player.pieces.length} im Ziel`;
    row.append(html('span', 'player-dot'), html('span', 'player-name', player.name));
    if (!player.absent && player.controller === 'computer') row.append(html('span', 'controller-badge', 'KI'));
    row.append(html('span', 'player-status', status));
    if (!player.absent) row.append(miniature);
    card.append(row);
    if (game.mode === 'events' && !player.absent) {
      const counter = html('div', 'counter-row');
      const meter = html('div', 'counter-track');
      meter.setAttribute('role', 'meter');
      meter.setAttribute('aria-label', `${player.name}: Augenzahlen-Counter`);
      meter.setAttribute('aria-valuemin', '0');
      meter.setAttribute('aria-valuemax', '32');
      meter.setAttribute('aria-valuenow', String(player.score));
      const fill = html('div', 'counter-fill');
      fill.style.width = `${player.score / 32 * 100}%`;
      meter.append(fill);
      const number = html('span', 'counter-number');
      number.append(html('strong', '', String(player.score)), ' / 32');
      counter.append(meter, number);
      card.append(counter);
    }
    $('players').append(card);
  });
  const computers = game.players.filter(player => !player.absent && player.controller === 'computer').length;
  const humans = game.players.filter(player => !player.absent && player.controller === 'human').length;
  $('players-summary').textContent = computers === 0 ? `${humans} MENSCHEN · LOKAL`
    : humans === 0 ? `${computers} KI · ZUSCHAUEN`
    : `${humans} MENSCH${humans === 1 ? '' : 'EN'} · ${computers} KI`;
  $('counter-note').hidden = game.mode !== 'events';
}

function render() {
  $('create-room').disabled = graphicsFailed || busy;
  $('local-mode').disabled = busy;
  if (started && !busy && game.phase !== 'over' && announcedTurn !== game.current) {
    if (announcedTurn !== null) sounds.play('turn');
    announcedTurn = game.current;
  }
  const player = game.players[game.phase === 'over' ? game.winner : game.current];
  const tvDice = online && started;
  $('tv-display').hidden = !tvDice;
  const diceParent = tvDice ? $('tv-dice-slot') : diceHome;
  if ($('dice-stage').parentElement !== diceParent) {
    if (tvDice) diceParent.append($('dice-stage'));
    else diceParent.insertBefore($('dice-stage'), diceAnchor);
  }
  $('tv-turn').textContent = game.phase === 'over' ? `${player.name} gewinnt!` : `${player.name} ist dran`;
  $('tv-roll').textContent = lastRoll ? `${lastRoll.values.join(' + ')}${lastRoll.values.length > 1 ? ' = ' + lastRoll.total : ' Augen'}` : 'Bereit zum Würfeln';
  $('tv-status').textContent = busy ? 'Animation läuft …' : game.phase === 'events' ? 'Ereignis auf dem Handy bestätigen'
    : isComputerTurn() ? 'KI spielt automatisch' : game.phase === 'move' ? 'Figur auf dem Handy auswählen' : 'Auf dem Handy würfeln';
  document.documentElement.style.setProperty('--player', player.color);
  $('current-orb').style.background = player.color;
  $('turn-label').textContent = game.phase === 'over' ? 'GEWONNEN' : isComputerTurn() ? 'KI AM ZUG' : 'AM ZUG';
  $('turn-title').textContent = player.name;
  $('turn-number').textContent = String(player.id + 1).padStart(2, '0');
  $('round-label').textContent = `RUNDE ${String(game.round).padStart(2, '0')}`;
  $('mode-badge').textContent = game.mode === 'events' ? '✦ Ereignismodus' : '⚄ Klassischer Modus';
  $('event-legend').hidden = game.mode !== 'events';
  const moves = game.legalMoves();
  $('new-game').disabled = graphicsFailed || busy || game.phase === 'events';
  $('rules-button').disabled = busy;
  $('turn-hint').textContent = graphicsFailed ? 'Die 3D-Spielansicht ist nicht verfügbar. Bitte den Hinweis am Brett beachten.'
    : busy ? 'Animation läuft. Gleich geht es weiter.'
    : game.phase === 'over' ? 'Die Partie ist entschieden. Zeit für eine Revanche.'
    : game.phase === 'events' ? 'Ein Ereignis mischt die Runde auf.'
    : isComputerTurn() ? `${player.name} ${game.phase === 'move' ? 'wählt eine Figur' : 'würfelt gleich'} automatisch.`
    : game.phase === 'move' ? selectedPiece !== null ? 'Abzweigung: Wähle unten den Weg für deine Figur.' : `${game.rollData.total} Augen. Wähle eine leuchtende Figur.`
    : game.attempts > 0 ? `Noch ${3 - game.attempts} Versuch${game.attempts === 2 ? '' : 'e'}, um auszuziehen.`
    : player.pieces.every(progress => progress === -1) ? 'Bring deine erste Figur ins Spiel.'
    : 'Dein Zug. Vielleicht gehört das Glück dir.';
  $('roll-button').disabled = graphicsFailed || !started || busy || game.pendingTrain || game.phase !== 'roll' || isComputerTurn();
  if (online) $('roll-button').disabled = true;
  $('roll-button').replaceChildren(html('span', '', '⚄'), busy ? 'Würfelt …' : game.phase === 'over' ? 'Partie beendet' : isComputerTurn() ? 'KI spielt automatisch' : game.phase === 'move' ? 'Figur auswählen' : 'Würfeln');
  if (!isComputerTurn()) $('roll-button').append(html('kbd', '', 'Leertaste'));
  $('dice-info').textContent = game.phase === 'over' ? 'Der letzte Wurf' : `${player.doubleTurns > 0 ? 'Zwei Würfel' : 'Ein Würfel'} · ${game.sides()} Seiten`;
  $('dice-total').textContent = lastRoll ? `${lastRoll.values.join(' + ')}${lastRoll.values.length > 1 ? ' = ' + lastRoll.total : ' Augen'}` : 'Bereit?';
  if (!busy) {
    const readyForNextTurn = game.phase === 'roll' && !game.rollData;
    renderDice(readyForNextTurn ? Array(player.doubleTurns > 0 ? 2 : 1).fill(1) : lastRoll?.values || [1],
      readyForNextTurn ? game.sides() : lastRoll?.sides || game.sides());
  }
  $('move-options').replaceChildren();
  if (!graphicsFailed && !busy && !isComputerTurn()) moves.filter(move => selectedPiece === null || move.piece === selectedPiece).forEach(move => {
    const choices = moves.filter(option => option.piece === move.piece);
    const routeName = move.branches?.length ? move.branches.map(kind => kind === 'shortcut' ? 'Abkürzung' : 'Umleitung').join(' + ') : 'Normaler Weg';
    const destination = move.destination >= 40 ? `Ziel ${move.destination - 39}` : `Feld ${(game.position(player.id, move.destination) ?? 0) + 1}`;
    const label = choices.length > 1 ? `Figur ${move.piece + 1}: ${routeName} → ${destination}`
      : `Figur ${move.piece + 1} ${player.pieces[move.piece] === -1 ? '↗ ausziehen' : '→ ziehen'}`;
    const button = html('button', 'move-option', label);
    button.addEventListener('click', () => movePiece(move.piece, false, move.path));
    $('move-options').append(button);
  });
  if (selectedPiece !== null && !busy && game.phase === 'move') {
    const back = html('button', 'move-option', 'Andere Figur wählen');
    back.addEventListener('click', () => { selectedPiece = null; render(); });
    $('move-options').append(back);
  }
  const effects = [];
  if (game.diceEffect && game.phase !== 'over') {
    const remaining = game.players.filter(other => !other.absent && !other.eliminated)
      .map(other => `${other.name}: ${game.diceEffect.remaining[other.id]}`);
    effects.push(`D${game.diceEffect.sides} für alle · verbleibende Züge: ${remaining.join(' · ')}`);
  }
  if (player.doubleTurns && game.phase !== 'over') effects.push(`Zwei Würfel: Summe ziehen, Sechserpasch zum Ausziehen.`);
  if (game.paths.length) effects.push('Neue Wege: Grün = Abkürzung, Orange = Umleitung. An Abzweigungen den Weg über die Figuren-Buttons wählen.');
  $('effect-banner').hidden = !effects.length;
  $('effect-banner').textContent = effects.join(' ');
  renderBoard();
  renderPlayers();
  $('activity').replaceChildren(...game.log.slice(0, 12).map(text => html('li', '', text)));
  $('board-hint').textContent = game.phase !== 'over' && isComputerTurn() ? 'Die KI spielt automatisch.'
    : game.phase === 'move' ? 'Leuchtende Figur auswählen.' : 'Würfeln. Ziehen. Daumen drücken.';
  publishState();
}

async function rollDice(automatic = false, remote = false) {
  if ((online && !automatic && !remote) || !onlineAvailable()) return;
  if (graphicsFailed || !started || busy || game.pendingTrain || game.phase !== 'roll' || anyDialogOpen() || (isComputerTurn() && !automatic)) return;
  cancelComputerAction();
  busy = true;
  selectedPiece = null;
  sounds.play('roll');
  const count = game.players[game.current].doubleTurns > 0 ? 2 : 1;
  const sides = game.sides();
  render();
  renderDice(Array(count).fill(1), sides, true);
  // Cosmetic values do not consume the game engine's random draws.
  const interval = setInterval(() => {
    document.querySelectorAll('.die').forEach(die => {
      die.querySelectorAll('.die-face').forEach(face => faceContent(face, 1 + Math.floor(Math.random() * sides), sides !== 6));
    });
  }, 90);
  try {
    await sleep(reducedMotion.matches ? 50 : 1120);
    if (!graphicsFailed) {
      const before = { ...snapshot(game), phase: game.phase };
      const actor = game.current;
      lastRoll = game.roll();
      statistics[actor].rolls++;
      statistics[actor].eyes += lastRoll.total;
      recordTransition(before, actor);
      publishState();
      sounds.play('result');
    }
  } finally {
    clearInterval(interval);
    busy = false;
  }
  render();
  showPending();
}

async function movePiece(piece, automatic = false, path = null, remote = false) {
  if ((online && !automatic && !remote) || !onlineAvailable()) return;
  if (graphicsFailed || busy || anyDialogOpen() || game.phase !== 'move' || (isComputerTurn() && !automatic)) return;
  cancelComputerAction();
  const options = game.legalMoves().filter(option => option.piece === piece);
  if (!automatic && path === null && options.length > 1) {
    selectedPiece = piece;
    sounds.play('click');
    render();
    $('move-options').querySelector('button')?.focus();
    return;
  }
  const before = { ...snapshot(game), phase: game.phase };
  const player = game.current;
  busy = true;
  render();
  try {
    const option = game.move(piece, path);
    statistics[player].moves++;
    recordTransition(before, player, { capture: true });
    publishState();
    await scene.move(before, snapshot(game), player, piece, option.path);
  } finally {
    busy = false;
    selectedPiece = null;
  }
  render();
  showPending();
}

function anyDialogOpen() {
  return [...document.querySelectorAll('dialog')].some(dialog => dialog.open);
}

function showPending() {
  if (graphicsFailed || busy || !onlineAvailable()) return;
  if (anyDialogOpen()) {
    scheduleComputerAction();
    return;
  }
  if (game.pendingTrain && game.phase !== 'over') {
    void runTrain();
    return;
  }
  if (game.phase === 'events') {
    showEvent();
  } else if (game.phase === 'over' && !winnerShown) {
    winnerShown = true;
    sounds.play('winner');
    const winner = game.players[game.winner];
    $('winner-title').textContent = `${winner.name} gewinnt!`;
    $('winner-description').textContent = winner.pieces.every(progress => progress >= 40)
      ? `${winner.pieces.length} Figuren im Ziel. Starke Nerven, gute Würfel. Und vielleicht ein bisschen Schadenfreude.`
      : 'Als letzte Person im Spiel holst du dir den Sieg. Das Chaos hat gesprochen.';
    $('winner-dialog').classList.add('winner-confetti');
    if (!online) $('winner-dialog').showModal();
  }
  scheduleComputerAction();
}

async function runTrain() {
  cancelComputerAction();
  busy = true;
  const before = { ...snapshot(game), phase: game.phase };
  render();
  try {
    const result = game.resolveTrain();
    recordTransition(before, game.current);
    publishState();
    await scene.train(before, snapshot(game), result);
  } finally {
    busy = false;
  }
  render();
  showPending();
}

function setupEventWheel() {
  const wheel = $('wheel');
  wheel.replaceChildren();
  wheel.style.transform = 'rotate(0deg)';
  wheelRotation = 0;
  let offset = 0;
  const stops = [];
  $('wheel-labels').replaceChildren();
  EVENTS.forEach((event, index) => {
    const size = eventProbability(event) * 360;
    const color = event.id === 'lose' ? '#ec6666' : COLORS[index % COLORS.length];
    stops.push(`${color} ${offset}deg ${offset + size}deg`);
    if (eventProbability(event) > .01) {
      const number = html('span', 'wheel-number', String(index + 1));
      const angle = offset + size / 2;
      number.style.transform = `rotate(${angle}deg) translateY(-75px) rotate(${-angle}deg)`;
      wheel.append(number);
    }
    const label = html('span', '', `${index + 1}: ${event.title} (${(eventProbability(event) * 100).toFixed(2)} %)`);
    $('wheel-labels').append(label);
    offset += size;
  });
  wheel.style.background = `conic-gradient(${stops.join(',')})`;
  wheel.setAttribute('aria-label', 'Ereignis-Glücksrad: Ausscheiden und Spitzenreiter zurück ins Haus jeweils 1 Prozent, alle übrigen Ereignisse gleich wahrscheinlich.');
}

async function spinWheel(angle) {
  sounds.play('wheel');
  wheelRotation = 360 * 6 + 360 - angle;
  const animation = $('wheel').animate(
    [{ transform: 'rotate(0deg)' }, { transform: `rotate(${wheelRotation}deg)` }],
    { duration: reducedMotion.matches ? 50 : 3800, easing: 'cubic-bezier(.15,.72,.13,1)', fill: 'forwards' }
  );
  try {
    await animation.finished;
    $('wheel').style.transform = `rotate(${wheelRotation}deg)`;
  } finally { animation.cancel(); }
}

function setupWheel(candidates) {
  const wheel = $('wheel');
  wheel.replaceChildren();
  wheel.style.transform = 'rotate(0deg)';
  wheelRotation = 0;
  $('wheel-labels').replaceChildren();
  const slice = 360 / candidates.length;
  const stops = candidates.map((candidate, index) => `${COLORS[candidate.player]} ${index * slice}deg ${(index + 1) * slice}deg`);
  wheel.style.background = `conic-gradient(${stops.join(',')})`;
  candidates.forEach((candidate, index) => {
    const number = html('span', 'wheel-number', String(index + 1));
    const angle = (index + .5) * slice;
    number.style.transform = `rotate(${angle}deg) translateY(-75px) rotate(${-angle}deg)`;
    wheel.append(number);
    const label = html('span');
    const dot = html('i');
    dot.style.background = COLORS[candidate.player];
    label.append(dot, `${index + 1}: ${game.players[candidate.player].name} · F${candidate.piece + 1}`);
    $('wheel-labels').append(label);
  });
}

function showEvent() {
  const event = game.queue[0];
  eventResolved = false;
  eventStage = 'select';
  eventActor = event.actor;
  sounds.play('event');
  eventComputer = game.players[event.actor].controller === 'computer';
  $('event-source').textContent = `${game.players[event.actor].name} · ${event.source}`.toLocaleUpperCase('de');
  $('event-symbol').textContent = '✦';
  $('event-title').textContent = 'Welches Ereignis wird es?';
  $('event-description').textContent = 'Drehe das Glücksrad! Ausscheiden und „Spitzenreiter, umkehren!“ haben jeweils nur 1 % Chance; alle anderen Ereignisse sind gleich wahrscheinlich.';
  $('event-result').textContent = '';
  $('event-confirm').disabled = eventComputer;
  wheelCandidates = [];
  $('wheel-container').hidden = false;
  setupEventWheel();
  $('event-confirm').textContent = 'Ereignis-Glücksrad drehen';
  eventShow();
  publishState();
}

async function confirmEvent(automatic = false, remote = false) {
  if ((online && !automatic && !remote) || !onlineAvailable()) return;
  if (graphicsFailed || busy || !$('event-dialog').open || (eventComputer && !automatic)) return;
  cancelComputerAction();
  if (eventResolved) {
    $('event-dialog').close();
    render();
    showPending();
    return;
  }
  busy = true;
  $('event-confirm').disabled = true;
  publishState();
  if (eventStage === 'select') {
    const event = game.queue[0];
    let offset = 0;
    for (const candidate of EVENTS) {
      if (candidate.id === event.id) break;
      offset += eventProbability(candidate) * 360;
    }
    try {
      await spinWheel(offset + eventProbability(event) * 180);
      $('event-symbol').textContent = event.icon;
      $('event-title').textContent = event.title;
      $('event-description').textContent = event.description;
      $('event-result').textContent = `Ausgewählt: ${event.title}`;
      eventStage = 'apply';
      wheelCandidates = event.id === 'rocket' ? game.eventCandidates() : [];
      if (wheelCandidates.length) setupWheel(wheelCandidates);
      $('event-confirm').textContent = wheelCandidates.length ? 'Raketen-Ziel auslosen' : 'Ereignis auslösen →';
    } finally { busy = false; }
    $('event-confirm').disabled = eventComputer;
    publishState();
    scheduleComputerAction();
    return;
  }
  const before = { ...snapshot(game), phase: game.phase };
  const result = game.resolveEvent();
  recordTransition(before, eventActor);
  // Persist the applied engine before animation, so reload cannot apply an event twice.
  eventResolved = true;
  eventStage = 'result';
  $('event-result').textContent = result.detail || 'Das Brett wurde aktualisiert. Weiter geht’s!';
  $('event-confirm').textContent = 'Weiter am Spieltisch →';
  publishState();
  if (result.target && wheelCandidates.length) {
    const index = wheelCandidates.findIndex(candidate => candidate.player === result.target.player && candidate.piece === result.target.piece);
    const angle = (index + .5) * 360 / wheelCandidates.length;
    await spinWheel(angle);
  }
  // Hide the modal so the board's event choreography remains fully visible.
  $('event-dialog').close();
  try {
    await scene.event(before, snapshot(game), result);
  } finally {
    busy = false;
  }
  if (graphicsFailed) return;
  eventShow();
  $('event-result').textContent = result.detail || 'Das Brett wurde aktualisiert. Weiter geht’s!';
  if (result.target) $('event-symbol').textContent = '✹';
  busy = false;
  eventResolved = true;
  $('event-confirm').disabled = eventComputer;
  $('event-confirm').textContent = 'Weiter am Spieltisch →';
  render();
  scheduleComputerAction();
}

function openSetup() {
  if (online || graphicsFailed || busy || game.phase === 'events') return;
  cancelComputerAction();
  $('setup-cancel').hidden = !started;
  $('setup-dialog').showModal();
}

COLORS.forEach((color, index) => {
  const field = html('div', 'name-field');
  field.style.setProperty('--card-color', color);
  const label = html('label', 'name-field');
  const caption = html('span');
  caption.append(html('i', 'player-dot'), `Spieler ${index + 1}`);
  const input = html('input');
  input.name = `player-${index}`;
  input.value = COLOR_NAMES[index];
  input.maxLength = 18;
  input.placeholder = COLOR_NAMES[index];
  input.autocomplete = 'off';
  input.required = true;
  label.append(caption, input);
  const controllerLabel = html('label', 'controller-field');
  controllerLabel.append(html('span', '', 'Gespielt von'));
  const select = html('select');
  select.name = `controller-${index}`;
  const human = html('option', '', 'Mensch');
  human.value = 'human';
  const computer = html('option', '', 'KI');
  computer.value = 'computer';
  const empty = html('option', '', 'Unbenutzt');
  empty.value = 'empty';
  select.append(human, computer, empty);
  controllerLabel.append(select);
  field.append(label, controllerLabel);
  $('name-fields').append(field);
});
EVENTS.forEach(event => {
  const item = html('div', 'rule-event');
  const description = html('div');
  description.append(html('strong', '', event.title), event.description);
  item.append(html('span', '', event.icon), description);
  $('event-rules').append(item);
});

$('setup-form').addEventListener('submit', event => {
  event.preventDefault();
  if (online || busy || graphicsFailed) return;
  cancelComputerAction();
  const data = new FormData(event.currentTarget);
  if (COLORS.filter((_, index) => data.get(`controller-${index}`) !== 'empty').length < 2) {
    $('setup-title').textContent = 'Mindestens zwei aktive Farben wählen';
    return;
  }
  game = new Game({
    names: COLORS.map((_, index) => data.get(`player-${index}`)),
    controllers: COLORS.map((_, index) => data.get(`controller-${index}`)),
    mode: data.get('mode')
  });
  started = true;
  statistics = emptyStatistics();
  announcedTurn = null;
  selectedPiece = null;
  sounds.play('start');
  scene?.newGame();
  lastRoll = null;
  winnerShown = false;
  $('setup-dialog').close();
  render();
  showPending();
  (isComputerTurn() ? $('rules-button') : $('roll-button')).focus();
});
$('setup-dialog').addEventListener('cancel', event => {
  if (!started) event.preventDefault();
});
$('setup-cancel').addEventListener('click', () => $('setup-dialog').close());
$('setup-dialog').addEventListener('close', showPending);
$('new-game').addEventListener('click', openSetup);
$('roll-button').addEventListener('click', () => rollDice());
$('event-confirm').addEventListener('click', () => confirmEvent());
$('event-dialog').addEventListener('cancel', event => event.preventDefault());
$('rules-button').addEventListener('click', () => {
  if (busy || anyDialogOpen()) return;
  cancelComputerAction();
  $('rules-dialog').showModal();
});
$('rules-close').addEventListener('click', () => $('rules-dialog').close());
$('rules-dialog').addEventListener('close', showPending);
$('winner-dialog').addEventListener('close', () => render());
$('play-again').addEventListener('click', () => {
  $('winner-dialog').close();
  openSetup();
});
document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || event.repeat || anyDialogOpen()) return;
  if (event.target.closest('input, button, [role="button"], textarea, select')) return;
  event.preventDefault();
  rollDice();
});
render();
const hostSession = readSession('host');
if (!graphicsFailed && hostSession) startConnection({ type: 'resume', code: hostSession.code, token: hostSession.token });
