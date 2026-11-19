# The SDK is one TypeScript file that sending episodes copy

The SDK is a single dependency-free file, `sdk/ainakupo.ts`, that each sending episode copies into its own repo and compiles with its own TypeScript. npm can't install a subfolder of a git repo (tested in `docs/research/sdk-design.md`: it installs the repo root), installing the whole repo would pull in the app and run its prepare script, publishing to npm can't be undone, a release tarball needs runs to create GitHub releases, and a separate SDK repo is outside what a run can change. Copies can drift, which is acceptable for a file of about 150 lines that rarely changes.

## Considered Options

- **npm:** permanent, and turned down in the spec.
- **`npm install github:…` from a subfolder:** doesn't work.
- **A `.tgz` on a GitHub release:** needs release creation and an unconfirmed redirect.
- **A separate SDK repo:** a second repo for runs to change.
