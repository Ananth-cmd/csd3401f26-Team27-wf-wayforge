// Data types shared between the UI and the document interface.
// These mirror the fields the real C++ side uses (wf_doc/Types.hpp),
// so the shape stays the same once the real document is wired in.

using System;
using System.Collections.Generic;
using UnityEngine;

namespace Wayforge
{
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

    // Used by the property panel to know what kind of field to draw
    // for a given property (checkbox, number field, dropdown, etc).
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

    [Serializable]
    public struct WfWall
    {
        public string id;
        public Vector2 a;
        public Vector2 b;
        public float thickness;
        public float confidence; // >=0.7 green, >=0.4 orange, else red

        public Vector2 Direction => (b - a).normalized;
        public float Length => Vector2.Distance(a, b);
    }

    [Serializable]
    public struct WfOpening
    {
        public string id;
        public string wall;   // which wall this door/window is on (stub only)
        public float offset;  // distance along the wall from point a (stub only)
        public Vector2 pos;   // world position - the real core gives this directly instead of wall + offset
        public float width;
        public OpeningType type;
        public float confidence;
    }

    [Serializable]
    public struct WfRoom
    {
        public string id;
        public string code;   // e.g. "E2-01-01", empty until tagged
        public string name;
        public RoomKind kind;
        public List<string> boundary; // wall ids around this room
        public List<Vector2> polygon; // room outline, world space
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
        public string room; // room this node belongs to, if any
    }

    [Serializable]
    public struct WfEdge
    {
        public string a; // node id
        public string b; // node id
        public float cost;
        public bool stepFree;
    }

    // One row of the property panel for a selected wall/room/etc.
    [Serializable]
    public struct WfPropertyRow
    {
        public string name;
        public PropertyType type;
        public string valueText;
        public string[] enumOptions; // only used when type is Enum
    }

    // One search result when looking up a room by code or name.
    [Serializable]
    public struct WfRoomHit
    {
        public string levelNodeRef;
        public string code;
        public string name;
        public string kind;
    }

    // What Route() returns - either a path with steps and cost,
    // or a failure with a message to show the user.
    [Serializable]
    public struct WfRouteResult
    {
        public bool success;
        public string errorMessage;
        public Vector3[] points;
        public float totalCost;
        public bool stepFree;
        public int stepCount;
    }
}