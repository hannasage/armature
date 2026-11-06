# Releasing

This page lists the steps to publish the prerelease `1.0.0-next.0` to the npm `next` tag.
Only a maintainer does these steps. An agent must not publish, log in to npm, or handle a token.

A prerelease is a version with a dash in it, such as `1.0.0-next.0`.
A distribution tag, or dist-tag, is a movable label on npm that points at one version.
Publishing with `--tag next` puts the version under `next`. It does not make it the default install.

## Before you start

- You need an npm account that can publish to the `@hannasage` scope.
  `npm view @hannasage/projection-ui name version` shows that the scope is in use. It does not prove that your account can publish to it.
  `npm publish --dry-run` does not check this either. The first real publish fails with an error if the account has no right.
- Your account needs two-factor authentication (2FA). 2FA is a second code, from an authenticator app, on top of the password.
  `npm publish` asks for a one-time code when the registry requires it. You can also pass `--otp <code>`.

## Steps

1. Confirm a clean checkout of `release/1.0.0` at the commit to publish.

   ```bash
   git fetch origin
   git checkout release/1.0.0
   git pull --ff-only
   git status --short
   git log -1 --oneline
   ```

   `git status --short` must print nothing. Write down the commit hash. You tag it in step 8.

2. Install exactly what the lock file says.

   ```bash
   npm ci
   ```

3. Run the gates and the pack check. Every command must exit with 0.

   ```bash
   npm run typecheck
   npm run lint
   npm test
   npm run build
   npm run check:pack
   ```

   `npm run check:pack` packs the package, installs the tarball into a clean temp project, imports each subpath, type checks a consumer file under `nodenext` and `bundler`, and resolves the stylesheet.
   It also fails if the tarball holds a file outside `dist`, `README.md`, `LICENSE`, and `package.json`, or if it is larger than 1.5 times the size in `docs/baseline.md`.

4. Run a dry run of the publish.

   ```bash
   npm publish --dry-run --tag next --access public
   ```

   The dry run also runs `prepublishOnly`, which repeats the gates and the pack check. It uploads nothing. Look for these lines:

   - `package: @hannasage/armature@1.0.0-next.0`.
   - The Tarball Contents list holds `LICENSE`, `README.md`, `package.json`, and files under `dist/`. Nothing else.
   - `total files: 122` and a package size of about 137 kB. A large change from these numbers needs an explanation.
   - The last notice line says `Publishing to https://registry.npmjs.org/ with tag next and public access (dry-run)`.
   - The last line is `+ @hannasage/armature@1.0.0-next.0`.

5. Log in. You do this yourself.

   ```bash
   npm whoami
   npm login
   ```

   Run `npm login` only if `npm whoami` fails or prints the wrong account. The login opens a browser or asks for your password and a 2FA code.
   Never paste a token into a file, a chat, or a command that is saved in shell history.

6. Publish.

   ```bash
   npm publish --tag next --access public
   ```

   Enter the 2FA code when npm asks. The command runs the gates and the pack check once more before it uploads.

7. Verify the registry and a clean install.

   ```bash
   npm view @hannasage/armature dist-tags
   npm view @hannasage/armature version
   cd "$(mktemp -d)"
   npm init -y
   npm install @hannasage/armature@next react
   node --input-type=module -e "import * as engine from '@hannasage/armature'; console.log(Object.keys(engine).length)"
   ```

   Run the `dist-tags` command with `--json` as well, so the output is easy to read.

   ```bash
   npm view @hannasage/armature dist-tags --json
   ```

   It must show `"next": "1.0.0-next.0"`.
   Then check `latest`. The registry may also point `latest` at `1.0.0-next.0` after a first publish. The local npm help does not say, so read the result.
   If `latest` points at `1.0.0-next.0`, leave it. A plain `npm install @hannasage/armature` installs the `latest` tag (see `npm help dist-tag`), so with no `latest` that command would resolve nothing.
   Leaving it is acceptable for a package that has no stable release yet.
   If you want to move it anyway, run `npm dist-tag rm @hannasage/armature latest`, or point it at another version with `npm dist-tag add`. Read `npm help dist-tag` first.
   The count in the last command must match the engine list in `scripts/public-api.mjs` (29 names).

8. Tag the commit from step 1.

   ```bash
   git tag -a v1.0.0-next.0 <commit-hash> -m "1.0.0-next.0"
   git push origin v1.0.0-next.0
   ```

9. Update the claims that said nothing was published. Do this in a pull request after the publish, not before.

   - In `README.md`, change the status line `Status: pre-release. Nothing is published. The package is private and the API can still change.` to say that `1.0.0-next.0` is on the `next` tag, that the API can still change, and how to install it.
   - In the Projection UI docs site, the Armature page at `docs-site/app/(docs)/armature/page.tsx` (on the `task/armature-page` branch when this page was written) says `Pre-release. Not published yet.` and `Pre-release. The API can still change.`
     Change the first to say it is on the `next` tag. Keep the second.
   - Search both repositories for `Nothing is published` and `Not published yet` to find any other copy.

## If something is wrong

Read `npm help unpublish` and `npm help deprecate` first. This section comes from the npm help of npm 11.21.2.

The safe fix is a new version.

- Fix the problem, set the version to `1.0.0-next.1`, and publish again with `--tag next`. The `next` tag then points at the new version.
- To point `next` at another version without a publish, run `npm dist-tag add @hannasage/armature@<version> next`.
- A version number can never be used again after it was published, even if it was removed. So the fix is always a new number.

To warn people away from a version, deprecate it. A deprecated version stays installable and shows the warning.

```bash
npm deprecate @hannasage/armature@1.0.0-next.0 "Broken. Use 1.0.0-next.1."
```

You must be an owner of the package. To undo a deprecation, pass an empty message: `""`.

To remove a version, `npm unpublish @hannasage/armature@1.0.0-next.0` deletes that version and its tarball. The npm help says this:

- The name and version can never be reused.
- If you remove all the versions of a package, you may not publish any new version of it until 24 hours have passed.
- Unpublishing a whole package needs `--force`.
- The registry also has its own unpublish rules. The help points to https://docs.npmjs.com/policies/unpublish. Those rules were not in the local help and were not read for this page, so read that page before you rely on `unpublish`.

The npm help itself recommends `npm deprecate` when the aim is to steer people to another version.
