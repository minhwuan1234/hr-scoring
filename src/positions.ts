export type Band = [number,number,string];
export interface Criterion { id:string; title:string; max:number; bands:Band[]; examples:{band:number;cap:number;statement:string}[] }
export interface PositionTemplate { id:string; version:number; name:string; description:string; generalRules:string; rubric:Criterion[] }
export type PositionDraft = Omit<PositionTemplate,'id'|'version'> & {version?:number};
export const positionKey=(p:Pick<PositionTemplate,'id'|'version'>)=>`${p.id}:v${p.version}`;
