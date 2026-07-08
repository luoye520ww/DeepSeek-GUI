# PR plan: checkpoint restore manifest + canonical path checks

Source rejection: KunAgent/Kun#696.

## Problem

The rejected checkpoint restore manifest work failed around macOS canonical paths, especially `/var/folders/...` vs `/private/var/folders/...`. Raw string comparison is not safe for checkpoint repository/workspace paths.

## Implementation direction

1. Add a versioned checkpoint manifest while keeping legacy `metadata.json` compatibility.
2. Canonicalize repository/workspace paths with realpath before storing and comparing.
3. Restore should validate expected context using canonical comparisons, not raw strings.
4. Legacy checkpoints without manifest should synthesize a manifest-like view from metadata, then canonicalize.
5. Tests must explicitly cover macOS `/var` and `/private/var` equivalent paths.

## Files expected to change

- `src/main/services/git-checkpoint-service.ts`
- `src/main/services/git-checkpoint-service.test.ts`
- Shared restore/checkpoint types if expected context needs IPC typing.

## Required tests

- Manifest is written for newly created checkpoints.
- Legacy metadata-only checkpoint still restores.
- `/var/...` and `/private/var/...` canonical roots compare equal.
- Wrong workspace/thread context is rejected before destructive restore.
