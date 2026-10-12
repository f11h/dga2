# Bitte aergern.

Ein schlankes Mensch-aergere-dich-nicht-Browsergame mit vier Spielerplaetzen
an einem Geraet oder mit Handys als Internet-Controller. Jeder Platz kann von
einem Menschen oder der KI gespielt werden oder unbenutzt bleiben (mindestens
zwei aktive Farben). HTML, CSS und JavaScript mit einer echten WebGL-3D-Spielansicht
auf Basis von lokal installiertem Three.js. Keine CDNs oder externen Assets;
nach der einmaligen Installation ist keine Internetverbindung erforderlich.
Dies gilt fuer den lokalen Modus; Internetpartien benoetigen den Spring-Server.

## Starten

Mit Node.js ab Version 20:

```sh
npm install
npm start
```

Im Browser `http://localhost:8080` oeffnen und **Lokal an diesem Geraet** waehlen.
Alternativ die Dateien mit
einem beliebigen statischen Webserver bereitstellen. `index.html` nicht
direkt per `file://` oeffnen: JavaScript-Module benoetigen einen Webserver.
Ein anderer Port kann ueber die Umgebungsvariable `PORT` gesetzt werden.

## Internet-Multiplayer: Brett + Handys

Der Hauptbrowser ist der Spieltisch und benoetigt WebGL. **Internet-Lobby
erstellen** erzeugt einen Raum. Der lokale Modus bleibt mit **Lokal an diesem
Geraet** separat verfuegbar. Handys scannen den lokal erzeugten QR-Code oder
oeffnen den angezeigten Link `https://<host>/controller/?room=CODE`; alternativ
Raumcode und Name auf `/controller/` eingeben. Der QR-Code enthaelt nur den
Raumcode, niemals das geheime Sitzungstoken.

Das erste beigetretene Handy verwaltet den Spielmodus und die freien Farben:
**KI** oder **Unbenutzt**. Nach **Einstellungen speichern** kann es die Partie
starten, sobald mindestens zwei Farben besetzt und Spieltisch sowie alle Handys
verbunden sind. Zwei oder drei aktive Farben verwenden weiterhin das feste
Vierfarbenbrett. Ab Spielstart zeigt der Spieltisch nur Brett, Ereignisrad und
Anzeigeoptionen (Ton, Vollbild, Kamera). Wuerfeln, Figur und alternativen Weg
auswaehlen sowie jeden Ereignisschritt bestaetigen erfolgt ausschliesslich
auf dem jeweiligen Handy. Die KI und Zugdurchfahrten laufen am Spieltisch.
In der Lobby kann die Verwaltung einen getrennten Handy-Platz reserviert
lassen oder ausdruecklich auf KI/unbenutzt umstellen und speichern. Dann ist
dessen alter Sitzungsschluessel nicht mehr gueltig. Verbundene Menschen
koennen nicht ersetzt werden. Waehrend einer laufenden Partie bleiben auch
getrennte menschliche Plaetze erhalten; die Partie pausiert zur Wiederaufnahme.

Das persoenliche Handy-Dashboard zeigt Figuren im Haus/Ziel, den Ereigniscounter,
echte geworfene Augensummen, Wuerfe, Zuege, geschlagene Figuren und Heimkehr.
Optionales Schuetteln aktiviert man per Schalter: Sensorfreigabe (insbesondere
iOS) und HTTPS sind erforderlich. Der normale Wuerfelbutton bleibt verfuegbar.
Die Controller-Seite kann ueber das Browsermenue bzw. Safari **Teilen > Zum
Home-Bildschirm** als eigenstaendige PWA installiert werden. Der Service Worker
speichert nur die statische Controller-Oberflaeche, keine Raum-/Spielstaende;
offline sind Spieleingaben gesperrt.

Bei Verbindungsausfall pausieren Handyeingaben und KI. Die Clients verbinden
mit begrenzten Wiederholungsabstaenden erneut und nehmen ihre rollengetrennt
lokal gespeicherten Sitzungen wieder auf. Aktionen werden nie automatisch
wiederholt. Auch Neuladen des Spieltischs rekonstruiert den zuletzt publizierten
Regelzustand und Ereignisschritt; eine bereits angewandte Ereigniswirkung wird
nicht doppelt ausgefuehrt. Laufende optische Animationen werden dabei nicht
wiederhergestellt. **Andere Lobby / neu beitreten** am Handy loescht seine alte
Sitzung. Raumdaten leben im Arbeitsspeicher des Servers; ein Serverneustart
oder Ablauf des Raums beendet die Wiederaufnahme.
Wird dieselbe Sitzung in einem zweiten Tab fortgesetzt, bleibt der ersetzte
Tab dauerhaft getrennt und zeigt einen Hinweis statt sich gegenseitig endlos
neu zu verbinden. Gespeicherte gemeinsame Zugangsdaten werden dabei nicht
geloescht. Lobby-Einstellungen und Spielstart sind bis zur Serverbestaetigung
gesperrt; bei Verbindungsverlust werden sie nicht automatisch erneut gesendet.
Abgelaufene oder nicht mehr vorhandene Raeume beenden die Wiederverbindung
mit einem sichtbaren Hinweis; am Spieltisch kann eine neue Lobby erstellt werden.

### Bereitstellung

`npm start` ist weiterhin ein ausschliesslich lokaler statischer Entwicklungsserver
auf `127.0.0.1` und **kein Multiplayer-Server**. Fuer Internetpartien muss der
Spring-WebSocket-Server dieselbe Origin fuer Browserdateien und `/ws` bereitstellen.
Docker-/Serverstart, Konfiguration und Grenzen sind in
[`backend/README.md`](backend/README.md) beschrieben. Fuer echte Internetnutzung
sind ein erreichbarer Host, DNS, HTTPS/WSS und ein WebSocket-faehiger Reverse
Proxy noetig; ein vorhandenes Container-Image allein ist noch keine
Internetbereitstellung. Sitzungstokens sind Bearer-Geheimnisse: nicht teilen.
Der Hauptbrowser bleibt Regelautoritaet und muss waehrend der Partie aktiv sein.

## GitHub Pages

Der Workflow `.github/workflows/deploy-pages.yml` veroeffentlicht das Spiel
bei jedem Push auf `main` oder `master`. Er kann auch unter **Actions**
mit **Run workflow** manuell gestartet werden.

Im GitHub-Repository unter **Settings > Pages > Build and deployment**
als **Source** die Option **GitHub Actions** auswaehlen. Danach den Code
einschliesslich `package-lock.json` und des Workflows pushen.
Bei einem anderen Hauptbranch die Branchliste im Workflow anpassen.

Der Workflow installiert die Abhaengigkeiten mit `npm ci`, fuehrt die
Tests aus und laedt nur die benoetigten Browserdateien sowie die beiden
Three.js-Module und deren Lizenz als Pages-Artefakt hoch. `node_modules`
muss nicht ins Repository eingecheckt werden. `.nojekyll` und die
beibehaltenen relativen Modulpfade erlauben auch den Betrieb unter
`https://<name>.github.io/<repository>/`. Ein Node.js-Server ist auf
GitHub Pages nicht erforderlich. Die veroeffentlichte URL erscheint
im Deployment unter **Actions** und **Settings > Pages**.

GitHub Pages bietet ausschliesslich den lokalen Spielmodus, keinen `/ws`-Broker.
Internet-Multiplayer ist dort ohne gleich-originige Serverbereitstellung nicht
verfuegbar.

## Spiel

- Vier Namen eingeben, pro Spielerplatz **Mensch** oder **KI** auswaehlen
  und klassischen oder Ereignismodus waehlen. Eine einzelne Person kann
  gegen drei KIs spielen; auch beliebige andere Mischungen und reine
  KI-Partien zum Zuschauen sind moeglich.
- Wuerfeln per Button oder Leertaste; leuchtende Figur oder Figuren-Button
  auswaehlen. Tastaturbedienung mit Tab und Enter wird unterstuetzt.
- **Vollbild** in der Kopfzeile zeigt das Spiel ohne Browserrahmen mit
  einer bildschirmfuellenden 3D-Spielflaeche ohne Seitenleisten oder Seitenraender.
  Im lokalen Modus liegen die Zugsteuerungen als kompaktes Overlay ueber dem
  Brett; im Multiplayer erfolgen die Eingaben weiterhin nur auf den Handys.
  Bei der Multiplayer-Figurenauswahl zeigen grosse, kontrastreiche Nummern
  ueber den ziehbaren Figuren dieselben Figurennummern wie auf dem Handy.
  **Vollbild verlassen** oder Esc beendet den Modus. In Browsern ohne
  Fullscreen-Unterstuetzung ist der Button deaktiviert.
- Das gesamte Brett mit Figuren, Feldern, Haeusern, Licht und Schatten ist
  echtes 3D. Figuren huepfen bei normalen Zuegen ueber **jedes** einzelne
  Feld, auch beim Ausziehen und in der Zielgasse. Geschlagene Figuren
  fliegen anschliessend ins Haus.
- Beim Warten, Wuerfeln und Auswaehlen zeigt die Kamera automatisch das
  ganze Brett mit Landschaft. Nur Zuege und Ereignisse werden verfolgt. **Uebersicht**
  zeigt das ganze Brett und deaktiviert die Verfolgung; **Kamera folgen**
  aktiviert sie wieder. Figuren-Buttons bleiben als Tastaturalternative
  zu den anklickbaren 3D-Figuren verfuegbar.
- Das Brett steht in einer belebten Landschaft mit umherlaufenden Schafen,
  Hasen, einer Ente sowie Katzen, Giraffen und Kuehen,
  Baeumen im Wind, Wolken, wechselndem Wetter und zufaelligen lustigen
  Hintergrundaktionen. **Ton an/aus** schaltet die lokal erzeugten
  Spiel- und Umgebungssounds. Audio startet nach der ersten Interaktion;
  es werden keine Audiodateien oder externen Dienste geladen.
- Animierte Ereignisfelder schweben und pulsieren. Ereignisse zeigen
  Raketenflug mit Einschlag, gemeinsame Tausch-/Umverteilungsfluege,
  Heimkehr, Zielportal, Eliminations-Aufloesung und rotierende Bonuswuerfel.
  Das Raketen-Gluecksrad bleibt erhalten; danach wird der Dialog fuer die
  3D-Inszenierung kurz ausgeblendet und zeigt anschliessend das Ergebnis.
- Waehrend Animationen werden Eingaben und KI serialisiert gesperrt.
  Regeln/Neues Spiel lassen sich zwischen Animationen oeffnen.
  Bei unsichtbarem Tab pausiert die 3D-Zeitleiste. Die Systemeinstellung
  **Bewegung reduzieren** verkuerzt Effekte und unterbindet Kameraschwenks
  sowie Landschaftsbewegungen.
  WebGL ist erforderlich; bei fehlender Unterstuetzung erscheint ein
  expliziter Hinweis und der Spielstart bleibt gesperrt.
- Eine 6 erlaubt das Ausziehen. Sind nur Hausfiguren und gesicherte
  Zielfiguren vorhanden, gibt es bis zu drei Versuche.
- Wenn moeglich, muss bei einer 6 ausgezogen werden; ein eigenes besetztes
  Startfeld muss freigemacht werden, solange Hausfiguren warten.
- Gegner werden durch Landen geschlagen. Eigene Figuren blockieren
  Landefelder. Zielfelder muessen genau erreicht werden und duerfen nicht
  uebersprungen werden.
- Die hinterste Zielfigur ist gesichert, ebenso eine lueckenlos daran
  anschliessende Reihe. Ungesicherte Zielfiguren koennen Ereignisse treffen.
- Alle eigenen Figuren im Ziel gewinnen (zu Beginn vier). Wer als einzige Person nicht
  ausgeschieden ist, gewinnt ebenfalls.

## KI-Spieler

Die KI wuerfelt, waehlt eine regelkonforme Figur und bestaetigt ihre
Ereignisse automatisch, einschliesslich des Raketen-Gluecksrads. Sie
bevorzugt Zielfelder und das Schlagen von Gegnern, beruecksichtigt
Schlaggefahren und kennt keine zukuenftigen Wuerfelergebnisse.
Spielregeln, Counter, Boni und Ausscheiden sind fuer Menschen und KI
identisch. Die KI laeuft lokal im Browser, ohne externe Dienste.

KI-Zuege laufen mit kurzen Denkpausen und denselben Animationen wie
menschliche Zuege. Die manuelle Steuerung ist dabei gesperrt.
Die Dialoge **Spielregeln** und **Neues Spiel** pausieren die automatische
Steuerung; nach dem Schliessen geht es weiter. Ereignisse menschlicher
Spieler werden weiterhin manuell bestaetigt.

## Ereignismodus

Genau zwoelf markierte Felder loesen beim Landen eines der vierzehn
Ereignisse aus. Ausscheiden und „Spitzenreiter, umkehren!“ (eine Figur pro
Person zurueck ins Haus) haben jeweils genau 1 % Wahrscheinlichkeit; die
anderen zwoelf teilen sich die restlichen 98 % gleichmaessig. Jedes Ereignis ist unabhaengig vom
Feld. Zusaetzlich sammelt jede Person alle gewuerfelten Augen. Bei
mindestens 32 wird der Counter auf 0 gesetzt und vor dem Ziehen ein
Ereignis ausgeloest. Ein Feld-Ereignis erfolgt nach dem Ziehen.
Umverteilungen loesen keine Ereignisketten aus.

Enthalten sind: fuehrende ungesicherte Figuren nach Hause, neue
Verteilung der Umlaufbahn, Tausch der belegten Umlauffelder, Raketen-Gluecksrad,
Zusatzwurf, alle ungesicherten Figuren nach Hause, eigene fuehrende
Figur sofort ins Ziel, zweiter Wuerfel fuer einen oder zwei Zuege,
seltenes sofortiges Ausscheiden, D10 und D4 fuer alle, veraenderte Wege
sowie eine zusaetzliche eigene Spielfigur.

Beim Ausloesen wird zuerst das Ereignis-Gluecksrad angezeigt. Seine
Segmentgroessen entsprechen den Wahrscheinlichkeiten. Nach der Drehung
wird das ausgewaehlte Ereignis bestaetigt; beim Raketenereignis folgt
ein zweites Gluecksrad fuer das Ziel. Auch die KI durchlaeuft beide Schritte.

Die Verstaerkung fuegt bei jedem Auftreten eine Figur im Haus und je
einen Start-Haus- und Zielplatz hinzu. Der neue Zielplatz liegt am Eingang;
bestehende Zielfiguren behalten ihre Position und ihren Sicherheitsstatus.
Zum Gewinnen muessen alle eigenen Figuren ins Ziel, auch die zusaetzlichen.

## Eisenbahn

In beiden Modi verlaeuft ein Gleis quer durch das Spielfeld. Zwischen
Durchfahrten liegen zufaellig zwei bis fuenf vollstaendige Tischrunden.
Der Zug faehrt vor dem naechsten Wurf und schickt Figuren an den beiden
Umlauf-Kreuzungen sowie ungesicherte Zielfiguren im Fahrweg zurueck ins Haus.
Hausfiguren und sichere Zielfiguren bleiben geschuetzt. Die Durchfahrt
wird animiert, vertont und sperrt Eingaben und KI bis zum Abschluss.

## Weitere Ereignisregeln

Das Wege-Ereignis erzeugt eine gruene Abkuerzung (vier Felder vorwaerts)
und eine orange Umleitung (drei Felder rueckwaerts). An einer Abzweigung
waehlt die Person ueber die Figuren-Buttons den normalen oder einen
Sonderweg; auch beim Anklicken einer Figur mit mehreren Wegen erscheint
diese Auswahl. Die KI bewertet ebenfalls die verschiedenen Wege.
Ein Sonderweg kostet einen Wuerfelschritt und ist pro Zug hoechstens
einmal nutzbar. Neue Wege ersetzen die vorherigen und bleiben bis zum
naechsten Wege-Ereignis bestehen. Figuren werden dabei nicht versetzt.
Sonderwege ueberspringen weder den eigenen Zieleingang noch fuehren sie
hinter das eigene Startfeld. Zielgassen bleiben unveraendert; Schlagen
und Feld-Ereignisse gelten nur am endgueltigen Landefeld.

Ein Raketenschlag schickt die getroffene ungesicherte Figur ins Haus;
sie bleibt im Spiel. Das Gluecksrad zeigt alle moeglichen Treffer mit
gleichen Chancen. Bereits gesicherte Zielfiguren sind ausgenommen.
Platztausch und neue Verteilung betreffen nur die Umlaufbahn.

Zwei Wuerfel bewegen **eine Figur um die Summe**. Ausziehen erfordert
**6 + 6**, waehrend mindestens eine 6 einen Zusatzwurf erlaubt.
Der Bonus gilt fuer die naechsten ein oder zwei eigenen vollstaendigen
Zuege, einschliesslich aller Zusatzwuerfe. Eine laufende Runde verbraucht
einen gerade erhaltenen Bonus nicht.

D10-/D4-Ereignisse gelten sofort und fuer zwei weitere vollstaendige
Zuege jeder aktiven Person; der aktuelle angebrochene Zug zaehlt nicht.
Ein neues Seiten-Ereignis ersetzt ein bestehendes. Bei D4 kann nicht
ausgezogen werden. Die CSS-3D-Wuerfel sind als kompakte Wuerfelkoerper
dargestellt; D4 und D10 nutzen Zahlen fuer den jeweiligen Wertebereich,
nicht geometrische Vier- oder Zehnflaechner.

Die detaillierten Regeln und Ereignisbeschreibungen sind im Spiel
ueber **Spielregeln** erreichbar. Neue Partien beginnen erst mit dem
Startbutton im Einrichtungsdialog. Lokale Spielstaende leben im aktuellen Tab;
Neuladen setzt lokale Partien zurueck. Internetpartien verwenden den publizierten
Server-Snapshot fuer die Wiederaufnahme.

## Entwicklung

```sh
npm test
```

Die Regellogik in `game.js` ist unabhaengig von der Oberflaeche und verwendet
fuer reproduzierbare Tests eine austauschbare Zufallsquelle. `app.js`
rendert Dialoge, Gluecksrad und CSS-3D-Wuerfel. `scene.js` rendert das
WebGL-Brett (DPI-Limit 1,7, einfache wiederverwendete Geometrien) und
animiert unabhaengige Vorher-/Nachher-Snapshots aus `animation.js`.
Die Regellogik wird nicht durch die Animation veraendert.
`landscape.js` animiert die Umgebung mit pausierender sichtbarer Zeit.
`sound.js` erzeugt die Soundeffekte per Web Audio und bietet eine
gemeinsame Stummschaltung.
`server.js` erlaubt nur die Browserdateien und die zwei benoetigten
Three.js-Buildmodule sowie das lokale QR-Modul; andere Dateien aus `node_modules` sind nicht
oeffentlich. Er lauscht ausschliesslich auf `127.0.0.1`.

## Drittanbieter-Lizenzen

Three.js und `qrcode-generator` werden lokal installiert, ohne CDN. Bei der
Bereitstellung ihrer ausgewaehlten Browsermodule muessen die MIT-Lizenz und
Copyright-Hinweise mitgeliefert werden. Pages kopiert `node_modules/three/LICENSE`
und `backend/THIRD_PARTY_NOTICES.txt` ins statische Artefakt; der Docker-Build
liefert diese Hinweise ebenfalls mit. Der kombinierte Hinweis enthaelt beide
Copyright-Vermerke und den vollstaendigen MIT-Lizenztext und ist unter
`/THIRD_PARTY_NOTICES.txt` erreichbar (auf Pages relativ zur Projekt-URL).
