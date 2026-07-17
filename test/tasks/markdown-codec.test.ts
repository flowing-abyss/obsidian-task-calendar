import { describe, expect, it } from 'vitest';
import {
  TaskMarkdownCodec,
  type ParsedTaskLine,
  type TaskSpanKind,
} from '../../src/tasks/infrastructure/markdown/TaskMarkdownCodec';
import { canonicalStatusCatalog } from '../helpers';

const codec = new TaskMarkdownCodec(canonicalStatusCatalog());
const location = { filePath: 'Projects/Test.md', line: 4 };

function parse(source: string): ParsedTaskLine {
  const parsed = codec.parseLine(source, location);
  expect(parsed).not.toBeNull();
  return parsed!;
}

function spanText(parsed: ParsedTaskLine, kind: TaskSpanKind): string[] {
  return parsed.spans
    .filter((span) => span.kind === kind)
    .map((span) => parsed.original.slice(span.from, span.to));
}

function expectLosslessPartition(parsed: ParsedTaskLine): void {
  expect(parsed.spans[0]?.from).toBe(0);
  for (let i = 1; i < parsed.spans.length; i++) {
    expect(parsed.spans[i]?.from).toBe(parsed.spans[i - 1]?.to);
  }
  expect(parsed.spans[parsed.spans.length - 1]?.to).toBe(parsed.original.length);
  expect(parsed.spans.map((span) => parsed.original.slice(span.from, span.to)).join('')).toBe(
    parsed.original,
  );
}

describe('TaskMarkdownCodec', () => {
  it('inserts a title before metadata when the source has no editable title fragment', () => {
    expect(
      codec.applyLineEdit('- [ ] 📅 2026-07-20', {
        type: 'set-title',
        markdownTitle: 'New title',
      }),
    ).toEqual({ type: 'changed', content: '- [ ] New title 📅 2026-07-20' });
  });

  it.each([-1, 0.5])('rejects invalid text-link occurrence %s', (occurrence) => {
    expect(codec.editTextLink('before [[Link]] after', occurrence, '[[Changed]]')).toEqual({
      type: 'invalid',
      issues: [{ code: 'invalid-target', field: 'link' }],
    });
  });

  it('rejects a missing text-link occurrence', () => {
    expect(codec.editTextLink('plain text', 0, '[[Changed]]')).toEqual({
      type: 'invalid',
      issues: [{ code: 'invalid-target', field: 'link' }],
    });
  });

  describe('full-line validation used by task creation', () => {
    it.each([
      ['ordinary metadata', '- [ ] Gym ⏰ 10:00 ⏱️ 1h 📅 2026-07-11'],
      ['plain task', '- [ ] Buy milk'],
      ['boundary time', '- [ ] t ⏰ 23:59 📅 2026-07-11'],
      ['valid start/due span', '- [ ] t 🛫 2026-07-01 📅 2026-07-05'],
      ['same-day start/due span', '- [ ] t 🛫 2026-07-15 📅 2026-07-15'],
    ])('accepts a well-formed %s line', (_case, source) => {
      expect(codec.validateLine(source)).toEqual([]);
    });

    it.each([
      ['out-of-grammar hour', '- [ ] t ⏰ 2093:15 📅 2026-07-11'],
      ['out-of-range hour', '- [ ] t ⏰ 25:00 📅 2026-07-11'],
      ['out-of-range minute', '- [ ] t ⏰ 10:75 📅 2026-07-11'],
      ['zero duration', '- [ ] t ⏱️ 0m 📅 2026-07-11'],
      ['impossible day', '- [ ] t 📅 2026-07-32'],
      ['impossible month', '- [ ] t 📅 2026-13-01'],
      ['non-task syntax', 'not a task line'],
      ['impossible start date', '- [ ] t 🛫 2026-02-30 📅 2026-07-05'],
      ['inverted start/due span', '- [ ] t 🛫 2026-07-16 📅 2026-07-15'],
    ])('rejects a malformed %s line without authorizing a write', (_case, source) => {
      expect(codec.validateLine(source)).not.toEqual([]);
    });
  });

  describe('lossless line edits', () => {
    it.each([
      ['set-title', { type: 'set-title', markdownTitle: 'Changed\n- [ ] injected' }, 'title'],
      ['append-title', { type: 'append-title', markdown: 'later\rinjected' }, 'title'],
      [
        'title edit-link',
        { type: 'edit-link', occurrence: 0, replacement: '[[Changed]]\n- [ ] injected' },
        'link',
      ],
    ] as const)(
      'rejects multiline input through %s without changing the task line',
      (_type, edit, field) => {
        expect(codec.applyLineEdit('- [ ] Task [[Link]]', edit)).toEqual({
          type: 'invalid',
          issues: [{ code: 'invalid-target', field }],
        });
      },
    );

    it.each(['[[Changed]]\n- [ ] injected', '[[Changed]]\rinjected'])(
      'rejects multiline text-link replacement %j without changing the source',
      (replacement) => {
        expect(codec.editTextLink('before [[Link]] after', 0, replacement)).toEqual({
          type: 'invalid',
          issues: [{ code: 'invalid-target', field: 'link' }],
        });
      },
    );

    it.each([
      ['set-title', { type: 'set-title', markdownTitle: 'Changed 📅 nope' }, 'due', 'invalid-date'],
      ['append-title', { type: 'append-title', markdown: '📅 nope' }, 'due', 'invalid-date'],
      [
        'set-title',
        { type: 'set-title', markdownTitle: 'Changed ⏰ 2093:15' },
        'time',
        'invalid-time',
      ],
      ['append-title', { type: 'append-title', markdown: '⏰ 2093:15' }, 'time', 'invalid-time'],
      [
        'set-title',
        { type: 'set-title', markdownTitle: 'Changed ⏱️ nope' },
        'duration',
        'invalid-duration',
      ],
      [
        'append-title',
        { type: 'append-title', markdown: '⏱️ nope' },
        'duration',
        'invalid-duration',
      ],
    ] as const)('rejects invalid metadata introduced through %s', (_type, edit, field, code) => {
      expect(codec.applyLineEdit('- [ ] Task', edit)).toEqual({
        type: 'invalid',
        issues: [{ code, field }],
      });
    });

    it.each([
      [
        'set-title',
        '- [ ] Task 📅 2026-07-20',
        { type: 'set-title', markdownTitle: 'Changed 📅 2026-07-21' },
        'due',
      ],
      [
        'append-title',
        '- [ ] Task 📅 2026-07-20',
        { type: 'append-title', markdown: '📅 2026-07-21' },
        'due',
      ],
      [
        'set-title',
        '- [ ] Task ⏰ 08:00',
        { type: 'set-title', markdownTitle: 'Changed ⏰ 09:00' },
        'time',
      ],
      [
        'append-title',
        '- [ ] Task ⏰ 08:00',
        { type: 'append-title', markdown: '⏰ 09:00' },
        'time',
      ],
      [
        'set-title',
        '- [ ] Task ⏱️ 30m',
        { type: 'set-title', markdownTitle: 'Changed ⏱️ 45m' },
        'duration',
      ],
      [
        'append-title',
        '- [ ] Task ⏱️ 30m',
        { type: 'append-title', markdown: '⏱️ 45m' },
        'duration',
      ],
    ] as const)(
      'rejects duplicate metadata introduced through %s',
      (_type, source, edit, field) => {
        expect(codec.applyLineEdit(source, edit)).toEqual({
          type: 'invalid',
          issues: [{ code: 'duplicate-field', field }],
        });
      },
    );

    it.each([
      ['set-title', { type: 'set-title', markdownTitle: 'Changed 📅 2026-07-21' }],
      ['append-title', { type: 'append-title', markdown: '📅 2026-07-21' }],
      ['set-title', { type: 'set-title', markdownTitle: 'Changed #added' }],
      ['append-title', { type: 'append-title', markdown: '#added' }],
      ['set-title', { type: 'set-title', markdownTitle: 'Changed 🆔 introduced' }],
      ['append-title', { type: 'append-title', markdown: '🆔 introduced' }],
      ['set-title', { type: 'set-title', markdownTitle: 'Changed 🆔 bad.id' }],
      ['append-title', { type: 'append-title', markdown: '🆔 bad.id' }],
      ['set-title', { type: 'set-title', markdownTitle: 'Changed ⛔ introduced' }],
      ['append-title', { type: 'append-title', markdown: '⛔ introduced' }],
      ['set-title', { type: 'set-title', markdownTitle: 'Changed ⛔ one,,two' }],
      ['append-title', { type: 'append-title', markdown: '⛔ one,,two' }],
      ['set-title', { type: 'set-title', markdownTitle: 'Changed ^introduced' }],
      ['append-title', { type: 'append-title', markdown: '^introduced' }],
    ] as const)('rejects semantic spans introduced through %s', (_type, edit) => {
      expect(codec.applyLineEdit('- [ ] Task', edit)).toEqual({
        type: 'invalid',
        issues: [{ code: 'invalid-target', field: 'title' }],
      });
    });

    it('preserves unrelated malformed and opaque source spans when setting time', () => {
      const source = '- [?] Old [[Title]] #work 🆔 keep-me ⛔ a,b 📅 2026-02-30 ⏱️ nope ^block';

      expect(codec.applyLineEdit(source, { type: 'set-time', value: '09:30' })).toEqual({
        type: 'changed',
        content:
          '- [?] Old [[Title]] #work 🆔 keep-me ⛔ a,b 📅 2026-02-30 ⏱️ nope ⏰ 09:30 ^block',
      });
    });

    it('rejects an ambiguous targeted single-valued field without changing source', () => {
      const source = '- [ ] Duplicate 📅 2026-07-20 📅 2026-07-21';

      expect(
        codec.applyLineEdit(source, {
          type: 'set-date',
          field: 'due',
          value: '2026-07-20',
        }),
      ).toEqual({
        type: 'invalid',
        issues: [{ code: 'duplicate-field', field: 'due' }],
      });
    });

    it('preserves an unrelated duplicate while replacing only the targeted span', () => {
      const source = '- [ ] Task 📅 2026-07-20 📅 2026-07-21 ⏰ 08:00';

      expect(codec.applyLineEdit(source, { type: 'set-time', value: '09:30' })).toEqual({
        type: 'changed',
        content: '- [ ] Task 📅 2026-07-20 📅 2026-07-21 ⏰ 09:30',
      });
    });

    it('validates a changed field but ignores malformed unrelated fields', () => {
      const source = '- [ ] Task 📅 2026-02-30';

      expect(codec.applyLineEdit(source, { type: 'set-time', value: '25:00' })).toEqual({
        type: 'invalid',
        issues: [{ code: 'invalid-time', field: 'time' }],
      });
      expect(codec.applyLineEdit(source, { type: 'set-time', value: '09:30' })).toEqual({
        type: 'changed',
        content: '- [ ] Task 📅 2026-02-30 ⏰ 09:30',
      });
    });

    it('checks start/due ordering only when a span boundary changes', () => {
      const source = '- [ ] Old #work 🛫 2026-07-21 📅 2026-07-20';

      expect(codec.applyLineEdit(source, { type: 'set-title', markdownTitle: 'New' })).toEqual({
        type: 'changed',
        content: '- [ ] New #work 🛫 2026-07-21 📅 2026-07-20',
      });
      expect(
        codec.applyLineEdit(source, {
          type: 'set-date',
          field: 'due',
          value: '2026-07-19',
        }),
      ).toEqual({
        type: 'invalid',
        issues: [{ code: 'inverted-span', field: 'start,due' }],
      });
    });

    it('replaces title source while preserving tags, IDs, dependencies, metadata, and block ID', () => {
      const source =
        '- [ ] Old [[Title|alias]] #work 🆔 keep-me ⛔ a,b ⏰ 08:00 📅 2026-07-20 ^block';

      expect(
        codec.applyLineEdit(source, {
          type: 'set-title',
          markdownTitle: 'New [title](https://example.test)',
        }),
      ).toEqual({
        type: 'changed',
        content:
          '- [ ] New [title](https://example.test) #work 🆔 keep-me ⛔ a,b ⏰ 08:00 📅 2026-07-20 ^block',
      });
    });

    it('replaces only the selected title link occurrence without reconstructing the line', () => {
      const source =
        '> - [ ] [[Doc#Heading|same]]#tag [[Doc^block|same]] 🧭 opaque 🆔 keep-id ⛔ dep [[After|same]] ^block\r\n';

      expect(
        codec.applyLineEdit(source, {
          type: 'edit-link',
          occurrence: 1,
          replacement: '[[Changed^anchor|updated]]',
        }),
      ).toEqual({
        type: 'changed',
        content:
          '> - [ ] [[Doc#Heading|same]]#tag [[Changed^anchor|updated]] 🧭 opaque 🆔 keep-id ⛔ dep [[After|same]] ^block\r\n',
      });

      expect(
        codec.applyLineEdit(source, {
          type: 'edit-link',
          occurrence: 2,
          replacement: '[[AfterChanged]]',
        }),
      ).toEqual({
        type: 'changed',
        content:
          '> - [ ] [[Doc#Heading|same]]#tag [[Doc^block|same]] 🧭 opaque 🆔 keep-id ⛔ dep [[AfterChanged]] ^block\r\n',
      });
    });

    it.each([
      ['- [ ] [[Calendar 📅 2026-07-20|date]] 📅 2026-08-01', '- [ ] [[Changed]] 📅 2026-08-01'],
      ['- [ ] [[Doc|time ⏰ 09:00]] ⏰ 10:00', '- [ ] [[Changed]] ⏰ 10:00'],
      ['- [ ] [[Doc|ID 🆔 keep]] 🆔 real-id', '- [ ] [[Changed]] 🆔 real-id'],
    ])(
      'treats metadata-looking text inside a title link as atomic while preserving real metadata',
      (source, expected) => {
        expect(
          codec.applyLineEdit(source, {
            type: 'edit-link',
            occurrence: 0,
            replacement: '[[Changed]]',
          }),
        ).toEqual({ type: 'changed', content: expected });
      },
    );

    it('rejects an absent title-link occurrence and keeps embeds and escaped lookalikes uncounted', () => {
      const source = '- [ ] ![[embed.png]] \\[[escaped]] [[Real]]';

      expect(
        codec.applyLineEdit(source, {
          type: 'edit-link',
          occurrence: 0,
          replacement: '[[Changed]]',
        }),
      ).toEqual({ type: 'changed', content: '- [ ] ![[embed.png]] \\[[escaped]] [[Changed]]' });
      expect(
        codec.applyLineEdit(source, {
          type: 'edit-link',
          occurrence: 1,
          replacement: '[[Changed]]',
        }),
      ).toEqual({
        type: 'invalid',
        issues: [{ code: 'invalid-target', field: 'link' }],
      });
    });

    it('sets the title fragment after a repository-leading tag without retaining the old title', () => {
      const source = '- [ ] #task/one-off Buy milk 📅 2026-06-24';
      const result = codec.applyLineEdit(source, { type: 'set-title', markdownTitle: 'New' });

      expect(result).toEqual({
        type: 'changed',
        content: '- [ ] #task/one-off New 📅 2026-06-24',
      });
      expect(parse((result as Extract<typeof result, { type: 'changed' }>).content)).toMatchObject({
        markdownTitle: 'New',
        tags: ['#task/one-off'],
        planning: { due: '2026-06-24' },
      });
    });

    it('appends after the last title fragment following a repository-leading tag', () => {
      const source = '- [ ] #task/one-off Buy milk 📅 2026-06-24';
      const result = codec.applyLineEdit(source, { type: 'append-title', markdown: 'later' });

      expect(result).toEqual({
        type: 'changed',
        content: '- [ ] #task/one-off Buy milk later 📅 2026-06-24',
      });
      expect(parse((result as Extract<typeof result, { type: 'changed' }>).content)).toMatchObject({
        markdownTitle: 'Buy milk later',
        tags: ['#task/one-off'],
        planning: { due: '2026-06-24' },
      });
    });

    it('sets an interleaved-tag title by replacing the first fragment and removing later fragments', () => {
      const source = '- [ ] Buy #shop milk 📅 2026-06-24';
      const result = codec.applyLineEdit(source, { type: 'set-title', markdownTitle: 'New' });

      expect(result).toEqual({
        type: 'changed',
        content: '- [ ] New #shop 📅 2026-06-24',
      });
      expect(parse((result as Extract<typeof result, { type: 'changed' }>).content)).toMatchObject({
        markdownTitle: 'New',
        tags: ['#shop'],
        planning: { due: '2026-06-24' },
      });
    });

    it('appends after the last interleaved-tag title fragment', () => {
      const source = '- [ ] Buy #shop milk 📅 2026-06-24';
      const result = codec.applyLineEdit(source, { type: 'append-title', markdown: 'later' });

      expect(result).toEqual({
        type: 'changed',
        content: '- [ ] Buy #shop milk later 📅 2026-06-24',
      });
      expect(parse((result as Extract<typeof result, { type: 'changed' }>).content)).toMatchObject({
        markdownTitle: 'Buy milk later',
        tags: ['#shop'],
        planning: { due: '2026-06-24' },
      });
    });

    it('replaces only the editable title and preserves unrelated malformed and unknown spans', () => {
      const source =
        '- [ ] Old title 🧭 north 🆔 bad.id ⛔ one,,two 📅 nope ⏰ 9:5 ⏱️ nope #work 🆔 keep-id ⛔ dep-1 ^block';

      expect(
        codec.applyLineEdit(source, { type: 'set-title', markdownTitle: 'New title' }),
      ).toEqual({
        type: 'changed',
        content:
          '- [ ] New title 🧭 north 🆔 bad.id ⛔ one,,two 📅 nope ⏰ 9:5 ⏱️ nope #work 🆔 keep-id ⛔ dep-1 ^block',
      });
    });

    it('does not duplicate a protected unknown suffix when editing the displayed markdown title', () => {
      const source =
        '- [ ] Old [[Title]] 🧭 preserve-unknown #work 🆔 keep-id ⛔ dep-1 📅 2026-07-20';
      const displayedTitle = parse(source).markdownTitle;

      const edited = codec.applyLineEdit(source, {
        type: 'set-title',
        markdownTitle: `${displayedTitle} TEMP`,
      });

      expect(edited).toEqual({
        type: 'changed',
        content:
          '- [ ] Old [[Title]] TEMP 🧭 preserve-unknown #work 🆔 keep-id ⛔ dep-1 📅 2026-07-20',
      });
      const editedContent = (edited as Extract<typeof edited, { type: 'changed' }>).content;
      expect(parse(editedContent).markdownTitle).toBe('Old [[Title]] TEMP 🧭 preserve-unknown');
    });

    it('keeps an identical protected value inside a wiki-link alias byte-correct', () => {
      const source =
        '- [ ] Old [[Note|🧭 preserve-unknown]] 🧭 preserve-unknown #work 🆔 keep-id ⛔ dep-1 ^block';

      expect(
        codec.applyLineEdit(source, {
          type: 'set-title',
          markdownTitle: `${parse(source).markdownTitle} TEMP`,
        }),
      ).toEqual({
        type: 'changed',
        content:
          '- [ ] Old [[Note|🧭 preserve-unknown]] TEMP 🧭 preserve-unknown #work 🆔 keep-id ⛔ dep-1 ^block',
      });
    });

    it('keeps an identical protected value inside a Markdown-link label byte-correct', () => {
      const source =
        '- [ ] Old [🧭 preserve-unknown](https://example.test) 🧭 preserve-unknown #work 🆔 keep-id ⛔ dep-1 ^block';

      expect(
        codec.applyLineEdit(source, {
          type: 'set-title',
          markdownTitle: `${parse(source).markdownTitle} TEMP`,
        }),
      ).toEqual({
        type: 'changed',
        content:
          '- [ ] Old [🧭 preserve-unknown](https://example.test) TEMP 🧭 preserve-unknown #work 🆔 keep-id ⛔ dep-1 ^block',
      });
    });

    it('keeps two identical link-label occurrences while preserving one source-owned value', () => {
      const source =
        '- [ ] [[One|🧭 same]] [🧭 same](https://example.test) 🧭 same 🆔 keep-id ⛔ dep-1 ^block';

      expect(
        codec.applyLineEdit(source, {
          type: 'set-title',
          markdownTitle: `${parse(source).markdownTitle} TEMP`,
        }),
      ).toEqual({
        type: 'changed',
        content:
          '- [ ] [[One|🧭 same]] [🧭 same](https://example.test) TEMP 🧭 same 🆔 keep-id ⛔ dep-1 ^block',
      });
    });

    it('edits a title after a protected-leading range without duplicating either range', () => {
      const source = '- [ ] 🧭 preserve-unknown Old [[Title]] #work 🆔 keep-id ⛔ dep-1 ^block';

      expect(
        codec.applyLineEdit(source, {
          type: 'set-title',
          markdownTitle: `${parse(source).markdownTitle} TEMP`,
        }),
      ).toEqual({
        type: 'changed',
        content: '- [ ] 🧭 preserve-unknown Old [[Title]] TEMP #work 🆔 keep-id ⛔ dep-1 ^block',
      });
    });

    it('keeps adjacent protected ranges once while editing all ordinary title fragments', () => {
      const source = '- [ ] Old 🧭 opaque 📅 not-a-date [[Title]] #work 🆔 keep-id ⛔ dep-1 ^block';

      expect(
        codec.applyLineEdit(source, {
          type: 'set-title',
          markdownTitle: `${parse(source).markdownTitle} TEMP`,
        }),
      ).toEqual({
        type: 'changed',
        content:
          '- [ ] Old [[Title]] TEMP 🧭 opaque 📅 not-a-date #work 🆔 keep-id ⛔ dep-1 ^block',
      });
    });

    it('treats inline code as editable title text rather than a protected unknown range', () => {
      const source =
        '- [ ] Old `🧭 preserve-unknown` 🧭 preserve-unknown End 🆔 keep-id ⛔ dep-1 ^block';

      expect(
        codec.applyLineEdit(source, {
          type: 'set-title',
          markdownTitle: `${parse(source).markdownTitle} TEMP`,
        }),
      ).toEqual({
        type: 'changed',
        content:
          '- [ ] Old `🧭 preserve-unknown` End TEMP 🧭 preserve-unknown 🆔 keep-id ⛔ dep-1 ^block',
      });
    });

    it('preserves CRLF and remains idempotent across repeated protected-leading edits', () => {
      const source =
        '> - [ ] 🧭 preserve-unknown Old [[Title]] #work 🆔 keep-id ⛔ dep-1 ^block\r\n';
      const first = codec.applyLineEdit(source, {
        type: 'set-title',
        markdownTitle: `${parse(source).markdownTitle} FIRST`,
      });
      expect(first).toEqual({
        type: 'changed',
        content:
          '> - [ ] 🧭 preserve-unknown Old [[Title]] FIRST #work 🆔 keep-id ⛔ dep-1 ^block\r\n',
      });

      const firstContent = (first as Extract<typeof first, { type: 'changed' }>).content;
      expect(
        codec.applyLineEdit(firstContent, {
          type: 'set-title',
          markdownTitle: `${parse(firstContent).markdownTitle} SECOND`,
        }),
      ).toEqual({
        type: 'changed',
        content:
          '> - [ ] 🧭 preserve-unknown Old [[Title]] FIRST SECOND #work 🆔 keep-id ⛔ dep-1 ^block\r\n',
      });
    });

    it('removes only the source-owned marker from a longer displayed protected group', () => {
      const source = '- [ ] 🧭';

      expect(
        codec.applyLineEdit(source, {
          type: 'set-title',
          markdownTitle: `${parse(source).markdownTitle} TEMP`,
        }),
      ).toEqual({
        type: 'changed',
        content: '- [ ] 🧭 TEMP',
      });
    });

    it('keeps ordinary payload after hidden carriers without duplicating source-owned spans', () => {
      const source = '- [ ] Old 🧭 #tag payload 🆔 id ⛔ dep ^block';

      expect(parse(source).markdownTitle).toBe('Old 🧭 payload');
      expect(
        codec.applyLineEdit(source, {
          type: 'set-title',
          markdownTitle: `${parse(source).markdownTitle} TEMP`,
        }),
      ).toEqual({
        type: 'changed',
        content: '- [ ] Old payload TEMP 🧭 #tag 🆔 id ⛔ dep ^block',
      });
    });

    it.each([
      [
        '- [ ] Old 🧭 📅 2026-07-20 payload',
        '- [ ] Old payload TEMP 🧭 📅 2026-07-20',
        '- [ ] Old payload TEMP AGAIN 🧭 📅 2026-07-20',
      ],
      [
        '- [ ] Old 🧭 🆔 id payload',
        '- [ ] Old payload TEMP 🧭 🆔 id',
        '- [ ] Old payload TEMP AGAIN 🧭 🆔 id',
      ],
      [
        '- [ ] Old 🧭 ^block payload ^terminal',
        '- [ ] Old payload TEMP 🧭 ^block ^terminal',
        '- [ ] Old payload TEMP AGAIN 🧭 ^block ^terminal',
      ],
    ])(
      'keeps hidden recognized carriers once across repeated displayed-title edits: %s',
      (source, firstExpected, secondExpected) => {
        const first = codec.applyLineEdit(source, {
          type: 'set-title',
          markdownTitle: `${parse(source).markdownTitle} TEMP`,
        });
        expect(first).toEqual({ type: 'changed', content: firstExpected });

        const firstContent = (first as Extract<typeof first, { type: 'changed' }>).content;
        expect(
          codec.applyLineEdit(firstContent, {
            type: 'set-title',
            markdownTitle: `${parse(firstContent).markdownTitle} AGAIN`,
          }),
        ).toEqual({ type: 'changed', content: secondExpected });
      },
    );

    it('matches protected groups by span and occurrence across reorder and deletion edits', () => {
      const source = '- [ ] Old 🧭 same Middle 🧭 same End 🧪 other';

      expect(
        codec.applyLineEdit(source, {
          type: 'set-title',
          markdownTitle: '🧪 other New 🧭 same 🧭 same',
        }),
      ).toEqual({
        type: 'changed',
        content: '- [ ] New 🧭 same 🧭 same 🧪 other',
      });
      expect(codec.applyLineEdit(source, { type: 'set-title', markdownTitle: 'New' })).toEqual({
        type: 'changed',
        content: '- [ ] New 🧭 same 🧭 same 🧪 other',
      });
    });

    it('returns unchanged for semantic no-op edits without normalizing bytes', () => {
      const source = '- [ ] Task  📅   2026-07-20 ^block\r\n';

      expect(
        codec.applyLineEdit(source, {
          type: 'set-date',
          field: 'due',
          value: '2026-07-20',
        }),
      ).toEqual({ type: 'unchanged', content: source });
    });
  });

  it('partitions a representative Tasks-compatible line without losing source bytes', () => {
    const source =
      '> - [/] Review [[Design|spec]] #work 🆔 review-1 ⛔ prep-1, prep_2 📅 2026-07-20 ^review';
    const parsed = parse(source);

    expect(parsed).toMatchObject({
      statusSymbol: '/',
      markdownTitle: 'Review [[Design|spec]]',
      tags: ['#work'],
      planning: { due: '2026-07-20' },
      source: { filePath: 'Projects/Test.md', line: 4, originalMarkdown: source },
    });
    expect(spanText(parsed, 'task-id')).toEqual(['🆔 review-1']);
    expect(spanText(parsed, 'depends-on')).toEqual(['⛔ prep-1, prep_2']);
    expect(spanText(parsed, 'block-id')).toEqual(['^review']);
    expectLosslessPartition(parsed);
  });

  it.each([
    ['🔺', 'A'],
    ['⏫', 'B'],
    ['🔼', 'C'],
    ['', 'D'],
    ['🔽', 'E'],
    ['⏬', 'F'],
  ] as const)('decodes priority %s as %s', (marker, priority) => {
    const parsed = parse(`- [ ] Task${marker ? ` ${marker}` : ''}`);
    expect(parsed.priority).toBe(priority);
    expect(parsed.markdownTitle).toBe('Task');
    expectLosslessPartition(parsed);
  });

  it('recognizes every planning field, recurrence, created date, time, and duration', () => {
    const source =
      '- [x] Ship ⏰ 09:05 ⏱️ 1h30m 🔁 every week ➕ 2026-07-01 🛫 2026-07-02 ⏳ 2026-07-03 📅 2026-07-04 ❌ 2026-07-05 ✅ 2026-07-06';
    const parsed = parse(source);

    expect(parsed.markdownTitle).toBe('Ship');
    expect(parsed.recurrence).toBe('every week');
    expect(parsed.planning).toEqual({
      start: '2026-07-02',
      scheduled: '2026-07-03',
      due: '2026-07-04',
      cancelled: '2026-07-05',
      completion: '2026-07-06',
      time: '09:05',
      duration: 90,
    });
    expect(spanText(parsed, 'created')).toEqual(['➕ 2026-07-01']);
    expectLosslessPartition(parsed);
  });

  it('retains every duplicate occurrence while exposing legacy first-value semantics', () => {
    const parsed = parse('- [ ] Task 📅 2026-07-01 📅 2026-07-02 🔼 🔽');

    expect(parsed.planning.due).toBe('2026-07-01');
    expect(parsed.priority).toBe('C');
    expect(parsed.occurrences.get('due')).toHaveLength(2);
    expect(parsed.occurrences.get('priority')).toHaveLength(2);
    expectLosslessPartition(parsed);
  });

  it('does not skip a zero-duration first occurrence in favor of a later duplicate', () => {
    const parsed = parse('- [ ] Task ⏱️ 0m ⏱️ 1h');
    expect(parsed.planning.duration).toBeUndefined();
    expect(parsed.occurrences.get('duration')).toHaveLength(2);
    expectLosslessPartition(parsed);
  });

  it('keeps tags and nested tags as dedicated spans while preserving Markdown title markup', () => {
    const parsed = parse(
      '- [ ] Read [[Sources|secondary sources]] and [docs](https://example.test) #work #project/alpha-beta',
    );

    expect(parsed.markdownTitle).toBe(
      'Read [[Sources|secondary sources]] and [docs](https://example.test)',
    );
    expect(parsed.tags).toEqual(['#work', '#project/alpha-beta']);
    expect(spanText(parsed, 'tag')).toEqual(['#work', '#project/alpha-beta']);
    expectLosslessPartition(parsed);
  });

  it.each([
    '  - [ ] Indented',
    '\t- [ ] Tabbed',
    '> - [ ] Quoted',
    '> > - [ ] Nested callout task',
    '>>- [ ] Compact quote',
  ])('preserves indentation and blockquote/callout prefix in %j', (source) => {
    const parsed = parse(source);
    expect(spanText(parsed, 'prefix')).toHaveLength(1);
    expectLosslessPartition(parsed);
  });

  it('preserves CRLF as its own exact source span', () => {
    const source = '> - [ ] Windows task 📅 2026-07-20\r\n';
    const parsed = parse(source);

    expect(parsed.lineEnding).toBe('\r\n');
    expect(parsed.source.originalMarkdown).toBe(source);
    const separators = spanText(parsed, 'separator');
    expect(separators[separators.length - 1]).toBe('\r\n');
    expectLosslessPartition(parsed);
  });

  it.each([
    ['🆔 A', 'A'],
    ['🆔 abc-DEF_123', 'abc-DEF_123'],
    ['🆔️ id_with-vs16', 'id_with-vs16'],
  ])('recognizes the pinned task ID grammar in %j', (carrier, id) => {
    const parsed = parse(`- [ ] Task ${carrier}`);
    expect(spanText(parsed, 'task-id')).toEqual([carrier]);
    expect(parsed.markdownTitle).toBe('Task');
    expect(parsed.original).toContain(id);
    expectLosslessPartition(parsed);
  });

  it.each([
    '⛔ one',
    '⛔ one,two',
    '⛔ one, two',
    '⛔ one ,two',
    '⛔ one , two',
    '⛔️ one_1, two-2',
  ])('recognizes pinned dependency lists in %j', (carrier) => {
    const parsed = parse(`- [ ] Task ${carrier}`);
    expect(spanText(parsed, 'depends-on')).toEqual([carrier]);
    expect(parsed.markdownTitle).toBe('Task');
    expectLosslessPartition(parsed);
  });

  it('recognizes adjacent metadata only when separated by whitespace', () => {
    const parsed = parse('- [ ] Task 🆔 id-1 📅 2026-07-20 ⛔ prep,next ✅ 2026-07-21');
    expect(spanText(parsed, 'task-id')).toEqual(['🆔 id-1']);
    expect(spanText(parsed, 'depends-on')).toEqual(['⛔ prep,next']);
    expect(parsed.planning).toMatchObject({ due: '2026-07-20', completion: '2026-07-21' });
    expectLosslessPartition(parsed);
  });

  it.each(['🆔 id!', '🆔 id.dot', '🆔 id/next', '⛔ one,two!', '⛔ one,,two', '⛔ one,two/three'])(
    'rejects partial ID/dependency matches with adjacent invalid characters in %j',
    (carrier) => {
      const parsed = parse(`- [ ] Task ${carrier}`);
      expect(parsed.occurrences.get('task-id') ?? []).toHaveLength(0);
      expect(parsed.occurrences.get('depends-on') ?? []).toHaveLength(0);
      expect(parsed.markdownTitle).toContain(carrier);
      expect(spanText(parsed, 'unknown').join('')).toContain(carrier.split(' ')[0]);
      expectLosslessPartition(parsed);
    },
  );

  it('retains malformed recognized-looking values and unknown emoji in the semantic title', () => {
    const source =
      '- [ ] Keep 🧭 north 📅 not-a-date ⏰ 9:5 ⏱️ nope ➕ 2026-7-1 🆔 bad.value ^bad/value';
    const parsed = parse(source);

    expect(parsed.planning).toEqual({});
    expect(parsed.markdownTitle).toBe(
      'Keep 🧭 north 📅 not-a-date ⏰ 9:5 ⏱️ nope ➕ 2026-7-1 🆔 bad.value ^bad/value',
    );
    expect(spanText(parsed, 'unknown').length).toBeGreaterThan(0);
    expectLosslessPartition(parsed);
  });

  it('recognizes only a terminal Obsidian block ID', () => {
    const parsed = parse('- [ ] Mention ^middle in title ^terminal');
    expect(spanText(parsed, 'block-id')).toEqual(['^terminal']);
    expect(parsed.markdownTitle).toBe('Mention ^middle in title');
    expectLosslessPartition(parsed);
  });

  it('does not recognize a terminal caret token without the required whitespace boundary', () => {
    const parsed = parse('- [ ] Keep title^not-a-block');
    expect(spanText(parsed, 'block-id')).toEqual([]);
    expect(parsed.markdownTitle).toBe('Keep title^not-a-block');
    expectLosslessPartition(parsed);
  });

  it('parses shuffled suffix tokens from right to left without reordering source', () => {
    const source = '- [ ] Task 📅 2026-07-20 🔁 every week ⏫ ⏰ 14:30';
    const parsed = parse(source);

    expect(parsed.markdownTitle).toBe('Task');
    expect(parsed.recurrence).toBe('every week');
    expect(parsed.priority).toBe('B');
    expect(parsed.planning).toMatchObject({ due: '2026-07-20', time: '14:30' });
    expectLosslessPartition(parsed);
  });

  it('returns null for non-task source', () => {
    expect(codec.parseLine('> [!todo] Callout header', location)).toBeNull();
    expect(codec.parseLine('- plain bullet', location)).toBeNull();
  });

  it('uses the injected status catalog without requiring configured symbols to parse', () => {
    expect(codec.statusForSymbol('/')).toBe('in-progress');
    expect(codec.statusForSymbol('X')).toBe('done');
    expect(codec.statusForSymbol('?')).toBe('open');
    expect(parse('- [?] Unknown but compatible').statusSymbol).toBe('?');
  });
});
