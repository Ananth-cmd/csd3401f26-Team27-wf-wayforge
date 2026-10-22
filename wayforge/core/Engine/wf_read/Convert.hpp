/*!
 * \file Convert.hpp
 * \brief Plan image / SVG to Level, and Levels to Building
 *
 * convertImage() runs the raster pipeline for one floor:
 *   load -> (shrink) -> adaptive threshold -> drop annotations and small
 *   components -> thin -> trace -> fit -> scale to metres -> find lifts and
 *   stairs -> drop short diagonals -> clean -> drop door leaves ->
 *   wf_read::interpret -> tag stair / lift rooms.
 * convertSvg() starts from the imported SVG segments instead.
 * With ConvertOptions::debugDir set, an image of each step is written
 * (1_grey, 2_ink, 3_tidy, 4_skeleton, 5_lines, 6_rooms).
 *
 * assembleBuilding() stacks converted floors by elevation and renumbers ids
 * so they are unique across the building. Navigation is added afterwards
 * with wf::graph::prepareNavigation().
 *
 * Links: used by wf_cli (build / convert / debug) and by wf_api
 * (wf_convert_image, wf_convert_svg). Uses wf_image, wf_vector and
 * wf_read::interpret.
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Single pipeline shared by the CLI and the DLL
 *   - Symbol handling for architectural plans, multi-floor assembly
 *   - Per-step debug images
 *
 * AI declaration: Claude Opus was used as a support tool for debugging and build infrastructure.
 *
 * \date 2026-10-18
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#pragma once
#include <filesystem>
#include <string>
#include <vector>
#include "wf_read/wf_read.hpp"

namespace wf::read {

    // Settings for finding rooms in the picture (RasterRooms.cpp). Metres / square metres.
    struct RasterRoomParams {
        float closeGap = 0.3f;             // breaks in walls up to this wide are sealed
        float wallHalf = 0.12f;            // distance rooms are grown into their walls (to the wall centre)
        float minArea = 1.5f;              // smaller enclosed areas (door swings, ducts) are not rooms
        float maxArea = 800.f;             // larger regions are ignored (outside, lower roofs)
        float simplify = 0.1f;             // outline tolerance
        float corridorWidth = 2.6f;        // narrower than this and long = corridor
        float liftMinSide = 1.0f, liftMaxSide = 3.5f;   // size of a lift box (small box with an X)
    };

    // Window settings (read.cpp). Metres.
    struct WindowParams {
        float minWidth = 0.5f, maxWidth = 5.f;   // detected window length range
        float solidWall = 0.15f;           // walls drawn at least this thick count as solid
        float sill = 0.9f, height = 1.4f;  // sill height above the floor, window height
        float assumedWidth = 1.2f;         // assumed windows: width,
        float assumedGap = 1.2f;           //   gap between windows,
        float assumedMargin = 0.6f;        //   and clearance from the ends of an outside stretch
    };

    // Options for converting one floor. Lengths in metres unless stated.
    struct ConvertOptions {
        std::string levelId = "L1";
        std::string levelName;             // empty: "Level <digits of levelId>"
        float elevation = 0.f;             // above the ground floor
        float ceilingHeight = 3.f;
        float metresPerPixel = 0.f;        // 0: derive from widthMetres, else 0.02
        float widthMetres = 0.f;           // real width of the drawn plan, 0 if unknown
        int   maxImageSize = 4000;         // pixels; larger images are downscaled first
        float minPixelsPerMetre = 40.f;    // coarser images are upscaled to this before processing
        float maxBlobMetres = 1.5f;        // separate components up to this size are removed (text, fixtures)
        float inkWindowMetres = 0.3f;      // adaptive threshold window (min 15 px). Must exceed wall
                                           // thickness; smaller copes better with uneven lighting
        bool  removeText = true;           // removeSmallBlobs
        bool  removeAnnotations = true;    // keepMainDrawing
        bool  removeArcs = true;           // short diagonals and door leaves
        bool  detectStairs = true;
        bool  detectLifts = true;
        bool  roomsFromPicture = true;     // images: rooms traced from the picture (roomsFromInk); false: interpret()
        bool  detectWindows = true;        // images: windows from the ink across each wall
        bool  assumeWindows = false;       // add evenly spaced windows on outside walls without any
        WindowParams windows;
        RasterRoomParams rooms;
        ReadParams read;                   // passed to interpret()
        std::filesystem::path debugDir;    // if set, step images are written here
    };

    // Counts from one conversion (CLI output, tests, debug view).
    struct ConvertReport {
        int   imageWidth = 0, imageHeight = 0;   // after downscaling
        float metresPerPixel = 0.f;
        int   annotationsRemoved = 0;            // components outside the main drawing
        int   blobsRemoved = 0;                  // small components
        int   arcsRemoved = 0;                   // short diagonals removed before clean()
        int   diagonalsRemoved = 0;              // short diagonals removed after clean()
        int   leavesRemoved = 0;
        int   windowsFound = 0, windowsAssumed = 0;
        int   segments = 0;                      // segments passed to interpret()
        int   stairs = 0, lifts = 0;
        ReadStats read;
        std::vector<std::string> debugFiles;
    };

    // PNG / JPG / BMP -> one floor.
    Result<Level> convertImage(const std::filesystem::path& path, IdGenerator& ids,
                               const ConvertOptions& opt = {}, ConvertReport* report = nullptr);
    // SVG -> one floor. metresPerUnit: size of one SVG user unit.
    Result<Level> convertSvg(const std::filesystem::path& path, float metresPerUnit, IdGenerator& ids,
                             const ConvertOptions& opt = {}, ConvertReport* report = nullptr);

    // Set RoomKind::Stair / Lift on the smallest room containing each symbol centre when it is a
    // stairwell or shaft (up to 80 m^2, or up to 30 m^2 if corridor-shaped). A symbol standing in
    // a corridor or a larger hall gets a room of its own from the symbol box.
    void tagSymbolRooms(Level& level, const std::vector<vec::SymbolRegion>& stairs, const std::vector<vec::SymbolRegion>& lifts);

    // Rooms as enclosed paper areas of a cleaned ink image (0 = ink), mpp metres per pixel.
    // clearPixels: pixel rectangles to blank first (stair and lift symbols). Plan y points up.
    std::vector<Room> roomsFromInk(const img::Image8& ink, float mpp, const std::vector<Rect>& clearPixels,
                                   IdGenerator& ids, const RasterRoomParams& p = {});

    // Reassign wall, opening and room ids from ids and fix references. Clears nodes and edges.
    void renumberLevel(Level& level, IdGenerator& ids);
    // Sort floors by elevation and renumber them into one building.
    Building assembleBuilding(std::vector<Level> floors, const std::string& name);

    // Window openings where the ink across a wall shows a window symbol. ink: cleaned image
    // (0 = ink), mpp metres per pixel, plan y up. Returns the number added.
    int detectWindows(Level& level, const img::Image8& ink, float mpp, IdGenerator& ids, const WindowParams& p = {});
    // Evenly spaced windows on outside walls (room on one side only, not stairs or lifts) that
    // have no windows yet. Confidence 0.3 marks them as assumed. Returns the number added.
    int addAssumedWindows(Level& level, IdGenerator& ids, const WindowParams& p = {});

    // Move a floor by d metres (walls and rooms; openings are relative to their walls).
    void translateLevel(Level& level, Vec2 d);
    // Translate each floor (bottom-up order) onto the floor below. The shift maximises the number
    // of stair / lift rooms within `tolerance` metres of a room of the same kind below; among
    // those, the smallest shift with at least 80% of the best wall overlap is used. Floors without
    // a match are not moved. Returns the shift per floor.
    std::vector<Vec2> alignFloors(std::vector<Level>& floors, float tolerance = 2.5f);

} // namespace wf::read
