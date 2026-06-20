// moldqueen RAW debug layout — protocol-level test tool over the SAME WebSocket API.
// Set slots/channels directly, build + SEND the MK4 telegram via the raw
// {cmd:set} / {cmd:stop} path (NOT the function map), and watch a console of the
// exact bytes on air. Basically mk4_test as a GUI. Reuses the dashboard shell + menu.
"use strict";

const $ = id => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const NEUTRAL_NIB = 0x8;
const tr = () => MK4I18N.dict();   // shared UI strings (EN-fallback). RAW is DEVICE-AGNOSTIC → uses t.raw.* (generic "device").

let ws = null, lifecycle = "IDLE";
let slotCount = 1;                                   // active slots (1-3)
let rawDriving = false;                              // affirm vals only after an explicit Send
                                                     // (cleared by Neutral/Stop/leaving READY)
const vals = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];  // signed value per slot/channel
let pendingSend = null;                              // {raw, fallback timer}

// value <-> nibble: nibble = 0x8 + value (same map as telegram.py), shown both ways
const toNib = v => (NEUTRAL_NIB + clamp(v | 0, -7, 7)) & 0xF;

// build the 12-nibble motion telegram client-side (raw bytes only; the on-air AD
// comes back from the server's state echo so the crypt is never reinvented here).
function motionRaw() {
  let hex = "7dae18";
  for (let s = 0; s < 3; s++) {
    for (let c = 0; c < 4; c += 2) {
      const hi = s < slotCount ? toNib(vals[s][c]) : NEUTRAL_NIB;
      const lo = s < slotCount ? toNib(vals[s][c + 1]) : NEUTRAL_NIB;
      hex += (((hi << 4) | lo) & 0xFF).toString(16).padStart(2, "0");
    }
  }
  return hex + "82";
}

// ---- WebSocket ----
function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
function connect() {
  ws = new WebSocket(MK4.wsEndpoint());                    // configurable (shared via clientconfig.js)
  ws.onopen = () => { setDot(true); MK4.setStatus("connected"); };
  ws.onclose = () => { setDot(false); MK4.setStatus("retrying"); setTimeout(connect, 1000); };
  ws.onerror = () => { MK4.setStatus("failed"); ws.close(); };
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === "lifecycle") setLifecycle(m.state);
    else if (m.type === "state") onState(m);
  };
}
function onState(m) {
  if (m.raw) setLive(m.raw, m.ad);
  if (pendingSend && m.raw === pendingSend.raw) {     // our Send reached the air
    clearTimeout(pendingSend.timer);
    logTelegram("SENT", m.raw, m.ad || "(server)");
    pendingSend = null;
  }
}

// ---- lifecycle ----
function setDot(ok) { const d = $("wsDot"); if (d) d.className = "dot" + (ok ? " ok" : ""); }
function setLifecycle(state) {
  const prev = lifecycle; lifecycle = state;
  if (state !== "READY") rawDriving = false;          // leaving READY stops affirming
  if (prev !== state) logInfo("lifecycle → " + state + (state === "CONNECTING" ? "  (connect telegram: adae18808080f352)" : ""));
  renderMenu(); updateGate(); wizardOnLifecycle(state);
}
// Affirmative motion-keepalive (mirrors dashboard.js): the server times out any non-neutral
// channel not refreshed ~3/0.3s, so re-send the sent vals ~10/s while DRIVING + READY.
const REFRESH_MS = 100;
function refreshActive() {
  if (!(ws && ws.readyState === 1) || lifecycle !== "READY" || !rawDriving) return;
  for (let s = 0; s < 3; s++) for (let c = 0; c < 4; c++) {
    const v = s < slotCount ? vals[s][c] : 0;
    if (v !== 0) send({ cmd: "set", slot: s, channel: c, value: v });   // re-affirm active channels
  }
}

// ---- menu (same shell/look as the dashboard) ----
function el(cls, style, html) { const d = document.createElement("div"); d.className = cls; if (style) d.style.cssText = style; if (html != null) d.innerHTML = html; return d; }
function mbtn(label, cls, on) { const b = document.createElement("button"); b.innerHTML = label; if (cls) b.className = cls; b.onclick = on; return b; }
function renderMenu() {
  const t = tr();
  const m = $("menu"); m.innerHTML = "";
  const left = el("tgroup");
  const dot = el("dot"); dot.id = "wsDot"; left.appendChild(dot);
  left.appendChild(el("lc", "", "<span id='lcText'>RAW · " + lifecycle + "</span>"));
  if (lifecycle === "IDLE") {
    left.appendChild(mbtn(t.raw.wizard, "primary", openWizard));   // guided on-ramp
    left.appendChild(mbtn(t.raw.connect, "", () => send({ cmd: "setup", action: "connect" })));  // manual (generic device)
  } else if (lifecycle === "CONNECTING") {
    left.appendChild(mbtn(t.ready, "primary", () => send({ cmd: "setup", action: "ready" })));
    left.appendChild(mbtn(t.reset, "", doReset));
  } else left.appendChild(mbtn(t.reset, "", doReset));
  m.appendChild(left);
  m.appendChild(el("grow"));
  const right = el("tgroup");
  const sb = mbtn(t.stop, "", doStop); sb.id = "stopBtn"; right.appendChild(sb);
  right.appendChild(mbtn(t.raw.neutral, "", doNeutral));
  right.appendChild(MK4I18N.picker(applyRawLang));   // language picker (persists mk4_lang; applies everywhere)
  if (MK4.showFullscreen()) right.appendChild(mbtn("⛶", "", toggleFull));
  right.appendChild(mbtn(t.layouts, "", () => location.href = "/?choose=1"));
  m.appendChild(right);
  setDot(ws && ws.readyState === 1);
}
function toggleFull() {
  if (!document.fullscreenElement) (document.documentElement.requestFullscreen || (() => {})).call(document.documentElement);
  else document.exitFullscreen && document.exitFullscreen();
}
// Language switch: re-render the WHOLE RAW page (menu + panels + open wizard) in the new
// language. Rebuilding the panels clears the console log — acceptable for a manual switch.
function applyRawLang() {
  buildMain(); renderMenu();
  if ($("wizard") && !$("wizard").classList.contains("hidden")) buildWizard();
}
function doReset() { send({ cmd: "setup", action: "reset" }); }
function doStop() { rawDriving = false; send({ cmd: "stop" }); logInfo(tr().raw.logStop); }
function doNeutral() {
  rawDriving = false;
  for (let s = 0; s < 3; s++) for (let c = 0; c < 4; c++) vals[s][c] = 0;
  buildSlots(); updatePreview();
  send({ cmd: "stop" }); logInfo(tr().raw.logNeutral);
}

// ---- condensed connection wizard (1-3 boxes); reuses the dashboard's .modal/.wiz
// styling and drives the same IDLE→CONNECTING→READY lifecycle. Step 3 (assign
// slots) is shown only when >1 box is selected. The service can't see the LEDs —
// it's a guided manual flow. The manual Connect/Ready/Reset buttons still work. ----
let wizStep = 0;
function openWizard() {
  wizStep = (lifecycle === "READY") ? 4 : (lifecycle === "CONNECTING") ? (slotCount > 1 ? 3 : 2) : 1;
  buildWizard(); $("wizard").classList.remove("hidden");
}
function closeWizard() { wizStep = 0; $("wizard").classList.add("hidden"); }
function wizardCancel() { send({ cmd: "setup", action: "reset" }); closeWizard(); }
function wizardOnLifecycle(state) {
  if (!$("wizard") || $("wizard").classList.contains("hidden")) return;
  if (state === "READY") { wizStep = 4; buildWizard(); }
  else if (state === "IDLE" && wizStep > 1) { wizStep = 1; buildWizard(); }
}
function wizNext() {
  if (wizStep === 1) { send({ cmd: "setup", action: "connect" }); wizStep = 2; }   // → CONNECTING
  else if (wizStep === 2) wizStep = 3;                                              // (multi-box only)
  buildWizard();
}
function wizBack() {
  if (wizStep === 2) { send({ cmd: "setup", action: "reset" }); wizStep = 1; }      // → IDLE
  else if (wizStep === 3) wizStep = 2;
  buildWizard();
}
function wizReady() { send({ cmd: "setup", action: "ready" }); }   // → READY → step 4 (via lifecycle)
function wbtn(id, label, primary) { return `<button id="${id}"${primary ? ' class="apply"' : ""}>${label}</button>`; }
function buildWizard() {
  const t = tr(), r = t.raw, n = slotCount, s = wizStep;
  const boxesPhrase = n === 1 ? r.yourBox : r.yourBoxes.replace("{n}", n);
  const whoPhrase = n === 1 ? r.yourBox : r.theBoxes;
  const txt = {
    1: { t: r.w1t, b: r.w1b.replace("{boxes}", boxesPhrase) },
    2: { t: r.w2t, b: r.w2b.replace("{who}", whoPhrase) },
    3: { t: r.w3t, b: n === 2 ? r.wAssign2 : r.wAssign3 },
    4: { t: r.w4t, b: r.w4b },
  }[s];
  let btns;
  if (s === 1) btns = wbtn("wCancel", t.wiz.cancel) + wbtn("wNext", t.wiz.next, 1);
  else if (s === 2) btns = wbtn("wCancel", t.wiz.cancel) + wbtn("wBack", t.wiz.back) + (n > 1 ? wbtn("wNext", t.wiz.next, 1) : wbtn("wReady", t.wiz.readyBtn, 1));
  else if (s === 3) btns = wbtn("wCancel", t.wiz.cancel) + wbtn("wBack", t.wiz.back) + wbtn("wReady", t.wiz.readyBtn, 1);
  else btns = wbtn("wDone", r.start, 1);
  const dots = n > 1 ? [1, 2, 3, 4] : [1, 2, 4];
  const gif = { 1: "long_flash", 2: "short_flash", 3: "double_short_flash" }[s];   // real LED-flash GIFs
  const media = gif ? `<div class="media"><img src="/assets/${gif}.gif" alt=""></div>` : "";
  $("wizard").innerHTML = `<div class="backdrop"></div><div class="sheet wiz">
    <h2>${r.wzTitle} <span class="muted" style="font-size:.8rem">(${n} ${n > 1 ? r.boxes : r.box})</span></h2>
    <div class="wsteps">${dots.map(d => `<span class="wdot${d === s ? " on" : d < s ? " done" : ""}"></span>`).join("")}</div>
    ${media}
    <h3 class="wt">${txt.t}</h3><p class="wbody">${txt.b}</p>
    <div class="actions wactions">${btns}</div>
  </div>`;
  $("wizard").querySelector(".backdrop").onclick = function () {};   // use Cancel, not click-out
  const on = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
  on("wCancel", wizardCancel); on("wBack", wizBack); on("wNext", wizNext); on("wReady", wizReady); on("wDone", closeWizard);
}

// ---- controls (slots / channels / send) ----
function buildMain() {
  const r = tr().raw;
  $("rawmain").innerHTML =
    `<div class="rawcol controls">
       <div class="panel">
         <h2>${r.apiConnection}</h2>
         <div class="eprow" id="epRow"></div>
       </div>
       <div class="panel">
         <h2>${r.activeDevices}</h2>
         <p class="hint">${r.slotsHint}</p>
         <div class="slotsel" id="slotsel"></div>
         <div id="slots"></div>
         <div class="preview" id="preview"></div>
         <div class="sendrow">
           <button class="btn send" id="sendBtn">${r.send}</button>
           <button class="btn neutral" id="neutralBtn">${r.neutral}</button>
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
  // slot-count selector
  const ss = $("slotsel");
  [1, 2, 3].forEach(n => {
    const b = mbtn(n + " " + (n === 1 ? r.slotWord : r.slotsWord), n === slotCount ? "btn on" : "btn", () => { slotCount = n; refreshSel(); buildSlots(); updatePreview(); });
    b.dataset.n = n; ss.appendChild(b);
  });
  $("sendBtn").onclick = doSend;
  $("neutralBtn").onclick = doNeutral;
  $("clearBtn").onclick = () => { $("log").innerHTML = ""; };
  $("copyBtn").onclick = copyLog;
  MK4.buildEndpointRow($("epRow"), () => { try { if (ws) ws.close(); } catch (e) {} connect(); });
  MK4.setStatus(ws && ws.readyState === 1 ? "connected" : "retrying");
  buildSlots(); updatePreview(); updateGate();
  fetch("/asyncapi.yaml").then(r => r.text()).then(t => { const p = $("apispec"); if (p) p.textContent = t; }).catch(() => {});
}
function refreshSel() { $("slotsel").querySelectorAll("button").forEach(b => b.className = (+b.dataset.n === slotCount ? "btn on" : "btn")); }

function buildSlots() {
  const r = tr().raw;
  const host = $("slots"); host.innerHTML = "";
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
      let v = clamp(parseInt(e.target.value || "0", 10) || 0, -7, 7);
      vals[s][c] = v;
      // keep the paired range/number in sync
      host.querySelectorAll(`.rg[data-s="${s}"][data-c="${c}"], .nm[data-s="${s}"][data-c="${c}"]`).forEach(o => { if (o !== e.target) o.value = v; });
      const nb = $(`nib-${s}-${c}`); if (nb) nb.textContent = "0x" + toNib(v).toString(16);
      updatePreview();
    });
  });
}
function updatePreview() {
  const raw = motionRaw();
  const p = $("preview");
  if (!p) return;
  const r = tr().raw;
  const nibs = raw.slice(6, 18).replace(/(..)/g, "$1 ").trim();
  // block-level rows (not <br>); a raw-specific label class avoids the dashboard's
  // global ".lbl { position:absolute }" rule (which made the two lines overlap).
  p.innerHTML =
    `<div class="prow"><span class="plbl">${r.previewTelegram}</span> <span class="pval">${raw}</span></div>` +
    `<div class="prow"><span class="plbl">${r.previewNibbles}</span> <span class="pval">${nibs}</span></div>`;
}
function updateGate() {
  const g = $("gate"), b = $("sendBtn");
  if (!g || !b) return;
  const ready = lifecycle === "READY";
  b.disabled = !ready;
  g.textContent = ready ? "" : tr().raw.gate;
}

function doSend() {
  if (lifecycle !== "READY") { logInfo(tr().raw.logSendIgnored); return; }
  rawDriving = true;                          // start affirming (keepalive holds it on the server)
  const target = motionRaw();
  // send a raw set for every channel (active = value, inactive slot = neutral)
  for (let s = 0; s < 3; s++) for (let c = 0; c < 4; c++) send({ cmd: "set", slot: s, channel: c, value: s < slotCount ? vals[s][c] : 0 });
  if (pendingSend) clearTimeout(pendingSend.timer);
  pendingSend = { raw: target, timer: setTimeout(() => {           // fallback if no state echo
    logTelegram("SENT", target, "(no echo — AD computed server-side)"); pendingSend = null;
  }, 800) };
}

// ---- console log ----
function ts() { const d = new Date(); return d.toTimeString().slice(0, 8) + "." + String(d.getMilliseconds()).padStart(3, "0"); }
function logRaw(html) { const e = document.createElement("div"); e.className = "logline"; e.innerHTML = html; const l = $("log"); l.appendChild(e); l.scrollTop = l.scrollHeight; }
function logTelegram(kind, raw, ad) { logRaw(`<span class="ts">${ts()}</span> <span class="kind ${kind}">${kind}</span> raw=<span class="raw">${raw}</span> · <span class="ad">AD=${ad}</span>`); }
function logInfo(text) { logRaw(`<span class="ts">${ts()}</span> <span class="info">${text}</span>`); }
function setLive() { /* live on-air readout is the preview; state echoes confirm Sends */ }
function copyLog() {
  const txt = [...$("log").querySelectorAll(".logline")].map(l => l.textContent).join("\n");
  (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(
    () => { const b = $("copyBtn"); b.textContent = tr().raw.copied; setTimeout(() => b.textContent = tr().raw.copy, 1200); }, () => {});
}

// ---- wiring ----
document.addEventListener("keydown", e => { if (e.code === "Space" || e.code === "Escape") { e.preventDefault(); doStop(); } });
buildMain();
renderMenu();
logInfo(tr().raw.bootHint);
connect();
setInterval(refreshActive, REFRESH_MS);   // affirmative motion-keepalive (server times out un-refreshed channels)
