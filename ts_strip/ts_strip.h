#ifndef TS_STRIP_H
#define TS_STRIP_H
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

//! Return status codes for ts_strip operations
typedef enum {
    TS_STRIP_SUCCESS = 0,           //! Successfully stripped types
    TS_STRIP_ERROR_INVALID_INPUT,   //! NULL input or invalid parameters
    TS_STRIP_ERROR_PARSE_FAILED,    //! Failed to parse TypeScript
    TS_STRIP_ERROR_UNSUPPORTED,     //! Contains unsupported/non-erasable syntax
    TS_STRIP_ERROR_OUT_OF_MEMORY    //! Memory allocation failed
} ts_strip_result_t;

//! Custom memory allocator functions
typedef struct {
    void* (*malloc_func)(void* user_data, size_t size);
    void* (*realloc_func)(void* user_data, void* ptr, size_t size);
    void (*free_func)(void* user_data, void* ptr);
    void* user_data;
} ts_strip_allocator_t;

//! Opaque context type for TypeScript stripping operations
typedef struct ts_strip_ctx ts_strip_ctx_t;

//! Creates a new TypeScript stripping context with default allocator
//! @return New context, or NULL on allocation failure. Caller owns, free with ts_strip_ctx_delete.
ts_strip_ctx_t* ts_strip_ctx_new(void);

//! Creates a new TypeScript stripping context with custom allocator
//! @param allocator Custom allocator to use for all allocations (copied, can be stack-allocated)
//! @return New context, or NULL on allocation failure. Caller owns, free with ts_strip_ctx_delete.
ts_strip_ctx_t* ts_strip_ctx_new_with_allocator(const ts_strip_allocator_t* allocator);

//! Deletes a TypeScript stripping context and frees all associated memory
//! @param ctx Context to delete (can be NULL)
void ts_strip_ctx_delete(ts_strip_ctx_t* ctx);

//! Strips TypeScript type annotations from source code using a reusable context
//!
//! This function performs type-only stripping similar to ts-blank-space:
//! - Removes type annotations by replacing them with spaces
//! - Preserves original line/column positions 
//! - Handles ASI (automatic semicolon insertion) safety
//! - Supports basic TypeScript syntax (interfaces, types, generics, etc.)
//!
//! @param ctx Context to use for parsing (must not be NULL)
//! @param typescript_source Input TypeScript source code (null-terminated, must not be NULL)
//! @param javascript_out Output parameter for resulting JavaScript code. Caller owns, free with allocator.
//! @param javascript_len Output parameter for length of resulting JavaScript
//! @return ts_strip_result_t indicating success or specific error type
//!
//! Example usage:
//!   ts_strip_ctx_t* ctx = ts_strip_ctx_new();
//!   char* js_output;
//!   size_t js_len;
//!   ts_strip_result_t result = ts_strip_with_ctx(ctx, "let x: string = 'hello';", &js_output, &js_len);
//!   if (result == TS_STRIP_SUCCESS) {
//!       printf("Result: %s\n", js_output);  // "let x         = 'hello';"
//!       free(js_output);
//!   }
//!   ts_strip_ctx_delete(ctx);
ts_strip_result_t ts_strip_with_ctx(
    ts_strip_ctx_t* ctx,
    const char* typescript_source,
    char** javascript_out,
    size_t* javascript_len
);

//! Strips TypeScript type annotations from source code (convenience function)
//!
//! This is a convenience wrapper that creates a temporary context internally.
//! For multiple operations, use ts_strip_ctx_new() and ts_strip_with_ctx() instead
//! for better performance.
//!
//! @param typescript_source Input TypeScript source code (null-terminated, must not be NULL)
//! @param javascript_out Output parameter for resulting JavaScript code. Caller owns, free with free().
//! @param javascript_len Output parameter for length of resulting JavaScript
//! @return ts_strip_result_t indicating success or specific error type
//!
//! Example usage:
//!   char* js_output;
//!   size_t js_len;
//!   ts_strip_result_t result = ts_strip("let x: string = 'hello';", &js_output, &js_len);
//!   if (result == TS_STRIP_SUCCESS) {
//!       printf("Result: %s\n", js_output);  // "let x         = 'hello';"
//!       free(js_output);
//!   }
ts_strip_result_t ts_strip(
    const char* typescript_source,
    char** javascript_out,
    size_t* javascript_len
);

//! Gets human-readable error message for a ts_strip_result_t
//! @param result The result code to get message for
//! @return Constant string describing the error (do not free)
const char* ts_strip_error_message(ts_strip_result_t result);

#ifdef __cplusplus
}
#endif

#endif // TS_STRIP_H