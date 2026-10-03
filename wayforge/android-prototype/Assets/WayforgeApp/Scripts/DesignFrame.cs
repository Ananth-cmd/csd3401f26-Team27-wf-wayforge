/*!
 * \file DesignFrame.cs
 * \brief Scales the 390 x 844 design board to fit the phone screen
 *
 * The UI is laid out on a board that is 390 x 844. This script shrinks or
 * grows that board to fit inside its parent without cutting anything off, so
 * the layout looks the same on different phone sizes. It runs in the editor
 * as well, so the board is scaled in the Scene view too.
 *
 * Links: put on the board object that holds the screens, inside the parent
 * canvas area it should fit into.
 *
 * \author Kannan Shrinivasan (k.shrinivasan@digipen.edu.sg)
 *
 * Contribution: Kannan Shrinivasan 
 *   - Working out the fit scale from the parent size
 *   - Applying it to the board
 *
 * AI declaration: Claude was used as a support tool for writing and debugging code and for the comments.
 *
 * \date 2026-10-04
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using UnityEngine;

namespace WayforgeApp
{
    // Keeps a 390 x 844 design board inside the available phone area without clipping.
    [ExecuteAlways, RequireComponent(typeof(RectTransform))]
    public sealed class DesignFrame : MonoBehaviour
    {
        //runs every frame, also in the editor because of ExecuteAlways
        void Update()
        {
            var rect = (RectTransform)transform;
            var parent = transform.parent as RectTransform;
            //skip if there is no parent or it has no size yet
            if (!parent || parent.rect.width <= 0 || parent.rect.height <= 0) return;
            //smaller of the two ratios, so the whole board fits and nothing gets cut off
            float scale = Mathf.Min(parent.rect.width / 390f, parent.rect.height / 844f);
            rect.localScale = Vector3.one * scale;
        }
    }
}