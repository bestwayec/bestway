import { describe, expect, it } from 'vitest';
import { needsProgramSelection, programGate } from './program-gate';

describe('student program gate', () => {
  it('shows the self-select onboarding state when no track is active', () => {
    expect(programGate({ signedIn: true, student: true, loaded: true, program: null, accessPolicy: 'SELF_SELECT' })).toBe('needs-self-select');
    expect(needsProgramSelection(programGate({ signedIn: true, student: true, loaded: true, program: null, accessPolicy: 'SELF_SELECT' }))).toBe(true);
  });

  it('shows the staff-assigned onboarding state when the center owns the track', () => {
    expect(programGate({ signedIn: true, student: true, loaded: true, program: null, accessPolicy: 'STAFF_ASSIGNED' })).toBe('needs-staff-assigned');
  });

  it('defaults to self-select onboarding when the policy is unknown or absent', () => {
    expect(programGate({ signedIn: true, student: true, loaded: true, program: null })).toBe('needs-self-select');
  });

  it('never exposes a mixed catalogue: a null track is not "ready"', () => {
    expect(programGate({ signedIn: true, student: true, loaded: true, program: null })).not.toBe('ready');
  });

  it('renders catalogues only for a loaded, active student track', () => {
    expect(programGate({ signedIn: true, student: true, loaded: true, program: 'IELTS', accessPolicy: 'SELF_SELECT' })).toBe('ready');
    expect(programGate({ signedIn: true, student: true, loaded: true, program: 'MULTILEVEL', accessPolicy: 'STAFF_ASSIGNED' })).toBe('ready');
  });

  it('stays in a loading state while the session or program state resolves', () => {
    expect(programGate({ signedIn: false, student: true, loaded: false })).toBe('loading');
    expect(programGate({ signedIn: true, student: true, loaded: false, program: 'IELTS' })).toBe('loading');
    expect(programGate({ signedIn: true, student: true, loaded: true, program: 'IELTS', switching: true })).toBe('loading');
  });

  it('does not gate staff and non-student roles', () => {
    expect(programGate({ signedIn: true, student: false, loaded: true, program: null })).toBe('not-student');
    expect(needsProgramSelection('not-student')).toBe(false);
  });
});
