# Releasing

This page lists the steps to publish a prerelease of `@hannasage/armature` to the npm `beta` tag.
It is written for the current release, `1.0.0-beta.1`. The same steps apply to every later beta: change the version, and nothing else here.
Only a maintainer does these steps. An agent must not publish, log in to npm, or handle a token.

The repository has its own release script. Run each step as `npm run release -- <step>`. The steps are `status`, `preflight`, `gates`, `dry-run`, `publish`, `verify`, and `tag`. The last two, `retire` and `claims`, are described below.
The script reads `release.config.json`: the version, the tag, the release branch (`main`), and the expected file count.
`publish` and `retire` only print the commands, and you run them yourself.
A refused precondition exits 1. Exit 2 means wrong use or a human-only step.

A prerelease is a version with a dash in it, such as `1.0.0-beta.1`.
A distribution tag, or dist-tag, is a movable label on npm that points at one version.
Publishing with `--tag beta` puts the version under `beta`. It does not make it the default install.

## Before you start

- You need an npm account that can publish to the `@hannasage` scope.
  `npm publish --dry-run` does not check this. The first real publish fails with an error if the account has no right.
- Your account needs two-factor authentication (2FA). `npm publish` asks for a one-time code when the registry requires it. You can also pass `--otp <code>`.
- The pull request that sets the version has been merged into `main`. `release.config.json`, `package.json`, and `package-lock.json` all name the version to publish.

## Steps

Run these from the armature repository folder.

1. Preflight. It checks that the files agree, that you are on `main` at `origin/main`, and that the work tree is clean. It writes down the commit.

   ```bash
   git checkout main
   git pull --ff-only
   npm run release -- preflight
   ```

   Write down the commit hash. `tag` uses the same commit.

2. Gates. This runs `npm ci`, then `typecheck`, `lint`, `test`, `build`, and `check:pack`. Every one must exit with 0.

   ```bash
   npm run release -- gates
   ```

3. Dry run. It runs `npm publish --dry-run --tag beta --access public` and checks the output.

   ```bash
   npm run release -- dry-run
   ```

   It checks these lines:

   - `package: @hannasage/armature@1.0.0-beta.1`.
   - `total files` equals `expectedFileCount` in `release.config.json` (259 for beta.1), and the size is under the limit in `scripts/pack-rules.mjs`.
   - The tag is `beta` and the output says dry-run.
   - The last line is `+ @hannasage/armature@1.0.0-beta.1`.

   A large change in the file count needs an explanation. Set `expectedFileCount` only after you know why it changed.

4. Publish. The script prints the command and does not run it. Run the printed command yourself, and enter the 2FA code when npm asks.

   ```bash
   npm run release -- publish
   npm whoami
   npm publish --tag beta --access public
   ```

   Run `npm login` only if `npm whoami` fails or prints the wrong account.
   Never paste a token into a file, a chat, or a command that is saved in shell history.
   `npm publish` runs `prepublishOnly`, which repeats the gates and the pack check, before it uploads.

5. Verify. It reads the registry and installs the package into a clean project.

   ```bash
   npm run release -- verify
   ```

   It fails if the `beta` tag is not the new version. It also fails if the `gitHead` on the registry differs from the commit that preflight recorded. Do not pass `--allow-no-githead`: without a gitHead nothing ties the tarball to the commit.

6. Tag. It tags the commit from preflight and pushes the tag. It refuses until verify has passed.

   ```bash
   npm run release -- tag
   ```

7. Look at the dist-tags. Moving `latest` is your decision. Beta publishes do not move it.

   ```bash
   npm dist-tag ls @hannasage/armature
   ```

8. Check the claims about the package. Do this in a pull request after the publish, not before.

   ```bash
   npm run release -- claims
   ```

   - `README.md` already says that `1.0.0-beta.1` is on the `beta` tag. It is true once the publish is done.
   - Search both repositories for `Nothing is published`, `Not published yet`, and `armature@next` to find any other copy.
   - The Projection UI docs site has an Armature page that names the published version. Update it after the publish.

## If something is wrong

Read `npm help unpublish` and `npm help deprecate` first. This section comes from the npm help of npm 11.21.2.

The safe fix is a new version.

- Fix the problem, set the version to the next beta, and publish again with `--tag beta`. The `beta` tag then points at the new version.
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

Bump the number after `beta`: `1.0.0-beta.2` follows `1.0.0-beta.1`, and so on. Publish each with `--tag beta`.
In the same commit, change `version` in `package.json`, `package-lock.json`, and `release.config.json`, the status line of `README.md`, and the version in `tests/package/contract.test.ts` and the tests under `tests/tools` that name it.
Run `npm run check:pack -- --update` if the tarball changed, and update `expectedFileCount` in `release.config.json` if the file count changed.
Leave `retire.deprecateMessage` alone. It belongs to the retirement of `1.0.0-next.0` and names `1.0.0-beta.0`.

## Retire 1.0.0-next.0

This was done when `1.0.0-beta.0` was published. It is kept as a record. `npm run release -- retire` reports "already done" once it holds. Only a maintainer does these steps. You must be an owner of the package.

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
