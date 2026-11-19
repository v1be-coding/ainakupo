# The SDK is one TypeScript file, served by the site, that sending episodes copy

The SDK is a single dependency-free file that the site publishes at `/sdk/ainakupo.ts`. Each sending episode downloads it, commits its copy, reviews the diff on each update, and compiles it with its own TypeScript. npm can't install a subfolder of a git repo (tested in `docs/research/sdk-design.md`: it installs the repo root), installing the whole repo would pull in the app and run its prepare script, publishing to npm can't be undone, a release tarball needs runs to create GitHub releases, and a separate SDK repo is outside what a run can change.

Serving it from the site also lets the frozen tests check the file senders actually get. CI's frozen-test job checks out only `frozen/` from `main`, so it can't import the PR's SDK from the repo; instead it downloads `/sdk/ainakupo.ts` from the PR's branch environment, strips its types and imports it (`docs/research/sdk-served-from-site.md`). That is why the file must stay strippable TypeScript, import only `node:` builtins, and never read the environment.

## Considered Options

- **npm:** permanent, and turned down in the spec.
- **`npm install github:…` from a subfolder:** doesn't work.
- **A `.tgz` on a GitHub release:** needs release creation and an unconfirmed redirect.
- **A separate SDK repo:** a second repo for runs to change.
- **Copying the file from this repo, tested by unit tests only:** the run would write both the SDK and its only tests.
- **`verify.yml` also checking out `sdk/` from the PR:** a workflow change, and it wouldn't prove the site serves the file.
