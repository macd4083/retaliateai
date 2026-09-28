import { describe, expect, it } from 'vitest';

import { buildCommitmentFragments, splitCommitmentIntoTasks } from '../lib/commitmentFragments';

describe('commitmentFragments', () => {
  it('splits a sentence into multiple measured tasks', () => {
    expect(splitCommitmentIntoTasks('Write 20 minutes, and review notes; then send summary.')).toEqual([
      'Write 20 minutes',
      'review notes',
      'then send summary',
    ]);
  });

  it('builds typed fragments from minimum/stretch fields', () => {
    expect(
      buildCommitmentFragments({
        tomorrowCommitment: 'Fallback only',
        commitmentMinimum: 'Read chapter 1 and outline key points',
        commitmentStretch: 'Run 20 minutes',
      })
    ).toEqual([
      { commitment_text: 'Read chapter 1', fragment_index: 0, commitment_type: 'minimum' },
      { commitment_text: 'outline key points', fragment_index: 1, commitment_type: 'minimum' },
      { commitment_text: 'Run 20 minutes', fragment_index: 2, commitment_type: 'stretch' },
    ]);
  });

  it('falls back to tomorrow commitment when minimum/stretch are empty', () => {
    expect(
      buildCommitmentFragments({
        tomorrowCommitment: 'Walk 30 minutes and prep lunch',
        commitmentMinimum: '',
        commitmentStretch: '',
      })
    ).toEqual([
      { commitment_text: 'Walk 30 minutes', fragment_index: 0, commitment_type: null },
      { commitment_text: 'prep lunch', fragment_index: 1, commitment_type: null },
    ]);
  });
});
