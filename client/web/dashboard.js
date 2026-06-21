// moldqueen — EXCAVATOR (13112) control surface. The chrome + runtime (WS/lifecycle/keepalive/
// STOP, menu, settings, wizard, gamepad, status light, title) live in the shared chrome.js
// (MK4Chrome). This file is ONLY the layout-specific control surface: the percent-positioned
// joysticks / hold-buttons / in-art labels + telemetry + the red STOP, all driving the shared
// api.driveFn (so resolution/keepalive/STOP are identical to every other layout).
"use strict";

// ---- geometry: background is 1672×941; place everything in % of that ----
const W = 1672, H = 941;
const $ = id => document.getElementById(id);
const pct = ([x, y, w, h]) =>
  `left:${(x / W * 100).toFixed(3)}%;top:${(y / H * 100).toFixed(3)}%;` +
  `width:${(w / W * 100).toFixed(3)}%;height:${(h / H * 100).toFixed(3)}%;`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const el = (cls, style, html) => { const d = document.createElement("div"); d.className = cls; if (style) d.style.cssText = style; if (html != null) d.innerHTML = html; return d; };

const FN = ["left_track", "right_track", "arm_lift", "front_arm", "rotation", "bucket"];
// Proportional drag joysticks; rotation + bucket are press-and-hold buttons.
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
const INFOBOXES = [   // (the custom title #ib_title is the chrome's — it renders it over the top strip)
  { id: "ib_mode",  rect: [1093, 37, 91, 44] },   // blank — lifecycle shown only by the status light
  { id: "ib_batt",  rect: [1347, 41, 106, 36], static: "—" },
  { id: "ib_row1",  rect: [1124, 548, 162, 41] },
  { id: "ib_row2",  rect: [1124, 642, 162, 41] },
  { id: "ib_row3",  rect: [1124, 736, 162, 41] },
];
const ESTOP = [1044, 820, 250, 74];   // in-art red STOP (always visible; the chrome wires stopAll)
// Sensible DualSense defaults for the gamepad (axes: 0=LSx 1=LSy 2=RSx 3=RSy; buttons 0=× 1=○ 2=□ 3=△ 4=L1 5=R1 6=L2 7=R2).
const PAD_DEFAULT = {
  left_track:  { type: "axis",    axis: 1, invert: true },
  right_track: { type: "axis",    axis: 3, invert: true },
  arm_lift:    { type: "buttons", neg: 0,  pos: 3 },
  front_arm:   { type: "buttons", neg: 4,  pos: 5 },
  rotation:    { type: "buttons", neg: 2,  pos: 1 },
  bucket:      { type: "buttons", neg: 6,  pos: 7 },
};

let A;   // the chrome api (set in buildSurface)

// ---- press-and-hold counters (rotation / bucket) ----
const holders = {};
function addHold(fn) { holders[fn] = (holders[fn] || 0) + 1; }
function relHold(fn) { holders[fn] = Math.max(0, (holders[fn] || 0) - 1); if (!holders[fn]) A.driveFn(fn, 0); }

// the in-dashboard emergency STOP button (same all-neutral as the keyboard STOP)
function makeEstop() {
  const b = el("estop", pct(ESTOP), `<span>${A.dict().stop}</span>`);
  b.id = "estopBtn";
  b.addEventListener("pointerdown", e => {
    e.preventDefault(); b.classList.add("hit"); A.stopAll();
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
    const val = A.scaleVal(fn, frac);
    joy.classList.toggle("active", val !== 0);
    A.driveFn(fn, val);
  };
  const reset = () => { pid = null; knob.style.top = "50%"; joy.classList.remove("active"); A.driveFn(fn, 0); };
  joy.addEventListener("pointerdown", e => {
    if (A.lifecycle() !== "READY") return;
    A.clearStopLatch();                               // a fresh deliberate touch resumes control
    pid = e.pointerId; try { joy.setPointerCapture(pid); } catch {} e.preventDefault(); setY(e.clientY);
  });
  joy.addEventListener("pointermove", e => { if (e.pointerId === pid) setY(e.clientY); });
  const up = e => { if (pid === null || (e && e.pointerId !== pid)) return;
                    try { joy.releasePointerCapture(pid); } catch {} reset(); };
  joy.addEventListener("pointerup", up);
  joy.addEventListener("pointercancel", up);
  joy.addEventListener("lostpointercapture", up);
  A.addControl(reset);
  return joy;
}
// ---- press-and-hold button (rotation / bucket) ----
function makeBtn(fn, dir, rect, k) {
  const b = document.createElement("button");
  b.className = "hot"; b.style.cssText = pct(rect); b.dataset.fn = fn;
  b.title = A.funcLabel(fn) + " — " + A.dict().dir[k];
  let on = false;
  const press = e => { e.preventDefault(); if (A.lifecycle() !== "READY" || on) return;
    A.clearStopLatch();                               // a fresh deliberate press resumes control
    on = true; b.classList.add("active"); addHold(fn); A.driveFn(fn, A.scaleVal(fn, dir)); };
  const rel = () => { if (!on) return; on = false; b.classList.remove("active"); relHold(fn); };
  b.addEventListener("pointerdown", press);
  b.addEventListener("pointerup", rel);
  b.addEventListener("pointerleave", rel);
  b.addEventListener("pointercancel", rel);
  A.addControl(() => { on = false; b.classList.remove("active"); });
  return b;
}

// ---- labels / live values ----
function setInfo(id, text) { const b = $(id); if (b && !b.dataset.static) b.innerHTML = text; }
function fitLabel(box) {     // shrink a label's font until it fits its textbox (long/two-line labels)
  box.style.fontSize = "";
  let size = parseFloat(getComputedStyle(box).fontSize) || 14, guard = 16;
  while (guard-- > 0 && size > 6 &&
         (box.scrollHeight > box.clientHeight + 1 || box.scrollWidth > box.clientWidth + 1)) {
    size -= 1; box.style.fontSize = size + "px";
  }
}
function renderLabels() {
  if (!A || !A.getMap()) return;
  const t = A.dict();
  for (const ti of TITLES) {
    const box = $("title_" + ti.fn + (ti.k ? "_" + ti.k : "")); if (!box) continue;
    const sub = ti.k ? " · " + t.dir[ti.k] : "";
    box.innerHTML = '<span class="lt">' + A.funcLabel(ti.fn) + sub + ' <span class="v"></span></span>';
    fitLabel(box);
  }
  refreshValues();
}
function refreshValues() {
  if (!A) return;
  const t = A.dict();
  for (const ti of TITLES) {
    const box = $("title_" + ti.fn + (ti.k ? "_" + ti.k : "")); if (!box) continue;
    const v = A.funcValue(ti.fn), span = box.querySelector(".v");
    if (span) span.textContent = v ? (v > 0 ? "+" + v : "" + v) : "";
    box.classList.toggle("driving", !!v);
  }
  // lifecycle state is shown ONLY by the status light — no lifecycle text on the dashboard.
  setInfo("ib_row1", t.info.swap + ": " + (A.deviceSwap() ? t.swapOn : t.swapOff));
  setInfo("ib_row2", t.info.speed + ": drag");
}

// ---- the surface build (the chrome calls this on boot / map change / language change) ----
function buildSurface(api) {
  A = api;
  const t = A.dict();
  const ov = $("overlay"); ov.innerHTML = "";
  for (const d of DIRLABELS) ov.appendChild(el("lbl dir", pct(d.rect), t.dir[d.k]));
  for (const b of INFOBOXES) { const box = el("lbl info", pct(b.rect)); box.id = b.id; if (b.static != null) { box.dataset.static = "1"; box.textContent = b.static; } ov.appendChild(box); }
  for (const ti of TITLES) {
    const box = el("lbl title", pct(ti.rect));
    box.id = "title_" + ti.fn + (ti.k ? "_" + ti.k : "");
    ov.appendChild(box);
  }
  for (const j of JOYS) ov.appendChild(makeJoy(j));
  for (const b of BTNS) ov.appendChild(makeBtn(b.fn, b.dir, b.rect, b.k));
  ov.appendChild(makeEstop());
  renderLabels();
}

MK4Chrome.create({
  layoutId: "excavator",
  fnList: FN,
  mapUrl: "/channel_map.excavator.json",
  connectLabel: t => t.connect,                         // "Connect Excavator"
  title: { default: "Excavator 13112", style: pct([646, 33, 380, 49]) },
  features: { deviceSwap: true, gamepad: true, labelsTab: true },
  gamepadDefault: PAD_DEFAULT,
  buildSurface,
  refresh: () => refreshValues(),                       // live telemetry/values on lifecycle/state
  onResize: () => renderLabels(),                       // re-fit labels to the new stage size
  onNeutralize: () => { for (const k in holders) holders[k] = 0; },
});
