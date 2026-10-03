/*!
 * \file UISounds.cs
 * \brief UI sounds for the app prototype
 *
 * plays prof vuk's sounds (Resources/Audio) on every interaction.
 * starts by itself so i didnt have to touch the scene.
 *   any button     -> UI-Hover_Light
 *   any toggle     -> TileHover 2
 *   new screen     -> UI Hover 2
 *   arriving       -> TPL_Pickup_02
 *
 * \author Katie Lim
 *
 * Contribution: Katie Lim 100%
 *   - hooking sounds to every button, toggle and screen change
 *
 * AI declaration: used Claude to help write and debug the code and comments.
 *
 * \date 2026-10-02
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace WayforgeApp
{
    public sealed class UISounds : MonoBehaviour
    {
        AudioSource source;
        AudioClip tap, toggle, screen, arrive;
        CanvasNavigator app;
        AppScreen lastScreen;
        float nextScan;
        readonly HashSet<Object> hooked = new HashSet<Object>();

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Create() => DontDestroyOnLoad(new GameObject("UI Sounds", typeof(UISounds)));

        void Awake()
        {
            // need 1 AudioListener in the scene or theres no sound, add one if the camera doesnt have it
            if (FindFirstObjectByType<AudioListener>() == null) gameObject.AddComponent<AudioListener>();
            source = gameObject.AddComponent<AudioSource>();
            tap = Resources.Load<AudioClip>("Audio/UI-Hover_Light");
            toggle = Resources.Load<AudioClip>("Audio/TileHover 2");
            screen = Resources.Load<AudioClip>("Audio/UI Hover 2");
            arrive = Resources.Load<AudioClip>("Audio/TPL_Pickup_02");
        }

        void Update()
        {
            // every 0.5s hook up any new buttons/toggles (place cards get made while the app runs)
            if (Time.unscaledTime >= nextScan)
            {
                nextScan = Time.unscaledTime + 0.5f;
                foreach (var b in FindObjectsByType<Button>(FindObjectsSortMode.None))
                    if (hooked.Add(b)) b.onClick.AddListener(() => source.PlayOneShot(tap));
                foreach (var t in FindObjectsByType<Toggle>(FindObjectsSortMode.None))
                    if (hooked.Add(t)) t.onValueChanged.AddListener(_ => source.PlayOneShot(toggle));
                if (app == null && (app = FindFirstObjectByType<CanvasNavigator>()) != null) lastScreen = app.CurrentScreen;
            }

            // screen changed, arrival gets its own sound
            if (app != null && app.CurrentScreen != lastScreen)
            {
                lastScreen = app.CurrentScreen;
                source.PlayOneShot(lastScreen == AppScreen.Arrival ? arrive : screen);
            }
        }
    }
}
