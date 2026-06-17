// ============================================================================
// TEMPLATE layout — a MINIMAL function-mapped skeleton. Copy this (+ template.html
// and template.css), rename to a unique id, and flip active:true in web/layouts.json.
// What it shows: connect/lifecycle wiring, ONE function driven BY NAME ("knob_1"),
// and a client OVERRIDE (slot/channel/invert) of the channel map. Look for TODO.
//
// The server gives you for free: the radio, the IDLE→CONNECTING→READY lifecycle,
// auto-neutral safety, the per-layout channel map (config/channel_map.template.json),
// the shared shell/menu CSS, and the configurable WS endpoint (clientconfig.js).
// ============================================================================
"use strict";
var $ = function (id) { return document.getElementById(id); };

// ── TODO: set this to YOUR layout id (must match the manifest `id`). The client tells
//    the server which layout it is, so the server loads THIS layout's function set +
//    channel map (config/channel_map.<id>.json) instead of another layout's. ──
var LAYOUT_ID = "template";

// ── TODO: your layout's FUNCTION SET. One name per motor/channel you control. Mirror
//    this list in web/layouts.json ("functions") AND config/channel_map.<id>.json. ──
var FN = ["knob_1"];

var ws = null, lifecycle = "IDLE", wsStatus = "retrying", wsTries = 0, wsTimer = null;
var defaultMap = null, activeMap = null;     // channel map: server DEFAULT + client overrides

function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
function clone(x) { return JSON.parse(JSON.stringify(x)); }

// ---- WebSocket (reuses the shared, configurable endpoint) ------------------------
function connectWS() {
  try { ws = new WebSocket(MK4.wsEndpoint()); } catch (e) { return scheduleRetry(); }
  ws.onopen = function () {
    wsTries = 0; setStatus("connected");
    send({ cmd: "map", layout: LAYOUT_ID });   // select THIS layout → server loads its function set + map
  };
  ws.onclose = function () { setStatus("retrying"); scheduleRetry(); };
  ws.onerror = function () { try { ws.close(); } catch (e) {} };
  ws.onmessage = function (ev) {
    var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.type === "lifecycle") setLifecycle(m.state);
    else if (m.type === "map") onMap(m);
    // else if (m.type === "state") { /* TODO: reflect m.slots if useful */ }
    // else if (m.type === "mapresult") { /* TODO: if you add Save/Promote UI */ }
  };
}
function scheduleRetry() { clearTimeout(wsTimer); wsTimer = setTimeout(connectWS, Math.min(1000 + wsTries++ * 500, 5000)); }
function reconnectWS() { try { if (ws) ws.close(); } catch (e) {} connectWS(); }
function setStatus(s) { wsStatus = s; MK4.setStatus(s); }

// ---- lifecycle -------------------------------------------------------------------
function setLifecycle(s) { lifecycle = s; renderMenu(); updateGate(); }
function onMap(m) {                                  // server pushes default + active map on connect
  defaultMap = m["default"];
  if (!activeMap) activeMap = clone(m.active || m["default"]);
  fillOverride();
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
    '    <!-- TODO: add Save (this is map set) + Promote ({cmd:map,action:promote}) like the dashboard. -->' +
    '  </div>' +
    '</div>';
  MK4.buildEndpointRow($("epRow"), reconnectWS);       // configurable WS endpoint, for free
  var k = $("knob1");
  var drive = function (v) { $("knob1v").textContent = v; send({ cmd: "drive", function: FN[0], value: +v }); };
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
  a.invert = $("ovInv").checked;
  send({ cmd: "map", action: "set", map: activeMap });  // server validates against this layout's function set
}

function updateGate() { var k = $("knob1"); if (k) k.disabled = lifecycle !== "READY"; }  // motion only in READY

// ---- boot ------------------------------------------------------------------------
renderMenu(); buildMain(); connectWS();
// TODO: replace name/description/icon (web/layouts.json), the FN set (here + manifest +
// config/channel_map.<id>.json), and these controls with your toy's real layout.
