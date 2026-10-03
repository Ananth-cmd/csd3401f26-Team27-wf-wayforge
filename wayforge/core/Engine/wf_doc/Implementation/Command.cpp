/*!
 * \file Command.cpp
 * \brief The code behind the undo stack and the edit commands
 *
 * The stack runs a command, clears redo, and either merges it into the one on
 * top (same kind, same target, within the time window) or pushes it. Undo and
 * redo move commands between the two stacks. Each command stores what it needs
 * to reverse itself: DeleteWall keeps the wall and its openings, MoveWall keeps
 * the old end points, SetProperty keeps the old value, SetRoomCode keeps the
 * old code and name.
 *
 * Links: implements what Command.hpp declares; commands change the building
 * through Document::mutableLevel (Document.cpp).
 *
 * \author Kannan Shrinivasan (k.shrinivasan@digipen.edu.sg)
 *
 * Contribution: Kannan Shrinivasan 100%
 *   - Stack execute, undo, redo, clear and discard
 *   - Merging of repeated moves and property edits
 *   - Do and Undo for each of the six commands
 *
 * AI declaration: Claude was used as a support tool for writing and debugging code and for the comments.
 *
 * \date 2026-09-21
 * \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.
 */

#include "wf_doc/Command.hpp"
#include "wf_doc/Document.hpp"
#include <algorithm>

namespace wf {

    //  CommandStack 
    //runs it first, clears redo, then joins the last edit if same key and within 300ms
    void CommandStack::execute(Document& doc, std::unique_ptr<ICommand> cmd)
    {
        cmd->Do(doc);
        m_redo.clear();
        const auto now = Clock::now();
        if (!m_undo.empty() && m_lastPush != Clock::time_point{}) 
        {
            const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(now - m_lastPush).count();
            auto& last = *m_undo.back();
            const std::string key = cmd->mergeKey();
            if (ms <= m_coalesceMs && !key.empty() && key == last.mergeKey() && last.tryMerge(*cmd))
            {
                m_lastPush = now;
                return;
            }
        }
        m_undo.push_back(std::move(cmd));
        m_lastPush = now;
    }

    bool CommandStack::undo(Document& doc) 
    {
        if (m_undo.empty()) return false;
        auto cmd = std::move(m_undo.back()); m_undo.pop_back();
        cmd->Undo(doc);
        m_redo.push_back(std::move(cmd));
        breakCoalescing();
        return true;
    }

    bool CommandStack::redo(Document& doc)
    {
        if (m_redo.empty()) return false;
        auto cmd = std::move(m_redo.back()); m_redo.pop_back();
        cmd->Do(doc);
        m_undo.push_back(std::move(cmd));
        breakCoalescing();
        return true;
    }

    void CommandStack::clear() noexcept { m_undo.clear(); m_redo.clear(); breakCoalescing(); }
    //drops last entry without undoing it, for edits that did nothing
    void CommandStack::discardLast() noexcept { if (!m_undo.empty()) m_undo.pop_back(); breakCoalescing(); }

    //AddWall 
    void AddWallCommand::Do(Document& doc) { if (auto* l = doc.mutableLevel(m_level)) l->walls.push_back(m_wall); }
    void AddWallCommand::Undo(Document& doc)
    {
        if (auto* l = doc.mutableLevel(m_level)) std::erase_if(l->walls, [&](const Wall& w) { return w.id == m_wall.id; });
    }

    // DeleteWall 
    //saves wall and its position, also pulls out the openings on it and saves them
    void DeleteWallCommand::Do(Document& doc)
    {
        auto* l = doc.mutableLevel(m_level);
        if (!l) return;
        auto it = std::find_if(l->walls.begin(), l->walls.end(), [&](const Wall& w) { return w.id == m_wallId; });
        if (it == l->walls.end()) return;
        m_index = static_cast<size_t>(it - l->walls.begin());
        m_backup = *it;
        l->walls.erase(it);
        m_orphanedOpenings.clear();

        std::erase_if(l->openings, [&](const Opening& o)
            {
                if (o.wall == m_wallId) { m_orphanedOpenings.push_back(o); return true; }
                return false;
            });
    }

    //wall goes back in same spot, openings go on the end of the list
    void DeleteWallCommand::Undo(Document& doc)
    {
        auto* l = doc.mutableLevel(m_level);
        if (!l) return;
        const size_t at = std::min(m_index, l->walls.size());
        l->walls.insert(l->walls.begin() + static_cast<std::ptrdiff_t>(at), m_backup);
        for (auto& o : m_orphanedOpenings) l->openings.push_back(o);
        m_orphanedOpenings.clear();
    }

    // MoveWall 
    //old ends only saved the first time, so redo doesnt overwrite them
    void MoveWallCommand::Do(Document& doc)
    {
        auto* l = doc.mutableLevel(m_level);
        if (!l) return;
        if (Wall* w = l->findWall(m_wallId))
        {
            if (!m_captured) { m_oldA = w->a; m_oldB = w->b; m_captured = true; }
            w->a = m_newA; w->b = m_newB;
        }
    }
    void MoveWallCommand::Undo(Document& doc)
    {
        auto* l = doc.mutableLevel(m_level);
        if (!l) return;
        if (Wall* w = l->findWall(m_wallId)) { w->a = m_oldA; w->b = m_oldB; }
    }

    bool MoveWallCommand::tryMerge(const ICommand& next)
    {
        const auto* other = dynamic_cast<const MoveWallCommand*>(&next);
        if (!other) return false;
        m_newA = other->m_newA; m_newB = other->m_newB;   // keep our old, take their new
        return true;
    }

    // SetProperty 
    namespace 
    {
        //helpers
        template <class T>
        bool applyProp(std::vector<T>& v, std::string_view id, std::string_view prop,
            const PropertyValue& value, PropertyValue* oldOut)
        {
            for (auto& e : v) if (e.id == id)
            {
                if (oldOut) *oldOut = getProperty(e, prop).value_or(PropertyValue{});
                return setProperty(e, prop, value);
            }

            return false;
        }
    }

    //saves old value first time, m_failed if element, name or type is wrong
    void SetPropertyCommand::Do(Document& doc)
    {
        auto* l = doc.mutableLevel(m_level);
        if (!l) { m_failed = true; return; }
        PropertyValue* oldOut = m_captured ? nullptr : &m_old;
        bool ok = false;
        switch (m_kind)
        {
            case ElementKind::Wall:    ok = applyProp(l->walls, m_elementId, m_property, m_new, oldOut); break;
            case ElementKind::Opening: ok = applyProp(l->openings, m_elementId, m_property, m_new, oldOut); break;
            case ElementKind::Room:    ok = applyProp(l->rooms, m_elementId, m_property, m_new, oldOut); break;
            case ElementKind::Node:    ok = applyProp(l->nodes, m_elementId, m_property, m_new, oldOut); break;
            case ElementKind::Poi:     ok = applyProp(l->pois, m_elementId, m_property, m_new, oldOut); break;
            case ElementKind::Anchor:  ok = applyProp(l->anchors, m_elementId, m_property, m_new, oldOut); break;
            case ElementKind::Level:
                if (oldOut) *oldOut = getProperty(*l, m_property).value_or(PropertyValue{});
                ok = setProperty(*l, m_property, m_new); break;
        }
        m_captured = true;
        m_failed = !ok;
    }

    void SetPropertyCommand::Undo(Document& doc)
    {
        if (m_failed) return;
        auto* l = doc.mutableLevel(m_level);
        if (!l) return;
        switch (m_kind) 
        {
            case ElementKind::Wall:    applyProp(l->walls, m_elementId, m_property, m_old, nullptr); break;
            case ElementKind::Opening: applyProp(l->openings, m_elementId, m_property, m_old, nullptr); break;
            case ElementKind::Room:    applyProp(l->rooms, m_elementId, m_property, m_old, nullptr); break;
            case ElementKind::Node:    applyProp(l->nodes, m_elementId, m_property, m_old, nullptr); break;
            case ElementKind::Poi:     applyProp(l->pois, m_elementId, m_property, m_old, nullptr); break;
            case ElementKind::Anchor:  applyProp(l->anchors, m_elementId, m_property, m_old, nullptr); break;
            case ElementKind::Level:   setProperty(*l, m_property, m_old); break;
        }
    }

    //same as move, keep our old value take their new one
    bool SetPropertyCommand::tryMerge(const ICommand& next)
    {
        const auto* other = dynamic_cast<const SetPropertyCommand*>(&next);
        if (!other || other->m_failed) return false;
        m_new = other->m_new;
        return true;
    }

    // AddOpening 
    void AddOpeningCommand::Do(Document& doc) { if (auto* l = doc.mutableLevel(m_level)) l->openings.push_back(m_opening); }
    void AddOpeningCommand::Undo(Document& doc)
    {
        if (auto* l = doc.mutableLevel(m_level))
            std::erase_if(l->openings, [&](const Opening& o) { return o.id == m_opening.id; });
    }

    //SetRoomCode 
    void SetRoomCodeCommand::Do(Document& doc)
    {
        auto* l = doc.mutableLevel(m_level);
        if (!l) return;
        if (Room* r = l->findRoom(m_roomId)) { m_oldCode = r->code; m_oldName = r->name; r->code = m_code; r->name = m_name; }
    }

    void SetRoomCodeCommand::Undo(Document& doc)
    {
        auto* l = doc.mutableLevel(m_level);
        if (!l) return;
        if (Room* r = l->findRoom(m_roomId)) { r->code = m_oldCode; r->name = m_oldName; }
    }

} // namespace wf