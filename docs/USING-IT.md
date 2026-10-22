# Using it in a real pipeline

The worked example: replacing hand-rolled deploy checks in a GitHub Actions
workflow with two of these packages.

This is the before and after from the project keel was extracted from — a
static site prerendered into six routes across three languages, deployed to a
CDN by a workflow that already had both checks written by hand.

---

## Before: the checks written inline

Two steps, 43 lines of YAML and shell in the one that mattered. Both were
written in response to a specific failure, and both work. They are also 43
lines that every project has to write again, test again, and get wrong again.

```yaml
- name: Check the pages actually contain their content
  run: |
    fail=0
    for f in dist/index.html dist/pricing.html; do
      if [ ! -f "$f" ]; then
        echo "::error::$f was not produced"
        fail=1
        continue
      fi
      bytes=$(wc -c < "$f")
      if [ "$bytes" -lt 12000 ]; then
        echo "::error::$f is only $bytes bytes"
        fail=1
      fi
      grep -q '<title>' "$f" || { echo "::error::$f has no title"; fail=1; }
    done
    exit $fail

- name: Ask the live site for its own pages
  run: |
    for attempt in 1 2 3 4 5 6 7 8; do
      live="$(curl -s "$SITE/?cb=$RANDOM$attempt" || true)"
      case "$live" in *"$SHA"*) break ;; esac
      if [ "$attempt" = 8 ]; then
        echo "::error::$SITE never served build $SHA."
        exit 1
      fi
      sleep 15
    done
    fail=0
    for p in / /pricing /hi /hi/pricing /mr /mr/pricing; do
      code="$(curl -s -o /tmp/body -w '%{http_code}' "$SITE$p?cb=$RANDOM")"
      size="$(wc -c < /tmp/body)"
      [ "$code" != "200" ] && { echo "::error::$p returned $code"; fail=1; }
      # ... byte floor, document detection, and so on
    done
    exit $fail
```

What that version does **not** do, and had to learn the hard way:

- A redirect off the origin is reported as a bare status code. When the URL
  under test sat behind access protection, it answered `404` in 107 bytes and
  `302` on `robots.txt`, and the obvious reading is "the routing table is
  broken" — sending somebody to fix a file layout that was never wrong.
- `robots.txt` is held to the same byte floor as a document, or the floor is
  dropped for everything.
- The failure summary counted routes, so a run that failed at the build-stamp
  stage — before any route was examined — printed `0 of 0 route(s) failed`,
  which reads exactly like success.

## After

```yaml
- name: Stamp the build
  run: npx verify-deploy stamp --into dist --build "$GITHUB_SHA"

- name: Deploy
  run: ./deploy.sh

- name: Ask the live site for its own pages
  run: |
    npx verify-deploy \
      --site https://example.com \
      --build "$GITHUB_SHA" \
      --routes ".,pricing,hi,hi/pricing,mr,mr/pricing,robots.txt,sitemap.xml"
```

```
build acbbf23fd9e856e08058ced6a60a5ac52cba1ad9 live after 1 attempt(s)
  /                  200   102258 bytes
  /pricing           200    37052 bytes
  /hi                200   125028 bytes
  /mr                200   126179 bytes
  /mr/pricing        200    49791 bytes
  /robots.txt        200       70 bytes
  /sitemap.xml       200     2341 bytes

every route answered, on build acbbf23fd9e856e08058ced6a60a5ac52cba1ad9
```

Non-document routes keep their own floor, an off-origin redirect is named as
protection rather than a routing fault, and the summary reports the result
rather than a tally.

---

## And one capability the pipeline did not have

Responsive breakage was checked by taking screenshots and looking at them.
That is how a layout came to be "fixed" for a bug that did not exist — the
captures were 494px wide because of a Windows window-size floor, not 390px.

```yaml
- name: No horizontal overflow
  run: |
    npx overflow https://example.com --widths 320,360,390,414,768,1024,1440
    npx overflow https://example.com/mr --widths 320,390,768
```

```
  320px  ok
  360px  ok
  390px  ok
  414px  ok
  768px  ok
 1024px  ok
 1440px  ok

No horizontal overflow at any of 7 width(s).
```

It needs a Chrome with `--remote-debugging-port`, which a CI runner already
has. If the pipeline already uses Playwright, use the adapter instead and skip
the browser setup entirely.

---

## Order matters

```
  preflight       before anything is pulled, built or migrated
  build
  verify-deploy stamp
  deploy
  verify-deploy   against the public URL, pinned to this build
  overflow        against the public URL
```

`preflight` is first for the same reason the others are last: a deploy that is
going to fail should fail in seconds, not after 2.5 GB has been pulled, a
schema has been migrated and a container has been restarted.

---

## What this is worth

43 lines of shell replaced by 6, in one project, measured from the diff in
`2d1c2ea`. That is not the
argument.

The argument is that those 43 lines were corrected three times before they were
right, and each rewrite came after a failure that reached production: a
routing fault a green build could not see, an auth wall misread as a 404, and
a summary that printed success for a failed run. Every project that writes
these by hand writes those same three bugs, and finds them the same way.
