// moldqueen landscape dashboard — client of the WebSocket API.
// Controls bind to FUNCTIONS via a configurable channel map (the CLIENT owns the
// active map and pushes it to the server on every connect; the server resolves
// function -> (slot,channel,value)). Tracks + arm-lift + front-arm are proportional
// DRAG JOYSTICKS (drag = speed up to the function's max; release snaps to NEUTRAL);
// rotation + bucket are press-and-hold buttons. Nothing stays latched.
"use strict";

// ---- geometry: background is 1672×941; place everything in % of that ----
const W = 1672, H = 941;
const $ = id => document.getElementById(id);
const pct = ([x, y, w, h]) =>
  `left:${(x / W * 100).toFixed(3)}%;top:${(y / H * 100).toFixed(3)}%;` +
  `width:${(w / W * 100).toFixed(3)}%;height:${(h / H * 100).toFixed(3)}%;`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- i18n (static strings; function titles come from the map labels) ----
const T = {
  en: { connect: "Connect Excavator", ready: "Ready", reset: "Reset", stop: "STOP", speed: "Speed",
        full: "⛶", settings: "⚙", layouts: "Layouts", close: "Close", lang: "DE", deviceSwap: "Swap hubs 0↔1",
        saveClose: "Save and Close", discard: "Discard", promote: "Save as default (locally)",
        resetMap: "Reset to default", labelsBtn: "Labels…", back: "Back", revtrim: "Rev ×",
        serverInfo: "ℹ Server info", infoConnectFirst: "Connect first", infoFetching: "Fetching…", infoTier: "tier",
        tabConnection: "Connect API", tabChannels: "Channels", tabLabels: "Labels", tabGamepad: "Gamepad", tabServerInfo: "Server info",
        padSub: "Drive with a PS5/DualSense (or any) controller paired to THIS device. Move a stick or press a button to see what it reports, then map inputs to functions.",
        padEnable: "Enable gamepad control", padAssign: "Input mapping", padSource: "Controller input",
        padInvert: "Invert", padLive: "Live", padAxis: "Axis", padButtons: "Buttons ±", padBtn: "Btn",
        padNone: "—", padNeg: "−", padPos: "+", padResetDefaults: "Reset to DualSense defaults",
        padAutosave: "Saved automatically in this browser",
        padNoController: "No controller — pair one to this device and press a button",
        padOnTitle: "Gamepad ON — click to disable", padOffTitle: "Gamepad OFF — click to enable",
        connSub: "Set the WebSocket API endpoint this page talks to (empty = this page’s host).",
        infoSub: "What the server reports — depends on its disclosure tier.",
        fn: "Function", slot: "Slot", ch: "Ch", invert: "Inv", maxFwd: "Max ▲", maxRev: "Max ▼", test: "Test",
        maxRevNote: "Max ▲ / ▼ cap forward / reverse speed (1–7). Reverse default is 5: setting Max ▼ too HIGH can drive the motor into a stall near full reverse (it stops moving).",
        labEn: "Label EN", labDe: "Label DE", assign: "Channel assignment",
        assignSub: "Drag/Test a control, see which motor moves, then set its slot/channel, max and reverse-trim here. Rev× boosts PARTIAL-throttle reverse toward forward speed (it can't exceed full speed). Save for this session, or Save as default (locally) to persist it in this browser. Occupied target channels are swapped automatically.",
        labelsTitle: "Function labels (EN / DE)", labelsSub: "The display name of each function, per language.",
        readyOnly: "test needs READY", confirmed: "confirmed", placeholder: "placeholder",
        applied: "Applied for this session ✓", promoted: "Saved as default (locally) ✓",
        swapOn: "swapped", swapOff: "normal", hold: "hold",
        hIdle: "Power on both hubs (one long flash), then press <b>Connect</b>.",
        hConnecting: "Button <b>ONE</b> hub to <b>two fast flashes</b> (slot&nbsp;1); leave the other on one flash (slot&nbsp;0). Then <b>Ready</b>.",
        dir: { forward: "Forward", backward: "Backward", up: "Up", down: "Down",
               out: "Out", in: "In", left: "Left", right: "Right", open: "Open", close: "Close" },
        info: { mode: "Mode", swap: "Hubs", speed: "Speed", batt: "Batt" },
        resume: "Resume setup",
        su: { title: "Get started", next: "Next — connect excavator →", skip: "Skip — just look around",
              s1t: "Step 1 — Reach the server",
              s1b: "This page drives the excavator through the WebSocket <b>API</b> (the “Connect API” endpoint — not the toy itself). First make sure it's reachable; set the endpoint if your Pi is elsewhere.",
              s2t: "Step 2 — Connect the excavator",
              s2b: "Server reachable ✓ &nbsp;Now power on the hubs and connect the <b>physical excavator</b> over BLE: <b>Connect Excavator</b> → assign slots → <b>Ready</b>." },
        wiz: { title: "Excavator setup", next: "Next", back: "Back", cancel: "Cancel",
               readyBtn: "Ready", startDriving: "Start driving", placeholder: "📷 placeholder — drop a photo here",
               w1: { t: "Step 1 — Power on", b: "Power on <b>both</b> hubs. Each shows <b>one long flash</b>." },
               w2: { t: "Step 2 — Connecting…", b: "Sending the connect signal — both hubs should now <b>fast-flash</b>." },
               w3: { t: "Step 3 — Assign slots", b: "Press <b>ONE</b> hub's button until it shows <b>two fast flashes</b> (slot&nbsp;1). Leave the other on one flash (slot&nbsp;0)." },
               w4: { t: "Ready ✓", b: "Connected — controls unlocked. You can start driving." } } },
  de: { connect: "Bagger verbinden", ready: "Bereit", reset: "Reset", stop: "STOPP", speed: "Tempo",
        full: "⛶", settings: "⚙", layouts: "Layouts", close: "Schließen", lang: "EN", deviceSwap: "Hubs 0↔1 tauschen",
        saveClose: "Speichern & schließen", discard: "Verwerfen", promote: "Als Standard speichern (lokal)",
        resetMap: "Auf Standard zurück", labelsBtn: "Labels…", back: "Zurück", revtrim: "Rev ×",
        serverInfo: "ℹ Server-Info", infoConnectFirst: "Erst verbinden", infoFetching: "Lädt…", infoTier: "Stufe",
        tabConnection: "API verbinden", tabChannels: "Kanäle", tabLabels: "Labels", tabGamepad: "Gamepad", tabServerInfo: "Server-Info",
        padSub: "Mit einem PS5/DualSense (oder beliebigen) Controller fahren, der mit DIESEM Gerät gekoppelt ist. Stick/Taste bewegen, um zu sehen was er meldet, dann Eingaben auf Funktionen abbilden.",
        padEnable: "Gamepad-Steuerung aktivieren", padAssign: "Eingabe-Zuordnung", padSource: "Controller-Eingabe",
        padInvert: "Invertieren", padLive: "Live", padAxis: "Achse", padButtons: "Tasten ±", padBtn: "Taste",
        padNone: "—", padNeg: "−", padPos: "+", padResetDefaults: "Auf DualSense-Standard zurück",
        padAutosave: "Automatisch in diesem Browser gespeichert",
        padNoController: "Kein Controller — mit diesem Gerät koppeln und eine Taste drücken",
        padOnTitle: "Gamepad AN — zum Deaktivieren klicken", padOffTitle: "Gamepad AUS — zum Aktivieren klicken",
        connSub: "WebSocket-API-Endpunkt dieser Seite (leer = Host dieser Seite).",
        infoSub: "Was der Server meldet — je nach Offenlegungsstufe.",
        fn: "Funktion", slot: "Slot", ch: "Kan", invert: "Inv", maxFwd: "Max ▲", maxRev: "Max ▼", test: "Test",
        maxRevNote: "Max ▲ / ▼ begrenzen Vorwärts- / Rückwärtstempo (1–7). Rückwärts-Standard ist 5: ein zu HOHES Max ▼ kann den Motor nahe Vollgas-Rückwärts in einen Stillstand treiben (er bewegt sich nicht mehr).",
        labEn: "Label EN", labDe: "Label DE", assign: "Kanalzuordnung",
        assignSub: "Steuerung ziehen/testen, sehen welcher Motor läuft, dann Slot/Kanal, Max und Rückwärts-Trim setzen. Rev× hebt TEILGAS-Rückwärts Richtung Vorwärtstempo an (kann Vollgas nicht überschreiten). Für die Sitzung speichern oder lokal als Standard speichern (in diesem Browser). Belegte Zielkanäle werden automatisch getauscht.",
        labelsTitle: "Funktions-Labels (EN / DE)", labelsSub: "Anzeigename jeder Funktion, je Sprache.",
        readyOnly: "Test braucht BEREIT", confirmed: "bestätigt", placeholder: "Platzhalter",
        applied: "Für Sitzung übernommen ✓", promoted: "Als Standard gespeichert (lokal) ✓",
        swapOn: "getauscht", swapOff: "normal", hold: "halten",
        hIdle: "Beide Hubs einschalten (ein langes Blinken), dann <b>Verbinden</b>.",
        hConnecting: "<b>EINEN</b> Hub auf <b>zwei schnelle Blinks</b> (Slot&nbsp;1); den anderen auf einem Blink (Slot&nbsp;0). Dann <b>Bereit</b>.",
        dir: { forward: "Vorwärts", backward: "Rückwärts", up: "Hoch", down: "Runter",
               out: "Aus", in: "Ein", left: "Links", right: "Rechts", open: "Öffnen", close: "Schließen" },
        info: { mode: "Modus", swap: "Hubs", speed: "Tempo", batt: "Akku" },
        resume: "Setup fortsetzen",
        su: { title: "Loslegen", next: "Weiter — Bagger verbinden →", skip: "Überspringen — nur umsehen",
              s1t: "Schritt 1 — Server erreichen",
              s1b: "Diese Seite steuert den Bagger über die WebSocket-<b>API</b> (der „API verbinden“-Endpunkt — nicht das Modell selbst). Zuerst sicherstellen, dass sie erreichbar ist; Endpunkt setzen, falls der Pi woanders läuft.",
              s2t: "Schritt 2 — Bagger verbinden",
              s2b: "Server erreichbar ✓ &nbsp;Jetzt die Hubs einschalten und den <b>echten Bagger</b> über BLE verbinden: <b>Bagger verbinden</b> → Slots zuordnen → <b>Bereit</b>." },
        wiz: { title: "Bagger-Setup", next: "Weiter", back: "Zurück", cancel: "Abbrechen",
               readyBtn: "Bereit", startDriving: "Losfahren", placeholder: "📷 Platzhalter — Foto hier einsetzen",
               w1: { t: "Schritt 1 — Einschalten", b: "<b>Beide</b> Hubs einschalten. Jeder zeigt <b>ein langes Blinken</b>." },
               w2: { t: "Schritt 2 — Verbinden…", b: "Verbindungssignal wird gesendet — beide Hubs sollten jetzt <b>schnell blinken</b>." },
               w3: { t: "Schritt 3 — Slots zuweisen", b: "<b>EINEN</b> Hub auf <b>zwei schnelle Blinks</b> stellen (Slot&nbsp;1). Den anderen auf einem Blink lassen (Slot&nbsp;0)." },
               w4: { t: "Bereit ✓", b: "Verbunden — Steuerung entsperrt. Du kannst losfahren." } } },
};

const FN = ["left_track", "right_track", "arm_lift", "front_arm", "rotation", "bucket"];
// Supported label languages [code, native picker name]. `en` is the fallback. Function
// labels are translated per-language (the map's `labels` object); fixed UI strings exist
// for en/de and fall back to en for the rest (focus = the function labels kids read).
const LANGS = [["en", "English"], ["de", "Deutsch"], ["zh", "中文"], ["ko", "한국어"], ["es", "Español"], ["fr", "Français"]];
// Proportional drag joysticks. Track joysticks fill the art's far-left/right button
// housings (top forward-button .. bottom backward-button) so the art is the visual
// housing; `kw` = knob width (fraction of zone width), `travel` = knob travel
// (fraction of half-height) at full deflection.
const JOYS = [
  { fn: "left_track",  rect: [64, 180, 221, 700], kw: 0.34, travel: 0.42 },
  { fn: "arm_lift",    rect: [468, 165, 130, 320], kw: 0.55, travel: 0.42 },
  { fn: "front_arm",   rect: [800, 162, 130, 325], kw: 0.55, travel: 0.42 },
  { fn: "right_track", rect: [1388, 180, 221, 700], kw: 0.34, travel: 0.42 },
];
const BTNS = [
  { fn: "rotation", dir: -1, rect: [1038, 346, 121, 115], k: "left" },
  { fn: "rotation", dir: +1, rect: [1181, 346, 119, 115], k: "right" },
  { fn: "bucket",   dir: +1, rect: [379, 735, 252, 134], k: "open" },
  { fn: "bucket",   dir: -1, rect: [708, 735, 252, 134], k: "close" },
];
const TITLES = [
  { fn: "left_track",  rect: [78, 128, 192, 38] },
  { fn: "arm_lift",    rect: [409, 128, 186, 36] },
  { fn: "front_arm",   rect: [738, 128, 194, 36] },
  { fn: "rotation",    rect: [1083, 128, 177, 36] },
  { fn: "right_track", rect: [1404, 128, 190, 38] },
  { fn: "bucket", k: "open",  rect: [408, 550, 187, 36] },
  { fn: "bucket", k: "close", rect: [739, 550, 193, 36] },
];
const DIRLABELS = [   // fixed "Forward/Backward" hints under the two track joysticks
  { k: "forward",  rect: [118, 342, 108, 27] },
  { k: "backward", rect: [116, 715, 113, 26] },
  { k: "forward",  rect: [1443, 342, 108, 27] },
  { k: "backward", rect: [1441, 715, 114, 26] },
];
const INFOBOXES = [
  { id: "ib_title", rect: [747, 33, 198, 49], static: "moldqueen" },
  { id: "ib_mode",  rect: [1093, 37, 91, 44] },
  { id: "ib_batt",  rect: [1347, 41, 106, 36], static: "—" },
  { id: "ib_row1",  rect: [1124, 548, 162, 41], key: "mode" },
  { id: "ib_row2",  rect: [1124, 642, 162, 41], key: "swap" },
  { id: "ib_row3",  rect: [1124, 736, 162, 41], key: "speed" },
];
// In-art EMERGENCY STOP: % hit-zone over the red STOP button the v3 art draws at the
// bottom-right (where the 4th telemetry row used to be). Part of the dashboard, so it's
// always visible regardless of the sidebar, and live in any lifecycle (stop is always honored).
const ESTOP = [1044, 820, 250, 74];

// ---- state ----
let ws = null, lifecycle = "IDLE";
let lang = localStorage.getItem("mk4_lang") || "en";
if (!LANGS.some(([c]) => c === lang)) lang = "en";   // guard stale/unknown stored codes
let defaultMap = null, activeMap = null, deviceSwap = localStorage.getItem("mk4_device_swap") === "1";
let navCollapsed = localStorage.getItem("mk4_nav_collapsed") === "1";   // sidebar hidden? (chip-toggled, persisted)
const MAP_URL = "/channel_map.excavator.json";   // this layout's bundled default map (client owns it)
let grid = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
const tr = () => T[lang] || T.en;   // fixed UI strings: en/de exist, others fall back to en

// ---- channel map helpers (client-authoritative active map) ----
function validMap(mp) {
  if (!mp || typeof mp !== "object" || !mp.functions) return false;
  const seen = {};
  for (const f of FN) {
    const a = mp.functions[f];
    if (!a || !Number.isInteger(a.slot) || a.slot < 0 || a.slot > 2) return false;
    if (!Number.isInteger(a.channel) || a.channel < 0 || a.channel > 3) return false;
    const key = a.slot + "/" + a.channel;
    if (seen[key]) return false; seen[key] = f;
  }
  return true;
}
// Legacy label_en/label_de -> labels.{en,de}; ensure a `labels` object over all LANGS
// (missing langs default to ""). Mirrors channelmap.py's migration so old stored/served
// maps upgrade transparently on the client too.
function migrateLabels(a) {
  const lb = (a.labels && typeof a.labels === "object") ? a.labels : {};
  if (lb.en == null && typeof a.label_en === "string") lb.en = a.label_en;
  if (lb.de == null && typeof a.label_de === "string") lb.de = a.label_de;
  const out = {};
  LANGS.forEach(([c]) => { out[c] = typeof lb[c] === "string" ? lb[c] : ""; });
  a.labels = out; delete a.label_en; delete a.label_de;
}
// Legacy single `max` -> per-direction max_fwd/max_rev (mirrors channelmap.py). A symmetric
// `max` applies to both (backward-compat); otherwise max_fwd 7 / max_rev 5 (5 = anti-stall).
function migrateCaps(a) {
  const legacy = (Number.isInteger(a.max) && a.max >= 1 && a.max <= 7) ? a.max : null;
  if (!(Number.isInteger(a.max_fwd) && a.max_fwd >= 1 && a.max_fwd <= 7)) a.max_fwd = legacy != null ? legacy : 7;
  if (!(Number.isInteger(a.max_rev) && a.max_rev >= 1 && a.max_rev <= 7)) a.max_rev = legacy != null ? legacy : 5;
  delete a.max;
}
function withDefaults(mp) {           // ensure every function has invert/caps/labels
  const m = JSON.parse(JSON.stringify(mp));
  for (const f of FN) {
    const a = m.functions[f];
    if (typeof a.invert !== "boolean") a.invert = false;
    if (typeof a.reverse_scale !== "number" || a.reverse_scale < 0.25 || a.reverse_scale > 4) a.reverse_scale = 1;
    migrateCaps(a);
    migrateLabels(a);
  }
  return m;
}
function loadStoredMap() {
  try { const m = JSON.parse(localStorage.getItem("mk4_active_map") || "null");
        return validMap(m) ? withDefaults(m) : null; } catch { return null; }
}
function saveActive() { localStorage.setItem("mk4_active_map", JSON.stringify(activeMap)); }
// A valid 6-function placeholder so Settings ALWAYS opens, even with no connection/map.
function placeholderMap() {
  const fns = {};
  FN.forEach((f, i) => fns[f] = { slot: (i / 4) | 0, channel: i % 4, invert: false, max_fwd: 7, max_rev: 5, reverse_scale: 1,
    labels: Object.fromEntries(LANGS.map(([c]) => [c, f.replace(/_/g, " ")])), confirmed: false });
  return { version: 1, functions: fns };
}
function mapForEdit() { return JSON.parse(JSON.stringify(activeMap || loadStoredMap() || placeholderMap())); }
function funcLabel(fn) {
  const a = activeMap && activeMap.functions[fn];
  if (!a) return fn;
  const lb = a.labels || {};
  return lb[lang] || lb.en || a.label_en || fn;   // picked lang → en → legacy → function name
}
function capFor(a, outPositive) {     // per-direction speed cap (mirrors channelmap.py)
  const m = outPositive ? a && a.max_fwd : a && a.max_rev;
  return (Number.isInteger(m) && m >= 1 && m <= 7) ? m : (outPositive ? 7 : 5);
}
// Scale a joystick/gamepad/button intent (frac in [-1,1], PRE-invert) to a signed value
// respecting the per-direction caps. The cap that applies is for the OUTPUT direction
// (frac sign flipped by invert) — so the joystick travel maps smoothly to the right cap
// and stays consistent with the server's output-side cap. Magnitude only; sign = frac sign.
function scaleVal(fn, frac) {
  const a = activeMap && activeMap.functions[fn];
  if (!a || !frac) return Math.round((frac || 0) * 7);
  const outPositive = (frac > 0) !== !!a.invert;
  return Math.sign(frac) * Math.round(Math.abs(frac) * capFor(a, outPositive));
}
function resolveSC(fn) {                // client-side resolve for reading the live grid
  const a = activeMap && activeMap.functions[fn]; if (!a) return null;
  let slot = a.slot; if (deviceSwap && (slot === 0 || slot === 1)) slot = 1 - slot;
  return [slot, a.channel];
}
function funcValue(fn) { const sc = resolveSC(fn); return sc ? (grid[sc[0]] || [])[sc[1]] || 0 : 0; }

// ---- WebSocket ----
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

let wsTries = 0, wsTimer = null, wsStatus = "retrying";
const WS_MAX_TRIES = 5;                                    // then stop auto-retry (no spam)
function setWsStatus(s) { wsStatus = s; MK4.setStatus(s); startupOnUpdate(); }
function scheduleRetry() {
  wsTries++;
  if (wsTries > WS_MAX_TRIES) { setWsStatus("failed"); return; }   // give up — user fixes the endpoint, then Connect
  setWsStatus("retrying");
  clearTimeout(wsTimer);
  wsTimer = setTimeout(connect, Math.min(1000 * wsTries, 5000));   // simple backoff
}
function connect() {
  clearTimeout(wsTimer);
  try { ws = new WebSocket(MK4.wsEndpoint()); } catch (e) { scheduleRetry(); return; }
  ws.onopen = () => { wsTries = 0; setDot(true); setWsStatus("connected"); };   // no map push — client owns the map
  ws.onclose = () => { setDot(false); neutralizeAll(); scheduleRetry(); };
  ws.onerror = () => { try { ws.close(); } catch (e) {} };   // onclose handles status + retry
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === "lifecycle") setLifecycle(m.state);
    else if (m.type === "state" && m.slots) { grid = m.slots; refreshValues(); }
    else if (m.type === "info") onInfo(m);
  };
}
// explicit (re)connect from the endpoint editor: reset the retry budget, connect now.
function reconnectWS() { wsTries = 0; clearTimeout(wsTimer); try { if (ws) ws.close(); } catch (e) {} connect(); }

// Local Apply/Promote feedback (no server round-trip — the client owns the map).
function okMsg(text) { const el = $("mapMsg"); if (el) { el.className = "ok"; el.textContent = text; } }

// ---- lifecycle / setup ----
function setDot(ok) { const d = $("wsDot"); if (d) d.className = "dot" + (ok ? " ok" : ""); }
function setLifecycle(state) {
  lifecycle = state;
  $("overlay").classList.toggle("locked", state !== "READY");
  if (state !== "READY") neutralizeAll();
  renderTopbar(); renderHint(); refreshValues();
  rebuildOpenSettings();
  wizardOnLifecycle(state);
  startupOnUpdate();
}

// ---- build the stage overlay ----
function el(cls, style, html) {
  const d = document.createElement("div");
  d.className = cls; if (style) d.style.cssText = style; if (html != null) d.innerHTML = html;
  return d;
}

const controls = [];   // {fn, reset()} — for global neutralize
const lastVal = {};    // fn -> last value sent (throttle)

// Full client-side resolution (the server is dumb transport now). Mirrors the old
// channelmap.resolve: reverse_scale (gated on the PRE-invert sign) → invert → per-direction
// cap → device-swap. `v` is the pre-invert, output-capped value from scaleVal, so this
// reproduces exactly the (slot, channel, nibble) the server used to compute from cmd:drive.
function resolveDrive(fn, v) {
  const a = activeMap && activeMap.functions[fn];
  if (!a) return null;
  let slot = a.slot | 0; const ch = a.channel | 0;
  if (deviceSwap && (slot === 0 || slot === 1)) slot = 1 - slot;
  let mag = Math.abs(v | 0);
  if (v < 0 && typeof a.reverse_scale === "number" && a.reverse_scale !== 1)
    mag = Math.max(0, Math.min(7, Math.round(mag * a.reverse_scale)));
  let sign = v < 0 ? -1 : (v > 0 ? 1 : 0);
  if (a.invert) sign = -sign;
  let out = sign * mag;
  if (out > 0) out = Math.min(out, capFor(a, true));        // max_fwd
  else if (out < 0) out = -Math.min(-out, capFor(a, false)); // max_rev
  return { slot, channel: ch, value: out };
}
function driveFn(fn, v) {
  v = clamp(v | 0, -7, 7);
  if (lastVal[fn] === v) return;
  lastVal[fn] = v;
  const r = resolveDrive(fn, v);                              // client owns resolution
  if (r) send({ cmd: "set", slot: r.slot, channel: r.channel, value: r.value });   // honored only in READY
}

function buildStage() {
  const ov = $("overlay");
  ov.innerHTML = ""; controls.length = 0;
  for (const d of DIRLABELS) ov.appendChild(el("lbl dir", pct(d.rect), tr().dir[d.k]));
  for (const b of INFOBOXES) { const box = el("lbl info", pct(b.rect)); box.id = b.id; ov.appendChild(box); }
  for (const t of TITLES) {
    const box = el("lbl title", pct(t.rect));
    box.id = "title_" + t.fn + (t.k ? "_" + t.k : "");
    ov.appendChild(box);
  }
  for (const j of JOYS) ov.appendChild(makeJoy(j));
  for (const b of BTNS) ov.appendChild(makeBtn(b.fn, b.dir, b.rect, b.k));
  ov.appendChild(makeEstop());
  renderLabels();
}

// the in-dashboard emergency STOP button (same all-neutral as the sidebar STOP)
function makeEstop() {
  const b = el("estop", pct(ESTOP), `<span>${tr().stop}</span>`);
  b.id = "estopBtn";
  b.addEventListener("pointerdown", e => {
    e.preventDefault(); b.classList.add("hit"); stopAll();
    try { b.setPointerCapture(e.pointerId); } catch {}
  });
  const up = () => b.classList.remove("hit");
  b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up);
  return b;
}

// ---- proportional drag joystick (up = +, down = -, release -> 0) ----
function makeJoy(j) {
  const fn = j.fn, travel = (j.travel || 0.42) * 100;
  const joy = el("joy", pct(j.rect)); joy.dataset.fn = fn;
  const zero = el("zero"); const knob = el("knob");
  if (j.kw) knob.style.width = (j.kw * 100).toFixed(1) + "%";
  joy.appendChild(zero); joy.appendChild(knob);
  let pid = null;
  const setY = clientY => {
    const r = joy.getBoundingClientRect();
    let frac = -((clientY - (r.top + r.height / 2)) / (r.height / 2));
    frac = clamp(frac, -1, 1);
    if (Math.abs(frac) < 0.12) frac = 0;              // centre dead-zone
    knob.style.top = (50 - frac * travel) + "%";
    const val = scaleVal(fn, frac);
    joy.classList.toggle("active", val !== 0);
    driveFn(fn, val);
  };
  const reset = () => { pid = null; knob.style.top = "50%"; joy.classList.remove("active"); driveFn(fn, 0); };
  joy.addEventListener("pointerdown", e => {
    if (lifecycle !== "READY") return;
    pid = e.pointerId; try { joy.setPointerCapture(pid); } catch {} e.preventDefault(); setY(e.clientY);
  });
  joy.addEventListener("pointermove", e => { if (e.pointerId === pid) setY(e.clientY); });
  const up = e => { if (pid === null || (e && e.pointerId !== pid)) return;
                    try { joy.releasePointerCapture(pid); } catch {} reset(); };
  joy.addEventListener("pointerup", up);
  joy.addEventListener("pointercancel", up);
  joy.addEventListener("lostpointercapture", up);
  controls.push({ fn, reset });
  return joy;
}

// ---- press-and-hold button (rotation / bucket) ----
const holders = {};   // fn -> count of active controls
function addHold(fn) { holders[fn] = (holders[fn] || 0) + 1; }
function relHold(fn) { holders[fn] = Math.max(0, (holders[fn] || 0) - 1); if (!holders[fn]) driveFn(fn, 0); }
function makeBtn(fn, dir, rect, k) {
  const b = document.createElement("button");
  b.className = "hot"; b.style.cssText = pct(rect); b.dataset.fn = fn;
  b.title = funcLabel(fn) + " — " + tr().dir[k];
  let on = false;
  const press = e => { e.preventDefault(); if (lifecycle !== "READY" || on) return;
    on = true; b.classList.add("active"); addHold(fn); driveFn(fn, scaleVal(fn, dir)); };
  const rel = () => { if (!on) return; on = false; b.classList.remove("active"); relHold(fn); };
  b.addEventListener("pointerdown", press);
  b.addEventListener("pointerup", rel);
  b.addEventListener("pointerleave", rel);
  b.addEventListener("pointercancel", rel);
  controls.push({ fn, reset: () => { on = false; b.classList.remove("active"); } });
  return b;
}

function neutralizeAll() {
  for (const k in holders) holders[k] = 0;
  controls.forEach(c => c.reset());
  FN.forEach(fn => driveFn(fn, 0));
}

// ---- labels / live values ----
// Shrink a label's font until it fits its textbox (handles long/two-line labels
// like "Arm heben/senken"). Resets to the CSS cqw baseline first so it re-fits on resize.
function fitLabel(box) {
  box.style.fontSize = "";
  let size = parseFloat(getComputedStyle(box).fontSize) || 14, guard = 16;
  while (guard-- > 0 && size > 6 &&
         (box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 1)) {
    size -= 1; box.style.fontSize = size + "px";
  }
}
function renderLabels() {
  if (!activeMap) return;
  for (const t of TITLES) {
    const box = $("title_" + t.fn + (t.k ? "_" + t.k : "")); if (!box) continue;
    const sub = t.k ? " · " + tr().dir[t.k] : "";
    box.innerHTML = '<span class="lt">' + funcLabel(t.fn) + sub + ' <span class="v"></span></span>';
    fitLabel(box);
  }
  refreshValues();
}
function refreshValues() {
  for (const t of TITLES) {
    const box = $("title_" + t.fn + (t.k ? "_" + t.k : "")); if (!box) continue;
    const v = funcValue(t.fn), span = box.querySelector(".v");
    if (span) span.textContent = v ? (v > 0 ? "+" + v : "" + v) : "";
    box.classList.toggle("driving", !!v);
  }
  setInfo("ib_mode", lifecycle);
  setInfo("ib_row1", tr().info.mode + ": " + lifecycle);
  setInfo("ib_row2", tr().info.swap + ": " + (deviceSwap ? tr().swapOn : tr().swapOff));
  setInfo("ib_row3", tr().info.speed + ": drag");
}
function setInfo(id, text) { const b = $(id); if (b && !b.dataset.static) b.innerHTML = text; }

// ---- top toolbar ----
function tbtn(label, cls, on) {
  const b = document.createElement("button"); b.innerHTML = label; if (cls) b.className = cls; b.onclick = on; return b;
}
function renderTopbar() {
  const tb = $("menu"); tb.innerHTML = "";
  // left cluster: connection dot + lifecycle label + setup button — in one flex group
  // so they never stack/overlap regardless of width.
  const left = el("tgroup");
  const dot = el("dot"); dot.id = "wsDot"; left.appendChild(dot);
  left.appendChild(el("lc", "", "<span id='lcText'>" + lifecycle + "</span>"));
  if (lifecycle === "IDLE") left.appendChild(tbtn(tr().connect, "primary connectExc", openWizard));
  else if (lifecycle === "CONNECTING") {
    left.appendChild(tbtn(tr().resume, "primary", openWizard));
    left.appendChild(tbtn(tr().reset, "", doReset));
  } else left.appendChild(tbtn(tr().reset, "", doReset));
  tb.appendChild(left);
  tb.appendChild(el("grow"));
  const right = el("tgroup");
  // STOP now lives on the dashboard itself (the red emergency button in the art) so it
  // stays reachable when the sidebar is collapsed — no separate toolbar STOP.
  if (MK4.showFullscreen()) right.appendChild(tbtn(tr().full, "", toggleFullscreen));
  if (activePad()) right.appendChild(padChip());   // controller indicator + quick enable toggle
  right.appendChild(langSelect());
  right.appendChild(tbtn(tr().layouts, "", () => { location.href = "/?choose=1"; }));
  right.appendChild(tbtn(tr().settings, "", openSettings));
  tb.appendChild(right);
  setDot(ws && ws.readyState === 1);
}
// ---- collapsible menu/sidebar (upper-left chip; persisted) ----
// Collapsed = #menu fully hidden, ONLY the chip shows (STOP stays reachable on the
// in-dashboard red button). The chip lives in the corner so it never covers a control.
function applyNav() {
  $("app").classList.toggle("navhidden", navCollapsed);
  const chip = $("navChip");
  // Directional arrow (not an X): ▶ = collapsed → tap to expand; ◀ = expanded → tap to collapse.
  if (chip) { chip.innerHTML = navCollapsed ? "▶" : "◀"; chip.title = navCollapsed ? "Show menu" : "Hide menu"; }
}
function toggleNav() {
  navCollapsed = !navCollapsed;
  localStorage.setItem("mk4_nav_collapsed", navCollapsed ? "1" : "0");
  applyNav();
}
function renderHint() { $("hint").classList.add("hidden"); }   // setup hint replaced by the wizard
function doReset() { send({ cmd: "setup", action: "reset" }); }
function stopAll() { neutralizeAll(); send({ cmd: "stop" }); }
function toggleFullscreen() {
  if (!document.fullscreenElement) (document.documentElement.requestFullscreen || (() => {})).call(document.documentElement);
  else document.exitFullscreen && document.exitFullscreen();
}
// language picker (6 languages) — replaces the old EN/DE toggle. Persists client-side.
function langSelect() {
  const s = document.createElement("select");
  s.id = "langSel"; s.className = "langsel"; s.title = "Language";
  s.innerHTML = LANGS.map(([c, name]) => `<option value="${c}"${c === lang ? " selected" : ""}>${name}</option>`).join("");
  s.onchange = () => setLang(s.value);
  return s;
}
function setLang(code) {
  if (!LANGS.some(([c]) => c === code)) code = "en";
  lang = code; localStorage.setItem("mk4_lang", lang);
  document.documentElement.lang = lang;
  buildStage(); renderTopbar(); renderHint();
  rebuildOpenSettings();
}

// ---- connection wizard (cold-start IDLE→CONNECTING→READY; centered modal) ----
let wizardStep = 0;
function openWizard() {
  wizardStep = (lifecycle === "READY") ? 4 : (lifecycle === "CONNECTING") ? 3 : 1;
  buildWizard(); $("wizard").classList.remove("hidden");
}
function closeWizard() { wizardStep = 0; $("wizard").classList.add("hidden"); }
function wizardNext() {
  if (wizardStep === 1) { send({ cmd: "setup", action: "connect" }); wizardStep = 2; }   // → CONNECTING
  else if (wizardStep === 2) wizardStep = 3;
  buildWizard();
}
function wizardBack() {
  if (wizardStep === 2) { send({ cmd: "setup", action: "reset" }); wizardStep = 1; }      // → IDLE
  else if (wizardStep === 3) wizardStep = 2;
  buildWizard();
}
function wizardCancel() { send({ cmd: "setup", action: "reset" }); closeWizard(); }
function wizardOnLifecycle(state) {     // keep the wizard in step with the real lifecycle
  if ($("wizard").classList.contains("hidden")) return;
  if (state === "READY") { wizardStep = 4; buildWizard(); }
  else if (state === "IDLE" && wizardStep > 1) { wizardStep = 1; buildWizard(); }
}
function buildWizard() {
  const t = tr(), s = wizardStep, w = t.wiz["w" + s];
  let btns;
  if (s === 1) btns = `<button id="wCancel">${t.wiz.cancel}</button><button class="apply" id="wNext">${t.wiz.next}</button>`;
  else if (s === 2) btns = `<button id="wCancel">${t.wiz.cancel}</button><button id="wBack">${t.wiz.back}</button><button class="apply" id="wNext">${t.wiz.next}</button>`;
  else if (s === 3) btns = `<button id="wCancel">${t.wiz.cancel}</button><button id="wBack">${t.wiz.back}</button><button class="apply" id="wReady">${t.wiz.readyBtn}</button>`;
  else btns = `<button class="apply" id="wDone">${t.wiz.startDriving}</button>`;
  const gif = { 1: "long_flash", 2: "short_flash", 3: "double_short_flash" }[s];   // real LED-flash GIFs
  const media = gif ? `<div class="media"><img src="/assets/${gif}.gif" alt=""></div>` : "";
  $("wizard").innerHTML = `<div class="backdrop"></div><div class="sheet wiz">
    <h2>${t.wiz.title}</h2>
    <div class="wsteps">${[1, 2, 3, 4].map(n => `<span class="wdot${n === s ? " on" : n < s ? " done" : ""}"></span>`).join("")}</div>
    ${media}
    <h3 class="wt">${w.t}</h3><p class="wbody">${w.b}</p>
    <div class="actions wactions">${btns}</div>
  </div>`;
  const set = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
  set("wCancel", wizardCancel); set("wBack", wizardBack); set("wNext", wizardNext);
  set("wReady", () => send({ cmd: "setup", action: "ready" }));   // → READY → step 4 (via lifecycle)
  set("wDone", closeWizard);
}

// ---- startup overlay: sequence the TWO connects in logical order ----
// Step 1 = reach the API (WebSocket "Connection"); step 2 = connect the physical
// excavator over BLE (the wizard). Skippable — never traps a look-around visitor.
let startupStep = 1;
function openStartup() {
  startupStep = (wsStatus === "connected") ? 2 : 1;   // skip step 1 if the API is already reachable
  buildStartup(); $("startup").classList.remove("hidden");
}
function closeStartup() { $("startup").classList.add("hidden"); }
function startupOnUpdate() {   // live-refresh while open as ws-status / lifecycle change
  if ($("startup").classList.contains("hidden")) return;
  if (lifecycle === "READY") { closeStartup(); return; }       // already connected end-to-end → moot
  if (startupStep === 1 && wsStatus === "connected") startupStep = 2;   // API up → advance to the toy
  buildStartup();
}
function buildStartup() {
  const t = tr(), s = startupStep, apiOk = wsStatus === "connected";
  const dots = `<div class="wsteps">
      <span class="wdot ${s === 1 ? "on" : "done"}"></span>
      <span class="wdot ${s === 2 ? "on" : ""}"></span></div>`;
  let body;
  if (s === 1) {
    body = `<h3 class="wt">${t.su.s1t}</h3><p class="wbody">${t.su.s1b}</p>
      <div class="eprow" id="suEpRow"></div>
      <div class="actions wactions">
        <button id="suSkip">${t.su.skip}</button>
        <button class="apply" id="suNext"${apiOk ? "" : " disabled"}>${t.su.next}</button>
      </div>`;
  } else {
    body = `<h3 class="wt">${t.su.s2t}</h3><p class="wbody">${t.su.s2b}</p>
      <div class="actions wactions">
        <button id="suSkip">${t.su.skip}</button>
        <button id="suBack">${t.wiz.back}</button>
        <button class="apply" id="suConnect">${t.connect}</button>
      </div>`;
  }
  $("startup").innerHTML = `<div class="backdrop"></div><div class="sheet wiz su">
     <h2>${t.su.title}</h2>${dots}${body}</div>`;
  $("startup").querySelector(".backdrop").onclick = closeStartup;   // dismissable (don't trap)
  const set = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
  set("suSkip", closeStartup);
  set("suNext", () => { if (wsStatus === "connected") { startupStep = 2; buildStartup(); } });
  set("suBack", () => { startupStep = 1; buildStartup(); });
  set("suConnect", () => { closeStartup(); openWizard(); });   // hand off to the existing excavator wizard
  if (s === 1) { MK4.buildEndpointRow($("suEpRow"), reconnectWS); MK4.setStatus(wsStatus); }
}

// ---- settings: two CENTERED overlay pages (assignment + labels) ----
let editMap = null;   // shared working copy while either page is open

function openSettings() { editMap = mapForEdit(); buildSettings(); $("settings").classList.remove("hidden"); }
function closeAll() { releaseSettingsTests(); $("settings").classList.add("hidden"); }
function swapAdj(slot) { return (deviceSwap && (slot === 0 || slot === 1)) ? 1 - slot : slot; }
function rebuildOpenSettings() {   // re-render the open settings overlay (keeps the current tab)
  if (!$("settings").classList.contains("hidden")) buildSettings();
}

// ====== TABBED settings overlay: Connection · Channels · Labels · Server info ======
// One overlay, four panels (one visible). Each panel owns its own actions. editMap is
// module state preserved across tab switches; all tabs render OFFLINE (no deadlock).
let settingsTab = "channels";
function showTab(name) { settingsTab = name; releaseSettingsTests(); buildSettings(); }

function buildSettings() {
  if (!editMap) editMap = mapForEdit();   // never null -> always renders, even offline
  const t = tr();
  const TABS = [["connection", t.tabConnection], ["channels", t.tabChannels],
                ["labels", t.tabLabels], ["gamepad", t.tabGamepad], ["info", t.tabServerInfo]];
  const bar = TABS.map(([id, lbl]) =>
    `<button class="stab${settingsTab === id ? " on" : ""}" data-tab="${id}">${lbl}</button>`).join("");
  const panel = settingsTab === "connection" ? connectionPanel(t)
              : settingsTab === "labels" ? labelsPanel(t)
              : settingsTab === "gamepad" ? gamepadPanel(t)
              : settingsTab === "info" ? infoPanel(t)
              : channelsPanel(t);
  $("settings").innerHTML =
    `<div class="backdrop"></div><div class="sheet">
       <button class="sheetx" id="settingsX" type="button" aria-label="${t.close}" title="${t.close}">✕</button>
       <div class="stabs">${bar}</div>
       <div class="spanel"><div class="spanelinner">${panel}</div></div>
     </div>`;
  $("settings").querySelector(".backdrop").onclick = discardEdits;   // click-out = discard (no silent save)
  $("settingsX").onclick = discardEdits;                              // top-right X = dismiss (same as click-out)
  $("settings").querySelectorAll(".stab").forEach(b => { b.onclick = () => showTab(b.dataset.tab); });
  ({ connection: wireConnection, channels: wireChannels, labels: wireLabels, gamepad: wireGamepad, info: wireInfo }[settingsTab])();
}

// ---- Connection tab: endpoint editor + status (usable OFFLINE — set endpoint first) ----
function connectionPanel(t) {
  return `<h2>${t.tabConnection}</h2><p class="sub">${t.connSub}</p><div class="eprow" id="epRow"></div>`;
}
function wireConnection() {
  MK4.buildEndpointRow($("epRow"), reconnectWS);
  MK4.setStatus(wsStatus);   // restore last known status into the freshly-built #epStatus
}

// ---- Channels tab: assignment table + swap + its own action row ----
function channelsPanel(t) {
  const rows = FN.map(fn => {
    const a = editMap.functions[fn];
    const opt = (n, sel) => `<option value="${n}"${n === sel ? " selected" : ""}>${n}</option>`;
    const slots = [0, 1, 2].map(n => opt(n, a.slot)).join("");
    const chans = [0, 1, 2, 3].map(n => opt(n, a.channel)).join("");
    return `<tr data-fn="${fn}">
      <td class="fn">${funcLabel(fn)}<br><span class="muted">${fn}</span></td>
      <td><select class="e-slot">${slots}</select></td>
      <td><select class="e-ch">${chans}</select></td>
      <td><input type="number" class="e-maxf" min="1" max="7" value="${a.max_fwd || 7}"></td>
      <td><input type="number" class="e-maxr" min="1" max="7" value="${a.max_rev || 5}"></td>
      <td><input type="number" class="e-rev" min="0.25" max="4" step="0.05" value="${a.reverse_scale ?? 1}"></td>
      <td style="text-align:center"><input type="checkbox" class="e-inv"${a.invert ? " checked" : ""}></td>
      <td><button class="test" data-fn="${fn}">${t.test}</button></td>
    </tr>`;
  }).join("");
  return `<h2>${t.assign}</h2><p class="sub">${t.assignSub}</p>
    <div class="srow">
      <label><input type="checkbox" id="swapChk"${deviceSwap ? " checked" : ""}> ${t.deviceSwap}</label>
      <span class="muted">${lifecycle !== "READY" ? "· " + t.readyOnly : ""}</span>
    </div>
    <table class="map"><thead><tr>
      <th>${t.fn}</th><th>${t.slot}</th><th>${t.ch}</th><th>${t.maxFwd}</th><th>${t.maxRev}</th><th>${t.revtrim}</th><th>${t.invert}</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table>
    <p class="sub maxnote">${t.maxRevNote}</p>
    <div class="actions">
      <button class="apply" id="saveBtn">${t.saveClose}</button>
      <button id="discardBtn">${t.discard}</button>
      <button class="promote" id="promoteBtn">${t.promote}</button>
      <button id="resetMapBtn">${t.resetMap}</button>
      <span id="mapMsg"></span>
    </div>`;
}
function wireChannels() {
  $("settings").querySelectorAll("tr[data-fn]").forEach(trEl => {
    const fn = trEl.dataset.fn, a = editMap.functions[fn];
    trEl.querySelector(".e-slot").onchange = e => assignCell(fn, +e.target.value, a.channel);
    trEl.querySelector(".e-ch").onchange = e => assignCell(fn, a.slot, +e.target.value);
    trEl.querySelector(".e-maxf").onchange = e => { a.max_fwd = clamp(+e.target.value | 0, 1, 7); e.target.value = a.max_fwd; };
    trEl.querySelector(".e-maxr").onchange = e => { a.max_rev = clamp(+e.target.value | 0, 1, 7); e.target.value = a.max_rev; };
    trEl.querySelector(".e-rev").onchange = e => { a.reverse_scale = clamp(+e.target.value || 1, 0.25, 4); e.target.value = a.reverse_scale; };
    trEl.querySelector(".e-inv").onchange = e => { a.invert = e.target.checked; };
    bindTest(trEl.querySelector(".test"), fn);
  });
  $("swapChk").onchange = e => {           // device-swap is now a local toggle + re-resolve
    deviceSwap = e.target.checked;
    localStorage.setItem("mk4_device_swap", deviceSwap ? "1" : "0");
    neutralizeAll(); send({ cmd: "stop" });   // routing changed → neutralize for safety
    refreshValues();
  };
  $("saveBtn").onclick = saveClose;
  $("discardBtn").onclick = discardEdits;
  $("promoteBtn").onclick = promoteMap;
  $("resetMapBtn").onclick = () => { editMap = JSON.parse(JSON.stringify(defaultMap || placeholderMap())); buildSettings(); };
}

// ---- Labels tab: per-function card with the 6 languages laid out as a labelled grid
//      (clean on the fixed-height panel + mobile) + own Save/Discard. ----
function labelsPanel(t) {
  const cards = FN.map(fn => {
    const a = editMap.functions[fn];
    const lb = a.labels || {};
    const fields = LANGS.map(([code]) =>
      `<label class="lblf"><span class="lc">${code.toUpperCase()}</span>` +
      `<input type="text" class="e-lab" data-lang="${code}" value="${(lb[code] || "").replace(/"/g, "&quot;")}"></label>`).join("");
    return `<div class="lblcard" data-fn="${fn}">
      <div class="lblfn">${funcLabel(fn)} <span class="muted">${fn}</span></div>
      <div class="lblgrid">${fields}</div></div>`;
  }).join("");
  return `<h2>${t.labelsTitle}</h2><p class="sub">${t.labelsSub}</p>
    <div class="lblcards">${cards}</div>
    <div class="actions">
      <button class="apply" id="lblSaveBtn">${t.saveClose}</button>
      <button id="lblDiscardBtn">${t.discard}</button>
    </div>`;
}
function wireLabels() {
  $("settings").querySelectorAll(".lblcard").forEach(card => {
    const a = editMap.functions[card.dataset.fn];
    if (!a.labels || typeof a.labels !== "object") a.labels = {};
    card.querySelectorAll(".e-lab").forEach(inp => {
      inp.oninput = e => { a.labels[e.target.dataset.lang] = e.target.value; };
    });
  });
  $("lblSaveBtn").onclick = saveClose;
  $("lblDiscardBtn").onclick = discardEdits;
}

// ---- Server info tab: tier-agnostic readout (auto-fetch on open) ----
function infoPanel(t) {
  return `<h2>${t.tabServerInfo}</h2><p class="sub">${t.infoSub}</p><div class="infobox" id="infoBox"></div>`;
}
function wireInfo() { requestInfo(); }   // fetch immediately (or show "connect first")

// ---- server-info readout (tier-agnostic: render whatever fields come back) ----
let lastInfo = null;
function requestInfo() {
  const box = $("infoBox"); if (!box) return;
  if (!ws || ws.readyState !== 1) {           // graceful: no hang when disconnected
    lastInfo = null;
    box.innerHTML = `<div class="ihead"><button id="infoRefresh" class="mini" title="refresh">↻</button></div>` +
                    `<div class="kv"><span class="muted">${tr().infoConnectFirst}</span></div>`;
    const rb = $("infoRefresh"); if (rb) rb.onclick = requestInfo;
    return;
  }
  box.innerHTML = `<div class="kv"><span class="muted">${tr().infoFetching}</span></div>`;
  send({ cmd: "info" });                        // server replies {type:"info", ...} -> onInfo
}

function onInfo(m) {
  lastInfo = m;
  const box = $("infoBox"); if (!box) return;   // only when the settings page is open
  const ORDER = ["app", "version", "info_level", "lifecycle", "radio_backend", "dry_run",
                 "hci", "ws_port", "http_port", "serve_client", "adapter_mac", "hostname",
                 "bluetoothd", "host_bind", "paths"];
  const fmtVal = v => {
    if (v === null || v === undefined) return "<span class='muted'>—</span>";
    if (Array.isArray(v)) return v.map(esc).join(", ");
    if (typeof v === "object") return Object.entries(v).map(([k, val]) => `${esc(k)}: ${esc(val)}`).join("<br>");
    if (typeof v === "boolean") return v ? "yes" : "no";
    return esc(v);
  };
  const keys = Object.keys(m).filter(k => k !== "type")     // iterate WHATEVER came back (tier-agnostic)
    .sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  const tier = m.info_level ? ` <span class="tag ph">${tr().infoTier}: ${esc(m.info_level)}</span>` : "";
  const rows = keys.map(k =>
    `<div class="kv"><span class="k">${esc(k)}</span><span class="v">${fmtVal(m[k])}</span></div>`).join("");
  box.innerHTML = `<div class="ihead">${tier}<button id="infoRefresh" class="mini" title="refresh">↻</button></div>${rows}`;
  const rb = $("infoRefresh"); if (rb) rb.onclick = requestInfo;
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// TEST pulse: drive the IN-PROGRESS edited slot/channel directly (raw set, swap-adjusted),
// so it reflects the current unsaved selection without needing Save first. READY-gated.
function bindTest(tb, fn) {
  tb.disabled = lifecycle !== "READY";
  const start = e => {
    e.preventDefault(); if (lifecycle !== "READY") return;
    const a = editMap.functions[fn];
    tb.classList.add("held");
    send({ cmd: "set", slot: swapAdj(a.slot), channel: a.channel, value: a.max_fwd || 7 });
  };
  const stop = () => {
    if (!tb.classList.contains("held")) return;
    const a = editMap.functions[fn]; tb.classList.remove("held");
    send({ cmd: "set", slot: swapAdj(a.slot), channel: a.channel, value: 0 });
  };
  tb.addEventListener("pointerdown", start);
  tb.addEventListener("pointerup", stop);
  tb.addEventListener("pointerleave", stop);
  tb.addEventListener("pointercancel", stop);
}
function releaseSettingsTests() {
  document.querySelectorAll(".test.held").forEach(tb => {
    tb.classList.remove("held"); send({ cmd: "stop" });   // belt-and-braces neutralize
  });
}

// Auto-swap so single-cell reassignment always works (no duplicate dead-ends).
function assignCell(fn, slot, channel) {
  const other = FN.find(f => f !== fn &&
    editMap.functions[f].slot === slot && editMap.functions[f].channel === channel);
  if (other) {
    editMap.functions[other].slot = editMap.functions[fn].slot;
    editMap.functions[other].channel = editMap.functions[fn].channel;
  }
  editMap.functions[fn].slot = slot;
  editMap.functions[fn].channel = channel;
  buildSettings();
}

// ---- commit / discard / promote ----
function saveClose() {
  if (!validMap(editMap)) { flashMsg("invalid map (duplicate slot/channel)"); return; }
  activeMap = withDefaults(editMap); saveActive(); renderLabels();   // client-owned: persist locally
  closeAll();
}
function discardEdits() { editMap = null; closeAll(); }   // revert unsaved edits
function promoteMap() {
  if (!validMap(editMap)) { flashMsg("invalid map (duplicate slot/channel)"); return; }
  activeMap = withDefaults(editMap); saveActive(); renderLabels();   // persist as this browser's default
  okMsg(tr().promoted);
}
function flashMsg(text) { const m = $("mapMsg"); if (m) { m.className = "bad"; m.textContent = text; } }

// ====== PS5 / DualSense (or any) GAMEPAD control ======
// Reads a controller paired to THIS client device via the Gamepad API and drives the
// SAME functions as the on-screen joysticks (driveFn -> WS drive-by-function), so it
// reuses the channel map / invert / max / reverse_scale and ALL existing safety:
// READY-gated, snap-to-neutral on release/disconnect/lifecycle-exit/blur. The on-screen
// joysticks keep working alongside it (arbitration below stops a resting pad stomping them).
const PAD_LS_MAP = "mk4_pad_map", PAD_LS_EN = "mk4_pad_enabled";
const PAD_DEADZONE = 0.18;     // resting-stick dead-zone (fraction of full deflection)
// Sensible DualSense (browser "standard" mapping) defaults — fully editable in Settings.
// axes: 0=LSx 1=LSy 2=RSx 3=RSy ; buttons: 0=× 1=○ 2=□ 3=△ 4=L1 5=R1 6=L2 7=R2 …
const PAD_DEFAULT = {
  left_track:  { type: "axis",    axis: 1, invert: true },   // left stick Y, up = forward
  right_track: { type: "axis",    axis: 3, invert: true },   // right stick Y, up = forward
  arm_lift:    { type: "buttons", neg: 0,  pos: 3 },          // × down / △ up
  front_arm:   { type: "buttons", neg: 4,  pos: 5 },          // L1 / R1
  rotation:    { type: "buttons", neg: 2,  pos: 1 },          // □ left / ○ right
  bucket:      { type: "buttons", neg: 6,  pos: 7 },          // L2 / R2
};
function normalizePadMap(m) {     // ensure every function has a sane source (axis|buttons)
  const out = {};
  for (const fn of FN) {
    const s = m && m[fn];
    out[fn] = (s && (s.type === "axis" || s.type === "buttons")) ? s
            : JSON.parse(JSON.stringify(PAD_DEFAULT[fn] || { type: "buttons", neg: null, pos: null }));
  }
  return out;
}
function loadPadMap() {
  try { const m = JSON.parse(localStorage.getItem(PAD_LS_MAP) || "null");
        if (m && typeof m === "object") return normalizePadMap(m); } catch {}
  return normalizePadMap(JSON.parse(JSON.stringify(PAD_DEFAULT)));
}
function savePadMap() { localStorage.setItem(PAD_LS_MAP, JSON.stringify(padMap)); }

let padIndex = null;            // index of the active gamepad in navigator.getGamepads()
let padEnabled = (localStorage.getItem(PAD_LS_EN) || "true") !== "false";
let padMap = loadPadMap();
const padOwns = {};            // fn -> is the gamepad currently ASSERTING this function?

function activePad() {          // the tracked pad, or adopt any connected one
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  if (padIndex != null && pads[padIndex]) return pads[padIndex];
  for (let i = 0; i < pads.length; i++) if (pads[i]) { padIndex = i; return pads[i]; }
  padIndex = null; return null;
}
function padBtnObj(gp, i) { if (i == null) return null; return gp.buttons[i] || null; }
function padPressed(gp, i) { const b = padBtnObj(gp, i); return !!b && (b.pressed || b.value > 0.5); }
function padAxisDeflection(gp, idx, invert) {
  let a = (typeof gp.axes[idx] === "number") ? gp.axes[idx] : 0;
  if (invert) a = -a;
  const m = Math.abs(a);
  if (m < PAD_DEADZONE) return 0;
  return Math.sign(a) * ((m - PAD_DEADZONE) / (1 - PAD_DEADZONE));   // rescale: just past dead-zone ≈ 0
}
function padFnValue(gp, fn) {    // -> signed value -7..+7 for `fn` from the mapped input
  const s = padMap[fn]; if (!s) return 0;
  if (s.type === "axis") return scaleVal(fn, clamp(padAxisDeflection(gp, s.axis, s.invert), -1, 1));
  const pos = padPressed(gp, s.pos), neg = padPressed(gp, s.neg);
  return pos && !neg ? scaleVal(fn, 1) : neg && !pos ? scaleVal(fn, -1) : 0;
}
// Arbitration: the pad only writes 0 for a function IT was driving — so a resting stick
// never stomps an on-screen joystick the user is actively dragging.
function padAssert(fn, v) {
  if (v !== 0) { padOwns[fn] = true; driveFn(fn, v); }
  else if (padOwns[fn]) { padOwns[fn] = false; driveFn(fn, 0); }
}
function padReleaseOwned() { for (const fn in padOwns) if (padOwns[fn]) { padOwns[fn] = false; driveFn(fn, 0); } }

function gamepadLoop() {
  requestAnimationFrame(gamepadLoop);
  const gp = activePad();
  if (gp && !$("settings").classList.contains("hidden") && settingsTab === "gamepad") updatePadReadout(gp);
  if (!padEnabled || !gp || lifecycle !== "READY") { padReleaseOwned(); return; }   // SAFETY gate
  for (const fn of FN) padAssert(fn, padFnValue(gp, fn));
}
function setPadEnabled(on) {
  padEnabled = on; localStorage.setItem(PAD_LS_EN, on ? "true" : "false");
  if (!on) padReleaseOwned();
  renderTopbar(); rebuildOpenSettings();
}
function padChip() {            // topbar status + quick enable toggle (shown only when a pad is present)
  const b = tbtn("🎮", padEnabled ? "padchip padon" : "padchip padoff", () => setPadEnabled(!padEnabled));
  b.title = padEnabled ? tr().padOnTitle : tr().padOffTitle;
  return b;
}
window.addEventListener("gamepadconnected", e => {
  if (padIndex == null) padIndex = e.gamepad.index;
  renderTopbar(); rebuildOpenSettings();
});
window.addEventListener("gamepaddisconnected", e => {
  if (e.gamepad.index === padIndex) { padReleaseOwned(); padIndex = null; activePad(); }   // SAFETY: neutralize, adopt another
  renderTopbar(); rebuildOpenSettings();
});

// ---- Gamepad settings tab: enable toggle + live readout + input->function mapping ----
function padCounts() { const gp = activePad(); return { axes: gp ? gp.axes.length : 4, btns: gp ? gp.buttons.length : 18 }; }
function padRowHtml(t, fn) {
  const s = padMap[fn], { axes, btns } = padCounts();
  const typeSel = `<select class="pad-type" data-fn="${fn}">
      <option value="axis"${s.type === "axis" ? " selected" : ""}>${t.padAxis}</option>
      <option value="buttons"${s.type === "buttons" ? " selected" : ""}>${t.padButtons}</option></select>`;
  let detail = "", inv = "";
  if (s.type === "axis") {
    const opts = Array.from({ length: axes }, (_, i) => `<option value="${i}"${i === s.axis ? " selected" : ""}>${t.padAxis} ${i}</option>`).join("");
    detail = `<select class="pad-axis" data-fn="${fn}">${opts}</select>`;
    inv = `<input type="checkbox" class="pad-inv" data-fn="${fn}"${s.invert ? " checked" : ""}>`;
  } else {
    const bopt = sel => `<option value="">${t.padNone}</option>` +
      Array.from({ length: btns }, (_, i) => `<option value="${i}"${i === sel ? " selected" : ""}>${t.padBtn} ${i}</option>`).join("");
    detail = `<span class="padbtns">${t.padNeg}<select class="pad-neg" data-fn="${fn}">${bopt(s.neg)}</select>` +
             ` ${t.padPos}<select class="pad-pos" data-fn="${fn}">${bopt(s.pos)}</select></span>`;
  }
  return `<tr data-fn="${fn}">
    <td class="fn">${funcLabel(fn)}<br><span class="muted">${fn}</span></td>
    <td>${typeSel} ${detail}</td>
    <td style="text-align:center">${inv}</td>
    <td class="padlive" data-fn="${fn}">0</td></tr>`;
}
function gamepadPanel(t) {
  const gp = activePad();
  const rows = FN.map(fn => padRowHtml(t, fn)).join("");
  return `<h2>${t.tabGamepad}</h2><p class="sub">${t.padSub}</p>
    <div class="srow">
      <label><input type="checkbox" id="padEnable"${padEnabled ? " checked" : ""}> ${t.padEnable}</label>
      <span class="muted">${lifecycle !== "READY" ? "· " + t.readyOnly : ""}</span>
    </div>
    <div class="padstat ${gp ? "ok" : ""}">${gp ? "🎮 " + esc(gp.id || "controller") : t.padNoController}</div>
    <div class="padro" id="padReadout"></div>
    <h3 class="padh">${t.padAssign}</h3>
    <table class="map padmap"><thead><tr><th>${t.fn}</th><th>${t.padSource}</th><th>${t.padInvert}</th><th>${t.padLive}</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <div class="actions">
      <button id="padReset">${t.padResetDefaults}</button>
      <span class="muted">${t.padAutosave}</span>
    </div>`;
}
function setPadSourceType(fn, type) {
  if (type === "axis") padMap[fn] = { type: "axis", axis: (padMap[fn].axis ?? 0) | 0, invert: !!padMap[fn].invert };
  else padMap[fn] = { type: "buttons", neg: padMap[fn].neg ?? null, pos: padMap[fn].pos ?? null };
  savePadMap();
}
function wireGamepad() {
  $("padEnable").onchange = e => setPadEnabled(e.target.checked);
  $("padReset").onclick = () => { padMap = normalizePadMap(JSON.parse(JSON.stringify(PAD_DEFAULT))); savePadMap(); buildSettings(); };
  $("settings").querySelectorAll("tr[data-fn]").forEach(trEl => {
    const fn = trEl.dataset.fn;
    const tSel = trEl.querySelector(".pad-type"); if (tSel) tSel.onchange = e => { setPadSourceType(fn, e.target.value); buildSettings(); };
    const ax = trEl.querySelector(".pad-axis"); if (ax) ax.onchange = e => { padMap[fn].axis = +e.target.value; savePadMap(); };
    const iv = trEl.querySelector(".pad-inv"); if (iv) iv.onchange = e => { padMap[fn].invert = e.target.checked; savePadMap(); };
    const ng = trEl.querySelector(".pad-neg"); if (ng) ng.onchange = e => { padMap[fn].neg = e.target.value === "" ? null : +e.target.value; savePadMap(); };
    const ps = trEl.querySelector(".pad-pos"); if (ps) ps.onchange = e => { padMap[fn].pos = e.target.value === "" ? null : +e.target.value; savePadMap(); };
  });
}
function updatePadReadout(gp) {  // live axes/buttons + per-row function values (built once, updated each frame)
  const box = $("padReadout"); if (!box) return;
  const na = gp.axes.length, nb = gp.buttons.length;
  if (box.dataset.na != na || box.dataset.nb != nb) {
    box.dataset.na = na; box.dataset.nb = nb;
    const axes = Array.from({ length: na }, (_, i) =>
      `<div class="axrow"><span class="axk">A${i}</span><span class="axbar"><i id="axb${i}"></i></span><span class="axv" id="axv${i}">0.00</span></div>`).join("");
    const btns = Array.from({ length: nb }, (_, i) => `<span class="pbtn" id="pbtn${i}">${i}</span>`).join("");
    box.innerHTML = `<div class="axes">${axes}</div><div class="pbtns">${btns}</div>`;
  }
  for (let i = 0; i < na; i++) { const v = gp.axes[i] || 0, b = $("axb" + i), vv = $("axv" + i);
    if (b) b.style.left = (50 + clamp(v, -1, 1) * 50).toFixed(1) + "%"; if (vv) vv.textContent = v.toFixed(2); }
  for (let i = 0; i < nb; i++) { const e2 = $("pbtn" + i); if (e2) e2.classList.toggle("on", padPressed(gp, i)); }
  $("settings").querySelectorAll(".padlive").forEach(td => { td.textContent = padFnValue(gp, td.dataset.fn); });
}

// ---- wiring ----
document.addEventListener("keydown", e => {
  if (e.code === "Space" || e.code === "Escape") { e.preventDefault(); stopAll(); }
});
window.addEventListener("blur", neutralizeAll);
document.addEventListener("visibilitychange", () => { if (document.hidden) neutralizeAll(); });
let _rfit; window.addEventListener("resize", () => {   // re-fit labels to the new stage size
  clearTimeout(_rfit); _rfit = setTimeout(() => { if (activeMap) renderLabels(); }, 150);
});

// Client owns the channel map: load this layout's bundled default file, then layer a
// localStorage override on top. (The server is dumb transport — it never sends a map.)
function applyMaps(def) {
  defaultMap = withDefaults(def);
  activeMap = loadStoredMap() || withDefaults(def);
  renderLabels(); rebuildOpenSettings();
}
fetch(MAP_URL).then(r => r.json()).then(applyMaps).catch(() => applyMaps(placeholderMap()));
document.documentElement.lang = lang;
buildStage();
renderTopbar();
$("navChip").onclick = toggleNav;
applyNav();
renderHint();
connect();
if (lifecycle !== "READY") openStartup();   // greet with the two-step connect guide (skippable)
requestAnimationFrame(gamepadLoop);          // start the gamepad poll loop (no-op until a pad appears)
