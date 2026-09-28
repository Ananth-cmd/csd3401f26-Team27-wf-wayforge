#!/usr/bin/env python3
"""
compare_golden.py - check that a converted building.wfb matches its golden file.

Usage:
    python tools/compare_golden.py <actual.wfb> <expected.wfb> [--tol 0.01] [--update]

Exit codes:
    0  files match (or --update wrote the expected file)
    1  files differ (the first difference is printed)
    2  bad usage, missing file, or invalid JSON

Ids (w1, r3, n7 ...) are regenerated on every convert, so they are ignored.
Elements are compared by geometry: each expected element must be matched
by exactly one actual element whose numbers are within --tol.
"""

import argparse
import json
import math
import shutil
import sys


class Mismatch(Exception):
    """Raised with a plain-words message at the first difference found."""


# ---------------------------------------------------------------- loading

def load_wfb(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        fail_usage(f"{path}: file not found")
    except json.JSONDecodeError as e:
        fail_usage(f"{path}: not valid JSON (line {e.lineno}, column {e.colno}): {e.msg}")


def fail_usage(message):
    print(f"error: {message}", file=sys.stderr)
    sys.exit(2)


# ---------------------------------------------------------------- helpers

def fmt(p):
    return f"({p[0]:.3f}, {p[1]:.3f})"


def close(a, b, tol):
    return abs(a - b) <= tol


def point_close(p, q, tol):
    return close(p[0], q[0], tol) and close(p[1], q[1], tol)


def ordered_segment(a, b):
    """A wall from a to b is the same wall as one from b to a."""
    return (a, b) if tuple(a) <= tuple(b) else (b, a)


# ------------------------------------------- turning elements into "shapes"
# Each shape is a dict with no ids in it, only things that should be stable.

def wall_shapes(level):
    shapes = []
    for w in level.get("walls", []):
        a, b = ordered_segment(w["a"], w["b"])
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
        length = math.hypot(bx - ax, by - ay) or 1.0
        t = o.get("offset", 0.0) + o.get("width", 0.9) / 2.0
        mid = [ax + (bx - ax) * t / length, ay + (by - ay) * t / length]
        shapes.append({"pos": mid, "width": o.get("width", 0.9), "type": o.get("type", "door")})
    return shapes


def room_shapes(level):
    shapes = []
    for r in level.get("rooms", []):
        shapes.append({
            "centroid": r.get("centroid", [0, 0]),
            "area": r.get("area", 0.0),
            "corners": len(r.get("polygon", [])),
            "kind": r.get("kind", "unknown"),
            "code": r.get("code", ""),
        })
    return shapes


def node_shapes(level):
    return [{"pos": n["pos"], "kind": n.get("kind", "corridor")} for n in level.get("nodes", [])]


def edge_shapes(level):
    """Edges point at node ids, so describe them by their two end positions."""
    nodes = {n["id"]: n["pos"] for n in level.get("nodes", [])}
    shapes = []
    for e in level.get("edges", []):
        if e["a"] not in nodes or e["b"] not in nodes:
            raise Mismatch(f"edge {e['a']}-{e['b']} refers to a missing node")
        a, b = ordered_segment(nodes[e["a"]], nodes[e["b"]])
        shapes.append({"a": a, "b": b, "stepFree": e.get("stepFree", True)})
    return shapes


# ---------------------------------------------------- comparing shapes

def shapes_match(s, t, tol):
    for key, v in s.items():
        w = t[key]
        if isinstance(v, list):
            if not point_close(v, w, tol):
                return False
        elif isinstance(v, float) or isinstance(w, float):
            # Shifting every wall by tol changes an area by about tol * perimeter.
            # A square of this area has perimeter 4 * sqrt(area), so use that.
            limit = tol * 4 * max(1.0, math.sqrt(abs(v))) if key == "area" else tol
            if not close(float(v), float(w), limit):
                return False
        elif v != w:
            return False
    return True


def describe(shape):
    parts = []
    for key, v in shape.items():
        parts.append(f"{key} {fmt(v)}" if isinstance(v, list) else f"{key} {v}")
    return ", ".join(parts)


def match_lists(what, where, actual, expected, tol):
    if len(actual) != len(expected):
        raise Mismatch(f"{where}: expected {len(expected)} {what}, got {len(actual)}")

    unused = list(actual)
    for exp in expected:
        for i, act in enumerate(unused):
            if shapes_match(exp, act, tol):
                del unused[i]
                break
        else:
            raise Mismatch(f"{where}: expected a {what[:-1]} with {describe(exp)}, "
                           f"but no {what[:-1]} in the actual file matches it")


# ---------------------------------------------------- whole-file compare

def compare(actual, expected, tol):
    if actual.get("version") != expected.get("version"):
        raise Mismatch(f"version: expected {expected.get('version')}, got {actual.get('version')}")

    a_levels = actual.get("levels", [])
    e_levels = expected.get("levels", [])
    if len(a_levels) != len(e_levels):
        raise Mismatch(f"expected {len(e_levels)} levels, got {len(a_levels)}")

    for i, (al, el) in enumerate(zip(a_levels, e_levels)):
        where = f"levels[{i}] ({el.get('id', '?')})"
        for key in ("elevation", "ceilingHeight"):
            if not close(al.get(key, 0.0), el.get(key, 0.0), tol):
                raise Mismatch(f"{where}: {key} expected {el.get(key)}, got {al.get(key)}")

        match_lists("walls", where, wall_shapes(al), wall_shapes(el), tol)
        match_lists("openings", where, opening_shapes(al), opening_shapes(el), tol)
        match_lists("rooms", where, room_shapes(al), room_shapes(el), tol)
        match_lists("nodes", where, node_shapes(al), node_shapes(el), tol)
        match_lists("edges", where, edge_shapes(al), edge_shapes(el), tol)

    a_links = actual.get("links", [])
    e_links = expected.get("links", [])
    if len(a_links) != len(e_links):
        raise Mismatch(f"expected {len(e_links)} links, got {len(a_links)}")


# ---------------------------------------------------------------- main

def main():
    parser = argparse.ArgumentParser(description="Compare a .wfb against its golden file.")
    parser.add_argument("actual", help="the .wfb the converter just wrote")
    parser.add_argument("expected", help="the golden .wfb in data/golden/")
    parser.add_argument("--tol", type=float, default=0.01, help="float tolerance in metres (default 0.01)")
    parser.add_argument("--update", action="store_true", help="overwrite the golden file with the actual one")
    args = parser.parse_args()  # argparse exits with code 2 on bad usage

    actual = load_wfb(args.actual)

    if args.update:
        shutil.copyfile(args.actual, args.expected)
        print(f"updated {args.expected} from {args.actual}")
        return 0

    expected = load_wfb(args.expected)

    try:
        compare(actual, expected, args.tol)
    except (Mismatch, KeyError, TypeError) as e:
        reason = str(e) if isinstance(e, Mismatch) else f"malformed element, missing or bad field {e}"
        print(f"MISMATCH {args.actual} vs {args.expected}: {reason}")
        return 1

    print(f"OK {args.actual} matches {args.expected} (tol {args.tol})")
    return 0


if __name__ == "__main__":
    sys.exit(main())