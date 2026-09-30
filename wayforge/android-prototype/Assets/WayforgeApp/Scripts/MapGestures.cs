using UnityEngine;
using UnityEngine.EventSystems;

namespace WayforgeApp
{
    // Attach to the editable RawImage map surface; no UI is generated here.
    public sealed class MapGestures : MonoBehaviour, IDragHandler, IScrollHandler
    {
        public BuildingMap map;
        float pinch;
        void LateUpdate() { var r = ((RectTransform)transform).rect; if (map && r.height > 0) map.Aspect(r.width / r.height); }
        public void OnDrag(PointerEventData e)
        {
            if (Input.touchCount > 1) return;
            if (map.TopDown || e.button == PointerEventData.InputButton.Right) map.Pan(e.delta);
            else map.Orbit(-e.delta.x * .3f);
        }
        public void OnScroll(PointerEventData e) => map.Zoom(e.scrollDelta.y > 0 ? .9f : 1.1f);
        void Update()
        {
            if (Input.touchCount != 2) { pinch = 0; return; }
            var a = Input.GetTouch(0); var b = Input.GetTouch(1);
            if (!RectTransformUtility.RectangleContainsScreenPoint((RectTransform)transform, a.position) ||
                !RectTransformUtility.RectangleContainsScreenPoint((RectTransform)transform, b.position)) return;
            float distance = Vector2.Distance(a.position, b.position);
            if (pinch > 10 && distance > 10) map.Zoom(pinch / distance);
            pinch = distance;
        }
    }
}

