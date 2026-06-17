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
  en: { connect: "Connect", ready: "Ready", reset: "Reset", stop: "STOP", speed: "Speed",
        full: "⛶", settings: "⚙", layouts: "Layouts", close: "Close", lang: "DE", deviceSwap: "Swap hubs 0↔1",
        saveClose: "Save and Close", discard: "Discard", promote: "Promote → default",
        resetMap: "Reset to default", labelsBtn: "Labels…", back: "Back", revtrim: "Rev ×",
        fn: "Function", slot: "Slot", ch: "Ch", invert: "Inv", maxsp: "Max", test: "Test",
        labEn: "Label EN", labDe: "Label DE", assign: "Channel assignment",
        assignSub: "Drag/Test a control, see which motor moves, then set its slot/channel, max and reverse-trim here. Save for this session, or Promote to save as the new default. Occupied target channels are swapped automatically.",
        labelsTitle: "Function labels (EN / DE)", labelsSub: "The display name of each function, per language.",
        readyOnly: "test needs READY", confirmed: "confirmed", placeholder: "placeholder",
        applied: "Applied for this session ✓", promoted: "Saved as default ✓",
        swapOn: "swapped", swapOff: "normal", hold: "hold",
        hIdle: "Power on both hubs (one long flash), then press <b>Connect</b>.",
        hConnecting: "Button <b>ONE</b> hub to <b>two fast flashes</b> (slot&nbsp;1); leave the other on one flash (slot&nbsp;0). Then <b>Ready</b>.",
        dir: { forward: "Forward", backward: "Backward", up: "Up", down: "Down",
               out: "Out", in: "In", left: "Left", right: "Right", open: "Open", close: "Close" },
        info: { mode: "Mode", swap: "Hubs", speed: "Speed", batt: "Batt" },
        resume: "Resume setup",
        wiz: { title: "Connection setup", next: "Next", back: "Back", cancel: "Cancel",
               readyBtn: "Ready", startDriving: "Start driving", placeholder: "📷 placeholder — drop a photo here",
               w1: { t: "Step 1 — Power on", b: "Power on <b>both</b> hubs. Each shows <b>one long flash</b>." },
               w2: { t: "Step 2 — Connecting…", b: "Sending the connect signal — both hubs should now <b>fast-flash</b>." },
               w3: { t: "Step 3 — Assign slots", b: "Press <b>ONE</b> hub's button until it shows <b>two fast flashes</b> (slot&nbsp;1). Leave the other on one flash (slot&nbsp;0)." },
               w4: { t: "Ready ✓", b: "Connected — controls unlocked. You can start driving." } } },
  de: { connect: "Verbinden", ready: "Bereit", reset: "Reset", stop: "STOPP", speed: "Tempo",
        full: "⛶", settings: "⚙", layouts: "Layouts", close: "Schließen", lang: "EN", deviceSwap: "Hubs 0↔1 tauschen",
        saveClose: "Speichern & schließen", discard: "Verwerfen", promote: "Als Standard speichern",
        resetMap: "Auf Standard zurück", labelsBtn: "Labels…", back: "Zurück", revtrim: "Rev ×",
        fn: "Funktion", slot: "Slot", ch: "Kan", invert: "Inv", maxsp: "Max", test: "Test",
        labEn: "Label EN", labDe: "Label DE", assign: "Kanalzuordnung",
        assignSub: "Steuerung ziehen/testen, sehen welcher Motor läuft, dann Slot/Kanal, Max und Rückwärts-Trim setzen. Für die Sitzung speichern oder als Standard speichern. Belegte Zielkanäle werden automatisch getauscht.",
        labelsTitle: "Funktions-Labels (EN / DE)", labelsSub: "Anzeigename jeder Funktion, je Sprache.",
        readyOnly: "Test braucht BEREIT", confirmed: "bestätigt", placeholder: "Platzhalter",
        applied: "Für Sitzung übernommen ✓", promoted: "Als Standard gespeichert ✓",
        swapOn: "getauscht", swapOff: "normal", hold: "halten",
        hIdle: "Beide Hubs einschalten (ein langes Blinken), dann <b>Verbinden</b>.",
        hConnecting: "<b>EINEN</b> Hub auf <b>zwei schnelle Blinks</b> (Slot&nbsp;1); den anderen auf einem Blink (Slot&nbsp;0). Dann <b>Bereit</b>.",
        dir: { forward: "Vorwärts", backward: "Rückwärts", up: "Hoch", down: "Runter",
               out: "Aus", in: "Ein", left: "Links", right: "Rechts", open: "Öffnen", close: "Schließen" },
        info: { mode: "Modus", swap: "Hubs", speed: "Tempo", batt: "Akku" },
        resume: "Setup fortsetzen",
        wiz: { title: "Verbindungs-Setup", next: "Weiter", back: "Zurück", cancel: "Abbrechen",
               readyBtn: "Bereit", startDriving: "Losfahren", placeholder: "📷 Platzhalter — Foto hier einsetzen",
               w1: { t: "Schritt 1 — Einschalten", b: "<b>Beide</b> Hubs einschalten. Jeder zeigt <b>ein langes Blinken</b>." },
               w2: { t: "Schritt 2 — Verbinden…", b: "Verbindungssignal wird gesendet — beide Hubs sollten jetzt <b>schnell blinken</b>." },
               w3: { t: "Schritt 3 — Slots zuweisen", b: "<b>EINEN</b> Hub auf <b>zwei schnelle Blinks</b> stellen (Slot&nbsp;1). Den anderen auf einem Blink lassen (Slot&nbsp;0)." },
               w4: { t: "Bereit ✓", b: "Verbunden — Steuerung entsperrt. Du kannst losfahren." } } },
};

const FN = ["left_track", "right_track", "arm_lift", "front_arm", "rotation", "bucket"];
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
  { id: "ib_row4",  rect: [1124, 832, 162, 41], static: "—" },
];

// ---- state ----
let ws = null, lifecycle = "IDLE";
let lang = localStorage.getItem("mk4_lang") || "en";
let defaultMap = null, activeMap = null, deviceSwap = false;
let grid = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
const tr = () => T[lang];

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
function withDefaults(mp) {           // ensure every function has invert/max/labels
  const m = JSON.parse(JSON.stringify(mp));
  for (const f of FN) {
    const a = m.functions[f];
    if (typeof a.invert !== "boolean") a.invert = false;
    if (!Number.isInteger(a.max) || a.max < 1 || a.max > 7) a.max = 7;
    if (typeof a.reverse_scale !== "number" || a.reverse_scale < 0.25 || a.reverse_scale > 4) a.reverse_scale = 1;
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
  FN.forEach((f, i) => fns[f] = { slot: (i / 4) | 0, channel: i % 4, invert: false, max: 7, reverse_scale: 1,
    label_en: f.replace(/_/g, " "), label_de: f.replace(/_/g, " "), confirmed: false });
  return { version: 1, functions: fns };
}
function mapForEdit() { return JSON.parse(JSON.stringify(activeMap || loadStoredMap() || placeholderMap())); }
function funcLabel(fn) {
  const a = activeMap && activeMap.functions[fn];
  return a ? (lang === "de" ? a.label_de : a.label_en) || fn : fn;
}
function funcMax(fn) { const a = activeMap && activeMap.functions[fn]; return (a && a.max) || 7; }
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
function setWsStatus(s) { wsStatus = s; MK4.setStatus(s); }
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
  ws.onopen = () => { wsTries = 0; setDot(true); setWsStatus("connected"); pushActiveMap(); };
  ws.onclose = () => { setDot(false); neutralizeAll(); scheduleRetry(); };
  ws.onerror = () => { try { ws.close(); } catch (e) {} };   // onclose handles status + retry
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === "lifecycle") setLifecycle(m.state);
    else if (m.type === "state" && m.slots) { grid = m.slots; refreshValues(); }
    else if (m.type === "map") onMap(m);
    else if (m.type === "mapresult") onMapResult(m);
  };
}
function pushActiveMap() { if (activeMap) send({ cmd: "map", action: "set", map: activeMap }); }
// explicit (re)connect from the endpoint editor: reset the retry budget, connect now.
function reconnectWS() { wsTries = 0; clearTimeout(wsTimer); try { if (ws) ws.close(); } catch (e) {} connect(); }

function onMap(m) {
  // The server is authoritative ONLY for the persisted default + the session swap.
  // The active map is client-owned (default + our overrides), so we never let a
  // server push clobber it — we push ours instead (see ws.onopen / Apply).
  defaultMap = m.default; deviceSwap = !!m.device_swap;
  if (!activeMap) {                       // FIRST map after a no-connection start (e.g. nginx)
    activeMap = loadStoredMap() || withDefaults(m.active);
    if (!$("settings").classList.contains("hidden")) editMap = mapForEdit();  // populate the open settings
  }
  renderLabels();
  rebuildOpenSettings();
}
function onMapResult(m) {
  const el = $("mapMsg"); if (!el) return;
  if (m.ok) { el.className = "ok"; el.textContent = m.action === "promote" ? tr().promoted : tr().applied; }
  else { el.className = "bad"; el.textContent = (m.errors || ["error"]).join("; "); }
}

// ---- lifecycle / setup ----
function setDot(ok) { const d = $("wsDot"); if (d) d.className = "dot" + (ok ? " ok" : ""); }
function setLifecycle(state) {
  lifecycle = state;
  $("overlay").classList.toggle("locked", state !== "READY");
  if (state !== "READY") neutralizeAll();
  renderTopbar(); renderHint(); refreshValues();
  rebuildOpenSettings();
  wizardOnLifecycle(state);
}

// ---- build the stage overlay ----
function el(cls, style, html) {
  const d = document.createElement("div");
  d.className = cls; if (style) d.style.cssText = style; if (html != null) d.innerHTML = html;
  return d;
}

const controls = [];   // {fn, reset()} — for global neutralize
const lastVal = {};    // fn -> last value sent (throttle)

function driveFn(fn, v) {
  v = clamp(v | 0, -7, 7);
  if (lastVal[fn] === v) return;
  lastVal[fn] = v;
  send({ cmd: "drive", function: fn, value: v });   // server honors only in READY
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
  renderLabels();
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
    const val = Math.round(frac * funcMax(fn));
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
    on = true; b.classList.add("active"); addHold(fn); driveFn(fn, dir * funcMax(fn)); };
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
  if (lifecycle === "IDLE") left.appendChild(tbtn(tr().connect, "primary", openWizard));
  else if (lifecycle === "CONNECTING") {
    left.appendChild(tbtn(tr().resume, "primary", openWizard));
    left.appendChild(tbtn(tr().reset, "", doReset));
  } else left.appendChild(tbtn(tr().reset, "", doReset));
  tb.appendChild(left);
  tb.appendChild(el("grow"));
  const right = el("tgroup");
  const sb = tbtn(tr().stop, "", stopAll); sb.id = "stopBtn"; right.appendChild(sb);
  right.appendChild(tbtn(tr().full, "", toggleFullscreen));
  right.appendChild(tbtn(tr().lang, "", toggleLang));
  right.appendChild(tbtn(tr().layouts, "", () => { location.href = "/?choose=1"; }));
  right.appendChild(tbtn(tr().settings, "", openSettings));
  tb.appendChild(right);
  setDot(ws && ws.readyState === 1);
}
function renderHint() { $("hint").classList.add("hidden"); }   // setup hint replaced by the wizard
function doReset() { send({ cmd: "setup", action: "reset" }); }
function stopAll() { neutralizeAll(); send({ cmd: "stop" }); }
function toggleFullscreen() {
  if (!document.fullscreenElement) (document.documentElement.requestFullscreen || (() => {})).call(document.documentElement);
  else document.exitFullscreen && document.exitFullscreen();
}
function toggleLang() {
  lang = lang === "en" ? "de" : "en"; localStorage.setItem("mk4_lang", lang);
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

// ---- settings: two CENTERED overlay pages (assignment + labels) ----
let editMap = null;   // shared working copy while either page is open

function openSettings() { editMap = mapForEdit(); buildAssign(); $("settings").classList.remove("hidden"); }
function closeAll() { releaseSettingsTests(); $("settings").classList.add("hidden"); $("labels").classList.add("hidden"); }
function swapAdj(slot) { return (deviceSwap && (slot === 0 || slot === 1)) ? 1 - slot : slot; }
function rebuildOpenSettings() {   // re-render whichever settings page is currently visible
  if (!$("settings").classList.contains("hidden")) buildAssign();
  else if (!$("labels").classList.contains("hidden")) buildLabels();
}

// ---- page 1: channel assignment (slot/channel/max/invert/rev-trim/Test) — NO labels ----
function buildAssign() {
  if (!editMap) editMap = mapForEdit();   // never null -> Settings always renders
  const t = tr();
  const rows = FN.map(fn => {
    const a = editMap.functions[fn];
    const opt = (n, sel) => `<option value="${n}"${n === sel ? " selected" : ""}>${n}</option>`;
    const slots = [0, 1, 2].map(n => opt(n, a.slot)).join("");
    const chans = [0, 1, 2, 3].map(n => opt(n, a.channel)).join("");
    const tag = a.confirmed ? `<span class="tag ok">${t.confirmed}</span>` : `<span class="tag ph">${t.placeholder}</span>`;
    return `<tr data-fn="${fn}">
      <td class="fn">${funcLabel(fn)}<br><span class="muted">${fn}</span> ${tag}</td>
      <td><select class="e-slot">${slots}</select></td>
      <td><select class="e-ch">${chans}</select></td>
      <td><input type="number" class="e-max" min="1" max="7" value="${a.max || 7}"></td>
      <td><input type="number" class="e-rev" min="0.25" max="4" step="0.05" value="${a.reverse_scale ?? 1}"></td>
      <td style="text-align:center"><input type="checkbox" class="e-inv"${a.invert ? " checked" : ""}></td>
      <td><button class="test" data-fn="${fn}">${t.test}</button></td>
    </tr>`;
  }).join("");
  $("settings").innerHTML =
    `<div class="backdrop"></div><div class="sheet">
      <h2>${t.assign}</h2>
      <p class="sub">${t.assignSub}</p>
      <div class="srow eprow" id="epRow"></div>
      <div class="srow">
        <label><input type="checkbox" id="swapChk"${deviceSwap ? " checked" : ""}> ${t.deviceSwap}</label>
        <span class="muted">${lifecycle !== "READY" ? "· " + t.readyOnly : ""}</span>
      </div>
      <table class="map"><thead><tr>
        <th>${t.fn}</th><th>${t.slot}</th><th>${t.ch}</th><th>${t.maxsp}</th><th>${t.revtrim}</th><th>${t.invert}</th><th></th>
      </tr></thead><tbody>${rows}</tbody></table>
      <div class="actions">
        <button class="apply" id="saveBtn">${t.saveClose}</button>
        <button id="discardBtn">${t.discard}</button>
        <button id="labelsBtn">${t.labelsBtn}</button>
        <button class="promote" id="promoteBtn">${t.promote}</button>
        <button id="resetMapBtn">${t.resetMap}</button>
        <span id="mapMsg"></span>
      </div>
    </div>`;
  $("settings").querySelector(".backdrop").onclick = discardEdits;   // click-out = discard (no silent save)
  MK4.buildEndpointRow($("epRow"), reconnectWS);
  MK4.setStatus(wsStatus);   // restore last known status into the freshly-built #epStatus
  $("settings").querySelectorAll("tr[data-fn]").forEach(trEl => {
    const fn = trEl.dataset.fn, a = editMap.functions[fn];
    trEl.querySelector(".e-slot").onchange = e => assignCell(fn, +e.target.value, a.channel);
    trEl.querySelector(".e-ch").onchange = e => assignCell(fn, a.slot, +e.target.value);
    trEl.querySelector(".e-max").onchange = e => { a.max = clamp(+e.target.value | 0, 1, 7); e.target.value = a.max; };
    trEl.querySelector(".e-rev").onchange = e => { a.reverse_scale = clamp(+e.target.value || 1, 0.25, 4); e.target.value = a.reverse_scale; };
    trEl.querySelector(".e-inv").onchange = e => { a.invert = e.target.checked; };
    bindTest(trEl.querySelector(".test"), fn);
  });
  $("swapChk").onchange = e => { send({ cmd: "map", action: "swap", value: e.target.checked }); };
  $("saveBtn").onclick = saveClose;
  $("discardBtn").onclick = discardEdits;
  $("labelsBtn").onclick = openLabels;
  $("promoteBtn").onclick = promoteMap;
  $("resetMapBtn").onclick = () => { editMap = JSON.parse(JSON.stringify(defaultMap || placeholderMap())); buildAssign(); };
}

// TEST pulse: drive the IN-PROGRESS edited slot/channel directly (raw set, swap-adjusted),
// so it reflects the current unsaved selection without needing Save first. READY-gated.
function bindTest(tb, fn) {
  tb.disabled = lifecycle !== "READY";
  const start = e => {
    e.preventDefault(); if (lifecycle !== "READY") return;
    const a = editMap.functions[fn];
    tb.classList.add("held");
    send({ cmd: "set", slot: swapAdj(a.slot), channel: a.channel, value: a.max || 7 });
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
  buildAssign();
}

// ---- page 2: EN/DE labels (separate overlay, reached from the assignment page) ----
function openLabels() { $("settings").classList.add("hidden"); buildLabels(); $("labels").classList.remove("hidden"); }
function backToAssign() { $("labels").classList.add("hidden"); buildAssign(); $("settings").classList.remove("hidden"); }
function buildLabels() {
  const t = tr();
  const rows = FN.map(fn => {
    const a = editMap.functions[fn];
    return `<tr data-fn="${fn}">
      <td class="fn">${fn}</td>
      <td><input type="text" class="e-en" value="${(a.label_en || "").replace(/"/g, "&quot;")}"></td>
      <td><input type="text" class="e-de" value="${(a.label_de || "").replace(/"/g, "&quot;")}"></td>
    </tr>`;
  }).join("");
  $("labels").innerHTML =
    `<div class="backdrop"></div><div class="sheet">
      <h2>${t.labelsTitle}</h2>
      <p class="sub">${t.labelsSub}</p>
      <table class="map"><thead><tr><th>${t.fn}</th><th>${t.labEn}</th><th>${t.labDe}</th></tr></thead>
        <tbody>${rows}</tbody></table>
      <div class="actions">
        <button class="apply" id="lblSaveBtn">${t.saveClose}</button>
        <button id="lblBackBtn">${t.back}</button>
      </div>
    </div>`;
  $("labels").querySelector(".backdrop").onclick = backToAssign;
  $("labels").querySelectorAll("tr[data-fn]").forEach(trEl => {
    const a = editMap.functions[trEl.dataset.fn];
    trEl.querySelector(".e-en").oninput = e => { a.label_en = e.target.value; };
    trEl.querySelector(".e-de").oninput = e => { a.label_de = e.target.value; };
  });
  $("lblSaveBtn").onclick = saveClose;
  $("lblBackBtn").onclick = backToAssign;
}

// ---- commit / discard / promote ----
function saveClose() {
  if (!validMap(editMap)) { flashMsg("invalid map (duplicate slot/channel)"); return; }
  activeMap = withDefaults(editMap); saveActive(); renderLabels();
  send({ cmd: "map", action: "set", map: activeMap });   // session active map
  closeAll();
}
function discardEdits() { editMap = null; closeAll(); }   // revert unsaved edits
function promoteMap() {
  if (!validMap(editMap)) { flashMsg("invalid map (duplicate slot/channel)"); return; }
  activeMap = withDefaults(editMap); saveActive(); renderLabels();
  send({ cmd: "map", action: "promote", map: activeMap });  // persist as default (stays open; shows result)
}
function flashMsg(text) { const m = $("mapMsg"); if (m) { m.className = "bad"; m.textContent = text; } }

// ---- wiring ----
document.addEventListener("keydown", e => {
  if (e.code === "Space" || e.code === "Escape") { e.preventDefault(); stopAll(); }
});
window.addEventListener("blur", neutralizeAll);
document.addEventListener("visibilitychange", () => { if (document.hidden) neutralizeAll(); });
let _rfit; window.addEventListener("resize", () => {   // re-fit labels to the new stage size
  clearTimeout(_rfit); _rfit = setTimeout(() => { if (activeMap) renderLabels(); }, 150);
});

// seed from the server-injected initial state so the UI renders before the WS opens
if (window.MK4_INIT) {
  const i = window.MK4_INIT;
  defaultMap = i.default; deviceSwap = !!i.device_swap; lifecycle = i.lifecycle || "IDLE";
  activeMap = loadStoredMap() || withDefaults(i.active);
} else {
  activeMap = null;
}
document.documentElement.lang = lang;
buildStage();
renderTopbar();
renderHint();
connect();
