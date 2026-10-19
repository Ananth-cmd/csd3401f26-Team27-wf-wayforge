/*!
 * \file wf_vector.hpp
 * \brief Public header of wf_vector: from pixels (or SVG) to clean straight lines
 *
 * This is step two of the Wayforge pipeline. It takes the black-and-white
 * picture from wf_image and turns the ink into straight line segments in
 * metres, then tidies them (joins broken lines, closes corners, straightens
 * walls). It can also read an SVG drawing directly, skipping the picture
 * steps. Finally it can join the lines into a "planar graph" and find every
 * closed loop in it - each loop is a room candidate.
 *
 * Links: wf_image (Image8) -> thin / traceSkeleton / fitPolylines -> scale -> clean
 *        -> wf_read, which uses buildPlanarGraph + findFaces to find rooms.
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Segment / PlanarGraph / Face data types shared with wf_read
 *   - Clean-up and planar graph API (Raster and SVG implemented together with Kervin Ong)
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the Doxygen header comments.
 *
 * \date 2026-09-16
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

// wf_vector - public header.
// Pixels -> line segments -> planar graph. Two entry points:
//   * the vector shortcut: importSvg() gives clean segments straight away
//   * the raster path: thin() -> traceSkeleton() -> fitPolylines()
// then both go through merge -> snap -> straighten -> PlanarGraph -> faces.
#pragma once
#include <vector>
#include <string>
#include <filesystem>
#include "wf_core/wf_core.hpp"     // Vec2, Rect, maths helpers, Result.
#include "wf_image/wf_image.hpp"   // Image8: the black-and-white picture we start from.

namespace wf::vec {

    // One straight line from a to b. Starts in pixels, becomes metres after scale().
    struct Segment {
        Vec2  a, b;
        float confidence = 1.f;   // How sure we are this is a real line (passed on to walls in wf_read).
        Vec2  direction() const noexcept { return normalize(b - a); }   // Unit vector from a to b.
        float length()    const noexcept { return distance(a, b); }
        float angle()     const noexcept { return angleOf(b - a); }     // Radians.
        Vec2  centre()    const noexcept { return (a + b) * 0.5f; }
    };

    using Polyline = std::vector<Vec2>;   // A chain of points, e.g. one traced line of pixels.

    //the vector shortcut
    struct SvgImportResult {
        std::vector<Segment> segments;
        float  width = 0.f;                        // document size in SVG user units
        float  height = 0.f;
        int    ignoredElements = 0;                 // curves / text / unsupported
        std::vector<std::string> warnings;         // Human-readable notes, e.g. "curves replaced by straight chords".
    };
    // Supports <line> <polyline> <polygon> <rect> and <path> with M/L/H/V/Z (+ relative).
    // Applies translate()/scale() transforms and <g> nesting. Curves become chords with a warning.
    Result<SvgImportResult> importSvg(const std::filesystem::path& path);
    Result<SvgImportResult> importSvgText(std::string_view svg);   // Same, from SVG text already in memory.

    //the raster path
    // Zhang-Suen thinning: reduces thick strokes to a one-pixel skeleton. Input 0=ink.
    img::Image8 thin(const img::Image8& binary);
    // Walk the skeleton following connected pixels, breaking at junctions (>=3 neighbours).
    std::vector<Polyline> traceSkeleton(const img::Image8& skeleton);
    // Douglas-Peucker on each run; each straight span becomes a Segment. tolerance in pixels.
    Polyline             douglasPeucker(const Polyline& pts, float tolerance);
    std::vector<Segment> fitPolylines(const std::vector<Polyline>& runs, float tolerance, float minLength = 2.f);

    //clean-up (both paths)
    struct CleanParams {
        float mergeAngleDeg = 3.f;    // two segments merge if within this of parallel...
        float mergeGap = 0.15f;  // ...and their endpoints are closer than this
        float snapDistance = 0.1f;   // endpoints within this become one shared vertex
        float cornerGap = 0.3f;   // two non-parallel segments whose ends are this close are extended to meet
        bool  straighten = true;   // snap angles to the dominant axis and its perpendicular
        float straightenTolDeg = 8.f;   // only angles within this of 0/90 are snapped
        float minLength = 0.05f;  // drop anything shorter (units of the segments, normally metres)
    };
    // Pixels -> metres (and flip y so it points up, like a map).
    std::vector<Segment> scale(const std::vector<Segment>& in, float factor, Vec2 origin = {}, bool flipY = false, float height = 0.f);
    std::vector<Segment> mergeCollinear(const std::vector<Segment>& in, float angleDeg, float gap);   // Join pieces of the same line.
    std::vector<Segment> snapEndpoints(const std::vector<Segment>& in, float snapDistance);          // Glue nearby ends into one point.
    std::vector<Segment> closeCorners(const std::vector<Segment>& in, float maxGap, float minAngleDeg = 30.f);   // Close L-corners.
    // T-junctions: an endpoint that stops just short of another segment is extended onto it.
    std::vector<Segment> closeTJunctions(const std::vector<Segment>& in, float maxGap, float minAngleDeg = 30.f);
    float                dominantAngle(const std::vector<Segment>& in);          // radians, in [0, pi/2)
    std::vector<Segment> straighten(const std::vector<Segment>& in, float axisAngle, float toleranceDeg);   // Make almost-straight walls exactly straight.
    std::vector<Segment> clean(const std::vector<Segment>& in, const CleanParams& p = {});                   // All of the above, in the right order.

    //planar graph
    // Lines joined at shared points: vertices are the points, edges are the line pieces between them.
    struct PlanarGraph {
        struct Vertex { Vec2 pos; std::vector<int> edges; };          // edges sorted by angle around the vertex
        struct Edge { int a = -1, b = -1; float confidence = 1.f; };   // a and b are vertex indices.
        std::vector<Vertex> vertices;
        std::vector<Edge>   edges;

        int  vertexCount() const noexcept { return static_cast<int>(vertices.size()); }
        int  edgeCount()   const noexcept { return static_cast<int>(edges.size()); }
        // Given an edge and one of its ends, return the other end.
        int  otherEnd(int edge, int v) const noexcept { return edges[static_cast<size_t>(edge)].a == v ? edges[static_cast<size_t>(edge)].b : edges[static_cast<size_t>(edge)].a; }
        int  degree(int v) const noexcept { return static_cast<int>(vertices[static_cast<size_t>(v)].edges.size()); }   // How many lines meet here.
    };
    // Splits segments at crossings, snaps shared vertices, sorts edges by angle.
    PlanarGraph buildPlanarGraph(const std::vector<Segment>& segments, float snapDistance = 0.05f);

    // One closed loop in the graph - a room candidate.
    struct Face {
        std::vector<int>  vertices;      // closed loop of vertex indices, counter-clockwise
        std::vector<int>  edges;
        float             area = 0.f;    // positive = interior face
        Polyline          points;        // vertex positions of the loop
    };
    // Trace faces: from each directed edge always take the next edge clockwise.
    // The outer face (negative area) is discarded.
    std::vector<Face> findFaces(const PlanarGraph& g);

    // Dangling edges (degree-1 chains) never close a face; removing them cleans up doors and noise.
    PlanarGraph pruneDanglingEdges(const PlanarGraph& g, int passes = 100);

    Rect bounds(const std::vector<Segment>& segs) noexcept;   // Smallest box around all the segments.

    // --- plan symbols (Symbols.cpp) -------------------------------------------------------
    // Door arcs / leaves, stair treads and lift crosses are removed before wf_read reads walls.
    // All lengths are in segment units (metres). removed = number of segments taken out.

    // Where a stair or lift symbol was found.
    struct SymbolRegion {
        Rect box;            // bounds of the symbol's segments
        Vec2 centre;         // used to find the containing room
    };

    // Remove segments shorter than maxLength that are more than tolDeg off the dominant grid
    // (pieces of door swing arcs). Long diagonals such as real slanted walls are kept.
    std::vector<Segment> removeShortDiagonals(const std::vector<Segment>& in, float maxLength, float tolDeg = 12.f, int* removed = nullptr);
    // Find lift crosses: two diagonals crossing at 60+ degrees with a bounding box of at least
    // minLength each way. Removes the arms (and collinear pieces of split arms). One region per lift.
    std::vector<SymbolRegion> detectLifts(std::vector<Segment>& segs, float minLength = 0.8f);
    // Find stair flights: at least minTreads parallel segments of similar length, spaced evenly
    // minGap..maxGap apart. Removes the treads. One region per flight.
    std::vector<SymbolRegion> detectStairs(std::vector<Segment>& segs, int minTreads = 5, float minGap = 0.15f, float maxGap = 0.5f);
    // Remove door leaves: a minWidth..maxWidth segment with a free end, hinged on a wall end that
    // is followed by a gap of about the same width and then a collinear wall.
    std::vector<Segment> removeDoorLeaves(const std::vector<Segment>& in, float minWidth, float maxWidth, int* removed = nullptr);

} // namespace wf::vec
