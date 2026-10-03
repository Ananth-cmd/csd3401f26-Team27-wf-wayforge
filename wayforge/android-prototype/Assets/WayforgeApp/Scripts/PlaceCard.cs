/*!
 * \file PlaceCard.cs
 * \brief One card in the list of places (name, floor and room code, tap to select)
 *
 * Sits on the PlaceCard prefab. The prefab controls how the card looks, and
 * this script only fills in the text and sets what happens when the card is
 * tapped. Bind can be called again on the same card to show a different place.
 *
 * Links: the script that builds the list of places calls Bind for each card;
 * Place holds the name and room code that are shown.
 *
 * \author Kannan Shrinivasan (k.shrinivasan@digipen.edu.sg)
 *
 * Contribution: Kannan Shrinivasan 
 
 * AI declaration: Claude was used as a support tool for writing and debugging code and for the comments.
 *
 * \date 2026-10-03
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using System;
using UnityEngine;
using UnityEngine.UI;

namespace WayforgeApp
{
    // Appearance belongs to the PlaceCard prefab. Only data and its click action change here.
    public sealed class PlaceCard : MonoBehaviour
    {
        public Text title;
        public Text subtitle;
        public Button button;

        //fills the card and sets what tapping it does, can be called again to reuse the card
        public void Bind(Place place, string floor, Action select)
        {
            title.text = place.name;
            subtitle.text = floor + " · " + place.code;
            //clears the old tap action first so reused cards dont run the old place too
            button.onClick.RemoveAllListeners();
            button.onClick.AddListener(() => select());
        }
    }
}