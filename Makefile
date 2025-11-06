#
# QuickJS Javascript Engine - WASI Build for Hako
#
# Copyright (c) 2017-2021 Fabrice Bellard
# Copyright (c) 2017-2021 Charlie Gordon
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
# THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
# THE SOFTWARE.

# WASI Configuration
CONFIG_WASI=y

# Check for WASI SDK
ifndef WASI_SDK_PATH
$(error WASI_SDK_PATH environment variable not set. Please set it to your WASI SDK installation directory)
endif

# Version management
GIT_VERSION := $(shell git describe --tags --always --dirty 2>/dev/null || echo "unknown")
HAKO_VERSION := $(GIT_VERSION)

# WASI SDK version parsing
WASI_VERSION_FILE := $(WASI_SDK_PATH)/VERSION
WASI_VERSION := $(shell cat $(WASI_VERSION_FILE) 2>/dev/null || echo "unknown")

# Parse WASI SDK VERSION file components
WASI_WASI_LIBC := $(shell grep "wasi-libc:" $(WASI_VERSION_FILE) 2>/dev/null | cut -d' ' -f2 || echo "unknown")
WASI_LLVM := $(shell grep "llvm:" $(WASI_VERSION_FILE) 2>/dev/null | cut -d' ' -f2 || echo "unknown")
WASI_CONFIG := $(shell grep "config:" $(WASI_VERSION_FILE) 2>/dev/null | cut -d' ' -f2 || echo "unknown")
QUICKJS_VERSION := $(shell cat VERSION 2>/dev/null || echo "unknown")

OBJDIR=.obj

ifdef CONFIG_WASI
OBJDIR:=$(OBJDIR)/wasi
endif

# WASI toolchain setup
ifdef CONFIG_WASI
  CROSS_PREFIX=$(WASI_SDK_PATH)/bin/
  CC=$(CROSS_PREFIX)clang
  AR=$(CROSS_PREFIX)llvm-ar
  STRIP=$(CROSS_PREFIX)llvm-strip
  SYSROOT=--sysroot=$(WASI_SDK_PATH)/share/wasi-sysroot
  TARGET=--target=wasm32-wasi
  EXE=.wasm
  
  # WASI-specific flags
  WASI_CFLAGS=-D_WASI_EMULATED_MMAN -D_WASI_EMULATED_SIGNAL -D_WASI_EMULATED_PROCESS_CLOCKS
  WASI_CFLAGS+=-D__WASI_SDK__ -DOS_WASI=1
  WASI_CFLAGS+=-DWASI_STACK_SIZE=8388608
  
  # WASM optimization and feature flags
  WASI_CFLAGS+=-msimd128 -mmultivalue -mmutable-globals -mtail-call -msign-ext -mbulk-memory -mnontrapping-fptoint -mextended-const
  
  # WASI linker flags for reactor model
  WASI_LDFLAGS=-Wl,--import-memory,--export-memory
  WASI_LDFLAGS+=-mexec-model=reactor
  WASI_LDFLAGS+=-Wl,--no-entry
  WASI_LDFLAGS+=-Wl,--stack-first
  WASI_LDFLAGS+=-Wl,--export=__stack_pointer
  WASI_LDFLAGS+=-Wl,--export=malloc
  WASI_LDFLAGS+=-Wl,--export=free
  WASI_LDFLAGS+=-Wl,--export=__heap_base
  WASI_LDFLAGS+=-Wl,--export=__data_end
  WASI_LDFLAGS+=-Wl,--allow-undefined
  WASI_LDFLAGS+=-Wl,-z,stack-size=8388608
  WASI_LDFLAGS+=-Wl,--initial-memory=25165824
  WASI_LDFLAGS+=-Wl,--max-memory=268435456
  WASI_LDFLAGS+=-Wl,--gc-sections
  WASI_LDFLAGS+=-Wl,--strip-all
  
  
  #WASI_CFLAGS+=-DDUMP_LEAKS
  
  CONFIG_LTO=
else
  CROSS_PREFIX?=
  EXE=
endif

HOST_CC=gcc
CFLAGS+=-g -Wall -MMD -MF $(OBJDIR)/$(@F).d
CFLAGS += -Wextra
CFLAGS += -Wno-sign-compare
CFLAGS += -Wno-missing-field-initializers
CFLAGS += -Wundef -Wuninitialized
CFLAGS += -Wunused -Wno-unused-parameter
CFLAGS += -Wwrite-strings
CFLAGS += -Wchar-subscripts -funsigned-char
CFLAGS += -MMD -MF $(OBJDIR)/$(@F).d
CFLAGS+=-fwrapv

# tree-sitter and ts_strip include paths
CFLAGS += -Its_strip -Its_strip/tree-sitter/lib/include

ifdef CONFIG_WASI
CFLAGS += $(SYSROOT) $(TARGET) $(WASI_CFLAGS)
CFLAGS += -fPIC -ffunction-sections -fdata-sections
CFLAGS += -fno-short-enums -fno-strict-aliasing
CFLAGS += -Wno-c99-designator -Wno-unknown-warning-option
CFLAGS += -Wno-unused-but-set-variable
CFLAGS += -fomit-frame-pointer -fno-sanitize=safe-stack
endif

DEFINES:=-D_GNU_SOURCE -DCONFIG_VERSION=\"$(shell cat VERSION)\"

CFLAGS+=$(DEFINES)
CFLAGS_DEBUG=$(CFLAGS) -O0
CFLAGS_SMALL=$(CFLAGS) -Os
CFLAGS_OPT=$(CFLAGS) -O2
CFLAGS_NOLTO:=$(CFLAGS_OPT)

ifdef CONFIG_WASI
CFLAGS_OPT=$(CFLAGS) -O3
LDFLAGS+=$(SYSROOT) $(TARGET) $(WASI_LDFLAGS)
else
LDFLAGS+=-g
endif

ifdef CONFIG_LTO
CFLAGS_SMALL+=-flto
CFLAGS_OPT+=-flto
LDFLAGS+=-flto
endif

ifdef CONFIG_WASI
LDEXPORT=
PROGS=hako$(EXE)
else
LDEXPORT=-rdynamic
PROGS=qjs$(EXE) qjsc$(EXE) run-test262$(EXE)
endif

PROGS+=libquickjs.a
ifdef CONFIG_LTO
PROGS+=libquickjs.lto.a
endif

all: $(OBJDIR) $(OBJDIR)/quickjs.check.o version.h wasi_version.h $(PROGS)

# Generate version.h
version.h: VERSION .FORCE
	@echo "Generating version.h with version: $(HAKO_VERSION)"
	@echo "#ifndef VERSION_H" > $@
	@echo "#define VERSION_H" >> $@
	@echo "" >> $@
	@echo "#define HAKO_VERSION \"$(HAKO_VERSION)\"" >> $@
	@echo "#define GIT_VERSION \"$(GIT_VERSION)\"" >> $@
	@echo "#define QUICKJS_VERSION \"$(QUICKJS_VERSION)\"" >> $@
	@echo "" >> $@
	@echo "#endif // VERSION_H" >> $@

# Generate wasi_version.h
wasi_version.h: $(WASI_VERSION_FILE) .FORCE
	@echo "Generating wasi_version.h"
	@echo "#ifndef WASI_VERSION_H" > $@
	@echo "#define WASI_VERSION_H" >> $@
	@echo "" >> $@
	@echo "#define WASI_VERSION \"$(WASI_VERSION)\"" >> $@
	@echo "#define WASI_WASI_LIBC \"$(WASI_WASI_LIBC)\"" >> $@
	@echo "#define WASI_LLVM \"$(WASI_LLVM)\"" >> $@
	@echo "#define WASI_CONFIG \"$(WASI_CONFIG)\"" >> $@
	@echo "" >> $@
	@echo "#endif // WASI_VERSION_H" >> $@

.FORCE:

QJS_LIB_OBJS=$(OBJDIR)/quickjs.o $(OBJDIR)/dtoa.o $(OBJDIR)/libregexp.o $(OBJDIR)/libunicode.o $(OBJDIR)/cutils.o $(OBJDIR)/quickjs-libc.o

# tree-sitter object (using amalgamated build)
TREE_SITTER_OBJ=$(OBJDIR)/ts_strip/tree_sitter.o

# ts_strip objects
TS_STRIP_OBJS=$(OBJDIR)/ts_strip/ts_strip.o \
              $(OBJDIR)/ts_strip/typescript_parser.o \
              $(OBJDIR)/ts_strip/typescript_scanner.o \
              $(OBJDIR)/ts_strip/tsx_parser.o \
              $(OBJDIR)/ts_strip/tsx_scanner.o

HAKO_OBJS=$(OBJDIR)/hako.o $(QJS_LIB_OBJS) $(TREE_SITTER_OBJ) $(TS_STRIP_OBJS)

HOST_LIBS=-lm -ldl -lpthread
LIBS=-lm -lpthread
ifndef CONFIG_WIN32
ifndef CONFIG_WASI
LIBS+=-ldl
endif
endif
LIBS+=$(EXTRA_LIBS)

$(OBJDIR):
	mkdir -p $(OBJDIR) $(OBJDIR)/examples $(OBJDIR)/tests $(OBJDIR)/ts_strip

ifdef CONFIG_WASI

hako$(EXE): $(HAKO_OBJS)
	$(CC) $(LDFLAGS) $(LDEXPORT) -o $@ $^ $(LIBS)

else

qjs$(EXE): $(OBJDIR)/qjs.o $(OBJDIR)/repl.o $(QJS_LIB_OBJS)
	$(CC) $(LDFLAGS) $(LDEXPORT) -o $@ $^ $(LIBS)

qjs-debug$(EXE): $(patsubst %.o, %.debug.o, $(OBJDIR)/qjs.o $(OBJDIR)/repl.o $(QJS_LIB_OBJS))
	$(CC) $(LDFLAGS) -o $@ $^ $(LIBS)

qjsc$(EXE): $(OBJDIR)/qjsc.o $(QJS_LIB_OBJS)
	$(CC) $(LDFLAGS) -o $@ $^ $(LIBS)

repl.c: qjsc$(EXE) repl.js
	./qjsc$(EXE) -s -c -o $@ -m repl.js

run-test262$(EXE): $(OBJDIR)/run-test262.o $(QJS_LIB_OBJS)
	$(CC) $(LDFLAGS) -o $@ $^ $(LIBS)

endif

ifdef CONFIG_LTO
LTOEXT=.lto
else
LTOEXT=
endif

libquickjs$(LTOEXT).a: $(QJS_LIB_OBJS)
	$(AR) rcs $@ $^

ifdef CONFIG_LTO
libquickjs.a: $(patsubst %.o, %.nolto.o, $(QJS_LIB_OBJS))
	$(AR) rcs $@ $^
endif

ifneq ($(wildcard unicode/UnicodeData.txt),)
$(OBJDIR)/libunicode.o $(OBJDIR)/libunicode.nolto.o: libunicode-table.h

libunicode-table.h: unicode_gen
	./unicode_gen unicode $@

unicode_gen: $(OBJDIR)/unicode_gen.host.o $(OBJDIR)/cutils.host.o libunicode.c unicode_gen_def.h
	$(HOST_CC) $(LDFLAGS) $(CFLAGS) -o $@ $(OBJDIR)/unicode_gen.host.o $(OBJDIR)/cutils.host.o
endif

# Standard compilation rules
$(OBJDIR)/%.o: %.c | $(OBJDIR)
	$(CC) $(CFLAGS_OPT) -c -o $@ $<

$(OBJDIR)/%.host.o: %.c | $(OBJDIR)
	$(HOST_CC) $(CFLAGS_OPT) -c -o $@ $<

$(OBJDIR)/%.pic.o: %.c | $(OBJDIR)
	$(CC) $(CFLAGS_OPT) -fPIC -DJS_SHARED_LIBRARY -c -o $@ $<

$(OBJDIR)/%.nolto.o: %.c | $(OBJDIR)
	$(CC) $(CFLAGS_NOLTO) -c -o $@ $<

$(OBJDIR)/%.debug.o: %.c | $(OBJDIR)
	$(CC) $(CFLAGS_DEBUG) -c -o $@ $<

$(OBJDIR)/%.check.o: %.c | $(OBJDIR)
	$(CC) $(CFLAGS) -DCONFIG_CHECK_JSVALUE -c -o $@ $<

# tree-sitter compilation (amalgamated build)
$(OBJDIR)/ts_strip/tree_sitter.o: ts_strip/tree-sitter/lib/src/lib.c | $(OBJDIR)
	$(CC) $(CFLAGS_OPT) -Its_strip/tree-sitter/lib/src -Its_strip/tree-sitter/lib/src/wasm -D_POSIX_C_SOURCE=200112L -D_DEFAULT_SOURCE -c -o $@ $<

# ts_strip compilation rules
$(OBJDIR)/ts_strip/ts_strip.o: ts_strip/ts_strip.c | $(OBJDIR)
	$(CC) $(CFLAGS_OPT) -c -o $@ $<

$(OBJDIR)/ts_strip/typescript_parser.o: ts_strip/typescript/parser.c | $(OBJDIR)
	$(CC) $(CFLAGS_OPT) -c -o $@ $<

$(OBJDIR)/ts_strip/typescript_scanner.o: ts_strip/typescript/scanner.c | $(OBJDIR)
	$(CC) $(CFLAGS_OPT) -c -o $@ $<

$(OBJDIR)/ts_strip/tsx_parser.o: ts_strip/tsx/parser.c | $(OBJDIR)
	$(CC) $(CFLAGS_OPT) -c -o $@ $<

$(OBJDIR)/ts_strip/tsx_scanner.o: ts_strip/tsx/scanner.c | $(OBJDIR)
	$(CC) $(CFLAGS_OPT) -c -o $@ $<

clean:
	rm -f repl.c out.c
	rm -f *.a *.o *.d *~ unicode_gen regexp_test $(PROGS)
	rm -f hello.c test_fib.c
	rm -f examples/*.so tests/*.so
	rm -rf $(OBJDIR)/ *.dSYM/ qjs-debug$(EXE)
	rm -rf run-test262-debug$(EXE)
	rm -f version.h wasi_version.h

ifdef CONFIG_WASI

install: all
	mkdir -p "$(DESTDIR)$(PREFIX)/bin"
	$(STRIP) hako$(EXE)
	install -m755 hako$(EXE) "$(DESTDIR)$(PREFIX)/bin"
	mkdir -p "$(DESTDIR)$(PREFIX)/lib/quickjs"
	install -m644 libquickjs.a "$(DESTDIR)$(PREFIX)/lib/quickjs"
ifdef CONFIG_LTO
	install -m644 libquickjs.lto.a "$(DESTDIR)$(PREFIX)/lib/quickjs"
endif
	mkdir -p "$(DESTDIR)$(PREFIX)/include/quickjs"
	install -m644 quickjs.h quickjs-libc.h "$(DESTDIR)$(PREFIX)/include/quickjs"

else

install: all
	mkdir -p "$(DESTDIR)$(PREFIX)/bin"
	$(STRIP) qjs$(EXE) qjsc$(EXE)
	install -m755 qjs$(EXE) qjsc$(EXE) "$(DESTDIR)$(PREFIX)/bin"
	mkdir -p "$(DESTDIR)$(PREFIX)/lib/quickjs"
	install -m644 libquickjs.a "$(DESTDIR)$(PREFIX)/lib/quickjs"
ifdef CONFIG_LTO
	install -m644 libquickjs.lto.a "$(DESTDIR)$(PREFIX)/lib/quickjs"
endif
	mkdir -p "$(DESTDIR)$(PREFIX)/include/quickjs"
	install -m644 quickjs.h quickjs-libc.h "$(DESTDIR)$(PREFIX)/include/quickjs"

endif

-include $(wildcard $(OBJDIR)/*.d)