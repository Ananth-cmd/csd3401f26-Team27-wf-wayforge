// Floor.shader - room floor slabs, all rooms of a level in one mesh.
// Standard (metallic) lighting as Unity's Standard shader with no textures; the
// albedo is _Color times the vertex colour, so each room keeps its own colour
// while the whole level is drawn in one draw call.
//
// Author: Ananthan Elangovan (ananthan.e@digipen.edu)
// AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.
// Copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
Shader "Wayforge/Floor"
{
    Properties
    {
        _Color ("Color", Color) = (1, 1, 1, 1)
        _Glossiness ("Smoothness", Range(0, 1)) = 0.5
        _Metallic ("Metallic", Range(0, 1)) = 0
    }
    SubShader
    {
        Tags { "RenderType" = "Opaque" }

        CGPROGRAM
        #pragma surface surf Standard fullforwardshadows addshadow
        #pragma target 3.0

        fixed4 _Color;
        half _Glossiness;
        half _Metallic;

        struct Input { fixed4 color : COLOR; };

        void surf (Input IN, inout SurfaceOutputStandard o)
        {
            o.Albedo = _Color.rgb * IN.color.rgb;
            o.Metallic = _Metallic;
            o.Smoothness = _Glossiness;
            o.Alpha = 1;
        }
        ENDCG
    }
    FallBack "Diffuse"
}
