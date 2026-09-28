// wf_vector - public header.
// Pixels -> line segments -> planar graph. Two entry points:
//   * the vector shortcut: importSvg() gives clean segments straight away
//   * the raster path: thin() -> traceSkeleton() -> fitPolylines()
// then both go through merge -> snap -> straighten -> PlanarGraph -> faces.
#pragma once
#include <vector>
#include <string>
#include <filesystem>
#include "wf_core/wf_core.hpp"
#include "wf_image/wf_image.hpp"

namespace wf::vec {

    struct Segment {
        Vec2  a, b;
        float confidence = 1.f;
        Vec2  direction() const noexcept { return normalize(b - a); }
        float length()    const noexcept { return distance(a, b); }
        float angle()     const noexcept { return angleOf(b - a); }
        Vec2  centre()    const noexcept { return (a + b) * 0.5f; }
    };

    using Polyline = std::vector<Vec2>;

    // ---- 1. the vector shortcut ------------------------------------------------------
    struct SvgImportResult {
        std::vector<Segment> segments;
        float  width = 0.f;                        // document size in SVG user units
        float  height = 0.f;
        int    ignoredElements = 0;                 // curves / text / unsupported
        std::vector<std::string> warnings;
    };
    // Supports <line> <polyline> <polygon> <rect> and <path> with M/L/H/V/Z (+ relative).
    // Applies translate()/scale() transforms and <g> nesting. Curves become chords with a warning.
    Result<SvgImportResult> importSvg(const std::filesystem::path& path);
    Result<SvgImportResult> importSvgText(std::string_view svg);

    // ---- 2. the raster path ----------------------------------------------------------------
    // Zhang-Suen thinning: reduces thick strokes to a one-pixel skeleton. Input 0=ink.
    img::Image8 thin(const img::Image8& binary);
    // Walk the skeleton following connected pixels, breaking at junctions (>=3 neighbours).
    std::vector<Polyline> traceSkeleton(const img::Image8& skeleton);
    // Douglas-Peucker on each run; each straight span becomes a Segment. tolerance in pixels.
    Polyline             douglasPeucker(const Polyline& pts, float tolerance);
    std::vector<Segment> fitPolylines(const std::vector<Polyline>& runs, float tolerance, float minLength = 2.f);

    // ---- 3. clean-up (both paths) --------------------------------------------------------
    struct CleanParams {
        float mergeAngleDeg = 3.f;    // two segments merge if within this of parallel...
        float mergeGap = 0.15f;  // ...and their endpoints are closer than this
        float snapDistance = 0.1f;   // endpoints within this become one shared vertex
        float cornerGap = 0.3f;   // two non-parallel segments whose ends are this close are extended to meet
        bool  straighten = true;   // snap angles to the dominant axis and its perpendicular
        float straightenTolDeg = 8.f;   // only angles within this of 0/90 are snapped
        float minLength = 0.05f;  // drop anything shorter (units of the segments, normally metres)
    };
    std::vector<Segment> scale(const std::vector<Segment>& in, float factor, Vec2 origin = {}, bool flipY = false, float height = 0.f);
    std::vector<Segment> mergeCollinear(const std::vector<Segment>& in, float angleDeg, float gap);
    std::vector<Segment> snapEndpoints(const std::vector<Segment>& in, float snapDistance);
    std::vector<Segment> closeCorners(const std::vector<Segment>& in, float maxGap, float minAngleDeg = 30.f);
    // T-junctions: an endpoint that stops just short of another segment is extended onto it.
    std::vector<Segment> closeTJunctions(const std::vector<Segment>& in, float maxGap, float minAngleDeg = 30.f);
    float                dominantAngle(const std::vector<Segment>& in);          // radians, in [0, pi/2)
    std::vector<Segment> straighten(const std::vector<Segment>& in, float axisAngle, float toleranceDeg);
    std::vector<Segment> clean(const std::vector<Segment>& in, const CleanParams& p = {});

    // ---- 4. planar graph ----------------------------------------------------------------
    struct PlanarGraph {
        struct Vertex { Vec2 pos; std::vector<int> edges; };          // edges sorted by angle around the vertex
        struct Edge { int a = -1, b = -1; float confidence = 1.f; };
        std::vector<Vertex> vertices;
        std::vector<Edge>   edges;

        int  vertexCount() const noexcept { return static_cast<int>(vertices.size()); }
        int  edgeCount()   const noexcept { return static_cast<int>(edges.size()); }
        int  otherEnd(int edge, int v) const noexcept { return edges[static_cast<size_t>(edge)].a == v ? edges[static_cast<size_t>(edge)].b : edges[static_cast<size_t>(edge)].a; }
        int  degree(int v) const noexcept { return static_cast<int>(vertices[static_cast<size_t>(v)].edges.size()); }
    };
    // Splits segments at crossings, snaps shared vertices, sorts edges by angle.
    PlanarGraph buildPlanarGraph(const std::vector<Segment>& segments, float snapDistance = 0.05f);

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

    Rect bounds(const std::vector<Segment>& segs) noexcept;

} // namespace wf::vec
