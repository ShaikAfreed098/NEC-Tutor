import test from "node:test";
import assert from "node:assert/strict";
import {chunkPage,lexicalRetrieve,normalizeVector} from "../src/lib/retrieval";
import {identify,ensureSameOrigin} from "../src/lib/auth";
import type {Chunk} from "../src/lib/types";
const samples:Chunk[]=[
  {id:"a",documentId:"doc-a",text:"Pointers in C store memory addresses. The address operator helps reference a variable. A pointer can be dereferenced to read the stored value.",page:4,subject:"programming",unit:4,title:"Pointers"},
  {id:"b",documentId:"doc-b",text:"Surveying determines relative positions on the earth. Surveying uses measurement of distances and angles to establish points.",page:2,subject:"civil-mechanical",unit:2,title:"Surveying"},
  {id:"c",documentId:"doc-c",text:"Arrays in C collect related values with the same data type. Array indexing begins at zero. An array can store many integers.",page:3,subject:"programming",unit:3,title:"Arrays"}
];
test("retrieval preserves page and document and respects subject/unit filters",()=>{
  const result=lexicalRetrieve(samples,"Explain pointers and memory addresses","programming",4);
  assert.equal(result[0].chunk.documentId,"doc-a");assert.equal(result[0].chunk.page,4);
  assert.equal(lexicalRetrieve(samples,"pointers memory addresses","chemistry",null).length,0);
  assert.equal(lexicalRetrieve(samples,"pointers memory addresses","programming",3).length,0);
});
test("unsupported exam-date query produces no matches",()=>{assert.equal(lexicalRetrieve(samples,"When is the November examination registration deadline?","all",null).length,0);});
test("chunking covers long page text without dropping its ending",()=>{const text=("Course content and important details. ").repeat(200)+"LAST_SENTENCE";const chunks=chunkPage(text);assert.ok(chunks.length>1);assert.ok(chunks.every(c=>c.length<=1400));assert.ok(chunks.at(-1)?.endsWith("LAST_SENTENCE"));});
test("embeddings are normalized and invalid embeddings are rejected",()=>{const vector=normalizeVector([3,4]);assert.ok(Math.abs(vector[0]-0.6)<1e-9);assert.throws(()=>normalizeVector([0,0]));assert.throws(()=>normalizeVector([NaN,1]));});
test("cross-site writes are rejected",()=>{assert.throws(()=>ensureSameOrigin(new Request("http://127.0.0.1:3000/api/chat",{headers:{origin:"https://unrelated.example"}})));assert.doesNotThrow(()=>ensureSameOrigin(new Request("http://127.0.0.1:3000/api/chat",{headers:{origin:"http://127.0.0.1:3000"}})));});
test("localhost aliases work on the same port, but other ports cannot submit",()=>{assert.doesNotThrow(()=>ensureSameOrigin(new Request("http://localhost:3000/api/chat",{headers:{origin:"http://127.0.0.1:3000"}})));assert.throws(()=>ensureSameOrigin(new Request("http://localhost:3000/api/chat",{headers:{origin:"http://127.0.0.1:4000"}})));});
test("preview students cannot access staff routes or remote preview hosts",async()=>{process.env.NEC_MODE="preview";await assert.rejects(()=>identify(new Request("http://127.0.0.1:3000/api/documents",{headers:{"x-preview-user":"student"}}),true),/Staff access/);await assert.rejects(()=>identify(new Request("https://example.com/api/profile")),/only available/);});
