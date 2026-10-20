import test from 'node:test';
import assert from 'node:assert/strict';
import {createCvLinks} from '../server/cv-links.mjs';
const scope='a'.repeat(64),env={CV_LINK_SECRET:'synthetic-signing-secret',PUBLIC_APP_URL:'https://example.test'};
const token=url=>new URL(url).pathname.split('/').at(-1);
test('CV links are scoped, survive restart and expire at 30 days',()=>{
 let time=1000000;const links=createCvLinks({env,now:()=>time});const url=links.url(scope,'cv-id');
 assert.equal(new URL(url).origin,'https://example.test');assert.deepEqual(links.verify(token(url)),{scope,id:'cv-id'});
 assert.deepEqual(createCvLinks({env,now:()=>time}).verify(token(url)),{scope,id:'cv-id'});
 time+=30*24*60*60*1000;assert.throws(()=>links.verify(token(url)),e=>e.status===404);
});
test('altered CV, scope or signature cannot authorize access; secret rotation revokes links',()=>{
 const links=createCvLinks({env}),original=token(links.url(scope,'cv-id')),[version,payload,signature]=original.split('.');
 for(const change of [{id:'different-cv'},{scope:'b'.repeat(64)},{exp:9999999999}]){
  const data={...JSON.parse(Buffer.from(payload,'base64url').toString()),...change};
  const edited=`${version}.${Buffer.from(JSON.stringify(data)).toString('base64url')}.${signature}`;
  assert.throws(()=>links.verify(edited),e=>e.status===404);
 }
 const edited=`${version}.${payload}.${signature[0]==='a'?'b':'a'}${signature.slice(1)}`;
 assert.throws(()=>links.verify(edited),e=>e.status===404);
 assert.throws(()=>createCvLinks({env:{...env,CV_LINK_SECRET:'rotated'}}).verify(original),e=>e.status===404);
 for(const invalid of ['',null,'bad','v1.x.x','x'.repeat(1001)])assert.throws(()=>links.verify(invalid),e=>e.status===404);
});
test('existing Lark secret can sign links without additional setup; invalid origin fails closed',()=>{
 const links=createCvLinks({env:{LARK_APP_SECRET:'synthetic-lark-secret'}});assert.deepEqual(links.verify(token(links.url(scope,'cv-id'))),{scope,id:'cv-id'});
 assert.throws(()=>createCvLinks({env:{}}).url(scope,'cv-id'),e=>e.status===503);
 assert.throws(()=>createCvLinks({env:{...env,PUBLIC_APP_URL:'http://example.test'}}).url(scope,'cv-id'),e=>e.status===503);
});
