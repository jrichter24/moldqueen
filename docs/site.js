/* moldqueen site — vanilla JS: nav, scrollspy, and the LIVE layouts fetch. No framework. */
(function () {
  "use strict";
  var nav = document.querySelector(".nav");

  // --- mobile nav toggle ---
  var toggle = document.querySelector(".navtoggle");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    nav.querySelectorAll(".navlinks a").forEach(function (a) {
      a.addEventListener("click", function () { nav.classList.remove("open"); toggle.setAttribute("aria-expanded", "false"); });
    });
  }

  // --- sticky nav shadow on scroll ---
  if (nav) {
    var onScroll = function () { nav.classList.toggle("scrolled", window.scrollY > 8); };
    onScroll(); window.addEventListener("scroll", onScroll, { passive: true });
  }

  // --- scrollspy: highlight the nav link for the section in view ---
  var links = Array.prototype.slice.call(document.querySelectorAll(".navlinks a[href^='#']"));
  if (links.length && "IntersectionObserver" in window) {
    var byId = {};
    links.forEach(function (a) { byId[a.getAttribute("href").slice(1)] = a; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          links.forEach(function (l) { l.classList.remove("active"); });
          if (byId[e.target.id]) byId[e.target.id].classList.add("active");
        }
      });
    }, { rootMargin: "-45% 0px -50% 0px", threshold: 0 });
    Object.keys(byId).forEach(function (id) { var el = document.getElementById(id); if (el) io.observe(el); });
  }

  // --- LIVE layouts (fetched from the repo's layouts.json; no hardcoded list) ---
  var grid = document.getElementById("layout-grid");
  if (grid) {
    var SRC = "https://raw.githubusercontent.com/jrichter24/moldqueen/main/client/web/layouts.json";
    var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
    var fail = function (msg) {
      grid.innerHTML = '<div class="layout-fail">' + esc(msg) +
        ' See the layouts in the <a href="https://github.com/jrichter24/moldqueen/tree/main/client/web" rel="noopener">repository</a>.</div>';
    };
    fetch(SRC, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) {
        var layouts = (data && data.layouts) || [];
        // match the app's chooser cards: active, not a hidden dev page (card:false), not a placeholder
        var cards = layouts.filter(function (L) { return L.active !== false && L.card !== false && L.kind !== "placeholder"; });
        if (!cards.length) { fail("No active layouts found."); return; }
        grid.innerHTML = cards.map(function (L) {
          var soon = L.protocolsSoon || [];
          var badge = L.generic
            ? '<span class="badge generic">Generic</span>'
            : '<span class="badge model">Model</span>';
          var protos = (L.protocols || []).map(function (p) {
            var s = soon.indexOf(p) >= 0;
            return '<span class="proto' + (s ? " soon" : "") + '"' + (s ? ' title="Coming soon"' : "") + ">" + esc(p.toUpperCase()) + "</span>";
          }).join("");
          return '<article class="layout-card">' +
            "<h3>" + esc(L.name) + "</h3>" +
            "<p>" + esc(L.description || "") + "</p>" +
            '<div class="badges">' + badge + protos + "</div>" +
            "</article>";
        }).join("");
      })
      .catch(function () { fail("Couldn't load the live layout list right now."); });
  }

  // --- footer year ---
  var y = document.getElementById("year"); if (y) y.textContent = new Date().getFullYear();
})();
