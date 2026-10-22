import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { SCRIPTS, detectScripts, dominantScript } from '../src/scripts.js';

test('each language is identified as the script it is written in', () => {
  const cases: Array<[string, string, string]> = [
    ['Hindi', 'आपका धंधा जैसे चलता है', 'devanagari'],
    ['Marathi', 'तुमचा धंदा जसा चालतो', 'devanagari'],
    ['Bengali', 'আপনি যা বিক্রি করেন', 'bengali'],
    ['Punjabi', 'ਤੁਹਾਡਾ ਕਾਰੋਬਾਰ', 'gurmukhi'],
    ['Gujarati', 'તમારો ધંધો', 'gujarati'],
    ['Odia', 'ଆପଣଙ୍କ ବ୍ୟବସାୟ', 'oriya'],
    ['Tamil', 'உங்கள் வணிகம்', 'tamil'],
    ['Telugu', 'మీ వ్యాపారం', 'telugu'],
    ['Kannada', 'ನಿಮ್ಮ ವ್ಯಾಪಾರ', 'kannada'],
    ['Malayalam', 'നിങ്ങളുടെ ബിസിനസ്', 'malayalam'],
    ['Urdu', 'آپ کا کاروبار', 'arabic'],
    ['Hebrew', 'העסק שלך', 'hebrew'],
    ['Thai', 'ธุรกิจของคุณ', 'thai'],
    ['Khmer', 'អាជីវកម្មរបស់អ្នក', 'khmer'],
    ['Burmese', 'သင့်လုပ်ငန်း', 'myanmar'],
    ['Sinhala', 'ඔබේ ව්‍යාපාරය', 'sinhala'],
    ['Amharic', 'የእርስዎ ንግድ', 'ethiopic'],
    ['Korean', '귀하의 사업', 'hangul'],
    ['Japanese', 'あなたのビジネス', 'kana'],
    ['Chinese', '您的业务', 'han'],
    ['Russian', 'ваш бизнес', 'cyrillic'],
    ['Greek', 'η επιχείρησή σας', 'greek'],
    ['English', 'your business', 'latin'],
  ];
  for (const [language, text, expected] of cases) {
    assert.equal(dominantScript(text)?.name, expected, `${language}: "${text}"`);
  }
});

test('Hindi and Marathi share a script, so they share every typographic rule', () => {
  const hi = dominantScript('आपका धंधा जैसे चलता है');
  const mr = dominantScript('तुमचा धंदा जसा चालतो');
  assert.equal(hi?.name, mr?.name);
});

test('Punjabi in Gurmukhi and Punjabi in Arabic script are different scripts', () => {
  // The same language, written two ways, with different direction and
  // different joining behaviour. This is why the table keys on script.
  assert.equal(dominantScript('ਪੰਜਾਬੀ ਬੋਲੀ')?.name, 'gurmukhi');
  assert.equal(dominantScript('پنجابی زبان')?.name, 'arabic');
  assert.equal(dominantScript('ਪੰਜਾਬੀ ਬੋਲੀ')?.rtl, false);
  assert.equal(dominantScript('پنجابی زبان')?.rtl, true);
});

test('spaces, digits and shared punctuation are attributed to no script', () => {
  assert.deepEqual(detectScripts('  1234 .,!? '), []);
  assert.equal(dominantScript('2026-10-22'), undefined);
});

test('a mixed run reports both scripts, dominant first', () => {
  const found = detectScripts('आपका Nayaverse डैशबोर्ड');
  assert.equal(found.length, 2);
  assert.equal(found[0]?.script.name, 'devanagari');
  assert.equal(found[1]?.script.name, 'latin');
});

test('a minority script does not become the dominant one', () => {
  const text = 'Your Nayaverse dashboard is ready आपका';
  assert.equal(dominantScript(text)?.name, 'latin');
});

test('the share threshold is adjustable for callers that want every script', () => {
  const text = 'Your Nayaverse dashboard is ready आपका';
  assert.equal(dominantScript(text, 0.9), undefined, 'nothing holds 90% of this');
});

test('the properties that drive the rules are set, not left at a default', () => {
  const byName = new Map(SCRIPTS.map((s) => [s.name, s]));
  const devanagari = byName.get('devanagari');
  assert.ok(devanagari);
  assert.equal(devanagari.joins, true, 'the shirorekha is a join');
  assert.equal(devanagari.cased, false);
  assert.equal(devanagari.stacked, true);
  assert.ok(devanagari.minLeading > 1.2);

  const arabic = byName.get('arabic');
  assert.ok(arabic);
  assert.equal(arabic.joins, true);
  assert.equal(arabic.rtl, true);

  const latin = byName.get('latin');
  assert.ok(latin);
  assert.equal(latin.joins, false);
  assert.equal(latin.cased, true);
  assert.equal(latin.minLeading, 1, 'Latin is the baseline the others are measured against');
});

test('every script has a label, at least one range, and a sane leading floor', () => {
  for (const s of SCRIPTS) {
    assert.ok(s.label.length > 0, `${s.name} has no label`);
    assert.ok(s.ranges.length > 0, `${s.name} has no ranges`);
    for (const [lo, hi] of s.ranges) {
      assert.ok(lo <= hi, `${s.name} has an inverted range`);
      assert.ok(lo >= 0 && hi <= 0x10ffff, `${s.name} has a range outside Unicode`);
    }
    assert.ok(s.minLeading >= 1 && s.minLeading <= 2, `${s.name} has an implausible minLeading`);
  }
});

test('no two scripts claim the same codepoint', () => {
  // Overlapping ranges would make detection depend on table order, so the
  // same string could change script if a row moved.
  const owner = new Map<number, string>();
  for (const s of SCRIPTS) {
    for (const [lo, hi] of s.ranges) {
      for (let cp = lo; cp <= hi; cp += 1) {
        const prev = owner.get(cp);
        assert.equal(prev, undefined, `U+${cp.toString(16)} claimed by ${prev} and ${s.name}`);
        owner.set(cp, s.name);
      }
    }
  }
});
