export const emptyProfile=()=>({name:null,phone:null,email:null,linkedinUrl:null});
const compact=value=>value.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
// The model extracts; these checks only reject invented values and unsafe links.
export function validateProfile(value,cvText){
 if(value==null)return emptyProfile();
 if(typeof value!=='object'||Array.isArray(value))throw Object.assign(new Error('The model returned an invalid candidate profile. Please retry.'),{status:502});
 const result=emptyProfile(),source=compact(cvText);
 for(const [field,max] of [['name',200],['phone',60],['email',254],['linkedinUrl',500]]){
  const raw=value[field];if(raw==null||raw==='')continue;
  if(typeof raw!=='string'||raw.length>max||/[\u0000-\u001f]/.test(raw))continue;
  const text=raw.trim();if(!text)continue;
  if(field==='name'){if(source.includes(compact(text)))result.name=text;}
  if(field==='phone'){const digits=text.replace(/\D/g,'');if(digits.length>=7&&digits.length<=15&&/^[+\d\s()./-]+$/.test(text)&&cvText.replace(/\D/g,'').includes(digits))result.phone=text;}
  if(field==='email'){if(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(text)&&source.includes(compact(text)))result.email=text;}
  if(field==='linkedinUrl'){
   try{const url=new URL(/^https?:\/\//i.test(text)?text:`https://${text}`);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port||!['linkedin.com','www.linkedin.com'].includes(url.hostname.toLowerCase())||!/^\/(in|pub)\/[^/]+/i.test(url.pathname))continue;
    const path=`linkedin.com${url.pathname}`.replace(/\/$/,'');if(!source.includes(compact(path)))continue;
    result.linkedinUrl=`https://www.linkedin.com${url.pathname}`;
   }catch{/* Missing or malformed links remain empty. */}
  }
 }
 return result;
}
