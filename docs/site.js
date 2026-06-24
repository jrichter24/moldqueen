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
    "ix.nav.app": "Zur App",
    "ix.nav.dev": "Entwickler",
    "ix.nav.about": "Über",
    "ix.hero.eyebrow": "Open Source · API-first",
    "ix.hero.h1": "Klemmbaustein-Modelle über eine einzige, klare Schnittstelle steuern.",
    "ix.hero.tag": "Es steuert Bluetooth-LE-Modelle über einen dokumentierten WebSocket-Vertrag. Mould King kommt zuerst.",
    "ix.hero.lead": "Es gibt einen smarten Web-Client und darunter einen austauschbaren Funkkern: heute ein Raspberry Pi, in der Hosentasche die Android-App, später vielleicht ein ESP32.",
    "ix.hero.btnApp": "Zur App",
    "ix.hero.btnGit": "Auf GitHub ansehen",
    // ---- index: features ----
    "ix.feat.eyebrow": "Was es anders macht",
    "ix.feat.h2": "Thin Transport, smarter Client.",
    "ix.feat.lead": "Die meisten RC-Apps verdrahten Modell und App fest miteinander. moldqueen hält beides getrennt: In der Mitte steht ein dokumentierter Vertrag, und jede Seite kann sich für sich ändern.",
    "ix.f1.num": "01 · API-first gedacht",
    "ix.f1.h3": "Der Vertrag ist das Produkt.",
    "ix.f1.p": "Es gibt einen dokumentierten WebSocket-Vertrag. Der Funkkern überträgt nur einfache Kanalbefehle. Alles andere steckt im Client: welche Funktion auf welchen Kanal geht, Invertierung, Wegbegrenzung und ein Keepalive, das das Modell anhält, sobald die Seite verstummt. Steuern kann alles, was den Vertrag spricht, ob Browser, Skript oder Agent.",
    "ix.f2.num": "02 · Gamepad-Unterstützung",
    "ix.f2.h3": "Mit dem Controller fahren.",
    "ix.f2.p": "Verbinde einen DualSense (oder einen beliebigen Controller) per Bluetooth und fahr los, auf dem Bagger wie auf den generischen Layouts. Das klappt im Browser und in der Android-App, und Touch funktioniert weiterhin. Die Belegung lässt sich anpassen, die Voreinstellungen sind sinnvoll, und der Controller läuft durch dieselbe Sicherheitslogik wie Touch, bis hin zum STOP.",
    "ix.f3.num": "03 · Läuft überall",
    "ix.f3.h3": "Den Funk dorthin, wo du willst.",
    "ix.f3.p": "Der Funk ist nur ein Ende des Vertrags, also kann er stehen, wo es passt: auf einem Raspberry Pi über rohes Bluetooth, in der eigenständigen Android-App ganz ohne Pi, oder als Client vom Desktop oder aus einem Docker-Container gegen einen entfernten Kern. Die Oberfläche bleibt jedes Mal dieselbe.",
    // ---- index: layouts ----
    "ix.lay.eyebrow": "Layouts",
    "ix.lay.h2": "Ein Client, viele Maschinen.",
    "ix.lay.lead": "Wenn du moldqueen öffnest, landest du in der Auswahl, jedes Layout als Karte. Eins antippen und losfahren. <em>Modell</em>-Layouts sind auf eine bestimmte Maschine zugeschnitten, <em>generische</em> steuern jedes Modell mit bis zu zwölf Motoren.",
    "ix.gen.num": "Generische Layouts",
    "ix.gen.h3": "Ein Controller für jedes Modell mit zwölf Motoren.",
    "ix.gen.p": "Kein Dashboard für genau dein Modell? Die generischen Layouts (ein Gamepad aus Klemmbausteinen und ein 12-Achsen-Raster) ordnen sich deiner Maschine über einen geführten Auto-Abgleich selbst zu. Du bewegst einen Stick, schaust, welcher Motor reagiert, fertig ist die Zuordnung. Danach fährst du per Touch oder Gamepad.",
    "ix.tiles.note": "Die Karten kommen live aus dem Projekt-Manifest. Die Abzeichen entsprechen der App: <strong>Generic</strong> oder <strong>Model</strong>, dazu das unterstützte Protokoll. <strong>MK4</strong> funktioniert heute; ein ausgegrautes <strong>MK6</strong> steht auf der <a href=\"#roadmap\">Roadmap</a>. Fahr mit der Maus über eine Karte, dann klappt sie auf.",
    // ---- index: get the app ----
    "ix.app.eyebrow": "Zur App",
    "ix.app.h2": "Wähle deinen Funk.",
    "ix.app.lead": "Es gibt zwei Wege loszufahren. Beide liefern dieselbe Oberfläche aus; der einzige Unterschied ist, wo der Bluetooth-Funk sitzt.",
    "ix.and.tag": "Menü: zum Öffnen mit der Maus darüber",
    "ix.and.num": "Android · eigenständige App",
    "ix.and.h3": "Alles auf dem Handy.",
    "ix.and.p": "Eine in sich geschlossene App. Sie nutzt den Bluetooth-Funk des Handys, liefert die Oberfläche direkt auf dem Gerät aus und braucht weder einen Pi noch ein Netzwerk. Vorerst ist es ein Entwickler-Build, den du über USB installierst:",
    "ix.and.muted": "Eine signierte, store-fertige Version steht auf der <a href=\"#roadmap\">Roadmap</a>. Builds und Notizen: <a href=\"https://github.com/jrichter24/moldqueen/releases\" rel=\"noopener\">GitHub Releases</a>.",
    "ix.pi.num": "Raspberry Pi · Steuerkern",
    "ix.pi.h3": "Der Referenz-Funk.",
    "ix.pi.p": "Lass den vollen Funkkern auf einem Pi mit Bluetooth-LE-USB-Stick laufen und öffne die Oberfläche dann von jedem Browser im Netzwerk:",
    "ix.pi.muted": "Die komplette Einrichtung, vom Auspacken bis zur ersten Fahrt, steht im <a href=\"https://github.com/jrichter24/moldqueen/blob/main/dev-docs/QUICKSTART.md\" rel=\"noopener\">Quickstart</a>.",
    // ---- index: developers ----
    "ix.dev.eyebrow": "Für Entwickler",
    "ix.dev.h2": "Zum Auseinandernehmen gebaut.",
    "ix.dev.lead": "Was zählt, ist der Vertrag. Der Funkkern ist ein dünner Transport: Er kümmert sich um den Funk und den Sicherheits-Lebenszyklus, mehr nicht. Der smarte Client besitzt die Kanalzuordnung und übersetzt jede Funktion in einen einfachen Kanalbefehl. Eine Seite lässt sich austauschen, ohne die andere anzufassen.",
    "ix.dev.k1": "Raspberry-Pi-Kern",
    "ix.dev.v1": "Python und rohes Bluetooth-HCI, der Referenz-Funkkern. <a href=\"https://github.com/jrichter24/moldqueen/blob/main/linux-core/README.md\" rel=\"noopener\">linux-core</a>",
    "ix.dev.k2": "Android-Kern",
    "ix.dev.v2": "Kotlin, ein nativer BLE-Advertiser, dasselbe API direkt auf dem Gerät. <a href=\"https://github.com/jrichter24/moldqueen/blob/main/dev-docs/ANDROID.md\" rel=\"noopener\">ANDROID.md</a>",
    "ix.dev.k3": "Desktop-Dev-Client",
    "ix.dev.v3": "Die Oberfläche lokal gegen einen entfernten Kern ausliefern, ohne Build. <a href=\"https://github.com/jrichter24/moldqueen/blob/main/dev-docs/DEV_CLIENT.md\" rel=\"noopener\">DEV_CLIENT.md</a>",
    "ix.dev.k4": "Docker",
    "ix.dev.v4": "Den Client als Container ausliefern, der auf deinen Pi zeigt. <a href=\"https://github.com/jrichter24/moldqueen/blob/main/dev-docs/REMOTE_CLIENT.md\" rel=\"noopener\">REMOTE_CLIENT.md</a>",
    "ix.dev.callout": "<strong>Das Protokoll.</strong> Gesteuert wird über herstellereigene Bluetooth-LE-Advertisements: ein Telegramm aus zwölf Nibble-Kanälen (MK4), das alle verbundenen Hubs gleichzeitig ansteuert. Der Codec ist Byte für Byte gegen die offizielle App geprüft. Vollständige Referenz in <a href=\"https://github.com/jrichter24/moldqueen/blob/main/dev-docs/PROJECT.md\" rel=\"noopener\">PROJECT.md</a> und im maschinenlesbaren <a href=\"https://github.com/jrichter24/moldqueen/blob/main/linux-core/mk4web/asyncapi.yaml\" rel=\"noopener\">AsyncAPI</a>.",
    "ix.dev.p": "Du willst dein eigenes Modell ergänzen? Ein Layout besteht nur aus Client-Dateien: ein Manifest-Eintrag, eine schlanke Seite und eine Kanalzuordnung. Die gemeinsame Oberfläche (Menü, Einstellungen, Verbindungsassistent, Gamepad, STOP) bekommst du geschenkt. Sieh dir <a href=\"https://github.com/jrichter24/moldqueen/blob/main/dev-docs/ADDING_A_LAYOUT.md\" rel=\"noopener\">Adding a layout</a> und die übrigen <a href=\"https://github.com/jrichter24/moldqueen/tree/main/dev-docs\" rel=\"noopener\">Entwickler-Docs</a> an. Issues und Pull Requests sind auf <a href=\"https://github.com/jrichter24/moldqueen\" rel=\"noopener\">GitHub</a> willkommen.",
    // ---- index: roadmap ----
    "ix.rm.eyebrow": "Roadmap",
    "ix.rm.h2": "Wohin es geht.",
    "ix.rm.lead": "Eine Richtung, keine Versprechen. Der rote Faden ist das API-first-Design: Jeder Punkt ist entweder ein neuer Funkkern hinter demselben Vertrag oder ein neuer Client, der ihn spricht.",
    "ix.rm.mk6": "<b>MK6-Protokoll.</b> <span>Ein zweiter Telegramm-Codec für Mould Kings byteweise MK6-Hubs. Dafür sind die ausgegrauten MK6-Abzeichen an den generischen Layouts schon reserviert.</span>",
    "ix.rm.esp": "<b>ESP32-Kern.</b> <span>Ein kleiner, günstiger dritter Funkkern, der von allein durchläuft und den Advertiser samt demselben API ausführt. Ganz ohne Pi oder Handy.</span>",
    "ix.rm.cam": "<b>Kamera (FPV).</b> <span>Ein Live-Bild aus Sicht der Maschine, sodass du nach dem fährst, was sie sieht. Derselbe Stream könnte später einen autonomen Fahrer speisen.</span>",
    "ix.rm.tof": "<b>Time-of-Flight-Sensor.</b> <span>Abstand und Hindernisse als Telemetrie, neben dem Steuer-API.</span>",
    "ix.rm.ai": "<b>KI-Steuerung.</b> <span>Ein Agent, der über denselben WebSocket-Vertrag selbstständig fährt. Dank der Thin-Transport-Trennung ist das ein neuer Client und kein Umbau.</span>",
    "ix.rm.note": "Alle Details in <a href=\"https://github.com/jrichter24/moldqueen/blob/main/dev-docs/ROADMAP.md\" rel=\"noopener\">ROADMAP.md</a>.",
    // ---- index: about ----
    "ix.ab.eyebrow": "Über",
    "ix.ab.h2": "Ein unabhängiges Hobbyprojekt.",
    "ix.ab.p1": "moldqueen ist ein privates, quelloffenes Hobbyprojekt zum Steuern von ferngesteuerten Klemmbaustein-Modellen über Bluetooth-LE. Mould King ist die erste unterstützte Marke, und der Aufbau lässt Platz für weitere.",
    "ix.ab.discH": "Haftungsausschluss",
    "ix.ab.disc": "Ein privates, inoffizielles Hobbyprojekt. Es steht in <strong>keiner</strong> Verbindung zu <strong>Mould King</strong> / Shenzhen Yuxing und ist von dort weder genehmigt noch unterstützt oder gesponsert. „Mould King“ und verwandte Marken gehören ihren Inhabern und werden hier nur beschreibend verwendet, zur Interoperabilität. Das Protokoll wurde zur Interoperabilität mit Hardware, die dem Autor gehört, nachgebaut, für Bildungs- und private Zwecke.",
    "ix.ab.credH": "Danksagungen",
    "ix.ab.cred": "Die <code>MouldKingCrypt</code>-Verschlüsselung ist Byte für Byte aus <a href=\"https://github.com/J0EK3R/mkconnect-python\" rel=\"noopener\">J0EK3R/mkconnect-python</a> portiert (MIT, © 2024 J0EK3R), von dort stammt auch die Grundlage zum MK4/MK6-Protokoll. <a href=\"https://github.com/imurvai/brickcontroller2\" rel=\"noopener\">BrickController2</a> diente als weitere Protokoll-Referenz. Vollständige Nennung in <a href=\"https://github.com/jrichter24/moldqueen/blob/main/THIRD-PARTY-NOTICES.md\" rel=\"noopener\">THIRD-PARTY-NOTICES.md</a>.",
    "ix.ab.builtH": "Wie es entstanden ist",
    "ix.ab.built": "moldqueen ist mit Hilfe von KI-Assistenten entstanden. Die frühe Arbeit lief mit Claude (Fable), die spätere mit Claude Opus 4.8. Alle Entwurfsentscheidungen und das Code-Review stammen vom menschlichen Entwickler.",
    "ix.ab.authH": "Autor",
    "ix.ab.auth": "Entwickelt von Dr. Jens Richter. Hintergrund in Physik und Elektrotechnik; hauptberuflich Tourenoptimierung mit genetischen und KI-Algorithmen bei <a href=\"https://www.dna-evolutions.com/\" rel=\"noopener\">DNA Evolutions</a>. Auf <a href=\"https://www.linkedin.com/in/li-jens-richter\" rel=\"noopener\">LinkedIn</a> erreichst du mich. <span class=\"muted\">Entstanden für meinen Sohn Jonas, der Bagger und Hubschrauber liebt.</span>",
    "ix.ab.attrH": "Nennung &amp; Weitergabe",
    "ix.ab.attrP": "Du baust auf moldqueen auf oder forkst es? Eine Nennung freut mich. Es steht unter der MIT-Lizenz, das ist also eine Bitte, keine Pflicht. Eine Zeile wie diese in deiner README oder im Info-Bereich genügt:",
    "ix.ab.attrSnip": "Erstellt mit moldqueen (https://github.com/jrichter24/moldqueen)",
    "ix.ab.licH": "Lizenz",
    "ix.ab.lic": "Veröffentlicht unter der <a href=\"https://github.com/jrichter24/moldqueen/blob/main/LICENSE\" rel=\"noopener\">MIT-Lizenz</a>.",
    "ix.foot.privacy": "Datenschutz",
    "ix.foot.license": "Lizenz (MIT)",
    "ix.foot.fine": "Ein unabhängiges, inoffizielles Hobbyprojekt. Keine Verbindung zu Mould King / Shenzhen Yuxing; Marken werden beschreibend zur Interoperabilität genannt.",
    // ---- privacy ----
    "pp.eyebrow": "Rechtliches",
    "pp.h1": "Datenschutzerklärung",
    "pp.lead": "Für die moldqueen-App und diese Website. Zuletzt aktualisiert am 23. Juni 2026.",
    "pp.inshort": "<strong>Kurz gesagt:</strong> moldqueen ist eine <strong>lokale Bluetooth-Steuerung</strong>. Es gibt <strong>keine Benutzerkonten</strong>, es werden <strong>keine personenbezogenen Daten</strong> erhoben, es sind <strong>keine Analyse- oder Werbe-SDKs</strong> enthalten, und es wird <strong>nichts</strong> an einen Server des Entwicklers gesendet. Es spricht nur mit deinem Modell über Bluetooth und mit seiner eigenen Steueroberfläche auf deinem Gerät oder im lokalen Netzwerk.",
    "pp.whoH": "Worum es geht",
    "pp.whoP": "moldqueen ist ein privates, unabhängiges, quelloffenes Projekt von Dr. Jens Richter („der Entwickler“). Diese Erklärung gilt für die <strong>moldqueen-App</strong> (die Android-App und die Raspberry-Pi-Software) und für diese <strong>Website</strong>.",
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
    "pp.contactP": "Fragen zum Datenschutz? Öffne ein Issue auf <a href=\"https://github.com/jrichter24/moldqueen/issues\" rel=\"noopener\">GitHub</a> oder schreib an <a href=\"mailto:jens.richter@dna-evolutions.com\">jens.richter@dna-evolutions.com</a>.",
    "pp.foot.fine": "Ein unabhängiges, inoffizielles Hobbyprojekt. Keine Verbindung zu Mould King / Shenzhen Yuxing.",
    // ---- inspiration ----
    "insp.eyebrow": "Empfehlungen",
    "insp.h1": "Sets &amp; Inspiration",
    "insp.lead": "Mould-King-Modelle aus Klemmbausteinen, die gut zu moldqueen passen: der Bagger, für den es entstanden ist, und ein paar andere zum Hineinwachsen.",
    "insp.disc": "<strong>Werbung.</strong> Diese Seite enthält Affiliate-Links. Wenn du über einen davon kaufst, erhalte ich unter Umständen eine kleine Provision, <strong>für dich ohne Mehrkosten</strong>. moldqueen steht in keiner Verbindung zu Mould King; die Produkte stammen von Dritten.",
    "insp.intro": "Die Links unten sind noch Platzhalter. moldqueen steuert heute Mould Kings <strong>MK4</strong>-Bluetooth-Hubs (siehe die <a href=\"index.html#layouts\">Layouts</a>); prüfe vor dem Kauf die Hub- und App-Generation eines Sets, wenn es sofort laufen soll.",
    "insp.c1h": "Mould King 13112, RC-Bagger",
    "insp.c1p": "Der Kettenbagger, für den moldqueen entstanden ist: Ketten, Drehkranz, Ausleger, Arm und Schaufel über einen einzigen MK4-Hub. Die Referenzmaschine für das <strong>Bagger</strong>-Layout.",
    "insp.c2h": "Weitere RC-Modelle von Mould King",
    "insp.c2p": "Bagger, Lader, Kräne und Technic-Fahrzeuge auf denselben Bluetooth-Hubs. Gute Kandidaten für ein <strong>generisches</strong> Layout: Sticks belegen, Motoren automatisch zuordnen, losfahren.",
    "insp.c3h": "Hubs, Motoren &amp; Ersatzteile",
    "insp.c3p": "Zusätzliche MK4-Bluetooth-Empfänger, L/XL-Motoren, Servos und Akkupacks, für Reparaturen oder um einen eigenen Aufbau zu verkabeln und generisch zu steuern.",
    "insp.c4h": "Für den Raspberry-Pi-Aufbau",
    "insp.c4p": "Du nutzt den Pi-Kern? Dann lohnt sich ein zuverlässiger Bluetooth-LE-USB-Stick und ein solides 5-V/3-A-Netzteil; Unterspannung war eine echte Ursache für Funkprobleme.",
    "insp.b.ali": "AliExpress · Link folgt",
    "insp.b.amz": "Amazon · Link folgt",
    "insp.b.dongle": "BLE-Stick · Link folgt",
    "insp.b.psu": "5-V/3-A-Netzteil · Link folgt",
    "insp.note": "Preise, Verfügbarkeit und die Produkte selbst legen die verlinkten Shops fest und können sich jederzeit ändern. moldqueen übernimmt keine Gewähr für Produkte; siehe den <a href=\"index.html#about\">Haftungsausschluss</a>.",
    "insp.foot.sets": "Sets &amp; Inspiration",
    "insp.foot.fine": "<strong>Werbung / enthält Affiliate-Links.</strong> Ein unabhängiges, inoffizielles Hobbyprojekt. Keine Verbindung zu Mould King / Shenzhen Yuxing."
  };

  var META_TITLE = {
    index: { en: "moldqueen: open control for building-block RC toys", de: "moldqueen: offene Steuerung für ferngesteuerte Klemmbaustein-Modelle" },
    privacy: { en: "Privacy Policy · moldqueen", de: "Datenschutz · moldqueen" },
    inspiration: { en: "Sets & inspiration · moldqueen", de: "Sets & Inspiration · moldqueen" }
  };
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
    root.setAttribute("lang", curLang);
    var t = META_TITLE[page]; if (t) document.title = (curLang === "de" && t.de) ? t.de : t.en;
    try { localStorage.setItem("mq_lang", curLang); } catch (e) {}
    document.querySelectorAll(".langbtn").forEach(function (b) {
      var on = b.getAttribute("data-lang") === curLang;
      b.classList.toggle("active", on); b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (lastCards) renderTiles();
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

  // ===================================================================== boot
  applyLang(curLang);
  var y = document.getElementById("year"); if (y) y.textContent = new Date().getFullYear();
})();
