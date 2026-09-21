// WfTypes.cs
//
// Plain C# mirrors of the structs in core/Engine/wf_doc/Types.hpp.
// These are the shapes that cross the C++ <-> C# boundary conceptually.
// Field names match the C++ struct field names 1:1 (see Work Breakdown
// section 3.1) so that when RTIS 2's real WayforgeDocument.cs starts
// filling these in from wf_get_walls / wf_get_room / etc., nothing in
// IMGD 2's UI code (PlanCanvas, RoomTagger, StudioWindow) needs to change.
//
// IMGD 2 owns this file's *shape* as far as "what does my UI need to draw
// a wall/room" is concerned. RTIS 2 owns the actual marshalling that fills
// these in from the DLL. IMGD 1 owns the ground truth (wf_doc/Types.hpp) --
// if IMGD 1 changes a field there, that change must be mirrored here.
//
// DO NOT put engine-agnostic C++ logic here. This is Unity-side only.

using System;
using System.Collections.Generic;
using UnityEngine;

namespace Wayforge
{
    // --- enums (Work Breakdown 3.1, wf_doc/Types.hpp) --------------------

    public enum RoomKind
    {
        Unknown,
        Classroom,
        Lab,
        Office,
        Toilet,
        Corridor,
        Stair,
        Lift,
        Lobby,
        Food,
        Storage,
        Exit
    }

    public enum OpeningType
    {
        Door,
        Window,
        Opening
    }

    public enum NodeKind
    {
        Room,
        Door,
        Corridor,
        Stair,
        Lift,
        Exit,
        Poi
    }

    // Property system (Work Breakdown 3.2). RTIS 2 exposes the C++
    // property table through wf_property_count / wf_property_name /
    // wf_get_property / wf_set_property. IMGD 2's RoomTagger iterates
    // this list to draw the wall inspector WITHOUT per-field UI code --
    // that's the whole point of the property system.
    public enum PropertyType
    {
        Bool,
        Int,
        Float,
        String,
        Vec2,
        Enum
    }

    public enum ElementKind
    {
        Wall = 0,
        Opening = 1,
        Room = 2,
        Node = 3,
        Poi = 4,
        Anchor = 5,
        Level = 6
    }

    // --- data shapes -------------------------------------------------------
    // Vec2 note: we use UnityEngine.Vector2 directly rather than inventing
    // our own Vec2, since everything here is already Unity-side. The C++
    // core has its own wf::Vec2 (Math.hpp) -- RTIS 2's marshalling layer is
    // responsible for converting between them, not this file.

    [Serializable]
    public struct WfWall
    {
        public string id;
        public Vector2 a;
        public Vector2 b;
        public float thickness;
        public float confidence; // 0..1. >=0.7 green, >=0.4 orange, else red (PDD 4.2 / PlanCanvas spec)

        public Vector2 Direction => (b - a).normalized;
        public float Length => Vector2.Distance(a, b);
    }

    [Serializable]
    public struct WfOpening
    {
        public string id;
        public string wall;      // id of the Wall this opening sits on
        public float offset;     // distance from wall.a along the wall
        public float width;
        public OpeningType type;
        public float confidence;
    }

    [Serializable]
    public struct WfRoom
    {
        public string id;
        public string code;      // e.g. "E2-01-01" -- empty/null until tagged
        public string name;
        public RoomKind kind;
        public List<string> boundary; // wall ids on this room's outline
        public List<Vector2> polygon; // world-space, counter-clockwise
        public Vector2 centroid;
        public float area;
        public float confidence;

        public bool IsTagged => !string.IsNullOrEmpty(code);
    }

    [Serializable]
    public struct WfNode
    {
        public string id;
        public Vector2 pos;
        public NodeKind kind;
        public string room; // id of the Room this node belongs to, if any
    }

    [Serializable]
    public struct WfEdge
    {
        public string a; // node id
        public string b; // node id
        public float cost;
        public bool stepFree;
    }

    // A single row in the property table for a selected element, as
    // returned by wf_property_name/wf_get_property. RoomTagger loops a
    // list of these to build the wall inspector generically.
    [Serializable]
    public struct WfPropertyRow
    {
        public string name;          // e.g. "thickness"
        public PropertyType type;
        public string valueText;     // current value, as text ("0.15", "true", "door")
        public string[] enumOptions; // populated only when type == Enum
    }

    // A single hit from doc.SearchRooms(query) -- used by RoomTagger's
    // route-preview "From / To" fields once code lookup is needed, and
    // later by the app's NavigationUI search box.
    [Serializable]
    public struct WfRoomHit
    {
        public string levelNodeRef; // "L1:r3"
        public string code;
        public string name;
        public string kind;
    }

    // Result of doc.Route(...) -- enough for RoomTagger to show step count
    // and cost, and later for RouteRenderer to draw the polyline.
    [Serializable]
    public struct WfRouteResult
    {
        public bool success;
        public string errorMessage;   // populated when !success
        public Vector3[] points;      // (x, elevation, y) triples, Unity space
        public float totalCost;
        public bool stepFree;
        public int stepCount;
    }
}
