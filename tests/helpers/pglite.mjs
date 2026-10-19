import { PGlite } from '@electric-sql/pglite';

export async function postgresPool() {
  const db=await PGlite.create();
  let tail=Promise.resolve();
  async function query(sql,args) {
    if(!args && sql.includes(';')) {
      const results=await db.exec(sql);
      const result=results.at(-1);
      return {...result,rowCount:result?.affectedRows || 0};
    }
    const result=await db.query(sql,args);
    return {...result,rowCount:result.affectedRows || 0};
  }
  const pool={query,async connect(){
    const previous=tail;
    let unlock;
    tail=new Promise(resolve=>{unlock=resolve;});
    await previous;
    let released=false;
    return {query,release(){if(!released){released=true;unlock();}}};
  },end:()=>db.close()};
  return {db,pool};
}
