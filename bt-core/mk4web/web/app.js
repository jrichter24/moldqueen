// moldqueen MK4 web client — thin first client of the WebSocket API.
// Setup lifecycle (IDLE->CONNECTING->READY) + press-and-hold joystick controls.
"use strict";

const SLOTS = [0, 1];                 // slot 2 exists in protocol; no third hub yet
const CHANNELS = [0, 1, 2, 3];
const $ = id => document.getElementById(id);
const wsBadge = $("wsBadge"), lcBadge = $("lcBadge");
const setupMsg = $("setupMsg"), setupBtns = $("setupBtns");
const controlsEl = $("controls"), speedEl = $("speed"), speedVal = $("speedVal");

let ws = null, lifecycle = "IDLE";
const held = new Set();               // buttons currently held
const key = (s, c) => s + "-" + c;

// ---------- WebSocket ----------
function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function connect() {
  ws = new WebSocket("ws://" + location.hostname + ":" + window.MK4_WS_PORT);
  ws.onopen = () => { wsBadge.textContent = "connected"; wsBadge.className = "badge ok"; };
  ws.onclose = () => {
    wsBadge.textContent = "disconnected — retry…"; wsBadge.className = "badge bad";
    releaseAll(); setTimeout(connect, 1000);
  };
  ws.onerror = () => ws.close();
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === "lifecycle") setLifecycle(m.state);
    else if (m.type === "state" && m.slots) applyState(m.slots);
  };
}

// ---------- lifecycle / setup panel ----------
function btn(label, action, cls) {
  const b = document.createElement("button");
  b.textContent = label; if (cls) b.className = cls;
  b.onclick = () => send({ cmd: "setup", action });
  return b;
}

function setLifecycle(state) {
  lifecycle = state;
  lcBadge.textContent = state;
  lcBadge.className = "badge " + (state === "READY" ? "ok" : state === "CONNECTING" ? "mid" : "bad");
  setupBtns.innerHTML = "";
  if (state === "IDLE") {
    setupMsg.innerHTML = "1) Power on both hubs — each shows <b>one long flash</b>.<br>" +
                         "2) Press <b>Connect</b> to start the connect telegram.";
    setupBtns.append(btn("Connect", "connect", "act"));
  } else if (state === "CONNECTING") {
    setupMsg.innerHTML = "Both hubs should now <b>fast-flash</b> (connected, both on slot 0).<br>" +
      "3) Press <b>ONE</b> hub's button until it shows <b>TWO fast flashes</b> (slot 1); leave the " +
      "other on one fast flash (slot 0).<br>4) Then press <b>Ready</b>.";
    setupBtns.append(btn("Ready", "ready", "act"), btn("Reset", "reset"));
  } else { // READY
    setupMsg.innerHTML = "✅ Connected — controls active. Hold Forward/Reverse below.";
    setupBtns.append(btn("Reset / Disconnect", "reset"));
  }
  controlsEl.classList.toggle("locked", state !== "READY");
  if (state !== "READY") releaseAll();
}

// ---------- controls ----------
function build() {
  for (const s of SLOTS) {
    const box = document.createElement("div");
    box.className = "slot";
    box.innerHTML = `<h2>Slot ${s}</h2>`;
    for (const c of CHANNELS) {
      const row = document.createElement("div");
      row.className = "ch";
      row.innerHTML =
        `<label>ch ${c}</label>` +
        `<button class="hold rev" data-s="${s}" data-c="${c}" data-dir="-1">◀ Rev</button>` +
        `<button class="hold fwd" data-s="${s}" data-c="${c}" data-dir="1">Fwd ▶</button>` +
        `<span class="val" id="v-${key(s, c)}">0</span>`;
      box.appendChild(row);
    }
    controlsEl.appendChild(box);
  }
  controlsEl.querySelectorAll(".hold").forEach(b => {
    b.addEventListener("pointerdown", e => { e.preventDefault(); startHold(b); });
    b.addEventListener("pointerup", () => stopHold(b));
    b.addEventListener("pointerleave", () => stopHold(b));   // snap to stop if pointer leaves
    b.addEventListener("pointercancel", () => stopHold(b));
  });
}

function startHold(b) {
  if (lifecycle !== "READY" || held.has(b)) return;
  held.add(b); b.classList.add("held");
  const s = +b.dataset.s, c = +b.dataset.c, dir = +b.dataset.dir;
  send({ cmd: "set", slot: s, channel: c, value: dir * (+speedEl.value) });
}

function stopHold(b) {
  if (!held.has(b)) return;
  held.delete(b); b.classList.remove("held");
  send({ cmd: "set", slot: +b.dataset.s, channel: +b.dataset.c, value: 0 });
}

function releaseAll() { Array.from(held).forEach(stopHold); }

function setVal(s, c, v) { const e = $("v-" + key(s, c)); if (e) e.textContent = v; }

function applyState(slots) {
  for (const s of SLOTS) for (const c of CHANNELS) setVal(s, c, slots[s][c]);
}

// ---------- wiring ----------
speedEl.addEventListener("input", () => { speedVal.textContent = speedEl.value; });
$("stop").addEventListener("click", () => { releaseAll(); send({ cmd: "stop" }); });
// safety nets: tabbing away / losing focus releases everything
window.addEventListener("blur", releaseAll);
document.addEventListener("visibilitychange", () => { if (document.hidden) releaseAll(); });

build();
setLifecycle("IDLE");
connect();
