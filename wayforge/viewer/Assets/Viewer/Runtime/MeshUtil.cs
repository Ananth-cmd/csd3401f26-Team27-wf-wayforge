/*!
 * \file MeshUtil.cs
 * \brief Polygon maths and mesh building for the viewer
 *
 * Centroid() and Triangulate() (ear clipping) handle any simple room
 * outline, including L and U shapes and rings joined to their hole by a cut. MeshBuilder collects vertices and
 * triangles with flat normals: AddWallBox() for one wall piece, AddSlab()
 * for an extruded room outline, AddBox() for axis-aligned boxes (stairs,
 * lift shafts, markers). ToWorld() maps plan (x, y) at height h to Unity
 * (x, h, y), so north (+y on the plan) is +z in the scene.
 *
 * Links: used by BuildingView (walls, floors, stairs, lifts) and RouteView.
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Ear-clipping triangulation, wall boxes and slab extrusion
 *
 * AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.
 *
 * \date 2026-10-18
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Wayforge.Viewer
{
    public static class MeshUtil
    {
        public static Vector3 ToWorld(Vector2 plan, float height) => new Vector3(plan.x, height, plan.y);

        // Destroy in play mode, DestroyImmediate in edit mode (editor tests build views without playing).
        public static void Kill(Object o)
        {
            if (o == null) return;
            if (Application.isPlaying) Object.Destroy(o); else Object.DestroyImmediate(o);
        }

        // Positive when the corners run anticlockwise (plan view, y up).
        public static float SignedArea(Vector2[] p)
        {
            float sum = 0f;
            for (int i = 0; i < p.Length; i++)
            {
                Vector2 a = p[i], b = p[(i + 1) % p.Length];
                sum += a.x * b.y - b.x * a.y;
            }
            return sum * 0.5f;
        }

        public static Vector2 Centroid(Vector2[] p)
        {
            if (p == null || p.Length == 0) return Vector2.zero;
            float area = SignedArea(p);
            if (Mathf.Abs(area) < 1e-6f)
            {
                Vector2 avg = Vector2.zero;
                foreach (var c in p) avg += c;
                return avg / p.Length;
            }
            float cx = 0f, cy = 0f;
            for (int i = 0; i < p.Length; i++)
            {
                Vector2 a = p[i], b = p[(i + 1) % p.Length];
                float cross = a.x * b.y - b.x * a.y;
                cx += (a.x + b.x) * cross;
                cy += (a.y + b.y) * cross;
            }
            return new Vector2(cx, cy) / (6f * area);
        }

        // Even-odd point-in-polygon test.
        public static bool Contains(Vector2[] poly, Vector2 p)
        {
            bool inside = false;
            for (int i = 0, j = poly.Length - 1; i < poly.Length; j = i++)
                if ((poly[i].y > p.y) != (poly[j].y > p.y) &&
                    p.x < (poly[j].x - poly[i].x) * (p.y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x)
                    inside = !inside;
            return inside;
        }

        public static Rect Bounds(Vector2[] p)
        {
            if (p == null || p.Length == 0) return new Rect();
            Vector2 min = p[0], max = p[0];
            foreach (var v in p) { min = Vector2.Min(min, v); max = Vector2.Max(max, v); }
            return Rect.MinMaxRect(min.x, min.y, max.x, max.y);
        }

        // Ear clipping. Returns indices into p, 3 per triangle, anticlockwise in plan view.
        public static int[] Triangulate(Vector2[] p)
        {
            var tris = new List<int>();
            int n = p.Length;
            if (n < 3) return tris.ToArray();

            var idx = new List<int>(n);
            if (SignedArea(p) >= 0f) for (int i = 0; i < n; i++) idx.Add(i);
            else for (int i = n - 1; i >= 0; i--) idx.Add(i);

            int guard = 0;
            while (idx.Count > 3 && guard++ < 10000)
            {
                bool clipped = false;
                for (int i = 0; i < idx.Count; i++)
                {
                    int ia = idx[(i + idx.Count - 1) % idx.Count], ib = idx[i], ic = idx[(i + 1) % idx.Count];
                    Vector2 a = p[ia], b = p[ib], c = p[ic];
                    if (Cross(b - a, c - b) <= 1e-9f) continue;            // reflex or straight corner
                    bool empty = true;
                    foreach (int k in idx)
                    {
                        if (k == ia || k == ib || k == ic) continue;
                        // Skip points on a triangle corner (corners repeated by a hole cut).
                        if (p[k] == a || p[k] == b || p[k] == c) continue;
                        if (InTriangle(p[k], a, b, c)) { empty = false; break; }
                    }
                    if (!empty) continue;
                    tris.Add(ia); tris.Add(ib); tris.Add(ic);
                    idx.RemoveAt(i);
                    clipped = true;
                    break;
                }
                if (!clipped) break;                                       // self-intersecting outline: give up on the rest
            }
            if (idx.Count == 3) { tris.Add(idx[0]); tris.Add(idx[1]); tris.Add(idx[2]); }
            return tris.ToArray();
        }

        static float Cross(Vector2 u, Vector2 v) => u.x * v.y - u.y * v.x;

        static bool InTriangle(Vector2 p, Vector2 a, Vector2 b, Vector2 c)
            => Cross(b - a, p - a) >= 0f && Cross(c - b, p - b) >= 0f && Cross(a - c, p - c) >= 0f;
    }

    // Vertices + triangles with one normal per face (no smoothing across box edges).
    public class MeshBuilder
    {
        readonly List<Vector3> _verts = new List<Vector3>();
        readonly List<Vector3> _normals = new List<Vector3>();
        readonly List<int> _tris = new List<int>();

        public int VertexCount => _verts.Count;

        // Unity draws a triangle (a, b, c) front-facing when Cross(b - a, c - a) points at the viewer.
        void AddTriangle(int a, int b, int c, Vector3 n)
        {
            Vector3 pa = _verts[a], pb = _verts[b], pc = _verts[c];
            if (Vector3.Dot(Vector3.Cross(pb - pa, pc - pa), n) >= 0f) { _tris.Add(a); _tris.Add(b); _tris.Add(c); }
            else { _tris.Add(a); _tris.Add(c); _tris.Add(b); }
        }

        // Quad a-b-c-d (in order around its edge), front side facing along n.
        public void AddQuad(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Vector3 n)
        {
            int s = _verts.Count;
            _verts.Add(a); _verts.Add(b); _verts.Add(c); _verts.Add(d);
            for (int i = 0; i < 4; i++) _normals.Add(n);
            AddTriangle(s, s + 1, s + 2, n);
            AddTriangle(s, s + 2, s + 3, n);
        }

        // Box between plan points from / to (along the wall), thickness across it, y0..y1 high.
        public void AddWallBox(Vector2 from, Vector2 to, float thickness, float y0, float y1)
        {
            Vector2 dir = to - from;
            if (dir.sqrMagnitude < 1e-8f || y1 <= y0) return;
            dir.Normalize();
            Vector2 side = new Vector2(-dir.y, dir.x) * (thickness * 0.5f);
            Vector2[] c = { from - side, to - side, to + side, from + side };   // footprint corners
            AddPrism(c, y0, y1, bottom: false);
        }

        // Axis-aligned box from min to max (world space).
        public void AddBox(Vector3 min, Vector3 max)
        {
            Vector2[] c = { new Vector2(min.x, min.z), new Vector2(max.x, min.z), new Vector2(max.x, max.z), new Vector2(min.x, max.z) };
            AddPrism(c, min.y, max.y, bottom: true);
        }

        // Room outline extruded from y0 to y1: top, sides and (optionally) bottom.
        public void AddSlab(Vector2[] outline, int[] tris, float y0, float y1)
        {
            AddPolygon(outline, tris, y1, up: true);
            AddPolygon(outline, tris, y0, up: false);
            AddSides(outline, y0, y1);
        }

        void AddPrism(Vector2[] footprint, float y0, float y1, bool bottom)
        {
            int[] tris = { 0, 1, 2, 0, 2, 3 };
            if (MeshUtil.SignedArea(footprint) < 0f) System.Array.Reverse(footprint);
            AddPolygon(footprint, tris, y1, up: true);
            if (bottom) AddPolygon(footprint, tris, y0, up: false);
            AddSides(footprint, y0, y1);
        }

        // Flat polygon at height y, facing up or down.
        void AddPolygon(Vector2[] outline, int[] tris, float y, bool up)
        {
            int s = _verts.Count;
            var n = up ? Vector3.up : Vector3.down;
            foreach (var p in outline) { _verts.Add(MeshUtil.ToWorld(p, y)); _normals.Add(n); }
            for (int i = 0; i + 2 < tris.Length; i += 3) AddTriangle(s + tris[i], s + tris[i + 1], s + tris[i + 2], n);
        }

        void AddSides(Vector2[] outline, float y0, float y1)
        {
            bool ccw = MeshUtil.SignedArea(outline) >= 0f;
            for (int i = 0; i < outline.Length; i++)
            {
                Vector2 a = outline[i], b = outline[(i + 1) % outline.Length];
                Vector2 e = b - a;
                if (e.sqrMagnitude < 1e-10f) continue;
                Vector2 out2 = ccw ? new Vector2(e.y, -e.x) : new Vector2(-e.y, e.x);   // outward in plan
                Vector3 n = new Vector3(out2.x, 0f, out2.y).normalized;
                AddQuad(MeshUtil.ToWorld(a, y0), MeshUtil.ToWorld(b, y0), MeshUtil.ToWorld(b, y1), MeshUtil.ToWorld(a, y1), n);
            }
        }

        public Mesh ToMesh(string name)
        {
            var m = new Mesh { name = name };
            if (_verts.Count > 65000) m.indexFormat = IndexFormat.UInt32;
            m.SetVertices(_verts);
            m.SetNormals(_normals);
            m.SetTriangles(_tris, 0);
            m.RecalculateBounds();
            return m;
        }
    }
}
