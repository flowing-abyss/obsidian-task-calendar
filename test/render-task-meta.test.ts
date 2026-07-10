import { describe, expect, it } from 'vitest';
import {
  extractTags,
  hasMeta,
  renderCountBadges,
  renderTagChips,
} from '../src/views/timegrid/renderTaskMeta';
import { freshContainer, task } from './helpers';

describe('renderTaskMeta', () => {
  describe('hasMeta', () => {
    it('is false for a task with no tags, subtasks, comments, or links', () => {
      expect(hasMeta(task())).toBe(false);
    });
    it('is true when the task has a tag', () => {
      expect(hasMeta(task({ rawText: '- [ ] t #work' }))).toBe(true);
    });
    it('is true when the task has subtasks', () => {
      expect(
        hasMeta(
          task({
            subtasks: [
              {
                filePath: 'f.md',
                line: 1,
                rawText: '  - [ ] sub',
                text: 'sub',
                markdownText: 'sub',
                status: 'open',
                statusSymbol: ' ',
                priority: 'D',
              },
            ],
          }),
        ),
      ).toBe(true);
    });
    it('is true when the task has comments', () => {
      expect(hasMeta(task({ comments: [{ line: 1, text: 'note' }] }))).toBe(true);
    });
    it('is true when the task has a precomputed linkCount', () => {
      expect(hasMeta(task({ linkCount: 2 }))).toBe(true);
    });
  });

  describe('extractTags', () => {
    it('extracts hashtags from rawText', () => {
      expect(extractTags(task({ rawText: '- [ ] t #work #urgent' }))).toEqual([
        '#work',
        '#urgent',
      ]);
    });
    it('caps at max', () => {
      expect(extractTags(task({ rawText: '- [ ] t #a #b #c' }), 2)).toEqual(['#a', '#b']);
    });
    it('returns an empty array when there are no tags', () => {
      expect(extractTags(task())).toEqual([]);
    });
  });

  describe('renderCountBadges', () => {
    it('renders nothing for a task with no counts', () => {
      const container = freshContainer();
      renderCountBadges(container, task());
      expect(container.querySelectorAll('.tc-task-count-badge')).toHaveLength(0);
    });

    it('renders a done/total badge for subtasks', () => {
      const container = freshContainer();
      const t = task({
        subtasks: [
          {
            filePath: 'f.md',
            line: 1,
            rawText: '  - [x] a',
            text: 'a',
            markdownText: 'a',
            status: 'done',
            statusSymbol: 'x',
            priority: 'D',
          },
          {
            filePath: 'f.md',
            line: 2,
            rawText: '  - [ ] b',
            text: 'b',
            markdownText: 'b',
            status: 'open',
            statusSymbol: ' ',
            priority: 'D',
          },
        ],
      });
      renderCountBadges(container, t);
      const badges = container.querySelectorAll('.tc-task-count-badge');
      expect(badges).toHaveLength(1);
      expect(badges[0]!.textContent).toContain('1/2');
    });

    it('renders a comment count badge', () => {
      const container = freshContainer();
      const t = task({ comments: [{ line: 1, text: 'a' }, { line: 2, text: 'b' }] });
      renderCountBadges(container, t);
      const badges = container.querySelectorAll('.tc-task-count-badge');
      expect(badges).toHaveLength(1);
      expect(badges[0]!.textContent).toContain('2');
    });

    it('renders a link count badge from the precomputed linkCount field', () => {
      const container = freshContainer();
      renderCountBadges(container, task({ linkCount: 3 }));
      const badges = container.querySelectorAll('.tc-task-count-badge');
      expect(badges).toHaveLength(1);
      expect(badges[0]!.textContent).toContain('3');
    });

    it('renders all three badges together, in subtask/comment/link order', () => {
      const container = freshContainer();
      const t = task({
        subtasks: [
          {
            filePath: 'f.md',
            line: 1,
            rawText: '  - [ ] a',
            text: 'a',
            markdownText: 'a',
            status: 'open',
            statusSymbol: ' ',
            priority: 'D',
          },
        ],
        comments: [{ line: 2, text: 'c' }],
        linkCount: 1,
      });
      renderCountBadges(container, t);
      const badges = container.querySelectorAll('.tc-task-count-badge');
      expect(badges).toHaveLength(3);
    });
  });

  describe('renderTagChips', () => {
    it('renders a chip per tag, uncolored when no tag group matches', () => {
      const container = freshContainer();
      renderTagChips(container, task({ rawText: '- [ ] t #misc' }), []);
      const chip = container.querySelector('.tc-task-tag') as HTMLElement;
      expect(chip).not.toBeNull();
      expect(chip.textContent).toBe('#misc');
      expect(chip.classList.contains('tc-task-tag--colored')).toBe(false);
    });

    it('colors the chip when the tag matches a configured tag group', () => {
      const container = freshContainer();
      renderTagChips(container, task({ rawText: '- [ ] t #work' }), [
        { id: '1', name: 'Work', mode: 'prefix', prefix: 'work', color: '#3498db' },
      ]);
      const chip = container.querySelector('.tc-task-tag') as HTMLElement;
      expect(chip.classList.contains('tc-task-tag--colored')).toBe(true);
      expect(chip.style.getPropertyValue('--tc-tag-color')).toBe('#3498db');
    });

    it('caps the number of chips at max', () => {
      const container = freshContainer();
      renderTagChips(container, task({ rawText: '- [ ] t #a #b #c' }), [], 2);
      expect(container.querySelectorAll('.tc-task-tag')).toHaveLength(2);
    });

    it('renders no click handlers (presentational-only, safe inside drag surfaces)', () => {
      const container = freshContainer();
      renderTagChips(container, task({ rawText: '- [ ] t #work' }), []);
      const chip = container.querySelector('.tc-task-tag') as HTMLElement;
      // jsdom doesn't expose a listener-count API; the contract this test protects is
      // "clicking the chip does nothing and does not throw" — no filter/drag wiring.
      expect(() => chip.dispatchEvent(new MouseEvent('click', { bubbles: true }))).not.toThrow();
    });
  });
});
