/**
 * Whose turn it is to be counted.
 *
 * Cameras took strict turns: one look each, round and round. That is right for
 * cameras watching a room, where the number changes slowly and a second either
 * way means nothing. It is wrong for a camera on a doorway, which is the one
 * place where everything happens in under a second — and with two cameras
 * sharing the computer, the door was getting a look about once a second while
 * people walked through it in less than that.
 *
 * A person has to be seen twice to be counted at all, because being seen twice
 * is the only way to know which way they were walking. So a door camera that
 * looks once a second counts the slow walkers and misses everybody else.
 *
 * So a doorway camera gets a turn between every room camera, and one more at
 * the end of the round: with one room camera it looks twice as often, with two
 * rooms three times as often. The room cameras lose a little — a room's number
 * is a slow thing and can wait half a second — and the doorway, where the
 * speed actually matters, gains it.
 */

export interface Turn {
  key: string;
  /** Watching a doorway, rather than a room. */
  isDoor: boolean;
}

export function countOrder<T extends Turn>(cams: T[]): T[] {
  const doors = cams.filter((c) => c.isDoor);
  const rooms = cams.filter((c) => !c.isDoor);
  // Nothing to balance: every camera is already getting every turn.
  if (!doors.length || !rooms.length) return cams;
  const out: T[] = [];
  for (const r of rooms) { out.push(...doors, r); }
  out.push(...doors);
  return out;
}
