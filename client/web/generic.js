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
      // face diamond: A(top)+ / D(bottom)- vertical ; B(right)+ / C(left)- horizontal
      { type: "btnpair", motors: ["face_v"], motor: "face_v", plus: [82.30, 16.57, 7.44, 14.88], minus: [82.30, 45.55, 7.44, 14.88] },
      { type: "btnpair", motors: ["face_h"], motor: "face_h", plus: [88.90, 31.91, 7.44, 14.88], minus: [75.08, 31.91, 7.44, 14.88] },
      { type: "stop", rect: [44.53, 69.90, 9.86, 19.73], cap: [49.98, 64.5] },   // cap = [painted-dot centerX%, caption bottomY%] — bottomY gives a clear gap above the button (dot top ≈70.7%)
    ],
  },
  // Brick-style (PS-like) controller — SAME motor model + engine + auto-assign, only the bg image
  // and hotspot rects differ. Rects transcribed from ps_like_gampepad_layout_spec.md (1717×916).
  generic_brick: {
    image: "/assets/generic_layouts/ps_like_gampepad.png",
    aspect: [1717, 916],
    title: { default: "Brick controller", rect: [29.1, 7, 40.8, 9] },
    controls: [
      // d-pad (top-left cluster): up/down -> dpad_v, left/right -> dpad_h
      { type: "dpad", motors: ["dpad_h", "dpad_v"], h: "dpad_h", v: "dpad_v", parts: {
          up: [10.7, 16.4, 6.1, 13.1], down: [10.5, 42.0, 6.4, 12.6],
          left: [3.4, 28.9, 7.6, 11.5], right: [17.2, 28.9, 7.6, 11.5] } },
      // one-axis lower outer joysticks (vertical only)
      { type: "oneaxis", id: "laxis", motors: ["laxis"], v: "laxis", rect: [2.0, 74.5, 9.9, 18.6] },
      { type: "oneaxis", id: "raxis", motors: ["raxis"], v: "raxis", rect: [87.9, 74.5, 9.9, 18.6] },
      // two-axis main sticks: vertical + horizontal = two motors
      { type: "twoaxis", id: "lstick", motors: ["lstick_h", "lstick_v"], h: "lstick_h", v: "lstick_v", rect: [22.8, 49.7, 16.0, 31.1] },
      { type: "twoaxis", id: "rstick", motors: ["rstick_h", "rstick_v"], h: "rstick_h", v: "rstick_v", rect: [61.2, 49.7, 16.0, 31.1] },
      // top-row buttons 1-4: pair 1/3 and 2/4 share a motor (1,2 = +, 3,4 = -) — same model as the 12-axis
      { type: "btnpair", motors: ["btn_13"], motor: "btn_13", plus: [36.1, 29.8, 5.2, 6.3], minus: [51.5, 29.8, 5.2, 6.3] },
      { type: "btnpair", motors: ["btn_24"], motor: "btn_24", plus: [43.7, 29.8, 5.2, 6.3], minus: [59.3, 29.8, 5.2, 6.3] },
      // face diamond: A(top)+ / D(bottom)- vertical ; B(right)+ / C(left)- horizontal
      { type: "btnpair", motors: ["face_v"], motor: "face_v", plus: [86.6, 10.4, 6.7, 12.6], minus: [86.2, 42.6, 6.7, 12.6] },
      { type: "btnpair", motors: ["face_h"], motor: "face_h", plus: [91.9, 26.7, 6.7, 12.6], minus: [78.3, 26.7, 6.7, 12.6] },
      { type: "stop", rect: [45.7, 72.8, 8.7, 16.4], cap: [49.99, 68] },   // painted dot centerX 49.99%, dot top ≈74.45%
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
  const fnh = c.h, fnv = c.v, travel = 34, NY = 57;   // NY = neutral Y%: knob rests low so it sits centered in the painted stick housing
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

if (!SPEC) { document.body.innerHTML = "<p style='color:#e8eef6;padding:1rem'>Unknown generic layout: " + LAYOUT_ID + "</p>"; }
else MK4Chrome.create({
  layoutId: LAYOUT_ID,
  fnList: FN,
  connectLabel: t => t.raw.connect,                     // generic "Connect device" (never excavator)
  title: { default: SPEC.title.default, style: pct(SPEC.title.rect) },
  features: { deviceSwap: false, gamepad: false, labelsTab: true },
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
