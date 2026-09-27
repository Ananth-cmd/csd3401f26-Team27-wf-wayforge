// Undo is a first-class citizen, not an afterthought (High Level Vision deck).
//
// Every mutation of the document is an ICommand with Do() and Undo(), pushed on
// the CommandStack. Two stacks, undo and redo; doing something new clears redo.
// Consecutive commands of the same kind on the same target within ~300 ms are
// coalesced so a 60-step drag is one undo step.
#pragma once
#include <memory>
#include <string>
#include <vector>
#include <chrono>
#include "Types.hpp"

namespace wf {

class Document;

struct ICommand {
    virtual ~ICommand() = default;
    virtual void Do(Document& doc)   = 0;
    virtual void Undo(Document& doc) = 0;
    virtual std::string name() const = 0;

    // Coalescing: return true if `next` was absorbed into this command.
    virtual bool tryMerge(const ICommand& /*next*/) { return false; }
    // Identity used for coalescing: same kind + same target => candidates to merge.
    virtual std::string mergeKey() const { return {}; }
};

class CommandStack {
public:
    using Clock = std::chrono::steady_clock;

    void execute(Document& doc, std::unique_ptr<ICommand> cmd);
    bool undo(Document& doc);
    bool redo(Document& doc);
    void clear() noexcept;
    // Drop the most recent undo entry without running Undo (used when a command turned out to be a no-op).
    void discardLast() noexcept;

    bool   canUndo() const noexcept { return !m_undo.empty(); }
    bool   canRedo() const noexcept { return !m_redo.empty(); }
    size_t undoDepth() const noexcept { return m_undo.size(); }
    size_t redoDepth() const noexcept { return m_redo.size(); }
    std::string nextUndoName() const { return m_undo.empty() ? "" : m_undo.back()->name(); }
    std::string nextRedoName() const { return m_redo.empty() ? "" : m_redo.back()->name(); }

    void setCoalesceWindowMs(int ms) noexcept { m_coalesceMs = ms; }
    // Force the next command to start a new undo step even if it could merge.
    void breakCoalescing() noexcept { m_lastPush = Clock::time_point{}; }

private:
    std::vector<std::unique_ptr<ICommand>> m_undo;
    std::vector<std::unique_ptr<ICommand>> m_redo;
    Clock::time_point m_lastPush{};
    int m_coalesceMs = 300;
};

// ---- concrete commands ------------------------------------------------------
// All of them address elements by level index + element id so they stay valid
// while other elements come and go.

class AddWallCommand final : public ICommand {
public:
    AddWallCommand(int level, Wall wall) : m_level(level), m_wall(std::move(wall)) {}
    void Do(Document& doc) override;
    void Undo(Document& doc) override;
    std::string name() const override { return "Add wall " + m_wall.id; }
    const std::string& wallId() const noexcept { return m_wall.id; }
private:
    int  m_level;
    Wall m_wall;
};

class DeleteWallCommand final : public ICommand {
public:
    DeleteWallCommand(int level, std::string wallId) : m_level(level), m_wallId(std::move(wallId)) {}
    void Do(Document& doc) override;
    void Undo(Document& doc) override;
    std::string name() const override { return "Delete wall " + m_wallId; }
private:
    int         m_level;
    std::string m_wallId;
    Wall        m_backup;
    size_t      m_index = 0;
    std::vector<Opening> m_orphanedOpenings;   // openings on this wall are removed with it
};

// Moves both endpoints (a drag). Coalesces with itself.
class MoveWallCommand final : public ICommand {
public:
    MoveWallCommand(int level, std::string wallId, Vec2 newA, Vec2 newB)
        : m_level(level), m_wallId(std::move(wallId)), m_newA(newA), m_newB(newB) {}
    void Do(Document& doc) override;
    void Undo(Document& doc) override;
    std::string name() const override { return "Move wall " + m_wallId; }
    std::string mergeKey() const override { return "MoveWall:" + std::to_string(m_level) + ":" + m_wallId; }
    bool tryMerge(const ICommand& next) override;
private:
    int m_level; std::string m_wallId;
    Vec2 m_newA, m_newB, m_oldA, m_oldB;
    bool m_captured = false;
};

// Generic "set one reflected property on one element" - works for any registered
// type: walls, openings, rooms, nodes... This is why the property system exists.
enum class ElementKind : uint8_t { Wall, Opening, Room, Node, Poi, Anchor, Level };

class SetPropertyCommand final : public ICommand {
public:
    SetPropertyCommand(int level, ElementKind kind, std::string elementId, std::string property, PropertyValue value)
        : m_level(level), m_kind(kind), m_elementId(std::move(elementId)), m_property(std::move(property)), m_new(std::move(value)) {}
    void Do(Document& doc) override;
    void Undo(Document& doc) override;
    std::string name() const override { return "Set " + m_property + " on " + m_elementId; }
    std::string mergeKey() const override { return "SetProp:" + std::to_string(m_level) + ":" + m_elementId + ":" + m_property; }
    bool tryMerge(const ICommand& next) override;
    bool failed() const noexcept { return m_failed; }
private:
    int m_level; ElementKind m_kind; std::string m_elementId; std::string m_property;
    PropertyValue m_new, m_old;
    bool m_captured = false, m_failed = false;
};

class AddOpeningCommand final : public ICommand {
public:
    AddOpeningCommand(int level, Opening opening) : m_level(level), m_opening(std::move(opening)) {}
    void Do(Document& doc) override;
    void Undo(Document& doc) override;
    std::string name() const override { return "Add opening " + m_opening.id; }
private:
    int m_level; Opening m_opening;
};

class SetRoomCodeCommand final : public ICommand {
public:
    SetRoomCodeCommand(int level, std::string roomId, std::string code, std::string name)
        : m_level(level), m_roomId(std::move(roomId)), m_code(std::move(code)), m_name(std::move(name)) {}
    void Do(Document& doc) override;
    void Undo(Document& doc) override;
    std::string name() const override { return "Tag room " + m_roomId; }
private:
    int m_level; std::string m_roomId, m_code, m_name, m_oldCode, m_oldName;
};

} // namespace wf
