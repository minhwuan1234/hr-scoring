import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const missing=()=>Object.assign(new Error('The original CV is unavailable. Upload and score this PDF again.'),{status:404});
export function validatePdf(bytes){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>20*1024*1024)throw Object.assign(new Error('Choose a non-empty PDF up to 20 MB.'),{status:413});
 if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw Object.assign(new Error('The uploaded file must be a PDF.'),{status:415});
}
export function createCvFiles({pool,directory,initialize,update}){
 function path(scope,id){if(!/^[a-zA-Z0-9_-]+$/.test(scope)||!/^[a-zA-Z0-9_-]+$/.test(id))throw missing();return resolve(directory,'cvs',scope,`${id}.pdf`);}
 async function save(scope,id,bytes){
  validatePdf(bytes);
  if(!pool)return update(scope,async state=>{const c=state.candidates?.[id];if(!c)throw missing();const file=path(scope,id);await mkdir(resolve(file,'..'),{recursive:true,mode:0o700});try{await writeFile(file,bytes,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}c.cvAvailable=true;});
  await initialize();const client=await pool.connect();
  try{
   await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[scope]);
   const {rows}=await client.query('SELECT job_id FROM hr_scoring_candidates WHERE workspace_id=$1 AND job_id=$2 FOR UPDATE',[scope,id]);if(!rows.length)throw missing();
   await client.query('INSERT INTO hr_scoring_candidate_files(workspace_id,job_id,pdf) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[scope,id,bytes]);
   await client.query('UPDATE hr_scoring_candidates SET cv_available=TRUE WHERE workspace_id=$1 AND job_id=$2',[scope,id]);await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
 async function get(scope,id){
  if(!pool){const candidate=await update(scope,s=>s.candidates?.[id]);if(!candidate?.cvAvailable)throw missing();try{return {bytes:await readFile(path(scope,id)),fileName:candidate.fileName};}catch(error){if(error.code==='ENOENT')throw missing();throw error;}}
  await initialize();const {rows}=await pool.query('SELECT f.pdf,c.file_name FROM hr_scoring_candidate_files f JOIN hr_scoring_candidates c USING(workspace_id,job_id) WHERE f.workspace_id=$1 AND f.job_id=$2',[scope,id]);if(!rows.length)throw missing();return {bytes:Buffer.from(rows[0].pdf),fileName:rows[0].file_name};
 }
 return {save,get};
}
