/* moldqueen site — vanilla JS. Scroll-driven black→white tone, hover image tiles (live),
   nav, scrollspy. No framework. */
(function () {
  "use strict";
  var root = document.documentElement;
  var nav = document.querySelector(".nav");
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- helpers ----------
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function smooth(e0, e1, x) { var t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); }
  function mixRGB(A, B, t) { return [Math.round(lerp(A[0], B[0], t)), Math.round(lerp(A[1], B[1], t)), Math.round(lerp(A[2], B[2], t))]; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ---------- 1. scroll-driven tone (black → white), contrast-managed ----------
  var DARK_BG = [9, 11, 15], LIGHT_BG = [241, 243, 246];
  var LIGHT_INK = [237, 241, 246], DARK_INK = [18, 22, 30];
  var DARK_ACC = [96, 178, 233], LIGHT_ACC = [27, 105, 160];

  // background lightness vs scroll progress: dark plateau → FAST sweep through the
  // mid-grey danger zone → light plateau. Keeps low-contrast moments brief.
  function level(p) {
    if (p < 0.42) return lerp(0.00, 0.15, p / 0.42);
    if (p < 0.60) return lerp(0.15, 0.92, (p - 0.42) / 0.18);
    return lerp(0.92, 1.00, (p - 0.60) / 0.40);
  }
  function applyTone() {
    var max = document.documentElement.scrollHeight - window.innerHeight;
    var p = clamp01(max > 0 ? window.scrollY / max : 0);
    var L = level(p);
    var bg = mixRGB(DARK_BG, LIGHT_BG, L);
    // Ink flips as a clean STEP at the bg midpoint (never a mid-grey ink on mid-grey bg,
    // which would be the unreadable case). The single colour switch is masked by the halo.
    var ti = L < 0.47 ? 0 : 1;
    var ink = ti ? DARK_INK : LIGHT_INK;
    var acc = ti ? LIGHT_ACC : DARK_ACC;
    // Text halo keyed to the BACKGROUND midpoint (where contrast is tightest), opposite the ink.
    var haloA = clamp01(1 - Math.abs(L - 0.5) / 0.14) * 0.55;
    root.style.setProperty("--bg", "rgb(" + bg.join(",") + ")");
    root.style.setProperty("--bg-rgb", bg.join(","));
    root.style.setProperty("--ink", "rgb(" + ink.join(",") + ")");
    root.style.setProperty("--ink-rgb", ink.join(","));
    root.style.setProperty("--accent", "rgb(" + acc.join(",") + ")");
    root.style.setProperty("--accent-rgb", acc.join(","));
    root.style.setProperty("--halo-rgb", ti < 0.5 ? "0,0,0" : "255,255,255");
    root.style.setProperty("--halo-a", haloA.toFixed(3));
  }
  var toneOn = document.body.classList.contains("scroll-tone");
  if (toneOn) {
    var ticking = false;
    var onScroll = function () {
      if (nav) nav.classList.toggle("scrolled", window.scrollY > 8);
      if (!ticking) { ticking = true; requestAnimationFrame(function () { applyTone(); ticking = false; }); }
    };
    applyTone(); onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", applyTone, { passive: true });
  } else if (nav) {
    var ns = function () { nav.classList.toggle("scrolled", window.scrollY > 8); };
    ns(); window.addEventListener("scroll", ns, { passive: true });
  }

  // ---------- mobile nav toggle ----------
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

  // ---------- scrollspy ----------
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

  // ---------- 2. live layout tiles (fetched from the repo manifest) ----------
  var grid = document.getElementById("tiles");
  if (grid) {
    var SRC = "https://raw.githubusercontent.com/jrichter24/moldqueen/main/client/web/layouts.json";
    var REPO = "https://github.com/jrichter24/moldqueen/tree/main/client/web";
    // id → real layout artwork copied into docs/assets/
    var IMG = {
      excavator: { src: "assets/excavator_tile.png", alt: "The excavator dashboard layout" },
      generic_brick: { src: "assets/brick_tile.png", alt: "The brick controller layout" },
      generic_12axis: { src: "assets/axis12_tile.png", alt: "The 12-axis controller layout" }
    };
    var fail = function (msg) {
      grid.innerHTML = '<div class="tiles-fail">' + esc(msg) +
        ' Browse them in the <a href="' + REPO + '" rel="noopener">repository</a>.</div>';
    };
    fetch(SRC, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (data) {
        var all = (data && data.layouts) || [];
        var cards = all.filter(function (L) { return L.active !== false && L.card !== false && L.kind !== "placeholder"; });
        if (!cards.length) { fail("No active layouts found."); return; }
        grid.innerHTML = cards.map(function (L) {
          var soon = L.protocolsSoon || [];
          var badge = L.generic ? '<span class="badge generic">Generic</span>' : '<span class="badge model">Model</span>';
          var protos = (L.protocols || []).map(function (p) {
            var s = soon.indexOf(p) >= 0;
            return '<span class="proto' + (s ? " soon" : "") + '"' + (s ? ' title="Coming soon"' : "") + ">" + esc(p.toUpperCase()) + "</span>";
          }).join("");
          var art = IMG[L.id];
          var img = art ? '<img src="' + art.src + '" alt="' + esc(art.alt) + '" loading="lazy" />' : "";
          return '<a class="tile' + (art ? "" : " tile-noimg") + '" href="' + REPO + '" rel="noopener" aria-label="' + esc(L.name) + ' layout">' +
            img +
            '<div class="scrim"></div>' +
            '<span class="open" aria-hidden="true">↗</span>' +
            '<div class="tbody">' +
              "<h3>" + esc(L.name) + "</h3>" +
              '<p class="tdesc">' + esc(L.description || "") + "</p>" +
              '<div class="badges">' + badge + protos + "</div>" +
            "</div></a>";
        }).join("");
      })
      .catch(function () { fail("Couldn't load the live layout list right now."); });
  }

  // ---------- footer year ----------
  var y = document.getElementById("year"); if (y) y.textContent = new Date().getFullYear();
})();
