// moldqueen RAW debug layout — protocol-level test bench over the SAME WebSocket API, now on the
// shared MK4Chrome. The menu/settings/wizard/status light/STOP/language come from the chrome (so RAW
// MATCHES every other layout); the bench is the CONTENT (buildSurface). RAW sets slots/channels
// directly and SENDs the raw {cmd:set}/{cmd:stop} telegram (NOT the function map), watching a console
// of the exact bytes on air. RAW keeps its OWN keepalive — the chrome's covers FN only (RAW has FN=[]).
"use strict";
const $ = id => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const NEUTRAL_NIB = 0x8;

let A = null;                                        // the chrome api (set in buildSurface)
let slotCount = 1;                                   // active slots (1-3)
let rawDriving = false;                              // affirm vals only after an explicit Send (cleared by Neutral/STOP/leaving READY)
const vals = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];   // signed value per slot/channel
let pendingSend = null;                              // {raw, timer}
const logLines = [];                                 // console history (preserved across surface rebuilds)
let apiSpec = null;                                  // cached /asyncapi.yaml text
let booted = false, lastLc = null;

const tr = () => (A ? A.dict() : MK4I18N.dict());
const toNib = v => (NEUTRAL_NIB + clamp(v | 0, -7, 7)) & 0xF;   // value<->nibble (same map as telegram.py)
function motionRaw() {
  let hex = "7dae18";
  for (let s = 0; s < 3; s++) for (let c = 0; c < 4; c += 2) {
    const hi = s < slotCount ? toNib(vals[s][c]) : NEUTRAL_NIB;
    const lo = s < slotCount ? toNib(vals[s][c + 1]) : NEUTRAL_NIB;
    hex += (((hi << 4) | lo) & 0xFF).toString(16).padStart(2, "0");
  }
  return hex + "82";
}
const el = (cls, style, html) => { const d = document.createElement("div"); d.className = cls; if (style) d.style.cssText = style; if (html != null) d.innerHTML = html; return d; };
function mbtn(label, cls, on) { const b = document.createElement("button"); b.innerHTML = label; if (cls) b.className = cls; b.onclick = on; return b; }

// ---- RAW keepalive: the chrome's keepalive only re-affirms FN (empty here); RAW drives raw
// slot/channel, so it MUST re-affirm its own active channels ~10/s or the server times them out. ----
function rawRefresh() {
  if (!A || A.lifecycle() !== "READY" || !rawDriving) return;
  for (let s = 0; s < 3; s++) for (let c = 0; c < 4; c++) {
    const v = s < slotCount ? vals[s][c] : 0;
    if (v !== 0) A.send({ cmd: "set", slot: s, channel: c, value: v });
  }
}

// ---- console log (history kept in logLines; appended live; survives surface rebuilds) ----
function ts() { const d = new Date(); return d.toTimeString().slice(0, 8) + "." + String(d.getMilliseconds()).padStart(3, "0"); }
function logPush(html) { logLines.push(html); const l = $("log"); if (l) { const e = document.createElement("div"); e.className = "logline"; e.innerHTML = html; l.appendChild(e); l.scrollTop = l.scrollHeight; } }
function logTelegram(kind, raw, ad) { logPush(`<span class="ts">${ts()}</span> <span class="kind ${kind}">${kind}</span> raw=<span class="raw">${raw}</span> · <span class="ad">AD=${ad}</span>`); }
function logInfo(text) { logPush(`<span class="ts">${ts()}</span> <span class="info">${text}</span>`); }
function renderLog() { const l = $("log"); if (!l) return; l.innerHTML = ""; for (const h of logLines) { const e = document.createElement("div"); e.className = "logline"; e.innerHTML = h; l.appendChild(e); } l.scrollTop = l.scrollHeight; }

// ---- raw set / send / neutral ----
function doSend() {
  if (!A || A.lifecycle() !== "READY") { logInfo(tr().raw.logSendIgnored); return; }
  A.clearStopLatch(); rawDriving = true;                // explicit input re-arms after a STOP
  for (let s = 0; s < 3; s++) for (let c = 0; c < 4; c++) A.send({ cmd: "set", slot: s, channel: c, value: s < slotCount ? vals[s][c] : 0 });
  const target = motionRaw();
  if (pendingSend) clearTimeout(pendingSend.timer);
  pendingSend = { raw: target, timer: setTimeout(() => { logTelegram("SENT", target, "(no echo — AD computed server-side)"); pendingSend = null; }, 800) };
}
function doNeutral() {
  rawDriving = false;
  for (let s = 0; s < 3; s++) for (let c = 0; c < 4; c++) vals[s][c] = 0;
  buildSlots(); updatePreview();
  if (A) A.send({ cmd: "stop" }); logInfo(tr().raw.logNeutral);
}

// ---- WS state echo (via chrome config.onState): confirm Sends + show the on-air AD ----
function onStateMsg(m) {
  if (pendingSend && m.raw === pendingSend.raw) { clearTimeout(pendingSend.timer); logTelegram("SENT", m.raw, m.ad || "(server)"); pendingSend = null; }
}

// ---- bench content ----
function refreshSel() { const ss = $("slotsel"); if (ss) ss.querySelectorAll("button").forEach(b => b.className = (+b.dataset.n === slotCount ? "btn on" : "btn")); }
function buildSlots() {
  const r = tr().raw, host = $("slots"); if (!host) return; host.innerHTML = "";
  for (let s = 0; s < slotCount; s++) {
    const slot = el("slot"); slot.innerHTML = `<div class="sh">${r.slot} ${s} &nbsp;(${r.globalCh} ${s * 4}–${s * 4 + 3})</div>`;
    for (let c = 0; c < 4; c++) {
      const g = s * 4 + c, v = vals[s][c];
      const row = el("chrow");
      row.innerHTML =
        `<label>${r.ch} ${c} <span style="color:#7f8ea4">g${g}</span></label>` +
        `<input type="range" min="-7" max="7" step="1" value="${v}" data-s="${s}" data-c="${c}" class="rg">` +
        `<input type="number" min="-7" max="7" step="1" value="${v}" data-s="${s}" data-c="${c}" class="nm">` +
        `<span class="nib" id="nib-${s}-${c}">0x${toNib(v).toString(16)}</span>`;
      slot.appendChild(row);
    }
    host.appendChild(slot);
  }
  host.querySelectorAll(".rg, .nm").forEach(inp => {
    inp.addEventListener("input", e => {
      const s = +e.target.dataset.s, c = +e.target.dataset.c;
      const v = clamp(parseInt(e.target.value || "0", 10) || 0, -7, 7);
      vals[s][c] = v;
      host.querySelectorAll(`.rg[data-s="${s}"][data-c="${c}"], .nm[data-s="${s}"][data-c="${c}"]`).forEach(o => { if (o !== e.target) o.value = v; });
      const nb = $(`nib-${s}-${c}`); if (nb) nb.textContent = "0x" + toNib(v).toString(16);
      updatePreview();
    });
  });
}
function updatePreview() {
  const p = $("preview"); if (!p) return;
  const r = tr().raw, raw = motionRaw(), nibs = raw.slice(6, 18).replace(/(..)/g, "$1 ").trim();
  p.innerHTML =
    `<div class="prow"><span class="plbl">${r.previewTelegram}</span> <span class="pval">${raw}</span></div>` +
    `<div class="prow"><span class="plbl">${r.previewNibbles}</span> <span class="pval">${nibs}</span></div>`;
}
function updateGate() {
  const g = $("gate"), b = $("sendBtn"); if (!g || !b) return;
  const ready = A && A.lifecycle() === "READY";
  b.disabled = !ready; g.textContent = ready ? "" : tr().raw.gate;
}
function copyLog() {
  const txt = logLines.map(h => { const d = document.createElement("div"); d.innerHTML = h; return d.textContent; }).join("\n");
  (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(
    () => { const b = $("copyBtn"); if (b) { b.textContent = tr().raw.copied; setTimeout(() => b.textContent = tr().raw.copy, 1200); } }, () => {});
}

// buildSurface: render the bench into #rawmain from module state (called on boot, map-load, language change)
function rawBench(api) {
  A = api;
  const r = tr().raw;
  $("rawmain").innerHTML =
    `<div class="rawcol controls">
       <div class="panel">
         <h2>${r.activeDevices}</h2>
         <p class="hint">${r.slotsHint}</p>
         <div class="slotsel" id="slotsel"></div>
         <div id="slots"></div>
         <div class="preview" id="preview"></div>
         <div class="sendrow">
           <button class="btn send" id="sendBtn">${r.send}</button>
           <button class="btn neutral" id="neutralBtn">${r.neutral}</button>
           <button class="btn stop" id="rawStop">${tr().stop}</button>
           <span class="gate" id="gate"></span>
         </div>
       </div>
     </div>
     <div class="rawcol console">
       <div class="panel console">
         <h2>${r.consoleH} <span class="tools">
           <button class="btn" id="copyBtn">${r.copy}</button>
           <button class="btn" id="clearBtn">${r.clear}</button></span></h2>
         <p class="hint">${r.consoleHint}</p>
         <div id="log"></div>
         <div class="apilist" style="margin-top:.6rem">
           <b>WS API</b> ${r.apiPath} <code>{cmd:set,slot,channel,value}</code> ·
           <code>{cmd:stop}</code> · <code>{cmd:setup,action:connect|ready|reset}</code> ·
           <code>{cmd:state}</code>. ${r.apiPushes} <code>lifecycle</code>, <code>state{slots,raw,ad}</code>.
         </div>
         <details class="api"><summary>${r.fullApi}</summary><pre id="apispec">${r.loading}</pre></details>
       </div>
     </div>`;
  const ss = $("slotsel");
  [1, 2, 3].forEach(n => { const b = mbtn(n + " " + (n === 1 ? r.slotWord : r.slotsWord), n === slotCount ? "btn on" : "btn", () => { slotCount = n; refreshSel(); buildSlots(); updatePreview(); }); b.dataset.n = n; ss.appendChild(b); });
  $("sendBtn").onclick = doSend;
  $("neutralBtn").onclick = doNeutral;
  $("rawStop").onclick = () => A.stopAll();             // content STOP -> shared chrome stop (latch + cmd:stop + neutralize)
  $("clearBtn").onclick = () => { logLines.length = 0; renderLog(); };
  $("copyBtn").onclick = copyLog;
  buildSlots(); updatePreview(); updateGate(); renderLog();
  if (apiSpec != null) { const p = $("apispec"); if (p) p.textContent = apiSpec; }
  else fetch("/asyncapi.yaml").then(x => x.text()).then(t => { apiSpec = t; const p = $("apispec"); if (p) p.textContent = t; }).catch(() => {});
  if (!booted) { booted = true; logInfo(r.bootHint); }
  // chrome neutralizeAll (STOP / blur / leave-READY) zeroes RAW too
  api.addControl(() => { rawDriving = false; for (let s = 0; s < 3; s++) for (let c = 0; c < 4; c++) vals[s][c] = 0; buildSlots(); updatePreview(); });
}

// refresh fires on lifecycle + state echoes: update the Send gate; log lifecycle transitions to the console
function onRefresh() {
  updateGate();
  if (A && booted) { const lc = A.lifecycle(); if (lc !== lastLc) { lastLc = lc; logInfo("lifecycle → " + lc + (lc === "CONNECTING" ? "  (connect telegram: adae18808080f352)" : "")); } }
}

MK4Chrome.create({
  layoutId: "raw",
  fnList: [],                                          // RAW has no function map — it drives raw slot/channel
  connectLabel: t => t.raw.connect,                    // generic "Connect device"
  features: { deviceSwap: false, gamepad: false, labelsTab: false, channels: false },   // only Connection + Server-info tabs
  wizardText: t => ({ next: t.suGen.next, s1b: t.suGen.s1b, s2t: t.suGen.s2t, s2b: t.suGen.s2b, wizTitle: t.suGen.wizTitle }),  // device-neutral
  buildSurface: rawBench,
  onState: onStateMsg,
  refresh: onRefresh,
  onNeutralize: () => { rawDriving = false; },         // (vals zeroed by the addControl reset)
});
setInterval(rawRefresh, 100);                          // RAW's own affirmative keepalive (server times out un-refreshed channels)
