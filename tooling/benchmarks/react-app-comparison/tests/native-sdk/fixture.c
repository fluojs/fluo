#define _GNU_SOURCE
#include <inttypes.h>
#include <pthread.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

#define HOOK __attribute__((noinline, visibility("default")))
static __thread int nesting;
static __thread int limit;
static __thread int observer_depth;
static pthread_barrier_t barrier;
static int concurrent;
static int constructor_reentry;
static int constructor_depth;
static int abandon;
static uint32_t *publication_slot;
static void (*real_release_store)(uint32_t *, uint32_t);

HOOK void fixture_publication_config(void *journal, void *store) {
  publication_slot = (uint32_t *)((char *)journal + 512 + 128);
  real_release_store = store;
}
HOOK void fixture_release_store(uint32_t *address, uint32_t value) {
  char ack;
  if (address == publication_slot) {
    printf("{\"publication\":\"before-slot\"}\n");
    if (read(STDIN_FILENO, &ack, 1) != 1 || ack != 'x') abort();
  }
  real_release_store(address, value);
  if (address == publication_slot) {
    printf("{\"publication\":\"after-slot\"}\n");
    if (read(STDIN_FILENO, &ack, 1) != 1 || ack != 'x') abort();
  }
}

HOOK uintptr_t fixture_resource(void *resource) {
  if (constructor_reentry && constructor_depth++ == 0) fixture_resource(resource);
  if (constructor_reentry) constructor_depth--;
  __asm__ volatile("" : : "r"(resource) : "memory");
  return (uintptr_t)resource ^ UINT64_C(0xabcdef0123456789);
}
HOOK uintptr_t fixture_loader(void *loader, void *unused1, void *unused2, void *resource) {
  if (constructor_reentry && constructor_depth++ == 0)
    fixture_loader(loader, unused1, unused2, resource);
  if (constructor_reentry) constructor_depth--;
  __asm__ volatile("" : : "r"(loader), "r"(resource) : "memory");
  return (uintptr_t)loader + (uintptr_t)resource;
}
HOOK uint64_t fixture_identifier_a(void *context, uint64_t identifier) {
  __asm__ volatile("" : : "r"(context), "r"(identifier) : "memory");
  return identifier ^ UINT64_C(0xfedcba9876543210);
}
HOOK uint64_t fixture_identifier_b(void *context, uint64_t identifier) {
  __asm__ volatile("" : : "r"(context), "r"(identifier) : "memory");
  return identifier + 1;
}
HOOK uintptr_t fixture_observer(void *a, void *b, void *c, void *d,
                                void *e, void *f, void *resource) {
  uintptr_t value = (uintptr_t)resource;
  if (fixture_identifier_a(a, UINT64_C(0xfedcba9876543210) + value)
      != ((UINT64_C(0xfedcba9876543210) + value) ^ UINT64_C(0xfedcba9876543210)))
    abort();
  if (observer_depth++ == 0) {
    if (fixture_observer(a, b, c, d, e, f, (void *)(value + 0x100)) != value + 0x100)
      abort();
  }
  observer_depth--;
  if (fixture_identifier_b(a, UINT64_MAX) != 0) abort();
  return value;
}
HOOK uintptr_t fixture_error(void *loader);
HOOK uintptr_t fixture_cancel(void *loader) {
  if (concurrent && nesting == 0) pthread_barrier_wait(&barrier);
  if (nesting++ < limit) {
    if (fixture_error(loader) != UINT64_C(0xfffffffffffffff9)) abort();
  }
  nesting--;
  return UINT64_C(0x8000000000000001);
}
HOOK uintptr_t fixture_error(void *loader) {
  if (abandon) raise(SIGTERM);
  if (nesting++ < limit) {
    if (fixture_cancel(loader) != UINT64_C(0x8000000000000001)) abort();
  }
  nesting--;
  return UINT64_C(0xfffffffffffffff9);
}
static void birth_pair(uintptr_t resource, uintptr_t loader) {
  if (fixture_resource((void *)resource) != (resource ^ UINT64_C(0xabcdef0123456789))) abort();
  if (fixture_loader((void *)loader, (void *)0x222, (void *)0x333, (void *)resource)
      != loader + resource) abort();
}
static void sequential(void) {
  birth_pair(0x1010, 0x2020);
  fixture_resource((void *)0x1110);
  fixture_observer((void *)0xa1, (void *)0xa2, (void *)0xa3, (void *)0xa4,
                   (void *)0xa5, (void *)0xa6, (void *)0x1010);
  limit = 5;
  fixture_cancel((void *)0x2020);
  /* Resource reuse must not change a previously born Loader's snapshot. */
  fixture_resource((void *)0x1010);
  limit = 1;
  fixture_cancel((void *)0x2020);
  fixture_loader((void *)0x2020, NULL, NULL, (void *)0x1010);
  fixture_cancel((void *)0x2020);
  /* Loader reuse is independent, including a still unknown Resource. */
  fixture_loader((void *)0x2020, NULL, NULL, (void *)0x3030);
  fixture_cancel((void *)0x2020);
  fixture_cancel((void *)0x4040);
  /* No current observer: this identifier must not manufacture a record. */
  fixture_identifier_a(NULL, 42);
}
static void *worker(void *number) {
  uintptr_t n = (uintptr_t)number;
  limit = 3;
  fixture_cancel((void *)(0x20000 + n * 0x100));
  return NULL;
}
static void parallel_calls(void) {
  pthread_t workers[4];
  for (uintptr_t i = 0; i != 4; i++)
    birth_pair(0x10000 + i * 0x100, 0x20000 + i * 0x100);
  if (pthread_barrier_init(&barrier, NULL, 4) != 0) abort();
  concurrent = 1;
  for (uintptr_t i = 0; i != 4; i++)
    if (pthread_create(&workers[i], NULL, worker, (void *)i) != 0) abort();
  for (int i = 0; i != 4; i++) pthread_join(workers[i], NULL);
  concurrent = 0;
  pthread_barrier_destroy(&barrier);
}

/* Test-only clocks for a second CModule using the exact recorder source. */
static int clock_depth;
HOOK int fixture_clock_reentrant(int id, struct timespec *value) {
  if (clock_depth++ == 0) {
    limit = 0;
    fixture_error((void *)0x9090);
  }
  clock_depth--;
  return clock_gettime(id, value);
}
HOOK int fixture_clock_failure(int id, struct timespec *value) {
  (void)id;
  (void)value;
  return -1;
}

int main(void) {
  char command[32];
  setvbuf(stdout, NULL, _IOLBF, 0);
  printf("{\"ready\":true,\"pid\":%d,\"thread\":%ld}\n", getpid(), syscall(SYS_gettid));
  while (fgets(command, sizeof(command), stdin) != NULL) {
    if (strcmp(command, "sequential\n") == 0) sequential();
    else if (strcmp(command, "concurrent\n") == 0) parallel_calls();
    else if (strcmp(command, "deep\n") == 0) { limit = 64; fixture_cancel((void *)0x2020); }
    else if (strcmp(command, "one\n") == 0) { limit = 0; fixture_error((void *)0x2020); }
    else if (strcmp(command, "reuse_nested\n") == 0) {
      constructor_reentry = 1;
      birth_pair(0x1010, 0x2020);
      constructor_reentry = 0;
      limit = 1;
      fixture_cancel((void *)0x2020);
    }
    else if (strcmp(command, "abandon\n") == 0) {
      abandon = 1;
      fixture_error((void *)0x2020);
    }
    else if (strcmp(command, "quit\n") == 0) break;
    else abort();
    printf("{\"done\":\"%.*s\"}\n", (int)strlen(command) - 1, command);
  }
  return 0;
}
