import { isWatchAppNotInstalledError } from '../../src/hooks/useWatchCheckInBridge';

// The classifier alone: it decides whether a failed context push is ordinary
// (a paired watch with no app, which is permanent and re-logs on every push)
// or something worth a warning. The push itself needs the native module and a
// rendered bridge, so only the rule is pinned here.
describe('isWatchAppNotInstalledError', () => {
  it('recognizes the error as ExpoModulesCore actually delivers it', () => {
    // Verbatim from a device log: the WCError code does not survive the wrap,
    // so this string is the whole signal.
    expect(
      isWatchAppNotInstalledError(
        'Error: UnexpectedException: Watch app is not installed. (at ExpoModulesCore/AsyncFunctionDefinition.swift:126)'
      )
    ).toBe(true);
  });

  it('ignores case, since the wording comes from the OS', () => {
    expect(isWatchAppNotInstalledError('WATCH APP IS NOT INSTALLED.')).toBe(
      true
    );
  });

  it('treats every other failure as unrecognized', () => {
    // The safe direction: an unmatched message keeps its WARNING rather than
    // being silently demoted to DEBUG.
    expect(
      isWatchAppNotInstalledError('Error: WCSession is not activated')
    ).toBe(false);
    expect(isWatchAppNotInstalledError('Error: payload too large')).toBe(false);
    expect(isWatchAppNotInstalledError('')).toBe(false);
  });
});
