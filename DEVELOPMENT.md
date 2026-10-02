# Dependency management

Use Bun 1.4.2 to manage this project’s dependencies. Keep Node.js for its existing tools; this migration does not replace the application runtime.

```sh
bun install --frozen-lockfile
bun run test
bun run build
```

Commit `bun.lock` when changing dependencies. Old npm/Yarn lockfiles have been backed up outside the repository. Public package installation and `npm publish` instructions are separate from this development setup.

Some legacy scripts require their original Node/toolchain versions or external input files. Installing with Bun does not make those old tools compatible with every current Node version.


## Local validation (2026-09-18)

Validated with Bun 1.4.2 and Node 24.21.0 in a temporary copy. The lockfile passed a frozen install with dependency lifecycle scripts disabled (`--ignore-scripts`), and dependency files were confirmed to share inodes with the Bun cache. This does not imply all native install scripts or supported runtime versions were validated.

All 180 tests and the production build passed. The old Yarn lock was converted through npm lockfile metadata to preserve executable entry points; the package/version set is unchanged.
