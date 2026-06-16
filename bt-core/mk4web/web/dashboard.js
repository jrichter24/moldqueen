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
        full: "⛶", settings: "⚙", close: "Close", lang: "DE", deviceSwap: "Swap hubs 0↔1",
        apply: "Apply (session)", promote: "Promote → default", resetMap: "Reset to default",
        fn: "Function", slot: "Slot", ch: "Ch", invert: "Inv", maxsp: "Max", test: "Test",
        labEn: "Label EN", labDe: "Label DE", assign: "Channel assignment",
        assignSub: "Drag a control, see which motor moves, then set its slot/channel + max here. Apply for this session, or Promote to save as the new default. Occupied target channels are swapped automatically.",
        readyOnly: "test needs READY", confirmed: "confirmed", placeholder: "placeholder",
        applied: "Applied for this session ✓", promoted: "Saved as default ✓",
        swapOn: "swapped", swapOff: "normal", hold: "hold",
        hIdle: "Power on both hubs (one long flash), then press <b>Connect</b>.",
        hConnecting: "Button <b>ONE</b> hub to <b>two fast flashes</b> (slot&nbsp;1); leave the other on one flash (slot&nbsp;0). Then <b>Ready</b>.",
        dir: { forward: "Forward", backward: "Backward", up: "Up", down: "Down",
               out: "Out", in: "In", left: "Left", right: "Right", open: "Open", close: "Close" },
        info: { mode: "Mode", swap: "Hubs", speed: "Speed", batt: "Batt" } },
  de: { connect: "Verbinden", ready: "Bereit", reset: "Reset", stop: "STOPP", speed: "Tempo",
        full: "⛶", settings: "⚙", close: "Schließen", lang: "EN", deviceSwap: "Hubs 0↔1 tauschen",
        apply: "Übernehmen", promote: "Als Standard speichern", resetMap: "Auf Standard zurück",
        fn: "Funktion", slot: "Slot", ch: "Kan", invert: "Inv", maxsp: "Max", test: "Test",
        labEn: "Label EN", labDe: "Label DE", assign: "Kanalzuordnung",
        assignSub: "Steuerung ziehen, sehen welcher Motor läuft, dann Slot/Kanal + Max setzen. Für die Sitzung übernehmen oder als Standard speichern. Belegte Zielkanäle werden automatisch getauscht.",
        readyOnly: "Test braucht BEREIT", confirmed: "bestätigt", placeholder: "Platzhalter",
        applied: "Für Sitzung übernommen ✓", promoted: "Als Standard gespeichert ✓",
        swapOn: "getauscht", swapOff: "normal", hold: "halten",
        hIdle: "Beide Hubs einschalten (ein langes Blinken), dann <b>Verbinden</b>.",
        hConnecting: "<b>EINEN</b> Hub auf <b>zwei schnelle Blinks</b> (Slot&nbsp;1); den anderen auf einem Blink (Slot&nbsp;0). Dann <b>Bereit</b>.",
        dir: { forward: "Vorwärts", backward: "Rückwärts", up: "Hoch", down: "Runter",
               out: "Aus", in: "Ein", left: "Links", right: "Rechts", open: "Öffnen", close: "Schließen" },
        info: { mode: "Modus", swap: "Hubs", speed: "Tempo", batt: "Akku" } },
};

const FN = ["left_track", "right_track", "arm_lift", "front_arm", "rotation", "bucket"];
// joystick functions (vertical drag) vs button functions (press-and-hold)
const JOYS = [
  { fn: "left_track",  rect: [100, 345, 150, 370] },
  { fn: "arm_lift",    rect: [468, 165, 130, 320] },
  { fn: "front_arm",   rect: [800, 162, 130, 325] },
  { fn: "right_track", rect: [1423, 345, 150, 370] },
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
  }
  return m;
}
function loadStoredMap() {
  try { const m = JSON.parse(localStorage.getItem("mk4_active_map") || "null");
        return validMap(m) ? withDefaults(m) : null; } catch { return null; }
}
function saveActive() { localStorage.setItem("mk4_active_map", JSON.stringify(activeMap)); }
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

function connect() {
  ws = new WebSocket("ws://" + location.hostname + ":" + window.MK4_WS_PORT);
  ws.onopen = () => { setDot(true); pushActiveMap(); };   // make the server match our map every connect
  ws.onclose = () => { setDot(false); neutralizeAll(); setTimeout(connect, 1000); };
  ws.onerror = () => ws.close();
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === "lifecycle") setLifecycle(m.state);
    else if (m.type === "state" && m.slots) { grid = m.slots; refreshValues(); }
    else if (m.type === "map") onMap(m);
    else if (m.type === "mapresult") onMapResult(m);
  };
}
function pushActiveMap() { if (activeMap) send({ cmd: "map", action: "set", map: activeMap }); }

function onMap(m) {
  // The server is authoritative ONLY for the persisted default + the session swap.
  // The active map is client-owned (default + our overrides), so we never let a
  // server push clobber it — we push ours instead (see ws.onopen / Apply).
  defaultMap = m.default; deviceSwap = !!m.device_swap;
  renderLabels();
  if (!$("settings").classList.contains("hidden")) buildSettings();
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
  if (!$("settings").classList.contains("hidden")) buildSettings();
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
  for (const j of JOYS) ov.appendChild(makeJoy(j.fn, j.rect));
  for (const b of BTNS) ov.appendChild(makeBtn(b.fn, b.dir, b.rect, b.k));
  renderLabels();
}

// ---- proportional drag joystick (up = +, down = -, release -> 0) ----
function makeJoy(fn, rect) {
  const joy = el("joy", pct(rect)); joy.dataset.fn = fn;
  const zero = el("zero"); const knob = el("knob");
  joy.appendChild(zero); joy.appendChild(knob);
  let pid = null;
  const setY = clientY => {
    const r = joy.getBoundingClientRect();
    let frac = -((clientY - (r.top + r.height / 2)) / (r.height / 2));
    frac = clamp(frac, -1, 1);
    if (Math.abs(frac) < 0.12) frac = 0;              // centre dead-zone
    knob.style.top = (50 - frac * 42) + "%";
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
function renderLabels() {
  if (!activeMap) return;
  for (const t of TITLES) {
    const box = $("title_" + t.fn + (t.k ? "_" + t.k : "")); if (!box) continue;
    const sub = t.k ? " · " + tr().dir[t.k] : "";
    box.innerHTML = funcLabel(t.fn) + sub + ' <span class="v"></span>';
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
  const tb = $("topbar"); tb.innerHTML = "";
  const dot = el("dot"); dot.id = "wsDot"; tb.appendChild(dot);
  tb.appendChild(el("", "", "<span id='lcText'>" + lifecycle + "</span>"));
  if (lifecycle === "IDLE") tb.appendChild(tbtn(tr().connect, "primary", () => send({ cmd: "setup", action: "connect" })));
  else if (lifecycle === "CONNECTING") {
    tb.appendChild(tbtn(tr().ready, "primary", () => send({ cmd: "setup", action: "ready" })));
    tb.appendChild(tbtn(tr().reset, "", () => send({ cmd: "setup", action: "reset" })));
  } else tb.appendChild(tbtn(tr().reset, "", () => send({ cmd: "setup", action: "reset" })));
  tb.appendChild(el("grow"));
  tb.appendChild(tbtn(tr().stop, "", stopAll)).id = "stopBtn";
  tb.appendChild(tbtn(tr().full, "", toggleFullscreen));
  tb.appendChild(tbtn(tr().lang, "", toggleLang));
  tb.appendChild(tbtn(tr().settings, "", openSettings));
  setDot(ws && ws.readyState === 1);
}
function renderHint() {
  const h = $("hint");
  if (lifecycle === "IDLE") { h.innerHTML = tr().hIdle; h.classList.remove("hidden"); }
  else if (lifecycle === "CONNECTING") { h.innerHTML = tr().hConnecting; h.classList.remove("hidden"); }
  else h.classList.add("hidden");
}
function stopAll() { neutralizeAll(); send({ cmd: "stop" }); }
function toggleFullscreen() {
  if (!document.fullscreenElement) (document.documentElement.requestFullscreen || (() => {})).call(document.documentElement);
  else document.exitFullscreen && document.exitFullscreen();
}
function toggleLang() {
  lang = lang === "en" ? "de" : "en"; localStorage.setItem("mk4_lang", lang);
  document.documentElement.lang = lang;
  buildStage(); renderTopbar(); renderHint();
  if (!$("settings").classList.contains("hidden")) buildSettings();
}

// ---- settings / channel-assignment view (right drawer) ----
let editMap = null;
function openSettings() { editMap = JSON.parse(JSON.stringify(activeMap)); buildSettings(); $("settings").classList.remove("hidden"); }
function closeSettings() { releaseSettingsTests(); $("settings").classList.add("hidden"); }

function buildSettings() {
  if (!editMap) editMap = JSON.parse(JSON.stringify(activeMap || defaultMap));
  const t = tr();
  const rows = FN.map(fn => {
    const a = editMap.functions[fn];
    const opt = (n, sel) => `<option value="${n}"${n === sel ? " selected" : ""}>${n}</option>`;
    const slots = [0, 1, 2].map(n => opt(n, a.slot)).join("");
    const chans = [0, 1, 2, 3].map(n => opt(n, a.channel)).join("");
    const tag = a.confirmed ? `<span class="tag ok">${t.confirmed}</span>` : `<span class="tag ph">${t.placeholder}</span>`;
    return `<tr data-fn="${fn}">
      <td class="fn">${fn}<br>${tag}</td>
      <td><select class="e-slot">${slots}</select></td>
      <td><select class="e-ch">${chans}</select></td>
      <td><input type="number" class="e-max" min="1" max="7" value="${a.max || 7}"></td>
      <td style="text-align:center"><input type="checkbox" class="e-inv"${a.invert ? " checked" : ""}></td>
      <td><input type="text" class="e-en" value="${(a.label_en || "").replace(/"/g, "&quot;")}"></td>
      <td><input type="text" class="e-de" value="${(a.label_de || "").replace(/"/g, "&quot;")}"></td>
      <td><button class="test" data-fn="${fn}">${t.test}</button></td>
    </tr>`;
  }).join("");
  $("settings").innerHTML =
    `<div class="backdrop"></div><div class="sheet">
      <h2>${t.assign}</h2>
      <p class="sub">${t.assignSub}</p>
      <div class="srow">
        <label><input type="checkbox" id="swapChk"${deviceSwap ? " checked" : ""}> ${t.deviceSwap}</label>
        <span class="muted">${lifecycle !== "READY" ? "· " + t.readyOnly : ""}</span>
      </div>
      <table class="map"><thead><tr>
        <th>${t.fn}</th><th>${t.slot}</th><th>${t.ch}</th><th>${t.maxsp}</th><th>${t.invert}</th>
        <th>${t.labEn}</th><th>${t.labDe}</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table>
      <div class="actions">
        <button class="apply" id="applyBtn">${t.apply}</button>
        <button class="promote" id="promoteBtn">${t.promote}</button>
        <button id="resetMapBtn">${t.resetMap}</button>
        <button id="closeBtn">${t.close}</button>
        <span id="mapMsg"></span>
      </div>
    </div>`;
  $("settings").querySelector(".backdrop").onclick = closeSettings;
  $("settings").querySelectorAll("tr[data-fn]").forEach(trEl => {
    const fn = trEl.dataset.fn, a = editMap.functions[fn];
    trEl.querySelector(".e-slot").onchange = e => assignCell(fn, +e.target.value, a.channel);
    trEl.querySelector(".e-ch").onchange = e => assignCell(fn, a.slot, +e.target.value);
    trEl.querySelector(".e-max").onchange = e => { a.max = clamp(+e.target.value | 0, 1, 7); e.target.value = a.max; };
    trEl.querySelector(".e-inv").onchange = e => { a.invert = e.target.checked; };
    trEl.querySelector(".e-en").oninput = e => { a.label_en = e.target.value; };
    trEl.querySelector(".e-de").oninput = e => { a.label_de = e.target.value; };
    const tb = trEl.querySelector(".test");
    tb.disabled = lifecycle !== "READY";
    const start = e => { e.preventDefault(); if (lifecycle !== "READY") return;
      tb.classList.add("held"); send({ cmd: "drive", function: fn, value: editMap.functions[fn].max || 7 }); };
    const stop = () => { tb.classList.remove("held"); send({ cmd: "drive", function: fn, value: 0 }); };
    tb.addEventListener("pointerdown", start);
    tb.addEventListener("pointerup", stop);
    tb.addEventListener("pointerleave", stop);
    tb.addEventListener("pointercancel", stop);
  });
  $("swapChk").onchange = e => { send({ cmd: "map", action: "swap", value: e.target.checked }); };
  $("applyBtn").onclick = () => applyMap(false);
  $("promoteBtn").onclick = () => applyMap(true);
  $("resetMapBtn").onclick = () => { editMap = JSON.parse(JSON.stringify(defaultMap)); buildSettings(); };
  $("closeBtn").onclick = closeSettings;
}

// Auto-swap so single-cell reassignment always works (no duplicate dead-ends).
function assignCell(fn, slot, channel) {
  const other = FN.find(f => f !== fn &&
    editMap.functions[f].slot === slot && editMap.functions[f].channel === channel);
  if (other) {   // target occupied -> give the displaced function this function's old cell
    editMap.functions[other].slot = editMap.functions[fn].slot;
    editMap.functions[other].channel = editMap.functions[fn].channel;
  }
  editMap.functions[fn].slot = slot;
  editMap.functions[fn].channel = channel;
  buildSettings();
}
function releaseSettingsTests() {
  $("settings").querySelectorAll(".test.held").forEach(tb => {
    tb.classList.remove("held"); send({ cmd: "drive", function: tb.dataset.fn, value: 0 });
  });
}
function applyMap(promote) {
  if (!validMap(editMap)) {   // shouldn't happen (auto-swap keeps it valid), but guard
    const msg = $("mapMsg"); msg.className = "bad"; msg.textContent = "invalid map (duplicate slot/channel)"; return;
  }
  activeMap = withDefaults(editMap); saveActive();
  renderLabels();
  send({ cmd: "map", action: promote ? "promote" : "set", map: activeMap });
}

// ---- wiring ----
document.addEventListener("keydown", e => {
  if (e.code === "Space" || e.code === "Escape") { e.preventDefault(); stopAll(); }
});
window.addEventListener("blur", neutralizeAll);
document.addEventListener("visibilitychange", () => { if (document.hidden) neutralizeAll(); });

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
