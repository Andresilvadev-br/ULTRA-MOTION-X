#!/usr/bin/env bash
# Builds the C ABI and runs the C and C++ conformance programs against the public headers.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
cargo build -p umx-ffi --release
OUT="$ROOT/sdk/ffi/tests/build"
mkdir -p "$OUT"
LIB="$ROOT/target/release/libultra_motion_x.a"
LIBS="-lpthread -ldl -lm"
cc -std=c11 -Wall -Wextra -Werror -I sdk/ffi/include sdk/ffi/tests/abi_test.c "$LIB" $LIBS -o "$OUT/abi_test"
c++ -std=c++17 -Wall -Wextra -Werror -I sdk/ffi/include sdk/ffi/tests/cpp_wrapper_test.cpp "$LIB" $LIBS -o "$OUT/cpp_wrapper_test"
"$OUT/abi_test"
"$OUT/cpp_wrapper_test"
