package de.bitteaergern.multiplayer;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Predicate;
import org.junit.jupiter.api.*;
import static org.junit.jupiter.api.Assertions.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = {"broker.asset-root=..", "broker.max-rooms=100"})
class RoomBrokerTest {
    @LocalServerPort int port;
    @Autowired RoomBroker broker;
    private final ObjectMapper json = new ObjectMapper();
    private final List<Client> clients = new ArrayList<>();
    private final HttpClient http = HttpClient.newHttpClient();

    @AfterEach
    void close() {
        clients.forEach(Client::close);
        broker.setClock(Clock.systemUTC());
    }

    @Test
    void twoHumansCanStartWithEmptySeatsAndOnlyOwnActionsReachHost() throws Exception {
        Client host = client(); JsonNode welcome = host.command(Map.of("type", "create"), "welcome");
        String code = welcome.get("code").asText();
        assertEquals(8, code.length());
        assertTrue(welcome.path("room").path("seats").findValuesAsText("kind").stream().allMatch("empty"::equals));
        assertFalse(welcome.path("room").toString().contains(welcome.get("token").asText()));
        Client first = join(code, "Erster"), second = join(code, "Zweiter");
        assertEquals(0, second.lastWelcome.path("room").path("managerSeat").asInt());
        assertError(second, Map.of("type", "start"), "FORBIDDEN");
        first.send(Map.of("type", "start"));
        host.await(n -> n.path("room").path("status").asText().equals("playing"));
        assertError(first, Map.of("type", "action", "action", "roll", "revision", 0), "BUSY");
        publish(host, state("roll", 0), false, 1);
        assertError(second, Map.of("type", "action", "action", "roll", "seat", 0, "revision", 1), "NOT_YOUR_TURN");
        assertError(first, Map.of("type", "state", "state", state("roll", 0), "busy", false), "FORBIDDEN");
        assertError(host, Map.of("type", "action", "action", "roll", "revision", 1), "FORBIDDEN");
        assertError(first, Map.of("type", "action", "action", "roll", "revision", 0), "STALE_REVISION");
        first.send(Map.of("type", "action", "action", "roll", "revision", 1));
        JsonNode accepted = host.await(n -> n.has("room") && n.path("room").path("busy").asBoolean()
            && n.path("room").path("revision").asInt() == 1);
        assertEquals(1, accepted.path("room").path("revision").asInt());
        JsonNode action = host.await(n -> n.path("type").asText().equals("action"));
        assertEquals(0, action.path("seat").asInt());
        assertEquals(1, action.path("revision").asInt());
        assertError(first, Map.of("type", "action", "action", "roll", "revision", 1), "BUSY");
        assertError(second, Map.of("type", "join", "code", code), "ALREADY_AUTHENTICATED");
        Client late = client();
        assertError(late, Map.of("type", "join", "code", code), "ALREADY_STARTED");
    }

    @Test
    void configurationsAreAtomicHumanSeatsProtectedAndHumanComputerStarts() throws Exception {
        Client host = client(); String code = host.command(Map.of("type", "create"), "welcome").path("code").asText();
        Client player = join(code, "🦊".repeat(18));
        assertError(player, Map.of("type", "start"), "NOT_ENOUGH_PLAYERS");
        assertError(player, Map.of("type", "configure", "mode", "classic", "seats",
            List.of(Map.of("id", 1, "kind", "computer"), Map.of("id", 0, "kind", "empty"))), "SEAT_CLAIMED");
        player.send(Map.of("type", "configure", "mode", "classic", "seats", List.of(Map.of("id", 1, "kind", "computer"))));
        JsonNode configured = host.await(n -> n.path("room").path("mode").asText().equals("classic"));
        assertEquals("human", configured.path("room").path("seats").get(0).path("kind").asText());
        player.send(Map.of("type", "start"));
        host.await(n -> n.path("room").path("status").asText().equals("playing"));
        assertError(host, Map.of("type", "configure", "mode", "events"), "ALREADY_STARTED");
    }

    @Test
    void legalMovesAreValidatedAndEventOwnerCanDifferFromCurrentAfterElimination() throws Exception {
        Client host = client(); String code = host.command(Map.of("type", "create"), "welcome").path("code").asText();
        Client first = join(code, "Eins"), second = join(code, "Zwei");
        first.send(Map.of("type", "start")); host.await(n -> n.path("room").path("status").asText().equals("playing"));
        Map<String, Object> move = state("move", 0);
        move.put("legalMoves", List.of(Map.of("piece", 1, "destination", 8)));
        publish(host, move, false, 1);
        assertError(first, Map.of("type", "action", "action", "roll", "revision", 1), "INVALID_PHASE");
        assertError(first, Map.of("type", "action", "action", "move", "piece", 1, "destination", 9, "revision", 1), "ILLEGAL_MOVE");
        first.send(Map.of("type", "action", "action", "move", "piece", 1, "destination", 8, "revision", 1));
        assertEquals(8, host.await(n -> n.path("type").asText().equals("action")).path("destination").asInt());
        Map<String, Object> resolvedEvent = state("roll", 1);
        resolvedEvent.put("eventActor", 0); resolvedEvent.put("eventOpen", true);
        publish(host, resolvedEvent, false, 2);
        first.send(Map.of("type", "action", "action", "event", "revision", 2));
        assertEquals(0, host.await(n -> n.path("type").asText().equals("action")).path("seat").asInt());
        Map<String, Object> event = state("over", 1);
        event.put("winner", 1); event.put("eventActor", 0); event.put("eventOpen", true);
        publish(host, event, false, 3);
        assertError(second, Map.of("type", "action", "action", "event", "revision", 3), "NOT_YOUR_TURN");
        first.send(Map.of("type", "action", "action", "event", "revision", 3));
        assertEquals(0, host.await(n -> n.path("type").asText().equals("action")).path("seat").asInt());
        event.put("eventOpen", false);
        publish(host, event, false, 4);
        assertError(first, Map.of("type", "action", "action", "event", "revision", 4), "NOT_PLAYING");
    }

    @Test
    void resumeReplacesSocketWithoutIdentityRaceAndOfflineHostPausesActions() throws Exception {
        Client host = client(); JsonNode welcome = host.command(Map.of("type", "create"), "welcome");
        String code = welcome.path("code").asText(), hostToken = welcome.path("token").asText();
        Client first = join(code, "Eins"), second = join(code, "Zwei");
        Client replacement = client();
        JsonNode resumed = replacement.command(Map.of("type", "resume", "code", code, "token", first.lastWelcome.path("token").asText()), "welcome");
        assertEquals(0, resumed.path("seat").asInt());
        first.await(n -> n.path("code").asText().equals("SESSION_REPLACED"));
        first.close();
        replacement.send(Map.of("type", "start"));
        host.await(n -> n.path("room").path("status").asText().equals("playing"));
        publish(host, state("roll", 0), false, 1);
        host.close();
        replacement.await(n -> n.has("room") && !n.path("room").path("hostConnected").asBoolean());
        assertError(replacement, Map.of("type", "action", "action", "roll", "revision", 1), "HOST_OFFLINE");
        Client newHost = client();
        assertEquals("host", newHost.command(Map.of("type", "resume", "code", code, "token", hostToken), "welcome").path("role").asText());
        replacement.send(Map.of("type", "action", "action", "roll", "revision", 1));
        newHost.await(n -> n.path("type").asText().equals("action"));
        publish(newHost, state("roll", 1), false, 2);
        assertError(replacement, Map.of("type", "action", "action", "roll", "revision", 2), "NOT_YOUR_TURN");
        second.send(Map.of("type", "action", "action", "roll", "revision", 2));
        newHost.await(n -> n.path("type").asText().equals("action"));
    }

    @Test
    void branchingMovePathMustMatchAndIsForwardedWithoutLosingRoute() throws Exception {
        Client host = client(); String code = host.command(Map.of("type", "create"), "welcome").path("code").asText();
        Client first = join(code, "Eins");
        join(code, "Zwei");
        first.send(Map.of("type", "start")); host.await(n -> n.path("room").path("status").asText().equals("playing"));
        Map<String, Object> state = state("move", 0);
        state.put("legalMoves", List.of(
            Map.of("piece", 1, "destination", 8, "path", List.of(6, 7, 8)),
            Map.of("piece", 1, "destination", 8, "path", List.of(3, 7, 8))));
        publish(host, state, false, 1);
        assertError(first, Map.of("type", "action", "action", "move", "piece", 1, "destination", 8,
            "path", List.of(2, 7, 8), "revision", 1), "ILLEGAL_MOVE");
        assertError(first, Map.of("type", "action", "action", "move", "piece", 1, "destination", 8,
            "path", List.of("3", 7, 8), "revision", 1), "ILLEGAL_MOVE");
        first.send(Map.of("type", "action", "action", "move", "piece", 1, "destination", 8,
            "path", List.of(3, 7, 8), "revision", 1));
        JsonNode action = host.await(n -> n.path("type").asText().equals("action"));
        assertEquals(json.valueToTree(List.of(3, 7, 8)), action.path("path"));
    }

    @Test
    void canonicalEngineEventsPhaseIsAcceptedAndEventActionReachesHost() throws Exception {
        Client host = client(); String code = host.command(Map.of("type", "create"), "welcome").path("code").asText();
        Client first = join(code, "Eins"), second = join(code, "Zwei");
        first.send(Map.of("type", "start")); host.await(n -> n.path("room").path("status").asText().equals("playing"));
        Map<String, Object> event = state("events", 1);
        event.put("eventActor", 0); event.put("eventOpen", true);
        publish(host, event, false, 1);
        assertError(second, Map.of("type", "action", "action", "event", "revision", 1), "NOT_YOUR_TURN");
        first.send(Map.of("type", "action", "action", "event", "revision", 1));
        assertEquals(0, host.await(n -> n.path("type").asText().equals("action")).path("seat").asInt());
    }

    @Test
    void disconnectedSeatRetainedManagerMovesAndStartBlocksOfflineHuman() throws Exception {
        Client host = client(); String code = host.command(Map.of("type", "create"), "welcome").path("code").asText();
        Client first = join(code, "Eins"), second = join(code, "Zwei");
        first.close();
        JsonNode room = host.await(n -> n.has("room") && n.path("room").path("managerSeat").asInt(-1) == 1);
        assertEquals("human", room.path("room").path("seats").get(0).path("kind").asText());
        assertError(second, Map.of("type", "start"), "PLAYER_OFFLINE");
        Client resumed = client();
        resumed.command(Map.of("type", "resume", "code", code, "token", first.lastWelcome.path("token").asText()), "welcome");
        assertError(second, Map.of("type", "configure", "mode", "classic"), "FORBIDDEN");
    }

    @Test
    void lobbyManagerCanReplaceAbandonedSeatAndOldTokenCannotResume() throws Exception {
        Client host = client(); String code = host.command(Map.of("type", "create"), "welcome").path("code").asText();
        Client first = join(code, "Eins"), second = join(code, "Zwei");
        String oldToken = first.lastWelcome.path("token").asText();
        first.close();
        host.await(n -> n.has("room") && n.path("room").path("managerSeat").asInt(-1) == 1);
        second.send(Map.of("type", "configure", "seats", List.of(Map.of("id", 0, "kind", "computer"))));
        JsonNode configured = host.await(n -> n.has("room") && n.path("room").path("seats").get(0).path("kind").asText().equals("computer"));
        assertEquals("Koralle", configured.path("room").path("seats").get(0).path("name").asText());
        Client oldPhone = client();
        assertError(oldPhone, Map.of("type", "resume", "code", code, "token", oldToken), "INVALID_TOKEN");
        second.send(Map.of("type", "start"));
        host.await(n -> n.path("room").path("status").asText().equals("playing"));
        second.close();
        host.await(n -> n.has("room") && !n.path("room").path("seats").get(1).path("connected").asBoolean());
        assertError(host, Map.of("type", "configure", "seats", List.of(Map.of("id", 1, "kind", "empty"))), "ALREADY_STARTED");
        Client resumed = client();
        assertEquals(1, resumed.command(Map.of("type", "resume", "code", code,
            "token", second.lastWelcome.path("token").asText()), "welcome").path("seat").asInt());
    }

    @Test
    void errorsNamesMalformedStateAndHeartbeatAreExplicit() throws Exception {
        Client unauthenticated = client();
        assertError(unauthenticated, Map.of("type", "ping"), "NOT_AUTHENTICATED");
        unauthenticated.socket.sendText("{broken", true).join();
        assertEquals("BAD_MESSAGE", unauthenticated.await(n -> n.path("type").asText().equals("error")).path("code").asText());
        Client host = client(); String code = host.command(Map.of("type", "create"), "welcome").path("code").asText();
        assertError(unauthenticated, Map.of("type", "join", "code", code, "name", "x".repeat(19)), "INVALID_NAME");
        assertError(unauthenticated, Map.of("type", "resume", "code", code, "token", "wrong"), "INVALID_TOKEN");
        Client player = join(code, "Name");
        assertEquals("pong", player.command(Map.of("type", "ping"), "pong").path("type").asText());
        assertError(player, Map.of("type", "wat"), "UNKNOWN_COMMAND");
        player.send(Map.of("type", "configure", "seats", List.of(Map.of("id", 1, "kind", "computer"))));
        host.await(n -> n.has("room") && n.path("room").path("seats").get(1).path("kind").asText().equals("computer"));
        player.send(Map.of("type", "start")); host.await(n -> n.path("room").path("status").asText().equals("playing"));
        assertError(host, Map.of("type", "state", "state", Map.of("phase", "roll"), "busy", false), "INVALID_STATE");
    }

    @Test
    void expiryIsBoundedAndSendsExplicitError() throws Exception {
        Client host = client(); String code = host.command(Map.of("type", "create"), "welcome").path("code").asText();
        broker.setClock(Clock.fixed(Instant.now().plus(Duration.ofHours(25)), ZoneOffset.UTC));
        broker.cleanup();
        assertEquals("ROOM_EXPIRED", host.await(n -> n.path("type").asText().equals("error")).path("code").asText());
        Client late = client();
        assertError(late, Map.of("type", "join", "code", code), "ROOM_NOT_FOUND");
    }

    @Test
    void binaryAndExcessiveCommandsGetExplicitErrors() throws Exception {
        Client host = client();
        host.command(Map.of("type", "create"), "welcome");
        host.socket.sendBinary(java.nio.ByteBuffer.wrap(new byte[]{1}), true).join();
        assertEquals("BAD_MESSAGE", host.await(n -> n.path("type").asText().equals("error")).path("code").asText());
        assertError(host, Map.of("type", "ping", "padding", "x".repeat(70_000)), "MESSAGE_TOO_LARGE");
        for (int i = 0; i < 50; i++) host.send(Map.of("type", "ping"));
        assertEquals("RATE_LIMIT", host.await(n -> n.path("type").asText().equals("error")).path("code").asText());
    }

    private Map<String, Object> state(String phase, int current) {
        Map<String, Object> state = new HashMap<>();
        state.put("phase", phase); state.put("current", current);
        state.put("players", List.of(Map.of("id", 0), Map.of("id", 1), Map.of("id", 2), Map.of("id", 3)));
        state.put("legalMoves", List.of()); state.put("winner", null);
        return state;
    }

    private void publish(Client host, Map<String, Object> state, boolean busy, int revision) throws Exception {
        host.send(Map.of("type", "state", "state", state, "busy", busy));
        host.await(n -> n.has("room") && n.path("room").path("revision").asInt() == revision);
    }

    private void assertError(Client client, Object command, String code) throws Exception {
        assertEquals(code, client.command(command, "error").path("code").asText());
    }

    private Client join(String code, String name) throws Exception {
        Client client = client();
        client.lastWelcome = client.command(Map.of("type", "join", "code", code, "name", name), "welcome");
        return client;
    }

    private Client client() {
        Client client = new Client(); clients.add(client);
        client.socket = http.newWebSocketBuilder().connectTimeout(Duration.ofSeconds(5))
            .buildAsync(URI.create("ws://localhost:" + port + "/ws"), client).join();
        return client;
    }

    private class Client implements WebSocket.Listener {
        final BlockingQueue<JsonNode> messages = new LinkedBlockingQueue<>();
        final StringBuilder fragments = new StringBuilder();
        WebSocket socket;
        JsonNode lastWelcome;
        @Override public void onOpen(WebSocket socket) { socket.request(1); }
        @Override public CompletionStage<?> onText(WebSocket socket, CharSequence text, boolean last) {
            fragments.append(text);
            if (last) {
                try { messages.add(json.readTree(fragments.toString())); }
                catch (Exception error) { throw new RuntimeException(error); }
                fragments.setLength(0);
            }
            socket.request(1); return null;
        }
        void send(Object value) throws Exception { socket.sendText(json.writeValueAsString(value), true).join(); }
        JsonNode command(Object value, String type) throws Exception {
            send(value); return await(n -> n.path("type").asText().equals(type));
        }
        JsonNode await(Predicate<JsonNode> predicate) throws Exception {
            long deadline = System.nanoTime() + Duration.ofSeconds(5).toNanos();
            List<JsonNode> seen = new ArrayList<>();
            while (System.nanoTime() < deadline) {
                JsonNode next = messages.poll(100, TimeUnit.MILLISECONDS);
                if (next != null) {
                    if (predicate.test(next)) return next;
                    seen.add(next);
                }
            }
            fail("Message not received. Received: " + seen); return null;
        }
        void close() { if (socket != null && !socket.isOutputClosed()) socket.sendClose(WebSocket.NORMAL_CLOSURE, "done").join(); }
    }
}
