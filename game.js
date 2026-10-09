export const COLORS = ['#f16463', '#f5c451', '#56c7a5', '#6c9ff8'];
export const COLOR_NAMES = ['Koralle', 'Gold', 'Mint', 'Blau'];
export const STARTS = [0, 10, 20, 30];
export const EVENT_FIELDS = [2, 5, 8, 12, 15, 18, 22, 25, 28, 32, 35, 38];
export const TRAIN_FIELDS = [15, 23];
export const EVENTS = [
  { id: 'leaders-home', icon: '↩', title: 'Spitzenreiter, umkehren!', description: 'Die vorderste ungesicherte Figur jeder Person muss zurück ins Haus.' },
  { id: 'redistribute', icon: '✦', title: 'Alles auf Anfang. Fast.', description: 'Alle Figuren auf der Umlaufbahn bekommen neue, zufällige Plätze. Zielhäuser bleiben unverändert.' },
  { id: 'swap', icon: '⇄', title: 'Großer Platztausch', description: 'Alle Figuren auf der Umlaufbahn tauschen zufällig ihre Positionen. Die belegten Felder bleiben dieselben.' },
  { id: 'rocket', icon: '✹', title: 'Raketenroulette', description: 'Das Glücksrad wählt eine ungesicherte Figur auf dem Brett. Ein Raketenschlag schickt sie zurück ins Haus.' },
  { id: 'again', icon: '↻', title: 'Eine Zugabe, bitte!', description: 'Du darfst nach diesem Wurf noch einmal würfeln.' },
  { id: 'all-home', icon: '⌂', title: 'Ab nach Hause!', description: 'Alle ungesicherten Figuren auf dem Brett müssen zurück ins Haus. Für alle Personen.' },
  { id: 'instant-goal', icon: '⚑', title: 'Überholspur ins Ziel', description: 'Deine führende ungesicherte Figur kommt sofort auf den hintersten freien Zielplatz. Ist keine unterwegs, startet eine aus dem Haus.' },
  { id: 'double-one', icon: '⚄', title: 'Doppelt hält besser', description: 'Für deinen nächsten Zug bekommst du einen zweiten Würfel. Beide Augenzahlen werden addiert.' },
  { id: 'double-two', icon: '⚄', title: 'Doppeltes Doppel', description: 'Für deine nächsten zwei Züge bekommst du einen zweiten Würfel. Aus dem Haus geht es nur mit einem Sechserpasch.' },
  { id: 'lose', icon: '×', title: 'Heute leider kein Glück', description: 'Du scheidest sofort aus. Deine Figuren werden vom Brett genommen; die anderen spielen weiter.' },
  { id: 'ten', icon: '⑩', title: 'Mehr ist mehr', description: 'Alle würfeln für die nächsten zwei vollständigen Tischrunden mit zehn statt sechs Seiten.' },
  { id: 'four', icon: '④', title: 'Kleine Schritte', description: 'Alle würfeln für die nächsten zwei vollständigen Tischrunden mit vier Seiten. In dieser Zeit ist kein Ausziehen möglich.' },
  { id: 'paths', icon: '⇢', title: 'Baustelle auf dem Brett!', description: 'Eine Abkürzung und eine Umleitung entstehen. An den Abzweigungen wählst du den normalen oder den neuen Weg. Sie bleiben bis zum nächsten Wege-Ereignis bestehen.' },
  { id: 'extra-piece', icon: '+', title: 'Verstärkung kommt!', description: 'Du erhältst eine zusätzliche Figur im Haus und je einen weiteren Haus- und Zielplatz. Zum Gewinnen müssen jetzt alle deine Figuren ins Ziel. Bereits sichere Figuren bleiben sicher.' }
];

const RARE_EVENTS = ['lose', 'leaders-home'];

export function eventProbability(event) {
  return RARE_EVENTS.includes(event.id) ? .01 : (1 - RARE_EVENTS.length * .01) / (EVENTS.length - RARE_EVENTS.length);
}

export function selectEvent(random) {
  const draw = random();
  const rareTotal = RARE_EVENTS.length * .01;
  if (draw < rareTotal) return EVENTS.find(event => event.id === RARE_EVENTS[Math.floor(draw / .01)]);
  const regular = EVENTS.filter(event => !RARE_EVENTS.includes(event.id));
  return regular[Math.min(regular.length - 1, Math.floor((draw - rareTotal) / (1 - rareTotal) * regular.length))];
}

export function shuffled(values, random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export class Game {
  constructor({ names = COLOR_NAMES, controllers = [], mode = 'events', random = Math.random } = {}) {
    this.random = random;
    this.mode = mode;
    this.players = COLORS.map((color, id) => ({
      id, color, name: names[id]?.trim() || COLOR_NAMES[id],
      controller: controllers[id] ?? 'human',
      pieces: [-1, -1, -1, -1], score: 0, eliminated: false,
      doubleTurns: 0, pendingDouble: 0
    }));
    if (this.players.some(player => !['human', 'computer'].includes(player.controller))) {
      throw new Error('Unbekannte Spielersteuerung.');
    }
    this.current = 0;
    this.phase = 'roll';
    this.attempts = 0;
    this.round = 1;
    this.rollData = null;
    this.queue = [];
    this.resume = null;
    this.diceEffect = null;
    this.winner = null;
    this.paths = [];
    // Schedule lazily so creating a game does not consume dice randomness.
    this.nextTrainRound = null;
    this.pendingTrain = false;
    this.log = ['Das Spiel beginnt. ' + this.players[0].name + ' ist dran.'];
  }

  say(text) {
    this.log.unshift(text);
    this.log.length = Math.min(this.log.length, 60);
  }

  position(playerId, progress) {
    return progress >= 0 && progress < 40 ? (STARTS[playerId] + progress) % 40 : null;
  }

  secured(playerId, pieceId) {
    const pieces = this.players[playerId].pieces;
    const progress = pieces[pieceId];
    if (progress < 40) return false;
    for (let i = progress + 1; i <= this.goalEnd(playerId); i++) {
      if (!pieces.includes(i)) return false;
    }
    return true;
  }

  goalEnd(playerId) {
    return 39 + this.players[playerId].pieces.length;
  }

  resolveTrain() {
    if (!this.pendingTrain || this.phase === 'over') throw new Error('Es wartet keine Zugdurchfahrt.');
    const targets = this.boardPieces().filter(piece =>
      TRAIN_FIELDS.includes(piece.position) ||
      (piece.player === 2 && piece.progress === 42 + this.players[2].pieces.length - 4));
    for (const target of targets) this.players[target.player].pieces[target.piece] = -1;
    this.pendingTrain = false;
    this.say(`Der Zug fährt durch! ${targets.length ? `${targets.length} Figuren sind zurück im Haus.` : 'Das Gleis ist frei.'}`);
    return { targets };
  }

  boardPieces({ trackOnly = false } = {}) {
    return this.players.flatMap(player => player.eliminated ? [] : player.pieces.flatMap((progress, piece) =>
      progress >= 0 && (trackOnly ? progress < 40 : !this.secured(player.id, piece))
        ? [{ player: player.id, piece, progress, position: this.position(player.id, progress) }]
        : []
    ));
  }

  leading(playerId) {
    return this.boardPieces().filter(piece => piece.player === playerId)
      .sort((a, b) => b.progress - a.progress)[0];
  }

  sides() {
    return this.diceEffect?.sides || 6;
  }

  routes(playerId, progress, steps) {
    if (progress < 0) return [{ destination: 0, path: [0], branches: [] }];
    const results = [];
    const walk = (at, remaining, path, branches, used) => {
      if (!remaining) {
        results.push({ destination: at, path, branches });
        return;
      }
      if (at >= this.goalEnd(playerId)) return;
      // Goal occupants block passage, not just the final landing.
      const next = at + 1;
      if (next < 40 || !this.players[playerId].pieces.includes(next)) {
        walk(next, remaining - 1, [...path, next], branches, used);
      }
      if (at >= 40) return;
      for (const [index, link] of this.paths.entries()) {
        const destination = at + link.delta;
        if (link.from !== this.position(playerId, at) || used.includes(index) || destination < 0 || destination >= 40) continue;
        walk(destination, remaining - 1, [...path, destination], [...branches, link.kind], [...used, index]);
      }
    };
    walk(progress, steps, [], [], []);
    return results;
  }

  legalMoves() {
    if (this.phase !== 'move' || !this.rollData || this.pendingTrain) return [];
    const player = this.players[this.current];
    if (player.eliminated) return [];
    const { total, canEnter } = this.rollData;
    let moves = player.pieces.flatMap((progress, piece) => {
      if (this.secured(player.id, piece)) return [];
      if (this.paths.length) {
        if (progress === -1 && !canEnter) return [];
        return this.routes(player.id, progress, total)
          .filter(route => !player.pieces.some((other, id) => id !== piece && other === route.destination))
          .map(route => ({ piece, ...route }));
      }
      const destination = progress === -1 ? (canEnter ? 0 : null) : progress + total;
      if (destination === null || destination > this.goalEnd(player.id)) return [];
      if (player.pieces.some((other, id) => id !== piece && other === destination)) return [];
      // In the narrow goal lane, pieces cannot jump over one another.
      if (destination >= 40 && player.pieces.some(other => other >= 40 && other > progress && other <= destination)) return [];
      return [{ piece, destination }];
    });
    if (player.pieces.includes(-1)) {
      const entry = moves.filter(move => player.pieces[move.piece] === -1);
      if (entry.length) moves = entry;
      else {
        const clearStart = moves.filter(move => player.pieces[move.piece] === 0);
        if (clearStart.length) moves = clearStart;
      }
    }
    return moves;
  }

  chooseComputerMove() {
    return this.chooseComputerOption().piece;
  }

  chooseComputerOption() {
    const moves = this.legalMoves();
    if (!moves.length) throw new Error('Die KI hat gerade keinen gültigen Zug.');
    const player = this.players[this.current];
    const opponents = this.boardPieces({ trackOnly: true }).filter(piece => piece.player !== player.id);
    const score = move => {
      if (move.destination >= 40) return 500 + move.destination * 5;
      const position = this.position(player.id, move.destination);
      const captured = opponents.find(piece => piece.position === position);
      const threatened = opponents.filter(piece => {
        if (piece === captured) return false;
        const distance = (position - piece.position + 40) % 40;
        const reach = this.sides() * (this.players[piece.player].doubleTurns > 0 ? 2 : 1);
        if (this.paths.length) {
          return Array.from({ length: reach }, (_, i) => i + 1).some(steps =>
            this.routes(piece.player, piece.progress, steps).some(route =>
              route.destination < 40 && this.position(piece.player, route.destination) === position));
        }
        return distance > 0 && distance <= reach && piece.progress + distance < 40;
      }).length;
      return move.destination + (captured ? 200 + captured.progress : 0) - threatened * 25;
    };
    return moves.reduce((best, move) => score(move) > score(best) ? move : best);
  }

  addEvent(source) {
    const event = selectEvent(this.random);
    this.queue.push({ ...event, source, actor: this.current });
  }

  roll() {
    if (this.phase !== 'roll' || this.pendingTrain) throw new Error('Jetzt kann nicht gewürfelt werden.');
    const player = this.players[this.current];
    const count = player.doubleTurns > 0 ? 2 : 1;
    const sides = this.sides();
    const values = Array.from({ length: count }, () => 1 + Math.floor(this.random() * sides));
    const total = values.reduce((sum, value) => sum + value, 0);
    this.rollData = { values, total, sides, canEnter: values.every(value => value === 6), again: values.includes(6) };
    this.attempts++;
    this.say(`${player.name} würfelt ${values.join(' + ')}${count === 2 ? ' = ' + total : ''}.`);
    if (this.mode === 'events') {
      player.score += total;
      if (player.score >= 32) {
        player.score = 0;
        this.addEvent('Augenzahlen-Counter: 32 erreicht');
      }
    }
    this.phase = 'move';
    this.pauseForEvents();
    this.settle();
    return this.rollData;
  }

  move(pieceId, path = null) {
    const move = this.legalMoves().find(option => option.piece === pieceId &&
      (path === null || (option.path?.length === path.length && option.path.every((value, i) => value === path[i]))));
    if (!move) throw new Error('Diese Figur kann mit diesem Wurf nicht ziehen.');
    const player = this.players[this.current];
    const before = player.pieces[pieceId];
    player.pieces[pieceId] = move.destination;
    const position = this.position(player.id, move.destination);
    if (position !== null) {
      for (const opponent of this.players) {
        if (opponent.id === player.id || opponent.eliminated) continue;
        opponent.pieces.forEach((progress, index) => {
          if (this.position(opponent.id, progress) === position) {
            opponent.pieces[index] = -1;
            this.say(`${player.name} schlägt ${opponent.name}s Figur ${index + 1}.`);
          }
        });
      }
    }
    this.say(`${player.name}: Figur ${pieceId + 1} ${before === -1 ? 'verlässt das Haus' : 'zieht ' + this.rollData.total + ' Felder'}.`);
    this.phase = 'afterMove';
    if (this.mode === 'events' && EVENT_FIELDS.includes(position)) this.addEvent('Ereignisfeld');
    this.checkWinner();
    this.pauseForEvents();
    this.settle();
    return move;
  }

  pauseForEvents() {
    if (this.queue.length && this.phase !== 'over') {
      this.resume = this.phase;
      this.phase = 'events';
    }
  }

  eventCandidates() {
    return this.boardPieces();
  }

  resolveEvent() {
    if (this.phase !== 'events') throw new Error('Es wartet kein Ereignis.');
    const event = this.queue.shift();
    const actor = this.players[event.actor];
    let target = null;
    let detail = '';
    switch (event.id) {
      case 'extra-piece':
        // Insert the new goal slot at the entrance, preserving secured tails.
        actor.pieces = actor.pieces.map(progress => progress >= 40 ? progress + 1 : progress);
        actor.pieces.push(-1);
        detail = `${actor.name} spielt jetzt mit ${actor.pieces.length} Figuren und ${actor.pieces.length} Zielplätzen. Die neue Figur wartet im Haus.`;
        break;
      case 'paths': {
        const sources = shuffled([3, 6, 13, 16, 23, 26, 33, 36], this.random);
        this.paths = [
          { from: sources[0], delta: 4, kind: 'shortcut' },
          { from: sources[1], delta: -3, kind: 'detour' }
        ];
        detail = 'Neue Wege: Eine Abkürzung spart drei Schritte, eine Umleitung führt drei Felder zurück. Jeder neue Weg kostet einen Würfelschritt und kann pro Zug einmal genutzt werden. Figuren bleiben stehen.';
        break;
      }
      case 'leaders-home': {
        let count = 0;
        for (const player of this.players) {
          const leader = this.leading(player.id);
          if (leader) {
            player.pieces[leader.piece] = -1;
            count++;
          }
        }
        detail = count ? `${count} Spitzenfiguren sind zurück im Haus.` : 'Keine ungesicherte Figur unterwegs. Alle bleiben stehen.';
        break;
      }
      case 'redistribute':
      case 'swap': {
        const pieces = this.boardPieces({ trackOnly: true });
        const positions = shuffled(event.id === 'swap' ? pieces.map(piece => piece.position) : Array.from({ length: 40 }, (_, i) => i), this.random);
        pieces.forEach((piece, index) => {
          this.players[piece.player].pieces[piece.piece] = positions[index] === undefined
            ? -1 : (positions[index] - STARTS[piece.player] + 40) % 40;
        });
        detail = pieces.length ? `${pieces.length} Figuren wurden ${event.id === 'swap' ? 'zufällig getauscht' : 'neu verteilt'}.` : 'Keine Figur auf der Umlaufbahn. Alle bleiben stehen.';
        break;
      }
      case 'rocket': {
        const candidates = this.eventCandidates();
        if (candidates.length) {
          target = candidates[Math.floor(this.random() * candidates.length)];
          this.players[target.player].pieces[target.piece] = -1;
          detail = `${this.players[target.player].name}, Figur ${target.piece + 1}, muss zurück ins Haus.`;
        } else detail = 'Keine ungesicherte Figur auf dem Brett. Die Rakete geht ins Leere.';
        break;
      }
      case 'again':
        this.rollData.again = true;
        detail = `${actor.name} darf nach diesem Wurf noch einmal würfeln.`;
        break;
      case 'all-home': {
        const pieces = this.boardPieces();
        for (const piece of pieces) this.players[piece.player].pieces[piece.piece] = -1;
        detail = pieces.length ? `${pieces.length} Figuren sind zurück im Haus. Sichere Zielfiguren bleiben stehen.` : 'Keine ungesicherte Figur unterwegs. Alle bleiben stehen.';
        break;
      }
      case 'instant-goal': {
        const leader = this.leading(actor.id);
        const pieceId = leader?.piece ?? actor.pieces.indexOf(-1);
        const destination = Array.from({ length: actor.pieces.length }, (_, i) => this.goalEnd(actor.id) - i)
          .find(progress => !actor.pieces.includes(progress));
        if (pieceId >= 0 && destination !== undefined) {
          actor.pieces[pieceId] = destination;
          detail = `${actor.name}s Figur ${pieceId + 1} steht jetzt sicher im Ziel.`;
        }
        else detail = 'Alle deine Figuren sind bereits sicher im Ziel.';
        break;
      }
      case 'double-one':
      case 'double-two':
        actor.pendingDouble = Math.max(actor.pendingDouble, event.id === 'double-one' ? 1 : 2);
        detail = `${actor.name} hat für die nächsten ${actor.pendingDouble === 1 ? 'einen Zug' : 'zwei Züge'} zwei Würfel.`;
        break;
      case 'lose':
        actor.eliminated = true;
        actor.pieces.fill(-1);
        detail = `${actor.name} scheidet aus. Die übrigen Personen spielen weiter.`;
        break;
      case 'ten':
      case 'four':
        // Snapshot the participants: everybody receives two full subsequent turns.
        this.diceEffect = {
          sides: event.id === 'ten' ? 10 : 4,
          remaining: this.players.map(player => player.eliminated ? 0 : 2),
          skipCurrent: true
        };
        detail = `Ab jetzt würfeln alle mit ${this.diceEffect.sides} Seiten.`;
        break;
      default:
        throw new Error('Unbekanntes Ereignis: ' + event.id);
    }
    this.say(`${actor.name}: ${event.title}${detail ? ' ' + detail : ''}`);
    this.checkWinner();
    if (this.phase !== 'over' && !this.queue.length) {
      this.phase = this.resume;
      this.resume = null;
      this.settle();
    }
    return { event, target, detail };
  }

  checkWinner() {
    const active = this.players.filter(player => !player.eliminated);
    const winner = active.find(player => player.pieces.every(progress => progress >= 40))
      || (active.length === 1 ? active[0] : null);
    if (winner) {
      this.winner = winner.id;
      this.phase = 'over';
      this.queue = [];
      this.say(`${winner.name} gewinnt!`);
    }
  }

  settle() {
    if (this.phase === 'over' || this.phase === 'events') return;
    const player = this.players[this.current];
    if (player.eliminated) {
      this.endTurn();
      return;
    }
    if (this.phase === 'move' && this.legalMoves().length) return;
    if (this.phase === 'move') this.say(`${player.name} kann keine Figur bewegen.`);
    if (this.rollData.again) {
      this.phase = 'roll';
      this.attempts = 0;
      this.say(`${player.name} darf noch einmal würfeln.`);
      return;
    }
    const allHomeOrSafe = player.pieces.every((progress, piece) => progress === -1 || this.secured(player.id, piece));
    if (this.phase === 'move' && allHomeOrSafe && player.pieces.includes(-1) && this.attempts < 3) {
      this.phase = 'roll';
      this.say(`${player.name} hat noch ${3 - this.attempts} Versuch${this.attempts === 1 ? 'e' : ''}.`);
      return;
    }
    this.endTurn();
  }

  endTurn() {
    const player = this.players[this.current];
    if (player.doubleTurns > 0) player.doubleTurns--;
    if (player.pendingDouble > 0) {
      player.doubleTurns = Math.max(player.doubleTurns, player.pendingDouble);
      player.pendingDouble = 0;
    }
    if (this.diceEffect) {
      if (!this.diceEffect.skipCurrent) {
        this.diceEffect.remaining[this.current] = Math.max(0, this.diceEffect.remaining[this.current] - 1);
      }
      this.diceEffect.skipCurrent = false;
      this.players.forEach(other => {
        if (other.eliminated) this.diceEffect.remaining[other.id] = 0;
      });
      if (this.diceEffect.remaining.every(turns => turns === 0)) this.diceEffect = null;
    }
    let next = this.current;
    do {
      next = (next + 1) % 4;
      if (next === 0) this.round++;
    } while (this.players[next].eliminated);
    this.current = next;
    this.phase = 'roll';
    this.attempts = 0;
    this.rollData = null;
    if (this.nextTrainRound === null) this.nextTrainRound = this.round + 2 + Math.floor(this.random() * 4);
    if (this.round >= this.nextTrainRound) {
      this.pendingTrain = true;
      this.nextTrainRound = this.round + 2 + Math.floor(this.random() * 4);
      this.say('Achtung, Zugdurchfahrt vor dem nächsten Wurf!');
    }
    this.say(`${this.players[next].name} ist dran.`);
  }
}
