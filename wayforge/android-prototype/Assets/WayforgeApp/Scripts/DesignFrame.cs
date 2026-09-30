using UnityEngine;

namespace WayforgeApp
{
    // Keeps a 390 x 844 design board inside the available phone area without clipping.
    [ExecuteAlways, RequireComponent(typeof(RectTransform))]
    public sealed class DesignFrame : MonoBehaviour
    {
        void Update()
        {
            var rect = (RectTransform)transform;
            var parent = transform.parent as RectTransform;
            if (!parent || parent.rect.width <= 0 || parent.rect.height <= 0) return;
            float scale = Mathf.Min(parent.rect.width / 390f, parent.rect.height / 844f);
            rect.localScale = Vector3.one * scale;
        }
    }
}
