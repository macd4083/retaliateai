import { describe, expect, it } from 'vitest';

import { buildCommitmentFragmentsFromLegacyFields, splitCommitmentText } from '../lib/commitmentFragments';

describe('commitmentFragments', () => {
  it('splits multi-action legacy commitments on explicit task conjunctions', () => {
    expect(splitCommitmentText('Call three leads and send two follow-ups')).toEqual([
      'Call three leads',
      'send two follow-ups',
    ]);
  });

  it('does not split simple noun conjunctions into separate actions', () => {
    expect(splitCommitmentText('Call Alice and Bob')).toEqual(['Call Alice and Bob']);
  });

  it('extracts minimum/stretch fragments from combined legacy commitment text', () => {
    expect(buildCommitmentFragmentsFromLegacyFields({
      tomorrowCommitment: 'Minimum: Call three leads. Stretch: Send two follow-ups.',
      commitmentMinimum: null,
      commitmentStretch: null,
    })).toEqual([
      { text: 'Call three leads', type: 'minimum' },
      { text: 'Send two follow-ups', type: 'stretch' },
    ]);
  });
});
