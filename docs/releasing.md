# Releasing

This page lists the steps to publish the prerelease `1.0.0-beta.0` to the npm `beta` tag.
It replaces `1.0.0-next.0`, which is already on npm. The last section retires that version.
Only a maintainer does these steps. An agent must not publish, log in to npm, or handle a token.

A prerelease is a version with a dash in it, such as `1.0.0-beta.0`.
A distribution tag, or dist-tag, is a movable label on npm that points at one version.
Publishing with `--tag beta` puts the version under `beta`. It does not make it the default install.

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
   npm publish --dry-run --tag beta --access public
   ```

   The dry run also runs `prepublishOnly`, which repeats the gates and the pack check. It uploads nothing. Look for these lines:

   - `package: @hannasage/armature@1.0.0-beta.0`.
   - The Tarball Contents list holds `LICENSE`, `README.md`, `package.json`, and files under `dist/`. Nothing else.
   - `total files: 122` and a package size of about 137 kB. A large change from these numbers needs an explanation.
   - The last notice line says `Publishing to https://registry.npmjs.org/ with tag beta and public access (dry-run)`.
   - The last line is `+ @hannasage/armature@1.0.0-beta.0`.

5. Log in. You do this yourself.

   ```bash
   npm whoami
   npm login
   ```

   Run `npm login` only if `npm whoami` fails or prints the wrong account. The login opens a browser or asks for your password and a 2FA code.
   Never paste a token into a file, a chat, or a command that is saved in shell history.

6. Publish.

   ```bash
   npm publish --tag beta --access public
   ```

   Enter the 2FA code when npm asks. The command runs the gates and the pack check once more before it uploads.

7. Verify the registry and a clean install.

   ```bash
   npm view @hannasage/armature dist-tags
   npm view @hannasage/armature version
   cd "$(mktemp -d)"
   npm init -y
   npm install @hannasage/armature@beta react
   node --input-type=module -e "import * as engine from '@hannasage/armature'; console.log(Object.keys(engine).length)"
   ```

   Run the `dist-tags` command with `--json` as well, so the output is easy to read.

   ```bash
   npm view @hannasage/armature dist-tags --json
   ```

   It must show `"beta": "1.0.0-beta.0"`.
   The registry also keeps `latest` and `next` pointing at `1.0.0-next.0` until you retire it. See the last section.
   The count in the last command must match the engine list in `scripts/public-api.mjs` (29 names).

8. Tag the commit from step 1.

   ```bash
   git tag -a v1.0.0-beta.0 <commit-hash> -m "1.0.0-beta.0"
   git push origin v1.0.0-beta.0
   ```

9. Check the claims about the package. Do this in a pull request after the publish, not before.

   - `README.md` already says that `1.0.0-beta.0` is on the `beta` tag. Merge the pull request that holds that text only after the publish.
   - In the Projection UI docs site, the Armature page at `docs-site/app/(docs)/armature/page.tsx` (on the `task/armature-page` branch when this page was written) says `Pre-release. Not published yet.` and `Pre-release. The API can still change.`
     Change the first to say it is on the `beta` tag. Keep the second.
   - Search both repositories for `Nothing is published`, `Not published yet`, and `armature@next` to find any other copy.

## If something is wrong

Read `npm help unpublish` and `npm help deprecate` first. This section comes from the npm help of npm 11.21.2.

The safe fix is a new version.

- Fix the problem, set the version to `1.0.0-beta.1`, and publish again with `--tag beta`. The `beta` tag then points at the new version.
- To point `beta` at another version without a publish, run `npm dist-tag add @hannasage/armature@<version> beta`.
- A version number can never be used again after it was published, even if it was removed. So the fix is always a new number.

To warn people away from a version, deprecate it. A deprecated version stays installable and shows the warning.

```bash
npm deprecate @hannasage/armature@1.0.0-beta.0 "Broken. Use 1.0.0-beta.1."
```

You must be an owner of the package. To undo a deprecation, pass an empty message: `""`.

To remove a version, `npm unpublish @hannasage/armature@1.0.0-beta.0` deletes that version and its tarball. The npm help says this:

- The name and version can never be reused.
- If you remove all the versions of a package, you may not publish any new version of it until 24 hours have passed.
- Unpublishing a whole package needs `--force`.
- The registry also has its own unpublish rules. The help points to https://docs.npmjs.com/policies/unpublish. Those rules were not in the local help and were not read for this page, so read that page before you rely on `unpublish`.

The npm help itself recommends `npm deprecate` when the aim is to steer people to another version.

## Future prereleases

Bump the number after `beta`: `1.0.0-beta.1`, then `1.0.0-beta.2`, and so on. Publish each with `--tag beta`.
Change `version` in `package.json` and in `package-lock.json`, and the version in `tests/package/contract.test.ts`, in the same commit.

## Retire 1.0.0-next.0

Do this after `1.0.0-beta.0` is published and verified. Only a maintainer does these steps. You must be an owner of the package.

Why this is needed: semantic versioning orders prerelease names as plain text, so `beta` sorts below `next`.
That means `1.0.0-next.0` still sorts above `1.0.0-beta.0`. A range such as `^1.0.0-0` could pick `next.0` over `beta.0`.
Deprecating `next.0` does not change the order. It warns people who install it, and it points them at the new version.
Moving the tags makes the plain install and the `beta` install land on `1.0.0-beta.0`.

1. Deprecate the old version.

   ```bash
   npm deprecate @hannasage/armature@1.0.0-next.0 "Renamed to the beta tag. Use 1.0.0-beta.0."
   ```

2. Remove the `next` tag.

   ```bash
   npm dist-tag rm @hannasage/armature next
   ```

3. Move `latest` to the new version. A plain `npm install @hannasage/armature` installs `latest`.

   ```bash
   npm dist-tag add @hannasage/armature@1.0.0-beta.0 latest
   ```

4. Check the result. `dist-tags` must show `"beta"` and `"latest"` at `1.0.0-beta.0`, and no `next`.

   ```bash
   npm view @hannasage/armature dist-tags --json
   npm view @hannasage/armature@1.0.0-next.0 deprecated
   ```
