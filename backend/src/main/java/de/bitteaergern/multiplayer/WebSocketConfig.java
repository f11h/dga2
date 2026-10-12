package de.bitteaergern.multiplayer;

import java.util.Arrays;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {
    private final RoomBroker broker;
    private final String[] origins;

    public WebSocketConfig(RoomBroker broker, @Value("${broker.allowed-origins:}") String origins) {
        this.broker = broker;
        this.origins = Arrays.stream(origins.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toArray(String[]::new);
        for (String origin : this.origins) {
            if (!origin.matches("https?://[^/*\\s]+")) throw new IllegalArgumentException("Explicit HTTP(S) origins required");
        }
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        var registration = registry.addHandler(broker, "/ws");
        if (origins.length > 0) registration.setAllowedOrigins(origins);
        // Spring's default origin policy permits only the request's own origin.
    }
}
