/* moldqueen site — vanilla JS. Scroll-driven black→white tone (a FAST sweep anchored to the
   "Get the app / Pick your radio" section), big live hover tiles, nav, scrollspy. No framework. */
(function () {
  "use strict";
  var root = document.documentElement;
  var nav = document.querySelector(".nav");

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function mixRGB(A, B, t) { return [Math.round(lerp(A[0], B[0], t)), Math.round(lerp(A[1], B[1], t)), Math.round(lerp(A[2], B[2], t))]; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function pretty(s) { return String(s).replace(/_/g, " "); }

  // ---------- 1. scroll-driven tone: dark until the #app section, a FAST sweep across it, then light ----------
  var DARK_BG = [9, 11, 15], LIGHT_BG = [241, 243, 246];
  var LIGHT_INK = [237, 241, 246], DARK_INK = [18, 22, 30];
  var DARK_ACC = [96, 178, 233], LIGHT_ACC = [27, 105, 160];
  var anchor = document.getElementById("app");

  function progress() {
    // 0 while #app is below the fold, → 1 as its top rises from 92% to 45% of the viewport.
    // A short window = a fast, concentrated black→white sweep right around "Pick your radio".
    if (!anchor) {
      var max = root.scrollHeight - window.innerHeight;
      return clamp01(max > 0 ? window.scrollY / max : 0);
    }
    var vh = window.innerHeight;
    var top = anchor.getBoundingClientRect().top;
    return clamp01((vh * 0.92 - top) / (vh * 0.92 - vh * 0.45));
  }
  function applyTone() {
    var L = progress();
    var bg = mixRGB(DARK_BG, LIGHT_BG, L);
    // Ink flips as a clean STEP at the bg midpoint (never mid-grey ink on mid-grey bg).
    var ti = L < 0.47 ? 0 : 1;
    var ink = ti ? DARK_INK : LIGHT_INK;
    var acc = ti ? LIGHT_ACC : DARK_ACC;
    var haloA = clamp01(1 - Math.abs(L - 0.5) / 0.14) * 0.55;  // halo strongest mid-transition
    root.style.setProperty("--bg", "rgb(" + bg.join(",") + ")");
    root.style.setProperty("--bg-rgb", bg.join(","));
    root.style.setProperty("--ink", "rgb(" + ink.join(",") + ")");
    root.style.setProperty("--ink-rgb", ink.join(","));
    root.style.setProperty("--accent", "rgb(" + acc.join(",") + ")");
    root.style.setProperty("--accent-rgb", acc.join(","));
    root.style.setProperty("--halo-rgb", ti < 0.5 ? "0,0,0" : "255,255,255");
    root.style.setProperty("--halo-a", haloA.toFixed(3));
  }
  if (document.body.classList.contains("scroll-tone")) {
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

  // ---------- 2. live, info-rich layout tiles ----------
  var grid = document.getElementById("tiles");
  if (grid) {
    var SRC = "https://raw.githubusercontent.com/jrichter24/moldqueen/main/client/web/layouts.json";
    var REPO = "https://github.com/jrichter24/moldqueen/tree/main/client/web";
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
        var cards = ((data && data.layouts) || []).filter(function (L) { return L.active !== false && L.card !== false && L.kind !== "placeholder"; });
        if (!cards.length) { fail("No active layouts found."); return; }
        grid.innerHTML = cards.map(function (L) {
          var soon = L.protocolsSoon || [];
          var badge = L.generic ? '<span class="badge generic">Generic</span>' : '<span class="badge model">Model</span>';
          var protos = (L.protocols || []).map(function (p) {
            var s = soon.indexOf(p) >= 0;
            return '<span class="proto' + (s ? " soon" : "") + '"' + (s ? ' title="Coming soon"' : "") + ">" + esc(p.toUpperCase()) + "</span>";
          }).join("");
          var fns = L.functions || [];
          var noun = L.generic ? "motors" : "functions";
          var sub = (L.generic ? "Generic controller" : cap(L.category || "Model")) + " · " + fns.length + " " + noun;
          var chips = fns.slice(0, 6).map(function (f) { return "<span>" + esc(pretty(f)) + "</span>"; }).join("") +
            (fns.length > 6 ? '<span>+' + (fns.length - 6) + "</span>" : "");
          var art = IMG[L.id];
          var img = art ? '<img src="' + art.src + '" alt="' + esc(art.alt) + '" loading="lazy" />' : "";
          return '<a class="tile' + (art ? "" : " tile-noimg") + '" href="' + REPO + '" rel="noopener" aria-label="' + esc(L.name) + ' layout">' +
            img + '<div class="scrim"></div>' +
            '<div class="t-badges">' + badge + protos + "</div>" +
            '<span class="open" aria-hidden="true">↗</span>' +
            '<div class="tbody">' +
              "<h3>" + esc(L.name) + "</h3>" +
              '<div class="t-sub">' + esc(sub) + "</div>" +
              '<p class="t-desc">' + esc(L.description || "") + "</p>" +
              '<div class="t-fns">' + chips + "</div>" +
            "</div></a>";
        }).join("");
      })
      .catch(function () { fail("Couldn't load the live layout list right now."); });
  }

  // ---------- footer year ----------
  var y = document.getElementById("year"); if (y) y.textContent = new Date().getFullYear();
})();
