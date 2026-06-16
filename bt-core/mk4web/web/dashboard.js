// moldqueen landscape dashboard — client of the WebSocket API.
// Controls bind to FUNCTIONS (via the active channel map), not raw channels, so
// remapping in Settings changes what each control drives. All driving controls are
// PRESS-AND-HOLD; release snaps that function to NEUTRAL (no latched motor).
"use strict";

// ---- geometry: background is 1672×941; place everything in % of that ----
const W = 1672, H = 941;
const $ = id => document.getElementById(id);
const pct = ([x, y, w, h]) =>
  `left:${(x / W * 100).toFixed(3)}%;top:${(y / H * 100).toFixed(3)}%;` +
  `width:${(w / W * 100).toFixed(3)}%;height:${(h / H * 100).toFixed(3)}%;`;

// ---- i18n (static UI strings; function titles come from the map labels) ----
const T = {
  en: { connect: "Connect", ready: "Ready", reset: "Reset", stop: "STOP", speed: "Speed",
        settings: "⚙ Settings", close: "Close", lang: "DE", deviceSwap: "Swap hubs 0↔1",
        apply: "Apply (session)", promote: "Promote → default", resetMap: "Reset to default",
        fn: "Function", slot: "Slot", ch: "Channel", invert: "Invert", labEn: "Label EN",
        labDe: "Label DE", test: "Hold to test", assign: "Channel assignment",
        assignSub: "Drive a control, see which motor moves, then set its slot/channel here. Apply for this session, or Promote to save as the new default.",
        readyOnly: "Needs READY", confirmed: "confirmed", placeholder: "placeholder",
        applied: "Applied for this session ✓", promoted: "Saved as default ✓",
        swapOn: "hubs swapped", swapOff: "normal",
        hIdle: "Power on both hubs (one long flash), then press <b>Connect</b>.",
        hConnecting: "Button <b>ONE</b> hub to <b>two fast flashes</b> (slot&nbsp;1); leave the other on one flash (slot&nbsp;0). Then press <b>Ready</b>.",
        dir: { forward: "Forward", backward: "Backward", up: "Up", down: "Down",
               out: "Out", in: "In", left: "Left", right: "Right", open: "Open", close: "Close" },
        info: { mode: "Mode", swap: "Hubs", speed: "Speed", batt: "Batt" } },
  de: { connect: "Verbinden", ready: "Bereit", reset: "Zurücksetzen", stop: "STOPP", speed: "Tempo",
        settings: "⚙ Einstellungen", close: "Schließen", lang: "EN", deviceSwap: "Hubs 0↔1 tauschen",
        apply: "Übernehmen (Sitzung)", promote: "Als Standard speichern", resetMap: "Auf Standard zurück",
        fn: "Funktion", slot: "Slot", ch: "Kanal", invert: "Invertieren", labEn: "Label EN",
        labDe: "Label DE", test: "Zum Testen halten", assign: "Kanalzuordnung",
        assignSub: "Steuerung betätigen, sehen welcher Motor sich bewegt, dann hier Slot/Kanal setzen. Für die Sitzung übernehmen oder als neuen Standard speichern.",
        readyOnly: "Benötigt BEREIT", confirmed: "bestätigt", placeholder: "Platzhalter",
        applied: "Für Sitzung übernommen ✓", promoted: "Als Standard gespeichert ✓",
        swapOn: "Hubs getauscht", swapOff: "normal",
        hIdle: "Beide Hubs einschalten (ein langes Blinken), dann <b>Verbinden</b> drücken.",
        hConnecting: "<b>EINEN</b> Hub auf <b>zwei schnelle Blinks</b> stellen (Slot&nbsp;1); den anderen auf einem Blink lassen (Slot&nbsp;0). Dann <b>Bereit</b> drücken.",
        dir: { forward: "Vorwärts", backward: "Rückwärts", up: "Hoch", down: "Runter",
               out: "Aus", in: "Ein", left: "Links", right: "Rechts", open: "Öffnen", close: "Schließen" },
        info: { mode: "Modus", swap: "Hubs", speed: "Tempo", batt: "Akku" } },
};

// ---- layout tables (px rects from the HMI spec) ----
// Each driving control: function + direction (+1/-1) + a direction sub-label key.
const CONTROLS = [
  { fn: "left_track",  dir: +1, rect: [64, 180, 221, 138] },
  { fn: "left_track",  dir: -1, rect: [73, 759, 199, 121] },
  { fn: "right_track", dir: +1, rect: [1388, 180, 221, 138] },
  { fn: "right_track", dir: -1, rect: [1398, 759, 198, 121] },
  { fn: "arm_lift",    dir: +1, rect: [468, 177, 130, 144], k: "up" },
  { fn: "arm_lift",    dir: -1, rect: [468, 321, 130, 144], k: "down" },
  { fn: "front_arm",   dir: +1, rect: [800, 174, 130, 145], k: "out" },
  { fn: "front_arm",   dir: -1, rect: [800, 319, 130, 145], k: "in" },
  { fn: "rotation",    dir: -1, rect: [1038, 346, 121, 115], k: "left" },
  { fn: "rotation",    dir: +1, rect: [1181, 346, 119, 115], k: "right" },
  { fn: "bucket",      dir: +1, rect: [379, 735, 252, 134], k: "open" },
  { fn: "bucket",      dir: -1, rect: [708, 735, 252, 134], k: "close" },
];
// Panel titles (show the function's label + live value).
const TITLES = [
  { fn: "left_track",  rect: [78, 128, 192, 38] },
  { fn: "arm_lift",    rect: [409, 128, 186, 36] },
  { fn: "front_arm",   rect: [738, 128, 194, 36] },
  { fn: "rotation",    rect: [1083, 128, 177, 36] },
  { fn: "right_track", rect: [1404, 128, 190, 38] },
  { fn: "bucket", k: "open",  rect: [408, 550, 187, 36] },
  { fn: "bucket", k: "close", rect: [739, 550, 193, 36] },
];
// Fixed direction hints (Forward / Backward under the tracks).
const DIRLABELS = [
  { k: "forward",  rect: [118, 342, 108, 27] },
  { k: "backward", rect: [116, 715, 113, 26] },
  { k: "forward",  rect: [1443, 342, 108, 27] },
  { k: "backward", rect: [1441, 715, 114, 26] },
];
// Telemetry/info textboxes (placeholders; a few show live status).
const INFOBOXES = [
  { id: "ib_title", rect: [747, 33, 198, 49], static: "moldqueen" },
  { id: "ib_mode",  rect: [1093, 37, 91, 44] },
  { id: "ib_batt",  rect: [1347, 41, 106, 36], key: "batt", val: "—" },
  { id: "ib_row1",  rect: [1124, 548, 162, 41], key: "mode" },
  { id: "ib_row2",  rect: [1124, 642, 162, 41], key: "swap" },
  { id: "ib_row3",  rect: [1124, 736, 162, 41], key: "speed" },
  { id: "ib_row4",  rect: [1124, 832, 162, 41], key: "batt", val: "—" },
];

// ---- state ----
let ws = null, lifecycle = "IDLE";
let lang = localStorage.getItem("mk4_lang") || "en";
let speed = +(localStorage.getItem("mk4_speed") || 6);
let defaultMap = null, activeMap = null, deviceSwap = false, synced = false;
let grid = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
const held = new Map();           // element -> {fn, dir}
const FN = ["left_track", "right_track", "arm_lift", "front_arm", "rotation", "bucket"];

const tr = () => T[lang];
function loadStoredMap() {
  try { return JSON.parse(localStorage.getItem("mk4_active_map") || "null"); } catch { return null; }
}

// ---- WebSocket ----
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

function connect() {
  ws = new WebSocket("ws://" + location.hostname + ":" + window.MK4_WS_PORT);
  ws.onopen = () => { setDot(true); };
  ws.onclose = () => { setDot(false); releaseAll(); setTimeout(connect, 1000); };
  ws.onerror = () => ws.close();
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === "lifecycle") setLifecycle(m.state);
    else if (m.type === "state" && m.slots) { grid = m.slots; refreshValues(); }
    else if (m.type === "map") onMap(m);
    else if (m.type === "mapresult") onMapResult(m);
  };
}

function onMap(m) {
  defaultMap = m.default; deviceSwap = !!m.device_swap;
  if (!synced) {
    // first reconciliation with the server: re-apply a stored client override if any
    synced = true;
    const stored = loadStoredMap();
    if (stored) { activeMap = stored; send({ cmd: "map", action: "set", map: stored }); }
    else activeMap = m.active;
  } else {
    activeMap = m.active;   // thereafter trust the server's active map
  }
  releaseAll();
  renderLabels(); if (!$("settings").classList.contains("hidden")) buildSettings();
}

function onMapResult(m) {
  const el = $("mapMsg"); if (!el) return;
  if (m.ok) {
    el.className = "ok";
    el.textContent = m.action === "promote" ? tr().promoted : tr().applied;
  } else {
    el.className = "bad";
    el.textContent = (m.errors || ["error"]).join("; ");
  }
}

// ---- lifecycle / setup ----
function setDot(ok) { const d = $("wsDot"); if (d) d.className = "dot" + (ok ? " ok" : ""); }

function setLifecycle(state) {
  lifecycle = state;
  $("overlay").classList.toggle("locked", state !== "READY");
  if (state !== "READY") releaseAll();
  renderTopbar(); renderHint(); refreshValues();
  const t = $("test_holding"); // refresh disabled state of any settings test buttons
  if (!$("settings").classList.contains("hidden")) buildSettings();
}

// ---- build the stage overlay ----
function el(cls, style, html) {
  const d = document.createElement("div");
  d.className = cls; if (style) d.style.cssText = style; if (html != null) d.innerHTML = html;
  return d;
}

function buildStage() {
  const ov = $("overlay");
  ov.innerHTML = "";
  // direction hint labels
  for (const d of DIRLABELS) ov.appendChild(el("lbl dir", pct(d.rect), tr().dir[d.k]));
  // info / telemetry textboxes
  for (const b of INFOBOXES) {
    const box = el("lbl info", pct(b.rect));
    box.id = b.id; ov.appendChild(box);
  }
  // titles
  for (const t of TITLES) {
    const box = el("lbl title", pct(t.rect));
    box.id = "title_" + t.fn + (t.k ? "_" + t.k : "");
    box.dataset.fn = t.fn; if (t.k) box.dataset.k = t.k;
    ov.appendChild(box);
  }
  // hotspots (press-and-hold)
  for (const c of CONTROLS) {
    const b = document.createElement("button");
    b.className = "hot"; b.style.cssText = pct(c.rect);
    b.dataset.fn = c.fn; b.dataset.dir = c.dir;
    b.title = (activeMap ? funcLabel(c.fn) : c.fn) + (c.k ? " — " + tr().dir[c.k] : "");
    b.addEventListener("pointerdown", e => { e.preventDefault(); startHold(b, c.fn, c.dir); });
    const up = () => stopHold(b);
    b.addEventListener("pointerup", up);
    b.addEventListener("pointerleave", up);
    b.addEventListener("pointercancel", up);
    ov.appendChild(b);
  }
  renderLabels();
}

// ---- driving (press-and-hold -> release snaps to neutral) ----
function startHold(b, fn, dir) {
  if (lifecycle !== "READY" || held.has(b)) return;
  held.set(b, { fn, dir }); b.classList.add("active");
  send({ cmd: "drive", function: fn, value: dir * speed });
}
function stopHold(b) {
  if (!held.has(b)) return;
  const { fn } = held.get(b); held.delete(b); b.classList.remove("active");
  // only neutralize the function if no other held control still drives it
  if (![...held.values()].some(h => h.fn === fn)) send({ cmd: "drive", function: fn, value: 0 });
}
function releaseAll() { [...held.keys()].forEach(stopHold); }

// ---- labels / values ----
function funcLabel(fn) {
  const a = activeMap && activeMap.functions[fn];
  return a ? (lang === "de" ? a.label_de : a.label_en) || fn : fn;
}
// client-side resolve of function -> (slot, channel) for reading the live grid
function resolveSC(fn) {
  const a = activeMap && activeMap.functions[fn]; if (!a) return null;
  let slot = a.slot; if (deviceSwap && (slot === 0 || slot === 1)) slot = 1 - slot;
  return [slot, a.channel];
}
function funcValue(fn) { const sc = resolveSC(fn); return sc ? (grid[sc[0]] || [])[sc[1]] || 0 : 0; }

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
  setInfo("ib_row3", tr().info.speed + ": " + speed + "/7");
}
function setInfo(id, text) {
  const b = $(id); if (b && !b.dataset.static) b.innerHTML = text;
}

// ---- top toolbar ----
function tbtn(label, cls, on) {
  const b = document.createElement("button"); b.innerHTML = label;
  if (cls) b.className = cls; b.onclick = on; return b;
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

  const sp = el("", "", "");
  sp.id = "speedWrap";
  sp.innerHTML = `<span>${tr().speed}</span>`;
  const r = document.createElement("input");
  r.type = "range"; r.min = "1"; r.max = "7"; r.step = "1"; r.value = speed;
  const out = el("", "", "" + speed); out.style.minWidth = "1em";
  r.oninput = () => { speed = +r.value; out.textContent = speed; localStorage.setItem("mk4_speed", speed); refreshValues(); };
  sp.appendChild(r); sp.appendChild(out);
  tb.appendChild(sp);

  tb.appendChild(el("grow"));
  tb.appendChild(tbtn(tr().stop, "", stopAll)).id = "stopBtn";
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

function stopAll() { releaseAll(); send({ cmd: "stop" }); }
function toggleLang() {
  lang = lang === "en" ? "de" : "en"; localStorage.setItem("mk4_lang", lang);
  document.documentElement.lang = lang;
  buildStage(); renderTopbar(); renderHint();
  if (!$("settings").classList.contains("hidden")) buildSettings();
}

// ---- settings / channel-assignment view (PART C) ----
let editMap = null;     // working copy while the sheet is open

function openSettings() {
  editMap = JSON.parse(JSON.stringify(activeMap));
  buildSettings();
  $("settings").classList.remove("hidden");
}
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
      <td class="fn">${fn}${tag}</td>
      <td><select class="e-slot">${slots}</select></td>
      <td><select class="e-ch">${chans}</select></td>
      <td style="text-align:center"><input type="checkbox" class="e-inv"${a.invert ? " checked" : ""}></td>
      <td><input type="text" class="e-en" value="${(a.label_en || "").replace(/"/g, "&quot;")}"></td>
      <td><input type="text" class="e-de" value="${(a.label_de || "").replace(/"/g, "&quot;")}"></td>
      <td><button class="test" data-fn="${fn}">${t.test}</button></td>
    </tr>`;
  }).join("");

  $("settings").innerHTML = `<div class="sheet">
    <h2>${t.assign}</h2>
    <p class="sub">${t.assignSub}</p>
    <div class="srow">
      <label><input type="checkbox" id="swapChk"${deviceSwap ? " checked" : ""}> ${t.deviceSwap}</label>
      <span class="muted">${lifecycle !== "READY" ? "· " + t.readyOnly + " (test)" : ""}</span>
    </div>
    <table class="map">
      <thead><tr><th>${t.fn}</th><th>${t.slot}</th><th>${t.ch}</th><th>${t.invert}</th>
        <th>${t.labEn}</th><th>${t.labDe}</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="actions">
      <button class="apply" id="applyBtn">${t.apply}</button>
      <button class="promote" id="promoteBtn">${t.promote}</button>
      <button id="resetMapBtn">${t.resetMap}</button>
      <button id="closeBtn">${t.close}</button>
      <span id="mapMsg"></span>
    </div>
  </div>`;

  // edit handlers
  $("settings").querySelectorAll("tr[data-fn]").forEach(trEl => {
    const fn = trEl.dataset.fn, a = editMap.functions[fn];
    trEl.querySelector(".e-slot").onchange = e => { a.slot = +e.target.value; };
    trEl.querySelector(".e-ch").onchange = e => { a.channel = +e.target.value; };
    trEl.querySelector(".e-inv").onchange = e => { a.invert = e.target.checked; };
    trEl.querySelector(".e-en").oninput = e => { a.label_en = e.target.value; };
    trEl.querySelector(".e-de").oninput = e => { a.label_de = e.target.value; };
    const tb = trEl.querySelector(".test");
    tb.disabled = lifecycle !== "READY";
    const start = e => { e.preventDefault(); if (lifecycle !== "READY") return;
      tb.classList.add("held"); send({ cmd: "drive", function: fn, value: speed }); };
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

function releaseSettingsTests() {
  $("settings").querySelectorAll(".test.held").forEach(tb => {
    tb.classList.remove("held"); send({ cmd: "drive", function: tb.dataset.fn, value: 0 });
  });
}

function applyMap(promote) {
  // client-side duplicate pre-check for instant feedback (server validates too)
  const seen = {}, errs = [];
  for (const fn of FN) {
    const a = editMap.functions[fn], key = a.slot + "/" + a.channel;
    if (seen[key]) errs.push(`${fn} ↔ ${seen[key]}: slot ${a.slot}/ch ${a.channel}`);
    else seen[key] = fn;
  }
  const msg = $("mapMsg");
  if (errs.length) { msg.className = "bad"; msg.textContent = "duplicate: " + errs.join(", "); return; }
  localStorage.setItem("mk4_active_map", JSON.stringify(editMap));
  send({ cmd: "map", action: promote ? "promote" : "set", map: editMap });
}

// ---- wiring ----
document.addEventListener("keydown", e => {
  if (e.code === "Space" || e.code === "Escape") { e.preventDefault(); stopAll(); }
});
window.addEventListener("blur", releaseAll);
document.addEventListener("visibilitychange", () => { if (document.hidden) releaseAll(); });

// seed from the server-injected initial state so the UI renders before the WS opens
if (window.MK4_INIT) {
  const i = window.MK4_INIT;
  defaultMap = i.default; deviceSwap = !!i.device_swap; lifecycle = i.lifecycle || "IDLE";
  activeMap = loadStoredMap() || i.active;
}
document.documentElement.lang = lang;
buildStage();
renderTopbar();
renderHint();
connect();
