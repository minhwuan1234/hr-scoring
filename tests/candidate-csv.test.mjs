import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateCsv} from '../server/candidate-csv.mjs';
test('CSV preserves Unicode and quoted fields while exporting scoring and separate human votes',()=>{
 const csv=candidateCsv([{candidateProfile:{name:'Quân, "Minh"',phone:'0900123456',email:'=EVIL()'},fileName:'CV.pdf',positionName:'HR',createdAt:Date.parse('2026-10-25T18:00:00Z'),total:83.6,state:'review',reviewerDecisions:{a:{name:'Annie',decision:'accept'},b:{name:'Trang Liu',decision:'denied'}}}]);
 assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"Quân, ""Minh"""'));assert.ok(csv.includes('"0900123456"'));assert.ok(csv.includes('"\'=EVIL()"'));assert.ok(csv.includes('26 Oct 2026'));assert.ok(csv.includes('"83.6","Review needed","1","1","Annie","Trang Liu"'));assert.equal(csv.split('\r\n').length,3);
});
test('empty exports contain headers and no candidate rows',()=>{assert.equal(candidateCsv([]).split('\r\n').length,2);});
