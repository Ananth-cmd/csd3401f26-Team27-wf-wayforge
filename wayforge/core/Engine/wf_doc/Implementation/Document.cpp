#include "wf_doc/Document.hpp"
#include "wf_doc/Serialize.hpp"

namespace wf {

Document::Document() = default;
Document::Document(Building building) : m_building(std::move(building)) { rescanIds(); }

const Level* Document::level(int index) const noexcept {
    if (index < 0 || index >= levelCount()) return nullptr;
    return &m_building.levels[static_cast<size_t>(index)];
}
Level* Document::mutableLevel(int index) noexcept {
    if (index < 0 || index >= levelCount()) return nullptr;
    m_dirty = true;
    return &m_building.levels[static_cast<size_t>(index)];
}

void Document::execute(std::unique_ptr<ICommand> cmd) { m_commands.execute(*this, std::move(cmd)); m_dirty = true; }
bool Document::undo() { return m_commands.undo(*this); }
bool Document::redo() { return m_commands.redo(*this); }

std::string Document::addWall(int level, Vec2 a, Vec2 b, float thickness, float confidence) {
    Wall w; w.id = nextId("w"); w.a = a; w.b = b; w.thickness = thickness; w.confidence = confidence;
    std::string id = w.id;
    execute(std::make_unique<AddWallCommand>(level, std::move(w)));
    return id;
}
bool Document::deleteWall(int level, std::string_view wallId) {
    const Level* l = this->level(level);
    if (!l || !l->findWall(wallId)) return false;
    execute(std::make_unique<DeleteWallCommand>(level, std::string(wallId)));
    return true;
}
bool Document::moveWall(int level, std::string_view wallId, Vec2 a, Vec2 b) {
    const Level* l = this->level(level);
    if (!l || !l->findWall(wallId)) return false;
    execute(std::make_unique<MoveWallCommand>(level, std::string(wallId), a, b));
    return true;
}
bool Document::setProperty(int level, ElementKind kind, std::string_view elementId, std::string_view property, PropertyValue value) {
    auto cmd = std::make_unique<SetPropertyCommand>(level, kind, std::string(elementId), std::string(property), std::move(value));
    SetPropertyCommand* raw = cmd.get();
    execute(std::move(cmd));
    if (raw->failed()) { m_commands.discardLast(); return false; }   // never leave a no-op on the stack
    return true;
}
std::string Document::addOpening(int level, std::string_view wallId, OpeningType type, float offset, float width, float confidence) {
    const Level* l = this->level(level);
    if (!l || !l->findWall(wallId)) return {};
    Opening o; o.id = nextId("o"); o.wall = std::string(wallId); o.type = type; o.offset = offset; o.width = width; o.confidence = confidence;
    std::string id = o.id;
    execute(std::make_unique<AddOpeningCommand>(level, std::move(o)));
    return id;
}
bool Document::setRoomCode(int level, std::string_view roomId, std::string_view code, std::string_view name) {
    const Level* l = this->level(level);
    if (!l || !l->findRoom(roomId)) return false;
    execute(std::make_unique<SetRoomCodeCommand>(level, std::string(roomId), std::string(code), std::string(name)));
    return true;
}

void Document::replaceBuilding(Building building) {
    m_building = std::move(building);
    m_commands.clear();
    rescanIds();
    m_dirty = true;
}
int Document::addLevel(Level level) {
    m_building.levels.push_back(std::move(level));
    m_dirty = true;
    return levelCount() - 1;
}

void Document::rescanIds() {
    m_ids.reset();
    for (auto& l : m_building.levels) {
        for (auto& w : l.walls)    m_ids.bump(idNumber(w.id));
        for (auto& o : l.openings) m_ids.bump(idNumber(o.id));
        for (auto& r : l.rooms)    m_ids.bump(idNumber(r.id));
        for (auto& n : l.nodes)    m_ids.bump(idNumber(n.id));
        for (auto& p : l.pois)     m_ids.bump(idNumber(p.id));
    }
}

Status Document::save(const std::filesystem::path& path) {
    auto s = io::writeText(path, toJson());
    if (s) { m_path = path; m_dirty = false; }
    return s;
}
Result<Document> Document::load(const std::filesystem::path& path) {
    auto text = io::readText(path);
    if (!text) return Result<Document>::fail(text.error());
    auto doc = fromJson(text.value());
    if (!doc) return Result<Document>::fail(path.string() + ": " + doc.error());
    doc->m_path = path;
    doc->m_dirty = false;
    return doc;
}
std::string Document::toJson(int indent) const { return buildingToJson(m_building, indent); }
Result<Document> Document::fromJson(std::string_view json) {
    auto b = buildingFromJson(json);
    if (!b) return Result<Document>::fail(b.error());
    return Document(std::move(b.value()));
}

} // namespace wf
