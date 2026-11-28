// Removes the "Pacing (Lokala uppladdningar)" copy under "Skapad av dig" at
// https://claude.ai/customize/plugins/yours, the step after each publish.
// Pasted whole (it starts with await) into the Chrome extension's javascript tool on that page; no
// screenshots or coordinates (they timed out and missed in 0.9.44 to 0.9.49).
// Every step checks before it clicks, and stops with nothing clicked when a
// check fails:
//   - the row is under the "Skapad av dig" heading, before "Från din
//     organisation", says "Lokala uppladdningar", and is the only such row;
//   - its menu is the uploads copy's (Stäng av, Dela, Ta bort), never the
//     organisation copy's (Ta bort alone);
//   - the dialog asks "Ta bort pluginet?".
// It returns what it did; afterwards the organisation's row must remain.
await (async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => { for (let t = 0; t < ms; t += 200) { const v = fn(); if (v) return v; await wait(200); } return null; };
  const heading = text => [...document.querySelectorAll('h3')].find(h => h.textContent.trim() === text);
  const own = await until(() => heading('Skapad av dig') || (heading('Från din organisation') && 'none'));
  if (!own) return 'stopped: the page shows neither section';
  if (own === 'none') return 'nothing to remove: no "Skapad av dig" section';
  const org = heading('Från din organisation');
  const before = el => !org || (el.compareDocumentPosition(org) & Node.DOCUMENT_POSITION_FOLLOWING);
  const after = el => own.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
  const rowOf = b => { let r = b; for (let i = 0; i < 8 && r && !/Pacing/.test(r.textContent); i++) r = r.parentElement; return r; };
  const ours = [...document.querySelectorAll('button[aria-label="Fler åtgärder för Pacing"]')]
    .filter(b => after(b) && before(b) && /Lokala uppladdningar/.test(rowOf(b)?.textContent || ''));
  if (ours.length !== 1) return 'stopped: ' + ours.length + ' uploads rows found';
  ours[0].click();
  const items = await until(() => { const m = [...document.querySelectorAll('[role="menuitem"]')]; return m.length ? m : null; }, 3000);
  const names = (items || []).map(i => i.textContent.trim());
  if (!names.includes('Stäng av') || !names.includes('Ta bort')) {
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return 'stopped: the menu was ' + JSON.stringify(names);
  }
  items.find(i => i.textContent.trim() === 'Ta bort').click();
  const dialog = await until(() => [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].find(d => /Ta bort pluginet\?/.test(d.textContent)), 3000);
  if (!dialog) return 'stopped: no "Ta bort pluginet?" dialog';
  const confirm = [...dialog.querySelectorAll('button')].find(b => b.textContent.trim() === 'Ta bort');
  if (!confirm) return 'stopped: the dialog has no Ta bort button';
  confirm.click();
  const gone = await until(() => !heading('Skapad av dig') || ![...document.querySelectorAll('button[aria-label="Fler åtgärder för Pacing"]')].some(b => after(b) && before(b)), 6000);
  const orgLeft = !!heading('Från din organisation') && document.querySelectorAll('button[aria-label="Fler åtgärder för Pacing"]').length >= 1;
  return (gone ? 'removed the uploads copy' : 'clicked Ta bort, but the row is still listed') + (orgLeft ? '; the organisation copy remains' : '; the organisation copy is NOT listed');
})()
