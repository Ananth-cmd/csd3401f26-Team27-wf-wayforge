using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace WayforgeApp
{
    // Plays the UI sounds (Resources/Audio) on every interaction. It starts by itself, so no scene changes are needed.
    //   Any button          -> UI-Hover_Light
    //   Any toggle          -> TileHover 2
    //   A new screen opens  -> UI Hover 2
    //   Arriving            -> TPL_Pickup_02
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
            // Sound needs one AudioListener (the "ears") in the scene; add it if the camera has none
            if (FindFirstObjectByType<AudioListener>() == null) gameObject.AddComponent<AudioListener>();
            source = gameObject.AddComponent<AudioSource>();
            tap = Resources.Load<AudioClip>("Audio/UI-Hover_Light");
            toggle = Resources.Load<AudioClip>("Audio/TileHover 2");
            screen = Resources.Load<AudioClip>("Audio/UI Hover 2");
            arrive = Resources.Load<AudioClip>("Audio/TPL_Pickup_02");
        }

        void Update()
        {
            // Twice a second, give a sound to any new button or toggle (place cards are made while the app runs)
            if (Time.unscaledTime >= nextScan)
            {
                nextScan = Time.unscaledTime + 0.5f;
                foreach (var b in FindObjectsByType<Button>(FindObjectsSortMode.None))
                    if (hooked.Add(b)) b.onClick.AddListener(() => source.PlayOneShot(tap));
                foreach (var t in FindObjectsByType<Toggle>(FindObjectsSortMode.None))
                    if (hooked.Add(t)) t.onValueChanged.AddListener(_ => source.PlayOneShot(toggle));
                if (app == null && (app = FindFirstObjectByType<CanvasNavigator>()) != null) lastScreen = app.CurrentScreen;
            }

            // A different screen opened: arrival gets its own sound
            if (app != null && app.CurrentScreen != lastScreen)
            {
                lastScreen = app.CurrentScreen;
                source.PlayOneShot(lastScreen == AppScreen.Arrival ? arrive : screen);
            }
        }
    }
}
