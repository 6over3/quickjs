CC = clang
CFLAGS = -Wall -O2 -g -Its

PKG_CONFIG = $(shell command -v pkg-config 2>/dev/null)
ifneq ($(PKG_CONFIG),)
    CFLAGS += $(shell pkg-config --cflags tree-sitter)
    LDFLAGS = $(shell pkg-config --libs tree-sitter)
else
    ifeq ($(shell uname -s),Darwin)
        BREW_PREFIX = $(shell brew --prefix 2>/dev/null || echo /usr/local)
        CFLAGS += -I$(BREW_PREFIX)/include
        LDFLAGS = -L$(BREW_PREFIX)/lib -ltree-sitter
    else
        CFLAGS += -I/usr/include -I/usr/local/include
        LDFLAGS = -L/usr/lib -L/usr/local/lib -ltree-sitter
    endif
endif

SRCS = ts_strip.c typescript/parser.c typescript/scanner.c tsx/parser.c tsx/scanner.c

all: example tests

example: example.c $(SRCS)
	$(CC) $(CFLAGS) -o $@ $^ $(LDFLAGS)

tests: suite.c $(SRCS)
	$(CC) $(CFLAGS) -o $@ $^ $(LDFLAGS)

test: tests
	./tests

clean:
	rm -f example tests

.PHONY: all test clean