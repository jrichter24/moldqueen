// moldqueen — GENERIC controller control surface (model-agnostic). The chrome + runtime
// (WS/lifecycle/keepalive/STOP, menu, tabbed settings, connect wizard, status light, title,
// auto-assign wizard SHELL) live in the shared chrome.js (MK4Chrome). This file is ONLY the
// per-layout control surface: the bg art + the percent-positioned widgets (one-axis, two-axis,
// d-pad, buttons, red STOP) that drive the shared api.driveFn, plus the auto-assign ALGORITHM
// (compute) that the chrome's wizard calls. Selected by window.MK4_LAYOUT_ID.
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
    assignOrder: ["lstick", "rstick", "laxis", "raxis", "dpad", "btn1", "btn2", "btn3", "btn4", "btnA", "btnB", "btnC", "btnD"],
    controls: [
      { id: "dpad", type: "dpad", name: "D-pad", fns: ["dpad_x", "dpad_y"], parts: {
          up: [10.60, 17.59, 5.81, 15.33], down: [10.37, 43.63, 6.31, 14.21],
          left: [3.44, 30.89, 8.00, 12.74], right: [16.35, 30.89, 8.06, 12.74] } },
      { id: "laxis", type: "oneaxis", name: "Left axis", fns: ["laxis"], rect: [5.07, 61.78, 8.46, 26.61] },
      { id: "raxis", type: "oneaxis", name: "Right axis", fns: ["raxis"], rect: [86.53, 61.78, 8.46, 26.61] },
      { id: "lstick", type: "twoaxis", name: "Left stick", fns: ["lstick_x", "lstick_y"], rect: [19.73, 53.55, 16.63, 34.39] },
      { id: "rstick", type: "twoaxis", name: "Right stick", fns: ["rstick_x", "rstick_y"], rect: [63.98, 53.55, 16.63, 34.39] },
      { id: "btn1", type: "button", name: "Button 1", fns: ["btn1"], rect: [36.92, 15.67, 11.84, 13.87] },
      { id: "btn2", type: "button", name: "Button 2", fns: ["btn2"], rect: [50.17, 15.67, 11.84, 13.87] },
      { id: "btn3", type: "button", name: "Button 3", fns: ["btn3"], rect: [36.92, 33.82, 11.84, 13.87] },
      { id: "btn4", type: "button", name: "Button 4", fns: ["btn4"], rect: [50.17, 33.82, 11.84, 13.87] },
      { id: "btnA", type: "button", name: "Button A", fns: ["btnA"], rect: [82.30, 16.57, 7.44, 14.88] },
      { id: "btnB", type: "button", name: "Button B", fns: ["btnB"], rect: [88.90, 31.91, 7.44, 14.88] },
      { id: "btnC", type: "button", name: "Button C", fns: ["btnC"], rect: [75.08, 31.91, 7.44, 14.88] },
      { id: "btnD", type: "button", name: "Button D", fns: ["btnD"], rect: [82.30, 45.55, 7.44, 14.88] },
      { id: "red", type: "stop", name: "STOP", rect: [44.53, 69.90, 9.86, 19.73] },
    ],
  },
};
const LAYOUT_ID = window.MK4_LAYOUT_ID || "generic_12axis";
const SPEC = SPECS[LAYOUT_ID];
const FN = SPEC ? SPEC.controls.filter(c => c.fns).flatMap(c => c.fns) : [];
const ctrlById = id => SPEC.controls.find(c => c.id === id);

let A;   // the chrome api (set in buildSurface)

// ---- control widgets (transparent hit-zones over the painted controls) ----
function makeOneAxis(c) {
  const fn = c.fns[0], travel = 40;
  const z = el("gx-zone gx-one" + (A.isUnmapped(fn) ? " unassigned" : ""), pct(c.rect)); z.dataset.cid = c.id;
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
  const fnx = c.fns[0], fny = c.fns[1], travel = 38;
  const z = el("gx-zone gx-two" + (A.isUnmapped(fnx) && A.isUnmapped(fny) ? " unassigned" : ""), pct(c.rect)); z.dataset.cid = c.id;
  const knob = el("gx-knob"); z.appendChild(knob);
  let pid = null;
  const setXY = (cx, cy) => {
    const r = z.getBoundingClientRect();
    let fx = clamp((cx - (r.left + r.width / 2)) / (r.width / 2), -1, 1);
    let fy = clamp(-((cy - (r.top + r.height / 2)) / (r.height / 2)), -1, 1);
    if (Math.abs(fx) < 0.12) fx = 0; if (Math.abs(fy) < 0.12) fy = 0;
    knob.style.left = (50 + fx * travel) + "%"; knob.style.top = (50 - fy * travel) + "%";
    const vx = A.scaleVal(fnx, fx), vy = A.scaleVal(fny, fy);
    z.classList.toggle("active", vx !== 0 || vy !== 0);
    A.driveFn(fnx, vx); A.driveFn(fny, vy);
  };
  const reset = () => { pid = null; knob.style.left = "50%"; knob.style.top = "50%"; z.classList.remove("active"); A.driveFn(fnx, 0); A.driveFn(fny, 0); };
  z.addEventListener("pointerdown", e => { if (A.lifecycle() !== "READY") return; A.clearStopLatch(); pid = e.pointerId; try { z.setPointerCapture(pid); } catch {} e.preventDefault(); setXY(e.clientX, e.clientY); });
  z.addEventListener("pointermove", e => { if (e.pointerId === pid) setXY(e.clientX, e.clientY); });
  const up = e => { if (pid === null || (e && e.pointerId !== pid)) return; try { z.releasePointerCapture(pid); } catch {} reset(); };
  z.addEventListener("pointerup", up); z.addEventListener("pointercancel", up); z.addEventListener("lostpointercapture", up);
  A.addControl(reset);
  return z;
}
function makeDpad(c) {
  const fnx = c.fns[0], fny = c.fns[1], frag = document.createDocumentFragment();
  const mk = (part, fn, dir) => {
    const b = document.createElement("button"); b.className = "gx-dpadbtn" + (A.isUnmapped(fn) ? " unassigned" : ""); b.style.cssText = pct(part); b.dataset.cid = c.id;
    let on = false;
    const press = e => { e.preventDefault(); if (A.lifecycle() !== "READY" || on) return; A.clearStopLatch(); on = true; b.classList.add("active"); A.driveFn(fn, A.scaleVal(fn, dir)); };
    const rel = () => { if (!on) return; on = false; b.classList.remove("active"); A.driveFn(fn, 0); };
    b.addEventListener("pointerdown", press); b.addEventListener("pointerup", rel); b.addEventListener("pointercancel", rel); b.addEventListener("pointerleave", rel); b.addEventListener("lostpointercapture", rel);
    A.addControl(() => { on = false; b.classList.remove("active"); });
    return b;
  };
  frag.appendChild(mk(c.parts.up, fny, 1)); frag.appendChild(mk(c.parts.down, fny, -1));
  frag.appendChild(mk(c.parts.left, fnx, -1)); frag.appendChild(mk(c.parts.right, fnx, 1));
  return frag;
}
function makeButton(c) {
  const fn = c.fns[0];
  const b = document.createElement("button"); b.className = "gx-btn" + (A.isUnmapped(fn) ? " unassigned" : ""); b.style.cssText = pct(c.rect); b.dataset.fn = fn; b.title = A.funcLabel(fn);
  let on = false;
  const press = e => { e.preventDefault(); if (A.lifecycle() !== "READY" || on) return; A.clearStopLatch(); on = true; b.classList.add("active"); A.driveFn(fn, A.scaleVal(fn, 1)); };
  const rel = () => { if (!on) return; on = false; b.classList.remove("active"); A.driveFn(fn, 0); };
  b.addEventListener("pointerdown", press); b.addEventListener("pointerup", rel); b.addEventListener("pointercancel", rel); b.addEventListener("pointerleave", rel); b.addEventListener("lostpointercapture", rel);
  A.addControl(() => { on = false; b.classList.remove("active"); });
  return b;
}
function makeStop(c) {
  const b = el("gx-stop", pct(c.rect), `<span>${A.dict().stop}</span>`); b.id = "estopBtn";
  b.addEventListener("pointerdown", e => { e.preventDefault(); b.classList.add("hit"); A.stopAll(); try { b.setPointerCapture(e.pointerId); } catch {} });
  const up = () => b.classList.remove("hit"); b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up);
  return b;
}

// ---- the surface build (chrome calls this on boot / map change / language change) ----
function buildSurface(api) {
  A = api;
  const stage = $("stage"), ov = $("overlay");
  $("bg").src = SPEC.image;
  stage.style.aspectRatio = SPEC.aspect[0] + " / " + SPEC.aspect[1];
  stage.style.width = "min(100cqw, calc(100cqh * " + SPEC.aspect[0] + " / " + SPEC.aspect[1] + "))";
  ov.innerHTML = "";
  for (const c of SPEC.controls) {
    const n = c.type === "oneaxis" ? makeOneAxis(c) : c.type === "twoaxis" ? makeTwoAxis(c)
            : c.type === "dpad" ? makeDpad(c) : c.type === "button" ? makeButton(c)
            : c.type === "stop" ? makeStop(c) : null;
    if (n) ov.appendChild(n);
  }
}

// ---- auto-assign algorithm (chrome's wizard calls compute(N); chrome owns apply/persist) ----
// Walk the 3 slots x 4 channels grid in priority order; 2-channel controls take TWO neighboring
// channels in the SAME slot (advance to the next slot if <2 left); greedy fit (skip a control
// that doesn't fit the remaining budget, let a smaller one use the tail). Unreached fns stay null.
function computeAssignment(N) {
  let budget = clamp(N | 0, 0, 12), slot = 0, ch = 0; const out = {};
  for (const id of SPEC.assignOrder) {
    if (budget <= 0 || slot > 2) break;
    const c = ctrlById(id), need = c.fns.length;
    if (need > budget) continue;
    if (need === 2) {
      if (ch > 2) { slot++; ch = 0; } if (slot > 2) break;
      out[c.fns[0]] = [slot, ch]; out[c.fns[1]] = [slot, ch + 1];
      ch += 2; if (ch > 3) { slot++; ch = 0; }
    } else { out[c.fns[0]] = [slot, ch]; ch++; if (ch > 3) { slot++; ch = 0; } }
    budget -= need;
  }
  return out;
}

if (!SPEC) { document.body.innerHTML = "<p style='color:#e8eef6;padding:1rem'>Unknown generic layout: " + LAYOUT_ID + "</p>"; }
else MK4Chrome.create({
  layoutId: LAYOUT_ID,
  fnList: FN,
  connectLabel: t => t.raw.connect,                     // generic "Connect device" (never excavator)
  title: { default: SPEC.title.default, style: pct(SPEC.title.rect) },
  features: { deviceSwap: false, gamepad: false, labelsTab: true },
  autoAssign: { compute: computeAssignment, order: SPEC.assignOrder, controls: SPEC.controls },
  buildSurface,
});
