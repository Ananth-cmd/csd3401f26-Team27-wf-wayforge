// The Document: a Building plus its command stack and id generators.
// All mutation goes through execute(); nothing outside the command classes
// writes to document fields directly (Rule from build plan 9.3).
#pragma once
#include <memory>
#include <string>
#include <filesystem>
#include "Types.hpp"
#include "Command.hpp"

namespace wf {

class Document {
public:
    Document();
    explicit Document(Building building);

    // --- read access --------------------------------------------------------
    const Building& building() const noexcept { return m_building; }
    int    levelCount() const noexcept { return static_cast<int>(m_building.levels.size()); }
    const Level* level(int index) const noexcept;
    bool   dirty() const noexcept { return m_dirty; }
    const std::filesystem::path& path() const noexcept { return m_path; }

    // --- mutation (always through commands) --------------------------------
    void execute(std::unique_ptr<ICommand> cmd);
    bool undo();
    bool redo();
    CommandStack& commands() noexcept { return m_commands; }

    // Convenience wrappers that build the right command.
    std::string addWall(int level, Vec2 a, Vec2 b, float thickness, float confidence = 1.f);
    bool        deleteWall(int level, std::string_view wallId);
    bool        moveWall(int level, std::string_view wallId, Vec2 a, Vec2 b);
    bool        setProperty(int level, ElementKind kind, std::string_view elementId, std::string_view property, PropertyValue value);
    std::string addOpening(int level, std::string_view wallId, OpeningType type, float offset, float width, float confidence = 1.f);
    bool        setRoomCode(int level, std::string_view roomId, std::string_view code, std::string_view name);

    // Bulk replace (used by the converter, not undoable - it is the import step).
    void   replaceBuilding(Building building);
    int    addLevel(Level level);
    std::string nextId(std::string_view prefix) { return m_ids.next(prefix); }

    // --- persistence --------------------------------------------------------
    Status save(const std::filesystem::path& path);
    static Result<Document> load(const std::filesystem::path& path);
    std::string toJson(int indent = 2) const;
    static Result<Document> fromJson(std::string_view json);

    // internal: commands need write access
    Building& mutableBuilding() noexcept { m_dirty = true; return m_building; }
    Level*    mutableLevel(int index) noexcept;

private:
    void rescanIds();
    Building     m_building;
    CommandStack m_commands;
    IdGenerator  m_ids;
    std::filesystem::path m_path;
    bool m_dirty = false;
};

} // namespace wf
