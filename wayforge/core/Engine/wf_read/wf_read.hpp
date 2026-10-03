/*!
 * \file wf_read.hpp
 * \brief turns straight lines from a floor plan into walls, doors and rooms
 *
 * wf_vector gives a list of lines in metres, this works out what they are:
 *   1. walls - 2 lines side by side = 1 thick wall. a line on its own
 *      is kept as a thin wall
 *   2. doors - a door sized gap between 2 walls in a straight line
 *      becomes 1 wall with a door in it
 *   3. rooms - every closed loop of walls is a room. long thin ones
 *      are corridors
 * everything gets a confidence score (0-1) so we can see what its unsure about.
 * wf_api calls this when you click Import image in Studio.
 *
 * \author Katie Lim
 *
 * Contribution: Katie Lim 100%
 *   - wall pairing, door gaps and room finding
 *   - settings (ReadParams) and result counts (ReadStats)
 *
 * AI declaration: used Claude to help write and debug the code and comments.
 *
 * \date 2026-09-06
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#pragma once
#include <vector>
#include <string>
#include "wf_core/wf_core.hpp"       // Vec2, Result, IdGenerator, maths
#include "wf_doc/wf_doc.hpp"         // Level, Wall, Opening, Room
#include "wf_vector/wf_vector.hpp"   // vec::Segment (the input lines)

namespace wf::read {

    // all the numbers that decide whats a wall, door or room. sizes in metres
    struct ReadParams {
        // walls: 2 lines side by side this far apart = 1 wall
        float parallelDeg = 3.f;          // how far off parallel they can be (degrees)
        float minThickness = 0.08f;
        float maxThickness = 0.5f;
        float defaultThickness = 0.15f;   // thickness for walls drawn as 1 line
        // doors: a gap this wide between 2 walls in a line = door
        float minDoorWidth = 0.5f;
        float maxDoorWidth = 1.6f;
        float collinearTol = 0.1f;        // how far off the line the 2nd wall can be
        // rooms
        float snap = 0.1f;                // wall ends closer than this get joined
        float minRoomArea = 1.5f;         // m^2, smaller than this is probably a pillar or noise
        float corridorAspect = 3.5f;      // this many times longer than wide = corridor
    };

    // counts of what was found, for the status bar + tests
    struct ReadStats {
        int inputSegments = 0;
        int pairedWalls = 0;              // walls from 2 lines
        int singleWalls = 0;              // walls from 1 line
        int openings = 0;
        int rooms = 0;
        int corridors = 0;
        int lowConfidence = 0;            // stuff with confidence under 0.7
        std::vector<std::string> notes;   // short msgs for the user
    };

    // runs all 3 steps and fills level.walls, level.openings and level.rooms.
    // whatever was in them gets replaced. new ids come from ids
    Result<ReadStats> interpret(const std::vector<vec::Segment>& segments, Level& level, IdGenerator& ids, const ReadParams& p = {});

    // each step on its own so the tests can check them 1 by 1
    std::vector<Wall>    pairWalls(const std::vector<vec::Segment>& segments, IdGenerator& ids, const ReadParams& p, ReadStats* stats = nullptr);
    void                 bridgeDoorGaps(std::vector<Wall>& walls, std::vector<Opening>& openings, IdGenerator& ids, const ReadParams& p);
    std::vector<Room>    findRooms(const std::vector<Wall>& walls, IdGenerator& ids, const ReadParams& p, ReadStats* stats = nullptr);
    RoomKind             classifyFace(const std::vector<Vec2>& polygon, float area, const ReadParams& p);

} // namespace wf::read
