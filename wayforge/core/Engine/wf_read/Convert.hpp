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

    // Options for converting one floor. Lengths in metres unless stated.
    struct ConvertOptions {
        std::string levelId = "L1";
        std::string levelName;             // empty: "Level <digits of levelId>"
        float elevation = 0.f;             // above the ground floor
        float ceilingHeight = 3.f;
        float metresPerPixel = 0.f;        // 0: derive from widthMetres, else 0.02
        float widthMetres = 0.f;           // real width of the drawn plan, 0 if unknown
        int   maxImageSize = 4000;         // pixels; larger images are downscaled first
        float maxBlobMetres = 1.5f;        // separate components up to this size are removed (text, fixtures)
        float inkWindowMetres = 0.3f;      // adaptive threshold window (min 15 px). Must exceed wall
                                           // thickness; smaller copes better with uneven lighting
        bool  removeText = true;           // removeSmallBlobs
        bool  removeAnnotations = true;    // keepMainDrawing
        bool  removeArcs = true;           // short diagonals and door leaves
        bool  detectStairs = true;
        bool  detectLifts = true;
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

    // Set RoomKind::Stair / Lift on rooms containing a symbol centre. Corridors and rooms over
    // 80 m^2 are left as they are.
    void tagSymbolRooms(Level& level, const std::vector<vec::SymbolRegion>& stairs, const std::vector<vec::SymbolRegion>& lifts);

    // Reassign wall, opening and room ids from ids and fix references. Clears nodes and edges.
    void renumberLevel(Level& level, IdGenerator& ids);
    // Sort floors by elevation and renumber them into one building.
    Building assembleBuilding(std::vector<Level> floors, const std::string& name);

} // namespace wf::read
