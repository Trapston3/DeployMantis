// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function detectSystemicFailure(frames: any[]): boolean {
  if (!frames || frames.length < 3) return false;

  let consecutiveChaos = 0;

  // Assuming frames are ordered chronologically or reverse-chronologically,
  // we just need to find a window of 3 consecutive chaos events.
  for (const frame of frames) {
    const isChaos =
      frame.statusCode === 502 ||
      frame.statusCode === 529 ||
      frame.message?.includes("Chaos");

    if (isChaos) {
      consecutiveChaos++;
      if (consecutiveChaos >= 3) {
        return true;
      }
    } else {
      consecutiveChaos = 0;
    }
  }

  return false;
}
