// Splits a room outline into triangles (ear clipping). Real plans have L- and U-shaped rooms,
// which Handles.DrawAAConvexPolygon draws wrong, so PlanCanvas fills rooms triangle by triangle.
// The 3D view reuses the same triangles for room floors.

using System.Collections.Generic;
using UnityEngine;

namespace Wayforge
{
    public static class PolygonUtil
    {
        // Returns vertex indices, three per triangle. Works for simple (non-self-intersecting)
        // polygons in either winding order. Returns an empty list for fewer than 3 points.
        public static List<int> Triangulate(IReadOnlyList<Vector2> poly)
        {
            var tris = new List<int>();
            int n = poly?.Count ?? 0;
            if (n < 3) return tris;

            var idx = new List<int>(n);
            for (int i = 0; i < n; i++) idx.Add(i);
            if (SignedArea(poly) < 0) idx.Reverse(); // work counter-clockwise

            int guard = 0;
            while (idx.Count > 3 && guard++ < n * n)
            {
                bool clipped = false;
                for (int i = 0; i < idx.Count; i++)
                {
                    int ia = idx[(i + idx.Count - 1) % idx.Count], ib = idx[i], ic = idx[(i + 1) % idx.Count];
                    Vector2 a = poly[ia], b = poly[ib], c = poly[ic];
                    if (Cross(b - a, c - b) <= 1e-9f) continue; // reflex or flat corner, not an ear

                    bool containsOther = false;
                    for (int j = 0; j < idx.Count && !containsOther; j++)
                    {
                        int k = idx[j];
                        if (k == ia || k == ib || k == ic) continue;
                        containsOther = InTriangle(poly[k], a, b, c);
                    }
                    if (containsOther) continue;

                    tris.Add(ia); tris.Add(ib); tris.Add(ic);
                    idx.RemoveAt(i);
                    clipped = true;
                    break;
                }
                if (!clipped) break; // degenerate outline: stop rather than loop forever
            }
            if (idx.Count == 3) { tris.Add(idx[0]); tris.Add(idx[1]); tris.Add(idx[2]); }
            return tris;
        }

        public static float SignedArea(IReadOnlyList<Vector2> poly)
        {
            float s = 0;
            for (int i = 0, j = poly.Count - 1; i < poly.Count; j = i++) s += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
            return s * 0.5f;
        }

        private static float Cross(Vector2 u, Vector2 v) => u.x * v.y - u.y * v.x;

        private static bool InTriangle(Vector2 p, Vector2 a, Vector2 b, Vector2 c) =>
            Cross(b - a, p - a) >= 0 && Cross(c - b, p - b) >= 0 && Cross(a - c, p - c) >= 0;
    }
}
