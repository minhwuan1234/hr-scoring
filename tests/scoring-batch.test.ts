import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreCvBatch} from '../src/scoring-batch.ts';
import type {ScoreResult} from '../src/scoring-api.ts';
const result=(state:'review'|'complete'):ScoreResult=>({id:'synthetic-job',state,version:1,total:0,dimensions:[],pending:[]});
test('batch pauses for human review and automatically continues after it completes',async()=>{
 const calls:string[]=[];let release!:()=>void;let signal!:()=>void;
 const waiting=new Promise<void>(resolve=>{signal=resolve;});
 const run=scoreCvBatch(['first','second','third'],{isActive:()=>true,score:async c=>{calls.push(c);return result(c==='first'?'review':'complete');},onReview:async c=>{calls.push(`review:${c}`);signal();await new Promise<void>(resolve=>{release=resolve;});},onError:()=>assert.fail('No error expected')});
 await waiting;
 assert.deepEqual(calls,['first','review:first']);
 release();await run;
 assert.deepEqual(calls,['first','review:first','second','third']);
});
test('a failed PDF or scoring request does not stop the remaining queue',async()=>{
 const calls:number[]=[],failed:number[]=[],reviews:number[]=[];
 await scoreCvBatch([1,2,3,4],{isActive:()=>true,score:async c=>{calls.push(c);if(c===1||c===3)throw new Error('Synthetic per-file failure');return result(c===4?'review':'complete');},onReview:async c=>{reviews.push(c);},onError:c=>failed.push(c)});
 assert.deepEqual(calls,[1,2,3,4]);assert.deepEqual(failed,[1,3]);assert.deepEqual(reviews,[4]);
});
test('deleted candidates do not pause and inactive workspaces stop new requests',async()=>{
 let mounted=true;const calls:number[]=[];
 await scoreCvBatch([1,2,3,4],{isActive:()=>mounted,score:async c=>{calls.push(c);if(c===1)return undefined;mounted=false;return result('complete');},onReview:async()=>assert.fail('No review expected'),onError:()=>assert.fail('No error expected')});
 assert.deepEqual(calls,[1,2]);
 await scoreCvBatch([],{isActive:()=>true,score:async()=>assert.fail('Empty queues do not score'),onReview:async()=>assert.fail('No review expected'),onError:()=>{}});
});
