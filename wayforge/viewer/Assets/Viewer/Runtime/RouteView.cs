/*!
 * \file RouteView.cs
 * \brief Draws a route from wf_cli / the backend on the 3D building
 *
 * Input is the route JSON produced by `wf_cli route` (or the backend that
 * wraps it): { "steps": [ { "level", "node", "x", "y", "z", "kind" }, ... ] }.
 * A bare array of steps is accepted too. The path is drawn as one line per
 * run of steps on the same level, 0.3 m above the floor, plus a connecting
 * line wherever the route changes level. Markers: start (green), end (red)
 * and each stair (orange) or lift (blue) change. Optionally a dot travels
 * along the route on a loop.
 *
 * With a single floor shown, only that floor's part of the route is visible.
 *
 * Links: ViewerApi.ShowRoute / ClearRoute; heights come from
 * BuildingView.LevelHeight() so the route follows the exploded view.
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Route lines per floor, floor-change links, markers and travelling dot
 *
 * AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.
 *
 * \date 2026-10-18
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using System;
using System.Collections.Generic;
using UnityEngine;

namespace Wayforge.Viewer
{
    public class RouteView : MonoBehaviour
    {
        [SerializeField] Material lineMaterial;
        [SerializeField] Material markerMaterial;
        [SerializeField] float lineWidth = 0.35f;
        [SerializeField] float dotSpeed = 4f;                // metres per second

        const float LineHeight = 0.3f;                       // above the floor

        public struct Step
        {
            public string level, node, kind;
            public Vector2 plan;
            public float z;                                  // elevation from the route JSON
        }

        public bool HasRoute => _steps.Count > 1;

        readonly List<Step> _steps = new List<Step>();
        readonly List<(GameObject go, string level)> _parts = new List<(GameObject, string)>();   // level null = between floors
        readonly List<UnityEngine.Object> _owned = new List<UnityEngine.Object>();
        readonly List<Vector3> _path = new List<Vector3>();
        GameObject _root;
        Transform _dot;
        float _dotDistance, _pathLength;
        bool _animate;

        // Parses the route JSON. Throws FormatException on bad input or { "ok": false }.
        public static List<Step> Parse(string json)
        {
            object root = Json.Parse(json);
            List<object> steps = root as List<object>;
            if (steps == null)
            {
                if (root is Dictionary<string, object> d && d.TryGetValue("ok", out var ok) && ok is bool b && !b)
                    throw new FormatException(Json.Str(root, "error", "route failed"));
                steps = Json.Arr(root, "steps") ?? Json.Arr(Json.Obj(root, "route"), "steps");
            }
            if (steps == null) throw new FormatException("route JSON has no \"steps\"");
            var list = new List<Step>();
            foreach (var s in steps)
                list.Add(new Step
                {
                    level = Json.Str(s, "level"),
                    node = Json.Str(s, "node"),
                    kind = Json.Str(s, "kind", "corridor"),
                    plan = new Vector2(Json.Num(s, "x"), Json.Num(s, "y")),
                    z = Json.Num(s, "z"),
                });
            return list;
        }

        // Draws the route. view supplies floor heights; animate = travelling dot.
        public void Show(List<Step> steps, BuildingView view, bool animate)
        {
            Clear();
            _steps.AddRange(steps);
            _animate = animate;
            if (_steps.Count < 2) return;

            _root = new GameObject("Route");
            _root.transform.SetParent(transform, false);

            Vector3 P(int i) => MeshUtil.ToWorld(_steps[i].plan, Height(view, _steps[i]) + LineHeight);

            // Runs of steps on the same level become one line each.
            int start = 0;
            for (int i = 1; i <= _steps.Count; i++)
            {
                bool end = i == _steps.Count || _steps[i].level != _steps[start].level;
                if (!end) continue;
                var pts = new List<Vector3>();
                for (int k = start; k < i; k++) pts.Add(P(k));
                if (pts.Count >= 2) AddLine(pts, _steps[start].level);
                if (i < _steps.Count)
                {
                    AddLine(new List<Vector3> { P(i - 1), P(i) }, null);   // stairs / lift between floors
                    string kind = _steps[i - 1].kind == "lift" || _steps[i].kind == "lift" ? "lift" : "stair";
                    AddMarker(P(i - 1), kind == "lift" ? new Color(0.3f, 0.4f, 1f) : new Color(1f, 0.55f, 0.1f), 0.7f, _steps[i - 1].level);
                }
                start = i;
            }
            AddMarker(P(0), new Color(0.15f, 0.75f, 0.3f), 1f, _steps[0].level);
            AddMarker(P(_steps.Count - 1), new Color(0.9f, 0.2f, 0.2f), 1f, _steps[_steps.Count - 1].level);

            for (int i = 0; i < _steps.Count; i++) _path.Add(P(i));
            _pathLength = 0f;
            for (int i = 1; i < _path.Count; i++) _pathLength += Vector3.Distance(_path[i - 1], _path[i]);
            if (_animate)
            {
                _dot = MakeMarker(Color.white, 0.5f, PrimitiveType.Sphere).transform;
                _dotDistance = 0f;
            }
            SetVisibleLevel(view.VisibleLevel);
        }

        public void Clear()
        {
            if (_root != null) MeshUtil.Kill(_root);
            foreach (var o in _owned) if (o != null) MeshUtil.Kill(o);
            _owned.Clear(); _parts.Clear(); _steps.Clear(); _path.Clear();
            _root = null; _dot = null;
        }

        // levelId null = all floors.
        public void SetVisibleLevel(string levelId)
        {
            foreach (var (go, level) in _parts)
                go.SetActive(levelId == null || level == levelId);
            if (_dot != null) _dot.gameObject.SetActive(levelId == null);
        }

        static float Height(BuildingView view, Step s)
        {
            if (view != null && view.Building != null && view.Building.FindLevel(s.level) != null) return view.LevelHeight(s.level);
            return s.z;
        }

        void AddLine(List<Vector3> pts, string level)
        {
            var go = new GameObject(level == null ? "Between floors" : "Route " + level);
            go.transform.SetParent(_root.transform, false);
            var lr = go.AddComponent<LineRenderer>();
            lr.sharedMaterial = lineMaterial;
            lr.useWorldSpace = true;
            lr.widthMultiplier = lineWidth;
            lr.numCornerVertices = 4;
            lr.numCapVertices = 4;
            lr.positionCount = pts.Count;
            lr.SetPositions(pts.ToArray());
            lr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            _parts.Add((go, level));
        }

        void AddMarker(Vector3 at, Color colour, float size, string level)
        {
            var go = MakeMarker(colour, size, PrimitiveType.Cylinder);
            go.transform.position = at + Vector3.up * (size * 0.25f);
            go.transform.localScale = new Vector3(size, size * 0.25f, size);
            _parts.Add((go, level));
        }

        GameObject MakeMarker(Color colour, float size, PrimitiveType shape)
        {
            var go = GameObject.CreatePrimitive(shape);
            MeshUtil.Kill(go.GetComponent<Collider>());                  // markers must not block room picking
            go.transform.SetParent(_root.transform, false);
            go.transform.localScale = Vector3.one * size;
            var mat = new Material(markerMaterial) { color = colour };
            _owned.Add(mat);
            go.GetComponent<MeshRenderer>().sharedMaterial = mat;
            return go;
        }

        void Update()
        {
            if (_dot == null || _pathLength <= 0f) return;
            _dotDistance = (_dotDistance + dotSpeed * Time.deltaTime) % (_pathLength + 2f);   // short pause at the end
            float d = Mathf.Min(_dotDistance, _pathLength);
            for (int i = 1; i < _path.Count; i++)
            {
                float seg = Vector3.Distance(_path[i - 1], _path[i]);
                if (d <= seg || i == _path.Count - 1)
                {
                    _dot.position = Vector3.Lerp(_path[i - 1], _path[i], seg > 0f ? Mathf.Clamp01(d / seg) : 1f) + Vector3.up * 0.1f;
                    return;
                }
                d -= seg;
            }
        }
    }
}
