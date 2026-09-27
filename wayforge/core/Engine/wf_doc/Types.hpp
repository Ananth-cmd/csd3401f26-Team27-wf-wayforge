#pragma once

#include "wf_core/wf_core.hpp"
#include "wf_doc/Property.hpp"
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace wf {

    enum class OpeningType : uint8_t { Door, Window, Opening };
    enum class RoomKind : uint8_t { Unknown, Classroom, Lab, Office, Toilet, Corridor, Stair, Lift, Lobby, Food, Storage, Exit };
    enum class NodeKind : uint8_t { Room, Door, Corridor, Stair, Lift, Exit, Poi };
    enum class LinkKind : uint8_t { Stair, Lift, Ramp };

 
    template <> struct EnumNames<OpeningType> {
        static constexpr const char* const names[] = { "door", "window", "opening" };
        static constexpr int count = 3;
    };
    template <> struct EnumNames<RoomKind> {
        static constexpr const char* const names[] = { "unknown", "classroom", "lab", "office", "toilet", "corridor", "stair", "lift", "lobby", "food", "storage", "exit" };
        static constexpr int count = 12;
    };
    template <> struct EnumNames<NodeKind> {
        static constexpr const char* const names[] = { "room", "door", "corridor", "stair", "lift", "exit", "poi" };
        static constexpr int count = 7;
    };
    template <> struct EnumNames<LinkKind> {
        static constexpr const char* const names[] = { "stair", "lift", "ramp" };
        static constexpr int count = 3;
    };

    struct Wall {
        std::string id;
        Vec2 a, b;
        float thickness = 0.15f, confidence = 1.f;
        Vec2 direction() const;
        float length() const;
        WF_PROPERTIES(Wall, WF_PROP(Wall, id), WF_PROP(Wall, a), WF_PROP(Wall, b),
            WF_PROP(Wall, thickness), WF_PROP(Wall, confidence))
    };
    WF_REGISTER_TYPE(Wall)

        struct Opening {
        std::string id, wall;
        float offset = 0, width = 0.9f;
        OpeningType type = OpeningType::Door;
        float sill = 0, height = 2.1f, confidence = 1.f;
        WF_PROPERTIES(Opening, WF_PROP(Opening, id), WF_PROP(Opening, wall), WF_PROP(Opening, offset),
            WF_PROP(Opening, width), WF_PROP(Opening, type), WF_PROP(Opening, sill),
            WF_PROP(Opening, height), WF_PROP(Opening, confidence))
    };
    WF_REGISTER_TYPE(Opening)

        struct Room {
        std::string id, code, name;
        RoomKind kind = RoomKind::Unknown;
        std::vector<std::string> boundary;   // not a property: Serialize handles it
        std::vector<Vec2> polygon;           // not a property: Serialize handles it
        Vec2 centroid;
        float area = 0, confidence = 1.f;
        WF_PROPERTIES(Room, WF_PROP(Room, id), WF_PROP(Room, code), WF_PROP(Room, name),
            WF_PROP(Room, kind), WF_PROP(Room, centroid), WF_PROP(Room, area),
            WF_PROP(Room, confidence))
    };
    WF_REGISTER_TYPE(Room)

        struct Node {
        std::string id;
        Vec2 pos;
        NodeKind kind = NodeKind::Corridor;
        std::string room;
        WF_PROPERTIES(Node, WF_PROP(Node, id), WF_PROP(Node, pos), WF_PROP(Node, kind), WF_PROP(Node, room))
    };
    WF_REGISTER_TYPE(Node)

        struct Edge {
        std::string a, b;
        float cost = 0;
        bool stepFree = true;
        WF_PROPERTIES(Edge, WF_PROP(Edge, a), WF_PROP(Edge, b), WF_PROP(Edge, cost), WF_PROP(Edge, stepFree))
    };
    WF_REGISTER_TYPE(Edge)

        struct Poi {
        std::string id, kind;
        Vec2 pos;
        std::string label;
        WF_PROPERTIES(Poi, WF_PROP(Poi, id), WF_PROP(Poi, kind), WF_PROP(Poi, pos), WF_PROP(Poi, label))
    };
    WF_REGISTER_TYPE(Poi)

        struct Anchor {
        std::string id, name;
        Vec2 pos;
        float heading = 0;
        WF_PROPERTIES(Anchor, WF_PROP(Anchor, id), WF_PROP(Anchor, name), WF_PROP(Anchor, pos), WF_PROP(Anchor, heading))
    };
    WF_REGISTER_TYPE(Anchor)

        struct Level {
        std::string id, name;
        float elevation = 0, ceilingHeight = 2.8f;
        std::vector<Wall> walls;
        std::vector<Opening> openings;
        std::vector<Room> rooms;
        std::vector<Node> nodes;
        std::vector<Edge> edges;
        std::vector<Poi> pois;
        std::vector<Anchor> anchors;

        const Wall* findWall(std::string_view) const;
        Wall* findWall(std::string_view);
        const Room* findRoom(std::string_view) const;
        const Node* findNode(std::string_view) const;

        WF_PROPERTIES(Level, WF_PROP(Level, id), WF_PROP(Level, name),
            WF_PROP(Level, elevation), WF_PROP(Level, ceilingHeight))
    };
    WF_REGISTER_TYPE(Level)

        struct Link {
        std::string a, b;
        LinkKind kind = LinkKind::Stair;
        bool stepFree = false;
        float cost = 12.f;
        WF_PROPERTIES(Link, WF_PROP(Link, a), WF_PROP(Link, b), WF_PROP(Link, kind),
            WF_PROP(Link, stepFree), WF_PROP(Link, cost))
    };
    WF_REGISTER_TYPE(Link)

        struct BuildingInfo {
        std::string name, id;
        WF_PROPERTIES(BuildingInfo, WF_PROP(BuildingInfo, name), WF_PROP(BuildingInfo, id))
    };
    WF_REGISTER_TYPE(BuildingInfo)

        struct SourceInfo {
        std::string file;
        float pixelsPerMetre = 0;
        bool rectified = false;
        WF_PROPERTIES(SourceInfo, WF_PROP(SourceInfo, file), WF_PROP(SourceInfo, pixelsPerMetre),
            WF_PROP(SourceInfo, rectified))
    };
    WF_REGISTER_TYPE(SourceInfo)

        struct Building {
        int version = 1;
        BuildingInfo building;
        SourceInfo source;
        std::vector<Level> levels;
        std::vector<Link> links;

        const Level* findLevel(std::string_view) const;
    };

    //polygonArea is always +ve.
    float polygonArea(const std::vector<Vec2>&);
    Vec2 polygonCentroid(const std::vector<Vec2>&);
    bool pointInPolygon(Vec2, const std::vector<Vec2>&);
    Rect polygonBounds(const std::vector<Vec2>&);
    Vec2 openingPosition(const Wall&, const Opening&);

} // namespace wf