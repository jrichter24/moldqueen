# Top-level ESP-IDF project for the moldqueen ESP32-S3 radio core.
cmake_minimum_required(VERSION 3.16)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)

# Firmware version (shown on the mgmt page / Server-info via esp_app_get_description()->version):
#   - RELEASE builds: the esp32-release.yml workflow exports MK_PROJECT_VER from the esp-v* tag
#     (e.g. esp-v0.1.0 -> 0.1.0) so the baked-in version is the clean tag, not a git-describe.
#   - DEV / local builds: MK_PROJECT_VER is unset, so we leave PROJECT_VER unset and ESP-IDF
#     falls back to its default `git describe` (e.g. v0.1.2-11-gSHA[-dirty]) — unchanged behavior.
# Setting PROJECT_VER before project() is the standard ESP-IDF override hook.
if(DEFINED ENV{MK_PROJECT_VER} AND NOT "$ENV{MK_PROJECT_VER}" STREQUAL "")
    set(PROJECT_VER "$ENV{MK_PROJECT_VER}")
endif()

project(moldqueen_esp32)
