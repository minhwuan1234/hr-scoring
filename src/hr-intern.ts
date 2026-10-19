export const HR_INTERN_POSITION = 'Talent Acquisition & Employer Branding Intern';

// Sample values exist exclusively to preview the UI, not to evaluate uploaded CVs.
export const HR_INTERN_DIMENSIONS = [
  { id: 'learning-drive', title: 'Learning drive & practical application', max: 30, sample: 23 },
  { id: 'learning-agility', title: 'Learning agility', max: 20, sample: 15 },
  { id: 'commitment', title: 'Long-term commitment & direction', max: 20, sample: 16 },
  { id: 'hiring', title: 'Recruitment support & hiring coordination', max: 8, sample: 6 },
  { id: 'execution', title: 'Data, trackers, records & careful execution', max: 7, sample: 5 },
  { id: 'employer-branding', title: 'Employer branding & content execution', max: 5, sample: 4 },
  { id: 'process', title: 'Process discipline, checklists & follow-through', max: 4, sample: 3 },
  { id: 'direction', title: 'Academic background & interest in talent / culture', max: 3, sample: 2 },
  { id: 'tools', title: 'Foundational tools, English & AI', max: 3, sample: 2 },
] as const;

export const SAMPLE_TOTAL = HR_INTERN_DIMENSIONS.reduce((sum, dimension) => sum + dimension.sample, 0);

// Agreed constraints for the future scoring service. Synonyms remain separate.
export const KEYWORD_RULES = {
  uniqueWithinCv: true,
  maxDimensionsPerExactPhrase: 1,
  mergeSynonyms: false,
  requireHumanApproval: true,
} as const;
