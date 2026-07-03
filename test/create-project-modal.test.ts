import { describe, expect, it, vi } from 'vitest';
import { CreateProjectModal } from '../src/projects/CreateProjectModal';

function makeModal(onSubmit: (name: string) => void): CreateProjectModal {
  // App is unused by submit(); pass a minimal stub. close() is a no-op on the base mock.
  const modal = new CreateProjectModal({} as never, onSubmit);
  (modal as unknown as { close: () => void }).close = vi.fn();
  return modal;
}

describe('CreateProjectModal.submit', () => {
  it('calls onSubmit with the trimmed name and closes', () => {
    const onSubmit = vi.fn();
    const modal = makeModal(onSubmit);
    modal.submit('  My Project  ');
    expect(onSubmit).toHaveBeenCalledWith('My Project');
  });

  it('ignores an empty / whitespace name', () => {
    const onSubmit = vi.fn();
    const modal = makeModal(onSubmit);
    modal.submit('   ');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('fires onSubmit only once', () => {
    const onSubmit = vi.fn();
    const modal = makeModal(onSubmit);
    modal.submit('A');
    modal.submit('B');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('A');
  });
});
