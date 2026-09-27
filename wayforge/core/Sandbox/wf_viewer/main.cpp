// wf_viewer - look at a .wfb on the desktop.
//   wf_viewer building.wfb
// Left-click a room to set the start, right-click a room to set the destination:
// the A* route is drawn. Press S to toggle step-free mode, G to toggle the graph,
// R to rebuild the graph, Esc to quit. Scroll to zoom, drag with the middle button to pan.
#include <GLFW/glfw3.h>
#include <iostream>
#include <string>
#include "wf_core/wf_core.hpp"
#include "wf_doc/wf_doc.hpp"
#include "wf_graph/wf_graph.hpp"

using namespace wf;

namespace {
struct View {
    Document doc;
    int    levelIndex = 0;
    float  zoom = 40.f;                // pixels per metre
    Vec2   pan{40.f, 40.f};
    bool   showGraph = true, stepFree = false;
    std::string from, to;
    graph::Route route;
    int width = 1280, height = 800;
    bool dragging = false; double lastX = 0, lastY = 0;
};
View g;

Vec2 toWorld(double px, double py) { return { (static_cast<float>(px) - g.pan.x) / g.zoom, (g.height - static_cast<float>(py) - g.pan.y) / g.zoom }; }

void colourFor(float confidence) {
    if (confidence >= 0.7f)      glColor3f(0.12f, 0.43f, 0.25f);
    else if (confidence >= 0.4f) glColor3f(0.82f, 0.54f, 0.f);
    else                         glColor3f(0.75f, 0.22f, 0.17f);
}

void drawLevel(const Level& l) {
    // rooms
    for (const Room& r : l.rooms) {
        if (r.kind == RoomKind::Corridor) glColor3f(0.91f, 0.94f, 1.f); else if (r.kind == RoomKind::Exit) glColor3f(0.99f, 0.91f, 0.91f); else glColor3f(0.95f, 0.97f, 0.94f);
        glBegin(GL_TRIANGLE_FAN);                        // convex-ish fill; good enough for a debug view
        for (const Vec2& p : r.polygon) glVertex2f(p.x, p.y);
        glEnd();
    }
    // graph
    if (g.showGraph) {
        glColor3f(0.62f, 0.72f, 0.84f); glLineWidth(1.f);
        glBegin(GL_LINES);
        for (const Edge& e : l.edges) { const Node* a = l.findNode(e.a); const Node* b = l.findNode(e.b); if (a && b) { glVertex2f(a->pos.x, a->pos.y); glVertex2f(b->pos.x, b->pos.y); } }
        glEnd();
        glPointSize(5.f); glBegin(GL_POINTS);
        for (const Node& n : l.nodes) { if (n.kind == NodeKind::Door) glColor3f(0.9f, 0.49f, 0.13f); else if (n.kind == NodeKind::Exit) glColor3f(0.75f, 0.22f, 0.17f); else glColor3f(0.17f, 0.44f, 0.73f); glVertex2f(n.pos.x, n.pos.y); }
        glEnd();
    }
    // walls
    for (const Wall& w : l.walls) {
        colourFor(w.confidence); glLineWidth(std::max(2.f, w.thickness * g.zoom));
        glBegin(GL_LINES); glVertex2f(w.a.x, w.a.y); glVertex2f(w.b.x, w.b.y); glEnd();
    }
    // openings (drawn white over the wall)
    for (const Opening& o : l.openings) {
        const Wall* w = l.findWall(o.wall); if (!w) continue;
        const Vec2 d = w->direction(); const Vec2 a = w->a + d * o.offset; const Vec2 b = a + d * o.width;
        if (o.type == OpeningType::Window) glColor3f(0.2f, 0.6f, 0.86f); else glColor3f(1, 1, 1);
        glLineWidth(std::max(3.f, w->thickness * g.zoom + 2)); glBegin(GL_LINES); glVertex2f(a.x, a.y); glVertex2f(b.x, b.y); glEnd();
    }
    // route
    if (!g.route.empty()) {
        glColor3f(0.9f, 0.3f, 0.24f); glLineWidth(4.f); glBegin(GL_LINE_STRIP);
        for (const auto& s : g.route.steps) if (s.level == l.id) glVertex2f(s.pos.x, s.pos.y);
        glEnd();
    }
}

void recomputeRoute() {
    g.route = {};
    if (g.from.empty() || g.to.empty()) return;
    auto r = graph::findRoute(g.doc.building(), g.from, g.to, {g.stepFree});
    if (r) { g.route = *r; std::cout << "route cost " << r->totalCost << (r->stepFree ? " step-free" : " uses stairs") << "\n"; }
    else std::cout << "route: " << r.error() << "\n";
}

std::string roomNodeAt(const Vec2& p) {
    const Level* l = g.doc.level(g.levelIndex); if (!l) return {};
    for (const Room& r : l->rooms) if (pointInPolygon(p, r.polygon)) { auto n = graph::nodeForRoom(g.doc.building(), r.id); return n ? *n : ""; }
    return {};
}

void onMouse(GLFWwindow* w, int button, int action, int) {
    double x, y; glfwGetCursorPos(w, &x, &y);
    if (button == GLFW_MOUSE_BUTTON_MIDDLE) { g.dragging = action == GLFW_PRESS; g.lastX = x; g.lastY = y; return; }
    if (action != GLFW_PRESS) return;
    const std::string n = roomNodeAt(toWorld(x, y));
    if (n.empty()) return;
    if (button == GLFW_MOUSE_BUTTON_LEFT) g.from = n; else g.to = n;
    recomputeRoute();
}
void onCursor(GLFWwindow*, double x, double y) {
    if (g.dragging) { g.pan.x += static_cast<float>(x - g.lastX); g.pan.y -= static_cast<float>(y - g.lastY); g.lastX = x; g.lastY = y; }
}
void onScroll(GLFWwindow* w, double, double dy) {
    double x, y; glfwGetCursorPos(w, &x, &y);
    const Vec2 before = toWorld(x, y);
    g.zoom *= dy > 0 ? 1.1f : 0.9f;
    const Vec2 after = toWorld(x, y);
    g.pan += (after - before) * g.zoom;
}
void onKey(GLFWwindow* w, int key, int, int action, int) {
    if (action != GLFW_PRESS) return;
    if (key == GLFW_KEY_ESCAPE) glfwSetWindowShouldClose(w, 1);
    if (key == GLFW_KEY_G) g.showGraph = !g.showGraph;
    if (key == GLFW_KEY_S) { g.stepFree = !g.stepFree; std::cout << "step-free " << (g.stepFree ? "on" : "off") << "\n"; recomputeRoute(); }
    if (key == GLFW_KEY_R) { IdGenerator ids; ids.bump(100000); graph::buildGraph(g.doc.mutableBuilding(), ids, {}); g.from.clear(); g.to.clear(); g.route = {}; std::cout << "graph rebuilt\n"; }
    if (key == GLFW_KEY_PAGE_UP)   g.levelIndex = std::min(g.levelIndex + 1, g.doc.levelCount() - 1);
    if (key == GLFW_KEY_PAGE_DOWN) g.levelIndex = std::max(g.levelIndex - 1, 0);
}
} // namespace

int main(int argc, char** argv) {
    if (argc < 2) { std::cerr << "usage: wf_viewer building.wfb\n"; return 2; }
    auto doc = Document::load(argv[1]);
    if (!doc) { std::cerr << doc.error() << "\n"; return 1; }
    g.doc = std::move(*doc);
    if (!glfwInit()) { std::cerr << "GLFW init failed\n"; return 1; }
    GLFWwindow* window = glfwCreateWindow(g.width, g.height, ("Wayforge viewer - " + g.doc.building().building.name).c_str(), nullptr, nullptr);
    if (!window) { glfwTerminate(); return 1; }
    glfwMakeContextCurrent(window);
    glfwSwapInterval(1);
    glfwSetMouseButtonCallback(window, onMouse);
    glfwSetCursorPosCallback(window, onCursor);
    glfwSetScrollCallback(window, onScroll);
    glfwSetKeyCallback(window, onKey);
    std::cout << "left-click: start room, right-click: destination, S: step-free, G: graph, R: rebuild graph, PgUp/PgDn: level\n";
    while (!glfwWindowShouldClose(window)) {
        glfwGetFramebufferSize(window, &g.width, &g.height);
        glViewport(0, 0, g.width, g.height);
        glClearColor(1, 1, 1, 1); glClear(GL_COLOR_BUFFER_BIT);
        glMatrixMode(GL_PROJECTION); glLoadIdentity(); glOrtho(0, g.width, 0, g.height, -1, 1);
        glMatrixMode(GL_MODELVIEW); glLoadIdentity();
        glTranslatef(g.pan.x, g.pan.y, 0); glScalef(g.zoom, g.zoom, 1);
        if (const Level* l = g.doc.level(g.levelIndex)) drawLevel(*l);
        glfwSwapBuffers(window);
        glfwPollEvents();
    }
    glfwDestroyWindow(window);
    glfwTerminate();
    return 0;
}
