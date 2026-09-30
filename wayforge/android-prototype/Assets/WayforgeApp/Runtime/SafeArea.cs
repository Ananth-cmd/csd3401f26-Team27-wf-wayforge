using UnityEngine;

namespace WayforgeApp
{
    [RequireComponent(typeof(RectTransform))]
    public sealed class SafeArea : MonoBehaviour
    {
        Rect previous;
        void Update()
        {
            var area = Screen.safeArea;
            if (area == previous || Screen.width == 0 || Screen.height == 0) return;
            previous = area;
            var rect = (RectTransform)transform;
            rect.anchorMin = new Vector2(area.xMin / Screen.width, area.yMin / Screen.height);
            rect.anchorMax = new Vector2(area.xMax / Screen.width, area.yMax / Screen.height);
            rect.offsetMin = rect.offsetMax = Vector2.zero;
        }
    }
}
