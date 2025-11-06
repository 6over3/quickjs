Hako QuickJS - WebAssembly JavaScript Engine
=============================================

This is a fork of QuickJS that compiles to WebAssembly using WASI SDK. It provides
a C API for embedding JavaScript execution in WebAssembly-based applications with
built-in TypeScript type stripping support.

Key Features
------------

- QuickJS JavaScript engine compiled to WebAssembly
- WASI reactor module (~800KB optimized)
- TypeScript type stripping via tree-sitter
- C API wrapper (hako.h/hako.c) for host integration
- Automated binding generation for host languages

Building
--------

Prerequisites:
  - WASI SDK (version 27 or later)
  - wasm-opt (from Binaryen)
  - Bun (for code generation)
  - wasm-objdump (from WABT, for bindings)

Build steps:

  1. Set WASI_SDK_PATH environment variable:
     export WASI_SDK_PATH=/path/to/wasi-sdk

  2. Build hako.wasm:
     ./release-hako.sh

  This runs make, compiles all sources, and optimizes the output with wasm-opt.

Code Generation
---------------

The codegen.ts tool generates language bindings from the compiled WASM module.

1. Parse WASM and generate bindings metadata:
   bun run codegen.ts parse hako.wasm hako.h bindings.json

   This extracts:
   - WASM type signatures and exports from hako.wasm
   - C function signatures and documentation from hako.h
   - Combines into bindings.json with complete metadata

2. Generate host language bindings:
   bun run codegen.ts generate csharp bindings.json HakoRegistry.cs

   Currently supports C# binding generation. The generated code includes:
   - Typed wrapper methods
   - Parameter marshalling
   - Documentation comments

Project Structure
-----------------

hako.h              - Public C API with function exports and documentation
hako.c              - Implementation wrapping QuickJS and TypeScript stripper
ts_strip/           - TypeScript type stripping using tree-sitter
release-hako.sh     - Build script with wasm-opt optimization
Makefile            - WASI build configuration
codegen.ts          - Binding generator tool

Documentation
-------------

For detailed QuickJS documentation, see doc/quickjs.pdf or doc/quickjs.html.
For Hako-specific usage, see the host implementations in the main repository.
