# Failed monolithic timing invocation

Source: `b02cde867cab4b9dd2dc7824f8c5ee177639899b`.
Monitor: `mon_GR2DE6X9AV94HTCP`.
The sequential default/equivalent invocation exited 134 during the default
configuration. Neither requested timing JSON file existed after termination.
Consequently none of its console-only completed conditions are counted as
retained timing evidence.

```text
[84201:0x761080c000] 16730165 ms: Mark-Compact 3651.9 (4220.7) -> 3602.7 (4224.5) MB
[84201:0x761080c000] 16747154 ms: Mark-Compact 3655.4 (4224.8) -> 3607.0 (4229.1) MB
FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
ELIFECYCLE Command failed with exit code 134.
```

The runner retains raw results until the journal's final flush. Fatal V8 abort
does not execute that JavaScript cleanup. The next collection uses the
existing scenario and concurrency selectors to bound each invocation to one
scenario, one configuration, one concurrency, all 16 targets and three rotated
repetitions (48 samples). Each successful invocation writes its own complete
raw JSON before the next starts. The full required matrix remains 2112
samples; no duration, repetition, target, or correctness gate is reduced.
Heap limits and the measured source remain unchanged.

Owned orphan PIDs 95342, 95343 and 95345 were identified by their absolute
issue-3910 executable paths and terminated after the failed run.
