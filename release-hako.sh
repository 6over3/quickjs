#!/bin/sh
# Release Hako
set -e

OUTPUT_DIR=${1:-.}


if ! command -v wasm-opt >/dev/null 2>&1; then
    echo "Error: wasm-opt not found in PATH"
    exit 1
fi

make clean
make

if [ ! -f hako.wasm ]; then
    echo "Error: hako.wasm not found after make"
    exit 1
fi

wasm-opt hako.wasm \
    --enable-bulk-memory \
    --enable-simd \
    --enable-nontrapping-float-to-int \
    --enable-tail-call \
    -O3 \
    -o "${OUTPUT_DIR}/hako.wasm"

echo "Built and optimized hako -> ${OUTPUT_DIR}/hako.wasm"