// Typed failures keep invalid model output distinct from application/database bugs.
export class ModelOutputError extends Error {
  constructor(message,code='MODEL_OUTPUT_INVALID') {super(message);this.name='ModelOutputError';this.status=502;this.code=code;}
}
export async function stage(name,operation){
  try{return await operation();}catch(error){error.stage ||= name;throw error;}
}
// Only regenerate output rejected by our validators. Never replay a DB commit.
export async function validatedModelCall(operation){
  for(let attempt=0;attempt<2;attempt++){
    try{return await operation();}catch(error){if(!(error instanceof ModelOutputError)||attempt===1)throw error;}
  }
}
