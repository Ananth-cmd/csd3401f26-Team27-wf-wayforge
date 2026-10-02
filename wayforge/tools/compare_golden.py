#!/usr/bin/env python3
"""
\\file compare_golden.py
\\brief Check that a converted building.wfb matches its golden file

Usage:
    python tools/compare_golden.py <actual.wfb> <expected.wfb> [--tol 0.01] [--update]

Exit codes:
    0  files match (or --update wrote the expected file)
    1  files differ (the first difference is printed)
    2  bad usage, missing file, or invalid JSON

Ids (w1, r3, n7 ...) are regenerated on every convert, so they are ignored.
Elements are compared by geometry: each expected element must be matched
by exactly one actual element whose numbers are within --tol.

Links: run_golden.py calls this once per golden file after `wf_cli convert`.
The CI job "golden-checker" (.github/workflows/build.yml) self-tests it
against tools/testdata/ before any C++ is built.

\\author Joel Chua (c.jialiang@digipen.edu)

Contribution: Joel Chua 100%
  - Id-free "shape" comparison so regenerated ids never cause false failures
  - Tolerance-based float matching, scaled for room areas
  - --update mode for refreshing a golden file on purpose

AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the header comments.

\\date 2026-09-15
\\copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
"""

import argparse   # Command-line parsing (actual, expected, --tol, --update).
import json       # .wfb files are plain JSON.
import math       # hypot / sqrt for wall lengths and area tolerance.
import shutil     # copyfile for --update.
import sys        # exit codes and stderr.


class Mismatch(Exception):
    """Raised with a plain-words message at the first difference found."""


# ---------------------------------------------------------------- loading

def load_wfb(path):
    """Read a .wfb file and return it as a dict, or exit with code 2 if it can't be read."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        fail_usage(f"{path}: file not found")
    except json.JSONDecodeError as e:
        # Point at the exact line/column so a hand-edited golden file is easy to fix.
        fail_usage(f"{path}: not valid JSON (line {e.lineno}, column {e.colno}): {e.msg}")


def fail_usage(message):
    """Print an error and exit with code 2 (bad input, as opposed to a real mismatch)."""
    print(f"error: {message}", file=sys.stderr)
    sys.exit(2)


# ---------------------------------------------------------------- helpers

def fmt(p):
    """Format an [x, y] point for messages, e.g. (1.250, 3.000)."""
    return f"({p[0]:.3f}, {p[1]:.3f})"


def close(a, b, tol):
    """True if two numbers are within tol of each other."""
    return abs(a - b) <= tol


def point_close(p, q, tol):
    """True if two [x, y] points are within tol on both axes."""
    return close(p[0], q[0], tol) and close(p[1], q[1], tol)


def ordered_segment(a, b):
    """A wall from a to b is the same wall as one from b to a."""
    # Always put the "smaller" end first so both directions compare equal.
    return (a, b) if tuple(a) <= tuple(b) else (b, a)


# ------------------------------------------- turning elements into "shapes"
# Each shape is a dict with no ids in it, only things that should be stable.

def wall_shapes(level):
    """Describe each wall by its two end points and thickness."""
    shapes = []
    for w in level.get("walls", []):
        a, b = ordered_segment(w["a"], w["b"])
        # 0.15 m is the converter's default wall thickness when none is written.
        shapes.append({"a": a, "b": b, "thickness": w.get("thickness", 0.15)})
    return shapes


def opening_shapes(level):
    """Openings point at a wall id, so turn them into a world position instead."""
    walls = {w["id"]: w for w in level.get("walls", [])}
    shapes = []
    for o in level.get("openings", []):
        w = walls.get(o["wall"])
        if w is None:
            raise Mismatch(f"opening {o.get('id')} refers to missing wall {o['wall']}")
        ax, ay = w["a"]
        bx, by = w["b"]
        # "or 1.0" avoids dividing by zero on a zero-length wall.
        length = math.hypot(bx - ax, by - ay) or 1.0
        # offset is measured from wall end a to the opening's edge; add half the width to get its centre.
        t = o.get("offset", 0.0) + o.get("width", 0.9) / 2.0
        # Walk t metres along the wall from a to find the centre point.
        mid = [ax + (bx - ax) * t / length, ay + (by - ay) * t / length]
        shapes.append({"pos": mid, "width": o.get("width", 0.9), "type": o.get("type", "door")})
    return shapes


def room_shapes(level):
    """Describe each room by centroid, area, corner count, kind and code (not its exact polygon)."""
    shapes = []
    for r in level.get("rooms", []):
        shapes.append({
            "centroid": r.get("centroid", [0, 0]),
            "area": r.get("area", 0.0),
            # Comparing the corner count instead of every point means the polygon
            # can start at a different corner and still match.
            "corners": len(r.get("polygon", [])),
            "kind": r.get("kind", "unknown"),
            "code": r.get("code", ""),
        })
    return shapes


def node_shapes(level):
    """Describe each navigation node by its position and kind."""
    return [{"pos": n["pos"], "kind": n.get("kind", "corridor")} for n in level.get("nodes", [])]


def edge_shapes(level):
    """Edges point at node ids, so describe them by their two end positions."""
    nodes = {n["id"]: n["pos"] for n in level.get("nodes", [])}
    shapes = []
    for e in level.get("edges", []):
        if e["a"] not in nodes or e["b"] not in nodes:
            raise Mismatch(f"edge {e['a']}-{e['b']} refers to a missing node")
        # Edges are two-way, so order the ends the same way as walls.
        a, b = ordered_segment(nodes[e["a"]], nodes[e["b"]])
        shapes.append({"a": a, "b": b, "stepFree": e.get("stepFree", True)})
    return shapes


# ---------------------------------------------------- comparing shapes

def shapes_match(s, t, tol):
    """True if every field of shape s matches the same field of shape t."""
    for key, v in s.items():
        w = t[key]
        if isinstance(v, list):
            # Lists are [x, y] points.
            if not point_close(v, w, tol):
                return False
        elif isinstance(v, float) or isinstance(w, float):
            # Shifting every wall by tol changes an area by about tol * perimeter.
            # A square of this area has perimeter 4 * sqrt(area), so use that.
            limit = tol * 4 * max(1.0, math.sqrt(abs(v))) if key == "area" else tol
            if not close(float(v), float(w), limit):
                return False
        elif v != w:
            # Strings, ints and bools must be exactly equal.
            return False
    return True


def describe(shape):
    """Turn a shape into readable text for the mismatch message."""
    parts = []
    for key, v in shape.items():
        parts.append(f"{key} {fmt(v)}" if isinstance(v, list) else f"{key} {v}")
    return ", ".join(parts)


def match_lists(what, where, actual, expected, tol):
    """Pair every expected shape with a different actual shape, or raise Mismatch."""
    if len(actual) != len(expected):
        raise Mismatch(f"{where}: expected {len(expected)} {what}, got {len(actual)}")

    # Each actual shape may only be used once, so remove it once it is matched.
    unused = list(actual)
    for exp in expected:
        for i, act in enumerate(unused):
            if shapes_match(exp, act, tol):
                del unused[i]
                break
        else:
            # for/else: the loop finished without a break, so nothing matched.
            # what[:-1] turns "walls" into "wall" for the message.
            raise Mismatch(f"{where}: expected a {what[:-1]} with {describe(exp)}, "
                           f"but no {what[:-1]} in the actual file matches it")


# ---------------------------------------------------- whole-file compare

def compare(actual, expected, tol):
    """Compare two loaded .wfb files level by level. Raises Mismatch at the first difference."""
    if actual.get("version") != expected.get("version"):
        raise Mismatch(f"version: expected {expected.get('version')}, got {actual.get('version')}")

    a_levels = actual.get("levels", [])
    e_levels = expected.get("levels", [])
    if len(a_levels) != len(e_levels):
        raise Mismatch(f"expected {len(e_levels)} levels, got {len(a_levels)}")

    # Levels are in a fixed order (ground floor first), so compare them pairwise.
    for i, (al, el) in enumerate(zip(a_levels, e_levels)):
        where = f"levels[{i}] ({el.get('id', '?')})"
        for key in ("elevation", "ceilingHeight"):
            if not close(al.get(key, 0.0), el.get(key, 0.0), tol):
                raise Mismatch(f"{where}: {key} expected {el.get(key)}, got {al.get(key)}")

        # Within a level the element order can change between converts, so match by shape.
        match_lists("walls", where, wall_shapes(al), wall_shapes(el), tol)
        match_lists("openings", where, opening_shapes(al), opening_shapes(el), tol)
        match_lists("rooms", where, room_shapes(al), room_shapes(el), tol)
        match_lists("nodes", where, node_shapes(al), node_shapes(el), tol)
        match_lists("edges", where, edge_shapes(al), edge_shapes(el), tol)

    # Links join levels (stairs, lifts); for now only the count is checked.
    a_links = actual.get("links", [])
    e_links = expected.get("links", [])
    if len(a_links) != len(e_links):
        raise Mismatch(f"expected {len(e_links)} links, got {len(a_links)}")


# ---------------------------------------------------------------- main

def main():
    """Parse arguments, run the comparison and return the exit code."""
    parser = argparse.ArgumentParser(description="Compare a .wfb against its golden file.")
    parser.add_argument("actual", help="the .wfb the converter just wrote")
    parser.add_argument("expected", help="the golden .wfb in data/golden/")
    parser.add_argument("--tol", type=float, default=0.01, help="float tolerance in metres (default 0.01)")
    parser.add_argument("--update", action="store_true", help="overwrite the golden file with the actual one")
    args = parser.parse_args()  # argparse exits with code 2 on bad usage

    # Load the actual file first so --update never copies a broken file over a golden one.
    actual = load_wfb(args.actual)

    if args.update:
        shutil.copyfile(args.actual, args.expected)
        print(f"updated {args.expected} from {args.actual}")
        return 0

    expected = load_wfb(args.expected)

    try:
        compare(actual, expected, args.tol)
    except (Mismatch, KeyError, TypeError) as e:
        # KeyError/TypeError mean an element is missing a field or has the wrong type,
        # which is also a mismatch rather than a crash.
        reason = str(e) if isinstance(e, Mismatch) else f"malformed element, missing or bad field {e}"
        print(f"MISMATCH {args.actual} vs {args.expected}: {reason}")
        return 1

    print(f"OK {args.actual} matches {args.expected} (tol {args.tol})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
