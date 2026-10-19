/*
 * WayforgeBridge.jslib
 * Unity -> page events for the Wayforge viewer (WebGL builds only).
 *
 * WF_Emit(name, json) is called by WebBridge.Emit in C#. The event goes to:
 *   1. window.wayforgeViewerEvents(name, data), if the page set it
 *      (wayforge-viewer.js does),
 *   2. a "wayforge-viewer" CustomEvent on window, detail = { event, data },
 *   3. the parent window via postMessage({ source: "wayforge-viewer", event, data })
 *      when the viewer runs inside an iframe.
 * See docs/viewer.md.
 *
 * Author: Ananthan Elangovan (ananthan.e@digipen.edu)
 * AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.
 * Copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */
mergeInto(LibraryManager.library, {
  WF_Emit: function (namePtr, jsonPtr) {
    var name = UTF8ToString(namePtr);
    var data = null;
    try { data = JSON.parse(UTF8ToString(jsonPtr)); } catch (e) { data = UTF8ToString(jsonPtr); }

    if (typeof window.wayforgeViewerEvents === "function") {
      try { window.wayforgeViewerEvents(name, data); } catch (e) { console.error(e); }
    }
    window.dispatchEvent(new CustomEvent("wayforge-viewer", { detail: { event: name, data: data } }));
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ source: "wayforge-viewer", event: name, data: data }, "*");
    }
  }
});
