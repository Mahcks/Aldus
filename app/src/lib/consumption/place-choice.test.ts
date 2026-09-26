import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../../app/(app)/consume/[id].tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile(
  'consume.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const names = new Set(['confirmPlace', 'onInteractiveReaderLocation', 'leaveScreen']);
const declarations: string[] = [];
function visit(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text))
    declarations.push(node.getText(file));
  ts.forEachChild(node, visit);
}
visit(file);
const compiled = new Bun.Transpiler({ loader: 'ts' }).transformSync(declarations.join('\n'));

for (const fails of [false, true]) {
  test(`saved-place choice blocks live callbacks until delayed ${fails ? 'failure' : 'success'}`, async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const choiceInFlight = { current: false };
    const locations: string[] = [];
    const busy: boolean[] = [];
    const notices: string[] = [];
    let saves = 0;
    let exits = 0;
    const context = {
      choiceInFlight,
      chosenPlace: 'this-device',
      session: {
        mayWrite: true,
        checkOwnership: async () => true,
        backToBook: () => {
          exits++;
        },
      },
      progressConflict: {},
      editionConflict: undefined,
      setChoiceBusy: (value: boolean) => busy.push(value),
      setNotice: (value: string) => notices.push(value),
      keepLocalReadingPlace: async () => {
        saves++;
        await pending;
        if (fails) throw new Error('restore failed');
      },
      onReaderLocation: (location: { reason: string }) => locations.push(location.reason),
      leaveReader: () => {
        throw new Error('Back started an unwanted old-page save');
      },
      errorMessage: (error: Error) => error.message,
    };
    const actions = new Function(
      ...Object.keys(context),
      `${compiled}; return { confirmPlace, onInteractiveReaderLocation, leaveScreen };`,
    )(...Object.values(context));
    const choosing = actions.confirmPlace();
    expect(choiceInFlight.current).toBe(true);
    await actions.confirmPlace();
    actions.onInteractiveReaderLocation({ reason: 'explicit' });
    actions.onInteractiveReaderLocation({ reason: 'relocate' });
    actions.onInteractiveReaderLocation({ reason: 'restore' });
    actions.leaveScreen();
    expect(locations).toEqual(['restore']);
    expect(exits).toBe(1);
    expect(saves).toBe(1);
    expect(busy).toEqual([true]);
    finish();
    await choosing;
    expect(choiceInFlight.current).toBe(false);
    expect(busy).toEqual([true, false]);
    actions.onInteractiveReaderLocation({ reason: 'explicit' });
    expect(locations).toEqual(['restore', 'explicit']);
    expect(notices).toEqual(fails ? ['', 'restore failed'] : ['']);
  });
}
