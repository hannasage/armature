# Workflow audit

This page lists the steps that people and agents repeat in this repository.
For each one it says whether a script should do the work or an agent should keep doing it.

## The test for a script

A step should become a script when all three of these are true:

- It runs in the same order every time.
- It needs no judgment. The result is pass or fail.
- Its inputs are known before it starts.

If the next step depends on what the last step found, or if a person must choose, the step stays an agent task.
An agent can run a script, read its output, and try another approach. The script never decides for the agent.

## Words used on this page

- A token is a small piece of text that a language model reads or writes. One token is about four characters of English.
- A safety class says what a script may change. There are four.
  - `read-only` reads files, git, or the network. It changes nothing.
  - `local-write` changes files in the working tree or in a clone tree.
  - `remote-write` pushes, comments, labels, or opens a pull request.
  - `human-only` publishes, deploys, spends money, logs in, or handles a secret. An agent never runs it.
- A gate is a check that must pass before work moves on. Here the gates are typecheck, lint, test, build, and check:pack.
- A clone tree is a separate folder with its own checkout of a branch. A task works in one so that it does not disturb other work.
- A draft pull request is a pull request that cannot be merged until someone marks it ready.

## The table

All token figures are estimates. They are ranges, not measurements. See "How the estimates were made" below.

| Name | Steps | How often | Estimated tokens saved per run | Safety class | Inputs | Outputs | Decision |
|---|---|---|---|---|---|---|---|
| Full gate run | Run typecheck, lint, test, build, and check:pack. Read each result. Report the exit code of each. | Before every commit and every pull request. Several times per task. | 1,500 to 7,000 | local-write | A folder in a git work tree. Optional flag to run `npm ci` first. | One PASS or FAIL line per gate with the real exit code. Optional JSON. | script. Built as `tools/gates.mjs`, which records the real exit code of every gate so a lint error cannot hide behind a pass line. |
| PR open with the standard body | Check the body rules. Run `gh pr create --draft`. Read the result. | Once per task, plus a retry when the body breaks a rule. | 500 to 2,000 | remote-write | A title, a body file, and a base branch. | The pull request URL, or a list of body problems. | script. Built as `tools/pr-open.mjs`, because the body rules are fixed and the script only opens drafts. |
| Tree cleanliness check | Run `git status`, compare the branch with its remote, and look for processes inside the folder. | Once per clone tree, before it is removed. | 600 to 1,500 | read-only | The top folder of a clone tree. | Three lines (clean, pushed, idle) and an exit code. | script. Built as `tools/tree-clean.mjs`, which removes nothing because removal stays in the factory-tree finish step of the workbench scripts. |
| Release preflight, verify, and claims | Check the branch and the tree. Read the registry. Install the package into a clean project. Count the exported names. Search the docs for stale claims. Also run the gates, the dry run, and the tag. | Once per release. | 8,000 to 25,000 per release | read-only for status and claims. local-write for preflight, gates, dry-run, and verify. remote-write for tag. human-only for publish and retire. | `release.config.json` and the repository. | One result per step, with an exit code. Optional JSON. | script. Built as `scripts/release.mjs`, which prints the commands for publish and retire and never runs them. |
| Version bump | Change the version in `package.json`, in `package-lock.json`, and in `tests/package/contract.test.ts`. Change `release.config.json` too. Run the tests. | Once per prerelease. | 800 to 2,000 | local-write | The new version. | Four changed files and a test result. | script. Not built yet, because the steps never change and one test already checks that `release.config.json` agrees with `package.json`. |
| Pack-size baseline refresh in `docs/baseline.md` | Build. Pack. Read the tarball size. Update the measured size in `scripts/pack-rules.mjs` and in `docs/baseline.md`. | When the package size changes on purpose. Rare. | 1,500 to 4,000 | local-write | The built package. | The measured size and the lines to change. | script. Not built yet, and it would print the size and the edit while a person approves the new baseline, because growth may or may not be wanted. |
| Public API list check (29 names in the root entry) | Import every subpath. Compare the exported names with `scripts/public-api.mjs`. | On every build and every pack check. | 0 new. Already scripted. | read-only | The built package. | A list of missing or extra names. | script. Already built as `scripts/check-exports.mjs` and `scripts/check-pack.mjs`, and the release script reads the count from the same list. |
| Three-viewport screenshot of the examples | Build the examples. Open each at three widths. Look at the pictures. Judge the result. | When an example or a style changes. | 0. The judgment is the work. | read-only | The built examples. | Pictures and a verdict. | keep as agent task, because a script can take the pictures but deciding whether they look right needs judgment. |
| Flaky-test triage | Run the failing test several times. Read the logs. Decide if the cause is time, load, shared state, or a real bug. Choose a fix. | When a test fails once and passes on a rerun. | 0. The judgment is the work. | local-write | A test name and its logs. | A diagnosis and a fix. | keep as agent task, because each step depends on what the last step found. |

## How the estimates were made

The ranges are rough guesses and they are not measured.
The low end assumes an agent reads a short log and makes no mistake.
The high end assumes it reads a long log, such as a full test run, and retries once.
A script replaces that reading with a few lines of output.
The saving is the reading and the retries, minus the cost of the few lines.
The release row is larger because one release has about 25 commands, and an agent would read the output of each.
To replace these guesses with facts, sum the token usage of a few real runs before and after.

## What is built in this lane

- `scripts/release.mjs` and `release.config.json`. Run `npm run release -- status` to see what is left.
- `tools/gates.mjs`. Run `npm run gates`.
- `tools/pr-open.mjs`. Run `npm run pr-open -- --title ... --body-file ... --base ...`.
- `tools/tree-clean.mjs`. Run `npm run tree-clean -- <tree>`.
- `tools/manifest.json` lists every script with its arguments, its output shape, and its safety class.
  A test checks that each listed file exists and that every `tools/*.mjs` file is listed. Another test runs each release subcommand and checks what it changed against the listed paths.

## Rules that every script follows

- It prints the exact command before it runs it.
- Exit code 0 means pass, 1 means a check failed, and 2 means the script was used the wrong way.
- It can run again. A finished release step prints `already done`.
- It stops at the first failed step and prints the first failing line.
- It never reads, stores, or prints a token, a password, or a one-time code.
- Every path argument is resolved first. A path that does not exist, or that is not in a git work tree, is refused.
- Tests use a temporary repository and a fake `npm` and `gh`. They never reach a real registry or a real remote.

## Safety notes

- `preflight`, `gates`, `dry-run`, and `verify` are `local-write`. Each one writes a small note named `release-state.json` inside the `.git` folder.
  The note holds a commit hash, a hash of `package-lock.json`, and for `verify` the integrity string of the published tarball. It holds no secret.
  The `tag` step reads it so that it tags only the commit that preflight saw, and only when the registry still matches what verify saw.
- `preflight` also runs `git fetch`, which updates the remote-tracking branches inside `.git`.
- `gates` and `dry-run` write to `node_modules` and `dist`. They record a result only when the working tree was clean before and after the run.
- `verify` creates a temporary project outside the repository, installs the package there with install scripts turned off and a small environment, and removes the folder when it finishes. The npm cache can change.
- `status` and `claims` are `read-only`. A test runs every release subcommand in a temporary repository and checks that each one changes only the paths that `tools/manifest.json` lists for it.
- A refused precondition exits 1. Exit 2 means wrong use or a human-only step.
- `tree-clean` compares with the last fetch. It does not fetch, so run `git fetch` first if the remote may have changed.
- `--cwd`, `--dir`, and the tree path let git read the configuration of that repository, so only point the tools at a repository you trust.
