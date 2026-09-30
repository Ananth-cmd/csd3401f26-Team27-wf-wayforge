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

        public void Bind(Place place, string floor, Action select)
        {
            title.text = place.name;
            subtitle.text = floor + " · " + place.code;
            button.onClick.RemoveAllListeners();
            button.onClick.AddListener(() => select());
        }
    }
}
