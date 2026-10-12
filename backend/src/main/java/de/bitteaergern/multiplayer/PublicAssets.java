package de.bitteaergern.multiplayer;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import jakarta.servlet.http.HttpServletRequest;

@RestController
public class PublicAssets {
    private final Path root;
    private static final Map<String, String> ASSETS = Map.ofEntries(
        Map.entry("/", "index.html"), Map.entry("/index.html", "index.html"),
        Map.entry("/style.css", "style.css"), Map.entry("/app.js", "app.js"),
        Map.entry("/game.js", "game.js"), Map.entry("/scene.js", "scene.js"),
        Map.entry("/animation.js", "animation.js"), Map.entry("/landscape.js", "landscape.js"),
        Map.entry("/sound.js", "sound.js"), Map.entry("/network.js", "network.js"),
        Map.entry("/controller/", "controller/index.html"), Map.entry("/controller/index.html", "controller/index.html"),
        Map.entry("/controller/controller.js", "controller/controller.js"), Map.entry("/controller/controller.css", "controller/controller.css"),
        Map.entry("/controller/manifest.webmanifest", "controller/manifest.webmanifest"),
        Map.entry("/controller/sw.js", "controller/sw.js"), Map.entry("/controller/icon.svg", "controller/icon.svg"),
        Map.entry("/node_modules/three/build/three.module.js", "node_modules/three/build/three.module.js"),
        Map.entry("/node_modules/three/build/three.core.js", "node_modules/three/build/three.core.js"),
        Map.entry("/node_modules/three/LICENSE", "node_modules/three/LICENSE"),
        Map.entry("/THIRD_PARTY_NOTICES.txt", "backend/THIRD_PARTY_NOTICES.txt"),
        Map.entry("/node_modules/qrcode-generator/dist/qrcode.mjs", "node_modules/qrcode-generator/dist/qrcode.mjs"),
        Map.entry("/node_modules/qrcode-generator/dist/qrcode.js", "node_modules/qrcode-generator/dist/qrcode.js")
    );

    public PublicAssets(@Value("${broker.asset-root:..}") String root) {
        this.root = Path.of(root).toAbsolutePath().normalize();
    }

    @GetMapping("/health")
    public Map<String, String> health() { return Map.of("status", "ok"); }

    @GetMapping("/controller")
    public ResponseEntity<Void> controllerRedirect() { return ResponseEntity.status(308).header("Location", "/controller/").build(); }

    @GetMapping({"/", "/index.html", "/style.css", "/*.js", "/THIRD_PARTY_NOTICES.txt", "/controller/**", "/node_modules/**"})
    public ResponseEntity<?> asset(HttpServletRequest request) throws IOException {
        String relative = ASSETS.get(request.getRequestURI());
        if (relative == null) return ResponseEntity.notFound().build();
        Path file = root.resolve(relative).normalize();
        if (!Files.isRegularFile(file) || !file.toRealPath().startsWith(root.toRealPath())) return ResponseEntity.notFound().build();
        String type = relative.endsWith(".js") || relative.endsWith(".mjs") ? "text/javascript"
            : relative.endsWith(".css") ? "text/css" : relative.endsWith(".svg") ? "image/svg+xml"
            : relative.endsWith(".webmanifest") ? "application/manifest+json"
            : relative.endsWith(".txt") || relative.endsWith("/LICENSE") ? "text/plain" : "text/html";
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(type))
            .header("X-Content-Type-Options", "nosniff").header("Cache-Control", "no-cache")
            .body(new FileSystemResource(file));
    }
}
