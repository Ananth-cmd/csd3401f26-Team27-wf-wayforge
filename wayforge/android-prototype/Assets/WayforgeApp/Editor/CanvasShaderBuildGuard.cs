/*!
 * \file CanvasShaderBuildGuard.cs
 * \brief Makes sure required Unity UI shaders are included in player builds.
 *
 * This file checks that the shaders used by Unity Canvas UI are added to the
 * Always Included Shaders list before a build starts. This is needed because
 * some Canvas materials are created at runtime and may not be kept just from
 * scene references.
 *
 * The build guard runs automatically before building and can also be called
 * manually by the prototype setup code. If a required shader cannot be found,
 * the build is stopped with an error.
 *
 * Links: Used by PrototypeSetup before building the Android prototype and uses
 * Unity GraphicsSettings to keep the required Canvas shaders in the build.
 *
 * \author kervin ong guan cheng (kervinguancheng.ong@digipen.edu)
 *
 * Contribution: kervin ong guan cheng 100%
 * - Canvas shader checking
 * - Always Included Shaders setup
 * - Automatic pre-build validation
 * - Build failure handling for missing UI shaders
 *
 * AI declaration: Claude is used to help debug and test the code and comments.
 *
 * \date 2026-10-04
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

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
        // Run this build check before most other preprocess build callbacks.
        public int callbackOrder => -100;

        // Automatically check the required shaders before a build starts.
        public void OnPreprocessBuild(BuildReport report) => EnsureIncluded();

        // Makes sure all required Canvas shaders are kept in the player build.
        public static void EnsureIncluded()
        {
            // Store the shaders that must be included.
            var required = new HashSet<Shader>();

            // Add Unity's default Canvas and UI shaders.
            Add(required, Graphic.defaultGraphicMaterial.shader);
            Add(required, Shader.Find("UI/Default"));
            Add(required, Shader.Find("UI/DefaultETC1"));

            // Load Unity's Graphics Settings so the Always Included Shaders list can be edited.
            var settings = new SerializedObject(AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/GraphicsSettings.asset")[0]);

            // Get the Always Included Shaders array from the Graphics Settings.
            var included = settings.FindProperty("m_AlwaysIncludedShaders");

            // Check every required shader.
            foreach (var shader in required)
            {
                bool found = false;

                // Look through the existing included shaders.
                for (int i = 0; i < included.arraySize; i++)
                    if (included.GetArrayElementAtIndex(i).objectReferenceValue == shader) found = true;

                // Add the shader if it is not already included.
                if (!found)
                {
                    int index = included.arraySize; included.arraySize++;
                    included.GetArrayElementAtIndex(index).objectReferenceValue = shader;
                }

                // Print the included shader to the Unity Console.
                Debug.Log("CANVAS_SHADER_INCLUDED: " + shader.name);
            }

            // Apply the Graphics Settings changes and save the project assets.
            settings.ApplyModifiedPropertiesWithoutUndo(); AssetDatabase.SaveAssets();
        }

        // Adds a required shader to the set after checking that it is valid.
        static void Add(HashSet<Shader> shaders, Shader shader)
        {
            // Stop the build if Unity cannot find one of the required UI shaders.
            if (!shader || shader.name == "Hidden/InternalErrorShader")
                throw new BuildFailedException("A required Canvas shader is unavailable. Fix the UI shaders before building.");

            // Add the valid shader to the required set.
            shaders.Add(shader);
        }
    }
}
