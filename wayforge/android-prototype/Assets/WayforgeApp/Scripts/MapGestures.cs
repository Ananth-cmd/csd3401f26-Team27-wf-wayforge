/*!
 * \file MapGestures.cs
 * \brief touch + mouse controls for the 3D map
 *
 * goes on the map image. drag to spin the map around (or pan in 2D),
 * pinch or scroll to zoom. it just tells BuildingMap what to do, the
 * camera stuff is in there.
 *
 * \author Katie
 *
 * Contribution: Katie
 *
 * AI declaration: used Claude to help write and debug the code and comments.
 *
 * \date 2026-10-03
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using UnityEngine;
using UnityEngine.EventSystems;

namespace WayforgeApp
{
    // goes on the RawImage that shows the map
    public sealed class MapGestures : MonoBehaviour, IDragHandler, IScrollHandler
    {
        public BuildingMap map;
        // finger distance from last frame, 0 = not pinching
        float pinch;
        // keep the map camera the same shape as the image so it doesnt stretch
        void LateUpdate() { var r = ((RectTransform)transform).rect; if (map && r.height > 0) map.Aspect(r.width / r.height); }
        // 1 finger drag / mouse drag
        public void OnDrag(PointerEventData e)
        {
            // 2 fingers is a pinch, Update handles that
            if (Input.touchCount > 1) return;
            // 2D view or right mouse = move the map, otherwise spin it
            if (map.TopDown || e.button == PointerEventData.InputButton.Right) map.Pan(e.delta);
            else map.Orbit(-e.delta.x * .3f);
        }
        // mouse wheel, scroll up zooms in
        public void OnScroll(PointerEventData e) => map.Zoom(e.scrollDelta.y > 0 ? .9f : 1.1f);
        // pinch zoom on phone
        void Update()
        {
            // not 2 fingers anymore so reset
            if (Input.touchCount != 2) { pinch = 0; return; }
            var a = Input.GetTouch(0); var b = Input.GetTouch(1);
            // both fingers have to be on the map
            if (!RectTransformUtility.RectangleContainsScreenPoint((RectTransform)transform, a.position) ||
                !RectTransformUtility.RectangleContainsScreenPoint((RectTransform)transform, b.position)) return;
            float distance = Vector2.Distance(a.position, b.position);
            // fingers moving apart = zoom in, together = zoom out
            if (pinch > 10 && distance > 10) map.Zoom(pinch / distance);
            pinch = distance;
        }
    }
}

