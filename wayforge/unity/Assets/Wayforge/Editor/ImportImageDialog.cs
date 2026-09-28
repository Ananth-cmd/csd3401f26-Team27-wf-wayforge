// Small popup shown after picking a floor-plan image in Studio: asks how wide
// the drawing is in real life, so walls come out in metres. Leaving it at 0
// uses the core's default of 1 pixel = 2 cm.

using System;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace Wayforge.Editor
{
    public class ImportImageDialog : EditorWindow
    {
        private string _imagePath;
        private float _widthMetres;
        private Action<string, float> _onImport;
        private Texture2D _preview;

        public static void Show(string imagePath, Action<string, float> onImport)
        {
            var w = CreateInstance<ImportImageDialog>();
            w.titleContent = new GUIContent("Import floor plan");
            w._imagePath = imagePath;
            w._onImport = onImport;
            w._preview = LoadPreview(imagePath);
            w.minSize = w.maxSize = new Vector2(380, w._preview != null ? 330 : 150);
            w.ShowUtility();
        }

        private void OnGUI()
        {
            EditorGUILayout.LabelField(Path.GetFileName(_imagePath), EditorStyles.boldLabel);
            if (_preview != null)
            {
                Rect r = GUILayoutUtility.GetRect(360, 180, GUILayout.ExpandWidth(true));
                GUI.DrawTexture(r, _preview, ScaleMode.ScaleToFit);
            }
            EditorGUILayout.Space(6);

            _widthMetres = Mathf.Max(0f, EditorGUILayout.FloatField(
                new GUIContent("Real width (m)", "How wide the whole drawing is in real life. 0 = assume 1 pixel = 2 cm."),
                _widthMetres));
            EditorGUILayout.HelpBox(_widthMetres > 0
                ? $"The drawing will be scaled to {_widthMetres:0.#} m wide."
                : "0 = automatic scale (1 pixel = 2 cm). Fine for the sample plans.", MessageType.None);

            GUILayout.FlexibleSpace();
            EditorGUILayout.BeginHorizontal();
            GUILayout.FlexibleSpace();
            if (GUILayout.Button("Cancel", GUILayout.Width(80))) Close();
            if (GUILayout.Button("Import", GUILayout.Width(80)))
            {
                var cb = _onImport; var path = _imagePath; var width = _widthMetres;
                Close();
                cb?.Invoke(path, width);
            }
            EditorGUILayout.EndHorizontal();
        }

        private void OnDestroy()
        {
            if (_preview != null) DestroyImmediate(_preview);
        }

        private static Texture2D LoadPreview(string path)
        {
            try
            {
                var tex = new Texture2D(2, 2);
                return tex.LoadImage(File.ReadAllBytes(path)) ? tex : null;
            }
            catch { return null; }
        }
    }
}
