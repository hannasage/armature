// The rules that `scripts/check-readme.mjs` applies. They are plain functions, so a test can run them on any text.
// A rule fails when the README makes a claim that package.json does not back: the status, the version, the install
// command, or the list of subpaths.

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];

// Words that look like a dist-tag and are not one.
const NOT_TAGS = new Set(["latest", "npm", "npx", "node"]);

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The prerelease tag a version carries, such as "beta" for 1.0.0-beta.0. Empty for a stable version. */
function prereleaseId(version) {
  const match = /^\d+\.\d+\.\d+-([0-9A-Za-z-]+)/.exec(version);
  return match ? match[1] : "";
}

/** A stable version has no prerelease id. */
export function isStable(pkg) {
  return prereleaseId(pkg.version) === "";
}

/**
 * The npm tag that `npm install <name>@<tag>` needs. A publish tag other than "latest" wins for any version.
 * With no tag, or the tag "latest", a stable version needs none, and a prerelease needs the tag or its prerelease id.
 */
export function expectedTag(pkg) {
  const publishTag = pkg.publishConfig?.tag;
  if (publishTag && publishTag !== "latest") return publishTag;
  if (isStable(pkg)) return "";
  return publishTag ?? prereleaseId(pkg.version);
}

/** The package name plus a subpath key from the exports map, such as "./dom" -> "<name>/dom". */
export function publicName(pkg, key) {
  return key === "." ? pkg.name : `${pkg.name}/${key.slice(2)}`;
}

/** The text without fenced code blocks. */
function withoutFences(text) {
  return text.replace(/^ {0,3}(```|~~~)[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm, "");
}

/** The inline-code spans of a text that are exactly a public name: the package name, alone or with a subpath. */
function nameSpans(text, pkg) {
  const pattern = new RegExp(`^${escapeRegExp(pkg.name)}(?:/[A-Za-z0-9._/-]*[A-Za-z0-9])?$`);
  return [...text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1].trim()).filter((span) => pattern.test(span));
}

/** The text between the "## The N subpaths" heading and the next "##" heading, or null when there is no heading. */
function subpathSection(source) {
  const readme = withoutFences(source);
  const heading = /^## The (\w+) subpaths$/m.exec(readme);
  if (!heading) return null;
  const rest = readme.slice(heading.index + heading[0].length);
  const next = /^## /m.exec(rest);
  return { word: heading[1], text: next ? rest.slice(0, next.index) : rest };
}

/** Return a list of problems. An empty list means the README agrees with package.json. */
export function checkReadme(readme, pkg) {
  const problems = [];
  const statusLines = readme.split("\n").filter((line) => line.startsWith("Status:"));
  const exportKeys = Object.keys(pkg.exports ?? {});
  const tag = expectedTag(pkg);

  if (exportKeys.length === 0) problems.push("package.json has no exports, so the README has nothing to match");

  // Status and version.
  if (statusLines.length !== 1) {
    problems.push(`the README needs exactly one line that starts with "Status:" and it has ${statusLines.length}`);
  } else {
    const status = statusLines[0];
    if (pkg.private === true) {
      if (!/\bprivate\b/i.test(status)) problems.push('package.json has "private": true, and the status line does not say the package is private');
    } else {
      if (/\bprivate\b/i.test(status) || /nothing is published/i.test(status)) {
        problems.push("package.json is not private, and the status line says the package is private or unpublished");
      }
      if (!new RegExp(`(?<![0-9A-Za-z.-])${escapeRegExp(pkg.version)}(?!\\.?[0-9A-Za-z-])`).test(status)) {
        problems.push(`the status line does not name the version ${pkg.version}`);
      }
      if (tag && tag !== "latest" && !new RegExp(`\`${escapeRegExp(tag)}\``).test(status)) problems.push(`the status line does not name the \`${tag}\` tag`);
      if (isStable(pkg) && !tag) {
        for (const match of status.matchAll(/`([^`]+)`/g)) {
          if (/^[a-z][a-z0-9-]*$/.test(match[1]) && !NOT_TAGS.has(match[1])) problems.push(`the version ${pkg.version} is stable, and the status line names the \`${match[1]}\` tag`);
        }
      }
    }
    const stray = [...status.matchAll(/\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/g)].map((m) => m[0]).filter((v) => v !== pkg.version);
    for (const version of stray) problems.push(`the status line names the version ${version}, and package.json has ${pkg.version}`);
  }

  // Install commands.
  const installs = [...readme.matchAll(/^\s*npm (?:install|i|add) +(\S+)/gm)].map((m) => m[1]);
  if (pkg.private !== true && installs.length === 0) problems.push("the README has no npm install command");
  for (const target of installs) {
    const atVersion = target.startsWith("@") ? target.indexOf("@", 1) : target.indexOf("@");
    const name = atVersion === -1 ? target : target.slice(0, atVersion);
    const spec = atVersion === -1 ? "" : target.slice(atVersion + 1);
    if (name !== pkg.name) problems.push(`the install command names ${name}, and package.json has ${pkg.name}`);
    else if (tag === "latest" && spec !== "" && spec !== "latest" && spec !== pkg.version) problems.push(`the install command is ${target}, and the publish tag is latest, so it needs no tag`);
    else if (tag && tag !== "latest" && spec !== tag && spec !== pkg.version) problems.push(`the install command is ${target}, and it needs @${tag} because the version is ${pkg.version}`);
    else if (!tag && spec !== "" && spec !== "latest" && spec !== pkg.version) problems.push(`the install command is ${target}, and the version ${pkg.version} is stable, so it needs no tag`);
  }

  // Subpaths. The listing check reads only the subpaths section. A name in prose, a URL, or a fenced block does not count.
  const jsKeys = exportKeys.filter((key) => !key.endsWith(".css"));
  const section = subpathSection(readme);
  if (!section) {
    problems.push('the README needs a heading "## The <number> subpaths" that lists every export');
  } else {
    const listed = new Set(nameSpans(withoutFences(section.text), pkg));
    for (const key of exportKeys) {
      if (!listed.has(publicName(pkg, key))) problems.push(`the README does not list the export ${key}`);
    }
    if (NUMBER_WORDS.indexOf(section.word.toLowerCase()) !== jsKeys.length) {
      problems.push(`the README heading says "${section.word}" subpaths, and package.json has ${jsKeys.length} JavaScript entries`);
    }
  }
  const known = new Set(exportKeys.map((key) => publicName(pkg, key)));
  for (const name of new Set(nameSpans(withoutFences(readme), pkg))) {
    if (!known.has(name)) problems.push(`the README names ${name}, and package.json does not export it`);
  }
  return problems;
}
