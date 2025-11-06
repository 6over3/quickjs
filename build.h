
#ifndef BUILD_H
#define BUILD_H

#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif

/**
 * @brief Structure containing build information
 */
typedef struct HakoBuildInfo {
const char* version;    /* Git version */
int32_t flags;   /* Feature flags bitmap */
const char* build_date; /* Build date */
const char* quickjs_version; /* QuickJS version */
const char* wasi_sdk_version;
const char* wasi_libc;    /* WASI-libc commit hash */
const char* llvm;         /* LLVM commit hash */
const char* config;       /* Configuration hash */
} HakoBuildInfo;

#ifdef __cplusplus
}
#endif

#endif /* BUILD_H */
