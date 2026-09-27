// The data model of a building.wfb. Plain structs, all fields reflected.
// A wall is a line plus numbers, not a mesh. An opening is an offset along its
// wall, never a world position. stepFree lives on every edge and link.
#pragma once
#include <string>
#include <vector>
#include <cstdint>
#include "wf_core/wf_core.hpp"
#include "Property.hpp"

namespace wf {

enum class OpeningType : uint8_t { Door, Window, Opening };
enum class RoomKind    : uint8_t { Unknown, Classroom, Lab, Office, Toilet, Corridor, Stair, Lift, Lobby, Food, Storage, Exit };
enum class NodeKind    : uint8_t { Room, Door, Corridor, Stair, Lift, Exit, Poi };
enum class LinkKind    : uint8_t { Stair, Lift, Ramp };

template <> struct EnumNames<OpeningType> { static constexpr const char* names[] = { "door", "window", "opening", nullptr }; };
template <> struct EnumNames<RoomKind>    { static constexpr const char* names[] = { "unknown", "classroom", "lab", "office", "toilet", "corridor", "stair", "lift", "lobby", "food", "storage", "exit", nullptr }; };
template <> struct EnumNames<NodeKind>    { static constexpr const char* names[] = { "room", "door", "corridor", "stair", "lift", "exit", "poi", nullptr }; };
template <> struct EnumNames<LinkKind>    { static constexpr const char* names[] = { "stair", "lift", "ramp", nullptr }; };

struct Wall {
    std::string id;
    Vec2        a, b;
    float       thickness  = 0.2f;
    float       confidence = 1.f;
    WF_PROPERTIES(Wall, WF_PROP(id), WF_PROP(a), WF_PROP(b), WF_PROP(thickness), WF_PROP(confidence))

    Vec2  centre()    const noexcept { return (a + b) * 0.5f; }
    float length()    const noexcept { return wf::distance(a, b); }
    Vec2  direction() const noexcept { return normalize(b - a); }
};

struct Opening {
    std::string id;
    std::string wall;                 // id of the wall it sits in
    OpeningType type   = OpeningType::Door;
    float       offset = 0.f;         // metres from wall.a along the wall
    float       width  = 0.9f;
    float       sill   = 0.f;
    float       height = 2.1f;
    float       confidence = 1.f;
    WF_PROPERTIES(Opening, WF_PROP(id), WF_PROP(wall), WF_PROP(type), WF_PROP(offset), WF_PROP(width),
                  WF_PROP(sill), WF_PROP(height), WF_PROP(confidence))
};

struct Room {
    std::string id;
    std::string code;                 // "E2-05-12"
    std::string name;                 // "Lecture Theatre 3"
    RoomKind    kind = RoomKind::Unknown;
    std::vector<std::string> boundary;   // wall ids (may be empty for raw faces)
    std::vector<Vec2>        polygon;    // room outline, counter-clockwise, metres
    Vec2        centroid;
    float       area       = 0.f;
    float       confidence = 1.f;
    WF_PROPERTIES(Room, WF_PROP(id), WF_PROP(code), WF_PROP(name), WF_PROP(kind), WF_PROP(centroid),
                  WF_PROP(area), WF_PROP(confidence))
};

struct Node {
    std::string id;
    Vec2        pos;
    std::string room;                 // room id, or "" for corridor/stair nodes
    NodeKind    kind = NodeKind::Corridor;
    WF_PROPERTIES(Node, WF_PROP(id), WF_PROP(pos), WF_PROP(room), WF_PROP(kind))
};

struct Edge {
    std::string a, b;                 // node ids
    float       cost     = 0.f;
    bool        stepFree = true;
    std::string via;                  // opening id if it passes through a door
    WF_PROPERTIES(Edge, WF_PROP(a), WF_PROP(b), WF_PROP(cost), WF_PROP(stepFree), WF_PROP(via))
};

struct Poi {
    std::string id;
    std::string kind;                 // "aed", "toilet", "printer"...
    Vec2        pos;
    std::string label;
    WF_PROPERTIES(Poi, WF_PROP(id), WF_PROP(kind), WF_PROP(pos), WF_PROP(label))
};

struct Anchor {                       // QR code / tap-to-start location
    std::string id;
    Vec2        pos;
    std::string label;
    WF_PROPERTIES(Anchor, WF_PROP(id), WF_PROP(pos), WF_PROP(label))
};

struct Level {
    std::string id;                   // "L5"
    std::string name;                 // "Level 5"
    float       elevation     = 0.f;
    float       ceilingHeight = 2.8f;
    WF_PROPERTIES(Level, WF_PROP(id), WF_PROP(name), WF_PROP(elevation), WF_PROP(ceilingHeight))

    std::vector<Wall>    walls;
    std::vector<Opening> openings;
    std::vector<Room>    rooms;
    std::vector<Node>    nodes;
    std::vector<Edge>    edges;
    std::vector<Poi>     pois;
    std::vector<Anchor>  anchors;

    Wall*    findWall(std::string_view id) noexcept;
    Room*    findRoom(std::string_view id) noexcept;
    Node*    findNode(std::string_view id) noexcept;
    Opening* findOpening(std::string_view id) noexcept;
    const Wall* findWall(std::string_view id) const noexcept;
    const Room* findRoom(std::string_view id) const noexcept;
    const Node* findNode(std::string_view id) const noexcept;
};

struct Link {                         // vertical connection between levels: "L5:n3" -> "L6:n7"
    std::string a, b;
    LinkKind    kind     = LinkKind::Stair;
    bool        stepFree = false;
    float       cost     = 12.f;
    WF_PROPERTIES(Link, WF_PROP(a), WF_PROP(b), WF_PROP(kind), WF_PROP(stepFree), WF_PROP(cost))
};

struct BuildingInfo {
    std::string name = "Untitled";
    float       unitsPerMetre = 1.f;
    WF_PROPERTIES(BuildingInfo, WF_PROP(name), WF_PROP(unitsPerMetre))
};

struct SourceInfo {
    std::string file;
    float       pixelsPerMetre = 0.f;
    bool        rectified = false;
    WF_PROPERTIES(SourceInfo, WF_PROP(file), WF_PROP(pixelsPerMetre), WF_PROP(rectified))
};

struct Building {
    int                version = 1;
    BuildingInfo       building;
    std::vector<Level> levels;
    std::vector<Link>  links;
    SourceInfo         source;

    Level*       findLevel(std::string_view id) noexcept;
    const Level* findLevel(std::string_view id) const noexcept;
};

// Geometry helpers on the model ------------------------------------------------
float polygonArea(std::span<const Vec2> poly) noexcept;        // signed, CCW positive
Vec2  polygonCentroid(std::span<const Vec2> poly) noexcept;
bool  pointInPolygon(const Vec2& p, std::span<const Vec2> poly) noexcept;
Rect  polygonBounds(std::span<const Vec2> poly) noexcept;
Vec2  openingPosition(const Wall& wall, const Opening& opening) noexcept;   // world midpoint of the opening

} // namespace wf

WF_REGISTER_TYPE(wf::Wall)
WF_REGISTER_TYPE(wf::Opening)
WF_REGISTER_TYPE(wf::Room)
WF_REGISTER_TYPE(wf::Node)
WF_REGISTER_TYPE(wf::Edge)
WF_REGISTER_TYPE(wf::Poi)
WF_REGISTER_TYPE(wf::Anchor)
WF_REGISTER_TYPE(wf::Level)
WF_REGISTER_TYPE(wf::Link)
WF_REGISTER_TYPE(wf::BuildingInfo)
WF_REGISTER_TYPE(wf::SourceInfo)
