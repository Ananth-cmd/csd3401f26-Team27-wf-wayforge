/*!
 * \file SafeArea.cs
 * \brief Keeps the UI inside the safe part of the phone screen
 *
 * Phones have notches, rounded corners and gesture bars that can cover the
 * edges of the screen. Unity gives us the area that is safe to use, and this
 * script resizes its object to fit exactly inside it. It only does the work
 * when the safe area changes, for example when the phone is rotated.
 *
 * Links: put on the object that holds the screens, under the Canvas, so
 * everything inside it stays clear of the notch and the bottom bar.
 *
 * \author Kannan Shrinivasan (k.shrinivasan@digipen.edu.sg)
 *
 * Contribution: Kannan Shrinivasan 
 *
 * AI declaration: Claude was used as a support tool for writing and debugging code and for the comments.
 *
 * \date 2026-10-04
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using UnityEngine;

namespace WayforgeApp
{
    [RequireComponent(typeof(RectTransform))]
    public sealed class SafeArea : MonoBehaviour
    {
        //last safe area we used, so we only redo the work when it changes
        Rect previous;
        void Update()
        {
            var area = Screen.safeArea;
            //nothing changed (or screen has no size yet), so do nothing
            if (area == previous || Screen.width == 0 || Screen.height == 0) return;
            previous = area;
            var rect = (RectTransform)transform;
            //safeArea is in pixels, anchors are 0 to 1, so divide by the screen size
            rect.anchorMin = new Vector2(area.xMin / Screen.width, area.yMin / Screen.height);
            rect.anchorMax = new Vector2(area.xMax / Screen.width, area.yMax / Screen.height);
            //zero the offsets so the object fills the anchors exactly
            rect.offsetMin = rect.offsetMax = Vector2.zero;
        }
    }
}