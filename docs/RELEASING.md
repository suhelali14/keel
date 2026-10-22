# Publishing

Three packages under the `@nayaverse` scope. Nothing is published yet.

## One-time setup

**1. GitHub.** Create an empty repo at `github.com/suhelali14/keel` — no
README, no licence, no `.gitignore`, since all three exist here already.

```bash
cd keel
git remote add origin https://github.com/suhelali14/keel.git
git push -u origin main
```

**2. npm account.** Create one at [npmjs.com/signup](https://www.npmjs.com/signup)
if you have none, then:

```bash
npm login
npm whoami        # should print your username
```

**3. The scope.** `@nayaverse` must exist and belong to you. For a personal
scope, publishing under `@<your-npm-username>` works immediately. For an org
scope, create the org first at
[npmjs.com/org/create](https://www.npmjs.com/org/create) — free for public
packages.

> If your npm username is not `nayaverse` and you do not want an org, rename
> the scope before the first publish. It is three `name` fields and a
> find-and-replace across the READMEs; after publishing it is a deprecation
> and a migration note.

**4. Two-factor.** npm requires it for publishing. Turn it on in account
settings; you will be asked for a code at publish time.

## Publishing

```bash
npm install
npm test                      # 40 tests; prepublishOnly runs them again
npm run release               # publishes all three, public
```

`npm run release` is `npm publish --workspaces --access public`. The `--access
public` matters: a scoped package defaults to **restricted**, which fails on a
free account with a message that does not explain why.

Each package also has `prepublishOnly: npm test`, so a broken tarball cannot
be published by accident. Publishing something broken to npm is close to
unrecoverable — the version number is burnt, people who tried it once do not
come back, and `npm unpublish` is only allowed for 72 hours.

## Check what ships before you ship it

```bash
cd packages/overflow && npm pack --dry-run
```

Should be `dist/src`, the README, and the manifest. **Not** `dist/test`, not
`src`. Current sizes: 14 kB, 19 kB, 13 kB.

And install the tarballs into a throwaway project to confirm the published
artifact works, rather than the source:

```bash
tmp=$(mktemp -d)
for p in verify-deploy overflow preflight; do
  (cd packages/$p && npm pack --pack-destination "$tmp")
done
cd "$tmp" && npm init -y && npm install ./*.tgz
node --input-type=module -e "import { verify } from '@nayaverse/verify-deploy'; console.log(typeof verify)"
./node_modules/.bin/overflow --help
```

That is the same discipline the packages themselves are about: the build
passing is not the claim, the installed thing working is.

## Versions

Start at `0.1.0` and stay below `1.0.0` until the API has survived somebody
else's project. Patch for fixes, minor for additions, and do not rename an
exported function before 1.0 without a minor bump and a line in the README.

## After the first publish

- Check each package page renders its README:
  `npmjs.com/package/@nayaverse/verify-deploy`
- Add the repo topics on GitHub: `deployment`, `ci`, `testing`,
  `responsive-design`, `devops`
- Use them in a real pipeline before telling anyone about them. A package the
  author does not use is visible from the README, and
  [docs/USING-IT.md](USING-IT.md) is the worked example to follow.
