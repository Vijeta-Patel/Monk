// A synthetic 22×48 phone screenshot of the demo app (a habit tracker with a snackbar whose UNDO
// button sits under the navigation bar). Only used by demo mode and snapshots.
export const PHONE_W = 22;
export const PHONE_H = 48;

export function demoPhoneFrame(opts: { snackbar: boolean } = { snackbar: true }): { w: number; h: number; px: string[] } {
  const px: string[] = [];
  for (let y = 0; y < PHONE_H; y++) {
    for (let x = 0; x < PHONE_W; x++) {
      let c = '#F4F1EA';
      if (y < 3) c = '#1E2A30';
      else if (y < 8) c = x > 1 && x < 12 && y === 5 ? '#FFFFFF' : '#2E7D6B';
      else if (y < 38) {
        const row = Math.floor((y - 9) / 6);
        const inCard = (y - 9) % 6 < 5 && x > 0 && x < 21 && row < 5;
        if (inCard) {
          c = '#FFFFFF';
          if ((y - 9) % 6 === 2 && x > 2 && x < 14) c = '#3B3F42';
          if ((y - 9) % 6 === 2 && x > 16 && x < 19) c = row === 1 ? '#F2A541' : '#43B38A';
        }
      } else if (y < 44 && opts.snackbar) {
        c = y === 38 ? '#F4F1EA' : '#303437';
        if (y > 39 && y < 42 && x > 1 && x < 13) c = '#E8E4DA';
        if (y > 39 && y < 42 && x > 15 && x < 20) c = '#F2A541';
      }
      if (y >= 42) c = '#050505';
      if (y === 45 && x > 7 && x < 14) c = '#9AA0A4';
      px.push(c);
    }
  }
  return { w: PHONE_W, h: PHONE_H, px };
}
