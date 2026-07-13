import { describe, expect, it } from 'vitest';
import { TaskMutationService } from '../src/mutation/TaskMutationService';

describe('legacy TaskMutationService status/priority surface', () => {
  it('does not retain status or priority writers after API migration', () => {
    const prototype = TaskMutationService.prototype as unknown as Record<string, unknown>;
    expect(prototype['toggleCompletion']).toBeUndefined();
    expect(prototype['setStatusChar']).toBeUndefined();
    expect(prototype['setPriority']).toBeUndefined();
  });
});
