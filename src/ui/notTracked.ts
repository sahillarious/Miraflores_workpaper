/**
 * Readiness steps this demo does not really derive from the workpaper's state. They are listed so
 * the checklist reads like a real one, but they must not look checked: the domain marks two of them
 * done unconditionally and the third can never be done here.
 */
export const NOT_TRACKED: Record<string, string> = {
  engagement: 'The app does not record signatures. The engagement letter and consents (D01, D02) are in the file.',
  carry: 'Carryovers are listed under Prior year & agency. The app does not check them as a step.',
  client: 'Client approval and e-file happen outside this app. The packet’s timeline replays a 2026-07-10 approval as history only.',
};
