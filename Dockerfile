# Wayforge dev environment: Ubuntu 24.04 with everything docs/setup.md asks for on Linux.
# The source code is NOT copied in - docker-compose.yml mounts the repo at /workspace,
# so edits you make in Windows show up in the container immediately.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# build-essential = GCC 13 (C++20), cmake 3.28, ninja, git + certs for FetchContent, python3 for golden tests
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

WORKDIR /workspace/wayforge
CMD ["bash"]
