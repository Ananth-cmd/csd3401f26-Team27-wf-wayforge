# \file Dockerfile
# \brief Wayforge dev environment: Ubuntu 24.04 with everything docs/setup.md asks for on Linux
#
# The source code is NOT copied in - docker-compose.yml mounts the repo at /workspace,
# so edits you make in Windows show up in the container immediately.
#
# Links: built by `docker compose build` (docker-compose.yml) and by the "docker"
# job in .github/workflows/build.yml.
#
# \author Joel Chua (c.jialiang@digipen.edu)
#
# Contribution: Joel Chua 100%
#   - Minimal Linux toolchain image matching the CI Ubuntu build
#
# AI declaration: Claude Opus was used as a support tool for debugging, build infrastructure and the header comments.
#
# \date 2026-09-18
# \copyright 2026 DigiPen Institute of Technology Singapore. All rights reserved.

# Ubuntu 24.04 ships GCC 13 and CMake 3.28, which are new enough for the core's C++20.
FROM ubuntu:24.04

# Stop apt from asking questions (e.g. time zone) while the image builds.
ENV DEBIAN_FRONTEND=noninteractive

# build-essential = GCC 13 (C++20), cmake 3.28, ninja, git + certs for FetchContent, python3 for golden tests
# --no-install-recommends and deleting the apt lists afterwards keep the image small.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        cmake \
        ninja-build \
        git \
        ca-certificates \
        python3 \
    && rm -rf /var/lib/apt/lists/*

# The mounted repo is owned by your Windows user, not root; stop git complaining about that.
RUN git config --global --add safe.directory '*'

# Start in the C++ project folder inside the mounted repo, with a bash shell.
WORKDIR /workspace/wayforge
CMD ["bash"]
