// Other positions remain in single-recipient testing mode.
export const LARK_RECIPIENTS=Object.freeze(['ou_f77cf794a1319628941dd689ecc97e32']);
export const SOCIAL_MEDIA_RECIPIENTS=Object.freeze([
 'ou_f77cf794a1319628941dd689ecc97e32',
 'ou_9f7de713af63322b36ee7e41f5731313',
 'ou_34667345f6e162ffccaa0b43f8c75986',
 'ou_70ce15a771b137289d618549406121ad',
]);
export const LARK_OUTBOUND_RECIPIENTS=Object.freeze([...new Set([...LARK_RECIPIENTS,...SOCIAL_MEDIA_RECIPIENTS])]);
export function recipientsForPosition(position){
 const name=String(position.positionName??position.name??'').trim().replace(/\s+/g,' ').toLowerCase();
 return ['social content creator','social media'].includes(name)?SOCIAL_MEDIA_RECIPIENTS:LARK_RECIPIENTS;
}
export const SETUP_CALL_URL='https://cal.com/f-creative-krcb9e/30min';
