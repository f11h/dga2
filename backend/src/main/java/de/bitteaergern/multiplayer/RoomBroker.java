package de.bitteaergern.multiplayer;

import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.annotation.PreDestroy;
import java.io.IOException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;

@Component
public class RoomBroker extends TextWebSocketHandler {
    static final int MAX_MESSAGE = 65_536;
    private static final String[] NAMES = {"Koralle", "Gold", "Mint", "Blau"};
    private static final char[] ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".toCharArray();
    private final ObjectMapper json = new ObjectMapper();
    private final SecureRandom random = new SecureRandom();
    private final ConcurrentMap<String, Room> rooms = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, Peer> peers = new ConcurrentHashMap<>();
    private final ExecutorService sender = Executors.newFixedThreadPool(8);
    private final int maxRooms;
    private final long idleMillis, hostAwayMillis, absoluteMillis;
    private Clock clock = Clock.systemUTC();

    public RoomBroker(@Value("${broker.max-rooms:500}") int maxRooms,
                      @Value("${broker.idle-minutes:120}") long idleMinutes,
                      @Value("${broker.host-away-minutes:15}") long hostAwayMinutes,
                      @Value("${broker.absolute-hours:24}") long absoluteHours) {
        this.maxRooms = maxRooms;
        idleMillis = Duration.ofMinutes(idleMinutes).toMillis();
        hostAwayMillis = Duration.ofMinutes(hostAwayMinutes).toMillis();
        absoluteMillis = Duration.ofHours(absoluteHours).toMillis();
        json.getFactory().setStreamReadConstraints(StreamReadConstraints.builder()
            .maxNestingDepth(40).maxStringLength(MAX_MESSAGE).maxNumberLength(100).build());
    }

    void setClock(Clock clock) { this.clock = clock; }
    private long now() { return clock.millis(); }

    @Override
    public void afterConnectionEstablished(WebSocketSession socket) throws Exception {
        // A small transport margin allows protocol errors for ordinary oversize commands.
        socket.setTextMessageSizeLimit(MAX_MESSAGE * 2);
        socket.setBinaryMessageSizeLimit(1);
        if (peers.size() >= 2000) { socket.close(CloseStatus.SERVICE_OVERLOAD); return; }
        peers.put(socket.getId(), new Peer(socket));
    }

    @Override
    protected void handleTextMessage(WebSocketSession socket, TextMessage message) {
        Peer peer = peers.get(socket.getId());
        if (peer == null) return;
        try {
            if (!peer.allow()) fail("RATE_LIMIT", "Zu viele Nachrichten. Bitte kurz warten.");
            if (message.asBytes().length > MAX_MESSAGE) fail("MESSAGE_TOO_LARGE", "Nachricht zu groß.");
            JsonNode parsed = json.readTree(message.getPayload());
            if (!(parsed instanceof ObjectNode command) || !command.path("type").isTextual()) fail("BAD_MESSAGE", "Ungültige JSON-Nachricht.");
            ObjectNode command = (ObjectNode) parsed;
            String type = command.path("type").asText();
            if (Set.of("create", "join", "resume").contains(type)) {
                if (peer.room != null) fail("ALREADY_AUTHENTICATED", "Diese Verbindung gehört bereits zu einem Raum.");
                authenticate(peer, type, command);
            } else {
                Room room = peer.room;
                if (room == null) fail("NOT_AUTHENTICATED", "Bitte zuerst einen Raum erstellen oder beitreten.");
                synchronized (room) {
                    if (rooms.get(room.code) != room) fail("ROOM_EXPIRED", "Dieser Raum ist abgelaufen.");
                    if (peer.member.peer != peer) fail("SESSION_REPLACED", "Die Sitzung wurde auf einem anderen Gerät fortgesetzt.");
                    room.lastUsed = now();
                    switch (type) {
                        case "ping" -> peer.send(Map.of("type", "pong"));
                        case "configure" -> configure(room, peer, command);
                        case "start" -> start(room, peer);
                        case "state" -> publish(room, peer, command);
                        case "action" -> action(room, peer, command);
                        default -> fail("UNKNOWN_COMMAND", "Unbekannter Befehl.");
                    }
                }
            }
        } catch (ProtocolError error) {
            peer.error(error.code, error.getMessage());
        } catch (IOException | IllegalArgumentException error) {
            peer.error("BAD_MESSAGE", "Ungültige JSON-Nachricht.");
        }
    }

    @Override
    protected void handleBinaryMessage(WebSocketSession socket, BinaryMessage message) {
        Peer peer = peers.get(socket.getId());
        if (peer != null) peer.error("BAD_MESSAGE", "Nur JSON-Textnachrichten sind erlaubt.");
    }

    @Override
    public void afterConnectionClosed(WebSocketSession socket, CloseStatus status) {
        Peer peer = peers.remove(socket.getId());
        if (peer == null || peer.room == null) return;
        Room room = peer.room;
        synchronized (room) {
            if (peer.member.peer != peer) return; // An old socket must never disconnect its replacement.
            peer.member.peer = null;
            if (peer.member.seat == null) room.hostGoneAt = now();
            room.lastUsed = now();
            broadcast(room);
        }
    }

    @Override
    public void handleTransportError(WebSocketSession socket, Throwable error) throws Exception {
        socket.close(CloseStatus.SERVER_ERROR);
    }

    private void authenticate(Peer peer, String type, ObjectNode command) {
        Room room;
        if (type.equals("create")) {
            synchronized (rooms) {
                if (rooms.size() >= maxRooms) fail("ROOM_LIMIT", "Zurzeit sind alle Räume belegt.");
                String code;
                do { code = code(); } while (rooms.containsKey(code));
                room = new Room(code);
                rooms.put(code, room);
            }
            synchronized (room) { attach(room, room.host, peer); }
            return;
        }
        String code = command.path("code").asText("").strip().toUpperCase(Locale.ROOT);
        room = rooms.get(code);
        if (room == null) fail("ROOM_NOT_FOUND", "Raum nicht gefunden oder abgelaufen.");
        synchronized (room) {
            if (expired(room)) { expire(room); fail("ROOM_EXPIRED", "Dieser Raum ist abgelaufen."); }
            if (type.equals("resume")) {
                String token = command.path("token").asText("");
                Member member = room.tokens.get(token);
                if (member == null) fail("INVALID_TOKEN", "Der Sitzungsschlüssel ist ungültig oder nicht mehr gültig.");
                attach(room, member, peer);
            } else {
                if (!room.status.equals("lobby")) fail("ALREADY_STARTED", "Das Spiel hat bereits begonnen.");
                String name = name(command.get("name"));
                Seat available = Arrays.stream(room.seats).filter(s -> s.kind.equals("empty")).findFirst().orElse(null);
                if (available == null) fail("ROOM_FULL", "Alle Spielerplätze sind belegt.");
                Member member = new Member(available.id, room.nextJoin++);
                available.kind = "human";
                available.name = name.isEmpty() ? NAMES[available.id] : name;
                available.member = member;
                room.tokens.put(member.token, member);
                attach(room, member, peer);
            }
        }
    }

    private void attach(Room room, Member member, Peer peer) {
        Peer previous = member.peer;
        member.peer = peer;
        peer.room = room;
        peer.member = member;
        room.lastUsed = now();
        if (member.seat == null) room.hostGoneAt = 0;
        if (previous != null) {
            previous.error("SESSION_REPLACED", "Die Sitzung wurde auf einem anderen Gerät fortgesetzt.");
            previous.close(CloseStatus.NORMAL);
        }
        Map<String, Object> welcome = new LinkedHashMap<>();
        welcome.put("type", "welcome"); welcome.put("code", room.code); welcome.put("token", member.token);
        welcome.put("role", member.seat == null ? "host" : "player"); welcome.put("seat", member.seat);
        welcome.put("room", snapshot(room));
        peer.send(welcome);
        broadcast(room);
    }

    private void manager(Room room, Peer peer) {
        if (peer.member.seat != null && !Objects.equals(peer.member.seat, managerSeat(room)))
            fail("FORBIDDEN", "Nur die Spielleitung darf den Raum konfigurieren.");
        if (!room.status.equals("lobby")) fail("ALREADY_STARTED", "Die Lobby ist bereits geschlossen.");
    }

    private void configure(Room room, Peer peer, ObjectNode command) {
        manager(room, peer);
        JsonNode mode = command.get("mode");
        if (mode != null && (!mode.isTextual() || !Set.of("events", "classic").contains(mode.asText())))
            fail("BAD_CONFIGURATION", "Unbekannter Spielmodus.");
        JsonNode seats = command.get("seats");
        if (seats != null) {
            if (!seats.isArray() || seats.size() > 4) fail("BAD_CONFIGURATION", "Ungültige Spielerplätze.");
            Set<Integer> seen = new HashSet<>();
            for (JsonNode entry : seats) {
                int id = integer(entry.get("id"), 0, 3, "BAD_CONFIGURATION");
                if (!seen.add(id) || !Set.of("empty", "computer").contains(entry.path("kind").asText()))
                    fail("BAD_CONFIGURATION", "Ungültige Spielerplätze.");
                if (room.seats[id].kind.equals("human") && connected(room.seats[id].member))
                    fail("SEAT_CLAIMED", "Ein verbundener menschlicher Spielerplatz darf nicht geändert werden.");
            }
            for (JsonNode entry : seats) {
                Seat seat = room.seats[entry.get("id").asInt()];
                if (seat.member != null) {
                    room.tokens.remove(seat.member.token);
                    seat.member.peer = null;
                    seat.member = null;
                }
                seat.kind = entry.get("kind").asText(); seat.name = NAMES[seat.id];
            }
        }
        if (mode != null) room.mode = mode.asText();
        broadcast(room);
    }

    private void start(Room room, Peer peer) {
        manager(room, peer);
        if (!connected(room.host)) fail("HOST_OFFLINE", "Der Fernseher ist nicht verbunden.");
        if (Arrays.stream(room.seats).filter(s -> !s.kind.equals("empty")).count() < 2)
            fail("NOT_ENOUGH_PLAYERS", "Mindestens zwei Spielerplätze müssen besetzt sein.");
        if (Arrays.stream(room.seats).anyMatch(s -> s.kind.equals("human") && !connected(s.member)))
            fail("PLAYER_OFFLINE", "Alle menschlichen Spieler müssen verbunden sein.");
        room.status = "playing"; room.busy = true;
        broadcast(room);
    }

    private void publish(Room room, Peer peer, ObjectNode command) {
        if (peer.member.seat != null) fail("FORBIDDEN", "Nur der Fernseher darf Spielzustände senden.");
        if (room.status.equals("lobby")) fail("NOT_STARTED", "Das Spiel wurde noch nicht gestartet.");
        JsonNode state = command.get("state");
        validateState(room, state);
        if (!command.path("busy").isBoolean()) fail("INVALID_STATE", "Der Beschäftigt-Status fehlt.");
        room.state = state.deepCopy(); room.busy = command.get("busy").asBoolean();
        room.inFlight = false; room.revision++;
        if (!state.path("winner").isNull() && state.has("winner") || state.path("phase").asText().equals("over"))
            room.status = "finished";
        broadcast(room);
    }

    private void validateState(Room room, JsonNode state) {
        if (state == null || !state.isObject()) fail("INVALID_STATE", "Ungültiger Spielzustand.");
        String phase = state.path("phase").asText();
        if (!Set.of("roll", "move", "events", "event", "over").contains(phase)) fail("INVALID_STATE", "Ungültige Spielphase.");
        int current = integer(state.get("current"), 0, 3, "INVALID_STATE");
        if (room.seats[current].kind.equals("empty")) fail("INVALID_STATE", "Der aktuelle Spielerplatz ist leer.");
        JsonNode players = state.get("players");
        if (players == null || !players.isArray() || players.size() != 4) fail("INVALID_STATE", "Vier Spielerzustände werden benötigt.");
        for (int i = 0; i < 4; i++) {
            JsonNode player = players.get(i);
            if (!player.isObject() || integer(player.get("id"), 0, 3, "INVALID_STATE") != i)
                fail("INVALID_STATE", "Ungültige Spielerzuordnung.");
        }
        if (state.hasNonNull("eventActor")) integer(state.get("eventActor"), 0, 3, "INVALID_STATE");
        if (state.has("eventOpen") && !state.get("eventOpen").isBoolean()) fail("INVALID_STATE", "Ungültiger Ereignisstatus.");
        if (state.hasNonNull("winner")) integer(state.get("winner"), 0, 3, "INVALID_STATE");
        JsonNode moves = state.get("legalMoves");
        if (moves == null || !moves.isArray() || moves.size() > 512) fail("INVALID_STATE", "Gültige Zugmöglichkeiten werden benötigt.");
        for (JsonNode move : moves) {
            integer(move.get("piece"), 0, 63, "INVALID_STATE");
            integer(move.get("destination"), 0, 103, "INVALID_STATE");
            if (move.has("path")) validatePath(move.get("path"), "INVALID_STATE");
        }
        finite(state);
    }

    private void finite(JsonNode node) {
        if (node.isNumber() && !Double.isFinite(node.asDouble())) fail("INVALID_STATE", "Nicht endliche Zahl im Spielzustand.");
        if (node.isContainerNode()) node.forEach(this::finite);
    }

    private void action(Room room, Peer peer, ObjectNode command) {
        if (peer.member.seat == null) fail("FORBIDDEN", "Der Fernseher darf nicht für Menschen spielen.");
        String action = command.path("action").asText();
        if (!Set.of("roll", "move", "event").contains(action)) fail("INVALID_ACTION", "Unbekannte Spielaktion.");
        boolean openEvent = room.state != null && room.state.path("eventOpen").asBoolean(false);
        if (!room.status.equals("playing") && !(room.status.equals("finished") && action.equals("event") && openEvent))
            fail("NOT_PLAYING", "Zurzeit läuft kein Spiel.");
        if (!connected(room.host)) fail("HOST_OFFLINE", "Der Fernseher ist nicht verbunden. Das Spiel pausiert.");
        if (room.busy || room.inFlight || room.state == null) fail("BUSY", "Bitte warten, bis die aktuelle Aktion abgeschlossen ist.");
        JsonNode revision = command.get("revision");
        if (revision == null || !revision.isIntegralNumber() || !revision.canConvertToLong() || revision.asLong() != room.revision)
            fail("STALE_REVISION", "Der Spielzustand hat sich geändert. Bitte erneut versuchen.");
        int owner = action.equals("event") && room.state.hasNonNull("eventActor")
            ? room.state.get("eventActor").asInt() : room.state.get("current").asInt();
        if (peer.member.seat != owner) fail("NOT_YOUR_TURN", "Diese Aktion gehört einem anderen Spieler.");
        String phase = room.state.get("phase").asText();
        if (action.equals("event") ? !openEvent : !phase.equals(action) || openEvent)
            fail("INVALID_PHASE", "Diese Aktion ist in der aktuellen Phase nicht erlaubt.");
        Map<String, Object> forwarded = new LinkedHashMap<>();
        forwarded.put("type", "action"); forwarded.put("seat", owner); forwarded.put("action", action); forwarded.put("revision", room.revision);
        if (action.equals("move")) {
            int piece = integer(command.get("piece"), 0, 63, "ILLEGAL_MOVE");
            int destination = integer(command.get("destination"), 0, 103, "ILLEGAL_MOVE");
            JsonNode path = command.get("path");
            if (path != null) validatePath(path, "ILLEGAL_MOVE");
            boolean legal = false;
            for (JsonNode move : room.state.get("legalMoves")) {
                if (move.get("piece").asInt() == piece && move.get("destination").asInt() == destination
                    && (path == null || path.equals(move.get("path")))) legal = true;
            }
            if (!legal) fail("ILLEGAL_MOVE", "Dieser Zug ist nicht erlaubt.");
            forwarded.put("piece", piece); forwarded.put("destination", destination);
            if (path != null) forwarded.put("path", path.deepCopy());
        }
        room.busy = true; room.inFlight = true;
        broadcast(room);
        room.host.peer.send(forwarded);
    }

    private String name(JsonNode value) {
        if (value == null) return "";
        if (!value.isTextual()) fail("INVALID_NAME", "Bitte einen gültigen Namen eingeben.");
        String name = value.asText().strip();
        if (name.codePointCount(0, name.length()) > 18 || name.codePoints().anyMatch(c -> Character.isISOControl(c) || c == '<' || c == '>' || Character.getType(c) == Character.FORMAT))
            fail("INVALID_NAME", "Namen dürfen höchstens 18 Zeichen und keinen HTML-Code enthalten.");
        return name;
    }

    private void validatePath(JsonNode path, String error) {
        if (!path.isArray() || path.isEmpty() || path.size() > 128) fail(error, "Ungültiger Zugweg.");
        for (JsonNode step : path) integer(step, 0, 103, error);
    }

    private int integer(JsonNode value, int min, int max, String error) {
        if (value == null || !value.isIntegralNumber() || !value.canConvertToInt() || value.intValue() < min || value.intValue() > max)
            fail(error, "Ungültiger Zahlenwert.");
        return value.intValue();
    }

    private Integer managerSeat(Room room) {
        return Arrays.stream(room.seats).filter(s -> s.kind.equals("human") && connected(s.member))
            .min(Comparator.comparingLong(s -> s.member.order)).map(s -> s.id).orElse(null);
    }

    private boolean connected(Member member) { return member != null && member.peer != null && member.peer.socket.isOpen(); }

    private Map<String, Object> snapshot(Room room) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("code", room.code); result.put("status", room.status); result.put("mode", room.mode);
        result.put("seats", Arrays.stream(room.seats).map(s -> Map.of("id", s.id, "name", s.name, "kind", s.kind, "connected", s.kind.equals("human") && connected(s.member))).toList());
        result.put("hostConnected", connected(room.host)); result.put("managerSeat", managerSeat(room));
        result.put("state", room.state); result.put("revision", room.revision); result.put("busy", room.busy);
        return result;
    }

    private void broadcast(Room room) {
        Map<String, Object> message = Map.of("type", "room", "room", snapshot(room));
        for (Member member : room.tokens.values()) if (connected(member)) member.peer.send(message);
    }

    private boolean expired(Room room) {
        long time = now();
        return time - room.createdAt >= absoluteMillis || time - room.lastUsed >= idleMillis
            || room.hostGoneAt > 0 && time - room.hostGoneAt >= hostAwayMillis;
    }

    private void expire(Room room) {
        if (!rooms.remove(room.code, room)) return;
        for (Member member : room.tokens.values()) if (connected(member)) {
            member.peer.error("ROOM_EXPIRED", "Dieser Raum ist abgelaufen. Bitte einen neuen Raum erstellen.");
            member.peer.close(CloseStatus.NORMAL);
        }
    }

    @Scheduled(fixedDelay = 30_000)
    public void cleanup() {
        for (Room room : rooms.values()) synchronized (room) { if (expired(room)) expire(room); }
        for (Peer peer : peers.values()) if (peer.room == null && now() - peer.createdAt > 60_000) {
            peer.error("AUTH_TIMEOUT", "Bitte erneut verbinden und einem Raum beitreten.");
            peer.close(CloseStatus.POLICY_VIOLATION);
        }
    }

    @PreDestroy
    void shutdown() { sender.shutdownNow(); }

    private String code() {
        StringBuilder code = new StringBuilder(8);
        for (int i = 0; i < 8; i++) code.append(ALPHABET[random.nextInt(ALPHABET.length)]);
        return code.toString();
    }

    private String token() {
        byte[] bytes = new byte[32]; random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static void fail(String code, String message) { throw new ProtocolError(code, message); }
    private static class ProtocolError extends RuntimeException {
        final String code;
        ProtocolError(String code, String message) { super(message); this.code = code; }
    }
    private class Member {
        final Integer seat;
        final long order;
        final String token = token();
        Peer peer;
        Member(Integer seat, long order) { this.seat = seat; this.order = order; }
    }
    private class Seat {
        final int id;
        String name, kind = "empty";
        Member member;
        Seat(int id) { this.id = id; name = NAMES[id]; }
    }
    private class Room {
        final String code;
        final long createdAt = now();
        long lastUsed = createdAt, hostGoneAt, revision, nextJoin;
        final Member host = new Member(null, -1);
        final Map<String, Member> tokens = new HashMap<>();
        final Seat[] seats = {new Seat(0), new Seat(1), new Seat(2), new Seat(3)};
        String status = "lobby", mode = "events";
        JsonNode state;
        boolean busy, inFlight;
        Room(String code) { this.code = code; tokens.put(host.token, host); }
    }

    private class Peer {
        final WebSocketSession socket;
        final long createdAt = now();
        final BlockingQueue<Object> outbox = new ArrayBlockingQueue<>(64);
        final AtomicBoolean draining = new AtomicBoolean();
        volatile Room room;
        Member member;
        long windowStart = now();
        int count;
        Peer(WebSocketSession socket) { this.socket = socket; }
        synchronized boolean allow() {
            if (now() - windowStart >= 1000) { windowStart = now(); count = 0; }
            return ++count <= 40;
        }
        void error(String code, String message) { send(Map.of("type", "error", "code", code, "message", message)); }
        void send(Object payload) {
            try { enqueue(json.writeValueAsString(payload)); }
            catch (IOException error) { close(CloseStatus.SERVER_ERROR); }
        }
        void close(CloseStatus status) { enqueue(status); }
        void enqueue(Object item) {
            if (!outbox.offer(item)) {
                outbox.clear();
                outbox.offer(CloseStatus.SERVICE_OVERLOAD);
            }
            drain();
        }
        void drain() {
            if (!draining.compareAndSet(false, true)) return;
            sender.execute(() -> {
                try {
                    Object item;
                    while ((item = outbox.poll()) != null && socket.isOpen()) {
                        if (item instanceof CloseStatus status) socket.close(status);
                        else socket.sendMessage(new TextMessage((String) item));
                    }
                } catch (IOException | RuntimeException error) {
                    try { socket.close(CloseStatus.SERVER_ERROR); } catch (IOException ignored) { }
                } finally {
                    draining.set(false);
                    if (!outbox.isEmpty() && socket.isOpen() && !sender.isShutdown()) drain();
                }
            });
        }
    }
}
