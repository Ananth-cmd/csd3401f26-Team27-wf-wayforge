/*!
 * \file StudioAudio.cs
 * \brief sounds for Studio: 1 bgm + 8 sfx
 *
 * which sound plays for which action comes from
 * Assets/Wayforge/Audio/audio_config.json, not the code. to change a
 * sound just swap the file or edit the config, no recompile needed.
 * music and each sfx get their own AudioSource so nothing gets cut off.
 *
 * \author Katie Lim
 *
 * Contribution: Katie Lim 100%
 *   - reading the sounds from the config + reloading when it changes
 *   - playing music and 8+ sounds at the same time in the editor
 *
 * AI declaration: used Claude to help write and debug the code and comments.
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
        // what audio_config.json looks like
        [Serializable] class Sound { public string id; public string file; public float volume = 1f; }
        [Serializable] class Music { public string file; public float volume = 0.3f; }
        [Serializable] class Config { public Music bgm; public Sound[] sfx; }

        const string Folder = "Assets/Wayforge/Audio";
        const string ConfigPath = Folder + "/audio_config.json";

        static Config config;
        static readonly Dictionary<string, Sound> sounds = new Dictionary<string, Sound>();
        static DateTime configTime;           // when the config was last read
        static GameObject speaker;            // hidden object holding the audio sources
        static AudioSource music;
        static readonly List<AudioSource> channels = new List<AudioSource>();

        public static bool MusicOn { get; private set; } = true;
        public static string LastSound { get; private set; } = "";   // shown in the sidebar

        // playing

        // play the sound for an action eg Play("make_3d"). does nothing if its not in the config
        public static void Play(string id) => Play(id, 0f, null);

        // same but starts after delay secs (uses the audio clock so its exact).
        // taken = channels already used so a delayed sound doesnt lose its channel
        static void Play(string id, float delay, List<AudioSource> taken)
        {
            ReloadIfChanged();
            if (!sounds.TryGetValue(id, out var sound)) return;
            var clip = AssetDatabase.LoadAssetAtPath<AudioClip>(Folder + "/" + sound.file);
            if (clip == null) { Debug.LogWarning("Wayforge audio: can't find " + sound.file); return; }

            var channel = FreeChannel(taken);
            taken?.Add(channel);
            channel.clip = clip;
            channel.volume = sound.volume;
            channel.PlayDelayed(delay);
            LastSound = id + " → " + sound.file;
        }

        // play all 8, 0.03s apart so theyre all playing together. each plays till the end
        public static void PlayAll()
        {
            ReloadIfChanged();
            if (config == null) return;
            var taken = new List<AudioSource>();
            for (int i = 0; i < config.sfx.Length; i++)
                Play(config.sfx[i].id, i * 0.03f, taken);
            LastSound = "all " + config.sfx.Length + " sounds";
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

        // how many sfx are playing now
        public static int PlayingCount()
        {
            int n = 0;
            foreach (var c in channels) if (c != null && c.isPlaying) n++;
            return n;
        }

        // when Studio closes, stop everything and delete the hidden object
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

        // channels

        // hidden object with 1 music + 8 sfx sources. doesnt get saved in the scene
        static void Setup()
        {
            if (speaker != null) return;
            speaker = EditorUtility.CreateGameObjectWithHideFlags("Wayforge Studio Audio", HideFlags.HideAndDontSave);
            music = speaker.AddComponent<AudioSource>();
            music.loop = true;
            channels.Clear();
            for (int i = 0; i < 8; i++) AddChannel();
        }

        // get a free one. if all busy add another so nothing gets cut off
        static AudioSource FreeChannel(List<AudioSource> taken)
        {
            Setup();
            foreach (var c in channels)
                if (!c.isPlaying && (taken == null || !taken.Contains(c))) return c;
            return AddChannel();
        }

        static AudioSource AddChannel()
        {
            var c = speaker.AddComponent<AudioSource>();
            c.playOnAwake = false;
            channels.Add(c);
            return c;
        }

        // reading the config

        // reread the config if it changed. unity reloads the sound files itself
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

            // music might have changed too
            if (music != null && music.isPlaying)
            {
                var clip = config?.bgm == null ? null : AssetDatabase.LoadAssetAtPath<AudioClip>(Folder + "/" + config.bgm.file);
                if (clip != music.clip) { StopMusic(); StartMusic(); }
            }
        }

        // list of sounds for the Audio menu
        public static string[] SoundIds()
        {
            ReloadIfChanged();
            var ids = new List<string>();
            if (config?.sfx != null) foreach (var s in config.sfx) ids.Add(s.id);
            return ids.ToArray();
        }
    }
}
