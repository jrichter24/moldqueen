// moldqueen — GENERIC controller control surface (model-agnostic, MOTOR-based). The chrome +
// runtime (WS/lifecycle/keepalive/STOP, menu, tabbed settings, connect wizard, status light,
// title, auto-assign wizard SHELL) live in chrome.js (MK4Chrome). This file is ONLY the per-
// layout control surface + the auto-assign profiles/algorithm.
//
// CONTROL MODEL: a MOTOR = one channel driven BOTH ways (+/-). Vertically/horizontally-opposite
// controls share a motor (top/up/right = +, bottom/down/left = -). One two-axis stick = TWO
// motors (vertical + horizontal); a one-axis = one; the d-pad = two; each top-button COLUMN
// (1/3, 2/4) = one; the face diamond = two (A/D vertical, B/C horizontal). Red center = STOP.
"use strict";
const $ = id => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const el = (cls, style, html) => { const d = document.createElement("div"); d.className = cls; if (style) d.style.cssText = style; if (html != null) d.innerHTML = html; return d; };
const pct = ([x, y, w, h]) => `left:${x}%;top:${y}%;width:${w}%;height:${h}%;`;   // spec rects are already %

const SPECS = {
  generic_12axis: {
    image: "/assets/generic_layouts/generic_12_axis.png",
    aspect: [1774, 887],
    title: { default: "12-axis controller", rect: [34.39, 5.41, 31.57, 7.89] },
    controls: [
      // d-pad: up/down -> dpad_v, left/right -> dpad_h
      { type: "dpad", motors: ["dpad_h", "dpad_v"], h: "dpad_h", v: "dpad_v", parts: {
          up: [10.60, 17.59, 5.81, 15.33], down: [10.37, 43.63, 6.31, 14.21],
          left: [3.44, 30.89, 8.00, 12.74], right: [16.35, 30.89, 8.06, 12.74] } },
      // one-axis edge controls (vertical only)
      { type: "oneaxis", id: "laxis", motors: ["laxis"], v: "laxis", rect: [5.07, 61.78, 8.46, 26.61] },
      { type: "oneaxis", id: "raxis", motors: ["raxis"], v: "raxis", rect: [86.53, 61.78, 8.46, 26.61] },
      // two-axis sticks: vertical + horizontal = two motors
      { type: "twoaxis", id: "lstick", motors: ["lstick_h", "lstick_v"], h: "lstick_h", v: "lstick_v", rect: [19.73, 53.55, 16.63, 34.39] },
      { type: "twoaxis", id: "rstick", motors: ["rstick_h", "rstick_v"], h: "rstick_h", v: "rstick_v", rect: [63.98, 53.55, 16.63, 34.39] },
      // top buttons: COLUMNS share a motor (top = +, bottom = -)
      { type: "btnpair", motors: ["btn_13"], motor: "btn_13", plus: [36.92, 15.67, 11.84, 13.87], minus: [36.92, 33.82, 11.84, 13.87] },
      { type: "btnpair", motors: ["btn_24"], motor: "btn_24", plus: [50.17, 15.67, 11.84, 13.87], minus: [50.17, 33.82, 11.84, 13.87] },
      // face diamond (centers from generic_12_axis_with_hints.png): A(top)+ / D(bottom)- vertical ; B(right)+ / C(left)- horizontal
      { type: "btnpair", motors: ["face_v"], motor: "face_v", plus: [82.78, 15.95, 7.44, 14.88], minus: [83.09, 42.56, 7.44, 14.88] },
      { type: "btnpair", motors: ["face_h"], motor: "face_h", plus: [89.60, 29.59, 7.44, 14.88], minus: [75.79, 29.48, 7.44, 14.88] },
      { type: "stop", rect: [44.53, 69.90, 9.86, 19.73], cap: [49.98, 64.5] },   // cap = [painted-dot centerX%, caption bottomY%] — bottomY gives a clear gap above the button (dot top ≈70.7%)
    ],
  },
  // Brick-style (PS-like) controller — SAME motor model + engine + auto-assign, only the bg image
  // and hotspot rects differ. Rects transcribed from ps_like_gampepad_layout_spec.md (1717×916).
  generic_brick: {
    image: "/assets/generic_layouts/ps_like_gampepad.png",
    aspect: [1717, 916],
    title: { default: "Brick controller", rect: [29.1, 7, 40.8, 9], color: "#33373d" },   // dark grey — readable on the light brick body
    // All hotspot centers measured from the yellow targets in ps_like_gampepad_with_hints.png.
    controls: [
      // d-pad (top-left cluster): up/down -> dpad_v, left/right -> dpad_h
      { type: "dpad", motors: ["dpad_h", "dpad_v"], h: "dpad_h", v: "dpad_v", parts: {
          up: [10.66, 16.45, 7.5, 13.5], down: [10.61, 36.81, 7.5, 13.5],
          left: [5.13, 26.33, 7.5, 13.5], right: [16.46, 27.20, 7.5, 13.5] } },
      // one-axis lower outer joysticks (vertical only)
      { type: "oneaxis", id: "laxis", motors: ["laxis"], v: "laxis", rect: [1.31, 72.20, 11, 21] },
      { type: "oneaxis", id: "raxis", motors: ["raxis"], v: "raxis", rect: [87.77, 72.31, 11, 21] },
      // two-axis main sticks: zone centered on the hint (joystick cap) -> knob rests at center (ny=50)
      { type: "twoaxis", id: "lstick", motors: ["lstick_h", "lstick_v"], h: "lstick_h", v: "lstick_v", rect: [24.0, 47.7, 15, 28], ny: 50 },
      { type: "twoaxis", id: "rstick", motors: ["rstick_h", "rstick_v"], h: "rstick_h", v: "rstick_v", rect: [61.0, 47.85, 15, 28], ny: 50 },
      // top-row buttons 1-4: pair 1/3 and 2/4 share a motor (1,2 = +, 3,4 = -)
      { type: "btnpair", motors: ["btn_13"], motor: "btn_13", plus: [35.51, 29.21, 6.5, 8.5], minus: [50.54, 29.37, 6.5, 8.5] },
      { type: "btnpair", motors: ["btn_24"], motor: "btn_24", plus: [43.02, 29.37, 6.5, 8.5], minus: [58.05, 28.99, 6.5, 8.5] },
      // face diamond: A(top)+ / D(bottom)- vertical ; B(right)+ / C(left)- horizontal
      { type: "btnpair", motors: ["face_v"], motor: "face_v", plus: [82.38, 12.39, 7, 13], minus: [82.38, 42.24, 7, 13] },
      { type: "btnpair", motors: ["face_h"], motor: "face_h", plus: [90.36, 27.18, 7, 13], minus: [74.34, 26.96, 7, 13] },
      { type: "stop", rect: [45.56, 73.68, 8.7, 16.4], cap: [49.91, 68] },   // red center; cap = [dot centerX%, caption bottomY%]
    ],
  },
};
const LAYOUT_ID = window.MK4_LAYOUT_ID || "generic_12axis";
const SPEC = SPECS[LAYOUT_ID];
const FN = SPEC ? [...new Set(SPEC.controls.flatMap(c => c.motors || []))] : [];

let A;   // the chrome api (set in buildSurface)

// ---- control widgets (transparent hit-zones; drive MOTOR channels with the correct sign) ----
function makeOneAxis(c) {
  const fn = c.v, travel = 40;
  const z = el("gx-zone gx-one" + (A.isUnmapped(fn) ? " unassigned" : ""), pct(c.rect));
  if (c.id) z.dataset.cid = c.id;
  const knob = el("gx-knob"); z.appendChild(knob);
  let pid = null;
  const setY = clientY => {
    const r = z.getBoundingClientRect();
    let f = clamp(-((clientY - (r.top + r.height / 2)) / (r.height / 2)), -1, 1);
    if (Math.abs(f) < 0.12) f = 0;
    knob.style.top = (50 - f * travel) + "%";
    const v = A.scaleVal(fn, f); z.classList.toggle("active", v !== 0); A.driveFn(fn, v);
  };
  const reset = () => { pid = null; knob.style.top = "50%"; z.classList.remove("active"); A.driveFn(fn, 0); };
  z.addEventListener("pointerdown", e => { if (A.lifecycle() !== "READY") return; A.clearStopLatch(); pid = e.pointerId; try { z.setPointerCapture(pid); } catch {} e.preventDefault(); setY(e.clientY); });
  z.addEventListener("pointermove", e => { if (e.pointerId === pid) setY(e.clientY); });
  const up = e => { if (pid === null || (e && e.pointerId !== pid)) return; try { z.releasePointerCapture(pid); } catch {} reset(); };
  z.addEventListener("pointerup", up); z.addEventListener("pointercancel", up); z.addEventListener("lostpointercapture", up);
  A.addControl(reset);
  return z;
}
function makeTwoAxis(c) {
  const fnh = c.h, fnv = c.v, travel = 34, NY = (c.ny != null ? c.ny : 57);   // NY = neutral Y% (per-control): knob rests centered in the painted stick cap
  const z = el("gx-zone gx-two" + (A.isUnmapped(fnh) && A.isUnmapped(fnv) ? " unassigned" : ""), pct(c.rect));
  if (c.id) z.dataset.cid = c.id;
  const knob = el("gx-knob"); knob.style.top = NY + "%"; z.appendChild(knob);
  let pid = null;
  const setXY = (cx, cy) => {
    const r = z.getBoundingClientRect();
    let fx = clamp((cx - (r.left + r.width / 2)) / (r.width / 2), -1, 1);     // right = +
    let fy = clamp(-((cy - (r.top + r.height / 2)) / (r.height / 2)), -1, 1);  // up = +
    if (Math.abs(fx) < 0.12) fx = 0; if (Math.abs(fy) < 0.12) fy = 0;
    knob.style.left = (50 + fx * travel) + "%"; knob.style.top = (NY - fy * travel) + "%";
    const vh = A.scaleVal(fnh, fx), vv = A.scaleVal(fnv, fy);
    z.classList.toggle("active", vh !== 0 || vv !== 0);
    A.driveFn(fnh, vh); A.driveFn(fnv, vv);
  };
  const reset = () => { pid = null; knob.style.left = "50%"; knob.style.top = NY + "%"; z.classList.remove("active"); A.driveFn(fnh, 0); A.driveFn(fnv, 0); };
  z.addEventListener("pointerdown", e => { if (A.lifecycle() !== "READY") return; A.clearStopLatch(); pid = e.pointerId; try { z.setPointerCapture(pid); } catch {} e.preventDefault(); setXY(e.clientX, e.clientY); });
  z.addEventListener("pointermove", e => { if (e.pointerId === pid) setXY(e.clientX, e.clientY); });
  const up = e => { if (pid === null || (e && e.pointerId !== pid)) return; try { z.releasePointerCapture(pid); } catch {} reset(); };
  z.addEventListener("pointerup", up); z.addEventListener("pointercancel", up); z.addEventListener("lostpointercapture", up);
  A.addControl(reset);
  return z;
}
// one button drives `fn` to `dir`*cap on press, 0 on release (used by d-pad arms + button pairs)
function makeDirBtn(fn, dir, rect) {
  const b = document.createElement("button"); b.className = "gx-dpadbtn" + (A.isUnmapped(fn) ? " unassigned" : ""); b.style.cssText = pct(rect);
  b.dataset.fn = fn; b.dataset.dir = dir;
  let on = false;
  const press = e => { e.preventDefault(); if (A.lifecycle() !== "READY" || on) return; A.clearStopLatch(); on = true; b.classList.add("active"); A.driveFn(fn, A.scaleVal(fn, dir)); };
  const rel = () => { if (!on) return; on = false; b.classList.remove("active"); A.driveFn(fn, 0); };
  b.addEventListener("pointerdown", press); b.addEventListener("pointerup", rel); b.addEventListener("pointercancel", rel); b.addEventListener("pointerleave", rel); b.addEventListener("lostpointercapture", rel);
  A.addControl(() => { on = false; b.classList.remove("active"); });
  return b;
}
function makeDpad(c) {
  const frag = document.createDocumentFragment();
  frag.appendChild(makeDirBtn(c.v, 1, c.parts.up));   frag.appendChild(makeDirBtn(c.v, -1, c.parts.down));
  frag.appendChild(makeDirBtn(c.h, -1, c.parts.left)); frag.appendChild(makeDirBtn(c.h, 1, c.parts.right));
  return frag;
}
function makeButtonPair(c) {   // top/right press = +cap, bottom/left press = -cap, on ONE motor
  const frag = document.createDocumentFragment();
  frag.appendChild(makeDirBtn(c.motor, 1, c.plus));
  frag.appendChild(makeDirBtn(c.motor, -1, c.minus));
  return frag;
}
function makeStop(c) {
  // "STOP" caption centered above the PAINTED red dot (cap=[centerX%, bottomY%]); CSS transform does the
  // exact centering (translate -50%,-100%), so it's dead-center on the dot regardless of text width.
  const frag = document.createDocumentFragment();
  const cx = c.cap ? c.cap[0] : (c.rect[0] + c.rect[2] / 2);
  const by = c.cap ? c.cap[1] : (c.rect[1] - 1.5);
  const cap = el("gx-stopcap", `left:${cx}%;top:${by}%;`, `<span>${A.dict().stop}</span>`);
  const b = el("gx-stop", pct(c.rect)); b.id = "estopBtn";
  b.addEventListener("pointerdown", e => { e.preventDefault(); b.classList.add("hit"); A.stopAll(); try { b.setPointerCapture(e.pointerId); } catch {} });
  const up = () => b.classList.remove("hit"); b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up);
  frag.appendChild(cap); frag.appendChild(b);
  return frag;
}
function buildSurface(api) {
  A = api;
  const stage = $("stage"), ov = $("overlay");
  $("bg").src = SPEC.image;
  stage.style.aspectRatio = SPEC.aspect[0] + " / " + SPEC.aspect[1];
  stage.style.width = "min(100cqw, calc(100cqh * " + SPEC.aspect[0] + " / " + SPEC.aspect[1] + "))";
  ov.innerHTML = "";
  for (const c of SPEC.controls) {
    const n = c.type === "oneaxis" ? makeOneAxis(c) : c.type === "twoaxis" ? makeTwoAxis(c)
            : c.type === "dpad" ? makeDpad(c) : c.type === "btnpair" ? makeButtonPair(c)
            : c.type === "stop" ? makeStop(c) : null;
    if (n) ov.appendChild(n);
  }
}

// ---- profiles: ordered MOTOR priority (which motors activate as N grows) ----
const PROFILES = {
  vehicle: ["lstick_v", "rstick_v", "lstick_h", "rstick_h", "laxis", "raxis", "dpad_v", "dpad_h", "btn_13", "btn_24", "face_v", "face_h"],
  car:     ["lstick_v", "rstick_h", "rstick_v", "lstick_h", "laxis", "raxis", "dpad_v", "dpad_h", "btn_13", "btn_24", "face_v", "face_h"],
  custom:  ["lstick_v", "rstick_v", "lstick_h", "rstick_h", "laxis", "raxis", "dpad_v", "dpad_h", "btn_13", "btn_24", "face_v", "face_h"],
};
const CHANNEL_ORDER = [0, 2, 1, 3];   // a hub's two main motor ports (ch0/ch2) first, then ch1/ch3; fill one slot before the next
// compute(profile, N) -> { motor: {slot, channel, invert} }. Each motor = ONE channel
// (N motors -> N channels). Unlisted motors stay unmapped. Walk slots in CHANNEL_ORDER.
function computeAssignment(profileId, N) {
  const pr = PROFILES[profileId] || PROFILES.custom;
  const out = {}; let slot = 0, k = 0;
  for (let i = 0; i < Math.min(clamp(N | 0, 0, 12), pr.length); i++) {
    if (slot > 2) break;
    out[pr[i]] = { slot, channel: CHANNEL_ORDER[k], invert: false };
    k++; if (k === 4) { slot++; k = 0; }
  }
  return out;
}
const MOTOR_LABELS = {
  lstick_v: "Left stick ↕", lstick_h: "Left stick ↔", rstick_v: "Right stick ↕", rstick_h: "Right stick ↔",
  laxis: "Left axis ↕", raxis: "Right axis ↕", dpad_v: "D-pad ↕", dpad_h: "D-pad ↔",
  btn_13: "Buttons 1/3", btn_24: "Buttons 2/4", face_v: "Face A/D", face_h: "Face B/C",
};
// Gamepad defaults: physical control -> same-named motor (DualSense numbering — axes 0=LSx 1=LSy
// 2=RSx 3=RSy; buttons 0=× 1=○ 2=□ 3=△ 4=L1 5=R1 6=L2 7=R2; d-pad 12=up 13=down 14=left 15=right).
// Editable per-motor in the Gamepad tab. laxis/raxis have no natural pad stick -> left unbound.
const PAD_DEFAULT = {
  lstick_h: { type: "axis", axis: 0 },               lstick_v: { type: "axis", axis: 1, invert: true },   // up = +
  rstick_h: { type: "axis", axis: 2 },               rstick_v: { type: "axis", axis: 3, invert: true },
  dpad_v:   { type: "buttons", neg: 13, pos: 12 },   dpad_h:   { type: "buttons", neg: 14, pos: 15 },
  face_v:   { type: "buttons", neg: 0,  pos: 3 },     face_h:   { type: "buttons", neg: 2,  pos: 1 },
  btn_13:   { type: "buttons", neg: 6,  pos: 4 },     btn_24:   { type: "buttons", neg: 7,  pos: 5 },
  laxis:    { type: "buttons", neg: null, pos: null }, raxis:  { type: "buttons", neg: null, pos: null },
};

if (!SPEC) { document.body.innerHTML = "<p style='color:#e8eef6;padding:1rem'>Unknown generic layout: " + LAYOUT_ID + "</p>"; }
else MK4Chrome.create({
  layoutId: LAYOUT_ID,
  fnList: FN,
  connectLabel: t => t.raw.connect,                     // generic "Connect device" (never excavator)
  title: { default: SPEC.title.default, style: pct(SPEC.title.rect), color: SPEC.title.color },
  features: { deviceSwap: false, gamepad: true, labelsTab: true },
  gamepadDefault: PAD_DEFAULT,                          // physical control -> same-named motor (editable in the Gamepad tab)
  autoAssign: {
    defaultN: 2,
    profiles: [
      { id: "vehicle", label: t => t.gen.profVehicle, zeroBox: true },
      { id: "car", label: t => t.gen.profCar, zeroBox: true },
      { id: "custom", label: t => t.gen.profCustom, zeroBox: false },
    ],
    compute: computeAssignment,
    motorLabel: m => MOTOR_LABELS[m] || m,
  },
  zeroBoxHint: t => t.gen.zeroBoxConnect,               // one-liner in the connect-wizard slot step
  // device-neutral startup/connect-guide wording for generic layouts (excavator passes nothing -> keeps its own)
  wizardText: t => ({ next: t.suGen.next, s1b: t.suGen.s1b, s2t: t.suGen.s2t, s2b: t.suGen.s2b, wizTitle: t.suGen.wizTitle }),
  buildSurface,
});
