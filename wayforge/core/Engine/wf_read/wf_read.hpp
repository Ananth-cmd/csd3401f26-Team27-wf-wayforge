/*!
 * \file wf_read.hpp
 * \brief Turns straight lines from a floor plan into walls, doors and rooms
 *
 * wf_vector gives us a list of straight lines (in metres). This library
 * works out what those lines mean:
 *   1. Walls - two lines side by side make one thick wall. A line on its
 *      own is kept as a thin wall.
 *   2. Doors - a door-sized gap between two walls in a straight line
 *      becomes one wall with a door in it.
 *   3. Rooms - every closed loop of walls becomes a room. Long thin rooms
 *      are marked as corridors.
 * Every wall, door and room gets a confidence score (0 to 1), so the
 * Studio can show which parts the program was not sure about.
 *
 * Used by: wf_api (wf_convert_image), which the Unity Studio calls when
 * you click Import image.
 *
 * \author Katie Lim
 *
 * Contribution: Katie Lim 100%
 *   - Wall pairing, door gap and room finding steps
 *   - Settings (ReadParams) and result counts (ReadStats)
 *
 * AI declaration: Claude was used as a support tool for writing and debugging code and for the comments.
 *
 * \date 2026-09-06
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#pragma once
#include <vector>
#include <string>
#include "wf_core/wf_core.hpp"       // Vec2, Result, IdGenerator and maths helpers
#include "wf_doc/wf_doc.hpp"         // Level, Wall, Opening, Room
#include "wf_vector/wf_vector.hpp"   // vec::Segment (the input lines)

namespace wf::read {

    // All the numbers that decide what counts as a wall, a door or a room. Sizes are in metres.
    struct ReadParams {
        // Walls: two lines side by side, this far apart, are one wall
        float parallelDeg = 3.f;          // how far from parallel two lines can be, in degrees
        float minThickness = 0.08f;
        float maxThickness = 0.5f;
        float defaultThickness = 0.15f;   // thickness for a wall drawn as a single line
        // Doors: a gap this wide between two walls in a straight line is a door
        float minDoorWidth = 0.5f;
        float maxDoorWidth = 1.6f;
        float collinearTol = 0.1f;        // how far off the line the second wall can be
        // Rooms
        float snap = 0.1f;                // wall ends closer than this are joined
        float minRoomArea = 1.5f;         // square metres, anything smaller is a pillar or noise
        float corridorAspect = 3.5f;      // a room this many times longer than wide is a corridor
    };

    // Counts of what was found, for the status bar and for tests
    struct ReadStats {
        int inputSegments = 0;
        int pairedWalls = 0;              // walls made from two lines side by side
        int singleWalls = 0;              // walls made from one line
        int openings = 0;
        int rooms = 0;
        int corridors = 0;
        int lowConfidence = 0;            // walls, doors and rooms with confidence under 0.7
        std::vector<std::string> notes;   // short messages for the user
    };

    // Runs all three steps. Fills level.walls, level.openings and level.rooms from lines in metres.
    // Anything already in those lists is replaced. New ids come from `ids`.
    Result<ReadStats> interpret(const std::vector<vec::Segment>& segments, Level& level, IdGenerator& ids, const ReadParams& p = {});

    // Each step on its own, so the tests can check them one at a time
    std::vector<Wall>    pairWalls(const std::vector<vec::Segment>& segments, IdGenerator& ids, const ReadParams& p, ReadStats* stats = nullptr);
    void                 bridgeDoorGaps(std::vector<Wall>& walls, std::vector<Opening>& openings, IdGenerator& ids, const ReadParams& p);
    std::vector<Room>    findRooms(const std::vector<Wall>& walls, IdGenerator& ids, const ReadParams& p, ReadStats* stats = nullptr);
    RoomKind             classifyFace(const std::vector<Vec2>& polygon, float area, const ReadParams& p);

} // namespace wf::read
