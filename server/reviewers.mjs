export const LARK_REVIEWERS=Object.freeze({
 'ou_f77cf794a1319628941dd689ecc97e32':'Minh Quân',
 'ou_9f7de713af63322b36ee7e41f5731313':'Trang Liu',
 'ou_4eb96bd84a22b6511fcb316d35ded621':'Quỳnh Chi',
 'ou_34667345f6e162ffccaa0b43f8c75986':'Linh Giang',
 'ou_70ce15a771b137289d618549406121ad':'Annie',
 'ou_ba8c57cac81d5504103a9ba941d5b179':'Phương Anh',
});
export function reviewerName(id){return Object.hasOwn(LARK_REVIEWERS,id)?LARK_REVIEWERS[id]:undefined;}
export function decisionCounts(candidate){const values=Object.values(candidate.reviewerDecisions||{});return {accept:values.filter(d=>d.decision==='accept').length,reject:values.filter(d=>d.decision==='denied').length};}
