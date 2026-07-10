// moldqueen — SHARED chrome + runtime core (MK4Chrome). Single source for everything AROUND
// the control surface: the WS/lifecycle/keepalive/STOP runtime, the channel map + resolution,
// the grouped menu + collapse chevron, the tabbed settings (Connection/Channels/Labels/
// Gamepad/Server-info + optional Auto-assign), the connect wizard + startup guide, the language
// picker, the custom title and the status light. Both the excavator (dashboard.js) and the
// generic engine (generic.js) call MK4Chrome.create(config); the ONLY per-layout code is the
// control surface (config.buildSurface) + a little config. The safety/runtime bits here were
// MOVED VERBATIM from the proven excavator (dashboard.js) — behavior must stay identical.
//
//   MK4Chrome.create({
//     layoutId, fnList, mapUrl?, connectLabel(t), title:{default, style},
//     features:{deviceSwap, gamepad, labelsTab, channels=true}, gamepadDefault?, autoAssign?:{compute,order,controls},
//     buildSurface(api), refresh?(api), onResize?(api), onNeutralize?(), onState?(msg),
//   })
// api handed to the surface: {driveFn, scaleVal, capFor, stopAll, clearStopLatch, neutralizeAll,
//     lifecycle(), isUnmapped, funcLabel, getMap(), getGrid(), deviceSwap(), dict(), addControl(reset), clamp}
"use strict";
window.MK4Chrome = (function () {
  function create(config) {
    const $ = id => document.getElementById(id);
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const el = (cls, style, html) => { const d = document.createElement("div"); d.className = cls; if (style) d.style.cssText = style; if (html != null) d.innerHTML = html; return d; };

    const FN = config.fnList;
    const LANGS = MK4I18N.LANGS;
    const features = config.features || {};
    const LAYOUT_ID = config.layoutId;
    const LAYOUT_TITLE_DEFAULT = (config.title && config.title.default) || LAYOUT_ID;
    const LAYOUT_TITLE_COLOR_DEFAULT = (config.title && config.title.color) || "#eaf2ff";   // per-layout default (light); brick passes a dark grey
    const MAP_URL = config.mapUrl || ("/channel_map." + LAYOUT_ID + ".json");
    const MAP_KEY = "mk4_active_map_" + LAYOUT_ID;   // D1: per-layout key

    // ---- state ----
    let ws = null, lifecycle = "IDLE";
    let lang = MK4I18N.lang();
    let defaultMap = null, activeMap = null, deviceSwap = !!features.deviceSwap && localStorage.getItem("mk4_device_swap") === "1";
    let navCollapsed = localStorage.getItem("mk4_nav_collapsed") === "1";
    let grid = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    const tr = () => MK4I18N.dict(lang);

    // ---- MIXED MODE: protocol is PER-SLOT (per physical box) ----
    // A function inherits its protocol from the box on its slot, so ONE layout can drive an MK4 box on
    // one slot and an MK6 box on another at once (the server already does per-command mixed). slotProto
    // = { "<slot>": "mk4"|"mk6" }, PERSISTED per-layout (same mechanism/key shape as the active channel
    // map, mk4_active_map_<id>). This REPLACES a single session protocol as the DRIVING source: each
    // function-bearing `set` stamps ITS slot's protocol + device. MK4 slots are left untouched (server
    // default mk4/device0) -> byte-identical MK4 telegrams. PROTO_KEY is kept only as the legacy
    // migration source (existing single-mk6 users had a session pick, no slotProto yet).
    const PROTO_KEY = "mk4_protocol";
    const SLOT_PROTO_KEY = "mk4_slot_proto_" + LAYOUT_ID;   // per-layout, mirrors mk4_active_map_<id>
    function getProtocol() { return localStorage.getItem(PROTO_KEY) === "mk6" ? "mk6" : "mk4"; }   // legacy default only
    function getSlotProto() { try { const o = JSON.parse(localStorage.getItem(SLOT_PROTO_KEY) || "{}"); return (o && typeof o === "object") ? o : {}; } catch { return {}; } }
    function setSlotProto(o) { localStorage.setItem(SLOT_PROTO_KEY, JSON.stringify(o || {})); }
    // "none" | "mk6" | "mk4": EXPLICIT "none" (unused box, mixed-only) -> "none"; "mk6" -> "mk6";
    // ABSENT / anything-else -> "mk4" (default, back-compat). "none" is DISTINCT from absent-default-mk4.
    function protoForSlot(slot) { const p = getSlotProto()[String(slot)]; return p === "mk6" ? "mk6" : p === "none" ? "none" : "mk4"; }
    function usedSlots(mp) {   // distinct integer slots the layout's functions occupy (slot != null)
      const m = mp || activeMap, set = new Set();
      if (m && m.functions) for (const f of FN) { const a = m.functions[f]; if (a && a.slot != null) set.add(a.slot | 0); }
      return [...set].sort((x, y) => x - y);
    }
    const ALL_SLOTS = [0, 1, 2];
    // Slots that have a BOX (to connect + drive): every slot the user EXPLICITLY assigned mk4/mk6 in the
    // mixed picker, PLUS any function-occupied slot NOT marked None (back-compat: primary/all-mk4 layouts
    // have functions but may store no per-slot pick). None + empty slots are excluded. The connect
    // enumeration is driven by ASSIGNMENT (this), NOT by usedSlots(): a box assigned to a slot that has no
    // functions yet still connects — fixes the "only one box pairs when a box sits on a function-less slot" bug.
    function boxSlots() {
      const sp = getSlotProto(), set = new Set();
      ALL_SLOTS.forEach(s => { const p = sp[String(s)]; if (p === "mk4" || p === "mk6") set.add(s); });
      usedSlots().forEach(s => { if (sp[String(s)] !== "none") set.add(s); });
      return [...set].sort((x, y) => x - y);
    }
    function allUsedProto() {   // protocol of the assigned boxes: "mk4" | "mk6" | "mixed"
      const ps = [...new Set(boxSlots().map(protoForSlot))];
      return ps.length <= 1 ? (ps[0] || "mk4") : "mixed";
    }
    function hasChosen() { const sp = getSlotProto(); return usedSlots().every(s => { const p = sp[String(s)]; return p === "mk4" || p === "mk6" || p === "none"; }); }
    // Back-compat migration: fill any UNSET used-slot from the legacy session pick — but ONLY for a legacy
    // user (PROTO_KEY present). A fresh user's slotProto stays empty so screen-0 must-pick still fires.
    function ensureSlotProto(mp) {
      if (localStorage.getItem(PROTO_KEY) == null) return;
      const sp = getSlotProto(), dflt = getProtocol(); let changed = false;
      for (const s of usedSlots(mp)) { const k = String(s); if (sp[k] !== "mk4" && sp[k] !== "mk6") { sp[k] = dflt; changed = true; } }
      if (changed) setSlotProto(sp);
    }
    // Stamp a function-bearing `set` with ITS slot's protocol. o.slot = the resolved, deviceSwap-adjusted
    // slot that ALSO becomes the mk6 device, so protocol+device stay consistent for that physical box.
    // MK4 slot -> o UNCHANGED (server default mk4/device0). `setup` connect/ready are enumerated
    // separately (NOT stamped here). Mutates + returns o.
    function stampProto(o) { if (protoForSlot(o.slot) === "mk6") { o.protocol = "mk6"; o.device = o.slot | 0; } return o; }
    // Per-PROTOCOL channel range: MK6 = 6 byte-channels (0-5); MK4 = 4 nibble-channels (0-3). Applied
    // PER-FUNCTION off the function's slot protocol (an mk6-slot fn may map c4/c5; mk4 stays capped at 3).
    function maxChannelFor(proto) { return proto === "mk6" ? 5 : 3; }
    function chanRangeFor(proto) { return Array.from({ length: maxChannelFor(proto) + 1 }, (_, n) => n); }

    // ---- channel map helpers (client-authoritative active map) ----
    function validMap(mp) {
      if (!mp || typeof mp !== "object" || !mp.functions) return false;
      const seen = {};
      for (const f of FN) {
        const a = mp.functions[f];
        if (!a) return false;
        if (a.slot == null && a.channel == null) continue;   // UNMAPPED (generic) — allowed; excavator never has nulls
        if (!Number.isInteger(a.slot) || a.slot < 0 || a.slot > 2) return false;
        const proto = protoForSlot(a.slot);   // per-slot protocol -> per-function channel range
        if (proto === "none") continue;   // None slot (unused box): function is inert -> accept, skip range + dedup (re-checked if slot later set to mk4/mk6)
        if (!Number.isInteger(a.channel) || a.channel < 0 || a.channel > maxChannelFor(proto)) return false;   // mk6 slot: 0-5, mk4: 0-3
        const key = proto + "/" + a.slot + "/" + a.channel;   // mk4 box + mk6 box on the same slot/channel = DIFFERENT boxes, allowed
        if (seen[key]) return false; seen[key] = f;
      }
      return true;
    }
    function migrateLabels(a) {
      const lb = (a.labels && typeof a.labels === "object") ? a.labels : {};
      if (lb.en == null && typeof a.label_en === "string") lb.en = a.label_en;
      if (lb.de == null && typeof a.label_de === "string") lb.de = a.label_de;
      const out = {};
      LANGS.forEach(([c]) => { out[c] = typeof lb[c] === "string" ? lb[c] : ""; });
      a.labels = out; delete a.label_en; delete a.label_de;
    }
    function migrateCaps(a) {
      const legacy = (Number.isInteger(a.max) && a.max >= 1 && a.max <= 7) ? a.max : null;
      if (!(Number.isInteger(a.max_fwd) && a.max_fwd >= 1 && a.max_fwd <= 7)) a.max_fwd = legacy != null ? legacy : 5;
      if (!(Number.isInteger(a.max_rev) && a.max_rev >= 1 && a.max_rev <= 7)) a.max_rev = legacy != null ? legacy : 5;
      delete a.max;
    }
    function withDefaults(mp) {
      const m = JSON.parse(JSON.stringify(mp)); if (!m.functions) m.functions = {};
      for (const f of FN) {
        const a = m.functions[f] || (m.functions[f] = {});
        if (a.slot === undefined) a.slot = null;             // generic: unmapped by default
        if (a.channel === undefined) a.channel = null;
        if (typeof a.invert !== "boolean") a.invert = false;
        if (typeof a.reverse_scale !== "number" || a.reverse_scale < 0.25 || a.reverse_scale > 4) a.reverse_scale = 1;
        migrateCaps(a);
        migrateLabels(a);
      }
      return m;
    }
    function loadStoredMap() {
      try {
        const m = JSON.parse(localStorage.getItem(MAP_KEY) || "null");
        if (m && m.functions) ensureSlotProto(m);   // legacy migration: fill slotProto for this map's slots BEFORE validation
        return validMap(m) ? withDefaults(m) : null;
      } catch { return null; }
    }
    function saveActive() { localStorage.setItem(MAP_KEY, JSON.stringify(activeMap)); }
    function placeholderMap() {
      const fns = {};
      FN.forEach((f, i) => fns[f] = { slot: (i / 4) | 0, channel: i % 4, invert: false, max_fwd: 5, max_rev: 5, reverse_scale: 1,
        labels: Object.fromEntries(LANGS.map(([c]) => [c, f.replace(/_/g, " ")])), confirmed: false });
      return { version: 1, functions: fns };
    }
    function mapForEdit() { return JSON.parse(JSON.stringify(activeMap || loadStoredMap() || placeholderMap())); }
    function funcLabel(fn) {
      const a = activeMap && activeMap.functions[fn];
      if (!a) return fn;
      const lb = a.labels || {};
      return lb[lang] || lb.en || a.label_en || fn;
    }
    const isUnmapped = fn => { const a = activeMap && activeMap.functions[fn]; return !a || a.slot == null || a.channel == null; };
    function capFor(a, outPositive) {
      const m = outPositive ? a && a.max_fwd : a && a.max_rev;
      return (Number.isInteger(m) && m >= 1 && m <= 7) ? m : (outPositive ? 7 : 5);
    }
    function scaleVal(fn, frac) {
      const a = activeMap && activeMap.functions[fn];
      if (!a || !frac) return Math.round((frac || 0) * 7);
      const outPositive = (frac > 0) !== !!a.invert;
      return Math.sign(frac) * Math.round(Math.abs(frac) * capFor(a, outPositive));
    }
    function resolveSC(fn) {
      const a = activeMap && activeMap.functions[fn]; if (!a || a.slot == null || a.channel == null) return null;
      let slot = a.slot; if (deviceSwap && (slot === 0 || slot === 1)) slot = 1 - slot;
      return [slot, a.channel];
    }
    function funcValue(fn) { const sc = resolveSC(fn); return sc ? (grid[sc[0]] || [])[sc[1]] || 0 : 0; }

    // ---- WebSocket ----
    function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
    let wsTries = 0, wsTimer = null, wsStatus = "retrying";
    const WS_MAX_TRIES = 5;
    function setWsStatus(s) { wsStatus = s; MK4.setStatus(s); updateStatusLight(); startupOnUpdate(); }
    function scheduleRetry() {
      wsTries++;
      if (wsTries > WS_MAX_TRIES) { setWsStatus("failed"); return; }
      setWsStatus("retrying");
      clearTimeout(wsTimer);
      wsTimer = setTimeout(connect, Math.min(1000 * wsTries, 5000));
    }
    function connect() {
      clearTimeout(wsTimer);
      try { ws = new WebSocket(MK4.wsEndpoint()); } catch (e) { scheduleRetry(); return; }
      ws.onopen = () => { wsTries = 0; setWsStatus("connected"); };
      ws.onclose = () => { neutralizeAll(); scheduleRetry(); updateStatusLight(); };
      ws.onerror = () => { try { ws.close(); } catch (e) {} };
      ws.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === "lifecycle") setLifecycle(m.state);
        else if (m.type === "state") { if (m.slots) { grid = m.slots; if (config.refresh) config.refresh(api); } if (config.onState) config.onState(m); }
        else if (m.type === "info") onInfo(m);
      };
    }
    function reconnectWS() { wsTries = 0; clearTimeout(wsTimer); try { if (ws) ws.close(); } catch (e) {} connect(); }

    // ---- drive + affirmative motion-keepalive + ABSOLUTE STOP (moved verbatim) ----
    const controls = [];   // {reset()} — for global neutralize (surface registers via api.addControl)
    const lastVal = {}, intent = {};
    let stopLatched = false, autoReady = false;
    function resolveDrive(fn, v) {
      const a = activeMap && activeMap.functions[fn];
      if (!a) return null;
      if (a.slot == null || a.channel == null) return null;   // D6: UNMAPPED -> no cmd:set (no motion)
      let slot = a.slot | 0; const ch = a.channel | 0;
      if (deviceSwap && (slot === 0 || slot === 1)) slot = 1 - slot;
      if (protoForSlot(slot) === "none") return null;   // None slot (unused box): NO set — drive + keepalive both null-check this, so NOTHING reaches stampProto (never the mk4/device0 default)
      let mag = Math.abs(v | 0);
      if (v < 0 && typeof a.reverse_scale === "number" && a.reverse_scale !== 1)
        mag = Math.max(0, Math.min(7, Math.round(mag * a.reverse_scale)));
      let sign = v < 0 ? -1 : (v > 0 ? 1 : 0);
      if (a.invert) sign = -sign;
      let out = sign * mag;
      if (out > 0) out = Math.min(out, capFor(a, true));
      else if (out < 0) out = -Math.min(-out, capFor(a, false));
      return { slot, channel: ch, value: out };
    }
    function driveFn(fn, v) {
      v = clamp(v | 0, -7, 7);
      if (stopLatched && v !== 0) return;                       // ABSOLUTE STOP: refuse motion until a fresh input clears the latch
      intent[fn] = v;
      if (v !== 0 && lastVal[fn] === v) return;                 // dedup NON-ZERO only; a 0 is always sent
      lastVal[fn] = v;
      const r = resolveDrive(fn, v);
      if (r) send(stampProto({ cmd: "set", slot: r.slot, channel: r.channel, value: r.value }));
    }
    const REFRESH_MS = 100;
    function refreshActive() {
      if (!(ws && ws.readyState === 1) || lifecycle !== "READY") return;
      if (stopLatched) return;
      for (const fn of FN) {
        const v = intent[fn] | 0;
        if (v === 0) continue;
        const r = resolveDrive(fn, v);
        if (r) send(stampProto({ cmd: "set", slot: r.slot, channel: r.channel, value: r.value }));
      }
    }
    function neutralizeAll() {
      if (config.onNeutralize) config.onNeutralize();
      controls.forEach(c => c.reset());
      FN.forEach(fn => driveFn(fn, 0));
    }
    function stopAll() {
      stopLatched = true;
      neutralizeAll();
      send({ cmd: "stop" });
      if (features.gamepad) { padSuppressed = true; if (padEnabled) setPadEnabled(false); }
    }
    function clearStopLatch() { stopLatched = false; }
    function doReset() { send({ cmd: "setup", action: "reset" }); toast(tr().released); }   // toast = feedback only; does not touch the release/safety behavior
    // lightweight shared toast (feedback only, no control/safety surface)
    let toastTimer = null;
    function toast(msg) {
      let node = document.getElementById("mqToast");
      if (!node) { node = document.createElement("div"); node.id = "mqToast"; node.setAttribute("role", "status"); node.setAttribute("aria-live", "polite"); document.body.appendChild(node); }
      node.textContent = msg; node.classList.add("show");
      clearTimeout(toastTimer); toastTimer = setTimeout(function () { node.classList.remove("show"); }, 2200);
    }

    // ---- status light ----
    function updateStatusLight() {
      const e = $("statusLight"); if (!e) return;
      const wsUp = !!(ws && ws.readyState === 1);
      const c = !wsUp ? "red" : (lifecycle === "READY" ? "green" : "yellow");
      e.className = "statuslight " + c;
      const t = tr();
      e.title = !wsUp ? t.statusNoServer : (lifecycle === "READY" ? t.statusReadyT : t.statusConnectedT + lifecycle);
    }
    function setLifecycle(state) {
      lifecycle = state;
      const ov = $("overlay"); if (ov) ov.classList.toggle("locked", state !== "READY");
      if (state !== "READY") neutralizeAll();
      renderTopbar(); renderHint(); if (config.refresh) config.refresh(api);
      rebuildOpenSettings();
      wizardOnLifecycle(state);
      startupOnUpdate();
      if (autoReady && state === "READY") { autoReady = false; closeWizard(); closeStartup(); }   // skipToReady sends its own connects+ready; this just auto-closes
    }

    // ---- surface (control widgets) — the ONLY per-layout code ----
    function updateGate() { const ov = $("overlay"); if (ov) ov.classList.toggle("locked", lifecycle !== "READY"); }
    function rebuildSurface() {
      controls.length = 0;
      if (config.buildSurface) config.buildSurface(api);
      renderTitle();
      updateGate();
    }
    function renderHint() { const h = $("hint"); if (h) h.classList.add("hidden"); }

    // ---- editable custom title (per-layout; rendered into the surface overlay) ----
    // Independent NAME + VISIBILITY: the NAME (mk4_title_<id>) is the custom text, or absent -> the default
    // layout name; VISIBILITY (mk4_title_show_<id>, default ON) is a "Show title" toggle. OFF hides the title
    // regardless of the name; ON shows the custom text if set, else the default. The field sets the name only.
    function titleVisible() { return localStorage.getItem("mk4_title_show_" + LAYOUT_ID) !== "0"; }
    function setTitleVisible(on) { localStorage.setItem("mk4_title_show_" + LAYOUT_ID, on ? "1" : "0"); renderTitle(); }
    function titleName() { const v = (localStorage.getItem("mk4_title_" + LAYOUT_ID) || "").trim(); return v || LAYOUT_TITLE_DEFAULT; }
    function titleColor() { return localStorage.getItem("mk4_title_color_" + LAYOUT_ID) || LAYOUT_TITLE_COLOR_DEFAULT; }
    function setTitleColor(c) { localStorage.setItem("mk4_title_color_" + LAYOUT_ID, c); renderTitle(); }
    function setTitle(v) {
      v = (v || "").trim();
      if (v && v !== LAYOUT_TITLE_DEFAULT) localStorage.setItem("mk4_title_" + LAYOUT_ID, v);
      else localStorage.removeItem("mk4_title_" + LAYOUT_ID);   // empty / default -> no custom name (falls back to default)
      renderTitle();
    }
    function renderTitle() {
      if (!config.title) return;
      const ov = $("overlay"); if (!ov) return;
      let b = $("ib_title");
      if (!titleVisible()) { if (b) b.remove(); return; }   // toggle OFF -> show no title at all
      if (!b) { b = document.createElement("div"); b.id = "ib_title"; b.className = "lbl info"; if (config.title.style) b.style.cssText = config.title.style; ov.appendChild(b); }
      b.style.color = titleColor();
      b.innerHTML = '<span class="ttl">' + esc(titleName()) + '</span>';
    }

    // ---- top toolbar (grouped: Navigation · Connection · Settings) + collapse chevron ----
    const HOME_ICON = '<svg class="micon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1.4 1 7.3v.9h1.6V14H6.5V9.6h3V14h3.9V8.2H15v-.9L8 1.4z"/></svg>';
    // translate glyph (characters + arrow) — reads as "translate language", not "internet/globe"
    const LANG_ICON = '<svg class="micon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>';
    // coffee-cup glyph for the Ko-fi support link
    const COFFEE_ICON = '<svg class="micon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 3h16a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-2v1a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V3zm14 5h2V5h-2v3zM2 19h18v2H2v-2z"/></svg>';
    const HEART_ICON = '<svg class="micon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-7.5-4.6-10-9.3C.6 9 1.3 5.5 4.3 4.4 6.4 3.6 8.6 4.3 10 6c.4.5.7 1 1 1.5.3-.5.6-1 1-1.5 1.4-1.7 3.6-2.4 5.7-1.6 3 1.1 3.7 4.6 2.3 7.3C19.5 16.4 12 21 12 21z"/></svg>';
    const GLOBE_ICON = '<svg class="micon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18"/></svg>';
    const KOFI_URL = "https://ko-fi.com/A437HBY";
    const SPONSOR_URL = "https://github.com/sponsors/jrichter24";
    const WEBSITE_URL = "https://jrichter24.github.io/moldqueen/";
    function tbtn(label, cls, on) { const b = document.createElement("button"); b.innerHTML = label; if (cls) b.className = cls; b.onclick = on; return b; }
    // Pure external link (new tab) for support / website. NEVER a control — no drive/keepalive/STOP path.
    function extLink(href, icon, label, title, cls) {
      const a = document.createElement("a");
      a.className = cls; a.href = href; a.target = "_blank"; a.rel = "noopener";
      if (title) { a.title = title; a.setAttribute("aria-label", title); }
      a.innerHTML = icon + '<span class="btxt">' + label + "</span>";
      return a;
    }
    function renderTopbar() {
      const tb = $("menu"); tb.innerHTML = ""; const t = tr();
      // collapse control — chevron points the way the menu folds (see collapseGlyph)
      const top = el("navtop");
      const cb = tbtn(collapseGlyph(), "navcollapse", toggleNav); cb.id = "navCollapseBtn"; cb.title = t.collapseMenu;
      top.appendChild(cb); tb.appendChild(top);
      // (the editable layout title is on the control surface — #ib_title — so collapsing never hides it)

      // GROUP 1 — Navigation: Startpage (home) — FIRST entry (leftmost horizontal / topmost vertical)
      const g1 = el("navgroup"); g1.appendChild(el("grouplabel", "", t.grpNavigation));
      const b1 = el("groupbtns"); g1.appendChild(b1);
      b1.appendChild(tbtn(HOME_ICON + '<span class="btxt">' + t.layouts + "</span>", "withicon", () => { location.href = "/?choose=1"; }));
      tb.appendChild(g1); tb.appendChild(el("navsep"));

      // GROUP 2 — Connection: connect/resume + auto-assign shortcut (generic only) + release
      const g2 = el("navgroup"); g2.appendChild(el("grouplabel", "", t.grpConnection));
      const b2 = el("groupbtns"); g2.appendChild(b2);
      b2.appendChild(lifecycle === "CONNECTING"
        ? tbtn(t.resume, "primary", openWizard)
        : tbtn((config.connectLabel ? config.connectLabel(t) : t.connect), "primary connectExc", openWizard));
      // auto-assign shortcut — only on layouts that HAVE auto-assign (generic; config.autoAssign). Opens the
      // EXISTING auto-assign UI (same as the Settings → re-run path); UI/navigation only, no drive/safety path.
      if (config.autoAssign) b2.appendChild(tbtn(t.gen.autoAssignBtn, "", () => { closeAll(); openAssign(); }));
      b2.appendChild(tbtn(t.resetConn, "", doReset));
      tb.appendChild(g2); tb.appendChild(el("navsep"));

      // GROUP 3 — Settings: language · settings · fullscreen (gated) · gamepad chip (gated)
      const g3 = el("navgroup"); g3.appendChild(el("grouplabel", "", t.grpSettings));
      const b3 = el("groupbtns"); g3.appendChild(b3);
      b3.appendChild(langSelect());
      b3.appendChild(tbtn(t.settings, "", openSettings));
      if (MK4.showFullscreen()) b3.appendChild(tbtn(t.full, "", toggleFullscreen));
      if (features.gamepad && activePad()) b3.appendChild(padChip());
      tb.appendChild(g3); tb.appendChild(el("navsep"));

      // GROUP 4 — Support: Website + GitHub Sponsors + Ko-fi (pure external links, new tab; no drive/keepalive/STOP path)
      const g4 = el("navgroup"); g4.appendChild(el("grouplabel", "", t.grpSupport));
      const b4 = el("groupbtns"); g4.appendChild(b4);
      b4.appendChild(extLink(WEBSITE_URL, GLOBE_ICON, t.website, t.websiteTitle, "kofibtn extlink"));
      b4.appendChild(extLink(SPONSOR_URL, HEART_ICON, t.sponsor, t.sponsorTitle, "kofibtn sponsorbtn"));
      b4.appendChild(extLink(KOFI_URL, COFFEE_ICON, t.support, t.supportTitle, "kofibtn"));
      tb.appendChild(g4);

      updateStatusLight();
    }
    const SIDEBAR_MQ = "(max-width: 768px), (max-height: 540px)";
    function isSidebar() { return window.matchMedia(SIDEBAR_MQ).matches; }
    function collapseGlyph() { return isSidebar() ? "‹" : "▴"; }
    function expandGlyph() { return isSidebar() ? "›" : "▾"; }
    function updateNavGlyphs() {
      const cb = $("navCollapseBtn"); if (cb) cb.textContent = collapseGlyph();
      const chip = $("navChip"); if (chip) chip.innerHTML = expandGlyph();
    }
    function applyNav() {
      $("app").classList.toggle("navhidden", navCollapsed);
      const chip = $("navChip");
      if (chip) { chip.innerHTML = expandGlyph(); chip.title = tr().expandMenu; }
    }
    function toggleNav() {
      navCollapsed = !navCollapsed;
      localStorage.setItem("mk4_nav_collapsed", navCollapsed ? "1" : "0");
      applyNav();
    }
    function toggleFullscreen() {
      if (!document.fullscreenElement) (document.documentElement.requestFullscreen || (() => {})).call(document.documentElement);
      else document.exitFullscreen && document.exitFullscreen();
    }
    function langSelect() {   // translate-glyph icon button with the native <select> overlaid (same dropdown)
      const wrap = document.createElement("span"); wrap.className = "langicon"; wrap.title = tr().langTitle;
      wrap.innerHTML = LANG_ICON;
      const s = document.createElement("select");
      s.id = "langSel"; s.className = "langsel";
      s.innerHTML = LANGS.map(([c, name]) => `<option value="${c}"${c === lang ? " selected" : ""}>${name}</option>`).join("");
      s.onchange = () => setLang(s.value);
      wrap.appendChild(s);
      return wrap;
    }
    function setLang(code) {
      lang = MK4I18N.setLang(code);
      rebuildSurface(); renderTopbar(); renderHint();
      if (!$("wizard").classList.contains("hidden")) buildWizard();
      if ($("startup") && !$("startup").classList.contains("hidden")) buildStartup();
      if ($("assign") && !$("assign").classList.contains("hidden")) buildAssign();
      rebuildOpenSettings();
    }

    // ---- connect lifecycle wizard (cold-start IDLE→CONNECTING→READY) ----
    // wizardStep 0 = box-SELECTION pre-screen; 1-4 = single-box pairing steps; 5 = per-box connect loop (mixed / multi-box).
    let wizardStep = 0;
    let boxMode = null, mixedSel = {};             // screen-0 selection state (this open): "mk4"|"mk6"|"mixed" + per-slot toggles
    let connectQueue = [], connectIdx = 0;         // the ordered connect enumeration, built at pairing start
    const BOX_PREVIEW = { mk4: "/assets/mk6/mk4_preview.png", mk6: "/assets/mk6/mk6_preview.png" };   // box photos (on disk)
    function fmt(str, vals) { return String(str).replace(/\{(\w+)\}/g, (mm, k) => (k in vals ? vals[k] : mm)); }
    function mk6MediaHtml(basename, m6) {
      return `<div class="media mk6media"><img class="mk6img" id="mk6StepImg" src="/assets/mk6/${basename}.gif" alt=""><span class="mk6phlabel">${m6.stepImgPlaceholder || "MK6 box — image coming soon"}</span></div>`;
    }
    // CONNECT ENUMERATION (server semantics: `setup connect protocol=P device=d` activates (P,d) + holds
    // all others neutral (CONNECTING); connects ACCUMULATE; one global `setup ready` flips ALL active to
    // driving). MK4 binds via ONE shared connect at device 0 (slot lives in the nibble telegram, not the
    // device) -> a SINGLE bare `setup connect` covers ALL mk4 slots (identical to today). Each MK6 slot
    // binds its OWN device -> one `setup connect protocol=mk6 device=<slot>` per mk6 slot (this fixes the
    // old "mk6 only ever bound device 0" gap). Order: mk4-shared first, then each mk6 slot ascending.
    // Enumerated over boxSlots() (ASSIGNMENT), so a box on a function-less slot still connects. A "none"
    // slot is excluded by boxSlots. MK4 collapses to ONE shared bare connect (device 0; slot lives in the
    // nibble telegram, hubs button-assigned) — do NOT add per-slot mk4 connects. Each MK6 slot -> its own
    // device connect. Count ("box i of N") + next-connect index both read this SAME filtered queue.
    function buildConnectQueue() {
      const slots = boxSlots(), q = [];
      const anyMk4 = slots.length === 0 || slots.some(s => protoForSlot(s) === "mk4");   // empty (RAW) -> bare mk4 connect (today)
      if (anyMk4) q.push({ kind: "mk4", slot: null, msg: { cmd: "setup", action: "connect" } });   // bare mk4 shared connect
      slots.filter(s => protoForSlot(s) === "mk6").forEach(s => q.push({ kind: "mk6", slot: s, msg: { cmd: "setup", action: "connect", protocol: "mk6", device: s } }));
      return q;
    }
    // Mixed screen-0 shows ALL THREE slots. initMixedSel: an UNUSED slot (no functions) DEFAULTS to "none"
    // (the user isn't forced to decide slots nothing uses); a USED slot keeps its stored pick or stays UNSET
    // (must be picked explicitly — None is a valid pick). derivedMode: the mode implied by stored slotProto
    // for reopen pre-select — any "none" (or a genuine mix) -> "mixed", else the uniform primary.
    function initMixedSel() {
      const sp = getSlotProto(), used = usedSlots(), sel = {};
      ALL_SLOTS.forEach(s => {
        const k = String(s), stored = sp[k];
        if (stored === "mk4" || stored === "mk6" || stored === "none") sel[k] = stored;   // keep an explicit prior pick
        else if (used.indexOf(s) === -1) sel[k] = "none";                                  // UNUSED slot -> default None
        // else: USED slot with no prior pick -> leave unset (gate forces an explicit pick)
      });
      return sel;
    }
    function derivedMode() {
      const sp = getSlotProto();
      if (ALL_SLOTS.some(s => sp[String(s)] === "none")) return "mixed";   // an explicit None -> the user was in mixed
      const protos = [...new Set(boxSlots().map(protoForSlot))];           // protocols of the assigned boxes
      if (!protos.length) return "mk4";                                    // nothing assigned -> default primary
      return protos.length === 1 ? protos[0] : "mixed";
    }
    // REOPEN RULE: FRESH open (IDLE) -> screen 0 (box select); reopen while CONNECTING -> resume the
    // per-box loop if one is in progress (multi-box), else pairing step 3 (skip screen 0 — box already
    // chosen); READY -> step 4. Screen 0 shows ONLY for a fresh connect.
    function openWizard() {
      if (lifecycle === "READY") wizardStep = 4;
      else if (lifecycle === "CONNECTING") wizardStep = (connectQueue.length > 1 && connectIdx < connectQueue.length) ? 5 : 3;
      else {
        wizardStep = 0;
        boxMode = hasChosen() ? derivedMode() : null;   // pre-select from an existing choice so returning users aren't re-gated
        mixedSel = initMixedSel();                      // unused slots -> None; stored picks kept; used-unset stays unset
      }
      buildWizard(); $("wizard").classList.remove("hidden");
    }
    function closeWizard() { wizardStep = 0; $("wizard").classList.add("hidden"); }
    function wizardCancel() { send({ cmd: "setup", action: "reset" }); closeWizard(); }
    function wizardOnLifecycle(state) {
      if ($("wizard").classList.contains("hidden")) return;
      if (state === "READY") { wizardStep = 4; buildWizard(); }
      else if (state === "IDLE" && wizardStep > 1 && wizardStep !== 5) { wizardStep = 1; buildWizard(); }
    }
    function wizardNext() {
      if (wizardStep === 1) {
        connectQueue = buildConnectQueue(); connectIdx = 0;
        if (!connectQueue.length) { send({ cmd: "setup", action: "ready" }); return; }   // all-None (no box to bind) -> straight to ready (READY push -> step 4); no connect
        send(connectQueue[0].msg);                 // first connect (bare mk4, or first mk6 slot)
        wizardStep = (connectQueue.length > 1) ? 5 : 2;   // multi-box -> per-box loop; single -> today's flow
        buildWizard();
      } else if (wizardStep === 2) {
        wizardStep = 3; buildWizard();
      } else if (wizardStep === 5) {               // per-box loop: advance / finish
        connectIdx++;
        if (connectIdx < connectQueue.length) { send(connectQueue[connectIdx].msg); buildWizard(); }
        else send({ cmd: "setup", action: "ready" });   // all boxes bound -> ONE global ready (READY push -> step 4)
      }
    }
    function wizardBack() {
      if (wizardStep === 2) { send({ cmd: "setup", action: "reset" }); wizardStep = 1; }
      else if (wizardStep === 3) wizardStep = 2;
      buildWizard();
    }
    function skipToReady() {   // "toy already connected": enumerate every box's connect (accumulate), then ready
      clearStopLatch();
      if (lifecycle === "READY") { autoReady = false; closeWizard(); closeStartup(); return; }
      autoReady = true;                            // auto-CLOSE the wizard/startup once READY arrives
      buildConnectQueue().forEach(e => send(e.msg));
      send({ cmd: "setup", action: "ready" });
    }
    // ---- SCREEN 0: box selection, rendered on wizardStep 0 (fresh connect) ----
    // Three options: MK4 / MK6 (primary box photos) + a smaller MIXED (MK4 + MK6). MK4/MK6 set EVERY used
    // slot to that protocol; MIXED reveals a per-slot MK4|MK6 toggle per used box. MUST-PICK gate: Next
    // enabled only when every used slot is assigned. The pick persists to slotProto (per-layout). Real box
    // photos on disk at /assets/mk6/mk{4,6}_preview.png; a missing preview onerror-falls-back to the label.
    function boxSelectReady() {
      if (boxMode === "mk4" || boxMode === "mk6") return true;
      // MIXED: every slot (0-2) must be assigned MK4/MK6/None. Unused slots pre-default None (pre-satisfied);
      // a USED slot with no pick blocks Next. None IS a valid pick, so slot0=None + slot1=MK4 + slot2=MK6 proceeds.
      if (boxMode === "mixed") return ALL_SLOTS.every(s => { const v = mixedSel[String(s)]; return v === "mk4" || v === "mk6" || v === "none"; });
      return usedSlots().length === 0;             // nothing to assign (RAW / unmapped) -> nothing to gate
    }
    function commitBoxSelect() {                    // persist the current selection into slotProto (live)
      const sp = getSlotProto();
      if (boxMode === "mixed") ALL_SLOTS.forEach(s => { const v = mixedSel[String(s)]; if (v) sp[String(s)] = v; });   // persist per-slot incl. explicit "none"
      else if (boxMode === "mk4" || boxMode === "mk6") {
        // Single protocol: every USED slot = boxMode, and DELETE non-used slot entries (clear any stale mixed
        // per-slot assignment). NOT set-all: setting a function-less slot to mk6 would make boxSlots() emit a
        // spurious per-slot mk6 connect (mk6 binds per device; mk4 shared-collapses). So single-MK6 on slots 0,1
        // gives exactly two mk6 connects (dev0,dev1), not three.
        const used = usedSlots();
        ALL_SLOTS.forEach(s => { const k = String(s); if (used.indexOf(s) === -1) delete sp[k]; else sp[k] = boxMode; });
        localStorage.setItem(PROTO_KEY, boxMode);
      }
      setSlotProto(sp);
    }
    function buildBoxSelect(t) {
      const m6 = t.mk6 || {};
      const prim = (id, cap) => `<button type="button" class="protobtn boxsel${boxMode === id ? " on" : ""}" data-mode="${id}">
          <span class="boxph"><img class="boxprev" src="${BOX_PREVIEW[id]}" alt=""><span class="boxcap">${cap}</span></span><span class="protolab">${id.toUpperCase()}</span></button>`;
      const mixedBtn = `<button type="button" class="mixbtn${boxMode === "mixed" ? " on" : ""}" data-mode="mixed">${m6.mixedOption || "Mixed (MK4 + MK6)"}</button>`;
      const noneLab = m6.noneLabel || "None";
      const mixHint = (boxMode === "mixed" && m6.mixedHint) ? `<p class="sub mixhint">${m6.mixedHint}</p>` : "";   // shown ONLY for Mixed
      const mixRows = boxMode === "mixed" ? `${mixHint}<div class="mixrows">${ALL_SLOTS.map(s => {
          const cur = mixedSel[String(s)];
          const seg = p => `<button type="button" class="segbtn${cur === p ? " on" : ""}" data-slot="${s}" data-proto="${p}">${p === "none" ? noneLab : p.toUpperCase()}</button>`;
          return `<div class="mixrow"><span class="mixlab">${fmt(m6.boxOnSlot || "Box on slot {n}", { n: s })}</span><span class="seg">${seg("mk4")}${seg("mk6")}${seg("none")}</span></div>`;
        }).join("")}</div>` : "";
      $("wizard").innerHTML = `<div class="backdrop"></div><div class="sheet wiz">
        <h2>${m6.chooseTitle || t.wiz.title}</h2>
        <div class="wsteps">${[1, 2, 3, 4].map(() => `<span class="wdot"></span>`).join("")}</div>
        ${m6.chooseBody ? `<p class="wbody">${m6.chooseBody}</p>` : ""}
        <div class="protopick" id="protoPick"><div class="protorow">${prim("mk4", m6.mk4Box || "MK4 box")}${prim("mk6", m6.mk6Box || "MK6 box")}</div>
          <div class="mixline">${mixedBtn}</div>${mixRows}</div>
        <div class="actions wactions">
          <button id="wCancel">${t.wiz.cancel}</button>
          <button class="apply" id="wPick"${boxSelectReady() ? "" : " disabled"}>${t.wiz.next}</button>
        </div></div>`;
      const on = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
      on("wCancel", wizardCancel);
      on("wPick", () => { if (boxSelectReady()) { commitBoxSelect(); wizardStep = 1; buildWizard(); } });
      $("wizard").querySelectorAll(".protobtn[data-mode], .mixbtn").forEach(b => {
        b.onclick = () => {
          boxMode = b.dataset.mode;
          if (boxMode === "mixed") mixedSel = initMixedSel();   // (re)default: unused slots -> None, stored picks kept, used-unset stays unset
          commitBoxSelect(); buildBoxSelect(t);
        };
      });
      $("wizard").querySelectorAll(".segbtn").forEach(b => {
        b.onclick = () => { mixedSel[b.dataset.slot] = b.dataset.proto; commitBoxSelect(); buildBoxSelect(t); };
      });
      $("wizard").querySelectorAll(".boxprev").forEach(im => { im.onerror = () => im.remove(); });   // missing preview -> label, not a broken image
    }
    // Step 5 — per-box connect loop (mixed / multi-box). Sends the current box's connect on entry/advance
    // and guides the user to physically pair THAT box during ITS connect window (each box binds only while
    // its own connect broadcasts). Next advances; on the last box it sends the one global ready.
    function buildBoxConnect(t) {
      const m6 = t.mk6 || {}, ce = connectQueue[connectIdx] || connectQueue[0] || { kind: "mk4", slot: null };
      const n = connectQueue.length, i = connectIdx + 1, last = connectIdx >= n - 1, isMk6 = ce.kind === "mk6";
      const title = fmt(m6.pairBoxTitle || "Pair box {i} of {n}", { i, n });
      const body = isMk6 ? fmt(m6.pairBoxMk6 || "Put the MK6 box for slot {slot} into pairing mode — it binds (single fast flash).", { slot: ce.slot })
                         : (m6.pairBoxMk4 || "Broadcasting the shared MK4 connect — power on your MK4 box(es); set each to its slot by its button.");
      const media = isMk6 ? mk6MediaHtml("step_1_mk6_ready_to_connect", m6) : `<div class="media"><img src="/assets/short_flash.gif" alt=""></div>`;
      const wizTitle = (config.wizardText && config.wizardText(t).wizTitle) || t.wiz.title;
      $("wizard").innerHTML = `<div class="backdrop"></div><div class="sheet wiz">
        <h2>${wizTitle}</h2>
        <div class="wsteps">${connectQueue.map((_, k) => `<span class="wdot${k === connectIdx ? " on" : k < connectIdx ? " done" : ""}"></span>`).join("")}</div>
        ${media}<h3 class="wt">${title}</h3><p class="wbody">${body}</p>
        <div class="actions wactions"><button id="wCancel">${t.wiz.cancel}</button><button class="apply" id="wNext">${last ? t.wiz.readyBtn : (m6.pairNext || t.wiz.next)}</button></div></div>`;
      const on = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
      on("wCancel", wizardCancel); on("wNext", wizardNext);
      const mimg = $("mk6StepImg"); if (mimg) mimg.onerror = () => mimg.remove();
    }
    function buildWizard() {
      const t = tr(), s = wizardStep;
      if (s === 0) return buildBoxSelect(t);        // screen 0 = box selection (pre-pairing; fresh connect only)
      if (s === 5) return buildBoxConnect(t);       // per-box connect loop (mixed / multi-box)
      const m6 = t.mk6 || {}, isMk6 = allUsedProto() === "mk6";   // single-box path: mk6 media/copy when all used slots are mk6
      const w = (s === 1 && isMk6) ? { t: m6.mk6Step1T || t.wiz.w1.t, b: m6.mk6Step1B || t.wiz.w1.b } : t.wiz["w" + s];
      let btns;
      if (s === 1) btns = `<button id="wCancel">${t.wiz.cancel}</button><button id="wAlready">${t.wiz.already}</button><button class="apply" id="wNext">${t.wiz.next}</button>`;
      else if (s === 2) btns = `<button id="wCancel">${t.wiz.cancel}</button><button id="wBack">${t.wiz.back}</button><button class="apply" id="wNext">${t.wiz.next}</button>`;
      else if (s === 3) btns = `<button id="wCancel">${t.wiz.cancel}</button><button id="wBack">${t.wiz.back}</button><button class="apply" id="wReady">${t.wiz.readyBtn}</button>`;
      else btns = `<button class="apply" id="wDone">${t.wiz.startDriving}</button>`;
      // Step media is IMAGE-ONLY divergence: MK4 keeps today's per-step flash gifs; MK6 shows its OWN
      // per-step pairing gif from a MAP. onerror removes the <img>, revealing the labeled placeholder —
      // 404 -> the label, NEVER the MK4 gif. Step 4 has no media (both maps undefined).
      const gif = { 1: "long_flash", 2: "short_flash", 3: "double_short_flash" }[s];
      const mk6gif = { 1: "step_1_mk6_ready_to_connect", 2: "step_2_mk6_short_flash", 3: "step_3_mk6_double_short_flash" }[s];
      const media = (isMk6 && mk6gif) ? mk6MediaHtml(mk6gif, m6) : (gif ? `<div class="media"><img src="/assets/${gif}.gif" alt=""></div>` : "");
      const wt = config.wizardText ? config.wizardText(t) : null;
      const wizTitle = (wt && wt.wizTitle) || t.wiz.title;
      $("wizard").innerHTML = `<div class="backdrop"></div><div class="sheet wiz">
        <h2>${wizTitle}</h2>
        <div class="wsteps">${[1, 2, 3, 4].map(n => `<span class="wdot${n === s ? " on" : n < s ? " done" : ""}"></span>`).join("")}</div>
        ${media}<h3 class="wt">${w.t}</h3><p class="wbody">${w.b}</p>
        ${s === 3 && config.zeroBoxHint ? '<p class="gx-zero">' + config.zeroBoxHint(t) + "</p>" : ""}
        <div class="actions wactions">${btns}</div></div>`;
      const on = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
      on("wCancel", wizardCancel); on("wBack", wizardBack); on("wNext", wizardNext);
      on("wReady", () => send({ cmd: "setup", action: "ready" })); on("wAlready", skipToReady); on("wDone", closeWizard);
      const mimg = $("mk6StepImg"); if (mimg) mimg.onerror = () => mimg.remove();   // MK6 step 1/2/3: 404 -> reveal labeled placeholder (never the MK4 gif)
    }

    // ---- startup overlay: reach the API, then connect the toy (skippable) ----
    let startupStep = 1;
    function openStartup() { if (!$("startup")) return; startupStep = (wsStatus === "connected") ? 2 : 1; buildStartup(); $("startup").classList.remove("hidden"); }
    function closeStartup() { if ($("startup")) $("startup").classList.add("hidden"); }
    function startupOnUpdate() {
      if (!$("startup") || $("startup").classList.contains("hidden")) return;
      if (lifecycle === "READY") { closeStartup(); return; }
      if (startupStep === 1 && wsStatus === "connected") startupStep = 2;
      buildStartup();
    }
    function buildStartup() {
      if (!$("startup")) return;
      const t = tr(), s = startupStep, apiOk = wsStatus === "connected";
      // device-neutral overrides for generic layouts (config.wizardText); excavator passes none -> its own su.*
      const wt = config.wizardText ? config.wizardText(t) : null;
      const su = wt ? Object.assign({}, t.su, wt) : t.su;
      const dots = `<div class="wsteps">
          <span class="wdot ${s === 1 ? "on" : "done"}"></span>
          <span class="wdot ${s === 2 ? "on" : ""}"></span></div>`;
      let body;
      if (s === 1) {
        body = `<h3 class="wt">${su.s1t}</h3><p class="wbody">${su.s1b}</p>
          <div class="eprow" id="suEpRow"></div>
          <div class="actions wactions">
            <button id="suSkip">${su.skip}</button>
            <button class="apply" id="suNext"${apiOk ? "" : " disabled"}>${su.next}</button>
          </div>`;
      } else {
        body = `<h3 class="wt">${su.s2t}</h3><p class="wbody">${su.s2b}</p>
          <div class="actions wactions">
            <button id="suSkip">${su.skip}</button>
            <button id="suBack">${t.wiz.back}</button>
            <button id="suAlready">${t.wiz.already}</button>
            <button class="apply" id="suConnect">${config.connectLabel ? config.connectLabel(t) : t.connect}</button>
          </div>`;
      }
      $("startup").innerHTML = `<div class="backdrop"></div><div class="sheet wiz su">
         <h2>${su.title}</h2>${dots}${body}</div>`;
      $("startup").querySelector(".backdrop").onclick = closeStartup;
      const set = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
      set("suSkip", closeStartup);
      set("suNext", () => { if (wsStatus === "connected") { startupStep = 2; buildStartup(); } });
      set("suBack", () => { startupStep = 1; buildStartup(); });
      set("suAlready", skipToReady);
      set("suConnect", () => { closeStartup(); openWizard(); });
      if (s === 1) { MK4.buildEndpointRow($("suEpRow"), reconnectWS); MK4.setStatus(wsStatus); }
    }

    // ---- auto-assign wizard (only if config.autoAssign): profile + motor count + inline editor ----
    const AA = config.autoAssign || {};
    let assignStep = "source", pendingStartup = false;
    let assignProfile = (AA.profiles && AA.profiles[0] && AA.profiles[0].id) || "custom";
    let assignN = AA.defaultN || 2;
    let assignRows = {};   // { motor: {slot, channel, invert} } — the (editable) in-progress assignment
    function recomputeRows() { assignRows = AA.compute ? AA.compute(assignProfile, assignN) : {}; }
    function openAssign() {
      if (!$("assign")) return;
      assignStep = "source"; assignProfile = (AA.profiles && AA.profiles[0] && AA.profiles[0].id) || "custom"; assignN = AA.defaultN || 2;
      recomputeRows(); buildAssign(); $("assign").classList.remove("hidden");
    }
    function closeAssign() {
      if ($("assign")) $("assign").classList.add("hidden");
      if (pendingStartup) { pendingStartup = false; if (lifecycle !== "READY") openStartup(); }   // first-run: map -> THEN the connect guide
    }
    // out = { motor: {slot, channel, invert} }. Sets slot/channel AND invert; unlisted motors -> unmapped.
    function applyAssignment(out) {
      const m = activeMap ? JSON.parse(JSON.stringify(activeMap)) : withDefaults(defaultMap || { functions: {} });
      for (const fn of FN) {
        const a = m.functions[fn], o = out[fn];
        if (o) { a.slot = o.slot; a.channel = o.channel; if (typeof o.invert === "boolean") a.invert = o.invert; }
        else { a.slot = null; a.channel = null; }
      }
      activeMap = withDefaults(m); saveActive(); rebuildSurface();
    }
    function buildAssign() {
      if (!$("assign")) return;
      const t = tr(); let body;
      if (assignStep === "source") {
        body = `<h2>${t.gen.setupTitle}</h2><p class="wbody">${t.gen.setupIntro}</p>
          <div class="actions wactions" style="flex-direction:column;align-items:stretch">
            <button class="apply" id="agAuto">${t.gen.autoAssign}</button>
            <button id="agKnown" disabled title="${t.gen.soon}">${t.gen.loadKnown}</button>
            <button id="agCancel">${t.wiz.cancel}</button></div>`;
      } else {
        const profs = AA.profiles || [];
        const cur = profs.find(x => x.id === assignProfile) || profs[0];
        const profSel = `<select id="agProfile">${profs.map(x => `<option value="${x.id}"${x.id === assignProfile ? " selected" : ""}>${x.label ? x.label(t) : x.id}</option>`).join("")}</select>`;
        const zero = (cur && cur.zeroBox) ? `<p class="gx-zero">⚠ ${t.gen.zeroBox}</p>` : "";
        const rows = Object.keys(assignRows).map(m => {
          const a = assignRows[m];
          const slots = [0, 1, 2].map(n => `<option value="${n}"${a.slot === n ? " selected" : ""}>${n}</option>`).join("");
          const chans = [0, 1, 2, 3].map(n => `<option value="${n}"${a.channel === n ? " selected" : ""}>${n}</option>`).join("");   // auto-assign is protocol-blind (4-per-slot); protocol comes from slotProto
          return `<tr data-m="${m}"><td class="fn">${esc(AA.motorLabel ? AA.motorLabel(m) : m)}</td>
            <td><select class="ar-slot">${slots}</select></td><td><select class="ar-ch">${chans}</select></td>
            <td style="text-align:center"><input type="checkbox" class="ar-inv"${a.invert ? " checked" : ""}></td></tr>`;
        }).join("");
        body = `<h2>${t.gen.setupTitle}</h2>
          <div class="srow"><label>${t.gen.profile} ${profSel}</label>
            <label>${t.gen.motors}
              <span class="stepper" role="group" aria-label="${t.gen.motors}">
                <button type="button" class="stepbtn" id="agNdn" aria-label="−"${assignN <= 1 ? " disabled" : ""}>−</button>
                <span class="stepval" id="agNval">${assignN}</span>
                <button type="button" class="stepbtn" id="agNup" aria-label="+"${assignN >= 12 ? " disabled" : ""}>+</button>
              </span></label></div>
          ${zero}
          <table class="map"><thead><tr><th></th><th>${t.slot}</th><th>${t.ch}</th><th>${t.invert}</th></tr></thead><tbody>${rows}</tbody></table>
          <div class="actions wactions"><button id="agBack">${t.wiz.back}</button><button class="apply" id="agAssign">${t.gen.assign}</button></div>`;
      }
      $("assign").innerHTML = `<div class="backdrop"></div><div class="sheet">${body}</div>`;
      $("assign").querySelector(".backdrop").onclick = closeAssign;   // dismissable: unmapped is safe (no motion)
      const on = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };
      on("agAuto", () => { assignStep = "setup"; recomputeRows(); buildAssign(); });
      on("agCancel", closeAssign); on("agBack", () => { assignStep = "source"; buildAssign(); });
      on("agAssign", () => { applyAssignment(assignRows); closeAssign(); });
      const ps = $("agProfile"); if (ps) ps.onchange = () => { assignProfile = ps.value; recomputeRows(); buildAssign(); };   // changing profile RESETS rows
      const setN = (v) => { assignN = clamp(v, 1, 12); recomputeRows(); buildAssign(); };   // stepper: clamp 1..12, no free-text (changing N RESETS rows)
      on("agNdn", () => setN(assignN - 1)); on("agNup", () => setN(assignN + 1));
      $("assign").querySelectorAll("tr[data-m]").forEach(trEl => {   // inline edits tweak only that motor (no rebuild)
        const m = trEl.dataset.m;
        trEl.querySelector(".ar-slot").onchange = e => { assignRows[m].slot = +e.target.value; };
        trEl.querySelector(".ar-ch").onchange = e => { assignRows[m].channel = +e.target.value; };
        trEl.querySelector(".ar-inv").onchange = e => { assignRows[m].invert = e.target.checked; };
      });
    }

    // ====== TABBED settings overlay ======
    let editMap = null, settingsTab = "channels", lastInfo = null;
    function openSettings() { editMap = mapForEdit(); buildSettings(); $("settings").classList.remove("hidden"); }
    function closeAll() { releaseSettingsTests(); $("settings").classList.add("hidden"); }
    function swapAdj(slot) { return (deviceSwap && (slot === 0 || slot === 1)) ? 1 - slot : slot; }
    function rebuildOpenSettings() { if (!$("settings").classList.contains("hidden")) buildSettings(); }
    function showTab(name) { settingsTab = name; releaseSettingsTests(); buildSettings(); }
    function buildSettings() {
      if (!editMap) editMap = mapForEdit();
      const t = tr();
      const TABS = [["connection", t.tabConnection]];
      if (features.channels !== false) TABS.push(["channels", t.tabChannels]);   // gated: a layout with FN=[] (e.g. RAW) can omit the empty editor
      if (features.labelsTab) TABS.push(["labels", t.tabLabels]);
      if (features.gamepad) TABS.push(["gamepad", t.tabGamepad]);
      TABS.push(["info", t.tabServerInfo]);
      if (TABS.every(x => x[0] !== settingsTab)) settingsTab = TABS[0][0];   // fall back to the first available tab
      const bar = TABS.map(([id, lbl]) => `<button class="stab${settingsTab === id ? " on" : ""}" data-tab="${id}">${lbl}</button>`).join("");
      const panel = settingsTab === "connection" ? connectionPanel(t)
                  : settingsTab === "labels" ? labelsPanel(t)
                  : settingsTab === "gamepad" ? gamepadPanel(t)
                  : settingsTab === "info" ? infoPanel(t)
                  : channelsPanel(t);
      $("settings").innerHTML =
        `<div class="backdrop"></div><div class="sheet">
           <button class="sheetx" id="settingsX" type="button" aria-label="${t.close}" title="${t.close}">✕</button>
           <div class="stabs">${bar}</div>
           <div class="spanel"><div class="spanelinner">${panel}</div></div>
         </div>`;
      $("settings").querySelector(".backdrop").onclick = discardEdits;
      $("settingsX").onclick = discardEdits;
      $("settings").querySelectorAll(".stab").forEach(b => { b.onclick = () => showTab(b.dataset.tab); });
      ({ connection: wireConnection, channels: wireChannels, labels: wireLabels, gamepad: wireGamepad, info: wireInfo }[settingsTab])();
    }

    // ---- Connection tab: endpoint editor (custom title moved to the Labels tab) ----
    function connectionPanel(t) {
      return `<h2>${t.tabConnection}</h2>
        <p class="sub">${t.connSub}</p><div class="eprow" id="epRow"></div>`;
    }
    function wireConnection() {
      MK4.buildEndpointRow($("epRow"), reconnectWS);
      MK4.setStatus(wsStatus);
    }

    // ---- Channels tab: assignment table (+ device-swap gated) + actions + auto-assign entry ----
    function channelsPanel(t) {
      const noneLab = (t.mk6 && t.mk6.noneLabel) || "None";
      const rows = FN.map(fn => {
        const a = editMap.functions[fn];
        const opt = (n, sel) => `<option value="${n}"${n === sel ? " selected" : ""}>${n}</option>`;
        const blank = sel => `<option value=""${sel == null ? " selected" : ""}>—</option>`;
        const proto = protoForSlot(a.slot);   // per-slot: mk6 box -> 0-5, mk4 box -> 0-3
        const slots = blank(a.slot) + [0, 1, 2].map(n => opt(n, a.slot)).join("");
        const chans = blank(a.channel) + chanRangeFor(proto).map(n => opt(n, a.channel)).join("");
        // EDITABLE per-slot protocol (None / MK4 / MK6): edits slotProto for THIS SLOT (live), same source
        // as screen-0. Gated on a.slot != null (an unmapped function has no slot -> no dropdown, like the old badge).
        const popt = (v, lbl) => `<option value="${v}"${v === proto ? " selected" : ""}>${lbl}</option>`;
        const protoSel = a.slot == null ? "" : ` <select class="e-proto" title="${t.slot} ${a.slot}">${popt("none", noneLab)}${popt("mk4", "MK4")}${popt("mk6", "MK6")}</select>`;
        return `<tr data-fn="${fn}">
          <td class="fn">${esc(funcLabel(fn))}<br><span class="muted">${fn}</span></td>
          <td><select class="e-slot">${slots}</select>${protoSel}</td>
          <td><select class="e-ch">${chans}</select></td>
          <td><input type="number" class="e-maxf" min="1" max="7" value="${a.max_fwd || 5}"></td>
          <td><input type="number" class="e-maxr" min="1" max="7" value="${a.max_rev || 5}"></td>
          <td><input type="number" class="e-rev" min="0.25" max="4" step="0.05" value="${a.reverse_scale ?? 1}"></td>
          <td style="text-align:center"><input type="checkbox" class="e-inv"${a.invert ? " checked" : ""}></td>
          <td><button class="test" data-fn="${fn}">${t.test}</button></td>
        </tr>`;
      }).join("");
      const swap = features.deviceSwap ? `<div class="srow">
          <label><input type="checkbox" id="swapChk"${deviceSwap ? " checked" : ""}> ${t.deviceSwap}</label>
          <span class="muted">${lifecycle !== "READY" ? "· " + t.readyOnly : ""}</span>
        </div>` : "";
      const rerun = config.autoAssign ? `<button id="rerunBtn">${t.gen.rerun}</button>` : "";
      return `<h2>${t.assign}</h2><p class="sub">${t.assignSub}</p>
        ${swap}
        <table class="map"><thead><tr>
          <th>${t.fn}</th><th>${t.slot}</th><th>${t.ch}</th><th>${t.maxFwd}</th><th>${t.maxRev}</th><th>${t.revtrim}</th><th>${t.invert}</th><th></th>
        </tr></thead><tbody>${rows}</tbody></table>
        <p class="sub maxnote">${t.maxRevNote}</p>
        <div class="actions">
          <button class="apply" id="saveBtn">${t.saveClose}</button>
          <button id="discardBtn">${t.discard}</button>
          <button class="promote" id="promoteBtn">${t.promote}</button>
          <button id="resetMapBtn">${t.resetMap}</button>
          ${rerun}
          <span id="mapMsg"></span>
        </div>`;
    }
    function wireChannels() {
      $("settings").querySelectorAll("tr[data-fn]").forEach(trEl => {
        const fn = trEl.dataset.fn, a = editMap.functions[fn];
        trEl.querySelector(".e-slot").onchange = e => assignCell(fn, e.target.value === "" ? null : +e.target.value, a.channel);
        trEl.querySelector(".e-ch").onchange = e => assignCell(fn, a.slot, e.target.value === "" ? null : +e.target.value);
        trEl.querySelector(".e-maxf").onchange = e => { a.max_fwd = clamp(+e.target.value | 0, 1, 7); e.target.value = a.max_fwd; };
        trEl.querySelector(".e-maxr").onchange = e => { a.max_rev = clamp(+e.target.value | 0, 1, 7); e.target.value = a.max_rev; };
        trEl.querySelector(".e-rev").onchange = e => { a.reverse_scale = clamp(+e.target.value || 1, 0.25, 4); e.target.value = a.reverse_scale; };
        trEl.querySelector(".e-inv").onchange = e => { a.invert = e.target.checked; };
        const pSel = trEl.querySelector(".e-proto"); if (pSel) pSel.onchange = e => setSlotProtoEditor(a.slot, e.target.value);
        bindTest(trEl.querySelector(".test"), fn);
      });
      const sw = $("swapChk");
      if (sw) sw.onchange = e => {
        deviceSwap = e.target.checked;
        localStorage.setItem("mk4_device_swap", deviceSwap ? "1" : "0");
        neutralizeAll(); send({ cmd: "stop" });
        if (config.refresh) config.refresh(api);
      };
      $("saveBtn").onclick = saveClose;
      $("discardBtn").onclick = discardEdits;
      $("promoteBtn").onclick = promoteMap;
      $("resetMapBtn").onclick = () => { editMap = JSON.parse(JSON.stringify(defaultMap || placeholderMap())); buildSettings(); };
      const rr = $("rerunBtn"); if (rr) rr.onclick = () => { closeAll(); openAssign(); };
    }

    // ---- Labels tab (gated) ----
    function labelsPanel(t) {
      const cards = FN.map(fn => {
        const a = editMap.functions[fn];
        const lb = a.labels || {};
        const fields = LANGS.map(([code]) =>
          `<label class="lblf"><span class="lc">${code.toUpperCase()}</span>` +
          `<input type="text" class="e-lab" data-lang="${code}" value="${(lb[code] || "").replace(/"/g, "&quot;")}"></label>`).join("");
        return `<div class="lblcard" data-fn="${fn}">
          <div class="lblfn">${esc(funcLabel(fn))} <span class="muted">${fn}</span></div>
          <div class="lblgrid">${fields}</div></div>`;
      }).join("");
      return `<h2>${t.labelsTitle}</h2><p class="sub">${t.labelsSub}</p>
        <div class="eprow" style="margin-bottom:1rem">
          <label class="eplabel" for="titleInput">${t.titleLabel}</label>
          <input type="text" id="titleInput" maxlength="40" spellcheck="false" placeholder="${esc(LAYOUT_TITLE_DEFAULT)}">
          <label class="titleshow"><input type="checkbox" id="titleShow"> ${t.titleShow}</label>
          <label class="titlecol">${t.titleColor} <input type="color" id="titleColor"></label>
        </div>
        <div class="lblcards">${cards}</div>
        <div class="actions">
          <button class="apply" id="lblSaveBtn">${t.saveClose}</button>
          <button id="lblDiscardBtn">${t.discard}</button>
        </div>`;
    }
    function wireLabels() {
      const ti = $("titleInput");
      if (ti) { ti.value = localStorage.getItem("mk4_title_" + LAYOUT_ID) || ""; ti.oninput = () => setTitle(ti.value); }
      const ts = $("titleShow");
      if (ts) { ts.checked = titleVisible(); ts.onchange = () => setTitleVisible(ts.checked); }
      const tc = $("titleColor");
      if (tc) { tc.value = titleColor(); tc.oninput = () => setTitleColor(tc.value); }
      $("settings").querySelectorAll(".lblcard").forEach(card => {
        const a = editMap.functions[card.dataset.fn];
        if (!a.labels || typeof a.labels !== "object") a.labels = {};
        card.querySelectorAll(".e-lab").forEach(inp => { inp.oninput = e => { a.labels[e.target.dataset.lang] = e.target.value; }; });
      });
      $("lblSaveBtn").onclick = saveClose;
      $("lblDiscardBtn").onclick = discardEdits;
    }

    // ---- Server info tab ----
    function infoPanel(t) { return `<h2>${t.tabServerInfo}</h2><p class="sub">${t.infoSub}</p><div class="infobox" id="infoBox"></div>`; }
    function wireInfo() { requestInfo(); }
    function requestInfo() {
      const box = $("infoBox"); if (!box) return;
      if (!ws || ws.readyState !== 1) {
        lastInfo = null;
        box.innerHTML = `<div class="ihead"><button id="infoRefresh" class="mini" title="refresh">↻</button></div>` +
                        `<div class="kv"><span class="muted">${tr().infoConnectFirst}</span></div>`;
        const rb = $("infoRefresh"); if (rb) rb.onclick = requestInfo;
        return;
      }
      box.innerHTML = `<div class="kv"><span class="muted">${tr().infoFetching}</span></div>`;
      send({ cmd: "info" });
    }
    function onInfo(m) {
      lastInfo = m;
      const box = $("infoBox"); if (!box) return;
      const ORDER = ["app", "version", "info_level", "lifecycle", "radio_backend", "dry_run",
                     "hci", "ws_port", "http_port", "serve_client", "adapter_mac", "hostname",
                     "bluetoothd", "host_bind", "paths"];
      const fmtVal = v => {
        if (v === null || v === undefined) return "<span class='muted'>—</span>";
        if (Array.isArray(v)) return v.map(esc).join(", ");
        if (typeof v === "object") return Object.entries(v).map(([k, val]) => `${esc(k)}: ${esc(val)}`).join("<br>");
        if (typeof v === "boolean") return v ? tr().infoYes : tr().infoNo;
        return esc(v);
      };
      const keys = Object.keys(m).filter(k => k !== "type")
        .sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
      const tier = m.info_level ? ` <span class="tag ph">${tr().infoTier}: ${esc(m.info_level)}</span>` : "";
      const rows = keys.map(k => `<div class="kv"><span class="k">${esc(k)}</span><span class="v">${fmtVal(m[k])}</span></div>`).join("");
      box.innerHTML = `<div class="ihead">${tier}<button id="infoRefresh" class="mini" title="refresh">↻</button></div>${rows}`;
      const rb = $("infoRefresh"); if (rb) rb.onclick = requestInfo;
    }

    // ---- TEST pulse / commit / discard / promote ----
    function bindTest(tb, fn) {
      tb.disabled = lifecycle !== "READY";
      const start = e => {
        e.preventDefault(); if (lifecycle !== "READY") return;
        const a = editMap.functions[fn]; if (a.slot == null || a.channel == null) return;
        if (protoForSlot(swapAdj(a.slot)) === "none") return;   // None slot -> test sends nothing
        tb.classList.add("held");
        send(stampProto({ cmd: "set", slot: swapAdj(a.slot), channel: a.channel, value: a.max_fwd || 5 }));
      };
      const stop = () => {
        if (!tb.classList.contains("held")) return;
        const a = editMap.functions[fn]; tb.classList.remove("held");
        if (a.slot != null && a.channel != null && protoForSlot(swapAdj(a.slot)) !== "none") send(stampProto({ cmd: "set", slot: swapAdj(a.slot), channel: a.channel, value: 0 }));
      };
      tb.addEventListener("pointerdown", start);
      tb.addEventListener("pointerup", stop);
      tb.addEventListener("pointerleave", stop);
      tb.addEventListener("pointercancel", stop);
    }
    function releaseSettingsTests() {
      document.querySelectorAll(".test.held").forEach(tb => { tb.classList.remove("held"); send({ cmd: "stop" }); });
    }
    function assignCell(fn, slot, channel) {
      if (slot != null && channel != null) {   // clamp channel into the (new) slot's protocol range (mk6 0-5 / mk4 0-3)
        const mx = maxChannelFor(protoForSlot(slot));
        if (channel > mx) channel = mx;
      }
      if (slot != null && channel != null) {
        const other = FN.find(f => f !== fn && editMap.functions[f].slot === slot && editMap.functions[f].channel === channel);
        if (other) { editMap.functions[other].slot = editMap.functions[fn].slot; editMap.functions[other].channel = editMap.functions[fn].channel; }
      }
      editMap.functions[fn].slot = slot;
      editMap.functions[fn].channel = channel;
      buildSettings();
    }
    // Channels-tab per-slot protocol edit: LIVE-write slotProto for THIS SLOT (single source shared with
    // screen-0), then re-render so EVERY same-slot row shows the new protocol + updated channel range.
    // Narrowing (mk6 -> mk4/none) clamps channel 4/5 -> 3 for ALL functions on the slot (reusing the
    // assignCell clamp logic) in BOTH the staged editMap AND the live activeMap (+ persist), so live
    // driving stays in range and a reload never rejects the saved map against the live slotProto.
    function setSlotProtoEditor(slot, proto) {
      if (slot == null || !(proto === "mk4" || proto === "mk6" || proto === "none")) return;
      const sp = getSlotProto(); sp[String(slot)] = proto; setSlotProto(sp);
      const mx = maxChannelFor(protoForSlot(slot));
      const clampMap = m => { if (m && m.functions) FN.forEach(f => { const a = m.functions[f]; if (a && a.slot != null && (a.slot | 0) === (slot | 0) && a.channel != null && a.channel > mx) a.channel = mx; }); };
      clampMap(editMap); clampMap(activeMap);
      if (activeMap) saveActive();
      buildSettings();
    }
    function okMsg(text) { const m = $("mapMsg"); if (m) { m.className = "ok"; m.textContent = text; } }
    function flashMsg(text) { const m = $("mapMsg"); if (m) { m.className = "bad"; m.textContent = text; } }
    function saveClose() {
      if (!validMap(editMap)) { flashMsg("invalid map (duplicate slot/channel)"); return; }
      activeMap = withDefaults(editMap); saveActive(); rebuildSurface();
      closeAll();
    }
    function discardEdits() { editMap = null; closeAll(); }
    function promoteMap() {
      if (!validMap(editMap)) { flashMsg("invalid map (duplicate slot/channel)"); return; }
      activeMap = withDefaults(editMap); saveActive(); rebuildSurface();
      okMsg(tr().promoted);
    }

    // ====== GAMEPAD (only if features.gamepad) ======
    const PAD_LS_MAP = "mk4_pad_map", PAD_LS_EN = "mk4_pad_enabled";
    const PAD_DEADZONE = 0.18;
    const PAD_DEFAULT = config.gamepadDefault || {};
    let padIndex = null;
    let padEnabled = (localStorage.getItem(PAD_LS_EN) || "true") !== "false";
    let padMap = loadPadMap();
    const padOwns = {};
    let padSuppressed = false, padLastId = null;
    function normalizePadMap(m) {
      const out = {};
      for (const fn of FN) {
        const s = m && m[fn];
        out[fn] = (s && (s.type === "axis" || s.type === "buttons")) ? s
                : JSON.parse(JSON.stringify(PAD_DEFAULT[fn] || { type: "buttons", neg: null, pos: null }));
      }
      return out;
    }
    function loadPadMap() {
      try { const m = JSON.parse(localStorage.getItem(PAD_LS_MAP) || "null"); if (m && typeof m === "object") return normalizePadMap(m); } catch {}
      return normalizePadMap(JSON.parse(JSON.stringify(PAD_DEFAULT)));
    }
    function savePadMap() { localStorage.setItem(PAD_LS_MAP, JSON.stringify(padMap)); }
    function activePad() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const ok = p => !!p && p.connected !== false;
      if (padIndex != null && ok(pads[padIndex])) return pads[padIndex];
      for (let i = 0; i < pads.length; i++) if (ok(pads[i])) { padIndex = i; return pads[i]; }
      padIndex = null; return null;
    }
    function padBtnObj(gp, i) { if (i == null) return null; return gp.buttons[i] || null; }
    function padPressed(gp, i) { const b = padBtnObj(gp, i); return !!b && (b.pressed || b.value > 0.5); }
    function padAxisDeflection(gp, idx, invert) {
      let a = (typeof gp.axes[idx] === "number") ? gp.axes[idx] : 0;
      if (invert) a = -a;
      const m = Math.abs(a);
      if (m < PAD_DEADZONE) return 0;
      return Math.sign(a) * ((m - PAD_DEADZONE) / (1 - PAD_DEADZONE));
    }
    function padFnValue(gp, fn) {
      const s = padMap[fn]; if (!s) return 0;
      if (s.type === "axis") return scaleVal(fn, clamp(padAxisDeflection(gp, s.axis, s.invert), -1, 1));
      const pos = padPressed(gp, s.pos), neg = padPressed(gp, s.neg);
      return pos && !neg ? scaleVal(fn, 1) : neg && !pos ? scaleVal(fn, -1) : 0;
    }
    function padAssert(fn, v) {
      if (v !== 0) { padOwns[fn] = true; driveFn(fn, v); }
      else if (padOwns[fn]) { padOwns[fn] = false; driveFn(fn, 0); }
    }
    function padReleaseOwned() { for (const fn in padOwns) if (padOwns[fn]) { padOwns[fn] = false; driveFn(fn, 0); } }
    function padReadsCenter(gp) { for (const fn of FN) if (padFnValue(gp, fn) !== 0) return false; return true; }
    function gamepadTick() {
      const gp = activePad();
      if (gp && !$("settings").classList.contains("hidden") && settingsTab === "gamepad") updatePadReadout(gp);
      if (!gp) { padReleaseOwned(); padSuppressed = true; padLastId = null; return; }
      const id = (gp.id || "pad") + "#" + gp.index;
      if (padLastId !== null && id !== padLastId) { padReleaseOwned(); padSuppressed = true; }
      padLastId = id;
      if (!padEnabled || lifecycle !== "READY") { padReleaseOwned(); return; }
      if (padSuppressed) {
        if (padReadsCenter(gp)) padSuppressed = false;
        else { padReleaseOwned(); return; }
      }
      for (const fn of FN) padAssert(fn, padFnValue(gp, fn));
    }
    function gamepadLoop() { requestAnimationFrame(gamepadLoop); gamepadTick(); }
    function setPadEnabled(on) {
      padEnabled = on; localStorage.setItem(PAD_LS_EN, on ? "true" : "false");
      if (!on) padReleaseOwned();
      else clearStopLatch();
      renderTopbar(); rebuildOpenSettings();
    }
    function padChip() {
      const b = tbtn("🎮", padEnabled ? "padchip padon" : "padchip padoff", () => setPadEnabled(!padEnabled));
      b.title = padEnabled ? tr().padOnTitle : tr().padOffTitle;
      return b;
    }
    function padCounts() { const gp = activePad(); return { axes: gp ? gp.axes.length : 4, btns: gp ? gp.buttons.length : 18 }; }
    function padRowHtml(t, fn) {
      const s = padMap[fn], { axes, btns } = padCounts();
      const typeSel = `<select class="pad-type" data-fn="${fn}">
          <option value="axis"${s.type === "axis" ? " selected" : ""}>${t.padAxis}</option>
          <option value="buttons"${s.type === "buttons" ? " selected" : ""}>${t.padButtons}</option></select>`;
      let detail = "", inv = "";
      if (s.type === "axis") {
        const opts = Array.from({ length: axes }, (_, i) => `<option value="${i}"${i === s.axis ? " selected" : ""}>${t.padAxis} ${i}</option>`).join("");
        detail = `<select class="pad-axis" data-fn="${fn}">${opts}</select>`;
        inv = `<input type="checkbox" class="pad-inv" data-fn="${fn}"${s.invert ? " checked" : ""}>`;
      } else {
        const bopt = sel => `<option value="">${t.padNone}</option>` +
          Array.from({ length: btns }, (_, i) => `<option value="${i}"${i === sel ? " selected" : ""}>${t.padBtn} ${i}</option>`).join("");
        detail = `<span class="padbtns">${t.padNeg}<select class="pad-neg" data-fn="${fn}">${bopt(s.neg)}</select>` +
                 ` ${t.padPos}<select class="pad-pos" data-fn="${fn}">${bopt(s.pos)}</select></span>`;
      }
      return `<tr data-fn="${fn}">
        <td class="fn">${esc(funcLabel(fn))}<br><span class="muted">${fn}</span></td>
        <td>${typeSel} ${detail}</td>
        <td style="text-align:center">${inv}</td>
        <td class="padlive" data-fn="${fn}">0</td></tr>`;
    }
    function gamepadPanel(t) {
      const gp = activePad();
      const rows = FN.map(fn => padRowHtml(t, fn)).join("");
      return `<h2>${t.tabGamepad}</h2><p class="sub">${t.padSub}</p>
        <div class="srow">
          <label><input type="checkbox" id="padEnable"${padEnabled ? " checked" : ""}> ${t.padEnable}</label>
          <span class="muted">${lifecycle !== "READY" ? "· " + t.readyOnly : ""}</span>
        </div>
        <div class="padstat ${gp ? "ok" : ""}">${gp ? "🎮 " + esc(gp.id || "controller") : t.padNoController}</div>
        <div class="padro" id="padReadout"></div>
        <h3 class="padh">${t.padAssign}</h3>
        <table class="map padmap"><thead><tr><th>${t.fn}</th><th>${t.padSource}</th><th>${t.padInvert}</th><th>${t.padLive}</th></tr></thead>
          <tbody>${rows}</tbody></table>
        <div class="actions">
          <button id="padReset">${t.padResetDefaults}</button>
          <span class="muted">${t.padAutosave}</span>
        </div>`;
    }
    function setPadSourceType(fn, type) {
      if (type === "axis") padMap[fn] = { type: "axis", axis: (padMap[fn].axis ?? 0) | 0, invert: !!padMap[fn].invert };
      else padMap[fn] = { type: "buttons", neg: padMap[fn].neg ?? null, pos: padMap[fn].pos ?? null };
      savePadMap();
    }
    function wireGamepad() {
      $("padEnable").onchange = e => setPadEnabled(e.target.checked);
      $("padReset").onclick = () => { padMap = normalizePadMap(JSON.parse(JSON.stringify(PAD_DEFAULT))); savePadMap(); buildSettings(); };
      $("settings").querySelectorAll("tr[data-fn]").forEach(trEl => {
        const fn = trEl.dataset.fn;
        const tSel = trEl.querySelector(".pad-type"); if (tSel) tSel.onchange = e => { setPadSourceType(fn, e.target.value); buildSettings(); };
        const ax = trEl.querySelector(".pad-axis"); if (ax) ax.onchange = e => { padMap[fn].axis = +e.target.value; savePadMap(); };
        const iv = trEl.querySelector(".pad-inv"); if (iv) iv.onchange = e => { padMap[fn].invert = e.target.checked; savePadMap(); };
        const ng = trEl.querySelector(".pad-neg"); if (ng) ng.onchange = e => { padMap[fn].neg = e.target.value === "" ? null : +e.target.value; savePadMap(); };
        const ps = trEl.querySelector(".pad-pos"); if (ps) ps.onchange = e => { padMap[fn].pos = e.target.value === "" ? null : +e.target.value; savePadMap(); };
      });
    }
    function updatePadReadout(gp) {
      const box = $("padReadout"); if (!box) return;
      const na = gp.axes.length, nb = gp.buttons.length;
      if (box.dataset.na != na || box.dataset.nb != nb) {
        box.dataset.na = na; box.dataset.nb = nb;
        const axes = Array.from({ length: na }, (_, i) =>
          `<div class="axrow"><span class="axk">A${i}</span><span class="axbar"><i id="axb${i}"></i></span><span class="axv" id="axv${i}">0.00</span></div>`).join("");
        const btns = Array.from({ length: nb }, (_, i) => `<span class="pbtn" id="pbtn${i}">${i}</span>`).join("");
        box.innerHTML = `<div class="axes">${axes}</div><div class="pbtns">${btns}</div>`;
      }
      for (let i = 0; i < na; i++) { const v = gp.axes[i] || 0, b = $("axb" + i), vv = $("axv" + i);
        if (b) b.style.left = (50 + clamp(v, -1, 1) * 50).toFixed(1) + "%"; if (vv) vv.textContent = v.toFixed(2); }
      for (let i = 0; i < nb; i++) { const e2 = $("pbtn" + i); if (e2) e2.classList.toggle("on", padPressed(gp, i)); }
      $("settings").querySelectorAll(".padlive").forEach(td => { td.textContent = padFnValue(gp, td.dataset.fn); });
    }

    // ---- the api handed to the control surface ----
    const api = {
      driveFn, scaleVal, capFor, stopAll, clearStopLatch, neutralizeAll,
      lifecycle: () => lifecycle, isUnmapped, funcLabel, funcValue,
      getMap: () => activeMap, getGrid: () => grid, deviceSwap: () => deviceSwap,
      dict: tr, addControl: reset => controls.push({ reset }), clamp, send,
    };

    // ---- boot ----
    // D1 migration: move the excavator's old non-per-layout key to the per-layout key (once).
    if (LAYOUT_ID === "excavator" && !localStorage.getItem(MAP_KEY) && localStorage.getItem("mk4_active_map")) {
      localStorage.setItem(MAP_KEY, localStorage.getItem("mk4_active_map"));
      localStorage.removeItem("mk4_active_map");
    }
    function applyMaps(def) {
      defaultMap = withDefaults(def);
      activeMap = loadStoredMap() || withDefaults(def);
      ensureSlotProto(activeMap);   // legacy migration: existing single-mk6 users (PROTO_KEY=mk6) -> all used slots mk6
      rebuildSurface(); rebuildOpenSettings();
      // First-run onboarding: a generic layout with NO channels assigned shows the auto-assign
      // wizard FIRST (mapping needs no connection); the connect guide then follows on close.
      // Everything else just shows the connect guide. (Avoids stacking two modals at boot.)
      const unassigned = config.autoAssign && !FN.some(f => activeMap.functions[f].slot != null && activeMap.functions[f].channel != null);
      if (unassigned) { pendingStartup = lifecycle !== "READY"; openAssign(); }
      else if (lifecycle !== "READY") openStartup();
    }
    document.documentElement.lang = lang;
    renderTopbar();
    if ($("navChip")) $("navChip").onclick = toggleNav;
    applyNav();
    renderHint();
    rebuildSurface();   // render once even before the map loads (locked overlay)
    connect();
    fetch(MAP_URL).then(r => r.json()).then(applyMaps).catch(() => applyMaps(placeholderMap()));
    setInterval(refreshActive, REFRESH_MS);
    document.addEventListener("keydown", e => { if (e.code === "Space" || e.code === "Escape") { e.preventDefault(); stopAll(); } });
    window.addEventListener("blur", neutralizeAll);
    document.addEventListener("visibilitychange", () => { if (document.hidden) neutralizeAll(); });
    let _rfit; window.addEventListener("resize", () => {
      updateNavGlyphs();
      clearTimeout(_rfit); _rfit = setTimeout(() => { if (config.onResize) config.onResize(api); }, 150);
    });
    if (features.gamepad) {
      window.addEventListener("gamepadconnected", e => { if (padIndex == null) padIndex = e.gamepad.index; renderTopbar(); rebuildOpenSettings(); });
      window.addEventListener("gamepaddisconnected", () => { padReleaseOwned(); padSuppressed = true; padIndex = null; padLastId = null; renderTopbar(); rebuildOpenSettings(); });
      requestAnimationFrame(gamepadLoop);
      setInterval(gamepadTick, 80);
    }
    return api;
  }
  return { create };
})();
