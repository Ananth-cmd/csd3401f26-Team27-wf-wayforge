using System.Collections.Generic;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEngine;
using UnityEngine.UI;

namespace WayforgeApp.Editor
{
    // Canvas default materials are supplied at runtime, so scene references alone
    // are not enough to retain their shaders in a player build.
    public sealed class CanvasShaderBuildGuard : IPreprocessBuildWithReport
    {
        public int callbackOrder => -100;

        public void OnPreprocessBuild(BuildReport report) => EnsureIncluded();

        public static void EnsureIncluded()
        {
            var required = new HashSet<Shader>();
            Add(required, Graphic.defaultGraphicMaterial.shader);
            Add(required, Shader.Find("UI/Default"));
            Add(required, Shader.Find("UI/DefaultETC1"));

            var settings = new SerializedObject(AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/GraphicsSettings.asset")[0]);
            var included = settings.FindProperty("m_AlwaysIncludedShaders");
            foreach (var shader in required)
            {
                bool found = false;
                for (int i = 0; i < included.arraySize; i++)
                    if (included.GetArrayElementAtIndex(i).objectReferenceValue == shader) found = true;
                if (!found)
                {
                    int index = included.arraySize; included.arraySize++;
                    included.GetArrayElementAtIndex(index).objectReferenceValue = shader;
                }
                Debug.Log("CANVAS_SHADER_INCLUDED: " + shader.name);
            }
            settings.ApplyModifiedPropertiesWithoutUndo(); AssetDatabase.SaveAssets();
        }

        static void Add(HashSet<Shader> shaders, Shader shader)
        {
            if (!shader || shader.name == "Hidden/InternalErrorShader")
                throw new BuildFailedException("A required Canvas shader is unavailable. Fix the UI shaders before building.");
            shaders.Add(shader);
        }
    }
}
