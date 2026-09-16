// wf_viewer - optional desktop debug viewer (GLFW). Build with -DWF_BUILD_VIEWER=ON.
#include <GLFW/glfw3.h>
#include <iostream>

int main() {
    if (!glfwInit()) { std::cerr << "GLFW init failed\n"; return 1; }
    GLFWwindow* w = glfwCreateWindow(800, 600, "Wayforge viewer", nullptr, nullptr);
    if (!w) { glfwTerminate(); return 1; }
    glfwMakeContextCurrent(w);
    while (!glfwWindowShouldClose(w)) { glClear(GL_COLOR_BUFFER_BIT); glfwSwapBuffers(w); glfwPollEvents(); }
    glfwTerminate();
    return 0;
}
