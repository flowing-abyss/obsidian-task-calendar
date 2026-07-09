import { describe, expect, it } from 'vitest';
import { insertTaskBlockIntoContent } from '../src/mutation/insertTaskBlock';

describe('insertTaskBlockIntoContent', () => {
  it('appends the block at the end in append mode', () => {
    const out = insertTaskBlockIntoContent('# Note\n\nbody', '- [ ] task', 'append', '## Tasks');
    expect(out).toBe('# Note\n\nbody\n- [ ] task\n');
  });

  it('inserts the block right after the section heading in section mode', () => {
    const content = '# Note\n## Tasks\n- [ ] existing\n## Notes\nblah';
    const out = insertTaskBlockIntoContent(content, '- [ ] task', 'section', '## Tasks');
    expect(out).toBe('# Note\n## Tasks\n- [ ] task\n- [ ] existing\n## Notes\nblah');
  });

  it('creates the section at the end when it is missing', () => {
    const out = insertTaskBlockIntoContent('# Note\nbody', '- [ ] task', 'section', '## Tasks');
    expect(out).toBe('# Note\nbody\n\n## Tasks\n- [ ] task\n');
  });

  it('falls back to append when section mode has a blank section name', () => {
    const out = insertTaskBlockIntoContent('body', '- [ ] task', 'section', '   ');
    expect(out).toBe('body\n- [ ] task\n');
  });

  it('keeps a multi-line block (task + sub-items) contiguous in section mode', () => {
    const block = '- [ ] parent\n\t- [ ] child';
    const content = '## Tasks\nexisting';
    const out = insertTaskBlockIntoContent(content, block, 'section', '## Tasks');
    expect(out).toBe('## Tasks\n- [ ] parent\n\t- [ ] child\nexisting');
  });
});
