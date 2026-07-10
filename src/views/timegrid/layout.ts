import type { Task } from '../../parser/types';

export const PIXELS_PER_HOUR = 48;

export interface TimedBlockInput {
  task: Task;
  startMinutes: number;
  durationMinutes: number;
}

export interface PositionedBlock extends TimedBlockInput {
  column: number;
  columns: number;
}

export function minutesToPixels(minutes: number): number {
  return (minutes / 60) * PIXELS_PER_HOUR;
}

export function timeStringToMinutes(time: string): number {
  const [h, m] = time.split(':').map((n) => parseInt(n, 10));
  return (h ?? 0) * 60 + (m ?? 0);
}

export function minutesToTimeString(minutes: number): string {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0');
  const m = (minutes % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

export function snapMinutes(rawMinutes: number, stepMinutes: number): number {
  const result = Math.round(rawMinutes / stepMinutes) * stepMinutes;
  return result === 0 ? 0 : result;
}

/**
 * Google-Calendar-style column packing for overlapping time-grid events: sort
 * by start time, assign each block the lowest-numbered column whose previous
 * occupant has already ended, then set `columns` to the max column index + 1
 * within each maximal overlapping cluster.
 */
export function packOverlaps(blocks: TimedBlockInput[]): PositionedBlock[] {
  const sorted = [...blocks].sort((a, b) => a.startMinutes - b.startMinutes);
  const positioned: PositionedBlock[] = [];
  let columnEnds: number[] = [];
  let cluster: PositionedBlock[] = [];
  let clusterEnd = -Infinity;

  const closeCluster = (): void => {
    if (!cluster.length) return;
    const columnsUsed = Math.max(...cluster.map((b) => b.column)) + 1;
    for (const b of cluster) b.columns = columnsUsed;
    cluster = [];
    columnEnds = [];
    clusterEnd = -Infinity;
  };

  for (const block of sorted) {
    const end = block.startMinutes + block.durationMinutes;
    if (block.startMinutes >= clusterEnd) closeCluster();

    let col = columnEnds.findIndex((colEnd) => colEnd <= block.startMinutes);
    if (col === -1) {
      col = columnEnds.length;
      columnEnds.push(end);
    } else {
      columnEnds[col] = end;
    }

    const positionedBlock: PositionedBlock = { ...block, column: col, columns: 0 };
    cluster.push(positionedBlock);
    positioned.push(positionedBlock);
    clusterEnd = Math.max(clusterEnd, end);
  }
  closeCluster();

  return positioned;
}
