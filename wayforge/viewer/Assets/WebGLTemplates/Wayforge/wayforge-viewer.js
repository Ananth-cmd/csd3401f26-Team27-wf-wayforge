/*
 * wayforge-viewer.js
 * Page-side API for the Wayforge 3D viewer (Unity WebGL). No dependencies.
 *
 *   const viewer = await WayforgeViewer.create({ canvas, buildUrl: "/viewer" });
 *   viewer.on("roomClicked", room => console.log(room.code));
 *   viewer.loadBuilding(wfbJsonText);
 *   viewer.showRoute(routeJsonFromBackend);
 *
 * buildUrl is the folder holding viewer-build.js and Build/ (the WebGL build
 * output). create() resolves once the viewer has sent its "ready" event.
 * Every command is fire-and-forget; problems come back as "error" events.
 * Full contract: docs/viewer.md.
 *
 * Author: Ananthan Elangovan (ananthan.e@digipen.edu)
 * AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.
 * Copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */
(function (global) {
  "use strict";

  var CONTRACT = "1.0";
  var TARGET = "WayforgeViewer";             // GameObject that receives SendMessage calls

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error("could not load " + src)); };
      document.head.appendChild(s);
    });
  }

  function asText(value) {
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  // Key events from the page's text fields stop propagating at the <html> element: after the page's
  // own handlers, before the viewer's document and window listeners.
  function isTextField(el) {
    if (!el) return false;
    var tag = el.tagName;
    return el.isContentEditable || tag === "TEXTAREA" || tag === "SELECT" ||
           (tag === "INPUT" && !/^(button|checkbox|radio|range|submit|reset|file|color)$/i.test(el.type || ""));
  }
  ["keydown", "keyup", "keypress"].forEach(function (type) {
    document.documentElement.addEventListener(type, function (e) { if (isTextField(e.target)) e.stopPropagation(); });
  });

  async function create(options) {
    var canvas = options.canvas;
    var base = (options.buildUrl || ".").replace(/\/+$/, "");
    if (!canvas) throw new Error("WayforgeViewer.create: options.canvas is required");

    if (!global.WAYFORGE_VIEWER_BUILD) await loadScript(base + "/viewer-build.js");
    var build = global.WAYFORGE_VIEWER_BUILD;
    if (typeof global.createUnityInstance !== "function") await loadScript(base + "/" + build.loaderUrl);

    // Events from WayforgeBridge.jslib arrive here.
    var listeners = {};
    var resolveReady;
    var ready = new Promise(function (r) { resolveReady = r; });
    global.wayforgeViewerEvents = function (name, data) {
      if (name === "ready") resolveReady(data);
      (listeners[name] || []).forEach(function (fn) { fn(data); });
      (listeners["*"] || []).forEach(function (fn) { fn(name, data); });
    };

    var instance = await global.createUnityInstance(canvas, {
      dataUrl: base + "/" + build.dataUrl,
      frameworkUrl: base + "/" + build.frameworkUrl,
      codeUrl: base + "/" + build.codeUrl,
      streamingAssetsUrl: base + "/StreamingAssets",
      companyName: build.companyName,
      productName: build.productName,
      productVersion: build.productVersion
    }, options.onProgress);
    var info = await ready;

    function send(method, arg) {
      instance.SendMessage(TARGET, method, arg === undefined || arg === null ? "" : String(arg));
    }

    return {
      instance: instance,
      contract: info && info.contract,

      // name: event name, or "*" for every event (fn(name, data)). Returns a function that unsubscribes.
      on: function (name, fn) {
        (listeners[name] = listeners[name] || []).push(fn);
        return function () { listeners[name] = (listeners[name] || []).filter(function (f) { return f !== fn; }); };
      },

      loadBuilding: function (wfb) { send("LoadBuilding", asText(wfb)); },
      loadBuildingUrl: function (url) { send("LoadBuildingUrl", new URL(url, document.baseURI).href); },

      showFloor: function (levelId) { send("ShowFloor", levelId); },
      showAllFloors: function () { send("ShowAllFloors"); },
      setFloorSpacing: function (metres) { send("SetFloorSpacing", Number(metres) || 0); },

      highlightRoom: function (ref) { send("HighlightRoom", ref || ""); },
      focusRoom: function (ref) { send("FocusRoom", ref); },

      // route: wf_cli route JSON (text or object) or an array of steps. opts.animate = false for no moving dot.
      showRoute: function (route, opts) {
        var r = typeof route === "string" ? JSON.parse(route) : route;
        if (Array.isArray(r)) r = { steps: r };
        if (opts && opts.animate === false) r = Object.assign({}, r, { animate: false });
        send("ShowRoute", JSON.stringify(r));
      },
      clearRoute: function () { send("ClearRoute"); },

      setView: function (mode) { send("SetView", mode); },              // "2d" or "3d"
      resetView: function () { send("ResetView"); },
      setCutaway: function (on) { send("SetCutaway", on ? "true" : "false"); },
      showLabels: function (on) { send("ShowLabels", on ? "true" : "false"); },
      showRoof: function (on) { send("ShowRoof", on ? "true" : "false"); },

      quit: function () { return instance.Quit(); }
    };
  }

  global.WayforgeViewer = { create: create, contract: CONTRACT };
})(window);
