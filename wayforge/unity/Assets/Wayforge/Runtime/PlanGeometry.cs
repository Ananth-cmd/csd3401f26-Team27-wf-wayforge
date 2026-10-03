/*!
 * \file PlanGeometry.cs
 * \brief maths for room outlines: area, centre and triangles
 *
 * outlines are lists of corners in metres (x right, y up).
 * need the triangles so L shaped rooms fill properly in 2D and 3D.
 *
 * \author Katie Lim
 *
 * Contribution: Katie Lim 100%
 *   - area, centre and triangle splitting for any room shape
 *
 * AI declaration: used Claude to help write and debug the code and comments.
 *
 * \date 2026-09-22
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using System.Collections.Generic;
using UnityEngine;

namespace Wayforge
{
    // maths for room outlines (metres, y up)
    public static class PlanGeometry
    {
        // area of the outline. + if the corners go anticlockwise, - if clockwise
        public static float SignedArea(Vector2[] p)
        {
            float sum = 0;
            for (int i = 0; i < p.Length; i++)
            {
                Vector2 a = p[i], b = p[(i + 1) % p.Length];
                sum += a.x * b.y - b.x * a.y;
            }
            return sum * 0.5f;
        }

        // middle of the room. just averaging the corners is off for L shaped rooms
        public static Vector2 Centroid(Vector2[] p)
        {
            if (p.Length == 0) return Vector2.zero;
            float area = SignedArea(p);
            if (Mathf.Abs(area) < 1e-6f)
            {
                // no area (corners all in a line) so just average them
                Vector2 avg = Vector2.zero;
                foreach (var c in p) avg += c;
                return avg / p.Length;
            }
            float cx = 0, cy = 0;
            for (int i = 0; i < p.Length; i++)
            {
                Vector2 a = p[i], b = p[(i + 1) % p.Length];
                float cross = a.x * b.y - b.x * a.y;
                cx += (a.x + b.x) * cross;
                cy += (a.y + b.y) * cross;
            }
            return new Vector2(cx, cy) / (6f * area);
        }

        // cuts any room outline into triangles, works for L / U shapes too.
        // keeps cutting off 1 corner triangle (the "ear") at a time till 1 is left.
        // returns corner indices, 3 per triangle, all anticlockwise
        public static int[] Triangulate(Vector2[] p)
        {
            var tris = new List<int>();
            int n = p.Length;
            if (n < 3) return tris.ToArray();

            // make it anticlockwise no matter what order the corners came in
            var left = new List<int>(n);   // corners not cut off yet
            if (SignedArea(p) >= 0) for (int i = 0; i < n; i++) left.Add(i);
            else for (int i = n - 1; i >= 0; i--) left.Add(i);

            int guard = 0;   // just in case it loops forever
            while (left.Count > 3 && guard++ < 10000)
            {
                bool clipped = false;
                for (int i = 0; i < left.Count; i++)
                {
                    int a = left[(i + left.Count - 1) % left.Count], b = left[i], c = left[(i + 1) % left.Count];
                    if (Cross(p[b] - p[a], p[c] - p[b]) <= 1e-6f) continue;   // inward or flat corner, cant cut here

                    // can only cut it if no other corner is inside the triangle
                    bool empty = true;
                    foreach (int k in left)
                    {
                        if (k == a || k == b || k == c) continue;
                        if (StrictlyInside(p[k], p[a], p[b], p[c])) { empty = false; break; }
                    }
                    if (!empty) continue;

                    tris.Add(a); tris.Add(b); tris.Add(c);
                    left.RemoveAt(i);
                    clipped = true;
                    break;
                }

                if (!clipped)
                {
                    // nothing cut, usually a corner in the middle of a straight edge. drop the flattest one
                    int flattest = 0;
                    float best = float.MaxValue;
                    for (int i = 0; i < left.Count; i++)
                    {
                        int a = left[(i + left.Count - 1) % left.Count], b = left[i], c = left[(i + 1) % left.Count];
                        float cross = Mathf.Abs(Cross(p[b] - p[a], p[c] - p[b]));
                        if (cross < best) { best = cross; flattest = i; }
                    }
                    if (best > 1e-4f) break;   // bad outline, just fill whats left below
                    left.RemoveAt(flattest);
                }
            }

            // fill whats left with triangles from the first corner
            for (int i = 1; i + 1 < left.Count; i++)
            {
                tris.Add(left[0]); tris.Add(left[i]); tris.Add(left[i + 1]);
            }
            return tris.ToArray();
        }

        // + if v turns left from u, - if right
        static float Cross(Vector2 u, Vector2 v) => u.x * v.y - u.y * v.x;

        // true if p is inside triangle abc (not on the edge)
        static bool StrictlyInside(Vector2 p, Vector2 a, Vector2 b, Vector2 c)
        {
            const float eps = 1e-6f;
            return Cross(b - a, p - a) > eps && Cross(c - b, p - b) > eps && Cross(a - c, p - c) > eps;
        }
    }
}
