/*!
 * \file StudioAudio.cs
 * \brief Sound feedback for Wayforge Studio: 1 background music + 8 sound effects
 *
 * Which sound plays for which action is read from
 * Assets/Wayforge/Audio/audio_config.json, not written in the code.
 * To change a sound, drop a new file into that folder and/or edit the
 * config. Studio notices the change and reloads by itself, with no
 * recompiling.
 *
 * The music and every sound effect have their own channel (AudioSource),
 * so a new sound never cuts off one that is still playing.
 *
 * Used by: StudioWindow (plays a sound on import, Make 3D, select, ...).
 *
 * \author Katie Lim
 *
 * Contribution: Katie Lim 100%
 *   - Reading sounds from the config, reloading when files change
 *   - Playing music and up to 8+ sounds at the same time in the Editor
 *
 * AI declaration: Claude was used as a support tool for writing and debugging code and for the comments.
 *
 * \date 2026-10-02
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace Wayforge.Editor
{
    public static class StudioAudio
    {
        // What audio_config.json looks like
        [Serializable] class Sound { public string id; public string file; public float volume = 1f; }
        [Serializable] class Music { public string file; public float volume = 0.3f; }
        [Serializable] class Config { public Music bgm; public Sound[] sfx; }

        const string Folder = "Assets/Wayforge/Audio";
        const string ConfigPath = Folder + "/audio_config.json";

        static Config config;
        static readonly Dictionary<string, Sound> sounds = new Dictionary<string, Sound>();
        static DateTime configTime;           // when the config was last read
        static GameObject speaker;            // hidden object that holds the channels
        static AudioSource music;
        static readonly List<AudioSource> channels = new List<AudioSource>();

        public static bool MusicOn { get; private set; } = true;
        public static string LastSound { get; private set; } = "";   // shown in the Studio sidebar

        // ---------- Playing ----------

        // Plays the sound for an action, e.g. Play("make_3d"). Does nothing if it is not in the config.
        public static void Play(string id)
        {
            ReloadIfChanged();
            if (!sounds.TryGetValue(id, out var sound)) return;
            var clip = AssetDatabase.LoadAssetAtPath<AudioClip>(Folder + "/" + sound.file);
            if (clip == null) { Debug.LogWarning("Wayforge audio: can't find " + sound.file); return; }

            var channel = FreeChannel();
            channel.clip = clip;
            channel.volume = sound.volume;
            channel.Play();
            LastSound = id + " → " + sound.file;
        }

        // Plays all 8 sounds one after another, 0.15 s apart. Each one plays to the end.
        public static void PlayAll()
        {
            ReloadIfChanged();
            if (config == null) return;
            double start = EditorApplication.timeSinceStartup;
            int next = 0;
            EditorApplication.CallbackFunction tick = null;
            tick = () =>
            {
                if (EditorApplication.timeSinceStartup - start < next * 0.15) return;
                Play(config.sfx[next].id);
                if (++next >= config.sfx.Length) EditorApplication.update -= tick;
            };
            EditorApplication.update += tick;
        }

        public static void StartMusic()
        {
            ReloadIfChanged();
            if (!MusicOn || config?.bgm == null) return;
            var clip = AssetDatabase.LoadAssetAtPath<AudioClip>(Folder + "/" + config.bgm.file);
            if (clip == null) return;
            Setup();
            if (music.isPlaying && music.clip == clip) return;
            music.clip = clip;
            music.volume = config.bgm.volume;
            music.Play();
        }

        public static void StopMusic()
        {
            if (music != null) music.Stop();
        }

        public static void ToggleMusic()
        {
            MusicOn = !MusicOn;
            if (MusicOn) StartMusic(); else StopMusic();
        }

        // How many sound effects are playing right now
        public static int PlayingCount()
        {
            int n = 0;
            foreach (var c in channels) if (c != null && c.isPlaying) n++;
            return n;
        }

        // Called when Studio closes: stop everything and remove the hidden object
        public static void Shutdown()
        {
            if (speaker != null) UnityEngine.Object.DestroyImmediate(speaker);
            speaker = null;
            music = null;
            channels.Clear();
        }

        public static void OpenConfig()
        {
            var asset = AssetDatabase.LoadAssetAtPath<TextAsset>(ConfigPath);
            if (asset != null) AssetDatabase.OpenAsset(asset);
        }

        // ---------- Channels ----------

        // A hidden object with 1 music channel and 8 sound channels. It is never saved in the scene.
        static void Setup()
        {
            if (speaker != null) return;
            speaker = EditorUtility.CreateGameObjectWithHideFlags("Wayforge Studio Audio", HideFlags.HideAndDontSave);
            music = speaker.AddComponent<AudioSource>();
            music.loop = true;
            channels.Clear();
            for (int i = 0; i < 8; i++) AddChannel();
        }

        // A channel that is free. If all are busy, add another one, so nothing gets cut off.
        static AudioSource FreeChannel()
        {
            Setup();
            foreach (var c in channels) if (!c.isPlaying) return c;
            return AddChannel();
        }

        static AudioSource AddChannel()
        {
            var c = speaker.AddComponent<AudioSource>();
            c.playOnAwake = false;
            channels.Add(c);
            return c;
        }

        // ---------- Reading the config ----------

        // Reads the config again if it was saved since last time. Sound files are reloaded by Unity itself.
        static void ReloadIfChanged()
        {
            string fullPath = Path.GetFullPath(ConfigPath);
            if (!File.Exists(fullPath)) { config = null; sounds.Clear(); return; }
            var time = File.GetLastWriteTimeUtc(fullPath);
            if (config != null && time == configTime) return;

            configTime = time;
            config = JsonUtility.FromJson<Config>(File.ReadAllText(fullPath));
            sounds.Clear();
            if (config?.sfx != null)
                foreach (var s in config.sfx) sounds[s.id] = s;

            // the music file may have changed too
            if (music != null && music.isPlaying)
            {
                var clip = config?.bgm == null ? null : AssetDatabase.LoadAssetAtPath<AudioClip>(Folder + "/" + config.bgm.file);
                if (clip != music.clip) { StopMusic(); StartMusic(); }
            }
        }

        // The list of sounds, for the Audio menu in Studio
        public static string[] SoundIds()
        {
            ReloadIfChanged();
            var ids = new List<string>();
            if (config?.sfx != null) foreach (var s in config.sfx) ids.Add(s.id);
            return ids.ToArray();
        }
    }
}
