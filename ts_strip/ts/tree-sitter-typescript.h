#ifndef TREE_SITTER_TYPESCRIPT_H_
#define TREE_SITTER_TYPESCRIPT_H_

typedef struct TSLanguage TSLanguage;

#ifdef __cplusplus
extern "C" {
#endif

const TSLanguage *tree_sitter_typescript(void);
const TSLanguage *tree_sitter_tsx(void);  // Add this line

#ifdef __cplusplus
}
#endif

#endif