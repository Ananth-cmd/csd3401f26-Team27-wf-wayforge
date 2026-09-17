#pragma once

//
#include "wf_core/wf_core.hpp" 
#include <string>
#include <string_view>
#include <vector>
#include <cstdint>

namespace wf {

    enum class OpeningType : uint8_t { Door, Window, Opening };
    enum class RoomKind : uint8_t { Unknown, Classroom, Lab, Office, Toilet, Corridor, Stair, Lift, Lobby, Food, Storage, Exit };
    enum class NodeKind : uint8_t { Room, Door, Corridor, Stair, Lift, Exit, Poi };
    enum class LinkKind : uint8_t { Stair, Lift, Ramp };

    template <class E> struct EnumNames { static const char* const names[]; };

    struct Wall {
        std::string id;
        Vec2 a, b;
        float thickness = 0.15f, confidence = 1.f;
        Vec2 direction() const;
        float length() const;
    };

    struct Opening {
        std::string id, wall;
        float offset = 0, width = 0.9f;
        OpeningType type = OpeningType::Door;
        float sill = 0, height = 2.1f, confidence = 1.f;
    };

    struct Room {
        std::string id, code, name;
        RoomKind kind = RoomKind::Unknown;
        std::vector<std::string> boundary;
        std::vector<Vec2> polygon;
        Vec2 centroid;
        float area = 0, confidence = 1.f;
    };

    struct Node {
        std::string id;
        Vec2 pos;
        NodeKind kind = NodeKind::Corridor;
        std::string room;
    };

    struct Edge {
        std::string a, b;
        float cost = 0;
        bool stepFree = true;
    };

    struct Poi {
        std::string id, kind;
        Vec2 pos;
        std::string label;
    };

    struct Anchor {
        std::string id, name;
        Vec2 pos;
        float heading = 0;
    };

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
    };

    struct Link {
        std::string a, b;
        LinkKind kind = LinkKind::Stair;
        bool stepFree = false;
        float cost = 12.f;
    };

    struct BuildingInfo { std::string name, id; };
    struct SourceInfo { std::string file; float pixelsPerMetre = 0; bool rectified = false; };

    struct Building {
        int version = 1;
        BuildingInfo building;
        SourceInfo source;
        std::vector<Level> levels;
        std::vector<Link> links;

        const Level* findLevel(std::string_view) const;
    };

    float polygonArea(const std::vector<Vec2>&);
    Vec2 polygonCentroid(const std::vector<Vec2>&);
    bool pointInPolygon(Vec2, const std::vector<Vec2>&);
    Rect polygonBounds(const std::vector<Vec2>&);
    Vec2 openingPosition(const Wall&, const Opening&);

} // namespace wf