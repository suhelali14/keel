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

**4. Two-factor.** npm **requires** it to publish. Without it the publish
fails at the very last step, after the tests have run and the tarball has been
built:

```
npm error code E403
npm error 403 Forbidden - PUT https://registry.npmjs.org/@nayaverse%2foverflow
npm error Two-factor authentication or granular access token with bypass 2fa
npm error enabled is required to publish packages.
```

Two ways through, and they are for different jobs.

**Publishing by hand — turn on 2FA.**
[npmjs.com/settings/~/2fa](https://www.npmjs.com/settings/~/2fa) -> enable for
*Authorization and writes*, scan the QR with any authenticator app, and save
the recovery codes somewhere that is not this machine. Then:

```bash
npm run release          # prompts for the 6-digit code
```

If the prompt does not appear (some Windows terminals swallow it), pass the
code instead. It changes every 30 seconds, so type it last:

```bash
npm publish --workspaces --access public --otp=123456
```

**Publishing from CI — use a granular token.** A pipeline cannot type a code.
[npmjs.com/settings/~/tokens](https://www.npmjs.com/settings/~/tokens) ->
Generate New Token -> **Granular Access Token**, scoped to the `@nayaverse`
packages, with **Bypass 2FA** on and read-and-write permission. Keep the
expiry short and put it in the repo as `NPM_TOKEN`:

```yaml
- run: npm run release
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

A granular token scoped to these packages is the right shape for this: a leak
lets somebody publish these three packages, not touch the whole account.

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

**Read the warnings, not just the file list.** A real one, caught on the first
publish attempt:

```
npm warn publish "bin[overflow]" script name dist/src/cli.js was invalid and removed
```

npm rejects a leading `./` in a `bin` path and **drops the entry** rather than
correcting it. The package would have installed fine and `npx overflow` would
not have existed — while both READMEs told people to run exactly that. `npm
pkg fix` rewrites `./dist/src/cli.js` to `dist/src/cli.js`.

The way to be sure is to install the tarball and look for the binary, not to
read the manifest:

```bash
ls node_modules/.bin/        # overflow, verify-deploy
```

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
