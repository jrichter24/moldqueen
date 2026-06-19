// moldqueen — shared CLIENT config (dashboard + RAW).
// The WS API endpoint the client connects to. Default derives from the page's own
// host (so serving the UI from the Pi "just works"); set + persist an override in
// localStorage so the client can be served from ANYWHERE (e.g. a Docker container
// on your desktop) and pointed at a remote Pi's API (ws://<pi>:8765).
// See docs/REMOTE_CLIENT.md.
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

  // Connection status shown next to the endpoint editor: connected | failed | retrying.
  M.setStatus = function (state) {
    var s = document.getElementById("epStatus");
    if (s) { s.textContent = "● " + state + " — " + M.wsEndpoint(); s.className = "epstatus " + state; }
  };

  // Build the endpoint editor into `host`. onApply() runs after the value is saved
  // (the layout uses it to reconnect the WebSocket to the new endpoint).
  M.buildEndpointRow = function (host, onApply) {
    // Vertical stacked form: label · full-width input · buttons row · status · hint.
    host.innerHTML =
      '<label class="eplabel" for="epInput">API endpoint</label>' +
      '<input type="text" id="epInput" spellcheck="false" autocapitalize="off" placeholder="' + M.defaultEndpoint() + '">' +
      '<div class="epbtns">' +
      '<button id="epApply" class="primary">Connect</button>' +
      '<button id="epReset">Use page host</button>' +
      '</div>' +
      '<span id="epStatus" class="epstatus"></span>' +
      '<div class="ephint">Empty = this page’s host (default). For a remote Pi set e.g. ' +
      '<code>ws://192.168.178.98:8765</code>. Saved in this browser.</div>';
    var inp = host.querySelector("#epInput");
    inp.value = M.storedEndpoint();
    host.querySelector("#epApply").onclick = function () { M.setEndpoint(inp.value); onApply(); };
    host.querySelector("#epReset").onclick = function () { M.setEndpoint(""); inp.value = ""; onApply(); };
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { M.setEndpoint(inp.value); onApply(); } });
  };
})(window.MK4);
