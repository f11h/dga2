FROM node:22-alpine AS assets
WORKDIR /source
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.html style.css app.js game.js scene.js animation.js landscape.js sound.js network.js ./
COPY controller/index.html controller/controller.js controller/controller.css controller/manifest.webmanifest controller/sw.js controller/icon.svg ./controller/
COPY backend/THIRD_PARTY_NOTICES.txt /public/backend/THIRD_PARTY_NOTICES.txt
RUN mkdir -p /public/node_modules/three/build /public/node_modules/qrcode-generator/dist \
    && cp index.html style.css app.js game.js scene.js animation.js landscape.js sound.js network.js /public/ \
    && cp -R controller /public/controller \
    && cp node_modules/three/build/three.module.js node_modules/three/build/three.core.js /public/node_modules/three/build/ \
    && cp node_modules/three/LICENSE /public/node_modules/three/LICENSE \
    && cp node_modules/qrcode-generator/dist/qrcode.mjs /public/node_modules/qrcode-generator/dist/

FROM maven:3.9-eclipse-temurin-21 AS backend
WORKDIR /build
COPY backend/pom.xml ./
RUN mvn -B -q dependency:go-offline
COPY backend/src ./src
RUN mvn -B -q package -DskipTests

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
RUN addgroup -S game && adduser -S -G game game \
    && mkdir -p /app/runtime && chown game:game /app/runtime
COPY --from=backend /build/target/multiplayer-1.0.0.jar /app/service.jar
COPY --from=assets /public /app/public
USER game
ENV GAME_ASSET_ROOT=/app/public
EXPOSE 8080
ENTRYPOINT ["java", "-Djava.io.tmpdir=/app/runtime", "-XX:MaxRAMPercentage=70", "-jar", "/app/service.jar"]
