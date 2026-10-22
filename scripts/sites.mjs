/**
 * The survey list.
 *
 * Chosen so the survey can actually say something: every entry serves real
 * prose in a script the rules have an opinion about. A page of English with
 * one foreign word proves nothing either way.
 *
 * `script` is what you expect to find there. The survey compares it against
 * what it actually detected, so a page that quietly served you English —
 * because of a redirect, a geo-wall, or a language cookie — is reported as
 * untested rather than as clean.
 */
export const SITES = [
  // Foundation-run, multilingual by design, and the one publisher that
  // genuinely welcomes a bug report about its own rendering.
  { name: 'Wikipedia (Hindi)', url: 'https://hi.wikipedia.org/wiki/भारत', script: 'devanagari' },
  { name: 'Wikipedia (Marathi)', url: 'https://mr.wikipedia.org/wiki/महाराष्ट्र', script: 'devanagari' },
  { name: 'Wikipedia (Tamil)', url: 'https://ta.wikipedia.org/wiki/தமிழ்_நாடு', script: 'tamil' },
  { name: 'Wikipedia (Arabic)', url: 'https://ar.wikipedia.org/wiki/مصر', script: 'arabic' },
  { name: 'Wikipedia (Thai)', url: 'https://th.wikipedia.org/wiki/ประเทศไทย', script: 'thai' },
  { name: 'Wikipedia (Bengali)', url: 'https://bn.wikipedia.org/wiki/বাংলাদেশ', script: 'bengali' },

  // Major publishers with real editorial budgets, so a fault here is not a
  // small-team oversight.
  { name: 'BBC Hindi', url: 'https://www.bbc.com/hindi', script: 'devanagari' },
  { name: 'BBC Marathi', url: 'https://www.bbc.com/marathi', script: 'devanagari' },
  { name: 'BBC Arabic', url: 'https://www.bbc.com/arabic', script: 'arabic' },
  { name: 'NDTV Khabar', url: 'https://khabar.ndtv.com/', script: 'devanagari' },

  // The standards bodies that define the behaviour being checked. If anyone
  // gets this right it should be these.
  { name: 'W3C i18n (Devanagari notes)', url: 'https://www.w3.org/International/', script: 'latin' },
];

/**
 * Pages whose own documentation says the rules matter, used as a sanity check
 * on the survey itself: if these come back with nothing at all, suspect the
 * harness before believing the web is fine.
 */
export const CONTROLS = [
  {
    name: 'CONTROL: your own site, pre-fix',
    url: 'https://www.nayaverse.in/mr',
    script: 'devanagari',
    expect: 'findings',
  },
];
