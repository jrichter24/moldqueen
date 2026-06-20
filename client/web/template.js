// ============================================================================
// TEMPLATE layout — a MINIMAL function-mapped skeleton. Copy this (+ template.html
// and template.css), rename to a unique id, and flip active:true in web/layouts.json.
// What it shows: connect/lifecycle wiring, ONE function driven BY NAME ("knob_1"),
// and a client OVERRIDE (slot/channel/invert) of the channel map. Look for TODO.
//
// The server is pure TRANSPORT: it gives you the radio, the IDLE→CONNECTING→READY
// lifecycle, and auto-neutral safety — you send only low-level {cmd:set,slot,channel,
// value}. The CLIENT owns the channel map (web/channel_map.template.json) + resolution
// (function→slot/channel, invert, caps). Shared shell/menu CSS + the configurable WS
// endpoint (clientconfig.js) come along too.
// ============================================================================
"use strict";
var $ = function (id) { return document.getElementById(id); };

// ── TODO: set this to YOUR layout id (must match the manifest `id`). It also names this
//    layout's bundled channel-map file the client loads: web/channel_map.<id>.json. ──
var LAYOUT_ID = "template";

// ── TODO: your layout's FUNCTION SET. One name per motor/channel you control. Mirror
//    this list in web/layouts.json ("functions") AND web/channel_map.<id>.json. ──
var FN = ["knob_1"];

var ws = null, lifecycle = "IDLE", wsStatus = "retrying", wsTries = 0, wsTimer = null;
var defaultMap = null, activeMap = null;     // channel map: server DEFAULT + client overrides
var tplIntent = 0;                           // last driven value (affirmative motion-keepalive)

function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
function clone(x) { return JSON.parse(JSON.stringify(x)); }

// ---- WebSocket (reuses the shared, configurable endpoint) ------------------------
function connectWS() {
  try { ws = new WebSocket(MK4.wsEndpoint()); } catch (e) { return scheduleRetry(); }
  ws.onopen = function () { wsTries = 0; setStatus("connected"); };   // client owns the map; nothing to select
  ws.onclose = function () { setStatus("retrying"); scheduleRetry(); };
  ws.onerror = function () { try { ws.close(); } catch (e) {} };
  ws.onmessage = function (ev) {
    var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.type === "lifecycle") setLifecycle(m.state);
    // else if (m.type === "state") { /* TODO: reflect m.slots if useful */ }
  };
}
function scheduleRetry() { clearTimeout(wsTimer); wsTimer = setTimeout(connectWS, Math.min(1000 + wsTries++ * 500, 5000)); }
function reconnectWS() { try { if (ws) ws.close(); } catch (e) {} connectWS(); }
function setStatus(s) { wsStatus = s; MK4.setStatus(s); }

// ---- lifecycle -------------------------------------------------------------------
function setLifecycle(s) { if (s !== "READY") tplIntent = 0; lifecycle = s; renderMenu(); updateGate(); }
// Affirmative motion-keepalive: the server times out any non-neutral channel not refreshed
// ~within 0.3s, so re-affirm the held value ~10/s while READY (replaces relying on the hold).
function refreshActive() {
  if (!(ws && ws.readyState === 1) || lifecycle !== "READY" || !tplIntent) return;
  var r = resolve(FN[0], tplIntent);
  if (r) send({ cmd: "set", slot: r.slot, channel: r.channel, value: r.value });
}
// Client-side resolution: function → (slot, channel, value) with invert + per-direction cap.
// (The server is dumb transport — it never resolves anything.)
function resolve(fn, v) {
  var a = activeMap && activeMap.functions && activeMap.functions[fn];
  if (!a) return null;
  var mag = Math.abs(v | 0);
  var sign = v < 0 ? -1 : (v > 0 ? 1 : 0);
  if (a.invert) sign = -sign;
  var out = sign * mag;
  var cf = (a.max_fwd >= 1 && a.max_fwd <= 7) ? a.max_fwd : 5;
  var cr = (a.max_rev >= 1 && a.max_rev <= 7) ? a.max_rev : 5;
  if (out > 0) out = Math.min(out, cf); else if (out < 0) out = -Math.min(-out, cr);
  return { slot: a.slot | 0, channel: a.channel | 0, value: out };
}

// ---- menu (reuses the shared shell classes: .tgroup/.dot/.lc/.grow/#stopBtn) ------
function el(cls, html) { var d = document.createElement("div"); if (cls) d.className = cls; if (html != null) d.innerHTML = html; return d; }
function btn(label, cls, on) { var b = document.createElement("button"); b.innerHTML = label; if (cls) b.className = cls; b.onclick = on; return b; }
function renderMenu() {
  var m = $("menu"); m.innerHTML = "";
  var left = el("tgroup");
  left.appendChild(el("lc", "<span>TEMPLATE · " + lifecycle + "</span>"));
  // Lifecycle buttons. TODO: for a guided cold-start, copy raw.js's buildWizard().
  if (lifecycle === "IDLE") left.appendChild(btn("Connect", "primary", function () { send({ cmd: "setup", action: "connect" }); }));
  else if (lifecycle === "CONNECTING") {
    left.appendChild(btn("Ready", "primary", function () { send({ cmd: "setup", action: "ready" }); }));
    left.appendChild(btn("Reset", "", function () { send({ cmd: "setup", action: "reset" }); }));
  } else left.appendChild(btn("Reset", "", function () { send({ cmd: "setup", action: "reset" }); }));
  m.appendChild(left);
  m.appendChild(el("grow"));
  var right = el("tgroup");
  var stop = btn("STOP", "", function () { send({ cmd: "stop" }); }); stop.id = "stopBtn"; right.appendChild(stop);
  right.appendChild(btn("Layouts", "", function () { location.href = "/?choose=1"; }));
  m.appendChild(right);
}

// ---- the controls: ONE knob bound to FN[0], + a client override of its channel map ----
function buildMain() {
  $("main").innerHTML =
    '<div class="tpl-card">' +
    '  <h2>TEMPLATE layout</h2>' +
    '  <p class="muted">Minimal function-mapped starter. Drives one function — <code>' + FN[0] + '</code> — by name.</p>' +
    '  <div class="epRow" id="epRow"></div>' +            // shared endpoint editor (gives #epStatus)
    '  <!-- TODO: one knob per function in FN; lay them out for your toy. -->' +
    '  <div class="knob">' +
    '    <label for="knob1">' + FN[0] + '</label>' +
    '    <input id="knob1" type="range" min="-7" max="7" value="0" step="1" disabled />' +
    '    <span id="knob1v" class="muted">0</span>' +
    '  </div>' +
    '  <div class="tpl-settings">' +
    '    <b>Override</b> <span class="muted">(' + FN[0] + ', this session)</span><br>' +
    '    <label>slot <input id="ovSlot" type="number" min="0" max="2"></label>' +
    '    <label>channel <input id="ovCh" type="number" min="0" max="3"></label>' +
    '    <label><input id="ovInv" type="checkbox"> invert</label>' +
    '    <button id="ovApply" class="primary">Apply override</button>' +
    '    <!-- TODO: persist edits to localStorage like the dashboard (the client owns the map). -->' +
    '  </div>' +
    '</div>';
  MK4.buildEndpointRow($("epRow"), reconnectWS);       // configurable WS endpoint, for free
  var k = $("knob1");
  var drive = function (v) {
    $("knob1v").textContent = v;
    tplIntent = +v;                                      // keepalive source of truth
    var r = resolve(FN[0], +v);                          // client resolves → low-level set
    if (r) send({ cmd: "set", slot: r.slot, channel: r.channel, value: r.value });
  };
  k.addEventListener("input", function () { drive(k.value); });
  var release = function () { k.value = 0; drive(0); };  // release → neutral (motion is momentary)
  k.addEventListener("pointerup", release);
  k.addEventListener("pointerleave", release);
  $("ovApply").onclick = applyOverride;
  updateGate();
}

function fillOverride() {                              // reflect the active map into the override inputs
  var a = activeMap && activeMap.functions && activeMap.functions[FN[0]];
  if (!a || !$("ovSlot")) return;
  $("ovSlot").value = a.slot; $("ovCh").value = a.channel; $("ovInv").checked = !!a.invert;
}
function applyOverride() {                             // push a client override of FN[0]'s mapping
  if (!activeMap || !activeMap.functions[FN[0]]) return;
  var a = activeMap.functions[FN[0]];
  a.slot = Math.max(0, Math.min(2, parseInt($("ovSlot").value, 10) || 0));
  a.channel = Math.max(0, Math.min(3, parseInt($("ovCh").value, 10) || 0));
  a.invert = $("ovInv").checked;   // client-owned override — re-resolves on the next drive (nothing sent to the server)
}

function updateGate() { var k = $("knob1"); if (k) k.disabled = lifecycle !== "READY"; }  // motion only in READY

// ---- boot ------------------------------------------------------------------------
renderMenu(); buildMain(); connectWS();
setInterval(refreshActive, 100);   // affirmative motion-keepalive (server times out un-refreshed channels)
// Client owns the map: load this layout's bundled default (client overrides layer on top).
fetch("/channel_map." + LAYOUT_ID + ".json").then(function (r) { return r.json(); })
  .then(function (def) { defaultMap = def; if (!activeMap) activeMap = clone(def); fillOverride(); })
  .catch(function () {});
// TODO: replace name/description/icon (web/layouts.json), the FN set (here + manifest +
// web/channel_map.<id>.json), and these controls with your toy's real layout.
