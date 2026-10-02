/*!
 * \file Stb.cpp
 * \brief The one place where the stb image library's code is compiled
 *
 * stb_image and stb_image_write are "single header" libraries: the header
 * only declares the functions unless you define *_IMPLEMENTATION before
 * including it, and then it also contains the real code. That must happen
 * in exactly one .cpp file, otherwise the linker finds the same functions
 * twice. This is that file. Load.cpp only includes the headers normally.
 * stb is on the approved list as tools-only (Y*).
 *
 * \author Ananthan Elangovan (ananthan.e@digipen.edu)
 *
 * Contribution: Ananthan Elangovan 100%
 *   - Isolated third-party code in a single file with its warnings silenced
 *   - Turned off image formats we never use to keep the build small
 *
 * AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the Doxygen header comments.
 *
 * \date 2026-09-27
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

// Single translation unit that owns the stb implementations. Never include this
// pattern anywhere else, or you get duplicate symbols.

// stb is not our code, so hide its compiler warnings here (we keep a zero-warning build).
#if defined(__GNUC__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wunused-function"
#pragma GCC diagnostic ignored "-Wsign-compare"
#pragma GCC diagnostic ignored "-Wmissing-field-initializers"
#endif
#if defined(_MSC_VER)
#pragma warning(push)
#pragma warning(disable : 4996 4244 4456 4457)
#endif

#define STB_IMAGE_IMPLEMENTATION   // "Put the real decoding code in this file."
#define STBI_NO_HDR                // We never load HDR, PSD, PIC or PNM floor plans,
#define STBI_NO_PSD                // so leave those decoders out.
#define STBI_NO_PIC
#define STBI_NO_PNM
#include <stb_image.h>

#define STB_IMAGE_WRITE_IMPLEMENTATION   // Same for the PNG writer used by savePng().
#include <stb_image_write.h>

// Turn the warnings back on for everything after this file.
#if defined(_MSC_VER)
#pragma warning(pop)
#endif
#if defined(__GNUC__)
#pragma GCC diagnostic pop
#endif
