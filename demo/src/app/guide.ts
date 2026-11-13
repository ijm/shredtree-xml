// Suggestions: a tip that flashes over a control to show what to try. Each one is shown
// at most once per loading of the demo, when its scenario loads or after a given action;
// nothing waits for the user to follow it. To add a sequence, add entries here.

/** Something the user did: shredded, built or locked the node a step names, or toggled
 * a key in the keyring. */
export interface Did {
  do: "shred" | "build" | "lock" | "key";
  at: string;  // the step's name, or the key's
}

/** A control on a step's node a tip can point at. */
export type Control = "shred" | "build" | "lock";

export interface Suggestion {
  scenario: string;  // the entry's name in boot.ts: "example-pipeline" is its autostart one
  when?: Did;        // after this; without it, when the scenario loads
  at: string;        // the step whose node the control is on
  control: Control;
  text: string;
}

export const SUGGESTIONS: Suggestion[] = [
  { scenario: "example-pipeline", at: "count", control: "shred", text: "try shredding this node" },
  { scenario: "example-pipeline", when: { do: "shred", at: "count" },
    at: "count", control: "build", text: "now try rebuilding it" },
];

/** The suggestion for `scenario` after `did` (undefined: on loading) that hasn't been
 * shown yet, marking it shown. */
export function suggest(scenario: string, did: Did | undefined, shown: Set<Suggestion>): Suggestion | undefined {
  const next = SUGGESTIONS.find((s) => s.scenario === scenario && !shown.has(s)
    && (s.when === undefined ? did === undefined : did !== undefined && s.when.do === did.do && s.when.at === did.at));
  if (next !== undefined) shown.add(next);
  return next;
}
