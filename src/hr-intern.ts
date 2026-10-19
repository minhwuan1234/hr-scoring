export const HR_INTERN_POSITION = 'Talent Acquisition & Employer Branding Intern';

export const HR_INTERN_DIMENSIONS = [
  { id: 'learning-drive', title: 'Learning drive & practical application', max: 30 },
  { id: 'learning-agility', title: 'Learning agility', max: 20 },
  { id: 'commitment', title: 'Long-term commitment & direction', max: 20 },
  { id: 'hiring', title: 'Recruitment support & hiring coordination', max: 8 },
  { id: 'execution', title: 'Data, trackers, records & careful execution', max: 7 },
  { id: 'employer-branding', title: 'Employer branding & content execution', max: 5 },
  { id: 'process', title: 'Process discipline, checklists & follow-through', max: 4 },
  { id: 'direction', title: 'Academic background & interest in talent / culture', max: 3 },
  { id: 'tools', title: 'Foundational tools, English & AI', max: 3 },
] as const;

export const HR_INTERN_BANDS: Record<string, [number,number][]> = {
  'learning-drive': [[0,9],[10,20],[21,30]],
  'learning-agility': [[0,6],[7,13],[14,20]],
  commitment: [[0,6],[7,13],[14,20]], hiring:[[0,2],[3,5],[6,8]],
  execution:[[0,2],[3,5],[6,7]], 'employer-branding':[[0,1],[2,3],[4,5]],
  process:[[0,1],[2,3],[4,4]], direction:[[0,0],[1,2],[3,3]], tools:[[0,0],[1,2],[3,3]],
};

// A full source sentence belongs to one dimension and is scored once.
export const SENTENCE_RULES = {
  uniqueWithinCv: true,
  maxDimensionsPerSentence: 1,
  requireHumanApproval: true,
} as const;
