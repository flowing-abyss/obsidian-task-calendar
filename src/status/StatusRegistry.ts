import type { TaskStatus } from '../parser/types';
import type { TaskStatusDef, TaskStatusType } from '../settings/types';

const TYPE_ORDER: TaskStatusType[] = ['todo', 'in-progress', 'done', 'cancelled'];

export class StatusRegistry {
  static readonly TYPE_TO_STATUS: Record<TaskStatusType, TaskStatus> = {
    todo: 'open',
    'in-progress': 'in-progress',
    done: 'done',
    cancelled: 'cancelled',
  };

  private readonly defs: TaskStatusDef[];
  private readonly bySymbolMap: Map<string, TaskStatusDef>;
  private readonly orderMap: Map<string, number>;

  constructor(defs: TaskStatusDef[]) {
    this.defs = defs;
    this.bySymbolMap = new Map();
    this.orderMap = new Map();
    defs.forEach((d, i) => {
      // first occurrence of a symbol wins (defensive against dupes)
      if (!this.bySymbolMap.has(d.symbol)) this.bySymbolMap.set(d.symbol, d);
      if (!this.orderMap.has(d.symbol)) this.orderMap.set(d.symbol, i);
    });
  }

  bySymbol(char: string): TaskStatusDef | undefined {
    return this.bySymbolMap.get(char);
  }

  typeForSymbol(char: string): TaskStatus {
    // 'X' (uppercase) is a common alternate "done" glyph in the Tasks-plugin
    // ecosystem; the registry only knows the canonical lowercase 'x', so fold
    // case for the lookup. Callers keep the raw glyph in statusSymbol.
    const lookup = char === 'X' ? 'x' : char;
    const def = this.bySymbolMap.get(lookup);
    return def ? StatusRegistry.TYPE_TO_STATUS[def.type] : 'open';
  }

  byType(type: TaskStatusType): TaskStatusDef[] {
    return this.defs.filter((d) => d.type === type);
  }

  grouped(): Array<{ type: TaskStatusType; statuses: TaskStatusDef[] }> {
    return TYPE_ORDER.map((type) => ({ type, statuses: this.byType(type) })).filter(
      (g) => g.statuses.length > 0,
    );
  }

  defaultTodo(): TaskStatusDef {
    return (this.byType('todo').find((d) => d.core) ?? this.byType('todo')[0] ?? this.defs[0])!;
  }

  defaultDone(): TaskStatusDef {
    return (this.byType('done').find((d) => d.core) ?? this.byType('done')[0] ?? this.defs[0])!;
  }

  orderIndex(char: string): number {
    return this.orderMap.get(char) ?? Number.MAX_SAFE_INTEGER;
  }

  all(): TaskStatusDef[] {
    return this.defs;
  }
}
