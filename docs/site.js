/* moldqueen site, vanilla JS. Scroll-driven black-to-white tone, big live hover tiles,
   nav, scrollspy, and an EN/DE language toggle. No framework. */
(function () {
  "use strict";
  var root = document.documentElement;
  var nav = document.querySelector(".nav");

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function mixRGB(A, B, t) { return [Math.round(lerp(A[0], B[0], t)), Math.round(lerp(A[1], B[1], t)), Math.round(lerp(A[2], B[2], t))]; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function pretty(s) { return String(s).replace(/_/g, " "); }

  // ===================================================================== i18n
  var DE = {
    "nav.home": "Start",
    // ---- index: nav + hero ----
    "ix.skip": "Zum Inhalt springen",
    "ix.nav.design": "Konzept",
    "ix.nav.layouts": "Layouts",
    "ix.nav.app": "Zur Android-App",
    "ix.nav.esp": "ESP32-Einrichtung",
    "ix.nav.dev": "Entwickler",
    "ix.nav.about": "Über",
    "ix.nav.support": "Unterstützen",
    "ix.hero.eyebrow": "Open Source · API-first",
    "ix.hero.h1": "Klemmbaustein-Modelle über eine einzige, saubere Schnittstelle steuern.",
    "ix.hero.tag": "moldqueen steuert Bluetooth-LE-Modelle über eine dokumentierte WebSocket-Schnittstelle. Den Anfang macht Mould King.",
    "ix.hero.lead": "Oben ein smarter Web-Client, darunter ein austauschbarer Funkkern: ein Raspberry Pi, in der Hosentasche die Android-App oder ein winziges ESP32-Board. Alle drei steuern schon heute echte Modelle.",
    "ix.hero.btnApp": "Zur Android-App",
    "ix.hero.btnGit": "Auf GitHub ansehen",
    "ix.hero.nextImg": "Nächstes Bild",
    // ---- index: features ----
    "ix.feat.eyebrow": "Was es anders macht",
    "ix.feat.h2": "Thin Transport, smarter Client.",
    "ix.feat.lead": "Bei den meisten RC-Apps sind Modell und App fest verdrahtet. moldqueen trennt beides: In der Mitte sitzt eine schmale, dokumentierte Schnittstelle, und jede Seite kann sich unabhängig weiterentwickeln.",
    "ix.f1.num": "01 · API-first gedacht",
    "ix.f1.h3": "Die Schnittstelle ist das Produkt.",
    "ix.f1.p": "In der Mitte steht eine dokumentierte WebSocket-Schnittstelle. Der Funkkern überträgt nur einfache Kanalbefehle, sonst nichts. Die ganze Logik steckt im Client: welche Funktion auf welchen Kanal geht, das Invertieren, die Wegbegrenzung und ein Keepalive, das das Modell stoppt, sobald die Seite verstummt. Steuern kann alles, was die Schnittstelle bedient, egal ob Browser, Skript oder KI-Agent.",
    "ix.f2.num": "02 · Gamepad-Unterstützung",
    "ix.f2.h3": "Mit dem Controller fahren.",
    "ix.f2.p": "Koppel einen DualSense (oder irgendeinen Controller) per Bluetooth und leg los, auf dem Bagger genauso wie auf den generischen Layouts. Das funktioniert im Browser und in der Android-App, und die Touch-Bedienung bleibt parallel nutzbar. Die Belegung kannst du anpassen, die Voreinstellungen passen meist, und der Controller läuft durch dieselbe Sicherheitslogik wie Touch, bis hin zum STOP.",
    "ix.f3.num": "03 · Läuft überall",
    "ix.f3.h3": "Der Funk darf stehen, wo du willst.",
    "ix.f3.p": "Der Funk ist nur das eine Ende der Schnittstelle, also darf er stehen, wo es gerade passt: auf einem Raspberry Pi über rohes Bluetooth, in der eigenständigen Android-App ganz ohne Pi, auf einem winzigen ESP32-Board über WLAN, oder als Client vom Desktop oder aus einem Docker-Container, der auf einen entfernten Kern zeigt. Die Oberfläche bleibt in jedem Fall dieselbe.",
    // ---- index: layouts ----
    "ix.lay.eyebrow": "Layouts",
    "ix.lay.h2": "Ein Client, viele Maschinen.",
    "ix.lay.lead": "moldqueen startet mit der Auswahl: jedes Layout als Karte. Eins antippen, losfahren. <em>Modell</em>-Layouts sind auf eine bestimmte Maschine zugeschnitten, <em>generische</em> fahren alles mit bis zu zwölf Motoren.",
    "ix.gen.num": "Generische Layouts",
    "ix.gen.h3": "Ein Controller für jedes Modell mit zwölf Motoren.",
    "ix.gen.p": "Kein passendes Dashboard für genau dein Modell? Die generischen Layouts (ein Gamepad aus Klemmbausteinen und ein 12-Achsen-Raster) richten sich per geführtem Auto-Abgleich selbst auf deine Maschine ein. Du bewegst einen Stick, schaust, welcher Motor anspringt, und schon steht die Zuordnung. Danach fährst du per Touch oder Gamepad.",
    "ix.tiles.note": "Die Karten kommen live aus dem Projekt-Manifest. Die Abzeichen sind dieselben wie in der App: <strong>Generic</strong> oder <strong>Model</strong>, dazu das unterstützte Protokoll. <strong>MK4</strong> läuft heute, ein ausgegrautes <strong>MK6</strong> steht auf der <a href=\"#roadmap\">Roadmap</a>. Mit der Maus über eine Karte fahren, dann klappt sie auf.",
    // ---- index: get the app ----
    "ix.app.eyebrow": "Zur Android-App",
    "ix.app.h2": "Wähle deinen Funk.",
    "ix.app.lead": "Drei Funkkerne, eine Oberfläche. Alle sprechen dieselbe Schnittstelle; sie unterscheiden sich nur darin, wo der Funk sitzt: dein Handy, ein Raspberry Pi oder ein winziges ESP32-Board.",
    "ix.and.tag": "Menü: zum Öffnen darüberfahren",
    "ix.and.num": "Android · eigenständige App",
    "ix.and.h3": "Alles auf dem Handy.",
    "ix.and.p": "Eine App, die alles selbst mitbringt. Sie nutzt den Bluetooth-Funk des Handys, liefert die Oberfläche direkt auf dem Gerät und kommt ohne Pi und ohne Netzwerk aus.",
    "ix.and.btnGet": "Android-App herunterladen",
    "ix.and.dl": "Aktuelle signierte Version: <b>v0.1.2</b>. Lade <code>moldqueen-v0.1.2.apk</code> herunter, erlaube die Installation aus unbekannten Quellen und öffne sie. <b>F-Droid: <a href=\"https://gitlab.com/fdroid/fdroiddata/-/merge_requests/41291\" rel=\"noopener\" target=\"_blank\">MR !41291 in Prüfung</a>.</b>",
    "ix.and.src": "Oder selbst bauen, per USB:",
    "ix.and.muted": "Alle Builds und Release-Notizen findest du bei <a href=\"https://github.com/jrichter24/moldqueen/releases\" rel=\"noopener\" target=\"_blank\">GitHub Releases</a>.",
    "ix.pi.num": "Raspberry Pi · Steuerkern",
    "ix.pi.h3": "Der Referenz-Funk.",
    "ix.pi.p": "Lass den kompletten Funkkern auf einem Pi mit Bluetooth-LE-USB-Stick laufen und ruf die Oberfläche dann aus jedem Browser im Netzwerk auf:",
    "ix.pi.muted": "Die ganze Einrichtung, vom Auspacken bis zur ersten Fahrt, steht im <a href=\"https://github.com/jrichter24/moldqueen/blob/main/dev-docs/QUICKSTART.md\" rel=\"noopener\" target=\"_blank\">Quickstart</a>.",
    "ix.esp.num": "ESP32 · eigenständiger Funkkern",
    "ix.esp.h3": "Der kleinste Funk.",
    "ix.esp.p": "Ein dritter Funkkern auf einem winzigen, günstigen ESP32-S3-Board: ein sauber neu geschriebener C-Codec, derselbe Bluetooth-LE-Advertiser und dieselbe WebSocket-Schnittstelle über WLAN. Es ist ein eigenständiges Gerät zum Loslegen. Nichts ist fest hinterlegt: flashen, dann fragt eine gebrandete Einrichtungsseite nach deinem WLAN. Danach hängt es in deinem Netz und du erreichst es per Name, ganz ohne IP-Suche. Kein Pi, kein Handy, nur das Board.",
    "ix.esp.muted": "Beim ersten Start öffnet das Board ein Einrichtungs-WLAN (<code>moldqueen-setup</code>) für die Netzwerkdaten; danach ist es als <code>moldqueenesp.local</code> auffindbar, mit eingebauter Verwaltungsseite unter <a href=\"#esp-setup\">moldqueenesp.local:8080</a>. Folge der Einrichtung unten oder sieh in den Ordner <a href=\"https://github.com/jrichter24/moldqueen/tree/main/esp32-core\" rel=\"noopener\" target=\"_blank\">esp32-core</a>.",
    // ---- index: docker client ----
    "ix.dock.p": "Du hast schon einen Funkkern laufen? Ein veröffentlichter, öffentlicher Container liefert allein die Web-Oberfläche aus, ohne Python und ohne Build. Er hostet den Client über <code>http://localhost</code> und verbindet sich damit direkt mit einem einfachen <code>ws://</code>-Gerät in deinem Netz. Das ist eine echte lokale Hosting-Option, um dein eigenes Gerät zu steuern, keine gehostete Demo.",
    "ix.dock.btn": "Docker-Image holen",
    "ix.dock.muted": "Nutze <code>:latest</code> für den neuesten Build oder fixiere <code>:0.1.0</code> für die aktuelle Version. Der Host-Port ist die linke Zahl, also frei umlegbar (<code>-p 9090:8080</code>). Richte den Endpunkt auf <code>ws://moldqueenrasp.local:8765</code>, <code>ws://moldqueenesp.local:8765</code> oder die IP-Form. Details in <a href=\"https://github.com/jrichter24/moldqueen/blob/main/dev-docs/REMOTE_CLIENT.md\" rel=\"noopener\" target=\"_blank\">REMOTE_CLIENT.md</a>.",
    // ---- index: esp32 setup guide ----
    "ix.es.eyebrow": "ESP32-Einrichtung",
    "ix.es.h2": "Den ESP32 einrichten.",
    "ix.es.lead": "Sobald die Firmware geflasht ist, muss nichts mehr einkompiliert werden. Das Board hat keine WLAN-Zugangsdaten und öffnet beim ersten Mal sein eigenes Einrichtungsnetz. Dies sind die fünf Schritte vom frisch geflashten Board bis zum Fahren über WLAN.",
    "ix.es.n1": "Schritt 1 · Mit dem Einrichtungs-WLAN verbinden",
    "ix.es.s1": "Verbinde dich mit dem offenen WLAN <code>moldqueen-setup</code>, das das Board beim ersten Start aufspannt. Es braucht kein Passwort.",
    "ix.es.n2": "Schritt 2 · Einrichtungsseite öffnen",
    "ix.es.s2": "Öffne die Einrichtungsseite unter <code>http://192.168.4.1</code>. Sie ist gebrandet und zweisprachig und funktioniert vollständig offline.",
    "ix.es.n3": "Schritt 3 · Netzwerk und Port wählen",
    "ix.es.s3": "Wähle dein Netzwerk aus der gescannten Liste, gib das Passwort ein, lege bei Bedarf den WebSocket-Port fest und speichere. Das Board startet neu und verbindet sich mit deinem WLAN.",
    "ix.es.n4": "Schritt 4 · Statusseite öffnen",
    "ix.es.s4": "Zurück in deinem eigenen Netz öffnest du die Statusseite unter <a href=\"http://moldqueenesp.local:8080\" rel=\"noopener\" target=\"_blank\"><code>http://moldqueenesp.local:8080</code></a>. Gefunden wird es per Name, es gibt also keine IP nachzuschlagen.",
    "ix.es.n5": "Schritt 5 · Das Board verwalten",
    "ix.es.s5": "Von dort verwaltest du das Board: Live-Status, Neustart, Zurück ins Einrichtungs-WLAN oder Netzwerk wechseln. Richte den Client-Endpunkt auf <code>ws://moldqueenesp.local:&lt;port&gt;</code> und fahr los.",
    "ix.es.prev": "Vorheriger Schritt",
    "ix.es.next": "Nächster Schritt",
    "ix.es.stepOf": "Schritt 1 von 5",
    "ix.es.zoomClose": "Vergrößertes Bild schließen",
    "ix.es.note": "Es werden keine Zugangsdaten in Git oder der Binärdatei gespeichert. Die vollständige schriftliche Anleitung steht in <a href=\"https://github.com/jrichter24/moldqueen/blob/main/dev-docs/ESP32_SETUP.md\" rel=\"noopener\" target=\"_blank\">ESP32_SETUP.md</a>; Build- und Flash-Hinweise stehen im Ordner <a href=\"https://github.com/jrichter24/moldqueen/tree/main/esp32-core\" rel=\"noopener\" target=\"_blank\">esp32-core</a>.",
    "ix.es.btnFw": "ESP32-Firmware herunterladen (.bin)",
    "ix.es.fw": "Aktuelle Version: <b>esp-v0.1.0</b>. Lade <code>moldqueen-esp32-&lt;tag&gt;.bin</code> herunter und flashe das einzelne Image an Offset <code>0x0</code>: <code>esptool.py --chip esp32s3 write_flash 0x0 moldqueen-esp32-&lt;tag&gt;.bin</code>.",
    // ---- index: developers ----
    "ix.dev.eyebrow": "Für Entwickler",
    "ix.dev.h2": "Zum Auseinandernehmen gebaut.",
    "ix.dev.lead": "Im Mittelpunkt steht die Schnittstelle. Der Funkkern ist reiner Transport: Er kümmert sich um den Funk und den Sicherheits-Ablauf, mehr nicht. Der smarte Client hält die Kanalzuordnung und übersetzt jede Funktion in einen einfachen Kanalbefehl. So lässt sich die eine Seite austauschen, ohne die andere anzufassen.",
    "ix.dev.k1": "Raspberry-Pi-Kern",
    "ix.dev.v1": "Python und rohes Bluetooth-HCI, der Referenz-Funkkern. <a href=\"https://github.com/jrichter24/moldqueen/blob/main/linux-core/README.md\" rel=\"noopener\" target=\"_blank\">linux-core</a>",
    "ix.dev.k2": "Android-Kern",
    "ix.dev.v2": "Kotlin, ein nativer BLE-Advertiser, dieselbe API direkt auf dem Gerät. <a href=\"https://github.com/jrichter24/moldqueen/blob/main/dev-docs/ANDROID.md\" rel=\"noopener\" target=\"_blank\">ANDROID.md</a>",
    "ix.dev.k5": "ESP32-Kern",
    "ix.dev.v5": "C und ESP-IDF, ein NimBLE-Advertiser, dieselbe API über WLAN. <a href=\"https://github.com/jrichter24/moldqueen/tree/main/esp32-core\" rel=\"noopener\" target=\"_blank\">esp32-core</a>",
    "ix.dev.k3": "Desktop-Dev-Client",
    "ix.dev.v3": "Die Oberfläche lokal gegen einen entfernten Kern ausliefern, ohne Build. <a href=\"https://github.com/jrichter24/moldqueen/blob/main/dev-docs/DEV_CLIENT.md\" rel=\"noopener\" target=\"_blank\">DEV_CLIENT.md</a>",
    "ix.dev.k4": "Docker",
    "ix.dev.v4": "Ein veröffentlichtes, öffentliches Nur-Client-Image, ein Befehl, kein Build. <a href=\"https://github.com/jrichter24/moldqueen/pkgs/container/moldqueen-client\" rel=\"noopener\" target=\"_blank\">ghcr-Paket</a> · <a href=\"https://github.com/jrichter24/moldqueen/blob/main/dev-docs/REMOTE_CLIENT.md\" rel=\"noopener\" target=\"_blank\">REMOTE_CLIENT.md</a>",
    "ix.dev.callout": "<strong>Das Protokoll.</strong> Gesteuert wird über herstellereigene Bluetooth-LE-Advertisements: ein Telegramm aus zwölf Nibble-Kanälen (MK4), das alle verbundenen Hubs gleichzeitig ansteuert. Der Codec ist Byte für Byte gegen die offizielle App geprüft. Vollständige Referenz in <a href=\"https://github.com/jrichter24/moldqueen/blob/main/dev-docs/PROJECT.md\" rel=\"noopener\" target=\"_blank\">PROJECT.md</a> und im maschinenlesbaren <a href=\"https://github.com/jrichter24/moldqueen/blob/main/linux-core/mk4web/asyncapi.yaml\" rel=\"noopener\" target=\"_blank\">AsyncAPI</a>.",
    "ix.dev.p": "Du willst dein eigenes Modell ergänzen? Ein Layout besteht nur aus Client-Dateien: ein Manifest-Eintrag, eine schlanke Seite und eine Kanalzuordnung. Die gemeinsame Oberfläche (Menü, Einstellungen, Verbindungsassistent, Gamepad, STOP) bekommst du geschenkt. Sieh dir <a href=\"https://github.com/jrichter24/moldqueen/blob/main/dev-docs/ADDING_A_LAYOUT.md\" rel=\"noopener\" target=\"_blank\">Adding a layout</a> und die übrigen <a href=\"https://github.com/jrichter24/moldqueen/tree/main/dev-docs\" rel=\"noopener\" target=\"_blank\">Entwickler-Docs</a> an. Issues und Pull Requests sind auf <a href=\"https://github.com/jrichter24/moldqueen\" rel=\"noopener\" target=\"_blank\">GitHub</a> willkommen.",
    // ---- index: support ----
    "ix.sup.eyebrow": "Unterstützen",
    "ix.sup.h2": "Unterstütze das Projekt.",
    "ix.sup.lead": "moldqueen ist frei und quelloffen, ein Hobbyprojekt aus der Freizeit. Wenn es dir nützt, kannst du es auf GitHub sponsern oder mir einen Kaffee spendieren. Keine Werbung, keine Affiliate-Links, keine Hintergedanken.",
    "ix.sup.btnGh": "Auf GitHub unterstützen",
    "ix.sup.btn": "Spendier mir einen Kaffee",
    // ---- index: roadmap ----
    "ix.rm.eyebrow": "Roadmap",
    "ix.rm.h2": "Wohin es geht.",
    "ix.rm.lead": "Eine Richtung, keine Versprechen. Roter Faden ist das API-first-Design: Jeder Punkt ist entweder ein neuer Funkkern hinter derselben Schnittstelle oder ein neuer Client, der sie bedient.",
    "ix.rm.mk6": "<b>MK6-Protokoll.</b> <span>Ein zweiter Telegramm-Codec für Mould Kings MK6-Hubs (byteweises Format). Dafür sind die ausgegrauten MK6-Abzeichen an den generischen Layouts schon reserviert.</span>",
    "ix.rm.esp": "<b>ESP32-Fertigstellung.</b> <span>Der ESP32-Kern ist ein eigenständiges Gerät zum Loslegen: WLAN-Einrichtung am Board, Auffinden als <code>moldqueenesp.local</code>, eine Verwaltungsseite, mDNS für den Pi (<code>moldqueenrasp.local</code> für den Raspberry-Pi-Kern) und eine Binary-/Release-Pipeline (eine herunterladbare <code>.bin</code>) sind alle vorhanden. Als Nächstes kommt das Ausliefern des Clients aus dem Flash.</span>",
    "ix.rm.cam": "<b>Kamera (FPV).</b> <span>Ein Live-Bild aus Sicht der Maschine, du fährst also nach dem, was sie sieht. Denselben Stream könnte später ein autonomer Fahrer nutzen.</span>",
    "ix.rm.tof": "<b>Time-of-Flight-Sensor.</b> <span>Abstand und Hindernisse als Telemetrie, parallel zur Steuer-Schnittstelle.</span>",
    "ix.rm.ai": "<b>KI-Steuerung.</b> <span>Ein Agent, der über dieselbe WebSocket-Schnittstelle selbstständig fährt. Dank der Thin-Transport-Trennung ist das ein neuer Client, kein Umbau.</span>",
    "ix.rm.note": "Alle Details in <a href=\"https://github.com/jrichter24/moldqueen/blob/main/dev-docs/ROADMAP.md\" rel=\"noopener\" target=\"_blank\">ROADMAP.md</a>.",
    // ---- index: about ----
    "ix.ab.eyebrow": "Über",
    "ix.ab.h2": "Ein unabhängiges Hobbyprojekt.",
    "ix.ab.p1": "moldqueen ist ein privates, quelloffenes Hobbyprojekt, um ferngesteuerte Klemmbaustein-Modelle über Bluetooth-LE zu steuern. Den Anfang macht Mould King, der Aufbau lässt aber bewusst Platz für weitere Marken.",
    "ix.ab.discH": "Haftungsausschluss",
    "ix.ab.disc": "Ein privates, inoffizielles Hobbyprojekt. Es steht in <strong>keiner</strong> Verbindung zu <strong>Mould King</strong> / Shenzhen Yuxing und wird von dort weder genehmigt noch unterstützt oder gesponsert. „Mould King“ und verwandte Marken gehören ihren jeweiligen Inhabern und werden hier nur beschreibend verwendet, zur Interoperabilität. Das Protokoll wurde für die Interoperabilität mit Hardware nachgebaut, die dem Autor gehört, zu Bildungs- und privaten Zwecken.",
    "ix.ab.credH": "Danksagungen",
    "ix.ab.cred": "Die <code>MouldKingCrypt</code>-Verschlüsselung ist Byte für Byte aus <a href=\"https://github.com/J0EK3R/mkconnect-python\" rel=\"noopener\" target=\"_blank\">J0EK3R/mkconnect-python</a> portiert (MIT, © 2024 J0EK3R); von dort stammt auch die Grundlage für das MK4/MK6-Protokoll. <a href=\"https://github.com/imurvai/brickcontroller2\" rel=\"noopener\" target=\"_blank\">BrickController2</a> diente als weitere Protokoll-Referenz. Vollständige Nennung in <a href=\"https://github.com/jrichter24/moldqueen/blob/main/THIRD-PARTY-NOTICES.md\" rel=\"noopener\" target=\"_blank\">THIRD-PARTY-NOTICES.md</a>.",
    "ix.ab.builtH": "Wie es entstanden ist",
    "ix.ab.built": "moldqueen ist mit KI-Unterstützung entstanden: die frühe Arbeit mit Claude (Fable), die spätere mit Claude Opus 4.8. KI-Coding-Assistenten halfen bei der Umsetzung. Architektur, Produktentscheidungen, Tests und das finale Code-Review blieben in menschlicher Hand.",
    "ix.ab.authH": "Autor",
    "ix.ab.auth": "Entwickelt von Dr. Jens Richter. Hintergrund in Physik und Elektrotechnik; hauptberuflich Tourenoptimierung mit genetischen und KI-Algorithmen bei <a href=\"https://www.dna-evolutions.com/\" rel=\"noopener\" target=\"_blank\">DNA Evolutions</a>. Auf <a href=\"https://www.linkedin.com/in/li-jens-richter\" rel=\"noopener\" target=\"_blank\">LinkedIn</a> erreichst du mich. <span class=\"muted\">Entstanden für meinen Sohn Jonas, der Bagger und Hubschrauber liebt.</span>",
    "ix.ab.attrH": "Nennung &amp; Weitergabe",
    "ix.ab.attrP": "Du baust auf moldqueen auf oder forkst es? Über eine Nennung freue ich mich. Es steht unter der MIT-Lizenz, das ist also eine Bitte, keine Pflicht. Eine Zeile wie diese in deiner README oder im Info-Bereich reicht völlig:",
    "ix.ab.attrSnip": "Erstellt mit moldqueen (https://github.com/jrichter24/moldqueen)",
    "ix.ab.licH": "Lizenz",
    "ix.ab.lic": "Veröffentlicht unter der <a href=\"https://github.com/jrichter24/moldqueen/blob/main/LICENSE\" rel=\"noopener\" target=\"_blank\">MIT-Lizenz</a>.",
    "ix.ab.support": "Gefällt dir das Projekt? Du kannst mir <a href=\"https://ko-fi.com/A437HBY\" rel=\"noopener\" target=\"_blank\">auf Ko-fi einen Kaffee spendieren ☕</a>.",
    "ix.foot.privacy": "Datenschutz",
    "ix.foot.license": "Lizenz (MIT)",
    "ix.foot.sponsor": "💜 Sponsern",
    "ix.foot.support": "☕ Kaffee",
    "ix.foot.fine": "Ein unabhängiges, inoffizielles Hobbyprojekt. Keine Verbindung zu Mould King / Shenzhen Yuxing; Markennamen dienen nur der Beschreibung und der Interoperabilität.",
    // ---- privacy ----
    "pp.eyebrow": "Rechtliches",
    "pp.h1": "Datenschutzerklärung",
    "pp.lead": "Für die moldqueen-App und diese Website. Zuletzt aktualisiert am 23. Juni 2026.",
    "pp.inshort": "<strong>Kurz gesagt:</strong> moldqueen ist eine <strong>lokale Bluetooth-Steuerung</strong>. Keine <strong>Benutzerkonten</strong>, keine <strong>personenbezogenen Daten</strong>, keine <strong>Analyse- oder Werbe-SDKs</strong>, und es geht <strong>nichts</strong> an einen Server des Entwicklers. Die App spricht nur mit deinem Modell über Bluetooth und mit ihrer eigenen Steueroberfläche auf deinem Gerät oder im lokalen Netz.",
    "pp.whoH": "Worum es geht",
    "pp.whoP": "moldqueen ist ein privates, unabhängiges, quelloffenes Projekt von Dr. Jens Richter („der Entwickler“). Diese Erklärung gilt für die <strong>moldqueen-App</strong> (die Android-App, die Raspberry-Pi-Software und die ESP32-Firmware) und für diese <strong>Website</strong>. Auch die ESP32-Firmware erhebt nichts: Das WLAN-Netz und das Passwort, die du bei der Einrichtung eingibst, werden nur lokal im Flash des Boards gespeichert, nichts ist vorausgefüllt, und sie stellt eine ungeschützte Verwaltungsseite und Steuerverbindung ausschließlich im lokalen Netzwerk bereit und sendet nichts an einen Server.",
    "pp.dataH": "Welche Daten die App erhebt",
    "pp.dataP": "Keine, die dein Gerät verlassen. Die App legt keine Konten an, fragt keine persönlichen Angaben ab und enthält keine Analyse-, Werbe-, Absturzbericht- oder Tracking-Bibliotheken. Sie erfasst keine Gerätekennungen, Kontakte, keinen Standort und keine Nutzungsprofile.",
    "pp.storeH": "Was auf deinem Gerät gespeichert wird",
    "pp.storeP": "Damit deine Einrichtung erhalten bleibt, speichert die App Einstellungen <strong>lokal auf deinem eigenen Gerät</strong> (im App-Speicher oder im lokalen Speicher des Browsers). Dazu gehört etwa:",
    "pp.storeLi1": "Kanalzuordnungen und Einstellungen je Funktion für jedes Modell-Layout;",
    "pp.storeLi2": "dein gewählter Steuer-Endpunkt, die Oberflächensprache und die Gamepad-Belegung.",
    "pp.storeP2": "Diese Daten bleiben auf dem Gerät und werden nie an den Entwickler übertragen. Du kannst sie jederzeit löschen, indem du die App-Daten (Android) oder die Website-Daten deines Browsers leerst.",
    "pp.permH": "Berechtigungen",
    "pp.btH": "Bluetooth",
    "pp.btP": "Wird <strong>nur</strong> verwendet, um Steuersignale an dein Klemmbaustein-Modell zu senden. Die App sendet Befehle über Bluetooth Low Energy; sie sucht keine fremden Geräte, identifiziert oder verbindet sich nicht mit ihnen und nutzt Bluetooth nicht, um deinen Standort zu bestimmen.",
    "pp.netH": "Netzwerk / Internet (Android)",
    "pp.netP": "Wird nur dafür genutzt, dass die App ihre <strong>eigene</strong> Oberfläche über die lokale Loopback-Adresse (<code>127.0.0.1</code>) an die Ansicht auf dem Gerät ausliefern kann, und um Steuerverbindungen von einem Browser anzunehmen, den du im <strong>lokalen Netzwerk</strong> darauf richtest. Die App sendet deine Daten nicht an externe Server.",
    "pp.siteH": "Diese Website",
    "pp.siteP": "Diese Seite ist statisch und wird in der Regel über GitHub Pages gehostet; beim Besuch ist GitHub der Host, dessen eigene Datenschutzpraxis für Server-Logs gilt. Die Seite setzt keine Tracking-Cookies und enthält keine Analyse. Der Bereich „Layouts“ lädt eine öffentliche, nicht personenbezogene Datei (das Layout-Manifest des Projekts) von GitHub, um die aktuellen Layouts anzuzeigen. <strong>Die App selbst enthält keine Affiliate-Links und stellt keine solchen Anfragen.</strong>",
    "pp.childH": "Kinder",
    "pp.childP": "Die App richtet sich nicht an Kinder und erhebt von niemandem personenbezogene Daten, unabhängig vom Alter.",
    "pp.thirdH": "Dienste von Dritten",
    "pp.thirdP": "Die App bindet keine Analyse-, Werbe- oder Social-SDKs von Dritten ein. Sie ist quelloffen, du kannst also alles in dieser Erklärung im Code nachprüfen.",
    "pp.changeH": "Änderungen",
    "pp.changeP": "Diese Erklärung kann sich mit der App weiterentwickeln. Käme zum Beispiel später eine optionale Funktion wie ein Kamerastream hinzu, würde sie hier beschrieben und bliebe lokal, sofern nichts anderes angegeben ist. Wesentliche Änderungen erkennst du am Datum „zuletzt aktualisiert“ oben.",
    "pp.contactH": "Kontakt",
    "pp.contactP": "Fragen zum Datenschutz? Öffne ein Issue auf <a href=\"https://github.com/jrichter24/moldqueen/issues\" rel=\"noopener\" target=\"_blank\">GitHub</a> oder schreib an <a href=\"mailto:jens.richter@dna-evolutions.com\">jens.richter@dna-evolutions.com</a>.",
    "pp.foot.fine": "Ein unabhängiges, inoffizielles Hobbyprojekt. Keine Verbindung zu Mould King / Shenzhen Yuxing.",
  };

  var META_TITLE = {
    index: { en: "moldqueen: open control for building-block RC toys", de: "moldqueen: offene Steuerung für ferngesteuerte Klemmbaustein-Modelle" },
    privacy: { en: "Privacy Policy · moldqueen", de: "Datenschutz · moldqueen" }
  };
  // "Step N of M" indicator template ($N = current, $M = total). Kept here (not as a
  // plain data-i18n string) because it interpolates the live step number.
  var STEP_OF = { en: "Step $N of $M", de: "Schritt $N von $M" };
  var TILE = {
    genericController: { en: "Generic controller", de: "Generischer Controller" },
    motors: { en: "motors", de: "Motoren" },
    functions: { en: "functions", de: "Funktionen" },
    cat: { vehicle: { en: "Vehicle", de: "Fahrzeug" } },
    failNone: { en: "No active layouts found.", de: "Keine aktiven Layouts gefunden." },
    failLoad: { en: "Couldn't load the live layout list right now.", de: "Die Live-Layout-Liste lässt sich gerade nicht laden." },
    failTail: { en: ' Browse them in the <a href="$REPO" rel="noopener">repository</a>.', de: ' Sieh sie dir im <a href="$REPO" rel="noopener">Repository</a> an.' }
  };

  var page = /privacy\.html$/.test(location.pathname) ? "privacy"
           : /inspiration\.html$/.test(location.pathname) ? "inspiration" : "index";

  var i18nEls = Array.prototype.slice.call(document.querySelectorAll("[data-i18n]"));
  var EN = {};
  i18nEls.forEach(function (el) { EN[el.getAttribute("data-i18n")] = el.innerHTML; });
  // Elements whose aria-label is translated (key reused from the DE/EN dictionaries).
  var ariaEls = Array.prototype.slice.call(document.querySelectorAll("[data-i18n-aria]"));
  ariaEls.forEach(function (el) {
    var k = el.getAttribute("data-i18n-aria");
    if (EN[k] == null) EN[k] = el.getAttribute("aria-label") || "";
  });

  var curLang = "en";
  try { if (localStorage.getItem("mq_lang") === "de") curLang = "de"; } catch (e) {}
  function tl(o) { return (curLang === "de" && o && o.de) ? o.de : (o ? o.en : ""); }

  function applyLang(lang) {
    curLang = (lang === "de") ? "de" : "en";
    i18nEls.forEach(function (el) {
      var k = el.getAttribute("data-i18n");
      var v = (curLang === "de" && DE[k] != null) ? DE[k] : EN[k];
      if (v != null) el.innerHTML = v;
    });
    ariaEls.forEach(function (el) {
      var k = el.getAttribute("data-i18n-aria");
      var v = (curLang === "de" && DE[k] != null) ? DE[k] : EN[k];
      if (v != null) el.setAttribute("aria-label", v);
    });
    root.setAttribute("lang", curLang);
    var t = META_TITLE[page]; if (t) document.title = (curLang === "de" && t.de) ? t.de : t.en;
    try { localStorage.setItem("mq_lang", curLang); } catch (e) {}
    document.querySelectorAll(".langbtn").forEach(function (b) {
      var on = b.getAttribute("data-lang") === curLang;
      b.classList.toggle("active", on); b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (lastCards) renderTiles();
    if (typeof refreshStepper === "function") refreshStepper();
  }
  document.querySelectorAll(".langbtn").forEach(function (b) {
    b.addEventListener("click", function () { applyLang(b.getAttribute("data-lang")); });
  });

  // ===================================================================== scroll tone
  var DARK_BG = [9, 11, 15], LIGHT_BG = [241, 243, 246];
  var LIGHT_INK = [237, 241, 246], DARK_INK = [18, 22, 30];
  var DARK_ACC = [96, 178, 233], LIGHT_ACC = [27, 105, 160];
  var anchor = document.getElementById("app");

  function progress() {
    if (!anchor) {
      var max = root.scrollHeight - window.innerHeight;
      return clamp01(max > 0 ? window.scrollY / max : 0);
    }
    var vh = window.innerHeight;
    var top = anchor.getBoundingClientRect().top;
    return clamp01((vh * 0.92 - top) / (vh * 0.92 - vh * 0.45));
  }
  function applyTone() {
    var L = progress();
    var bg = mixRGB(DARK_BG, LIGHT_BG, L);
    var ti = L < 0.47 ? 0 : 1;
    var ink = ti ? DARK_INK : LIGHT_INK;
    var acc = ti ? LIGHT_ACC : DARK_ACC;
    var haloA = clamp01(1 - Math.abs(L - 0.5) / 0.14) * 0.55;
    root.style.setProperty("--bg", "rgb(" + bg.join(",") + ")");
    root.style.setProperty("--bg-rgb", bg.join(","));
    root.style.setProperty("--ink", "rgb(" + ink.join(",") + ")");
    root.style.setProperty("--ink-rgb", ink.join(","));
    root.style.setProperty("--accent", "rgb(" + acc.join(",") + ")");
    root.style.setProperty("--accent-rgb", acc.join(","));
    root.style.setProperty("--halo-rgb", ti < 0.5 ? "0,0,0" : "255,255,255");
    root.style.setProperty("--halo-a", haloA.toFixed(3));
  }
  if (document.body.classList.contains("scroll-tone")) {
    var ticking = false;
    var onScroll = function () {
      if (nav) nav.classList.toggle("scrolled", window.scrollY > 8);
      if (!ticking) { ticking = true; requestAnimationFrame(function () { applyTone(); ticking = false; }); }
    };
    applyTone(); onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", applyTone, { passive: true });
  } else if (nav) {
    var ns = function () { nav.classList.toggle("scrolled", window.scrollY > 8); };
    ns(); window.addEventListener("scroll", ns, { passive: true });
  }

  // ===================================================================== nav toggle
  var toggle = document.querySelector(".navtoggle");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    nav.querySelectorAll(".navlinks a").forEach(function (a) {
      a.addEventListener("click", function () { nav.classList.remove("open"); toggle.setAttribute("aria-expanded", "false"); });
    });
  }

  // ===================================================================== scrollspy
  var links = Array.prototype.slice.call(document.querySelectorAll(".navlinks a[href^='#']"));
  if (links.length && "IntersectionObserver" in window) {
    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute("href").slice(1)] = a; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          links.forEach(function (l) { l.classList.remove("active"); });
          if (byId[e.target.id]) byId[e.target.id].classList.add("active");
        }
      });
    }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });
    Object.keys(byId).forEach(function (id) { var el = document.getElementById(id); if (el) io.observe(el); });
  }

  // ===================================================================== live tiles
  var grid = document.getElementById("tiles");
  var SRC = "https://raw.githubusercontent.com/jrichter24/moldqueen/main/client/web/layouts.json";
  var REPO = "https://github.com/jrichter24/moldqueen/tree/main/client/web";
  var IMG = {
    excavator: { src: "assets/excavator_tile.png", alt: "The excavator dashboard layout" },
    generic_brick: { src: "assets/brick_tile.png", alt: "The brick controller layout" },
    generic_12axis: { src: "assets/axis12_tile.png", alt: "The 12-axis controller layout" }
  };
  var lastCards = null;
  function failTiles(kind) {
    if (!grid) return;
    var msg = kind === "load" ? tl(TILE.failLoad) : tl(TILE.failNone);
    grid.innerHTML = '<div class="tiles-fail">' + esc(msg) + tl(TILE.failTail).replace("$REPO", REPO) + "</div>";
  }
  function renderTiles() {
    if (!grid || !lastCards) return;
    grid.innerHTML = lastCards.map(function (L) {
      var soon = L.protocolsSoon || [];
      var badge = L.generic ? '<span class="badge generic">Generic</span>' : '<span class="badge model">Model</span>';
      var protos = (L.protocols || []).map(function (p) {
        var s = soon.indexOf(p) >= 0;
        return '<span class="proto' + (s ? " soon" : "") + '"' + (s ? ' title="Coming soon"' : "") + ">" + esc(p.toUpperCase()) + "</span>";
      }).join("");
      var fns = L.functions || [];
      var noun = L.generic ? tl(TILE.motors) : tl(TILE.functions);
      var who = L.generic ? tl(TILE.genericController) : (TILE.cat[L.category] ? tl(TILE.cat[L.category]) : cap(L.category || "Model"));
      var sub = who + " · " + fns.length + " " + noun;
      var chips = fns.slice(0, 6).map(function (f) { return "<span>" + esc(pretty(f)) + "</span>"; }).join("") +
        (fns.length > 6 ? '<span>+' + (fns.length - 6) + "</span>" : "");
      var art = IMG[L.id];
      var img = art ? '<img src="' + art.src + '" alt="' + esc(art.alt) + '" loading="lazy" />' : "";
      return '<a class="tile' + (art ? "" : " tile-noimg") + '" href="' + REPO + '" rel="noopener" aria-label="' + esc(L.name) + ' layout">' +
        img + '<div class="scrim"></div>' +
        '<div class="t-badges">' + badge + protos + "</div>" +
        '<span class="open" aria-hidden="true">↗</span>' +
        '<div class="tbody">' +
          "<h3>" + esc(L.name) + "</h3>" +
          '<div class="t-sub">' + esc(sub) + "</div>" +
          '<p class="t-desc">' + esc(L.description || "") + "</p>" +
          '<div class="t-fns">' + chips + "</div>" +
        "</div></a>";
    }).join("");
  }
  if (grid) {
    fetch(SRC, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) {
        var cards = ((data && data.layouts) || []).filter(function (L) { return L.active !== false && L.card !== false && L.kind !== "placeholder"; });
        if (!cards.length) { failTiles("none"); return; }
        lastCards = cards; renderTiles();
      })
      .catch(function () { failTiles("load"); });
  }

  // ===================================================================== hero slider
  // Auto-rotating, restrained crossfade through the hero images. Pure CSS opacity
  // transition (.is-active); JS only swaps the active class. The slides and the manual
  // "next" arrow are ALWAYS wired. Only the auto-advance TIMER honours
  // prefers-reduced-motion (a click is explicit, so the arrow still advances). Pauses on
  // hover and when the tab is hidden.
  (function () {
    var slider = document.getElementById("heroSlider");
    if (!slider) return;
    var slides = Array.prototype.slice.call(slider.querySelectorAll(".hero-img"));
    if (slides.length < 2) return;
    var reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    var i = 0, timer = null, paused = false;
    var INTERVAL = 5000;
    function show(n) {
      slides[i].classList.remove("is-active");
      i = (n + slides.length) % slides.length;
      slides[i].classList.add("is-active");
    }
    function tick() { if (!paused && !document.hidden) show(i + 1); }
    function start() { if (reduce) return; if (!timer) timer = setInterval(tick, INTERVAL); }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    slider.addEventListener("mouseenter", function () { paused = true; });
    slider.addEventListener("mouseleave", function () { paused = false; });
    document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); else start(); });

    // manual advance: next image + reset the timer so it doesn't tick immediately after
    var nextBtn = document.getElementById("heroNext");
    if (nextBtn) nextBtn.addEventListener("click", function () { show(i + 1); stop(); start(); });

    start();
  })();

  // ===================================================================== ESP32 step slider
  // User-paced setup walkthrough: one step visible at a time, NEXT/PREV + clickable dots,
  // a "Step N of 5" indicator, and left/right arrow keys when the slider is focused.
  // Degrades to a plain vertical stack of all 5 steps when JS is off (.no-js fallback CSS).
  var refreshStepper = null;
  (function () {
    var stepper = document.getElementById("espStepper");
    if (!stepper) return;
    var steps = Array.prototype.slice.call(stepper.querySelectorAll(".step"));
    if (!steps.length) return;
    var prevBtn = stepper.querySelector(".step-prev");
    var nextBtn = stepper.querySelector(".step-next");
    var dotsWrap = stepper.querySelector(".step-dots");
    var indicator = stepper.querySelector(".step-indicator span");
    var total = steps.length;
    var cur = 0;

    stepper.classList.remove("no-js");      // upgrade: show one step at a time
    stepper.setAttribute("tabindex", "0");
    stepper.setAttribute("role", "group");
    stepper.setAttribute("aria-roledescription", "carousel");

    // build dots
    var dots = [];
    if (dotsWrap) {
      for (var d = 0; d < total; d++) {
        (function (n) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "step-dot";
          b.setAttribute("role", "tab");
          b.setAttribute("aria-label", "Step " + (n + 1));
          b.addEventListener("click", function () { go(n); });
          dotsWrap.appendChild(b);
          dots.push(b);
        })(d);
      }
    }

    function indicatorText() {
      var tmpl = tl(STEP_OF) || "Step $N of $M";
      return tmpl.replace("$N", String(cur + 1)).replace("$M", String(total));
    }
    refreshStepper = function () {
      if (indicator) indicator.textContent = indicatorText();
    };
    function render() {
      steps.forEach(function (s, n) {
        var on = n === cur;
        s.classList.toggle("is-active", on);
        s.setAttribute("aria-hidden", on ? "false" : "true");
      });
      dots.forEach(function (b, n) {
        var on = n === cur;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
      if (prevBtn) prevBtn.disabled = (cur === 0);
      if (nextBtn) nextBtn.disabled = (cur === total - 1);
      stepper.setAttribute("data-step", String(cur));
      refreshStepper();
    }
    function go(n) { cur = (n < 0 ? 0 : n >= total ? total - 1 : n); render(); }

    if (prevBtn) prevBtn.addEventListener("click", function () { go(cur - 1); });
    if (nextBtn) nextBtn.addEventListener("click", function () { go(cur + 1); });
    stepper.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { go(cur - 1); e.preventDefault(); }
      else if (e.key === "ArrowRight") { go(cur + 1); e.preventDefault(); }
    });

    // ---- click-to-zoom lightbox: clicking the current screenshot opens it full-size ----
    var lb = document.getElementById("espLightbox");
    var lbImg = document.getElementById("espLightboxImg");
    var lbCap = document.getElementById("espLightboxCap");
    var lbClose = document.getElementById("espLightboxClose");
    if (lb && lbImg && lbCap && lbClose) {
      var lastFocus = null;
      function openLb(step) {
        var img = step.querySelector(".shot");
        var num = step.querySelector(".step-copy .num");
        var desc = step.querySelector(".step-copy p");
        if (!img) return;
        lbImg.src = img.currentSrc || img.src;
        lbImg.alt = img.getAttribute("alt") || "";
        var cap = num ? num.textContent : "";
        if (desc) cap += (cap ? " - " : "") + desc.textContent;
        lbCap.textContent = cap;
        lastFocus = document.activeElement;
        lb.hidden = false;
        document.body.classList.add("lb-open");
        lbClose.focus();
      }
      function closeLb() {
        if (lb.hidden) return;
        lb.hidden = true;
        document.body.classList.remove("lb-open");
        if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
      }
      steps.forEach(function (s) {
        var img = s.querySelector(".shot");
        if (!img) return;
        img.classList.add("zoomable");
        img.addEventListener("click", function () { if (s.classList.contains("is-active")) openLb(s); });
      });
      lb.addEventListener("click", function (e) {
        // closest(): clicking the X lands on its inner <svg>/<path> (no data-close);
        // walk up to the button/backdrop that carries data-close so the X closes too.
        if (e.target.closest("[data-close]")) closeLb();
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && !lb.hidden) closeLb();
      });
      // keep focus inside the dialog (single focusable: the close button)
      lb.addEventListener("keydown", function (e) {
        if (e.key === "Tab") { e.preventDefault(); lbClose.focus(); }
      });
    }

    render();
  })();

  // ===================================================================== boot
  applyLang(curLang);
  var y = document.getElementById("year"); if (y) y.textContent = new Date().getFullYear();
})();
