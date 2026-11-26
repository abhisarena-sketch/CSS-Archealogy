# Publishing

The four packages are versioned together. As of this writing none of them has been published.

| Package | npm name | Availability (checked 2026-11-26) |
|---|---|---|
| CLI | `css-archaeology` | Not taken (registry returned 404) |
| Engine | `@css-archaeology/core` | Not taken; needs the `css-archaeology` npm organisation, which does not appear to exist yet (org package listing returned 404) |
| Rules | `@css-archaeology/analyzers` | Same organisation |
| Adapters | `@css-archaeology/framework-adapters` | Same organisation |

Re-check before publishing: `npm view css-archaeology` (expect a 404) and create the scope at
<https://www.npmjs.com/org/create> (`css-archaeology`). If the scope is unavailable, rename the scoped packages in
every `package.json` and in the CLI's dependencies.

## Release steps

1. Make sure `main` is green in CI.
2. Update `version` in `packages/*/package.json`, the internal dependency versions, and `VERSION` in
   `packages/core/src/version.ts`. Move the changelog's Unreleased section under the new version.
3. Build and check the package contents:

   ```sh
   npm ci
   npm run build
   npm test
   npm pack --dry-run -w packages/core -w packages/analyzers -w packages/framework-adapters -w packages/cli
   ```

4. Publish in dependency order (requires `npm login` with 2FA):

   ```sh
   npm publish -w packages/core --access public
   npm publish -w packages/analyzers --access public
   npm publish -w packages/framework-adapters --access public
   npm publish -w packages/cli --access public
   ```

   Add `--provenance` when publishing from GitHub Actions with `id-token: write` permission.

5. Tag the release (`git tag v0.1.0 && git push origin v0.1.0`) and create a GitHub release from the changelog.
6. Smoke test: `npx css-archaeology@0.1.0 --version` in an empty directory.

The playground is private (`"private": true`) and is not published to npm. It can be deployed as a static Node
server (`next start`) or on any Next.js host; keep the security headers in `next.config.ts`.
