# Multiplayer broker

Spring Boot serves the TV application and phone PWA and brokers raw JSON WebSockets at
`/ws`. The TV browser owns the game rules, dice and animations; this is **not**
a server-authoritative anti-cheat system. Phones cannot publish state, impersonate
other seats or send actions while the TV is offline.

## Run locally

Use Java 21 or newer (tested with Java 25). The included official Maven wrapper
downloads Maven 3.9.11 on its first invocation:

```powershell
cd C:\dev\tictactoe\backend
.\mvnw.cmd test
.\mvnw.cmd spring-boot:run
```

On Linux/macOS use `sh mvnw test` and `sh mvnw spring-boot:run`.
An existing Maven 3.9 installation works as well; no global installation is necessary.

The default asset directory is the parent of the backend working directory.
Run from `backend`, or set `GAME_ASSET_ROOT` to the absolute repository directory
when running elsewhere. Root frontend dependencies must already be installed
(`npm ci` in the root). Only explicitly allowlisted browser assets are exposed:
the TV scripts/styles, controller files, two Three modules, and QR module.
Repository metadata, source tests, backend files, and other node_modules are not public.
Distributed Three.js and QR assets retain their license notices. The container
also includes the Three.js `LICENSE` and `/THIRD_PARTY_NOTICES.txt` with the full
MIT terms and copyright notices for both dependencies. No CDN is required.

Open `http://localhost:8080/` on the TV. Phones use
`http://<TV-host-LAN-address>:8080/controller/`. Permit TCP 8080 through the host
firewall. `localhost` QR links cannot be reached from other devices: open the TV
page with its LAN or public hostname before sharing its QR code. QR URLs use the
browser-visible origin; there is no separate internal-container public URL.

## Docker

From the repository root:

```powershell
docker compose up --build -d
docker compose logs -f game
docker compose down
```

The multi-stage build uses `npm ci`, copies only selected public assets, builds
the Java jar, and runs a non-root Java 21 process. Port 8080 is published on all
host interfaces. `/health` returns `{"status":"ok"}`. Compose limits resources,
drops capabilities, uses a read-only root filesystem and a writable runtime
mount. The build requires access to npm, Maven Central, and the image registry.
Run the wrapper's `test` goal separately before deployment; image compilation does not run the
local-filesystem asset integration tests.

### GitHub Container Registry

The `Multiplayer service` workflow verifies the backend before building the
Docker image. Pushes to `main`/`master` and manual workflow runs publish it to
`ghcr.io/<owner>/<repository>` using the built-in `GITHUB_TOKEN`; no additional
registry secret is required. Pull requests only build the image and never log
in or publish. Images receive branch and commit (`sha-...`) tags; only runs on
the repository's default branch update `latest`.

For this repository, start the published image with:

```powershell
docker run --detach --name bitte-aergern --publish 8080:8080 ghcr.io/f11h/dga2:latest
```

The package inherits repository access when first published by this workflow.
For anonymous pulls, set its visibility to **Public** in the GitHub package
settings. Private packages require `docker login ghcr.io` with a token granting
`read:packages`. If a package with this name already exists, grant this
repository Actions access in its package settings.

For Internet access, terminate **HTTPS** at a trusted reverse proxy and forward
HTTP and WebSocket traffic to this single service. No Redis, STOMP, or additional
broker is required. Example nginx location inside your TLS virtual host:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Port $server_port;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 180s;
}
```

Restrict access to the backend port when a proxy is used. The proxy must replace,
not trust client-supplied forwarded headers. Spring honors those headers; HTTPS
pages connect using same-origin WSS. Use the final public hostname on the TV.
Controller service workers/installability require HTTPS, except on localhost.
Controller motion input also requires a secure context and the phone's sensor
permission. This service does not disable sensors with a Permissions-Policy.
If your reverse proxy sets that header, preserve
`accelerometer=(self), gyroscope=(self)` for same-origin controller input.
Tokens are bearer secrets: never log messages/tokens or place tokens in shared QR URLs.

## Configuration

| Environment | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | HTTP/WebSocket port |
| `GAME_ASSET_ROOT` | `..` | Allowlisted static asset directory |
| `GAME_ALLOWED_ORIGINS` | empty | Same-origin only; optional comma-separated exact HTTP(S) origins |
| `GAME_MAX_ROOMS` | `500` | In-memory room cap |
| `GAME_IDLE_MINUTES` | `120` | Room idle expiry (authenticated pings count as activity) |
| `GAME_HOST_AWAY_MINUTES` | `15` | TV-disconnection reconnect grace |
| `GAME_ABSOLUTE_HOURS` | `24` | Hard maximum lifetime, even with active heartbeats |

Wildcard origins are rejected. Origin enforcement protects browser connections,
not non-browser clients; development clients without an Origin header are accepted.
Possession of an unguessable room code permits a lobby join.
Room codes have eight unambiguous random characters; role-bound reconnect
tokens contain 256 bits of randomness. Rooms and tokens are **in memory only**:
restarts lose them, and multiple replicas require sticky routing plus a different
shared-state design. Expiry runs every 30 seconds and also on joins/resumes.
Disconnected humans retain their seat and token until room expiry, except when
the manager or TV explicitly replaces their disconnected seat while still in
the lobby. Replacement invalidates that seat's old reconnect token.

Limits: 64 KiB text messages, bounded JSON nesting and number length, 40
commands/second/socket, 2,000 live sockets, 64 queued outbound messages/socket,
one-minute unauthenticated timeout, names up to 18 Unicode code points.
Ordinary oversize commands receive `MESSAGE_TOO_LARGE`; messages beyond the
128 KiB transport ceiling close the WebSocket with a transport size violation.
Deploy behind additional connection/IP rate limiting for untrusted Internet traffic.
Slow clients are disconnected rather than holding room locks during sends.

## Shared wire protocol

Client authentication:

- `{type:"create"}` creates a TV/host room.
- `{type:"join",code,name}` claims the first empty seat (lobby only).
- `{type:"resume",code,token}` resumes the token's original role/seat and replaces
  any previous socket; closing the old socket cannot disconnect its replacement.

Successful authentication sends
`{type:"welcome",code,token,role:"host"|"player",seat:null|0..3,room}`.
All members receive `{type:"room",room}` snapshots, without tokens.

`room` contains `code`, `status` (`lobby`, `playing`, `finished`), `mode`
(`events`, `classic`), four `seats` (`id,name,kind,connected`), `hostConnected`,
`managerSeat`, `state`, `revision`, and `busy`. Seats initially are empty and
named Koralle, Gold, Mint, Blau. The earliest-joined currently connected human is
manager; TV also has lobby configuration/start authority.

- `{type:"configure",mode,seats:[{id,kind:"computer"|"empty"}]}` changes only
  unclaimed or disconnected-human seats, never connected humans. A replaced
  disconnected human's old token then receives `INVALID_TOKEN` on resume.
  Mode/seats may be omitted. Changes are atomic and lobby-only; during play
  disconnected human seats/tokens remain reserved for reconnect.
- `{type:"start"}` requires at least two participating seats, an online TV and
  all humans online; starts busy until the TV publishes initial state.
- Host only: `{type:"state",state,busy}` increments revision on every publication
  and releases the in-flight action latch. State must contain `phase`
  (`roll`, `move`, `events`, `over`; `event` also accepted for compatibility),
  `current` seat, four `players` with matching
  `id`s and `legalMoves:[{piece,destination}]`. Other game state stays opaque.
  Optional `winner`, `eventActor`, `eventOpen` are validated.
  A winner or `phase:"over"` finishes the room.
- Phone only: `{type:"action",action:"roll"|"move"|"event",revision,piece?,destination?,path?}`.
  Revision, phase, online host, busy/in-flight latch, owning seat and move legality
  are checked. Accepted actions set busy and are sent **only** to the TV as
  `{type:"action",seat,action,revision,piece?,destination?,path?}`.
  An optional nonempty integer `path` array must exactly match the advertised
  legal option's path, distinguishing routes with the same piece/destination;
  accepted paths are forwarded unchanged. Paths are limited to 128 steps.
  Event actions require `eventOpen:true`, use `eventActor` when supplied, and
  remain allowed after the engine has changed phase, including a finished room
  with phase `over`, for outstanding event UI confirmations.
- Authenticated `{type:"ping"}` returns `{type:"pong"}`.

Errors are `{type:"error",code,message}` with stable uppercase codes and German
messages. Important codes include `FORBIDDEN`, `NOT_YOUR_TURN`, `STALE_REVISION`,
`BUSY`, `HOST_OFFLINE`, `PLAYER_OFFLINE`, `SEAT_CLAIMED`, `ILLEGAL_MOVE`,
`INVALID_STATE`, `ROOM_FULL`, `ROOM_EXPIRED`, `ROOM_NOT_FOUND`, `INVALID_TOKEN`,
`SESSION_REPLACED`, `RATE_LIMIT`, `BAD_MESSAGE`, and `UNKNOWN_COMMAND`.

JUnit integration tests run against actual Java WebSocket clients and embedded
Tomcat, covering role/seat enforcement, lobby configuration, two-human and
human/computer starts, stale/busy actions, legal moves, eliminated event owners,
reconnect identity races, disconnected seats, expiry, origins and static exposure.
