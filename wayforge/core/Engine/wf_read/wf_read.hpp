// wf_read - public header.
// Interprets clean line segments as a building: which lines are walls, where
// the doors are, which closed loops are rooms. Output goes straight into a
// wf::Level. Confidence is stored on every element so the editor can highlight
// what the machine was unsure about instead of silently lying.
#pragma once
#include <vector>
#include <string>
#include "wf_core/wf_core.hpp"
#include "wf_doc/wf_doc.hpp"
#include "wf_vector/wf_vector.hpp"

namespace wf::read {

    struct ReadParams {
        // walls: two parallel lines this far apart are one wall
        float parallelDeg = 3.f;
        float minThickness = 0.08f;
        float maxThickness = 0.5f;
        float defaultThickness = 0.15f;   // for single-line plans (SVG shortcut, hand drawings)
        // doors: a gap in a straight wall run this wide is an opening
        float minDoorWidth = 0.5f;
        float maxDoorWidth = 1.6f;
        float collinearTol = 0.1f;    // perpendicular offset allowed when bridging a gap
        // rooms
        float snap = 0.1f;
        float minRoomArea = 1.5f;    // m^2; smaller faces are columns, shafts, noise
        float corridorAspect = 3.5f;    // long thin faces are corridors
    };

    struct ReadStats {
        int inputSegments = 0;
        int pairedWalls = 0;            // walls found as a parallel pair
        int singleWalls = 0;            // walls taken from a single line
        int openings = 0;
        int rooms = 0;
        int corridors = 0;
        int lowConfidence = 0;            // elements with confidence < 0.7
        std::vector<std::string> notes;
    };

    // Fills `level.walls`, `level.openings`, `level.rooms` from segments in metres.
    // Existing walls/openings/rooms in `level` are replaced. Ids come from `ids`.
    Result<ReadStats> interpret(const std::vector<vec::Segment>& segments, Level& level, IdGenerator& ids, const ReadParams& p = {});

    // The individual stages, exposed for tests and for the editor's "re-run rooms" button.
    std::vector<Wall>    pairWalls(const std::vector<vec::Segment>& segments, IdGenerator& ids, const ReadParams& p, ReadStats* stats = nullptr);
    void                 bridgeDoorGaps(std::vector<Wall>& walls, std::vector<Opening>& openings, IdGenerator& ids, const ReadParams& p);
    std::vector<Room>    findRooms(const std::vector<Wall>& walls, IdGenerator& ids, const ReadParams& p, ReadStats* stats = nullptr);
    RoomKind             classifyFace(const std::vector<Vec2>& polygon, float area, const ReadParams& p);

} // namespace wf::read
