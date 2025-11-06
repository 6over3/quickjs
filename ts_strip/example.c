#include "ts_strip.h"
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <string.h>

typedef struct {
    double min_ms;
    double max_ms;
    double total_ms;
    size_t count;
} timing_stats_t;

static double get_time_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1000.0 + ts.tv_nsec / 1000000.0;
}

static void update_stats(timing_stats_t* stats, double time_ms) {
    if (stats->count == 0) {
        stats->min_ms = time_ms;
        stats->max_ms = time_ms;
    } else {
        if (time_ms < stats->min_ms) stats->min_ms = time_ms;
        if (time_ms > stats->max_ms) stats->max_ms = time_ms;
    }
    stats->total_ms += time_ms;
    stats->count++;
}

static void print_stats(const timing_stats_t* stats, const char* label) {
    if (stats->count == 0) {
        printf("%s: No data\n", label);
        return;
    }
    
    double avg_ms = stats->total_ms / stats->count;
    printf("\n%s Performance:\n", label);
    printf("  Total:   %.3f ms (%zu operations)\n", stats->total_ms, stats->count);
    printf("  Average: %.3f ms\n", avg_ms);
    printf("  Min:     %.3f ms\n", stats->min_ms);
    printf("  Max:     %.3f ms\n", stats->max_ms);
}

static void run_test(ts_strip_ctx_t* ctx, const char* ts_code, size_t example_num, timing_stats_t* stats) {
    char* js_output = NULL;
    size_t js_len = 0;

    printf("Example %zu:\n", example_num);
    printf("Input (%zu bytes):\n%s\n\n", strlen(ts_code), ts_code);

    double start = get_time_ms();
    ts_strip_result_t result = ts_strip_with_ctx(ctx, ts_code, &js_output, &js_len);
    double elapsed = get_time_ms() - start;
    
    update_stats(stats, elapsed);

    if (result == TS_STRIP_SUCCESS) {
        printf("Output (%zu bytes) [%.3f ms]:\n%s\n\n", js_len, elapsed, js_output);
        free(js_output);
    } else if (result == TS_STRIP_ERROR_UNSUPPORTED) {
        printf("Output (%zu bytes, with warnings) [%.3f ms]:\n%s\n", 
               js_len, elapsed, js_output);
        printf("Warning: %s\n\n", ts_strip_error_message(result));
        free(js_output);
    } else {
        printf("Error [%.3f ms]: %s\n\n", elapsed, ts_strip_error_message(result));
    }

    printf("---\n\n");
}

int main(void) {
    timing_stats_t basic_stats = {0};
    timing_stats_t comment_stats = {0};
    timing_stats_t edge_stats = {0};
    timing_stats_t error_stats = {0};

    printf("=== TypeScript Type Stripper Demo ===\n\n");

    // Create reusable context
    ts_strip_ctx_t* ctx = ts_strip_ctx_new();
    if (!ctx) {
        fprintf(stderr, "Failed to create ts_strip context\n");
        return 1;
    }

    // Basic TypeScript features
    printf("BASIC TYPE STRIPPING\n");
    printf("====================\n\n");
    
    const char* basic_examples[] = {
        "let x: string = 'hello';",
        "function greet(name: string): void { console.log('Hello ' + name); }",
        "interface User { name: string; age: number; }",
        "type StringOrNumber = string | number;",
        "function identity<T>(arg: T): T { return arg; }",
        "class Person {\n private name: string;\n constructor(name: string) { this.name = name; }\n}",
        "let value = getValue() as string;",
        "class Cat<T> {\n public whiskers: number;\n public tail: T;\n\n constructor(count: number, tail: T) {\n this.whiskers = count;\n this.tail = tail;\n }\n}",
        NULL
    };

    for (size_t i = 0; basic_examples[i] != NULL; i++) {
        run_test(ctx, basic_examples[i], i + 1, &basic_stats);
    }

    // Comments preservation
    printf("\nCOMMENT PRESERVATION\n");
    printf("====================\n\n");
    
    const char* comment_examples[] = {
        "// This is a comment\nlet x: string = 'hello'; // Another comment\n// Final comment",
        
        "/* Block comment start */\nlet y: number = 42;\n/* Block comment end */",
        
        "/**\n * JSDoc comment for function\n * @param name - The person's name\n * @returns void\n */\nfunction greet(name: string): void {\n  console.log('Hello ' + name);\n}",
        
        "// Interface definition\ninterface User {\n  /** User's name */\n  name: string;\n  // User's age\n  age: number;\n}\n\n/* Implementation */\nclass UserImpl implements User {\n  name: string;\n  age: number;\n  \n  constructor(name: string, age: number) {\n    this.name = name;\n    this.age = age;\n  }\n}",
        
        "// Getting value\nlet value = getValue() /* type assertion */ as string; // Done",
        
        "/**\n * Generic function with JSDoc\n * @template T\n * @param {T} arg - The argument\n * @returns {T} The same argument\n */\nfunction identity<T>(arg: T): T {\n  return arg;\n}",
        
        "class Example {\n  /* Private field */ private field: string;\n  // Public method\n  public method(): void { /* empty */ }\n}",
        
        "// Import statement\nimport { Component } from 'react';\n\n/**\n * Export with JSDoc\n */\nexport interface Props {\n  name: string;\n}",
        
        NULL
    };

    for (size_t i = 0; comment_examples[i] != NULL; i++) {
        run_test(ctx, comment_examples[i], i + 1, &comment_stats);
    }

    // Edge cases
    printf("\nEDGE CASES\n");
    printf("==========\n\n");
    
    const char* edge_cases[] = {
        "",
        "// Just a comment\n/* Block comment */\n/** JSDoc */",
        "// Regular JS\nlet x = 42;\nconsole.log(x);",
        "/* Outer comment\n * interface Nested { prop: string; }\n * End comment */\nlet valid: string = 'test';",
        "let template: string = `\n  This is a template\n  with multiple lines\n  and a type: ${type}\n`;",
        NULL
    };

    for (size_t i = 0; edge_cases[i] != NULL; i++) {
        run_test(ctx, edge_cases[i], i + 1, &edge_stats);
    }

    // Unsupported syntax
    printf("\nUNSUPPORTED SYNTAX\n");
    printf("==================\n\n");
    
    const char* error_examples[] = {
        "enum Color { Red, Green, Blue }",
        "namespace MyNamespace { export const x = 1; }",
        "declare module 'mymodule' { export const x: number; }",
        NULL
    };

    for (size_t i = 0; error_examples[i] != NULL; i++) {
        run_test(ctx, error_examples[i], i + 1, &error_stats);
    }

    // Clean up context
    ts_strip_ctx_delete(ctx);

    // Performance summary
    printf("\n");
    printf("=====================================\n");
    printf("PERFORMANCE SUMMARY\n");
    printf("=====================================\n");
    
    print_stats(&basic_stats, "Basic Type Stripping");
    print_stats(&comment_stats, "Comment Preservation");
    print_stats(&edge_stats, "Edge Cases");
    print_stats(&error_stats, "Error Handling");
    
    // Combined stats
    timing_stats_t combined = {
        .min_ms = basic_stats.min_ms,
        .max_ms = basic_stats.max_ms,
        .total_ms = basic_stats.total_ms + comment_stats.total_ms + 
                    edge_stats.total_ms + error_stats.total_ms,
        .count = basic_stats.count + comment_stats.count + 
                 edge_stats.count + error_stats.count
    };
    
    // Update min/max across all categories
    if (comment_stats.count > 0) {
        if (comment_stats.min_ms < combined.min_ms) combined.min_ms = comment_stats.min_ms;
        if (comment_stats.max_ms > combined.max_ms) combined.max_ms = comment_stats.max_ms;
    }
    if (edge_stats.count > 0) {
        if (edge_stats.min_ms < combined.min_ms) combined.min_ms = edge_stats.min_ms;
        if (edge_stats.max_ms > combined.max_ms) combined.max_ms = edge_stats.max_ms;
    }
    if (error_stats.count > 0) {
        if (error_stats.min_ms < combined.min_ms) combined.min_ms = error_stats.min_ms;
        if (error_stats.max_ms > combined.max_ms) combined.max_ms = error_stats.max_ms;
    }
    
    print_stats(&combined, "Overall");


    return 0;
}