import type {ScoreResult} from './scoring-api';

// Wait for human review before continuing automatically with the next CV.
// Individual PDF or request failures do not stop the remaining queue.
export async function scoreCvBatch<T>(queue:readonly T[],options:{
  isActive:()=>boolean;
  score:(candidate:T)=>Promise<ScoreResult|undefined>;
  onReview:(candidate:T)=>Promise<void>;
  onError:(candidate:T,error:unknown)=>void;
}):Promise<void>{
  for(const candidate of queue){
    if(!options.isActive())break;
    try{
      const result=await options.score(candidate);
      if(result?.state==='review')await options.onReview(candidate);
    }catch(error){options.onError(candidate,error);}
  }
}
