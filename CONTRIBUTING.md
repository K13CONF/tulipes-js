# Contributing

Tulipes is an experimental TypeScript framework. The source repository currently
has restricted access; collaborators can open issues and pull requests here.
For access or ordinary package questions, contact the npm owner at
abdelghanielmouak@gmail.com. Report vulnerabilities through [SECURITY.md](SECURITY.md).

Use Node 24.x and the pinned Yarn version:

```sh
corepack enable
yarn install --immutable
yarn test
yarn test:types
```

For boot, database, queue or authentication work, run the complete integration
suite with dedicated services as described in [Testing](docs/testing.md).
Add a failing Vitest regression at the affected public boundary before a fix.
Use actual HTTP or database behavior when a mock would hide the failure.

Keep generated production modules and `example/modules` identical. Update both
renderers and reference files when changing their contracts. The example's
starter test must also match generated `tests/app.test.ts`. CLI changes must
work from packed packages outside this workspace.

Open a branch and PR describing the trigger, resulting behavior, validation and
migration impact. CI must pass before merge. Changes to public contracts need
migration notes; new integrations should start with a documented boundary and a
small usable increment. [Support and ownership](docs/support.md) describes who
maintains releases. [Releasing](docs/releasing.md) describes publication gates.
