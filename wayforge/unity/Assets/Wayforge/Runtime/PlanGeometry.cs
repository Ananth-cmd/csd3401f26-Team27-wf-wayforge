/*!
 * \file PlanGeometry.cs
 * \brief Maths for room outlines: area, centre and triangles
 *
 * Room outlines are lists of corners in metres (x right, y up).
 * SignedArea gives the floor area, Centroid gives the middle of the room
 * (for the label), and Triangulate cuts the outline into triangles so
 * L-shaped rooms can be filled in 2D and turned into a 3D floor.
 *
 * Used by: RoomData (Area, Centre, Triangles), StudioWindow, RoomBuilder.
 *
 * \author Katie Lim
 *
 * Contribution: Katie Lim 100%
 *   - Area, centre and triangle splitting for any room shape
 *
 * AI declaration: Claude was used as a support tool for writing and debugging code and for the comments.
 *
 * \date 2026-09-22
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

using System.Collections.Generic;
using UnityEngine;

namespace Wayforge
{
    // Maths helpers for room outlines (plan coordinates, metres, y up).
    public static class PlanGeometry
    {
        // Area of the outline. Positive when the corners go counter-clockwise, negative when clockwise.
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

        // The middle of the room (the plain average of the corners is wrong for L-shaped rooms)
        public static Vector2 Centroid(Vector2[] p)
        {
            if (p.Length == 0) return Vector2.zero;
            float area = SignedArea(p);
            if (Mathf.Abs(area) < 1e-6f)
            {
                // No area (all corners in a line): just use the average
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

        // Cuts any room outline (even L or U shapes) into triangles.
        // It keeps cutting off one corner triangle ("ear") at a time until only one triangle is left.
        // Returns corner indices, three per triangle, each triangle counter-clockwise.
        public static int[] Triangulate(Vector2[] p)
        {
            var tris = new List<int>();
            int n = p.Length;
            if (n < 3) return tris.ToArray();

            // Work counter-clockwise whatever order the corners came in
            var left = new List<int>(n);   // corners not cut off yet
            if (SignedArea(p) >= 0) for (int i = 0; i < n; i++) left.Add(i);
            else for (int i = n - 1; i >= 0; i--) left.Add(i);

            int guard = 0;   // stops the loop if something goes wrong
            while (left.Count > 3 && guard++ < 10000)
            {
                bool clipped = false;
                for (int i = 0; i < left.Count; i++)
                {
                    int a = left[(i + left.Count - 1) % left.Count], b = left[i], c = left[(i + 1) % left.Count];
                    if (Cross(p[b] - p[a], p[c] - p[b]) <= 1e-6f) continue;   // inward or flat corner: can't cut here

                    // The triangle can only be cut off if no other corner is inside it
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
                    // Nothing could be cut: usually a corner sitting in the middle of a straight edge. Drop the flattest one.
                    int flattest = 0;
                    float best = float.MaxValue;
                    for (int i = 0; i < left.Count; i++)
                    {
                        int a = left[(i + left.Count - 1) % left.Count], b = left[i], c = left[(i + 1) % left.Count];
                        float cross = Mathf.Abs(Cross(p[b] - p[a], p[c] - p[b]));
                        if (cross < best) { best = cross; flattest = i; }
                    }
                    if (best > 1e-4f) break;   // badly shaped outline: fill what is left below
                    left.RemoveAt(flattest);
                }
            }

            // Fill whatever is left with triangles from the first corner
            for (int i = 1; i + 1 < left.Count; i++)
            {
                tris.Add(left[0]); tris.Add(left[i]); tris.Add(left[i + 1]);
            }
            return tris.ToArray();
        }

        // Positive if v turns left from u, negative if it turns right
        static float Cross(Vector2 u, Vector2 v) => u.x * v.y - u.y * v.x;

        // True if p is inside triangle abc (not on its edges)
        static bool StrictlyInside(Vector2 p, Vector2 a, Vector2 b, Vector2 c)
        {
            const float eps = 1e-6f;
            return Cross(b - a, p - a) > eps && Cross(c - b, p - b) > eps && Cross(a - c, p - c) > eps;
        }
    }
}
