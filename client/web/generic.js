// moldqueen — GENERIC layout engine (model-agnostic controllers). ONE engine, parameterized
// by a per-layout SPEC (bg image + control hotspots + function list), selected by
// window.MK4_LAYOUT_ID (set in the thin per-layout html). Reuses the dumb-server contract
// (cmd:set/stop/setup), the shared shell/i18n/clientconfig, and the SAME client resolution
// (function -> slot/channel/value with invert/caps/reverse_scale) as the function-mapped
// layouts. New here vs the excavator: two-axis + d-pad control widgets (multi-channel), the
// auto-assign wizard, and the UNMAPPED-function guard so unassigned controls emit nothing.
"use strict";

const $ = id => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const el = (cls, style, html) => { const d = document.createElement("div"); d.className = cls; if (style) d.style.cssText = style; if (html != null) d.innerHTML = html; return d; };
// hotspot rects are already in PERCENT of the stage (from the layout spec) — place directly.
const pct = ([x, y, w, h]) => `left:${x}%;top:${y}%;width:${w}%;height:${h}%;`;
const show = (id, on) => $(id).classList.toggle("hidden", !on);

// ---- per-layout specs (image + control hotspots in %; control.fns = the channels it drives) ----
const SPECS = {
  generic_12axis: {
    image: "/assets/generic_layouts/generic_12_axis.png",
    aspect: [1774, 887],
    // priority for auto-assign: sticks (2ch) first, then the edge one-axis controls, then d-pad, then buttons.
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
const FN = SPEC ? SPEC.controls.filter(c => c.fns).flatMap(c => c.fns) : [];   // every drivable function
const LSKEY = "mk4_active_map_" + LAYOUT_ID;
const ctrlById = id => SPEC.controls.find(c => c.id === id);

// ---- state ----
let ws = null, lifecycle = "IDLE", lang = MK4I18N.lang();
let activeMap = null, defaultMap = null;
const tr = () => MK4I18N.dict(lang);

// ---- channel map (client-owned; same schema as function-mapped, but slot/channel may be null) ----
function withDefaults(mp) {
  const m = JSON.parse(JSON.stringify(mp)); if (!m.functions) m.functions = {};
  for (const f of FN) {
    const a = m.functions[f] || (m.functions[f] = {});
    if (a.slot === undefined) a.slot = null;
    if (a.channel === undefined) a.channel = null;
    if (typeof a.invert !== "boolean") a.invert = false;
    if (typeof a.reverse_scale !== "number" || a.reverse_scale < 0.25 || a.reverse_scale > 4) a.reverse_scale = 1;
    if (!(Number.isInteger(a.max_fwd) && a.max_fwd >= 1 && a.max_fwd <= 7)) a.max_fwd = 5;
    if (!(Number.isInteger(a.max_rev) && a.max_rev >= 1 && a.max_rev <= 7)) a.max_rev = 5;
    if (!a.labels || typeof a.labels !== "object") a.labels = {};
  }
  return m;
}
const validMap = m => !!(m && m.functions && FN.every(f => m.functions[f]));
function loadStoredMap() {
  try { const m = JSON.parse(localStorage.getItem(LSKEY) || "null"); return validMap(m) ? withDefaults(m) : null; } catch { return null; }
}
function saveActive() { localStorage.setItem(LSKEY, JSON.stringify(activeMap)); }
const hasAnyAssigned = m => FN.some(f => m.functions[f].slot != null && m.functions[f].channel != null);
const isUnmapped = fn => { const a = activeMap && activeMap.functions[fn]; return !a || a.slot == null || a.channel == null; };
function funcLabel(fn) { const a = activeMap && activeMap.functions[fn]; if (!a) return fn; const lb = a.labels || {}; return lb[lang] || lb.en || fn; }

// ---- resolution (THE dumb-server contract: function -> {slot,channel,value}) ----
function capFor(a, outPositive) { const m = outPositive ? a.max_fwd : a.max_rev; return (Number.isInteger(m) && m >= 1 && m <= 7) ? m : (outPositive ? 7 : 5); }
function scaleVal(fn, frac) {   // [-1,1] travel -> signed value respecting the per-direction cap
  const a = activeMap && activeMap.functions[fn];
  if (!a || !frac) return Math.round((frac || 0) * 7);
  const outPositive = (frac > 0) !== !!a.invert;
  return Math.sign(frac) * Math.round(Math.abs(frac) * capFor(a, outPositive));
}
function resolveDrive(fn, v) {
  const a = activeMap && activeMap.functions[fn];
  if (!a) return null;
  if (a.slot == null || a.channel == null) return null;   // ← UNMAPPED: emit NO cmd:set (no motion)
  let mag = Math.abs(v | 0);
  if (v < 0 && typeof a.reverse_scale === "number" && a.reverse_scale !== 1) mag = Math.max(0, Math.min(7, Math.round(mag * a.reverse_scale)));
  let sign = v < 0 ? -1 : (v > 0 ? 1 : 0); if (a.invert) sign = -sign;
  let out = sign * mag;
  if (out > 0) out = Math.min(out, capFor(a, true)); else if (out < 0) out = -Math.min(-out, capFor(a, false));
  return { slot: a.slot | 0, channel: a.channel | 0, value: out };
}

// ---- drive + affirmative motion-keepalive + absolute STOP (same model as the excavator) ----
const controls = [];            // {fns, reset()} for global neutralize
const lastVal = {}, intent = {};
let stopLatched = false;
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
function driveFn(fn, v) {
  v = clamp(v | 0, -7, 7);
  if (stopLatched && v !== 0) return;                 // ABSOLUTE STOP: refuse motion until a fresh input clears it
  intent[fn] = v;
  if (v !== 0 && lastVal[fn] === v) return;           // dedup NON-ZERO only; a 0 is never dropped
  lastVal[fn] = v;
  const r = resolveDrive(fn, v);
  if (r) send({ cmd: "set", slot: r.slot, channel: r.channel, value: r.value });
}
const REFRESH_MS = 100;
function refreshActive() {                            // re-affirm active non-neutral channels ~10/s while READY
  if (!(ws && ws.readyState === 1) || lifecycle !== "READY" || stopLatched) return;
  for (const fn of FN) { const v = intent[fn] | 0; if (!v) continue; const r = resolveDrive(fn, v); if (r) send({ cmd: "set", slot: r.slot, channel: r.channel, value: r.value }); }
}
function neutralizeAll() { controls.forEach(c => c.reset()); FN.forEach(fn => driveFn(fn, 0)); }
function stopAll() { stopLatched = true; neutralizeAll(); send({ cmd: "stop" }); }   // red center -> kill+reconnect at neutral
function clearStopLatch() { stopLatched = false; }
function doReset() { send({ cmd: "setup", action: "reset" }); }

// ---- WebSocket / lifecycle / status light ----
let wsTries = 0, wsTimer = null, wsStatus = "retrying";
const WS_MAX_TRIES = 5;
function setWsStatus(s) { wsStatus = s; MK4.setStatus(s); updateStatusLight(); }
function scheduleRetry() { wsTries++; if (wsTries > WS_MAX_TRIES) { setWsStatus("failed"); return; } setWsStatus("retrying"); clearTimeout(wsTimer); wsTimer = setTimeout(connect, Math.min(1000 * wsTries, 5000)); }
function connect() {
  clearTimeout(wsTimer);
  try { ws = new WebSocket(MK4.wsEndpoint()); } catch (e) { scheduleRetry(); return; }
  ws.onopen = () => { wsTries = 0; setWsStatus("connected"); };
  ws.onclose = () => { neutralizeAll(); scheduleRetry(); updateStatusLight(); };
  ws.onerror = () => { try { ws.close(); } catch (e) {} };
  ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.type === "lifecycle") setLifecycle(m.state); };
}
function reconnectWS() { wsTries = 0; clearTimeout(wsTimer); try { if (ws) ws.close(); } catch (e) {} connect(); }
let autoReady = false;
function setLifecycle(state) {
  lifecycle = state;
  if (state !== "READY") neutralizeAll();
  updateGate(); renderMenu(); updateStatusLight(); wizardOnLifecycle(state);
  if (autoReady) { if (state === "CONNECTING") send({ cmd: "setup", action: "ready" }); else if (state === "READY") { autoReady = false; closeWizard(); } }
}
function updateStatusLight() {
  const e = $("statusLight"); if (!e) return; const t = tr();
  const wsUp = !!(ws && ws.readyState === 1);
  const c = !wsUp ? "red" : (lifecycle === "READY" ? "green" : "yellow");
  e.className = "statuslight " + c;
  e.title = !wsUp ? t.statusNoServer : (lifecycle === "READY" ? t.statusReadyT : t.statusConnectedT + lifecycle);
}

// ---- stage: bg + percent-positioned control widgets ----
function updateGate() { const ov = $("overlay"); if (ov) ov.classList.toggle("locked", lifecycle !== "READY"); }
function buildStage() {
  const stage = $("stage"), ov = $("overlay"); if (!stage || !SPEC) return;
  $("bg").src = SPEC.image;
  stage.style.aspectRatio = SPEC.aspect[0] + " / " + SPEC.aspect[1];
  stage.style.width = "min(100cqw, calc(100cqh * " + SPEC.aspect[0] + " / " + SPEC.aspect[1] + "))";
  ov.innerHTML = ""; controls.length = 0;
  for (const c of SPEC.controls) {
    const n = c.type === "oneaxis" ? makeOneAxis(c) : c.type === "twoaxis" ? makeTwoAxis(c)
            : c.type === "dpad" ? makeDpad(c) : c.type === "button" ? makeButton(c)
            : c.type === "stop" ? makeStop(c) : null;
    if (n) ov.appendChild(n);
  }
  updateGate();
}
function makeOneAxis(c) {
  const fn = c.fns[0], travel = 40;
  const z = el("gx-zone gx-one" + (isUnmapped(fn) ? " unassigned" : ""), pct(c.rect)); z.dataset.cid = c.id;
  const knob = el("gx-knob"); z.appendChild(knob);
  let pid = null;
  const setY = clientY => {
    const r = z.getBoundingClientRect();
    let f = clamp(-((clientY - (r.top + r.height / 2)) / (r.height / 2)), -1, 1);
    if (Math.abs(f) < 0.12) f = 0;
    knob.style.top = (50 - f * travel) + "%";
    const v = scaleVal(fn, f); z.classList.toggle("active", v !== 0); driveFn(fn, v);
  };
  const reset = () => { pid = null; knob.style.top = "50%"; z.classList.remove("active"); driveFn(fn, 0); };
  z.addEventListener("pointerdown", e => { if (lifecycle !== "READY") return; clearStopLatch(); pid = e.pointerId; try { z.setPointerCapture(pid); } catch {} e.preventDefault(); setY(e.clientY); });
  z.addEventListener("pointermove", e => { if (e.pointerId === pid) setY(e.clientY); });
  const up = e => { if (pid === null || (e && e.pointerId !== pid)) return; try { z.releasePointerCapture(pid); } catch {} reset(); };
  z.addEventListener("pointerup", up); z.addEventListener("pointercancel", up); z.addEventListener("lostpointercapture", up);
  controls.push({ fns: c.fns, reset });
  return z;
}
function makeTwoAxis(c) {
  const fnx = c.fns[0], fny = c.fns[1], travel = 38;
  const z = el("gx-zone gx-two" + (isUnmapped(fnx) && isUnmapped(fny) ? " unassigned" : ""), pct(c.rect)); z.dataset.cid = c.id;
  const knob = el("gx-knob"); z.appendChild(knob);
  let pid = null;
  const setXY = (cx, cy) => {
    const r = z.getBoundingClientRect();
    let fx = clamp((cx - (r.left + r.width / 2)) / (r.width / 2), -1, 1);
    let fy = clamp(-((cy - (r.top + r.height / 2)) / (r.height / 2)), -1, 1);
    if (Math.abs(fx) < 0.12) fx = 0; if (Math.abs(fy) < 0.12) fy = 0;
    knob.style.left = (50 + fx * travel) + "%"; knob.style.top = (50 - fy * travel) + "%";
    const vx = scaleVal(fnx, fx), vy = scaleVal(fny, fy);
    z.classList.toggle("active", vx !== 0 || vy !== 0);
    driveFn(fnx, vx); driveFn(fny, vy);
  };
  const reset = () => { pid = null; knob.style.left = "50%"; knob.style.top = "50%"; z.classList.remove("active"); driveFn(fnx, 0); driveFn(fny, 0); };
  z.addEventListener("pointerdown", e => { if (lifecycle !== "READY") return; clearStopLatch(); pid = e.pointerId; try { z.setPointerCapture(pid); } catch {} e.preventDefault(); setXY(e.clientX, e.clientY); });
  z.addEventListener("pointermove", e => { if (e.pointerId === pid) setXY(e.clientX, e.clientY); });
  const up = e => { if (pid === null || (e && e.pointerId !== pid)) return; try { z.releasePointerCapture(pid); } catch {} reset(); };
  z.addEventListener("pointerup", up); z.addEventListener("pointercancel", up); z.addEventListener("lostpointercapture", up);
  controls.push({ fns: c.fns, reset });
  return z;
}
function makeDpad(c) {
  const fnx = c.fns[0], fny = c.fns[1], frag = document.createDocumentFragment();
  const mk = (part, fn, dir) => {
    const b = document.createElement("button"); b.className = "gx-dpadbtn" + (isUnmapped(fn) ? " unassigned" : ""); b.style.cssText = pct(part); b.dataset.cid = c.id;
    let on = false;
    const press = e => { e.preventDefault(); if (lifecycle !== "READY" || on) return; clearStopLatch(); on = true; b.classList.add("active"); driveFn(fn, scaleVal(fn, dir)); };
    const rel = () => { if (!on) return; on = false; b.classList.remove("active"); driveFn(fn, 0); };
    b.addEventListener("pointerdown", press); b.addEventListener("pointerup", rel); b.addEventListener("pointercancel", rel); b.addEventListener("pointerleave", rel); b.addEventListener("lostpointercapture", rel);
    controls.push({ fns: [fn], reset: () => { on = false; b.classList.remove("active"); } });
    return b;
  };
  frag.appendChild(mk(c.parts.up, fny, 1)); frag.appendChild(mk(c.parts.down, fny, -1));
  frag.appendChild(mk(c.parts.left, fnx, -1)); frag.appendChild(mk(c.parts.right, fnx, 1));
  return frag;
}
function makeButton(c) {
  const fn = c.fns[0];
  const b = document.createElement("button"); b.className = "gx-btn" + (isUnmapped(fn) ? " unassigned" : ""); b.style.cssText = pct(c.rect); b.dataset.fn = fn; b.title = funcLabel(fn);
  let on = false;
  const press = e => { e.preventDefault(); if (lifecycle !== "READY" || on) return; clearStopLatch(); on = true; b.classList.add("active"); driveFn(fn, scaleVal(fn, 1)); };
  const rel = () => { if (!on) return; on = false; b.classList.remove("active"); driveFn(fn, 0); };
  b.addEventListener("pointerdown", press); b.addEventListener("pointerup", rel); b.addEventListener("pointercancel", rel); b.addEventListener("pointerleave", rel); b.addEventListener("lostpointercapture", rel);
  controls.push({ fns: [fn], reset: () => { on = false; b.classList.remove("active"); } });
  return b;
}
function makeStop(c) {
  const b = el("gx-stop", pct(c.rect), `<span>${esc(tr().stop)}</span>`); b.id = "estopBtn";
  b.addEventListener("pointerdown", e => { e.preventDefault(); b.classList.add("hit"); stopAll(); try { b.setPointerCapture(e.pointerId); } catch {} });
  const up = () => b.classList.remove("hit"); b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up);
  return b;
}

// ---- menu (flat top-bar / sidebar, reuses shell + i18n picker) ----
function mbtn(label, cls, on) { const b = document.createElement("button"); b.innerHTML = label; if (cls) b.className = cls; b.onclick = on; return b; }
function renderMenu() {
  const t = tr(), m = $("menu"); m.innerHTML = "";
  const left = el("tgroup");
  if (lifecycle === "IDLE") left.appendChild(mbtn(t.raw.connect, "primary", openWizard));        // "Connect device" (generic)
  else if (lifecycle === "CONNECTING") { left.appendChild(mbtn(t.ready, "primary", () => send({ cmd: "setup", action: "ready" }))); left.appendChild(mbtn(t.reset, "", doReset)); }
  else left.appendChild(mbtn(t.reset, "", doReset));
  m.appendChild(left); m.appendChild(el("grow"));
  const right = el("tgroup");
  const sb = mbtn(t.stop, "", stopAll); sb.id = "stopBtn"; right.appendChild(sb);
  right.appendChild(mbtn(t.settings, "", openSettings));
  right.appendChild(MK4I18N.picker(setLang));
  if (MK4.showFullscreen()) right.appendChild(mbtn("⛶", "", toggleFull));
  right.appendChild(mbtn(t.layouts, "", () => location.href = "/?choose=1"));
  m.appendChild(right);
}
function toggleFull() { if (!document.fullscreenElement) (document.documentElement.requestFullscreen || (() => {})).call(document.documentElement); else document.exitFullscreen && document.exitFullscreen(); }
function setLang(code) {
  lang = MK4I18N.setLang(code);
  renderMenu(); buildStage();
  if (!$("wizard").classList.contains("hidden")) buildWizard();
  if (!$("assign").classList.contains("hidden")) buildAssign();
  if (!$("settings").classList.contains("hidden")) buildSettings();
}

// ---- connect lifecycle wizard (cold-start IDLE->CONNECTING->READY; reused from the dashboard) ----
let wizStep = 0;
function openWizard() { wizStep = lifecycle === "READY" ? 4 : lifecycle === "CONNECTING" ? 3 : 1; buildWizard(); show("wizard", true); }
function closeWizard() { wizStep = 0; show("wizard", false); }
function wizardCancel() { send({ cmd: "setup", action: "reset" }); closeWizard(); }
function wizardOnLifecycle(state) { if ($("wizard").classList.contains("hidden")) return; if (state === "READY") { wizStep = 4; buildWizard(); } else if (state === "IDLE" && wizStep > 1) { wizStep = 1; buildWizard(); } }
function wizardNext() { if (wizStep === 1) { send({ cmd: "setup", action: "connect" }); wizStep = 2; } else if (wizStep === 2) wizStep = 3; buildWizard(); }
function wizardBack() { if (wizStep === 2) { send({ cmd: "setup", action: "reset" }); wizStep = 1; } else if (wizStep === 3) wizStep = 2; buildWizard(); }
function skipToReady() { clearStopLatch(); if (lifecycle === "READY") { autoReady = false; closeWizard(); return; } autoReady = true; if (lifecycle === "CONNECTING") send({ cmd: "setup", action: "ready" }); else send({ cmd: "setup", action: "connect" }); }
function buildWizard() {
  const t = tr(), s = wizStep, w = t.wiz["w" + s];
  let btns;
  if (s === 1) btns = `<button id="wCancel">${t.wiz.cancel}</button><button id="wAlready">${t.wiz.already}</button><button class="apply" id="wNext">${t.wiz.next}</button>`;
  else if (s === 2) btns = `<button id="wCancel">${t.wiz.cancel}</button><button id="wBack">${t.wiz.back}</button><button class="apply" id="wNext">${t.wiz.next}</button>`;
  else if (s === 3) btns = `<button id="wCancel">${t.wiz.cancel}</button><button id="wBack">${t.wiz.back}</button><button class="apply" id="wReady">${t.wiz.readyBtn}</button>`;
  else btns = `<button class="apply" id="wDone">${t.wiz.startDriving}</button>`;
  const gif = { 1: "long_flash", 2: "short_flash", 3: "double_short_flash" }[s];
  const media = gif ? `<div class="media"><img src="/assets/${gif}.gif" alt=""></div>` : "";
  $("wizard").innerHTML = `<div class="backdrop"></div><div class="sheet wiz">
    <h2>${t.wiz.title}</h2>
    <div class="wsteps">${[1, 2, 3, 4].map(n => `<span class="wdot${n === s ? " on" : n < s ? " done" : ""}"></span>`).join("")}</div>
    ${media}<h3 class="wt">${w.t}</h3><p class="wbody">${w.b}</p>
    <div class="actions wactions">${btns}</div></div>`;
  const on = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
  on("wCancel", wizardCancel); on("wBack", wizardBack); on("wNext", wizardNext);
  on("wReady", () => send({ cmd: "setup", action: "ready" })); on("wAlready", skipToReady); on("wDone", closeWizard);
}

// ---- AUTO-ASSIGN wizard (controls -> channels) ----
let assignStep = "source", assignN = 4;
function openAssign() { assignStep = "source"; buildAssign(); show("assign", true); }
function closeAssign() { show("assign", false); }
// Walk the 3 slots x 4 channels grid in priority order; 2-channel controls take TWO neighboring
// channels in the SAME slot (advance to next slot if <2 left); greedy fit (skip a control that
// doesn't fit the remaining budget, let a smaller one use the tail). Unreached fns stay unmapped.
function computeAssignment(N) {
  let budget = clamp(N | 0, 0, 12), slot = 0, ch = 0; const out = {};
  for (const id of SPEC.assignOrder) {
    if (budget <= 0 || slot > 2) break;
    const c = ctrlById(id), need = c.fns.length;
    if (need > budget) continue;
    if (need === 2) {
      if (ch > 2) { slot++; ch = 0; } if (slot > 2) break;       // keep the pair in one slot
      out[c.fns[0]] = [slot, ch]; out[c.fns[1]] = [slot, ch + 1];
      ch += 2; if (ch > 3) { slot++; ch = 0; }
    } else { out[c.fns[0]] = [slot, ch]; ch++; if (ch > 3) { slot++; ch = 0; } }
    budget -= need;
  }
  return out;
}
// THE SEAM for "load known toy" later: a known toy is a pre-filled assignment (or full channel
// map); it would call applyAssignment(thatAssignment). Auto-assign just computes it from N.
function applyAssignment(out) {
  const m = activeMap ? JSON.parse(JSON.stringify(activeMap)) : withDefaults(defaultMap || { functions: {} });
  for (const fn of FN) { const a = m.functions[fn]; if (out[fn]) { a.slot = out[fn][0]; a.channel = out[fn][1]; } else { a.slot = null; a.channel = null; } }
  activeMap = withDefaults(m); saveActive(); buildStage();
}
function buildAssign() {
  const t = tr(); let body;
  if (assignStep === "source") {
    body = `<h2>${t.gen.setupTitle}</h2><p class="wbody">${t.gen.setupIntro}</p>
      <div class="actions wactions" style="flex-direction:column;align-items:stretch">
        <button class="apply" id="agAuto">${t.gen.autoAssign}</button>
        <button id="agKnown" disabled title="${t.gen.soon}">${t.gen.loadKnown}</button>
        <button id="agCancel">${t.wiz.cancel}</button></div>`;
  } else {
    body = `<h2>${t.gen.howMany}</h2><p class="wbody">${t.gen.howManySub}</p>
      <div class="gx-count"><input type="number" id="agN" min="1" max="12" value="${assignN}"></div>
      <div class="gx-preview" id="agPreview"></div>
      <div class="actions wactions"><button id="agBack">${t.wiz.back}</button><button class="apply" id="agAssign">${t.gen.assign}</button></div>`;
  }
  $("assign").innerHTML = `<div class="backdrop"></div><div class="sheet wiz">${body}</div>`;
  $("assign").querySelector(".backdrop").onclick = closeAssign;   // dismissable: leaving it unmapped is safe (no motion)
  const on = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
  on("agAuto", () => { assignStep = "count"; buildAssign(); });
  on("agCancel", closeAssign); on("agBack", () => { assignStep = "source"; buildAssign(); });
  on("agAssign", () => { const n = clamp(parseInt($("agN").value, 10) || 1, 1, 12); applyAssignment(computeAssignment(n)); closeAssign(); });
  const nIn = $("agN"); if (nIn) { nIn.oninput = () => { assignN = clamp(parseInt(nIn.value, 10) || 1, 1, 12); updatePreview(); }; updatePreview(); }
}
function updatePreview() {
  const out = computeAssignment(assignN);
  const lines = SPEC.assignOrder.map(id => { const c = ctrlById(id); if (!c.fns.every(f => out[f])) return null; return esc(c.name) + " → " + c.fns.map(f => "s" + out[f][0] + "c" + out[f][1]).join(", "); }).filter(Boolean);
  const box = $("agPreview"); if (box) box.innerHTML = lines.length ? lines.map(l => `<div>${l}</div>`).join("") : `<div class="muted">${tr().gen.nonePreview}</div>`;
}

// ---- lean channels editor (hand-tune; shared channelsui extraction deferred) ----
function openSettings() { buildSettings(); show("settings", true); }
function closeSettings() { show("settings", false); }
function buildSettings() {
  const t = tr();
  const rows = FN.map(fn => {
    const a = activeMap.functions[fn];
    const slots = `<option value=""${a.slot == null ? " selected" : ""}>—</option>` + [0, 1, 2].map(n => `<option value="${n}"${a.slot === n ? " selected" : ""}>${n}</option>`).join("");
    const chans = `<option value=""${a.channel == null ? " selected" : ""}>—</option>` + [0, 1, 2, 3].map(n => `<option value="${n}"${a.channel === n ? " selected" : ""}>${n}</option>`).join("");
    return `<tr data-fn="${fn}"><td class="fn">${esc(funcLabel(fn))}<br><span class="muted">${fn}</span></td>
      <td><select class="e-slot">${slots}</select></td><td><select class="e-ch">${chans}</select></td>
      <td><input type="number" class="e-maxf" min="1" max="7" value="${a.max_fwd}"></td>
      <td><input type="number" class="e-maxr" min="1" max="7" value="${a.max_rev}"></td>
      <td style="text-align:center"><input type="checkbox" class="e-inv"${a.invert ? " checked" : ""}></td></tr>`;
  }).join("");
  $("settings").innerHTML = `<div class="backdrop"></div><div class="sheet">
    <button class="sheetx" id="setX" type="button" aria-label="${t.close}" title="${t.close}">✕</button>
    <h2>${t.assign}</h2><p class="sub">${t.gen.channelsSub}</p>
    <table class="map"><thead><tr><th>${t.fn}</th><th>${t.slot}</th><th>${t.ch}</th><th>${t.maxFwd}</th><th>${t.maxRev}</th><th>${t.invert}</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="actions"><button class="apply" id="setAuto">${t.gen.rerun}</button><button id="setClose">${t.close}</button></div></div>`;
  $("settings").querySelector(".backdrop").onclick = closeSettings;
  $("setX").onclick = closeSettings; $("setClose").onclick = closeSettings;
  $("setAuto").onclick = () => { closeSettings(); openAssign(); };
  $("settings").querySelectorAll("tr[data-fn]").forEach(trEl => {
    const fn = trEl.dataset.fn, a = activeMap.functions[fn];
    const commit = () => { saveActive(); buildStage(); };   // live: edits re-resolve immediately
    trEl.querySelector(".e-slot").onchange = e => { a.slot = e.target.value === "" ? null : +e.target.value; commit(); };
    trEl.querySelector(".e-ch").onchange = e => { a.channel = e.target.value === "" ? null : +e.target.value; commit(); };
    trEl.querySelector(".e-maxf").onchange = e => { a.max_fwd = clamp(+e.target.value | 0, 1, 7); e.target.value = a.max_fwd; commit(); };
    trEl.querySelector(".e-maxr").onchange = e => { a.max_rev = clamp(+e.target.value | 0, 1, 7); e.target.value = a.max_rev; commit(); };
    trEl.querySelector(".e-inv").onchange = e => { a.invert = e.target.checked; commit(); };
  });
}

// ---- boot ----
function applyMaps(def) {
  defaultMap = withDefaults(def);
  activeMap = loadStoredMap() || withDefaults(def);
  buildStage();
  if (!hasAnyAssigned(activeMap)) openAssign();   // first use: no channels assigned -> auto-assign wizard
}
if (!SPEC) { document.body.innerHTML = "<p style='color:#e8eef6;padding:1rem'>Unknown generic layout: " + esc(LAYOUT_ID) + "</p>"; }
else {
  document.documentElement.lang = lang;
  renderMenu(); connect();
  fetch("/channel_map." + LAYOUT_ID + ".json").then(r => r.json()).then(applyMaps).catch(() => applyMaps({ functions: {} }));
  setInterval(refreshActive, REFRESH_MS);
  window.addEventListener("blur", neutralizeAll);
  document.addEventListener("visibilitychange", () => { if (document.hidden) neutralizeAll(); });
  document.addEventListener("keydown", e => { if (e.code === "Space" || e.code === "Escape") { e.preventDefault(); stopAll(); } });
}
