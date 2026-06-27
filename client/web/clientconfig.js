// moldqueen — shared CLIENT config (dashboard + RAW).
// The WS API endpoint the client connects to. Default derives from the page's own
// host (so serving the UI from the Pi "just works"); set + persist an override in
// localStorage so the client can be served from ANYWHERE (e.g. a Docker container
// on your desktop) and pointed at a remote Pi's API (ws://<pi>:8765).
// See dev-docs/REMOTE_CLIENT.md.
window.MK4 = window.MK4 || {};
(function (M) {
  M.LS_ENDPOINT = "mk4_ws_endpoint";

  // Derived default. window.MK4_WS_PORT is injected by the serving host; when the UI
  // is served raw (no injection) it isn't a number → fall back to 8765.
  M.defaultEndpoint = function () {
    var port = parseInt(window.MK4_WS_PORT, 10);
    if (!isFinite(port)) port = 8765;
    return "ws://" + location.hostname + ":" + port;
  };
  M.storedEndpoint = function () { return (localStorage.getItem(M.LS_ENDPOINT) || "").trim(); };
  M.wsEndpoint = function () { return M.storedEndpoint() || M.defaultEndpoint(); };
  M.setEndpoint = function (v) {
    v = (v || "").trim();
    if (v) localStorage.setItem(M.LS_ENDPOINT, v); else localStorage.removeItem(M.LS_ENDPOINT);
    return M.wsEndpoint();
  };

  // Optional in-client Fullscreen button. window.MK4_SHOW_FULLSCREEN is injected by the
  // serving side ("true" for the web default, "false" for a host that handles fullscreen
  // natively). Unreplaced/absent -> default ON. The client never knows WHO set it — no
  // host-specific branching here.
  M.showFullscreen = function () { return String(window.MK4_SHOW_FULLSCREEN) !== "false"; };

  // Shared UI strings (EN-fallback) from the single i18n source; null-safe if i18n absent.
  function T() { return window.MK4I18N ? window.MK4I18N.dict() : null; }

  // Connection status shown next to the endpoint editor: connected | failed | retrying.
  M.setStatus = function (state) {
    var s = document.getElementById("epStatus");
    if (!s) return;
    var t = T(), word = (t && t.statusW && t.statusW[state]) || state;   // translated status word
    s.textContent = "● " + word + " — " + M.wsEndpoint(); s.className = "epstatus " + state;
  };

  // Build the endpoint editor into `host`. onApply() runs after the value is saved
  // (the layout uses it to reconnect the WebSocket to the new endpoint).
  //
  // EDIT-STATE GUARD: this row is rebuilt whenever its containing sheet re-renders —
  // which the reconnect/retry loop and lifecycle/state pushes do repeatedly while the
  // client is disconnected and auto-retrying. A naive rebuild would reset the input to
  // the stored endpoint and clobber whatever the user is mid-typing (you could never
  // type a full address). So the input is a LOCAL EDIT BUFFER: it commits to the real
  // (localStorage-backed) endpoint only on an explicit action (Connect / Enter / Use
  // page host), and on rebuild we PRESERVE any in-progress edit — the value + caret of
  // the existing input when it is focused or holds uncommitted text — instead of
  // resetting it. The retry loop keeps using the last committed endpoint in the
  // background; it never touches the field being edited.
  M.buildEndpointRow = function (host, onApply) {
    var t = T();   // translated labels/hint (EN fallback)
    var L = function (k, en) { return (t && t[k]) || en; };
    // Capture the prior input's edit-state BEFORE we blow it away with innerHTML.
    var prev = host.querySelector("#epInput");
    var stored = M.storedEndpoint();
    var keep = null;   // { value, selStart, selEnd } to carry across the rebuild, or null
    if (prev) {
      var wasFocused = (document.activeElement === prev);
      var isDirty = (prev.value !== stored);   // uncommitted user input differs from the committed endpoint
      if (wasFocused || isDirty) {
        keep = { value: prev.value, focused: wasFocused, selStart: prev.selectionStart, selEnd: prev.selectionEnd };
      }
    }
    // Vertical stacked form: label · full-width input · buttons row · status · hint.
    host.innerHTML =
      '<label class="eplabel" for="epInput">' + L("epLabel", "API endpoint") + '</label>' +
      '<input type="text" id="epInput" spellcheck="false" autocapitalize="off" placeholder="' + M.defaultEndpoint() + '">' +
      '<div class="epbtns">' +
      '<button id="epApply" class="primary">' + L("epConnect", "Connect") + '</button>' +
      '<button id="epReset">' + L("epUseHost", "Use page host") + '</button>' +
      '</div>' +
      '<span id="epStatus" class="epstatus"></span>' +
      '<div class="ephint">' + L("epHint", "Empty = this page’s host (default). For a remote Pi set e.g. " +
      "<code>ws://192.168.178.98:8765</code>. Saved in this browser.") + '</div>';
    var inp = host.querySelector("#epInput");
    if (keep) {
      // Mid-edit rebuild: restore exactly what the user had (value + caret), do not reset.
      inp.value = keep.value;
      if (keep.focused) {
        inp.focus();
        try { inp.setSelectionRange(keep.selStart, keep.selEnd); } catch (e) {}
      }
    } else {
      inp.value = stored;   // fresh build: show the committed endpoint
    }
    // Commit handlers: only THESE persist the typed value + (re)connect — never the rebuild.
    function commit() { M.setEndpoint(inp.value); onApply(); }
    host.querySelector("#epApply").onclick = commit;
    host.querySelector("#epReset").onclick = function () { M.setEndpoint(""); inp.value = ""; onApply(); };
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") commit(); });
    // Commit on a GENUINE user blur (Tab/click away). A rebuild detaches the focused
    // node, which also fires blur — guard with isConnected so a rebuild never commits
    // (and never reconnects to) a half-typed value.
    inp.addEventListener("blur", function () {
      if (inp.isConnected && inp.value !== M.storedEndpoint()) commit();
    });
  };
})(window.MK4);
